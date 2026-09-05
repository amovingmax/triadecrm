/**
 * A esteira vista do worker: uma fachada fina sobre as RPCs do Postgres.
 *
 * O cérebro é o banco (ADR-03). Dedup, higiene do dado, resolução do candidato,
 * proveniência campo a campo, backoff e dead-letter já existem lá dentro
 * (migrações 20260904001600 e 20260904001802). Este arquivo não repete nada
 * disso: ele só monta argumento, traduz o que volta e dá NOME ao erro. Nenhuma
 * regra de negócio mora aqui, e é assim que precisa continuar — regra que
 * existisse só no worker não valeria para a importação por planilha, e a esteira
 * é uma só.
 *
 * A conexão é por HTTPS com a chave `service_role` (ADR-04: recepção em nuvem,
 * processamento local). A chave ignora RLS: nada neste arquivo pode ser chamado
 * a partir do navegador.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

import type { PayloadDeCaptura } from './whitelist';

export type ClienteDoBanco = SupabaseClient;

export function criarCliente(url: string, chaveServico: string): ClienteDoBanco {
  return createClient(url, chaveServico, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { 'x-worker': 'ingest' } },
  });
}

/** Erro de conversa com o banco, já com o nome da operação — para o log dizer onde doeu. */
export class ErroDaEsteira extends Error {
  constructor(
    readonly operacao: string,
    mensagem: string,
  ) {
    super(`${operacao}: ${mensagem}`);
    this.name = 'ErroDaEsteira';
  }
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

// ---------------------------------------------------------------------------
// Fontes
// ---------------------------------------------------------------------------

export interface EntradaDoCatalogo {
  categoria_origem: string;
  caminho: string;
}

export interface Fonte {
  id: number;
  slug: string;
  name: string;
  kind: string;
  base_url: string | null;
  robots_ok: boolean | null;
  is_enabled: boolean;
  rate_limit_seconds: number;
  /** `collector` de `sources.config`, já lido com guarda de tipo. */
  coletor: {
    tipo: string | null;
    ligado: boolean;
    agente: string | null;
    catalogo: EntradaDoCatalogo[];
  };
}

interface LinhaDeFonte {
  id: number;
  slug: string;
  name: string;
  kind: string;
  base_url: string | null;
  robots_ok: boolean | null;
  is_enabled: boolean;
  rate_limit_seconds: number | string;
  config: unknown;
}

function objeto(valor: unknown): Record<string, unknown> {
  return typeof valor === 'object' && valor !== null && !Array.isArray(valor)
    ? (valor as Record<string, unknown>)
    : {};
}

function textoOuNulo(valor: unknown): string | null {
  return typeof valor === 'string' && valor.trim() !== '' ? valor.trim() : null;
}

/** `sources.config` é jsonb livre: cada fonte traz chaves diferentes, nenhuma garantida. */
export function lerCatalogo(config: unknown): EntradaDoCatalogo[] {
  const bruto = objeto(objeto(config).collector).catalogo;
  if (!Array.isArray(bruto)) return [];
  const entradas: EntradaDoCatalogo[] = [];
  for (const item of bruto) {
    const linha = objeto(item);
    const categoria = textoOuNulo(linha.categoria_origem);
    const caminho = textoOuNulo(linha.caminho);
    if (categoria && caminho) entradas.push({ categoria_origem: categoria, caminho });
  }
  return entradas;
}

export function paraFonte(linha: LinhaDeFonte): Fonte {
  const config = objeto(linha.config);
  const coletor = objeto(config.collector);
  return {
    id: linha.id,
    slug: linha.slug,
    name: linha.name,
    kind: linha.kind,
    base_url: linha.base_url,
    robots_ok: linha.robots_ok,
    is_enabled: linha.is_enabled,
    rate_limit_seconds: Number(linha.rate_limit_seconds) || 0,
    coletor: {
      tipo: textoOuNulo(coletor.kind),
      ligado: coletor.enabled === true,
      agente: textoOuNulo(coletor.agente),
      catalogo: lerCatalogo(config),
    },
  };
}

export async function buscarFontePorSlug(
  cliente: ClienteDoBanco,
  slug: string,
): Promise<Fonte | null> {
  const { data, error } = await cliente
    .from('sources')
    .select('id, slug, name, kind, base_url, robots_ok, is_enabled, rate_limit_seconds, config')
    .eq('slug', slug)
    .maybeSingle();
  if (error) throw new ErroDaEsteira('sources.select', error.message);
  return data ? paraFonte(data as LinhaDeFonte) : null;
}

export async function buscarFontePorId(cliente: ClienteDoBanco, id: number): Promise<Fonte | null> {
  const { data, error } = await cliente
    .from('sources')
    .select('id, slug, name, kind, base_url, robots_ok, is_enabled, rate_limit_seconds, config')
    .eq('id', id)
    .maybeSingle();
  if (error) throw new ErroDaEsteira('sources.select', error.message);
  return data ? paraFonte(data as LinhaDeFonte) : null;
}

// ---------------------------------------------------------------------------
// Lote
// ---------------------------------------------------------------------------

export type RespostaDeLote = { ok: true; batch_id: string } | { ok: false; reason: string };

export async function abrirLote(
  cliente: ClienteDoBanco,
  argumentos: { fonteId: number; rotulo: string; parametros: Record<string, unknown> },
): Promise<RespostaDeLote> {
  return rpc<RespostaDeLote>(cliente, 'esteira_abrir_lote', {
    p_kind: 'coleta',
    p_source_id: argumentos.fonteId,
    p_label: argumentos.rotulo,
    p_params: argumentos.parametros,
  });
}

export type EstadoDeLote = 'na_fila' | 'rodando' | 'concluido' | 'falhou';

export async function marcarLote(
  cliente: ClienteDoBanco,
  loteId: string,
  estado: EstadoDeLote,
  estatisticas?: Record<string, unknown>,
  erro?: string,
): Promise<void> {
  await rpc<unknown>(cliente, 'esteira_estado_lote', {
    p_batch_id: loteId,
    p_status: estado,
    p_stats: estatisticas ?? null,
    p_error: erro ?? null,
  });
}

// ---------------------------------------------------------------------------
// Filas
// ---------------------------------------------------------------------------

export const FILAS = {
  jobs: 'ingest_jobs',
  paginas: 'ingest_pages',
  registros: 'ingest_records',
  mortas: 'ingest_dlq',
} as const;

export type NomeDaFila = (typeof FILAS)[keyof typeof FILAS];

export interface MensagemDaFila {
  msg_id: number;
  entregas: number;
  enfileirada_em: string;
  mensagem: Record<string, unknown>;
}

export type RespostaDeEnfileiramento =
  | { enfileirado: true; msg_id: number }
  | { enfileirado: false; motivo: string };

export async function enfileirar(
  cliente: ClienteDoBanco,
  fila: NomeDaFila,
  payload: Record<string, unknown>,
  chave: string,
  loteId: string | null = null,
  atrasoSegundos = 0,
): Promise<RespostaDeEnfileiramento> {
  return rpc<RespostaDeEnfileiramento>(cliente, 'esteira_fila_enfileirar', {
    p_queue: fila,
    p_payload: payload,
    p_key: chave,
    p_batch_id: loteId,
    p_delay: atrasoSegundos,
  });
}

export async function lerFila(
  cliente: ClienteDoBanco,
  fila: NomeDaFila,
  quantidade = 1,
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

export async function concluir(
  cliente: ClienteDoBanco,
  fila: NomeDaFila,
  msgId: number,
  chave: string,
): Promise<void> {
  await rpc<boolean>(cliente, 'esteira_fila_concluir', {
    p_queue: fila,
    p_msg_id: msgId,
    p_key: chave,
  });
}

export type RespostaDeFalha = { acao: 'reagendado' | 'dead_letter'; tentativa: number };

export async function falhar(
  cliente: ClienteDoBanco,
  fila: NomeDaFila,
  msgId: number,
  chave: string,
  erro: string,
): Promise<RespostaDeFalha> {
  return rpc<RespostaDeFalha>(cliente, 'esteira_fila_falhar', {
    p_queue: fila,
    p_msg_id: msgId,
    p_key: chave,
    p_erro: erro.slice(0, 2000),
  });
}

// ---------------------------------------------------------------------------
// Captura e resolução
// ---------------------------------------------------------------------------

export type RespostaDeCaptura =
  | { ok: true; novo: boolean; raw_capture_id: string; reason?: string }
  | { ok: false; reason: string };

export async function gravarCaptura(
  cliente: ClienteDoBanco,
  argumentos: {
    loteId: string;
    fonteId: number;
    payload: PayloadDeCaptura;
    externalId: string | null;
    sourceUrl: string | null;
    httpStatus: number | null;
    coletor: string;
  },
): Promise<RespostaDeCaptura> {
  return rpc<RespostaDeCaptura>(cliente, 'esteira_gravar_captura', {
    p_batch_id: argumentos.loteId,
    p_source_id: argumentos.fonteId,
    p_payload: argumentos.payload,
    p_external_id: argumentos.externalId,
    p_source_url: argumentos.sourceUrl,
    p_http_status: argumentos.httpStatus,
    p_collector: argumentos.coletor,
  });
}

export type RespostaDeProcessamento =
  | { ok: true; mudou: boolean; source_record_id?: string; candidate_id?: string; criado?: boolean }
  | { ok: false; reason: string };

export async function processarCaptura(
  cliente: ClienteDoBanco,
  capturaId: string,
): Promise<RespostaDeProcessamento> {
  return rpc<RespostaDeProcessamento>(cliente, 'esteira_processar_captura', {
    p_raw_capture_id: capturaId,
  });
}

// ---------------------------------------------------------------------------
// Batida de ponto
// ---------------------------------------------------------------------------

export interface BatidaDePonto {
  worker: string;
  instancia: string;
  status: 'ok' | 'degradado' | 'parado';
  fila: string | null;
  host: string | null;
  versao: string | null;
  processados: number;
  falhas: number;
  detalhes: Record<string, unknown>;
}

export async function baterPonto(cliente: ClienteDoBanco, batida: BatidaDePonto): Promise<void> {
  await rpc<unknown>(cliente, 'esteira_bater_ponto', {
    p_worker: batida.worker,
    p_instance: batida.instancia,
    p_status: batida.status,
    p_queue: batida.fila,
    p_host: batida.host,
    p_version: batida.versao,
    p_processed: batida.processados,
    p_failed: batida.falhas,
    p_details: batida.detalhes,
  });
}
