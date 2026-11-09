import { describe, expect, it } from 'vitest';

import {
  RecusaDoModeloError,
  clienteAnthropic,
  corpoDaRequisicao,
  esquemaParaAApi,
  type PedidoAoModelo,
} from './cliente';
import {
  canalDeChegadaV1,
  fichaDaConversaV1,
  leituraDoClienteV2,
  pulsoDoDiaV1,
  esquemaDeSaida,
} from '@komune/prompts';

/**
 * O esquema que sai daqui é a única parte do pedido que a API valida ANTES de
 * pensar: se ele estiver errado, a chamada morre em 400 e o erro não diz qual
 * prompt foi. O dublê não pega isso — ele responde, não valida.
 *
 * A primeira chamada real de `ficha-da-conversa@v1` descobriu que a saída
 * estruturada recusa `minimum`/`maximum` em `integer`. Este arquivo existe para
 * essa descoberta não precisar ser feita duas vezes, e para o prompt NOVO de
 * amanhã não repetir o mesmo 400.
 */

function achar(no: unknown, encontrou: (n: Record<string, unknown>) => boolean): Record<string, unknown>[] {
  if (Array.isArray(no)) return no.flatMap((i) => achar(i, encontrou));
  if (typeof no !== 'object' || no === null) return [];
  const atual = no as Record<string, unknown>;
  const aqui = encontrou(atual) ? [atual] : [];
  return [...aqui, ...Object.values(atual).flatMap((v) => achar(v, encontrou))];
}

