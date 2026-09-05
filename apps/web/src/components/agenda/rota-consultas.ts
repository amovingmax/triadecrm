'use client';

import { createClient } from '@/lib/supabase/client';

import { ErroDaAgenda } from './consultas';
import type { RotaDoDia } from './rota-tipos';

/**
 * De onde a rota vem: duas RPC, e nenhuma consulta solta.
 *
 * `public.rota_do_dia` devolve o plano, as paradas na ordem do OSRM, os alvos do
 * dia com o motivo de quem ficou de fora, e o pulso do worker — tudo num objeto,
 * porque a tela precisa das quatro coisas ao mesmo tempo para ser honesta. Fazer
 * isso com `select` da tabela obrigaria a repetir no cliente a regra de quem
 * entra na rota, e regra repetida é regra que diverge (ADR-03).
 *
 * `public.rota_montar` é o pedido. Ela não calcula nada: enfileira, e quem
 * calcula é o worker com o OSRM na máquina dedicada (ADR-04). Por isso a tela
 * fica olhando (`refetchInterval`) enquanto o plano está `enfileirada`.
 */

function erroDe(codigo: string | null | undefined, causa: unknown): ErroDaAgenda {
  switch (codigo) {
    case '42501':
      return new ErroDaAgenda('Seu perfil não pode ver esta rota.', false, causa);
    case 'PGRST301':
    case '401':
      return new ErroDaAgenda('Sua sessão expirou. Entre de novo para ver a rota.', false, causa);
    default:
      return new ErroDaAgenda('Não deu para falar com o servidor.', true, causa);
  }
}

export function chaveDaRota(usuarioId: string, dia: string) {
  return ['rota', usuarioId, dia] as const;
}

export async function buscarRotaDoDia(dia: string): Promise<RotaDoDia> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc('rota_do_dia', { p_dia: dia });
  if (error) throw erroDe(error.code, error);
  return data as unknown as RotaDoDia;
}

export type PedidoDeRota =
  | { enfileirado: true; plano_id: string; tentativa: number; alvos_elegiveis: number }
  | { enfileirado: false; motivo: string; frase: string };

export async function pedirRota(dia: string): Promise<PedidoDeRota> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc('rota_montar', { p_dia: dia });
  if (error) throw erroDe(error.code, error);
  return data as unknown as PedidoDeRota;
}
