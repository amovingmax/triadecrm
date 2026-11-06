/**
 * Chegada da troca de empresa sem novo login (passo 3 de `lib/troca-de-empresa.ts`).
 *
 * O navegador chega aqui, na empresa de destino, com o código de uso único que este
 * servidor emitiu há instantes (`/api/empresas/entrada`). A troca pela sessão acontece
 * no servidor e os cookies ficam nesta empresa; daí em diante é um login como outro
 * qualquer. Se havia outra pessoa logada aqui, quem fica é quem trocou.
 *
 * Código inválido, já usado ou vencido: a tela de login desta empresa, com o aviso.
 */
import { NextResponse, type NextRequest } from 'next/server';

import { codigoValido } from '@/lib/auth/entrada-pelo-app';
import { origemDaRequisicao } from '@/lib/http';
import { createClient } from '@/lib/supabase/server';
import { destinoSeguro } from '@/lib/supabase/middleware';

export async function GET(request: NextRequest) {
  const base = origemDaRequisicao(request);
  const params = request.nextUrl.searchParams;
  const next = destinoSeguro(params.get('next'));
  const codigo = params.get('codigo');
  const recusar = () =>
    NextResponse.redirect(`${base}/login?erro=troca&next=${encodeURIComponent(next)}`);
  if (!codigoValido(codigo)) return recusar();

  const supabase = await createClient();
  const { error } = await supabase.auth.verifyOtp({ type: 'magiclink', token_hash: codigo });
  if (error) {
    console.warn(`[troca] /auth/empresa/entrar código recusado: ${error.message}`);
    return recusar();
  }
  return NextResponse.redirect(`${base}${next}`);
}
