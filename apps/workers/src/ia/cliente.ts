/**
 * O cliente do modelo — uma porta só, para o real e para o dublê.
 *
 * Não existe credencial da Anthropic neste repositório, e não é para existir. O
 * que existe é uma interface de duas linhas (`ClienteDoModelo`) e duas
 * implementações que entram pelo MESMO lugar: `clienteAnthropic`, que fala com
 * a API de verdade pelo SDK oficial, e o dublê de `duble.ts`, que devolve
 * fixture. `execucao.ts` não sabe qual dos dois recebeu — e é por isso que o
 * caminho testado é o caminho que roda.
 *
 * A troca é por ambiente, não por código: `ANTHROPIC_BASE_URL` é lido pelo
 * próprio SDK. Apontá-la para `http://127.0.0.1:8787` faz o mesmo binário,
 * com o mesmo cliente, falar com o dublê HTTP (`duble-servidor.ts`).
 *
 * ## O que este arquivo NÃO faz
 *
 * Não monta prompt. Não concatena texto do lead. Não conhece nome de campo de
 * entrada nenhum. Ele recebe `sistema` e `mensagem` já prontos por
 * `prepararChamada` (packages/prompts), que é o único caminho sancionado até a
 * API, e devolve o JSON e a contagem de tokens. Trocar a ordem disso seria
 * contornar a pseudonimização. As imagens (só o canal de chegada da Imova,
 * 06/11/2026) chegam do mesmo jeito: já conferidas por `conferirImagens`.
 *
 * ## Duas decisões de requisição, por modelo (ADR-10)
 *
 * - **`cache_control` no bloco de sistema.** O bloco estável dos quatro prompts
 *   é o mesmo em toda chamada do mesmo fluxo; a leitura de cache custa 0,1× a
 *   entrada, e `ai_runs` tem coluna própria para ela justamente para a economia
 *   aparecer. O bloco volátil (a mensagem) fica depois do ponto de corte.
 * - **`thinking` não é enviado.** Em Haiku 4.5 pensar exige `budget_tokens`, que
 *   não queremos: são saídas estruturadas curtas com validação determinística
 *   atrás. Em Sonnet 5 omitir o campo liga o modo adaptativo, e aí `effort: low`
 *   segura o gasto — que é o ajuste recomendado para rota de alto volume e
 *   tarefa bem especificada. `effort` NÃO existe em Haiku 4.5 (a API recusa), e
 *   é por isso que a tabela abaixo é por modelo em vez de uma constante só.
 * - **Haiku 5.5 (a leitura do cliente da Imova, 03/11/2026)** pensa sempre: omitir
 *   `thinking` liga o modo adaptativo, e o esforço padrão dele é `medium`. Aqui vai
 *   `low`, pelo mesmo motivo do Sonnet: saída estruturada, tarefa bem especificada,
 *   validação determinística atrás. O raciocínio conta em `max_tokens`, e por isso
 *   o prompt dele tem teto maior.
 */
import Anthropic from '@anthropic-ai/sdk';

/**
 * Uma imagem que vai junto do texto (06/11/2026, canal de chegada da Imova; 09/11/2026,
 * a foto do anúncio na IA que atende).
 *
 * Quem chega aqui já passou pela porteira de `packages/prompts` (`conferirImagens`,
 * chamada por `executar`): o prompt a declarou, o tipo é o dos bytes, o tamanho cabe e o
 * rótulo foi auditado. Este arquivo não confere nada disso de novo — ele só monta.
 */
export interface ImagemDoPedido {
  readonly mime: 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp';
  readonly base64: string;
  /** "Foto f1, enviada na mensagem m3": o texto que vai logo antes da imagem. */
  readonly rotulo: string;
}

/** Um pedido pronto para a API: o que `prepararChamada` devolveu, mais o esquema. */
export interface PedidoAoModelo {
  readonly modelo: string;
  /** Bloco estável, cacheável. */
  readonly sistema: string;
  /** Bloco volátil, já pseudonimizado. */
  readonly mensagem: string;
  readonly maxTokens: number;
  /** JSON Schema da saída, de `esquemaDeSaida(prompt)`. */
  readonly esquema: Record<string, unknown>;
  /**
   * As imagens, na ordem. Ausente ou vazia: a requisição sai exatamente como saía antes
   * de existir imagem — o conteúdo do usuário continua sendo a string da mensagem, e o
   * cache dos outros prompts não muda.
   */
  readonly imagens?: readonly ImagemDoPedido[];
}

