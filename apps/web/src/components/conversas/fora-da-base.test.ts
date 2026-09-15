import { describe, expect, it } from 'vitest';

import {
  conversasForaDaBase,
  finalDoNumero,
  fraseDoResultado,
  MOTIVOS_DA_FICHA,
} from './fora-da-base-dados';
import type { FioCru } from './mensagens';
import { estadoDaUrl, urlDoEstado, FILTROS_VAZIOS } from './tipos';

/**
 * A aba "Fora da base" (migração 20260915130000): quem escreveu e não é ficha.
 *
 *  1. Só a conversa SEM ficha entra, a mais recente em cima.
 *  2. O número não aparece inteiro (RF-BAS-14): o banco usa o da conversa.
 *  3. Toda recusa do banco tem frase, e a aba sobrevive ao link.
 */

function fio(parcial: Partial<FioCru>): FioCru {
  return {
    id: 'f',
    organization_id: null,
    contact_id: null,
    channel: 'whatsapp',
    peer_phone_e164: '+5584999994698',
    business_number: '+5584999318888',
    assignee_id: 'u',
    status: 'aguardando_nos',
    bot_paused: false,
    last_message_at: null,
    last_inbound_at: null,
    last_outbound_at: null,
    window_expires_at: null,
    unread_count: 0,
    ai_summary: null,
    ai_intent: null,
    ai_confidence: null,
    ...parcial,
  };
}

describe('conversasForaDaBase', () => {
  it('só as sem ficha, a mais recente primeiro', () => {
    const lista = conversasForaDaBase([
      fio({ id: 'a', last_message_at: '2026-09-15T10:00:00Z' }),
      fio({ id: 'b', organization_id: 'org', last_message_at: '2026-09-15T12:00:00Z' }),
      fio({ id: 'c', last_message_at: '2026-09-15T11:00:00Z' }),
      fio({ id: 'd' }),
    ]);
    expect(lista.map((f) => f.id)).toEqual(['c', 'a', 'd']);
  });
});

describe('finalDoNumero', () => {
  it('mostra só os quatro últimos dígitos', () => {
    expect(finalDoNumero('+5584999994698')).toBe('terminado em 4698');
    expect(finalDoNumero('')).toBe('sem número');
  });
});

describe('as recusas', () => {
  it('cada motivo que o banco devolve tem frase', () => {
    for (const motivo of [
      'conversa_inexistente',
      'ja_vinculada',
      'ficha_inexistente',
      'telefone_suprimido',
      'telefone_ja_cadastrado',
      'telefone_de_contato_existente',
      'categoria_invalida',
      'nome_obrigatorio',
    ]) {
      expect(MOTIVOS_DA_FICHA[motivo], motivo).toBeTruthy();
    }
    expect(fraseDoResultado({ ok: false, motivo: 'algo_novo' })).toBe(
      'Não deu para concluir. Tente de novo.',
    );
  });
});

describe('a aba na URL', () => {
  it('?aba=fora abre na aba e volta para a URL', () => {
    expect(estadoDaUrl({ aba: 'fora' }).aba).toBe('fora');
    expect(urlDoEstado(FILTROS_VAZIOS, null, 'fora')).toBe('?aba=fora');
  });
});
