'use client';

import type { Temperature } from '@komune/schema';

import { createClient } from '@/lib/supabase/client';
import { TEMPERATURAS_EM_ORDEM } from '@/components/temperatura';

import type { Periodo } from './periodo';
import type {
  FatiaTermica,
  LinhaBairro,
  LinhaCategoria,
  LinhaFonte,
  LinhaFunil,
  LinhaHorario,
  LinhaPessoa,
} from './tipos';

/**
 * A camada de dados dos relatórios: uma função por consulta do banco.
 *
 * Nenhuma conta acontece aqui. Todas as agregações são funções `SECURITY DEFINER`
 * do Postgres (RF-REL-01, ADR-03), e o cliente só pede o período e recebe as linhas
 * prontas. As duas exceções estão explicadas onde aparecem: a contagem da base por
 * temperatura (que é um `count` do próprio Postgres, sem trazer linha nenhuma) e a
 * série diária, reconstruída do histórico de etapas enquanto o banco não tiver uma
 * função própria para ela.
 */

/** Máximo de mudanças de etapa que a série diária aceita reconstruir no navegador. */
export const TETO_DO_HISTORICO = 5000;

/** Chave base do cache do TanStack Query. Todo relatório pendura no período. */
export function chaveDoRelatorio(nome: string, periodo: Periodo) {
  return ['relatorios', nome, periodo.de, periodo.ate] as const;
}

type FalhaDoBanco = { code?: string; message?: string };

/**
 * Traduz a falha para uma frase que diz o que fazer. O texto cru do Postgres
 * ("permission denied for function", "JWT expired") não é para a Heloísa ler.
 */
export function mensagemDoErro(erro: unknown): string {
  const falha = (erro ?? {}) as FalhaDoBanco;
  const texto = falha.message ?? (erro instanceof Error ? erro.message : '');

  if (falha.code === '42501' || /não tem acesso|permission denied/i.test(texto)) {
    return 'O seu acesso não inclui os relatórios. Peça a um gestor para liberar.';
  }
  if (/não autenticado|jwt|expired/i.test(texto)) {
    return 'A sua sessão expirou. Entre de novo e volte para esta tela.';
  }
  if (/fetch|network|failed to fetch|load failed/i.test(texto)) {
    return 'O aplicativo não alcançou o servidor. Confira a conexão e tente de novo.';
  }
  if (/timeout|canceling statement/i.test(texto)) {
    return 'A consulta demorou demais. Tente um período mais curto.';
  }
  return 'O relatório não voltou do servidor. Tente de novo em alguns segundos.';
}

async function chamar<L>(nome: string, periodo: Periodo): Promise<L[]> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc(nome, { p_de: periodo.de, p_ate: periodo.ate });
  if (error) throw error;
  return (data ?? []) as L[];
}

export const carregarFunil = (periodo: Periodo) => chamar<LinhaFunil>('relatorio_funil', periodo);

export const carregarCategorias = (periodo: Periodo) =>
  chamar<LinhaCategoria>('relatorio_por_categoria', periodo);

export const carregarBairros = (periodo: Periodo) =>
  chamar<LinhaBairro>('relatorio_por_bairro', periodo);

export const carregarPessoas = (periodo: Periodo) =>
  chamar<LinhaPessoa>('relatorio_por_responsavel', periodo);

export const carregarHorarios = (periodo: Periodo) =>
  chamar<LinhaHorario>('relatorio_por_horario', periodo);

export const carregarFontes = (periodo: Periodo) =>
  chamar<LinhaFonte>('relatorio_por_fonte', periodo);

/**
 * A base de hoje por temperatura, uma contagem por faixa da escala.
 *
 * São cinco pedidos `head` com `count: exact`: quem conta é o Postgres, e nenhuma
 * linha de organização trafega — nem nome, nem telefone. A `organizations_view` já
 * exclui apagados e aplica a visibilidade do papel, então o número é o que a pessoa
 * pode ver, sem contorno de RLS.
 */
export async function carregarBasePorTemperatura(): Promise<FatiaTermica[]> {
  const supabase = createClient();

  return Promise.all(
    TEMPERATURAS_EM_ORDEM.map(async (definicao) => {
      const { count, error } = await supabase
        .from('organizations_view')
        .select('id', { count: 'exact', head: true })
        .eq('temperature', definicao.valor);
      if (error) throw error;
      return { temperatura: definicao.valor, organizacoes: count ?? 0 };
    }),
  );
}

export type MudancaDeEtapa = { deal_id: string; to_stage_id: number; changed_at: string };

export type HistoricoDeEtapas = {
  mudancas: MudancaDeEtapa[];
  /** `true` quando o histórico passou do teto e a série não pode ser confiável. */
  truncado: boolean;
};

/**
 * O histórico de etapas inteiro, para reconstruir a composição da base dia a dia.
 *
 * Por que aqui e não no banco: não existe função de série temporal em
 * `20260904001400_metas_e_relatorios.sql`, e este agente não é dono de migração. A
 * reconstrução é honesta (cada negócio carrega a temperatura da etapa em que estava
 * no fim de cada dia) e o custo é pequeno enquanto a base é de centenas de negócios.
 * Passando de `TETO_DO_HISTORICO` mudanças, a tela para de desenhar a série e diz
 * que a conta precisa descer para o Postgres.
 */
export async function carregarHistoricoDeEtapas(): Promise<HistoricoDeEtapas> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from('deal_stage_history')
    .select('deal_id,to_stage_id,changed_at')
    .order('changed_at', { ascending: true })
    .limit(TETO_DO_HISTORICO + 1);
  if (error) throw error;

  const linhas = (data ?? []) as MudancaDeEtapa[];
  return {
    mudancas: linhas.slice(0, TETO_DO_HISTORICO),
    truncado: linhas.length > TETO_DO_HISTORICO,
  };
}

/** Mapa `etapa -> temperatura`, montado do próprio relatório de funil. */
export function temperaturaPorEtapa(linhas: LinhaFunil[]): Map<number, Temperature> {
  return new Map(linhas.map((linha) => [linha.etapa_id, linha.temperatura]));
}
