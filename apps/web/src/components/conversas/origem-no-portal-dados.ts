import { useQuery } from '@tanstack/react-query';

import { EMPRESA } from '@/lib/empresa';
import { createClient } from '@/lib/supabase/client';
import {
  chegouEm,
  fraseDaOrigem,
  origemDoLead,
  type LeadDoPortal,
} from '@/components/anuncios/leads/leads-rotulos';

import { TETO_ORGANIZACOES } from './dados';

/**
 * De qual anúncio dos portais veio o cliente da conversa (05/11/2026; migrações
 * 20261105100000 e 20261105130000). SÓ LEITURA.
 *
 * SÓ DA IMOVA: onde não há o módulo de anúncios (`EMPRESA.modulos.anuncios`; a
 * KOMUNE), a tela nem pergunta ao banco, e nada aparece. Na Imova é UMA
 * consulta a `portal_leads_na_lista`, compartilhada por todas as conversas
 * abertas, no molde de `atitude-dados.ts`: a lista só mostra a admin, gestor e
 * SDR, e os mais recentes bastam (o teto é o das fichas da lista de Conversas).
 *
 * SÓ QUEM MANDOU MENSAGEM (`grupo = 'mensagem'`): quem só clicou no anúncio não
 * tem conversa, e a etiqueta não pode aparecer numa conversa que não veio dele.
 * A conversa é achada primeiro pelo id (a do WhatsApp em que a pessoa escreveu
 * depois do clique, que pode ainda não ter ficha), e depois pela ficha.
 *
 * Não confundir com a `FaixaDoAnuncio` dos balões: aquela é o anúncio de clique
 * para o WhatsApp da Meta, que vem DENTRO da mensagem. Esta é o lead que o
 * Grupo OLX entregou pelo webhook. Nada aqui mexe em envio, entrada, mensagem
 * ou conversa.
 */

/** O módulo existe nesta empresa? Fora dele, a tela não faz consulta nenhuma. */
export const ORIGEM_NO_PORTAL_NA_EMPRESA: boolean = EMPRESA.modulos.anuncios;

export type OrigemNaConversa = {
  leadId: string;
  /** "Veio do anúncio SA0012_IMOVA · WhatsApp" ou "Parecido com o anúncio X · ...". */
  frase: string;
  parecido: boolean;
  /** O anúncio do CRM, para o link; null quando o código não é do CRM. */
  anuncioId: string | null;
  codigo: string | null;
  chegouEm: string;
  descartado: boolean;
};

export type OrigensNoPortal = {
  porConversa: ReadonlyMap<string, OrigemNaConversa>;
  porFicha: ReadonlyMap<string, OrigemNaConversa>;
};

export const CHAVE_ORIGENS_NO_PORTAL = ['conversas', 'origem-no-portal'] as const;

type LinhaDaConsulta = Pick<
  LeadDoPortal,
  | 'id'
  | 'organization_id'
  | 'conversation_id'
  | 'grupo'
  | 'chegou_por'
  | 'chegou_em'
  | 'client_listing_id'
  | 'anuncio_codigo'
  | 'anuncio_id'
  | 'lead_certo'
  | 'mcmv'
  | 'tipos'
  | 'recebido_no_portal_em'
  | 'recebido_em'
  | 'situacao'
>;

/**
 * Um lead por conversa e um por ficha, só de quem mandou mensagem: o mais
 * recente que não foi descartado; se todos foram, o mais recente (de onde a
 * pessoa veio continua sendo verdade).
 */
export function montarOrigens(linhas: readonly LinhaDaConsulta[]): OrigensNoPortal {
  const ordenadas = linhas
    .filter((l) => l.grupo === 'mensagem')
    .sort((a, b) => chegouEm(b).localeCompare(chegouEm(a)));
  const porConversa = new Map<string, OrigemNaConversa>();
  const porFicha = new Map<string, OrigemNaConversa>();
  const guardar = (
    mapa: Map<string, OrigemNaConversa>,
    chave: string | null,
    o: OrigemNaConversa,
  ) => {
    if (!chave) return;
    const ja = mapa.get(chave);
    if (ja && !(ja.descartado && !o.descartado)) return;
    mapa.set(chave, o);
  };
  for (const l of ordenadas) {
    if (!l.organization_id && !l.conversation_id) continue;
    const origem = origemDoLead(l);
    const o: OrigemNaConversa = {
      leadId: l.id,
      frase: fraseDaOrigem(l),
      parecido: origem.tipo === 'parecido',
      anuncioId: origem.tipo === 'parecido' ? null : l.anuncio_id,
      codigo: origem.codigo,
      chegouEm: chegouEm(l),
      descartado: l.situacao === 'descartado',
    };
    guardar(porConversa, l.conversation_id, o);
    guardar(porFicha, l.organization_id, o);
  }
  return { porConversa, porFicha };
}

/** A conversa primeiro (é dela que a pessoa escreveu), depois a ficha. */
export function origemDaConversa(
  origens: OrigensNoPortal,
  { conversaId, organizacaoId }: { conversaId: string | null; organizacaoId: string | null },
): OrigemNaConversa | null {
  return (
    (conversaId ? origens.porConversa.get(conversaId) : undefined) ??
    (organizacaoId ? origens.porFicha.get(organizacaoId) : undefined) ??
    null
  );
}

async function carregarOrigens(): Promise<OrigensNoPortal> {
  const { data, error } = await createClient()
    .from('portal_leads_na_lista')
    .select(
      'id, organization_id, conversation_id, grupo, chegou_por, chegou_em, client_listing_id, anuncio_codigo, anuncio_id, lead_certo, mcmv, tipos, recebido_no_portal_em, recebido_em, situacao',
    )
    .eq('grupo', 'mensagem')
    .or('organization_id.not.is.null,conversation_id.not.is.null')
    .order('recebido_em', { ascending: false })
    .limit(TETO_ORGANIZACOES * 2);
  if (error) throw new Error(error.message);
  return montarOrigens((data ?? []) as unknown as LinhaDaConsulta[]);
}

const NENHUMA: OrigensNoPortal = { porConversa: new Map(), porFicha: new Map() };

/**
 * O lead do portal da conversa (pelo id dela) ou da ficha, ou null. Na KOMUNE,
 * sempre null e sem consulta.
 */
export function useOrigemNoPortal({
  conversaId,
  organizacaoId,
}: {
  conversaId: string | null;
  organizacaoId: string | null;
}): OrigemNaConversa | null {
  const consulta = useQuery({
    queryKey: CHAVE_ORIGENS_NO_PORTAL,
    queryFn: carregarOrigens,
    enabled: ORIGEM_NO_PORTAL_NA_EMPRESA,
    staleTime: 60_000,
  });
  return origemDaConversa(consulta.data ?? NENHUMA, { conversaId, organizacaoId });
}

/**
 * O pedaço curto para a linha embaixo do nome, no cabeçalho da conversa: "veio
 * do anúncio SA0012_IMOVA" ou "parecido com o anúncio SA0012_IMOVA".
 */
export function origemCurta(origem: OrigemNaConversa | null): string | null {
  if (!origem?.codigo) return null;
  return origem.parecido
    ? `parecido com o anúncio ${origem.codigo}`
    : `veio do anúncio ${origem.codigo}`;
}
