import { describe, expect, it } from 'vitest';

import {
  anuncioPadrao,
  avisoDoAnuncioForaDoAr,
  chaveDoCodigo,
  enderecoDoAnuncio,
  filtrarAnuncios,
  linhaDoImovel,
  recadoDoImovel,
  validarImovel,
  type AnuncioDaEscolha,
} from './imovel-da-visita';

/**
 * O imóvel da visita (11/11/2026, só na Imova): "Caso seja visita presencial, deverá
 * ter o endereço e o código do imóvel/terreno que será tratado." Estes testes seguram
 * o anúncio padrão da folha do link, a régua da escolha, a busca, o endereço montado
 * como no banco e a linha de onde do cartão.
 */

function anuncio(parcial: Partial<AnuncioDaEscolha> & { codigo: string }): AnuncioDaEscolha {
  return {
    id: `id-${parcial.codigo}`,
    titulo: 'Apartamento com 2 quartos',
    situacao: 'no_ar',
    endereco: 'Rua das Algas, 120, Ponta Negra, Natal',
    ...parcial,
  };
}

const LISTA: AnuncioDaEscolha[] = [
  anuncio({
    codigo: 'IM0010',
    titulo: 'Casa em Capim Macio',
    situacao: 'pausado',
    endereco: 'Rua Missionário Gunnar Vingren, 50, Capim Macio, Natal',
  }),
  anuncio({ codigo: 'IM0003', titulo: 'Casa com 3 quartos em Ponta Negra' }),
  anuncio({ codigo: 'TE0004', titulo: 'Terreno de esquina em Parnamirim', endereco: null }),
  anuncio({ codigo: 'SA0012_IMOVA', titulo: 'Sala comercial no Tirol', situacao: 'rascunho' }),
];

describe('o endereço do anúncio, montado como no banco', () => {
  it('junta rua e número, complemento, bairro e cidade', () => {
    expect(
      enderecoDoAnuncio({
        endereco: 'Av. Engenheiro Roberto Freire',
        numero: '4715',
        complemento: 'Sala A',
        bairro: 'Ponta Negra',
        cidade: 'Natal',
      }),
    ).toBe('Av. Engenheiro Roberto Freire, 4715, Sala A, Ponta Negra, Natal');
  });

  it('não repete o número que já está na rua', () => {
    expect(
      enderecoDoAnuncio({
        endereco: 'Av Barra de Tabatinga, 2004',
        numero: '2004',
        complemento: null,
        bairro: 'Tabatinga',
        cidade: 'Nísia Floresta',
      }),
    ).toBe('Av Barra de Tabatinga, 2004, Tabatinga, Nísia Floresta');
  });

  it('sem rua o número some, e sem nada é nulo', () => {
    expect(
      enderecoDoAnuncio({
        endereco: ' ',
        numero: '10',
        complemento: null,
        bairro: 'Tirol',
        cidade: null,
      }),
    ).toBe('Tirol');
    expect(
      enderecoDoAnuncio({
        endereco: null,
        numero: null,
        complemento: null,
        bairro: null,
        cidade: null,
      }),
    ).toBeNull();
  });
});

describe('a busca por código e título', () => {
  it('casa o código sem os zeros, com espaço ou hífen, e o sufixo', () => {
    expect(chaveDoCodigo('IM0003')).toBe('IM3');
    expect(chaveDoCodigo('im 3')).toBe('IM3');
    expect(chaveDoCodigo('IM-03')).toBe('IM3');
    expect(chaveDoCodigo('SA0012_IMOVA')).toBe('SA12');
    expect(chaveDoCodigo('casa')).toBeNull();
    expect(filtrarAnuncios(LISTA, 'im3').map((a) => a.codigo)).toEqual(['IM0003']);
    expect(filtrarAnuncios(LISTA, 'sa12').map((a) => a.codigo)).toEqual(['SA0012_IMOVA']);
  });

  it('acha pelo título e pelo endereço, sem acento e sem maiúscula, palavra por palavra', () => {
    expect(filtrarAnuncios(LISTA, 'CASA ponta').map((a) => a.codigo)).toEqual(['IM0003']);
    expect(filtrarAnuncios(LISTA, 'parnamirim').map((a) => a.codigo)).toEqual(['TE0004']);
    expect(filtrarAnuncios(LISTA, 'algas').map((a) => a.codigo)).toEqual([
      'IM0003',
      'SA0012_IMOVA',
    ]);
    expect(filtrarAnuncios(LISTA, 'missionario').map((a) => a.codigo)).toEqual(['IM0010']);
    expect(filtrarAnuncios(LISTA, 'nada disso')).toEqual([]);
  });

  it('sem busca, o que está no ar vem primeiro, e depois pelo código', () => {
    expect(filtrarAnuncios(LISTA, '  ').map((a) => a.codigo)).toEqual([
      'IM0003',
      'TE0004',
      'IM0010',
      'SA0012_IMOVA',
    ]);
  });
});

