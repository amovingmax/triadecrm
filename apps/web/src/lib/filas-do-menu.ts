import { createClient } from '@/lib/supabase/server';
import { type ChaveDeFila } from '@/lib/navegacao';

/**
 * As filas que o menu conta, e por que só estas duas.
 *
 * ---------------------------------------------------------------------------
 * A REGRA
 * ---------------------------------------------------------------------------
 * Um número ao lado de um item da lateral significa uma coisa só: **tem trabalho
 * parado ali esperando por você**. Não é "quantas linhas essa tela tem", não é
 * badge de novidade, e não é enfeite de densidade.
 *
 * Por isso a lista é curta e vai continuar curta:
 *
 * - `candidatos` — candidato do Radar coletado e ainda não revisado. É o caso
 *   mais puro da regra: um robô já fez a parte dele e a fila parou numa pessoa.
 *   Sem o número, ninguém abre o Radar por vontade própria — abre-se o Radar
 *   *porque* alguém lembrou que ele existe, o que é o oposto de direcionamento.
 * - `rascunhos` — rascunho da IA aguardando aprovação. Conta porque **expira**:
 *   um rascunho vencido é uma conversa que não aconteceu, e o custo do atraso é
 *   real, não estético.
 *
 * E por isso Metas, Relatórios, Cadências e Ajustes NÃO contam, mesmo tendo o que
 * contar. São telas de configuração e de leitura: nada ali espera por ninguém, e
 * um número nelas ensinaria a pessoa a ignorar os números que importam.
 *
 * ---------------------------------------------------------------------------
 * POR QUE NO SERVIDOR, E NÃO NO CLIENTE
 * ---------------------------------------------------------------------------
 * O `ProvedorConsultas` (TanStack Query) vive em cada `layout` de rota, não acima
 * da casca. Contar no cliente exigiria subir o provedor para o `AppShell` — e
 * pagaria com um estado de carregamento piscando na lateral a cada troca de tela,
 * que é exatamente o tipo de ruído que a passada de layout acabou de remover.
 *
 * Aqui são dois `count: 'exact', head: true`: o Postgres conta pelo índice e não
 * devolve linha nenhuma. Rodam em paralelo, no mesmo `layout` que já espera pela
 * sessão, então não acrescentam uma ida à rede em série.
 *
 * ---------------------------------------------------------------------------
 * A RLS DECIDE, E O ERRO NÃO DERRUBA A CASCA
 * ---------------------------------------------------------------------------
 * As duas consultas passam pelo cliente normal, com a RLS ligada. Para quem não
 * enxerga a tabela, a contagem volta zero — e o item nem aparece no menu, porque
 * `papeis` já o escondeu antes. Se a consulta falhar por qualquer motivo, a
 * contagem é `null` e o item simplesmente não mostra número: a barra lateral
 * inteira não pode cair porque uma contagem de badge não respondeu.
 */
export type ContagemDasFilas = Partial<Record<ChaveDeFila, number | null>>;

export async function contarFilasDoMenu(): Promise<ContagemDasFilas> {
  const supabase = await createClient();

  const [candidatos, rascunhos] = await Promise.all([
    supabase
      .from('supplier_candidates')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'novo'),
    supabase
      .from('message_drafts')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'pendente'),
  ]);

  return {
    candidatos: candidatos.error ? null : (candidatos.count ?? null),
    rascunhos: rascunhos.error ? null : (rascunhos.count ?? null),
  };
}
