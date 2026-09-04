'use client';

import { useCallback, useSyncExternalStore } from 'react';

import {
  CHAVE_ULTIMA_SUPERFICIE,
  SUPERFICIE_PADRAO,
  SUPERFICIES_DO_REGISTRO,
  type Superficie,
} from './tipos';

/**
 * O último canal que ela usou, guardado no aparelho.
 *
 * Quem passa a manhã visitando registra visita atrás de visita: o chip certo já
 * selecionado é um toque a menos vezes trinta. Como isso vive fora do React
 * (`localStorage`), a leitura é um `useSyncExternalStore` e não um `useState` com
 * efeito: o servidor renderiza o padrão, o cliente lê o aparelho, e não há setState
 * em efeito nem divergência de hidratação.
 */

const ouvintes = new Set<() => void>();

function inscrever(ouvinte: () => void): () => void {
  ouvintes.add(ouvinte);
  return () => {
    ouvintes.delete(ouvinte);
  };
}

/**
 * Devolve sempre a MESMA string primitiva para o mesmo valor guardado, que é o que o
 * `useSyncExternalStore` exige do `getSnapshot` para não redesenhar em laço.
 */
function noAparelho(): Superficie {
  try {
    const guardado = window.localStorage.getItem(CHAVE_ULTIMA_SUPERFICIE);
    if (guardado && (SUPERFICIES_DO_REGISTRO as readonly string[]).includes(guardado)) {
      return guardado as Superficie;
    }
  } catch {
    // Aba anônima, cota cheia ou armazenamento bloqueado: vale o padrão.
  }
  return SUPERFICIE_PADRAO;
}

const noServidor = (): Superficie => SUPERFICIE_PADRAO;

export function useUltimaSuperficie(): [Superficie, (nova: Superficie) => void] {
  const atual = useSyncExternalStore(inscrever, noAparelho, noServidor);

  const guardar = useCallback((nova: Superficie) => {
    try {
      window.localStorage.setItem(CHAVE_ULTIMA_SUPERFICIE, nova);
    } catch {
      // Sem armazenamento a preferência não persiste; a tela continua funcionando.
    }
    for (const ouvinte of ouvintes) ouvinte();
  }, []);

  return [atual, guardar];
}
