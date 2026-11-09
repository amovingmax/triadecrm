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

/**
 * Os modelos do ADR-10. Nenhum outro entra sem mudar o ADR.
 *
 * O Haiku 5.5 entrou em 03/11/2026, por decisão do usuário, para a leitura do cliente
 * da Imova (`leitura-do-cliente`): a geração atual do Haiku, a da mesma faixa do
 * ADR-10. Os prompts da KOMUNE continuam no Haiku 4.5 e no Sonnet 5.
 */
export const MODELOS = {
  /** Classificação e extração, saídas estruturadas, Batch API. */
  haiku: 'claude-haiku-4-5',
  /** Rascunho, resumo, digest, Assistente e relatório. */
  sonnet: 'claude-sonnet-5',
  /** A leitura do cliente da Imova (03/11/2026). Pensa antes de responder (adaptativo). */
  haiku55: 'claude-haiku-5-5',
  /** A IA que atende o cliente da Imova sozinha (06/11/2026). Sempre pensa (adaptativo). */
  opus55: 'claude-opus-5-5',
  /** Alternativa mais barata para a IA que atende (06/11/2026), escolhida na configuração. */
  sonnet55: 'claude-sonnet-5-5',
} as const;

export type ModeloAlvo = (typeof MODELOS)[keyof typeof MODELOS];

/**
 * O valor de `ai_runs.purpose`. A lista é fechada porque é por ela que o custo é
 * agrupado (índice `ai_runs_purpose_day_idx`) e o alerta de 80% é lido.
 */
export type PropositoDeAiRun =
  | 'transcribe_audio'
  | 'summarize_call'
  | 'draft_followup'
  | 'classify_inbound'
  // CRM Inteligente (17/09/2026): a ficha por conversa e o Pulso do dia.
  | 'analisar_conversa'
  | 'pulso_do_dia'
  // A leitura do processo inteiro de um cliente da Imova (03/11/2026). O valor já
  // existia na lista do banco (`ai_runs_purpose_check`), sem prompt.
  | 'summarize_deal'
  // A IA que atende o cliente da Imova sozinha (06/11/2026). O valor já existia na
  // lista do banco, sem prompt.
  | 'draft_reply'
  // A metade que LÊ da triagem do Radar: a conta soma nota e avaliações, e não
  // sabe que "Fotografia Silva — Formaturas" não atende casamento.
  | 'triar_candidato'
  // A IA juíza da Imova (06/11/2026): a nota diária do atendimento da IA que atende.
  // Entrou na lista do banco pela migração 20261109200000, logo depois de
  // 'triar_candidato', e é por ela que o custo da juíza aparece separado.
  | 'avaliar_atendimento'
  // O "relatório que vende" da Imova (09/11/2026): o conselho por cliente
  // (`conselheiro-do-lead`) e por imóvel (`conselheiro-do-imovel`), um propósito só para
  // o custo do relatório aparecer junto. Precisa entrar em `ai_runs_purpose_check`.
  | 'aconselhar_vendas'
  // O canal de chegada do lead da Imova (06/11/2026): placa, anúncio, rede social
  // ou outros, lido do começo da conversa e de até três fotos.
  | 'identificar_canal';

/**
 * As imagens que um prompt aceita junto com o texto (06/11/2026).
 *
 * Opcional, e a ausência é a regra: prompt que não declara `imagens` não leva imagem
 * nenhuma, e `conferirImagens` (`nucleo/imagens.ts`) recusa com
 * `ImagemNaoDeclaradaError` em vez de deixar passar. Foto não se pseudonimiza — pode
 * ter rosto, documento, placa de carro —, então mandar imagem é decisão de cada
 * versão de prompt, escrita no próprio prompt, e não uma opção de quem chama.
 */
export interface ImagensDoPrompt {
  /** Quantas imagens, no máximo, numa chamada. O que passar disso fica de fora. */
  readonly maximo: number;
  /** Os tipos aceitos, conferidos pelos BYTES da imagem e não pelo que o arquivo diz ser. */
  readonly tipos: readonly ('image/jpeg' | 'image/png' | 'image/gif' | 'image/webp')[];
  /**
   * Tamanho máximo de cada imagem como ela vai na requisição — em base64, que é o que
   * a API mede contra o limite dela (5 MB). Uma foto de 4 MB vira 5,3 MB em base64.
   */
  readonly bytesMax: number;
}

