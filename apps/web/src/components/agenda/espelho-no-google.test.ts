import { describe, expect, it } from 'vitest';

import {
  fraseDoEspelho,
  horaFalada,
  lerEstadoDoEspelho,
  motivoDoErro,
  type EstadoDoEspelho,
} from './espelho-no-google';

/**
 * O cartão "Espelho no Google" (11/11/2026): a frase certa para cada estado,
 * na ordem do que mais pede ação — desligado, com erro, parado, ligado.
 */

// 11/11/2026, 15h em Natal (18h UTC).
const AGORA = new Date('2026-11-11T18:00:00Z');

const LIGADO: EstadoDoEspelho = {
  idPreenchido: true,
  workerPassando: true,
  workerPassouEm: '2026-11-11T17:59:30Z',
  pessoa: 'Rafael',
  pendentes: 0,
  gravados: 12,
  feriados: 3,
  comErro: 0,
  ultimoGravadoEm: '2026-11-11T17:10:00Z',
  ultimoErro: null,
};

describe('lerEstadoDoEspelho', () => {
  it('lê a resposta do banco', () => {
    expect(
      lerEstadoDoEspelho({
        ligado: true,
        google_agenda_id_preenchido: true,
        google_agenda_id: 'x@group.calendar.google.com',
        worker_passando: true,
        worker_passou_em: '2026-11-11T17:59:30+00:00',
        pessoa: { id: 'p', nome: 'Rafael' },
        pendentes: 2,
        gravados: 12,
        feriados: 3,
        com_erro: 1,
        ultimo_gravado_em: '2026-11-11T17:10:00+00:00',
        ultimo_erro: {
          erro: 'Google 403: Forbidden',
          em: '2026-11-11T17:00:00+00:00',
          desde: '2026-11-10T18:00:00+00:00',
          ativo: true,
        },
        agora: '2026-11-11T18:00:00+00:00',
      }),
    ).toEqual({
      idPreenchido: true,
      workerPassando: true,
      workerPassouEm: '2026-11-11T17:59:30+00:00',
      pessoa: 'Rafael',
      pendentes: 2,
      gravados: 12,
      feriados: 3,
      comErro: 1,
      ultimoGravadoEm: '2026-11-11T17:10:00+00:00',
      ultimoErro: {
        erro: 'Google 403: Forbidden',
        em: '2026-11-11T17:00:00+00:00',
        desde: '2026-11-10T18:00:00+00:00',
        ativo: true,
      },
    });
  });

  it('o que não é estado vira null, e campo que falta vira zero ou vazio', () => {
    expect(lerEstadoDoEspelho(null)).toBeNull();
    expect(lerEstadoDoEspelho([])).toBeNull();
    expect(lerEstadoDoEspelho({ ligado: true })).toBeNull();
    expect(lerEstadoDoEspelho({ google_agenda_id_preenchido: false })).toMatchObject({
      idPreenchido: false,
      pessoa: null,
      gravados: 0,
      ultimoErro: null,
    });
  });
});

describe('fraseDoEspelho', () => {
  it('sem o id da agenda: desligado, com o efeito para o cliente e o comando da conferência', () => {
    const f = fraseDoEspelho({ ...LIGADO, idPreenchido: false, gravados: 0 }, AGORA);
    expect(f.tom).toBe('desligado');
    expect(f.titulo).toBe('Espelho no Google desligado: falta o id da agenda');
    expect(f.detalhe).toContain('"confirmado"');
    expect(f.comando).toContain('scripts/google-agenda-conferir.mjs');
  });

  it('com erro de pé: desde quando, o motivo em poucas palavras, e "rode a conferência"', () => {
    const f = fraseDoEspelho(
      {
        ...LIGADO,
        comErro: 2,
        ultimoErro: {
          erro: 'Google 403: You need to have writer access to this calendar.',
          em: '2026-11-11T17:00:00Z',
          desde: '2026-11-10T18:00:00Z',
          ativo: true,
        },
      },
      AGORA,
    );
    expect(f.tom).toBe('erro');
    expect(f.titulo).toBe('Com erro desde 10/11 15h: a agenda recusou (403). Rode a conferência');
    expect(f.detalhe).toBe(
      '2 horários não foram copiados para o Google, e o Calendly ainda os oferece.',
    );
    expect(f.comando).not.toBeNull();
  });

  it('o erro que já passou não vira alarme: o espelho segue ligado', () => {
    const f = fraseDoEspelho(
      {
        ...LIGADO,
        ultimoErro: {
          erro: 'Google 503: x',
          em: '2026-11-10T18:00:00Z',
          desde: null,
          ativo: false,
        },
      },
      AGORA,
    );
    expect(f.tom).toBe('ligado');
  });

  it('o id está lá e o worker não passa: parado, com o que conferir', () => {
    expect(
      fraseDoEspelho(
        { ...LIGADO, workerPassando: false, workerPassouEm: '2026-11-10T18:20:00Z' },
        AGORA,
      ).titulo,
    ).toBe('Espelho parado: o worker não passa desde 10/11 15h20');
    const nunca = fraseDoEspelho({ ...LIGADO, workerPassando: false, workerPassouEm: null }, AGORA);
    expect(nunca.tom).toBe('parado');
    expect(nunca.titulo).toBe('Espelho parado: o worker ainda não passou por aqui');
    expect(nunca.detalhe).toContain('GOOGLE_AGENDA_CREDENCIAL');
  });

  it('ligado: quantos horários e feriados, e o último às tantas', () => {
    const f = fraseDoEspelho(LIGADO, AGORA);
    expect(f.tom).toBe('ligado');
    expect(f.titulo).toBe('Ligado: 12 horários copiados e 3 feriados, o último às 14h10');
    expect(f.detalhe).toBe('A agenda de Rafael está no Google.');
    expect(f.comando).toBeNull();
  });

  it('ligado, noutro dia, um só, com fila e sem pessoa', () => {
    const f = fraseDoEspelho(
      {
        ...LIGADO,
        gravados: 1,
        feriados: 0,
        pendentes: 2,
        pessoa: null,
        ultimoGravadoEm: '2026-11-10T13:00:00Z',
      },
      AGORA,
    );
    expect(f.titulo).toBe('Ligado: 1 horário copiado, o último em 10/11 às 10h');
    expect(f.detalhe).toBe(
      'Ninguém atende pelo Calendly ainda: só os feriados vão ao Google. 2 itens na fila.',
    );
    expect(
      fraseDoEspelho({ ...LIGADO, gravados: 0, feriados: 0, ultimoGravadoEm: null }, AGORA).titulo,
    ).toBe('Ligado: nada copiado ainda');
  });
});

describe('as peças da frase', () => {
  it('o motivo do erro', () => {
    expect(motivoDoErro('Google 403: Forbidden')).toBe('a agenda recusou (403)');
    expect(motivoDoErro('Google 404: Not Found')).toBe('a agenda não foi achada (404)');
    expect(motivoDoErro('Google 503: Backend Error')).toBe('o Google ficou fora do ar (503)');
    expect(motivoDoErro('o Google não deu o token (400): Invalid JWT Signature.')).toBe(
      'o Google não deu a permissão (400)',
    );
    expect(motivoDoErro('fetch failed')).toBe('o Google não respondeu');
  });

  it('a hora falada, em Natal', () => {
    expect(horaFalada('2026-11-11T17:10:00Z')).toBe('14h10');
    expect(horaFalada('2026-11-11T18:00:00Z')).toBe('15h');
  });
});
