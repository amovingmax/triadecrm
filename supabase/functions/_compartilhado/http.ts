// =============================================================================
// TRIADE — respostas HTTP das Edge Functions
//
// Regra única: o que sai é uma frase em português que diz o que fazer; o que
// fica no log é o suficiente para descobrir o porquê. Nunca o contrário, e
// nunca os dois misturados — mensagem de erro detalhada é mapa para quem está
// sondando a porta.
// =============================================================================

export const CORS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type, idempotency-key, ' +
    'x-komune-signature, x-komune-timestamp, x-komune-delivery, ' +
    'x-triade-signature, x-triade-timestamp',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Max-Age': '86400',
};

export function json(corpo: unknown, status = 200, extras: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(corpo), {
    status,
    headers: { ...CORS, ...extras, 'Content-Type': 'application/json; charset=utf-8' },
  });
}

/**
 * Erro para o cliente + registro para nós.
 *
 * `mensagem` é o que a pessoa lê e é sempre acionável. `codigo` é estável e
 * serve para a outra ponta programar em cima. `interno` só vai para o log.
 */
export function erro(
  status: number,
  codigo: string,
  mensagem: string,
  interno?: unknown,
  contexto: Record<string, unknown> = {},
): Response {
  registrar('erro', {
    codigo,
    status,
    ...contexto,
    interno: interno instanceof Error ? interno.message : interno,
  });
  return json({ ok: false, codigo, mensagem }, status);
}

/**
 * Log estruturado, sem PII e sem segredo.
 *
 * Telefone, e-mail, token e corpo de mensagem NÃO entram aqui. Identificamos
 * pelo id (`pre_registration_id`, `organization_id`), que é pseudônimo dentro
 * do nosso próprio banco e não diz nada fora dele.
 */
export function registrar(nivel: 'info' | 'aviso' | 'erro', dados: Record<string, unknown>): void {
  const linha = JSON.stringify({ nivel, em: new Date().toISOString(), ...dados });
  if (nivel === 'erro') console.error(linha);
  else console.log(linha);
}

export function preflight(req: Request): Response | null {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  return null;
}

/** Recusa método fora da lista com a frase certa. */
export function exigirMetodo(req: Request, permitidos: string[]): Response | null {
  if (permitidos.includes(req.method)) return null;
  return erro(
    405,
    'metodo_nao_permitido',
    `Esta função aceita ${permitidos.join(' ou ')}. Refaça a chamada com o método certo.`,
    undefined,
    { metodo: req.method },
  );
}
