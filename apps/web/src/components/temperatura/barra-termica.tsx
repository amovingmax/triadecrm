'use client';

import { useReducedMotion } from 'motion/react';

import { cn } from '@/lib/utils';

import { definicaoTemperatura, type Temperatura } from './escala-termica';

/**
 * Barra térmica: o elemento-assinatura do CRM. Três pixels na borda esquerda de
 * cada linha, na cor da temperatura calculada pelo banco. Não tem raio de propósito,
 * para ler como marcação de margem, não como enfeite.
 *
 * Sobre a base Ocean Breeze (#0f172a no escuro, #f0f8ff no claro) as cinco cores
 * foram medidas de novo: o pior par é `cliente` contra o muted do claro, em 3,31:1,
 * e todos os outros ficam acima; nenhuma sumiu com a troca de paleta, então os
 * valores da escala continuam os mesmos.
 *
 * Quando o negócio está esfriando (`deals.needs_attention`: morno com mais de 7 dias
 * ou quente com mais de 5 dias sem contato), a barra DESTACA de três jeitos, os três
 * somando e nunca tirando:
 *
 * 1. a barra ENGROSSA de 3px para 6px, permanentemente. É o sinal, e é o único que
 *    não depende de movimento nem de preferência do sistema: 3px contra 6px é razão
 *    exata de 2, o par fina/grossa mais legível no sol e no escuro;
 * 2. um pulso lento de espessura por cima disso (6px que vai a ~11px e volta), nunca
 *    de opacidade: baixar o alfa apagaria justamente a linha que precisa ser vista
 *    (foi o que levou o âmbar a 1,40:1 no claro na primeira versão);
 * 3. um halo de 12px que se apaga para a direita, na própria cor da temperatura.
 *
 * O halo é DECORAÇÃO, não sinal: medido contra o fundo ele fica entre 1,53:1 e 1,74:1
 * no claro e entre 1,74:1 e 2,36:1 no escuro, longe dos 3:1 da WCAG 1.4.11. Foi por
 * isso que a espessura virou permanente: quem pediu menos movimento no sistema perde
 * o pulso (useReducedMotion, mais a rede de segurança em globals.css) e não pode ficar
 * dependendo do halo, e mesmo com movimento ligado o olhar de relance cai no vale do
 * ciclo, onde a barra media exatamente os mesmos 3px de uma linha normal.
 *
 * O conjunto cabe nos 12px do halo e os 16px de `pl-4` de quem usa a barra, então
 * nem o pulso nem o halo encostam no texto da linha.
 *
 * A barra não leva `title`: ela é `pointer-events-none` (senão engoliria o toque do
 * link da linha), então o navegador nunca mostraria a dica. Quem carrega o rótulo
 * legível é o `ChipTemperatura`, visível na lista, na tabela e na ficha; aqui fica o
 * `sr-only`, e as telas que já mostram o chip passam `semRotulo` para o leitor de
 * tela não anunciar a mesma temperatura duas vezes.
 */
export function BarraTermica({
  temperatura,
  needsAttention = false,
  posicao = 'fluxo',
  semRotulo = false,
  className,
}: {
  temperatura: Temperatura | string | null | undefined;
  /** `deals.needs_attention`: liga o halo e o pulso lento. */
  needsAttention?: boolean;
  /** 'fluxo' em linha flex; 'absoluta' quando a linha é uma <tr> com célula relativa. */
  posicao?: 'fluxo' | 'absoluta';
  /** Use quando a temperatura já é anunciada por outro elemento da mesma linha. */
  semRotulo?: boolean;
  className?: string;
}) {
  const movimentoReduzido = useReducedMotion();
  const definicao = definicaoTemperatura(temperatura);
  const pulsa = needsAttention && !movimentoReduzido;

  // `needs_attention` é esfriamento, não prazo de etapa: o banco o define como morno
  // com mais de 7 dias ou quente com mais de 5 dias sem contato (PRD §5.6).
  const rotulo = needsAttention
    ? `Temperatura: ${definicao.rotulo}. Esfriando por falta de contato.`
    : `Temperatura: ${definicao.rotulo}.`;

  return (
    <span
      aria-hidden={semRotulo || undefined}
      data-temperatura={definicao.valor}
      data-atencao={needsAttention ? '' : undefined}
      className={cn(
        // `pointer-events-none`: com o halo a marca fica 12px larga e passa por baixo
        // do padding do link da linha; o toque tem de continuar chegando no link.
        'pointer-events-none flex shrink-0',
        needsAttention ? 'w-3' : 'w-[3px]',
        posicao === 'absoluta' ? 'absolute inset-y-0 left-0' : 'min-h-4 self-stretch',
        className,
      )}
      style={
        needsAttention
          ? {
              backgroundImage: `linear-gradient(to right, color-mix(in oklab, ${definicao.cor} 38%, transparent), transparent)`,
            }
          : undefined
      }
    >
      <span
        aria-hidden="true"
        className={cn(
          'shrink-0 self-stretch rounded-none',
          // A espessura é o sinal e é permanente; o pulso é só o acento por cima.
          needsAttention ? 'w-[6px]' : 'w-[3px]',
          pulsa && 'pulso-termico',
        )}
        style={{ backgroundColor: definicao.cor }}
      />
      {!semRotulo && <span className="sr-only">{rotulo}</span>}
    </span>
  );
}
