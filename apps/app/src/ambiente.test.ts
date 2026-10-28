import { describe, expect, it } from 'vitest';

import {
  ENDERECOS,
  MARCA_DO_APP,
  ambienteDoApp,
  enderecoInicial,
  hostsPermitidos,
  montarConfig,
} from './ambiente';

describe('ambiente do app', () => {
  it('sem variável é o teste local: um app de teste nunca abre a produção por descuido', () => {
    expect(ambienteDoApp(undefined)).toBe('local');
    expect(ambienteDoApp('')).toBe('local');
    expect(montarConfig(ambienteDoApp(undefined)).server?.url).toBe('http://localhost:3000');
  });

  it('ambiente desconhecido é erro, não cai em nenhum outro', () => {
    expect(() => ambienteDoApp('produção')).toThrow(/não existe/);
    expect(() => ambienteDoApp('prod')).toThrow(/não existe/);
  });

  it('o emulador do Android enxerga o Mac em 10.0.2.2', () => {
    expect(enderecoInicial('local-android')).toBe('http://10.0.2.2:3000');
  });

  it('no ar, só https e só as duas empresas', () => {
    const config = montarConfig('producao');
    expect(config.server?.url).toBe(ENDERECOS.komune);
    expect(config.server?.cleartext).toBe(false);
    expect(config.server?.allowNavigation).toEqual([
      'triade-crm-tawny.vercel.app',
      'imova-crm.vercel.app',
    ]);
    for (const host of hostsPermitidos('producao'))
      expect(host).not.toMatch(/localhost|10\.0\.2\.2/);
  });

  it('a casca se identifica ao site pelo user-agent, e só por ele', () => {
    expect(montarConfig('producao').appendUserAgent).toMatch(
      new RegExp(`^${MARCA_DO_APP}/\\d+\\.\\d+\\.\\d+$`),
    );
  });

  it('a troca de empresa navega dentro do app nos três ambientes', () => {
    for (const ambiente of ['local', 'local-android', 'producao'] as const) {
      expect(hostsPermitidos(ambiente)).toContain('imova-crm.vercel.app');
    }
  });
});
