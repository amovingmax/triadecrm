/**
 * BANCO DE MENTIRA — só para teste. Não vai para produção e não é importado por
 * nenhum caminho de execução.
 *
 * É o mínimo do construtor de consultas do `supabase-js` que o worker de IA
 * usa: `select` com `eq`/`order`/`limit`, `insert ... select().single()`,
 * `update ... eq`, contagem com `head: true` e `rpc`. Existe por um motivo só —
 * os testes rodam **sem rede** (nem Supabase, nem Anthropic), e é essa regra que
 * faz o `vitest` deste pacote continuar valendo na máquina de qualquer um.
 *
 * Ele imita duas coisas do banco de verdade, e as duas de propósito:
 *
 * 1. **`ai_runs.cost_usd` é calculado na escrita**, como faz o gatilho
 *    `app.ai_runs_before_write`. Sem isso o teste do custo estaria conferindo o
 *    que ele mesmo escreveu. `custoDoBanco` permite mentir de propósito, que é
 *    como se prova que a divergência entre as duas contas vira aviso.
 * 2. **`message_drafts` nasce `pendente`**, sem caminho para outro estado. Não é
 *    a mesma garantia do gatilho de verdade (aquela exige `auth.uid()`), e o
 *    pgTAP é quem a mede; aqui é só para o teste não poder inventar aprovação.
 */
import { custoDaChamada, type ModeloAlvo } from '@komune/prompts';

import type { ClienteDoBanco } from '../ingest/esteira';

export type LinhaFalsa = Record<string, unknown>;
export type TabelasFalsas = Record<string, LinhaFalsa[]>;

interface Filtro {
  readonly coluna: string;
  readonly valor: unknown;
}

export interface OpcoesDoBancoFalso {
  /** Mente no custo devolvido por `ai_runs`, para exercitar o aviso de divergência. */
  readonly custoDoBanco?: (linha: LinhaFalsa) => number;
  /** Respostas de `rpc`, por nome. */
  readonly rpcs?: Record<string, (argumentos: Record<string, unknown>) => unknown>;
  /** Falha a escrita nesta tabela, para exercitar o caminho do erro. */
  readonly falharEm?: string;
}

export interface BancoFalso {
  readonly cliente: ClienteDoBanco;
  readonly tabelas: TabelasFalsas;
  /** Toda chamada de `rpc`, na ordem, para o teste conferir a idempotência. */
  readonly chamadasDeRpc: { nome: string; argumentos: Record<string, unknown> }[];
}

let proximoId = 1;

function novoUuid(): string {
  const n = (proximoId += 1).toString(16).padStart(12, '0');
  return `00000000-0000-4000-8000-${n}`;
}

class Consulta implements PromiseLike<{ data: unknown; error: { message: string } | null; count?: number }> {
  private readonly filtros: Filtro[] = [];
  private ordem: { coluna: string; crescente: boolean } | null = null;
  private teto: number | null = null;
  private contar = false;

  constructor(
    private readonly linhas: LinhaFalsa[],
    private readonly tabela: string,
  ) {}

  eq(coluna: string, valor: unknown): this {
    this.filtros.push({ coluna, valor });
    return this;
  }

  order(coluna: string, opcoes?: { ascending?: boolean }): this {
    this.ordem = { coluna, crescente: opcoes?.ascending !== false };
    return this;
  }

  limit(quantidade: number): this {
    this.teto = quantidade;
    return this;
  }

  comContagem(): this {
    this.contar = true;
    return this;
  }

  private resolver(): LinhaFalsa[] {
    let saida = this.linhas.filter((linha) =>
      this.filtros.every((filtro) => linha[filtro.coluna] === filtro.valor),
    );
    if (this.ordem !== null) {
      const { coluna, crescente } = this.ordem;
      saida = [...saida].sort((a, b) => {
        const va = String(a[coluna] ?? '');
        const vb = String(b[coluna] ?? '');
        return crescente ? va.localeCompare(vb) : vb.localeCompare(va);
      });
    }
    return this.teto === null ? saida : saida.slice(0, this.teto);
  }

  async maybeSingle(): Promise<{ data: LinhaFalsa | null; error: null }> {
    return await Promise.resolve({ data: this.resolver()[0] ?? null, error: null });
  }

  async single(): Promise<{ data: LinhaFalsa | null; error: { message: string } | null }> {
    const achadas = this.resolver();
    return await Promise.resolve(
      achadas.length === 1
        ? { data: achadas[0] ?? null, error: null }
        : { data: null, error: { message: `${this.tabela}: esperava 1 linha, achei ${achadas.length}` } },
    );
  }

  then<R1 = { data: unknown; error: null; count?: number }, R2 = never>(
    aoResolver?: ((valor: { data: unknown; error: null; count?: number }) => R1 | PromiseLike<R1>) | null,
    aoFalhar?: ((motivo: unknown) => R2 | PromiseLike<R2>) | null,
  ): PromiseLike<R1 | R2> {
    const achadas = this.resolver();
    const valor = this.contar
      ? { data: null, error: null, count: achadas.length }
      : { data: achadas, error: null };
    return Promise.resolve(valor).then(aoResolver, aoFalhar);
  }
}

