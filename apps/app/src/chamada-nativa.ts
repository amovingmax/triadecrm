import { useSyncExternalStore } from 'react';

import { chamadaNativa, type LigacaoDoNativo } from '../modules/triade-chamada';
import type { LinhaNoApp } from './chamada';

/**
 * O lado JS da ligação na tela de chamada do iPhone (23/11/2026). A ligação é nativa
 * (`modules/triade-chamada`); aqui ficam a tela do app durante a ligação, os botões dela
 * e o endereço de chamada que o site grava (`/api/aparelhos`).
 */

export const temTelaDeChamada = chamadaNativa !== null;

let linha: LinhaNoApp | null = null;
let altoFalante = false;
const ouvintes = new Set<() => void>();

function mudar(nova: LinhaNoApp | null) {
  linha = nova;
  for (const o of ouvintes) o();
  conferirLigacao();
}

/**
 * Há ligação tocando ou em curso neste iPhone? Enquanto houver, a página do CRM fica
 * calada (`audio-da-pagina.ts`): o som dela tiraria o áudio da ligação (24/11/2026).
 * Tocando conta pelos eventos do nativo; um toque sem fim conhecido sai em 90 s.
 */
const tocando = new Map<string, number>();
const TOQUE_ESQUECIDO_MS = 90_000;
let emLigacaoAgora = false;
const aoMudarLigacao = new Set<(emLigacao: boolean) => void>();

function conferirLigacao() {
  const agora = Date.now();
  for (const [chamada, desde] of tocando) if (agora - desde > TOQUE_ESQUECIDO_MS) tocando.delete(chamada);
  const em = tocando.size > 0 || (linha !== null && (linha.estado === 'conectando' || linha.estado === 'em_curso'));
  if (em === emLigacaoAgora) return;
  emLigacaoAgora = em;
  for (const f of aoMudarLigacao) f(em);
}

export function emLigacao(): boolean {
  return emLigacaoAgora;
}

export function quandoMudarLigacao(f: (emLigacao: boolean) => void): () => void {
  aoMudarLigacao.add(f);
  return () => aoMudarLigacao.delete(f);
}

function tocou(chamada: string) {
  tocando.set(chamada, Date.now());
  conferirLigacao();
  // O toque esquecido (sem fim nem atender) sai sozinho.
  setTimeout(conferirLigacao, TOQUE_ESQUECIDO_MS + 1000);
}

function parouDeTocar(chamada: string) {
  if (tocando.delete(chamada)) conferirLigacao();
}

/**
 * O que o nativo guardou com o app fechado chega de uma vez quando o JS sobe: o que for
 * velho fica de fora (um fim de uma hora atrás não aparece como se fosse agora), e o
 * estado de agora vem de `ligacaoAtual`.
 */
const EVENTO_VELHO_MS = 10_000;

function receber(l: LigacaoDoNativo) {
  parouDeTocar(l.chamada);
  if (linha?.chamada !== l.chamada && Date.now() - l.em > EVENTO_VELHO_MS) return;
  // Ligação nova: o som volta para o fone.
  if (linha?.chamada !== l.chamada) altoFalante = false;
  mudar({ ...l, altoFalante });
}

/** A ligação na tela do app (`tela-de-chamada.tsx`). */
export function useLinhaDaChamada(): LinhaNoApp | null {
  return useSyncExternalStore(
    (o) => {
      ouvintes.add(o);
      return () => ouvintes.delete(o);
    },
    () => linha,
  );
}

let ligado = false;

/** Liga os ouvintes do nativo, uma vez por abertura do app. */
export function iniciarChamadas(): void {
  if (!chamadaNativa || ligado) return;
  ligado = true;
  void chamadaNativa.iniciar();
  chamadaNativa.addListener('onEstado', receber);
  chamadaNativa.addListener('onTocando', (e) => tocou(e.chamada));
  chamadaNativa.addListener('onFim', (e) => parouDeTocar(e.chamada));
  chamadaNativa.addListener('onRecusar', (e) => parouDeTocar(e.chamada));
  // O app abriu no meio de uma ligação atendida com o iPhone bloqueado.
  void chamadaNativa
    .ligacaoAtual()
    .then((l) => {
      if (l && (!linha || linha.chamada === l.chamada)) receber(l);
    })
    .catch(() => undefined);
}

/** O endereço de chamada deste iPhone, para o site gravar junto com o de push. */
export async function enderecoDeChamada(): Promise<{ voip: string; sandbox: boolean } | null> {
  if (!chamadaNativa) return null;
  // Na primeira abertura a Apple demora um instante para dar o endereço.
  for (let i = 0; i < 10; i++) {
    const voip = await chamadaNativa.tokenDeVoz().catch(() => null);
    if (voip) return { voip, sandbox: chamadaNativa.servidorDeTeste() };
    await new Promise((r) => setTimeout(r, 500));
  }
  return null;
}

/**
 * O microfone pedido com o app aberto: atendendo com o iPhone bloqueado, o iPhone não
 * consegue perguntar. Uma vez basta (o pedido do site para gravar áudio vale também).
 */
export async function pedirMicrofone(): Promise<void> {
  await chamadaNativa?.pedirMicrofone().catch(() => false);
}

// Os botões da tela do app. Mudo e Desligar passam pelo CallKit, para a tela de chamada
// do iPhone e a do app dizerem a mesma coisa.
export function desligar(): void {
  if (!linha) return;
  if (linha.estado === 'conectando' || linha.estado === 'em_curso') {
    void chamadaNativa?.encerrar(linha.chamada);
  } else {
    mudar(null);
  }
}

export function alternarMudo(): void {
  if (linha?.estado === 'em_curso') void chamadaNativa?.silenciar(linha.chamada, !linha.mudo);
}

export function alternarAltoFalante(): void {
  if (!linha) return;
  altoFalante = !altoFalante;
  void chamadaNativa?.altoFalante(altoFalante);
  mudar({ ...linha, altoFalante });
}

export function fecharAviso(): void {
  if (linha && linha.estado !== 'conectando' && linha.estado !== 'em_curso') mudar(null);
}
