import { describe, expect, it } from 'vitest';

import {
  escaparCuringas,
  normalizarBusca,
  ordenarCandidatos,
  pontuarNome,
  trechosDestacados,
} from './autocompletar';

describe('autocompletar de parceiro', () => {
  it('normaliza como o search_name do banco: sem acento, minúsculo, espaços colapsados', () => {
    expect(normalizarBusca('  Jôsy   BUFFET ')).toBe('josy buffet');
    expect(normalizarBusca('Decoração')).toBe('decoracao');
  });

  it('pontua do começo do nome para o meio da palavra', () => {
    expect(pontuarNome('Buffet Sabor', 'buf')).toBe(0);
    expect(pontuarNome('Anne Vieira Buffet e Eventos', 'buf')).toBe(1);
    expect(pontuarNome('Espetto & Grill', 'grill')).toBe(1);
    expect(pontuarNome('Churrascaria', 'rasca')).toBe(2);
    expect(pontuarNome('Castelo Forte', '84999')).toBe(3);
    expect(pontuarNome('Jôsy Buffet', 'JOSY')).toBe(0);
  });

  it('junta as duas buscas sem repetir e põe o casamento pelo nome na frente', () => {
    const daBusca = [
      { id: 'tel', nome: 'Castelo Forte' }, // achado pelo telefone
      { id: 'anne', nome: 'Anne Vieira Buffet' },
    ];
    const doTrecho = [
      { id: 'anne', nome: 'Anne Vieira Buffet' },
      { id: 'buf', nome: 'Buffet Sabor' },
      { id: 'meio', nome: 'Superbuffet' },
    ];
    expect(ordenarCandidatos('buf', daBusca, doTrecho, 8)).toEqual(['buf', 'anne', 'meio', 'tel']);
    expect(ordenarCandidatos('buf', daBusca, doTrecho, 2)).toEqual(['buf', 'anne']);
  });

  it('destaca o trecho que casou mantendo o nome original, com acento', () => {
    expect(trechosDestacados('Jôsy Buffet', 'josy')).toEqual([
      { texto: 'Jôsy', destaque: true },
      { texto: ' Buffet', destaque: false },
    ]);
    expect(trechosDestacados('Anne Vieira Buffet', 'buf')).toEqual([
      { texto: 'Anne Vieira ', destaque: false },
      { texto: 'Buf', destaque: true },
      { texto: 'fet', destaque: false },
    ]);
    expect(trechosDestacados('Castelo Forte', '8499')).toEqual([
      { texto: 'Castelo Forte', destaque: false },
    ]);
  });

  it('trata % e _ como texto no ilike', () => {
    expect(escaparCuringas('50%_off')).toBe('50\\%\\_off');
  });
});
