import { generateKeyPairSync, createVerify } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { cancelarNoCalendly, uuidDoEvento } from './calendly';
import {
  ClienteDoGoogleAgenda,
  corpoDoBloco,
  corpoDoFeriado,
  jwtDaContaDeServico,
  lerCredencial,
  TITULO_DO_BLOCO,
  TITULO_DO_FERIADO,
} from './google-agenda';
import {
  criarSincronizacaoDaAgenda,
  LOG_ESPELHO_DESLIGADO,
  LOG_ESPELHO_LIGADO,
  LOG_ESPELHO_SEM_CREDENCIAL,
} from './sincronizar';
import { createLogger } from '../lib/log';

/**
 * A agenda do Calendly no worker-wa: o espelho "Ocupado" no Google e os
 * cancelamentos que o CRM pede ao Calendly.
 *
 * O QUE ESTE ARQUIVO PROTEGE
 * ---------------------------------------------------------------------------
 *  1. O token do Google sai de um JWT ASSINADO com a chave da conta de serviço
 *     (conferido com a chave pública), com o escopo só de eventos.
 *  2. Gravar duas vezes não duplica: 409 vira atualização do mesmo evento.
 *  3. O bloco não leva nada do cliente: título fixo, opaco, privado.
 *  4. No Calendly, "já cancelado" e "não existe" contam como feito; token
 *     errado e fora do ar voltam a tentar; o resto para.
 *  5. A passada responde ao banco cada item (feito/falhou, gravado/apagado),
 *     não vai ao banco sem chave nenhuma, e espera quando o banco não tem as
 *     funções (o worker da KOMUNE, ou a migração ainda não publicada).
 *  6. (11/11/2026) O plano B: com GOOGLE_AGENDA_SUB o JWT leva `sub`; sem
 *     ela, não leva. O feriado vai ao Google como dia inteiro, opaco, e o que
 *     já existe é substituído (PUT). O espelho desligado é dito no log UMA vez
 *     (e de novo só quando muda), e o worker da KOMUNE continua mudo.
 */

// Os testes provocam erros de propósito: o log fica mudo.
const logger = createLogger({ worker: 'wa', level: 'error', stdout: () => {}, stderr: () => {} });

/** Um logger que guarda as linhas, para conferir o que foi dito. */
function loggerQueGuarda() {
  const linhas: Array<{ level: string; msg: string } & Record<string, unknown>> = [];
  const guardar = (linha: string) => linhas.push(JSON.parse(linha));
  return {
    linhas,
    logger: createLogger({ worker: 'wa', level: 'info', stdout: guardar, stderr: guardar }),
    vezes: (msg: string) => linhas.filter((l) => l.msg === msg).length,
  };
}

/** O corpo do JWT que foi ao endpoint do token. */
function corpoDoJwtPedido(corpoDoPost: string | null): Record<string, unknown> {
  const assertion = new URLSearchParams(corpoDoPost ?? '').get('assertion') ?? '';
  return JSON.parse(Buffer.from(assertion.split('.')[1] ?? '', 'base64url').toString());
}

/** A n-ésima chamada, ou o teste falha dizendo qual faltou. */
function n<T>(lista: T[], i: number): T {
  const item = lista[i];
  if (item === undefined) throw new Error(`faltou a chamada ${i}`);
  return item;
}

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const PEM = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
const CREDENCIAL = { client_email: 'crm@imova-agenda.iam.gserviceaccount.com', private_key: PEM };

type Chamada = { url: string; metodo: string; corpo: string | null };

/** Um `fetch` falso que responde pela ordem da lista e guarda o que foi pedido. */
function buscador(respostas: Array<{ status: number; corpo?: unknown }>) {
  const chamadas: Chamada[] = [];
  const fila = [...respostas];
  const buscar = (async (url: string | URL | Request, init?: RequestInit) => {
    chamadas.push({
      url: String(url),
      metodo: init?.method ?? 'GET',
      corpo: (init?.body as string) ?? null,
    });
    const r = fila.shift() ?? { status: 500, corpo: { erro: 'sem resposta no teste' } };
    return new Response(r.corpo === undefined ? null : JSON.stringify(r.corpo), {
      status: r.status,
    });
  }) as typeof fetch;
  return { buscar, chamadas };
}

const TOKEN_OK = { status: 200, corpo: { access_token: 'tok-1', expires_in: 3600 } };

