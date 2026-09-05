/**
 * A fila `ai_jobs` vista do worker — a mesma esteira, outra boca.
 *
 * Não existe fila nova aqui. A migração 20260905000200 acrescentou `ai_jobs` e
 * `ai_dlq` ao catálogo de `public.ingest_queues` justamente para reusar o que a
 * esteira de ingestão já resolveu: `visibility timeout` dimensionado pelo
 * trabalho, chave de idempotência em `ingest_dedup`, backoff exponencial e
 * dead-letter configurável (ADR-11). Este arquivo só chama as mesmas quatro
 * RPC de `public` com o nome da fila da IA.
 *
 * ## A chave de idempotência viaja DENTRO do payload
 *
 * `app.ia_enfileirar(purpose, payload, chave)` grava em `ingest_dedup` a chave
 * `"<propósito>:<chave>"`, mas o payload que chega ao worker é
 * `{purpose, ...payload}` — a chave não vem junto. Sem ela o consumidor não tem
 * como concluir nem falhar a mensagem certa em `ingest_dedup`.
 *
 * O contrato, então, é este, e vale para quem enfileirar de SQL ou de TypeScript:
 * **`chave` é um campo do payload**, e o dedup usa `"<purpose>:<chave>"`. Quem
 * chamar `app.ia_enfileirar` precisa passar a mesma string nos dois lugares:
 *
 *   select app.ia_enfileirar('classify_inbound',
 *                            jsonb_build_object('chave', 'msg:<uuid>', 'message_id', '<uuid>'),
 *                            'msg:<uuid>');
 *
 * `enfileirarTrabalho` faz as duas coisas de uma vez e é o caminho preferido.
 * Mensagem que chegar sem `chave` ainda é processada — cai em `msg:<msg_id>`,
 * como no coletor —, mas perde a proteção contra reprocessamento: uma chamada
 * ao modelo repetida é dinheiro gasto duas vezes.
 */
import { createClient } from '@supabase/supabase-js';

import { ErroDaEsteira, type ClienteDoBanco, type MensagemDaFila } from '../ingest/esteira';

export type { ClienteDoBanco, MensagemDaFila };

/** As filas do worker de IA, como estão em `public.ingest_queues`. */
export const FILAS_DA_IA = {
  trabalhos: 'ai_jobs',
  mortas: 'ai_dlq',
} as const;

export type NomeDaFilaDaIa = (typeof FILAS_DA_IA)[keyof typeof FILAS_DA_IA];

/**
 * Conexão por HTTPS com a chave `service_role` (ADR-04). A chave ignora RLS:
 * nada deste módulo pode ser chamado a partir do navegador.
 */
export function criarClienteDaIa(url: string, chaveServico: string): ClienteDoBanco {
  return createClient(url, chaveServico, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { 'x-worker': 'ai' } },
  });
}

function objeto(valor: unknown): Record<string, unknown> {
  return typeof valor === 'object' && valor !== null && !Array.isArray(valor)
    ? (valor as Record<string, unknown>)
    : {};
}

async function rpc<T>(
  cliente: ClienteDoBanco,
  nome: string,
  argumentos: Record<string, unknown>,
): Promise<T> {
  const { data, error } = await cliente.rpc(nome, argumentos);
  if (error) throw new ErroDaEsteira(nome, error.message);
  return data as T;
}

export type RespostaDeEnfileiramento =
  | { enfileirado: true; msg_id: number }
  | { enfileirado: false; motivo: string };

/**
 * Põe um trabalho na fila da IA com a chave nos dois lugares que precisam dela:
 * dentro do payload (para o consumidor) e no dedup (para a idempotência).
 */
export async function enfileirarTrabalho(
  cliente: ClienteDoBanco,
  proposito: string,
  chave: string,
  payload: Record<string, unknown>,
  atrasoSegundos = 0,
): Promise<RespostaDeEnfileiramento> {
  return rpc<RespostaDeEnfileiramento>(cliente, 'esteira_fila_enfileirar', {
    p_queue: FILAS_DA_IA.trabalhos,
    p_payload: { ...payload, purpose: proposito, chave },
    p_key: `${proposito}:${chave}`,
    p_batch_id: null,
    p_delay: atrasoSegundos,
  });
}

export async function lerFilaDaIa(
  cliente: ClienteDoBanco,
  quantidade = 1,
  fila: NomeDaFilaDaIa = FILAS_DA_IA.trabalhos,
): Promise<MensagemDaFila[]> {
  const linhas = await rpc<unknown>(cliente, 'esteira_fila_ler', {
    p_queue: fila,
    p_qty: quantidade,
  });
  if (!Array.isArray(linhas)) return [];
  return linhas.map((linha) => {
    const l = objeto(linha);
    return {
      msg_id: Number(l.msg_id),
      entregas: Number(l.entregas ?? 0),
      enfileirada_em: String(l.enfileirada_em ?? ''),
      mensagem: objeto(l.mensagem),
    };
  });
}

export async function concluirDaIa(
  cliente: ClienteDoBanco,
  msgId: number,
  chave: string,
  fila: NomeDaFilaDaIa = FILAS_DA_IA.trabalhos,
): Promise<void> {
  await rpc<boolean>(cliente, 'esteira_fila_concluir', {
    p_queue: fila,
    p_msg_id: msgId,
    p_key: chave,
  });
}

export type RespostaDeFalha = { acao: string; tentativa: number };

export async function falharDaIa(
  cliente: ClienteDoBanco,
  msgId: number,
  chave: string,
  erro: string,
  fila: NomeDaFilaDaIa = FILAS_DA_IA.trabalhos,
): Promise<RespostaDeFalha> {
  return rpc<RespostaDeFalha>(cliente, 'esteira_fila_falhar', {
    p_queue: fila,
    p_msg_id: msgId,
    p_key: chave,
    p_erro: erro.slice(0, 2000),
  });
}

/**
 * A chave de dedup de uma mensagem já lida.
 *
 * `"<purpose>:<chave>"` quando os dois campos existem — é exatamente o que
 * `app.ia_enfileirar` grava. Sem eles, `msg:<msg_id>`: a mensagem é tratada e
 * arquivada, mas sem a trava contra reprocessamento.
 */
export function chaveDaMensagem(mensagem: MensagemDaFila): string {
  const proposito = mensagem.mensagem.purpose;
  const chave = mensagem.mensagem.chave;
  if (typeof proposito === 'string' && proposito !== '' && typeof chave === 'string' && chave !== '') {
    return `${proposito}:${chave}`;
  }
  return `msg:${mensagem.msg_id}`;
}
