/**
 * Só para teste: sobe o dublê da Graph API (`supabase/functions/_dubles/
 * meta-graph-duble.mjs`) numa porta de 127.0.0.1 e o derruba no fim. Cada
 * arquivo de teste usa a sua porta, porque o Vitest roda arquivos em paralelo.
 *
 * Não existe credencial da Meta neste repositório, e não é para existir.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { ClienteDaGraph, VERSAO_PADRAO } from './graph';

const AQUI = dirname(fileURLToPath(import.meta.url));
const DUBLE = resolve(AQUI, '../../../../supabase/functions/_dubles/meta-graph-duble.mjs');

export const TOKEN_DE_TESTE = 'token-de-teste-da-graph';
export const SEGREDO_DO_APP_DE_TESTE = 'segredo-do-app-de-teste';

export interface DubleDaGraph {
  url: string;
  cliente(opcoes?: { token?: string; phoneNumberId?: string }): ClienteDaGraph;
  zerar(): Promise<void>;
  /** Estado da conta no dublê: números, modelos, registros e assinaturas. */
  conta(): Promise<{
    numeros: Record<string, Record<string, unknown>>;
    modelos: Record<string, Record<string, unknown>[]>;
    registros: unknown[];
    assinaturasDaWaba: { waba_id: string; override_callback_uri: string | null }[];
    assinaturasDoApp: { app_id: string; object: string; callback_url: string; fields: string }[];
  }>;
  cenario(cenario: Record<string, unknown>): Promise<void>;
  parar(): void;
}

export async function subirDubleDaGraph(porta: number): Promise<DubleDaGraph> {
  const url = `http://127.0.0.1:${porta}`;
  const processo: ChildProcess = spawn(process.execPath, [DUBLE, 'servir', String(porta)], {
    env: {
      ...process.env,
      META_WA_ACCESS_TOKEN: TOKEN_DE_TESTE,
      META_WA_APP_SECRET: SEGREDO_DO_APP_DE_TESTE,
    },
    stdio: 'ignore',
  });

  let subiu = false;
  for (let i = 0; i < 60 && !subiu; i += 1) {
    try {
      const r = await fetch(`${url}/_enviadas`);
      subiu = r.ok;
    } catch {
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  if (!subiu) {
    processo.kill('SIGTERM');
    throw new Error('o dublê da Graph API não subiu');
  }

  return {
    url,
    cliente: (opcoes = {}) =>
      new ClienteDaGraph({
        baseUrl: url,
        versao: VERSAO_PADRAO,
        phoneNumberId: opcoes.phoneNumberId ?? '1234567890',
        token: opcoes.token ?? TOKEN_DE_TESTE,
        timeoutMs: 5_000,
      }),
    zerar: async () => {
      await fetch(`${url}/_zerar`, { method: 'POST' });
    },
    conta: async () => (await (await fetch(`${url}/_conta`)).json()) as never,
    cenario: async (cenario) => {
      await fetch(`${url}/_cenario`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(cenario),
      });
    },
    parar: () => {
      processo.kill('SIGTERM');
    },
  };
}
