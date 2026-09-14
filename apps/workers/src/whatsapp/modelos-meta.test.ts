/**
 * Os modelos na Meta, medidos em três alturas:
 *
 *   1. O PEDIDO e a VALIDAÇÃO local, sem rede: o formato exato do POST e o que
 *      a Meta recusaria de certeza (variável na borda, variáveis coladas).
 *   2. A SINCRONIZAÇÃO contra o dublê da Graph API, com um banco falso:
 *      manda o que falta, registra o que já existe, é idempotente.
 *   3. OS ERROS: do item (registra e segue) e do mundo (para sem registrar).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  criarSincronizacaoPeriodica,
  ehErroDoMundo,
  exemploDaVariavel,
  fraseDoResumo,
  listarModelosDaMeta,
  montarPedidoDeModelo,
  NAO_ENVIADO,
  resumoZerado,
  sincronizarModelos,
  validarModelo,
  variaveisDoCorpo,
  type ContextoDosModelos,
  type ResultadoDaSincronizacao,
} from './modelos-meta';
import { subirDubleDaGraph, type DubleDaGraph } from './duble-da-graph-de-teste';
import { createLogger } from '../lib/log';

import type { ClienteDaGraph, FalhaDaGraph, RespostaDaGraph } from './graph';
import type { ClienteDoBanco, ModeloParaMeta } from './ponte';

const logger = createLogger({
  worker: 'teste',
  level: 'error',
  stdout: () => {},
  stderr: () => {},
});

function modelo(parcial: Partial<ModeloParaMeta> = {}): ModeloParaMeta {
  return {
    template_id: 1,
    codigo: 'AEB-ABR-A',
    nome_meta_atual: null,
    situacao_atual: null,
    nome_sugerido: 'aeb_abr_a_v1',
    categoria: 'MARKETING',
    idioma: 'pt_BR',
    corpo: 'Oi, {{nome}}, tudo bem? Vi a {{empresa}} no {{origem}} e lembrei de você.',
    variaveis: ['nome', 'empresa', 'origem'],
    ...parcial,
  };
}

// ---------------------------------------------------------------------------
// 1. O pedido e a validação
// ---------------------------------------------------------------------------

describe('o pedido de criação do modelo', () => {
  it('tem exatamente o formato NAMED da Meta, com exemplo realista por variável', () => {
    expect(montarPedidoDeModelo(modelo())).toEqual({
      name: 'aeb_abr_a_v1',
      language: 'pt_BR',
      category: 'MARKETING',
      parameter_format: 'NAMED',
      components: [
        {
          type: 'BODY',
          text: 'Oi, {{nome}}, tudo bem? Vi a {{empresa}} no {{origem}} e lembrei de você.',
          example: {
            body_text_named_params: [
              { param_name: 'nome', example: 'Mariana' },
              { param_name: 'empresa', example: 'Buffet Sabor Potiguar' },
              { param_name: 'origem', example: 'Instagram' },
            ],
          },
        },
      ],
    });
  });

  it('sem variável, não manda `example`', () => {
    const p = montarPedidoDeModelo(
      modelo({ corpo: 'Pronto, você não recebe mais mensagens nossas.', categoria: 'UTILITY' }),
    );
    expect(p.components[0]).toEqual({
      type: 'BODY',
      text: 'Pronto, você não recebe mais mensagens nossas.',
    });
  });

  it('variável repetida entra uma vez só, e `{{ nome }}` vira `{{nome}}`', () => {
    const p = montarPedidoDeModelo(
      modelo({ corpo: 'Oi, {{ nome }}! Tudo certo, {{nome}}? Abraço.' }),
    );
    expect(p.components[0]?.text).toBe('Oi, {{nome}}! Tudo certo, {{nome}}? Abraço.');
    expect(p.components[0]?.example?.body_text_named_params).toEqual([
      { param_name: 'nome', example: 'Mariana' },
    ]);
  });

  it('exemplo de variável desconhecida cai no padrão', () => {
    expect(exemploDaVariavel('hora_tarde')).toBe('15h');
    expect(exemploDaVariavel('link_app')).toBe('https://admin.komune.app.br/seja-parceiro');
    expect(exemploDaVariavel('qualquer_coisa')).toBe('exemplo');
    expect(exemploDaVariavel('toString')).toBe('exemplo');
  });

  it('variaveisDoCorpo segue a ordem da primeira aparição, sem repetir', () => {
    expect(variaveisDoCorpo('A {{b}} c {{a}} d {{b}} e {{Invalida}}')).toEqual(['b', 'a']);
  });
});

describe('a validação local (o que a Meta recusaria de certeza)', () => {
  it('aceita um modelo bem formado', () => {
    expect(validarModelo(modelo())).toEqual({ ok: true });
  });

  it.each([
    ['{{nome}}, tudo bem? Aqui é a Heloísa.', 'começa'],
    ['  "{{nome}}", tudo bem? Aqui é a Heloísa.', 'começa'],
    ['Oi, tudo bem? Aqui é a Heloísa, da {{empresa}}', 'termina'],
    ['Oi, tudo bem? Aqui é a Heloísa, da {{empresa}}!', 'termina'],
    ['Oi, tudo bem? Aqui é a Heloísa, da {{empresa}}. ', 'termina'],
    ['Oi, {{nome}}{{empresa}} tudo bem?', 'coladas'],
    ['Oi, {{nome}}   {{empresa}} tudo bem?', 'coladas'],
  ])('recusa "%s" (%s)', (corpo, palavra) => {
    const v = validarModelo(modelo({ corpo }));
    expect(v.ok).toBe(false);
    expect(v.ok === false && v.motivo).toContain(palavra);
  });

  it('recusa nome fora de ^[a-z0-9_]{1,512}$', () => {
    expect(validarModelo(modelo({ nome_sugerido: 'AEB-ABR-A' })).ok).toBe(false);
    expect(validarModelo(modelo({ nome_sugerido: 'a'.repeat(513) })).ok).toBe(false);
    expect(validarModelo(modelo({ nome_sugerido: 'a'.repeat(512) })).ok).toBe(true);
  });

  it('recusa corpo acima de 1024 caracteres', () => {
    const corpo = `Oi, {{nome}}, ${'a'.repeat(1020)}`;
    const v = validarModelo(modelo({ corpo }));
    expect(v.ok === false && v.motivo).toContain('1024');
  });

  it('recusa placeholder fora do formato nomeado e categoria que não vai para aprovação', () => {
    expect(validarModelo(modelo({ corpo: 'Oi, {{1}}, tudo bem?' })).ok).toBe(false);
    expect(validarModelo(modelo({ corpo: 'Oi, {{Nome}}, tudo bem?' })).ok).toBe(false);
    expect(validarModelo(modelo({ categoria: 'AUTHENTICATION' })).ok).toBe(false);
  });
});

describe('erro do item × erro do mundo', () => {
  const falha = (parcial: Partial<FalhaDaGraph>): FalhaDaGraph => ({
    ok: false,
    codigo: '100',
    mensagem: 'x',
    retentar: false,
    httpStatus: 400,
    ...parcial,
  });

  it('token, rede, 5xx, limite e permissão são do mundo', () => {
    expect(
      ehErroDoMundo(falha({ codigo: 'token_meta_invalido', retentar: true, httpStatus: 401 })),
    ).toBe(true);
    expect(
      ehErroDoMundo(falha({ codigo: 'sem_resposta_da_meta', retentar: true, httpStatus: null })),
    ).toBe(true);
    expect(ehErroDoMundo(falha({ codigo: '4', retentar: true }))).toBe(true);
    expect(ehErroDoMundo(falha({ codigo: '200' }))).toBe(true);
    expect(ehErroDoMundo(falha({ codigo: '10' }))).toBe(true);
    expect(ehErroDoMundo(falha({ codigo: 'http_403', httpStatus: 403 }))).toBe(true);
  });

  it('parâmetro inválido do modelo é do item', () => {
    expect(ehErroDoMundo(falha({ codigo: '100', subcodigo: 2388299 }))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 2. A sincronização contra o dublê
// ---------------------------------------------------------------------------

interface Chamada {
  nome: string;
  args: Record<string, unknown>;
}

function bancoFalso(itens: ModeloParaMeta[]): { cliente: ClienteDoBanco; chamadas: Chamada[] } {
  const chamadas: Chamada[] = [];
  const cliente = {
    rpc: (nome: string, args: Record<string, unknown>) => {
      chamadas.push({ nome, args });
      if (nome === 'wa_modelos_para_meta') return Promise.resolve({ data: itens, error: null });
      if (nome === 'wa_modelo_meta_registrar') {
        return Promise.resolve({ data: { ok: true, meta_status: 'pending' }, error: null });
      }
      return Promise.resolve({ data: null, error: { message: `rpc inesperada: ${nome}` } });
    },
  } as unknown as ClienteDoBanco;
  return { cliente, chamadas };
}

const registros = (chamadas: Chamada[]) =>
  chamadas.filter((c) => c.nome === 'wa_modelo_meta_registrar').map((c) => c.args);

const WABA = '777';

describe('a sincronização contra o dublê da Graph API', () => {
  let duble: DubleDaGraph;

  beforeAll(async () => {
    duble = await subirDubleDaGraph(8792);
  }, 20_000);

  afterAll(() => {
    duble?.parar();
  });

  beforeEach(async () => {
    await duble.zerar();
  });

  const itens = [
    modelo({ template_id: 1 }),
    // Recusado aqui: termina com variável. Não pode chegar à Meta.
    modelo({
      template_id: 2,
      codigo: 'AEB-FUP-B',
      nome_sugerido: 'aeb_fup_b_v1',
      corpo: 'Passando para lembrar do {{detalhe}}',
    }),
    modelo({
      template_id: 3,
      codigo: 'GEN-SYS-OPTOUT',
      nome_sugerido: 'aprovar_gen_sys_optout_v1',
      categoria: 'UTILITY',
      corpo: 'Pronto, você não recebe mais mensagens nossas.',
    }),
  ];

  function contexto(cliente: ClienteDoBanco, dormir = vi.fn(async () => {})): ContextoDosModelos {
    return { cliente, graph: duble.cliente(), wabaId: WABA, logger, dormir };
  }

  it('manda o que falta, recusa antes o que a Meta recusaria e registra tudo', async () => {
    const { cliente, chamadas } = bancoFalso(itens);
    const dormir = vi.fn(async () => {});
    const r = await sincronizarModelos(contexto(cliente, dormir));

    expect(r).toEqual({
      ok: true,
      interrompida: false,
      resumo: { enviados: 2, aprovados: 1, pendentes: 1, recusados: 0, falhas: 1 },
    });

    const conta = await duble.conta();
    const naMeta = conta.modelos[WABA] ?? [];
    expect(naMeta.map((m) => m.name)).toEqual(['aeb_abr_a_v1', 'aprovar_gen_sys_optout_v1']);
    expect(naMeta[0]?.parameter_format).toBe('NAMED');

    const reg = registros(chamadas);
    expect(reg).toHaveLength(3);
    expect(reg[0]).toMatchObject({
      p_template_id: 1,
      p_nome_meta: 'aeb_abr_a_v1',
      p_situacao_meta: 'PENDING',
    });
    expect(reg[0]?.p_id_meta).toEqual(expect.any(String));
    expect(reg[1]).toMatchObject({
      p_template_id: 2,
      p_situacao_meta: NAO_ENVIADO,
      p_id_meta: null,
    });
    expect(String(reg[1]?.p_motivo)).toContain('termina com uma variável');
    expect(reg[2]).toMatchObject({ p_template_id: 3, p_situacao_meta: 'APPROVED' });

    // Um intervalo entre dois pedidos de criação — e só entre pedidos.
    expect(dormir).toHaveBeenCalledTimes(1);
    expect(dormir).toHaveBeenCalledWith(1_000);
  });

  it('é IDEMPOTENTE: rodar de novo não cria nada, só registra o status', async () => {
    const primeiro = bancoFalso(itens);
    await sincronizarModelos(contexto(primeiro.cliente));

    const segundo = bancoFalso(itens);
    const r = await sincronizarModelos(contexto(segundo.cliente));
    expect(r.ok === true && r.resumo).toEqual({
      enviados: 0,
      aprovados: 1,
      pendentes: 1,
      recusados: 0,
      falhas: 1,
    });
    const conta = await duble.conta();
    expect(conta.modelos[WABA]).toHaveLength(2);
    expect(registros(segundo.chamadas).map((a) => a.p_situacao_meta)).toEqual([
      'PENDING',
      NAO_ENVIADO,
      'APPROVED',
    ]);
  });

  it('modelo recusado pela revisão da Meta volta com o motivo dela', async () => {
    const { cliente, chamadas } = bancoFalso([
      modelo({ template_id: 9, nome_sugerido: 'rejeitar_promo_v1' }),
    ]);
    await sincronizarModelos(contexto(cliente));
    // Na segunda passada o modelo já existe: o status e o motivo vêm da lista.
    const segundo = bancoFalso([modelo({ template_id: 9, nome_sugerido: 'rejeitar_promo_v1' })]);
    const r = await sincronizarModelos(contexto(segundo.cliente));
    expect(r.ok === true && r.resumo.recusados).toBe(1);
    expect(registros(segundo.chamadas)[0]).toMatchObject({
      p_situacao_meta: 'REJECTED',
      p_motivo: 'PROMOTIONAL',
    });
    expect(registros(chamadas)[0]).toMatchObject({ p_situacao_meta: 'REJECTED' });
  });

  it('TOKEN ERRADO: para antes de tudo e não registra nada', async () => {
    const { cliente, chamadas } = bancoFalso(itens);
    const r = await sincronizarModelos({
      ...contexto(cliente),
      graph: duble.cliente({ token: 'token-errado' }),
    });
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.erro).toContain('token_meta_invalido');
    expect(registros(chamadas)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 3. Os erros, com uma Graph falsa
// ---------------------------------------------------------------------------

function graphFalsa(respostas: {
  ler?: (caminho: string, consulta: Record<string, string | number>) => RespostaDaGraph;
  publicar?: (caminho: string, corpo: Record<string, unknown>) => RespostaDaGraph;
}): ClienteDaGraph {
  return {
    ler: vi.fn(async (caminho: string, consulta: Record<string, string | number> = {}) =>
      respostas.ler
        ? respostas.ler(caminho, consulta)
        : ({ ok: true, json: { data: [] }, httpStatus: 200 } as RespostaDaGraph),
    ),
    publicar: vi.fn(async (caminho: string, corpo: Record<string, unknown> = {}) =>
      respostas.publicar
        ? respostas.publicar(caminho, corpo)
        : ({ ok: true, json: { id: '1', status: 'PENDING' }, httpStatus: 200 } as RespostaDaGraph),
    ),
  } as unknown as ClienteDaGraph;
}

describe('os erros no meio da sincronização', () => {
  it('erro do MUNDO no segundo pedido: para, e só o primeiro fica registrado', async () => {
    let n = 0;
    const graph = graphFalsa({
      publicar: () => {
        n += 1;
        return n === 1
          ? { ok: true, json: { id: '10', status: 'PENDING' }, httpStatus: 200 }
          : {
              ok: false,
              codigo: 'token_meta_invalido',
              mensagem: 'Invalid OAuth access token',
              retentar: true,
              httpStatus: 401,
            };
      },
    });
    const { cliente, chamadas } = bancoFalso([
      modelo({ template_id: 1 }),
      modelo({ template_id: 2, nome_sugerido: 'aeb_abr_b_v1' }),
      modelo({ template_id: 3, nome_sugerido: 'aeb_abr_c_v1' }),
    ]);
    const r = await sincronizarModelos({
      cliente,
      graph,
      wabaId: WABA,
      logger,
      dormir: async () => {},
    });
    expect(r.ok).toBe(false);
    expect(r.resumo.enviados).toBe(1);
    expect(registros(chamadas).map((a) => a.p_template_id)).toEqual([1]);
    expect(n).toBe(2);
  });

  it('"JÁ EXISTE" que a lista não mostrou: busca pelo nome e registra o status', async () => {
    const graph = graphFalsa({
      ler: (_caminho, consulta) =>
        consulta.name === 'aeb_abr_a_v1'
          ? {
              ok: true,
              httpStatus: 200,
              json: {
                data: [
                  // O filtro `name` da Meta casa por trecho: só o nome EXATO vale.
                  { id: '5', name: 'aeb_abr_a_v10', language: 'pt_BR', status: 'REJECTED' },
                  { id: '6', name: 'aeb_abr_a_v1', language: 'en_US', status: 'REJECTED' },
                  { id: '7', name: 'aeb_abr_a_v1', language: 'pt_BR', status: 'APPROVED' },
                ],
              },
            }
          : { ok: true, httpStatus: 200, json: { data: [] } },
      publicar: () => ({
        ok: false,
        codigo: '100',
        subcodigo: 2388024,
        mensagem: 'Invalid parameter — Content for pt_BR already exists for this template name.',
        retentar: false,
        httpStatus: 400,
      }),
    });
    const { cliente, chamadas } = bancoFalso([modelo()]);
    const r = await sincronizarModelos({ cliente, graph, wabaId: WABA, logger });
    expect(r.ok === true && r.resumo).toEqual({ ...resumoZerado(), aprovados: 1 });
    expect(registros(chamadas)[0]).toMatchObject({ p_situacao_meta: 'APPROVED', p_id_meta: '7' });
  });

  it('a Meta recusa o PEDIDO (erro do item): registra NAO_ENVIADO com o motivo dela e segue', async () => {
    let n = 0;
    const graph = graphFalsa({
      publicar: () => {
        n += 1;
        return n === 1
          ? {
              ok: false,
              codigo: '100',
              subcodigo: 2388293,
              mensagem: 'Invalid parameter — Too many variables for the text length.',
              retentar: false,
              httpStatus: 400,
            }
          : { ok: true, json: { id: '11', status: 'PENDING' }, httpStatus: 200 };
      },
    });
    const { cliente, chamadas } = bancoFalso([
      modelo({ template_id: 1 }),
      modelo({ template_id: 2, nome_sugerido: 'aeb_abr_b_v1' }),
    ]);
    const r = await sincronizarModelos({
      cliente,
      graph,
      wabaId: WABA,
      logger,
      dormir: async () => {},
    });
    expect(r.ok === true && r.resumo).toEqual({
      ...resumoZerado(),
      enviados: 1,
      pendentes: 1,
      falhas: 1,
    });
    const reg = registros(chamadas);
    expect(reg[0]).toMatchObject({ p_template_id: 1, p_situacao_meta: NAO_ENVIADO });
    expect(String(reg[0]?.p_motivo)).toContain('2388293');
    expect(reg[1]).toMatchObject({ p_template_id: 2, p_situacao_meta: 'PENDING' });
  });

  it('pagina a lista pelo cursor `after`, sem seguir a URL de `paging.next`', async () => {
    const consultas: Record<string, string | number>[] = [];
    const graph = graphFalsa({
      ler: (_caminho, consulta) => {
        consultas.push(consulta);
        return consulta.after === 'c1'
          ? {
              ok: true,
              httpStatus: 200,
              json: {
                data: [{ name: 'b', language: 'pt_BR', status: 'PENDING' }],
                paging: { cursors: { after: 'c2' } },
              },
            }
          : {
              ok: true,
              httpStatus: 200,
              json: {
                data: [{ name: 'a', language: 'pt_BR', status: 'APPROVED' }],
                paging: {
                  cursors: { after: 'c1' },
                  next: 'https://graph.facebook.com/…&access_token=segredo',
                },
              },
            };
      },
    });
    const r = await listarModelosDaMeta(graph, WABA);
    expect(r.ok === true && r.modelos.map((m) => m.name)).toEqual(['a', 'b']);
    expect(consultas).toHaveLength(2);
    expect(consultas[0]).toEqual({
      fields: 'id,name,status,category,language,rejected_reason',
      limit: 100,
    });
    expect(consultas[1]?.after).toBe('c1');
  });

  it('cursor repetido não vira laço infinito', async () => {
    const graph = graphFalsa({
      ler: () => ({
        ok: true,
        httpStatus: 200,
        json: { data: [], paging: { cursors: { after: 'mesmo' }, next: 'x' } },
      }),
    });
    const r = await listarModelosDaMeta(graph, WABA);
    expect(r.ok).toBe(true);
    expect((graph.ler as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(2);
  });

  it('banco fora do ar: devolve o erro, sem chamar a Meta', async () => {
    const graph = graphFalsa({});
    const cliente = {
      rpc: () => Promise.resolve({ data: null, error: { message: 'function does not exist' } }),
    } as unknown as ClienteDoBanco;
    const r = await sincronizarModelos({ cliente, graph, wabaId: WABA, logger });
    expect(r.ok === false && r.erro).toContain('wa_modelos_para_meta');
    expect(graph.ler).not.toHaveBeenCalled();
  });

  it('a parada do worker interrompe entre um modelo e outro', async () => {
    const graph = graphFalsa({});
    const { cliente, chamadas } = bancoFalso([
      modelo({ template_id: 1 }),
      modelo({ template_id: 2, nome_sugerido: 'aeb_abr_b_v1' }),
    ]);
    let parar = false;
    const r = await sincronizarModelos({
      cliente,
      graph,
      wabaId: WABA,
      logger,
      dormir: async () => {},
      deveParar: () => {
        const agora = parar;
        parar = true;
        return agora;
      },
    });
    expect(r).toMatchObject({ ok: true, interrompida: true });
    expect(registros(chamadas)).toHaveLength(1);
  });

  it('o resumo se lê numa linha', () => {
    expect(
      fraseDoResumo({ enviados: 1, aprovados: 0, pendentes: 2, recusados: 1, falhas: 0 }),
    ).toBe('1 enviado · 0 aprovados · 2 pendentes · 1 recusado · 0 falhas');
  });
});

// ---------------------------------------------------------------------------
// 4. A sincronização periódica do laço
// ---------------------------------------------------------------------------

describe('a sincronização periódica', () => {
  const ok: ResultadoDaSincronizacao = { ok: true, resumo: resumoZerado(), interrompida: false };
  const base = {
    cliente: {} as ClienteDoBanco,
    graph: {} as ClienteDaGraph,
    wabaId: WABA,
    logger,
  };

  it('dispara na subida e não sobrepõe uma passada à outra', async () => {
    const relogio = 1_000;
    let solte: () => void = () => {};
    const sincronizar = vi.fn(
      () =>
        new Promise<ResultadoDaSincronizacao>((resolva) => {
          solte = () => resolva(ok);
        }),
    );
    const p = criarSincronizacaoPeriodica(base, {
      agora: () => relogio,
      intervaloMs: 0,
      sincronizar,
    });

    p.talvezDisparar();
    p.talvezDisparar(); // em curso: mesmo com intervalo zero, não sobrepõe
    expect(sincronizar).toHaveBeenCalledTimes(1);

    solte();
    await p.encerrar(false);
  });

  it('só volta depois de 30 min', async () => {
    let relogio = 0;
    const sincronizar = vi.fn(async () => ok);
    const p = criarSincronizacaoPeriodica(base, { agora: () => relogio, sincronizar });
    p.talvezDisparar();
    await new Promise((r) => setTimeout(r, 0));
    relogio += 29 * 60 * 1000;
    p.talvezDisparar();
    await new Promise((r) => setTimeout(r, 0));
    expect(sincronizar).toHaveBeenCalledTimes(1);
    relogio += 60 * 1000;
    p.talvezDisparar();
    await new Promise((r) => setTimeout(r, 0));
    expect(sincronizar).toHaveBeenCalledTimes(2);
    await p.encerrar(false);
  });

  it('falha só vira log: nem erro devolvido, nem exceção derrubam o laço', async () => {
    const linhas: string[] = [];
    const log = createLogger({
      worker: 'teste',
      level: 'error',
      stdout: (l) => linhas.push(l),
      stderr: (l) => linhas.push(l),
    });
    const p = criarSincronizacaoPeriodica(
      { ...base, logger: log },
      {
        sincronizar: async () => ({
          ok: false,
          erro: 'criar modelo na Meta: 190',
          resumo: resumoZerado(),
        }),
      },
    );
    p.talvezDisparar();
    await p.encerrar(false);
    const q = criarSincronizacaoPeriodica(
      { ...base, logger: log },
      {
        sincronizar: async () => {
          throw new Error('quebrou');
        },
      },
    );
    expect(() => q.talvezDisparar()).not.toThrow();
    await q.encerrar(false);
    expect(linhas.some((l) => l.includes('falhou') && l.includes('190'))).toBe(true);
    expect(linhas.some((l) => l.includes('quebrou'))).toBe(true);
  });

  it('encerrar(true) pede para a passada em curso parar entre um modelo e outro', async () => {
    let deveParar: (() => boolean) | undefined;
    let solte: () => void = () => {};
    const p = criarSincronizacaoPeriodica(base, {
      sincronizar: (ctx) => {
        deveParar = ctx.deveParar;
        return new Promise((resolva) => {
          solte = () => resolva(ok);
        });
      },
    });
    p.talvezDisparar();
    expect(deveParar?.()).toBe(false);
    const fim = p.encerrar(true);
    expect(deveParar?.()).toBe(true);
    solte();
    await fim;
    // Depois de encerrado, não dispara mais.
    p.talvezDisparar();
  });
});
