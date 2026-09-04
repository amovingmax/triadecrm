'use client';

import { motion, type Transition } from 'motion/react';

import { useMovimento } from '@/components/movimento';
import { MarcaTriade } from '@/components/logo';
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
 * COMPOSIÇÃO. A tela tem duas colunas no desktop e uma só no celular, e as duas
 * regras abaixo são o que faz os dois lados se encontrarem:
 *
 * 1. Uma âncora só. As duas colunas são `lg:justify-end` com o mesmo `lg:py-20`,
 *    então a frase da tese e o bloco da ação FECHAM na mesma linha de base. Antes
 *    a tese encostava no rodapé e a ação ficava centrada no próprio painel: 269px
 *    entre os centros ópticos, e o olho tinha de subir a tela para achar o botão.
 *    Agora ele atravessa a costura na horizontal, que é o que esta tela quer.
 *
 * 2. Abaixo de `lg` não existe esquerda e direita, então também não existe segunda
 *    superfície: o fundo, o brilho e o vazamento térmico saem da coluna da tese e
 *    passam para uma camada que cobre a tela inteira no celular e exatamente a
 *    coluna da tese no desktop (mesma grade, sem número mágico). As sections ficam
 *    transparentes e o conteúdo vira um bloco só (pílula, título, frase, botão,
 *    nota), centrado, com o vazio virando margem em cima e embaixo em vez de um
 *    buraco de 310px entre a última palavra e o único botão.
 *
 * TEXTO. Quatro elementos, no máximo. A pílula, o título, a frase e uma quarta
 * peça que explica o acesso: a nota de rodapé quando a entrada é normal, o aviso
 * quando ela falhou. As duas nunca aparecem juntas, porque o aviso já diz o que a
 * nota diria e com mais precisão. É essa quarta peça que dá corpo ao painel da
 * ação: sozinho, o botão era 2% de tinta num campo de 670x900.
 *
 * Contraste, medido nos dois modos: o título em gradiente para no pior pixel
 * (a parada de 60%) em 6,6:1 no escuro e 4,6:1 no claro sobre o painel `muted`,
 * acima do AA de texto normal mesmo sendo texto grande. O corpo usa a rampa de
 * grafite direto (o escape previsto no globals.css) porque --muted-foreground é
 * calibrado contra --background e sobre o painel `muted` ele para em 4,48:1:
 * assim a frase fica em 6,8:1 no claro e 6,3:1 no escuro, e a nota, um degrau
 * abaixo, em 4,6:1 no claro e 4,7:1 no escuro. O texto do botão sobre o gradiente
 * de ação fica em 8:1 no escuro e 4,7:1 no claro.
 */

/** Entrada: fade de 600ms do template, escalonado na ordem de leitura, uma vez só. */
const DURACAO_ENTRADA = 0.6;
const ATRASO_BASE = 0.18;
const PASSO = 0.07;

/** A mesma grade da `<main>`, repetida na camada de fundo. Uma constante para as
 *  duas: se a proporção mudar, o fundo não pode ficar para trás do conteúdo. */
const GRADE = 'lg:grid-cols-[1.15fr_1fr]';

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
    // `justify-center` só vale no empilhamento do celular; em `lg` a mesma
    // propriedade alinharia as COLUNAS do grid, por isso o `lg:justify-normal`.
    <main
      className={cn(
        'relative flex min-h-[100dvh] flex-1 flex-col justify-center py-14 lg:grid lg:justify-normal lg:py-0',
        GRADE,
      )}
    >
      {/* Camada de fundo. No celular é uma superfície só, do topo ao rodapé; no
          desktop ela repete a grade da <main>, então a costura entre os dois
          planos cai exatamente na divisa das colunas, sem porcentagem à mão.
          Fica antes das sections no DOM, e as sections são `relative`: o
          conteúdo pinta por cima sem precisar de z-index. */}
      <div aria-hidden="true" className={cn('pointer-events-none absolute inset-0 grid', GRADE)}>
        <div className="relative overflow-hidden bg-muted">
          <VazamentoTermico />
          {/* Brilho do herói: gradiente radial em CSS, sem cromia e sem imagem de
              CDN. Vem de cima; o vazamento térmico vem da esquerda. Um é a luz,
              o outro é a cor do produto, e por isso não brigam. */}
          <div className="brilho-radial absolute inset-0" />
        </div>
        <div className="hidden bg-background lg:block lg:border-l lg:border-border" />
      </div>

      <EscadaTermica />

      {/* Painel da tese. No desktop é o lado largo e o conteúdo encosta embaixo:
          a composição sobe da escada, não flutua no meio da tela. */}
      <section className="relative px-7 sm:px-12 lg:flex lg:flex-col lg:justify-end lg:px-16 lg:py-20">
        <motion.div {...entrada(0)}>
          {/* Tinta cheia, não esmaecida: sobre a pílula sobre o painel, no ponto mais forte
              do brilho radial, o esmaecido do claro para em 4,40:1. E o eyebrow é para ser
              lido, não para sumir. */}
          <span className="pilula inline-flex items-center gap-2 py-1.5 pr-3.5 pl-1.5 text-xs text-foreground">
            <MarcaTriade className="size-5" />
            Acesso restrito ao time
          </span>
        </motion.div>

        <motion.h1
          {...entrada(1)}
          className="titulo-gradiente mt-7 text-4xl leading-[1.05] font-medium sm:text-5xl lg:text-6xl"
        >
          Tríade
        </motion.h1>

        <motion.p
          {...entrada(2)}
          className="mt-5 max-w-[32ch] text-base text-balance text-grafite-600 sm:text-lg dark:text-grafite-400"
        >
          {/* Espaço inquebrável entre "do" e "primeiro": o `text-balance` otimiza
              largura de linha, não sintaxe, e deixava a preposição pendurada no fim
              da primeira linha, longe do substantivo que ela rege. Com o NBSP a
              quebra passa a fechar sintagma nas duas larguras. */}
          {'Leva o fornecedor de evento do\u00A0primeiro contato ao perfil publicado.'}
        </motion.p>
      </section>

      {/* Painel da ação. Mesma âncora de base do painel da tese, alinhado à esquerda
          do próprio painel e nunca centralizado: o olho sai da frase e chega no botão
          sem subir a tela. A caixa tem a medida da frase do outro lado (max-w-sm, 384px,
          contra os 32ch da frase), então os dois blocos rimam de largura e de base. */}
      <section className="relative mt-10 px-7 sm:px-12 lg:mt-0 lg:flex lg:flex-col lg:justify-end lg:px-16 lg:py-20">
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

          {/* A saída, antes de o erro acontecer. Até agora esta informação só existia
              dentro do aviso de "e-mail sem acesso", ou seja, depois de a pessoa
              bater na porta fechada. Quando o aviso está na tela ela sai: ele já diz
              o mesmo, com o motivo real. Rampa de grafite direto e não
              --muted-foreground, porque no celular esta nota fica sobre o painel
              `muted`, onde o token para em 4,48:1. */}
          {aviso ? null : (
            <motion.p
              {...entrada(4)}
              className="mt-4 text-sm text-grafite-500 dark:text-grafite-450"
            >
              Entre com a conta Google do seu e-mail @komune.app.br. Se o seu acesso ainda não foi
              liberado, peça a Rafael, Luiz ou Matheus.
            </motion.p>
          )}
        </div>
      </section>
    </main>
  );
}
