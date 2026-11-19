import { NextResponse, type NextRequest } from 'next/server';

import { type AppRole, isAppRole, roleFromClaims } from '@/lib/auth/role';
import { conferirEmpresaDoBanco } from '@/lib/conferir-empresa';
import { EMPRESA } from '@/lib/empresa';
import { createClient } from '@/lib/supabase/server';
import {
  PAPEIS_DA_INTELIGENCIA,
  ROTA_DA_INTELIGENCIA,
  ROTA_INICIAL,
} from '@/lib/supabase/middleware';

import {
  aindaIgual,
  cabecalhosDaPaginaPronta,
  cabecalhosDePaginaSimples,
  paginaSimples,
} from '../cabecalhos';
import { lerPaginaPronta } from '../pagina-pronta';

/**
 * `/inteligencia/painel`: entrega a página pronta da Inteligência de mercado (revisão
 * de 18/11/2026; antes era um arquivo em `public/`, guardado só pelo proxy).
 *
 * Confere tudo aqui, no servidor, antes de mandar um byte:
 *  1. a empresa tem o módulo (na KOMUNE, "não encontrado");
 *  2. há sessão (senão, o login, voltando para `/inteligencia`);
 *  3. o papel do token está entre os da Inteligência;
 *  4. o PERFIL NO BANCO confirma: ativo e com papel da lista. Quem foi rebaixado ou
 *     desligado perde o acesso na hora, sem esperar o token vencer (~1 h). A cópia que
 *     o navegador já baixou continua com ele: o `no-cache` só faz perguntar de novo;
 *  5. o banco é desta empresa (`conferirEmpresaDoBanco`, a mesma conferência do layout
 *     do CRM, que esta rota não usa por ficar fora de `(app)`).
 *
 * A página vai com a Content-Security-Policy `sandbox` (ver `../cabecalhos.ts`).
 */
export const dynamic = 'force-dynamic';

function irPara(request: NextRequest, caminho: string, next?: string): NextResponse {
  const url = request.nextUrl.clone();
  url.pathname = caminho;
  url.search = '';
  if (next) url.searchParams.set('next', next);
  return NextResponse.redirect(url);
}

function aviso(status: number, titulo: string, texto: string): Response {
  return new Response(paginaSimples({ titulo, texto, voltarPara: ROTA_INICIAL }), {
    status,
    headers: cabecalhosDePaginaSimples(),
  });
}

type Perfil = { role: unknown; is_active: unknown };

function perfilDaInteligencia(perfil: Perfil | null): boolean {
  if (!perfil || perfil.is_active !== true || !isAppRole(perfil.role)) return false;
  return PAPEIS_DA_INTELIGENCIA.includes(perfil.role as AppRole);
}

export async function GET(request: NextRequest): Promise<Response> {
  if (!EMPRESA.modulos.inteligenciaMercado) {
    return aviso(404, 'Página não encontrada', 'Este endereço não existe neste CRM.');
  }

  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const claims = data?.claims;
  if (!claims) return irPara(request, '/login', ROTA_DA_INTELIGENCIA);
  if (!PAPEIS_DA_INTELIGENCIA.includes(roleFromClaims(claims))) {
    return irPara(request, '/sem-permissao');
  }

  const { data: perfil, error } = await supabase
    .from('profiles')
    .select('role, is_active')
    .eq('id', claims.sub)
    .maybeSingle<Perfil>();
  if (error) {
    console.error('[inteligencia] não deu para conferir o perfil:', error.message);
    return aviso(
      503,
      'Não deu para conferir o seu acesso agora',
      'A Inteligência de mercado só abre depois de o CRM confirmar o seu acesso no banco. Tente de novo em alguns minutos.',
    );
  }
  if (!perfilDaInteligencia(perfil)) return irPara(request, '/sem-permissao');

  const empresa = await conferirEmpresaDoBanco();
  if (!empresa.ok) {
    return aviso(
      503,
      'O CRM não abriu, por segurança',
      `Este endereço é o CRM da ${EMPRESA.nome}, mas o banco de dados ligado a ele é de outra empresa (${empresa.empresaDoBanco}). Avise um administrador.`,
    );
  }

  const pagina = await lerPaginaPronta();
  if (!pagina) {
    return aviso(
      404,
      'A Inteligência de mercado ainda não tem página',
      'A página com os dados do mercado ainda não foi publicada neste CRM. Quando ela for atualizada e publicada, aparece aqui.',
    );
  }

  const cabecalhos = cabecalhosDaPaginaPronta(pagina.etag);
  if (aindaIgual(request.headers.get('if-none-match'), pagina.etag)) {
    return new Response(null, { status: 304, headers: cabecalhos });
  }
  return new Response(pagina.gz as BodyInit, {
    status: 200,
    headers: {
      ...cabecalhos,
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Encoding': 'gzip',
      'Content-Length': String(pagina.gz.byteLength),
    },
  });
}
