'use client';

import { useQuery } from '@tanstack/react-query';
import { CalendarCheck2, CalendarClock, CalendarOff, TriangleAlert } from 'lucide-react';

import { createClient } from '@/lib/supabase/client';
import { cn } from '@/lib/utils';

import {
  CHAVE_DO_ESPELHO,
  fraseDoEspelho,
  lerEstadoDoEspelho,
  type EstadoDoEspelho,
  type Tom,
} from './espelho-no-google';

/**
 * "Espelho no Google": o cartão que diz ao admin se o que a equipe marca no CRM
 * está sumindo do Calendly (11/11/2026, só na Imova).
 *
 * Um cartão pequeno e sozinho, sem props: lê `public.agenda_espelho_estado()`
 * (só admin e gestor; o banco confere) e diz uma frase (`espelho-no-google.ts`).
 * Pode ser posto em qualquer lugar onde o Calendly aparece para o admin — hoje,
 * na Agenda —, ao lado do campo "Quem atende o que chega pelo Calendly".
 *
 * SILÊNCIO SÓ QUANDO NÃO HÁ O QUE DIZER: banco sem a função (a KOMUNE, ou o banco
 * da Imova antes da migração 20261111205000) e papel sem acesso não mostram nada.
 * O resto aparece, inclusive a falha de ler o estado.
 */
async function buscarEstado(): Promise<EstadoDoEspelho | null> {
  const { data, error } = await createClient().rpc('agenda_espelho_estado');
  if (error) {
    // PGRST202/42883: a função não existe neste banco. 42501: sem permissão.
    if (['PGRST202', '42883', '42501'].includes(error.code)) return null;
    throw new Error(error.message);
  }
  return lerEstadoDoEspelho(data);
}

const APARENCIA: Record<Tom, { caixa: string; Icone: typeof CalendarCheck2 }> = {
  ligado: { caixa: 'bg-menta text-menta-tinta', Icone: CalendarCheck2 },
  desligado: { caixa: 'bg-muted text-muted-foreground', Icone: CalendarOff },
  parado: { caixa: 'bg-morno-fundo text-morno-texto', Icone: CalendarClock },
  erro: { caixa: 'bg-destructive/10 text-destructive-texto', Icone: TriangleAlert },
};

export function CartaoDoEspelhoNoGoogle({ className }: { className?: string }) {
  const consulta = useQuery({
    queryKey: CHAVE_DO_ESPELHO,
    queryFn: buscarEstado,
    // O worker passa a cada 15 s; o cartão não precisa ser mais rápido que um minuto.
    staleTime: 60_000,
    refetchInterval: 60_000,
    retry: 1,
  });

  if (consulta.isPending) return null;
  if (consulta.isError) {
    return (
      <p className={cn('px-1 text-xs text-muted-foreground', className)}>
        Espelho no Google: não deu para ler o estado agora.
      </p>
    );
  }
  if (!consulta.data) return null;

  const frase = fraseDoEspelho(consulta.data, new Date(consulta.dataUpdatedAt));
  const { caixa, Icone } = APARENCIA[frase.tom];

  return (
    <section
      aria-label="Espelho no Google"
      className={cn(
        'sombra-base flex items-start gap-3 rounded-xl bg-card px-4 py-3 text-sm',
        className,
      )}
    >
      <span className={cn('flex size-7 shrink-0 items-center justify-center rounded-full', caixa)}>
        <Icone className="size-4" aria-hidden="true" />
      </span>
      <div className="flex min-w-0 flex-col gap-0.5">
        <p className="font-medium">{frase.titulo}</p>
        {frase.detalhe ? <p className="text-xs text-muted-foreground">{frase.detalhe}</p> : null}
        {frase.comando ? (
          <p className="text-xs text-muted-foreground">
            No Terminal, na pasta do CRM:{' '}
            <code className="rounded bg-muted px-1 py-0.5 break-all text-foreground">
              {frase.comando}
            </code>
          </p>
        ) : null}
      </div>
    </section>
  );
}
