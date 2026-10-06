import { escolherNegocio, type NegocioCru } from '@/components/conversas/montagem';
import { isAppRole } from '@/lib/auth/role';
import { createClient } from '@/lib/supabase/client';

import { recebeAvisos, type ConversaComResposta, type FichaDoAviso } from './regra';

/**
 * As leituras do aviso de resposta. SÓ leituras.
 *
 * Nada aqui escreve no banco: nem em `messages`, nem em `conversations`, nem na
 * fila de saída. O aviso observa o que o worker-wa já gravou e não muda o estado
 * de conversa nenhuma — nem o "por ler" (`unread_count`), que é a tela da
 * conversa quem zera, depois que alguém do time responde.
 */

/**
 * Quantas conversas a conferência traz. A conversa só sai da conta quando alguém
 * responde, então a janela de leitura cobre dias, e não minutos: o teto tem
 * folga para isso. Bater nele trava o piso (ver `pisoPossivel`).
 */
export const TETO_DE_RESPOSTAS = 200;

/** O marco de quem nunca abriu o CRM num banco sem conversa nenhuma. */
export const ANTES_DE_TUDO = '1970-01-01T00:00:00+00:00';

interface LinhaCrua {
  id: string;
  organization_id: string | null;
  assignee_id: string;
  last_inbound_at: string | null;
  peer_nome: string | null;
  peer_phone_e164: string;
  messages: { created_at: string }[] | null;
}

/**
 * As conversas em que chegou mensagem depois de `desde`, com a resposta à
 * pergunta "quando alguém do time escreveu aqui pela última vez?".
 *
 * UMA ida ao banco. A mensagem embutida é filtrada e limitada a uma por conversa
 * — a mais recente, que é a que diz se a última entrada já foi respondida —, e
 * sai pelo índice `messages_conv_idx`. O filtro é o de
 * `app.messages_quem_responde_atende` (saída do CRM escrita por gente ou
 * aprovada por gente), menos os modelos: o cumprimento de abertura e o de
 * campanha abrem a conversa, não a atendem.
 *
 * `cheia` diz que a leitura bateu no teto: pode haver mais, abaixo dele.
 *
 * `null` é falha de rede, e não "nada chegou": quem chama mantém o que tinha.
 */
export async function lerConversasComResposta(
  desde: string,
): Promise<{ conversas: ConversaComResposta[]; cheia: boolean } | null> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from('conversations')
    .select(
      'id, organization_id, assignee_id, last_inbound_at, peer_nome, peer_phone_e164, messages(created_at)',
    )
    .gt('last_inbound_at', desde)
    .eq('messages.direction', 'out')
    .eq('messages.origin', 'crm')
    .in('messages.author_kind', ['human', 'bot_ai'])
    .neq('messages.type', 'template')
    .neq('messages.status', 'failed')
    .order('created_at', { referencedTable: 'messages', ascending: false })
    .limit(1, { referencedTable: 'messages' })
    .order('last_inbound_at', { ascending: false })
    .limit(TETO_DE_RESPOSTAS);

  if (error) return null;

  const linhas = (data ?? []) as LinhaCrua[];
  const conversas = linhas
    .filter((linha) => linha.last_inbound_at !== null)
    .map((linha): ConversaComResposta => {
      const respondidaEm = linha.messages?.[0]?.created_at ?? null;
      return {
        conversaId: linha.id,
        organizacaoId: linha.organization_id,
        responsavelId: linha.assignee_id,
        chegouEm: linha.last_inbound_at as string,
        nomeDoPerfil: linha.peer_nome,
        telefone: linha.peer_phone_e164,
        alguemEscreveu: respondidaEm !== null,
        respondidaEm,
      };
    });
  return { conversas, cheia: linhas.length >= TETO_DE_RESPOSTAS };
}

/**
 * A chegada mais recente que a pessoa enxerga: o ponto de partida de quem abre o
 * CRM pela primeira vez neste navegador. O que já estava lá não vira "novo".
 *
 * `undefined` é falha de rede; `null` é banco sem conversa nenhuma.
 */
export async function lerUltimaChegada(): Promise<string | null | undefined> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from('conversations')
    .select('last_inbound_at')
    .not('last_inbound_at', 'is', null)
    .order('last_inbound_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) return undefined;
  return (data as { last_inbound_at: string | null } | null)?.last_inbound_at ?? null;
}

/** A última mensagem recebida de uma conversa: o tipo e o texto, para a prévia do cartão. */
export interface UltimaMensagem {
  readonly tipo: string | null;
  readonly corpo: string | null;
}

/** Quantas mensagens ler por conversa para achar a última de cada uma. */
const FOLGA_POR_CONVERSA = 5;

