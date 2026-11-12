import { describe, expect, it } from 'vitest';

import { EMPRESAS } from '@komune/schema/empresas';

import { definicaoNaEmpresa, maiuscula, metricaNaEmpresa, VOCABULARIO } from './vocabulario';

const DO_BANCO = {
  rotulo: 'Portas batidas',
  fonte: 'activities com desfecho do catálogo; máx. 1 por alvo por dia',
};

describe('vocabulário da empresa', () => {
  it('sem empresa no ambiente é a KOMUNE, com as palavras de sempre', () => {
    expect(VOCABULARIO.parceiro).toBe('parceiro');
    expect(maiuscula(VOCABULARIO.parceiro)).toBe('Parceiro');
  });

  it('na KOMUNE a métrica fica com o rótulo e a fonte do banco', () => {
    expect(metricaNaEmpresa('doors_knocked', DO_BANCO, EMPRESAS.komune.vocabulario)).toEqual(
      DO_BANCO,
    );
    expect(definicaoNaEmpresa('doors_knocked', EMPRESAS.komune.vocabulario)).toBeNull();
  });

  it('na Imova a porta batida vira contato feito, e a métrica sem troca fica como veio', () => {
    const imova = EMPRESAS.imova.vocabulario;
    expect(metricaNaEmpresa('doors_knocked', DO_BANCO, imova)).toEqual({
      rotulo: 'Contatos feitos',
      fonte: 'activities com desfecho do catálogo; máx. 1 por cliente ou proprietário por dia',
    });
    expect(metricaNaEmpresa('calls_made', { rotulo: 'Ligações', fonte: 'x' }, imova)).toEqual({
      rotulo: 'Ligações',
      fonte: 'x',
    });
    expect(definicaoNaEmpresa('replies', imova)).toBe('Mensagens que o cliente respondeu.');
  });
});
