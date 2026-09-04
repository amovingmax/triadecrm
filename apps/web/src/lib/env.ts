/**
 * Variáveis de ambiente públicas do apps/web (prefixo NEXT_PUBLIC_).
 *
 * O Next.js só substitui `process.env.NEXT_PUBLIC_*` no bundle do navegador quando o acesso é literal,
 * por isso cada variável tem a própria função em vez de um acesso dinâmico por nome.
 */

function exigir(nome: string, valor: string | undefined): string {
  if (!valor) {
    throw new Error(
      `Variável de ambiente ${nome} não definida. Copie apps/web/.env.example para apps/web/.env.local ` +
        'e preencha com os valores impressos por `supabase status`.',
    );
  }
  return valor;
}

/** URL da API do Supabase (local: http://127.0.0.1:54321). */
export function supabaseUrl(): string {
  return exigir('NEXT_PUBLIC_SUPABASE_URL', process.env.NEXT_PUBLIC_SUPABASE_URL);
}

/** Chave anônima (pública) do Supabase — sempre sob RLS. */
export function supabaseAnonKey(): string {
  return exigir('NEXT_PUBLIC_SUPABASE_ANON_KEY', process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
}

/** URL pública da aplicação; usada em redirecionamentos absolutos e na metadata. */
export function appUrl(): string {
  return process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';
}
