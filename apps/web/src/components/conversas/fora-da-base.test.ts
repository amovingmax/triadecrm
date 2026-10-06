import { describe, expect, it } from 'vitest';

import {
  conversasForaDaBase,
  fraseDoResultado,
  MOTIVOS_DA_FICHA,
  nomeDoCliente,
} from './fora-da-base-dados';
import type { FioCru } from './mensagens';
import { escopoInicialDe, estadoDaUrl, urlDoEstado, FILTROS_VAZIOS } from './tipos';

/**
 * A aba "Fora da base" (migração 20260915130000): quem escreveu e não é ficha.
 *
 *  1. Só a conversa SEM ficha entra, a mais recente em cima.
 *  2. Aparece o nome do perfil do WhatsApp; sem ele, o número inteiro.
 *  3. Toda recusa do banco tem frase, e a aba sobrevive ao link.
 */

function fio(parcial: Partial<FioCru>): FioCru {
  return {
    id: 'f',
    organization_id: null,
    contact_id: null,
    channel: 'whatsapp',
    peer_phone_e164: '+5584999994698',
    peer_nome: null,
    arquivada_em: null,
    business_number: '+5584999318888',
    assignee_id: 'u',
    setor_id: null,
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

describe('nomeDoCliente', () => {
  it('o nome do perfil, quando a pessoa deixou um', () => {
    expect(nomeDoCliente(fio({ peer_nome: ' Maria Souza ' }))).toBe('Maria Souza');
  });

  it('sem nome, o número inteiro — não "terminado em 4698"', () => {
    expect(nomeDoCliente(fio({}))).toBe('+55 84 99999-4698');
    expect(nomeDoCliente(fio({ peer_nome: '   ' }))).toBe('+55 84 99999-4698');
  });

  it('número de fora do Brasil aparece como chegou', () => {
    expect(nomeDoCliente(fio({ peer_phone_e164: '+351912345678' }))).toBe('+351912345678');
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

  it('?cliente=<conversa> abre a conversa de quem não é ficha, e volta para a URL', () => {
    expect(estadoDaUrl({ cliente: 'fio-9' }).clienteId).toBe('fio-9');
    expect(estadoDaUrl({}).clienteId).toBeNull();
    expect(urlDoEstado(FILTROS_VAZIOS, null, 'conversas', 'fio-9')).toBe('?cliente=fio-9');
    // Com uma ficha aberta, quem vale é ela: as duas não ficam abertas juntas.
    expect(urlDoEstado(FILTROS_VAZIOS, 'org-1', 'conversas', 'fio-9')).toBe('?org=org-1');
  });
});

describe('com que recorte a tela de Conversas abre', () => {
  it('quem atende abre em "Minhas"', () => {
    expect(escopoInicialDe('admin')).toBe('minhas');
    expect(escopoInicialDe('gestor')).toBe('minhas');
    expect(escopoInicialDe('sdr')).toBe('minhas');
    expect(escopoInicialDe('embaixador')).toBe('minhas');
  });

  it('leitura e financeiro não atendem ninguém: abrem em "Todas"', () => {
    expect(escopoInicialDe('leitura')).toBe('todas');
    expect(escopoInicialDe('financeiro')).toBe('todas');
  });

  it('sem `?ver=`, vale o padrão de quem abriu', () => {
    expect(estadoDaUrl({}, 'minhas').filtros.escopo).toBe('minhas');
    expect(estadoDaUrl({}, 'todas').filtros.escopo).toBe('todas');
    // Um link direto para uma conversa também não traz `ver`.
    expect(estadoDaUrl({ org: 'org-1' }, 'minhas').filtros.escopo).toBe('minhas');
  });

  it('a escolha da pessoa vence o padrão, e valor estranho cai nele', () => {
    expect(estadoDaUrl({ ver: 'todas' }, 'minhas').filtros.escopo).toBe('todas');
    expect(estadoDaUrl({ ver: 'setor' }, 'minhas').filtros.escopo).toBe('setor');
    expect(estadoDaUrl({ ver: 'qualquer-coisa' }, 'minhas').filtros.escopo).toBe('minhas');
  });

  it('o endereço omite o padrão e guarda só a escolha diferente', () => {
    const minhas = { ...FILTROS_VAZIOS, escopo: 'minhas' as const };
    const todas = { ...FILTROS_VAZIOS, escopo: 'todas' as const };
    expect(urlDoEstado(minhas, null, 'conversas', null, 'minhas')).toBe('');
    expect(urlDoEstado(todas, null, 'conversas', null, 'minhas')).toBe('?ver=todas');
    // Para quem abre em "Todas" (leitura), nada muda em relação a antes.
    expect(urlDoEstado(todas, null, 'conversas', null, 'todas')).toBe('');
    expect(urlDoEstado(minhas, null, 'conversas', null, 'todas')).toBe('?ver=minhas');
  });

  it('ida e volta: o que o endereço guarda é o que a leitura devolve', () => {
    for (const escopo of ['minhas', 'setor', 'todas'] as const) {
      const url = urlDoEstado({ ...FILTROS_VAZIOS, escopo }, null, 'conversas', null, 'minhas');
      const params = Object.fromEntries(new URLSearchParams(url));
      expect(estadoDaUrl(params, 'minhas').filtros.escopo).toBe(escopo);
    }
  });

  it('"Limpar filtros" continua levando a "Todas"', () => {
    expect(FILTROS_VAZIOS.escopo).toBe('todas');
  });
});
