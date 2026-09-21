'use client';

import { useState } from 'react';
import { ListTodo } from 'lucide-react';
import { toast } from 'sonner';

import { createClient } from '@/lib/supabase/client';

/**
 * "Virar tarefa" (Fase 3): o que a pessoa pediu na mensagem vira tarefa minha,
 * para o próximo dia útil às 9h, com o texto dela no título. Um toque; a data
 * e o texto se ajustam depois, no Meu dia.
 */
export function VirarTarefa({ mensagemId }: { mensagemId: string }) {
  const [feito, setFeito] = useState(false);
  const [indo, setIndo] = useState(false);

  async function virar() {
    setIndo(true);
    const { data, error } = await createClient().rpc('virar_tarefa', { p_message_id: mensagemId });
    setIndo(false);
    if (error || !(data as { ok?: boolean } | null)?.ok) {
      toast.error('Não virou tarefa.');
      return;
    }
    setFeito(true);
    toast.success('Virou tarefa sua, para o próximo dia útil às 9h.', {
      description: 'Ajuste a data no Meu dia, se precisar.',
    });
  }

  return (
    <button
      type="button"
      disabled={feito || indo}
      onClick={() => void virar()}
      className="ml-auto inline-flex items-center gap-1 rounded px-1 text-[11px] text-muted-foreground hover:text-foreground disabled:opacity-60"
    >
      <ListTodo className="size-3" aria-hidden="true" />
      {feito ? 'Virou tarefa' : 'Virar tarefa'}
    </button>
  );
}
