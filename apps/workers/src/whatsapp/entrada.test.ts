/**
 * A ORDEM do que acontece com uma mensagem que chegou é a regra, e é isto que
 * este arquivo mede:
 *
 *   1. gravar SEMPRE, antes de julgar — a mensagem em que alguém escreve
 *      "SAIR" é a prova do opt-out;
 *   2. opt-out ANTES de tudo o mais, e o tratamento PARA nele;
 *   3. áudio: baixar agora (a URL da Meta expira) e pedir a transcrição;
 *   4. texto: pedir a classificação.
 *
 * O banco entra como dublê: um objeto com `rpc` que grava o que foi chamado, na
 * ordem. Nenhuma rede, nenhum Supabase.
 */
import { describe, expect, it, vi } from 'vitest';

import { contagensDaEntradaZeradas, extensaoDoMime, tratarEntrada } from './entrada';
import { createLogger } from '../lib/log';

import type { ClienteDaGraph } from './graph';
import type { ClienteDoBanco } from './ponte';
import type { ContextoDaEntrada } from './entrada';

interface Chamada {
  nome: string;
  args: Record<string, unknown>;
}

function bancoFalso(respostas: Record<string, unknown> = {}): {
  cliente: ClienteDoBanco;
  chamadas: Chamada[];
} {
  const chamadas: Chamada[] = [];
  const padrao: Record<string, unknown> = {
    wa_entrada_registrar: {
      novo: true,
      message_id: '11111111-1111-4111-8111-111111111111',
      conversation_id: '22222222-2222-4222-8222-222222222222',
    },
    wa_eco_registrar: { novo: true, message_id: 'm', conversation_id: 'c' },
    wa_status_registrar: { ok: true, motivo: 'atualizado' },
    wa_optout_registrar: { ok: true, motivo: 'registrado', confirmacao_enfileirada: true },
    wa_midia_registrar: { ok: true },
    ia_fila_enfileirar: { enfileirado: true, msg_id: 1 },
    ...respostas,
  };
  const cliente = {
    rpc: (nome: string, args: Record<string, unknown>) => {
      chamadas.push({ nome, args });
      return Promise.resolve({ data: padrao[nome] ?? null, error: null });
    },
  } as unknown as ClienteDoBanco;
  return { cliente, chamadas };
}

function graphFalso(): ClienteDaGraph {
  return {
    midia: vi.fn(async () => ({ ok: true as const, url: 'http://x/1', mime: 'audio/ogg' })),
    baixar: vi.fn(async () => ({
      ok: true as const,
      bytes: new Uint8Array([1, 2, 3]),
      mime: 'audio/ogg',
    })),
  } as unknown as ClienteDaGraph;
}

const logger = createLogger({
  worker: 'teste',
  level: 'error',
  stdout: () => {},
  stderr: () => {},
});

function contexto(cliente: ClienteDoBanco, balde = ''): ContextoDaEntrada {
  return {
    cliente,
    graph: graphFalso(),
    logger,
    balde,
    supabaseUrl: 'http://127.0.0.1:54321',
    chaveServico: 'chave-de-teste',
  };
}

const MENSAGEM = {
  tipo: 'mensagem',
  chave: 'wamid.A',
  wamid: 'wamid.A',
  de: '+5584988776655',
  numero_da_empresa: '+5584999880011',
  tipo_da_mensagem: 'text',
  texto: 'Oi, tudo bem?',
  media_id: null,
  media_mime: null,
  ocorrido_em: '2026-09-05T12:00:00.000Z',
};

