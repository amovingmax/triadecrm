/**
 * O WhatsApp completo (27/10/2026), do lado do worker: a forma de cada tipo
 * novo, o corpo que vai para a Graph API, o cancelamento que chega antes do
 * envio, e as ações que não são mensagem (ler, digitando, bloquear, grupos).
 *
 * Sem rede e sem banco: o banco e a Graph são dublês de uma função só.
 */
import { describe, expect, it, vi } from 'vitest';

import { ClienteDaGraph, type Envio, type RespostaDaGraph } from './graph';
import { contatosDoConteudo, contagensDaSaidaZeradas, drenarSaida, formaDoEnvio } from './saida';
import { falhaDoBloqueio, fazerAcao, fazerAcoes, type ContextoDasAcoes } from './acoes';
import { prepararArquivo } from './midia-de-saida';
import { extensaoDoMime, tipoParaOBalde } from './entrada';
import { CONFIG_DE_ENVIO_PADRAO } from './ponte';
import { createLogger } from '../lib/log';

import type { AcaoDoWhatsapp, ClienteDoBanco, ItemDeSaida } from './ponte';

const silencioso = createLogger({ worker: 'teste', level: 'error', stdout: () => {}, stderr: () => {} });

function item(parcial: Partial<ItemDeSaida> = {}): ItemDeSaida {
  return {
    msg_id: 9,
    message_id: '33333333-3333-4333-8333-333333333333',
    conversation_id: '44444444-4444-4444-8444-444444444444',
    business_number: '+5584999880011',
    para: '+5584988776655',
    tipo: 'text',
    corpo: 'Oi',
    template_params: [],
    audio_asset_id: null,
    media_path: null,
    media_mime: null,
    janela_aberta: true,
    modelo: null,
    botoes: [],
    link_codigo: 'crm',
    responde_a_wamid: null,
    reage_a_wamid: null,
    conteudo: null,
    media_nome: null,
    tipo_na_meta: null,
    ...parcial,
  };
}

function envioDe(i: ItemDeSaida): Envio {
  const f = formaDoEnvio(i);
  if (!f.ok) throw new Error(`sem forma: ${f.codigo}`);
  return f.envio;
}

