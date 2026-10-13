import { describe, expect, it } from 'vitest';

import { avisoDaExclusaoDoLote, recadoDoLote } from './lote-gestao';

describe('avisoDaExclusaoDoLote', () => {
  it('conta quem voltou para a base, no singular e no plural', () => {
    expect(avisoDaExclusaoDoLote(0)).toBe('Lote excluído.');
    expect(avisoDaExclusaoDoLote(1)).toBe('Lote excluído. 1 contato voltou para a base.');
    expect(avisoDaExclusaoDoLote(7)).toBe('Lote excluído. 7 contatos voltaram para a base.');
  });
});

describe('recadoDoLote', () => {
  it('toda recusa do banco tem frase, e a desconhecida não vaza código', () => {
    for (const motivo of [
      'sem_permissao',
      'item_inexistente',
      'lote_inexistente',
      'lote_encerrado',
      'em_ligacao',
      'fora_da_fila',
      'motivo_obrigatorio',
    ]) {
      expect(recadoDoLote(motivo)).not.toMatch(/servidor/);
    }
    expect(recadoDoLote('qualquer_coisa')).toBe(
      'Não deu para falar com o servidor. Tente de novo.',
    );
  });
});