describe('mensagem recebida', () => {
  it('é GRAVADA antes de qualquer julgamento', async () => {
    const { cliente, chamadas } = bancoFalso();
    const c = contagensDaEntradaZeradas();
    await tratarEntrada(contexto(cliente), { ...MENSAGEM }, c);
    expect(chamadas[0]?.nome).toBe('wa_entrada_registrar');
    expect(c.mensagens).toBe(1);
  });

  it('texto novo pede a classificação ao worker-ai', async () => {
    const { cliente, chamadas } = bancoFalso();
    const c = contagensDaEntradaZeradas();
    await tratarEntrada(contexto(cliente), { ...MENSAGEM }, c);
    const ia = chamadas.find((x) => x.nome === 'ia_fila_enfileirar');
    expect(ia?.args.p_purpose).toBe('classify_inbound');
    expect(c.classificacoes_pedidas).toBe(1);
  });

  it('reentrega da Meta não faz nada além de contar', async () => {
    const { cliente, chamadas } = bancoFalso({
      wa_entrada_registrar: { novo: false, message_id: 'm', conversation_id: 'c' },
    });
    const c = contagensDaEntradaZeradas();
    await tratarEntrada(contexto(cliente), { ...MENSAGEM }, c);
    expect(c.repetidas).toBe(1);
    expect(c.mensagens).toBe(0);
    expect(chamadas.map((x) => x.nome)).toEqual(['wa_entrada_registrar']);
  });

  it('mensagem sem wamid é ignorada com nome, não repetida cinco vezes', async () => {
    const { cliente, chamadas } = bancoFalso();
    const c = contagensDaEntradaZeradas();
    await tratarEntrada(contexto(cliente), { ...MENSAGEM, wamid: null }, c);
    expect(c.ignorados).toBe(1);
    expect(chamadas).toHaveLength(0);
  });
});

describe('OPT-OUT — antes de tudo, e o tratamento para nele', () => {
  it('grava a mensagem, registra a supressão, e não faz mais nada', async () => {
    const { cliente, chamadas } = bancoFalso();
    const c = contagensDaEntradaZeradas();
    await tratarEntrada(contexto(cliente), { ...MENSAGEM, texto: 'SAIR' }, c);

    expect(chamadas.map((x) => x.nome)).toEqual(['wa_entrada_registrar', 'wa_optout_registrar']);
    expect(c.optouts).toBe(1);
    // Nada de IA: gastar modelo com quem acabou de sair é gastar dinheiro
    // para desrespeitar.
    expect(c.classificacoes_pedidas).toBe(0);
    expect(c.transcricoes_pedidas).toBe(0);
  });

  it('a evidência que vai ao consent_events cita a regra que disparou', async () => {
    const { cliente, chamadas } = bancoFalso();
    await tratarEntrada(
      contexto(cliente),
      { ...MENSAGEM, texto: 'por favor me tira da lista' },
      contagensDaEntradaZeradas(),
    );
    const optout = chamadas.find((x) => x.nome === 'wa_optout_registrar');
    expect(String(optout?.args.p_evidencia)).toContain('me tira da lista');
    expect(optout?.args.p_confirmar).toBe(true);
  });

  it('opt-out em ÁUDIO com legenda também para antes de transcrever', async () => {
    const { cliente, chamadas } = bancoFalso();
    const c = contagensDaEntradaZeradas();
    await tratarEntrada(
      contexto(cliente, 'mensagens'),
      { ...MENSAGEM, tipo_da_mensagem: 'audio', media_id: '99', texto: 'para de mandar' },
      c,
    );
    expect(chamadas.map((x) => x.nome)).toEqual(['wa_entrada_registrar', 'wa_optout_registrar']);
    expect(c.transcricoes_pedidas).toBe(0);
  });

  it('"consigo para quinta às 9h30" NÃO é opt-out e segue para a classificação', async () => {
    const { cliente, chamadas } = bancoFalso();
    const c = contagensDaEntradaZeradas();
    await tratarEntrada(
      contexto(cliente),
      { ...MENSAGEM, texto: 'consigo para quinta às 9h30' },
      c,
    );
    expect(chamadas.some((x) => x.nome === 'wa_optout_registrar')).toBe(false);
    expect(c.classificacoes_pedidas).toBe(1);
  });
});

