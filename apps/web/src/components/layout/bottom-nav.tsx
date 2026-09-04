'use client';

import { Ellipsis } from 'lucide-react';
import { usePathname } from 'next/navigation';
import { useState } from 'react';

import { NavLink } from '@/components/layout/nav-link';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';
import { type AppRole } from '@/lib/auth/role';
import { estaAtivo, navegacaoPara } from '@/lib/navegacao';
import { cn } from '@/lib/utils';

/**
 * Barra inferior do celular (até md): os 4 itens principais + "Mais", que abre um menu com os demais.
 * Mobile-first nas telas de campo (PRD §8): Meu dia, Parceiros, Funis e Conversas a um toque.
 */
export function BottomNav({ papel }: { papel: AppRole }) {
  const pathname = usePathname();
  const [aberto, setAberto] = useState(false);

  const itens = navegacaoPara(papel);
  const principais = itens.filter((item) => item.principal);
  const secundarios = itens.filter((item) => !item.principal);
  const algumSecundarioAtivo = secundarios.some((item) => estaAtivo(pathname, item.href));

  return (
    <nav
      aria-label="Navegação principal"
      className="fixed inset-x-0 bottom-0 z-30 border-t bg-background/95 pb-[var(--area-segura-inferior)] backdrop-blur supports-backdrop-filter:bg-background/80 md:hidden"
    >
      <div className="flex h-[var(--altura-barra-inferior)] items-stretch px-1">
        {principais.map((item) => (
          <NavLink key={item.href} item={item} variante="inferior" />
        ))}

        <Sheet open={aberto} onOpenChange={setAberto}>
          <SheetTrigger
            className={cn(
              'flex min-w-0 flex-1 flex-col items-center justify-center gap-1 rounded-md px-1 py-2 text-[11px] font-medium leading-none transition-colors',
              algumSecundarioAtivo ? 'text-primary' : 'text-muted-foreground hover:text-foreground',
            )}
            aria-label="Mais opções de navegação"
          >
            <Ellipsis className="size-5" aria-hidden="true" />
            <span>Mais</span>
          </SheetTrigger>
          <SheetContent side="bottom" className="rounded-t-2xl pb-[var(--area-segura-inferior)]">
            <SheetHeader>
              <SheetTitle>Mais</SheetTitle>
              <SheetDescription>Outras áreas do CRM</SheetDescription>
            </SheetHeader>
            <div className="flex flex-col gap-1 px-3 pb-4">
              {secundarios.map((item) => (
                <NavLink
                  key={item.href}
                  item={item}
                  variante="menu"
                  onNavegar={() => setAberto(false)}
                />
              ))}
            </div>
          </SheetContent>
        </Sheet>
      </div>
    </nav>
  );
}
