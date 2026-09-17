'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';

import type { RealtimeChannel } from '@supabase/supabase-js';

import { createClient } from '@/lib/supabase/client';

import { CHAVE_CONVERSAS, chaveDaLinha } from './dados';
import { chaveDaLeitura } from './leitura-da-ia-dados';

/**
 * O eco do banco: a tela se atualiza sozinha quando o parceiro responde.
 *
 * ===========================================================================
 * O PROBLEMA QUE ISTO RESOLVE
 * ===========================================================================
 * O worker-wa varre a fila a cada 5 s, então a resposta do parceiro está no
 * banco poucos segundos depois de ele apertar enviar. A tela é que não sabia:
 * `useQuery` sem `refetchInterval` busca uma vez e para. Quem atendia
 * descobria a resposta recarregando a página — ou não descobria.
 *
 * ===========================================================================
 * POR QUE ESCUTAR EM VEZ DE PERGUNTAR
 * ===========================================================================
 * A lista de Conversas custa seis leituras, e uma delas traz 3.000 atividades
 * (a decisão está em `dados.ts`). Repetir isso a cada 10 s, por pessoa e por
 * aba, seria pagar caro por uma tela que continuaria atrasada — só que menos.
 *
 * Escutar inverte a conta: o banco avisa, e só então a tela busca. Em dia
 * parado, custo zero. O Realtime avalia a RLS de cada assinante com o JWT dele,
 * então quem não enxerga a conversa não recebe o evento dela — é a mesma
 * fechadura da tela.
 *
 * ===========================================================================
 * AS QUATRO DECISÕES DE COMPORTAMENTO
 * ===========================================================================
 * 1. **O evento não traz o conteúdo para a tela.** Ele diz "mudou algo nesta
 *    conversa", e quem busca é o TanStack Query, pelo PostgREST. Montar a
 *    mensagem a partir do payload seria manter duas montagens diferentes do
 *    mesmo dado — e a do evento nunca veria o que um gatilho mudou depois.
 * 2. **Rajada vira uma busca só.** Cinco mensagens em dois segundos (áudio,
 *    texto, recibo, recibo, ficha) são um `invalidate`, não cinco.
 * 3. **Aba escondida não busca.** Guarda o que mudou e resolve quando a pessoa
 *    volta. Um CRM aberto em oito abas não deve multiplicar por oito a carga de
 *    cada mensagem que chega.
 * 4. **Sem eco, pergunta barato.** Se o socket não sobe (rede da empresa,
 *    proxy, plano), entra uma sondagem de duas consultas minúsculas a cada 20 s
 *    — e ela só dispara a busca pesada quando a assinatura muda. A tela diz em
 *    que modo está, porque "parece parado" e "está parado" precisam ser
 *    distinguíveis por quem usa.
 * 5. **A sondagem não some quando o eco sobe**, só desacelera para 90 s. "Ao
 *    vivo" quer dizer que o canal assinou, não que os eventos estão chegando:
 *    um socket aberto e surdo deixaria a tela morta dizendo que está viva. O
 *    atraso máximo passa a ser um minuto e meio em vez de infinito.
 */

/** As tabelas publicadas no Realtime (migração `20260917150000`). */
export type TabelaDoEco =
  | 'messages'
  | 'conversations'
  | 'message_drafts'
  | 'ficha_da_conversa';

export interface EventoDoEco {
  readonly tabela: TabelaDoEco;
  /** O fio, quando o registro o nomeia. */
  readonly conversaId: string | null;
  /** A ficha do parceiro — é por ela que a linha do tempo é indexada. */
  readonly organizacaoId: string | null;
  /** `true` só para mensagem NOVA vinda do parceiro. É o que merece aviso. */
  readonly respostaDoParceiro: boolean;
}

/**
 * `ligando` é o primeiro instante, `ao_vivo` é o socket de pé, `sem_eco` é a
 * sondagem de reserva. Três estados porque a tela precisa dizer qual é.
 */
