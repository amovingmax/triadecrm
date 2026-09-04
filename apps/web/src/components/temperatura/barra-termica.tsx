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
 * Quando o negócio passa do prazo da etapa (`deals.needs_attention`), a barra
 * DESTACA de dois jeitos, os dois somando luz e nunca tirando:
 *
 * 1. um halo fixo de 12px que se apaga para a direita, na própria cor da temperatura
 *    (é fundo decorativo atrás da barra, que continua em cor cheia);
 * 2. um pulso lento de ESPESSURA (3px que vai a 7px e volta), nunca de opacidade:
 *    baixar o alfa apagaria justamente a linha que precisa ser vista (foi o que
 *    levou o âmbar a 1,40:1 no claro na primeira versão).
 *
 * O halo é estático de propósito: quem pediu menos movimento no sistema perde o
 * pulso (useReducedMotion, mais a rede de segurança em globals.css) e antes ficava
 * sem sinal nenhum. Agora o realce continua lá, parado.
 *
 * O conjunto cabe nos 12px do halo e os 16px de `pl-4` de quem usa a barra, então
 * nem o pulso nem o halo encostam no texto da linha.
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

  const rotulo = needsAttention
    ? `Temperatura: ${definicao.rotulo}. Passou do prazo da etapa.`
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
        className={cn('w-[3px] shrink-0 self-stretch rounded-none', pulsa && 'pulso-termico')}
        style={{ backgroundColor: definicao.cor }}
      />
      {!semRotulo && <span className="sr-only">{rotulo}</span>}
    </span>
  );
}
