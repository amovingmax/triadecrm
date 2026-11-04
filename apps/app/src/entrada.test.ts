import { describe, expect, it } from 'vitest';

import { regrasDaCasca } from './ambiente';
import {
  enderecoDepoisDaJanela,
  enderecoDoInicio,
  lerDevolucao,
  origemDoInicio,
  voltaDoApp,
} from './entrada';

const noAr = regrasDaCasca('producao');
const noTeste = regrasDaCasca('local', '192.168.0.192:8081');
const ESTADO = '3f1c9a2e-7b4d-4e8a-9c0f-5d6e7f8a9b0c';
const CODIGO = '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15';

describe('o pedido de login pelo app', () => {
  it('reconhece o início nas duas empresas, e devolve a origem de cada uma', () => {
    expect(origemDoInicio('https://triade-crm-tawny.vercel.app/auth/app/google', noAr)).toBe(
      'https://triade-crm-tawny.vercel.app',
    );
    expect(origemDoInicio('https://imova-crm.vercel.app/auth/app/google?x=1', noAr)).toBe(
      'https://imova-crm.vercel.app',
    );
    expect(origemDoInicio('http://192.168.0.192:3101/auth/app/google', noTeste)).toBe(
      'http://192.168.0.192:3101',
    );
  });

  it('não confunde com outra rota, outro site ou http no ar', () => {
    expect(origemDoInicio('https://triade-crm-tawny.vercel.app/auth/callback', noAr)).toBeNull();
    expect(origemDoInicio('https://triade-crm-tawny.vercel.app/auth/app/googlex', noAr)).toBeNull();
    expect(origemDoInicio('https://atacante.com/auth/app/google', noAr)).toBeNull();
    expect(origemDoInicio('http://triade-crm-tawny.vercel.app/auth/app/google', noAr)).toBeNull();
  });
});

describe('a ida e a volta da janela segura', () => {
  it('a volta é o esquema do app, ou o projeto do Mac no Expo Go', () => {
    expect(voltaDoApp(false, '192.168.0.192:8081')).toBe('triade://auth');
    expect(voltaDoApp(true, '192.168.0.192:8081')).toBe('exp://192.168.0.192:8081/--/auth');
  });

  it('a janela abre com o estado e a volta na query', () => {
    expect(enderecoDoInicio('https://imova-crm.vercel.app', ESTADO, 'triade://auth')).toBe(
      `https://imova-crm.vercel.app/auth/app/google?estado=${ESTADO}&volta=triade%3A%2F%2Fauth`,
    );
  });

  it('com o estado certo, o código vira a entrada na WebView', () => {
    const devolucao = lerDevolucao(`triade://auth?token=${CODIGO}&estado=${ESTADO}`, ESTADO);
    expect(devolucao).toEqual({ codigo: CODIGO });
    expect(enderecoDepoisDaJanela('https://imova-crm.vercel.app', devolucao)).toBe(
      `https://imova-crm.vercel.app/auth/app/entrar?token=${CODIGO}`,
    );
  });

  it('sem o estado sorteado aqui, nada vale', () => {
    expect(lerDevolucao(`triade://auth?token=${CODIGO}&estado=outro`, ESTADO)).toEqual({
      erro: 'app',
    });
    expect(lerDevolucao(`triade://auth?token=${CODIGO}`, ESTADO)).toEqual({ erro: 'app' });
  });

  it('a recusa do site vira o aviso da tela de login', () => {
    const devolucao = lerDevolucao(`triade://auth?erro=sem-perfil&estado=${ESTADO}`, ESTADO);
    expect(devolucao).toEqual({ erro: 'sem-perfil' });
    expect(enderecoDepoisDaJanela('https://triade-crm-tawny.vercel.app', devolucao)).toBe(
      'https://triade-crm-tawny.vercel.app/login?erro=sem-perfil',
    );
    expect(lerDevolucao(`triade://auth?erro=%3Cscript%3E&estado=${ESTADO}`, ESTADO)).toEqual({
      erro: 'callback',
    });
  });
});
