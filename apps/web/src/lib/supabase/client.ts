/**
 * Cliente Supabase para o navegador (componentes "use client").
 * A sessão fica em cookies compartilhados com o servidor (@supabase/ssr), não em localStorage.
 */
import { createBrowserClient } from '@supabase/ssr';

import { supabaseAnonKey, supabaseUrl } from '@/lib/env';

export function createClient() {
  return createBrowserClient(supabaseUrl(), supabaseAnonKey());
}
