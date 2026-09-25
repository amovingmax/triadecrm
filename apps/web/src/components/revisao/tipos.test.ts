import { describe, expect, it } from 'vitest';

import {
  diasAteSumir,
  EXPLICACAO_DA_MARCA,
  MARCAS_QUE_O_BANCO_ESCREVE,
  PRAZO_DE_RETENCAO_DIAS,
} from './tipos';

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

/**
 * O cartão renderiza `{nota?.rotulo ?? marca}` (`cartao-candidato.tsx:318`).
 * Marca sem entrada no dicionário vira nome interno na tela — foi assim que
 * quem importou os 20 buffets leu "⚠ ja_existe_na_base", e em 25/09/2026
 * `mudou_na_fonte` ainda estava de fora pelo mesmo motivo.
 */
describe('EXPLICACAO_DA_MARCA', () => {
  it('cobre toda marca que o banco sabe escrever', () => {
    const semTexto = MARCAS_QUE_O_BANCO_ESCREVE.filter((m) => !EXPLICACAO_DA_MARCA[m]);
    expect(semTexto).toEqual([]);
  });

  it('nenhum rótulo é o nome interno da marca', () => {
    for (const marca of MARCAS_QUE_O_BANCO_ESCREVE) {
      expect(EXPLICACAO_DA_MARCA[marca]!.rotulo).not.toContain('_');
      expect(EXPLICACAO_DA_MARCA[marca]!.explicacao.length).toBeGreaterThan(20);
    }
  });
});
