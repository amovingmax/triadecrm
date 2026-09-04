'use client';

import { useEffect, useState } from 'react';

/**
 * `true` abaixo do breakpoint `md` do Tailwind (768px).
 *
 * A tela de funis precisa disso em JavaScript, e não em classe CSS, por uma decisão
 * do contrato: **no celular não existe quadro**. Doze e catorze colunas não cabem em
 * 390px, e arrastar cartão dentro de uma lista que rola verticalmente disputa o gesto
 * de rolagem de quem está de pé, na rua, com uma mão só. Abaixo de `md` a folha de
 * mover entra por baixo (o polegar alcança) e o quadro vira trilha de etapas + lista.
 * Esconder um dos dois com `hidden` montaria os dois no HTML.
 *
 * Começa em `false` e só decide depois de montar, para o HTML do servidor e o do
 * cliente serem iguais na primeira renderização.
 */
export function useTelaPequena(): boolean {
  const [pequena, setPequena] = useState(false);

  useEffect(() => {
    const consulta = window.matchMedia('(max-width: 767px)');
    const aplicar = () => setPequena(consulta.matches);
    aplicar();
    consulta.addEventListener('change', aplicar);
    return () => consulta.removeEventListener('change', aplicar);
  }, []);

  return pequena;
}
