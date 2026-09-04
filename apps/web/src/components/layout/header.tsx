import Link from 'next/link';

import { UserMenu } from '@/components/layout/user-menu';
import { Logo } from '@/components/logo';
import { type Sessao } from '@/lib/auth/session';

/** Cabeçalho fixo: marca (só no celular, onde não há sidebar) e usuário com papel e "Sair". */
export function Header({ sessao }: { sessao: Sessao }) {
  return (
    <header className="sticky top-0 z-30 flex h-14 items-center justify-between gap-3 border-b bg-background/95 px-4 backdrop-blur supports-backdrop-filter:bg-background/80 md:px-8">
      <Link href="/meu-dia" className="md:hidden" aria-label="KOMUNE CRM — ir para Meu dia">
        <Logo />
      </Link>
      <div className="hidden md:block" aria-hidden="true" />
      <UserMenu sessao={sessao} />
    </header>
  );
}
