'use client';

import { motion } from 'motion/react';

import { useMovimento } from '@/components/movimento';
import { TEMPERATURAS_EM_ORDEM } from '@/components/temperatura';
import { cn } from '@/lib/utils';

/**
 * Escada térmica: o elemento-assinatura do produto na escala da página inteira.
 *
 * Na lista, cada linha carrega UM segmento da escala (a barra de 3px na borda
 * esquerda, na cor da temperatura daquele negócio). Aqui, na única tela de vitrine
 * do CRM, a mesma barra aparece inteira e de uma vez: frio embaixo, cliente ativo
 * em cima. É literalmente o que a ferramenta faz, desenhado com o token que o app
 * usa todo dia, e não um gradiente bonito qualquer.
 *
 * A entrada sobe de baixo para cima (escalonada pela ordem do enum no Postgres),
 * porque a subida é a tese da tela. Roda uma vez e para: nada de laço infinito.
 */
export function EscadaTermica({ className }: { className?: string }) {
  const { reduzido } = useMovimento();

  return (
    <div
      className={cn(
        'pointer-events-none absolute inset-y-0 left-0 z-10 flex w-1 flex-col lg:w-1.5',
        className,
      )}
      role="img"
      aria-label="Escala térmica do CRM, do contato frio ao parceiro publicado."
    >
      {[...TEMPERATURAS_EM_ORDEM].reverse().map((definicao) => (
        <motion.span
          key={definicao.valor}
          className="flex-1"
          style={{ backgroundColor: definicao.cor, transformOrigin: 'bottom' }}
          initial={reduzido ? false : { scaleY: 0 }}
          animate={reduzido ? undefined : { scaleY: 1 }}
          transition={{
            duration: 0.5,
            delay: (definicao.ordem - 1) * 0.09,
            ease: [0.22, 0.61, 0.36, 1],
          }}
        />
      ))}
    </div>
  );
}

/**
 * Vazamento de cor da escada para dentro do painel da tese: a mesma sequência de
 * cinco cores, em 6% a 9%, dissolvida para a direita. Existe para amarrar a barra
 * ao plano (sem ela a escada vira um risco solto na borda), não para "dar vida".
 */
export function VazamentoTermico() {
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute inset-0"
      style={{
        backgroundImage: [
          'linear-gradient(to top,',
          'color-mix(in oklab, var(--frio) 9%, transparent) 0%,',
          'color-mix(in oklab, var(--morno) 6%, transparent) 30%,',
          'color-mix(in oklab, var(--quente) 7%, transparent) 55%,',
          'color-mix(in oklab, var(--cliente) 7%, transparent) 80%,',
          'color-mix(in oklab, var(--cliente-ativo) 9%, transparent) 100%)',
        ].join(' '),
        maskImage: 'linear-gradient(to right, black 0%, transparent 70%)',
        WebkitMaskImage: 'linear-gradient(to right, black 0%, transparent 70%)',
      }}
    />
  );
}
