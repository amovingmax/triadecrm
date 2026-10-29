import { describe, expect, it } from 'vitest';

import {
  ENDERECOS,
  MARCA_DO_APP,
  MARCA_NO_USER_AGENT,
  ambienteDoApp,
  hostDoMac,
  partesDoEndereco,
  regrasDaCasca,
} from './ambiente';

describe('ambiente do app', () => {
  it('sem variável é o teste local: um app de teste nunca abre a produção por descuido', () => {
    expect(ambienteDoApp(undefined)).toBe('local');
    expect(ambienteDoApp('')).toBe('local');
    expect(regrasDaCasca(ambienteDoApp(undefined), '10.0.0.188:8081').inicio).toBe(
      'http://10.0.0.188:3100',
    );
  });

  it('ambiente desconhecido é erro, não cai em nenhum outro', () => {
    expect(() => ambienteDoApp('produção')).toThrow(/não existe/);
    expect(() => ambienteDoApp('prod')).toThrow(/não existe/);
    // O emulador do Android tinha ambiente próprio no Capacitor; no Expo ele usa o local.
    expect(() => ambienteDoApp('local-android')).toThrow(/não existe/);
  });

  it('no teste, o celular acha o Mac pelo endereço de onde o Expo serve o app', () => {
    expect(hostDoMac('10.0.0.188:8081')).toBe('10.0.0.188');
    expect(hostDoMac('192.168.1.20:8082')).toBe('192.168.1.20');
    // O simulador do iPhone divide a rede com o Mac.
    expect(hostDoMac(undefined)).toBe('localhost');
    expect(hostDoMac('')).toBe('localhost');
    expect(regrasDaCasca('local').inicio).toBe('http://localhost:3100');
  });

  it('no ar, só https e só as duas empresas', () => {
    const regras = regrasDaCasca('producao', '10.0.0.188:8081');
    expect(regras.inicio).toBe(ENDERECOS.komune);
    expect(regras.soHttps).toBe(true);
    expect(regras.hosts).toEqual(['triade-crm-tawny.vercel.app', 'imova-crm.vercel.app']);
  });

  it('a troca de empresa navega dentro do app nos dois ambientes', () => {
    for (const ambiente of ['local', 'producao'] as const) {
      expect(regrasDaCasca(ambiente, '10.0.0.188:8081').hosts).toContain('imova-crm.vercel.app');
    }
    expect(regrasDaCasca('local', '10.0.0.188:8081').hosts).toContain('10.0.0.188:3100');
  });

  it('a casca se identifica ao site pelo user-agent, e só por ele', () => {
    expect(MARCA_NO_USER_AGENT).toMatch(new RegExp(`^${MARCA_DO_APP}/\\d+\\.\\d+\\.\\d+$`));
  });
});

describe('partesDoEndereco', () => {
  it('separa esquema e host, com a porta quando não é a padrão', () => {
    expect(partesDoEndereco('https://triade-crm-tawny.vercel.app/conversas?x=1')).toEqual({
      esquema: 'https',
      host: 'triade-crm-tawny.vercel.app',
    });
    expect(partesDoEndereco('http://10.0.0.188:3100/')).toEqual({
      esquema: 'http',
      host: '10.0.0.188:3100',
    });
    expect(partesDoEndereco('tel:+5584999999999')).toEqual({ esquema: 'tel', host: '' });
  });

  it('a porta padrão some e o usuário antes de @ não é host, como no navegador', () => {
    expect(partesDoEndereco('https://Triade-CRM-tawny.vercel.app:443/x')?.host).toBe(
      'triade-crm-tawny.vercel.app',
    );
    expect(partesDoEndereco('https://outro.com@imova-crm.vercel.app/')?.host).toBe(
      'imova-crm.vercel.app',
    );
  });

  it('o que não é endereço não tem partes', () => {
    expect(partesDoEndereco('')).toBeNull();
    expect(partesDoEndereco('/conversas')).toBeNull();
  });
});
