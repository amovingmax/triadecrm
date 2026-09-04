/**
 * Volta do Google (Supabase Auth, fluxo PKCE): troca o `code` pela sessão, grava os cookies e
 * redireciona para o destino pedido (`?next=`, sempre um caminho interno) ou para a rota inicial.
 */
import { NextResponse, type NextRequest } from 'next/server';

import { origemDaRequisicao } from '@/lib/http';
import { destinoSeguro } from '@/lib/supabase/middleware';
import { createClient } from '@/lib/supabase/server';

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const base = origemDaRequisicao(request);
  const next = destinoSeguro(searchParams.get('next'));

  // O provedor recusou, ou o gatilho da allowlist abortou a criação do usuário.
  if (searchParams.get('error')) {
    const detalhe = searchParams.get('error_description') ?? searchParams.get('error_code');
    return NextResponse.redirect(`${base}/login?erro=${motivoDoProvedor(detalhe)}`);
  }

  const code = searchParams.get('code');
  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(`${base}${next}`);
    }
    return NextResponse.redirect(`${base}/login?erro=${motivoDaTroca(error.message)}`);
  }

  return NextResponse.redirect(`${base}/login?erro=callback`);
}

/** Compara sem acento: a mensagem chega do Postgres, do GoTrue ou já reescrita. */
function semAcento(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

/**
 * Duas origens de recusa, e a saída de cada uma é diferente:
 *
 * - `app.handle_new_auth_user` aborta o INSERT em `auth.users` quando o e-mail não está
 *   em `allowed_users` nem em `allowed_domains`. O GoTrue devolve o callback com
 *   `?error=` e a mensagem do banco (ou o embrulho genérico "Database error saving new
 *   user") em `error_description`. Aqui "tentar de novo" nunca funciona: a saída é entrar
 *   com o e-mail da empresa ou pedir liberação a um admin.
 * - `public.custom_access_token_hook` recusa o token com HTTP 403 (sem perfil no CRM,
 *   conta desativada) na troca do código pela sessão.
 *
 * Sem essa leitura os dois casos virariam o mesmo erro cru, e a pessoa ficaria clicando
 * em Entrar sem nunca conseguir.
 */
function motivoConhecido(
  mensagem: string | null | undefined,
): 'nao-autorizado' | 'sem-perfil' | 'desativado' | null {
  const texto = semAcento(mensagem ?? '');
  // Ordem importa: a allowlist é a única causa de INSERT abortado neste schema, e a
  // mensagem específica vem antes do embrulho genérico do GoTrue.
  if (texto.includes('nao autorizado')) return 'nao-autorizado';
  if (texto.includes('sem perfil')) return 'sem-perfil';
  if (texto.includes('desativado')) return 'desativado';
  if (texto.includes('database error saving new user')) return 'nao-autorizado';
  return null;
}

/** Recusa vinda do provedor. Cancelar no Google ("access_denied") segue em "tente de novo". */
function motivoDoProvedor(mensagem: string | null | undefined) {
  return motivoConhecido(mensagem) ?? 'provedor';
}

/** Falha na troca do código pela sessão: o padrão fala do login, não do Google. */
function motivoDaTroca(mensagem: string | undefined) {
  return motivoConhecido(mensagem) ?? 'callback';
}
