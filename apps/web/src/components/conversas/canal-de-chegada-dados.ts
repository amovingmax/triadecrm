import { useQuery } from '@tanstack/react-query';
import type { CanalDeChegada, SubcanalDeChegada } from '@komune/schema';

import { EMPRESA } from '@/lib/empresa';
import { createClient } from '@/lib/supabase/client';

import {
  COLUNAS_DA_CHEGADA,
  erroDoMarcar,
  montarCanais,
  type ChegadaCrua,
  type ChegadaDaConversa,
} from './canal-de-chegada-regra';
import { TETO_ORGANIZACOES } from './dados';

/**
 * O canal de chegada do lead, na tela (06/11/2026; migração `…_o_canal_de_chegada`).
 *
 * SÓ DA IMOVA. Onde o módulo não existe (`EMPRESA.modulos.canalDeChegada`), a
 * tela nem pergunta ao banco — na KOMUNE a view nem existe — e nada aparece. Na
 * Imova quem decide é o banco (`app.chegadas_rodar`, a cada minuto, e a IA
 * depois); a tela só lê e manda a correção de quem atende, que vence sempre.
 *
 * Nada daqui manda mensagem: `chegada_marcar` só grava o canal e o histórico.
 */

/** O módulo existe nesta empresa? Fora dele, a tela não faz consulta nenhuma. */
export const CANAL_NA_EMPRESA: boolean = EMPRESA.modulos.canalDeChegada;

export type BaseDosCanais = {
  ligada: boolean;
  /** A chegada mais recente de cada conversa. */
  porConversa: ReadonlyMap<string, ChegadaDaConversa>;
};

export const CANAIS_DESLIGADOS: BaseDosCanais = { ligada: false, porConversa: new Map() };

/** Debaixo de `['conversas']`: mudar a etapa ou concluir relê junto, como a atitude. */
export const CHAVE_CANAIS = ['conversas', 'canais'] as const;

export async function carregarCanais(): Promise<BaseDosCanais> {
  const { data, error } = await createClient()
    .from('canal_por_conversa')
    .select(COLUNAS_DA_CHEGADA)
    .order('inicio_em', { ascending: false })
    .limit(TETO_ORGANIZACOES * 2);
  if (error) throw new Error(error.message);
  return { ligada: true, porConversa: montarCanais((data ?? []) as ChegadaCrua[]) };
}

/**
 * A leitura de todos os canais, compartilhada pela lista, pelo filtro e pela
 * conversa aberta: uma consulta só. Volta a ler a cada minuto, que é o ritmo do
 * banco; enquanto não volta (ou se falhar), a tela fica como se o módulo
 * estivesse desligado, sem chip nenhum.
 */
export function useCanais(): BaseDosCanais {
  const consulta = useQuery({
    queryKey: CHAVE_CANAIS,
    queryFn: carregarCanais,
    enabled: CANAL_NA_EMPRESA,
    staleTime: 30_000,
    refetchInterval: (q) => (q.state.data?.ligada ? 60_000 : false),
  });
  return consulta.data ?? CANAIS_DESLIGADOS;
}

/**
 * A correção de quem atende. `canal = null` devolve para a automática; subcanal
 * nulo deixa o banco escolher (o automático, se for do mesmo canal).
 */
export async function marcarCanal(
  chegadaId: string,
  canal: CanalDeChegada | null,
  subcanal: SubcanalDeChegada | null = null,
): Promise<void> {
  const { data, error } = await createClient().rpc('chegada_marcar', {
    p_chegada_id: chegadaId,
    p_canal: canal,
    p_subcanal: canal === null ? null : subcanal,
  });
  if (error) throw new Error(error.message);
  const problema = erroDoMarcar(data);
  if (problema) throw new Error(problema);
}
