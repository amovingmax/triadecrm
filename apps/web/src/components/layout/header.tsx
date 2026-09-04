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
 *
 * `superficie-vidro` é o acabamento do template: a base a 80% com desfoque e uma
 * hairline embaixo, no lugar de uma borda cheia. A lista passa por baixo do
 * cabeçalho enquanto rola, e a linha fina separa sem desenhar uma segunda régua.
 *
 * A marca também é um alvo de toque (leva ao "Meu dia") e por isso carrega a caixa
 * de 44px dos outros controles do cabeçalho: `.toque` só dá a resposta tátil, não
 * dá tamanho, e sem a caixa o alvo era o do próprio SVG (35x28px). O `-ml-1.5`
 * devolve a folga que a caixa acrescenta, para o "K" ficar onde já estava.
 */
export function Header({ sessao }: { sessao: Sessao }) {
  return (
    <header className="superficie-vidro sticky top-0 z-30 flex h-14 shrink-0 items-center gap-2 px-3 md:px-6">
      <Link
        href="/meu-dia"
        className="toque -ml-1.5 inline-flex h-11 min-w-11 items-center justify-center md:hidden"
        aria-label="Tríade, ir para Meu dia"
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
