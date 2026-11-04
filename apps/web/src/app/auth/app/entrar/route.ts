/**
 * A ENTRADA NO APP DE CELULAR, já na WebView do app (ver `lib/auth/entrada-pelo-app.ts`,
 * passo 4).
 *
 * O app recebeu o código de uso único da janela segura e abre este endereço. A troca
 * pela sessão acontece aqui, no servidor, e os cookies ficam na WebView: daí em diante o
 * app é um navegador logado como outro qualquer, e a sessão se renova sozinha.
 */
import { NextResponse, type NextRequest } from 'next/server';

import { codigoValido } from '@/lib/auth/entrada-pelo-app';
import { origemDaRequisicao } from '@/lib/http';
import { createClient } from '@/lib/supabase/server';
import { ROTA_INICIAL } from '@/lib/supabase/middleware';

export async function GET(request: NextRequest) {
  const base = origemDaRequisicao(request);
  const codigo = request.nextUrl.searchParams.get('token');
  if (!codigoValido(codigo)) return NextResponse.redirect(`${base}/login?erro=app`);

  const supabase = await createClient();
  const { error } = await supabase.auth.verifyOtp({ type: 'magiclink', token_hash: codigo });
  if (error) return NextResponse.redirect(`${base}/login?erro=app-codigo`);
  return NextResponse.redirect(`${base}${ROTA_INICIAL}`);
}
