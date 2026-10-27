import { describe, expect, it } from 'vitest';

import { montarMensagens, type MensagemCrua } from './mensagens';

/**
 * O fio completado (27/10/2026): a reação vira selo, a resposta cita, a
 * original sabe da correção. Os testes passam por `montarMensagens`, que é o
 * caminho de verdade da linha crua até o balão.
 */

const ANA = 'aaaaaaaa-0000-4000-8000-000000000001';
const NOMES = new Map([[ANA, 'Ana']]);

let relogio = 0;
function linha(parcial: Partial<MensagemCrua> & { id: string }): MensagemCrua {
  relogio += 1;
  return {
    conversation_id: 'f1',
    organization_id: 'o1',
    direction: 'in',
    type: 'text',
    status: 'received',
    body: 'oi',
    media_path: null,
    media_mime: null,
    transcript: null,
    template_id: null,
    draft_id: null,
    author_kind: 'system',
    sent_by: null,
    approved_by: null,
    is_first_contact: false,
    business_initiated: false,
    optout_confirmation: false,
    origin: 'crm',
    error_code: null,
    error_detail: null,
    created_at: `2026-10-27T10:${String(relogio).padStart(2, '0')}:00.000Z`,
    sent_at: null,
    delivered_at: null,
    read_at: null,
    failed_at: null,
    ...parcial,
  };
}

function nossa(parcial: Partial<MensagemCrua> & { id: string }): MensagemCrua {
  return linha({
    direction: 'out',
    status: 'sent',
    author_kind: 'human',
    sent_by: ANA,
    ...parcial,
  });
}

describe('a reação vira selo embaixo da mensagem reagida', () => {
  it('sai do fio e aparece no alvo, uma de cada lado', () => {
    const fio = montarMensagens(
      [
        linha({ id: 'alvo', wa_message_id: 'wamid.A' }),
        linha({ id: 'r1', type: 'reaction', body: '👍', reage_a: 'alvo' }),
        nossa({ id: 'r2', type: 'reaction', body: '❤️', reage_a: 'alvo' }),
      ],
      NOMES,
    );
    expect(fio.map((m) => m.id)).toEqual(['alvo']);
    expect(fio[0]?.reacoes.deles?.emoji).toBe('👍');
    expect(fio[0]?.reacoes.nossa).toEqual({ emoji: '❤️', naFila: false, quem: 'Ana' });
  });

  it('vale a última de cada lado, e a sem emoji tira a reação', () => {
    const fio = montarMensagens(
      [
        linha({ id: 'alvo' }),
        linha({ id: 'r1', type: 'reaction', body: '👍', reage_a: 'alvo' }),
        linha({ id: 'r2', type: 'reaction', body: '😂', reage_a: 'alvo' }),
        nossa({ id: 'r3', type: 'reaction', body: '🙏', reage_a: 'alvo' }),
        nossa({ id: 'r4', type: 'reaction', body: null, reage_a: 'alvo' }),
      ],
      NOMES,
    );
    expect(fio[0]?.reacoes.deles?.emoji).toBe('😂');
    expect(fio[0]?.reacoes.nossa).toBeNull();
  });

  it('acha o alvo pelo wamid quando o vínculo por id ainda não existe', () => {
    const fio = montarMensagens(
      [
        nossa({ id: 'alvo', wa_message_id: 'wamid.X' }),
        linha({ id: 'r1', type: 'reaction', body: '🎉', reage_a_wamid: 'wamid.X' }),
      ],
      NOMES,
    );
    expect(fio).toHaveLength(1);
    expect(fio[0]?.reacoes.deles?.emoji).toBe('🎉');
  });

  it('a nossa que não saiu não conta, e a que está na fila aparece como na fila', () => {
    const [falhou] = montarMensagens(
      [
        linha({ id: 'alvo' }),
        nossa({ id: 'r', type: 'reaction', body: '👍', status: 'failed', reage_a: 'alvo' }),
      ],
      NOMES,
    );
    expect(falhou?.reacoes.nossa).toBeNull();
    const [naFila] = montarMensagens(
      [
        linha({ id: 'alvo' }),
        nossa({ id: 'r', type: 'reaction', body: '👍', status: 'queued', reage_a: 'alvo' }),
      ],
      NOMES,
    );
    expect(naFila?.reacoes.nossa?.naFila).toBe(true);
  });

  it('a reação antiga, sem alvo, e a de alvo fora do que foi carregado continuam balão', () => {
    const fio = montarMensagens(
      [
        linha({ id: 'antiga', type: 'reaction', body: '👍' }),
        linha({ id: 'longe', type: 'reaction', body: '❤️', reage_a: 'nao-carregada' }),
      ],
      NOMES,
    );
    expect(fio.map((m) => m.id)).toEqual(['antiga', 'longe']);
  });
});

