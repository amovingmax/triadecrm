'use client';

import { FileSpreadsheet, RotateCw, TriangleAlert } from 'lucide-react';

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
    <div aria-busy="true" aria-live="polite" className="flex flex-col gap-4">
      <p className="sr-only">Conferindo a planilha contra a base.</p>
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="flex flex-col gap-2 rounded-xl border border-hairline p-3">
            <Skeleton className="h-7 w-12" />
            <Skeleton className="h-3.5 w-24" />
          </div>
        ))}
      </div>
      <ul className="flex flex-col">
        {['w-52', 'w-40', 'w-64', 'w-44', 'w-56'].map((largura, i) => (
          <li key={i} className="flex items-center gap-3 border-b border-hairline py-3">
            <Skeleton className="h-4 w-8" />
            <Skeleton className={`h-4 ${largura}`} />
            <Skeleton className="ml-auto h-5 w-24 rounded-full" />
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Nenhum lote importado ainda: o que é esta tela e por onde começar. */
export function SemLotes() {
  return (
    <div className="flex flex-col items-center gap-3 px-6 py-10 text-center">
      <span className="flex size-10 items-center justify-center rounded-xl bg-muted text-muted-foreground">
        <FileSpreadsheet className="size-5" aria-hidden="true" />
      </span>
      <div className="space-y-1">
        <p className="font-heading font-medium">Nenhuma planilha importada ainda</p>
        <p className="mx-auto max-w-md text-sm leading-relaxed text-muted-foreground">
          Escolha o arquivo acima. O CRM sugere o que é cada coluna, você corrige o que estiver
          errado e confere a prévia antes de qualquer coisa ser gravada.
        </p>
      </div>
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
      className="flex flex-col items-start gap-3 rounded-xl border border-hairline bg-destructive/5 p-4"
    >
      <div className="flex items-start gap-3">
        <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-destructive/10 text-destructive-texto">
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
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-3 text-sm">
        <span className="text-muted-foreground">{rotulo}</span>
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
          className="h-full rounded-full bg-foreground/70 transition-[width] duration-200 ease-out"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}
