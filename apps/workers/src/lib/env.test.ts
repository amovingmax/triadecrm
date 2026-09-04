import { describe, expect, it } from 'vitest';

import { formatEnvIssues, loadEnv } from './env';

const base = {
  SUPABASE_URL: 'http://127.0.0.1:54321',
  SUPABASE_SERVICE_ROLE_KEY: 'chave-de-teste',
};

describe('loadEnv', () => {
  it('aceita o ambiente base para ingest e aplica padrões', () => {
    const result = loadEnv('ingest', { ...base, LOG_LEVEL: '', TZ: '' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.env.LOG_LEVEL).toBe('info');
    expect(result.env.TZ).toBe('America/Fortaleza');
    expect(result.env.NODE_ENV).toBe('development');
    expect(result.env.SENTRY_DSN).toBeUndefined();
  });

  it('rejeita ambiente sem as variáveis do Supabase', () => {
    const result = loadEnv('ingest', {});
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues.join('\n')).toContain('SUPABASE_URL');
    expect(result.issues.join('\n')).toContain('SUPABASE_SERVICE_ROLE_KEY');
  });

  it('exige credenciais da Meta só para wa', () => {
    expect(loadEnv('ingest', base).ok).toBe(true);
    expect(loadEnv('wa', base).ok).toBe(false);
    expect(
      loadEnv('wa', { ...base, META_WA_ACCESS_TOKEN: 'token', META_WA_PHONE_NUMBER_ID: '123' }).ok,
    ).toBe(true);
  });

  it('exige ANTHROPIC_API_KEY só para ai', () => {
    expect(loadEnv('ai', base).ok).toBe(false);
    expect(loadEnv('ai', { ...base, ANTHROPIC_API_KEY: 'sk-teste' }).ok).toBe(true);
  });

  it('trata string vazia como ausente também em opcionais', () => {
    const result = loadEnv('ingest', { ...base, SENTRY_DSN: '', KOMUNE_HMAC_SECRET: '' });
    expect(result.ok).toBe(true);
  });

  it('formata as pendências em pt-BR', () => {
    const text = formatEnvIssues('wa', [
      'META_WA_ACCESS_TOKEN: META_WA_ACCESS_TOKEN é obrigatória',
    ]);
    expect(text).toContain('worker "wa"');
    expect(text).toContain('.env.example');
  });
});
