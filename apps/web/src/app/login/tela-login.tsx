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
 * Login: a única superfície de vitrine do CRM, e por isso a única que recebe o
 * acabamento inteiro do template (pílula de eyebrow, título em gradiente, brilho
 * radial em CSS, ação em gradiente). Tudo isso sai de utilitário do globals.css,
 * nenhum valor é escrito à mão aqui.
 *
 * Quatro elementos de texto, no máximo: a pílula, o título, a frase e, quando o
 * acesso falha, o aviso, que diz o que aconteceu e o que fazer. A pílula absorveu
 * a nota de "acesso restrito" que antes ficava embaixo do botão, então o eyebrow
 * entrou sem somar peso à tela.
 *
 * Contraste, medido nos dois modos: o título em gradiente para no pior pixel
 * (a parada de 60%) em 6,6:1 no escuro e 4,6:1 no claro sobre o painel `muted`,
 * acima do AA de texto normal mesmo sendo texto grande. O corpo usa a rampa de
 * grafite direto (o escape previsto no globals.css) porque --muted-foreground é
 * calibrado contra --background e sobre o painel `muted` ele para em 4,48:1:
 * assim a frase fica em 6,8:1 no claro e 6,3:1 no escuro. O texto do botão sobre
 * o gradiente de ação fica em 8:1 no escuro e 4,7:1 no claro.
 */

/** Entrada: fade de 600ms do template, escalonado na ordem de leitura, uma vez só. */
const DURACAO_ENTRADA = 0.6;
const ATRASO_BASE = 0.18;
const PASSO = 0.07;

export function TelaLogin({ next, aviso }: { next: string; aviso: AvisoAcesso | null }) {
  const { reduzido } = useMovimento();

  /** Fade de um bloco na ordem de leitura. Roda uma vez, e só uma. */
  function entrada(indice: number) {
    if (reduzido) return {};
    return {
      initial: { opacity: 0 },
      animate: { opacity: 1 },
      transition: { duration: DURACAO_ENTRADA, delay: ATRASO_BASE + indice * PASSO, ease: CURVA },
    } as const;
  }

  return (
    // min-h-[100dvh], nunca h-screen: a barra de endereço do iOS come 60px e o
    // botão sairia da tela justamente no celular, que é onde o time entra.
    <main className="relative flex min-h-[100dvh] flex-1 flex-col lg:grid lg:grid-cols-[1.15fr_1fr]">
      <EscadaTermica />

      {/* Painel da tese. No desktop é o lado largo e o conteúdo encosta embaixo:
          a composição sobe da escada, não flutua no meio da tela. */}
      <section className="relative overflow-hidden bg-muted px-7 pt-16 pb-14 sm:px-12 lg:flex lg:flex-col lg:justify-end lg:px-16 lg:py-20">
        <VazamentoTermico />
        {/* Brilho do herói: gradiente radial em CSS, sem cromia e sem imagem de
            CDN. Vem de cima; o vazamento térmico vem da esquerda. Um é a luz,
            o outro é a cor do produto, e por isso não brigam. */}
        <div aria-hidden="true" className="brilho-radial pointer-events-none absolute inset-0" />

        <div className="relative">
          <motion.div {...entrada(0)}>
            {/* Tinta cheia, não esmaecida: sobre a pílula sobre o painel, no ponto mais forte
                do brilho radial, o esmaecido do claro para em 4,40:1. E o eyebrow é para ser
                lido, não para sumir. */}
            <span className="pilula inline-flex items-center gap-2 py-1.5 pr-3.5 pl-1.5 text-xs text-foreground">
              <MarcaK className="size-5" />
              Acesso restrito ao time
            </span>
          </motion.div>

          <motion.h1
            {...entrada(1)}
            className="titulo-gradiente mt-7 text-4xl leading-[1.05] font-medium sm:text-5xl lg:text-6xl"
          >
            KOMUNE CRM
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
        </div>
      </section>
    </main>
  );
}
