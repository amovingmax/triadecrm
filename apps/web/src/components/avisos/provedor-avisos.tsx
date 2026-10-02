'use client';

import { usePathname, useRouter } from 'next/navigation';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import type { RealtimeChannel } from '@supabase/supabase-js';

import { ESPERA_DA_RAJADA_MS, RITMO_VIGIANDO_MS } from '@/components/conversas/eco-do-banco';
import { type AppRole } from '@/lib/auth/role';
import { estaAtivo } from '@/lib/navegacao';
import { createClient } from '@/lib/supabase/client';

import {
  mostrarAviso,
  pedirPermissao as pedirAoNavegador,
  usePermissao,
  type Permissao,
} from './aviso-do-navegador';
import {
  ANTES_DE_TUDO,
  lerConversasComResposta,
  lerFichasDoAviso,
  lerPessoasAtivas,
  lerUltimaChegada,
  lerUltimasMensagens,
} from './dados';
import {
  chaveDasAbertas,
  chaveDoVisto,
  estaSilenciado,
  gravarVistoAte,
  lerAbertas,
  lerVistoAte,
  marcarAberta,
  podarAbertas,
  useConviteDispensado,
  useSilenciado,
} from './preferencias';
import {
  aindaNaoAbertas,
  chegaramAgora,
  contextoDoAviso,
  destinoDoAviso,
  maisRecente,
  marcaDoAviso,
  nomeDoAviso,
  pisoPossivel,
  previaDaMensagem,
  recebeAvisos,
  respostasParaMim,
  textoDoAviso,
  tipoDoAviso,
  type ContextoDoAviso,
  type ConversaComResposta,
  type TipoDoAviso,
} from './regra';

/**
 * O aviso de resposta: a casca do CRM fica sabendo que alguém escreveu, em
 * qualquer tela, e diz isso a quem atende.
 *
 * ===========================================================================
 * O QUE ISTO FAZ, E O QUE NÃO FAZ
 * ===========================================================================
 * Escuta a chegada de mensagem pelo Realtime, lê quais conversas têm mensagem
 * nova PARA ESTA PESSOA (`regra.ts`) e faz três coisas com isso: o número ao lado
 * de Conversas, o cartão "Nova mensagem" no canto da tela (`pilha-de-avisos`) e,
 * com o CRM fora de vista, a notificação do sistema.
 *
 * Não escreve em lugar nenhum. Não envia nada à Meta, não marca mensagem como
 * lida, não muda o dono de conversa nenhuma. Se tudo aqui falhar, a mensagem
 * chega e aparece na lista exatamente como antes.
 *
 * ===========================================================================
 * AS DECISÕES DE COMPORTAMENTO
 * ===========================================================================
 * 1. **O evento só acorda; quem decide é a leitura.** Como no eco da tela de
 *    Conversas, o payload não é a fonte: ele não diz quem atende nem se alguém
 *    já escreveu. A cada evento a casca refaz UMA consulta pequena e aplica a
 *    regra. O mesmo caminho serve à sondagem de reserva.
 * 2. **Aba escondida confere na hora.** O navegador atrasa relógio de aba em
 *    segundo plano para até um minuto; um `setTimeout` de 400 ms ali viraria o
 *    atraso do aviso. O evento do socket não é atrasado, e a leitura parte dele.
 *    Com a aba à vista, a rajada vira uma leitura só.
 * 3. **A sondagem roda também escondida** — é o contrário do eco de Conversas, e
 *    de propósito. Lá, aba escondida não busca para não multiplicar a carga de
 *    uma lista pesada. Aqui a aba escondida é exatamente o caso que importa, e a
 *    consulta é mínima: se o socket cair, o aviso atrasa um minuto e meio em vez
 *    de não vir.
 * 4. **O número cai conversa a conversa, e não ao entrar na tela** (02/10/2026).
 *    Janio: "ele não deve desaparecer todo de uma vez assim que eu abro a aba de
 *    conversas... caso eu abra uma mensagem ele sai de 5 e vai pra 4". Ver a
 *    lista não é ler a conversa. Cada conversa conta, e leva a marca "Nova" na
 *    lista, até a pessoa ABRI-LA — por escolha: um clique na lista, o botão
 *    Responder do cartão ou um link. A que o desktop abre sozinho por ser a
 *    primeira da lista não conta como aberta; é a mesma regra com que a tela
 *    zera o "por ler" (`conversa.tsx`, `escolhaExplicita`).
 *    O cartão continua aparecendo para as OUTRAS conversas; a que está na tela
 *    não avisa, porque a mensagem dela já entrou diante da pessoa.
 * 5. **A primeira leitura não avisa ninguém.** Ela mostra o número do que já
 *    esperava e estabelece a linha de base; recarregar a página não anuncia de
 *    novo o que estava lá.
 * 6. **O cartão aparece mesmo quando a notificação do sistema saiu.** Quem volta
 *    para a aba encontra o cartão esperando, e ele só começa a contar o tempo
 *    quando a pessoa está olhando (ver `pilha-de-avisos`).
 */

