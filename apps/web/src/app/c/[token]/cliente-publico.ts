import { createClient } from '@supabase/supabase-js';

import { supabaseAnonKey, supabaseUrl } from '@/lib/env';

/**
 * Cliente do Supabase da página pública de reivindicação.
 *
 * É deliberadamente OUTRO cliente, e não o de `@/lib/supabase/server`: aquele lê e
 * escreve a sessão nos cookies, e aqui não pode haver sessão nenhuma. Quem abre
 * `/c/<token>` é o dono do buffet, não alguém do time; se um cookie de sessão do
 * CRM estivesse em jogo, um usuário logado que abrisse o link estaria falando com
 * o banco como `authenticated`, e as três funções da página passariam a rodar sob
 * um papel que não é o do visitante.
 *
 * `anon` tem `execute` em exatamente três funções — `abrir_reivindicacao`,
 * `aceitar_reivindicacao` e `recusar_reivindicacao` — e nenhum `grant` de tabela
 * em lugar nenhum (migração 20260904001700 §F.5 e §H). A chave anônima aqui não
 * abre nada além do que o token já abre.
 */
export function clientePublico() {
  return createClient(supabaseUrl(), supabaseAnonKey(), {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { headers: { 'x-triade-superficie': 'reivindicacao' } },
  });
}

/** O token é 32 bytes em hexadecimal. Vale conferir antes de gastar uma ida ao banco. */
export function tokenPlausivel(valor: string): boolean {
  return /^[0-9a-f]{64}$/.test(valor);
}