describe('áudio (RF-CON-27, R13)', () => {
  it('pede a transcrição com a chave do wamid — a mesma mensagem não é transcrita duas vezes', async () => {
    const { cliente, chamadas } = bancoFalso();
    const c = contagensDaEntradaZeradas();
    await tratarEntrada(
      contexto(cliente),
      {
        ...MENSAGEM,
        tipo_da_mensagem: 'audio',
        texto: null,
        media_id: '99',
        media_mime: 'audio/ogg',
      },
      c,
    );
    const ia = chamadas.find((x) => x.nome === 'ia_fila_enfileirar');
    expect(ia?.args.p_purpose).toBe('transcribe_audio');
    expect(ia?.args.p_key).toBe('wamid.A');
    expect(c.transcricoes_pedidas).toBe(1);
    // Sem transcrição não há o que classificar: quem enfileira a
    // classificação, para áudio, é o worker-ai depois de transcrever.
    expect(c.classificacoes_pedidas).toBe(0);
  });

  it('com balde vazio o download é pulado, e a transcrição continua sendo pedida', async () => {
    const { cliente, chamadas } = bancoFalso();
    const c = contagensDaEntradaZeradas();
    await tratarEntrada(
      contexto(cliente, ''),
      { ...MENSAGEM, tipo_da_mensagem: 'audio', texto: null, media_id: '99' },
      c,
    );
    expect(c.midias_baixadas).toBe(0);
    expect(chamadas.some((x) => x.nome === 'wa_midia_registrar')).toBe(false);
    expect(c.transcricoes_pedidas).toBe(1);
  });
});

describe('recibo e eco', () => {
  it('recibo é aplicado pelo wamid', async () => {
    const { cliente, chamadas } = bancoFalso();
    const c = contagensDaEntradaZeradas();
    await tratarEntrada(
      contexto(cliente),
      {
        tipo: 'recibo',
        chave: 'status:wamid.X:delivered',
        wamid: 'wamid.X',
        estado: 'delivered',
        ocorrido_em: '2026-09-05T12:00:00.000Z',
        codigo: null,
        detalhe: null,
      },
      c,
    );
    expect(chamadas[0]?.nome).toBe('wa_status_registrar');
    expect(chamadas[0]?.args.p_status).toBe('delivered');
    expect(c.recibos).toBe(1);
  });

  it('recibo de mensagem ainda desconhecida não é erro (o eco pode chegar depois)', async () => {
    const { cliente } = bancoFalso({
      wa_status_registrar: { ok: false, motivo: 'mensagem_desconhecida' },
    });
    const c = contagensDaEntradaZeradas();
    await expect(
      tratarEntrada(
        contexto(cliente),
        { tipo: 'recibo', chave: 'k', wamid: 'wamid.Z', estado: 'sent' },
        c,
      ),
    ).resolves.toBeUndefined();
    expect(c.recibos).toBe(1);
  });

  it('eco do Coexistence vira mensagem de saída registrada', async () => {
    const { cliente, chamadas } = bancoFalso();
    const c = contagensDaEntradaZeradas();
    await tratarEntrada(
      contexto(cliente),
      {
        tipo: 'eco',
        chave: 'wamid.E',
        wamid: 'wamid.E',
        para: '+5584988776655',
        numero_da_empresa: '+5584999880011',
        tipo_da_mensagem: 'text',
        texto: 'Oi, Marcos',
        ocorrido_em: '2026-09-05T12:00:00.000Z',
      },
      c,
    );
    expect(chamadas[0]?.nome).toBe('wa_eco_registrar');
    expect(c.ecos).toBe(1);
  });

  it('tipo desconhecido não derruba a volta', async () => {
    const { cliente } = bancoFalso();
    const c = contagensDaEntradaZeradas();
    await tratarEntrada(contexto(cliente), { tipo: 'coisa_nova', chave: 'k' }, c);
    expect(c.ignorados).toBe(1);
  });
});