/** O cartão "Nova mensagem" de uma conversa. */
export interface CartaoDeAviso {
  readonly conversaId: string;
  readonly organizacaoId: string | null;
  /** Parceiro (tem ficha) ou cliente: decide o selo e o avatar do cartão. */
  readonly tipo: TipoDoAviso;
  readonly nome: string;
  /** A linha sob o nome: categoria e etapa do parceiro, ou "Cliente do app". */
  readonly contexto: ContextoDoAviso;
  /** O começo da mensagem, ou o que chegou no lugar de texto. `null` = não se sabe. */
  readonly previa: string | null;
  readonly chegouEm: string;
}

/** Qual conversa abrir: a da ficha, ou a de quem não é ficha. */
export interface AlvoDaConversa {
  readonly conversaId: string;
  readonly organizacaoId: string | null;
}

interface Avisos {
  /**
   * Conversas com mensagem nova para esta pessoa, que ela ainda não abriu.
   * `null` enquanto não se sabe.
   */
  readonly respostasNovas: number | null;
  /** O papel desta pessoa é avisado? Leitura e financeiro não são. */
  readonly recebe: boolean;
  readonly silenciado: boolean;
  readonly silenciar: (silenciar: boolean) => void;
  readonly permissao: Permissao;
  readonly pedirPermissao: () => Promise<Permissao>;
  /** O convite de ligar as notificações do navegador ainda cabe? */
  readonly conviteAberto: boolean;
  readonly dispensarConvite: () => void;
  /** Os cartões na tela, do mais novo para o mais antigo. */
  readonly cartoes: readonly CartaoDeAviso[];
  readonly dispensarCartao: (conversaId: string) => void;
  readonly dispensarTodos: () => void;
  readonly abrirConversa: (alvo: AlvoDaConversa) => void;
}

/**
 * O que a tela de Conversas diz à casca. Fica num contexto à parte, de valor
 * estável: a tela é pesada, e não deve repintar a cada cartão que entra ou sai.
 */
interface AcoesDosAvisos {
  /**
   * Qual conversa está aberta diante da pessoa (id da conversa), ou `null`.
   * `porEscolha` diz se foi ela quem abriu; a que o desktop abre sozinho por ser
   * a primeira da lista não deixa de ser nova.
   */
  readonly olharConversa: (conversaId: string | null, porEscolha?: boolean) => void;
  /** A tela montada sabe abrir uma conversa sem navegar; `null` ao desmontar. */
  readonly registrarAbridor: (abrir: ((alvo: AlvoDaConversa) => void) | null) => void;
}

const SEM_AVISOS: Avisos = {
  respostasNovas: null,
  recebe: false,
  silenciado: false,
  silenciar: () => undefined,
  permissao: 'sem_suporte',
  pedirPermissao: async () => 'sem_suporte',
  conviteAberto: false,
  dispensarConvite: () => undefined,
  cartoes: [],
  dispensarCartao: () => undefined,
  dispensarTodos: () => undefined,
  abrirConversa: () => undefined,
};

const SEM_ACOES: AcoesDosAvisos = {
  olharConversa: () => undefined,
  registrarAbridor: () => undefined,
};

const SEM_NOVAS: ReadonlySet<string> = new Set();

const Contexto = createContext<Avisos>(SEM_AVISOS);
const ContextoDeAcoes = createContext<AcoesDosAvisos>(SEM_ACOES);
const ContextoDasNovas = createContext<ReadonlySet<string>>(SEM_NOVAS);

export function useAvisos(): Avisos {
  return useContext(Contexto);
}

export function useAcoesDosAvisos(): AcoesDosAvisos {
  return useContext(ContextoDeAcoes);
}

/**
 * Os ids das conversas com mensagem nova que esta pessoa ainda não abriu: é o
 * que a lista marca com "Nova". Num contexto à parte, e o conjunto só troca de
 * identidade quando muda de conteúdo — quem repinta é a lista, não a tela.
 */
export function useConversasNovas(): ReadonlySet<string> {
  return useContext(ContextoDasNovas);
}

function mesmoConjunto(a: ReadonlySet<string>, b: readonly string[]): boolean {
  return a.size === b.length && b.every((id) => a.has(id));
}

