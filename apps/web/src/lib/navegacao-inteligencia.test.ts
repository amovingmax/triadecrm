import { beforeEach, describe, expect, it, vi } from 'vitest';

import { APP_ROLES } from '@/lib/auth/role';

/**
 * O item "Inteligência de mercado" (18/11/2026): só na Imova, só para admin, gestor
 * e SDR. Arquivo à parte do `navegacao.test.ts` porque aqui a empresa é trocada por
 * um dublê (lá os testes rodam como a KOMUNE, sem `NEXT_PUBLIC_EMPRESA`).
 */

const estado = vi.hoisted(() => ({ empresa: 'komune' as 'komune' | 'imova' }));

vi.mock('@/lib/empresa', async () => {
  const { EMPRESAS } = await import('@komune/schema/empresas');
  return {
    get EMPRESA() {
      return EMPRESAS[estado.empresa];
    },
  };
});

const { barraDoCelular, NAVEGACAO, navegacaoDaLateral, navegacaoPara } =
  await import('@/lib/navegacao');

const HREF = '/inteligencia';
const hrefs = (papel: (typeof APP_ROLES)[number]) => navegacaoPara(papel).map((item) => item.href);

beforeEach(() => {
  estado.empresa = 'komune';
});

describe('Inteligência de mercado no menu', () => {
  it('é do grupo Controle, com o módulo da Imova, e nunca mostra número', () => {
    const item = NAVEGACAO.find((i) => i.href === HREF);
    expect(item).toMatchObject({
      rotulo: 'Inteligência de mercado',
      grupo: 'controle',
      modulo: 'inteligenciaMercado',
      papeis: ['admin', 'gestor', 'sdr'],
    });
    expect(item?.fila).toBeUndefined();
    // A descrição é o índice da paleta: as palavras que alguém digitaria.
    expect(item?.descricao).toMatch(/mercado/i);
    expect(item?.descricao).toMatch(/m²/);
    expect(item?.descricao).toMatch(/vantagens/i);
  });

  it('na Imova aparece para admin, gestor e SDR, no "Mais" (não toma lugar dos principais nem da barra)', () => {
    estado.empresa = 'imova';
    for (const papel of ['admin', 'gestor', 'sdr'] as const) {
      expect(hrefs(papel)).toContain(HREF);
      expect(navegacaoDaLateral(papel).mais.map((i) => i.href)).toContain(HREF);
      expect(navegacaoDaLateral(papel).principais.map((i) => i.href)).not.toContain(HREF);
      expect(barraDoCelular(papel).fatias.map((i) => i.href)).not.toContain(HREF);
    }
  });

  it('na Imova não aparece para os papéis que saíram no pivô', () => {
    estado.empresa = 'imova';
    for (const papel of APP_ROLES.filter((p) => !['admin', 'gestor', 'sdr'].includes(p))) {
      expect(hrefs(papel)).not.toContain(HREF);
    }
  });

  it('na KOMUNE não aparece para ninguém', () => {
    for (const papel of APP_ROLES) {
      expect(hrefs(papel)).not.toContain(HREF);
    }
  });
});
