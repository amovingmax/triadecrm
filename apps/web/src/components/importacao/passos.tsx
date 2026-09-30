'use client';

import { Check } from 'lucide-react';

import { cn } from '@/lib/utils';

export type PassoDaImportacao = 'arquivo' | 'categorias' | 'conferir' | 'pronto';

const PASSOS: readonly { id: PassoDaImportacao; rotulo: string }[] = [
  { id: 'arquivo', rotulo: 'Arquivo' },
  { id: 'categorias', rotulo: 'Categorias' },
  { id: 'conferir', rotulo: 'Conferir' },
  { id: 'pronto', rotulo: 'Pronto' },
];

/**
 * Onde a pessoa está na importação (30/09/2026).
 *
 * A tela era uma pilha só: arquivo, origem, colunas, categorias, contagem,
 * lista e a barra de gravar, tudo de uma vez e tudo com o mesmo peso. Rafael:
 * "to entendendo nada e ta muito ruim e com bastante confusão". Com os passos à
 * vista, cada tela pergunta UMA coisa e diz quanto falta.
 *
 * "Categorias" aparece sempre, mesmo quando a lista não tem categoria nova:
 * nesse caso o passo já nasce feito. Um indicador que ganha e perde passos
 * conforme o arquivo seria mais uma coisa para entender.
 */
export function Passos({ atual }: { atual: PassoDaImportacao }) {
  const indiceAtual = PASSOS.findIndex((p) => p.id === atual);

  return (
    <ol aria-label="Passos da importação" className="flex items-center gap-1.5 sm:gap-2">
      {PASSOS.map((passo, indice) => {
        const feito = indice < indiceAtual;
        const ativo = indice === indiceAtual;
        return (
          <li
            key={passo.id}
            aria-current={ativo ? 'step' : undefined}
            className="flex min-w-0 items-center gap-1.5 sm:gap-2"
          >
            {indice > 0 ? (
              <span
                aria-hidden="true"
                className={cn('h-px w-4 shrink-0 sm:w-8', feito || ativo ? 'bg-foreground/30' : 'bg-border')}
              />
            ) : null}
            <span
              className={cn(
                'flex h-9 shrink-0 items-center gap-2 rounded-full p-1 text-sm transition-colors',
                ativo && 'bg-menta pr-3.5 font-medium text-menta-tinta',
                feito && 'sombra-base bg-card text-foreground sm:pr-3.5',
                !ativo && !feito && 'text-muted-foreground sm:pr-3.5',
              )}
            >
              <span
                className={cn(
                  'numerico flex size-7 shrink-0 items-center justify-center rounded-full text-xs',
                  ativo && 'bg-menta-tinta text-menta',
                  feito && 'bg-foreground text-background',
                  !ativo && !feito && 'bg-muted',
                )}
              >
                {feito ? <Check className="size-3.5" aria-hidden="true" /> : indice + 1}
              </span>
              {/* No celular só o passo atual mostra o nome: quatro pílulas com
                  rótulo não cabem em 390px, e o número basta para as outras. */}
              <span className={cn(ativo ? 'inline' : 'sr-only sm:not-sr-only')}>
                {passo.rotulo}
                {feito ? <span className="sr-only"> (feito)</span> : null}
              </span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}