describe('a forma dos tipos novos', () => {
  it('responder citando vale para qualquer tipo: vira `context` na Graph', () => {
    const p = ClienteDaGraph.payloadDoEnvio(envioDe(item({ responde_a_wamid: 'wamid.CITADA' })));
    expect(p.context).toEqual({ message_id: 'wamid.CITADA' });
    expect(p.type).toBe('text');
  });

  it('a reação aponta para a mensagem, e emoji vazio tira a reação', () => {
    const p = ClienteDaGraph.payloadDoEnvio(
      envioDe(item({ tipo: 'reaction', corpo: '👍', reage_a_wamid: 'wamid.ALVO' })),
    );
    expect(p).toMatchObject({ type: 'reaction', reaction: { message_id: 'wamid.ALVO', emoji: '👍' } });
    const tirar = ClienteDaGraph.payloadDoEnvio(
      envioDe(item({ tipo: 'reaction', corpo: null, reage_a_wamid: 'wamid.ALVO' })),
    );
    expect(tirar).toMatchObject({ reaction: { emoji: '' } });
    expect(tirar.context).toBeUndefined();
  });

  it('reação sem alvo na Meta não sai', () => {
    const f = formaDoEnvio(item({ tipo: 'reaction', corpo: '👍' }));
    expect(f.ok).toBe(false);
    if (!f.ok) expect(f.codigo).toBe('reacao_sem_alvo');
  });

  it('localização com nome e endereço', () => {
    const p = ClienteDaGraph.payloadDoEnvio(
      envioDe(
        item({
          tipo: 'location',
          corpo: null,
          conteudo: { latitude: -5.79, longitude: -35.2, nome: 'Espaço Lagoa', endereco: 'Av. Roberto Freire' },
        }),
      ),
    );
    expect(p).toMatchObject({
      type: 'location',
      location: { latitude: -5.79, longitude: -35.2, name: 'Espaço Lagoa', address: 'Av. Roberto Freire' },
    });
  });

  it('o cartão de contato no formato da Meta', () => {
    const p = ClienteDaGraph.payloadDoEnvio(
      envioDe(
        item({
          tipo: 'contacts',
          corpo: null,
          conteudo: { contatos: [{ nome: 'Marta Buffet', telefones: [{ numero: '+5584999990000' }] }] },
        }),
      ),
    );
    expect(p).toMatchObject({
      type: 'contacts',
      contacts: [
        {
          name: { formatted_name: 'Marta Buffet', first_name: 'Marta' },
          phones: [{ phone: '+5584999990000', type: 'CELL' }],
        },
      ],
    });
  });

  it('contatos sem telefone ficam de fora do cartão', () => {
    expect(contatosDoConteudo({ contatos: [{ nome: 'Sem número', telefones: [] }, { nome: 'Ok', telefones: ['84999'] }] }))
      .toEqual([{ nome: 'Ok', telefones: [{ numero: '84999' }] }]);
  });

  it('botões: ids posicionais e título do jeito que a pessoa escreveu', () => {
    const p = ClienteDaGraph.payloadDoEnvio(
      envioDe(
        item({
          tipo: 'interactive',
          corpo: 'Qual dia fica melhor?',
          conteudo: { interativo: { tipo: 'botoes', botoes: ['Segunda', 'Terça'] } },
        }),
      ),
    );
    expect(p).toMatchObject({
      type: 'interactive',
      interactive: {
        type: 'button',
        body: { text: 'Qual dia fica melhor?' },
        action: {
          buttons: [
            { type: 'reply', reply: { id: 'b1', title: 'Segunda' } },
            { type: 'reply', reply: { id: 'b2', title: 'Terça' } },
          ],
        },
      },
    });
  });

  it('lista de opções e pedir localização', () => {
    const lista = ClienteDaGraph.payloadDoEnvio(
      envioDe(
        item({
          tipo: 'interactive',
          corpo: 'Escolha',
          conteudo: { interativo: { tipo: 'lista', botao: 'Ver opções', itens: [{ titulo: 'Buffet', descricao: 'Até 100' }] } },
        }),
      ),
    );
    expect(lista).toMatchObject({
      interactive: {
        type: 'list',
        action: { button: 'Ver opções', sections: [{ rows: [{ id: 'l1', title: 'Buffet', description: 'Até 100' }] }] },
      },
    });
    const pedir = ClienteDaGraph.payloadDoEnvio(
      envioDe(item({ tipo: 'interactive', corpo: 'Onde é?', conteudo: { interativo: { tipo: 'pedir_localizacao' } } })),
    );
    expect(pedir).toMatchObject({
      interactive: { type: 'location_request_message', action: { name: 'send_location' } },
    });
  });

  it('documento leva o nome do arquivo; figurinha vai como sticker', () => {
    const doc = formaDoEnvio(item({ tipo: 'document', corpo: 'O contrato', media_path: 'c/1.pdf', media_nome: 'contrato.pdf' }));
    expect(doc).toEqual({
      ok: true,
      envio: { para: '+5584988776655', tipo: 'documento', nome: 'contrato.pdf', legenda: 'O contrato' },
    });
    const fig = formaDoEnvio(item({ tipo: 'image', tipo_na_meta: 'sticker', corpo: null, media_path: 'c/2.webp' }));
    expect(fig).toEqual({ ok: true, envio: { para: '+5584988776655', tipo: 'figurinha' } });
    expect(ClienteDaGraph.payloadDoEnvio({ tipo: 'figurinha', para: '+55', mediaId: 'm1' })).toMatchObject({
      type: 'sticker',
      sticker: { id: 'm1' },
    });
  });

  it('nada disso sai fora da janela de 24 h', () => {
    for (const i of [
      item({ tipo: 'reaction', corpo: '👍', reage_a_wamid: 'w', janela_aberta: false }),
      item({ tipo: 'location', conteudo: { latitude: 1, longitude: 1 }, janela_aberta: false }),
      item({ tipo: 'document', media_path: 'x', janela_aberta: false }),
      item({ tipo: 'interactive', conteudo: { interativo: { tipo: 'pedir_localizacao' } }, janela_aberta: false }),
    ]) {
      expect(formaDoEnvio(i).ok).toBe(false);
    }
  });

  it('a mensagem de grupo vai com recipient_type group', () => {
    const p = ClienteDaGraph.payloadDoEnvio({ tipo: 'texto', para: 'G1', grupo: true, corpo: 'Bom dia' });
    expect(p).toMatchObject({ recipient_type: 'group', to: 'G1', type: 'text' });
  });
});

