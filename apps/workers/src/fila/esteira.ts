/**
 * A esteira vista do worker: uma fachada fina sobre as RPCs do Postgres.
 *
 * Morava em `ingest/esteira.ts` até 25/09/2026. Nunca foi do coletor: `ia/`,
 * `rotas/` e `lib/pulso.ts` sempre leram daqui — é o cliente das filas `pgmq`
 * (`public.esteira_fila_*`) e a batida de ponto de TODO worker. Quando o
 * coletor saiu, o nome da pasta passou a mentir sobre quem depende dele.
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

export type ClienteDoBanco = SupabaseClient;

export function criarCliente(url: string, chaveServico: string): ClienteDoBanco {
  return createClient(url, chaveServico, {
    auth: { persistSession: false, autoRefreshToken: false },
    // O cabeçalho só diz "veio de um worker": desde 25/09/2026 quem chama é
    // `wa`, `ai` ou `rotas`, e não existe mais um worker chamado `ingest`.
    global: { headers: { 'x-worker': 'komune-crm' } },
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

/** `jsonb` que volta do banco é `unknown` aqui: só objeto de verdade vira objeto. */
function objeto(valor: unknown): Record<string, unknown> {
  return typeof valor === 'object' && valor !== null && !Array.isArray(valor)
    ? (valor as Record<string, unknown>)
    : {};
}

// ---------------------------------------------------------------------------
// Filas
// ---------------------------------------------------------------------------

// Os nomes são os das filas `pgmq` no banco, e não mudam: nome de banco é
// ledger. `ingest_*` continua sendo como a esteira se chama lá dentro, mesmo
// depois de o worker `ingest` ter saído.
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
