import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * O filtro de perfil de Prospectados (Imova, 23/11/2026): Clientes, Parceiros e
 * as três tags. Arquivo à parte porque a empresa é trocada por um dublê, e
 * `FILTRO_DE_PERFIL` é calculado quando o módulo carrega (por isso o
 * `resetModules` antes de cada importação).
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

describe('o filtro de perfil de Prospectados', () => {
  it('tem Clientes, Parceiros e as três tags, nesta ordem', async () => {
    const { PERFIS_DA_LISTA } = await tipos('imova');
    expect(PERFIS_DA_LISTA.map((p) => p.valor)).toEqual([
      'cliente',
      'parceiro',
      'proprietario',
      'colaborador',
      'inquilino',
    ]);
    expect(PERFIS_DA_LISTA.map((p) => p.rotulo)).toEqual([
      'Clientes',
      'Parceiros',
      'Proprietários',
      'Colaboradores',
      'Inquilinos',
    ]);
  });

  it('na Imova vai e volta pela URL, e conta como filtro', async () => {
    const {
      FILTRO_DE_PERFIL,
      FILTROS_VAZIOS,
      contarFiltros,
      filtrosDaUrl,
      temRecorte,
      urlDosFiltros,
    } = await tipos('imova');
    expect(FILTRO_DE_PERFIL).toBe(true);
    const f = { ...FILTROS_VAZIOS, perfil: 'inquilino' as const };
    expect(urlDosFiltros(f)).toBe('?perfil=inquilino');
    expect(filtrosDaUrl({ perfil: 'inquilino' }).perfil).toBe('inquilino');
    expect(filtrosDaUrl({ perfil: 'cliente' }).perfil).toBe('cliente');
    expect(contarFiltros(f)).toBe(1);
    expect(temRecorte(f)).toBe(true);
  });

  it('valor desconhecido na URL vira "sem filtro" (comprador e outro saíram)', async () => {
    const { filtrosDaUrl } = await tipos('imova');
    expect(filtrosDaUrl({ perfil: 'comprador' }).perfil).toBeNull();
    expect(filtrosDaUrl({ perfil: 'outro' }).perfil).toBeNull();
  });

  it('na KOMUNE não existe: a URL é ignorada', async () => {
    const { FILTRO_DE_PERFIL, filtrosDaUrl } = await tipos('komune');
    expect(FILTRO_DE_PERFIL).toBe(false);
    expect(filtrosDaUrl({ perfil: 'parceiro' }).perfil).toBeNull();
  });
});
