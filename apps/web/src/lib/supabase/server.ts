/**
 * Cliente Supabase para o servidor (Server Components, Route Handlers e Server Actions).
 * Lê e grava a sessão nos cookies da requisição via `next/headers`.
 */
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

import { supabaseAnonKey, supabaseUrl } from '@/lib/env';

export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(supabaseUrl(), supabaseAnonKey(), {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        } catch {
          // Chamado a partir de um Server Component, onde cookies são somente leitura.
          // Não é problema: o proxy (src/proxy.ts) renova a sessão e regrava os cookies.
        }
      },
    },
  });
}
