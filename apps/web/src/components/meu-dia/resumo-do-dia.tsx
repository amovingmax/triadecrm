'use client';

import Link from 'next/link';
import { Info, Target } from 'lucide-react';

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
        <p className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-muted-foreground">
          <Target className="size-3.5 shrink-0" aria-hidden="true" />
          Nenhuma meta definida para hoje: os números acima são só o realizado.
          {podeDefinirMeta ? (
            <Link href="/metas" className="underline underline-offset-4 hover:text-foreground">
              Definir em Metas
            </Link>
          ) : (
            <span>Quem define a meta é gestor ou admin.</span>
          )}
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

function CartaoDeMetrica({ metrica }: { metrica: MetricaDoDia }) {
  const realizado = metrica.realizado ?? 0;
  const meta = metrica.meta;
  const percentual = meta && meta > 0 ? Math.round((realizado / meta) * 100) : null;
  const preenchido = percentual === null ? 0 : Math.min(100, percentual);
  const bateu = percentual !== null && percentual >= 100;
  const definicao = definicaoDaMetrica(metrica.metrica);

  return (
    <li className="flex flex-col gap-1.5 sm:border-l sm:border-hairline sm:pl-4 sm:first:border-l-0 sm:first:pl-0">
      <p className="truncate text-xs text-muted-foreground" title={metrica.rotulo}>
        {metrica.rotulo}
      </p>

      <p className="flex items-baseline gap-1.5">
        <span className="numerico text-2xl leading-none font-medium">{realizado}</span>
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
              className="block h-full rounded-full bg-foreground"
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

      {/* A definição vai no PÉ do cartão, e não embaixo do rótulo: ela ocupa uma ou
          duas linhas conforme a largura da coluna, e acima do número empurraria cada
          um dos quatro para uma altura diferente — a faixa perderia a leitura de
          relance, que é a única coisa que ela faz bem. */}
      {definicao ? (
        <p className="text-[0.6875rem] leading-snug text-muted-foreground">{definicao}</p>
      ) : null}
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