/** Os quatro contadores de `ai_runs`, no vocabulário de `custoDaChamada`. */
export interface UsoDoModelo {
  readonly entrada: number;
  readonly saida: number;
  readonly escritaDeCache: number;
  readonly leituraDeCache: number;
}

export interface RespostaDoModelo {
  /** O JSON devolvido, ainda não validado: quem valida é `interpretar` do prompt. */
  readonly json: unknown;
  readonly uso: UsoDoModelo;
  /** O modelo que de fato respondeu, como a API o nomeia. */
  readonly modelo: string;
  readonly paradaPor: string | null;
}

export interface ClienteDoModelo {
  conversar(pedido: PedidoAoModelo): Promise<RespostaDoModelo>;
}

/** Erro de conversa com o modelo, com o nome do modelo e o status quando houver. */
export class ErroDoModelo extends Error {
  readonly status: number | null;
  /** Erro de rede, 429 e 5xx voltam depois; 400 e 401 não voltam nunca. */
  readonly transitorio: boolean;

  constructor(mensagem: string, status: number | null, transitorio: boolean) {
    super(mensagem);
    this.name = 'ErroDoModelo';
    this.status = status;
    this.transitorio = transitorio;
  }
}

/** A saída veio, mas não era JSON — ou não era o JSON combinado. */
export class RespostaIlegivelError extends Error {
  constructor(motivo: string) {
    super(`A resposta do modelo não deu para ler: ${motivo}`);
    this.name = 'RespostaIlegivelError';
  }
}

/**
 * O modelo recusou (`stop_reason = 'refusal'`, HTTP 200): um classificador de segurança
 * declinou o pedido. Vale para todos os prompts (06/11/2026).
 *
 * **Determinístico**: repetir o mesmo pedido dá a mesma recusa, e cada volta é paga —
 * a recusa vem com `usage` e é cobrada. Antes disto a recusa caía em "resposta ilegível"
 * (sem bloco de texto, ou texto que não era JSON) e girava na fila até a `ai_dlq`. O
 * Haiku 5.5 não tem fallback do lado do servidor: quem trata é quem chamou.
 *
 * O `uso` vai junto porque a recusa custou; `aiRunId` é preenchido por `executar` quando
 * a linha de `ai_runs` já foi escrita (ver `registrada`).
 */
export class RecusaDoModeloError extends Error {
  readonly categoria: string | null;
  readonly uso: UsoDoModelo;
  readonly modelo: string;
  readonly aiRunId: number | null;

  constructor(categoria: string | null, uso: UsoDoModelo, modelo: string, aiRunId: number | null = null) {
    super(`O modelo recusou o pedido (stop_reason refusal${categoria === null ? '' : `, categoria ${categoria}`})`);
    this.name = 'RecusaDoModeloError';
    this.categoria = categoria;
    this.uso = uso;
    this.modelo = modelo;
    this.aiRunId = aiRunId;
  }

  /** A mesma recusa, agora com a linha de `ai_runs` que a registrou. */
  registrada(aiRunId: number): RecusaDoModeloError {
    return new RecusaDoModeloError(this.categoria, this.uso, this.modelo, aiRunId);
  }
}

/**
 * `effort` por modelo. Ausente = não mandar o campo.
 *
 * Sonnet 5 aceita `low`…`max`; Haiku 4.5 recusa `effort` com 400. A tabela
 * existe para o erro ser impossível, não para ser configurável.
 */
const ESFORCO_POR_MODELO: Readonly<Record<string, 'low' | 'medium' | 'high'>> = {
  'claude-sonnet-5': 'low',
  'claude-haiku-5-5': 'low',
  // A IA que atende o cliente da Imova (06/11/2026): Haiku 5.5 (acima, o mesmo da
  // leitura do cliente), Sonnet 5.5 ou Opus 5.5, à escolha da tela. Pensam sempre (o
  // Opus 5.5 não aceita desligar); `low` é o recomendado para conversa.
  'claude-opus-5-5': 'low',
  'claude-sonnet-5-5': 'low',
};

