import { afterEach, describe, expect, it, vi } from 'vitest';

import { entradaLocalLigada } from './entrada-local';

/**
 * A entrada sem Google só pode existir no computador: `next dev` E Supabase
 * local. Qualquer uma das duas faltando, a tela é a do Google e a rota dá 404.
 */
describe('entradaLocalLigada', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('liga em next dev com o Supabase local', () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'http://127.0.0.1:54321');
    expect(entradaLocalLigada()).toBe(true);
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'http://localhost:54321');
    expect(entradaLocalLigada()).toBe(true);
  });

  it('nunca no build de produção, mesmo apontando para o banco local', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'http://127.0.0.1:54321');
    expect(entradaLocalLigada()).toBe(false);
  });

  it('nunca com o Supabase da nuvem, mesmo em next dev', () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://toqdjcajyrowutunczhr.supabase.co');
    expect(entradaLocalLigada()).toBe(false);
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'http://127.0.0.1.exemplo.com');
    expect(entradaLocalLigada()).toBe(false);
  });
});
