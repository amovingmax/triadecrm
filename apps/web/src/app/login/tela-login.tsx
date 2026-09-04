'use client';

import { motion, type Transition } from 'motion/react';

import { useMovimento } from '@/components/movimento';
import { MarcaK } from '@/components/logo';
import { cn } from '@/lib/utils';

import { BotaoGoogle } from './botao-google';
import { EscadaTermica, VazamentoTermico } from './escada-termica';
import type { AvisoAcesso } from './avisos';

const CURVA: Transition['ease'] = [0.22, 0.61, 0.36, 1];

/**
 * Nota de contraste: --muted-foreground é calibrado contra --background. Sobre o plano
 * do painel da tese (--muted) ele para em 4,48:1 e reprova o AA de texto normal, então
 * a frase e o corpo do aviso grave usam a rampa de grafite direto (o escape previsto no
 * globals.css): 5,8:1 no claro e 5,2:1 no escuro. O botão primário é tinta sobre papel
 * nos dois modos, acima de 15:1.
 */

/** Sequência orquestrada de entrada: a escada sobe primeiro, o texto chega atrás dela. */
const ATRASO_BASE = 0.34;
const PASSO = 0.08;

export function TelaLogin({ next, aviso }: { next: string; aviso: AvisoAcesso | null }) {
  const { reduzido } = useMovimento();

  /** Entrada de um bloco de texto na ordem de leitura. Roda uma vez, e só uma. */
  function entrada(indice: number) {
    if (reduzido) return {};
    return {
      initial: { opacity: 0, y: 10 },
      animate: { opacity: 1, y: 0 },
      transition: { duration: 0.42, delay: ATRASO_BASE + indice * PASSO, ease: CURVA },
    } as const;
  }

  return (
    <main className="relative flex min-h-svh flex-1 flex-col lg:grid lg:grid-cols-[1.15fr_1fr]">
      <EscadaTermica />

      {/* Painel da tese. No desktop é o lado largo e o conteúdo encosta embaixo:
          a composição sobe da escada, não flutua no meio da tela. */}
      <section className="relative overflow-hidden bg-muted px-7 pt-16 pb-14 sm:px-12 lg:flex lg:flex-col lg:justify-end lg:px-16 lg:py-20">
        <VazamentoTermico />

        <div className="relative">
          <motion.div {...entrada(0)}>
            <MarcaK className="size-9 lg:size-11" />
          </motion.div>

          <motion.h1
            {...entrada(1)}
            className="mt-7 text-4xl leading-[1.05] font-semibold tracking-tight sm:text-5xl lg:text-6xl"
          >
            KOMUNE <span className="font-normal text-muted-foreground">CRM</span>
          </motion.h1>

          <motion.p
            {...entrada(2)}
            className="mt-5 max-w-[32ch] text-base text-balance text-grafite-600 sm:text-lg dark:text-grafite-400"
          >
            Leva o fornecedor de evento do primeiro contato ao perfil publicado.
          </motion.p>
        </div>
      </section>

      {/* Painel da ação. Alinhado à esquerda do próprio painel, nunca centralizado:
          o olho desce da frase para o botão sem atravessar a tela. */}
      <section className="flex flex-1 items-center bg-background px-7 py-14 sm:px-12 lg:border-l lg:border-border lg:px-16 lg:py-20">
        <div className="w-full max-w-sm">
          {aviso ? (
            <motion.div
              {...entrada(3)}
              role="alert"
              className={cn(
                'mb-7 rounded-xl border p-4',
                aviso.grave ? 'border-transparent bg-quente-fundo' : 'border-border bg-card',
              )}
            >
              <p
                className={cn(
                  'text-sm font-medium',
                  aviso.grave ? 'text-quente-texto' : 'text-foreground',
                )}
              >
                {aviso.titulo}
              </p>
              <p
                className={cn(
                  'mt-1.5 text-sm',
                  aviso.grave ? 'text-grafite-700 dark:text-grafite-300' : 'text-muted-foreground',
                )}
              >
                {aviso.saida}
              </p>
            </motion.div>
          ) : null}

          <motion.div {...entrada(aviso ? 4 : 3)}>
            <BotaoGoogle next={next} rotulo={aviso?.rotuloBotao} />
          </motion.div>

          {aviso ? null : (
            <motion.p {...entrada(4)} className="mt-5 text-xs text-muted-foreground">
              Acesso restrito ao time da KOMUNE.
            </motion.p>
          )}
        </div>
      </section>
    </main>
  );
}
