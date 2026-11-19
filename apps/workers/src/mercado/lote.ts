/**
 * Peças comuns aos coletores de anúncios: o lote que vai ao banco em pedaços e
 * a impressão digital do bruto da rodada.
 */
import { createHash, type Hash } from 'node:crypto';

import { temLinkBloqueado } from './bloqueio';
import { contarRecusa, ehRecusa, type Recusa } from './anuncio';
import type { Gravador, ItemAnuncio, LinhaIndice, ResumoDaGravacao } from './tipos';

/** Quantos anúncios por chamada a `mercado_anuncios_registrar` (o teste de carga fez 4.000 em ~3 s). */
export const TAMANHO_DO_LOTE = 200;

/**
 * Junta os anúncios da rodada, sem repetir id, e manda ao banco em lotes. Cada
 * consulta (uma busca, um mapa do site) entra de uma vez, com a marca de
 * "lida até o fim" que só se sabe quando ela acaba (regra R2 do banco).
 */
export class LoteDeAnuncios {
  readonly ids = new Set<string>();
  readonly recusas: Record<string, number> = {};
  readonly resumo: ResumoDaGravacao = {
    novos: 0,
    atualizados: 0,
    ignorados: 0,
    recusados: 0,
    erros: [],
  };
  private pendentes: ItemAnuncio[] = [];

  constructor(
    private readonly gravador: Gravador,
    private readonly tamanho = TAMANHO_DO_LOTE,
  ) {}

  /** Conta a recusa de um item que nem vai ao banco. */
  recusar(motivo: string): void {
    contarRecusa(this.recusas, motivo);
  }

  /**
   * Põe uma consulta inteira na fila do banco. Item de link proibido em
   * qualquer campo é recusado aqui mesmo (o banco recusaria também).
   */
  async consulta(itens: ReadonlyArray<ItemAnuncio | Recusa>, completa: boolean): Promise<void> {
    for (const x of itens) {
      if (ehRecusa(x)) {
        this.recusar(x.recusa);
        continue;
      }
      if (this.ids.has(x.id_externo)) continue;
      if (temLinkBloqueado(x)) {
        this.recusar('link de domínio proibido');
        continue;
      }
      this.ids.add(x.id_externo);
      this.pendentes.push({ ...x, consulta_completa: completa && x.consulta_completa !== false });
    }
    if (this.pendentes.length >= this.tamanho) await this.esvaziar(false);
  }

  /** Manda o que falta. `tudo` = inclusive o resto menor que um lote. */
  async esvaziar(tudo = true): Promise<void> {
    while (this.pendentes.length >= this.tamanho || (tudo && this.pendentes.length > 0)) {
      const pedaco = this.pendentes.splice(0, this.tamanho);
      const r = await this.gravador.anuncios(pedaco);
      this.resumo.novos += r.novos;
      this.resumo.atualizados += r.atualizados;
      this.resumo.ignorados += r.ignorados;
      this.resumo.recusados += r.recusados;
      for (const e of r.erros) if (this.resumo.erros.length < 20) this.resumo.erros.push(e);
    }
  }
}

/** sha256 de tudo o que a rodada leu (cada fragmento numa linha), para `mercado_coletas.hash_bruto`. */
export class Impressao {
  private readonly hash: Hash = createHash('sha256');
  private n = 0;

  somar(fragmento: unknown): void {
    this.hash.update(`${typeof fragmento === 'string' ? fragmento : JSON.stringify(fragmento)}\n`);
    this.n += 1;
  }

  get quantos(): number {
    return this.n;
  }

  /** null se nada foi lido (o banco recusa hash de bruto vazio como prova). */
  fechar(): string | null {
    return this.n > 0 ? this.hash.digest('hex') : null;
  }
}

/**
 * Um ponto por série e mês no mesmo lote. O "on conflict (serie, mes)" do
 * Postgres recusa o lote INTEIRO se a mesma chave vier duas vezes ("cannot
 * affect row a second time"), e a rodada iria para a dead-letter. Fica a linha
 * de maior amostra (na Corrida, o mesmo bairro escrito de dois jeitos); sem
 * amostra, ou empate, a última. Quem precisa somar (GeoMapas) soma antes, no
 * coletor.
 */
export function indicesSemRepetir(linhas: readonly LinhaIndice[]): {
  linhas: LinhaIndice[];
  repetidas: number;
} {
  const porChave = new Map<string, LinhaIndice>();
  for (const l of linhas) {
    const chave = `${l.serie}|${l.mes}`;
    const atual = porChave.get(chave);
    if (atual && (atual.amostra ?? -1) > (l.amostra ?? -1)) continue;
    porChave.set(chave, l);
  }
  return { linhas: [...porChave.values()], repetidas: linhas.length - porChave.size };
}
