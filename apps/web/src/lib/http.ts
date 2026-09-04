/**
 * Utilidades HTTP dos Route Handlers.
 *
 * Em Route Handlers o Next normaliza `request.url`/`request.nextUrl` para o hostname configurado
 * (ex.: localhost), perdendo o host pelo qual o usuário chegou (127.0.0.1, domínio atrás de proxy).
 * Para redirecionamentos absolutos, a origem é montada a partir dos cabeçalhos.
 */
import { type NextRequest } from 'next/server';

import { appUrl } from '@/lib/env';

const HOSTS_LOCAIS = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i;

/** Origem (protocolo + host) da requisição, respeitando `x-forwarded-*` de proxies reversos. */
export function origemDaRequisicao(request: NextRequest): string {
  const host = request.headers.get('x-forwarded-host') ?? request.headers.get('host');
  if (!host) return appUrl();
  const proto =
    request.headers.get('x-forwarded-proto') ?? (HOSTS_LOCAIS.test(host) ? 'http' : 'https');
  return `${proto}://${host}`;
}
