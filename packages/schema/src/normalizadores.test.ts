import { describe, expect, it } from 'vitest';

import {
  CASOS_CNPJ_NORMALIZE,
  CASOS_CNPJ_VALIDO,
  CASOS_DOMINIO,
  CASOS_HOST_COMPARTILHADO,
  CASOS_INSTAGRAM,
  CASOS_MASCARA,
  CASOS_SEARCH_NAME,
  CASOS_TELEFONE,
} from './casos-normalizacao.fixtures';
import { SCHEMA_PACKAGE, TIMEZONE } from './index';
import {
  cnpjIsValid,
  formatPhoneBr,
  isPhoneBrValido,
  isSharedWebHost,
  maskPhone,
  normalizeCnpj,
  normalizeInstagram,
  normalizePhoneBr,
  searchName,
  websiteDomain,
} from './normalizadores';

describe('@komune/schema', () => {
  it('exporta as constantes compartilhadas', () => {
    expect(SCHEMA_PACKAGE).toBe('@komune/schema');
    expect(TIMEZONE).toBe('America/Fortaleza');
  });
});

describe('normalizePhoneBr (espelho de app.normalize_phone_br)', () => {
  it.each(CASOS_TELEFONE)('telefone: $descricao', ({ entrada, esperado }) => {
    expect(normalizePhoneBr(entrada)).toBe(esperado);
  });

  it('trata undefined como NULL, igual ao coalesce do SQL', () => {
    expect(normalizePhoneBr(undefined)).toBeNull();
  });

  it('isPhoneBrValido é o atalho booleano da mesma regra', () => {
    expect(isPhoneBrValido('(84) 99999-1234')).toBe(true);
    expect(isPhoneBrValido('84 89999-1234')).toBe(false);
  });
});

describe('normalizeCnpj / cnpjIsValid (espelho de app.normalize_cnpj e app.cnpj_is_valid)', () => {
  it.each(CASOS_CNPJ_NORMALIZE)('cnpj: $descricao', ({ entrada, esperado }) => {
    expect(normalizeCnpj(entrada)).toBe(esperado);
  });

  it.each(CASOS_CNPJ_VALIDO)('cnpj válido: $descricao', ({ entrada, esperado }) => {
    expect(cnpjIsValid(entrada)).toBe(esperado);
  });

  it('rejeita todas as sequências repetidas, não só a de 1', () => {
    for (let d = 0; d <= 9; d += 1) {
      expect(cnpjIsValid(String(d).repeat(14))).toBe(false);
    }
  });
});

describe('normalizeInstagram (espelho de app.normalize_instagram)', () => {
  it.each(CASOS_INSTAGRAM)('instagram: $descricao', ({ entrada, esperado }) => {
    expect(normalizeInstagram(entrada)).toBe(esperado);
  });

  it('recusa todas as rotas reservadas do Instagram', () => {
    for (const rota of ['p', 'reels', 'story', 'direct', 'oauth', 'static']) {
      expect(normalizeInstagram(`https://www.instagram.com/${rota}/algo/`)).toBeNull();
    }
  });
});

describe('websiteDomain / isSharedWebHost (espelho de app.website_domain e app.is_shared_web_host)', () => {
  it.each(CASOS_DOMINIO)('domínio: $descricao', ({ entrada, esperado }) => {
    expect(websiteDomain(entrada)).toBe(esperado);
  });

  it.each(CASOS_HOST_COMPARTILHADO)('host: $descricao', ({ entrada, esperado }) => {
    expect(isSharedWebHost(entrada)).toBe(esperado);
  });
});

describe('searchName (espelho de app.search_name)', () => {
  it.each(CASOS_SEARCH_NAME)('search_name: $descricao', ({ entrada, esperado }) => {
    expect(searchName(entrada)).toBe(esperado);
  });
});

describe('maskPhone (espelho de app.mask_phone, RF-BAS-14)', () => {
  it.each(CASOS_MASCARA)('máscara: $descricao', ({ entrada, esperado }) => {
    expect(maskPhone(entrada)).toBe(esperado);
  });

  it('nunca deixa passar mais que os 2 últimos dígitos', () => {
    const mascarado = maskPhone('+5584999991234');
    expect(mascarado).not.toContain('9999');
    expect(mascarado?.endsWith('34')).toBe(true);
  });
});

describe('formatPhoneBr (apresentação, sem equivalente no banco)', () => {
  it('formata celular e fixo e devolve o valor original quando não reconhece', () => {
    expect(formatPhoneBr('+5584999991234')).toBe('+55 84 99999-1234');
    expect(formatPhoneBr('+558432064212')).toBe('+55 84 3206-4212');
    expect(formatPhoneBr('+351912345678')).toBe('+351912345678');
    expect(formatPhoneBr(null)).toBeNull();
  });
});
