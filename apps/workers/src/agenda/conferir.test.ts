import { createVerify, generateKeyPairSync } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  AGENDA_DA_IMOVA,
  conferir,
  CONTA_DA_IMOVA,
  diagnosticoDaAgenda,
  diagnosticoDoToken,
  jwtDaContaDeServico,
  lerArgumentos,
  lerCredencial,
  sqlDoGoogleAgendaId,
  textoDoResultado,
} from '../../../../scripts/google-agenda-conferir.mjs';

/**
 * O script que o usuário roda no Terminal antes de ligar o espelho
 * (`scripts/google-agenda-conferir.mjs`, 11/11/2026). Nunca contra o Google de
 * verdade: só com o `fetch` falso.
 *
 * O QUE ESTE ARQUIVO PROTEGE
 * ---------------------------------------------------------------------------
 *  1. A ordem: credencial → token → agenda → gravar e apagar, parando no
 *     primeiro que falha.
 *  2. Cada recusa do Google vira a frase do que fazer: agenda não
 *     compartilhada, só leitura, delegação não ligada, API desligada, chave
 *     apagada, relógio errado.
 *  3. O plano B: com --sub o JWT leva `sub`.
 *  4. O conteúdo da credencial NUNCA aparece no texto: nem a chave, nem o token.
 */

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const PEM = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
const JSON_DA_CONTA = JSON.stringify({
  type: 'service_account',
  client_email: CONTA_DA_IMOVA,
  client_id: '112233445566778899',
  private_key: PEM,
  token_uri: 'https://oauth2.googleapis.com/token',
});
const TOKEN = 'ya29.token-que-nao-pode-aparecer';
const AGORA = Date.UTC(2026, 10, 11, 18, 0, 0);

type Chamada = { url: string; metodo: string; corpo: string | null; auth: string | null };
type Resposta = { status: number; corpo?: unknown };

function buscador(respostas: Resposta[]) {
  const chamadas: Chamada[] = [];
  const fila = [...respostas];
  const buscar = (async (url: string | URL | Request, init?: RequestInit) => {
    const cabecalhos = (init?.headers ?? {}) as Record<string, string>;
    chamadas.push({
      url: String(url),
      metodo: init?.method ?? 'GET',
      corpo: (init?.body as string) ?? null,
      auth: cabecalhos.Authorization ?? null,
    });
    const r = fila.shift() ?? { status: 500, corpo: { erro: 'sem resposta no teste' } };
    return new Response(r.corpo === undefined ? null : JSON.stringify(r.corpo), {
      status: r.status,
    });
  }) as typeof fetch;
  return { buscar, chamadas };
}

const TOKEN_OK: Resposta = { status: 200, corpo: { access_token: TOKEN, expires_in: 3600 } };
const AGENDA_OK: Resposta = {
  status: 200,
  corpo: {
    summary: 'CRM Imova - ocupado',
    timeZone: 'America/Sao_Paulo',
    accessRole: 'writer',
    items: [],
  },
};

async function rodar(respostas: Resposta[], extra: { sub?: string; credencial?: string } = {}) {
  const b = buscador(respostas);
  const r = await conferir({
    credencialCrua: extra.credencial ?? JSON_DA_CONTA,
    sub: extra.sub,
    buscar: b.buscar,
    agora: () => AGORA,
  });
  return { r, chamadas: b.chamadas, texto: textoDoResultado(r) };
}

function ultimo<T>(lista: T[]): T {
  const item = lista[lista.length - 1];
  if (item === undefined) throw new Error('lista vazia');
  return item;
}

function corpoDoJwt(corpoDoPost: string | null): Record<string, unknown> {
  const assertion = new URLSearchParams(corpoDoPost ?? '').get('assertion') ?? '';
  return JSON.parse(Buffer.from(assertion.split('.')[1] ?? '', 'base64url').toString());
}

