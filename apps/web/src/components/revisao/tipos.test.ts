import { describe, expect, it } from 'vitest';

import { diasAteSumir, PRAZO_DE_RETENCAO_DIAS } from './tipos';

/**
 * A retenção do PRD §10.6 apaga candidato em "novo" aos 90 dias de `created_at`
 * (`app.aplicar_retencao`, cron às 04:00 de Fortaleza). É regra de LGPD e é
 * certa — mas até hoje ela não aparecia em lugar nenhum da tela, e a única
 * forma de não perder um alvo é decidir antes. Uma fila que não diz que expira
 * é um cemitério com aparência de trabalho.
 */
describe('diasAteSumir', () => {
  it('conta os dias que faltam para a retenção apagar o candidato', () => {
    const hoje = new Date('2026-09-25T12:00:00-03:00');
    expect(diasAteSumir('2026-09-17T10:00:00-03:00', hoje)).toBe(82);
    expect(diasAteSumir('2026-09-25T10:00:00-03:00', hoje)).toBe(PRAZO_DE_RETENCAO_DIAS);
  });

  it('nunca devolve negativo: a rodada do cron é diária, e pode atrasar', () => {
    const hoje = new Date('2027-01-01T12:00:00-03:00');
    expect(diasAteSumir('2026-09-17T10:00:00-03:00', hoje)).toBe(0);
  });

  it('data ilegível não vira alarme', () => {
    expect(diasAteSumir(null, new Date())).toBeNull();
    expect(diasAteSumir('nem data é', new Date())).toBeNull();
  });
});
