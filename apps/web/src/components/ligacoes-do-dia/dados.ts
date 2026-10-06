'use client';

import { createClient } from '@/lib/supabase/client';

import { ligacoesDoDiaSchema, type LigacoesDoDia } from './tipos';

/** `pessoa` nula = todos que ligaram (só a gestão); quem liga recebe o próprio dia. */
export function chaveDasLigacoesDoDia(dia: string, pessoa: string | null) {
  return ['ligacoes-do-dia', dia, pessoa ?? 'todos'] as const;
}

type FalhaDoBanco = { code?: string; message?: string };

/** Nenhum texto do Postgres chega à tela: a recusa vira frase que diz o que fazer. */
export function mensagemDoErro(erro: unknown): string {
  const falha = (erro ?? {}) as FalhaDoBanco;
  const texto = falha.message ?? (erro instanceof Error ? erro.message : '');

  if (falha.code === '42501') return 'O seu acesso não inclui este relatório.';
  if (falha.code === 'PGRST202') {
    return 'Esta versão da tela não conversa com o servidor. Recarregue a página.';
  }
  if (/jwt|expired/i.test(texto))
    return 'A sua sessão expirou. Entre de novo e volte para esta tela.';
  if (/fetch|network|load failed/i.test(texto)) {
    return 'O aplicativo não alcançou o servidor. Confira a conexão e tente de novo.';
  }
  return 'As ligações do dia não voltaram do servidor. Tente de novo em alguns segundos.';
}

export async function carregarLigacoesDoDia(
  dia: string,
  pessoa: string | null,
): Promise<LigacoesDoDia> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc('ligacoes_do_dia', {
    p_dia: dia,
    p_pessoa: pessoa,
  });
  if (error) throw error;
  return ligacoesDoDiaSchema.parse(data);
}
