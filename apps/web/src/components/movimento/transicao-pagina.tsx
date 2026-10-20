'use client';

import { useLayoutEffect, useRef } from 'react';
import { usePathname } from 'next/navigation';

import { cn } from '@/lib/utils';

/**
 * Troca de página dentro do app: opacidade mais 2px de subida. A justificativa é
 * de orientação, não de enfeite: confirma que a navegação aconteceu quando o
 * conteúdo novo é parecido com o anterior (uma lista trocando por outra lista).
 *
 * Sem AnimatePresence de propósito: animação de saída atrasaria o conteúdo novo.
 */
export function TransicaoPagina({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  const caminho = usePathname();
  const bloco = useRef<HTMLDivElement>(null);
  const primeiro = useRef(true);

  // A entrada é toda do CSS (`entrada-pagina`, em `globals.css`, com o porquê de
  // ter saído do `motion`: até 29/09/2026 o CRM ficava em branco para quem usa
  // "reduzir movimento").
  //
  // Até 20/10/2026 ela rodava de novo por um `key` no caminho, que REMONTAVA tudo
  // o que está aqui dentro: os layouts das seções e, com eles, o cache de consultas
  // (ver `consultas/provedor-consultas.tsx`). Agora a mesma animação de CSS é só
  // reiniciada: tirar a classe, forçar um cálculo de layout e devolver a classe.
  // Continua sendo CSS, então continua valendo a regra de movimento reduzido e o
  // `backwards` que solta o `position: fixed` no fim (`globals-fundo.test.ts`).
  // Na primeira montagem a classe do servidor já anima sozinha.
  useLayoutEffect(() => {
    if (primeiro.current) {
      primeiro.current = false;
      return;
    }
    const el = bloco.current;
    if (!el) return;
    el.classList.remove('entrada-pagina');
    void el.offsetWidth;
    el.classList.add('entrada-pagina');
  }, [caminho]);

  return (
    <div ref={bloco} className={cn('entrada-pagina', className)}>
      {children}
    </div>
  );
}
