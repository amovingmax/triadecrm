'use client';

import { useReducedMotion } from 'motion/react';

/**
 * Centro do movimento do app. Toda animação passa por aqui para que a decisão
 * "quem pediu menos movimento não recebe movimento" fique em um lugar só.
 *
 * Regra do sistema: cada animação precisa de uma frase que a justifique.
 * Só animamos `transform` e `opacity`; nada de width, height, top ou left.
 */

/** Folha de cadastro rápido: entra por baixo no celular, pela lateral no desktop. */
export const MOLA_FOLHA = { type: 'spring', stiffness: 260, damping: 30 } as const;

/** Substituta da mola quando o sistema pede menos movimento: chega pronta. */
export const SEM_MOLA = { duration: 0 } as const;

/** Troca de página dentro do app: opacidade mais 2px, curto o bastante para não atrasar. */
export const TRANSICAO_PAGINA = { duration: 0.18, ease: [0.22, 0.61, 0.36, 1] } as const;

/** Entrada escalonada da lista: os primeiros resultados chegam primeiro. */
export const ESCALONAMENTO = {
  /** 15ms entre uma linha e a seguinte. */
  atrasoPorItem: 0.015,
  /** Acima de 24 linhas o escalonamento vira espera; da 25 em diante todas entram juntas. */
  maximoItens: 24,
  /** Duração da entrada de cada linha. */
  duracao: 0.22,
} as const;

/** Deslocamento vertical padrão das entradas, em pixels. */
export const DESLOCAMENTO_ENTRADA = 4;

/**
 * O nome do arquivo é `usar-movimento`, mas a função se chama `useMovimento`:
 * a regra `react-hooks/rules-of-hooks` só reconhece um hook pelo prefixo `use`.
 */
export function useMovimento() {
  const reduzido = useReducedMotion() ?? false;

  return {
    /** `true` quando o sistema pede menos movimento (prefers-reduced-motion). */
    reduzido,
    /** Mola da folha, já neutralizada quando o movimento é reduzido. */
    mola: reduzido ? SEM_MOLA : MOLA_FOLHA,
    /** Transição de troca de página, já neutralizada quando o movimento é reduzido. */
    transicaoPagina: reduzido ? SEM_MOLA : TRANSICAO_PAGINA,
    /** Constantes do escalonamento da lista. */
    escalonamento: ESCALONAMENTO,
    /** Deslocamento de entrada: zero quando o movimento é reduzido. */
    deslocamento: reduzido ? 0 : DESLOCAMENTO_ENTRADA,
    /** Atraso da linha de índice `indice`, em segundos. */
    atrasoDaLinha(indice: number) {
      if (reduzido || indice >= ESCALONAMENTO.maximoItens) return 0;
      return indice * ESCALONAMENTO.atrasoPorItem;
    },
  };
}
