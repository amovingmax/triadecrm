'use client';

import { RotateCw, TriangleAlert } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';

/**
 * Espera, vazio e erro da importação.
 *
 * A regra dos três: a espera tem o desenho do que vai chegar (não um "carregando"
 * solto), o vazio diz o que FAZER e o erro diz o que aconteceu e como sair dele —
 * nunca um código do Postgres.
 */

/** Espera da prévia, com o desenho das contagens e das primeiras linhas. */
export function EsqueletoDaPrevia() {
  return (
    <div
      aria-busy="true"
      aria-live="polite"
      className="sombra-base flex flex-col gap-5 rounded-xl bg-card p-4 sm:p-5"
    >
      <p className="sr-only">Conferindo a lista contra a base.</p>
      <div className="flex items-center justify-between gap-4">
        <Skeleton className="h-6 w-80 max-w-full" />
        <Skeleton className="h-10 w-36 rounded-full" />
      </div>
      <div className="flex gap-2">
        {['w-36', 'w-32', 'w-28'].map((largura) => (
          <Skeleton key={largura} className={`h-9 ${largura} rounded-full`} />
        ))}
      </div>
      <ul className="flex flex-col gap-2">
        {['w-52', 'w-40', 'w-64', 'w-44'].map((largura, i) => (
          <li key={i} className="flex flex-col gap-2 rounded-lg bg-muted/45 px-4 py-3">
            <Skeleton className={`h-4 ${largura}`} />
            <Skeleton className="h-3 w-72 max-w-full" />
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Falhou. Diz a causa em português e oferece a única saída que existe. */
export function ErroDaImportacao({
  titulo = 'Não deu para continuar',
  causa,
  comoResolver,
  aoTentar,
}: {
  titulo?: string;
  causa: string;
  comoResolver?: string;
  aoTentar?: () => void;
}) {
  return (
    <div
      role="alert"
      className="flex flex-col items-start gap-3 rounded-xl bg-destructive/5 p-4 sm:p-5"
    >
      <div className="flex items-start gap-3">
        <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full bg-destructive/10 text-destructive-texto">
          <TriangleAlert className="size-4" aria-hidden="true" />
        </span>
        <div className="space-y-1">
          <p className="font-heading text-sm font-medium">{titulo}</p>
          <p className="text-sm leading-relaxed text-muted-foreground">{causa}</p>
          {comoResolver ? (
            <p className="text-sm leading-relaxed text-muted-foreground">{comoResolver}</p>
          ) : null}
        </div>
      </div>
      {aoTentar ? (
        <Button variant="outline" onClick={aoTentar} className="toque h-11 md:h-9">
          <RotateCw aria-hidden="true" />
          Tentar de novo
        </Button>
      ) : null}
    </div>
  );
}

/**
 * Barra de progresso. Existe porque a promessa desta tela é "arquivo grande não
 * trava": sem um número andando, "não travou" e "travou" são a mesma tela.
 */
export function Progresso({
  rotulo,
  feitas,
  total,
}: {
  rotulo: string;
  feitas: number;
  total: number;
}) {
  const pct = total > 0 ? Math.min(100, Math.round((feitas / total) * 100)) : 0;
  return (
    <div className="sombra-base flex flex-col gap-2 rounded-xl bg-card p-4 sm:p-5">
      <div className="flex items-baseline justify-between gap-3 text-sm">
        <span className="font-medium">{rotulo}</span>
        <span className="numerico text-xs text-muted-foreground">
          {feitas} de {total}
        </span>
      </div>
      <div
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
        aria-label={rotulo}
        className="h-1.5 w-full overflow-hidden rounded-full bg-muted"
      >
        <div
          className="h-full rounded-full bg-menta transition-[width] duration-200 ease-out"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}
