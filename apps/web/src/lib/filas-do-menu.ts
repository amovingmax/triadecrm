import { createClient } from '@/lib/supabase/server';
import { type ChaveDeFila } from '@/lib/navegacao';

/**
 * As filas que o menu conta, e por que só estas.
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
 * - `candidatos` — candidato na fila de Revisão, de qualquer origem, ainda não
 *   decidido. É o caso mais puro da regra: a importação já fez a parte dela e a
 *   linha parou numa pessoa. Sem o número, ninguém abre a Revisão por vontade
 *   própria — abre-se *porque* alguém lembrou que ela existe, o que é o oposto
 *   de direcionamento.
 * - `respostas` — resposta nova para esta pessoa, em Conversas. NÃO é contada
 *   aqui: ela muda a cada mensagem que chega e cai quando a pessoa abre a conversa,
 *   e um número contado no servidor só mudaria na recarga da página. Quem a
 *   mantém é o aviso de resposta (`components/avisos/provedor-avisos.tsx`). Até
 *   01/10/2026 o número de Conversas era o de rascunhos da IA pendentes; eles
 *   seguem na aba "Aprovar" da própria tela.
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
 * Aqui é um `count: 'exact', head: true`: o Postgres conta pelo índice e não
 * devolve linha nenhuma. Roda em paralelo com a sessão, no mesmo `layout`, então
 * não acrescenta uma ida à rede em série.
 *
 * ---------------------------------------------------------------------------
 * A RLS DECIDE, E O ERRO NÃO DERRUBA A CASCA
 * ---------------------------------------------------------------------------
 * A consulta passa pelo cliente normal, com a RLS ligada. Para quem não
 * enxerga a tabela, a contagem volta zero — e o item nem aparece no menu, porque
 * `papeis` já o escondeu antes. Se a consulta falhar por qualquer motivo, a
 * contagem é `null` e o item simplesmente não mostra número: a barra lateral
 * inteira não pode cair porque uma contagem de badge não respondeu.
 */
export type ContagemDasFilas = Partial<Record<ChaveDeFila, number | null>>;

export async function contarFilasDoMenu(): Promise<ContagemDasFilas> {
  const supabase = await createClient();

  const candidatos = await supabase
    .from('supplier_candidates')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'novo');

  return {
    candidatos: candidatos.error ? null : (candidatos.count ?? null),
  };
}
