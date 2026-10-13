/**
 * O que a gestão faz com um lote depois de montado (13/10/2026): ver quem está
 * nele, tirar um contato da fila e excluir o lote.
 *
 * Três RPCs da migração `20261013140000_tirar_do_lote_e_excluir_o_lote.sql`.
 * Nenhuma apaga linha: o contato tirado vira `devolvido` e volta para a base; o
 * lote excluído ganha `deleted_at`, e as ligações feitas nele continuam no
 * relatório do dia.
 *
 * Como em `exclusao/acoes.ts`, a recusa do banco nunca estoura: volta
 * `{ ok: false, motivo }`, e a frase sai de `recadoDoLote`.
 */
import { createClient } from '@/lib/supabase/client';

export type StatusDoContatoNoLote = 'fila' | 'em_andamento' | 'concluido' | 'devolvido';

export type ContatoDoLote = {
  itemId: string;
  organizacaoId: string;
  nome: string;
  status: StatusDoContatoNoLote;
  tentativas: number;
  /** Nome do desfecho, ou o resultado da linha quando ninguém atendeu. */
  ultimoResultado: string | null;
};

export const ROTULO_DO_CONTATO_NO_LOTE: Record<StatusDoContatoNoLote, string> = {
  fila: 'Na fila',
  em_andamento: 'Em ligação',
  concluido: 'Ligado',
  devolvido: 'Fora do lote',
};

const RESULTADO_DA_LINHA: Record<string, string> = {
  atendida_humano: 'Atendeu',
  nao_atendeu: 'Não atendeu',
  caixa_postal: 'Caixa postal',
  ocupado: 'Ocupado',
  numero_invalido: 'Número errado',
  chamada_muda: 'Chamada muda',
  queda_de_linha: 'A linha caiu',
};

const RECADO: Record<string, string> = {
  sem_permissao: 'Seu perfil não pode fazer isso. Mexer no lote é de admin e gestor.',
  item_inexistente: 'Este contato não está mais no lote. Recarregue a página.',
  lote_inexistente: 'Este lote não existe mais. Recarregue a página.',
  lote_encerrado: 'Este lote já foi encerrado: a fila dele já voltou para a base.',
  em_ligacao: 'Alguém está em ligação agora. Espere a ligação terminar e tente de novo.',
  fora_da_fila: 'Este contato já não está na fila do lote.',
  motivo_obrigatorio: 'Escreva o motivo da exclusão.',
};

export function recadoDoLote(motivo: string): string {
  return RECADO[motivo] ?? 'Não deu para falar com o servidor. Tente de novo.';
}

type Bruto = Record<string, unknown>;

function texto(valor: unknown): string | null {
  return typeof valor === 'string' && valor.trim() !== '' ? valor : null;
}

function numero(valor: unknown): number {
  return typeof valor === 'number' && Number.isFinite(valor) ? valor : 0;
}

export const chaveDosContatosDoLote = (loteId: string) =>
  ['ligacao', 'contatos-do-lote', loteId] as const;

/** Estoura em falha: quem chama é o TanStack Query, que mostra o erro. */
export async function carregarContatosDoLote(loteId: string): Promise<ContatoDoLote[]> {
  const { data, error } = await createClient().rpc('lote_contatos', { p_batch_id: loteId });
  if (error) throw error;
  const r = (data ?? {}) as Bruto;
  if (r.ok !== true) throw new Error(recadoDoLote(texto(r.motivo) ?? ''));
  return ((r.contatos ?? []) as Bruto[]).map((c) => ({
    itemId: String(c.item_id),
    organizacaoId: String(c.organizacao_id),
    nome: texto(c.nome) ?? 'Parceiro',
    status: (texto(c.status) ?? 'fila') as StatusDoContatoNoLote,
    tentativas: numero(c.tentativas),
    ultimoResultado:
      texto(c.ultimo_desfecho) ??
      (texto(c.ultimo_resultado) ? (RESULTADO_DA_LINHA[String(c.ultimo_resultado)] ?? null) : null),
  }));
}

export type ResultadoDeTirar = { ok: true; nome: string } | { ok: false; motivo: string };

export async function tirarContatoDoLote(itemId: string): Promise<ResultadoDeTirar> {
  const { data, error } = await createClient().rpc('lote_tirar_contato', { p_item_id: itemId });
  if (error) return { ok: false, motivo: 'erro_do_servidor' };
  const r = (data ?? {}) as Bruto;
  if (r.ok !== true) return { ok: false, motivo: texto(r.motivo) ?? 'erro_do_servidor' };
  return { ok: true, nome: texto(r.nome) ?? 'Parceiro' };
}

export type ResultadoDeExcluirLote =
  | { ok: true; nome: string; devolvidos: number; ligacoesFeitas: number }
  | { ok: false; motivo: string };

export async function excluirLote(loteId: string, motivo: string): Promise<ResultadoDeExcluirLote> {
  const { data, error } = await createClient().rpc('lote_excluir', {
    p_batch_id: loteId,
    p_motivo: motivo,
  });
  if (error) return { ok: false, motivo: 'erro_do_servidor' };
  const r = (data ?? {}) as Bruto;
  if (r.ok !== true) return { ok: false, motivo: texto(r.motivo) ?? 'erro_do_servidor' };
  return {
    ok: true,
    nome: texto(r.nome) ?? 'Lote',
    devolvidos: numero(r.devolvidos),
    ligacoesFeitas: numero(r.ligacoes_feitas),
  };
}

/** "Lote excluído. 7 contatos voltaram para a base." — o aviso depois de excluir. */
export function avisoDaExclusaoDoLote(devolvidos: number): string {
  if (devolvidos === 0) return 'Lote excluído.';
  return devolvidos === 1
    ? 'Lote excluído. 1 contato voltou para a base.'
    : `Lote excluído. ${devolvidos} contatos voltaram para a base.`;
}
