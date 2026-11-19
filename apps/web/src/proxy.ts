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
     * - sw-avisos.js (o service worker não pode ser redirecionado para o login)
     * - arquivos estáticos por extensão (imagens, fontes, txt, xml, json)
     *
     * O que termina nessas extensões sai SEM proxy e, portanto, sem login. Por isso a
     * página pronta da Inteligência de mercado (18/11/2026) não mora em `public/`: quem
     * a entrega é a rota `/inteligencia/painel`, que passa por aqui e confere o acesso.
     */
    '/((?!_next/static|_next/image|favicon\\.ico|manifest\\.webmanifest|sw-avisos\\.js|icons/|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|woff2?|txt|xml|json)$).*)',
  ],
};
