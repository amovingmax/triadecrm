'use client';

import { useEffect, useState } from 'react';

/**
 * `true` abaixo do breakpoint `md` do Tailwind (768px).
 *
 * Existe para as decisões que o CSS não resolve sozinho: a folha de cadastro entra
 * por baixo no celular e pela lateral no desktop, e isso é uma prop do componente,
 * não uma classe. Começa em `false` e só decide depois de montar, para o HTML do
 * servidor e o do cliente serem iguais na primeira renderização.
 */
export function useEhCelular(): boolean {
  const [ehCelular, setEhCelular] = useState(false);

  useEffect(() => {
    const consulta = window.matchMedia('(max-width: 767px)');
    const aplicar = () => setEhCelular(consulta.matches);
    aplicar();
    consulta.addEventListener('change', aplicar);
    return () => consulta.removeEventListener('change', aplicar);
  }, []);

  return ehCelular;
}
