import { describe, expect, it } from 'vitest';

import { avisoDaConsultoria, recadoDaConsultoria } from './consultoria';

describe('o aviso do botão da Consultoria (14/10/2026)', () => {
  it('conta quantos entraram ou saíram', () => {
    expect(avisoDaConsultoria(true, 1, 1)).toBe('Na Consultoria.');
    expect(avisoDaConsultoria(true, 5, 3)).toBe('3 parceiros na Consultoria.');
    expect(avisoDaConsultoria(false, 1, 1)).toBe('Saiu da Consultoria.');
    expect(avisoDaConsultoria(false, 4, 4)).toBe('4 parceiros saíram da Consultoria.');
  });

  it('diz quando nada mudou, em vez de fingir que mudou', () => {
    expect(avisoDaConsultoria(true, 1, 0)).toBe('Já estava na Consultoria.');
    expect(avisoDaConsultoria(true, 3, 0)).toBe('Todos já estavam na Consultoria.');
    expect(avisoDaConsultoria(false, 1, 0)).toBe('Não estava na Consultoria.');
  });

  it('a recusa do banco vira frase, e o desconhecido vira "tente de novo"', () => {
    expect(recadoDaConsultoria('sem_permissao')).toMatch(/admin e gestor/);
    expect(recadoDaConsultoria('muitos_de_uma_vez')).toMatch(/200/);
    expect(recadoDaConsultoria('qualquer_coisa')).toMatch(/Tente de novo/);
  });
});
