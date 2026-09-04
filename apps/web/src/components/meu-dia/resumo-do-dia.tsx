'use client';

import Link from 'next/link';
import { Info, Target } from 'lucide-react';

import { cn } from '@/lib/utils';
import { Skeleton } from '@/components/ui/skeleton';

import { metricasVisiveis, ressalvasDasMetricas, type MetricaDoDia } from './tipos';

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
      <ul className="grid grid-cols-2 gap-2 sm:grid-cols-4">
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

      {ressalvas.length > 0 ? (
        <details className="text-xs text-muted-foreground">
          <summary className="flex min-h-11 cursor-pointer list-none items-center gap-1.5 sm:min-h-8">
            <Info className="size-3.5 shrink-0" aria-hidden="true" />
            <span className="underline underline-offset-4">De onde saem estes números</span>
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

  return (
    <li className="flex flex-col gap-1.5 rounded-lg border border-hairline bg-card px-3 py-2.5">
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
      ) : (
        <p className="text-[0.6875rem] text-muted-foreground">sem meta</p>
      )}
    </li>
  );
}

/** Espera no formato final: quatro cartões da mesma altura, sem pulso. */
function EsqueletoDoResumo() {
  return (
    <div aria-busy="true" aria-live="polite">
      <span className="sr-only">Carregando o resumo do dia.</span>
      <ul className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <li
            key={i}
            className="flex flex-col gap-2 rounded-lg border border-hairline bg-card px-3 py-2.5"
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
