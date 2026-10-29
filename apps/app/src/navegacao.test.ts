import { describe, expect, it } from 'vitest';

import { regrasDaCasca } from './ambiente';
import { destinoDoEndereco } from './navegacao';

const noAr = regrasDaCasca('producao');
const noTeste = regrasDaCasca('local', '10.0.0.188:8081');

describe('destinoDoEndereco', () => {
  it('as duas empresas abrem dentro do app', () => {
    expect(destinoDoEndereco('https://triade-crm-tawny.vercel.app/conversas', noAr)).toBe('app');
    expect(destinoDoEndereco('https://imova-crm.vercel.app/meu-dia', noAr)).toBe('app');
  });

  it('no ar, http nunca abre dentro do app, nem o do Mac', () => {
    expect(destinoDoEndereco('http://triade-crm-tawny.vercel.app/', noAr)).toBe('fora');
    expect(destinoDoEndereco('http://10.0.0.188:3100/', noAr)).toBe('fora');
  });

  it('no teste, o site do Mac abre dentro do app, e só na porta dele', () => {
    expect(destinoDoEndereco('http://10.0.0.188:3100/auth/dev?quem=gestor', noTeste)).toBe('app');
    expect(destinoDoEndereco('http://10.0.0.188:3000/', noTeste)).toBe('fora');
    expect(destinoDoEndereco('http://10.0.0.188:54321/auth/v1/authorize', noTeste)).toBe('fora');
  });

  it('outros sites e o login do Google vão para o navegador do aparelho', () => {
    expect(destinoDoEndereco('https://accounts.google.com/o/oauth2/v2/auth', noAr)).toBe('fora');
    expect(
      destinoDoEndereco('https://toqdjcajyrowutunczhr.supabase.co/auth/v1/authorize', noAr),
    ).toBe('fora');
    expect(destinoDoEndereco('https://triade-crm-tawny.vercel.app.golpe.com/', noAr)).toBe('fora');
  });

  it('telefone, e-mail e WhatsApp abrem o app certo do aparelho', () => {
    expect(destinoDoEndereco('tel:+5584999999999', noAr)).toBe('fora');
    expect(destinoDoEndereco('mailto:contato@komune.app.br', noAr)).toBe('fora');
    expect(destinoDoEndereco('whatsapp://send?phone=5584999999999', noAr)).toBe('fora');
  });

  it('about:blank e os downloads por blob ficam no app; o resto perigoso não abre', () => {
    expect(destinoDoEndereco('about:blank', noAr)).toBe('app');
    expect(destinoDoEndereco('blob:https://triade-crm-tawny.vercel.app/1234', noAr)).toBe('app');
    expect(destinoDoEndereco('javascript:alert(1)', noAr)).toBe('nenhum');
    expect(destinoDoEndereco('file:///etc/hosts', noAr)).toBe('nenhum');
    expect(destinoDoEndereco('data:text/html,<p>oi</p>', noAr)).toBe('nenhum');
    expect(destinoDoEndereco('não é endereço', noAr)).toBe('nenhum');
  });
});
