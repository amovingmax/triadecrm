import { type z } from 'zod';

import { estimarTokens } from './tokens';

/**
 * O contrato de um prompt versionado (ADR-10 do PRD; RF-CON-28).
 *
 * A regra que manda no desenho: **trocar a versão de um prompt não pode quebrar quem
 * chama a anterior.** Por isso uma versão é um objeto imutável e completo — id, versão,
 * modelo alvo, schema de entrada, schema de saída e o texto —, e não um texto solto que
 * alguém edita. `v2` é um arquivo novo ao lado de `v1`; o catálogo guarda as duas; quem
 * pede `obterPrompt('resumo-ligacao', 1)` continua recebendo o v1 com o schema do v1,
 * mesmo depois de o v2 virar vigente.
 *
 * O que vai para `ai_runs` (`model`, `prompt_version`, tokens, custo) sai daqui:
 * `versaoDoPrompt(prompt)` é a string gravada na coluna.
 */

/** Os dois modelos do ADR-10. Nenhum outro entra sem mudar o ADR. */
export const MODELOS = {
  /** Classificação e extração, saídas estruturadas, Batch API. */
  haiku: 'claude-haiku-4-5',
  /** Rascunho, resumo, digest, Assistente e relatório. */
  sonnet: 'claude-sonnet-5',
} as const;

export type ModeloAlvo = (typeof MODELOS)[keyof typeof MODELOS];

/**
 * O valor de `ai_runs.purpose`. A lista é fechada porque é por ela que o custo é
 * agrupado (índice `ai_runs_purpose_day_idx`) e o alerta de 80% é lido.
 */
export type PropositoDeAiRun =
  'transcribe_audio' | 'summarize_call' | 'draft_followup' | 'classify_inbound';

/**
 * Um caso do próprio prompt: entrada e a saída que a versão deve produzir.
 *
 * Não é decoração. Os evals validam cada exemplo contra os dois schemas — um exemplo que
 * não passa no próprio schema é um prompt que promete uma saída e declara outra.
 */
export interface ExemploDePrompt<Entrada, Saida> {
  readonly nome: string;
  readonly entrada: Entrada;
  readonly saida: Saida;
}

/** Metadados sem os genéricos: é o que o inventário e o documento de custos leem. */
export interface MetadadosDePrompt {
  readonly id: string;
  readonly versao: number;
  readonly modelo: ModeloAlvo;
  readonly proposito: PropositoDeAiRun;
  readonly maxTokens: number;
  /**
   * Tokens de entrada estáveis (o bloco `sistema`), que é a parte coberta pelo cache.
   * Calculado por `definirPrompt`, nunca escrito à mão: prompt que engordou é custo que
   * engordou, e o número tem de acompanhar o texto sozinho.
   */
  readonly tokensDeSistema: number;
}

export interface PromptVersionado<Entrada, Saida> extends MetadadosDePrompt {
  /** Schema da entrada. Nada chega ao modelo sem passar por ele. */
  readonly entrada: z.ZodType<Entrada>;
  /** Schema da saída estruturada. O modelo devolve JSON; isto valida. */
  readonly saida: z.ZodType<Saida>;
  /** Bloco estável (cacheável): persona, regras, base de conhecimento. */
  readonly sistema: string;
  /** Bloco volátil: os dados do caso, já pseudonimizados. */
  readonly montarMensagem: (entrada: Entrada) => string;
  /**
   * Campos de texto da entrada que passam pela pseudonimização.
   *
   * É lista explícita, e não "todo campo string", porque campo opaco (id, slug, enum)
   * não deve ser mexido — e porque a varredura de telefone confundiria um uuid com um
   * número. O guardrail que não depende desta lista é `verificarSemPii`, que roda sobre
   * a mensagem final, já montada (ver `nucleo/chamada.ts`).
   */
  readonly camposDeTexto: readonly string[];
  /**
   * Campos da entrada que o **próprio Tríade escreveu** — não vieram de pessoa nenhuma.
   *
   * `leadId`, `canal`, `duracaoSeg`, `confiancaAsr`, `variante`, `segmento`, `desfecho`,
   * flags: coisa que o CRM gerou, guardou e imprime na mensagem. Não é texto de origem
   * não confiável, e é por isso que a lista existe: a auditoria da **junção** (os trechos
   * de fora colados sem fronteira, em `nucleo/chamada.ts`) roda só sobre o que veio de
   * fora. Sem a separação, `leadId` + `duracaoSeg` + capturas somam dez dígitos começando
   * por DDD sozinhos, e um exemplo real dos próprios prompts passa a ser barrado.
   *
   * **A lista é do que é nosso, nunca do que é de fora — e isso é o desenho.** Campo novo
   * que ninguém classificou não aparece aqui, e por não aparecer é tratado como de fora:
   * a classificação falha fechado. Cada campo desta lista continua sendo auditado
   * individualmente; o que ele não faz é entrar na junção.
   */
  readonly camposDoTriade: readonly string[];
  readonly exemplos: readonly ExemploDePrompt<Entrada, Saida>[];
}

