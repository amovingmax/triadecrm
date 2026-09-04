'use client';

import { useReducedMotion } from 'motion/react';

import { cn } from '@/lib/utils';

import { definicaoTemperatura, type Temperatura } from './escala-termica';

/**
 * Barra térmica: o elemento-assinatura do CRM. Três pixels na borda esquerda de
 * cada linha, na cor da temperatura calculada pelo banco. Não tem raio de propósito,
 * para ler como marcação de margem, não como enfeite.
 *
 * Quando o negócio passa do prazo da etapa (`deals.needs_attention`), a barra ganha
 * um pulso lento de espessura (nunca de opacidade, que apagaria justamente a linha
 * que precisa ser vista): é o único movimento contínuo da lista, e ele existe para
 * dizer "este aqui esfriou". Quem pediu menos movimento no sistema não recebe
 * nenhum (useReducedMotion, mais a rede de segurança em globals.css).
 */
export function BarraTermica({
  temperatura,
  needsAttention = false,
  posicao = 'fluxo',
  semRotulo = false,
  className,
}: {
  temperatura: Temperatura | string | null | undefined;
  /** `deals.needs_attention`: liga o pulso lento. */
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
        'w-[3px] shrink-0 rounded-none',
        posicao === 'absoluta' ? 'absolute inset-y-0 left-0' : 'min-h-4 self-stretch',
        pulsa && 'pulso-termico',
        className,
      )}
      style={{ backgroundColor: definicao.cor }}
    >
      {!semRotulo && <span className="sr-only">{rotulo}</span>}
    </span>
  );
}
