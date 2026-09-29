import { createClient } from '@/lib/supabase/client';

import { ErroDaConversa } from './acoes';

/**
 * O que o CRM mandou sozinho (RPC `public.mensagens_automaticas`, migração
 * 20261002190000).
 *
 * Rafael, 28/09/2026: "onde e como vemos as mensagens que foram enviadas
 * automáticas?". A pergunta é por MENSAGEM, e nenhuma consulta que já existe
 * responde: `app.conversas_esperando_gente` responde por conversa,
 * `public.envio_em_massa_detalhe` por lote, e `conversas/dados.ts` por parceiro.
 */

/** Sete dias, que é o que cabe numa tela e o horizonte da pergunta diária. */
export const DIAS_DO_FEED = 7;

/**
 * O teto de linhas do feed — o mesmo `p_limite` que a RPC recebe.
 *
 * Exportado porque o placar do cabeçalho conta as linhas CARREGADAS, e no dia em
 * que elas baterem no teto o texto tem de dizer isso. Um placar que diz "200
 * saíram" numa semana de 900 não é resumo, é número errado.
 */
export const LIMITE_DO_FEED = 200;

export const CHAVE_AUTOMATICAS = ['conversas', 'automaticas', DIAS_DO_FEED] as const;

/** Uma linha crua da RPC. O tipo gerado declara tudo não-nulo; não é. */
export type AutomaticaCrua = {
  message_id: string | null;
  conversation_id: string | null;
  organization_id: string | null;
  organizacao: string | null;
  quando: string | null;
  autor: string | null;
  modelo: string | null;
  rotulo: string | null;
  corpo: string | null;
  entrega: string | null;
  erro: string | null;
  respondeu_em: string | null;
  gente_falou_em: string | null;
  atendente: string | null;
};

/**
 * A data em que o feed passa a contar (`app_settings.automaticas.marco_zero`).
 *
 * Ela é LIDA pela tela, e não só aplicada pelo banco, porque um feed que corta
 * em silêncio mente por omissão: "3 saíram nos últimos 7 dias" é falso quando o
 * que a função devolve começa anteontem. A tela diz a data; o placar continua
 * contando o que a tela mostra.
 */
export async function carregarMarcoZero(): Promise<string | null> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from('app_settings')
    .select('value')
    .eq('key', 'automaticas')
    .maybeSingle();
  // Falha aqui não pode derrubar o feed: sem a data a tela mostra o que sempre
  // mostrou, que é o comportamento de antes desta linha existir.
  if (error) return null;
  const valor = (data?.value ?? null) as { marco_zero?: string | null } | null;
  return valor?.marco_zero?.trim() || null;
}

export async function carregarAutomaticas(): Promise<AutomaticaCrua[]> {
  const supabase = createClient();
  const desde = new Date(Date.now() - DIAS_DO_FEED * 24 * 60 * 60 * 1000).toISOString();
  // `p_ate` fica no padrão da função (`now()`) de propósito: mandar um `now()`
  // do NAVEGADOR faria o feed depender do relógio da máquina de quem abre, e um
  // relógio dois minutos atrasado esconderia justo a mensagem mais recente — a
  // que a pessoa abriu a tela para ver.
  const { data, error } = await supabase.rpc('mensagens_automaticas', {
    p_desde: desde,
    p_limite: LIMITE_DO_FEED,
  });
  if (error) {
    throw new ErroDaConversa('Não deu para ler o que o CRM mandou sozinho.', true, error);
  }
  return (data ?? []) as unknown as AutomaticaCrua[];
}
