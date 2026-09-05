// =============================================================================
// TRIADE — chamada de RPC no Postgres a partir de uma Edge Function
//
// Sem SDK, de propósito: o que precisamos é um POST em /rest/v1/rpc/<função>.
// Zero dependência externa significa zero surpresa de supply chain numa função
// que carrega segredo de integração e responde a webhook de fora.
//
// Duas identidades, nunca misturadas:
//   * `rpcServico`  — service_role. Só as cinco funções de `public` que têm
//     EXECUTE para service_role (ver migração 20260904001810, seção G).
//   * `rpcDoUsuario` — repassa o Authorization de quem chamou. A RLS e o
//     `auth.uid()` do Postgres decidem; a Edge Function não decide nada.
// =============================================================================

import { registrar } from './http.ts';

const URL_BASE = Deno.env.get('SUPABASE_URL') ?? '';
const CHAVE_SERVICO = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const CHAVE_ANON = Deno.env.get('SUPABASE_ANON_KEY') ?? '';

export class ErroDeBanco extends Error {
  constructor(
    readonly status: number,
    readonly detalhe: string,
  ) {
    super(`RPC devolveu ${status}: ${detalhe}`);
    this.name = 'ErroDeBanco';
  }
}

async function chamar(
  nome: string,
  args: Record<string, unknown>,
  autorizacao: string,
  apikey: string,
): Promise<unknown> {
  const resposta = await fetch(`${URL_BASE}/rest/v1/rpc/${nome}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey,
      Authorization: autorizacao,
    },
    body: JSON.stringify(args),
  });
  const texto = await resposta.text();
  if (!resposta.ok) {
    registrar('erro', { rpc: nome, status: resposta.status, detalhe: texto.slice(0, 400) });
    throw new ErroDeBanco(resposta.status, texto.slice(0, 400));
  }
  return texto.length === 0 ? null : JSON.parse(texto);
}

export function rpcServico<T = unknown>(
  nome: string,
  args: Record<string, unknown> = {},
): Promise<T> {
  return chamar(nome, args, `Bearer ${CHAVE_SERVICO}`, CHAVE_SERVICO) as Promise<T>;
}

export function rpcDoUsuario<T = unknown>(
  nome: string,
  args: Record<string, unknown>,
  autorizacao: string,
): Promise<T> {
  return chamar(nome, args, autorizacao, CHAVE_ANON) as Promise<T>;
}

export function rpcAnonimo<T = unknown>(
  nome: string,
  args: Record<string, unknown> = {},
): Promise<T> {
  return chamar(nome, args, `Bearer ${CHAVE_ANON}`, CHAVE_ANON) as Promise<T>;
}
