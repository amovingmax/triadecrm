'use client';

import Link from 'next/link';
import {
  BadgeCheck,
  CalendarCheck,
  ClipboardList,
  DoorClosed,
  DoorOpen,
  Info,
  MapPin,
  Phone,
  Target,
  UserPlus,
  type LucideIcon,
} from 'lucide-react';

import { cn } from '@/lib/utils';
import { Skeleton } from '@/components/ui/skeleton';

import {
  definicaoDaMetrica,
  metricasVisiveis,
  ressalvasDasMetricas,
  type MetricaDoDia,
} from './tipos';

/**
 * O resumo que abre a tela: quanto já foi feito hoje, contra a meta quando ela
 * existe (RF-MET-02).
 *
 * Duas escolhas que valem estar escritas:
 *
 * 1. **A barra de progresso é acromática.** A única cromia do produto é a escala
 *    térmica; uma barra verde de "meta batida" ao lado de uma linha verde de
 *    "cliente" apagaria a leitura de relance que o CRM inteiro depende. O
 *    preenchimento é a própria tinta do texto, e quem diz que a meta foi batida é o
 *    número, não a cor.
 *
 * 2. **Métrica sem meta continua aparecendo.** O banco devolve uma linha por métrica
 *    tenha ou não meta definida, e hoje a tabela `goals` está vazia: esconder as
 *    métricas sem meta deixaria a tela em branco justamente para quem mais precisa
 *    ver o que fez. Sem meta, o cartão mostra o realizado e diz "sem meta".
 *
 * 3. **Cada número carrega a própria definição.** "Portas abertas" é jargão de
 *    captação, e esta faixa é a primeira coisa que alguém vê ao entrar no CRM:
 *    quatro números que a pessoa não sabe ler não abrem o dia, atrapalham. A
 *    definição fica no pé do cartão, sempre visível, e não num `title` (que o
 *    celular não mostra) nem dentro da nota, que nasce fechada.
 */
export function ResumoDoDia({
  metricas,
  carregando,
  podeDefinirMeta,
}: {
  metricas: readonly MetricaDoDia[];
  carregando: boolean;
  /** Gestor e admin definem meta (é o que a RLS de `goals` permite); os demais só leem. */
  podeDefinirMeta: boolean;
}) {
  if (carregando) return <EsqueletoDoResumo />;

  const visiveis = metricasVisiveis(metricas);
  const semNenhumaMeta = visiveis.every((m) => m.meta === null);
  const ressalvas = ressalvasDasMetricas(metricas);

  if (visiveis.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        O resumo do dia não veio. Recarregue a tela; se continuar, avise no grupo do time.
      </p>
    );
  }

  return (
    <section aria-label="Resumo do dia" className="flex flex-col gap-3">
      <ul className="grid grid-cols-2 gap-x-6 gap-y-4 rounded-lg border border-hairline bg-card px-4 py-3 sm:grid-cols-4 sm:gap-x-4">
        {visiveis.map((metrica) => (
          <CartaoDeMetrica key={metrica.metrica} metrica={metrica} />
        ))}
      </ul>

      {semNenhumaMeta ? (
        <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
          <Target className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
          {/* O texto inteiro num filho só: com `flex-wrap`, em 390 px o alvo ficava
              sozinho numa linha e a frase começava na linha de baixo. */}
          <span>
            Sem meta para hoje: os números acima são só o realizado.{' '}
            {podeDefinirMeta ? (
              <Link href="/metas" className="underline underline-offset-4 hover:text-foreground">
                Definir em Metas
              </Link>
            ) : (
              <span>Quem define a meta é gestor ou admin.</span>
            )}
          </span>
        </p>
      ) : null}

      {/* Chamava-se "De onde saem estes números" e listava só as exceções: quem
          abria procurando o que é uma porta aberta não achava, porque a explicação
          nunca esteve aqui. Agora a definição está no cartão e esta nota volta a se
          chamar pelo que ela de fato guarda — a aproximação e o que ainda não é
          medido. */}
      {ressalvas.length > 0 ? (
        <details className="text-xs text-muted-foreground">
          <summary className="flex min-h-11 cursor-pointer list-none items-center gap-1.5 sm:min-h-8">
            <Info className="size-3.5 shrink-0" aria-hidden="true" />
            <span className="underline underline-offset-4">Ressalvas destes números</span>
          </summary>
          <ul className="mt-1 flex list-disc flex-col gap-1 pl-8 sm:pl-5">
            {ressalvas.map((frase) => (
              <li key={frase}>{frase}</li>
            ))}
          </ul>
        </details>
      ) : null}
    </section>
  );
}

