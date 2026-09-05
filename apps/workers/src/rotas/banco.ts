/**
 * O banco visto pelo worker de rotas: fachada fina sobre as RPC do Postgres.
 *
 * O cérebro continua sendo o banco (ADR-03). Quem decide quem entra na rota é
 * `app.rota_alvos`, chamada de dentro de `public.rota_proximas` e de novo em
 * `public.rota_gravar_ordem` — este arquivo não tem uma linha de regra sobre
 * supressão, ficha apagada ou precisão de coordenada, e não pode ter: regra que
 * morasse aqui não valeria para quem montasse a rota por SQL.
 *
 * Conexão por HTTPS com a `service_role` (ADR-04). A chave ignora RLS: nada
 * deste módulo pode ser chamado do navegador.
 */
import { createClient } from '@supabase/supabase-js';

import { ErroDaEsteira, type ClienteDoBanco } from '../ingest/esteira';

import type { PerguntaDeGeocodificacao, RespostaDoNominatim } from './nominatim';

export type { ClienteDoBanco };

export function criarClienteDeRotas(url: string, chaveServico: string): ClienteDoBanco {
  return createClient(url, chaveServico, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { 'x-worker': 'rotas' } },
  });
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

export const FILAS_DE_ROTAS = { trabalhos: 'rotas_jobs', mortas: 'rotas_dlq' } as const;

// ---------------------------------------------------------------------------
// Geocodificação
// ---------------------------------------------------------------------------

export function perguntasPendentes(
  cliente: ClienteDoBanco,
  limite = 50,
): Promise<PerguntaDeGeocodificacao[]> {
  return rpc<PerguntaDeGeocodificacao[]>(cliente, 'geo_pendentes', { p_limite: limite });
}

export type ResultadoDaGravacaoDeGeo = {
  id: number;
  precisao: 'logradouro' | 'bairro' | 'cidade' | null;
  raio_m: number | null;
  aplicadas: number;
};

export function gravarGeocodificacao(
  cliente: ClienteDoBanco,
  pergunta: PerguntaDeGeocodificacao,
  resposta: RespostaDoNominatim,
): Promise<ResultadoDaGravacaoDeGeo> {
  return rpc<ResultadoDaGravacaoDeGeo>(cliente, 'geo_gravar', {
    p_consulta: pergunta.consulta,
    p_escopo: pergunta.escopo,
    p_city_id: pergunta.city_id,
    p_neighborhood: pergunta.neighborhood,
    p_encontrado: resposta.encontrado,
    p_lat: resposta.lat ?? null,
    p_lng: resposta.lng ?? null,
    p_addresstype: resposta.addresstype ?? null,
    p_osm_type: resposta.osm_type ?? null,
    p_osm_id: resposta.osm_id ?? null,
    p_osm_class: resposta.osm_class ?? null,
    p_display_name: resposta.display_name ?? null,
    p_bbox: resposta.bbox ?? null,
    p_licenca: resposta.licenca ?? null,
  });
}

// ---------------------------------------------------------------------------
// Rotas
// ---------------------------------------------------------------------------

export type ParadaPedida = {
  task_id: string;
  organization_id: string;
  organizacao: string;
  lat: number;
  lng: number;
  precisao: 'logradouro' | 'bairro' | 'cidade';
  raio_m: number | null;
  quando: string;
};

export type PedidoDeRota = {
  msg_id: number;
  chave: string;
  plano_id: string;
  dia: string;
  origem: { rotulo: string; lat: number; lng: number };
  paradas: ParadaPedida[];
};

export function proximosPedidos(cliente: ClienteDoBanco, quantidade = 1): Promise<PedidoDeRota[]> {
  return rpc<PedidoDeRota[]>(cliente, 'rota_proximas', { p_qty: quantidade });
}

export type ParadaGravada = {
  task_id: string;
  segundos_do_anterior: number;
  metros_do_anterior: number;
};

export type ResultadoDaGravacao = {
  plano_id: string;
  gravadas: number;
  descartadas: string[];
  total_segundos: number;
  total_metros: number;
};

export function gravarOrdem(
  cliente: ClienteDoBanco,
  planoId: string,
  paradas: readonly ParadaGravada[],
  totalSegundos: number,
  totalMetros: number,
): Promise<ResultadoDaGravacao> {
  return rpc<ResultadoDaGravacao>(cliente, 'rota_gravar_ordem', {
    p_plano_id: planoId,
    p_paradas: paradas,
    p_total_seconds: totalSegundos,
    p_total_meters: totalMetros,
  });
}

export function falharRota(
  cliente: ClienteDoBanco,
  planoId: string,
  motivo: string,
): Promise<boolean> {
  return rpc<boolean>(cliente, 'rota_falhar', { p_plano_id: planoId, p_motivo: motivo });
}

// ---------------------------------------------------------------------------
// Fila (as mesmas RPC da esteira, com o nome da fila das rotas)
// ---------------------------------------------------------------------------

export async function concluirPedido(
  cliente: ClienteDoBanco,
  msgId: number,
  chave: string,
): Promise<void> {
  await rpc<boolean>(cliente, 'esteira_fila_concluir', {
    p_queue: FILAS_DE_ROTAS.trabalhos,
    p_msg_id: msgId,
    p_key: chave,
  });
}

export type RespostaDeFalha = { acao: string; tentativa: number };

export function falharPedido(
  cliente: ClienteDoBanco,
  msgId: number,
  chave: string,
  erro: string,
): Promise<RespostaDeFalha> {
  return rpc<RespostaDeFalha>(cliente, 'esteira_fila_falhar', {
    p_queue: FILAS_DE_ROTAS.trabalhos,
    p_msg_id: msgId,
    p_key: chave,
    p_erro: erro.slice(0, 2000),
  });
}
