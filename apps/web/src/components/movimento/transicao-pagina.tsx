'use client';

import { usePathname } from 'next/navigation';
import { motion } from 'motion/react';

import { DESLOCAMENTO_ENTRADA, useMovimento } from './usar-movimento';

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
  const { reduzido, transicaoPagina } = useMovimento();

  if (reduzido) return <div className={className}>{children}</div>;

  return (
    <motion.div
      key={caminho}
      className={className}
      initial={{ opacity: 0, y: DESLOCAMENTO_ENTRADA / 2 }}
      animate={{ opacity: 1, y: 0 }}
      transition={transicaoPagina}
    >
      {children}
    </motion.div>
  );
}
