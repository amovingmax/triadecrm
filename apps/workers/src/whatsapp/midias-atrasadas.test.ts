/**
 * A passada de recuperação das mídias: pega no banco o que ficou sem arquivo,
 * baixa, guarda e registra — e anota a falha, para a mídia que a Meta já
 * apagou sair da fila na terceira tentativa.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import { recuperarMidias } from './midias-atrasadas';
import { createLogger } from '../lib/log';

import type { ContextoDaEntrada } from './entrada';
import type { ClienteDaGraph } from './graph';
import type { ClienteDoBanco } from './ponte';

interface Chamada {
  nome: string;
  args: Record<string, unknown>;
}

const logger = createLogger({ worker: 'teste', level: 'error', stdout: () => {}, stderr: () => {} });

function montar(pendentes: unknown[], balde = 'mensagens') {
  const chamadas: Chamada[] = [];
  const cliente = {
    rpc: (nome: string, args: Record<string, unknown>) => {
      chamadas.push({ nome, args });
      const data =
        nome === 'wa_midias_sem_arquivo'
          ? pendentes
          : nome === 'wa_midia_falhou'
            ? { ok: true, tentativas: 1 }
            : { ok: true };
      return Promise.resolve({ data, error: null });
    },
  } as unknown as ClienteDoBanco;
  const ctx: ContextoDaEntrada = {
    cliente,
    graph: {
      midia: vi.fn(async () => ({ ok: true as const, url: 'http://x/1', mime: 'image/jpeg' })),
      baixar: vi.fn(async () => ({ ok: true as const, bytes: new Uint8Array([1]), mime: 'image/jpeg' })),
    } as unknown as ClienteDaGraph,
    logger,
    balde,
    supabaseUrl: 'http://127.0.0.1:54321',
    chaveServico: 'chave-de-teste',
  };
  return { ctx, chamadas };
}

const FOTO = {
  message_id: '33333333-3333-4333-8333-333333333333',
  conversation_id: '44444444-4444-4444-8444-444444444444',
  media_id: 'mid-1',
  tipo: 'image',
};

describe('recuperação das mídias sem arquivo', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('baixa, guarda e registra o que ficou sem arquivo', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 200 })));
    const { ctx, chamadas } = montar([FOTO]);
    const r = await recuperarMidias(ctx);
    expect(r).toEqual({ vistas: 1, baixadas: 1, falhas: 0 });
    const registro = chamadas.find((x) => x.nome === 'wa_midia_registrar');
    expect(registro?.args.p_message_id).toBe(FOTO.message_id);
    expect(registro?.args.p_media_path).toBe(`${FOTO.conversation_id}/${FOTO.message_id}.jpg`);
    expect(chamadas.some((x) => x.nome === 'wa_midia_falhou')).toBe(false);
  });

  it('o que não deu fica anotado, para sair da fila na terceira vez', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('não', { status: 500 })));
    const { ctx, chamadas } = montar([FOTO]);
    const r = await recuperarMidias(ctx);
    expect(r).toEqual({ vistas: 1, baixadas: 0, falhas: 1 });
    expect(chamadas.find((x) => x.nome === 'wa_midia_falhou')?.args.p_message_id).toBe(FOTO.message_id);
    expect(chamadas.some((x) => x.nome === 'wa_midia_registrar')).toBe(false);
  });

  it('linha incompleta da fila é ignorada, sem derrubar a passada', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 200 })));
    const { ctx } = montar([{ message_id: null }, FOTO]);
    const r = await recuperarMidias(ctx);
    expect(r.vistas).toBe(1);
    expect(r.baixadas).toBe(1);
  });

  it('sem balde configurado, nem pergunta ao banco', async () => {
    const { ctx, chamadas } = montar([FOTO], '');
    const r = await recuperarMidias(ctx);
    expect(r).toEqual({ vistas: 0, baixadas: 0, falhas: 0 });
    expect(chamadas).toHaveLength(0);
  });
});
