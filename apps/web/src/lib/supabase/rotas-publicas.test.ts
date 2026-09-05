import { describe, expect, it } from 'vitest';

import { destinoSeguro, ehRotaPublica, ROTA_INICIAL } from './middleware';

/**
 * A lista de rotas que abrem sem sessão é curta de propósito, e ficou mais longa
 * quando a página de reivindicação entrou (`/c/<token>`). Estes testes travam as
 * duas pontas: o que TEM de abrir sem login, e o que não pode passar a abrir por
 * causa de um `startsWith` frouxo.
 */

describe('ehRotaPublica', () => {
  it('abre o login, o fluxo do Supabase Auth e a reivindicação', () => {
    expect(ehRotaPublica('/login')).toBe(true);
    expect(ehRotaPublica('/auth/callback')).toBe(true);
    expect(ehRotaPublica('/auth/signout')).toBe(true);
    expect(ehRotaPublica(`/c/${'a1'.repeat(32)}`)).toBe(true);
  });

  it('não abre nenhuma tela do CRM', () => {
    for (const rota of [
      '/',
      '/meu-dia',
      '/parceiros',
      '/parceiros/8f2c0a5e-0000-4000-8000-000000000001',
      '/admin',
      '/conversas',
    ]) {
      expect(ehRotaPublica(rota)).toBe(false);
    }
  });

  it('não confunde /c/ com uma rota que apenas começa com "c"', () => {
    expect(ehRotaPublica('/conversas')).toBe(false);
    expect(ehRotaPublica('/c')).toBe(false);
    expect(ehRotaPublica('/campanhas/1')).toBe(false);
  });
});

describe('destinoSeguro', () => {
  it('não devolve rota pública como destino pós-login', () => {
    expect(destinoSeguro('/login')).toBe(ROTA_INICIAL);
    expect(destinoSeguro(`/c/${'a1'.repeat(32)}`)).toBe(ROTA_INICIAL);
  });

  it('continua barrando destino externo', () => {
    expect(destinoSeguro('https://exemplo.com')).toBe(ROTA_INICIAL);
    expect(destinoSeguro('//exemplo.com')).toBe(ROTA_INICIAL);
    expect(destinoSeguro(null)).toBe(ROTA_INICIAL);
  });

  it('preserva um caminho interno legítimo', () => {
    expect(destinoSeguro('/parceiros?q=buffet')).toBe('/parceiros?q=buffet');
  });
});
