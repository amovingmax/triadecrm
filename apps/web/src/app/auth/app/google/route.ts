/**
 * A IDA AO GOOGLE PELO APP DE CELULAR, aberta na janela segura do iPhone (ver
 * `lib/auth/entrada-pelo-app.ts`, passo 2).
 *
 * Guarda o estado e a volta do app num cookie desta janela e manda para o Google pelo
 * mesmo Supabase do botão do navegador. O código PKCE fica no cookie da janela, e é
 * nela que `/auth/callback` faz a troca.
 *
 * No CRM do computador (`next dev` com o banco local) não há Google: a janela mostra os
 * usuários de teste, e o resto do caminho é o mesmo de produção.
 */
import { cookies } from 'next/headers';
import { NextResponse, type NextRequest } from 'next/server';

import { entradaLocalLigada } from '@/lib/auth/entrada-local';
import {
  COOKIE_DO_APP,
  enderecoDeVolta,
  estadoValido,
  VALIDADE_DO_COOKIE_S,
  VOLTA_DO_APP,
  voltaValida,
} from '@/lib/auth/entrada-pelo-app';
import { origemDaRequisicao } from '@/lib/http';
import { createClient } from '@/lib/supabase/server';

export async function GET(request: NextRequest) {
  const base = origemDaRequisicao(request);
  const estado = request.nextUrl.searchParams.get('estado');
  const volta = request.nextUrl.searchParams.get('volta');
  // Sem os dois, não foi o app que abriu (ou é uma versão do app sem a janela segura).
  if (!estadoValido(estado) || !voltaValida(volta)) {
    return NextResponse.redirect(`${base}/login?erro=app`);
  }

  const cookieStore = await cookies();
  cookieStore.set(COOKIE_DO_APP, JSON.stringify({ estado, volta }), {
    httpOnly: true,
    // A volta do Google é uma navegação de outro site: `lax` deixa o cookie ir junto.
    sameSite: 'lax',
    secure: base.startsWith('https://'),
    path: '/auth',
    maxAge: VALIDADE_DO_COOKIE_S,
  });

  if (entradaLocalLigada()) {
    return NextResponse.redirect(`${base}/login?next=${encodeURIComponent(VOLTA_DO_APP)}`);
  }

  const supabase = await createClient();
  const redirectTo = new URL('/auth/callback', base);
  redirectTo.searchParams.set('next', VOLTA_DO_APP);
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo: redirectTo.toString(),
      queryParams: { prompt: 'select_account' },
      skipBrowserRedirect: true,
    },
  });
  if (error || !data.url) {
    return NextResponse.redirect(enderecoDeVolta(volta, { erro: 'provedor', estado }));
  }
  return NextResponse.redirect(data.url);
}