describe('BSUID — nomes de usuário do WhatsApp (migração 20260915120000)', () => {
  const BSUID = 'BR.13491208655302741918';

  it('com telefone e BSUID: os dois vão para o banco, e o resto segue igual', async () => {
    const { cliente, chamadas } = bancoFalso();
    const c = contagensDaEntradaZeradas();
    await tratarEntrada(contexto(cliente), { ...MENSAGEM, de_user_id: BSUID }, c);
    expect(chamadas[0]?.nome).toBe('wa_entrada_registrar');
    expect(chamadas[0]?.args.p_peer_phone).toBe('+5584988776655');
    expect(chamadas[0]?.args.p_peer_user_id).toBe(BSUID);
    expect(c.mensagens).toBe(1);
    expect(c.classificacoes_pedidas).toBe(1);
  });

  it('item antigo da fila, sem de_user_id, manda BSUID nulo', async () => {
    const { cliente, chamadas } = bancoFalso();
    await tratarEntrada(contexto(cliente), { ...MENSAGEM }, contagensDaEntradaZeradas());
    expect(chamadas[0]?.args.p_peer_user_id).toBeNull();
  });

  it('SEM telefone, conversa conhecida: o banco acha o fio e o opt-out continua valendo', async () => {
    const { cliente, chamadas } = bancoFalso();
    const c = contagensDaEntradaZeradas();
    await tratarEntrada(
      contexto(cliente),
      { ...MENSAGEM, de: null, de_user_id: BSUID, texto: 'SAIR' },
      c,
    );
    expect(chamadas[0]?.args.p_peer_phone).toBeNull();
    expect(chamadas[0]?.args.p_peer_user_id).toBe(BSUID);
    expect(chamadas.map((x) => x.nome)).toEqual(['wa_entrada_registrar', 'wa_optout_registrar']);
    expect(c.optouts).toBe(1);
    expect(c.ignorados).toBe(0);
  });

  it('SEM telefone e ninguém conhece o BSUID: conta, avisa, e não chama mais nada', async () => {
    const { cliente, chamadas } = bancoFalso({
      wa_entrada_registrar: {
        novo: true,
        message_id: null,
        conversation_id: null,
        sem_telefone: true,
      },
    });
    const linhas: string[] = [];
    const ctx = {
      ...contexto(cliente),
      logger: createLogger({
        worker: 'teste',
        level: 'debug',
        stdout: (l) => linhas.push(l),
        stderr: (l) => linhas.push(l),
      }),
    };
    const c = contagensDaEntradaZeradas();
    await tratarEntrada(ctx, { ...MENSAGEM, de: null, de_user_id: BSUID }, c);
    expect(chamadas.map((x) => x.nome)).toEqual(['wa_entrada_registrar']);
    expect(c.sem_telefone).toBe(1);
    expect(c.mensagens).toBe(0);
    expect(linhas.join('\n')).toContain('dead-letter');
    expect(linhas.join('\n')).toContain(BSUID);
  });

  it('SEM telefone, ninguém conhece, e a pessoa pediu para SAIR: vira erro, sem opt-out falso', async () => {
    const { cliente, chamadas } = bancoFalso({
      wa_entrada_registrar: {
        novo: true,
        message_id: null,
        conversation_id: null,
        sem_telefone: true,
      },
    });
    const erros: string[] = [];
    const ctx = {
      ...contexto(cliente),
      logger: createLogger({
        worker: 'teste',
        level: 'error',
        stdout: () => {},
        stderr: (l) => erros.push(l),
      }),
    };
    const c = contagensDaEntradaZeradas();
    await tratarEntrada(ctx, { ...MENSAGEM, de: null, de_user_id: BSUID, texto: 'parar' }, c);
    // Não há conversa: chamar wa_optout_registrar com id nulo seria fingir.
    expect(chamadas.some((x) => x.nome === 'wa_optout_registrar')).toBe(false);
    expect(c.optouts).toBe(0);
    expect(erros).toHaveLength(1);
    expect(erros[0]).toContain('opt-out SEM telefone');
  });

  it('sem telefone E sem BSUID continua ignorada, sem ir ao banco', async () => {
    const { cliente, chamadas } = bancoFalso();
    const c = contagensDaEntradaZeradas();
    await tratarEntrada(contexto(cliente), { ...MENSAGEM, de: null, de_user_id: null }, c);
    expect(c.ignorados).toBe(1);
    expect(chamadas).toHaveLength(0);
  });

  it('recibo com recipient_user_id: aplicado pelo wamid e leva o BSUID junto', async () => {
    const { cliente, chamadas } = bancoFalso();
    const c = contagensDaEntradaZeradas();
    await tratarEntrada(
      contexto(cliente),
      {
        tipo: 'recibo',
        chave: 'status:wamid.X:read',
        wamid: 'wamid.X',
        estado: 'read',
        para_user_id: BSUID,
        ocorrido_em: '2026-09-15T12:00:00.000Z',
      },
      c,
    );
    expect(chamadas[0]?.nome).toBe('wa_status_registrar');
    expect(chamadas[0]?.args.p_wamid).toBe('wamid.X');
    expect(chamadas[0]?.args.p_user_id).toBe(BSUID);
    expect(c.recibos).toBe(1);
  });
});

