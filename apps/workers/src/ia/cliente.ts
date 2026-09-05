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
 * contornar a pseudonimização.
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
 */
import Anthropic from '@anthropic-ai/sdk';

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
 * `effort` por modelo. Ausente = não mandar o campo.
 *
 * Sonnet 5 aceita `low`…`max`; Haiku 4.5 recusa `effort` com 400. A tabela
 * existe para o erro ser impossível, não para ser configurável.
 */
const ESFORCO_POR_MODELO: Readonly<Record<string, 'low' | 'medium' | 'high'>> = {
  'claude-sonnet-5': 'low',
};

/** `$schema` é metadado do zod, não do pedido: sai antes de virar tráfego. */
function esquemaLimpo(esquema: Record<string, unknown>): Record<string, unknown> {
  const { $schema: _ignorado, ...resto } = esquema;
  return resto;
}

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
}

export function clienteAnthropic(opcoes: OpcoesDoCliente): ClienteDoModelo {
  const anthropic = new Anthropic({
    apiKey: opcoes.chave,
    ...(opcoes.baseUrl === undefined ? {} : { baseURL: opcoes.baseUrl }),
    maxRetries: opcoes.tentativas ?? 1,
    timeout: opcoes.tempoLimiteMs ?? 120_000,
  });

  return {
    async conversar(pedido: PedidoAoModelo): Promise<RespostaDoModelo> {
      const esforco = ESFORCO_POR_MODELO[pedido.modelo];
      let resposta;
      try {
        resposta = await anthropic.messages.create({
          model: pedido.modelo,
          max_tokens: pedido.maxTokens,
          system: [
            { type: 'text', text: pedido.sistema, cache_control: { type: 'ephemeral' } },
          ],
          messages: [{ role: 'user', content: pedido.mensagem }],
          output_config: {
            format: { type: 'json_schema', schema: esquemaLimpo(pedido.esquema) },
            ...(esforco === undefined ? {} : { effort: esforco }),
          },
        });
      } catch (erro) {
        throw traduzirErro(erro);
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
