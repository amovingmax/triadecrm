'use client';

import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, ExternalLink, TriangleAlert } from 'lucide-react';
import { toast } from 'sonner';

import { createClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';

import {
  AGENDADOS_NO_CALENDLY,
  deQuemEhAAgenda,
  fraseDaFalha,
  lerFalhas,
  type FalhaNoCalendly,
} from './calendly';

/**
 * "Não consegui cancelar no Calendly o agendamento de Maria, de 20/11 às 10h.
 * Cancele lá e avise o cliente." (pedido de 11/11/2026)
 *
 * O CRM cancela no Calendly o agendamento que recusou (horário ocupado, sábado,
 * domingo, feriado) e o que a equipe desmarcou. Quando o Calendly não aceita — o
 * token venceu, por exemplo —, o worker tenta 8 vezes e para, e até aqui ninguém
 * ficava sabendo: o cliente seguia com o horário confirmado lá. Agora o dono do
 * agendamento e os admins veem este aviso no topo da Agenda
 * (`public.calendly_cancelamentos_que_falharam`), até alguém tocar em "Já cancelei"
 * (`public.calendly_cancelamento_resolvido`). Cancelar lá também tira o aviso: o
 * Calendly avisa o CRM.
 *
 * Só na Imova (módulo `calendly`). Sem push novo. Banco sem a migração
 * 20261111204000 (a função não existe): silêncio, como se não houvesse nada.
 */
export function chaveDasFalhas(usuarioId: string) {
  return ['agenda', 'calendly', 'falhas', usuarioId] as const;
}

async function buscarFalhas(): Promise<FalhaNoCalendly[]> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc('calendly_cancelamentos_que_falharam');
  if (error) return [];
  return lerFalhas(data);
}

export function FalhasDoCalendly({ usuarioId }: { usuarioId: string }) {
  const cliente = useQueryClient();
  const consulta = useQuery({
    queryKey: chaveDasFalhas(usuarioId),
    queryFn: buscarFalhas,
    staleTime: 60_000,
  });
  const resolvido = useMutation({
    mutationFn: async (id: string) => {
      const supabase = createClient();
      const { error } = await supabase.rpc('calendly_cancelamento_resolvido', { p_id: id });
      if (error) throw error;
    },
    onError: () => {
      toast.error('Não deu para marcar agora. Confira a conexão e tente de novo.');
    },
    onSettled: () => void cliente.invalidateQueries({ queryKey: chaveDasFalhas(usuarioId) }),
  });

  const falhas = consulta.data ?? [];
  if (falhas.length === 0) return null;

  return (
    <section
      aria-label="Cancelamentos que o CRM não conseguiu fazer no Calendly"
      className="sombra-base flex flex-col gap-3 rounded-xl bg-card p-5"
    >
      <h2 className="flex items-center gap-2 text-[15px] font-semibold tracking-[-0.01em]">
        <span className="flex size-7 items-center justify-center rounded-full bg-destructive/10 text-destructive-texto">
          <TriangleAlert className="size-4" aria-hidden="true" />
        </span>
        {falhas.length === 1
          ? 'Um agendamento ainda está de pé no Calendly'
          : `${falhas.length} agendamentos ainda estão de pé no Calendly`}
      </h2>
      <ul className="flex flex-col gap-2">
        {falhas.map((f) => {
          const agenda = deQuemEhAAgenda(f, usuarioId);
          return (
            <li key={f.id} className="flex flex-col gap-2 rounded-lg bg-muted/45 px-4 py-3">
              <p className="text-sm">{fraseDaFalha(f)}</p>
              {agenda || f.erro ? (
                <p className="text-xs text-muted-foreground">
                  {[agenda, f.erro ? `O Calendly respondeu: ${f.erro}` : null]
                    .filter(Boolean)
                    .join(' · ')}
                </p>
              ) : null}
              <div className="flex flex-wrap items-center gap-2">
                <Button asChild variant="outline" size="lg" className="toque h-11 md:h-9">
                  <a href={AGENDADOS_NO_CALENDLY} target="_blank" rel="noopener noreferrer">
                    <ExternalLink aria-hidden="true" />
                    Abrir o Calendly
                  </a>
                </Button>
                {f.organizationId ? (
                  <Button asChild variant="outline" size="lg" className="toque h-11 md:h-9">
                    <Link href={`/parceiros/${f.organizationId}`}>Ver a ficha</Link>
                  </Button>
                ) : null}
                <Button
                  size="lg"
                  className="toque h-11 md:h-9"
                  disabled={resolvido.isPending}
                  onClick={() => resolvido.mutate(f.id)}
                >
                  <Check aria-hidden="true" />
                  Já cancelei e avisei
                </Button>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
