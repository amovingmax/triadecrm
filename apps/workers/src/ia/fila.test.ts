import { describe, expect, it } from 'vitest';

import { bancoFalso } from './banco-de-teste';
import { chaveDaMensagem, enfileirarTrabalho } from './fila';

import type { MensagemDaFila } from '../fila/esteira';

function mensagem(corpo: Record<string, unknown>, msgId = 42): MensagemDaFila {
  return { msg_id: msgId, entregas: 1, enfileirada_em: '2026-09-05T10:00:00Z', mensagem: corpo };
}

describe('chaveDaMensagem', () => {
  it('reconstrói exatamente a chave que app.ia_enfileirar grava em ingest_dedup', () => {
    expect(
      chaveDaMensagem(mensagem({ purpose: 'classify_inbound', chave: 'msg:abc' })),
    ).toBe('classify_inbound:msg:abc');
  });

  it('sem `chave` no payload, cai no msg_id — trata, mas sem trava de reprocessamento', () => {
    // É o mesmo desfecho do coletor. Fica registrado aqui porque quem enfileirar
    // de SQL precisa pôr a chave DENTRO do payload, e esquecer disso não deve
    // travar a fila — deve custar a idempotência, que é o que o log dirá.
    expect(chaveDaMensagem(mensagem({ purpose: 'classify_inbound' }, 7))).toBe('msg:7');
    expect(chaveDaMensagem(mensagem({ chave: 'msg:abc' }, 7))).toBe('msg:7');
    expect(chaveDaMensagem(mensagem({}, 7))).toBe('msg:7');
  });
});

describe('enfileirarTrabalho', () => {
  it('passa pela porta que conhece o orçamento, e leva a chave no payload', async () => {
    const banco = bancoFalso(
      {},
      { rpcs: { ia_fila_enfileirar: () => ({ enfileirado: true, msg_id: 7 }) } },
    );
    const r = await enfileirarTrabalho(banco.cliente, 'summarize_call', 'attempt:xyz', {
      attempt_id: 'xyz',
    });
    expect(r).toEqual({ enfileirado: true, msg_id: 7 });

    const chamada = banco.chamadasDeRpc.at(-1);
    // `esteira_fila_enfileirar` era a porta larga: pulava a lista de propósitos,
    // o freio do orçamento e a anotação da dívida. Uma porta larga ao lado da
    // estreita é o mesmo que não ter porta.
    expect(chamada?.nome).toBe('ia_fila_enfileirar');
    // `purpose` não vai mais no payload daqui: quem o põe é `app.ia_enfileirar`,
    // com `jsonb_build_object('purpose', p_purpose) || payload`. Pôr nos dois
    // lados seria duas fontes para o mesmo fato.
    expect(chamada?.argumentos).toEqual({
      p_purpose: 'summarize_call',
      p_payload: { attempt_id: 'xyz', chave: 'attempt:xyz' },
      p_key: 'attempt:xyz',
    });
    // E o consumidor continua reconstruindo exatamente a chave do dedup.
    expect(
      chaveDaMensagem(
        mensagem({
          ...(chamada?.argumentos.p_payload as Record<string, unknown>),
          purpose: chamada?.argumentos.p_purpose,
        }),
      ),
    ).toBe('summarize_call:attempt:xyz');
  });

  it('a recusa por orçamento volta como motivo, não como exceção', async () => {
    const banco = bancoFalso(
      {},
      {
        rpcs: {
          ia_fila_enfileirar: () => ({ enfileirado: false, motivo: 'orcamento', adiado: true }),
        },
      },
    );
    await expect(
      enfileirarTrabalho(banco.cliente, 'draft_followup', 'attempt:1', { attempt_id: '1' }),
    ).resolves.toMatchObject({ enfileirado: false, motivo: 'orcamento' });
  });
});