describe('o esquema que vai para a API', () => {
  const RESTRICOES_DE_VALOR = [
    'minimum',
    'maximum',
    'exclusiveMinimum',
    'exclusiveMaximum',
    'minItems',
    'maxItems',
    'minLength',
    'maxLength',
    'pattern',
    'format',
    'multipleOf',
    'uniqueItems',
    'default',
    'examples',
  ];

  it('não leva restrição de valor nenhuma: a API recusa e a lista é descoberta a 400 por vez', () => {
    // O canal de chegada (06/11/2026) tem `pattern` no código do imóvel e `maxItems`
    // nas provas: é o caso que a peneira tem de pegar.
    for (const prompt of [fichaDaConversaV1, pulsoDoDiaV1, canalDeChegadaV1]) {
      const limpo = esquemaParaAApi(esquemaDeSaida(prompt));
      const sobraram = achar(limpo, (n) => RESTRICOES_DE_VALOR.some((k) => k in n));
      expect({ prompt: prompt.id, sobraram }).toEqual({ prompt: prompt.id, sobraram: [] });
    }
  });

  it('mas a FORMA continua inteira: sem ela o modelo não sabe o que devolver', () => {
    const limpo = esquemaParaAApi(esquemaDeSaida(fichaDaConversaV1)) as Record<string, unknown>;
    expect(limpo.type).toBe('object');
    const propriedades = limpo.properties as Record<string, unknown>;
    expect(Object.keys(propriedades)).toContain('scoreIntencao');
    expect(Object.keys(propriedades)).toContain('sinais');
    // Campo que é enum continua com as opções — é o que impede intenção inventada.
    const enums = achar(limpo, (n) => Array.isArray(n.enum));
    expect(enums.length).toBeGreaterThan(0);
    expect(limpo.required).toBeDefined();
  });

  it('e o zod continua recusando o que estiver fora da faixa', () => {
    // A poda é só no que o modelo VÊ. Quem garante a faixa é a volta.
    expect(() =>
      fichaDaConversaV1.saida.parse({
        resumo: 'x',
        intencao: 'AMBIGUO',
        scoreIntencao: 140,
        motivo: 'x',
        sentimento: 'neutro',
        sinais: [],
        objecoes: [],
        etapaSugerida: null,
        compromissosNovos: [],
        compromissosCumpridos: [],
        proximaAcao: { descricao: 'x', prazo: null },
        dadosExtraidos: [],
        alertas: [],
        confianca: 0.5,
        dadosInsuficientes: false,
      }),
    ).toThrow();
  });

  it('$schema não vira tráfego', () => {
    expect('$schema' in esquemaParaAApi(esquemaDeSaida(fichaDaConversaV1))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// O corpo que sai para a API (06/11/2026): imagens e recusa
// ---------------------------------------------------------------------------

interface Capturado {
  readonly url: string;
  readonly corpo: string;
}

/**
 * Um `fetch` de mentira para o SDK de verdade: guarda o corpo EXATO que sairia para a
 * API e devolve a mensagem pedida. Sem rede e sem chave — e sem atalho: o corpo é o
 * que o SDK serializou.
 */
function fetchQueGuarda(resposta: Record<string, unknown>): {
  capturados: Capturado[];
  fetch: (url: unknown, init?: { body?: unknown }) => Promise<Response>;
} {
  const capturados: Capturado[] = [];
  return {
    capturados,
    fetch: async (url, init) => {
      capturados.push({ url: String(url), corpo: typeof init?.body === 'string' ? init.body : '' });
      return await Promise.resolve(
        new Response(JSON.stringify(resposta), {
          status: 200,
          headers: { 'content-type': 'application/json', 'request-id': 'req_teste' },
        }),
      );
    },
  };
}

function mensagemDaApi(extras: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'msg_teste',
    type: 'message',
    role: 'assistant',
    model: 'claude-haiku-5-5',
    content: [{ type: 'text', text: '{"ok":true}' }],
    stop_reason: 'end_turn',
    stop_sequence: null,
    usage: {
      input_tokens: 120,
      output_tokens: 30,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 900,
    },
    ...extras,
  };
}

const PNG_1X1 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

describe('o corpo da requisição', () => {
  const pedido: PedidoAoModelo = {
    modelo: 'claude-haiku-5-5',
    sistema: 'bloco estável, o mesmo em toda chamada',
    mensagem: 'lead: lead-1a2b3c\nMENSAGENS NOVAS:\n[m1] em 06/11 às 14:02 — cliente: Oi',
    maxTokens: 4000,
    esquema: esquemaDeSaida(leituraDoClienteV2),
  };

  /**
   * O corpo como ele saía ANTES de existir imagem (até 05/11/2026), escrito à mão e na
   * mesma ordem de campos. Se este teste quebrar, o cache dos prompts que já rodam muda.
   */
  function corpoDeAntes(p: PedidoAoModelo, esforco: 'low' | undefined): Record<string, unknown> {
    return {
      model: p.modelo,
      max_tokens: p.maxTokens,
      system: [{ type: 'text', text: p.sistema, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: p.mensagem }],
      output_config: {
        format: { type: 'json_schema', schema: esquemaParaAApi(p.esquema) },
        ...(esforco === undefined ? {} : { effort: esforco }),
      },
    };
  }

  it('sem imagem, sai byte a byte igual ao de antes — com e sem esforço', async () => {
    for (const [modelo, esforco] of [
      ['claude-haiku-5-5', 'low'],
      ['claude-haiku-4-5', undefined],
    ] as const) {
      const p = { ...pedido, modelo };
      const { capturados, fetch } = fetchQueGuarda(mensagemDaApi());
      const cliente = clienteAnthropic({ chave: 'chave-de-teste', fetch: fetch as never, tentativas: 0 });
      await cliente.conversar(p);
      // Lista vazia também é "sem imagem".
      await cliente.conversar({ ...p, imagens: [] });

      const esperado = JSON.stringify(corpoDeAntes(p, esforco));
      expect(capturados).toHaveLength(2);
      expect(capturados[0]?.corpo).toBe(esperado);
      expect(capturados[1]?.corpo).toBe(esperado);
      expect(capturados[0]?.url).toMatch(/\/v1\/messages$/);
    }
  });

  it('com imagem, cada foto vem anunciada pelo rótulo, e a mensagem por último', () => {
    const corpo = corpoDaRequisicao({
      ...pedido,
      imagens: [
        { mime: 'image/png', base64: PNG_1X1, rotulo: 'Foto f1, enviada na mensagem m2' },
        { mime: 'image/jpeg', base64: '/9j/4AAQ', rotulo: 'Foto f2, enviada na mensagem m3' },
      ],
    });
    expect(corpo.messages).toEqual([
      {
        role: 'user',
        content: [
          { type: 'text', text: 'Foto f1, enviada na mensagem m2' },
          { type: 'image', source: { type: 'base64', media_type: 'image/png', data: PNG_1X1 } },
          { type: 'text', text: 'Foto f2, enviada na mensagem m3' },
          { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: '/9j/4AAQ' } },
          { type: 'text', text: pedido.mensagem },
        ],
      },
    ]);
    // O resto do corpo não muda por causa da imagem: o sistema continua cacheável.
    const { messages: _imagens, ...resto } = corpo;
    const { messages: _texto, ...semImagem } = corpoDaRequisicao(pedido);
    expect(resto).toEqual(semImagem);
  });

  it('a recusa do modelo vira RecusaDoModeloError, com a categoria e o que ela custou', async () => {
    const { fetch } = fetchQueGuarda(
      mensagemDaApi({
        content: [],
        stop_reason: 'refusal',
        stop_details: { type: 'refusal', category: 'general_harms', explanation: null },
      }),
    );
    const cliente = clienteAnthropic({ chave: 'chave-de-teste', fetch: fetch as never, tentativas: 0 });
    const erro = await cliente.conversar(pedido).catch((e: unknown) => e);
    expect(erro).toBeInstanceOf(RecusaDoModeloError);
    const recusa = erro as RecusaDoModeloError;
    expect(recusa.categoria).toBe('general_harms');
    expect(recusa.uso).toEqual({ entrada: 120, saida: 30, escritaDeCache: 0, leituraDeCache: 900 });
    expect(recusa.aiRunId).toBeNull();
    expect(recusa.registrada(42).aiRunId).toBe(42);
  });

  it('a recusa é lida antes do texto: mesmo com texto que não é JSON, é recusa, não "ilegível"', async () => {
    const { fetch } = fetchQueGuarda(
      mensagemDaApi({ content: [{ type: 'text', text: 'Não posso ajudar.' }], stop_reason: 'refusal' }),
    );
    const cliente = clienteAnthropic({ chave: 'chave-de-teste', fetch: fetch as never, tentativas: 0 });
    const erro = await cliente.conversar(pedido).catch((e: unknown) => e);
    expect(erro).toBeInstanceOf(RecusaDoModeloError);
    expect((erro as RecusaDoModeloError).categoria).toBeNull();
  });

  it('a resposta normal continua sendo lida como antes', async () => {
    const { fetch } = fetchQueGuarda(mensagemDaApi());
    const cliente = clienteAnthropic({ chave: 'chave-de-teste', fetch: fetch as never, tentativas: 0 });
    const resposta = await cliente.conversar(pedido);
    expect(resposta.json).toEqual({ ok: true });
    expect(resposta.uso.leituraDeCache).toBe(900);
    expect(resposta.paradaPor).toBe('end_turn');
  });
});