describe('documento e figurinha antes da Meta', () => {
  const bytes = new Uint8Array([1, 2, 3]);
  it('documento de tipo que a Meta aceita passa com o nome dado', () => {
    expect(prepararArquivo('document', { bytes, mime: 'application/pdf', nome: 'cardapio.pdf' }).nome).toBe('cardapio.pdf');
  });
  it('figurinha que não é webp é recusada com o motivo', () => {
    expect(() => prepararArquivo('sticker', { bytes, mime: 'image/png' })).toThrow(/webp/u);
  });
  it('o balde guarda o tipo desconhecido como octet-stream, e o docx com a extensão certa', () => {
    expect(tipoParaOBalde('application/x-rar-compressed')).toBe('application/octet-stream');
    expect(
      extensaoDoMime('application/vnd.openxmlformats-officedocument.wordprocessingml.document'),
    ).toBe('.docx');
  });
});

describe('o cancelamento chega antes do envio', () => {
  it('apagada enquanto esperava: não chama a Meta e tira da fila', async () => {
    const chamadas: string[] = [];
    const cliente = {
      rpc: (nome: string) => {
        chamadas.push(nome);
        if (nome === 'wa_saida_proximos') {
          return Promise.resolve({ data: { itens: [item()], recusados: [] }, error: null });
        }
        if (nome === 'wa_saida_ainda_vale') return Promise.resolve({ data: false, error: null });
        return Promise.resolve({ data: { ok: true }, error: null });
      },
    } as unknown as ClienteDoBanco;
    const enviar = vi.fn();
    await drenarSaida(
      {
        cliente,
        graph: { enviar } as unknown as ClienteDaGraph,
        logger: silencioso,
        config: CONFIG_DE_ENVIO_PADRAO,
        dormir: async () => {},
      },
      5,
      contagensDaSaidaZeradas(),
    );
    expect(enviar).not.toHaveBeenCalled();
    expect(chamadas).toContain('wa_saida_falha_definitiva');
    expect(chamadas).not.toContain('wa_saida_sucesso');
  });
});

function acao(parcial: Partial<AcaoDoWhatsapp>): AcaoDoWhatsapp {
  return {
    id: 1,
    tipo: 'ler',
    tentativa: 1,
    dados: {},
    conversation_id: null,
    para: null,
    grupo_id: null,
    group_id: null,
    mensagem: null,
    ...parcial,
  };
}

function graphFalsa(resposta: RespostaDaGraph = { ok: true, json: {}, httpStatus: 200 }) {
  const chamadas: { metodo: string; caminho: string; corpo?: unknown }[] = [];
  const g = {
    marcarLida: vi.fn(async (wamid: string, digitando: boolean) => {
      chamadas.push({ metodo: 'ler', caminho: wamid, corpo: digitando });
      return resposta;
    }),
    bloquear: vi.fn(async (numeros: string[], bloquear: boolean) => {
      chamadas.push({ metodo: bloquear ? 'bloquear' : 'desbloquear', caminho: numeros.join(',') });
      return resposta;
    }),
    publicar: vi.fn(async (caminho: string, corpo: unknown) => {
      chamadas.push({ metodo: 'POST', caminho, corpo });
      return resposta;
    }),
    remover: vi.fn(async (caminho: string, corpo: unknown) => {
      chamadas.push({ metodo: 'DELETE', caminho, corpo });
      return resposta;
    }),
    ler: vi.fn(async (caminho: string) => {
      chamadas.push({ metodo: 'GET', caminho });
      return resposta;
    }),
    enviar: vi.fn(async () => ({ ok: true as const, wamid: 'wamid.G' })),
  };
  return { graph: g as unknown as ClienteDaGraph, chamadas };
}

function contextoDasAcoes(graph: ClienteDaGraph, cliente?: ClienteDoBanco): ContextoDasAcoes {
  return {
    cliente: cliente ?? ({} as ClienteDoBanco),
    graph,
    logger: silencioso,
    phoneNumberId: 'PN1',
  };
}

