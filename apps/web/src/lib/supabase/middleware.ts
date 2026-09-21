/**
 * Renovação de sessão e proteção de rotas, executadas pelo proxy (src/proxy.ts) antes de cada requisição.
 *
 * Fluxo: cria um cliente Supabase ligado aos cookies da requisição, valida o JWT (renovando-o quando está
 * perto de expirar) e regrava os cookies na resposta. Não autenticado fora das rotas públicas → /login;
 * autenticado em /login → /meu-dia.
 */
import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

import { supabaseAnonKey, supabaseUrl } from '@/lib/env';

/** Rota inicial de quem está autenticado. */
export const ROTA_INICIAL = '/meu-dia';

/**
 * Rotas acessíveis sem sessão: login, o fluxo de callback/signout do Supabase Auth
 * e a página de reivindicação do pré-cadastro.
 *
 * `/c/<token>` é a única rota do produto feita para quem NÃO é do time: é o link
 * que o fornecedor abre para dizer se o perfil é dele (RF-PRE-08). Mandá-la para
 * o /login seria pedir ao dono do buffet uma conta que ele não tem. Quem protege
 * a rota é o token — 32 bytes, guardados só como hash, válidos por 7 dias — e o
 * fato de `anon` não ter grant de tabela nenhuma no banco.
 *
 * `/r/<código>` é o link rastreado dos envios em massa: também é aberto pelo
 * parceiro, sem conta. Só grava o clique e redireciona para um destino que o
 * banco escolhe (`public.envio_clique`).
 */
export function ehRotaPublica(pathname: string): boolean {
  return (
    pathname === '/login' ||
    pathname.startsWith('/auth/') ||
    pathname.startsWith('/c/') ||
    pathname.startsWith('/r/')
  );
}

/**
 * Garante que um destino pós-login é um caminho interno (evita open redirect via `?next=`).
 * Aceita apenas caminhos absolutos do próprio app; qualquer outra coisa cai na rota inicial.
 */
export function destinoSeguro(valor: string | null | undefined): string {
  if (!valor || !valor.startsWith('/') || valor.startsWith('//') || valor.startsWith('/\\')) {
    return ROTA_INICIAL;
  }
  if (ehRotaPublica(valor)) return ROTA_INICIAL;
  return valor;
}

/**
 * O endereço dos links dos envios em massa (`ir.komune.app.br`, decisão do
 * Rafael em 21/09/2026). Ele aponta para este mesmo app, mas só serve para
 * UMA coisa: `/r/<código>`. Qualquer outro caminho nele vai para o site da
 * Komune — o parceiro que apaga o código da URL não pode cair no login do CRM.
 */
export const HOST_DOS_LINKS = 'ir.komune.app.br';
export const SITE_DA_KOMUNE = 'https://komune.app.br';

export function destinoNoHostDosLinks(host: string | null, pathname: string): string | null {
  if ((host ?? '').split(':')[0]?.toLowerCase() !== HOST_DOS_LINKS) return null;
  return pathname.startsWith('/r/') ? null : SITE_DA_KOMUNE;
}

export async function atualizarSessao(request: NextRequest): Promise<NextResponse> {
  const foraDoLink = destinoNoHostDosLinks(request.headers.get('host'), request.nextUrl.pathname);
  if (foraDoLink !== null) return NextResponse.redirect(foraDoLink, 302);

  let response = NextResponse.next({ request });

  const supabase = createServerClient(supabaseUrl(), supabaseAnonKey(), {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, options),
        );
      },
    },
  });

  // Importante: nada entre a criação do cliente e a validação abaixo — é ela que renova a sessão.
  // getClaims valida o JWT (localmente com chaves assimétricas; via servidor com segredo simétrico).
  const { data } = await supabase.auth.getClaims();
  const autenticado = Boolean(data?.claims);

  const { pathname, search } = request.nextUrl;

  if (!autenticado && !ehRotaPublica(pathname)) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    url.search = '';
    if (pathname !== '/') url.searchParams.set('next', `${pathname}${search}`);
    return redirecionarPreservandoCookies(url, response);
  }

  if (autenticado && pathname === '/login') {
    const url = request.nextUrl.clone();
    url.pathname = destinoSeguro(request.nextUrl.searchParams.get('next'));
    url.search = '';
    return redirecionarPreservandoCookies(url, response);
  }

  return response;
}

/** Redireciona (307) sem perder cookies de sessão eventualmente renovados nesta requisição. */
function redirecionarPreservandoCookies(url: URL, original: NextResponse): NextResponse {
  const redirect = NextResponse.redirect(url);
  original.cookies.getAll().forEach((cookie) => redirect.cookies.set(cookie));
  return redirect;
}