/** Quantos cartões a casca guarda. A pilha mostra menos e resume o resto. */
const TETO_DE_CARTOES = 8;

export function ProvedorDeAvisos({
  usuarioId,
  papel,
  children,
}: {
  usuarioId: string;
  papel: AppRole;
  children: React.ReactNode;
}) {
  const recebe = recebeAvisos(papel);
  const rota = usePathname();
  const roteador = useRouter();
  const emConversas = estaAtivo(rota, '/conversas');

  const [respostasNovas, setRespostasNovas] = useState<number | null>(null);
  const [novasIds, setNovasIds] = useState<ReadonlySet<string>>(SEM_NOVAS);
  const [cartoes, setCartoes] = useState<readonly CartaoDeAviso[]>([]);
  const [silenciado, silenciar] = useSilenciado(usuarioId);
  const [conviteDispensado, dispensarConvite] = useConviteDispensado(usuarioId);
  const permissao = usePermissao();

  // O que muda sem reassinar o canal: trocar de tela não pode derrubar o socket.
  // Os `ref`s são escritos em efeito, não durante a pintura (ver `eco-do-banco`).
  const emConversasAgora = useRef(emConversas);
  const roteadorAgora = useRef(roteador);
  useEffect(() => {
    roteadorAgora.current = roteador;
  }, [roteador]);

  /** Chegada conhecida de cada conversa minha. `null` até a primeira leitura. */
  const conhecidas = useRef<Map<string, string> | null>(null);
  const ativos = useRef<Set<string> | null>(null);
  /** Só confere depois de saber quem está ativo: a linha de base não pode mudar de regra no meio. */
  const pronto = useRef(false);
  const lendo = useRef(false);
  const deNovo = useRef(false);
  const relogio = useRef<number | null>(null);
  /** As conversas minhas da última leitura: é delas que sai o número. */
  const minhasAgora = useRef<readonly ConversaComResposta[] | null>(null);
  /** O que a tela de Conversas contou: a conversa aberta e como abrir outra. */
  const conversaAberta = useRef<string | null>(null);
  /** A mesma conversa, só quando foi a pessoa quem a abriu. */
  const abertaPorEscolha = useRef<string | null>(null);
  const abridor = useRef<((alvo: AlvoDaConversa) => void) | null>(null);

  const dispensarCartao = useCallback((conversaId: string) => {
    setCartoes((atuais) => atuais.filter((c) => c.conversaId !== conversaId));
  }, []);
  const dispensarTodos = useCallback(() => setCartoes([]), []);

  /** Refaz o número e as marcas "Nova" a partir da última leitura e do que foi aberto. */
  const publicar = useCallback((): readonly ConversaComResposta[] => {
    const minhas = minhasAgora.current;
    if (minhas === null) return [];
    const porAbrir = aindaNaoAbertas(minhas, lerAbertas(usuarioId));
    const ids = porAbrir.map((c) => c.conversaId);
    setRespostasNovas(porAbrir.length);
    setNovasIds((atuais) => (mesmoConjunto(atuais, ids) ? atuais : new Set(ids)));
    return porAbrir;
  }, [usuarioId]);

  /**
   * A conversa que a pessoa abriu deixa de ser nova — se ela está olhando: na
   * tela de Conversas, com a aba à vista e a janela em foco. O CRM num segundo
   * monitor, com a pessoa digitando em outro programa, não está sendo olhado.
   */
  const marcarAConversaAberta = useCallback((): boolean => {
    const conversaId = abertaPorEscolha.current;
    if (conversaId === null) return false;
    if (!emConversasAgora.current || document.hidden || !document.hasFocus()) return false;
    const chegouEm = minhasAgora.current?.find((c) => c.conversaId === conversaId)?.chegouEm;
    if (chegouEm === undefined) return false;
    return marcarAberta(usuarioId, conversaId, chegouEm);
  }, [usuarioId]);

  const abrir = useCallback((alvos: readonly AlvoDaConversa[]) => {
    const unico = alvos.length === 1 ? alvos[0] : undefined;
    // Com a tela de Conversas montada, quem abre é ela: navegar para o mesmo
    // endereço não trocaria a conversa, porque o estado dela mora no cliente.
    if (unico && abridor.current) abridor.current(unico);
    else roteadorAgora.current.push(destinoDoAviso(alvos));
  }, []);

  const abrirConversa = useCallback(
    (alvo: AlvoDaConversa) => {
      dispensarCartao(alvo.conversaId);
      abrir([alvo]);
    },
    [abrir, dispensarCartao],
  );

  const avisar = useCallback(
    async (novas: readonly ConversaComResposta[]) => {
      if (estaSilenciado(usuarioId)) return;

      const fichas = novas.flatMap((c) => (c.organizacaoId ? [c.organizacaoId] : []));
      const [fichasDoAviso, ultimas] = await Promise.all([
        lerFichasDoAviso(fichas),
        lerUltimasMensagens(novas.map((c) => c.conversaId)),
      ]);
      const novos = novas.map((c): CartaoDeAviso => {
        const ultima = ultimas.get(c.conversaId);
        const ficha = c.organizacaoId ? (fichasDoAviso.get(c.organizacaoId) ?? null) : null;
        return {
          conversaId: c.conversaId,
          organizacaoId: c.organizacaoId,
          tipo: tipoDoAviso(c),
          nome: nomeDoAviso(c, ficha?.nome ?? null),
          contexto: contextoDoAviso(c, ficha),
          previa: previaDaMensagem(ultima?.tipo ?? null, ultima?.corpo ?? null),
          chegouEm: c.chegouEm,
        };
      });

      // O cartão entra sempre. A conversa que já tinha cartão troca o dela pelo
      // novo, no topo: é a mesma pessoa escrevendo de novo.
      setCartoes((atuais) => {
        const chegando = new Set(novos.map((c) => c.conversaId));
        return [...novos, ...atuais.filter((c) => !chegando.has(c.conversaId))].slice(
          0,
          TETO_DE_CARTOES,
        );
      });

      // Fora de vista é a aba escondida OU a janela sem foco: o CRM num segundo
      // monitor, com a pessoa digitando em outro programa, também não está sendo
      // olhado. Aí o sistema avisa — sem o texto da mensagem (ver `textoDoAviso`).
      if (document.hidden || !document.hasFocus()) {
        const texto = textoDoAviso(novos.map((c) => c.nome));
        mostrarAviso({
          titulo: texto.titulo,
          corpo: texto.corpo,
          marca: marcaDoAviso(novas),
          aoClicar: () => {
            for (const c of novos) dispensarCartao(c.conversaId);
            abrir(novos);
          },
        });
      }
    },
    [usuarioId, abrir, dispensarCartao],
  );

  const conferir = useCallback(async () => {
    if (!recebe || !pronto.current) return;
    // Uma leitura por vez. O que chegar no meio pede só mais uma, no fim.
    if (lendo.current) {
      deNovo.current = true;
      return;
    }

    const umaVez = async () => {
      let desde = lerVistoAte(usuarioId);
      if (desde === null) {
        // Primeira vez neste navegador: o que já estava lá não é novidade.
        const ultima = await lerUltimaChegada();
        if (ultima === undefined) return;
        desde = ultima ?? ANTES_DE_TUDO;
        gravarVistoAte(usuarioId, desde);
      }

      const conversas = await lerConversasComResposta(desde);
      if (conversas === null) return;

      const minhas = respostasParaMim(conversas, { id: usuarioId, papel }, ativos.current);
      let novas = chegaramAgora(conhecidas.current, minhas);
      conhecidas.current = new Map(minhas.map((c) => [c.conversaId, c.chegouEm]));
      minhasAgora.current = minhas;

      // A conversa que a pessoa abriu e está olhando segue aberta: a mensagem
      // que chega nela não a faz voltar a contar.
      marcarAConversaAberta();
      const porAbrir = publicar();

      // O piso só anda sobre o que já foi aberto (ver `pisoPossivel`). O que ele
      // cobre sai do registro das abertas E da lista em memória, juntos: ficar
      // na lista sem estar no registro faria a conversa já aberta voltar a
      // contar no próximo clique, até a leitura seguinte.
      const piso = pisoPossivel(conversas, porAbrir);
      if (piso !== null) {
        gravarVistoAte(usuarioId, piso);
        podarAbertas(usuarioId, piso);
        minhasAgora.current = minhas.filter((c) => maisRecente(c.chegouEm, piso) > 0);
      }

      // O cartão não anuncia a conversa que está na tela, diante da pessoa —
      // aberta por ela ou pelo desktop.
      const olhando = emConversasAgora.current && !document.hidden && document.hasFocus();
      if (olhando) novas = novas.filter((c) => c.conversaId !== conversaAberta.current);

      if (novas.length > 0) await avisar(novas);
    };

    lendo.current = true;
    try {
      do {
        deNovo.current = false;
        await umaVez();
      } while (deNovo.current);
    } finally {
      lendo.current = false;
    }
  }, [recebe, usuarioId, papel, avisar, publicar, marcarAConversaAberta]);

  // ---------- 1. o socket acorda, a sondagem garante ----------
  useEffect(() => {
    if (!recebe) return;

    const supabase = createClient();
    let canal: RealtimeChannel | null = null;
    let desmontou = false;

    const aoChegar = () => {
      if (document.hidden) {
        void conferir();
        return;
      }
      if (relogio.current !== null) return;
      relogio.current = window.setTimeout(() => {
        relogio.current = null;
        void conferir();
      }, ESPERA_DA_RAJADA_MS);
    };

    const ligar = async () => {
      // A sessão primeiro: assinar antes conecta o socket só com a chave anônima,
      // e a RLS não entrega evento nenhum (ver `eco-do-banco.ts`).
      await supabase.auth.getSession();
      if (desmontou) return;

      ativos.current = await lerPessoasAtivas();
      if (desmontou) return;
      pronto.current = true;
      void conferir();

      // Toda mensagem nova, e não só a de entrada: a resposta de um colega é o
      // que tira a conversa do meu número, e ela chega como saída.
      const novo = supabase.channel(`avisos-de-resposta-${crypto.randomUUID().slice(0, 8)}`);
      novo.on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'messages' },
        aoChegar,
      );
      novo.subscribe();
      canal = novo;
    };

    void ligar();
    const sondagem = window.setInterval(() => void conferir(), RITMO_VIGIANDO_MS);

    return () => {
      desmontou = true;
      window.clearInterval(sondagem);
      if (canal !== null) void supabase.removeChannel(canal);
      if (relogio.current !== null) window.clearTimeout(relogio.current);
      relogio.current = null;
    };
  }, [recebe, conferir]);

  // ---------- 2. entrar em Conversas, ou sair dela, muda o que está sendo olhado ----------
  useEffect(() => {
    emConversasAgora.current = emConversas;
    void conferir();
  }, [emConversas, conferir]);

  // ---------- 3. voltar para a aba ou para a janela, e o que outra aba abriu ----------
  useEffect(() => {
    if (!recebe) return;

    const aoVoltar = () => {
      if (!document.hidden) void conferir();
    };
    const aoGuardar = (evento: StorageEvent) => {
      // Outra aba abriu uma conversa: o número cai aqui também, sem ir ao banco.
      if (evento.key === chaveDasAbertas(usuarioId)) publicar();
      else if (evento.key === chaveDoVisto(usuarioId)) void conferir();
    };
    document.addEventListener('visibilitychange', aoVoltar);
    window.addEventListener('focus', aoVoltar);
    window.addEventListener('storage', aoGuardar);
    return () => {
      document.removeEventListener('visibilitychange', aoVoltar);
      window.removeEventListener('focus', aoVoltar);
      window.removeEventListener('storage', aoGuardar);
    };
  }, [recebe, usuarioId, conferir, publicar]);

  const pedirPermissao = useCallback(() => pedirAoNavegador(), []);

  const acoes = useMemo<AcoesDosAvisos>(
    () => ({
      olharConversa: (conversaId, porEscolha = false) => {
        conversaAberta.current = conversaId;
        abertaPorEscolha.current = porEscolha ? conversaId : null;
        // Abriu a conversa, o cartão dela perdeu o sentido.
        if (conversaId !== null) dispensarCartao(conversaId);
        // E, aberta por escolha, ela deixa de ser nova na hora, sem esperar a
        // próxima leitura: o número cai e a marca some no mesmo clique.
        if (marcarAConversaAberta()) publicar();
      },
      registrarAbridor: (abrirNaTela) => {
        abridor.current = abrirNaTela;
      },
    }),
    [dispensarCartao, marcarAConversaAberta, publicar],
  );

  const valor = useMemo<Avisos>(
    () => ({
      respostasNovas: recebe ? respostasNovas : null,
      recebe,
      silenciado,
      silenciar,
      permissao,
      pedirPermissao,
      conviteAberto: recebe && permissao === 'a_pedir' && !silenciado && !conviteDispensado,
      dispensarConvite,
      cartoes,
      dispensarCartao,
      dispensarTodos,
      abrirConversa,
    }),
    [
      recebe,
      respostasNovas,
      silenciado,
      silenciar,
      permissao,
      pedirPermissao,
      conviteDispensado,
      dispensarConvite,
      cartoes,
      dispensarCartao,
      dispensarTodos,
      abrirConversa,
    ],
  );

  return (
    <ContextoDeAcoes.Provider value={acoes}>
      <ContextoDasNovas.Provider value={recebe ? novasIds : SEM_NOVAS}>
        <Contexto.Provider value={valor}>{children}</Contexto.Provider>
      </ContextoDasNovas.Provider>
    </ContextoDeAcoes.Provider>
  );
}
