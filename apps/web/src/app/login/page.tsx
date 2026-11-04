import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';

import { entradaLocalLigada } from '@/lib/auth/entrada-local';
import { estouNoApp } from '@/lib/auth/entrada-pelo-app';
import { getSession } from '@/lib/auth/session';
import { destinoDepoisDoLogin } from '@/lib/supabase/middleware';

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
  // A volta do app de celular passa por aqui no teste do computador: a janela segura
  // mostra os usuários de teste e, depois deles, segue para `/auth/app/volta`.
  const next = destinoDepoisDoLogin(typeof params.next === 'string' ? params.next : null);
  const aviso = avisoDe(typeof params.erro === 'string' ? params.erro : null);

  // O proxy já redireciona quem está logado; isto cobre o acesso direto em modo de desenvolvimento.
  if (await getSession()) redirect(next);

  return (
    <TelaLogin
      next={next}
      aviso={aviso}
      entradaLocal={entradaLocalLigada()}
      noApp={estouNoApp((await headers()).get('user-agent'))}
    />
  );
}
