import { isValidElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * A porta `/inteligencia` (18/11/2026): na KOMUNE não existe; na Imova confere o papel
 * e o banco da empresa e abre a página pronta. Mesmas condições do teste do porteiro
 * (`lib/supabase/porteiro-da-inteligencia.test.ts`), com a empresa, a sessão e a
 * conferência do banco trocadas por dublês.
 */

const estado = vi.hoisted(() => ({
  empresa: 'imova' as 'komune' | 'imova',
  empresaDoBanco: { ok: true } as { ok: true } | { ok: false; empresaDoBanco: string },
  requireRole: vi.fn(async (..._papeis: string[]) => ({ papel: 'sdr' })),
}));

vi.mock('@/lib/empresa', async () => {
  const { EMPRESAS } = await import('@komune/schema/empresas');
  return {
    get EMPRESA() {
      return EMPRESAS[estado.empresa];
    },
    UM_ADMIN: 'um administrador',
  };
});

vi.mock('@/lib/env', () => ({
  supabaseUrl: () => 'http://127.0.0.1:54321',
  supabaseAnonKey: () => 'chave-anonima-de-teste',
}));

vi.mock('@/lib/auth/session', () => ({
  requireRole: (...papeis: string[]) => estado.requireRole(...papeis),
}));

vi.mock('@/lib/conferir-empresa', () => ({
  conferirEmpresaDoBanco: async () => estado.empresaDoBanco,
}));

const { default: Pagina } = await import('./page');
const { AbrirPaginaPronta } = await import('./abrir-pagina-pronta');
const { BancoDeOutraEmpresa } = await import('@/components/layout/banco-de-outra-empresa');

beforeEach(() => {
  estado.empresa = 'imova';
  estado.empresaDoBanco = { ok: true };
  estado.requireRole.mockClear();
  estado.requireRole.mockImplementation(async () => ({ papel: 'sdr' }));
});

describe('a página /inteligencia', () => {
  it('na KOMUNE responde "não encontrado" antes de olhar a sessão', async () => {
    estado.empresa = 'komune';
    await expect(Pagina()).rejects.toMatchObject({ digest: 'NEXT_HTTP_ERROR_FALLBACK;404' });
    expect(estado.requireRole).not.toHaveBeenCalled();
  });

  it('na Imova exige admin, gestor ou SDR (os mesmos do porteiro e do menu)', async () => {
    const { PAPEIS_DA_INTELIGENCIA } = await import('@/lib/supabase/middleware');
    await Pagina();
    expect(estado.requireRole).toHaveBeenCalledWith(...PAPEIS_DA_INTELIGENCIA);
    expect(PAPEIS_DA_INTELIGENCIA).toEqual(['admin', 'gestor', 'sdr']);
  });

  it('quem não pode entrar sai pelo requireRole (login ou /sem-permissao), sem abrir nada', async () => {
    estado.requireRole.mockImplementation(async () => {
      throw Object.assign(new Error('NEXT_REDIRECT'), {
        digest: 'NEXT_REDIRECT;replace;/sem-permissao;307;',
      });
    });
    await expect(Pagina()).rejects.toThrow('NEXT_REDIRECT');
  });

  it('abre a rota da página pronta', async () => {
    const elemento = await Pagina();
    expect(isValidElement(elemento)).toBe(true);
    expect(elemento.type).toBe(AbrirPaginaPronta);
    expect(elemento.props).toEqual({ endereco: '/inteligencia/painel' });
  });

  it('banco de outra empresa: não abre, como o layout do CRM', async () => {
    estado.empresaDoBanco = { ok: false, empresaDoBanco: 'komune' };
    const elemento = await Pagina();
    expect(elemento.type).toBe(BancoDeOutraEmpresa);
    expect(elemento.props).toEqual({ empresaDoBanco: 'komune' });
  });
});
