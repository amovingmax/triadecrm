'use client';

import { RotateCw } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';

/**
 * Espera e falha do painel de pré-cadastro na ficha.
 *
 * Não há estado "vazio" aqui: rascunho inexistente é um estado NORMAL do parceiro,
 * com uma ação própria, e por isso mora no painel e não nesta folha.
 */

/** Espera com o desenho final do painel: duas linhas de estado e a ação. */
export function EsqueletoDoPainel() {
  return (
    <div aria-busy="true" aria-live="polite" className="flex flex-col gap-4">
      <p className="sr-only">Carregando o pré-cadastro deste parceiro.</p>
      <div className="flex flex-wrap items-center gap-2">
        <Skeleton className="h-5 w-32 rounded-full" />
        <Skeleton className="h-5 w-40 rounded-full" />
      </div>
      <div className="flex flex-col gap-2">
        <Skeleton className="h-3.5 w-64" />
        <Skeleton className="h-3.5 w-48" />
      </div>
      <Skeleton className="h-11 w-52 rounded-lg md:h-9" />
    </div>
  );
}

/** Falhou: o que aconteceu e o que fazer, sem texto cru do Postgres. */
export function ErroDoPainel({ causa, aoTentar }: { causa: string; aoTentar: () => void }) {
  return (
    <div className="flex flex-col items-start gap-3">
      <div className="space-y-1">
        <p className="text-sm font-medium">Não deu para carregar o pré-cadastro</p>
        <p className="max-w-prose text-sm text-muted-foreground">
          {causa} Confira a conexão e tente de novo. Se continuar, avise no grupo do time.
        </p>
      </div>
      <Button variant="outline" onClick={aoTentar} className="toque h-11 md:h-9">
        <RotateCw aria-hidden="true" />
        Tentar de novo
      </Button>
    </div>
  );
}
