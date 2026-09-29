'use client';

import { usePathname } from 'next/navigation';

import { cn } from '@/lib/utils';



/**
 * Troca de página dentro do app: opacidade mais 2px de subida. A justificativa é
 * de orientação, não de enfeite: confirma que a navegação aconteceu quando o
 * conteúdo novo é parecido com o anterior (uma lista trocando por outra lista).
 *
 * O `key` no caminho remonta o bloco a cada rota, que é o que dispara a entrada.
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
  // `key` no caminho remonta a div a cada troca de página, e é isso que faz a
  // animação de CSS rodar de novo. Nada mais depende de estado do cliente: o
  // HTML do servidor e o do navegador são idênticos, e a entrada é toda do CSS
  // (`entrada-pagina`, em `globals.css`, com o porquê de ter saído do
  // `motion`). Até 29/09/2026 isto deixava o CRM em branco para quem usa
  // "reduzir movimento".
  return (
    <div key={caminho} className={cn('entrada-pagina', className)}>
      {children}
    </div>
  );
}
