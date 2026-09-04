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

/**
 * Link de navegação com estado ativo pela rota atual; serve a lateral do desktop,
 * a barra inferior do celular e o menu "Mais".
 *
 * O ativo se marca por três coisas sem cromia: peso (font-medium), um fundo sutil
 * (tinta a 8% sobre a própria base da casca, 1,20:1 contra ela) e uma marca de 2px
 * em tinta, à esquerda na lateral e no topo na barra inferior. É a mesma gramática
 * da barra térmica da lista, e nenhuma delas gasta cor cromática, que na interface
 * só significa temperatura.
 *
 * O inativo usa `--sidebar-muted-foreground`, medido contra o azul da casca; o
 * `--muted-foreground` do conteúdo pararia em 4,45:1 sobre ele.
 */
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
          'toque relative flex min-w-0 flex-1 flex-col items-center justify-center gap-1 px-1 text-[11px] leading-none transition-colors',
          ativo
            ? 'bg-sidebar-accent font-medium text-sidebar-accent-foreground'
            : 'text-sidebar-muted-foreground',
        )}
      >
        <span
          aria-hidden="true"
          className={cn(
            'absolute inset-x-3 top-0 h-0.5 bg-sidebar-primary',
            ativo ? 'opacity-100' : 'opacity-0',
          )}
        />
        <Icone className={cn('size-5', ativo && 'stroke-[2.25]')} aria-hidden="true" />
        <span className="truncate">{item.rotulo}</span>
      </Link>
    );
  }

  if (variante === 'menu') {
    return (
      <Link
        href={item.href}
        aria-current={ativo ? 'page' : undefined}
        onClick={onNavegar}
        className={cn(
          'toque flex h-11 items-center gap-3 rounded-lg px-3 text-sm transition-colors',
          ativo ? 'bg-accent font-medium text-accent-foreground' : 'text-foreground',
        )}
      >
        {/* Sem `item.dia` aqui: dia de calendário é metadado de roadmap. Quem abre um
            módulo que ainda não existe encontra o aviso "chega no D3" na própria tela. */}
        <Icone className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
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
        'relative flex h-8 items-center gap-2.5 rounded-lg pr-2 pl-3 text-[13px] transition-colors',
        ativo
          ? 'bg-sidebar-accent font-medium text-sidebar-accent-foreground'
          : 'text-sidebar-muted-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground',
      )}
    >
      {ativo ? (
        <span
          aria-hidden="true"
          className="absolute top-1.5 bottom-1.5 left-0 w-0.5 bg-sidebar-primary"
        />
      ) : null}
      <Icone className="size-4 shrink-0" aria-hidden="true" />
      <span className="truncate">{item.rotulo}</span>
    </Link>
  );
}
