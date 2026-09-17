import { describe, expect, it } from 'vitest';

import {
  assinatura,
  lerEvento,
  pendenciaVazia,
  somarAoPendente,
  type EventoDoEco,
} from './eco-do-banco';

/**
 * O que estes testes protegem.
 *
 * O eco decide DUAS coisas, e as duas erram calado se ninguém as fixar: o que
 * recarregar (errar aqui é a tela não atualizar, ou atualizar a conversa
 * errada) e quando avisar (errar aqui é anunciar a mensagem que a pessoa está
 * lendo, ou calar sobre a que ela não viu).
 *
 * O socket em si não é testado aqui — quem o prova é o banco, com a publicação,
 * e o navegador, com a conversa aberta.
 */

describe('ler o evento', () => {
  it('em `conversations` o id É o fio', () => {
    const evento = lerEvento('conversations', { id: 'fio-1', organization_id: 'org-1' }, false);
    expect(evento).toEqual({
      tabela: 'conversations',
      conversaId: 'fio-1',
      organizacaoId: 'org-1',
      respostaDoParceiro: false,
    });
  });

  it('nas outras, o fio vem em `conversation_id`', () => {
    const evento = lerEvento(
      'message_drafts',
      { id: 'rascunho-1', conversation_id: 'fio-9', organization_id: 'org-9' },
      true,
    );
    expect(evento?.conversaId).toBe('fio-9');
    expect(evento?.organizacaoId).toBe('org-9');
    // Rascunho é o robô redigindo, não o parceiro respondendo: não vira aviso.
    expect(evento?.respostaDoParceiro).toBe(false);
  });

  it('só mensagem NOVA e de ENTRADA conta como resposta do parceiro', () => {
    const entrada = { conversation_id: 'f', organization_id: 'o', direction: 'in' };
    expect(lerEvento('messages', entrada, true)?.respostaDoParceiro).toBe(true);
    // Recibo de entrega é UPDATE na mesma linha: a tela atualiza, ninguém avisa.
    expect(lerEvento('messages', entrada, false)?.respostaDoParceiro).toBe(false);
    // O que NÓS mandamos não é resposta de ninguém.
    expect(
      lerEvento('messages', { ...entrada, direction: 'out' }, true)?.respostaDoParceiro,
    ).toBe(false);
  });

  it('registro sem id nenhum não vira busca no escuro', () => {
    expect(lerEvento('messages', { direction: 'in' }, true)).toBeNull();
    expect(lerEvento('messages', null, true)).toBeNull();
    expect(lerEvento('messages', 'não é objeto', true)).toBeNull();
  });

  it('conversa fora da base não tem ficha, e ainda assim atualiza a lista', () => {
    // `organization_id` nulo é o fio de quem não está na base (RF-CON-06): a
    // lista precisa saber, e não há linha do tempo de parceiro para buscar.
    const evento = lerEvento(
      'messages',
      { conversation_id: 'fio-solto', organization_id: null, direction: 'in' },
      true,
    );
    expect(evento?.conversaId).toBe('fio-solto');
    expect(evento?.organizacaoId).toBeNull();
  });
});

describe('juntar a rajada', () => {
  const resposta = (org: string | null): EventoDoEco => ({
    tabela: 'messages',
    conversaId: 'f',
    organizacaoId: org,
    respostaDoParceiro: true,
  });

  it('cinco eventos viram uma busca da lista e uma por parceiro', () => {
    const pendencia = pendenciaVazia();
    somarAoPendente(pendencia, resposta('org-1'));
    somarAoPendente(pendencia, resposta('org-1'));
    somarAoPendente(pendencia, resposta('org-2'));
    somarAoPendente(pendencia, {
      tabela: 'conversations',
      conversaId: 'f',
      organizacaoId: 'org-1',
      respostaDoParceiro: false,
    });

    expect(pendencia.lista).toBe(true);
    expect([...pendencia.organizacoes].sort()).toEqual(['org-1', 'org-2']);
    expect(pendencia.respostas).toHaveLength(3);
  });

  it('a leitura da IA recarrega a lista TAMBÉM — porque a lista passou a mostrá-la', () => {
    // Este teste fixava o contrário até a lista ganhar a linha de "próxima ação".
    // Enquanto o conselho só existia dentro da conversa, recarregar a lista por
    // causa dele era desperdício; agora é o oposto — não recarregar deixaria o
    // conselho velho justamente onde a pessoa decide com quem falar.
    const pendencia = pendenciaVazia();
    somarAoPendente(pendencia, {
      tabela: 'ficha_da_conversa',
      conversaId: 'fio-7',
      organizacaoId: 'org-7',
      respostaDoParceiro: false,
    });
    expect(pendencia.lista).toBe(true);
    expect([...pendencia.organizacoes]).toEqual(['org-7']);
    expect([...pendencia.fios]).toEqual(['fio-7']);
  });

  it('qualquer evento recarrega a lista: ordem, prévia e "por ler" mudam com todos', () => {
    const pendencia = pendenciaVazia();
    expect(pendencia.lista).toBe(false);
    somarAoPendente(pendencia, {
      tabela: 'messages',
      conversaId: 'f',
      organizacaoId: null,
      respostaDoParceiro: false,
    });
    expect(pendencia.lista).toBe(true);
    expect(pendencia.organizacoes.size).toBe(0);
  });
});

describe('a assinatura da sondagem de reserva', () => {
  it('muda quando chega mensagem e quando um rascunho entra na fila', () => {
    const antes = assinatura('2026-09-17T12:00:00Z', 2);
    expect(assinatura('2026-09-17T12:00:00Z', 2)).toBe(antes);
    expect(assinatura('2026-09-17T12:00:05Z', 2)).not.toBe(antes);
    expect(assinatura('2026-09-17T12:00:00Z', 3)).not.toBe(antes);
  });

  it('banco sem conversa nenhuma tem assinatura estável, e não "sempre mudou"', () => {
    expect(assinatura(null, 0)).toBe(assinatura(null, 0));
  });
});
