'use client';

import { useState } from 'react';

/**
 * Centro do movimento do app. Toda animação passa por aqui para que a decisão
 * "quem pediu menos movimento não recebe movimento" fique em um lugar só.
 *
 * Regra do sistema: cada animação precisa de uma frase que a justifique.
 * Só animamos `transform` e `opacity`; nada de width, height, top ou left.
 *
 * Desde 20/10/2026 as animações das telas de trabalho são de CSS (`globals.css`:
 * `entrada-pagina`, `revelar-linha`, `entrada-folha`, `crescer-barra`), e a regra
 * de movimento reduzido do fim daquele arquivo vale para todas. O `motion` ficou só
 * no login: perguntar "reduzir movimento?" pelo `useReducedMotion` dele levava a
 * biblioteca inteira (39 KB comprimidos) para toda página do CRM.
 */

/**
 * Entrada escalonada da lista: os primeiros resultados chegam primeiro.
 *
 * Encurtada em 21/10/2026 (eram 15 ms, 24 linhas e 220 ms): a lista inteira assenta
 * em ~150 ms, e cada linha já nasce legível (`revelar-linha`, em `globals.css`).
 */
export const ESCALONAMENTO = {
  /** 4ms entre uma linha e a seguinte. */
  atrasoPorItem: 0.004,
  /** Acima de 8 linhas o escalonamento vira espera; da 9ª em diante todas entram juntas. */
  maximoItens: 8,
  /** Duração da entrada de cada linha (a mesma do `revelar-linha` do CSS). */
  duracao: 0.12,
} as const;

const CONSULTA = '(prefers-reduced-motion: reduce)';

function lerPreferencia(): boolean | null {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return null;
  return window.matchMedia(CONSULTA).matches;
}

/**
 * O sistema pediu menos movimento? Faz o que o `useReducedMotion` do `motion` fazia:
 * lê a preferência na primeira renderização do navegador (no servidor, `null`) e a
 * guarda. Mesmo valor, mesmo instante, sem a biblioteca.
 */
export function useMovimentoReduzido(): boolean | null {
  const [reduzido] = useState(lerPreferencia);
  return reduzido;
}

/**
 * O nome do arquivo é `usar-movimento`, mas a função se chama `useMovimento`:
 * a regra `react-hooks/rules-of-hooks` só reconhece um hook pelo prefixo `use`.
 */
export function useMovimento() {
  const reduzido = useMovimentoReduzido() ?? false;
  return {
    /** `true` quando o sistema pede menos movimento (prefers-reduced-motion). */
    reduzido,
  };
}