/**
 * As imagens que um prompt aceita junto com o texto (06/11/2026).
 *
 * Opcional, e a ausência é a regra: prompt que não declara `imagens` não leva imagem
 * nenhuma, e `conferirImagens` (`nucleo/imagens.ts`) recusa com
 * `ImagemNaoDeclaradaError` em vez de deixar passar. Foto não se pseudonimiza — pode
 * ter rosto, documento, placa de carro —, então mandar imagem é decisão de cada
 * versão de prompt, escrita no próprio prompt, e não uma opção de quem chama.
 */
export interface ImagensDoPrompt {
  /** Quantas imagens, no máximo, numa chamada. O que passar disso fica de fora. */
  readonly maximo: number;
  /** Os tipos aceitos, conferidos pelos BYTES da imagem e não pelo que o arquivo diz ser. */
  readonly tipos: readonly ('image/jpeg' | 'image/png' | 'image/gif' | 'image/webp')[];
  /**
   * Tamanho máximo de cada imagem como ela vai na requisição — em base64, que é o que
   * a API mede contra o limite dela (5 MB). Uma foto de 4 MB vira 5,3 MB em base64.
   */
  readonly bytesMax: number;
}

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
   *
   * **Caminho aninhado** (GATE 1, 17/09/2026): quando o campo raiz é uma lista de objetos
   * em que só *parte* é nossa, declare o caminho — `'mensagens[].quando'`, `'conversas[].leadId'`.
   * `mensagens` inteiro é texto de fora (o parceiro escreveu), mas o horário, o remetente
   * e o id da mensagem foram o CRM que escreveu, e colados ao texto eles fabricavam
   * telefone onde não havia: `09:40` + `parceiro` + "dia 12/12 para 150" dá dez dígitos
   * começando por 94. Só vale caminho cuja raiz esteja em `camposDeTexto` — se a raiz
   * inteira fosse nossa, bastava declarar a raiz. O eval prova as duas coisas.
   */
  readonly camposDoTriade: readonly string[];
  /**
   * **O que uma chamada deste prompt lê**: uma mensagem, ou a conversa inteira.
   *
   * Muda a varredura de PII aplicada aos trechos de fora (`nucleo/auditoria-pii.ts`), e só
   * isso. `'mensagem'` — o padrão, e o que vale para quem não declarar nada — usa a
   * varredura sem fronteira nenhuma. `'conversa'` usa a varredura com fronteira de letra,
   * porque na escala da conversa a outra barra praticamente tudo: data, horário, preço e
   * quantidade, colados, viram telefone. A decisão, com os números medidos, está no
   * comentário de `verificarSemPiiNaConversa` e em `docs/ia/GATE-1-crm-inteligente.md`.
   *
   * Omitir é a escolha estrita: prompt novo que ninguém classificou é auditado como
   * mensagem. Falha fechado, como `camposDoTriade`.
   */
  readonly escala?: 'mensagem' | 'conversa';
  /**
   * As imagens que esta versão aceita (ver `ImagensDoPrompt`). Ausente em todo prompt
   * anterior ao canal de chegada: a ausência quer dizer "nenhuma", e quem tenta mandar
   * uma assim mesmo recebe `ImagemNaoDeclaradaError`.
   */
  readonly imagens?: ImagensDoPrompt;
  readonly exemplos: readonly ExemploDePrompt<Entrada, Saida>[];
}

/** Congela a versão e mede o bloco estável. Prompt é dado, não estado. */
export function definirPrompt<Entrada, Saida>(
  prompt: Omit<PromptVersionado<Entrada, Saida>, 'tokensDeSistema'>,
): PromptVersionado<Entrada, Saida> {
  // A declaração das imagens é congelada junto: um `maximo` trocado em tempo de
  // execução mudaria o que sai para o modelo sem mudar a versão.
  const imagens =
    prompt.imagens === undefined
      ? {}
      : {
          imagens: Object.freeze({
            ...prompt.imagens,
            tipos: Object.freeze([...prompt.imagens.tipos]),
          }),
        };
  return Object.freeze({ ...prompt, ...imagens, tokensDeSistema: estimarTokens(prompt.sistema) });
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