describe('a conta de serviço do Google', () => {
  it('o JWT é assinado com a chave dela e pede só o escopo de eventos', () => {
    const jwt = jwtDaContaDeServico(CREDENCIAL, 1_800_000_000);
    const [cabecalho = '', corpo = '', assinatura = ''] = jwt.split('.');
    const verificador = createVerify('RSA-SHA256');
    verificador.update(`${cabecalho}.${corpo}`);
    expect(verificador.verify(publicKey, Buffer.from(assinatura, 'base64url'))).toBe(true);
    expect(JSON.parse(Buffer.from(corpo, 'base64url').toString())).toEqual({
      iss: CREDENCIAL.client_email,
      scope: 'https://www.googleapis.com/auth/calendar.events',
      aud: 'https://oauth2.googleapis.com/token',
      iat: 1_800_000_000,
      exp: 1_800_003_600,
    });
  });

  it('plano B: com GOOGLE_AGENDA_SUB o JWT leva sub, assinado do mesmo jeito', () => {
    const jwt = jwtDaContaDeServico(CREDENCIAL, 1_800_000_000, ' agenda@imovaimobiliaria.com.br ');
    const [cabecalho = '', corpo = '', assinatura = ''] = jwt.split('.');
    const verificador = createVerify('RSA-SHA256');
    verificador.update(`${cabecalho}.${corpo}`);
    expect(verificador.verify(publicKey, Buffer.from(assinatura, 'base64url'))).toBe(true);
    expect(JSON.parse(Buffer.from(corpo, 'base64url').toString())).toEqual({
      iss: CREDENCIAL.client_email,
      sub: 'agenda@imovaimobiliaria.com.br',
      scope: 'https://www.googleapis.com/auth/calendar.events',
      aud: 'https://oauth2.googleapis.com/token',
      iat: 1_800_000_000,
      exp: 1_800_003_600,
    });
    // Vazio é o mesmo que não ter: nada de `sub` no JWT.
    const semSub = jwtDaContaDeServico(CREDENCIAL, 1_800_000_000, '  ');
    expect(
      JSON.parse(Buffer.from(semSub.split('.')[1] ?? '', 'base64url').toString()),
    ).not.toHaveProperty('sub');
  });

  it('o cliente pede o token com sub só quando há GOOGLE_AGENDA_SUB', async () => {
    const com = buscador([TOKEN_OK, { status: 200, corpo: {} }]);
    await new ClienteDoGoogleAgenda({
      credencial: CREDENCIAL,
      sub: 'agenda@imovaimobiliaria.com.br',
      buscar: com.buscar,
    }).gravar('cal', 'abc123', '2026-11-15T13:00:00.000Z', '2026-11-15T13:45:00.000Z');
    expect(corpoDoJwtPedido(n(com.chamadas, 0).corpo).sub).toBe('agenda@imovaimobiliaria.com.br');

    const sem = buscador([TOKEN_OK, { status: 200, corpo: {} }]);
    await new ClienteDoGoogleAgenda({ credencial: CREDENCIAL, buscar: sem.buscar }).gravar(
      'cal',
      'abc123',
      '2026-11-15T13:00:00.000Z',
      '2026-11-15T13:45:00.000Z',
    );
    expect(corpoDoJwtPedido(n(sem.chamadas, 0).corpo)).not.toHaveProperty('sub');
  });

  it('a chave vem como o JSON do Google Cloud, cru ou em base64', () => {
    const json = JSON.stringify({ type: 'service_account', ...CREDENCIAL });
    expect(lerCredencial(json).client_email).toBe(CREDENCIAL.client_email);
    expect(lerCredencial(Buffer.from(json).toString('base64')).client_email).toBe(
      CREDENCIAL.client_email,
    );
    expect(() => lerCredencial('não é json')).toThrow(/conta de serviço/);
    expect(() => lerCredencial('{"client_email": "x"}')).toThrow(/private_key/);
  });

  it('o bloco não leva nada do cliente: título fixo, opaco e privado', () => {
    expect(corpoDoBloco('2026-11-15T13:00:00.000Z', '2026-11-15T13:45:00.000Z')).toEqual({
      summary: TITULO_DO_BLOCO,
      start: { dateTime: '2026-11-15T13:00:00.000Z' },
      end: { dateTime: '2026-11-15T13:45:00.000Z' },
      transparency: 'opaque',
      visibility: 'private',
      status: 'confirmed',
      reminders: { useDefault: false, overrides: [] },
      extendedProperties: { private: { origem: 'triade-crm' } },
    });
  });
});

