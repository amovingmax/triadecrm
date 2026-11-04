import { describe, expect, it } from 'vitest';

import { destinoDepoisDoLogin } from '@/lib/supabase/middleware';

import {
  codigoValido,
  enderecoDeVolta,
  estadoValido,
  estouNoApp,
  lerCookieDoApp,
  VOLTA_DO_APP,
  voltaValida,
} from './entrada-pelo-app';

/**
 * O que estes testes protegem: o código de uso único do login pelo app só pode ir para
 * o próprio app. Uma volta aceita a mais (um site, um projeto qualquer do Expo Go) seria
 * entregar a sessão de alguém a quem montou o link.
 */

const ESTADO = '3f1c9a2e-7b4d-4e8a-9c0f-5d6e7f8a9b0c';

describe('a marca do app', () => {
  it('reconhece o user-agent da casca e nada mais', () => {
    expect(
      estouNoApp(
        'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 TriadeApp/0.1.0',
      ),
    ).toBe(true);
    expect(estouNoApp('Mozilla/5.0 (iPhone) Version/18.6 Mobile/15E148 Safari/604.1')).toBe(false);
    expect(estouNoApp(null)).toBe(false);
  });
});

describe('para onde o código pode ir', () => {
  it('o app instalado', () => {
    expect(voltaValida('triade://auth')).toBe(true);
  });

  it('o Expo Go servido pelo Mac na rede local', () => {
    expect(voltaValida('exp://192.168.0.192:8081/--/auth')).toBe(true);
    expect(voltaValida('exp://172.20.10.2:8081/--/auth')).toBe(true);
    expect(voltaValida('exp://MacBook-Air-de-A.local:8081/--/auth')).toBe(true);
  });

  it('nunca um site, um Expo Go na internet ou outro caminho', () => {
    for (const volta of [
      'https://triade-crm-tawny.vercel.app/auth',
      'https://atacante.com/?',
      'exp://u.expo.dev:80/--/auth',
      'exp://8.8.8.8:8081/--/auth',
      'exp://192.168.0.192:8081/--/outra',
      'triade://auth/../roubar',
      'triade://outra',
      'javascript:alert(1)',
      '',
      null,
    ]) {
      expect(voltaValida(volta)).toBe(false);
    }
  });

  it('leva os campos na query da volta', () => {
    expect(enderecoDeVolta('triade://auth', { token: 'abc', estado: ESTADO })).toBe(
      `triade://auth?token=abc&estado=${ESTADO}`,
    );
  });
});

describe('o estado, o cookie e o código', () => {
  it('o estado é o UUID que o app sorteia', () => {
    expect(estadoValido(ESTADO)).toBe(true);
    expect(estadoValido('curto')).toBe(false);
    expect(estadoValido(`${ESTADO}<script>`)).toBe(false);
  });

  it('o cookie é conferido de novo na leitura', () => {
    expect(lerCookieDoApp(JSON.stringify({ estado: ESTADO, volta: 'triade://auth' }))).toEqual({
      estado: ESTADO,
      volta: 'triade://auth',
    });
    expect(
      lerCookieDoApp(JSON.stringify({ estado: ESTADO, volta: 'https://atacante.com' })),
    ).toBeNull();
    expect(lerCookieDoApp('não é json')).toBeNull();
    expect(lerCookieDoApp(undefined)).toBeNull();
  });

  it('o código de uso único tem o formato do Supabase', () => {
    expect(codigoValido('9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15')).toBe(true);
    expect(codigoValido('abc')).toBe(false);
    expect(codigoValido('9f86d081884c7d65 9a2feaa0c55ad015a3bf4f1b')).toBe(false);
  });
});

describe('o destino depois do login', () => {
  it('aceita a volta do app, a única rota de /auth/ que vale', () => {
    expect(destinoDepoisDoLogin(VOLTA_DO_APP)).toBe(VOLTA_DO_APP);
    expect(destinoDepoisDoLogin('/auth/dev')).toBe('/meu-dia');
    expect(destinoDepoisDoLogin('/auth/app/volta/../dev')).toBe('/meu-dia');
    expect(destinoDepoisDoLogin('/conversas')).toBe('/conversas');
    expect(destinoDepoisDoLogin('https://atacante.com')).toBe('/meu-dia');
  });
});
