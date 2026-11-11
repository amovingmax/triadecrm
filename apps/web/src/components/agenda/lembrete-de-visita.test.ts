import { describe, expect, it } from 'vitest';

import {
  lembretesPorTarefa,
  respostaDoLembrete,
  ROTULO_DA_RESPOSTA,
  type LinhaDoLembrete,
} from './lembrete-de-visita';

const linha = (parcial: Partial<LinhaDoLembrete>): LinhaDoLembrete => ({
  task_id: 't1',
  marcada_para: '2027-03-05T17:00:00+00:00',
  resposta: null,
  ...parcial,
});

describe('respostaDoLembrete', () => {
  it('"Confirmo" no horário de agora vira "Cliente confirmou"', () => {
    const resposta = respostaDoLembrete('2027-03-05T14:00:00-03:00', [
      linha({ resposta: 'confirmou' }),
    ]);
    expect(resposta).toBe('confirmou');
    expect(resposta && ROTULO_DA_RESPOSTA[resposta]).toBe('Cliente confirmou');
  });

  it('"Preciso remarcar" vira "Pediu para remarcar"', () => {
    const resposta = respostaDoLembrete('2027-03-05T17:00:00.000Z', [
      linha({ resposta: 'remarcar' }),
    ]);
    expect(resposta && ROTULO_DA_RESPOSTA[resposta]).toBe('Pediu para remarcar');
  });

  it('compara o instante, não o texto: +00:00, -03:00 e Z são o mesmo horário', () => {
    expect(
      respostaDoLembrete('2027-03-05T14:00:00-03:00', [linha({ resposta: 'confirmou' })]),
    ).toBe('confirmou');
  });

  it('remarcou a visita: a resposta do horário velho não vale para o novo', () => {
    expect(
      respostaDoLembrete('2027-03-05T15:30:00-03:00', [
        linha({ marcada_para: '2027-03-05T17:00:00+00:00', resposta: 'confirmou' }),
        linha({ marcada_para: '2027-03-05T18:30:00+00:00', resposta: null }),
      ]),
    ).toBeNull();
  });

  it('o lembrete do horário novo respondido vale, mesmo com o velho na lista', () => {
    expect(
      respostaDoLembrete('2027-03-05T15:30:00-03:00', [
        linha({ marcada_para: '2027-03-05T17:00:00+00:00', resposta: 'remarcar' }),
        linha({ marcada_para: '2027-03-05T18:30:00+00:00', resposta: 'confirmou' }),
      ]),
    ).toBe('confirmou');
  });

  it('sem lembrete, sem resposta ou com resposta desconhecida, não há selo', () => {
    expect(respostaDoLembrete('2027-03-05T14:00:00-03:00', [])).toBeNull();
    expect(respostaDoLembrete('2027-03-05T14:00:00-03:00', [linha({})])).toBeNull();
    expect(
      respostaDoLembrete('2027-03-05T14:00:00-03:00', [linha({ resposta: 'talvez' })]),
    ).toBeNull();
    expect(respostaDoLembrete('não é data', [linha({ resposta: 'confirmou' })])).toBeNull();
  });
});

describe('lembretesPorTarefa', () => {
  it('agrupa as linhas pela tarefa', () => {
    const grupos = lembretesPorTarefa([
      linha({ task_id: 'a' }),
      linha({ task_id: 'b' }),
      linha({ task_id: 'a', marcada_para: '2027-03-05T18:30:00+00:00' }),
    ]);
    expect(grupos.get('a')).toHaveLength(2);
    expect(grupos.get('b')).toHaveLength(1);
    expect(grupos.get('c')).toBeUndefined();
  });
});
