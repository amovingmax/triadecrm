import { describe, expect, it } from 'vitest';

import type { MensagemCrua } from './mensagens';
import { ehRespostaDoTime, respondidaDepoisDaEntrada } from './por-ler';

/**
 * O "por ler" zera quando sai a resposta, e não quando alguém abre a conversa
 * (05/10/2026). Estes testes fixam o que conta como resposta: errar para mais
 * apaga o sinal de quem ainda espera; errar para menos deixa o número preso.
 */

function mensagem(parcial: Partial<MensagemCrua> = {}): MensagemCrua {
  return {
    id: 'm-1',
    conversation_id: 'fio-1',
    organization_id: null,
    direction: 'out',
    type: 'text',
    status: 'sent',
    body: 'Bom dia!',
    media_path: null,
    media_mime: null,
    transcript: null,
    template_id: null,
    draft_id: null,
    author_kind: 'human',
    sent_by: 'sdr-1',
    approved_by: null,
    is_first_contact: false,
    business_initiated: false,
    optout_confirmation: false,
    origin: 'crm',
    error_code: null,
    error_detail: null,
    created_at: '2026-10-05T12:05:00+00:00',
    sent_at: null,
    delivered_at: null,
    read_at: null,
    failed_at: null,
    ...parcial,
  };
}

const ENTRADA = mensagem({
  id: 'in-1',
  direction: 'in',
  author_kind: 'system',
  sent_by: null,
  status: 'received',
  created_at: '2026-10-05T12:00:00+00:00',
});

describe('o que conta como resposta do time', () => {
  it('texto escrito por gente, mesmo ainda na fila', () => {
    expect(ehRespostaDoTime(mensagem({ status: 'queued' }))).toBe(true);
  });

  it('áudio gravado por gente', () => {
    expect(ehRespostaDoTime(mensagem({ type: 'audio' }))).toBe(true);
  });

  it('rascunho da IA aprovado por gente', () => {
    expect(ehRespostaDoTime(mensagem({ author_kind: 'bot_ai' }))).toBe(true);
  });

  it('não conta: resposta automática, modelo, envio que falhou ou eco', () => {
    expect(ehRespostaDoTime(mensagem({ author_kind: 'bot_fixed' }))).toBe(false);
    expect(ehRespostaDoTime(mensagem({ author_kind: 'system' }))).toBe(false);
    expect(ehRespostaDoTime(mensagem({ type: 'template' }))).toBe(false);
    expect(ehRespostaDoTime(mensagem({ status: 'failed' }))).toBe(false);
    expect(ehRespostaDoTime(mensagem({ origin: 'echo' }))).toBe(false);
  });
});

describe('a última mensagem recebida já foi respondida?', () => {
  it('só recebida, ninguém respondeu: não', () => {
    expect(respondidaDepoisDaEntrada([ENTRADA])).toBe(false);
  });

  it('abrir e ler não muda nada: sem saída, continua não', () => {
    expect(respondidaDepoisDaEntrada([ENTRADA, ENTRADA])).toBe(false);
  });

  it('alguém respondeu depois: sim', () => {
    expect(respondidaDepoisDaEntrada([ENTRADA, mensagem()])).toBe(true);
  });

  it('a resposta automática do mesmo instante não conta', () => {
    const automatica = mensagem({ author_kind: 'bot_fixed', created_at: ENTRADA.created_at });
    expect(respondidaDepoisDaEntrada([ENTRADA, automatica])).toBe(false);
  });

  it('chegou mensagem nova depois da resposta: volta a não', () => {
    const outra = { ...ENTRADA, id: 'in-2', created_at: '2026-10-05T12:10:00+00:00' };
    expect(respondidaDepoisDaEntrada([ENTRADA, mensagem(), outra])).toBe(false);
  });

  it('nada recebido: não há o que zerar', () => {
    expect(respondidaDepoisDaEntrada([mensagem()])).toBe(false);
  });
});
