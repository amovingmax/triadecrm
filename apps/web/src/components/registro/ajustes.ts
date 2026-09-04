'use client';

import { createClient } from '@/lib/supabase/client';

import { ErroDeRegistro, mensagemDoErro } from './gravar';
import type { ComQuem } from './tipos';

/**
 * As três correções do recibo, quando o registro JÁ subiu.
 *
 * Enquanto o envio está segurado pela janela de arrependimento, corrigir é mexer no
 * pedido que ainda não saiu — não custa nada. Depois que ele sobe, cada correção é
 * um `update` de uma linha só, e todas passam nas políticas que já existem:
 *
 * - `activities_update` aceita `user_id = auth.uid()`: a atividade é dela;
 * - trocar `metadata.com_quem` REPASSA pelo gatilho `app.activities_apply_outcome`
 *   (que é `before insert or update`), então `door_opened` é recalculado pelo banco,
 *   e não remendado aqui — a métrica de porta continua sendo do Postgres (RF-MET-01);
 * - `tasks_update` aceita `created_by = auth.uid()`: a tarefa da próxima ação foi
 *   criada em nome dela.
 *
 * Nenhuma delas bloqueia coisa alguma: o registro já está gravado e completo.
 */

function levantar(codigo: string | null | undefined, causa: unknown): never {
  const { frase, podeTentarDeNovo } = mensagemDoErro(codigo);
  throw new ErroDeRegistro(frase, podeTentarDeNovo, causa);
}

/** A observação livre, escrita depois do recibo. */
export async function anotarNaAtividade(activityId: string, texto: string): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase
    .from('activities')
    .update({ body: texto.trim() || null })
    .eq('id', activityId);
  if (error) levantar(error.code, error);
}

/** A correção do interlocutor: o gatilho recalcula porta aberta e porta batida. */
export async function corrigirComQuem(activityId: string, comQuem: ComQuem): Promise<void> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from('activities')
    .select('metadata')
    .eq('id', activityId)
    .single();
  if (error) levantar(error.code, error);

  const metadata = { ...((data?.metadata ?? {}) as Record<string, unknown>), com_quem: comQuem };
  const { error: erroDeGravacao } = await supabase
    .from('activities')
    .update({ metadata })
    .eq('id', activityId);
  if (erroDeGravacao) levantar(erroDeGravacao.code, erroDeGravacao);
}

/** A data da próxima ação, quando ela quer outra. */
export async function remarcarProximaAcao(taskId: string, quando: string): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase.from('tasks').update({ due_at: quando }).eq('id', taskId);
  if (error) levantar(error.code, error);
}