/**
 * O JSON Schema reduzido ao que a saída estruturada da API aceita.
 *
 * ===========================================================================
 * POR QUE É UMA LISTA DO QUE FICA, E NÃO DO QUE SAI
 * ===========================================================================
 * A saída estruturada aceita um SUBCONJUNTO do JSON Schema, e ela recusa com 400
 * o que está fora — uma palavra-chave por vez, na ordem em que aparecem:
 *
 *   "For 'integer' type, properties maximum, minimum are not supported"
 *   "For 'array' type, property 'maxItems' is not supported"
 *
 * Descobrir esse subconjunto uma recusa por vez custa uma chamada a cada volta e
 * deixa o próximo prompt repetindo o mesmo 400. Então a regra é invertida: fica o
 * que descreve a FORMA (tipo, campos, obrigatórios, itens, enum, união, referência)
 * e sai todo o resto, que é restrição de VALOR.
 *
 * **As restrições continuam valendo** — quem as aplica é o zod, na volta
 * (`interpretar`): score fora de 0–100, lista com mais itens que o teto ou texto
 * mais longo que o máximo derrubam a resposta do mesmo jeito. O que se perde é a
 * dica ao modelo, e essa os prompts já dão por escrito ("o resumo é factual e cabe
 * em 400 caracteres", "no máximo 8 prioridades").
 *
 * `$schema` sai pelo mesmo motivo: é metadado do zod, não do pedido.
 */
const FORMA: ReadonlySet<string> = new Set([
  'type',
  'properties',
  'required',
  'items',
  'prefixItems',
  'enum',
  'const',
  'anyOf',
  'oneOf',
  'allOf',
  'not',
  'additionalProperties',
  'description',
  'title',
  '$ref',
  '$defs',
  'definitions',
]);

function esquemaLimpo(esquema: Record<string, unknown>): Record<string, unknown> {
  return soAForma(esquema) as Record<string, unknown>;
}

function soAForma(no: unknown): unknown {
  if (Array.isArray(no)) return no.map(soAForma);
  if (typeof no !== 'object' || no === null) return no;

  const entrada = no as Record<string, unknown>;
  const saida: Record<string, unknown> = {};
  for (const [chave, valor] of Object.entries(entrada)) {
    if (!FORMA.has(chave)) continue;
    // `properties` e `$defs` são mapas de NOME para esquema: as chaves deles são
    // nomes de campo, não palavras-chave, e não passam por esta peneira.
    saida[chave] =
      chave === 'properties' || chave === '$defs' || chave === 'definitions'
        ? mapaDeEsquemas(valor)
        : soAForma(valor);
  }
  return saida;
}

function mapaDeEsquemas(valor: unknown): unknown {
  if (typeof valor !== 'object' || valor === null || Array.isArray(valor)) return valor;
  const saida: Record<string, unknown> = {};
  for (const [nome, esquema] of Object.entries(valor as Record<string, unknown>)) {
    saida[nome] = soAForma(esquema);
  }
  return saida;
}

/** Exportado só para o teste: é a parte do pedido que a API valida antes de pensar. */
export { esquemaLimpo as esquemaParaAApi };

/**
 * `output_config.format` garante que o primeiro bloco de texto é o JSON pedido.
 * A varredura existe porque um bloco de `thinking` pode vir antes dele.
 */
function primeiroTexto(blocos: readonly { type: string }[]): string | null {
  for (const bloco of blocos) {
    if (bloco.type === 'text' && 'text' in bloco && typeof bloco.text === 'string') {
      return bloco.text;
    }
  }
  return null;
}

export interface OpcoesDoCliente {
  readonly chave: string;
  /** `undefined` deixa o SDK ler `ANTHROPIC_BASE_URL` ou usar a API oficial. */
  readonly baseUrl?: string | undefined;
  /**
   * Tentativas dentro de UMA leitura da fila. O retry longo é da esteira
   * (backoff exponencial em `app.esteira_falhar`), não do cliente: duas
   * políticas de repetição empilhadas viram uma terceira que ninguém previu.
   */
  readonly tentativas?: number;
  readonly tempoLimiteMs?: number;
  /**
   * O `fetch` que o SDK usa. Só os testes passam um: é como se prova, sem rede, o corpo
   * EXATO que sai para a API (`cliente.test.ts`).
   */
  readonly fetch?: NonNullable<ConstructorParameters<typeof Anthropic>[0]>['fetch'];
}

/**
 * O conteúdo do turno do usuário.
 *
 * Sem imagem: a string da mensagem, como sempre foi — é o que mantém a requisição dos
 * outros prompts idêntica byte a byte, e com ela o cache. Com imagem: cada foto
 * anunciada pelo rótulo e logo depois o bloco `image`, e a mensagem montada por último
 * (imagem antes do texto é a ordem que a API recomenda, e o prompt do canal diz isso ao
 * modelo).
 */
