'use client';

import { createContext, useContext, useEffect, useRef, type CSSProperties } from 'react';
import { motion } from 'motion/react';

import { cn } from '@/lib/utils';

import { DESLOCAMENTO_ENTRADA, ESCALONAMENTO, useMovimento } from './usar-movimento';

/**
 * Entrada escalonada da lista. A justificativa: quando a busca devolve resultados,
 * os primeiros chegam primeiro, e o olho aprende que a lista tem ordem. Passada a
 * primeira renderização a animação se desliga, para que ordenar uma coluna ou
 * carregar mais linhas não faça a tabela inteira piscar de novo.
 *
 * Uso na tabela (a linha é uma <tr>, então o escalonamento vai por CSS):
 *
 *   <RevelarLista>
 *     <table>{linhas.map((l, i) => <Linha key={l.id} indice={i} />)}</table>
 *   </RevelarLista>
 *
 *   function Linha({ indice }) {
 *     const revelar = useRevelarLinha(indice);
 *     return <tr {...revelar}>...</tr>;
 *   }
 *
 * Em lista de cartões, use <RevelarItem indice={i}> direto.
 */

interface ContextoRevelar {
  deveRevelar: (indice: number) => boolean;
}

const RevelarContexto = createContext<ContextoRevelar | null>(null);

export function RevelarLista({ children }: { children: React.ReactNode }) {
  const { reduzido } = useMovimento();
  const jaRevelou = useRef(false);

  useEffect(() => {
    // Desliga depois que a primeira leva terminou de entrar. O tempo é o da última
    // linha animada (24ª) mais a duração dela; nada re-renderiza no meio do caminho.
    const total =
      (ESCALONAMENTO.duracao + ESCALONAMENTO.maximoItens * ESCALONAMENTO.atrasoPorItem) * 1000;
    const relogio = window.setTimeout(() => {
      jaRevelou.current = true;
    }, total);
    return () => window.clearTimeout(relogio);
  }, []);

  return (
    <RevelarContexto.Provider
      value={{
        deveRevelar: (indice) =>
          !reduzido && !jaRevelou.current && indice >= 0 && indice < ESCALONAMENTO.maximoItens,
      }}
    >
      {children}
    </RevelarContexto.Provider>
  );
}

/**
 * Devolve `className` e `style` para espalhar em qualquer elemento (inclusive <tr>,
 * que não aceita um wrapper). Fora de <RevelarLista> não anima nada, de propósito.
 */
export function useRevelarLinha(indice: number): { className?: string; style?: CSSProperties } {
  const contexto = useContext(RevelarContexto);
  if (!contexto?.deveRevelar(indice)) return {};

  return {
    className: 'revelar-linha',
    style: { animationDelay: `${Math.round(indice * ESCALONAMENTO.atrasoPorItem * 1000)}ms` },
  };
}

/** Versão em componente, para listas de cartões e outros blocos que aceitam uma <div>. */
export function RevelarItem({
  indice,
  className,
  children,
}: {
  indice: number;
  className?: string;
  children?: React.ReactNode;
}) {
  const contexto = useContext(RevelarContexto);
  const anima = contexto?.deveRevelar(indice) ?? false;

  if (!anima) return <div className={className}>{children}</div>;

  return (
    <motion.div
      className={cn(className)}
      initial={{ opacity: 0, y: DESLOCAMENTO_ENTRADA }}
      animate={{ opacity: 1, y: 0 }}
      transition={{
        duration: ESCALONAMENTO.duracao,
        delay: indice * ESCALONAMENTO.atrasoPorItem,
        ease: [0.22, 0.61, 0.36, 1],
      }}
    >
      {children}
    </motion.div>
  );
}
