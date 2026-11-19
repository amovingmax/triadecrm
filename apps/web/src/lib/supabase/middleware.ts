/**
 * Renovação de sessão e proteção de rotas, executadas pelo proxy (src/proxy.ts) antes de cada requisição.
 *
 * Fluxo: cria um cliente Supabase ligado aos cookies da requisição, valida o JWT (renovando-o quando está
 * perto de expirar) e regrava os cookies na resposta. Não autenticado fora das rotas públicas → /login;
 * autenticado em /login → /meu-dia.
 */
import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

import type { Empresa } from '@komune/schema/empresas';

import { VOLTA_DO_APP } from '@/lib/auth/entrada-pelo-app';
import { type AppRole, roleFromClaims } from '@/lib/auth/role';
import { EMPRESA } from '@/lib/empresa';
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
 *
 * `/api/empresas/acesso` é chamada pelo servidor da OUTRA empresa, sem cookie, para
 * saber se mostra o botão de trocar. Quem a protege é a assinatura com o segredo que
 * só os dois sites têm (`lib/pergunta-entre-empresas.ts`).
 *
 * `/privacidade` é a política de privacidade da empresa que a publica no CRM (a Imova):
 * a Meta, o Google e quem conversa com a empresa abrem o link sem conta. Na KOMUNE a
 * política mora no site dela, e a rota continua atrás do login, como sempre esteve.
 *
 * `/aplicativo` e `/aplicativo/privacidade` são o suporte e a política do app de
 * celular, os links que a ficha da App Store pede. Abrem nas duas empresas: o app é um
 * só, e o revisor da Apple e quem baixa o app abrem os links sem conta.
 */
