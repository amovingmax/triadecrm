/**
 * Proxy do Next.js 16 (sucessor do middleware.ts): roda antes de cada requisição, renova a sessão do
 * Supabase e redireciona quem não está autenticado para /login (exceto /login, /auth/* e assets).
 */
import { type NextRequest } from 'next/server';

import { atualizarSessao } from '@/lib/supabase/middleware';

export async function proxy(request: NextRequest) {
  return atualizarSessao(request);
}

export const config = {
  matcher: [
    /*
     * Tudo, exceto:
     * - _next/static, _next/image (arquivos do build e otimização de imagens)
     * - favicon.ico, manifest.webmanifest, icons/ (PWA — buscados sem cookies)
     * - arquivos estáticos por extensão (imagens, fontes, txt, xml, json)
     */
    '/((?!_next/static|_next/image|favicon\\.ico|manifest\\.webmanifest|icons/|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|woff2?|txt|xml|json)$).*)',
  ],
};
