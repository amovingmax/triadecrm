/**
 * O banco visto pelo worker de mercado: fachada fina sobre as funções do
 * Postgres (ADR-03). Quem decide o que pode ser coletado é `mercado_fontes`
 * (`pode_coletar`); quem decide o que entra é `mercado_anuncios_registrar` e o
 * contrato V0 (gatilho); quem decide o que é verdade é `app.mercado_verificar`.
 * Nenhuma dessas regras mora aqui.
 *
 * Conexão por HTTPS com a `service_role` (ADR-04): nada deste módulo pode ser
 * chamado do navegador.
 */
import { createClient } from '@supabase/supabase-js';

import { ErroDaEsteira, type ClienteDoBanco } from '../fila/esteira';
import { indicesSemRepetir } from './lote';
import type { RegiaoDoBanco } from './regioes';
import type {
  FonteDaLista,
  Gravador,
  ItemAnuncio,
  LinhaIndice,
  LinhaObra,
  LinhaProximidade,
  PontoParaMedir,
  ResumoDaGravacao,
} from './tipos';

export type { ClienteDoBanco };
export { indicesSemRepetir };

/**
 * As filas. A morta é a dlq que `ingest_queues` dá à `mercado_coleta`:
 * `app.esteira_falhar` manda para a dlq da própria fila desde a migração
 * 20260905000200 (o pgTAP 194 prova com 3 falhas seguidas).
 */
export const FILAS_DE_MERCADO = { coleta: 'mercado_coleta', mortas: 'mercado_dlq' } as const;

