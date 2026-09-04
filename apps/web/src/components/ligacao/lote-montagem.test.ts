import { describe, expect, it } from 'vitest';

import { nomeSugerido, pluralDaPalavra, sujeitoDoLote } from './lote-montagem';

/**
 * O nome sugerido do lote é a primeira frase que quem liga lê de manhã, e ela vinha
 * com erro de concordância: "Fornecedor frios — sexta". O nome do funil descreve UMA
 * captação de UM tipo de parceiro ("Captação de fornecedor"); o lote é um punhado de
 * gente, e o adjetivo de temperatura é sempre plural.
 */
describe('nome sugerido do lote', () => {
  it('pluraliza o funil e concorda com a temperatura', () => {
    expect(nomeSugerido({ id: 1, slug: 'fornecedor', nome: 'Captação de fornecedor' }, ['frio'], 'sexta-feira')).toBe(
      'Fornecedores frios — sexta',
    );
  });

  it('concorda no masculino quando um dos núcleos é masculino', () => {
    expect(
      nomeSugerido({ id: 3, slug: 'produtor', nome: 'Produtor e cerimonialista' }, ['morno'], 'quinta-feira'),
    ).toBe('Produtores e cerimonialistas mornos — quinta');
  });

  it('concorda no feminino quando todos os núcleos são femininos', () => {
    expect(nomeSugerido({ id: 9, slug: 'noiva', nome: 'Captação de noiva' }, ['frio'], 'segunda-feira')).toBe(
      'Noivas frias — segunda',
    );
  });

  it('sem funil escolhido, ainda entrega um nome legível', () => {
    expect(nomeSugerido(null, ['quente'], 'sábado')).toBe('Parceiros quentes — sábado');
  });

  it('mistura de temperaturas não vira adjetivo nenhum', () => {
    expect(
      nomeSugerido({ id: 1, slug: 'fornecedor', nome: 'Captação de fornecedor' }, ['frio', 'morno'], 'terça-feira'),
    ).toBe('Fornecedores — terça');
  });

  it('cabe no limite de 60 caracteres do formulário', () => {
    const nome = nomeSugerido({ id: 3, slug: 'produtor', nome: 'Produtor e cerimonialista' }, ['quente'], 'quarta-feira');
    expect(nome.length).toBeLessThanOrEqual(60);
  });
});

describe('plural das palavras que aparecem em nome de funil', () => {
  it.each([
    ['fornecedor', 'fornecedores'],
    ['produtor', 'produtores'],
    ['cerimonialista', 'cerimonialistas'],
    ['buffet', 'buffets'],
    ['parceiros', 'parceiros'],
    ['casal', 'casais'],
    ['perfil', 'perfis'],
    ['homem', 'homens'],
    ['salão', 'salões'],
  ])('%s → %s', (palavra, esperado) => {
    expect(pluralDaPalavra(palavra)).toBe(esperado);
  });
});

describe('sujeito do lote', () => {
  it('tira o prefixo "Captação de" e devolve o gênero para a concordância', () => {
    expect(sujeitoDoLote('Captação de fornecedor')).toEqual({
      texto: 'Fornecedores',
      feminino: false,
    });
  });
});