describe('o Google Agenda', () => {
  const CAL = 'agenda@group.calendar.google.com';

  it('o feriado é um bloco de dia inteiro, opaco, privado e sem nada do cliente', () => {
    expect(corpoDoFeriado('2026-11-20', '2026-11-21')).toEqual({
      summary: TITULO_DO_FERIADO,
      start: { date: '2026-11-20' },
      end: { date: '2026-11-21' },
      transparency: 'opaque',
      visibility: 'private',
      status: 'confirmed',
      reminders: { useDefault: false, overrides: [] },
      extendedProperties: { private: { origem: 'triade-crm', tipo: 'feriado' } },
    });
    expect(TITULO_DO_FERIADO).toBe('Ocupado — feriado');
  });

  it('grava o feriado com o id estável; o que já existe é substituído (PUT), sem duplicar', async () => {
    const { buscar, chamadas } = buscador([
      TOKEN_OK,
      { status: 409, corpo: { error: { message: 'The requested identifier already exists.' } } },
      { status: 200, corpo: {} },
    ]);
    const google = new ClienteDoGoogleAgenda({ credencial: CREDENCIAL, buscar });
    expect(
      await google.gravarFeriado(
        CAL,
        '47f9887b30a946e2603b4d4b2b9214c2',
        '2026-11-20',
        '2026-11-21',
      ),
    ).toEqual({ ok: true });
    const inserido = JSON.parse(n(chamadas, 1).corpo ?? '{}');
    expect(inserido.id).toBe('47f9887b30a946e2603b4d4b2b9214c2');
    expect(inserido.start).toEqual({ date: '2026-11-20' });
    expect(inserido.end).toEqual({ date: '2026-11-21' });
    expect(n(chamadas, 2).metodo).toBe('PUT');
    expect(n(chamadas, 2).url).toContain(
      '/events/47f9887b30a946e2603b4d4b2b9214c2?sendUpdates=none',
    );
    expect(JSON.parse(n(chamadas, 2).corpo ?? '{}').start).toEqual({ date: '2026-11-20' });
  });

  it('grava com o id do compromisso, e o token serve para a próxima chamada', async () => {
    const { buscar, chamadas } = buscador([TOKEN_OK, { status: 200, corpo: {} }, { status: 204 }]);
    const google = new ClienteDoGoogleAgenda({
      credencial: CREDENCIAL,
      buscar,
      agora: () => 1_800_000_000,
    });
    expect(
      await google.gravar(CAL, 'abc123', '2026-11-15T13:00:00.000Z', '2026-11-15T13:45:00.000Z'),
    ).toEqual({ ok: true });
    expect(await google.apagar(CAL, 'abc123')).toEqual({ ok: true });
    expect(chamadas.map((c) => c.metodo)).toEqual(['POST', 'POST', 'DELETE']);
    expect(n(chamadas, 1).url).toBe(
      'https://www.googleapis.com/calendar/v3/calendars/agenda%40group.calendar.google.com/events?sendUpdates=none',
    );
    expect(JSON.parse(n(chamadas, 1).corpo ?? '{}').id).toBe('abc123');
    expect(n(chamadas, 0).corpo).toContain(
      'grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer',
    );
  });

  it('o evento que já existe (409) é atualizado no lugar, sem duplicar', async () => {
    const { buscar, chamadas } = buscador([
      TOKEN_OK,
      { status: 409, corpo: { error: { message: 'duplicate' } } },
      { status: 200, corpo: {} },
    ]);
    const google = new ClienteDoGoogleAgenda({ credencial: CREDENCIAL, buscar });
    expect(
      await google.gravar(CAL, 'abc123', '2026-11-15T14:00:00.000Z', '2026-11-15T14:45:00.000Z'),
    ).toEqual({ ok: true });
    expect(n(chamadas, 2).metodo).toBe('PATCH');
    expect(n(chamadas, 2).url).toContain('/events/abc123?sendUpdates=none');
    expect(JSON.parse(n(chamadas, 2).corpo ?? '{}').status).toBe('confirmed');
  });

  it('apagar o que já não existe conta como apagado', async () => {
    const { buscar } = buscador([TOKEN_OK, { status: 410 }]);
    const google = new ClienteDoGoogleAgenda({ credencial: CREDENCIAL, buscar });
    expect(await google.apagar(CAL, 'abc123')).toEqual({ ok: true });
  });

  it('fora do ar é transitório; agenda não compartilhada com a conta não é', async () => {
    const fora = buscador([
      TOKEN_OK,
      { status: 503, corpo: { error: { message: 'Backend Error' } } },
    ]);
    expect(
      await new ClienteDoGoogleAgenda({ credencial: CREDENCIAL, buscar: fora.buscar }).gravar(
        CAL,
        'a1b2c',
        'x',
        'y',
      ),
    ).toEqual({ ok: false, transitorio: true, erro: 'Google 503: Backend Error' });
    const naoAchou = buscador([
      TOKEN_OK,
      { status: 404, corpo: { error: { message: 'Not Found' } } },
    ]);
    expect(
      await new ClienteDoGoogleAgenda({ credencial: CREDENCIAL, buscar: naoAchou.buscar }).gravar(
        CAL,
        'a1b2c',
        'x',
        'y',
      ),
    ).toEqual({ ok: false, transitorio: false, erro: 'Google 404: Not Found' });
  });

  it('sem token do Google, a gravação falha com o motivo, sem lançar', async () => {
    const { buscar } = buscador([
      {
        status: 400,
        corpo: { error: 'invalid_grant', error_description: 'Invalid JWT Signature.' },
      },
    ]);
    const r = await new ClienteDoGoogleAgenda({ credencial: CREDENCIAL, buscar }).gravar(
      CAL,
      'a1b2c',
      'x',
      'y',
    );
    expect(r).toEqual({
      ok: false,
      transitorio: true,
      erro: 'o Google não deu o token (400): Invalid JWT Signature.',
    });
  });
});

