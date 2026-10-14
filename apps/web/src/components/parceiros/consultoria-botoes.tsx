'use client';

import { useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Headset } from 'lucide-react';
import { toast } from 'sonner';

import { cn } from '@/lib/utils';

import {
  avisoDaConsultoria,
  carregarConsultoria,
  CHAVE_CONSULTORIA,
  HREF_CONSULTORIA,
  marcarConsultoria,
  recadoDaConsultoria,
} from './consultoria';

const NINGUEM: ReadonlySet<string> = new Set();

/**
 * Quem está na Consultoria e o clique que põe e tira (14/10/2026). As regras
 * estão em `consultoria.ts`. Sem diálogo: nada se perde, e o aviso traz
 * "Desfazer" e o caminho para a aba.
 */
export function useConsultoria(ligada: boolean) {
  const clientes = useQueryClient();
  const consulta = useQuery({
    queryKey: CHAVE_CONSULTORIA,
    queryFn: carregarConsultoria,
    enabled: ligada,
  });
  const router = useRouter();

  // O "Desfazer" do aviso: o clique contrário, sem outro aviso de desfazer.
  const desfazer = useCallback(
    async (ids: readonly string[], sim: boolean) => {
      const r = await marcarConsultoria(ids, sim);
      if (!r.ok) {
        toast.error('Não deu para desfazer.', { description: recadoDaConsultoria(r.motivo) });
        return;
      }
      void clientes.invalidateQueries({ queryKey: CHAVE_CONSULTORIA });
      toast.success('Desfeito.');
    },
    [clientes],
  );

  const marcar = useCallback(
    async (ids: readonly string[], sim: boolean): Promise<boolean> => {
      const r = await marcarConsultoria(ids, sim);
      if (!r.ok) {
        toast.error(sim ? 'Não foi para a Consultoria.' : 'Não saiu da Consultoria.', {
          description: recadoDaConsultoria(r.motivo),
        });
        return false;
      }
      void clientes.invalidateQueries({ queryKey: CHAVE_CONSULTORIA });
      toast.success(avisoDaConsultoria(sim, ids.length, r.mudaram), {
        description: sim
          ? 'Aparece em Conversas → Consultoria. A etapa do funil não muda.'
          : 'Volta para a lista de Conversas, se tiver conversa.',
        action:
          r.mudaram > 0
            ? { label: 'Desfazer', onClick: () => void desfazer(ids, !sim) }
            : sim
              ? { label: 'Abrir', onClick: () => router.push(HREF_CONSULTORIA) }
              : undefined,
        duration: 8_000,
      });
      return true;
    },
    [clientes, router, desfazer],
  );

  return { naConsultoria: consulta.data ?? NINGUEM, marcar };
}

/**
 * O botão da linha: um fone quando o parceiro não está na Consultoria; a
 * pílula "Consultoria" quando está — e o mesmo clique o tira de lá.
 */
export function BotaoConsultoria({
  nome,
  marcado,
  aoMudar,
  className,
}: {
  nome: string;
  marcado: boolean;
  aoMudar: (sim: boolean) => void;
  className?: string;
}) {
  const rotulo = marcado
    ? `${nome} está na Consultoria. Tirar de lá`
    : `Mandar ${nome} para a Consultoria, em Conversas`;
  return (
    <button
      type="button"
      onClick={() => aoMudar(!marcado)}
      title={rotulo}
      aria-label={rotulo}
      aria-pressed={marcado}
      className={cn(
        'inline-flex shrink-0 items-center justify-center gap-1 rounded-lg text-xs font-medium',
        'transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50',
        marcado
          ? 'h-6 border border-hairline bg-muted px-2 text-foreground hover:bg-muted/70'
          : 'size-7 text-muted-foreground hover:bg-muted hover:text-foreground',
        className,
      )}
    >
      {marcado ? (
        <>
          <Check className="size-3" aria-hidden="true" />
          Consultoria
        </>
      ) : (
        <Headset className="size-4" aria-hidden="true" />
      )}
    </button>
  );
}
