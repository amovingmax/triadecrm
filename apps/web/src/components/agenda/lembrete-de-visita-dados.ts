'use client';

import type { createClient } from '@/lib/supabase/client';
import { EMPRESA } from '@/lib/empresa';

import type { LinhaDoLembrete } from './lembrete-de-visita';

/**
 * As respostas dos lembretes de visita das tarefas da tela (Agenda e Meu dia), sob a
 * RLS de quem entrou: quem vê a tarefa vê o lembrete dela. Só a Imova tem a tabela;
 * lista vazia não vai ao servidor. É enfeite do cartão, então o erro é engolido: sem
 * ele o compromisso aparece como antes, sem o selo.
 */
export async function buscarRespostasDosLembretes(
  supabase: ReturnType<typeof createClient>,
  taskIds: readonly string[],
): Promise<LinhaDoLembrete[]> {
  if (!EMPRESA.modulos.lembreteDeVisita || taskIds.length === 0) return [];
  const { data, error } = await supabase
    .from('visita_lembretes')
    .select('task_id, marcada_para, resposta')
    .in('task_id', [...taskIds])
    .not('resposta', 'is', null);
  if (error || !data) return [];
  return data as LinhaDoLembrete[];
}
