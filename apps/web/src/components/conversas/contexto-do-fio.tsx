'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import { useEu } from './assumir-conversa';
import { achadosNoFio } from './busca-no-fio';
import { carregarFavoritas, CHAVE_CONVERSAS, CHAVE_FAVORITAS } from './dados';
import type { MensagemDoFio } from './tipos';

/**
 * O que a conversa aberta divide entre os balões, a caixa de escrever e o
 * cabeçalho (27/10/2026).
 *
 * O balão diz "responder a esta"; quem escreve é a caixa, lá embaixo. O
 * cabeçalho abre a lupa; quem acende o trecho é o balão. Três pedaços da tela
 * que não se conhecem falando da mesma coisa — e o jeito React de fazer isso
 * sem passar dez props por quatro andares é um contexto.
 *
 * Fora dele (a tela que mostra um balão solto), `useFio()` devolve `null` e o
 * balão aparece sem menu, como era antes.
 */
export type BuscaNoFio = {
  aberta: boolean;
  termo: string;
  /** As mensagens que batem, na ordem do fio. */
  achados: readonly string[];
  /** A que está em foco agora (a última, ao abrir: a mais recente). */
  atual: string | null;
};

export type Fio = {
  fioId: string;
  /** Pode escrever (admin, gestor, SDR): reagir, responder, apagar, encaminhar. */
  podeEscrever: boolean;
  /** A janela de 24 h DESTA conversa está aberta: dá para reagir agora. */
  janelaAberta: boolean;
  bloqueada: boolean;
  /** O fio carregado, por id: a citação e as favoritas procuram aqui. */
  mensagens: readonly MensagemDoFio[];
  porId: ReadonlyMap<string, MensagemDoFio>;
  nomeDoParceiro: string | null;

  citando: MensagemDoFio | null;
  citar: (mensagem: MensagemDoFio | null) => void;

  favoritas: ReadonlySet<string>;

  /** Rola até a mensagem e a acende por um instante. */
  irPara: (mensagemId: string) => void;
  /** Refaz as leituras da conversa depois de mexer numa mensagem. */
  atualizar: () => void;

  busca: BuscaNoFio;
  abrirBusca: () => void;
  fecharBusca: () => void;
  procurar: (termo: string) => void;
  /** -1: a anterior (mais antiga); +1: a seguinte. */
  andarNaBusca: (passo: -1 | 1) => void;
};

const Contexto = createContext<Fio | null>(null);

export function useFio(): Fio | null {
  return useContext(Contexto);
}

/** O id do elemento do balão: é por ele que `irPara` acha a mensagem. */
export function idDoBalao(mensagemId: string): string {
  return `msg-${mensagemId}`;
}

/** Quanto tempo a mensagem fica acesa depois de alguém ir até ela. */
const ACESA_MS = 1600;

