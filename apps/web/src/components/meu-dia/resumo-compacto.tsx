'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Info, Target } from 'lucide-react';

import { cn } from '@/lib/utils';
import { Skeleton } from '@/components/ui/skeleton';

import { EXPEDIENTE, fracaoDoExpediente, ritmoDaMeta, type RitmoDaMeta } from './novo';
import { ICONE_DA_METRICA } from './resumo-do-dia';
import {
  definicaoDaMetrica,
  metricasVisiveis,
  ressalvasDasMetricas,
  type MetricaDoDia,
} from './tipos';

/**
 * Os números do dia no Meu dia novo da Imova (módulo `meuDiaNovo`): a mesma leitura
 * de `ResumoDoDia` (RF-MET-02), numa faixa mais baixa e com a MARCA DE RITMO.
 *
 * O que muda em relação ao `ResumoDoDia`, e por quê:
 *
 * 1. **A marca de ritmo.** "28 de 40" às 10h é ótimo e às 17h é atraso, e a barra
 *    sozinha não sabe a hora. O traço na barra é onde a pessoa deveria estar agora,
 *    num ritmo constante de `EXPEDIENTE.inicio` a `EXPEDIENTE.fim`, para bater a
 *    meta; a frase embaixo diz o resultado em palavras ("5 abaixo do ritmo").
 * 2. **Mais baixa.** Os quatro cartões de 40px com zero ocupavam a primeira dobra
 *    inteira nos prints de antes; aqui o número desce para 28px e o cartão encolhe.
 * 3. **A cor diz o ritmo, como no protótipo aprovado em 10/11/2026:** abaixo do
 *    ritmo, a barra e a frase vão para o laranja da marca (`menta`, que na Imova é
 *    o laranja do logo); no ritmo ou com a meta batida, para o petróleo
 *    (`primary`). Antes das 9h e sem meta, a barra fica neutra: ainda não há
 *    ritmo para dizer.
 */
