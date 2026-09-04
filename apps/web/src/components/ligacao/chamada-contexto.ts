import { type AppRole } from '@/lib/auth/role';
import { type EtapaAlvo, type Feriado, type MotivoPerda } from '@/components/registro/tipos';

import { type DesfechoDeLigacao, type OrdemDaFila, type StatusDoLote } from './tipos';

/**
 * As formas que servidor e cliente trocam entre si nesta tela.
 *
 * Elas moram aqui, e não em `chamada-dados.ts`, por um motivo prático: aquele arquivo
 * importa `@/lib/supabase/server`, que por sua vez usa `next/headers`. Um componente
 * `'use client'` que importasse tipos de lá arrastaria o módulo do servidor para o
 * pacote do navegador. Tipo é contrato, e contrato não tem lado.
 */

/** Um funil que pode virar lote. `ativacao` fica de fora: não é captação. */
export type FunilDeLigacao = { id: number; slug: string; nome: string };

/** Um roteiro publicado, como a montagem o oferece. */
export type RoteiroPublicado = { id: string; slug: string; nome: string; versao: number };

/** Uma categoria do mercado de Natal (R09), para o recorte opcional do lote. */
export type CategoriaDeLote = { id: number; nome: string };

/** Um lote na lista, já com os contadores materializados pelo gatilho do banco. */
export type LoteResumido = {
  id: string;
  nome: string;
  status: StatusDoLote;
  pipelineId: number;
  temperaturaOrigem: string;
  roteiroId: string;
  roteiroVersao: number;
  ordem: OrdemDaFila;
  maxTentativas: number;
  metaLigacoes: number | null;
  iniciaEm: string;
  terminaEm: string;
  total: number;
  pendentes: number;
  falados: number;
  criadoEm: string;
};

export type ContextoDaLigacao = {
  /** Os 8 desfechos da superfície `ligacao`, com a coluna `requires_answer`. */
  catalogo: DesfechoDeLigacao[];
  motivosPerda: MotivoPerda[];
  etapasAlvo: EtapaAlvo[];
  /** Feriados a partir de hoje: a janela de ligação não abre em feriado (R13 §6). */
  feriados: Feriado[];
  /** Formatos de reunião aceitos por funil, lidos de `stages.required_fields`. */
  formatosDeReuniao: Record<number, string[]>;
  funis: FunilDeLigacao[];
  roteiros: RoteiroPublicado[];
  categorias: CategoriaDeLote[];
  lotes: LoteResumido[];
};

/** Colunas de `call_batches` que a tela lê, na forma exata do `select` do PostgREST. */
export const COLUNAS_DO_LOTE =
  'id, nome, status, pipeline_id, temperature_origin, script_id, script_version, order_mode, max_attempts, target_calls, starts_on, ends_on, total, pending, talked, created_at' as const;

/** Uma linha de `call_batches` como o PostgREST a devolve, na forma que a tela usa. */
export type LinhaDeLote = {
  id: string;
  nome: string;
  status: string;
  pipeline_id: number;
  temperature_origin: string;
  script_id: string;
  script_version: number;
  order_mode: string;
  max_attempts: number;
  target_calls: number | null;
  starts_on: string;
  ends_on: string;
  total: number;
  pending: number;
  talked: number;
  created_at: string;
};

/** A tradução da linha para a forma que a tela usa. Uma só, para os dois lados. */
export function loteDaLinha(linha: LinhaDeLote): LoteResumido {
  return {
    id: linha.id,
    nome: linha.nome,
    status: linha.status as StatusDoLote,
    pipelineId: linha.pipeline_id,
    temperaturaOrigem: linha.temperature_origin,
    roteiroId: linha.script_id,
    roteiroVersao: linha.script_version,
    ordem: linha.order_mode as OrdemDaFila,
    maxTentativas: linha.max_attempts,
    metaLigacoes: linha.target_calls,
    iniciaEm: linha.starts_on,
    terminaEm: linha.ends_on,
    total: linha.total,
    pendentes: linha.pending,
    falados: linha.talked,
    criadoEm: linha.created_at,
  };
}

/** Um lote ainda vale para hoje? Fora do período ele não entrega item. */
export function loteValeHoje(lote: LoteResumido, hoje: string): boolean {
  return lote.iniciaEm <= hoje && lote.terminaEm >= hoje;
}

/**
 * Espelho de `app.can_write()`: os papéis que montam lote e tabulam ligação.
 *
 * Quem decide é o Postgres (as políticas de `call_batches`, `call_batch_items` e
 * `call_attempts`, e o `app.can_write()` dentro das RPCs). Isto só evita oferecer à
 * pessoa um botão que o banco vai recusar.
 */
export const PAPEIS_QUE_LIGAM: readonly AppRole[] = ['admin', 'gestor', 'sdr', 'embaixador'];

export function podeLigar(papel: AppRole): boolean {
  return PAPEIS_QUE_LIGAM.includes(papel);
}
