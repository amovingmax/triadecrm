/**
 * O cliente da Cloud API, medido em duas alturas:
 *
 *   1. A TABELA DE ERROS, sem rede nenhuma. É a única decisão que este módulo
 *      toma, e é a que custa reputação do número quando erra: insistir num
 *      "fora da janela de 24 h" são quatro registros de empresa insistindo na
 *      conta que a Meta usa para o quality rating (R04 §4).
 *
 *   2. O CAMINHO INTEIRO contra o dublê local
 *      (`supabase/functions/_dubles/meta-graph-duble.mjs`), que responde como a
 *      Graph API responde — com os códigos dela. Não existe credencial da Meta
 *      neste repositório e não é para existir; o dublê sobe em 127.0.0.1 e
 *      morre no fim do arquivo.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  ClienteDaGraph,
  classificarErro,
  parametrosDoCorpo,
  valorDeParametroLimpo,
  wamidDaResposta,
  VERSAO_PADRAO,
} from './graph';
import {
  SEGREDO_DO_APP_DE_TESTE,
  subirDubleDaGraph,
  type DubleDaGraph,
} from './duble-da-graph-de-teste';

// ---------------------------------------------------------------------------
// 1. A tabela de erros — sem rede
// ---------------------------------------------------------------------------

function erroDaMeta(codigo: number, mensagem = 'erro', detalhe?: string): unknown {
  return {
    error: {
      message: mensagem,
      type: 'OAuthException',
      code: codigo,
      error_data: detalhe ? { messaging_product: 'whatsapp', details: detalhe } : undefined,
    },
  };
}

describe('a decisão de tentar de novo', () => {
  it.each([
    [80007, 'limite de vazão da conta'],
    [130429, 'limite de vazão da Cloud API'],
    [131049, 'limite de marketing por usuário'],
    [131056, 'limite do par'],
    [133016, 'conta em recuperação'],
    [1, 'erro interno deles'],
  ])('%i é transitório: volta para a fila', (codigo) => {
    expect(classificarErro(400, erroDaMeta(codigo)).retentar).toBe(true);
  });

  it.each([
    [131026, 'o número não tem WhatsApp'],
    [131047, 'fora da janela de 24 h'],
    [132000, 'parâmetros do template não batem'],
    [132001, 'template inexistente ou não aprovado'],
    [132005, 'template pausado por qualidade'],
    [100, 'parâmetro inválido — bug nosso'],
  ])('%i é definitivo: repetir não muda nada', (codigo) => {
    expect(classificarErro(400, erroDaMeta(codigo)).retentar).toBe(false);
  });

  it('5xx é do transporte e sempre vale outra tentativa', () => {
    expect(classificarErro(500, null, 'Internal Server Error').retentar).toBe(true);
    expect(classificarErro(503, null).retentar).toBe(true);
    expect(classificarErro(429, null).retentar).toBe(true);
  });

  it('token expirado (190) vira um código que se lê, e ainda assim retenta', () => {
    // Marcar como definitivo mataria, uma a uma, todas as mensagens da fila
    // enquanto ninguém percebe que o token venceu.
    const r = classificarErro(401, erroDaMeta(190, 'Invalid OAuth access token'));
    expect(r.codigo).toBe('token_meta_invalido');
    expect(r.retentar).toBe(true);
  });

  it('a mensagem guardada junta o texto da Meta e o detalhe dela', () => {
    const r = classificarErro(400, erroDaMeta(131047, 'Re-engagement message', 'passaram 24 h'));
    expect(r.mensagem).toBe('Re-engagement message — passaram 24 h');
  });

  it('resposta sem corpo reconhecível ainda produz um código nomeado', () => {
    expect(classificarErro(418, null, '<html>').codigo).toBe('http_418');
  });

  it('guarda o subcódigo e o motivo "para o usuário" da criação de modelo', () => {
    // Na criação de modelo, `message` diz só "Invalid parameter"; o motivo que
    // se lê está em `error_user_msg`.
    const r = classificarErro(400, {
      error: {
        message: 'Invalid parameter',
        code: 100,
        error_subcode: 2388024,
        error_user_title: 'Content in This Language Already Exists',
        error_user_msg: 'Content for pt_BR already exists for this template name.',
      },
    });
    expect(r.subcodigo).toBe(2388024);
    expect(r.codigo).toBe('100');
    expect(r.mensagem).toBe(
      'Invalid parameter — Content for pt_BR already exists for this template name.',
    );
    expect(r.retentar).toBe(false);
  });
});

describe('o corpo do POST', () => {
  it('modelo com botão de link manda o sufixo no índice do botão', () => {
    const p = ClienteDaGraph.payloadDoEnvio({
      tipo: 'template',
      para: '+5584988776655',
      nome: 'env_cadastro_pendente_v1',
      idioma: 'pt_BR',
      parametros: { nome: 'Ana' },
      botaoDeLink: { indice: 0, sufixo: 'a1b2c3d4e5f6' },
    });
    expect((p.template as { components: unknown[] }).components[1]).toEqual({
      type: 'button',
      sub_type: 'url',
      index: '0',
      parameters: [{ type: 'text', text: 'a1b2c3d4e5f6' }],
    });
  });

  it('a resposta ao botão vai como interativo com um botão de link', () => {
    const p = ClienteDaGraph.payloadDoEnvio({
      tipo: 'link',
      para: '+5584988776655',
      corpo: 'Aqui está o seu convite.',
      rotulo: 'Criar meu perfil',
      url: 'https://crm.teste/r/a1b2c3d4e5f6',
    });
    expect(p).toMatchObject({
      type: 'interactive',
      interactive: {
        type: 'cta_url',
        body: { text: 'Aqui está o seu convite.' },
        action: {
          name: 'cta_url',
          parameters: { display_text: 'Criar meu perfil', url: 'https://crm.teste/r/a1b2c3d4e5f6' },
        },
      },
    });
  });

  it('texto vai sem prévia de link (link no 1º toque é sinal de spam, R04 §4)', () => {
    const p = ClienteDaGraph.payloadDoEnvio({ tipo: 'texto', para: '+5584988776655', corpo: 'oi' });
    expect(p).toMatchObject({
      messaging_product: 'whatsapp',
      to: '+5584988776655',
      type: 'text',
      text: { preview_url: false, body: 'oi' },
    });
  });

  it('template leva nome, idioma e os parâmetros do corpo', () => {
    const p = ClienteDaGraph.payloadDoEnvio({
      tipo: 'template',
      para: '+5584988776655',
      nome: 'gen_fup_lig_v1',
      idioma: 'pt_BR',
      parametros: ['Marcos', 'Komune'],
    });
    expect(p).toMatchObject({
      type: 'template',
      template: {
        name: 'gen_fup_lig_v1',
        language: { code: 'pt_BR' },
        components: [
          {
            type: 'body',
            parameters: [
              { type: 'text', text: 'Marcos' },
              { type: 'text', text: 'Komune' },
            ],
          },
        ],
      },
    });
  });

  it('template com parâmetros NOMEADOS leva parameter_name em cada um', () => {
    const p = ClienteDaGraph.payloadDoEnvio({
      tipo: 'template',
      para: '+5584988776655',
      nome: 'aeb_abr_a_v1',
      idioma: 'pt_BR',
      parametros: { nome: 'Maria', empresa: 'Buffet X' },
    });
    expect(p).toEqual({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: '+5584988776655',
      type: 'template',
      template: {
        name: 'aeb_abr_a_v1',
        language: { code: 'pt_BR' },
        components: [
          {
            type: 'body',
            parameters: [
              { type: 'text', parameter_name: 'nome', text: 'Maria' },
              { type: 'text', parameter_name: 'empresa', text: 'Buffet X' },
            ],
          },
        ],
      },
    });
  });

  it('objeto de parâmetros vazio também não manda componente', () => {
    const p = ClienteDaGraph.payloadDoEnvio({
      tipo: 'template',
      para: '+55849',
      nome: 'x',
      idioma: 'pt_BR',
      parametros: {},
    });
    expect((p.template as { components: unknown[] }).components).toEqual([]);
  });

  it('valor com quebra de linha, tab ou espaço repetido é normalizado, não recusado', () => {
    // A Meta recusa parâmetro com \n, \t ou mais de 4 espaços seguidos.
    expect(valorDeParametroLimpo('Buffet\nSabor\tPotiguar')).toBe('Buffet Sabor Potiguar');
    expect(valorDeParametroLimpo('  Maria      Clara \r\n')).toBe('Maria Clara');
    expect(valorDeParametroLimpo(42)).toBe('42');
    expect(valorDeParametroLimpo(null)).toBe('');
    expect(parametrosDoCorpo({ detalhe: 'linha 1\n\nlinha 2' })).toEqual([
      { type: 'text', parameter_name: 'detalhe', text: 'linha 1 linha 2' },
    ]);
    // A regra vale também para o posicional.
    expect(parametrosDoCorpo(['a\tb', 'c     d'])).toEqual([
      { type: 'text', text: 'a b' },
      { type: 'text', text: 'c d' },
    ]);
  });

  it('template sem parâmetro não manda componente vazio', () => {
    const p = ClienteDaGraph.payloadDoEnvio({
      tipo: 'template',
      para: '+55849',
      nome: 'x',
      idioma: 'pt_BR',
      parametros: [],
    });
    expect((p.template as { components: unknown[] }).components).toEqual([]);
  });

  it('ÁUDIO SAI COMO MENSAGEM DE VOZ, e isto decide se ele toca', () => {
    // Sem `voice: true` a Cloud API entrega um ARQUIVO de áudio: ícone de
    // download, sem onda, sem transcrição — e o aparelho não baixa sozinho. Em
    // 17/09/2026 isso apareceu como "este áudio não está mais disponível" num
    // iPhone, em mensagem que a Meta dizia ter entregue e lido.
    const p = ClienteDaGraph.payloadDoEnvio({
      tipo: 'audio',
      para: '+5584988776655',
      mediaId: '123456789',
    });
    expect(p.type).toBe('audio');
    expect(p.audio).toEqual({ id: '123456789', voice: true });
  });
});

describe('o wamid da resposta', () => {
  it('sai de messages[0].id', () => {
    expect(wamidDaResposta({ messages: [{ id: 'wamid.X' }] })).toBe('wamid.X');
  });
  it('resposta sem id não vira wamid inventado', () => {
    expect(wamidDaResposta({ messages: [] })).toBeNull();
    expect(wamidDaResposta({})).toBeNull();
    expect(wamidDaResposta(null)).toBeNull();
    expect(wamidDaResposta({ messages: [{ id: '' }] })).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 2. O caminho inteiro contra o dublê local
// ---------------------------------------------------------------------------

const PORTA = 8791;
const TOKEN = 'token-de-teste';
const AQUI = dirname(fileURLToPath(import.meta.url));
const DUBLE = resolve(AQUI, '../../../../supabase/functions/_dubles/meta-graph-duble.mjs');

let processo: ChildProcess | null = null;

async function esperarOServidor(): Promise<void> {
  for (let i = 0; i < 60; i += 1) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORTA}/_enviadas`);
      if (r.ok) return;
    } catch {
      // ainda subindo
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('o dublê da Graph API não subiu');
}

function cliente(token = TOKEN): ClienteDaGraph {
  return new ClienteDaGraph({
    baseUrl: `http://127.0.0.1:${PORTA}`,
    versao: VERSAO_PADRAO,
    phoneNumberId: '1234567890',
    token,
    timeoutMs: 5_000,
  });
}

describe('contra o dublê da Graph API (sem rede, sem credencial)', () => {
  beforeAll(async () => {
    processo = spawn(process.execPath, [DUBLE, 'servir', String(PORTA)], {
      env: { ...process.env, META_WA_ACCESS_TOKEN: TOKEN },
      stdio: 'ignore',
    });
    await esperarOServidor();
  }, 20_000);

  afterAll(() => {
    processo?.kill('SIGTERM');
  });

  it('texto sai e volta com wamid', async () => {
    const r = await cliente().enviar({
      tipo: 'texto',
      para: '+5584988776655',
      corpo: 'Oi, Marcos, aqui é a Heloísa',
    });
    expect(r.ok).toBe(true);
    expect(r.ok === true && r.wamid).toMatch(/^wamid\.DUBLE/);
  });

  it('o dublê recebeu exatamente o payload da Cloud API', async () => {
    await fetch(`http://127.0.0.1:${PORTA}/_zerar`, { method: 'POST' });
    await cliente().enviar({
      tipo: 'template',
      para: '+5584988776600',
      nome: 'gen_fup_lig_v1',
      idioma: 'pt_BR',
      parametros: ['Marcos'],
    });
    const r = await fetch(`http://127.0.0.1:${PORTA}/_enviadas`);
    const { enviadas } = (await r.json()) as { enviadas: { corpo: Record<string, unknown> }[] };
    expect(enviadas).toHaveLength(1);
    expect(enviadas[0]?.corpo).toMatchObject({
      messaging_product: 'whatsapp',
      to: '+5584988776600',
      type: 'template',
    });
  });

  it('131047 (fora da janela) volta como definitivo', async () => {
    const r = await cliente().enviar({ tipo: 'texto', para: '+5584900000131047', corpo: 'oi' });
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.codigo).toBe('131047');
    expect(r.ok === false && r.retentar).toBe(false);
  });

  it('131049 (limite de marketing por usuário) volta como transitório', async () => {
    const r = await cliente().enviar({ tipo: 'texto', para: '+5584900000131049', corpo: 'oi' });
    expect(r.ok === false && r.codigo).toBe('131049');
    expect(r.ok === false && r.retentar).toBe(true);
  });

  it('131026 (número sem WhatsApp) volta como definitivo', async () => {
    const r = await cliente().enviar({ tipo: 'texto', para: '+5584900000131026', corpo: 'oi' });
    expect(r.ok === false && r.retentar).toBe(false);
  });

  it('5xx da Meta volta como transitório', async () => {
    const r = await cliente().enviar({ tipo: 'texto', para: '+558490000000500', corpo: 'oi' });
    expect(r.ok === false && r.retentar).toBe(true);
  });

  it('token errado é reconhecido como token, não como erro genérico', async () => {
    const r = await cliente('token-errado').enviar({
      tipo: 'texto',
      para: '+5584988776655',
      corpo: 'oi',
    });
    expect(r.ok === false && r.codigo).toBe('token_meta_invalido');
  });

  it('a mídia é buscada em duas etapas, e a segunda também exige o bearer', async () => {
    const meta = await cliente().midia('midia-de-teste');
    expect(meta.ok).toBe(true);
    if (!meta.ok) return;
    expect(meta.mime).toContain('audio/ogg');

    const bytes = await cliente().baixar(meta.url);
    expect(bytes.ok).toBe(true);
    expect(bytes.ok === true && bytes.bytes.length).toBeGreaterThan(0);

    // Sem o bearer, a mesma URL não abre — é por isso que quem baixa é o
    // worker-wa, na hora, e não outro processo depois.
    const semToken = await cliente('token-errado').baixar(meta.url);
    expect(semToken.ok).toBe(false);
  });

  it('mídia inexistente não vira exceção, vira motivo', async () => {
    const r = await cliente().midia('nao-existe');
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.motivo).toContain('404');
  });

  it('servidor fora do ar vira "sem_resposta_da_meta" e retenta', async () => {
    const morto = new ClienteDaGraph({
      baseUrl: 'http://127.0.0.1:1',
      versao: VERSAO_PADRAO,
      phoneNumberId: '1',
      token: TOKEN,
      timeoutMs: 1_000,
    });
    const r = await morto.enviar({ tipo: 'texto', para: '+5584988776655', corpo: 'oi' });
    expect(r.ok === false && r.codigo).toBe('sem_resposta_da_meta');
    expect(r.ok === false && r.retentar).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 3. As chamadas da conta (ler/publicar) — modelos, número, webhooks
// ---------------------------------------------------------------------------

describe('GET e POST genéricos no Graph', () => {
  let duble: DubleDaGraph;

  beforeAll(async () => {
    duble = await subirDubleDaGraph(8794);
  }, 20_000);

  afterAll(() => {
    duble?.parar();
  });

  it('lê o número com os campos pedidos, com o bearer no cabeçalho', async () => {
    const r = await duble.cliente().ler('1234567890', {
      fields: 'display_phone_number,platform_type,status',
    });
    expect(r.ok).toBe(true);
    expect(r.ok === true && r.json).toEqual({
      id: '1234567890',
      display_phone_number: '+55 84 99999-0000',
      platform_type: 'CLOUD_API',
      status: 'CONNECTED',
    });
  });

  it('cria modelo e reconhece o "já existe" pelo subcódigo', async () => {
    await duble.zerar();
    const pedido = {
      name: 'gen_teste_v1',
      language: 'pt_BR',
      category: 'UTILITY',
      parameter_format: 'NAMED',
      components: [{ type: 'BODY', text: 'Oi, {{nome}}, tudo bem?' }],
    };
    const primeira = await duble.cliente().publicar('777/message_templates', pedido);
    expect(primeira.ok === true && primeira.json.status).toBe('PENDING');

    const segunda = await duble.cliente().publicar('777/message_templates', pedido);
    expect(segunda.ok).toBe(false);
    expect(segunda.ok === false && segunda.subcodigo).toBe(2388024);
    expect(segunda.ok === false && segunda.retentar).toBe(false);
  });

  it('manda formulário sem bearer quando o token do app vai no corpo', async () => {
    await duble.zerar();
    const r = await duble.cliente().publicar(
      '4242/subscriptions',
      {
        access_token: `4242|${SEGREDO_DO_APP_DE_TESTE}`,
        object: 'whatsapp_business_account',
        callback_url: 'https://exemplo.supabase.co/functions/v1/wa-webhook',
        verify_token: 'verificacao',
        fields: 'messages',
      },
      { formulario: true, semBearer: true },
    );
    expect(r.ok).toBe(true);
    const conta = await duble.conta();
    expect(conta.assinaturasDoApp).toHaveLength(1);
    expect(conta.assinaturasDoApp[0]?.fields).toBe('messages');
  });

  it('token errado numa chamada de conta também vira token_meta_invalido', async () => {
    const r = await duble.cliente({ token: 'token-errado' }).ler('777/message_templates');
    expect(r.ok === false && r.codigo).toBe('token_meta_invalido');
  });
});

describe('segredo não vaza em mensagem de erro', () => {
  it('nem o token do usuário de sistema, nem o token do app no corpo', async () => {
    const token = 'EAAG-token-secreto-123';
    const cliente = new ClienteDaGraph({
      baseUrl: 'http://127.0.0.1:1',
      versao: VERSAO_PADRAO,
      phoneNumberId: '1',
      token,
      buscar: (async () => {
        throw new Error(`falhou com ${token} e 99|segredo-do-app-xyz`);
      }) as unknown as typeof fetch,
    });
    const r = await cliente.publicar(
      '99/subscriptions',
      { access_token: '99|segredo-do-app-xyz' },
      { formulario: true, semBearer: true },
    );
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.mensagem).not.toContain(token);
    expect(r.ok === false && r.mensagem).not.toContain('segredo-do-app-xyz');
    expect(r.ok === false && r.mensagem).toContain('***');
  });
});