export function ResumoCompacto({
  metricas,
  carregando,
  podeDefinirMeta,
}: {
  metricas: readonly MetricaDoDia[];
  carregando: boolean;
  podeDefinirMeta: boolean;
}) {
  // O relógio anda sozinho: a marca de ritmo se move ao longo do dia sem a pessoa
  // precisar recarregar. Um minuto é o passo em que ela muda de lugar a olho nu.
  const [agora, setAgora] = useState(() => new Date());
  useEffect(() => {
    const relogio = setInterval(() => setAgora(new Date()), 60_000);
    return () => clearInterval(relogio);
  }, []);

  if (carregando) return <EsqueletoCompacto />;

  const visiveis = metricasVisiveis(metricas);
  if (visiveis.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        O resumo do dia não veio. Recarregue a tela; se continuar, avise no grupo do time.
      </p>
    );
  }

  const fracao = fracaoDoExpediente(agora);
  const comRitmo = visiveis.map((metrica) => ({
    metrica,
    ritmo: ritmoDaMeta(metrica.realizado ?? 0, metrica.meta, fracao),
  }));
  const semNenhumaMeta = visiveis.every((m) => m.meta === null);
  const algumaMarca = comRitmo.some(({ ritmo }) => ritmo.marca !== null);
  const ressalvas = ressalvasDasMetricas(metricas);

  return (
    <section aria-label="Seu dia em números" className="flex flex-col gap-2.5">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <h2 className="font-heading text-sm font-semibold tracking-tight">Seu dia em números</h2>
        {podeDefinirMeta && !semNenhumaMeta ? (
          <Link
            href="/metas"
            className="toque inline-flex min-h-11 items-center gap-1.5 text-xs text-muted-foreground underline underline-offset-4 hover:text-foreground sm:min-h-0"
          >
            <Target className="size-3.5" aria-hidden="true" />
            Ajustar metas
          </Link>
        ) : null}
      </div>

      {semNenhumaMeta ? (
        <p className="flex items-start gap-1.5 rounded-lg border border-dashed px-3 py-2 text-xs text-muted-foreground">
          <Target className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
          <span>
            Sem meta para hoje: os números abaixo mostram só o realizado.{' '}
            {podeDefinirMeta ? (
              <Link href="/metas" className="underline underline-offset-4 hover:text-foreground">
                Definir metas
              </Link>
            ) : (
              <span>Quem define a meta é gestor ou admin.</span>
            )}
          </span>
        </p>
      ) : null}

      <ul className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {comRitmo.map(({ metrica, ritmo }) => (
          <CartaoCompacto key={metrica.metrica} metrica={metrica} ritmo={ritmo} />
        ))}
      </ul>

      {algumaMarca ? (
        <p className="flex items-center gap-2 text-xs text-muted-foreground">
          <span aria-hidden="true" className="h-3 w-0.5 shrink-0 rounded-full bg-foreground" />
          <span>
            A marca mostra onde você deveria estar agora para bater a meta até as {EXPEDIENTE.fim}h.
          </span>
        </p>
      ) : null}

      {ressalvas.length > 0 ? (
        <details className="text-xs text-muted-foreground">
          <summary className="flex min-h-11 cursor-pointer list-none items-center gap-1.5 sm:min-h-7">
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

function CartaoCompacto({ metrica, ritmo }: { metrica: MetricaDoDia; ritmo: RitmoDaMeta }) {
  const realizado = metrica.realizado ?? 0;
  const meta = metrica.meta;
  const preenchido = meta && meta > 0 ? Math.min(100, Math.round((realizado / meta) * 100)) : 0;
  const bateu = ritmo.situacao === 'batida';
  const definicao = definicaoDaMetrica(metrica.metrica);
  const Icone = ICONE_DA_METRICA[metrica.metrica];

  return (
    <li
      title={definicao ? `${metrica.rotulo}: ${definicao}` : metrica.rotulo}
      className="sombra-base flex flex-col gap-2 rounded-xl bg-card px-4 py-4 sm:px-5"
    >
      <p className="flex items-center gap-2.5 text-sm text-muted-foreground">
        {Icone ? (
          <span className="flex size-8 shrink-0 items-center justify-center rounded-[10px] bg-muted text-foreground">
            <Icone className="size-4" aria-hidden="true" strokeWidth={1.75} />
          </span>
        ) : null}
        <span className="truncate">{metrica.rotulo}</span>
      </p>

      <p className="flex items-baseline gap-1.5">
        <span
          className={cn(
            'numerico text-[34px] leading-none font-medium tracking-[-0.03em]',
            realizado === 0 && 'text-muted-foreground',
          )}
        >
          {realizado}
        </span>
        <span className="text-sm text-muted-foreground">
          {meta !== null ? (
            <>
              de <span className="numerico">{meta}</span>
            </>
          ) : (
            'sem meta'
          )}
        </span>
      </p>

      {meta !== null ? (
        <span
          role="progressbar"
          aria-valuenow={preenchido}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={`${metrica.rotulo}: ${realizado} de ${meta}. ${ritmo.frase}.`}
          className="relative mt-1 block h-1.5 rounded-full bg-muted"
        >
          <span
            aria-hidden="true"
            className={cn(
              'block h-full rounded-full',
              ritmo.situacao === 'abaixo'
                ? 'bg-menta'
                : ritmo.situacao === 'no_ritmo' || bateu
                  ? 'bg-primary'
                  : 'bg-foreground/45',
            )}
            style={{ width: `${preenchido}%` }}
          />
          {ritmo.marca !== null ? (
            // O traço do ritmo, com um contorno da cor do cartão: sem ele, quando a
            // barra já passou da marca, o traço some dentro do preenchimento.
            <span
              aria-hidden="true"
              className="absolute -top-[5px] h-4 w-0.5 -translate-x-1/2 rounded-full bg-foreground ring-2 ring-card"
              style={{ left: `${ritmo.marca}%` }}
            />
          ) : null}
        </span>
      ) : null}

      <p
        className={cn(
          'mt-0.5 text-[13px]',
          ritmo.situacao === 'abaixo'
            ? 'font-semibold text-menta-texto'
            : ritmo.situacao === 'no_ritmo' || bateu
              ? 'font-semibold text-primary'
              : 'text-muted-foreground',
        )}
      >
        {ritmo.frase}
      </p>
      <span className="sr-only">{definicao}</span>
    </li>
  );
}

function EsqueletoCompacto() {
  return (
    <div aria-busy="true" aria-live="polite">
      <span className="sr-only">Carregando o resumo do dia.</span>
      <ul className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <li key={i} className="sombra-base flex flex-col gap-2 rounded-xl bg-card px-4 py-3.5">
            <Skeleton className="h-6 w-24 rounded-full" />
            <Skeleton className="h-7 w-16" />
            <Skeleton className="h-1 w-full rounded-full" />
            <Skeleton className="h-3 w-20" />
          </li>
        ))}
      </ul>
    </div>
  );
}