describe('o Calendly', () => {
  const URI = 'https://api.calendly.com/scheduled_events/EV-1234-abcd';

  it('o uuid do evento é o fim da URI', () => {
    expect(uuidDoEvento(URI)).toBe('EV-1234-abcd');
    expect(uuidDoEvento(`${URI}/`)).toBe('EV-1234-abcd');
    // Id curto também vale (achado no teste de ponta a ponta com o banco local).
    expect(uuidDoEvento('https://api.calendly.com/scheduled_events/E2ER1')).toBe('E2ER1');
    // O que mudaria o caminho ou a consulta da URL da API, não.
    expect(uuidDoEvento('https://api.calendly.com/scheduled_events/abc?x=1')).toBeNull();
    expect(uuidDoEvento('https://api.calendly.com/scheduled_events/abc%2F..')).toBeNull();
    expect(uuidDoEvento('https://api.calendly.com/scheduled_events/')).toBeNull();
  });

  it('cancela com o recado ao cliente', async () => {
    const { buscar, chamadas } = buscador([{ status: 201, corpo: { resource: {} } }]);
    expect(
      await cancelarNoCalendly({
        token: 't',
        eventoUri: URI,
        motivo: 'Escolha outro horário.',
        buscar,
      }),
    ).toEqual({ ok: true });
    expect(n(chamadas, 0).url).toBe(
      'https://api.calendly.com/scheduled_events/EV-1234-abcd/cancellation',
    );
    expect(JSON.parse(n(chamadas, 0).corpo ?? '{}')).toEqual({ reason: 'Escolha outro horário.' });
  });

  it('já cancelado ou inexistente conta como feito', async () => {
    const ja = buscador([
      { status: 403, corpo: { title: 'Permission Denied', message: 'Event is already canceled' } },
    ]);
    expect(
      await cancelarNoCalendly({ token: 't', eventoUri: URI, motivo: 'x', buscar: ja.buscar }),
    ).toEqual({ ok: true });
    const sumiu = buscador([{ status: 404, corpo: { title: 'Resource Not Found' } }]);
    expect(
      await cancelarNoCalendly({ token: 't', eventoUri: URI, motivo: 'x', buscar: sumiu.buscar }),
    ).toEqual({ ok: true });
  });

  it('token errado e fora do ar voltam a tentar; pedido recusado para', async () => {
    const token = buscador([{ status: 401, corpo: { title: 'Unauthenticated' } }]);
    expect(
      await cancelarNoCalendly({ token: 't', eventoUri: URI, motivo: 'x', buscar: token.buscar }),
    ).toMatchObject({ ok: false, definitivo: false });
    const fora = buscador([{ status: 502 }]);
    expect(
      await cancelarNoCalendly({ token: 't', eventoUri: URI, motivo: 'x', buscar: fora.buscar }),
    ).toMatchObject({ ok: false, definitivo: false });
    const recusado = buscador([
      {
        status: 400,
        corpo: { title: 'Invalid Argument', message: 'The supplied parameters are invalid.' },
      },
    ]);
    expect(
      await cancelarNoCalendly({
        token: 't',
        eventoUri: URI,
        motivo: 'x',
        buscar: recusado.buscar,
      }),
    ).toEqual({
      ok: false,
      definitivo: true,
      erro: 'Calendly 400: Invalid Argument · The supplied parameters are invalid.',
    });
  });
});