export function ehRotaPublica(pathname: string, empresa: Empresa = EMPRESA): boolean {
  return (
    pathname === '/login' ||
    pathname === '/api/empresas/acesso' ||
    pathname === '/api/empresas/entrada' ||
    pathname === '/api/empresas/aparelho' ||
    pathname.startsWith('/auth/') ||
    pathname.startsWith('/c/') ||
    pathname.startsWith('/r/') ||
    (pathname === '/privacidade' && empresa.privacidade !== null) ||
    pathname === '/aplicativo' ||
    pathname === '/aplicativo/privacidade'
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
 * O destino depois do login, com a volta do app de celular como única rota pública
 * aceita. `destinoSeguro` recusa toda rota de `/auth/` (é isso que impede o laço de
 * login); a volta do app é a exceção, porque é ela que entrega o login ao app
 * (`lib/auth/entrada-pelo-app.ts`).
 */
export function destinoDepoisDoLogin(valor: string | null | undefined): string {
  return valor === VOLTA_DO_APP ? VOLTA_DO_APP : destinoSeguro(valor);
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

/**
 * A Inteligência de mercado (18/11/2026), só na Imova.
 *
 * `/inteligencia` é a página do CRM que abre a página pronta do protótipo, e
 * `/inteligencia/painel` é a rota que entrega a página pronta (cerca de 7 MB, com os
 * dados dentro, guardada em gzip FORA de `public/`). Quem decide se entrega é a
 * própria rota, no servidor: sessão, papel, perfil no banco e banco da empresa
 * (`app/(inteligencia)/inteligencia/painel/route.ts`). Este porteiro é a primeira
 * camada, antes de qualquer coisa embaixo de `/inteligencia`:
 *
 *  - na empresa sem o módulo (a KOMUNE), a rota e tudo embaixo dela não existem:
 *    "não encontrado", com ou sem login (o mesmo código publica os dois sites);
 *  - sem login, vai para o login, como qualquer tela (quem faz é o fluxo de sempre);
 *  - com login, mas fora dos papéis, vai para `/sem-permissao`.
 *
 * Nada da Inteligência mora em `public/`: o `matcher` do `proxy.ts` deixa passar SEM
 * LOGIN o que termina em .json, .png, .svg, .txt e outros (o teste
 * `pagina-pronta.test.ts` confere que a pasta não existe).
 */
export const ROTA_DA_INTELIGENCIA = '/inteligencia';

/** A rota que entrega a página pronta que `scripts/inteligencia/copiar-prototipo.mjs` grava. */
export const PAGINA_PRONTA_DA_INTELIGENCIA = '/inteligencia/painel';

/**
 * Quem entra: admin, gestor e SDR (decisão assumida em 18/11/2026; o dono pode
 * mudar). Espelho dos `papeis` do item do menu, que um teste confere: aqui não se
 * importa `lib/navegacao`, que puxaria os ícones do menu para o porteiro.
 */
export const PAPEIS_DA_INTELIGENCIA: readonly AppRole[] = ['admin', 'gestor', 'sdr'];

/**
 * O caminho como o servidor o entende: decodificado (`/%69nteligencia/…` é o mesmo
 * endereço), sem barras repetidas e em minúsculas (num disco que não distingue
 * maiúscula, `/Inteligencia/…` abriria o mesmo arquivo, se um dia houver um). Sem
 * isso, um endereço escrito de outro jeito passaria pelo porteiro como "fora".
 */
function caminhoNormalizado(pathname: string): string {
  let caminho = pathname;
  for (let i = 0; i < 3; i += 1) {
    try {
      const decodificado = decodeURIComponent(caminho);
      if (decodificado === caminho) break;
      caminho = decodificado;
    } catch {
      break;
    }
  }
  return caminho.replace(/[\\/]+/g, '/').toLowerCase();
}

export function ehDaInteligencia(pathname: string): boolean {
  const caminho = caminhoNormalizado(pathname);
  return caminho === ROTA_DA_INTELIGENCIA || caminho.startsWith(`${ROTA_DA_INTELIGENCIA}/`);
}

export type DecisaoDaInteligencia = 'fora' | 'nao_encontrado' | 'login' | 'sem_permissao' | 'entra';

/**
 * O que o porteiro faz com um caminho, sem Next nem Supabase (para testar).
 * `papel` é null quando não há sessão. 'fora' = o caminho não é da Inteligência.
 */
export function porteiroDaInteligencia(
  pathname: string,
  papel: AppRole | null,
  empresa: Empresa = EMPRESA,
): DecisaoDaInteligencia {
  if (!ehDaInteligencia(pathname)) return 'fora';
  if (!empresa.modulos.inteligenciaMercado) return 'nao_encontrado';
  if (papel === null) return 'login';
  if (!PAPEIS_DA_INTELIGENCIA.includes(papel)) return 'sem_permissao';
  return 'entra';
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

  const inteligencia = porteiroDaInteligencia(
    pathname,
    autenticado ? roleFromClaims(data?.claims) : null,
  );
  if (inteligencia === 'nao_encontrado') {
    // A página `/inteligencia` responde "não encontrado" sozinha (`notFound()`), com a
    // tela de sempre; o que estiver embaixo dela (a rota da página pronta) é levado
    // até ela, em vez de ser entregue.
    if (pathname === ROTA_DA_INTELIGENCIA) return response;
    const url = request.nextUrl.clone();
    url.pathname = ROTA_DA_INTELIGENCIA;
    url.search = '';
    return reescreverPreservandoCookies(url, response);
  }
  if (inteligencia === 'sem_permissao') {
    const url = request.nextUrl.clone();
    url.pathname = '/sem-permissao';
    url.search = '';
    return redirecionarPreservandoCookies(url, response);
  }
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

/** Reescreve (mesmo endereço na barra, outra rota por dentro) sem perder cookies de sessão. */
function reescreverPreservandoCookies(url: URL, original: NextResponse): NextResponse {
  const reescrita = NextResponse.rewrite(url);
  original.cookies.getAll().forEach((cookie) => reescrita.cookies.set(cookie));
  return reescrita;
}

/** Redireciona (307) sem perder cookies de sessão eventualmente renovados nesta requisição. */
function redirecionarPreservandoCookies(url: URL, original: NextResponse): NextResponse {
  const redirect = NextResponse.redirect(url);
  original.cookies.getAll().forEach((cookie) => redirect.cookies.set(cookie));
  return redirect;
}