export function ProvedorDoFio({
  fioId,
  mensagens,
  janelaAberta,
  bloqueada,
  nomeDoParceiro,
  atualizar: chaves,
  soltarRolagem,
  mensagemAlvo = null,
  aoChegarNoAlvo,
  children,
}: {
  fioId: string;
  mensagens: readonly MensagemDoFio[];
  janelaAberta: boolean;
  bloqueada: boolean;
  nomeDoParceiro: string | null;
  /** As leituras desta conversa, além da lista. */
  atualizar: readonly (readonly unknown[])[];
  /** Descola a rolagem do fim: quem foi até uma mensagem não é puxado de volta. */
  soltarRolagem: () => void;
  /** Abrir já rolado até esta mensagem (veio da busca da lista). */
  mensagemAlvo?: string | null;
  aoChegarNoAlvo?: () => void;
  children: React.ReactNode;
}) {
  const eu = useEu();
  const clientes = useQueryClient();
  const favoritas = useQuery({
    queryKey: CHAVE_FAVORITAS,
    queryFn: carregarFavoritas,
    staleTime: 5 * 60_000,
  });

  const [citando, setCitando] = useState<MensagemDoFio | null>(null);
  const [busca, setBusca] = useState<{ aberta: boolean; termo: string; indice: number | null }>({
    aberta: false,
    termo: '',
    indice: null,
  });

  const porId = useMemo(() => new Map(mensagens.map((m) => [m.id, m])), [mensagens]);
  const achados = useMemo(
    () => (busca.aberta ? achadosNoFio(mensagens, busca.termo) : []),
    [busca.aberta, busca.termo, mensagens],
  );
  // Sem escolha, a mais recente: é de baixo para cima que se lê uma conversa.
  const indice =
    achados.length === 0 ? null : Math.min(busca.indice ?? achados.length - 1, achados.length - 1);
  const atual = indice === null ? null : (achados[indice] ?? null);

  const relogio = useRef<number | null>(null);
  const irPara = useCallback(
    (mensagemId: string) => {
      const alvo = document.getElementById(idDoBalao(mensagemId));
      if (!alvo) return;
      soltarRolagem();
      alvo.scrollIntoView({ block: 'center', behavior: 'smooth' });
      alvo.setAttribute('data-apontada', '');
      if (relogio.current !== null) window.clearTimeout(relogio.current);
      relogio.current = window.setTimeout(() => {
        alvo.removeAttribute('data-apontada');
        relogio.current = null;
      }, ACESA_MS);
    },
    [soltarRolagem],
  );
  useEffect(
    () => () => {
      if (relogio.current !== null) window.clearTimeout(relogio.current);
    },
    [],
  );

  // A busca da lista abriu esta conversa por uma mensagem: rola até ela depois
  // que o fio chegou e a rolagem do fim fez a parte dela.
  useEffect(() => {
    if (!mensagemAlvo || !porId.has(mensagemAlvo)) return;
    const vez = window.setTimeout(() => {
      irPara(mensagemAlvo);
      aoChegarNoAlvo?.();
    }, 150);
    return () => window.clearTimeout(vez);
  }, [mensagemAlvo, porId, irPara, aoChegarNoAlvo]);

  // A mensagem em foco na busca vai para o meio da tela.
  useEffect(() => {
    if (atual) irPara(atual);
  }, [atual, irPara]);

  const chavesRef = useRef(chaves);
  useEffect(() => {
    chavesRef.current = chaves;
  }, [chaves]);
  const atualizar = useCallback(() => {
    void clientes.invalidateQueries({ queryKey: CHAVE_CONVERSAS });
    for (const chave of chavesRef.current) void clientes.invalidateQueries({ queryKey: chave });
  }, [clientes]);

  const valor = useMemo<Fio>(
    () => ({
      fioId,
      podeEscrever: Boolean(eu?.podeEscrever),
      janelaAberta,
      bloqueada,
      mensagens,
      porId,
      nomeDoParceiro,
      citando,
      citar: setCitando,
      favoritas: favoritas.data ?? SEM_FAVORITAS,
      irPara,
      atualizar,
      busca: { aberta: busca.aberta, termo: busca.termo, achados, atual },
      abrirBusca: () => setBusca((b) => ({ ...b, aberta: true })),
      fecharBusca: () => setBusca({ aberta: false, termo: '', indice: null }),
      procurar: (termo) => setBusca((b) => ({ ...b, termo, indice: null })),
      andarNaBusca: (passo) =>
        setBusca((b) => {
          if (achados.length === 0) return b;
          const daqui = indice ?? achados.length - 1;
          const proximo = (daqui + passo + achados.length) % achados.length;
          return { ...b, indice: proximo };
        }),
    }),
    [
      fioId,
      eu?.podeEscrever,
      janelaAberta,
      bloqueada,
      mensagens,
      porId,
      nomeDoParceiro,
      citando,
      favoritas.data,
      irPara,
      atualizar,
      busca.aberta,
      busca.termo,
      achados,
      atual,
      indice,
    ],
  );

  return <Contexto.Provider value={valor}>{children}</Contexto.Provider>;
}

const SEM_FAVORITAS: ReadonlySet<string> = new Set();
