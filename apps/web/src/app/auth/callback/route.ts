/**
 * Volta do Google (Supabase Auth, fluxo PKCE): troca o `code` pela sessão, grava os cookies e
 * redireciona para o destino pedido (`?next=`, sempre um caminho interno) ou para a rota inicial.
 */
import { NextResponse, type NextRequest } from 'next/server';

import { origemDaRequisicao } from '@/lib/http';
import { destinoSeguro } from '@/lib/supabase/middleware';
import { createClient } from '@/lib/supabase/server';

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const base = origemDaRequisicao(request);
  const next = destinoSeguro(searchParams.get('next'));

  // O provedor recusou (usuário cancelou, domínio não permitido etc.).
  if (searchParams.get('error')) {
    return NextResponse.redirect(`${base}/login?erro=provedor`);
  }

  const code = searchParams.get('code');
  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(`${base}${next}`);
    }
  }

  return NextResponse.redirect(`${base}/login?erro=callback`);
}
