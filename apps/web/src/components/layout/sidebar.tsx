'use client';

import Link from 'next/link';

import { NavLink } from '@/components/layout/nav-link';
import { Logo } from '@/components/logo';
import { type AppRole } from '@/lib/auth/role';
import { navegacaoPara } from '@/lib/navegacao';

/** Barra lateral do desktop (md+). No celular a navegação fica na barra inferior. */
export function Sidebar({ papel }: { papel: AppRole }) {
  const itens = navegacaoPara(papel);

  return (
    <aside className="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground md:flex">
      <div className="flex h-14 items-center border-b border-sidebar-border px-4">
        <Link href="/meu-dia" aria-label="KOMUNE CRM — ir para Meu dia">
          <Logo />
        </Link>
      </div>

      <nav aria-label="Navegação principal" className="flex flex-1 flex-col gap-1 p-3">
        {itens.map((item) => (
          <NavLink key={item.href} item={item} variante="lateral" />
        ))}
      </nav>

      <p className="border-t border-sidebar-border px-4 py-3 text-xs text-muted-foreground">
        MVP · Natal/RN · fuso America/Fortaleza
      </p>
    </aside>
  );
}
