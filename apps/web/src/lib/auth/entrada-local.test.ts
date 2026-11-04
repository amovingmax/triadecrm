import { afterEach, describe, expect, it, vi } from 'vitest';

import { enderecoDaRedeLocal, entradaLocalLigada, nomeDaRedeLocal } from './entrada-local';

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

  it('liga com o Supabase no endereço do computador na rede (o celular de teste)', () => {
    vi.stubEnv('NODE_ENV', 'development');
    for (const url of [
      'http://10.0.0.188:54321',
      'http://192.168.1.20:54321',
      'http://172.20.0.5:54321',
    ]) {
      vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', url);
      expect(entradaLocalLigada()).toBe(true);
    }
  });

  it('nunca com endereço público ou nome que imita a rede local', () => {
    vi.stubEnv('NODE_ENV', 'development');
    for (const url of [
      'http://8.8.8.8:54321',
      'http://172.32.0.1:54321',
      'http://10.0.0.188.exemplo.com',
      'http://exemplo.com:54321',
    ]) {
      vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', url);
      expect(entradaLocalLigada()).toBe(false);
    }
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'http://10.0.0.188:54321');
    expect(entradaLocalLigada()).toBe(false);
  });
});

describe('nomeDaRedeLocal', () => {
  it('o nome .local do computador liga a entrada, só em next dev', () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'http://MacBook-Air-de-A.local:56321');
    expect(entradaLocalLigada()).toBe(true);
    vi.stubEnv('NODE_ENV', 'production');
    expect(entradaLocalLigada()).toBe(false);
    vi.unstubAllEnvs();
  });

  it('só um nome simples terminado em .local', () => {
    expect(nomeDaRedeLocal('MacBook-Air-de-A.local')).toBe(true);
    expect(nomeDaRedeLocal('golpe.local.exemplo.com')).toBe(false);
    expect(nomeDaRedeLocal('a.b.local')).toBe(false);
    expect(nomeDaRedeLocal('local')).toBe(false);
  });
});

describe('enderecoDaRedeLocal', () => {
  it('só as três faixas privadas', () => {
    expect(enderecoDaRedeLocal('10.0.0.188')).toBe(true);
    expect(enderecoDaRedeLocal('192.168.0.10')).toBe(true);
    expect(enderecoDaRedeLocal('172.16.4.2')).toBe(true);
    expect(enderecoDaRedeLocal('172.31.255.1')).toBe(true);
    expect(enderecoDaRedeLocal('172.15.0.1')).toBe(false);
    expect(enderecoDaRedeLocal('localhost')).toBe(false);
    expect(enderecoDaRedeLocal('127.0.0.1')).toBe(false);
    expect(enderecoDaRedeLocal('')).toBe(false);
  });
});