export type EstadoDoEco = 'ligando' | 'ao_vivo' | 'sem_eco';

/** Quanto tempo juntar eventos antes de buscar. Rajada vira uma busca só. */
export const ESPERA_DA_RAJADA_MS = 400;

/** Ritmo da sondagem quando não há eco. Barata o bastante para ser frequente. */
export const RITMO_SEM_ECO_MS = 20_000;

/**
 * Ritmo da MESMA sondagem enquanto o eco está de pé.
 *
 * Ela não some quando o socket sobe, e a razão é um modo de falha real: "ao
 * vivo" quer dizer que o canal assinou, não que os eventos estão chegando. Se a
 * publicação sumir numa migração futura, ou se o socket ficar aberto e surdo, a
 * tela diria "ao vivo" e estaria morta — em silêncio, que é a pior forma.
 *
 * A noventa segundos ela custa duas consultas minúsculas por minuto e meio, e é
 * o que garante que o atraso máximo da tela seja um minuto e meio em vez de
 * infinito.
 */
export const RITMO_VIGIANDO_MS = 90_000;

interface RegistroCru {
  readonly id?: unknown;
  readonly conversation_id?: unknown;
  readonly organization_id?: unknown;
  readonly direction?: unknown;
}

function texto(valor: unknown): string | null {
  return typeof valor === 'string' && valor !== '' ? valor : null;
}

/**
 * O que o evento significa, sem React no meio.
 *
 * `conversations` é a própria conversa (o id É o fio); as outras duas a citam.
 * Registro sem id nenhum não diz o que recarregar e vira `null` — é o caso de um
 * payload cortado pela RLS, que não deve virar uma busca no escuro.
 */
export function lerEvento(
  tabela: TabelaDoEco,
  registro: unknown,
  ehInsercao: boolean,
): EventoDoEco | null {
  if (registro === null || typeof registro !== 'object') return null;
  const r = registro as RegistroCru;

  const conversaId = tabela === 'conversations' ? texto(r.id) : texto(r.conversation_id);
  const organizacaoId = texto(r.organization_id);
  if (conversaId === null && organizacaoId === null) return null;

  return {
    tabela,
    conversaId,
    organizacaoId,
    respostaDoParceiro: tabela === 'messages' && ehInsercao && r.direction === 'in',
  };
}

/** O que juntar enquanto a rajada não termina (ou enquanto a aba está escondida). */
export interface Pendencia {
  /** A lista sempre precisa: ordem, prévia e "por ler" mudam com qualquer evento. */
  lista: boolean;
  /** As linhas do tempo abertas que precisam ser buscadas de novo. */
  readonly organizacoes: Set<string>;
  /** As respostas do parceiro, para quem quiser avisar. */
  readonly respostas: EventoDoEco[];
  /** Os fios cuja leitura da IA mudou — ela é indexada pelo fio, não pela ficha. */
  readonly fios: Set<string>;
}

export function pendenciaVazia(): Pendencia {
  return { lista: false, organizacoes: new Set(), respostas: [], fios: new Set() };
}

export function somarAoPendente(pendencia: Pendencia, evento: EventoDoEco): Pendencia {
  // A ficha da IA não mexe na lista: ela não muda ordem, prévia nem "por ler".
  // Recarregar seis consultas porque um resumo foi reescrito seria pagar o preço
  // da lista inteira para atualizar uma faixa de texto.
  if (evento.tabela !== 'ficha_da_conversa') {
    pendencia.lista = true;
    if (evento.organizacaoId !== null) pendencia.organizacoes.add(evento.organizacaoId);
  }
  if (evento.conversaId !== null) pendencia.fios.add(evento.conversaId);
  if (evento.respostaDoParceiro) pendencia.respostas.push(evento);
  return pendencia;
}

