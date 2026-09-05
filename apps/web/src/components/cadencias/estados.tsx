'use client';

import Link from 'next/link';
import { RotateCw, Route, SquareKanban } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';

/**
 * Espera, vazio e falha — os três jeitos de a tela não ter o que mostrar.
 *
 * "Nenhuma organização em cadência" não é falha e não é sucesso: é o estado real de
 * um produto que subiu a régua antes de matricular alguém. A tela diz isso com todas
 * as letras e aponta para o funil, que é de onde a matrícula sai.
 */

/** Espera no formato final: o cartão da cadência com a lista de passos por baixo. */
export function EsqueletoDasCadencias() {
  return (
    <div aria-busy="true" aria-live="polite" className="flex flex-col gap-4">
      <span className="sr-only">Carregando as cadências.</span>
      {Array.from({ length: 3 }, (_, i) => (
        <div key={i} className="rounded-xl border border-hairline bg-card">
          <div className="flex items-start justify-between gap-3 border-b border-hairline px-4 py-3">
            <div className="flex flex-1 flex-col gap-2">
              <Skeleton className="h-5 w-52" />
              <Skeleton className="h-3 w-64" />
            </div>
            <Skeleton className="h-9 w-24 rounded-lg" />
          </div>
          <ul className="flex flex-col">
            {Array.from({ length: 3 }, (_, j) => (
              <li key={j} className="flex items-start gap-3 border-b border-hairline px-4 py-3 last:border-b-0">
                <Skeleton className="size-7 rounded-lg" />
                <div className="flex flex-1 flex-col gap-2">
                  <Skeleton className="h-4 w-48" />
                  <Skeleton className="h-3 w-72" />
                </div>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

/** Espera do resumo: o bloco de honestidade, os contadores e a lista. */
export function EsqueletoDoResumo() {
  return (
    <div aria-busy="true" aria-live="polite" className="flex flex-col gap-5">
      <span className="sr-only">Carregando o resumo do dia.</span>
      <Skeleton className="h-16 w-full rounded-xl" />
      <ul className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <li key={i} className="flex flex-col gap-2 rounded-lg border border-hairline bg-card px-3 py-2.5">
            <Skeleton className="h-3 w-20" />
            <Skeleton className="h-6 w-10" />
          </li>
        ))}
      </ul>
      <div className="flex flex-col gap-2">
        {Array.from({ length: 5 }, (_, i) => (
          <div key={i} className="flex items-start gap-3 border-b border-hairline py-3 pl-4">
            <div className="flex flex-1 flex-col gap-2">
              <Skeleton className="h-4 w-56" />
              <Skeleton className="h-3 w-40" />
            </div>
            <Skeleton className="h-3 w-10" />
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * A régua existe, mas ninguém entrou nela ainda.
 *
 * Não é comemoração e não é erro: nenhuma matrícula significa que nenhum toque vai
 * nascer, e é isso que a frase tem de dizer. O caminho de saída é o funil, porque a
 * matrícula parte de um negócio com dono.
 */
export function NinguemEmCadencia({ quantasLigadas }: { quantasLigadas: number }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-xl border border-hairline bg-card px-6 py-10 text-center">
      <span className="flex size-10 items-center justify-center rounded-xl bg-muted text-muted-foreground">
        <Route className="size-5" aria-hidden="true" />
      </span>
      <div className="space-y-1">
        <p className="font-heading font-medium">Nenhuma organização está em cadência.</p>
        <p className="mx-auto max-w-md text-sm text-muted-foreground">
          As <span className="numerico">{quantasLigadas}</span> réguas abaixo estão ligadas e
          prontas, mas ninguém foi matriculado ainda — então nenhum toque vai nascer hoje. A
          matrícula parte de um negócio com dono, no funil.
        </p>
      </div>
      <Button asChild variant="outline" className="toque h-11 md:h-9">
        <Link href="/funis">
          <SquareKanban aria-hidden="true" />
          Abrir o funil
        </Link>
      </Button>
    </div>
  );
}

/** Falhou: diz em português o que houve e o que fazer, nunca o texto cru do Postgres. */
export function ErroDaTela({
  titulo,
  causa,
  aoTentar,
}: {
  titulo: string;
  causa: string;
  aoTentar: () => void;
}) {
  return (
    <div className="flex flex-col items-center gap-3 px-6 py-16 text-center">
      <span className="flex size-10 items-center justify-center rounded-xl bg-muted text-muted-foreground">
        <RotateCw className="size-5" aria-hidden="true" />
      </span>
      <div className="space-y-1">
        <p className="font-heading font-medium">{titulo}</p>
        <p className="mx-auto max-w-sm text-sm text-muted-foreground">
          {causa} Tente de novo; se continuar, avise no grupo do time.
        </p>
      </div>
      <Button variant="outline" onClick={aoTentar} className="toque h-11 md:h-9">
        <RotateCw aria-hidden="true" />
        Tentar de novo
      </Button>
    </div>
  );
}
