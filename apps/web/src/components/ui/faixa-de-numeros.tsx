import { type ReactNode } from 'react';

import { cn } from '@/lib/utils';

/**
 * Os números do topo de uma tela numa faixa compacta (protótipo responsivo da
 * Imova, 24/11/2026): no celular eles deslizam de lado numa linha só, em vez de
 * empilhar três ou quatro linhas de caixas antes do conteúdo; do tablet para cima
 * dividem a largura.
 */
export function FaixaDeNumeros({
  rotulo,
  className,
  children,
}: {
  rotulo: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      role="group"
      aria-label={rotulo}
      className={cn(
        'faixa-deslizante faixa-sangria gap-2.5 pb-1 [&>*]:min-w-[8.5rem]',
        'md:grid md:grid-cols-[repeat(auto-fit,minmax(8.5rem,1fr))] md:overflow-visible md:[mask-image:none] md:[&>*]:min-w-0',
        'md:mx-0 md:px-0',
        className,
      )}
    >
      {children}
    </div>
  );
}

/** Um número da faixa: rótulo pequeno, valor grande e um detalhe numa linha. */
export function NumeroCompacto({
  rotulo,
  valor,
  detalhe,
  icone,
  tom,
  children,
  className,
}: {
  rotulo: string;
  valor: ReactNode;
  detalhe?: ReactNode;
  icone?: ReactNode;
  /** Pinta o valor (ex.: 'text-quente-texto' para "sem resposta"). */
  tom?: string;
  /** Algo abaixo do valor, como uma barra de progresso. */
  children?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'flex min-w-0 flex-col gap-0.5 rounded-2xl bg-card px-3.5 py-3 text-left sombra-base',
        className,
      )}
    >
      <span className="flex items-center gap-1.5 text-[12.5px] whitespace-nowrap text-muted-foreground [&_svg]:size-3.5">
        {icone}
        {rotulo}
      </span>
      <span className={cn('numerico font-heading text-2xl leading-tight font-semibold', tom)}>
        {valor}
      </span>
      {children}
      {detalhe ? (
        <span className="truncate text-xs text-muted-foreground">{detalhe}</span>
      ) : null}
    </div>
  );
}
