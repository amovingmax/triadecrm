'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef } from 'react';
import { toast } from 'sonner';

import { mostrarAviso, ouvirCliqueNoAviso } from '@/components/avisos/aviso-do-navegador';
import { estaSilenciado, somEstaLigado } from '@/components/avisos/preferencias';
import { outraAbaJaTocou, somDestravado, tocarSom } from '@/components/avisos/som';
import { EMPRESA } from '@/lib/empresa';

import {
  acaoDoLead,
  destinoDosLeads,
  ehAlvoDeLead,
  linhaDoLead,
  pisoDepois,
  textoDoAvisoDeLead,
  type AlvoDoLead,
  type LeadDoAviso,
} from './aviso-de-lead';
import {
  CHAVE_DOS_LEADS,
  CHAVE_DOS_LEADS_NOVOS,
  contarLeadsNovos,
  lerLeadsQueEscreveram,
  lerNomesDosLeads,
  lerUltimoLeadQueEscreveu,
  type LeadQueEscreveu,
} from './leads-dados';

/**
 * O aviso de lead novo dos portais, no computador (11/11/2026), só na Imova.
 *
 * Pedido do usuário: "O lead deve aparecer na aba de leads em anúncios e
 * devemos ser notificados que um novo lead chega." O lead que escreveu pelo
 * portal (chat, formulário, pedido de visita) não tem conversa de WhatsApp, então
 * o aviso de mensagem nova (`components/avisos/provedor-avisos.tsx`) não o via.
 *
 * O que faz, em qualquer tela do CRM:
 * - a cada 30 segundos, e ao voltar para a aba, lê os leads que escreveram
 *   depois do último visto (`portal_leads.escreveu_em`, migração 20261111120000);
 * - para cada lead novo: o cartão "Novo lead do portal" com "Ver lead", o toque
 *   (o mesmo do aviso de mensagem, que sai no menu da conta) e, com o CRM fora de
 *   vista, a notificação do sistema;
 * - mantém o número de leads sem resposta ao lado de Anúncios no menu e no alto
 *   da aba Leads, e recarrega a lista quando chega lead.
 *
 * As mesmas regras do aviso de mensagem: "Silenciar avisos" no menu da conta cala
 * tudo; a primeira leitura num navegador não anuncia o que já estava lá; o piso
 * fica no aparelho e é dividido entre as abas, então uma aba não anuncia de novo o
 * que a outra já anunciou. O celular é avisado pelo banco (aviso "Lead novo dos
 * portais", na rodada de 10 segundos). Não escreve nada no banco.
 */

const RITMO_MS = 30_000;
const CHAVE_DO_PISO = 'komune.avisos.leads-visto.v1';
const ANTES_DE_TUDO = '1970-01-01T00:00:00+00:00';
/** Cartões soltos de uma vez; o resto vira um cartão só, "mais N". */
const CARTOES_SOLTOS = 3;
const DURACAO_DO_CARTAO_MS = 20_000;

interface LeadsNovos {
  /** Leads que escreveram e estão sem resposta. `null` = não se sabe, ou não vale aqui. */
  readonly novos: number | null;
}

const Contexto = createContext<LeadsNovos>({ novos: null });

export function useLeadsNovos(): LeadsNovos {
  return useContext(Contexto);
}

function lerPiso(usuarioId: string): string | null {
  try {
    return window.localStorage.getItem(`${CHAVE_DO_PISO}:${usuarioId}`);
  } catch {
    return null;
  }
}

function gravarPiso(usuarioId: string, piso: string): void {
  try {
    window.localStorage.setItem(`${CHAVE_DO_PISO}:${usuarioId}`, piso);
  } catch {
    // Sem armazenamento, o piso fica só na memória desta aba.
  }
}

