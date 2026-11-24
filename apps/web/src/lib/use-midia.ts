'use client';

import { useSyncExternalStore } from 'react';

/**
 * Se a consulta de mídia vale agora (ex.: `(min-width: 640px)`), acompanhando a
 * mudança de tamanho. No servidor responde `false`: quem usa isto decide coisas
 * que só aparecem depois de um toque (uma folha, um menu), nunca o primeiro quadro.
 */
export function useMidia(consulta: string): boolean {
  return useSyncExternalStore(
    (avisar) => {
      const m = window.matchMedia(consulta);
      m.addEventListener('change', avisar);
      return () => m.removeEventListener('change', avisar);
    },
    () => window.matchMedia(consulta).matches,
    () => false,
  );
}
