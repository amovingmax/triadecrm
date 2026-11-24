'use client';

import { forwardRef } from 'react';
import { Ban, Check, CheckCheck, Clock } from 'lucide-react';

import { cn } from '@/lib/utils';
import { iniciaisDe } from '@/lib/iniciais';
import { definicaoTemperatura, type Temperatura } from '@/components/temperatura/escala-termica';

/**
 * As peças da tela de Conversas no jeito do WhatsApp (03/11/2026).
 *
 * O pedido foi deixar Conversas "cada vez mais parecida com o WhatsApp, para gerar
 * familiaridade e pela praticidade do visual". As medidas e as cores são as do
 * protótipo aprovado; as cores moram em `globals.css` (`--wpp-*`) e valem só aqui.
 * O resto do CRM continua com o desenho de sempre.
 */

/** O círculo de 44px dos ícones do WhatsApp: cabeçalho, caixa de escrever, lista. */
export const BotaoRedondo = forwardRef<
  HTMLButtonElement,
  React.ButtonHTMLAttributes<HTMLButtonElement> & { tamanho?: 'md' | 'sm' }
>(function BotaoRedondo({ className, tamanho = 'md', type = 'button', ...resto }, ref) {
  return (
    <button
      ref={ref}
      type={type}
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-full text-wpp-suave transition-colors outline-none',
        'hover:bg-foreground/[0.07] focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-40',
        'aria-expanded:bg-foreground/[0.07] aria-pressed:bg-foreground/[0.07] aria-pressed:text-foreground',
        tamanho === 'md' ? 'size-11 [&_svg]:size-[19px]' : 'size-9 [&_svg]:size-[17px]',
        className,
      )}
      {...resto}
    />
  );
});

/**
 * O avatar das iniciais, com o ponto da temperatura no canto (o lugar do "online"
 * do WhatsApp). O anel do ponto tem a cor do que está atrás, para ele descolar do
 * círculo; quem sabe essa cor é quem desenha a linha (selecionada ou não).
 */
export function AvatarDaConversa({
  nome,
  temperatura = null,
  tamanho = 48,
  anel = 'var(--wpp-painel)',
  className,
  children,
}: {
  nome: string;
  temperatura?: Temperatura | null;
  /** Em px: 48 na lista, 40 no cabeçalho, 64 na ficha. */
  tamanho?: number;
  anel?: string;
  className?: string;
  /** Por cima do círculo: o ✓ da seleção no celular. */
  children?: React.ReactNode;
}) {
  const t = temperatura ? definicaoTemperatura(temperatura) : null;
  return (
    <span
      aria-hidden="true"
      className={cn(
        'relative flex shrink-0 items-center justify-center rounded-full bg-wpp-avatar font-semibold text-wpp-avatar-texto',
        className,
      )}
      style={{ width: tamanho, height: tamanho, fontSize: Math.round(tamanho * 0.31) }}
    >
      {iniciaisDe(nome)}
      {t ? (
        <span
          className="absolute right-[-1px] bottom-0 rounded-full"
          title={t.rotulo}
          style={{
            width: tamanho >= 48 ? 13 : 12,
            height: tamanho >= 48 ? 13 : 12,
            background: t.cor,
            boxShadow: `0 0 0 2.5px ${anel}`,
          }}
        />
      ) : null}
      {children}
    </span>
  );
}

/** O estado da entrega como o WhatsApp mostra: relógio, ✓, ✓✓ e ✓✓ azul. */
export type Tique = 'espera' | 'enviado' | 'entregue' | 'lido' | 'falha';

export function Tiques({ tique, className }: { tique: Tique; className?: string }) {
  const classe = cn('size-4 shrink-0', className);
  if (tique === 'espera') return <Clock className={cn(classe, 'size-3.5')} aria-label="na fila" />;
  if (tique === 'falha')
    return <Ban className={cn(classe, 'size-3.5 text-destructive-texto')} aria-label="não saiu" />;
  if (tique === 'enviado') return <Check className={classe} aria-label="enviada" />;
  return (
    <CheckCheck
      className={cn(classe, tique === 'lido' && 'text-wpp-tique')}
      aria-label={tique === 'lido' ? 'lida' : 'entregue'}
    />
  );
}

/** A pílula centrada do fio: o dia ("Hoje", "Ontem") e os avisos do sistema. */
export function PilulaDoFio({
  tom = 'sistema',
  className,
  children,
  ...resto
}: React.HTMLAttributes<HTMLSpanElement> & { tom?: 'dia' | 'sistema' }) {
  return (
    <span
      className={cn(
        'max-w-[min(80%,36rem)] px-3 text-center text-xs shadow-wpp',
        tom === 'dia'
          ? 'rounded-lg bg-wpp-dia py-[5px] font-medium text-wpp-dia-texto'
          : 'rounded-full bg-wpp-sis py-1 text-wpp-sis-texto',
        className,
      )}
      {...resto}
    >
      {children}
    </span>
  );
}

/** A pontinha do balão, no primeiro de cada bloco: à esquerda o que entra, à direita o que sai. */
export function RabichoDoBalao({ lado }: { lado: 'entra' | 'sai' }) {
  return (
    <svg
      aria-hidden="true"
      width="8"
      height="13"
      viewBox="0 0 8 13"
      className={cn(
        'absolute top-0',
        lado === 'entra' ? '-left-2 text-wpp-entra' : '-right-2 text-wpp-sai',
      )}
    >
      <path
        d={
          lado === 'entra'
            ? 'M8 0H1.5C.4 0 0 1.2.7 2L8 11.5Z'
            : 'M0 0h6.5c1.1 0 1.5 1.2.8 2L0 11.5Z'
        }
        fill="currentColor"
      />
    </svg>
  );
}
