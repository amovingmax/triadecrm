/**
 * Papel do usuário (RF-ADM-01).
 *
 * O papel é injetado no JWT pelo Custom Access Token Hook do Supabase a partir de `profiles.role`,
 * em `app_metadata.app_role` — nunca em `user_metadata`, que o próprio usuário pode editar.
 * Este módulo é lógica pura (sem Next/Supabase) para rodar no navegador, no servidor e nos testes.
 */

/** Valores do enum `app.user_role` do banco (PRD RF-ADM-01; R05 §4). */
export const APP_ROLES = [
  'admin',
  'gestor',
  'sdr',
  'embaixador',
  'leitura',
  'financeiro',
  'bot',
] as const;

export type AppRole = (typeof APP_ROLES)[number];

/** Papel assumido quando o JWT não traz `app_role` válido: só leitura, nunca mais que isso. */
export const PAPEL_PADRAO: AppRole = 'leitura';

/** Rótulos exibidos na interface (badge do cabeçalho, listas de usuários). */
export const ROTULO_PAPEL: Record<AppRole, string> = {
  admin: 'Admin',
  gestor: 'Gestor',
  sdr: 'SDR',
  embaixador: 'Embaixador',
  leitura: 'Leitura',
  financeiro: 'Financeiro',
  bot: 'Robô',
};

export function isAppRole(valor: unknown): valor is AppRole {
  return typeof valor === 'string' && (APP_ROLES as readonly string[]).includes(valor);
}

/** Decodifica base64url (JWT) para texto UTF-8 sem depender de Buffer (funciona no navegador). */
function decodificarBase64Url(segmento: string): string {
  const base64 = segmento.replace(/-/g, '+').replace(/_/g, '/');
  const completado = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
  const binario = atob(completado);
  const bytes = Uint8Array.from(binario, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

/**
 * Lê o payload de um JWT sem validar a assinatura. Use apenas para exibir dados de um token que
 * já foi validado (getClaims/getUser); a autorização de verdade é o RLS no Postgres.
 */
export function decodeJwtPayload(token: string): Record<string, unknown> | null {
  const partes = token.split('.');
  const payload = partes[1];
  if (partes.length !== 3 || !payload) return null;
  try {
    const json: unknown = JSON.parse(decodificarBase64Url(payload));
    return json !== null && typeof json === 'object' && !Array.isArray(json)
      ? (json as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/** Extrai o papel de um conjunto de claims (`app_metadata.app_role`), com fallback `leitura`. */
export function roleFromClaims(claims: unknown): AppRole {
  if (claims === null || typeof claims !== 'object') return PAPEL_PADRAO;
  const appMetadata = (claims as Record<string, unknown>).app_metadata;
  if (appMetadata === null || typeof appMetadata !== 'object') return PAPEL_PADRAO;
  const papel = (appMetadata as Record<string, unknown>).app_role;
  return isAppRole(papel) ? papel : PAPEL_PADRAO;
}

/** Extrai o papel do access_token (JWT) da sessão, com fallback `leitura`. */
export function roleFromAccessToken(token: string | null | undefined): AppRole {
  if (!token) return PAPEL_PADRAO;
  return roleFromClaims(decodeJwtPayload(token));
}
