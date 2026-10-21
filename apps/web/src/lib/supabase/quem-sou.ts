import type { createClient } from './client';

/**
 * O id de quem está logado, no navegador, sem ida ao servidor de autenticação.
 *
 * `getUser()` pergunta ao Auth toda vez (uma ida à rede, em São Paulo); `getClaims()`
 * valida o JWT aqui mesmo, com a chave pública ES256 do projeto, que a biblioteca
 * guarda em memória (20/10/2026). Para dizer "este lote é meu" ou preencher o autor
 * de uma linha, é o mesmo dado: quem decide o acesso continua sendo a RLS, que
 * confere o mesmo JWT do outro lado.
 */
export async function idDaSessao(
  supabase: ReturnType<typeof createClient>,
): Promise<string | null> {
  const { data } = await supabase.auth.getClaims();
  const sub = data?.claims?.sub;
  return typeof sub === 'string' && sub !== '' ? sub : null;
}
