import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Ajustes → Inteligência de mercado (19/11/2026): a aba só existe na Imova. Arquivo
 * à parte porque a empresa é trocada por um dublê, e `ABAS_DA_EMPRESA` é calculada
 * quando o módulo carrega (por isso o `resetModules` antes de cada importação).
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

async function tipos(empresa: 'komune' | 'imova') {
  estado.empresa = empresa;
  vi.resetModules();
  return import('./tipos');
}

beforeEach(() => {
  estado.empresa = 'komune';
});

describe('a aba Inteligência de mercado', () => {
  it('é do módulo da Imova, antes da LGPD', async () => {
    const { ABAS } = await tipos('komune');
    const ids = ABAS.map((a) => a.id);
    expect(ABAS.find((a) => a.id === 'mercado')).toMatchObject({
      rotulo: 'Inteligência de mercado',
      modulo: 'inteligenciaMercado',
    });
    expect(ids.indexOf('mercado')).toBe(ids.indexOf('lgpd') - 1);
  });

  it('na Imova aparece e abre pela URL', async () => {
    const { ABAS_DA_EMPRESA, abaDaUrl } = await tipos('imova');
    expect(ABAS_DA_EMPRESA.map((a) => a.id)).toContain('mercado');
    expect(abaDaUrl('mercado')).toBe('mercado');
  });

  it('na KOMUNE não aparece nem abre pela URL', async () => {
    const { ABAS_DA_EMPRESA, abaDaUrl } = await tipos('komune');
    expect(ABAS_DA_EMPRESA.map((a) => a.id)).not.toContain('mercado');
    expect(abaDaUrl('mercado')).toBe('pessoas');
  });
});
