'use client';

import { useQuery } from '@tanstack/react-query';
import { Sparkles } from 'lucide-react';

import { createClient } from '@/lib/supabase/client';
import { cn } from '@/lib/utils';

/**
 * As conversas em que a IA leu interesse na resposta a um aviso de ligação, e o
 * negócio ainda não foi qualificado (`public.qualificacoes_sugeridas`, migração
 * 20261013120000). Uma consulta para a fila inteira: todo item usa a mesma chave.
 */
async function buscarInteresses(): Promise<ReadonlySet<string>> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc('qualificacoes_sugeridas');
  if (error) throw error;
  return new Set(
    ((data ?? []) as { organization_id: string | null }[])
      .map((l) => l.organization_id)
      .filter((id): id is string => typeof id === 'string'),
  );
}

export function useInteresseSugerido(organizacaoId: string | null, ligado: boolean): boolean {
  const { data } = useQuery({
    queryKey: ['meu-dia', 'qualificar'],
    queryFn: buscarInteresses,
    enabled: ligado,
    staleTime: 30_000,
  });
  return Boolean(ligado && organizacaoId && data?.has(organizacaoId));
}

/**
 * O selo da linha "Responder no WhatsApp" quando há interesse a qualificar. É o
 * desenho da marca "Nova" (`avisos/marca-de-nova`) e do selo do cartão de sugestão
 * na conversa — quem abre a linha encontra lá o botão Qualificar.
 */
export function SeloDeInteresse({ className }: { className?: string }) {
  return (
    <span
      title="A IA leu interesse na resposta ao aviso de ligação. Abra a conversa para qualificar."
      className={cn(
        'inline-flex shrink-0 items-center gap-1 rounded-full bg-menta py-px pr-1.5 pl-1 text-[10px] leading-4 font-semibold tracking-[0.04em] text-menta-tinta uppercase',
        className,
      )}
    >
      <Sparkles className="size-3" aria-hidden="true" />
      Interesse
    </span>
  );
}
