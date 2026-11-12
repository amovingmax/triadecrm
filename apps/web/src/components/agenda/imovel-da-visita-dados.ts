'use client';

import { useQuery } from '@tanstack/react-query';

import { createClient } from '@/lib/supabase/client';
import { EMPRESA } from '@/lib/empresa';
import { SITUACOES, type Situacao } from '@/components/anuncios/tipos';

import { resultadoDeVisita, type ResultadoDeVisita } from './acoes-reuniao';
import {
  enderecoDoAnuncio,
  type AnuncioDaEscolha,
  type ImovelDaVisita,
  type OrigemDoImovel,
} from './imovel-da-visita';

/**
 * O que a tela pede ao banco sobre o imóvel da visita (11/11/2026, só na Imova,
 * módulo `agendaComImovel`; migração 20261112160000, do agente do convite).
 *
 * Toda escrita é função do Postgres, que confere quem pode e devolve `{ ok, motivo }`:
 * `visita_marcar_com_imovel` (a visita nova, que chama a `visita_marcar` de sempre e
 * grava o imóvel) e `visita_definir_imovel` (a visita que ficou sem). A leitura é
 * `visita_imoveis`, sob a RLS de quem lê (quem vê a tarefa vê o imóvel dela).
 */

/** O módulo existe nesta empresa? Fora dele (a KOMUNE), nada daqui vai ao servidor. */
export const IMOVEL_NA_VISITA: boolean = EMPRESA.modulos.agendaComImovel;

export const CHAVE_ANUNCIOS_DA_ESCOLHA = ['agenda', 'anuncios-da-escolha'] as const;

/** Mais do que a Imova tem: a lista inteira vem de uma vez e a busca é na tela. */
const TETO_DA_LISTA = 500;

function situacaoDe(valor: unknown): Situacao | null {
  return typeof valor === 'string' && valor in SITUACOES ? (valor as Situacao) : null;
}

/** Os anúncios que não foram excluídos, com o endereço montado como no banco. */
export async function carregarAnunciosDaEscolha(): Promise<AnuncioDaEscolha[]> {
  const { data, error } = await createClient()
    .from('anuncios')
    .select('id, codigo, titulo, situacao, endereco, numero, complemento, bairro, cidade')
    .is('excluido_em', null)
    .order('codigo')
    .limit(TETO_DA_LISTA);
  if (error) throw new Error(error.message);
  return (data ?? []).flatMap((a) => {
    const situacao = situacaoDe(a.situacao);
    return a.id && a.codigo && situacao
      ? [
          {
            id: a.id,
            codigo: a.codigo,
            titulo: a.titulo?.trim() || 'Anúncio sem título',
            situacao,
            endereco: enderecoDoAnuncio(a),
          },
        ]
      : [];
  });
}

/** A lista da escolha, compartilhada pelas folhas abertas (cinco minutos de validade). */
export function useAnunciosDaEscolha(ligada = true) {
  return useQuery({
    queryKey: CHAVE_ANUNCIOS_DA_ESCOLHA,
    queryFn: carregarAnunciosDaEscolha,
    enabled: IMOVEL_NA_VISITA && ligada,
    staleTime: 5 * 60_000,
  });
}

const ORIGENS: readonly OrigemDoImovel[] = ['crm', 'calendly', 'convite', 'ia', 'corrigido'];

type LinhaDoImovel = {
  task_id: string;
  anuncio_id: string | null;
  codigo: string | null;
  endereco: string;
  origem: string;
  anuncios: { titulo: string | null; situacao: string | null } | null;
};

/**
 * O imóvel das visitas da tela, por tarefa. Nulo quando não há módulo ou a leitura
 * falhou: aí a tela NÃO diz "Falta o imóvel" de ninguém, porque não sabe — o cartão
 * fica como antes, com o endereço que tiver.
 */
export async function buscarImoveisDasVisitas(
  supabase: ReturnType<typeof createClient>,
  taskIds: readonly string[],
): Promise<Map<string, ImovelDaVisita> | null> {
  if (!IMOVEL_NA_VISITA) return null;
  if (taskIds.length === 0) return new Map();
  const { data, error } = await supabase
    .from('visita_imoveis')
    .select('task_id, anuncio_id, codigo, endereco, origem, anuncios(titulo, situacao)')
    .in('task_id', [...taskIds]);
  if (error || !data) return null;
  return new Map(
    (data as unknown as LinhaDoImovel[]).map((l) => [
      l.task_id,
      {
        anuncioId: l.anuncio_id,
        codigo: l.codigo,
        endereco: l.endereco,
        titulo: l.anuncios?.titulo ?? null,
        situacao: situacaoDe(l.anuncios?.situacao),
        origem: (ORIGENS as readonly string[]).includes(l.origem)
          ? (l.origem as OrigemDoImovel)
          : 'crm',
      },
    ]),
  );
}

/**
 * Marca a visita com o imóvel: `public.visita_marcar_com_imovel`. Um dos dois vai:
 * o anúncio, ou o endereço do imóvel sem anúncio. A recusa é a mesma da
 * `visita_marcar` (horário ocupado, com os conflitos; dia não útil…), mais
 * `visita_sem_imovel` e `anuncio_invalido`.
 */
export async function marcarVisitaComImovel(p: {
  organizationId: string;
  dealId: string | null;
  inicio: string;
  donoId: string | null;
  anuncioId: string | null;
  endereco: string | null;
}): Promise<ResultadoDeVisita> {
  const { data, error } = await createClient().rpc('visita_marcar_com_imovel', {
    p_organization_id: p.organizationId,
    p_inicio: p.inicio,
    p_deal_id: p.dealId ?? undefined,
    p_dono: p.donoId ?? undefined,
    p_anuncio_id: p.anuncioId ?? undefined,
    p_endereco: p.endereco ?? undefined,
  });
  return resultadoDeVisita(data, error);
}

export type ResultadoDoImovel =
  { ok: true; codigo: string | null; endereco: string | null } | { ok: false; motivo: string };

/** Grava ou corrige o imóvel de uma visita: `public.visita_definir_imovel`. */
export async function definirImovelDaVisita(p: {
  taskId: string;
  anuncioId: string | null;
  endereco: string | null;
}): Promise<ResultadoDoImovel> {
  const { data, error } = await createClient().rpc('visita_definir_imovel', {
    p_task_id: p.taskId,
    p_anuncio_id: p.anuncioId ?? undefined,
    p_endereco: p.endereco ?? undefined,
  });
  if (error)
    return { ok: false, motivo: error.code === '42501' ? 'sem_permissao' : 'erro_do_servidor' };
  const r = (data ?? {}) as { ok?: boolean; motivo?: string; codigo?: string; endereco?: string };
  return r.ok === true
    ? { ok: true, codigo: r.codigo ?? null, endereco: r.endereco ?? null }
    : { ok: false, motivo: r.motivo ?? 'erro_do_servidor' };
}
