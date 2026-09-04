'use client';

import Link from 'next/link';

import { NavLink } from '@/components/layout/nav-link';
import { Logo } from '@/components/logo';
import { type AppRole } from '@/lib/auth/role';
import { navegacaoPara } from '@/lib/navegacao';

/**
 * Lateral do desktop (md+): estreita e de pouco peso, porque a tela pertence à lista.
 * Ícone mais rótulo, altura de linha de 32px, sem cartão e sem sombra. No celular a
 * navegação vive na barra inferior.
 *
 * O que separa a navegação do conteúdo é a base da casca (o azul do Ocean Breeze:
 * #e0f2fe no claro, #1e293b no escuro) mais uma hairline, nunca uma borda cheia. O
 * bloco da marca tem os mesmos 56px do cabeçalho e fecha com a mesma linha, então a
 * régua do topo atravessa a tela inteira.
 */
export function Sidebar({ papel }: { papel: AppRole }) {
  const itens = navegacaoPara(papel);

  return (
    <aside className="sticky top-0 hidden h-dvh w-52 shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground md:flex">
      <div className="flex h-14 shrink-0 items-center border-b border-sidebar-border px-3">
        <Link href="/meu-dia" className="toque" aria-label="Tríade, ir para Meu dia">
          <Logo className="text-[15px]" />
        </Link>
      </div>

      {/* Sem rodapé: carimbo de versão e faixa de localidade não ajudam quem está
          usando o CRM (o fuso aparece onde é operacional, na data da próxima ação). */}
      <nav aria-label="Navegação principal" className="flex flex-1 flex-col gap-0.5 px-2 py-2">
        {itens.map((item) => (
          <NavLink key={item.href} item={item} variante="lateral" />
        ))}
      </nav>
    </aside>
  );
}
