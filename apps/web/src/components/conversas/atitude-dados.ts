import { useQuery } from '@tanstack/react-query';

import { EMPRESA } from '@/lib/empresa';
import { createClient } from '@/lib/supabase/client';

import {
  montarAtitudes,
  type AtitudeDaConversa,
  type EtiquetaDoToque,
  type Objecao,
} from './atitude-regra';
import { TETO_ORGANIZACOES } from './dados';

/**
 * A atitude do cliente, na tela (29/10/2026; migração 20261029110000).
 *
 * SÓ DA IMOVA ("a KOMUNE já tem as dela"). Onde o módulo não existe
 * (`EMPRESA.modulos.atitudeDoCliente`), a tela nem pergunta ao banco, e nada
 * aparece. Na Imova, quem calcula é o banco (`app.atitude_calcular`,
 * recalculada pelo pg_cron a cada minuto); a tela só lê e manda o toque de
 * quem atende. O banco trava do lado dele também: fora da Imova a regra não
 * liga.
 */

/** O módulo existe nesta empresa? Fora dele, a tela não faz consulta nenhuma. */
export const ATITUDE_NA_EMPRESA: boolean = EMPRESA.modulos.atitudeDoCliente;

export type BaseDasAtitudes = {
  ligada: boolean;
  objecoes: Objecao[];
  porConversa: ReadonlyMap<string, AtitudeDaConversa>;
};

export const ATITUDES_DESLIGADAS: BaseDasAtitudes = {
  ligada: false,
  objecoes: [],
  porConversa: new Map(),
};

export const CHAVE_ATITUDES = ['conversas', 'atitudes'] as const;

export function chaveDoHistoricoDaAtitude(conversaId: string) {
  return ['conversas', 'atitudes', 'historico', conversaId] as const;
}

export async function carregarAtitudes(): Promise<BaseDasAtitudes> {
  const supabase = createClient();
  const config = await supabase.from('app_settings').select('value').eq('key', 'atitude').maybeSingle();
  const valor = config.data?.value;
  const ligada =
    valor !== null &&
    typeof valor === 'object' &&
    !Array.isArray(valor) &&
    (valor as Record<string, unknown>)['ligada'] === true;
  if (!ligada) return ATITUDES_DESLIGADAS;

  const [atitudes, abertas, objecoes] = await Promise.all([
    supabase
      .from('atitudes')
      .select('conversation_id, etiqueta, antes_de_esfriar, motivo, desde, marcada')
      .not('etiqueta', 'is', null)
      .limit(TETO_ORGANIZACOES * 2),
    supabase
      .from('conversa_objecoes')
      .select('conversation_id, objecao_id')
      .is('resolvida_em', null)
      .limit(TETO_ORGANIZACOES * 2),
    supabase.from('objecoes').select('id, nome').eq('ativa', true).order('posicao'),
  ]);
  const erro = atitudes.error ?? abertas.error ?? objecoes.error;
  if (erro) throw new Error(erro.message);

  return {
    ligada: true,
    objecoes: objecoes.data ?? [],
    porConversa: montarAtitudes(atitudes.data ?? [], abertas.data ?? []),
  };
}

/**
 * A leitura de todas as atitudes, compartilhada pela lista e pela conversa.
 * Volta a ler a cada minuto: é o ritmo do recálculo no banco.
 */
export function useAtitudes(): BaseDasAtitudes {
  const consulta = useQuery({
    queryKey: CHAVE_ATITUDES,
    queryFn: carregarAtitudes,
    enabled: ATITUDE_NA_EMPRESA,
    staleTime: 30_000,
    refetchInterval: (q) => (q.state.data?.ligada ? 60_000 : false),
  });
  return consulta.data ?? ATITUDES_DESLIGADAS;
}

export type MudancaDaAtitude = {
  id: number;
  tipo: 'etiqueta' | 'objecao';
  para: string | null;
  motivo: string;
  por: string | null;
  em: string;
};

export async function carregarHistoricoDaAtitude(conversaId: string): Promise<MudancaDaAtitude[]> {
  const { data, error } = await createClient()
    .from('atitude_historico')
    .select('id, tipo, para, motivo, por, em')
    .eq('conversation_id', conversaId)
    .order('em', { ascending: false })
    .limit(8);
  if (error) throw new Error(error.message);
  return (data ?? []) as MudancaDaAtitude[];
}

type Resposta = { ok: boolean; motivo?: string };

function falhou(resposta: Resposta | null): string | null {
  if (resposta?.ok) return null;
  switch (resposta?.motivo) {
    case 'sem_permissao':
      return 'O seu acesso não deixa mudar esta conversa.';
    case 'desligada':
      return 'As etiquetas de atitude estão desligadas.';
    default:
      return 'Não deu para gravar.';
  }
}

/** O toque de quem atende. `null` devolve a etiqueta para a regra. */
export async function marcarAtitude(conversaId: string, etiqueta: EtiquetaDoToque | null) {
  const { data, error } = await createClient().rpc('atitude_marcar', {
    p_conversation_id: conversaId,
    p_etiqueta: etiqueta,
  });
  if (error) throw new Error(error.message);
  const problema = falhou(data as Resposta | null);
  if (problema) throw new Error(problema);
}

export async function marcarObjecao(conversaId: string, objecaoId: number, aberta: boolean) {
  const { data, error } = await createClient().rpc('objecao_marcar', {
    p_conversation_id: conversaId,
    p_objecao_id: objecaoId,
    p_aberta: aberta,
  });
  if (error) throw new Error(error.message);
  const problema = falhou(data as Resposta | null);
  if (problema) throw new Error(problema);
}
