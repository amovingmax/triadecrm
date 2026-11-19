/**
 * Em que região do estudo o anúncio cai, com as regiões que o banco tem
 * (`mercado_regioes`, lidas no começo da rodada).
 *
 * É a mesma conta de `app.mercado_regiao_do_bairro` (mesma cidade; a
 * palavra-chave mais longa ganha, como palavra inteira dentro de "bairro
 * cidade"; numa região de município, a cidade basta), mais as duas leituras
 * pelo título que o protótipo fazia e o banco não tem como fazer: Cidade
 * Jardim (loteamento dentro de Capim Macio, que os portais cadastram como
 * Capim Macio) e o Satélite (dentro de Pitimbu).
 *
 * Serve para o worker NÃO mandar ao banco anúncio de bairro fora do estudo e
 * para escolher o que ler primeiro. A região gravada continua conferida pelo
 * banco: o `regiao_id` mandado só vale se existir.
 */
import { semAcento } from './texto';

export interface RegiaoDoBanco {
  id: string;
  cidade: string;
  chaves: string[];
  abrangencia: string;
  ativa: boolean;
  lat?: number | null;
  lng?: number | null;
}

export interface RegiaoAchada {
  regiao: string;
  /** A região veio do título, não do bairro da fonte (fica anotado no bruto). */
  porTitulo: boolean;
}

const chave = (s: unknown): string =>
  semAcento(s)
    .replace(/\(.*?\)/g, ' ')
    .replace(/[-,/]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const BAIRROS_DO_CIDADE_JARDIM = [
  'capim macio',
  'candelaria',
  'pitimbu',
  'lagoa nova',
  'nova descoberta',
  'neopolis',
  'cidade jardim',
];
const BAIRROS_DO_SATELITE = ['pitimbu', 'planalto', 'satelite', 'cidade satelite'];

export class Regioes {
  private readonly ativas: RegiaoDoBanco[];

  constructor(linhas: readonly RegiaoDoBanco[]) {
    this.ativas = linhas.filter((r) => r.ativa);
  }

  get lista(): readonly RegiaoDoBanco[] {
    return this.ativas;
  }

  existe(id: string): boolean {
    return this.ativas.some((r) => r.id === id);
  }

  cidadeDa(id: string): string | null {
    return this.ativas.find((r) => r.id === id)?.cidade ?? null;
  }

  /**
   * A cidade de um bairro quando a página não diz a cidade (correção #6 da
   * verificação de 18/11: um anúncio de Ponta Negra, Natal, ficou com a cidade
   * padrão do site, Tibau do Sul). Só responde se UMA cidade tiver região com
   * esse bairro; senão, null (e o anúncio fica sem cidade, fora do estudo).
   */
  cidadePeloBairro(bairro: string | null | undefined): string | null {
    const b = chave(bairro);
    if (!b) return null;
    const cidades = new Set<string>();
    for (const r of this.ativas) {
      if (r.abrangencia === 'municipio') continue;
      if (
        r.chaves.some((k0) => {
          const k = chave(k0);
          return k !== '' && ` ${b} `.includes(` ${k} `);
        })
      )
        cidades.add(r.cidade);
    }
    return cidades.size === 1 ? ([...cidades][0] ?? null) : null;
  }

  /** A região do estudo, ou null (bairro fora do estudo, ou sem cidade). */
  regiaoDe(o: {
    cidade?: string | null;
    bairro?: string | null;
    texto?: string | null;
  }): RegiaoAchada | null {
    const c = chave(o.cidade);
    const b = chave(o.bairro);
    const t = semAcento(o.texto);
    if (!c) return null;
    if (
      c === 'natal' &&
      this.existe('natal-cidade-jardim') &&
      /cidade jardim/.test(t) &&
      BAIRROS_DO_CIDADE_JARDIM.includes(b)
    ) {
      return { regiao: 'natal-cidade-jardim', porTitulo: b !== 'cidade jardim' };
    }
    if (
      c === 'natal' &&
      this.existe('natal-satelite') &&
      /\bsatelite\b/.test(t) &&
      BAIRROS_DO_SATELITE.includes(b)
    ) {
      return { regiao: 'natal-satelite', porTitulo: b !== 'satelite' };
    }
    let melhor: RegiaoDoBanco | null = null;
    let tam = 0;
    const alvo = ` ${b} ${c} `;
    for (const r of this.ativas) {
      if (chave(r.cidade) !== c) continue;
      for (const k0 of r.chaves) {
        const k = chave(k0);
        if (!k) continue;
        const casa =
          (r.abrangencia === 'municipio' && k === c) || (b !== '' && alvo.includes(` ${k} `));
        if (casa && (k.length > tam || (k.length === tam && melhor !== null && r.id < melhor.id))) {
          melhor = r;
          tam = k.length;
        }
      }
    }
    return melhor ? { regiao: melhor.id, porTitulo: false } : null;
  }
}
