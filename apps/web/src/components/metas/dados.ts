'use client';

import { createClient } from '@/lib/supabase/client';
import { isAppRole, type AppRole } from '@/lib/auth/role';

import type { Periodo } from './periodo';
import type { LinhaProgresso } from './tipos';

/**
 * Tudo que a tela de Metas fala com o banco.
 *
 * Ler é uma RPC só (`public.goal_progress`), que já devolve meta contra realizado,
 * dias úteis e ritmo — a conta inteira mora no Postgres (ADR-03). Escrever é a
 * tabela `public.goals` direto, com a RLS decidindo quem pode: `goals_insert`,
 * `goals_update` e `goals_delete` exigem `app.is_manager()`.
 */

/** Chave de cache do TanStack Query: uma por pessoa, período e recorte. */
export function chaveDoProgresso(pessoaId: string, periodo: Periodo, inicio: string) {
  return ['metas', 'progresso', pessoaId, periodo, inicio] as const;
}

/** Prefixo para invalidar tudo depois de salvar ou remover uma meta. */
export const CHAVE_METAS = ['metas'] as const;

/**
 * Chave dos papéis do time. FORA de `CHAVE_METAS` de propósito: salvar uma meta
 * invalida `['metas']` inteiro, e papel não muda porque alguém definiu um alvo.
 */
export const CHAVE_PAPEIS = ['time', 'papeis'] as const;

/**
 * O papel de cada pessoa do time, lido do diretório do próprio banco.
 *
 * `public.team_directory` é a view sem PII que todo autenticado enxerga — a mesma
 * que a página usa para montar a lista de nomes. A tela precisa do papel para uma
 * coisa só: dizer, no cartão de quem é `leitura`, `financeiro` ou `bot`, por que o
 * realizado vai ficar em zero (`porQueFicaEmZero`). Ler o papel do banco em vez de
 * receber de fora é o que impede a tela de decidir por conta própria quem trabalha.
 *
 * Falha aqui não derruba nada: quem chama trata o mapa ausente como "não sei o
 * papel" e não mostra aviso nenhum — a tela de metas continua inteira sem isto.
 */
export async function buscarPapeisDoTime(): Promise<Record<string, AppRole>> {
  const supabase = createClient();
  const { data, error } = await supabase.from('team_directory').select('id, role');
  if (error) throw new Error(error.message);

  const papeis: Record<string, AppRole> = {};
  for (const linha of data ?? []) {
    if (linha.id && isAppRole(linha.role)) papeis[linha.id] = linha.role;
  }
  return papeis;
}

export async function buscarProgresso(
  pessoaId: string,
  periodo: Periodo,
  inicio: string,
): Promise<LinhaProgresso[]> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc('goal_progress', {
    p_user_id: pessoaId,
    p_period: periodo,
    p_ref: inicio,
  });

  if (error) throw new Error(error.message);
  return (data ?? []) as LinhaProgresso[];
}

export type MetaParaSalvar = {
  pessoaId: string;
  metrica: string;
  periodo: Periodo;
  /** Primeiro dia do período, já normalizado (o gatilho do banco normaliza de novo). */
  inicio: string;
  alvo: number;
  nota: string | null;
};

/**
 * Grava a meta da pessoa no período.
 *
 * É leitura seguida de `update` ou `insert`, e não um `upsert`: a chave única é um
 * índice PARCIAL (`goals_pessoa_uq ... where user_id is not null`), e o `on_conflict`
 * do PostgREST não sabe apontar para índice com predicado.
 */
export async function salvarMeta(meta: MetaParaSalvar): Promise<void> {
  const supabase = createClient();

  const { data: existente, error: erroBusca } = await supabase
    .from('goals')
    .select('id')
    .eq('user_id', meta.pessoaId)
    .eq('metric', meta.metrica)
    .eq('period', meta.periodo)
    .eq('period_start', meta.inicio)
    .maybeSingle();

  if (erroBusca) throw new Error(erroBusca.message);

  const nota = meta.nota?.trim() ? meta.nota.trim() : null;

  if (existente) {
    const { error } = await supabase
      .from('goals')
      .update({ target: meta.alvo, note: nota })
      .eq('id', (existente as { id: string }).id);
    if (error) throw new Error(error.message);
    return;
  }

  const { error } = await supabase.from('goals').insert({
    user_id: meta.pessoaId,
    metric: meta.metrica,
    period: meta.periodo,
    period_start: meta.inicio,
    target: meta.alvo,
    note: nota,
  });
  if (error) throw new Error(error.message);
}

export async function removerMeta(meta: Omit<MetaParaSalvar, 'alvo' | 'nota'>): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase
    .from('goals')
    .delete()
    .eq('user_id', meta.pessoaId)
    .eq('metric', meta.metrica)
    .eq('period', meta.periodo)
    .eq('period_start', meta.inicio);
  if (error) throw new Error(error.message);
}

/**
 * Erro do Postgres traduzido para o que a pessoa tem de fazer. Nunca sai texto cru
 * do banco na tela: `new row violates row-level security policy` não diz nada a
 * quem está na rua com o celular na mão.
 */
export function mensagemDoErro(erro: unknown): string {
  const texto = erro instanceof Error ? erro.message : '';

  if (/gestor ou admin|row-level security|permission denied|42501/i.test(texto)) {
    return 'O seu acesso não permite essa ação. Só gestor ou admin define meta e vê a meta de outra pessoa.';
  }
  if (/jwt|autenticad|expired/i.test(texto)) return 'A sua sessão expirou. Entre de novo.';
  if (/fetch|network|failed to fetch/i.test(texto)) {
    return 'O aplicativo não alcançou o servidor. Confira a conexão.';
  }
  if (/duplicate key|goals_pessoa_uq/i.test(texto)) {
    return 'Já existe uma meta dessa métrica para este período. Recarregue a tela e edite a que existe.';
  }
  if (/goals_target_check|between 0 and 10000/i.test(texto)) {
    return 'O alvo precisa ser um número inteiro de 0 a 10000.';
  }
  return 'Não deu para falar com o servidor. Tente de novo; se continuar, avise no grupo do time.';
}
