import { describe, expect, it } from 'vitest';

import {
  diasDoPeriodo,
  diasNoPeriodo,
  faixaDoPeriodo,
  formatarDia,
  hojeEmNatal,
  periodoDaUrl,
  periodoDe,
  periodoValido,
  somarDias,
  urlDoRecorte,
} from './periodo';

/** D1 do calendário do MVP: sexta, 04/09/2026. */
const HOJE = '2026-09-04';

describe('periodoDe', () => {
  it('conta os 7 dias incluindo hoje', () => {
    expect(periodoDe('sete', HOJE)).toEqual({ chave: 'sete', de: '2026-08-29', ate: HOJE });
  });

  it('conta os 30 dias incluindo hoje', () => {
    expect(periodoDe('trinta', HOJE)).toEqual({ chave: 'trinta', de: '2026-08-06', ate: HOJE });
  });

  it('este mês vai do dia 1 até hoje', () => {
    expect(periodoDe('mes', HOJE)).toEqual({ chave: 'mes', de: '2026-09-01', ate: HOJE });
  });

  it('mês passado é o mês inteiro, não os últimos 30 dias', () => {
    expect(periodoDe('mes_passado', HOJE)).toEqual({
      chave: 'mes_passado',
      de: '2026-08-01',
      ate: '2026-08-31',
    });
  });

  it('personalizado preserva as datas que a pessoa já tinha escolhido', () => {
    const atual = { chave: 'personalizado' as const, de: '2026-07-01', ate: '2026-07-15' };
    expect(periodoDe('personalizado', HOJE, atual)).toEqual(atual);
  });
});

describe('contas de calendário', () => {
  it('soma e subtrai dias sem escorregar de mês', () => {
    expect(somarDias('2026-08-31', 1)).toBe('2026-09-01');
    expect(somarDias('2026-09-01', -1)).toBe('2026-08-31');
  });

  it('conta as duas pontas do período', () => {
    expect(diasNoPeriodo({ chave: 'sete', de: '2026-08-29', ate: '2026-09-04' })).toBe(7);
    expect(diasNoPeriodo({ chave: 'personalizado', de: HOJE, ate: HOJE })).toBe(1);
  });

  it('lista os dias do período em ordem', () => {
    const dias = diasDoPeriodo({ chave: 'personalizado', de: '2026-09-01', ate: '2026-09-04' });
    expect(dias).toEqual(['2026-09-01', '2026-09-02', '2026-09-03', '2026-09-04']);
  });

  it('formata a data no jeito brasileiro sem passar por Date', () => {
    expect(formatarDia(HOJE)).toBe('04/09/2026');
    expect(faixaDoPeriodo({ chave: 'sete', de: '2026-08-29', ate: HOJE })).toBe(
      '29/08/2026 a 04/09/2026',
    );
  });

  it('hoje sai no formato do banco', () => {
    expect(hojeEmNatal()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe('periodoValido', () => {
  it('recusa data final antes da inicial', () => {
    expect(periodoValido({ chave: 'personalizado', de: '2026-09-10', ate: '2026-09-01' })).toBe(
      false,
    );
  });

  it('recusa data incompleta, que é o que o campo devolve enquanto se digita', () => {
    expect(periodoValido({ chave: 'personalizado', de: '', ate: HOJE })).toBe(false);
  });

  it('aceita um único dia', () => {
    expect(periodoValido({ chave: 'personalizado', de: HOJE, ate: HOJE })).toBe(true);
  });
});

describe('periodoDaUrl', () => {
  it('lê o par de datas de um link compartilhado', () => {
    expect(periodoDaUrl({ de: '2026-08-01', ate: '2026-08-31' }, HOJE)).toEqual({
      chave: 'personalizado',
      de: '2026-08-01',
      ate: '2026-08-31',
    });
  });

  it('lê a opção nomeada', () => {
    expect(periodoDaUrl({ periodo: 'sete' }, HOJE).de).toBe('2026-08-29');
  });

  it('cai nos 30 dias quando a URL não faz sentido', () => {
    expect(periodoDaUrl({ periodo: 'ontem', de: 'ontem' }, HOJE)).toEqual({
      chave: 'trinta',
      de: '2026-08-06',
      ate: HOJE,
    });
  });
});

describe('urlDoRecorte', () => {
  it('grava a opção nomeada, e não as datas', () => {
    expect(urlDoRecorte(periodoDe('sete', HOJE), 'funil')).toBe('?painel=funil&periodo=sete');
  });

  it('grava as datas quando o período é escolhido a dedo', () => {
    expect(
      urlDoRecorte({ chave: 'personalizado', de: '2026-08-01', ate: '2026-08-31' }, 'bairros'),
    ).toBe('?painel=bairros&de=2026-08-01&ate=2026-08-31');
  });
});