/**
 * Um desenho por número. A faixa era quatro rótulos cinzas com quatro números do
 * mesmo tamanho: nada dizia, de relance, qual deles era porta batida e qual era
 * reunião. O ícone faz isso sem gastar linha.
 */
const ICONE_DA_METRICA: Record<string, LucideIcon> = {
  doors_knocked: DoorOpen,
  doors_opened: DoorClosed,
  calls_made: Phone,
  meetings_booked: CalendarCheck,
  meetings_done: CalendarCheck,
  visits_done: MapPin,
  new_targets: UserPlus,
  pre_registrations: ClipboardList,
  published: BadgeCheck,
};

function CartaoDeMetrica({ metrica }: { metrica: MetricaDoDia }) {
  const realizado = metrica.realizado ?? 0;
  const meta = metrica.meta;
  const percentual = meta && meta > 0 ? Math.round((realizado / meta) * 100) : null;
  const preenchido = percentual === null ? 0 : Math.min(100, percentual);
  const bateu = percentual !== null && percentual >= 100;
  const definicao = definicaoDaMetrica(metrica.metrica);
  const Icone = ICONE_DA_METRICA[metrica.metrica];

  return (
    <li
      // A DEFINIÇÃO VIROU TÍTULO (23/09/2026). "Contato registrado. Um por alvo, por
      // dia." embaixo de cada número somava quatro parágrafos cinzas na primeira
      // dobra da tela para explicar quatro palavras que o time usa todo dia. Quem
      // ainda não sabe passa o mouse — ou abre "Ressalvas destes números", logo
      // abaixo, que é onde a explicação longa mora de verdade.
      title={definicao ? `${metrica.rotulo}: ${definicao}` : metrica.rotulo}
      className="flex flex-col gap-1.5 sm:border-l sm:border-hairline sm:pl-4 sm:first:border-l-0 sm:first:pl-0"
    >
      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        {Icone ? <Icone className="size-3.5 shrink-0" aria-hidden="true" /> : null}
        <span className="truncate">{metrica.rotulo}</span>
      </p>

      <p className="flex items-baseline gap-1.5">
        <span
          className={cn(
            'numerico text-3xl leading-none font-semibold',
            realizado === 0 && 'text-muted-foreground',
          )}
        >
          {realizado}
        </span>
        {meta !== null ? (
          <span className="text-xs text-muted-foreground">
            de <span className="numerico">{meta}</span>
          </span>
        ) : null}
      </p>

      {meta !== null ? (
        <div className="flex items-center gap-2">
          <span
            role="progressbar"
            aria-valuenow={preenchido}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label={`${metrica.rotulo}: ${realizado} de ${meta}`}
            className="h-1 flex-1 overflow-hidden rounded-full bg-muted"
          >
            <span
              aria-hidden="true"
              className={cn('block h-full rounded-full', bateu ? 'bg-primary' : 'bg-foreground')}
              style={{ width: `${preenchido}%` }}
            />
          </span>
          <span
            className={cn(
              'numerico shrink-0 text-[0.6875rem]',
              bateu ? 'font-medium text-foreground' : 'text-muted-foreground',
            )}
          >
            {percentual}%
          </span>
        </div>
      ) : null}

      {/* A definição só existe como `title` do cartão: ver a nota acima. */}
      <span className="sr-only">{definicao}</span>
    </li>
  );
}

/** Espera no formato final: quatro cartões da mesma altura, sem pulso. */
function EsqueletoDoResumo() {
  return (
    <div aria-busy="true" aria-live="polite">
      <span className="sr-only">Carregando o resumo do dia.</span>
      <ul className="grid grid-cols-2 gap-x-6 gap-y-4 rounded-lg border border-hairline bg-card px-4 py-3 sm:grid-cols-4 sm:gap-x-4">
        {Array.from({ length: 4 }, (_, i) => (
          <li
            key={i}
            className="flex flex-col gap-2 sm:border-l sm:border-hairline sm:pl-4 sm:first:border-l-0 sm:first:pl-0"
          >
            <Skeleton className="h-3 w-20" />
            <Skeleton className="h-6 w-10" />
            <Skeleton className="h-1 w-full" />
          </li>
        ))}
      </ul>
    </div>
  );
}
