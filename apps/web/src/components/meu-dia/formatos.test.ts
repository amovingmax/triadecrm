import { describe, expect, it } from 'vitest';

import { dataPorExtenso, formatarQuando, primeiroNome, saudacaoDoDia } from './formatos';
import type { ItemDoDia } from './tipos';

/**
 * Duas coisas são travadas aqui. A primeira é o fuso: o dia de trabalho é o de Natal,
 * e o aparelho pode estar em qualquer lugar — 03:00 UTC ainda é a noite anterior em
 * `America/Fortaleza`. A segunda é a separação da frase: só o dígito pode receber a
 * IBM Plex Mono, como manda a direção visual.
 */

function item(parcial: Partial<ItemDoDia>): ItemDoDia {
  return {
    prioridade: 3,
    tipo: 'tarefa_atrasada',
    motivo: 'Tarefa vencida',
    titulo: 'Ligar D+1',
    quando: null,
    atrasoHoras: null,
    tarefaId: null,
    atividadeId: null,
    negocioId: null,
    organizacaoId: 'org-1',
    organizacao: 'Buffet Alvorada',
    bairro: null,
    categoria: null,
    temperatura: 'morno',
    funil: null,
    etapa: null,
    ...parcial,
  };
}

describe('saudacaoDoDia', () => {
  it('lê a hora em Natal, não a do aparelho', () => {
    // 03:00 UTC = 00:00 em America/Fortaleza: à meia-noite ninguém diz bom dia.
    expect(saudacaoDoDia(new Date('2026-09-04T03:00:00Z'))).toBe('Boa noite');
    // 09:00 UTC = 06:00 em Natal: aí sim.
    expect(saudacaoDoDia(new Date('2026-09-04T09:00:00Z'))).toBe('Bom dia');
    // 12:00 UTC = 09:00 em Natal.
    expect(saudacaoDoDia(new Date('2026-09-04T12:00:00Z'))).toBe('Bom dia');
    // 18:00 UTC = 15:00 em Natal.
    expect(saudacaoDoDia(new Date('2026-09-04T18:00:00Z'))).toBe('Boa tarde');
    // 23:00 UTC = 20:00 em Natal.
    expect(saudacaoDoDia(new Date('2026-09-04T23:00:00Z'))).toBe('Boa noite');
  });
});

describe('dataPorExtenso', () => {
  it('escreve o dia civil de Natal, com maiúscula', () => {
    expect(dataPorExtenso(new Date('2026-09-04T12:00:00Z'))).toBe('Sexta-feira, 4 de setembro');
  });
});

describe('primeiroNome', () => {
  it('devolve só o primeiro nome, e string vazia quando não há nome', () => {
    expect(primeiroNome('Heloísa Cavalcanti')).toBe('Heloísa');
    expect(primeiroNome('  ')).toBe('');
    expect(primeiroNome(null)).toBe('');
  });
});

describe('formatarQuando', () => {
  it('põe em mono só o dígito do atraso, nunca a preposição nem a unidade', () => {
    const meiaHora = formatarQuando(item({ atrasoHoras: 0.5 }));
    expect(meiaHora).toMatchObject({ prefixo: 'há ', numero: '30', sufixo: ' min', atencao: true });

    const duasHoras = formatarQuando(item({ atrasoHoras: 2.1 }));
    expect(duasHoras).toMatchObject({ prefixo: 'há ', numero: '2', sufixo: ' h' });

    const tresDias = formatarQuando(item({ atrasoHoras: 74 }));
    expect(tresDias).toMatchObject({ prefixo: 'há ', numero: '3', sufixo: ' d' });
  });

  it('nunca arredonda um atraso curto para zero', () => {
    expect(formatarQuando(item({ atrasoHoras: 0.001 })).numero).toBe('1');
  });

  it('diz "sem prazo" em vez de mostrar um vazio', () => {
    expect(formatarQuando(item({ quando: null }))).toMatchObject({
      prefixo: 'sem prazo',
      numero: null,
      atencao: false,
    });
  });

  it('mostra a hora de Natal quando o compromisso é hoje', () => {
    const agora = new Date('2026-09-04T12:00:00Z');
    const quando = formatarQuando(
      item({ tipo: 'reuniao_proxima', quando: '2026-09-04T17:30:00Z' }),
      agora,
    );
    expect(quando.numero).toBe('14:30');
    expect(quando.atencao).toBe(true);
  });

  it('escreve "amanhã" por extenso e a data curta a partir de depois de amanhã', () => {
    const agora = new Date('2026-09-04T12:00:00Z');
    expect(formatarQuando(item({ quando: '2026-09-05T12:00:00Z' }), agora)).toMatchObject({
      prefixo: 'amanhã',
      numero: null,
    });
    expect(formatarQuando(item({ quando: '2026-09-08T12:00:00Z' }), agora).numero).toBe('08/09');
  });
});
