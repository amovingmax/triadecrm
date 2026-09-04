import { describe, expect, it } from 'vitest';

import { type CandidatoDaBase } from './consultas';
import { LENTE_LIMPA, calcularPrevia, lenteEstaLimpa, type LenteDaBase } from './lote-previa';

/**
 * A prévia é a única conta do módulo que roda fora do banco, e ela decide o que a
 * pessoa acredita antes de reservar 25 contatos. Os quatro testes abaixo protegem as
 * quatro afirmações que a tela faz:
 *
 * 1. quem entra é quem tem `motivo === null` dentro do recorte;
 * 2. a exclusão é contada por motivo, e só dentro do recorte;
 * 3. `entram` é o menor entre elegíveis e tamanho pedido — nunca o tamanho pedido;
 * 4. a lente NÃO encolhe `entram`, porque `montar_lote` não recebe bairro nem tempo
 *    parado. É a regra que impede a tela de prometer um lote que o banco não monta.
 */

let proximo = 0;

function candidato(parcial: Partial<CandidatoDaBase> = {}): CandidatoDaBase {
  proximo += 1;
  return {
    organizationId: `org-${proximo}`,
    nome: `Parceiro ${proximo}`,
    kind: 'fornecedor',
    temperatura: 'frio',
    categoriaIds: [1],
    categoriaNome: 'Buffet adulto/corporativo',
    cidade: 'Natal',
    bairro: 'Ponta Negra',
    temTelefone: true,
    tentativas: 0,
    diasSemContato: 90,
    motivo: null,
    ...parcial,
  };
}

const RECORTE_FRIO = { temperaturas: ['frio' as const], categoriaIds: [] };

describe('calcularPrevia', () => {
  it('conta como elegível só quem não tem motivo de exclusão', () => {
    const base = [
      candidato(),
      candidato(),
      candidato({ motivo: 'sem_telefone', temTelefone: false }),
      candidato({ motivo: 'reservado_em_outro_lote' }),
    ];

    const previa = calcularPrevia(base, RECORTE_FRIO, LENTE_LIMPA, 25);

    expect(previa.noRecorte).toBe(4);
    expect(previa.elegiveis).toBe(2);
    expect(previa.entram).toBe(2);
    expect(previa.excluidos).toEqual([
      { motivo: 'sem_telefone', quantos: 1 },
      { motivo: 'reservado_em_outro_lote', quantos: 1 },
    ]);
  });

  it('não conta exclusão de quem está fora do recorte', () => {
    const base = [
      candidato(),
      // Mesmo motivo, outra temperatura: não é problema deste lote e não entra na conta.
      candidato({ temperatura: 'quente', motivo: 'sem_telefone' }),
      // Mesmo motivo, outra categoria.
      candidato({ categoriaIds: [9], motivo: 'sem_telefone' }),
    ];

    const previa = calcularPrevia(
      base,
      { temperaturas: ['frio'], categoriaIds: [1] },
      LENTE_LIMPA,
      25,
    );

    expect(previa.noRecorte).toBe(1);
    expect(previa.excluidos).toEqual([]);
  });

  it('mostra a mistura de temperatura em linhas separadas, para a tela poder recusá-la', () => {
    const base = [
      candidato(),
      candidato(),
      candidato({ temperatura: 'quente' }),
      candidato({ temperatura: 'morno', motivo: 'nao_contatar' }),
    ];

    const previa = calcularPrevia(
      base,
      { temperaturas: ['frio', 'quente', 'morno'], categoriaIds: [] },
      LENTE_LIMPA,
      25,
    );

    expect(previa.porTemperatura).toEqual([
      { temperatura: 'frio', quantos: 2 },
      { temperatura: 'quente', quantos: 1 },
    ]);
  });

  it('nunca promete mais do que o tamanho pedido', () => {
    const base = Array.from({ length: 40 }, () => candidato());

    expect(calcularPrevia(base, RECORTE_FRIO, LENTE_LIMPA, 25).entram).toBe(25);
    expect(calcularPrevia(base, RECORTE_FRIO, LENTE_LIMPA, 60).entram).toBe(40);
  });

  it('a lente muda a leitura, nunca o que o banco vai reservar', () => {
    const base = [
      candidato({ bairro: 'Ponta Negra' }),
      candidato({ bairro: 'Alecrim' }),
      candidato({ bairro: 'Alecrim' }),
    ];
    const lente: LenteDaBase = { ...LENTE_LIMPA, bairros: ['Alecrim'] };

    const previa = calcularPrevia(base, RECORTE_FRIO, lente, 25);

    expect(previa.elegiveis).toBe(3);
    expect(previa.entram).toBe(3);
    expect(previa.naLente).toBe(2);
    expect(previa.amostra).toHaveLength(2);
    expect(previa.porBairro).toEqual([{ rotulo: 'Alecrim', quantos: 2 }]);
  });

  it('a lente de tempo parado deixa passar quem nunca teve contato nenhum', () => {
    const base = [
      candidato({ diasSemContato: null }),
      candidato({ diasSemContato: 5 }),
      candidato({ diasSemContato: 40 }),
    ];

    const previa = calcularPrevia(base, RECORTE_FRIO, { ...LENTE_LIMPA, paradoHaDias: 30 }, 25);

    expect(previa.naLente).toBe(2);
  });
});

describe('lenteEstaLimpa', () => {
  it('reconhece a lente sem nenhum recorte', () => {
    expect(lenteEstaLimpa(LENTE_LIMPA)).toBe(true);
    expect(lenteEstaLimpa({ ...LENTE_LIMPA, telefone: 'sem' })).toBe(false);
    expect(lenteEstaLimpa({ ...LENTE_LIMPA, tentativasAte: 0 })).toBe(false);
  });
});
