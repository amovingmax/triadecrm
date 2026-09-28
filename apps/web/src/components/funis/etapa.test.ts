import { describe, expect, it } from 'vitest';

import { preenchimentoDaEtapa, rotuloDaEtapa } from './etapa';

describe('a etapa na tela', () => {
  it('mostra o nome da etapa como veio do banco', () => {
    expect(rotuloDaEtapa('Respondeu')).toBe('Respondeu');
  });

  it('diz "Sem etapa" quando o negócio ainda não tem funil', () => {
    expect(rotuloDaEtapa(null)).toBe('Sem etapa');
    expect(rotuloDaEtapa('   ')).toBe('Sem etapa');
  });

  it('a barra enche proporcionalmente à posição, no funil de fornecedor (9 de trabalho)', () => {
    expect(preenchimentoDaEtapa(1, 9)).toBeCloseTo(1 / 9);
    expect(preenchimentoDaEtapa(9, 9)).toBe(1);
  });

  it('e no de produtor, que tem 11 — o denominador é do funil, não uma constante', () => {
    expect(preenchimentoDaEtapa(9, 11)).toBeCloseTo(9 / 11);
    expect(preenchimentoDaEtapa(11, 11)).toBe(1);
  });

  it('etapa de saída (90, 98, 99) não finge progresso', () => {
    // Nutrição, Perdido e Opt-out são destino, não avanço: a barra fica vazia.
    expect(preenchimentoDaEtapa(90, 9)).toBe(0);
    expect(preenchimentoDaEtapa(98, 9)).toBe(0);
    expect(preenchimentoDaEtapa(99, 11)).toBe(0);
  });

  it('total zero ou desconhecido não estoura nem preenche', () => {
    expect(preenchimentoDaEtapa(3, 0)).toBe(0);
    expect(preenchimentoDaEtapa(null, 9)).toBe(0);
  });
});
