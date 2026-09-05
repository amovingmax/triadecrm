import type { Metadata } from 'next';

import { requireSession } from '@/lib/auth/session';
import { TelaCadencias } from '@/components/cadencias/tela-cadencias';

export const metadata: Metadata = { title: 'Cadências' };

/**
 * Cadências (RF-CON-13..17; PRD §7.4; anexos R13 e R07).
 *
 * O servidor faz uma coisa só: exige sessão e diz se o papel liga e desliga régua —
 * o mesmo conjunto que a RLS de `public.cadences` aceita (`app.is_manager()`). Não é
 * autorização; é para não oferecer um botão que o banco vai recusar. Quem decide
 * continua sendo o Postgres, e a RPC devolve `sem_permissao` por escrito.
 */
export default async function Pagina() {
  const sessao = await requireSession();

  return <TelaCadencias podeLigarDesligar={sessao.papel === 'admin' || sessao.papel === 'gestor'} />;
}