export function criarClienteDeMercado(url: string, chaveServico: string): ClienteDoBanco {
  return createClient(url, chaveServico, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { 'x-worker': 'mercado' } },
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

const objeto = (v: unknown): Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {};

// ---------------------------------------------------------------------------
// A lista, as regiões e a régua
// ---------------------------------------------------------------------------

const COLUNAS_DA_FONTE =
  'id, nome, grupo, url, veredito, intervalo_min_seg, max_por_rodada, licenca, frequencia, coletor, liberada, reconferir, pode_coletar';

export async function lerFonte(cliente: ClienteDoBanco, id: string): Promise<FonteDaLista | null> {
  const { data, error } = await cliente
    .from('mercado_fontes')
    .select(COLUNAS_DA_FONTE)
    .eq('id', id)
    .maybeSingle();
  if (error) throw new ErroDaEsteira('mercado_fontes', error.message);
  return (data as FonteDaLista | null) ?? null;
}

export async function lerRegioes(cliente: ClienteDoBanco): Promise<RegiaoDoBanco[]> {
  const { data, error } = await cliente
    .from('mercado_regioes')
    .select('id, cidade, chaves, abrangencia, ativa, lat, lng');
  if (error) throw new ErroDaEsteira('mercado_regioes', error.message);
  return (data as RegiaoDoBanco[] | null) ?? [];
}

/** Os rótulos de domínio que a régua ativa bloqueia (`fontes_bloqueadas`). */
export async function lerRotulosBloqueados(cliente: ClienteDoBanco): Promise<string[]> {
  const { data, error } = await cliente
    .from('mercado_regras')
    .select('regras')
    .eq('ativa', true)
    .maybeSingle();
  if (error) throw new ErroDaEsteira('mercado_regras', error.message);
  const lista = objeto(objeto(data).regras).fontes_bloqueadas;
  return Array.isArray(lista) ? lista.map(String) : [];
}

/** O estado (cursor, rodízio) que a última coleta automática desta fonte deixou. */
export async function lerEstadoAnterior(
  cliente: ClienteDoBanco,
  fonte: string,
): Promise<Record<string, unknown>> {
  const { data, error } = await cliente
    .from('mercado_coletas')
    .select('detalhes')
    .eq('fonte', fonte)
    .eq('origem', 'auto')
    .neq('situacao', 'rodando')
    .order('inicio', { ascending: false })
    .limit(5);
  if (error) throw new ErroDaEsteira('mercado_coletas', error.message);
  for (const linha of (data as Array<{ detalhes?: unknown }> | null) ?? []) {
    const estado = objeto(objeto(linha.detalhes).estado);
    if (Object.keys(estado).length > 0) return estado;
  }
  return {};
}

/** Anúncios no ar com ponto exato ou de esquina (os únicos que viram distância). */
export async function lerPontosParaMedir(cliente: ClienteDoBanco): Promise<PontoParaMedir[]> {
  const { data, error } = await cliente
    .from('mercado_anuncios')
    .select('id, regiao_id, lat, lng, loc_precisao')
    .in('loc_precisao', ['exata', 'esquina'])
    .is('saiu_do_ar_em', null)
    .eq('estado', 'ok')
    .not('lat', 'is', null)
    .not('lng', 'is', null)
    .limit(5000);
  if (error) throw new ErroDaEsteira('mercado_anuncios', error.message);
  return (
    (data as Array<{
      id: string;
      regiao_id: string | null;
      lat: number | string;
      lng: number | string;
      loc_precisao: 'exata' | 'esquina';
    }> | null) ?? []
  ).map((a) => ({
    mercado_anuncio_id: a.id,
    regiao_id: a.regiao_id,
    lat: Number(a.lat),
    lng: Number(a.lng),
    precisao: a.loc_precisao,
  }));
}

// ---------------------------------------------------------------------------
// A coleta
// ---------------------------------------------------------------------------

export type RespostaDaAbertura =
  | {
      ok: true;
      coleta_id: number;
      fonte: string;
      intervalo_min_seg: number | null;
      max_por_rodada: number | null;
    }
  | { ok: false; motivo: string };

/** Abre a coleta automática: as travas de `mercado_coleta_abrir` e mais "uma por fonte de cada vez" (`ja_rodando`). */
export function abrirColeta(
  cliente: ClienteDoBanco,
  fonte: string,
  versao: string,
  detalhes: Record<string, unknown>,
): Promise<RespostaDaAbertura> {
  return rpc<RespostaDaAbertura>(cliente, 'mercado_coleta_abrir_worker', {
    p_fonte: fonte,
    p_coletor_versao: versao,
    p_detalhes: detalhes,
  });
}

/** O que o worker confere antes de rodar (`public.mercado_worker_estado`). */
export interface EstadoDoMercado {
  empresa: string | null;
  ligado: boolean;
  fila: boolean;
  /** A fonte pedida já tem coleta automática rodando (null quando nenhuma fonte foi dada). */
  rodando: boolean | null;
}

/**
 * Lê o estado. Devolve null quando o banco não tem a função: é o banco da
 * KOMUNE (a migração não cria nada lá) ou a migração 20261119169000 ainda não
 * foi aplicada. Outro erro sobe.
 */
export async function lerEstadoDoMercado(
  cliente: ClienteDoBanco,
  fonte: string | null = null,
): Promise<EstadoDoMercado | null> {
  const { data, error } = await cliente.rpc('mercado_worker_estado', { p_fonte: fonte });
  if (error) {
    // PGRST202: a API não acha a função (não existe neste banco).
    if (error.code === 'PGRST202' || /could not find the function/i.test(error.message))
      return null;
    throw new ErroDaEsteira('mercado_worker_estado', error.message);
  }
  const x = objeto(data);
  return {
    empresa: typeof x.empresa === 'string' ? x.empresa : null,
    ligado: x.ligado === true,
    fila: x.fila === true,
    rodando: typeof x.rodando === 'boolean' ? x.rodando : null,
  };
}

/** Por que o worker de mercado não serve para este banco (ou null se serve). */
export function motivoDoBancoErrado(estado: EstadoDoMercado | null): string | null {
  if (!estado)
    return 'este banco não tem a inteligência de mercado (é o da KOMUNE, ou a migração 20261119169000 não foi aplicada)';
  if (estado.empresa !== 'imova')
    return `a inteligência de mercado é só da Imova; este banco é da ${estado.empresa ?? 'empresa desconhecida'}`;
  if (!estado.fila) return 'a fila mercado_coleta não existe neste banco';
  return null;
}

export function fecharColeta(
  cliente: ClienteDoBanco,
  argumentos: {
    coletaId: number;
    consultasCompletas: readonly string[];
    erro: string | null;
    detalhes: Record<string, unknown>;
    hashBruto: string | null;
  },
): Promise<Record<string, unknown>> {
  return rpc<Record<string, unknown>>(cliente, 'mercado_coleta_fechar_por_consulta', {
    p_id: argumentos.coletaId,
    p_consultas: argumentos.consultasCompletas,
    p_erro: argumentos.erro,
    p_detalhes: argumentos.detalhes,
    p_hash_bruto: argumentos.hashBruto,
  });
}

export function posRodada(cliente: ClienteDoBanco): Promise<Record<string, unknown>> {
  return rpc<Record<string, unknown>>(cliente, 'mercado_pos_rodada', {});
}

// ---------------------------------------------------------------------------
// O gravador de verdade
// ---------------------------------------------------------------------------

const comChaves = <T extends object>(
  linha: T,
  chaves: readonly string[],
): Record<string, unknown> => {
  const out: Record<string, unknown> = {};
  for (const k of chaves) out[k] = (linha as Record<string, unknown>)[k] ?? null;
  return out;
};

const CHAVES_DO_INDICE = [
  'serie',
  'mes',
  'valor',
  'nome',
  'unidade',
  'local',
  'regiao_id',
  'sub',
  'modo',
  'amostra',
  'metodo',
  'url',
  'obs',
] as const;
const CHAVES_DA_OBRA = [
  'id_externo',
  'url',
  'documento',
  'tipo',
  'fase',
  'orgao',
  'objeto',
  'local_texto',
  'bairro',
  'cidade',
  'regiao_id',
  'lat',
  'lng',
  'precisao_ponto',
  'unidades',
  'valor',
  'publicado_em',
] as const;

/** Grava pelo banco: anúncios por função, índices e obras por upsert (o gatilho V0 confere), proximidades por função. */
export function gravadorDoBanco(
  cliente: ClienteDoBanco,
  coletaId: number,
  fonte: string,
): Gravador {
  return {
    async anuncios(itens: readonly ItemAnuncio[]): Promise<ResumoDaGravacao> {
      if (itens.length === 0)
        return { novos: 0, atualizados: 0, ignorados: 0, recusados: 0, erros: [] };
      const r = objeto(
        await rpc<unknown>(cliente, 'mercado_anuncios_registrar', {
          p_coleta: coletaId,
          p_anuncios: itens,
        }),
      );
      if (r.ok === false)
        throw new ErroDaEsteira('mercado_anuncios_registrar', String(r.motivo ?? 'recusado'));
      return {
        novos: Number(r.novos ?? 0),
        atualizados: Number(r.atualizados ?? 0),
        ignorados: Number(r.ignorados ?? 0),
        recusados: Number(r.recusados ?? 0),
        erros: Array.isArray(r.erros)
          ? (r.erros as Array<{ id_externo?: string; erro: string }>)
          : [],
      };
    },
    async vistos(ids: readonly string[]): Promise<number> {
      let n = 0;
      for (let i = 0; i < ids.length; i += 5000) {
        n += Number(
          await rpc<number>(cliente, 'mercado_anuncios_vistos', {
            p_coleta: coletaId,
            p_ids: ids.slice(i, i + 5000),
          }),
        );
      }
      return n;
    },
    async indices(linhas: readonly LinhaIndice[]): Promise<number> {
      if (linhas.length === 0) return 0;
      const agora = new Date().toISOString();
      const corpo = indicesSemRepetir(linhas).linhas.map((l) => ({
        ...comChaves(l, CHAVES_DO_INDICE),
        aproximado: l.aproximado ?? false,
        fonte,
        coleta_id: coletaId,
        coletado_em: agora,
      }));
      for (let i = 0; i < corpo.length; i += 500) {
        const { error } = await cliente
          .from('mercado_indices')
          .upsert(corpo.slice(i, i + 500), { onConflict: 'serie,mes' });
        if (error) throw new ErroDaEsteira('mercado_indices', error.message);
      }
      return corpo.length;
    },
    async obras(linhas: readonly LinhaObra[]): Promise<number> {
      if (linhas.length === 0) return 0;
      const agora = new Date().toISOString();
      // A mesma chave duas vezes no mesmo lote faria o "on conflict" falhar: fica a última.
      const unicas = [...new Map(linhas.map((l) => [l.id_externo, l])).values()];
      const corpo = unicas.map((l) => ({
        ...comChaves(l, CHAVES_DA_OBRA),
        fonte,
        coleta_id: coletaId,
        coletado_em: agora,
      }));
      for (let i = 0; i < corpo.length; i += 500) {
        const { error } = await cliente
          .from('mercado_obras')
          .upsert(corpo.slice(i, i + 500), { onConflict: 'fonte,id_externo' });
        if (error) throw new ErroDaEsteira('mercado_obras', error.message);
      }
      return corpo.length;
    },
    async proximidades(linhas: readonly LinhaProximidade[]): Promise<number> {
      let n = 0;
      for (let i = 0; i < linhas.length; i += 500) {
        n += Number(
          await rpc<number>(cliente, 'mercado_proximidades_gravar', {
            p_coleta: coletaId,
            p_itens: linhas.slice(i, i + 500),
          }),
        );
      }
      return n;
    },
  };
}

/** O gravador do ensaio: não escreve nada, só conta (e guarda os primeiros para mostrar). */
export function gravadorDeEnsaio(): Gravador & {
  amostra: Record<string, unknown[]>;
  contagem: Record<string, number>;
} {
  const amostra: Record<string, unknown[]> = {
    anuncios: [],
    indices: [],
    obras: [],
    proximidades: [],
  };
  const contagem: Record<string, number> = {
    anuncios: 0,
    vistos: 0,
    indices: 0,
    obras: 0,
    proximidades: 0,
  };
  const guardar = (tipo: string, linhas: readonly unknown[]): number => {
    contagem[tipo] = (contagem[tipo] ?? 0) + linhas.length;
    const lista = amostra[tipo] ?? [];
    for (const l of linhas) if (lista.length < 3) lista.push(l);
    amostra[tipo] = lista;
    return linhas.length;
  };
  return {
    amostra,
    contagem,
    async anuncios(itens) {
      return {
        novos: guardar('anuncios', itens),
        atualizados: 0,
        ignorados: 0,
        recusados: 0,
        erros: [],
      };
    },
    async vistos(ids) {
      return guardar('vistos', ids);
    },
    async indices(linhas) {
      return guardar('indices', linhas);
    },
    async obras(linhas) {
      return guardar('obras', linhas);
    },
    async proximidades(linhas) {
      return guardar('proximidades', linhas);
    },
  };
}

// ---------------------------------------------------------------------------
// A fila (pgmq pela esteira de sempre)
// ---------------------------------------------------------------------------

export interface PedidoDeColeta {
  msgId: number;
  chave: string;
  entregas: number;
  fonte: string;
  coletor: string | null;
}

/** "Hoje" em Fortaleza de um instante (a chave da fila leva o dia de Fortaleza). */
export function diaEmFortaleza(instante: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Fortaleza',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(instante);
}

/**
 * A chave de idempotência da mensagem. `app.mercado_coleta_enfileirar` usa
 * "mercado:<fonte>:<dia em Fortaleza>" e não a põe no corpo; o dia é o da
 * entrada na fila (mesma transação do `now()` de lá).
 */
export function chaveDoPedido(mensagem: Record<string, unknown>, enfileiradaEm: string): string {
  if (typeof mensagem.chave === 'string' && mensagem.chave) return mensagem.chave;
  return `mercado:${String(mensagem.fonte)}:${diaEmFortaleza(new Date(enfileiradaEm))}`;
}

export async function proximosPedidos(
  cliente: ClienteDoBanco,
  quantidade = 1,
): Promise<PedidoDeColeta[]> {
  const linhas = await rpc<unknown>(cliente, 'esteira_fila_ler', {
    p_queue: FILAS_DE_MERCADO.coleta,
    p_qty: quantidade,
  });
  if (!Array.isArray(linhas)) return [];
  return linhas.map((l) => {
    const x = objeto(l);
    const m = objeto(x.mensagem);
    return {
      msgId: Number(x.msg_id),
      chave: chaveDoPedido(m, String(x.enfileirada_em ?? new Date().toISOString())),
      entregas: Number(x.entregas ?? 0),
      fonte: String(m.fonte ?? ''),
      coletor: typeof m.coletor === 'string' ? m.coletor : null,
    };
  });
}

export async function concluirPedido(cliente: ClienteDoBanco, p: PedidoDeColeta): Promise<void> {
  await rpc<boolean>(cliente, 'esteira_fila_concluir', {
    p_queue: FILAS_DE_MERCADO.coleta,
    p_msg_id: p.msgId,
    p_key: p.chave,
  });
}

export function falharPedido(
  cliente: ClienteDoBanco,
  p: PedidoDeColeta,
  erro: string,
): Promise<{ acao: string; tentativa: number }> {
  return rpc<{ acao: string; tentativa: number }>(cliente, 'esteira_fila_falhar', {
    p_queue: FILAS_DE_MERCADO.coleta,
    p_msg_id: p.msgId,
    p_key: p.chave,
    p_erro: erro.slice(0, 2000),
  });
}
