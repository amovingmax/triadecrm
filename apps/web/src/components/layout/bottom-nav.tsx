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
 * Barra inferior do celular (até md): os 4 módulos de uso diário mais "Mais", que
 * abre o resto numa folha. É a navegação de campo, a um polegar de distância
 * (PRD §8): Meu dia, Parceiros, Funis e Conversas.
 *
 * A base é a da casca (a mesma da lateral do desktop: #e0f2fe no claro, #1e293b no
 * escuro), com desfoque e hairline em cima. Os 64px de altura são deliberados e
 * ficam acima do teto de 56px do cabeçalho: é o mínimo para empilhar ícone de 20px
 * e rótulo de 11px dentro de um alvo de toque de 44px.
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
      className="superficie-vidro-inferior fixed inset-x-0 bottom-0 z-30 pb-[var(--area-segura-inferior)] md:hidden"
    >
      <div className="flex h-[var(--altura-barra-inferior)] items-stretch">
        {principais.map((item) => (
          <NavLink key={item.href} item={item} variante="inferior" />
        ))}

        <Sheet open={aberto} onOpenChange={setAberto}>
          <SheetTrigger
            className={cn(
              'toque relative flex min-w-0 flex-1 flex-col items-center justify-center gap-1 px-1 text-[11px] leading-none transition-colors',
              algumSecundarioAtivo
                ? 'bg-sidebar-accent font-medium text-sidebar-accent-foreground'
                : 'text-sidebar-muted-foreground',
            )}
            aria-label="Mais áreas do CRM"
          >
            <span
              aria-hidden="true"
              className={cn(
                'absolute inset-x-3 top-0 h-0.5 bg-sidebar-primary',
                algumSecundarioAtivo ? 'opacity-100' : 'opacity-0',
              )}
            />
            <Ellipsis
              className={cn('size-5', algumSecundarioAtivo && 'stroke-[2.25]')}
              aria-hidden="true"
            />
            <span>Mais</span>
          </SheetTrigger>

          <SheetContent
            side="bottom"
            className="gap-3 rounded-t-xl pb-[calc(var(--area-segura-inferior)+0.75rem)]"
          >
            <SheetHeader className="pb-1">
              <SheetTitle>Mais áreas</SheetTitle>
              <SheetDescription>Os módulos que não cabem na barra.</SheetDescription>
            </SheetHeader>
            <div className="flex flex-col gap-0.5 px-2">
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
