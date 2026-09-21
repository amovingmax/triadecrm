import { describe, expect, it } from 'vitest';

import { aplicarResposta, atalhoEmDigitacao, respostasQueBatem } from './respostas-prontas';

const RESPOSTAS = [
  { id: 1, atalho: 'custo', titulo: 'Quanto custa', texto: 'É de graça.' },
  { id: 2, atalho: 'cadastro', titulo: 'Link do cadastro', texto: 'O cadastro leva 5 minutos.' },
];

describe('respostas prontas', () => {
  it('reconhece o "/" no começo ou depois de um espaço, e só no fim do texto', () => {
    expect(atalhoEmDigitacao('/cu')).toBe('cu');
    expect(atalhoEmDigitacao('Oi! /')).toBe('');
    expect(atalhoEmDigitacao('site.com/cu')).toBeNull();
    expect(atalhoEmDigitacao('/custo e mais')).toBeNull();
  });

  it('filtra pelo atalho e pelo nome', () => {
    expect(respostasQueBatem(RESPOSTAS, 'ca').map((r) => r.atalho)).toEqual(['cadastro']);
    expect(respostasQueBatem(RESPOSTAS, 'link').map((r) => r.atalho)).toEqual(['cadastro']);
    expect(respostasQueBatem(RESPOSTAS, '')).toHaveLength(2);
  });

  it('troca o atalho pelo texto, mantendo o que veio antes', () => {
    expect(aplicarResposta('Oi, Ana! /cus', RESPOSTAS[0]!)).toBe('Oi, Ana! É de graça.');
    expect(aplicarResposta('/', RESPOSTAS[1]!)).toBe('O cadastro leva 5 minutos.');
  });
});
