import { describe, expect, it } from 'vitest';

import {
  deslocarPeriodo,
  ehPeriodoAtual,
  ehPeriodoFuturo,
  fimDoPeriodo,
  hojeEmNatal,
  inicioDoPeriodo,
  rotuloDoPeriodo,
} from './periodo';

/**
 * A aritmética de período é a única conta que a tela de Metas faz sozinha, e ela
 * precisa dar o mesmo resultado que `app.goal_bounds` no Postgres: semana começando
 * na segunda, mês no dia 1. Se estes testes e o pgTAP discordarem, o SQL é a verdade.
 */

describe('inicioDoPeriodo', () => {
  it('dia é ele mesmo', () => {
    expect(inicioDoPeriodo('2026-09-04', 'day')).toBe('2026-09-04');
  });

  it('semana começa na segunda (sexta 04/09/2026 cai na semana de 31/08)', () => {
    expect(inicioDoPeriodo('2026-09-04', 'week')).toBe('2026-08-31');
  });

  it('segunda é o próprio início da semana', () => {
    expect(inicioDoPeriodo('2026-08-31', 'week')).toBe('2026-08-31');
  });

  it('domingo pertence à semana que começou na segunda anterior', () => {
    expect(inicioDoPeriodo('2026-09-06', 'week')).toBe('2026-08-31');
  });

  it('mês começa no dia 1', () => {
    expect(inicioDoPeriodo('2026-09-18', 'month')).toBe('2026-09-01');
  });
});

describe('fimDoPeriodo', () => {
  it('dia termina nele mesmo', () => {
    expect(fimDoPeriodo('2026-09-04', 'day')).toBe('2026-09-04');
  });

  it('semana termina no domingo', () => {
    expect(fimDoPeriodo('2026-08-31', 'week')).toBe('2026-09-06');
  });

  it('mês termina no último dia, inclusive em fevereiro bissexto', () => {
    expect(fimDoPeriodo('2026-09-01', 'month')).toBe('2026-09-30');
    expect(fimDoPeriodo('2028-02-01', 'month')).toBe('2028-02-29');
  });
});

describe('deslocarPeriodo', () => {
  it('anda um dia para trás atravessando o mês', () => {
    expect(deslocarPeriodo('2026-09-01', 'day', -1)).toBe('2026-08-31');
  });

  it('anda uma semana inteira, não sete dias soltos', () => {
    expect(deslocarPeriodo('2026-08-31', 'week', 1)).toBe('2026-09-07');
    expect(deslocarPeriodo('2026-08-31', 'week', -1)).toBe('2026-08-24');
  });

  it('anda de mês em mês sem escorregar no dia 31', () => {
    expect(deslocarPeriodo('2026-01-01', 'month', 1)).toBe('2026-02-01');
    expect(deslocarPeriodo('2026-03-01', 'month', -1)).toBe('2026-02-01');
    expect(deslocarPeriodo('2026-12-01', 'month', 1)).toBe('2027-01-01');
  });
});

describe('ehPeriodoAtual e ehPeriodoFuturo', () => {
  it('reconhece a semana de hoje', () => {
    expect(ehPeriodoAtual('2026-08-31', 'week', '2026-09-04')).toBe(true);
    expect(ehPeriodoAtual('2026-08-24', 'week', '2026-09-04')).toBe(false);
  });

  it('período que ainda não começou é futuro', () => {
    expect(ehPeriodoFuturo('2026-09-07', '2026-09-04')).toBe(true);
    expect(ehPeriodoFuturo('2026-09-04', '2026-09-04')).toBe(false);
  });
});

describe('rotuloDoPeriodo', () => {
  it('diz "Hoje" quando o dia é hoje e manda só o número para o mono', () => {
    const partes = rotuloDoPeriodo('2026-09-04', 'day', '2026-09-04');
    expect(partes.map((p) => p.texto).join('')).toBe('Hoje, sexta-feira, 04/09/2026');
    expect(partes.filter((p) => p.mono).map((p) => p.texto)).toEqual(['04/09/2026']);
  });

  it('capitaliza o dia da semana quando não é hoje', () => {
    const partes = rotuloDoPeriodo('2026-09-03', 'day', '2026-09-04');
    expect(partes.map((p) => p.texto).join('')).toBe('Quinta-feira, 03/09/2026');
  });

  it('escreve a semana de ponta a ponta', () => {
    const partes = rotuloDoPeriodo('2026-08-31', 'week', '2026-09-04');
    expect(partes.map((p) => p.texto).join('')).toBe('Semana de 31/08 a 06/09/2026');
  });

  it('escreve o mês por extenso com o ano em mono', () => {
    const partes = rotuloDoPeriodo('2026-09-01', 'month', '2026-09-04');
    expect(partes.map((p) => p.texto).join('')).toBe('Setembro de 2026');
    expect(partes.filter((p) => p.mono).map((p) => p.texto)).toEqual(['2026']);
  });
});

describe('hojeEmNatal', () => {
  it('devolve o dia de Natal, não o do fuso da máquina', () => {
    // 04/09/2026 às 02:00 UTC ainda é 03/09 em America/Fortaleza (UTC-3).
    expect(hojeEmNatal(new Date('2026-09-04T02:00:00Z'))).toBe('2026-09-03');
    expect(hojeEmNatal(new Date('2026-09-04T12:00:00Z'))).toBe('2026-09-04');
  });
});
