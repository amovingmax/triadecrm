import { describe, expect, it } from 'vitest';

import { atendenteImovaV7, esquemaDeSaida } from '@komune/prompts';

import { clienteAnthropic, corpoComFerramentas, type PedidoComFerramentas } from './cliente';

/**
 * O corpo de uma volta com ferramentas (a busca no mapa da v7, 23/11/2026), SEM REDE:
 * as ferramentas como a API as recebe, a conversa com `tool_use` e `tool_result`, a
 * última volta sem ferramenta (`tool_choice: none`), e a resposta lida como "pediu
 * ferramenta" ou "respondeu o JSON".
 */

const PEDIDO: PedidoComFerramentas = {
  modelo: 'claude-haiku-5-5',
  sistema: 'regras',
  maxTokens: 2000,
  esquema: esquemaDeSaida(atendenteImovaV7),
  ferramentas: atendenteImovaV7.ferramentas ?? [],
  turnos: [
    { papel: 'usuario', texto: 'mensagens' },
    { papel: 'assistente', conteudo: [{ type: 'tool_use', id: 't1', name: 'buscar_no_mapa', input: { referencia: 'Camurupim' } }] },
    { papel: 'resultados', resultados: [{ id: 't1', texto: '"Camurupim": não achado no mapa.', erro: false }] },
  ],
};

describe('corpoComFerramentas', () => {
  it('declara a ferramenta, mantém o sistema em cache, a saída estruturada e o esforço', () => {
    const corpo = corpoComFerramentas(PEDIDO);
    expect(corpo.tools).toEqual([
      {
        name: 'buscar_no_mapa',
        description: atendenteImovaV7.ferramentas?.[0]?.descricao,
        input_schema: atendenteImovaV7.ferramentas?.[0]?.entrada,
      },
    ]);
    expect(corpo.system).toEqual([{ type: 'text', text: 'regras', cache_control: { type: 'ephemeral' } }]);
    expect(corpo.output_config?.format?.type).toBe('json_schema');
    expect(corpo.output_config?.effort).toBe('low');
    expect('tool_choice' in corpo).toBe(false);
  });

  it('a conversa: o pedido do modelo volta como veio, e o resultado como tool_result', () => {
    const corpo = corpoComFerramentas(PEDIDO);
    expect(corpo.messages).toEqual([
      { role: 'user', content: 'mensagens' },
      { role: 'assistant', content: [{ type: 'tool_use', id: 't1', name: 'buscar_no_mapa', input: { referencia: 'Camurupim' } }] },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: '"Camurupim": não achado no mapa.' }] },
    ]);
    const comErro = corpoComFerramentas({
      ...PEDIDO,
      turnos: [{ papel: 'resultados', resultados: [{ id: 't9', texto: 'falhou', erro: true }] }],
    });
    expect(comErro.messages[0]).toEqual({
      role: 'user',
      content: [{ type: 'tool_result', tool_use_id: 't9', content: 'falhou', is_error: true }],
    });
  });

  it('a última volta: as ferramentas seguem declaradas, mas tool_choice é none', () => {
    const corpo = corpoComFerramentas({ ...PEDIDO, semFerramentas: true });
    expect(corpo.tool_choice).toEqual({ type: 'none' });
    expect(corpo.tools).toHaveLength(1);
  });
});

describe('conversarComFerramentas', () => {
  function cliente(resposta: Record<string, unknown>) {
    const corpos: unknown[] = [];
    const fetch = (async (_url: unknown, init?: { body?: unknown }) => {
      corpos.push(JSON.parse(String(init?.body)));
      return new Response(JSON.stringify(resposta), { status: 200, headers: { 'content-type': 'application/json' } });
    }) as never;
    return { modelo: clienteAnthropic({ chave: 'teste', baseUrl: 'http://dublê.local', fetch }), corpos };
  }
  const usage = { input_tokens: 10, output_tokens: 5, cache_creation_input_tokens: 0, cache_read_input_tokens: 7 };

  it('pedido de ferramenta: devolve as chamadas e os blocos crus para a volta seguinte', async () => {
    const conteudo = [
      { type: 'thinking', thinking: 'procurar', signature: 'assinatura' },
      { type: 'tool_use', id: 'toolu_1', name: 'buscar_no_mapa', input: { referencia: 'Serv Club' } },
    ];
    const { modelo, corpos } = cliente({
      id: 'msg_1',
      type: 'message',
      role: 'assistant',
      model: 'claude-haiku-5-5',
      content: conteudo,
      stop_reason: 'tool_use',
      usage,
    });
    const volta = await modelo.conversarComFerramentas!(PEDIDO);
    expect(volta.tipo).toBe('ferramentas');
    if (volta.tipo !== 'ferramentas') return;
    expect(volta.chamadas).toEqual([{ id: 'toolu_1', nome: 'buscar_no_mapa', entrada: { referencia: 'Serv Club' } }]);
    expect(volta.conteudo).toEqual(conteudo);
    expect(volta.uso).toEqual({ entrada: 10, saida: 5, escritaDeCache: 0, leituraDeCache: 7 });
    expect((corpos[0] as { tools: unknown[] }).tools).toHaveLength(1);
  });

  it('resposta final: o JSON do primeiro bloco de texto', async () => {
    const { modelo } = cliente({
      id: 'msg_2',
      type: 'message',
      role: 'assistant',
      model: 'claude-haiku-5-5',
      content: [{ type: 'text', text: '{"acao":"responder"}' }],
      stop_reason: 'end_turn',
      usage,
    });
    const volta = await modelo.conversarComFerramentas!(PEDIDO);
    expect(volta).toMatchObject({ tipo: 'final', json: { acao: 'responder' }, paradaPor: 'end_turn' });
  });
});
