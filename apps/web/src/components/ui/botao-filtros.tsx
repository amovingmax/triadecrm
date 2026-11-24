import { SlidersHorizontal } from 'lucide-react';
import { type ComponentProps } from 'react';

import { cn } from '@/lib/utils';

/**
 * O botão "Filtros" ao lado da busca (protótipo responsivo da Imova, 24/11/2026):
 * os filtros que não cabem numa linha moram numa folha, e o botão mostra quantos
 * estão ligados. No celular estreito (abaixo de 480px) vira só o ícone, com o
 * número no canto, para a busca ficar com a largura.
 */
export function BotaoFiltros({
  ligados = 0,
  rotulo = 'Filtros',
  className,
  ...props
}: Omit<ComponentProps<'button'>, 'children'> & { ligados?: number; rotulo?: string }) {
  return (
    <button
      type="button"
      aria-label={ligados ? `${rotulo}, ${ligados} ligado${ligados > 1 ? 's' : ''}` : rotulo}
      className={cn(
        'toque relative inline-flex h-11 shrink-0 items-center justify-center gap-2 rounded-lg border border-input bg-card px-3.5 text-sm font-semibold whitespace-nowrap md:h-10',
        'max-[479px]:w-11 max-[479px]:px-0',
        'focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none',
        className,
      )}
      {...props}
    >
      <SlidersHorizontal className="size-4" aria-hidden />
      <span className="max-[479px]:sr-only">{rotulo}</span>
      {ligados > 0 ? (
        <span className="numerico inline-grid h-5 min-w-5 place-items-center rounded-full bg-menta px-1.5 text-xs font-bold text-menta-tinta max-[479px]:absolute max-[479px]:-top-1.5 max-[479px]:-right-1.5">
          {ligados}
        </span>
      ) : null}
    </button>
  );
}
