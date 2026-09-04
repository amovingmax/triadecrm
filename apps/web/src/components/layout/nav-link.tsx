'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { type ItemNavegacao, estaAtivo } from '@/lib/navegacao';
import { cn } from '@/lib/utils';

type Props = {
  item: ItemNavegacao;
  variante: 'lateral' | 'inferior' | 'menu';
  onNavegar?: () => void;
};

/** Link de navegação com estado ativo pela rota atual; usado na sidebar, na barra inferior e no menu "Mais". */
export function NavLink({ item, variante, onNavegar }: Props) {
  const pathname = usePathname();
  const ativo = estaAtivo(pathname, item.href);
  const Icone = item.icone;

  if (variante === 'inferior') {
    return (
      <Link
        href={item.href}
        aria-current={ativo ? 'page' : undefined}
        className={cn(
          'flex min-w-0 flex-1 flex-col items-center justify-center gap-1 rounded-md px-1 py-2 text-[11px] font-medium leading-none transition-colors',
          ativo ? 'text-primary' : 'text-muted-foreground hover:text-foreground',
        )}
      >
        <Icone className={cn('size-5', ativo && 'stroke-[2.25]')} aria-hidden="true" />
        <span className="truncate">{item.rotulo}</span>
      </Link>
    );
  }

  return (
    <Link
      href={item.href}
      aria-current={ativo ? 'page' : undefined}
      onClick={onNavegar}
      className={cn(
        'flex items-center gap-3 rounded-md px-3 text-sm font-medium transition-colors',
        variante === 'menu' ? 'h-12 text-base' : 'h-9',
        ativo
          ? 'bg-sidebar-accent text-sidebar-accent-foreground'
          : 'text-sidebar-foreground/80 hover:bg-sidebar-accent/70 hover:text-sidebar-accent-foreground',
      )}
    >
      <Icone className="size-4 shrink-0" aria-hidden="true" />
      <span className="truncate">{item.rotulo}</span>
    </Link>
  );
}
