import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { getSession } from '@/lib/auth/session';
import { destinoSeguro } from '@/lib/supabase/middleware';

import { avisoDe } from './avisos';
import { TelaLogin } from './tela-login';

export const metadata: Metadata = {
  title: 'Entrar',
};

type Props = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function PaginaLogin({ searchParams }: Props) {
  const params = await searchParams;
  const next = destinoSeguro(typeof params.next === 'string' ? params.next : null);
  const aviso = avisoDe(typeof params.erro === 'string' ? params.erro : null);

  // O proxy já redireciona quem está logado; isto cobre o acesso direto em modo de desenvolvimento.
  if (await getSession()) redirect(next);

  return <TelaLogin next={next} aviso={aviso} />;
}
