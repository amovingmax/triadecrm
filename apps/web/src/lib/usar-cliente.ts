'use client';

import { useSyncExternalStore } from 'react';

/**
 * Duas leituras que só existem no navegador, feitas com `useSyncExternalStore`
 * em vez de `useState` mais `useEffect`: o React já entrega um valor para o
 * servidor e outro para o cliente, sem setState em efeito (que a regra
 * `react-hooks/set-state-in-effect` proíbe) e sem divergência de hidratação.
 */

/** Nada muda depois de montar, então não há a que se inscrever. Referência estável de propósito. */
const semInscricao = () => () => {};

const noServidor = () => false;
const noCliente = () => true;

/** `false` na renderização do servidor e no primeiro passe do cliente; `true` depois da hidratação. */
export function useMontado(): boolean {
  return useSyncExternalStore(semInscricao, noCliente, noServidor);
}

function lerTeclaMeta(): '⌘' | 'Ctrl' {
  return /Mac|iPhone|iPad/i.test(navigator.userAgent) ? '⌘' : 'Ctrl';
}

const semTeclaMeta = () => null;

/** Tecla modificadora deste aparelho para a dica do atalho; `null` até a hidratação. */
export function useTeclaMeta(): '⌘' | 'Ctrl' | null {
  return useSyncExternalStore(semInscricao, lerTeclaMeta, semTeclaMeta);
}
