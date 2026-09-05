import { describe, expect, it } from 'vitest';

import {
  agendaEmPortugues,
  atrasoEmTexto,
  dataCompleta,
  diaPorExtenso,
  hora,
  vistoHa,
} from './formatos';

/**
 * O que estes testes travam:
 *
 * 1. **O fuso.** O dia de trabalho é o de Natal e o aparelho pode estar em qualquer
 *    lugar. Um instante às 02:00 UTC ainda é a noite anterior em `America/Fortaleza`,
 *    e o dia civil que o banco devolve (`YYYY-MM-DD`) não pode escorregar para o dia
 *    anterior quando o navegador está a oeste — que é exatamente o que acontece se
 *    alguém interpretar a string como instante local.
 *
 * 2. **A ausência.** Data nula tem de virar travessão, e não "Invalid Date"; worker
 *    que nunca bateu ponto tem de virar "nunca", que é diferente de "faz muito tempo".
 *
 * 3. **A tradução do cron.** Uma agenda traduzida errado é pior do que a expressão
 *    crua: o que este arquivo não reconhecer sai como veio.
 */

describe('hora', () => {
  it('escreve a hora de Natal, não a do aparelho', () => {
    // 13:00 UTC = 10:00 em America/Fortaleza (UTC-3, sem horário de verão).
    expect(hora('2026-09-05T13:00:00Z')).toBe('10:00');
  });

  it('atravessa a meia-noite para o lado certo', () => {
    // 01:30 UTC do dia 6 ainda é 22:30 do dia 5 em Natal.
    expect(hora('2026-09-06T01:30:00Z')).toBe('22:30');
  });

  it('devolve travessão sem data, e sem data inválida', () => {
    expect(hora(null)).toBe('—');
    expect(hora('nem data isso é')).toBe('—');
  });
});

describe('dataCompleta', () => {
  it('escreve dia da semana, data e hora de Natal', () => {
    expect(dataCompleta('2026-09-05T13:00:00Z')).toContain('05/09');
    expect(dataCompleta('2026-09-05T13:00:00Z')).toContain('10:00');
  });

  it('diz "sem data" em vez de quebrar', () => {
    expect(dataCompleta(null)).toBe('sem data');
    expect(dataCompleta('')).toBe('sem data');
  });
});

describe('diaPorExtenso', () => {
  it('não escorrega para o dia anterior', () => {
    // O dia civil vem do Postgres já recortado; ancorar no meio-dia de Natal impede
    // que um navegador a oeste leia "4 de setembro".
    // 05/09/2026 é sábado (o D1 do calendário do PRD é sexta 04/09).
    expect(diaPorExtenso('2026-09-05')).toBe('Sábado, 5 de setembro');
    expect(diaPorExtenso('2026-09-04')).toBe('Sexta-feira, 4 de setembro');
  });

  it('devolve a string crua quando não é data', () => {
    expect(diaPorExtenso('hoje')).toBe('hoje');
  });
});

describe('atrasoEmTexto', () => {
  it('vira minutos abaixo de uma hora', () => {
    expect(atrasoEmTexto(0.5)).toBe('há 30 min');
  });

  it('vira horas até 48 h — o mesmo corte que o meu_dia usa no motivo', () => {
    expect(atrasoEmTexto(5.4)).toBe('há 5 h');
    // 40 h é a linha real da base: o banco escreve "Tarefa vencida há 40 h".
    expect(atrasoEmTexto(40)).toBe('há 40 h');
  });

  it('arredonda o dia para bater com o "há N dia(s)" que o banco escreve ao lado', () => {
    // 448 h é a linha real da base: `meu_dia` diz "vencida há 19 dia(s)" (dias civis).
    // Truncar daria 18 e a mesma linha teria dois números para a mesma coisa.
    expect(atrasoEmTexto(448)).toBe('há 19 d');
    expect(atrasoEmTexto(208)).toBe('há 9 d');
  });

  it('aceita a string que o PostgREST manda para numeric', () => {
    expect(atrasoEmTexto('232.0')).toBe('há 10 d');
  });

  it('some quando não há atraso', () => {
    expect(atrasoEmTexto(null)).toBeNull();
    expect(atrasoEmTexto(0)).toBeNull();
    expect(atrasoEmTexto(-3)).toBeNull();
  });
});

describe('vistoHa', () => {
  const agora = new Date('2026-09-05T13:00:00Z');

  it('diz "nunca" quando ninguém bateu ponto', () => {
    expect(vistoHa(null, agora)).toBe('nunca');
  });

  it('conta minutos, horas e dias', () => {
    expect(vistoHa('2026-09-05T12:57:00Z', agora)).toBe('há 3 min');
    expect(vistoHa('2026-09-05T09:00:00Z', agora)).toBe('há 4 h');
    expect(vistoHa('2026-09-03T13:00:00Z', agora)).toBe('há 2 d');
  });
});

describe('agendaEmPortugues', () => {
  it('traduz o intervalo do agendador das cadências', () => {
    expect(agendaEmPortugues('*/15 * * * *')).toBe('a cada 15 minutos');
  });

  it('traduz o horário fixo do encerramento por silêncio', () => {
    expect(agendaEmPortugues('0 10 * * *')).toBe('todo dia às 10:00');
  });

  it('devolve a expressão crua quando não reconhece', () => {
    expect(agendaEmPortugues('0 0 * * 1')).toBe('0 0 * * 1');
  });
});