export function VigiaDeLeads({
  usuarioId,
  ligado,
  children,
}: {
  usuarioId: string;
  /** Imova com Anúncios, e papel que atende (admin, gestor e SDR). */
  ligado: boolean;
  children: React.ReactNode;
}) {
  const roteador = useRouter();
  const consultas = useQueryClient();
  const contagem = useQuery({
    queryKey: CHAVE_DOS_LEADS_NOVOS,
    queryFn: contarLeadsNovos,
    enabled: ligado,
    staleTime: 30_000,
    refetchInterval: 60_000,
  });

  const roteadorAgora = useRef(roteador);
  useEffect(() => {
    roteadorAgora.current = roteador;
  }, [roteador]);
  /** O piso desta aba, para quando o aparelho não guarda nada. */
  const pisoNaMemoria = useRef<string | null>(null);
  const lendo = useRef(false);

  const abrir = useCallback((ids: readonly string[]) => {
    roteadorAgora.current.push(destinoDosLeads(ids));
  }, []);

  const avisar = useCallback(
    async (lidos: readonly LeadQueEscreveu[]) => {
      if (estaSilenciado(usuarioId)) return;
      const nomes = await lerNomesDosLeads(lidos.map((l) => l.id));
      const leads: LeadDoAviso[] = lidos.map((l) => ({
        id: l.id,
        nome: nomes.get(l.id) ?? null,
        acao: acaoDoLead(l.tipos),
        codigo: l.codigo,
      }));

      const soltos = leads.slice(0, CARTOES_SOLTOS);
      for (const lead of soltos) {
        toast('Novo lead do portal', {
          id: `lead:${lead.id}`,
          description: linhaDoLead(lead),
          duration: DURACAO_DO_CARTAO_MS,
          action: { label: 'Ver lead', onClick: () => abrir([lead.id]) },
        });
      }
      const resto = leads.length - soltos.length;
      if (resto > 0) {
        toast(`Mais ${resto} ${resto === 1 ? 'lead novo' : 'leads novos'} do portal`, {
          id: `leads:${leads.map((l) => l.id).join(',')}`,
          duration: DURACAO_DO_CARTAO_MS,
          action: { label: 'Ver leads', onClick: () => abrir([]) },
        });
      }

      // O toque sai de uma aba só (ver `som.ts`).
      const ids = leads.map((l) => l.id);
      const marca = `lead:${ids.join(',')}`;
      const comSom = somEstaLigado(usuarioId);
      const somResolvido =
        comSom && somDestravado() && (outraAbaJaTocou(usuarioId, marca) || tocarSom());

      if (document.hidden || !document.hasFocus()) {
        const texto = textoDoAvisoDeLead(leads, EMPRESA.nomeNoAviso);
        const alvos: AlvoDoLead[] = ids.map((lead) => ({ lead }));
        void mostrarAviso({
          titulo: texto.titulo,
          corpo: texto.corpo,
          marca,
          botao: ids.length === 1 ? 'Ver lead' : 'Ver leads',
          alvos,
          destino: destinoDosLeads(ids),
          silenciosa: !comSom || somResolvido,
          aoClicar: () => abrir(ids),
        });
      }
    },
    [usuarioId, abrir],
  );

  const conferir = useCallback(async () => {
    if (!ligado || lendo.current) return;
    lendo.current = true;
    try {
      const piso = lerPiso(usuarioId) ?? pisoNaMemoria.current;
      if (piso === null) {
        // Primeira vez neste navegador: o que já estava lá não é novidade.
        const ultimo = await lerUltimoLeadQueEscreveu();
        if (ultimo === undefined) return;
        pisoNaMemoria.current = ultimo ?? ANTES_DE_TUDO;
        gravarPiso(usuarioId, pisoNaMemoria.current);
        return;
      }

      const lidos = await lerLeadsQueEscreveram(piso);
      if (lidos === null || lidos.length === 0) return;

      // Outra aba pode ter anunciado estes enquanto esta lia.
      const agora = lerPiso(usuarioId) ?? piso;
      const ineditos = lidos.filter((l) => Date.parse(l.escreveuEm) > Date.parse(agora));
      const proximo = pisoDepois(agora, lidos);
      pisoNaMemoria.current = proximo;
      gravarPiso(usuarioId, proximo);

      // A lista e os números de Leads, em qualquer tela que os mostre.
      void consultas.invalidateQueries({ queryKey: CHAVE_DOS_LEADS });
      if (ineditos.length > 0) await avisar(ineditos);
    } finally {
      lendo.current = false;
    }
  }, [ligado, usuarioId, consultas, avisar]);

  useEffect(() => {
    if (!ligado) return;
    void conferir();
    const relogio = window.setInterval(() => void conferir(), RITMO_MS);
    const aoVoltar = () => {
      if (!document.hidden) void conferir();
    };
    document.addEventListener('visibilitychange', aoVoltar);
    window.addEventListener('focus', aoVoltar);
    return () => {
      window.clearInterval(relogio);
      document.removeEventListener('visibilitychange', aoVoltar);
      window.removeEventListener('focus', aoVoltar);
    };
  }, [ligado, conferir]);

  // O clique na notificação do sistema volta pela aba (`sw-avisos.js`). O aviso
  // de mensagem escuta o mesmo canal e deixa passar o que não é conversa.
  useEffect(() => {
    if (!ligado) return;
    return ouvirCliqueNoAviso<unknown>((alvos) => {
      const ids = alvos.filter(ehAlvoDeLead).map((a) => a.lead);
      if (ids.length > 0) abrir(ids);
    });
  }, [ligado, abrir]);

  const valor = useMemo<LeadsNovos>(
    () => ({ novos: ligado ? (contagem.data ?? null) : null }),
    [ligado, contagem.data],
  );

  return <Contexto.Provider value={valor}>{children}</Contexto.Provider>;
}