/** Congela a versão e mede o bloco estável. Prompt é dado, não estado. */
export function definirPrompt<Entrada, Saida>(
  prompt: Omit<PromptVersionado<Entrada, Saida>, 'tokensDeSistema'>,
): PromptVersionado<Entrada, Saida> {
  return Object.freeze({ ...prompt, tokensDeSistema: estimarTokens(prompt.sistema) });
}

/** A string gravada em `ai_runs.prompt_version`. */
export function versaoDoPrompt(prompt: MetadadosDePrompt): string {
  return `${prompt.id}@v${prompt.versao}`;
}

export function metadadosDoPrompt<Entrada, Saida>(
  prompt: PromptVersionado<Entrada, Saida>,
): MetadadosDePrompt {
  return {
    id: prompt.id,
    versao: prompt.versao,
    modelo: prompt.modelo,
    proposito: prompt.proposito,
    maxTokens: prompt.maxTokens,
    tokensDeSistema: prompt.tokensDeSistema,
  };
}

/**
 * Forma mínima de um catálogo: id → versão → algo que sabe a própria versão.
 *
 * A restrição é frouxa de propósito. `selecionar` precisa preservar o tipo exato da
 * versão pedida (é isso que faz o v1 continuar tipado como v1 depois de o v2 existir),
 * e um genérico amarrado a `PromptVersionado<E, S>` perderia essa precisão.
 */
export type CatalogoDeVersoes = { readonly [versao: number]: { readonly versao: number } };
export type CatalogoDePrompts = { readonly [id: string]: CatalogoDeVersoes };

/**
 * Busca uma versão específica, devolvendo o tipo daquela versão.
 *
 * `selecionar(CATALOGO, 'resumo-ligacao', 1)` continua devolvendo o v1 — com o schema
 * de entrada e o de saída do v1 — no dia em que o v2 for publicado.
 */
export function selecionar<
  Catalogo extends CatalogoDePrompts,
  Id extends keyof Catalogo,
  Versao extends keyof Catalogo[Id],
>(catalogo: Catalogo, id: Id, versao: Versao): Catalogo[Id][Versao] {
  // A travessia é feita sobre uma visão apagada do catálogo e o tipo volta numa asserção
  // só. Indexar o genérico duas vezes faria o TypeScript resolver `Catalogo[Id]` pela
  // assinatura de índice da restrição e perder justamente o que esta função existe para
  // preservar: o tipo da versão pedida. A guarda de runtime é para quem chamar de fora
  // do TypeScript (um script de manutenção) pedindo uma versão que saiu do catálogo.
  const apagado = catalogo as unknown as Record<
    PropertyKey,
    Record<PropertyKey, unknown> | undefined
  >;
  const escolhida = apagado[id as PropertyKey]?.[versao as PropertyKey];
  if (escolhida === undefined) {
    throw new Error(`Prompt ${String(id)}@v${String(versao)} não existe no catálogo.`);
  }
  return escolhida as Catalogo[Id][Versao];
}
