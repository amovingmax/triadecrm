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

  it('as variáveis do --conectar são opcionais para o laço do wa', () => {
    const wa = { ...base, META_WA_ACCESS_TOKEN: 'token', META_WA_PHONE_NUMBER_ID: '123' };
    const vazio = loadEnv('wa', {
      ...wa,
      META_WA_BUSINESS_ACCOUNT_ID: '',
      META_APP_ID: '',
      META_WA_PIN: '',
      WA_WEBHOOK_URL: '',
    });
    expect(vazio.ok).toBe(true);
    if (!vazio.ok) return;
    expect(vazio.env.META_WA_BUSINESS_ACCOUNT_ID).toBeUndefined();
    expect(vazio.env.WA_WEBHOOK_URL).toBeUndefined();

    const cheio = loadEnv('wa', {
      ...wa,
      META_WA_BUSINESS_ACCOUNT_ID: '777',
      META_APP_ID: '4242',
      META_WA_PIN: '123456',
      WA_WEBHOOK_URL: 'https://projeto.supabase.co/functions/v1/wa-webhook',
    });
    expect(cheio.ok && cheio.env.META_WA_BUSINESS_ACCOUNT_ID).toBe('777');
    expect(loadEnv('wa', { ...wa, WA_WEBHOOK_URL: 'nao-e-url' }).ok).toBe(false);
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
