import { describe, expect, it } from 'vitest';

import { origensDasEmpresas, regrasDaCasca } from './ambiente';
import { empresaGuardada, empresaParaLembrar } from './empresa';

const noAr = origensDasEmpresas('producao');
const noTeste = origensDasEmpresas('local', '10.0.0.188:8081');

describe('onde o app abre', () => {
  it('na primeira vez, a KOMUNE; depois, a empresa guardada', () => {
    expect(regrasDaCasca('producao').inicio).toBe('https://triade-crm-tawny.vercel.app');
    expect(regrasDaCasca('producao', null, 'imova').inicio).toBe('https://imova-crm.vercel.app');
    expect(regrasDaCasca('local', '10.0.0.188:8081', 'imova').inicio).toBe(
      'http://10.0.0.188:3101',
    );
  });

  it('a troca de empresa não muda o que a casca deixa abrir', () => {
    expect(regrasDaCasca('producao', null, 'imova').hosts).toEqual(regrasDaCasca('producao').hosts);
  });

  it('só vale o que ainda é empresa conhecida', () => {
    expect(empresaGuardada('imova')).toBe('imova');
    expect(empresaGuardada(' komune\n')).toBe('komune');
    expect(empresaGuardada('outra')).toBeNull();
    expect(empresaGuardada(null)).toBeNull();
  });
});

describe('a empresa que o app guarda', () => {
  it('a de uma página de dentro do CRM', () => {
    expect(empresaParaLembrar('https://imova-crm.vercel.app/meu-dia', noAr)).toBe('imova');
    expect(empresaParaLembrar('https://triade-crm-tawny.vercel.app/conversas?c=1', noAr)).toBe(
      'komune',
    );
    expect(empresaParaLembrar('http://10.0.0.188:3101/parceiros/abc', noTeste)).toBe('imova');
  });

  it('nunca o login, o caminho dele ou a raiz (que manda para o login)', () => {
    expect(empresaParaLembrar('https://imova-crm.vercel.app/login', noAr)).toBeNull();
    expect(
      empresaParaLembrar('https://imova-crm.vercel.app/login?erro=sem-perfil', noAr),
    ).toBeNull();
    expect(
      empresaParaLembrar('https://imova-crm.vercel.app/auth/app/entrar?token=x', noAr),
    ).toBeNull();
    expect(empresaParaLembrar('https://imova-crm.vercel.app/', noAr)).toBeNull();
    expect(empresaParaLembrar('https://imova-crm.vercel.app', noAr)).toBeNull();
  });

  it('nem outro site, nem http no lugar de https', () => {
    expect(empresaParaLembrar('https://google.com/meu-dia', noAr)).toBeNull();
    expect(empresaParaLembrar('http://imova-crm.vercel.app/meu-dia', noAr)).toBeNull();
    expect(empresaParaLembrar('http://10.0.0.188:3102/meu-dia', noTeste)).toBeNull();
  });
});
