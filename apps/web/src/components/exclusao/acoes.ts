/**
 * As exclusões do CRM falando com o banco (07/10/2026).
 *
 * Quatro RPCs da migração `20261007110000_excluir_sem_apagar.sql`, e nenhuma
 * apaga linha: o parceiro sai de circulação (`organizations.deleted_at`) e
 * volta com `parceiro_restaurar`; a tarefa vira `cancelled`.
 *
 * As funções daqui NUNCA estouram por recusa do banco: devolvem `{ ok: false,
 * motivo }`, e a frase que a pessoa lê sai de `recadoDaExclusao`. Nada do
 * Postgres chega à tela — é a regra do `funis/acoes/erros.ts`, valendo aqui.
 */
import { createClient } from '@/lib/supabase/client';

// ---------------------------------------------------------------------------
// O parceiro
// ---------------------------------------------------------------------------

/** O que `public.parceiro_excluir` levou junto, para o aviso dizer com número. */
export type ReciboDaExclusao = {
  nome: string;
  reunioesCanceladas: number;
  tarefasCanceladas: number;
  enviosCancelados: number;
  conversasDesligadas: number;
};

export type ResultadoDeExcluirParceiro =
  | { ok: true; recibo: ReciboDaExclusao }
  | { ok: false; motivo: string };

export type ResultadoDeRestaurar =
  | { ok: true; nome: string }
  | {
      ok: false;
      motivo: string;
      /** Só em `duplicado`: o que bateu e com qual ficha. */
      campo?: string;
      outraFichaId?: string;
      outraFichaNome?: string;
    };

export type ParceiroExcluido = {
  id: string;
  nome: string;
  categoria: string | null;
  cidade: string | null;
  bairro: string | null;
  excluidoEm: string;
  excluidoPor: string | null;
  motivo: string | null;
};

const RECADO: Record<string, string> = {
  sem_permissao: 'Seu perfil não pode fazer isso. Excluir e restaurar é de admin e gestor.',
  nao_encontrado: 'Este parceiro não está mais na base. Recarregue a página.',
  motivo_obrigatorio: 'Escreva o motivo da exclusão.',
  ja_e_cliente:
    'Este parceiro já é cliente da Komune. Quem está publicado ou fechou negócio não se exclui pelo CRM.',
  pre_cadastro_em_andamento:
    'Este parceiro tem um pré-cadastro em andamento na Komune. Espere ele concluir ou expirar antes de excluir.',
  anonimizado: 'Os dados deste parceiro foram eliminados. Não há o que restaurar.',
  duplicado: 'Este parceiro foi cadastrado de novo enquanto estava excluído.',
  nao_encontrada: 'Este compromisso não existe mais. Recarregue a página.',
  ja_concluida: 'Este compromisso já foi concluído: ele é histórico, e não se exclui.',
  estado_invalido: 'Esta reunião já foi fechada.',
  nao_existe: 'Esta reunião não existe mais.',
};

export function recadoDaExclusao(motivo: string): string {
  return RECADO[motivo] ?? 'Não deu para falar com o servidor. Tente de novo.';
}

/** O campo que bateu na restauração, do jeito que se fala. */
export function rotuloDoCampoDuplicado(campo: string | undefined): string {
  if (campo === 'telefone') return 'o mesmo telefone';
  if (campo === 'cnpj') return 'o mesmo CNPJ';
  if (campo === 'instagram') return 'o mesmo Instagram';
  if (campo === 'google_maps') return 'o mesmo lugar no Google Maps';
  return 'os mesmos dados';
}

type Bruto = Record<string, unknown>;

function numero(valor: unknown): number {
  return typeof valor === 'number' && Number.isFinite(valor) ? valor : 0;
}

function texto(valor: unknown): string | null {
  return typeof valor === 'string' && valor.trim() !== '' ? valor : null;
}

export async function excluirParceiro(
  organizationId: string,
  motivo: string,
): Promise<ResultadoDeExcluirParceiro> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc('parceiro_excluir', {
    p_organization_id: organizationId,
    p_motivo: motivo,
  });
  if (error) return { ok: false, motivo: 'erro_do_servidor' };
  const r = (data ?? {}) as Bruto;
  if (r.ok !== true) return { ok: false, motivo: texto(r.motivo) ?? 'erro_do_servidor' };
  return {
    ok: true,
    recibo: {
      nome: texto(r.nome) ?? 'Parceiro',
      reunioesCanceladas: numero(r.reunioes_canceladas),
      tarefasCanceladas: numero(r.tarefas_canceladas),
      enviosCancelados: numero(r.envios_cancelados),
      conversasDesligadas: numero(r.conversas_desligadas),
    },
  };
}

