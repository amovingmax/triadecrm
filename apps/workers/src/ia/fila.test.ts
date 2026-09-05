import { describe, expect, it } from 'vitest';

import { bancoFalso } from './banco-de-teste';
import { chaveDaMensagem, enfileirarTrabalho } from './fila';

import type { MensagemDaFila } from '../ingest/esteira';

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
  it('põe a chave nos DOIS lugares que precisam dela', async () => {
    const banco = bancoFalso({});
    await enfileirarTrabalho(banco.cliente, 'summarize_call', 'attempt:xyz', { attempt_id: 'xyz' });

    const chamada = banco.chamadasDeRpc[0];
    expect(chamada?.nome).toBe('esteira_fila_enfileirar');
    expect(chamada?.argumentos.p_queue).toBe('ai_jobs');
    // O dedup vê "<propósito>:<chave>"…
    expect(chamada?.argumentos.p_key).toBe('summarize_call:attempt:xyz');
    // …e o consumidor vê a mesma chave dentro da mensagem.
    expect(chamada?.argumentos.p_payload).toEqual({
      attempt_id: 'xyz',
      purpose: 'summarize_call',
      chave: 'attempt:xyz',
    });
    expect(
      chaveDaMensagem(mensagem(chamada?.argumentos.p_payload as Record<string, unknown>)),
    ).toBe(chamada?.argumentos.p_key);
  });
});
