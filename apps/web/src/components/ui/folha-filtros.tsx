'use client';

import { type ReactNode } from 'react';

import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { useMidia } from '@/lib/use-midia';
import { cn } from '@/lib/utils';

/**
 * A folha onde moram os filtros que não cabem numa linha (protótipo responsivo da
 * Imova, 24/11/2026): sobe de baixo no celular, onde o polegar alcança, e abre do
 * lado direito do tablet para cima. O rodapé fica preso (Limpar / Ver resultados).
 */
export function FolhaFiltros({
  aberta,
  aoMudar,
  titulo = 'Filtros',
  descricao,
  rodape,
  children,
}: {
  aberta: boolean;
  aoMudar: (aberta: boolean) => void;
  titulo?: string;
  descricao?: string;
  rodape?: ReactNode;
  children: ReactNode;
}) {
  const lado = useMidia('(min-width: 640px)') ? 'right' : 'bottom';
  return (
    <Sheet open={aberta} onOpenChange={aoMudar}>
      <SheetContent
        side={lado}
        className={cn(
          'gap-0 p-0',
          lado === 'bottom' ? 'max-h-[88dvh] rounded-t-3xl' : 'w-full sm:max-w-[400px]',
        )}
      >
        <SheetHeader className="border-b border-hairline px-4 py-3 sm:px-6">
          <SheetTitle>{titulo}</SheetTitle>
          {descricao ? <SheetDescription>{descricao}</SheetDescription> : (
            <SheetDescription className="sr-only">{titulo}</SheetDescription>
          )}
        </SheetHeader>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-2 sm:px-6">{children}</div>
        {rodape ? (
          <SheetFooter className="flex-row gap-2 border-t border-hairline px-4 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom,0px))] sm:px-6 [&>*]:flex-1">
            {rodape}
          </SheetFooter>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

/** Um grupo de opções dentro da folha ("Perfil", "Etapa"), com chips que quebram linha. */
export function GrupoDeFiltro({ titulo, children }: { titulo: string; children: ReactNode }) {
  return (
    <fieldset className="border-t border-hairline py-3 first:border-t-0">
      <legend className="mb-2.5 float-left w-full text-[13px] font-bold">{titulo}</legend>
      <div className="clear-both flex flex-wrap gap-2">{children}</div>
    </fieldset>
  );
}
