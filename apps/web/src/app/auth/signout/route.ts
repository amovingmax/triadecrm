/** Sair: encerra a sessão no Supabase, limpa os cookies e volta para /login. Somente POST. */
import { NextResponse, type NextRequest } from 'next/server';

import { origemDaRequisicao } from '@/lib/http';
import { createClient } from '@/lib/supabase/server';

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  await supabase.auth.signOut();
  return NextResponse.redirect(`${origemDaRequisicao(request)}/login`, { status: 303 });
}
