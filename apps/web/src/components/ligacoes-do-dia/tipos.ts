import { z } from 'zod';

/**
 * O dia de quem ligou: o que `public.ligacoes_do_dia` devolve (migração
 * `20261006120000`).
 *
 * É a MESMA resposta para as duas telas — o relatório da gestão e o Meu dia de
 * quem liga —, para o número que a pessoa vê no próprio dia ser o que a gestão
 * vê no relatório.
 */

/** Como terminou um punhado de ligações: um desfecho, ou um resultado da linha. */
export const resultadoDoDiaSchema = z.object({
  /** Slug do desfecho (`lig_*`), resultado técnico, `sem_resultado` ou `atendida_sem_desfecho`. */
  chave: z.string(),
  /** Nome do desfecho no catálogo; `null` para o que não é desfecho. */
  nome: z.string().nullable(),
  atendida: z.boolean().nullable(),
  quantas: z.number(),
});

/** Uma tentativa de ligação. Só vem quando se pergunta por UMA pessoa. */
export const ligacaoDoDiaSchema = z.object({
  id: z.string(),
  iniciada_em: z.string(),
  duracao_seg: z.number().nullable(),
  /** `app.call_result`; `null` = começou e não foi tabulada. */
  resultado: z.string().nullable(),
  desfecho: z.string().nullable(),
  desfecho_nome: z.string().nullable(),
  organizacao_id: z.string().nullable(),
  organizacao: z.string().nullable(),
  com_quem: z.string().nullable(),
  observacao: z.string().nullable(),
  /** `manual` enquanto a duração é a que a pessoa declarou; a telefonia troca isto. */
  provedor: z.string(),
});

export const pessoaDoDiaSchema = z.object({
  pessoa_id: z.string(),
  nome: z.string().nullable(),
  papel: z.string().nullable(),
  primeira_em: z.string().nullable(),
  ultima_em: z.string().nullable(),
  ligacoes: z.number(),
  atendidas: z.number(),
  nao_atendidas: z.number(),
  /** Começou e não tabulou. Num relatório exato, ela aparece. */
  sem_resultado: z.number(),
  tempo_falado_seg: z.number(),
  contatos: z.number(),
  reunioes_marcadas: z.number(),
  pediram_para_nao_ligar: z.number(),
  /** O que a pessoa registrou no dia fora da tela de Ligar. */
  outros_registros: z.number(),
  resultados: z.array(resultadoDoDiaSchema),
  /** `null` no resumo de todos; a lista só vem pedindo uma pessoa. */
  lista: z.array(ligacaoDoDiaSchema).nullable(),
});

export const ligacoesDoDiaSchema = z.object({
  dia: z.string(),
  pessoas: z.array(pessoaDoDiaSchema),
});

export type ResultadoDoDia = z.infer<typeof resultadoDoDiaSchema>;
export type LigacaoDoDia = z.infer<typeof ligacaoDoDiaSchema>;
export type PessoaDoDia = z.infer<typeof pessoaDoDiaSchema>;
export type LigacoesDoDia = z.infer<typeof ligacoesDoDiaSchema>;
