/**
 * Ajustes → Integrações: o que a tela lê e grava (17/11/2026).
 *
 * Tudo por funções do banco (migração 20261117200000), que conferem
 * `app.admin_ou_gestor()`: a tela só evita oferecer o que o banco recusaria.
 * As tabelas (`app.api_*`) não abrem para ninguém; a chave e o segredo do
 * webhook só existem na resposta de quem cria, uma vez.
 */
import { createClient } from '@/lib/supabase/client';

import { fraseDaRecusa, type Entrega, type Integracoes } from './integracoes-regras';

export const CHAVE_DAS_INTEGRACOES = ['admin', 'integracoes'] as const;

type Recusavel = { ok?: boolean; motivo?: string; mensagem?: string };

export class RecusaDaIntegracao extends Error {}

function conferir<T extends Recusavel>(dados: unknown): T {
  const r = (dados ?? {}) as T;
  if (!r.ok) throw new RecusaDaIntegracao(r.mensagem ?? fraseDaRecusa(r.motivo));
  return r;
}

export async function carregarIntegracoes(): Promise<Integracoes> {
  const { data, error } = await createClient().rpc('api_integracoes');
  if (error) throw new Error(error.message);
  return data as unknown as Integracoes;
}

export async function criarChave(nome: string, escopos: string[], emNomeDe: string) {
  const { data, error } = await createClient().rpc('api_chave_criar', {
    p_nome: nome,
    p_escopos: escopos,
    p_em_nome_de: emNomeDe,
  });
  if (error) throw new Error(error.message);
  return conferir<Recusavel & { id: string; chave: string; prefixo: string }>(data);
}

export async function revogarChave(id: string) {
  const { data, error } = await createClient().rpc('api_chave_revogar', { p_id: id });
  if (error) throw new Error(error.message);
  return conferir(data);
}

export async function criarWebhook(url: string, eventos: string[], descricao: string) {
  const { data, error } = await createClient().rpc('api_webhook_criar', {
    p_url: url.trim(),
    p_eventos: eventos,
    p_descricao: descricao.trim() || undefined,
  });
  if (error) throw new Error(error.message);
  return conferir<Recusavel & { id: string; segredo: string }>(data);
}

export async function ativarWebhook(id: string, ativo: boolean) {
  const { data, error } = await createClient().rpc('api_webhook_ativar', {
    p_id: id,
    p_ativo: ativo,
  });
  if (error) throw new Error(error.message);
  return conferir(data);
}

export async function excluirWebhook(id: string) {
  const { data, error } = await createClient().rpc('api_webhook_excluir', { p_id: id });
  if (error) throw new Error(error.message);
  return conferir(data);
}

export async function testarWebhook(id: string) {
  const { data, error } = await createClient().rpc('api_webhook_testar', { p_id: id });
  if (error) throw new Error(error.message);
  return conferir(data);
}

export async function carregarEntregas(id: string): Promise<Entrega[]> {
  const { data, error } = await createClient().rpc('api_webhook_entregas', {
    p_id: id,
    p_limite: 20,
  });
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as Entrega[];
}
