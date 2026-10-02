import { createClient } from '@/lib/supabase/client';

import { type ConversaComResposta } from './regra';

/**
 * As leituras do aviso de resposta. SÓ leituras.
 *
 * Nada aqui escreve no banco: nem em `messages`, nem em `conversations`, nem na
 * fila de saída. O aviso observa o que o worker-wa já gravou e não muda o estado
 * de conversa nenhuma — nem o "por ler" (`unread_count`), que continua sendo
 * zerado só por quem abre a conversa na tela.
 */

/** Quantas conversas a conferência traz. Quem ficou duas semanas fora vê "50", não "312". */
export const TETO_DE_RESPOSTAS = 50;

/** O marco de quem nunca abriu o CRM num banco sem conversa nenhuma. */
export const ANTES_DE_TUDO = '1970-01-01T00:00:00+00:00';

interface LinhaCrua {
  id: string;
  organization_id: string | null;
  assignee_id: string;
  last_inbound_at: string | null;
  peer_nome: string | null;
  peer_phone_e164: string;
  messages: { id: string }[] | null;
}

/**
 * As conversas em que chegou mensagem depois de `desde`, com a resposta à
 * pergunta "alguém do time já escreveu aqui?".
 *
 * UMA ida ao banco. A mensagem embutida é filtrada e limitada a uma por conversa
 * — o que importa é se existe, não quantas são —, e sai pelo índice
 * `messages_conv_idx`. O filtro é o de `app.messages_quem_responde_atende`
 * (saída do CRM escrita por gente ou aprovada por gente), menos os modelos: o
 * cumprimento de abertura e o de campanha abrem a conversa, não a atendem.
 *
 * `null` é falha de rede, e não "nada chegou": quem chama mantém o que tinha.
 */
export async function lerConversasComResposta(
  desde: string,
): Promise<ConversaComResposta[] | null> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from('conversations')
    .select(
      'id, organization_id, assignee_id, last_inbound_at, peer_nome, peer_phone_e164, messages(id)',
    )
    .gt('last_inbound_at', desde)
    .eq('messages.direction', 'out')
    .eq('messages.origin', 'crm')
    .in('messages.author_kind', ['human', 'bot_ai'])
    .neq('messages.type', 'template')
    .neq('messages.status', 'failed')
    .limit(1, { referencedTable: 'messages' })
    .order('last_inbound_at', { ascending: false })
    .limit(TETO_DE_RESPOSTAS);

  if (error) return null;

  return ((data ?? []) as LinhaCrua[])
    .filter((linha) => linha.last_inbound_at !== null)
    .map((linha) => ({
      conversaId: linha.id,
      organizacaoId: linha.organization_id,
      responsavelId: linha.assignee_id,
      chegouEm: linha.last_inbound_at as string,
      nomeDoPerfil: linha.peer_nome,
      telefone: linha.peer_phone_e164,
      alguemEscreveu: (linha.messages?.length ?? 0) > 0,
    }));
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

/** Os nomes das fichas, só quando há o que avisar. Falha vira mapa vazio: o aviso sai sem nome. */
export async function lerNomesDasFichas(ids: readonly string[]): Promise<Map<string, string>> {
  const nomes = new Map<string, string>();
  if (ids.length === 0) return nomes;

  const supabase = createClient();
  const { data, error } = await supabase
    .from('organizations_view')
    .select('id, name')
    .in('id', [...new Set(ids)]);

  if (error) return nomes;
  for (const linha of (data ?? []) as { id: string | null; name: string | null }[]) {
    if (linha.id && linha.name) nomes.set(linha.id, linha.name);
  }
  return nomes;
}

/**
 * Quem está ativo no time. A view `team_directory` não tem PII e é legível por
 * todo autenticado. `null` é falha de rede (ver `ehParaMim`).
 */
export async function lerPessoasAtivas(): Promise<Set<string> | null> {
  const supabase = createClient();
  const { data, error } = await supabase.from('team_directory').select('id').eq('is_active', true);

  if (error) return null;
  return new Set(
    ((data ?? []) as { id: string | null }[])
      .map((linha) => linha.id)
      .filter((id): id is string => id !== null),
  );
}
