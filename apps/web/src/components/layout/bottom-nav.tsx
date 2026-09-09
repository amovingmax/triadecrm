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
 * Barra inferior do celular (até md): os módulos de uso diário mais "Mais", que abre
 * o resto numa folha. É a navegação de campo, a um polegar de distância (PRD §8):
 * Meu dia, Registrar, Parceiros, Funis e Conversas.
 *
 * Eram quatro até "Registrar" entrar. Ela é a única tela em que o trabalho de campo
 * VIRA dado (temperatura, próxima ação e meta saem de lá), e estava fora da
 * navegação inteira: chegava-se a ela por link de outro módulo ou pelo estado vazio
 * do Meu dia, que só aparece quando não há o que registrar. Uma tela de campo que só
 * se alcança de dentro de outra tela não é de campo.
 *
 * Cinco itens mais "Mais" são seis fatias de `flex-1`. Em 390px isso dá 65px por
 * fatia, ainda acima do alvo de 44px, e os rótulos mais longos ("Parceiros",
 * "Conversas") ficam no limite do `truncate`. A fusão dos 12 módulos em 6 é a tarefa
 * que resolve isso de verdade; até lá, seis fatias é o preço de a tela de registro
 * existir na navegação, e é mais barato que a ausência dela.
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
              'toque relative flex min-w-0 flex-1 flex-col items-center justify-center gap-1 px-1 text-[11px] leading-4 transition-colors',
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

          {/* Teto de 80svh com rolagem própria: a folha é `h-auto` e cresce com o
              conteúdo. Desde que cada linha passou a trazer a descrição do módulo,
              oito módulos secundários passam de 500px, e num aparelho de 667px de
              altura a folha sairia pelo topo levando junto os últimos itens. `svh`
              e não `vh` porque a barra do navegador do celular entra na conta. */}
          <SheetContent
            side="bottom"
            className="max-h-[80svh] gap-3 overflow-y-auto rounded-t-xl pb-[calc(var(--area-segura-inferior)+0.75rem)]"
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