/**
 * A última mensagem recebida de cada conversa, só para as que vão virar cartão.
 * Sob a mesma RLS da tela: quem não enxerga a conversa não lê a mensagem. Falha
 * vira mapa vazio, e o cartão sai sem prévia.
 */
export async function lerUltimasMensagens(
  conversas: readonly string[],
): Promise<Map<string, UltimaMensagem>> {
  const ultimas = new Map<string, UltimaMensagem>();
  if (conversas.length === 0) return ultimas;

  const supabase = createClient();
  const { data, error } = await supabase
    .from('messages')
    .select('conversation_id, type, body, created_at')
    .in('conversation_id', [...new Set(conversas)])
    .eq('direction', 'in')
    .order('created_at', { ascending: false })
    .limit(conversas.length * FOLGA_POR_CONVERSA);

  if (error) return ultimas;
  for (const linha of (data ?? []) as {
    conversation_id: string;
    type: string | null;
    body: string | null;
  }[]) {
    // A consulta vem da mais recente para a mais antiga: a primeira de cada
    // conversa é a que vale.
    if (!ultimas.has(linha.conversation_id)) {
      ultimas.set(linha.conversation_id, { tipo: linha.type, corpo: linha.body });
    }
  }
  return ultimas;
}

type NegocioDoAviso = Pick<NegocioCru, 'status' | 'updated_at'> & {
  organization_id: string;
  stages: { name: string | null } | null;
};

/**
 * O que o cartão diz de cada parceiro: o nome, a categoria e a etapa do funil.
 * Só quando há o que avisar, e só para as fichas que vão virar cartão.
 *
 * Duas leituras em paralelo, sob a mesma RLS da tela. A etapa é a do negócio em
 * foco, escolhido por `escolherNegocio` — a mesma escolha da lista de Conversas,
 * para o cartão não dizer "Respondeu" de um parceiro que a lista mostra em
 * "Autorizou". Cada leitura falha sozinha: sem a ficha o cartão sai sem nome e
 * sem categoria; sem os negócios, sem etapa.
 */
export async function lerFichasDoAviso(ids: readonly string[]): Promise<Map<string, FichaDoAviso>> {
  const fichas = new Map<string, FichaDoAviso>();
  if (ids.length === 0) return fichas;

  const unicos = [...new Set(ids)];
  const supabase = createClient();
  const [organizacoes, negocios] = await Promise.all([
    supabase.from('organizations_view').select('id, name, primary_category_name').in('id', unicos),
    supabase
      .from('deals')
      .select('organization_id, status, updated_at, stages(name)')
      .in('organization_id', unicos),
  ]);

  const porOrganizacao = new Map<string, NegocioDoAviso[]>();
  if (!negocios.error) {
    for (const negocio of (negocios.data ?? []) as unknown as NegocioDoAviso[]) {
      const lista = porOrganizacao.get(negocio.organization_id) ?? [];
      lista.push(negocio);
      porOrganizacao.set(negocio.organization_id, lista);
    }
  }

  const linhas = organizacoes.error
    ? []
    : ((organizacoes.data ?? []) as {
        id: string | null;
        name: string | null;
        primary_category_name: string | null;
      }[]);
  const porId = new Map(linhas.flatMap((o) => (o.id ? [[o.id, o] as const] : [])));

  for (const id of unicos) {
    const organizacao = porId.get(id);
    const emFoco = escolherNegocio(porOrganizacao.get(id) ?? []);
    fichas.set(id, {
      nome: organizacao?.name ?? null,
      categoria: organizacao?.primary_category_name ?? null,
      etapa: emFoco?.stages?.name ?? null,
    });
  }
  return fichas;
}

/**
 * Quem está ativo no time E atende o WhatsApp. A view `team_directory` não tem
 * PII e é legível por todo autenticado. `null` é falha de rede (ver `ehParaMim`).
 *
 * "E atende" entrou no pivô de 06/10/2026. O SDR passou a só ligar e deixou de
 * ser avisado; se ele continuasse contando como "responsável ativo", a conversa
 * que ainda está no nome dele seria de alguém que não a vê — e a resposta do
 * parceiro não avisaria ninguém. Fora desta lista, o responsável vale como
 * ninguém atendendo, e o aviso vai para toda a gestão.
 */
export async function lerPessoasAtivas(): Promise<Set<string> | null> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from('team_directory')
    .select('id, role')
    .eq('is_active', true);

  if (error) return null;
  return new Set(
    ((data ?? []) as { id: string | null; role: string | null }[])
      .filter((linha) => isAppRole(linha.role) && recebeAvisos(linha.role))
      .map((linha) => linha.id)
      .filter((id): id is string => id !== null),
  );
}