/**
 * A assinatura do banco para a sondagem de reserva.
 *
 * Duas perguntas minúsculas — a mensagem mais recente e quantos rascunhos
 * esperam aprovação — viram um texto. Enquanto o texto não muda, nada é
 * buscado: é o que separa "perguntar de 20 em 20 s" de "buscar de 20 em 20 s".
 */
export function assinatura(
  ultimaMensagemEm: string | null,
  rascunhosPendentes: number | null,
): string {
  return `${ultimaMensagemEm ?? '-'}|${rascunhosPendentes ?? -1}`;
}

async function lerAssinatura(supabase: ReturnType<typeof createClient>): Promise<string | null> {
  const [conversa, rascunhos] = await Promise.all([
    supabase
      .from('conversations')
      .select('last_message_at')
      .order('last_message_at', { ascending: false, nullsFirst: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from('message_drafts')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'pendente'),
  ]);

  // Falha de rede não é "nada mudou": devolver uma assinatura inventada faria a
  // tela achar que está em dia. `null` deixa a sondagem tentar de novo.
  if (conversa.error || rascunhos.error) return null;
  return assinatura(conversa.data?.last_message_at ?? null, rascunhos.count ?? 0);
}

/**
 * Liga a tela ao banco. Devolve em que modo ela está.
 *
 * `aoResponderem` é chamado uma vez por rajada, com as respostas que chegaram em
 * conversas que não estão abertas — quem decide o que fazer com isso é a tela.
 */
export function useEcoDasConversas({
  organizacaoAberta,
  aoResponderem,
}: {
  organizacaoAberta: string | null;
  aoResponderem?: (respostas: EventoDoEco[]) => void;
}): EstadoDoEco {
  const clientes = useQueryClient();
  const [estado, setEstado] = useState<EstadoDoEco>('ligando');

  // O que a tela está mostrando agora, sem reassinar o canal a cada troca de
  // conversa: reassinar derrubaria o socket toda vez que alguém clica na lista.
  // Os `ref`s são escritos em efeito, não durante a pintura — escrever em
  // pintura é o que faz o mesmo componente renderizar duas coisas diferentes no
  // modo estrito.
  const abertaAgora = useRef(organizacaoAberta);
  const avisar = useRef(aoResponderem);
  useEffect(() => {
    abertaAgora.current = organizacaoAberta;
    avisar.current = aoResponderem;
  }, [organizacaoAberta, aoResponderem]);

  const pendente = useRef<Pendencia>(pendenciaVazia());
  const relogio = useRef<number | null>(null);
  /** Quantas vezes o eco já buscou. A sondagem usa isto para não buscar de novo. */
  const buscasDoEco = useRef(0);

  const resolver = useCallback(() => {
    if (relogio.current !== null) {
      window.clearTimeout(relogio.current);
      relogio.current = null;
    }
    const pendencia = pendente.current;
    pendente.current = pendenciaVazia();
    if (!pendencia.lista && pendencia.fios.size === 0) return;

    buscasDoEco.current += 1;
    if (pendencia.lista) void clientes.invalidateQueries({ queryKey: CHAVE_CONVERSAS });
    for (const organizacaoId of pendencia.organizacoes) {
      void clientes.invalidateQueries({ queryKey: chaveDaLinha(organizacaoId) });
    }
    for (const fioId of pendencia.fios) {
      void clientes.invalidateQueries({ queryKey: chaveDaLeitura(fioId) });
    }

    const deFora = pendencia.respostas.filter((r) => r.organizacaoId !== abertaAgora.current);
    if (deFora.length > 0) avisar.current?.(deFora);
  }, [clientes]);

  const agendar = useCallback(() => {
    // Escondida, nada é buscado: guarda e resolve quando a pessoa voltar.
    if (typeof document !== 'undefined' && document.hidden) return;
    if (relogio.current !== null) return;
    relogio.current = window.setTimeout(resolver, ESPERA_DA_RAJADA_MS);
  }, [resolver]);

  // ---------- 1. o eco ----------
  useEffect(() => {
    const supabase = createClient();
    let canal: RealtimeChannel | null = null;
    let desmontou = false;

    const ligar = async () => {
      // A SESSÃO PRIMEIRO, E ISTO NÃO É ZELO EXCESSIVO.
      //
      // O cliente avisa o Realtime do token quando a sessão carrega, e isso
      // acontece DEPOIS de o objeto existir. Assinar antes conecta o socket só
      // com a chave anônima — e aí a RLS faz o certo, que é não entregar evento
      // nenhum. O sintoma seria "a tela não atualiza", sem erro em lugar nenhum.
      // Ler os cookies custa nada e tira a corrida do caminho.
      await supabase.auth.getSession();
      if (desmontou) return;

      // Nome único por montagem: no modo estrito o React monta duas vezes, e
      // dois canais com o mesmo nome no mesmo cliente é assinatura repetida.
      const novo = supabase.channel(`conversas-ao-vivo-${crypto.randomUUID().slice(0, 8)}`);

      const escutar = (tabela: TabelaDoEco) => {
        novo.on(
          'postgres_changes',
          { event: '*', schema: 'public', table: tabela },
          (payload: { eventType: string; new?: unknown }) => {
            const evento = lerEvento(tabela, payload.new, payload.eventType === 'INSERT');
            if (evento === null) return;
            somarAoPendente(pendente.current, evento);
            agendar();
          },
        );
      };

      escutar('messages');
      escutar('conversations');
      escutar('message_drafts');
      escutar('ficha_da_conversa');

      novo.subscribe((status) => {
        // `CLOSED` é também o que chega ao desmontar; o efeito já terá saído.
        if (!desmontou) setEstado(status === 'SUBSCRIBED' ? 'ao_vivo' : 'sem_eco');
      });
      canal = novo;
    };

    void ligar();

    return () => {
      desmontou = true;
      if (canal !== null) void supabase.removeChannel(canal);
      if (relogio.current !== null) window.clearTimeout(relogio.current);
      relogio.current = null;
    };
  }, [agendar]);

  // ---------- 2. voltar para a aba resolve o que ficou guardado ----------
  useEffect(() => {
    const aoVoltar = () => {
      if (document.hidden) return;
      resolver();
    };
    document.addEventListener('visibilitychange', aoVoltar);
    return () => document.removeEventListener('visibilitychange', aoVoltar);
  }, [resolver]);

  // ---------- 3. a sondagem: reserva quando não há eco, vigia quando há ----------
  useEffect(() => {
    const supabase = createClient();
    let ultima: string | null = null;
    let buscasVistas = buscasDoEco.current;
    let vivo = true;

    const sondar = async () => {
      if (document.hidden) return;
      const agora = await lerAssinatura(supabase);
      if (!vivo || agora === null) return;

      const ecoJaBuscou = buscasDoEco.current !== buscasVistas;
      buscasVistas = buscasDoEco.current;

      // Três motivos para só reposicionar a régua, sem buscar nada:
      // é a primeira leitura (o ponto de partida), nada mudou, ou o eco já
      // buscou por conta dele — e aí buscar de novo seria pagar duas vezes pela
      // mesma mensagem.
      if (ultima !== null && agora !== ultima && !ecoJaBuscou) {
        pendente.current.lista = true;
        const aberta = abertaAgora.current;
        if (aberta !== null) pendente.current.organizacoes.add(aberta);
        resolver();
      }
      ultima = agora;
    };

    void sondar();
    const id = window.setInterval(
      () => void sondar(),
      estado === 'ao_vivo' ? RITMO_VIGIANDO_MS : RITMO_SEM_ECO_MS,
    );
    return () => {
      vivo = false;
      window.clearInterval(id);
    };
  }, [estado, resolver]);

  return estado;
}
