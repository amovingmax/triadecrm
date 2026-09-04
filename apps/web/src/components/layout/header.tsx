import Link from 'next/link';

import { PaletaComandos } from '@/components/layout/paleta-comandos';
import { UserMenu } from '@/components/layout/user-menu';
import { Logo } from '@/components/logo';
import { AlternadorTema } from '@/components/tema/alternador-tema';
import { type Sessao } from '@/lib/auth/session';

/**
 * Cabeçalho fixo de 56px (o teto da densidade 7: a lista é que precisa da altura).
 * Traz a marca no celular, onde não há lateral; a paleta de comandos com a dica da
 * tecla; a troca de tema; e o usuário com nome, papel e saída.
 */
export function Header({ sessao }: { sessao: Sessao }) {
  return (
    <header className="sticky top-0 z-30 flex h-14 shrink-0 items-center gap-2 border-b bg-background/95 px-3 backdrop-blur supports-backdrop-filter:bg-background/80 md:px-6">
      <Link
        href="/meu-dia"
        className="toque md:hidden"
        aria-label="KOMUNE CRM, ir para Meu dia"
        title="Meu dia"
      >
        <Logo somenteIcone className="sm:hidden" />
        <Logo className="hidden sm:inline-flex" />
      </Link>

      <PaletaComandos papel={sessao.papel} />

      <div className="ml-auto flex items-center gap-1">
        <AlternadorTema />
        <UserMenu sessao={sessao} />
      </div>
    </header>
  );
}
