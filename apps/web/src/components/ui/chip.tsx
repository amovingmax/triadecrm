import { type ComponentProps, type ReactNode } from 'react';

import { cn } from '@/lib/utils';

/**
 * A ficha de filtro rápido (situação, caixa, período curto). Tinta cheia quando
 * ligada, contorno quando não; 44px no celular e 36px no computador, e nunca
 * quebra o rótulo. A contagem, quando há, vai numa pílula dentro dela.
 *
 * É um `<button aria-pressed>`: quem decide o que acontece é a tela.
 */
export function Chip({
  ativo = false,
  contagem,
  className,
  children,
  ...props
}: Omit<ComponentProps<'button'>, 'aria-pressed'> & {
  ativo?: boolean;
  contagem?: number | null;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={ativo}
      className={cn(
        'toque inline-flex h-11 shrink-0 items-center gap-1.5 rounded-full border px-3.5 text-sm font-medium whitespace-nowrap transition-colors md:h-9',
        'focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none',
        ativo
          ? 'border-foreground bg-foreground text-background'
          : 'border-border bg-card text-foreground hover:border-input',
        className,
      )}
      {...props}
    >
      {children}
      {contagem != null ? (
        <span
          className={cn(
            'numerico inline-grid h-5 min-w-5 place-items-center rounded-full px-1.5 text-xs font-semibold',
            ativo ? 'bg-background/20 text-background' : 'bg-muted text-muted-foreground',
          )}
        >
          {contagem}
        </span>
      ) : null}
    </button>
  );
}