/** Um dublê do banco que só sabe as RPCs da agenda. */
function bancoDeTeste(respostas: Record<string, unknown>, erro?: string) {
  const chamadas: Array<{ nome: string; args: Record<string, unknown> }> = [];
  const cliente = {
    rpc: async (nome: string, args: Record<string, unknown>) => {
      chamadas.push({ nome, args });
      if (erro) return { data: null, error: { message: erro } };
      return { data: respostas[nome] ?? null, error: null };
    },
  } as unknown as Parameters<typeof criarSincronizacaoDaAgenda>[0]['cliente'];
  return { cliente, chamadas };
}

describe('a passada da agenda', () => {
  it('sem chave nenhuma (o worker da KOMUNE), não vai ao banco', async () => {
    const { cliente, chamadas } = bancoDeTeste({});
    const agenda = criarSincronizacaoDaAgenda({ cliente, logger });
    expect(agenda.ligada).toBe(false);
    await agenda.rodar();
    expect(chamadas).toEqual([]);
  });

  it('cancela no Calendly e responde ao banco: feito, ou falhou com o motivo', async () => {
    const { cliente, chamadas } = bancoDeTeste({
      calendly_cancelamentos_pendentes: [
        {
          id: 'ag-1',
          evento_uri: 'https://api.calendly.com/scheduled_events/EV-0001-aaaa',
          motivo: 'Horário ocupado.',
        },
        {
          id: 'ag-2',
          evento_uri: 'https://api.calendly.com/scheduled_events/EV-0002-bbbb',
          motivo: 'Horário ocupado.',
        },
      ],
    });
    const { buscar } = buscador([
      { status: 201, corpo: {} },
      { status: 400, corpo: { title: 'Invalid Argument' } },
    ]);
    const resumo = await criarSincronizacaoDaAgenda({
      cliente,
      logger,
      tokenCalendly: 't',
      buscar,
    }).rodar();
    expect(resumo).toMatchObject({ canceladosNoCalendly: 1, falhas: 1 });
    expect(chamadas.slice(1)).toEqual([
      { nome: 'calendly_cancelamento_feito', args: { p_id: 'ag-1' } },
      {
        nome: 'calendly_cancelamento_falhou',
        args: { p_id: 'ag-2', p_erro: 'Calendly 400: Invalid Argument', p_definitivo: true },
      },
    ]);
  });

  it('grava e apaga no Google e responde ao banco', async () => {
    const { cliente, chamadas } = bancoDeTeste({
      agenda_espelho_pendencias: {
        ligado: true,
        calendario: 'agenda@group.calendar.google.com',
        gravar: [
          {
            item_id: 'it-1',
            evento_id: 'it1',
            inicio: '2026-11-15T13:00:00+00:00',
            fim: '2026-11-15T13:45:00+00:00',
          },
        ],
        apagar: [{ item_id: 'it-2', evento_id: 'it2' }],
      },
    });
    const { buscar, chamadas: http } = buscador([
      TOKEN_OK,
      { status: 200, corpo: {} },
      { status: 204 },
    ]);
    const resumo = await criarSincronizacaoDaAgenda({
      cliente,
      logger,
      credencialGoogle: JSON.stringify(CREDENCIAL),
      buscar,
    }).rodar();
    expect(resumo).toEqual({
      canceladosNoCalendly: 0,
      gravadosNoGoogle: 1,
      apagadosNoGoogle: 1,
      falhas: 0,
    });
    expect(JSON.parse(n(http, 1).corpo ?? '{}').start).toEqual({
      dateTime: '2026-11-15T13:00:00.000Z',
    });
    expect(chamadas.slice(1)).toEqual([
      {
        nome: 'agenda_espelho_gravado',
        args: {
          p_item: 'it-1',
          p_inicio: '2026-11-15T13:00:00+00:00',
          p_fim: '2026-11-15T13:45:00+00:00',
        },
      },
      { nome: 'agenda_espelho_apagado', args: { p_item: 'it-2' } },
    ]);
  });

  it('o feriado vai ao Google como dia inteiro e volta ao banco com o início e o fim dele', async () => {
    const { cliente, chamadas } = bancoDeTeste({
      agenda_espelho_pendencias: {
        ligado: true,
        calendario: 'agenda@group.calendar.google.com',
        gravar: [
          {
            item_id: '47f9887b-30a9-46e2-603b-4d4b2b9214c2',
            evento_id: '47f9887b30a946e2603b4d4b2b9214c2',
            tipo: 'feriado',
            inicio: '2026-11-20T00:00:00-03:00',
            fim: '2026-11-21T00:00:00-03:00',
            dia: '2026-11-20',
            ate: '2026-11-21',
          },
        ],
        apagar: [],
      },
    });
    const { buscar, chamadas: http } = buscador([TOKEN_OK, { status: 200, corpo: {} }]);
    const resumo = await criarSincronizacaoDaAgenda({
      cliente,
      logger,
      credencialGoogle: JSON.stringify(CREDENCIAL),
      buscar,
    }).rodar();
    expect(resumo).toMatchObject({ gravadosNoGoogle: 1, falhas: 0 });
    const corpo = JSON.parse(n(http, 1).corpo ?? '{}');
    expect(corpo.summary).toBe('Ocupado — feriado');
    expect(corpo.start).toEqual({ date: '2026-11-20' });
    expect(corpo.end).toEqual({ date: '2026-11-21' });
    expect(chamadas.slice(1)).toEqual([
      {
        nome: 'agenda_espelho_gravado',
        args: {
          p_item: '47f9887b-30a9-46e2-603b-4d4b2b9214c2',
          p_inicio: '2026-11-20T00:00:00-03:00',
          p_fim: '2026-11-21T00:00:00-03:00',
        },
      },
    ]);
  });

  it('o feriado recusado pelo Google volta ao banco como falha, com o motivo', async () => {
    const { cliente, chamadas } = bancoDeTeste({
      agenda_espelho_pendencias: {
        ligado: true,
        calendario: 'agenda@group.calendar.google.com',
        gravar: [
          {
            item_id: '47f9887b-30a9-46e2-603b-4d4b2b9214c2',
            evento_id: '47f9887b30a946e2603b4d4b2b9214c2',
            tipo: 'feriado',
            inicio: '2026-11-20T00:00:00-03:00',
            fim: '2026-11-21T00:00:00-03:00',
            dia: '2026-11-20',
            ate: '2026-11-21',
          },
        ],
        apagar: [],
      },
    });
    const { buscar } = buscador([
      TOKEN_OK,
      {
        status: 403,
        corpo: { error: { message: 'You need to have writer access to this calendar.' } },
      },
    ]);
    await criarSincronizacaoDaAgenda({
      cliente,
      logger,
      credencialGoogle: JSON.stringify(CREDENCIAL),
      buscar,
    }).rodar();
    expect(n(chamadas, 1)).toEqual({
      nome: 'agenda_espelho_falhou',
      args: {
        p_item: '47f9887b-30a9-46e2-603b-4d4b2b9214c2',
        p_inicio: '2026-11-20T00:00:00-03:00',
        p_fim: '2026-11-21T00:00:00-03:00',
        p_erro: 'Google 403: You need to have writer access to this calendar.',
      },
    });
  });

  it('espelho desligado no banco: diz no log UMA vez, e de novo só quando muda', async () => {
    let pendencias: unknown = { ligado: false, motivo: 'sem_google_agenda_id' };
    const chamadas: string[] = [];
    const cliente = {
      rpc: async (nome: string) => {
        chamadas.push(nome);
        return { data: nome === 'agenda_espelho_pendencias' ? pendencias : null, error: null };
      },
    } as unknown as Parameters<typeof criarSincronizacaoDaAgenda>[0]['cliente'];
    const { buscar } = buscador([]);
    const log = loggerQueGuarda();
    const agenda = criarSincronizacaoDaAgenda({
      cliente,
      logger: log.logger,
      credencialGoogle: JSON.stringify(CREDENCIAL),
      buscar,
    });
    await agenda.rodar();
    await agenda.rodar();
    await agenda.rodar();
    expect(chamadas).toHaveLength(3);
    expect(log.vezes(LOG_ESPELHO_DESLIGADO)).toBe(1);
    expect(log.linhas.find((l) => l.msg === LOG_ESPELHO_DESLIGADO)?.level).toBe('warn');
    expect(LOG_ESPELHO_DESLIGADO).toBe(
      'espelho desligado: falta google_agenda_id em app_settings[calendly]',
    );

    // Alguém gravou o google_agenda_id: o log diz que ligou, uma vez.
    pendencias = {
      ligado: true,
      calendario: 'agenda@group.calendar.google.com',
      gravar: [],
      apagar: [],
    };
    await agenda.rodar();
    await agenda.rodar();
    expect(log.vezes(LOG_ESPELHO_LIGADO)).toBe(1);

    // E se desligar de novo, diz de novo.
    pendencias = { ligado: false, motivo: 'sem_google_agenda_id' };
    await agenda.rodar();
    expect(log.vezes(LOG_ESPELHO_DESLIGADO)).toBe(2);
  });

  it('worker com o Calendly e sem a chave do Google diz que o espelho está desligado; o da KOMUNE, nada', () => {
    const { cliente } = bancoDeTeste({});
    const imova = loggerQueGuarda();
    const agenda = criarSincronizacaoDaAgenda({
      cliente,
      logger: imova.logger,
      tokenCalendly: 't',
    });
    expect(agenda.cancelaNoCalendly).toBe(true);
    expect(agenda.credencialDoGoogle).toBe(false);
    expect(imova.vezes(LOG_ESPELHO_SEM_CREDENCIAL)).toBe(1);

    const komune = loggerQueGuarda();
    criarSincronizacaoDaAgenda({ cliente, logger: komune.logger });
    expect(komune.linhas).toEqual([]);
  });

  it('credencialDoGoogle diz se a chave foi lida, e não só se a variável existe', () => {
    const { cliente } = bancoDeTeste({});
    expect(
      criarSincronizacaoDaAgenda({ cliente, logger, credencialGoogle: JSON.stringify(CREDENCIAL) })
        .credencialDoGoogle,
    ).toBe(true);
    expect(
      criarSincronizacaoDaAgenda({ cliente, logger, credencialGoogle: 'lixo', tokenCalendly: 't' })
        .credencialDoGoogle,
    ).toBe(false);
  });

  it('espelho desligado no banco (sem google_agenda_id): não chama o Google', async () => {
    const { cliente } = bancoDeTeste({
      agenda_espelho_pendencias: { ligado: false, motivo: 'sem_google_agenda_id' },
    });
    const { buscar, chamadas: http } = buscador([]);
    await criarSincronizacaoDaAgenda({
      cliente,
      logger,
      credencialGoogle: JSON.stringify(CREDENCIAL),
      buscar,
    }).rodar();
    expect(http).toEqual([]);
  });

  it('banco sem as funções: para de perguntar por um tempo, sem lançar', async () => {
    const { cliente, chamadas } = bancoDeTeste(
      {},
      'Could not find the function public.calendly_cancelamentos_pendentes',
    );
    const agenda = criarSincronizacaoDaAgenda({ cliente, logger, tokenCalendly: 't' });
    await agenda.rodar();
    await agenda.rodar();
    expect(chamadas).toHaveLength(1);
  });

  it('chave do Google torta não derruba nada: só o Calendly segue', () => {
    const { cliente } = bancoDeTeste({});
    const agenda = criarSincronizacaoDaAgenda({
      cliente,
      logger,
      credencialGoogle: 'lixo',
      tokenCalendly: 't',
    });
    expect(agenda.ligada).toBe(true);
    expect(criarSincronizacaoDaAgenda({ cliente, logger, credencialGoogle: 'lixo' }).ligada).toBe(
      false,
    );
  });
});
