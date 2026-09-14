/**
 * `workers wa --conectar`, contra o dublê da Graph API e um banco falso.
 *
 * O que importa medir: cada passo diz ✓ ou ✗ com o que fazer; o registro na
 * Cloud API NÃO é tentado "por garantia" (10 tentativas em 72 h por número);
 * a assinatura recusada pelo app cai no override da WABA; e nenhum segredo
 * aparece na saída.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  configDaConexao,
  conectarNumero,
  paraNumeroNaMeta,
  precisaRegistrar,
  urlDoWebhook,
  type ConfigDaConexao,
} from './conectar';
import {
  SEGREDO_DO_APP_DE_TESTE,
  TOKEN_DE_TESTE,
  subirDubleDaGraph,
  type DubleDaGraph,
} from './duble-da-graph-de-teste';
import { resumoZerado, type ResultadoDaSincronizacao } from './modelos-meta';
import { loadEnv } from '../lib/env';
import { createLogger } from '../lib/log';

import type { ClienteDoBanco } from './ponte';

const logger = createLogger({
  worker: 'teste',
  level: 'error',
  stdout: () => {},
  stderr: () => {},
});

const VERIFY_TOKEN = 'verificacao-secreta-do-webhook';

function config(parcial: Partial<ConfigDaConexao> = {}): ConfigDaConexao {
  return {
    phoneNumberId: '1234567890',
    wabaId: '777',
    appId: '4242',
    appSecret: SEGREDO_DO_APP_DE_TESTE,
    verifyToken: VERIFY_TOKEN,
    pin: null,
    callbackUrl: 'https://projeto.supabase.co/functions/v1/wa-webhook',
    ...parcial,
  };
}

interface Chamada {
  nome: string;
  args: Record<string, unknown>;
}

function bancoFalso(erro: string | null = null): { cliente: ClienteDoBanco; chamadas: Chamada[] } {
  const chamadas: Chamada[] = [];
  const cliente = {
    rpc: (nome: string, args: Record<string, unknown>) => {
      chamadas.push({ nome, args });
      if (erro) return Promise.resolve({ data: null, error: { message: erro } });
      return Promise.resolve({
        data: { ok: true, numero_padrao: '+5584999990000', aquecimento_recomecou: true },
        error: null,
      });
    },
  } as unknown as ClienteDoBanco;
  return { cliente, chamadas };
}

const sincronizouBem = async (): Promise<ResultadoDaSincronizacao> => ({
  ok: true,
  interrompida: false,
  resumo: { ...resumoZerado(), enviados: 3, pendentes: 3 },
});

describe('workers wa --conectar', () => {
  let duble: DubleDaGraph;

  beforeAll(async () => {
    duble = await subirDubleDaGraph(8793);
  }, 20_000);

  afterAll(() => {
    duble?.parar();
  });

  beforeEach(async () => {
    await duble.zerar();
  });

  async function rodar(
    cfg: ConfigDaConexao,
    opcoes: {
      token?: string;
      banco?: ReturnType<typeof bancoFalso>;
      sincronizar?: () => Promise<ResultadoDaSincronizacao>;
    } = {},
  ) {
    const linhas: string[] = [];
    const banco = opcoes.banco ?? bancoFalso();
    const codigo = await conectarNumero({
      cliente: banco.cliente,
      graph: duble.cliente({ token: opcoes.token, phoneNumberId: cfg.phoneNumberId }),
      logger,
      config: cfg,
      escrever: (l) => linhas.push(l),
      sincronizar: opcoes.sincronizar ?? sincronizouBem,
    });
    return { codigo, saida: linhas.join('\n'), linhas, banco };
  }

  it('número JÁ registrado: seis ✓, sem gastar tentativa de registro', async () => {
    const { codigo, saida, banco, linhas } = await rodar(config());
    expect(codigo).toBe(0);
    expect(linhas.filter((l) => l.startsWith('✓'))).toHaveLength(6);
    expect(saida).toContain(
      '✓ 1/6 Número na Meta: +55 84 99999-0000 · "Komune" · qualidade GREEN · CLOUD_API/CONNECTED',
    );
    expect(saida).toContain('✓ 2/6 Já registrado na Cloud API');
    expect(saida).toContain('Modelos: 3 enviados');

    const conta = await duble.conta();
    expect(conta.registros).toHaveLength(0);
    expect(conta.assinaturasDaWaba).toEqual([{ waba_id: '777', override_callback_uri: null }]);
    expect(conta.assinaturasDoApp).toEqual([
      {
        app_id: '4242',
        object: 'whatsapp_business_account',
        callback_url: 'https://projeto.supabase.co/functions/v1/wa-webhook',
        fields: 'messages',
      },
    ]);

    expect(banco.chamadas).toEqual([
      {
        nome: 'wa_numero_configurar',
        args: {
          p_numero: '+55 84 99999-0000',
          p_phone_number_id: '1234567890',
          p_waba_id: '777',
          p_nome_exibicao: 'Komune',
          p_qualidade: 'GREEN',
        },
      },
    ]);
    expect(saida).toContain('+5584999990000');
    expect(saida).toContain('aquecimento');
  });

  it('NENHUM segredo aparece na saída', async () => {
    const { saida } = await rodar(config({ phoneNumberId: '5550001', pin: '123456' }));
    expect(saida).not.toContain(TOKEN_DE_TESTE);
    expect(saida).not.toContain(SEGREDO_DO_APP_DE_TESTE);
    expect(saida).not.toContain(VERIFY_TOKEN);
    expect(saida).not.toContain('123456');
  });

  it('número NÃO registrado e sem PIN: ✗ no passo 2, explica o PIN, e segue os outros passos', async () => {
    const { codigo, saida } = await rodar(config({ phoneNumberId: '5550001' }));
    expect(codigo).toBe(1);
    expect(saida).toContain('✗ 2/6');
    expect(saida).toContain('META_WA_PIN');
    expect(saida).toContain('6 dígitos');
    expect(saida).toContain('✓ 3/6');
    expect(saida).toContain('✓ 6/6');
    expect((await duble.conta()).registros).toHaveLength(0);
  });

  it('número NÃO registrado com PIN: registra e mostra o status novo', async () => {
    const { codigo, saida } = await rodar(config({ phoneNumberId: '5550001', pin: '123456' }));
    expect(codigo).toBe(0);
    expect(saida).toContain('✓ 2/6 Registrado na Cloud API: agora CLOUD_API/CONNECTED.');
    const conta = await duble.conta();
    expect(conta.registros).toHaveLength(1);
    expect(conta.numeros['5550001']).toMatchObject({
      platform_type: 'CLOUD_API',
      status: 'CONNECTED',
    });
  });

  it('PIN errado (133005): ✗ com o que fazer', async () => {
    const { codigo, saida } = await rodar(config({ phoneNumberId: '5550001', pin: '000000' }));
    expect(codigo).toBe(1);
    expect(saida).toContain('✗ 2/6 A Meta recusou o registro (133005');
    expect(saida).toContain('PIN errado');
  });

  it('PIN com formato errado não gasta tentativa', async () => {
    const { saida } = await rodar(config({ phoneNumberId: '5550001', pin: '12ab' }));
    expect(saida).toContain('✗ 2/6 META_WA_PIN não tem 6 dígitos.');
    expect((await duble.conta()).registros).toHaveLength(0);
  });

  it('número sem verificação por código não gasta tentativa de registro', async () => {
    await duble.cenario({ numeros: { 5550001: { code_verification_status: 'NOT_VERIFIED' } } });
    const { saida } = await rodar(config({ phoneNumberId: '5550001', pin: '123456' }));
    expect(saida).toContain('✗ 2/6 O número ainda não foi verificado');
    expect((await duble.conta()).registros).toHaveLength(0);
  });

  it('assinatura pelo app RECUSADA pela Meta: cai no override de callback da WABA', async () => {
    await duble.cenario({ recusarAssinaturaDoApp: true });
    const { codigo, saida } = await rodar(config());
    expect(codigo).toBe(0);
    expect(saida).toContain('✓ 4/6');
    expect(saida).toContain('override na WABA');
    const conta = await duble.conta();
    expect(conta.assinaturasDaWaba).toContainEqual({
      waba_id: '777',
      override_callback_uri: 'https://projeto.supabase.co/functions/v1/wa-webhook',
    });
  });

  it('segredo do app errado: a assinatura pelo app falha e o override da WABA assume', async () => {
    const { saida } = await rodar(config({ appSecret: 'segredo-errado' }));
    expect(saida).toContain('✓ 4/6');
    expect(saida).toContain('token_meta_invalido');
    expect(saida).not.toContain('segredo-errado');
  });

  it('app E override recusados (verificação do callback falhou): ✗ explica a Edge Function e o token', async () => {
    await duble.cenario({ recusarAssinaturaDoApp: true, recusarOverrideDaWaba: true });
    const { codigo, saida } = await rodar(config());
    expect(codigo).toBe(1);
    expect(saida).toContain(
      '✗ 4/6 A Meta não aceitou o webhook em https://projeto.supabase.co/functions/v1/wa-webhook',
    );
    expect(saida).toContain('wa-webhook precisa estar publicada');
    expect(saida).toContain('META_WA_VERIFY_TOKEN');
    expect(saida).not.toContain(VERIFY_TOKEN);
  });

  it('token errado: ✗ no passo 1 e para — sem tocar no banco', async () => {
    const banco = bancoFalso();
    const { codigo, linhas } = await rodar(config(), { token: 'token-errado', banco });
    expect(codigo).toBe(1);
    expect(linhas).toHaveLength(1);
    expect(linhas[0]).toContain('✗ 1/6');
    expect(linhas[0]).toContain('META_WA_ACCESS_TOKEN');
    expect(banco.chamadas).toHaveLength(0);
  });

  it('banco sem a migração: ✗ no passo 5, os outros seguem', async () => {
    const { codigo, saida } = await rodar(config(), {
      banco: bancoFalso('Could not find the function public.wa_numero_configurar'),
    });
    expect(codigo).toBe(1);
    expect(saida).toContain('✗ 5/6');
    expect(saida).toContain('20260914100000');
    expect(saida).toContain('✓ 6/6');
  });

  it('sincronização de modelos que para no meio: ✗ no passo 6', async () => {
    const { codigo, saida } = await rodar(config(), {
      sincronizar: async () => ({
        ok: false,
        erro: 'criar modelo na Meta: 4: limite',
        resumo: resumoZerado(),
      }),
    });
    expect(codigo).toBe(1);
    expect(saida).toContain('✗ 6/6 Sincronização de modelos parou');
    expect(saida).toContain('--sincronizar-modelos');
  });
});

describe('o que --conectar exige e decide', () => {
  const base = {
    SUPABASE_URL: 'https://projeto.supabase.co/',
    SUPABASE_SERVICE_ROLE_KEY: 'chave',
    META_WA_ACCESS_TOKEN: 'token',
    META_WA_PHONE_NUMBER_ID: '123',
  };

  it('lista o que falta, com onde achar', () => {
    const env = loadEnv('wa', base);
    expect(env.ok).toBe(true);
    if (!env.ok) return;
    const r = configDaConexao(env.env);
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.faltando.join('\n')).toContain('META_WA_BUSINESS_ACCOUNT_ID');
    expect(r.ok === false && r.faltando.join('\n')).toContain('META_APP_ID');
    expect(r.ok === false && r.faltando.join('\n')).toContain('META_WA_APP_SECRET');
    expect(r.ok === false && r.faltando.join('\n')).toContain('META_WA_VERIFY_TOKEN');
  });

  it('com tudo, monta a config; o webhook padrão é a Edge Function do projeto', () => {
    const env = loadEnv('wa', {
      ...base,
      META_WA_BUSINESS_ACCOUNT_ID: '777',
      META_APP_ID: '4242',
      META_WA_APP_SECRET: 's',
      META_WA_VERIFY_TOKEN: 'v',
      META_WA_PIN: '',
      WA_WEBHOOK_URL: '',
    });
    expect(env.ok).toBe(true);
    if (!env.ok) return;
    const r = configDaConexao(env.env);
    expect(r.ok === true && r.config).toEqual({
      phoneNumberId: '123',
      wabaId: '777',
      appId: '4242',
      appSecret: 's',
      verifyToken: 'v',
      pin: null,
      callbackUrl: 'https://projeto.supabase.co/functions/v1/wa-webhook',
    });
    expect(
      urlDoWebhook({ SUPABASE_URL: 'http://x', WA_WEBHOOK_URL: 'https://outro.exemplo/wa' }),
    ).toBe('https://outro.exemplo/wa');
  });

  it('precisa registrar só quem não está na Cloud API ou caiu', () => {
    const n = (plataforma: string, status: string) =>
      paraNumeroNaMeta({ platform_type: plataforma, status });
    expect(precisaRegistrar(n('NOT_APPLICABLE', 'PENDING'))).toBe(true);
    expect(precisaRegistrar(n('ON_PREMISE', 'CONNECTED'))).toBe(true);
    expect(precisaRegistrar(n('CLOUD_API', 'PENDING'))).toBe(true);
    expect(precisaRegistrar(n('CLOUD_API', 'DISCONNECTED'))).toBe(true);
    expect(precisaRegistrar(n('CLOUD_API', 'CONNECTED'))).toBe(false);
    // Qualidade não é conexão: registrar de novo não melhora nada.
    expect(precisaRegistrar(n('CLOUD_API', 'FLAGGED'))).toBe(false);
    expect(precisaRegistrar(n('CLOUD_API', 'RESTRICTED'))).toBe(false);
  });

  it('lê a vazão de throughput.level', () => {
    expect(paraNumeroNaMeta({ throughput: { level: 'STANDARD' } }).vazao).toBe('STANDARD');
  });
});
