'use client';

import { cn } from '@/lib/utils';

/**
 * As duas navegações internas da Admin.
 *
 * `SeletorDeAba` é o primeiro nível (Pessoas · Catálogos · LGPD): três destinos que
 * não se parecem, então ganham a forma de um segmentado, com a aba ativa em relevo.
 * `ChipsDeSecao` é o segundo nível (as seis listas de catálogo, os quatro registros de
 * LGPD): muitos destinos parecidos, que pedem uma faixa de pílulas com a contagem ao
 * lado do nome — a contagem é o que diferencia "Feriados" de "Modelos" antes do clique.
 *
 * Nenhum dos dois usa cor: quem está ativo se diz por contraste de superfície e peso,
 * porque a única cromia do produto é a escala térmica e aqui não há temperatura.
 *
 * Ambos são `<button>` de verdade dentro de um `role="tablist"`: navegam por teclado,
 * anunciam o estado e cumprem 44px de alvo no celular.
 */

export function SeletorDeAba<T extends string>({
  itens,
  ativo,
  aoTrocar,
  rotulo,
}: {
  itens: readonly { id: T; rotulo: string }[];
  ativo: T;
  aoTrocar: (id: T) => void;
  rotulo: string;
}) {
  return (
    <div
      role="tablist"
      aria-label={rotulo}
      className="flex w-full gap-1 rounded-lg bg-muted/60 p-1 md:w-fit"
    >
      {itens.map((item) => {
        const selecionado = item.id === ativo;
        return (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={selecionado}
            onClick={() => aoTrocar(item.id)}
            className={cn(
              'toque h-11 flex-1 rounded-md px-4 text-sm font-medium transition-colors md:h-8 md:flex-none',
              'focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none',
              selecionado
                ? 'bg-background text-foreground sombra-base'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {item.rotulo}
          </button>
        );
      })}
    </div>
  );
}

export function ChipsDeSecao<T extends string>({
  itens,
  ativo,
  aoTrocar,
  rotulo,
}: {
  itens: readonly { id: T; rotulo: string; contagem?: number }[];
  ativo: T;
  aoTrocar: (id: T) => void;
  rotulo: string;
}) {
  return (
    <div role="tablist" aria-label={rotulo} className="flex flex-wrap gap-2">
      {itens.map((item) => {
        const selecionado = item.id === ativo;
        return (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={selecionado}
            onClick={() => aoTrocar(item.id)}
            className={cn(
              'toque flex h-11 items-center gap-1.5 rounded-full border px-3.5 text-sm transition-colors md:h-8',
              'focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none',
              selecionado
                ? 'border-transparent bg-foreground text-background'
                : 'border-hairline text-muted-foreground hover:text-foreground',
            )}
          >
            {item.rotulo}
            {item.contagem === undefined ? null : (
              <span className={cn('numerico text-xs', !selecionado && 'text-muted-foreground')}>
                {item.contagem}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
