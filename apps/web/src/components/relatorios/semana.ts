'use client';

import { z } from 'zod';

import type { FunctionReturns } from '@komune/schema';

import { createClient } from '@/lib/supabase/client';

import type { Periodo } from './periodo';

/**
 * O relatório de segunda (RF-REL-09): tipos, leitura e a conversão do `fatos` que
 * o banco guarda.
 *
 * Por que zod aqui: `weekly_reports.fatos` é `jsonb`, e o tipo gerado por
 * `supabase gen types` para jsonb é `Json` — ou seja, "qualquer coisa". Sem uma
 * validação de verdade, a tela leria `fatos.numeros[0].semana` no escuro e quebraria
 * no navegador da Heloísa quando a migração mudasse uma chave. O esquema abaixo é o
 * contrato escrito da versão 1 do JSON; um fato fora do contrato vira erro de tela
 * com frase em português, e não `undefined` desenhado como se fosse número.
 */

/** Um número da semana, com a comparação já resolvida pelo banco. */
export const numeroSemanalSchema = z.object({
  chave: z.string(),
  rotulo: z.string(),
  ajuda: z.string(),
  /** true quando o número sai do funil e não da plataforma Komune. */
  proxy: z.boolean(),
  semana: z.number(),
  anterior: z.number(),
  delta: z.number(),
  /** false quando não há base nos dois lados para afirmar direção. */
  comparavel: z.boolean(),
});

const movimentoSchema = z.object({
  etapa: z.string(),
  funil: z.string(),
  n: z.number(),
});

const fatiaDaBaseSchema = z.object({
  temperatura: z.string(),
  ordem: z.number(),
  organizacoes: z.number(),
});

const atencaoSchema = z.object({
  chave: z.string(),
  titulo: z.string(),
  texto: z.string(),
  numero: z.number(),
  peso: z.number(),
});

export const fatosDaSemanaSchema = z.object({
  versao: z.literal(1),
  semana: z.object({
    inicio: z.string(),
    fim: z.string(),
    rotulo: z.string(),
    parcial: z.boolean(),
    dias_uteis: z.number(),
  }),
  anterior: z.object({ inicio: z.string(), fim: z.string(), rotulo: z.string() }),
  gerado_em: z.string(),
  comparavel_minimo: z.number(),
  semanas_com_registro: z.number(),
  /** true enquanto a operação tem menos de três semanas de registro. */
  cedo: z.boolean(),
  numeros: z.array(numeroSemanalSchema),
  avancos: z.array(movimentoSchema),
  esfriaram: z.array(movimentoSchema),
  base: z.array(fatiaDaBaseSchema),
  /** As até três exibidas, já ordenadas por peso. */
  atencao: z.array(atencaoSchema),
  /**
   * Todas as regras que dispararam, para auditar a semana depois. A tela mostra as
   * três de `atencao`; este campo existe para quem for reler a semana no banco.
   * Tem padrão porque um relatório guardado antes de o campo existir continua
   * válido: as três exibidas são um recorte dele, e nunca outra lista.
   */
  atencao_todas: z.array(atencaoSchema).default([]),
  dependencias: z.array(z.string()),
});

export type NumeroSemanal = z.infer<typeof numeroSemanalSchema>;
export type MovimentoDeEtapa = z.infer<typeof movimentoSchema>;
export type FatiaDaBase = z.infer<typeof fatiaDaBaseSchema>;
export type ItemDeAtencao = z.infer<typeof atencaoSchema>;
export type FatosDaSemana = z.infer<typeof fatosDaSemanaSchema>;

/** O relatório guardado de uma semana, já com os fatos validados. */
export type RelatorioDaSemana = {
  semanaInicio: string;
  semanaFim: string;
  rotulo: string;
  parcial: boolean;
  texto: string;
  fatos: FatosDaSemana;
  geradoEm: string;
  geradoPor: 'cron' | 'manual';
  geradoPorNome: string | null;
};

/** Uma semana civil no seletor, gerada ou não. */
export type SemanaDisponivel = {
  semanaInicio: string;
  semanaFim: string;
  rotulo: string;
  parcial: boolean;
  gerado: boolean;
  geradoEm: string | null;
  geradoPor: string | null;
};

/** Chave de cache do TanStack Query. */
export function chaveDaSemana(semana: string | null) {
  return ['relatorios', 'semana', semana ?? 'ultima'] as const;
}
export const CHAVE_DAS_SEMANAS = ['relatorios', 'semanas'] as const;

/**
 * Lê o relatório guardado de uma semana. `null` quando aquela semana ainda não foi
 * gerada — que é diferente de "a semana foi vazia", e a tela diz a diferença.
 */
export async function carregarRelatorioDaSemana(
  semana: string | null,
): Promise<RelatorioDaSemana | null> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc('relatorio_semanal', {
    p_semana_inicio: semana ?? undefined,
  });
  if (error) throw error;

  const linha = (data ?? [])[0];
  if (!linha) return null;

  return {
    semanaInicio: linha.semana_inicio,
    semanaFim: linha.semana_fim,
    rotulo: linha.rotulo,
    parcial: linha.parcial,
    texto: linha.texto,
    fatos: fatosDaSemanaSchema.parse(linha.fatos),
    geradoEm: linha.gerado_em,
    geradoPor: linha.gerado_por === 'manual' ? 'manual' : 'cron',
    geradoPorNome: linha.gerado_por_nome,
  };
}

/** As últimas semanas civis, geradas ou não. */
export async function carregarSemanas(quantas = 8): Promise<SemanaDisponivel[]> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc('relatorios_semanais', { p_semanas: quantas });
  if (error) throw error;

  const linhas: FunctionReturns<'relatorios_semanais'> = data ?? [];
  return linhas.map((linha) => ({
    semanaInicio: linha.semana_inicio,
    semanaFim: linha.semana_fim,
    rotulo: linha.rotulo,
    parcial: linha.parcial,
    gerado: linha.gerado,
    geradoEm: linha.gerado_em,
    geradoPor: linha.gerado_por,
  }));
}

/** Gera e guarda o relatório de uma semana. Devolve a segunda-feira gravada. */
export async function gerarRelatorioDaSemana(semana: string | null): Promise<string> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc('relatorio_semanal_gerar', {
    p_semana_inicio: semana ?? undefined,
  });
  if (error) throw error;
  return data;
}

/** O período equivalente à semana, para o nome dos arquivos exportados. */
export function periodoDaSemana(relatorio: RelatorioDaSemana): Periodo {
  return { chave: 'personalizado', de: relatorio.semanaInicio, ate: relatorio.semanaFim };
}

/**
 * A frase de comparação com a semana anterior, na tela.
 *
 * É a MESMA regra do texto guardado (`app.frase_variacao_semanal`), e por isso lê
 * `comparavel`, que o banco já decidiu — em vez de recalcular aqui e arriscar a tela
 * dizer "subiu" enquanto o texto do relatório diz "não dá para comparar".
 */
export function variacaoNaTela(numero: NumeroSemanal): string {
  if (numero.semana === 0 && numero.anterior === 0) return 'zero nas duas';
  if (!numero.comparavel) return 'sem base para comparar';
  if (numero.delta > 0) return `+${numero.delta}`;
  if (numero.delta < 0) return String(numero.delta);
  return 'igual';
}
