import { describe, expect, it } from 'vitest';

import {
  CAMPOS_DA_WHITELIST,
  CHAVE_PROIBIDA,
  filtrarPelaWhitelist,
  payloadTemIdentidade,
} from './whitelist';

describe('filtrarPelaWhitelist', () => {
  it('deixa passar só os campos da whitelist', () => {
    const { payload } = filtrarPelaWhitelist({
      nome_comercial: 'Triunfal Cerimonial',
      cidade: 'Natal',
      nota: 4.9,
      avaliacoes_qtd: 89,
      preco_a_partir_de: 4300,
    });
    expect(payload).toEqual({
      nome_comercial: 'Triunfal Cerimonial',
      cidade: 'Natal',
      nota: 4.9,
      avaliacoes_qtd: 89,
      preco_a_partir_de: 4300,
    });
  });

  it('descarta foto, descrição e avaliação — e grita, porque são proibidos', () => {
    const resultado = filtrarPelaWhitelist({
      nome_comercial: 'Espaço X',
      image: ['https://cdn0.casamentos.com.br/vendor/1.webp'],
      description: 'texto longo do fornecedor',
      review: [{ author: 'Ana' }],
      logo: 'https://cdn0/logo.png',
    });
    expect(resultado.payload).toEqual({ nome_comercial: 'Espaço X' });
    expect(resultado.proibidos.sort()).toEqual(['description', 'image', 'logo', 'review']);
  });

  it('descarta CPF e dado bancário, que nem existem no CRM (ADR-09)', () => {
    const resultado = filtrarPelaWhitelist({ nome_comercial: 'A', cpf: '123', pix: 'x@y' });
    expect(resultado.payload).toEqual({ nome_comercial: 'A' });
    expect(resultado.proibidos.sort()).toEqual(['cpf', 'pix']);
  });

  it('omite vazio, nulo e não-numérico em vez de mandar lixo ao banco', () => {
    const { payload } = filtrarPelaWhitelist({
      nome_comercial: '  Buffet Y  ',
      cidade: '   ',
      nota: Number.NaN,
      avaliacoes_qtd: null,
      bairro: undefined,
    });
    expect(payload).toEqual({ nome_comercial: 'Buffet Y' });
  });

  it('aceita lista de telefones e limpa os itens vazios', () => {
    const { payload } = filtrarPelaWhitelist({
      nome_comercial: 'Z',
      telefones: [' (84) 99999-0000 ', '', '  '],
    });
    expect(payload.telefones).toEqual(['(84) 99999-0000']);
  });

  it('descarta chave fora da whitelist mesmo quando é inofensiva', () => {
    const resultado = filtrarPelaWhitelist({ nome_comercial: 'W', latitude: -5.79 });
    expect(resultado.descartados).toEqual(['latitude']);
    expect(resultado.proibidos).toEqual([]);
  });
});

describe('a lista é a mesma do banco', () => {
  it('nenhum campo permitido casa com a expressão de campo proibido', () => {
    // Se um dia alguém acrescentar `foto_url` à whitelist, este teste avisa antes
    // do banco: `app.payload_e_permitido` recusaria o payload inteiro.
    const conflitos = CAMPOS_DA_WHITELIST.filter(
      (campo) => CHAVE_PROIBIDA.test(campo) && campo !== 'fotos_qtd',
    );
    expect(conflitos).toEqual([]);
  });
});

describe('payloadTemIdentidade', () => {
  it('exige nome comercial ou razão social', () => {
    expect(payloadTemIdentidade({ nome_comercial: 'A' })).toBe(true);
    expect(payloadTemIdentidade({ razao_social: 'A LTDA' })).toBe(true);
    expect(payloadTemIdentidade({ cidade: 'Natal' })).toBe(false);
  });
});
