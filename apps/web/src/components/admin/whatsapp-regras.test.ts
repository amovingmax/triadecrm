import { describe, expect, it } from 'vitest';

import {
  conferirPerfil,
  formularioDoPerfil,
  fraseDoPerfil,
  lerOpcoesDeEnvio,
  lerPerfil,
  mesclarOpcoes,
  mudancasDoPerfil,
} from './whatsapp-regras';

describe('as opções do envio', () => {
  it('chave ausente é ligada; só "falso" escrito desliga', () => {
    expect(lerOpcoesDeEnvio({ numero_padrao: '+5584' })).toEqual({
      confirmarLeitura: true,
      mostrarDigitando: true,
    });
    expect(lerOpcoesDeEnvio({ confirmar_leitura: false, mostrar_digitando: 'false' })).toEqual({
      confirmarLeitura: false,
      mostrarDigitando: false,
    });
    expect(lerOpcoesDeEnvio(null)).toEqual({ confirmarLeitura: true, mostrarDigitando: true });
  });

  it('mesclar guarda o número conectado e a assinatura', () => {
    expect(
      mesclarOpcoes(
        { numero_padrao: '+5584999998801', assinar_com_nome: true },
        { confirmar_leitura: false },
      ),
    ).toEqual({
      numero_padrao: '+5584999998801',
      assinar_com_nome: true,
      confirmar_leitura: false,
    });
    expect(mesclarOpcoes(undefined, { mostrar_digitando: true })).toEqual({
      mostrar_digitando: true,
    });
  });
});

describe('o perfil', () => {
  it('nulo antes de o worker ler a primeira vez', () => {
    expect(lerPerfil({})).toBeNull();
    expect(lerPerfil(null)).toBeNull();
  });

  it('lê o que a Meta devolveu, com os sites que são texto', () => {
    const p = lerPerfil({
      about: 'Marketplace de eventos',
      websites: ['https://komune.com.br', 3],
      profile_picture_url: 'https://pps.whatsapp.net/x.jpg',
      lido_em: '2026-10-27T15:00:00Z',
    });
    expect(p?.websites).toEqual(['https://komune.com.br']);
    expect(p?.profilePictureUrl).toBe('https://pps.whatsapp.net/x.jpg');
    expect(p?.address).toBe('');
    expect(formularioDoPerfil(p).site1).toBe('https://komune.com.br');
  });

  it('só o que mudou vai para a Meta', () => {
    const antes = formularioDoPerfil(
      lerPerfil({
        about: 'Oi',
        email: 'a@b.co',
        websites: ['https://a.co'],
        vertical: 'EVENT_PLAN',
      }),
    );
    expect(mudancasDoPerfil(antes, { ...antes })).toEqual({});
    expect(mudancasDoPerfil(antes, { ...antes, about: ' Olá ', site2: 'https://b.co' })).toEqual({
      about: 'Olá',
      websites: ['https://a.co', 'https://b.co'],
    });
    expect(mudancasDoPerfil(antes, { ...antes, site1: '' })).toEqual({ websites: [] });
    expect(mudancasDoPerfil(antes, { ...antes, vertical: 'RETAIL' })).toEqual({
      vertical: 'RETAIL',
    });
  });

  it('confere os tetos da Meta antes de mandar', () => {
    expect(conferirPerfil({ about: '' })).toBe('recado_de_1_a_139_letras');
    expect(conferirPerfil({ about: 'x'.repeat(140) })).toBe('recado_de_1_a_139_letras');
    expect(conferirPerfil({ description: 'x'.repeat(513) })).toBe('descricao_longa_demais');
    expect(conferirPerfil({ websites: ['komune.com.br'] })).toBe('ate_2_sites_com_http');
    expect(conferirPerfil({ websites: ['https://a', 'https://b', 'https://c'] })).toBe(
      'ate_2_sites_com_http',
    );
    expect(conferirPerfil({ email: 'sem-arroba' })).toBe('email_invalido');
    expect(conferirPerfil({ email: '' })).toBeNull();
    expect(conferirPerfil({ about: 'Marketplace de eventos de Natal' })).toBeNull();
  });

  it('cada motivo tem frase', () => {
    expect(fraseDoPerfil('recado_de_1_a_139_letras')).toMatch(/139/);
    expect(fraseDoPerfil('qualquer')).toMatch(/Tente de novo/);
  });
});
