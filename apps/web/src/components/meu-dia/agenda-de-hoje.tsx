'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { CalendarClock, CalendarDays, CircleCheck } from 'lucide-react';

import { cn } from '@/lib/utils';
import { Skeleton } from '@/components/ui/skeleton';
import { ROTULO_DA_RESPOSTA } from '@/components/agenda/lembrete-de-visita';

import { buscarAgendaDeHoje, type CompromissoDeHoje } from './consultas';
import { linkDaAgenda, rotuloSemHora, separarPelaHora } from './hora-na-agenda';

/**
 * A agenda de hoje ao lado da fila, no Meu dia novo da Imova (módulo `meuDiaNovo`).
 *
 * A fila só mostra a reunião que está a menos de três horas (`reuniao_proxima`);
 * a agenda mostra o dia inteiro, com a linha do "agora" no meio, para a pessoa
 * saber quanto tempo tem até sair para a visita antes de pegar a próxima conversa.
 *
 * Duas formas: a coluna inteira em tela larga, e no celular só o próximo
 * compromisso, numa faixa, que é o que cabe no topo sem empurrar a fila para baixo.
 *
 * SÓ O QUE TEM HORA LEVA HORA (11/11/2026). A apresentação a combinar e a visita
 * sem hora combinada carregam o prazo da régua (09:00), e apareciam como "09:00 ·
 * atrasada 3 h". Agora a régua é a da Agenda (`hora-na-agenda.ts`): elas descem
 * para "Sem hora marcada", sem hora e sem atraso. E "Abrir agenda" leva a agenda
 * da pessoa cujo dia está aberto, e não a de quem entrou.
 */
export function AgendaDeHoje({
  pessoa,
  usuarioId,
  hoje,
  forma,
}: {
  /** De quem é o dia (o mesmo do seletor). */
  pessoa: string;
  /** Quem entrou: com outra pessoa no seletor, os links levam `?pessoa=`. */
  usuarioId?: string;
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
  const { comHora, semHora } = separarPelaHora(itens);
  const proximo = comHora.find((c) => !c.feito && new Date(c.quando).getTime() >= agora);
  const daAgenda = linkDaAgenda(pessoa, usuarioId);

  if (forma === 'faixa') {
    if (!proximo) return null;
    return (
      <Link
        href={daAgenda}
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
  const indiceDoAgora = comHora.findIndex((c) => new Date(c.quando).getTime() >= agora);

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
          href={daAgenda}
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
        <>
          {comHora.length > 0 ? (
            <ol className="flex flex-col">
              {comHora.map((compromisso, ordem) => (
                <li key={compromisso.id} className="flex flex-col">
                  {ordem === indiceDoAgora ? <LinhaDoAgora agora={agora} /> : null}
                  <Compromisso compromisso={compromisso} agora={agora} daAgenda={daAgenda} />
                </li>
              ))}
              {indiceDoAgora === -1 ? <LinhaDoAgora agora={agora} /> : null}
            </ol>
          ) : (
            <p className="py-2 text-sm text-muted-foreground">Nenhum horário marcado para hoje.</p>
          )}
          {semHora.length > 0 ? <SemHora itens={semHora} daAgenda={daAgenda} /> : null}
        </>
      )}
    </section>
  );
}

/**
 * O que é de hoje mas não tem hora combinada: a apresentação a combinar e a visita
 * sem hora. Sem hora e sem "atrasada": a hora delas é prazo, não compromisso.
 */
function SemHora({ itens, daAgenda }: { itens: readonly CompromissoDeHoje[]; daAgenda: string }) {
  return (
    <div className="flex flex-col pt-2">
      <h3 className="text-xs font-medium text-muted-foreground">Sem hora marcada</h3>
      <ul className="flex flex-col">
        {itens.map((c) => (
          <li key={c.id}>
            <Link
              href={c.organizacaoId ? `/parceiros/${c.organizacaoId}` : daAgenda}
              className="flex min-w-0 flex-col border-t py-2.5 first:border-t-0 outline-none focus-visible:bg-muted/40 md:hover:bg-muted/40"
            >
              <span
                className={cn(
                  'truncate text-sm',
                  c.feito ? 'text-muted-foreground line-through' : 'text-foreground',
                )}
              >
                {tituloDoCompromisso(c)}
              </span>
              <span className="truncate text-xs text-muted-foreground">
                {rotuloSemHora(c.tipo)}
                {c.feito ? ' · feita' : ''}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Compromisso({
  compromisso,
  agora,
  daAgenda,
}: {
  compromisso: CompromissoDeHoje;
  agora: number;
  daAgenda: string;
}) {
  const instante = new Date(compromisso.quando).getTime();
  const passou = compromisso.feito || instante < agora;
  const destino = compromisso.organizacaoId ? `/parceiros/${compromisso.organizacaoId}` : daAgenda;
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
          {compromisso.feito ? ' · feita' : ''}
        </span>
        {/* O toque do cliente no lembrete da véspera: verde confirmou, âmbar quer
            outro horário — as mesmas cores do cartão da Agenda. */}
        {compromisso.respostaDoLembrete && !compromisso.feito ? (
          <span
            className={cn(
              'mt-1 inline-flex items-center gap-1 self-start rounded-full px-2 py-0.5 text-xs font-medium',
              compromisso.respostaDoLembrete === 'confirmou'
                ? 'bg-cliente-fundo text-cliente-texto'
                : 'bg-morno-fundo text-morno-texto',
            )}
          >
            {compromisso.respostaDoLembrete === 'confirmou' ? (
              <CircleCheck className="size-3" aria-hidden="true" />
            ) : (
              <CalendarClock className="size-3" aria-hidden="true" />
            )}
            {ROTULO_DA_RESPOSTA[compromisso.respostaDoLembrete]}
          </span>
        ) : null}
        {/* O que vem diz quanto falta, no laranja da marca; o que passou sem ser
            feito diz há quanto tempo, no tom de alerta — como no protótipo. */}
        {!compromisso.feito && !passou ? (
          <span className="numerico mt-0.5 text-xs font-medium text-menta-texto">
            {quantoFalta(compromisso.quando, agora)}
          </span>
        ) : !compromisso.feito ? (
          <span className="numerico mt-1 self-start rounded-full bg-destructive/15 px-2 py-0.5 text-xs font-semibold text-destructive-texto">
            {quantoPassou(compromisso.quando, agora)}
          </span>
        ) : null}
      </span>
    </Link>
  );
}

function LinhaDoAgora({ agora }: { agora: number }) {
  return (
    <span
      className="flex items-center gap-2 py-1 text-xs font-semibold text-menta-texto"
      role="presentation"
    >
      <span className="numerico w-11 shrink-0">{hora(new Date(agora).toISOString())}</span>
      <span aria-hidden="true" className="h-0.5 flex-1 rounded-full bg-menta" />
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

/** "atrasada 42 min", "atrasada 2 h": o compromisso que passou sem ser marcado feito. */
function quantoPassou(iso: string, agora: number): string {
  const minutos = Math.max(1, Math.round((agora - new Date(iso).getTime()) / 60_000));
  if (minutos < 60) return `atrasada ${minutos} min`;
  const horas = Math.floor(minutos / 60);
  return `atrasada ${horas} h`;
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