function conteudoDoUsuario(pedido: PedidoAoModelo): string | Anthropic.ContentBlockParam[] {
  const imagens = pedido.imagens ?? [];
  if (imagens.length === 0) return pedido.mensagem;
  return [
    ...imagens.flatMap((imagem): Anthropic.ContentBlockParam[] => [
      { type: 'text', text: imagem.rotulo },
      { type: 'image', source: { type: 'base64', media_type: imagem.mime, data: imagem.base64 } },
    ]),
    { type: 'text', text: pedido.mensagem },
  ];
}

/**
 * O corpo do `messages.create`. Separado de `conversar` para o teste poder compará-lo
 * com o de antes das imagens sem passar por rede nenhuma.
 */
export function corpoDaRequisicao(pedido: PedidoAoModelo): Anthropic.MessageCreateParamsNonStreaming {
  const esforco = ESFORCO_POR_MODELO[pedido.modelo];
  return {
    model: pedido.modelo,
    max_tokens: pedido.maxTokens,
    system: [{ type: 'text', text: pedido.sistema, cache_control: { type: 'ephemeral' } }],
    messages: [{ role: 'user', content: conteudoDoUsuario(pedido) }],
    output_config: {
      format: { type: 'json_schema', schema: esquemaLimpo(pedido.esquema) },
      ...(esforco === undefined ? {} : { effort: esforco }),
    },
  };
}

/** A categoria da recusa, quando a API a manda (`stop_details`, só em `refusal`). */
function categoriaDaRecusa(resposta: unknown): string | null {
  const detalhes = (resposta as { stop_details?: { category?: unknown } | null }).stop_details;
  return typeof detalhes?.category === 'string' ? detalhes.category : null;
}

export function clienteAnthropic(opcoes: OpcoesDoCliente): ClienteDoModelo {
  const anthropic = new Anthropic({
    apiKey: opcoes.chave,
    ...(opcoes.baseUrl === undefined ? {} : { baseURL: opcoes.baseUrl }),
    ...(opcoes.fetch === undefined ? {} : { fetch: opcoes.fetch }),
    maxRetries: opcoes.tentativas ?? 1,
    timeout: opcoes.tempoLimiteMs ?? 120_000,
  });

  return {
    async conversar(pedido: PedidoAoModelo): Promise<RespostaDoModelo> {
      let resposta;
      try {
        resposta = await anthropic.messages.create(corpoDaRequisicao(pedido));
      } catch (erro) {
        throw traduzirErro(erro);
      }

      // A recusa é lida ANTES do texto: uma recusa pode vir sem bloco de texto, ou com
      // texto que não é o JSON combinado, e as duas coisas virariam "resposta ilegível",
      // que a fila repete.
      if (resposta.stop_reason === 'refusal') {
        throw new RecusaDoModeloError(
          categoriaDaRecusa(resposta),
          {
            entrada: resposta.usage.input_tokens,
            saida: resposta.usage.output_tokens,
            escritaDeCache: resposta.usage.cache_creation_input_tokens ?? 0,
            leituraDeCache: resposta.usage.cache_read_input_tokens ?? 0,
          },
          resposta.model,
        );
      }

      const texto = primeiroTexto(resposta.content);
      if (texto === null) {
        throw new RespostaIlegivelError(
          `nenhum bloco de texto (parada: ${resposta.stop_reason ?? 'desconhecida'})`,
        );
      }
      let json: unknown;
      try {
        json = JSON.parse(texto);
      } catch {
        throw new RespostaIlegivelError('o bloco de texto não é JSON');
      }

      return {
        json,
        modelo: resposta.model,
        paradaPor: resposta.stop_reason,
        uso: {
          entrada: resposta.usage.input_tokens,
          saida: resposta.usage.output_tokens,
          escritaDeCache: resposta.usage.cache_creation_input_tokens ?? 0,
          leituraDeCache: resposta.usage.cache_read_input_tokens ?? 0,
        },
      };
    },
  };
}

/**
 * Dois grupos, e a diferença importa para a fila: o transitório volta com
 * backoff; o determinístico só gastaria a mesma resposta cinco vezes.
 */
function traduzirErro(erro: unknown): Error {
  if (erro instanceof Anthropic.APIError) {
    const status = typeof erro.status === 'number' ? erro.status : null;
    const transitorio = status === null || status === 408 || status === 409 || status === 429 || status >= 500;
    return new ErroDoModelo(erro.message, status, transitorio);
  }
  if (erro instanceof Error) return new ErroDoModelo(erro.message, null, true);
  return new ErroDoModelo(String(erro), null, true);
}
