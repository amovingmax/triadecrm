import { describe, expect, it, vi } from 'vitest';

import { enviarPeloResend, type ConfiguracaoDoAviso } from './aviso-por-email';
import { createLogger } from '../lib/log';

/**
 * O cano do Resend, sozinho.
 *
 * POR QUE ESTE ARQUIVO EXISTE
 * ---------------------------------------------------------------------------
 * `avisarPorEmail` engole o erro e devolve `false`, e para a fila de ENTRADA
 * isso está certo: aviso que derruba a fila é pior que aviso que não chega, e a
 * mensagem do parceiro já está gravada quando aquilo roda.
 *
 * Para uma fila COM RETENTATIVA está errado. Mensagem que "deu certo" é
 * arquivada, e as cinco tentativas prometidas nunca acontecem. Por isso o
 * resultado passa a ser discriminado.
 *
 * E ele não é binário. "Aviso desligado" e "lista de destinatários vazia" NÃO
 * são falha: são configuração. Devolver falha nesses casos mandaria TODA
 * reunião para `reuniao_avisos_dlq` em qualquer ambiente sem Resend — inclusive
 * o local, inclusive o CI. A dead-letter é onde alguém vai olhar: enchê-la de
 * configuração é transformá-la em alarme que ninguém mais lê.
 */

const logger = createLogger({ worker: 'wa', level: 'error' });

const CONFIG: ConfiguracaoDoAviso = {
  ativo: true,
  para: ['komune@komune.app.br'],
  de: 'CRM Komune <crm@komune.app.br>',
  responderPara: 'komune@komune.app.br',
  urlDoCrm: 'https://crm.komune.app.br',
};

const PARA = ['komune@komune.app.br', 'heloisa@komune.app.br'];

const naoChamar = vi.fn(async () => {
  throw new Error('o cano não devia ter sido aberto');
}) as unknown as typeof fetch;

describe('enviarPeloResend', () => {
  it('devolve transitorio no 5xx do Resend, em vez de engolir', async () => {
    const r = await enviarPeloResend(
      'assunto',
      'corpo',
      CONFIG,
      PARA,
      'chave',
      logger,
      (async () => new Response('boom', { status: 503 })) as unknown as typeof fetch,
    );
    expect(r).toEqual({ ok: false, motivo: 'recusado', transitorio: true });
  });

  it('429 também é transitório: limite de taxa passa', async () => {
    const r = await enviarPeloResend(
      'a',
      'c',
      CONFIG,
      PARA,
      'chave',
      logger,
      (async () => new Response('slow down', { status: 429 })) as unknown as typeof fetch,
    );
    expect(r).toEqual({ ok: false, motivo: 'recusado', transitorio: true });
  });

  it('não é transitório no 4xx: repetir não conserta chave errada nem domínio não verificado', async () => {
    const r = await enviarPeloResend(
      'a',
      'c',
      CONFIG,
      PARA,
      'chave',
      logger,
      (async () =>
        new Response('{"message":"domain not verified"}', {
          status: 422,
        })) as unknown as typeof fetch,
    );
    expect(r).toEqual({ ok: false, motivo: 'recusado', transitorio: false });
  });

  it('erro de rede é transitório', async () => {
    const r = await enviarPeloResend(
      'a',
      'c',
      CONFIG,
      PARA,
      'chave',
      logger,
      (async () => {
        throw new Error('ECONNRESET');
      }) as unknown as typeof fetch,
    );
    expect(r).toEqual({ ok: false, motivo: 'recusado', transitorio: true });
  });

  it('o 200 abre o cano uma vez só, com os destinatários que recebeu por fora', async () => {
    const chamadas: Array<{ url: string; corpo: Record<string, unknown> }> = [];
    const r = await enviarPeloResend('assunto', 'corpo', CONFIG, PARA, 'chave', logger, (async (
      url: string,
      init: { body: string },
    ) => {
      chamadas.push({ url, corpo: JSON.parse(init.body) as Record<string, unknown> });
      return new Response('{"id":"1"}', { status: 200 });
    }) as unknown as typeof fetch);
    expect(r).toEqual({ ok: true });
    expect(chamadas).toHaveLength(1);
    expect(chamadas[0]!.corpo.to).toEqual(PARA);
    expect(chamadas[0]!.corpo.subject).toBe('assunto');
  });

  it('aviso desligado NÃO é falha: é configuração', async () => {
    const r = await enviarPeloResend(
      'a',
      'c',
      { ...CONFIG, ativo: false },
      PARA,
      'chave',
      logger,
      naoChamar,
    );
    expect(r).toEqual({ ok: false, motivo: 'desligado', transitorio: false });
  });

  it('lista de destinatários vazia também é "desligado"', async () => {
    const r = await enviarPeloResend('a', 'c', CONFIG, [], 'chave', logger, naoChamar);
    expect(r).toEqual({ ok: false, motivo: 'desligado', transitorio: false });
  });

  it('sem RESEND_API_KEY é falha, e não é transitória', async () => {
    const r = await enviarPeloResend('a', 'c', CONFIG, PARA, undefined, logger, naoChamar);
    expect(r).toEqual({ ok: false, motivo: 'sem_chave', transitorio: false });
  });
});