describe('a conferência do espelho no Google', () => {
  it('tudo certo: lê, pega o token, abre a agenda, grava e apaga o teste, e diz o SQL', async () => {
    const { r, chamadas, texto } = await rodar([
      TOKEN_OK,
      AGENDA_OK,
      { status: 200, corpo: { id: 'x' } },
      { status: 204 },
    ]);
    expect(r.ok).toBe(true);
    expect(r.passos.map((p) => [p.nome, p.ok])).toEqual([
      ['Credencial', true],
      ['Token', true],
      ['Agenda', true],
      ['Gravar e apagar', true],
    ]);
    expect(chamadas.map((c) => c.metodo)).toEqual(['POST', 'GET', 'POST', 'DELETE']);
    expect(chamadas[1]?.url).toContain(`/calendars/${encodeURIComponent(AGENDA_DA_IMOVA)}/events?`);
    // O teste é longe: daqui a dez anos, de madrugada, e é o mesmo id que é apagado.
    const evento = JSON.parse(chamadas[2]?.corpo ?? '{}');
    expect(evento.start).toEqual({ dateTime: '2036-01-04T03:00:00-03:00' });
    expect(evento.id).toMatch(/^[0-9a-v]{5,}$/);
    expect(ultimo(chamadas).url).toContain(`/events/${evento.id}?sendUpdates=none`);
    expect(chamadas[1]?.auth).toBe(`Bearer ${TOKEN}`);
    // O JWT sem plano B não leva sub.
    expect(corpoDoJwt(chamadas[0]?.corpo ?? null)).not.toHaveProperty('sub');
    expect(texto).toContain('Tudo certo');
    expect(texto).toContain(sqlDoGoogleAgendaId(AGENDA_DA_IMOVA).split('\n')[1]);
    expect(texto).toContain('fly deploy');
    expect(texto).not.toContain('GOOGLE_AGENDA_SUB=');
  });

  it('o texto nunca mostra a chave privada nem o token', async () => {
    for (const respostas of [
      [TOKEN_OK, AGENDA_OK, { status: 200, corpo: {} }, { status: 204 }],
      [TOKEN_OK, { status: 404, corpo: { error: { code: 404, message: 'Not Found' } } }],
      [
        {
          status: 400,
          corpo: { error: 'invalid_grant', error_description: 'Invalid JWT Signature.' },
        },
      ],
    ]) {
      const { texto, r } = await rodar(respostas);
      expect(texto).not.toContain('PRIVATE KEY');
      expect(texto).not.toContain(PEM.split('\n')[1] ?? 'x');
      expect(texto).not.toContain(TOKEN);
      expect(JSON.stringify(r)).not.toContain('PRIVATE KEY');
      expect(JSON.stringify(r)).not.toContain(TOKEN);
    }
  });

  it('credencial: vazia, torta e sem a chave dizem o que fazer, sem ir ao Google', async () => {
    for (const credencial of ['', 'não é json', '{"client_email": "x@y"}']) {
      const { r, chamadas } = await rodar([], { credencial });
      expect(r.ok).toBe(false);
      expect(r.passos).toHaveLength(1);
      expect(r.passos[0]?.nome).toBe('Credencial');
      expect(chamadas).toEqual([]);
    }
    // Em base64, como no segredo do Fly, também vale.
    const { r } = await rodar([TOKEN_OK, AGENDA_OK, { status: 200, corpo: {} }, { status: 204 }], {
      credencial: Buffer.from(JSON_DA_CONTA).toString('base64'),
    });
    expect(r.ok).toBe(true);
    expect(r.passos[0]?.frase).toContain(CONTA_DA_IMOVA);
    expect(r.passos[0]?.frase).toContain('112233445566778899');
  });

  it('agenda não compartilhada (404): diz para compartilhar com a conta de serviço', async () => {
    const { r, texto } = await rodar([
      TOKEN_OK,
      { status: 404, corpo: { error: { code: 404, message: 'Not Found' } } },
    ]);
    expect(r.ok).toBe(false);
    expect(ultimo(r.passos).nome).toBe('Agenda');
    expect(ultimo(r.passos).frase).toMatch(
      /^A agenda não foi compartilhada com a conta de serviço/,
    );
    expect(ultimo(r.passos).frase).toContain(CONTA_DA_IMOVA);
    expect(ultimo(r.passos).frase).toContain('Fazer alterações nos eventos');
    expect(texto).toContain('FALHOU');
    expect(texto).not.toContain('Tudo certo');
  });

  it('só leitura: a lista abre, mas o papel é de leitor', async () => {
    const { r } = await rodar([
      TOKEN_OK,
      { status: 200, corpo: { summary: 'CRM Imova - ocupado', accessRole: 'reader', items: [] } },
    ]);
    expect(r.ok).toBe(false);
    expect(ultimo(r.passos).frase).toMatch(
      /^A conta tem só leitura: falta "Fazer alterações nos eventos"/,
    );
    const livreOcupado = await rodar([
      TOKEN_OK,
      { status: 200, corpo: { accessRole: 'freeBusyReader', items: [] } },
    ]);
    expect(ultimo(livreOcupado.r.passos).frase).toMatch(/^A conta vê só livre\/ocupado/);
  });

  it('só leitura descoberta na gravação (403 requiredAccessLevel)', async () => {
    const { r } = await rodar([
      TOKEN_OK,
      AGENDA_OK,
      {
        status: 403,
        corpo: {
          error: {
            code: 403,
            message: 'You need to have writer access to this calendar.',
            errors: [{ reason: 'requiredAccessLevel' }],
          },
        },
      },
    ]);
    expect(ultimo(r.passos).nome).toBe('Gravar e apagar');
    expect(ultimo(r.passos).frase).toMatch(/^A conta tem só leitura/);
  });

  it('gravou e não apagou: falha, e diz onde está o evento de teste para apagar à mão', async () => {
    const { r } = await rodar([
      TOKEN_OK,
      AGENDA_OK,
      { status: 200, corpo: {} },
      { status: 403, corpo: { error: { message: 'Forbidden' } } },
    ]);
    expect(r.ok).toBe(false);
    expect(ultimo(r.passos).frase).toContain('04/01/2036');
    expect(ultimo(r.passos).frase).toContain('Conferência do CRM — pode apagar');
  });

  it('API do Google Agenda desligada no projeto', async () => {
    const { r } = await rodar([
      TOKEN_OK,
      {
        status: 403,
        corpo: {
          error: {
            code: 403,
            message:
              'Google Calendar API has not been used in project 123 before or it is disabled.',
            errors: [{ reason: 'accessNotConfigured' }],
            status: 'PERMISSION_DENIED',
          },
        },
      },
    ]);
    expect(ultimo(r.passos).frase).toMatch(/^A API do Google Agenda não está ativada/);
  });

  it('plano B: com --sub o JWT leva sub; sem a delegação, diz o caminho no Admin do Google', async () => {
    const sub = 'contato@imovaimobiliaria.com.br';
    const { r, chamadas, texto } = await rodar(
      [
        {
          status: 401,
          corpo: {
            error: 'unauthorized_client',
            error_description:
              'Client is unauthorized to retrieve access tokens using this method, or client not authorized for any of the scopes requested.',
          },
        },
      ],
      { sub },
    );
    expect(corpoDoJwt(chamadas[0]?.corpo ?? null).sub).toBe(sub);
    expect(r.ok).toBe(false);
    expect(ultimo(r.passos).nome).toBe('Token');
    expect(ultimo(r.passos).frase).toMatch(
      /^A delegação em todo o domínio não está ligada para este escopo/,
    );
    expect(ultimo(r.passos).frase).toContain(
      'Segurança → Controles de API → Delegação em todo o domínio',
    );
    expect(ultimo(r.passos).frase).toContain('112233445566778899');
    expect(ultimo(r.passos).frase).toContain('https://www.googleapis.com/auth/calendar.events');
    expect(texto).toContain('FALHOU');
  });

  it('plano B que dá certo diz para pôr GOOGLE_AGENDA_SUB no Fly', async () => {
    const { r, texto } = await rodar(
      [TOKEN_OK, AGENDA_OK, { status: 200, corpo: {} }, { status: 204 }],
      { sub: 'contato@imovaimobiliaria.com.br' },
    );
    expect(r.ok).toBe(true);
    expect(r.passos[1]?.frase).toContain('em nome de contato@imovaimobiliaria.com.br');
    expect(texto).toContain(
      'fly secrets set --app imova-worker-wa GOOGLE_AGENDA_SUB=contato@imovaimobiliaria.com.br',
    );
  });

  it('as recusas do token viram frases claras', () => {
    expect(
      diagnosticoDoToken(400, {
        error: 'invalid_grant',
        error_description: 'Invalid JWT Signature.',
      }),
    ).toMatch(/^O Google não reconhece esta chave/);
    expect(
      diagnosticoDoToken(400, {
        error: 'invalid_grant',
        error_description:
          'Invalid JWT: Token must be a short-lived token (60 minutes) and in a reasonable timeframe. Check your iat and exp values in the JWT claim.',
      }),
    ).toMatch(/^O relógio deste computador/);
    expect(
      diagnosticoDoToken(
        400,
        { error: 'invalid_grant', error_description: 'Invalid email or User ID' },
        { sub: 'ninguem@imovaimobiliaria.com.br' },
      ),
    ).toBe(
      'O e-mail do --sub (ninguem@imovaimobiliaria.com.br) não é um usuário do Google Workspace da Imova. Confira o endereço.',
    );
    expect(
      diagnosticoDoToken(400, {
        error: 'invalid_grant',
        error_description: 'Invalid grant: account not found',
      }),
    ).toMatch(/^A conta de serviço não existe mais/);
    expect(diagnosticoDoToken(500, {})).toBe('O Google não deu o token (500): sem detalhe.');
  });

  it('a agenda que não abre para o usuário do --sub diz isso, e não "compartilhe com a conta de serviço"', () => {
    const frase = diagnosticoDaAgenda(
      404,
      { error: { message: 'Not Found' } },
      { sub: 'contato@imovaimobiliaria.com.br', conta: CONTA_DA_IMOVA },
    );
    expect(frase).toMatch(/^A agenda não abre para contato@imovaimobiliaria.com.br/);
    expect(frase).not.toContain(CONTA_DA_IMOVA);
  });

  it('agenda fora do fuso de Natal: passa, com o aviso do feriado de dia inteiro', async () => {
    const { r } = await rodar([
      TOKEN_OK,
      { status: 200, corpo: { summary: 'X', timeZone: 'Europe/Lisbon', accessRole: 'owner' } },
      { status: 200, corpo: {} },
      { status: 204 },
    ]);
    expect(r.ok).toBe(true);
    expect(r.passos[2]?.aviso).toContain('Europe/Lisbon');
  });

  it('o JWT do script é o mesmo do worker: assinado, só o escopo de eventos, sub opcional', () => {
    const lida = lerCredencial(JSON_DA_CONTA);
    if (!lida.credencial) throw new Error('a credencial devia ser lida');
    const jwt = jwtDaContaDeServico(lida.credencial, 1_800_000_000, 'a@b.com');
    const [cabecalho = '', corpo = '', assinatura = ''] = jwt.split('.');
    const verificador = createVerify('RSA-SHA256');
    verificador.update(`${cabecalho}.${corpo}`);
    expect(verificador.verify(publicKey, Buffer.from(assinatura, 'base64url'))).toBe(true);
    expect(JSON.parse(Buffer.from(corpo, 'base64url').toString())).toEqual({
      iss: CONTA_DA_IMOVA,
      sub: 'a@b.com',
      scope: 'https://www.googleapis.com/auth/calendar.events',
      aud: 'https://oauth2.googleapis.com/token',
      iat: 1_800_000_000,
      exp: 1_800_003_600,
    });
  });

  it('o SQL junta o id ao que já está em app_settings[calendly], sem apagar o dono', () => {
    expect(sqlDoGoogleAgendaId(AGENDA_DA_IMOVA)).toBe(
      [
        'insert into public.app_settings (key, value)',
        `values ('calendly', '{"google_agenda_id":"${AGENDA_DA_IMOVA}"}')`,
        'on conflict (key) do update',
        '  set value = public.app_settings.value || excluded.value, updated_at = now();',
      ].join('\n'),
    );
    expect(sqlDoGoogleAgendaId("a'b")).toContain(`'{"google_agenda_id":"a''b"}'`);
  });

  it('os argumentos: arquivo solto, --sub, --agenda e o ambiente', () => {
    expect(lerArgumentos(['~/Downloads/chave.json', '--sub', 'a@b.com'])).toMatchObject({
      arquivo: '~/Downloads/chave.json',
      sub: 'a@b.com',
      agenda: AGENDA_DA_IMOVA,
      erro: null,
    });
    expect(
      lerArgumentos(['--credencial', 'c.json', '--agenda', 'x@group.calendar.google.com']),
    ).toMatchObject({
      arquivo: 'c.json',
      agenda: 'x@group.calendar.google.com',
    });
    expect(lerArgumentos([], { GOOGLE_AGENDA_SUB: 'c@d.com' }).sub).toBe('c@d.com');
    expect(lerArgumentos(['--sub']).erro).toBe('Falta o valor de --sub.');
    expect(lerArgumentos(['--qualquer']).erro).toBe('Não conheço a opção --qualquer.');
  });
});
