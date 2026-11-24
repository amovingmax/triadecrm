'use client';

import { type ReactNode, useEffect, useRef } from 'react';

import { cn } from '@/lib/utils';

/**
 * Uma linha de chips (ou etapas, ou abas) que rola de lado quando não cabe, em vez
 * de quebrar em duas ou três linhas e empurrar o conteúdo para baixo da dobra
 * (protótipo responsivo da Imova, 24/11/2026). O esmaecido na borda direita diz
 * que há mais; com `sangria` a linha vai até a borda da página.
 *
 * O item ativo (`aria-pressed`, `aria-selected` ou `aria-current`) fica à vista: ao
 * montar e a cada troca de `ativo`, a faixa rola só o necessário. Não é
 * `scrollIntoView`, que também rolaria a página na vertical.
 */
export function FaixaDeslizante({
  rotulo,
  ativo,
  sangria = false,
  className,
  children,
}: {
  /** O nome do grupo para o leitor de tela ("Situação", "Etapa"). */
  rotulo: string;
  /** Muda quando o item ativo muda; serve só para trazê-lo à vista. */
  ativo?: string | number | null;
  /** Vai até a borda da página (anula a margem do conteúdo). */
  sangria?: boolean;
  className?: string;
  children: ReactNode;
}) {
  const faixa = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const trilho = faixa.current;
    if (!trilho || trilho.scrollWidth <= trilho.clientWidth) return;
    const item = trilho.querySelector<HTMLElement>(
      '[aria-pressed="true"], [aria-selected="true"], [aria-current="true"], [aria-current="page"]',
    );
    if (!item) return;
    const t = trilho.getBoundingClientRect();
    const a = item.getBoundingClientRect();
    const folga = 24;
    if (a.left < t.left + folga) trilho.scrollLeft -= t.left - a.left + folga;
    else if (a.right > t.right - folga) trilho.scrollLeft += a.right - t.right + folga;
  }, [ativo]);

  return (
    <div
      ref={faixa}
      role="group"
      aria-label={rotulo}
      className={cn('faixa-deslizante', sangria && 'faixa-sangria', className)}
    >
      {children}
    </div>
  );
}
