import { describe, expect, it, vi } from 'vitest';

import { avisarDasReunioes } from './reuniao-avisos';
import type { AvisoDeReuniao } from './aviso-de-reuniao';
import type { ClienteDoBanco } from './ponte';
import { createLogger } from '../lib/log';

/**
 * O laço que tira o aviso da fila e o manda.
 *
 * O QUE ESTE ARQUIVO PROTEGE
 * ---------------------------------------------------------------------------
 *  1. **Falha transitória volta para a fila.** A reunião já está gravada e já
 *     foi confirmada ao parceiro quando isto roda; o que não pode acontecer é a
 *     mensagem ser arquivada como se tivesse sido entregue — as cinco
 *     tentativas prometidas nunca aconteceriam.
 *  2. **Sucesso marca `aviso_enviado_em` ANTES de arquivar.** Enquanto esse
 *     campo é nulo, o cartão da Agenda diz que ninguém foi avisado.
 *  3. **Aviso desligado ARQUIVA, e não vai para a dead-letter.** Fila que
 *     arquiva o que não tinha para onde ir é fila; fila que manda isso para a
 *     dead-letter é alarme que ninguém mais lê. Sem esta distinção, toda
 *     reunião em qualquer máquina sem Resend — inclusive a local — queimaria
 *     cinco tentativas e cairia em `reuniao_avisos_dlq`.
 *  4. **Sem chave é falha, com o motivo escrito**, para a linha chegar à
 *     dead-letter com o erro junto, que é onde alguém a vê.
 */

const logger = createLogger({ worker: 'wa', level: 'error' });

const AVISO: AvisoDeReuniao = {
  msgId: 7,
  chave: 'reuniao:r1:marcada',
  motivo: 'marcada',
  reuniaoId: 'r1',
  organizationId: 'o1',
  conversationId: 'c1',
  parceiro: 'Buffet Sabor',
  quandoPorExtenso: 'quinta-feira, 1º de outubro, às 10h20',
  quandoCurto: '01/10, 10h20',
  formato: 'online',
  link: 'https://meet.invalid/heloisa',
  local: null,
  estado: 'marcada',
  marcadaPeloRobo: true,
  atende: 'Heloísa',
  emailDoDono: 'heloisa@komune.app.br',
};

const CONFIG_LIGADA = {
  ativo: true,
  de: 'CRM Komune <crm@komune.app.br>',
  para: ['komune@komune.app.br'],
  responder_para: 'komune@komune.app.br',
  url_do_crm: 'https://crm.komune.app.br',
};

/** Um dublê de `ClienteDoBanco` que só sabe responder às RPCs deste laço. */
function duble(config = CONFIG_LIGADA, avisos: AvisoDeReuniao[] = [AVISO]) {
  const chamadas: Array<{ nome: string; args: Record<string, unknown> }> = [];
  const cliente = {
    from: (tabela: string) => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => {
            chamadas.push({ nome: `from:${tabela}`, args: {} });
            return { data: { value: config }, error: null };
          },
        }),
      }),
    }),
    rpc: async (nome: string, args: Record<string, unknown>) => {
      chamadas.push({ nome, args });
      if (nome === 'reuniao_avisos_proximos') {
        return {
          data: avisos.map((a) => ({
            msg_id: a.msgId,
            chave: a.chave,
            motivo: a.motivo,
            reuniao_id: a.reuniaoId,
            organization_id: a.organizationId,
            conversation_id: a.conversationId,
            parceiro: a.parceiro,
            quando_por_extenso: a.quandoPorExtenso,
            quando_curto: a.quandoCurto,
            formato: a.formato,
            link: a.link,
            local: a.local,
            estado: a.estado,
            marcada_pelo_robo: a.marcadaPeloRobo,
            atende: a.atende,
            email_do_dono: a.emailDoDono,
          })),
          error: null,
        };
      }
      if (nome === 'esteira_fila_falhar') {
        return { data: { acao: 'reagendado', tentativa: 1 }, error: null };
      }
      return { data: true, error: null };
    },
  } as unknown as ClienteDoBanco;
  const usou = (nome: string): boolean => chamadas.some((c) => c.nome === nome);
  return { cliente, chamadas, usou };
}

describe('avisarDasReunioes', () => {
  it('Resend 503: devolve à fila e NÃO marca como avisado', async () => {
    const d = duble();
    await avisarDasReunioes(d.cliente, 'chave-do-resend', logger, (async () =>
      new Response('boom', { status: 503 })) as unknown as typeof fetch);
    expect(d.usou('esteira_fila_falhar')).toBe(true);
    expect(d.usou('reuniao_aviso_enviado')).toBe(false);
    expect(d.usou('esteira_fila_concluir')).toBe(false);
  });

  it('Resend 200: marca como avisado e arquiva', async () => {
    const d = duble();
    await avisarDasReunioes(d.cliente, 'chave-do-resend', logger, (async () =>
      new Response('{"id":"1"}', { status: 200 })) as unknown as typeof fetch);
    expect(d.usou('reuniao_aviso_enviado')).toBe(true);
    expect(d.usou('esteira_fila_concluir')).toBe(true);
    expect(d.usou('esteira_fila_falhar')).toBe(false);
  });

  it('aviso desligado: ARQUIVA, e a dead-letter continua vazia', async () => {
    const naoChamar = vi.fn(async () => {
      throw new Error('o cano não devia ter sido aberto');
    }) as unknown as typeof fetch;
    const d = duble({ ...CONFIG_LIGADA, ativo: false });
    await avisarDasReunioes(d.cliente, 'chave-do-resend', logger, naoChamar);
    expect(d.usou('esteira_fila_concluir')).toBe(true);
    expect(d.usou('esteira_fila_falhar')).toBe(false);
    expect(d.usou('reuniao_aviso_enviado')).toBe(false);
  });

  it('sem RESEND_API_KEY: falha com o motivo escrito', async () => {
    const naoChamar = vi.fn(async () => {
      throw new Error('o cano não devia ter sido aberto');
    }) as unknown as typeof fetch;
    const d = duble();
    await avisarDasReunioes(d.cliente, undefined, logger, naoChamar);
    const falha = d.chamadas.find((c) => c.nome === 'esteira_fila_falhar');
    expect(falha).toBeDefined();
    expect(String(falha!.args.p_erro)).toContain('sem_chave');
  });

  it('fila vazia não abre o cano nem fala com o banco de novo', async () => {
    const naoChamar = vi.fn(async () => {
      throw new Error('o cano não devia ter sido aberto');
    }) as unknown as typeof fetch;
    const d = duble(CONFIG_LIGADA, []);
    await avisarDasReunioes(d.cliente, 'chave-do-resend', logger, naoChamar);
    expect(d.usou('esteira_fila_concluir')).toBe(false);
    expect(d.usou('esteira_fila_falhar')).toBe(false);
  });
});
