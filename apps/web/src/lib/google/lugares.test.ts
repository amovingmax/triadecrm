import { describe, expect, it } from 'vitest';

import { montarConsulta } from './lugares';

/**
 * A consulta textual é a única lógica deste módulo que não é chamada HTTP, e é
 * onde o erro sai caro: uma consulta mal montada devolve o telefone de OUTRO
 * negócio, e a pessoa liga achando que está falando com o fornecedor certo.
 *
 * Os casos abaixo são os nomes reais das 34 fichas sem telefone em produção.
 */
describe('montarConsulta', () => {
  it('junta nome, categoria, bairro e cidade numa frase', () => {
    expect(
      montarConsulta({
        nome: 'Chácara Alvorada',
        categoria: 'Locais: salões, chácaras, hotéis, restaurantes, praia',
        bairro: 'Pium',
        cidade: 'Parnamirim',
        uf: 'RN',
      }),
    ).toBe('Chácara Alvorada, Locais: salões, chácaras, hotéis, restaurantes, praia, Pium, Parnamirim, RN');
  });

  it('cai para Natal/RN quando a ficha não tem cidade', () => {
    // 32 das 34 fichas sem telefone estão exatamente assim: só nome e categoria.
    expect(montarConsulta({ nome: 'Vybbe', categoria: 'Produtoras corporativas' })).toBe(
      'Vybbe, Produtoras corporativas, Natal, RN',
    );
  });

  it('a categoria entra porque o nome sozinho é ambíguo', () => {
    // "M3TA" e "Grupo Feeling" sem categoria devolvem qualquer coisa. Este teste
    // trava a decisão de sempre incluí-la.
    expect(montarConsulta({ nome: 'M3TA', categoria: 'Empresas de formatura' })).toContain(
      'Empresas de formatura',
    );
  });

  it('pula pedaço vazio, nulo ou só com espaço, sem deixar vírgula solta', () => {
    expect(
      montarConsulta({ nome: 'Perez Assessoria', categoria: null, bairro: '   ', cidade: 'Natal' }),
    ).toBe('Perez Assessoria, Natal, RN');
  });

  it('não inventa cidade quando a ficha tem uma', () => {
    expect(
      montarConsulta({ nome: 'Macamirim Eventos', cidade: 'Extremoz', uf: 'RN' }),
    ).toBe('Macamirim Eventos, Extremoz, RN');
  });
});
