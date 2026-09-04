import { describe, expect, it } from 'vitest';

import {
  APP_ROLES,
  PAPEL_PADRAO,
  decodeJwtPayload,
  isAppRole,
  roleFromAccessToken,
  roleFromClaims,
} from './role';

/** Monta um JWT "de mentira" (assinatura inválida): só o payload importa para o decodificador. */
function jwtFalso(payload: Record<string, unknown>): string {
  const b64url = (obj: unknown) =>
    Buffer.from(JSON.stringify(obj), 'utf8')
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
  return `${b64url({ alg: 'HS256', typ: 'JWT' })}.${b64url(payload)}.assinatura`;
}

describe('roleFromAccessToken', () => {
  it('lê app_metadata.app_role do access_token', () => {
    const token = jwtFalso({ sub: 'u1', app_metadata: { app_role: 'admin' } });
    expect(roleFromAccessToken(token)).toBe('admin');
  });

  it.each(APP_ROLES)('aceita o papel %s do enum app.user_role', (papel) => {
    expect(roleFromAccessToken(jwtFalso({ app_metadata: { app_role: papel } }))).toBe(papel);
  });

  it('cai em leitura quando o token não traz app_role', () => {
    expect(roleFromAccessToken(jwtFalso({ sub: 'u1', app_metadata: {} }))).toBe('leitura');
    expect(roleFromAccessToken(jwtFalso({ sub: 'u1' }))).toBe('leitura');
  });

  it('cai em leitura quando o papel não existe no enum', () => {
    expect(roleFromAccessToken(jwtFalso({ app_metadata: { app_role: 'superuser' } }))).toBe(
      'leitura',
    );
  });

  it('ignora user_metadata (editável pelo usuário) — RF-ADM-01', () => {
    const token = jwtFalso({ user_metadata: { app_role: 'admin' }, app_metadata: {} });
    expect(roleFromAccessToken(token)).toBe('leitura');
  });

  it('cai em leitura com token ausente ou malformado', () => {
    expect(roleFromAccessToken(null)).toBe(PAPEL_PADRAO);
    expect(roleFromAccessToken(undefined)).toBe(PAPEL_PADRAO);
    expect(roleFromAccessToken('')).toBe(PAPEL_PADRAO);
    expect(roleFromAccessToken('abc')).toBe(PAPEL_PADRAO);
    expect(roleFromAccessToken('a.b.c')).toBe(PAPEL_PADRAO);
    expect(roleFromAccessToken('a.!!!.c')).toBe(PAPEL_PADRAO);
  });

  it('decodifica payload com acentos (UTF-8) e sem padding de base64', () => {
    const payload = decodeJwtPayload(
      jwtFalso({ user_metadata: { full_name: 'Heloísa Ç' }, app_metadata: { app_role: 'sdr' } }),
    );
    expect(payload).toMatchObject({ user_metadata: { full_name: 'Heloísa Ç' } });
  });
});

describe('roleFromClaims', () => {
  it('lê claims já validadas pelo getClaims()', () => {
    expect(roleFromClaims({ sub: 'u1', app_metadata: { app_role: 'gestor' } })).toBe('gestor');
  });

  it('tolera claims inválidas', () => {
    expect(roleFromClaims(null)).toBe('leitura');
    expect(roleFromClaims('texto')).toBe('leitura');
    expect(roleFromClaims({ app_metadata: 'x' })).toBe('leitura');
    expect(roleFromClaims({ app_metadata: { app_role: 42 } })).toBe('leitura');
  });
});

describe('isAppRole', () => {
  it('reconhece só os valores do enum', () => {
    expect(isAppRole('sdr')).toBe(true);
    expect(isAppRole('SDR')).toBe(false);
    expect(isAppRole(undefined)).toBe(false);
  });
});