export async function restaurarParceiro(organizationId: string): Promise<ResultadoDeRestaurar> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc('parceiro_restaurar', {
    p_organization_id: organizationId,
  });
  if (error) return { ok: false, motivo: 'erro_do_servidor' };
  const r = (data ?? {}) as Bruto;
  if (r.ok === true) return { ok: true, nome: texto(r.nome) ?? 'Parceiro' };
  return {
    ok: false,
    motivo: texto(r.motivo) ?? 'erro_do_servidor',
    campo: texto(r.campo) ?? undefined,
    outraFichaId: texto(r.organization_id) ?? undefined,
    outraFichaNome: texto(r.nome) ?? undefined,
  };
}

export const CHAVE_DOS_EXCLUIDOS = ['parceiros-excluidos'] as const;

/** Estoura em falha técnica: quem chama é o TanStack Query, que mostra o erro. */
export async function carregarExcluidos(busca: string): Promise<ParceiroExcluido[]> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc('parceiros_excluidos', {
    p_q: busca.trim() || undefined,
  });
  if (error) throw error;
  // O cliente do navegador não carrega os tipos gerados, e os gerados dizem que
  // toda coluna de função-tabela é não nula. Não são: categoria, cidade, bairro,
  // quem excluiu e o motivo podem faltar.
  type Linha = {
    id: string;
    nome: string;
    categoria: string | null;
    cidade: string | null;
    bairro: string | null;
    excluido_em: string;
    excluido_por: string | null;
    motivo: string | null;
  };
  return ((data ?? []) as Linha[]).map((l) => ({
    id: l.id,
    nome: l.nome,
    categoria: l.categoria,
    cidade: l.cidade,
    bairro: l.bairro,
    excluidoEm: l.excluido_em,
    excluidoPor: l.excluido_por,
    motivo: l.motivo,
  }));
}

/**
 * O que a exclusão levou junto, em uma frase — ou `null` quando não havia nada
 * pendente. "2 tarefas e 1 reunião canceladas", e não quatro números soltos.
 */
export function resumoDoRecibo(recibo: ReciboDaExclusao): string | null {
  const partes: string[] = [];
  const plural = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`;
  if (recibo.reunioesCanceladas > 0) {
    partes.push(plural(recibo.reunioesCanceladas, 'reunião cancelada', 'reuniões canceladas'));
  }
  if (recibo.tarefasCanceladas > 0) {
    partes.push(plural(recibo.tarefasCanceladas, 'tarefa cancelada', 'tarefas canceladas'));
  }
  if (recibo.enviosCancelados > 0) {
    partes.push(
      plural(recibo.enviosCancelados, 'mensagem tirada da fila', 'mensagens tiradas da fila'),
    );
  }
  if (partes.length === 0) return null;
  if (partes.length === 1) return `${partes[0]}.`;
  return `${partes.slice(0, -1).join(', ')} e ${partes[partes.length - 1]}.`;
}

// ---------------------------------------------------------------------------
// O compromisso e a próxima ação
// ---------------------------------------------------------------------------

export type ResultadoDeExcluirTarefa =
  | { ok: true; eraReuniao: boolean }
  | { ok: false; motivo: string };

/**
 * Exclui uma tarefa da Agenda ou dos próximos passos (`public.tarefa_excluir`).
 * Quando ela é o eco de uma reunião de pé, o banco cancela a REUNIÃO — e
 * `eraReuniao` volta `true`, para o aviso dizer isso.
 */
export async function excluirTarefa(
  taskId: string,
  motivo?: string,
): Promise<ResultadoDeExcluirTarefa> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc('tarefa_excluir', {
    p_task_id: taskId,
    p_motivo: motivo?.trim() || undefined,
  });
  if (error) return { ok: false, motivo: 'erro_do_servidor' };
  const r = (data ?? {}) as Bruto;
  if (r.ok !== true) return { ok: false, motivo: texto(r.motivo) ?? 'erro_do_servidor' };
  return { ok: true, eraReuniao: r.era_reuniao === true };
}
