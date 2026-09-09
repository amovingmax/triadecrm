'use client';

import { createClient } from '@/lib/supabase/client';

import {
  listaParaCadenciaSchema,
  matriculaSchema,
  portaDoNegocioSchema,
  resumoSchema,
  visaoSchema,
  type ListaParaCadencia,
  type Momento,
  type PortaDoNegocio,
  type ResultadoDaMatricula,
  type ResumoDoDia,
  type VisaoDasCadencias,
} from './tipos';

/**
 * As três conversas desta tela com o Postgres.
 *
 * Duas leituras (`cadencias_visao`, `resumo_do_dia`) e um interruptor
 * (`ligar_cadencia`). Nenhuma escreve mensagem, cria toque ou mexe em matrícula:
 * quem faz isso é a régua do banco, pelo `pg_cron`, e o envio de verdade depende de
 * um número da Meta que ainda não existe.
 */

/** Erro do banco com o código preservado, para a tela traduzir em vez de exibir cru. */
export class ErroDasCadencias extends Error {
  readonly codigo: string | undefined;

  constructor(mensagem: string, codigo?: string) {
    super(mensagem);
    this.name = 'ErroDasCadencias';
    this.codigo = codigo;
  }
}

export async function buscarCadencias(): Promise<VisaoDasCadencias> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc('cadencias_visao');
  if (error) throw new ErroDasCadencias(error.message, error.code);
  return visaoSchema.parse(data);
}

export async function buscarResumo(momento: Momento | null): Promise<ResumoDoDia> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc('resumo_do_dia', { p_momento: momento });
  if (error) throw new ErroDasCadencias(error.message, error.code);
  return resumoSchema.parse(data);
}

/** O que o banco pode responder a um pedido de ligar ou desligar. */
export type RespostaDoInterruptor =
  | { ok: true; mudou: boolean; ativa: boolean; matriculasAtivas: number }
  | { ok: false; motivo: string };

const RECUSAS: Record<string, string> = {
  sem_permissao: 'Ligar e desligar cadência é de gestor ou admin. Peça a quem tem o papel.',
  cadencia_inexistente: 'Esta cadência não existe mais no banco. Atualize a tela.',
  estado_ausente: 'O pedido chegou sem dizer se era para ligar ou desligar. Tente de novo.',
};

/** A recusa do banco em português. Motivo novo aparece como veio, nunca some. */
export function mensagemDaRecusa(motivo: string): string {
  return RECUSAS[motivo] ?? `O banco recusou: ${motivo}.`;
}

export async function ligarCadencia(
  slug: string,
  ativa: boolean,
): Promise<RespostaDoInterruptor> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc('ligar_cadencia', {
    p_slug: slug,
    p_ativa: ativa,
  });
  if (error) throw new ErroDasCadencias(error.message, error.code);

  const bruto = (data ?? {}) as Record<string, unknown>;
  if (bruto.ok === true) {
    return {
      ok: true,
      mudou: bruto.mudou === true,
      ativa: bruto.ativa === true,
      matriculasAtivas: typeof bruto.matriculas_ativas === 'number' ? bruto.matriculas_ativas : 0,
    };
  }
  return { ok: false, motivo: typeof bruto.motivo === 'string' ? bruto.motivo : 'desconhecido' };
}

/**
 * O que dizer quando falha. Nunca o texto do Postgres: "permission denied for
 * function cadencias_visao" não diz a ninguém o que fazer, e "42501" menos ainda.
 */
export function mensagemDoErro(erro: unknown): string {
  const codigo = erro instanceof ErroDasCadencias ? erro.codigo : undefined;
  const texto = erro instanceof Error ? erro.message : '';

  if (codigo === '42501' || /não autenticado|not authenticated|jwt/i.test(texto)) {
    return 'A sua sessão expirou. Entre de novo para ver as cadências.';
  }
  if (codigo === 'PGRST202' || /could not find the function/i.test(texto)) {
    return 'Esta versão do aplicativo está mais nova que a do banco. Avise no grupo do time.';
  }
  if (/fetch|network|failed to fetch/i.test(texto)) {
    return 'O aplicativo não alcançou o servidor. Confira a conexão.';
  }
  // Falha de parse do zod: o banco respondeu, mas com uma forma que a tela não
  // reconhece. Dizer "o servidor não respondeu" aqui esconderia justamente o caso
  // em que a migração e a tela saíram de sincronia.
  if (erro instanceof Error && erro.name === 'ZodError') {
    return 'O banco respondeu num formato que esta tela não reconhece. Avise no grupo do time.';
  }
  return 'O servidor não respondeu como esperado.';
}

// ---------------------------------------------------------------------------
// A porta de entrada
// ---------------------------------------------------------------------------

/**
 * As três chamadas que abrem a régua para alguém.
 *
 * `cadencias_do_negocio` e `negocios_para_cadencia` são leitura pura: perguntam ao
 * mesmo guarda que a gravação consulta (`app.recusa_de_matricula`) o que ele
 * responderia, sem escrever nada. `matricular_em_cadencia` é a única que grava — e é
 * ela que existe no banco desde 04/09 sem ninguém chamar.
 */

/**
 * Chave de cache da porta de um negócio. Vive pouco de propósito: um toque pendente
 * que nasce em outra aba muda a resposta, e uma lista velha ofereceria justamente o
 * que o banco acabou de fechar.
 */
export function chaveDaPortaDoNegocio(dealId: string) {
  return ['cadencias', 'porta', dealId] as const;
}

export function chaveDosNegociosDaCadencia(slug: string, busca: string) {
  return ['cadencias', 'elegiveis', slug, busca.trim()] as const;
}

export async function buscarPortaDoNegocio(dealId: string): Promise<PortaDoNegocio> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc('cadencias_do_negocio', { p_deal_id: dealId });
  if (error) throw new ErroDasCadencias(error.message, error.code);
  return portaDoNegocioSchema.parse(data);
}

export async function buscarNegociosDaCadencia(
  slug: string,
  busca: string,
): Promise<ListaParaCadencia> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc('negocios_para_cadencia', {
    p_cadence_slug: slug,
    p_q: busca.trim() || undefined,
    p_limit: 20,
  });
  if (error) throw new ErroDasCadencias(error.message, error.code);
  return listaParaCadenciaSchema.parse(data);
}

export async function matricular(pedido: {
  organizationId: string;
  slug: string;
  gancho?: string | null;
  dealId?: string | null;
}): Promise<ResultadoDaMatricula> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc('matricular_em_cadencia', {
    p_organization_id: pedido.organizationId,
    p_cadence_slug: pedido.slug,
    p_gancho: pedido.gancho?.trim() || undefined,
    p_deal_id: pedido.dealId ?? undefined,
  });
  if (error) throw new ErroDasCadencias(error.message, error.code);
  return matriculaSchema.parse(data);
}