describe('o anúncio que a folha do link já abre escolhido', () => {
  it('é o do lead do portal ("Veio do anúncio")', () => {
    expect(
      anuncioPadrao(LISTA, {
        doLead: { anuncioId: 'id-IM0003', codigo: 'IM0003', parecido: false },
        daChegada: 'TE0004',
      }),
    ).toBe('id-IM0003');
  });

  it('acha pelo código do lead quando o lead não está ligado ao anúncio do CRM', () => {
    expect(
      anuncioPadrao(LISTA, { doLead: { anuncioId: null, codigo: 'SA12', parecido: false } }),
    ).toBe('id-SA0012_IMOVA');
  });

  it('o "parecido com" não conta: vale o código da placa, e sem ele, nada', () => {
    const parecido = { anuncioId: null, codigo: 'IM0003', parecido: true };
    expect(anuncioPadrao(LISTA, { doLead: parecido, daChegada: 'TE4' })).toBe('id-TE0004');
    expect(anuncioPadrao(LISTA, { doLead: parecido })).toBeNull();
  });

  it('anúncio que não está na lista (excluído) não é escolhido', () => {
    expect(
      anuncioPadrao(LISTA, {
        doLead: { anuncioId: 'id-excluido', codigo: 'IM0099', parecido: false },
      }),
    ).toBeNull();
    expect(anuncioPadrao([], { daChegada: 'IM0003' })).toBeNull();
  });
});

describe('a régua do imóvel da visita', () => {
  it('com anúncio, vale o anúncio; sem escolher, recusa', () => {
    expect(validarImovel({ modo: 'anuncio', anuncioId: 'id-IM0003' })).toEqual({
      ok: true,
      anuncioId: 'id-IM0003',
      endereco: null,
    });
    expect(validarImovel({ modo: 'anuncio', anuncioId: null })).toEqual({
      ok: false,
      recado: 'Escolha o anúncio do imóvel da visita.',
    });
  });

  it('sem anúncio, o endereço é obrigatório e precisa ser endereço', () => {
    expect(
      validarImovel({ modo: 'sem_anuncio', endereco: '  Rua Mossoró,  250, Tirol, Natal ' }),
    ).toEqual({ ok: true, anuncioId: null, endereco: 'Rua Mossoró, 250, Tirol, Natal' });
    for (const endereco of ['', '   ', '12', 'Local a combinar (o Calendly não informou)']) {
      expect(validarImovel({ modo: 'sem_anuncio', endereco }).ok).toBe(false);
    }
    expect(
      validarImovel({ modo: 'sem_anuncio', endereco: `Rua ${'a'.repeat(300)}` }),
    ).toMatchObject({
      ok: false,
      recado: expect.stringMatching(/300 letras/),
    });
  });
});

describe('o que o cartão mostra', () => {
  it('a linha de onde é "código · título"', () => {
    expect(linhaDoImovel({ codigo: 'IM0003', titulo: 'Casa com 3 quartos em Ponta Negra' })).toBe(
      'IM0003 · Casa com 3 quartos em Ponta Negra',
    );
    expect(linhaDoImovel({ codigo: 'IM0003', titulo: null })).toBe('IM0003');
    expect(linhaDoImovel({ codigo: null, titulo: null })).toBe('Imóvel sem anúncio');
  });

  it('avisa do anúncio que não está no ar, e só dele', () => {
    expect(avisoDoAnuncioForaDoAr('no_ar')).toBeNull();
    expect(avisoDoAnuncioForaDoAr(null)).toBeNull();
    expect(avisoDoAnuncioForaDoAr('pausado')).toMatch(/^Este anúncio está fora do ar: /);
    expect(avisoDoAnuncioForaDoAr('rascunho')).toMatch(/^Este anúncio está em rascunho: /);
  });

  it('as recusas do imóvel têm frase própria, e as da agenda continuam as de sempre', () => {
    expect(recadoDoImovel('visita_sem_imovel')).toMatch(/A visita precisa do imóvel/);
    expect(recadoDoImovel('anuncio_invalido')).toMatch(/não existe mais ou foi excluído/);
    expect(recadoDoImovel('horario_ocupado')).toBe('Essa pessoa já tem compromisso nesse horário.');
    expect(recadoDoImovel('qualquer_coisa')).toBe('Não deu para falar com o servidor.');
  });
});
