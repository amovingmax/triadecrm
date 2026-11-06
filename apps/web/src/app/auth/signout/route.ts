/**
 * Sair: encerra a sessão no Supabase, limpa os cookies e volta para /login. Somente POST.
 *
 * No app de celular (06/11/2026), antes de encerrar, o aparelho deixa de receber os avisos
 * desta pessoa: o app guardou o endereço de push num cookie (`lib/avisos-no-celular.ts`).
 * Se a remoção falhar, a saída acontece do mesmo jeito; quem entrar depois no aparelho o
 * pega para si ao registrar.
 */
import { NextResponse, type NextRequest } from 'next/server';

import { levarAparelhoAsOutrasEmpresas } from '@/lib/aparelho-entre-empresas';
import { COOKIE_DO_APARELHO, tokenValido } from '@/lib/avisos-no-celular';
import { origemDaRequisicao } from '@/lib/http';
import { createClient } from '@/lib/supabase/server';

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const aparelho = request.cookies.get(COOKIE_DO_APARELHO)?.value;
  if (tokenValido(aparelho)) {
    const { error } = await supabase.rpc(
      'aparelho_remover' as never,
      { p_token: aparelho } as never,
    );
    if (error) console.warn(`[aviso] /auth/signout aparelho_remover: ${error.message}`);
    // Saiu do app: o aparelho para de receber os avisos desta pessoa em todas as empresas.
    const { data } = await supabase.auth.getClaims();
    const email = typeof data?.claims?.email === 'string' ? data.claims.email : null;
    if (email) await levarAparelhoAsOutrasEmpresas(email, 'remover', aparelho, 'ios');
  }
  await supabase.auth.signOut();
  return NextResponse.redirect(`${origemDaRequisicao(request)}/login`, { status: 303 });
}