describe('as ações que não são mensagem', () => {
  it('"digitando…" marca como lida e mostra os pontinhos na mesma chamada', async () => {
    const { graph, chamadas } = graphFalsa();
    const r = await fazerAcao(contextoDasAcoes(graph), acao({ tipo: 'digitando', dados: { wamid: 'wamid.IN' } }));
    expect(r.ok).toBe(true);
    expect(chamadas).toEqual([{ metodo: 'ler', caminho: 'wamid.IN', corpo: true }]);
  });

  it('a Meta responde 200 sem bloquear: vira falha com a frase dela', async () => {
    const json = {
      block_users: {
        failed_users: [{ input: '+55', errors: [{ message: 'Re-engagement message', code: 131047 }] }],
      },
    };
    expect(falhaDoBloqueio(json)).toBe('Re-engagement message');
    const { graph } = graphFalsa({ ok: true, json, httpStatus: 200 });
    const r = await fazerAcao(contextoDasAcoes(graph), acao({ tipo: 'bloquear', dados: { para: '+5584988776655' } }));
    expect(r).toMatchObject({ ok: false, codigo: 'bloqueio_recusado', retentar: false });
  });

  it('criar o grupo manda nome, descrição e aprovação; o id chega pelo webhook', async () => {
    const { graph, chamadas } = graphFalsa({ ok: true, json: { request_id: 'REQ1' }, httpStatus: 200 });
    const r = await fazerAcao(
      contextoDasAcoes(graph),
      acao({ tipo: 'grupo_criar', dados: { assunto: 'Réveillon', aprovacao: 'approval_required' } }),
    );
    expect(chamadas[0]).toEqual({
      metodo: 'POST',
      caminho: 'PN1/groups',
      corpo: { messaging_product: 'whatsapp', subject: 'Réveillon', join_approval_mode: 'approval_required' },
    });
    expect(r).toEqual({ ok: true, resultado: { request_id: 'REQ1', id: null } });
  });

  it('ação de grupo que a Meta ainda não criou não sai', async () => {
    const { graph, chamadas } = graphFalsa();
    const r = await fazerAcao(contextoDasAcoes(graph), acao({ tipo: 'grupo_convite' }));
    expect(r).toMatchObject({ ok: false, codigo: 'grupo_sem_id' });
    expect(chamadas).toHaveLength(0);
  });

  it('tirar do grupo e recusar pedido são DELETE com corpo', async () => {
    const { graph, chamadas } = graphFalsa();
    await fazerAcao(contextoDasAcoes(graph), acao({ tipo: 'grupo_remover', group_id: 'G1', dados: { wa_ids: ['5584'] } }));
    await fazerAcao(contextoDasAcoes(graph), acao({ tipo: 'grupo_recusar', group_id: 'G1', dados: { pedidos: ['J1'] } }));
    expect(chamadas).toEqual([
      { metodo: 'DELETE', caminho: 'G1/participants', corpo: { messaging_product: 'whatsapp', participants: [{ user: '5584' }] } },
      { metodo: 'DELETE', caminho: 'G1/join_requests', corpo: { messaging_product: 'whatsapp', join_requests: ['J1'] } },
    ]);
  });

  it('mensagem de grupo apagada antes de sair não vai', async () => {
    const { graph } = graphFalsa();
    const r = await fazerAcao(
      contextoDasAcoes(graph),
      acao({ tipo: 'grupo_enviar', group_id: 'G1', mensagem: { type: 'text', body: 'oi', ainda_vale: false } }),
    );
    expect(r).toMatchObject({ ok: false, codigo: 'cancelada' });
  });

  it('a passada conclui o que deu certo e manda a falha com a decisão de repetir', async () => {
    const rpcs: { nome: string; args: Record<string, unknown> }[] = [];
    const cliente = {
      rpc: (nome: string, args: Record<string, unknown>) => {
        rpcs.push({ nome, args });
        if (nome === 'wa_acoes_proximas') {
          return Promise.resolve({
            data: [
              { id: 1, tipo: 'ler', dados: { wamid: 'w1' } },
              { id: 2, tipo: 'grupo_apagar', dados: {}, group_id: 'G1' },
            ],
            error: null,
          });
        }
        if (nome === 'wa_acao_falhar') return Promise.resolve({ data: 'reagendada', error: null });
        return Promise.resolve({ data: true, error: null });
      },
    } as unknown as ClienteDoBanco;
    const g = {
      marcarLida: vi.fn(async () => ({ ok: true, json: {}, httpStatus: 200 })),
      remover: vi.fn(async () => ({
        ok: false,
        codigo: '131000',
        mensagem: 'Something went wrong',
        retentar: true,
        httpStatus: 500,
      })),
    } as unknown as ClienteDaGraph;
    expect(await fazerAcoes(contextoDasAcoes(g, cliente))).toBe(2);
    expect(rpcs.find((r) => r.nome === 'wa_acao_concluir')?.args.p_id).toBe(1);
    expect(rpcs.find((r) => r.nome === 'wa_acao_falhar')?.args).toMatchObject({
      p_id: 2,
      p_codigo: '131000',
      p_retentar: true,
    });
  });
});
