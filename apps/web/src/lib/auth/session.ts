/**
 * Sessão do usuário no servidor (Server Components, layouts e Route Handlers).
 *
 * `getClaims()` valida o JWT antes de devolver as claims, e o papel sai de `app_metadata.app_role`
 * (RF-ADM-01). Nome e avatar vêm do `user_metadata` preenchido pelo Google no login.
 */
import { redirect } from 'next/navigation';

import { type AppRole, roleFromClaims } from '@/lib/auth/role';
import { createClient } from '@/lib/supabase/server';

export type Sessao = {
  id: string;
  email: string | null;
  nome: string;
  avatarUrl: string | null;
  iniciais: string;
  papel: AppRole;
};

function texto(valor: unknown): string | null {
  return typeof valor === 'string' && valor.trim() ? valor.trim() : null;
}

/** "Heloísa Andrade" → "HA"; "heloisa@komune.app.br" → "H". */
export function iniciaisDe(nome: string): string {
  const partes = nome
    .split(/[\s@._-]+/)
    .filter(Boolean)
    .slice(0, 2);
  const letras = partes.map((p) => p.charAt(0).toUpperCase()).join('');
  return letras || '?';
}

/** Sessão atual ou null quando não há usuário autenticado. */
export async function getSession(): Promise<Sessao | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();
  if (error || !data?.claims) return null;

  const claims = data.claims;
  const meta = (claims.user_metadata ?? {}) as Record<string, unknown>;
  const email = texto(claims.email) ?? texto(meta.email);
  const nome = texto(meta.full_name) ?? texto(meta.name) ?? email ?? 'Usuário';

  return {
    id: claims.sub,
    email,
    nome,
    avatarUrl: texto(meta.avatar_url) ?? texto(meta.picture),
    iniciais: iniciaisDe(nome),
    papel: roleFromClaims(claims),
  };
}

/** Para páginas que exigem login: redireciona para /login quando não há sessão. */
export async function requireSession(): Promise<Sessao> {
  const sessao = await getSession();
  if (!sessao) redirect('/login');
  return sessao;
}

/**
 * Para páginas restritas a certos papéis (ex.: /admin só para admin e gestor).
 * Sem sessão → /login; com sessão mas sem papel permitido → /sem-permissao.
 * A autorização definitiva continua sendo o RLS do banco; isto só evita mostrar telas inúteis.
 */
export async function requireRole(...permitidos: AppRole[]): Promise<Sessao> {
  const sessao = await requireSession();
  if (!permitidos.includes(sessao.papel)) redirect('/sem-permissao');
  return sessao;
}
