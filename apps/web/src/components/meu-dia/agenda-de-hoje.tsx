'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { CalendarDays } from 'lucide-react';

import { cn } from '@/lib/utils';
import { Skeleton } from '@/components/ui/skeleton';

import { buscarAgendaDeHoje, type CompromissoDeHoje } from './consultas';

/**
 * A agenda de hoje ao lado da fila, no Meu dia novo da Imova (módulo `meuDiaNovo`).
 *
 * A fila só mostra a reunião que está a menos de três horas (`reuniao_proxima`);
 * a agenda mostra o dia inteiro, com a linha do "agora" no meio, para a pessoa
 * saber quanto tempo tem até sair para a visita antes de pegar a próxima conversa.
 *
 * Duas formas: a coluna inteira em tela larga, e no celular só o próximo
 * compromisso, numa faixa, que é o que cabe no topo sem empurrar a fila para baixo.
 */
export function AgendaDeHoje({
  pessoa,
  hoje,
  forma,
}: {
  /** De quem é o dia (o mesmo do seletor). */
  pessoa: string;
  hoje: string;
  forma: 'coluna' | 'faixa';
}) {
  const agenda = useQuery({
    queryKey: ['meu-dia', 'agenda-de-hoje', pessoa, hoje],
    queryFn: () => buscarAgendaDeHoje(pessoa, hoje),
    refetchOnMount: 'always',
  });
  const [agora, setAgora] = useState(() => Date.now());
  useEffect(() => {
    const relogio = setInterval(() => setAgora(Date.now()), 60_000);
    return () => clearInterval(relogio);
  }, []);

  const itens = agenda.data ?? [];
  const proximo = itens.find((c) => !c.feito && new Date(c.quando).getTime() >= agora);

  if (forma === 'faixa') {
    if (!proximo) return null;
    return (
      <Link
        href="/agenda"
        className="sombra-base flex min-h-12 items-center gap-2.5 rounded-xl bg-card px-3.5 py-2 text-sm lg:hidden"
      >
        <CalendarDays className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <span className="numerico shrink-0 font-medium">{hora(proximo.quando)}</span>
        <span className="min-w-0 flex-1 truncate">{tituloDoCompromisso(proximo)}</span>
        <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
          {quantoFalta(proximo.quando, agora)}
        </span>
      </Link>
    );
  }

  // O "agora" entra entre o último compromisso que já passou e o primeiro que não.
  const indiceDoAgora = itens.findIndex((c) => new Date(c.quando).getTime() >= agora);

  return (
    <section
      aria-labelledby="agenda-de-hoje"
      className="sombra-base flex flex-col gap-1 rounded-xl bg-card p-4 sm:p-5"
    >
      <div className="flex items-center justify-between gap-2 pb-1">
        <h2 id="agenda-de-hoje" className="font-heading text-sm font-semibold tracking-tight">
          Agenda de hoje
        </h2>
        <Link
          href="/agenda"
          className="toque inline-flex min-h-11 items-center text-xs text-muted-foreground underline underline-offset-4 hover:text-foreground sm:min-h-0"
        >
          Abrir agenda
        </Link>
      </div>

      {agenda.isPending ? (
        <div aria-busy="true" className="flex flex-col gap-3 py-1">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      ) : agenda.isError ? (
        <p className="py-2 text-sm text-muted-foreground">A agenda não carregou agora.</p>
      ) : itens.length === 0 ? (
        <p className="py-2 text-sm text-muted-foreground">
          Nenhuma reunião ou visita marcada para hoje.
        </p>
      ) : (
        <ol className="flex flex-col">
          {itens.map((compromisso, ordem) => (
            <li key={compromisso.id} className="flex flex-col">
              {ordem === indiceDoAgora ? <LinhaDoAgora agora={agora} /> : null}
              <Compromisso compromisso={compromisso} agora={agora} />
            </li>
          ))}
          {indiceDoAgora === -1 ? <LinhaDoAgora agora={agora} /> : null}
        </ol>
      )}
    </section>
  );
}

function Compromisso({ compromisso, agora }: { compromisso: CompromissoDeHoje; agora: number }) {
  const instante = new Date(compromisso.quando).getTime();
  const passou = compromisso.feito || instante < agora;
  const destino = compromisso.organizacaoId ? `/parceiros/${compromisso.organizacaoId}` : '/agenda';
  return (
    <Link
      href={destino}
      className="flex gap-3 border-t py-2.5 first:border-t-0 outline-none focus-visible:bg-muted/40 md:hover:bg-muted/40"
    >
      <span
        className={cn(
          'numerico w-11 shrink-0 pt-px text-sm',
          passou ? 'text-muted-foreground' : 'font-medium text-foreground',
        )}
      >
        {hora(compromisso.quando)}
      </span>
      <span className="flex min-w-0 flex-col">
        <span
          className={cn(
            'truncate text-sm',
            compromisso.feito ? 'text-muted-foreground line-through' : 'text-foreground',
          )}
        >
          {tituloDoCompromisso(compromisso)}
        </span>
        <span className="truncate text-xs text-muted-foreground">
          {compromisso.tipo === 'visit' ? 'Visita' : 'Reunião'}
          {compromisso.feito
            ? ' · feita'
            : !passou
              ? ` · ${quantoFalta(compromisso.quando, agora)}`
              : ''}
        </span>
      </span>
    </Link>
  );
}

function LinhaDoAgora({ agora }: { agora: number }) {
  return (
    <span
      className="flex items-center gap-2 py-1 text-xs font-medium text-primary"
      role="presentation"
    >
      <span className="numerico w-11 shrink-0">{hora(new Date(agora).toISOString())}</span>
      <span aria-hidden="true" className="h-0.5 flex-1 rounded-full bg-primary" />
      <span className="sr-only">agora</span>
    </span>
  );
}

/** O nome que diz com quem: o parceiro, quando há, senão o título da tarefa. */
function tituloDoCompromisso(c: CompromissoDeHoje): string {
  return c.organizacao && !c.titulo.includes(c.organizacao)
    ? `${c.titulo} · ${c.organizacao}`
    : c.titulo;
}

const FORMATO_DA_HORA = new Intl.DateTimeFormat('pt-BR', {
  timeZone: 'America/Fortaleza',
  hour: '2-digit',
  minute: '2-digit',
});

function hora(iso: string): string {
  return FORMATO_DA_HORA.format(new Date(iso));
}

/** "em 48 min", "em 2 h", "agora". */
function quantoFalta(iso: string, agora: number): string {
  const minutos = Math.round((new Date(iso).getTime() - agora) / 60_000);
  if (minutos <= 0) return 'agora';
  if (minutos < 60) return `em ${minutos} min`;
  const horas = Math.floor(minutos / 60);
  const resto = minutos % 60;
  return resto === 0 ? `em ${horas} h` : `em ${horas} h ${resto} min`;
}
