/**
 * Ajustes → Inteligência de mercado → Vantagens para a IA: o que a tela lê e grava
 * (etapa 6, 19/11/2026, só na Imova).
 *
 * Leitura direta das tabelas, que a RLS abre para a equipe (`app.is_manager()`):
 * `mercado_argumentos` (as vantagens), `mercado_motor_execucoes` (o "não diga" da
 * última conta de cada imóvel) e o título dos imóveis em `anuncios` e
 * `anuncios_no_canal_pro`; mais `public.mercado_vantagens_para_ia()`, que é EXATAMENTE
 * o que a IA recebe hoje. Gravação só pelas funções da migração 20261119164000, que
 * conferem `app.admin_ou_gestor()` e guardam cada decisão no histórico da vantagem:
 *   - `public.mercado_argumentos_aprovar_imovel(p_imovel, p_ids, p_confirmo_conferido)`;
 *   - `public.mercado_argumento_decidir(p_id, p_decisao, p_motivo, p_confirmo_conferido)`.
 *
 * As gravações NUNCA estouram por recusa do banco: devolvem `{ ok: false, motivo }`,
 * e a frase que a pessoa lê sai de `fraseDaRecusaDaVantagem`.
 */
import type { Database } from '@komune/schema/database.types';

import { createClient } from '@/lib/supabase/client';

import type {
  ExecucaoDoMotor,
  ImovelDaCarteira,
  ResultadoDaAprovacao,
  VantagemDoMercado,
} from './mercado-vantagens-regras';

export const CHAVE_DAS_VANTAGENS = ['admin', 'mercado', 'vantagens'] as const;

type Funcoes = Database['public']['Functions'];
type ArgsDeAprovar = Funcoes['mercado_argumentos_aprovar_imovel']['Args'];
type ArgsDeDecidir = Funcoes['mercado_argumento_decidir']['Args'];

/** Uma linha por imóvel e chave: a tabela cresce com a carteira, não com o tempo. */
const VANTAGENS_LIDAS = 2000;
/** Duas coletas por semana por imóvel: 400 cobrem meses de uma carteira de dezenas. */
const EXECUCOES_LIDAS = 400;

export type DadosDasVantagens = {
  vantagens: VantagemDoMercado[];
  execucoes: ExecucaoDoMotor[];
  carteira: ImovelDaCarteira[];
  /** O JSON de `public.mercado_vantagens_para_ia()`; `null` quando não deu para ler. */
  paraIa: unknown;
};

export async function carregarVantagens(): Promise<DadosDasVantagens> {
  const supabase = createClient();
  const [vantagens, execucoes, paraIa] = await Promise.all([
    supabase
      .from('mercado_argumentos')
      .select(
        'id, imovel_codigo, chave, regra, eixo, forca, texto, fonte_texto, numeros, prova, fontes, data_dado, coletado_em, valido_ate, momentos, objecoes, explica_preco, so_com_preco_dito, aviso, marcas, status, motivo_status, aprovado_por, aprovado_em, aprovado_numeros, aprovado_texto, renovacoes, renovado_em, ultima_versao_em, recusado_por, recusado_em, criado_em, atualizado_em',
      )
      .order('imovel_codigo')
      .limit(VANTAGENS_LIDAS),
    supabase
      .from('mercado_motor_execucoes')
      .select('imovel_codigo, executado_em, nao_use')
      .order('id', { ascending: false })
      .limit(EXECUCOES_LIDAS),
    supabase.rpc('mercado_vantagens_para_ia'),
  ]);

  if (vantagens.error) throw new Error(vantagens.error.message);
  if (execucoes.error) throw new Error(execucoes.error.message);

  const linhas = (vantagens.data ?? []) as unknown as VantagemDoMercado[];
  const execs = (execucoes.data ?? []) as unknown as ExecucaoDoMotor[];
  const codigos = [
    ...new Set([...linhas.map((v) => v.imovel_codigo), ...execs.map((e) => e.imovel_codigo)]),
  ];

  return {
    vantagens: linhas,
    execucoes: execs,
    carteira: await carregarTitulos(codigos),
    paraIa: paraIa.error ? null : (paraIa.data ?? {}),
  };
}

/**
 * O título de cada imóvel: primeiro a aba Anúncios; o que não está lá (o anúncio feito
 * à mão no portal e ainda não trazido) sai do relatório do portal. Sem título, a tela
 * mostra só o código: o título é complemento.
 */
async function carregarTitulos(codigos: string[]): Promise<ImovelDaCarteira[]> {
  if (codigos.length === 0) return [];
  const supabase = createClient();
  const doCrm = await supabase
    .from('anuncios')
    .select('codigo, titulo')
    .in('codigo', codigos)
    .is('excluido_em', null);
  const achados = doCrm.error ? [] : ((doCrm.data ?? []) as ImovelDaCarteira[]);
  const faltam = codigos.filter((c) => !achados.some((a) => a.codigo === c));
  if (faltam.length === 0) return achados;
  const manuais = await supabase
    .from('anuncios_no_canal_pro')
    .select('codigo, titulo')
    .in('codigo', faltam)
    .is('excluido_em', null);
  return [...achados, ...(manuais.error ? [] : ((manuais.data ?? []) as ImovelDaCarteira[]))];
}

export type ResultadoDaDecisao = { ok: true; status: string } | { ok: false; motivo: string };

function papelRecusado(error: { code?: string }): string {
  // 42501: o banco recusou o papel (a aba só abre para admin e gestor, mas o papel
  // pode ter mudado com a tela aberta).
  return error.code === '42501' ? 'sem_permissao' : 'erro';
}

export async function aprovarImovel(
  codigo: string,
  confirmoConferido: boolean,
): Promise<ResultadoDaAprovacao> {
  const args: ArgsDeAprovar = { p_imovel: codigo, p_confirmo_conferido: confirmoConferido };
  const { data, error } = await createClient().rpc('mercado_argumentos_aprovar_imovel', args);
  if (error) return { ok: false, motivo: papelRecusado(error) };
  const r = (data ?? {}) as {
    ok?: unknown;
    motivo?: unknown;
    aprovadas?: unknown;
    nao_aprovadas?: unknown;
  };
  if (r.ok !== true) return { ok: false, motivo: typeof r.motivo === 'string' ? r.motivo : 'erro' };
  const nao = Array.isArray(r.nao_aprovadas) ? r.nao_aprovadas : [];
  return {
    ok: true,
    aprovadas: typeof r.aprovadas === 'number' ? r.aprovadas : 0,
    naoAprovadas: nao
      .filter((x): x is Record<string, unknown> => Boolean(x) && typeof x === 'object')
      .map((x) => ({
        id: String(x.id ?? ''),
        chave: String(x.chave ?? ''),
        motivo: typeof x.motivo === 'string' ? x.motivo : 'erro',
      })),
  };
}

export async function decidirVantagem(
  id: string,
  decisao: 'recusar' | 'voltar',
  motivo: string,
): Promise<ResultadoDaDecisao> {
  const args: ArgsDeDecidir = { p_id: id, p_decisao: decisao, p_motivo: motivo.trim() };
  const { data, error } = await createClient().rpc('mercado_argumento_decidir', args);
  if (error) return { ok: false, motivo: papelRecusado(error) };
  const r = (data ?? {}) as { ok?: unknown; motivo?: unknown; status?: unknown };
  if (r.ok !== true) return { ok: false, motivo: typeof r.motivo === 'string' ? r.motivo : 'erro' };
  return { ok: true, status: typeof r.status === 'string' ? r.status : '' };
}