class Escrita implements PromiseLike<{ data: unknown; error: { message: string } | null }> {
  private colunas: string[] = [];

  constructor(
    private readonly aplicar: () => LinhaFalsa[],
    private readonly erro: string | null,
  ) {}

  select(colunas?: string): this {
    this.colunas = (colunas ?? '').split(',').map((c) => c.trim()).filter((c) => c !== '');
    return this;
  }

  async maybeSingle(): Promise<{ data: LinhaFalsa | null; error: { message: string } | null }> {
    return await this.executar();
  }

  /** `insert().select('id').single()` é o mesmo caminho: uma linha acabou de nascer. */
  async single(): Promise<{ data: LinhaFalsa | null; error: { message: string } | null }> {
    return await this.executar();
  }

  private async executar(): Promise<{ data: LinhaFalsa | null; error: { message: string } | null }> {
    if (this.erro !== null) return await Promise.resolve({ data: null, error: { message: this.erro } });
    const escritas = this.aplicar();
    const primeira = escritas[0] ?? null;
    if (primeira === null) return await Promise.resolve({ data: null, error: null });
    const recorte: LinhaFalsa = {};
    for (const coluna of this.colunas) recorte[coluna] = primeira[coluna];
    return await Promise.resolve({ data: this.colunas.length === 0 ? primeira : recorte, error: null });
  }

  then<R1, R2 = never>(
    aoResolver?: ((valor: { data: unknown; error: { message: string } | null }) => R1 | PromiseLike<R1>) | null,
    aoFalhar?: ((motivo: unknown) => R2 | PromiseLike<R2>) | null,
  ): PromiseLike<R1 | R2> {
    return this.executar().then(aoResolver, aoFalhar);
  }
}

export function bancoFalso(
  tabelas: TabelasFalsas,
  opcoes: OpcoesDoBancoFalso = {},
): BancoFalso {
  const chamadasDeRpc: { nome: string; argumentos: Record<string, unknown> }[] = [];
  const banco: TabelasFalsas = { ...tabelas };
  const linhasDe = (tabela: string): LinhaFalsa[] => (banco[tabela] ??= []);

  const cliente = {
    from(tabela: string) {
      return {
        select(colunas?: string, opcoesDoSelect?: { count?: string; head?: boolean }) {
          const consulta = new Consulta(linhasDe(tabela), tabela);
          return opcoesDoSelect?.head === true ? consulta.comContagem() : consulta;
        },
        insert(valores: LinhaFalsa) {
          return new Escrita(
            () => {
              const linha: LinhaFalsa = { id: novoUuid(), created_at: new Date().toISOString(), ...valores };
              if (tabela === 'ai_runs') {
                linha.id = proximoId += 1;
                const modelo = String(linha.model) as ModeloAlvo;
                const custo =
                  linha.status === 'bloqueado'
                    ? 0
                    : custoDaChamada(modelo, {
                        entrada: Number(linha.tokens_in ?? 0),
                        saida: Number(linha.tokens_out ?? 0),
                        escritaDeCache: Number(linha.tokens_cache_write ?? 0),
                        leituraDeCache: Number(linha.tokens_cache_read ?? 0),
                      });
                linha.cost_usd = opcoes.custoDoBanco?.(linha) ?? custo;
              }
              if (tabela === 'message_drafts') linha.status = 'pendente';
              linhasDe(tabela).push(linha);
              return [linha];
            },
            opcoes.falharEm === tabela ? `${tabela}: escrita recusada no teste` : null,
          );
        },
        update(valores: LinhaFalsa) {
          const filtros: Filtro[] = [];
          const alvo = {
            eq(coluna: string, valor: unknown) {
              filtros.push({ coluna, valor });
              return alvo;
            },
            then<R1, R2 = never>(
              aoResolver?: ((v: { data: unknown; error: null }) => R1 | PromiseLike<R1>) | null,
              aoFalhar?: ((motivo: unknown) => R2 | PromiseLike<R2>) | null,
            ): PromiseLike<R1 | R2> {
              for (const linha of linhasDe(tabela)) {
                if (filtros.every((f) => linha[f.coluna] === f.valor)) Object.assign(linha, valores);
              }
              return Promise.resolve({ data: null, error: null }).then(aoResolver, aoFalhar);
            },
          };
          return alvo;
        },
      };
    },
    async rpc(nome: string, argumentos: Record<string, unknown>) {
      chamadasDeRpc.push({ nome, argumentos });
      const resposta = opcoes.rpcs?.[nome];
      return await Promise.resolve({
        data: resposta === undefined ? { enfileirado: true, msg_id: 1 } : resposta(argumentos),
        error: null,
      });
    },
  };

  return { cliente: cliente as unknown as ClienteDoBanco, tabelas: banco, chamadasDeRpc };
}