describe('a resposta citada sabe quem ela cita', () => {
  it('pelo id, com o autor e o resumo sem assinatura', () => {
    const fio = montarMensagens(
      [
        nossa({ id: 'a', body: '*Ana:*\nO cardápio segue amanhã' }),
        linha({ id: 'b', body: 'Combinado', responde_a: 'a' }),
      ],
      NOMES,
    );
    expect(fio[1]?.citada).toEqual({
      id: 'a',
      entrada: false,
      autor: 'Ana',
      resumo: 'O cardápio segue amanhã',
    });
  });

  it('pelo wamid, e diz o tipo quando não há texto', () => {
    const fio = montarMensagens(
      [
        linha({
          id: 'doc',
          type: 'document',
          body: null,
          media_nome: 'cardapio.pdf',
          wa_message_id: 'w1',
        }),
        nossa({ id: 'r', body: 'Recebido!', responde_a_wamid: 'w1' }),
      ],
      NOMES,
    );
    expect(fio[1]?.citada?.resumo).toBe('Documento: cardapio.pdf');
    expect(fio[1]?.citada?.entrada).toBe(true);
  });

  it('a citada que não está no CRM aparece como tal, sem link', () => {
    const [m] = montarMensagens([linha({ id: 'r', responde_a_wamid: 'w-de-antes' })], NOMES);
    expect(m?.citada).toMatchObject({ id: null, resumo: 'Mensagem que não está no CRM' });
  });

  it('quem não cita nada não tem citação', () => {
    const [m] = montarMensagens([linha({ id: 'r' })], NOMES);
    expect(m?.citada).toBeNull();
  });
});

describe('a correção', () => {
  it('a original aponta para a correção; a cancelada não conta', () => {
    const fio = montarMensagens(
      [
        nossa({ id: 'errada', body: 'Amanhã às 15h' }),
        nossa({
          id: 'certa',
          body: '_Correção:_ Amanhã às 16h',
          corrige_a: 'errada',
          responde_a: 'errada',
        }),
      ],
      NOMES,
    );
    expect(fio[0]?.corrigidaPor).toBe('certa');
    expect(fio[1]?.citada?.id).toBe('errada');

    const [semCorrecao] = montarMensagens(
      [
        nossa({ id: 'errada' }),
        nossa({ id: 'cancelada', corrige_a: 'errada', status: 'failed', error_code: 'cancelada' }),
      ],
      NOMES,
    );
    expect(semCorrecao?.corrigidaPor).toBeNull();
  });
});

describe('as colunas novas chegam ao balão', () => {
  it('apagada, cancelada, encaminhada, ouvida e o conteúdo', () => {
    const [m] = montarMensagens(
      [
        nossa({
          id: 'x',
          type: 'location',
          body: null,
          encaminhada: true,
          apagada_em: '2026-10-27T11:00:00Z',
          apagada_por: ANA,
          conteudo: { latitude: -5.79, longitude: -35.21, nome: 'Buffet Aurora' },
        }),
      ],
      NOMES,
    );
    expect(m).toMatchObject({
      tipo: 'location',
      encaminhada: true,
      apagadaPor: 'Ana',
      cancelada: false,
    });
    expect(m?.conteudo.localizacao).toEqual({
      latitude: -5.79,
      longitude: -35.21,
      nome: 'Buffet Aurora',
      endereco: null,
    });
  });
});