describe('a saúde do número (Fase 3 do pivô)', () => {
  const SAUDE = {
    tipo: 'saude',
    chave: 'saude:account_update:e1:1757030000:0',
    numero: null,
    campo: 'account_update',
    evento: 'ACCOUNT_RESTRICTION',
    qualidade: null,
    limite_anterior: null,
    limite_atual: null,
    conversas_por_dia: null,
    restricoes: [{ restriction_type: 'RESTRICTED_BIZ_INITIATED_MESSAGING' }],
    banido: false,
    payload: { event: 'ACCOUNT_RESTRICTION' },
    ocorrido_em: '2026-09-25T12:00:00.000Z',
  };

  it('vira uma linha de histórico, e NENHUMA decisão do lado de cá', async () => {
    const { cliente, chamadas } = bancoFalso({ wa_saude_registrar: 42 });
    const c = contagensDaEntradaZeradas();
    await tratarEntrada(contexto(cliente), { ...SAUDE }, c);

    expect(c.saude_registrada).toBe(1);
    expect(c.ignorados).toBe(0);
    expect(chamadas).toHaveLength(1);
    expect(chamadas[0]?.nome).toBe('wa_saude_registrar');
    const item = (chamadas[0]?.args as { p_item: Record<string, unknown> }).p_item;
    expect(item.origem).toBe('webhook');
    expect(item.campo).toBe('account_update');
    // O `value` inteiro viaja: o que hoje ninguém lê pode ser a pergunta de
    // amanhã, e um webhook não volta.
    expect(item.payload).toEqual({ event: 'ACCOUNT_RESTRICTION' });
    // O número vem nulo de propósito — `account_update` é da WABA. Quem o
    // preenche é `app.wa_numero_padrao()`, dentro do banco.
    expect(item.numero).toBe(null);
  });

  it('item de saúde sem campo é ignorado com nome, não gravado pela metade', async () => {
    const { cliente, chamadas } = bancoFalso();
    const c = contagensDaEntradaZeradas();
    await tratarEntrada(contexto(cliente), { tipo: 'saude' }, c);
    expect(c.ignorados).toBe(1);
    expect(c.saude_registrada).toBe(0);
    expect(chamadas).toHaveLength(0);
  });
});

describe('extensão do arquivo pelo mime', () => {
  it.each([
    ['audio/ogg; codecs=opus', '.ogg'],
    ['audio/mpeg', '.mp3'],
    ['image/jpeg', '.jpg'],
    ['application/pdf', '.pdf'],
    ['coisa/estranha', '.bin'],
  ])('%s → %s', (mime, esperado) => {
    expect(extensaoDoMime(mime)).toBe(esperado);
  });
});
