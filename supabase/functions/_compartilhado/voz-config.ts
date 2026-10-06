// =============================================================================
// TRIADE — configuração das funções de voz
//
// Segredo vem de `segredo()` (ambiente → Vault), como em todo o resto. As duas
// URLs não são segredo, mas precisam ser EXATAMENTE as cadastradas no Twilio,
// porque entram na assinatura: por isso são configuradas, e não deduzidas de
// `req.url` (atrás do gateway a função enxerga outro host).
// =============================================================================

import { segredo } from './segredos.ts';

function urlDaFuncao(variavel: string, funcao: string): string {
  const configurada = (Deno.env.get(variavel) ?? '').trim();
  if (configurada.length > 0) return configurada;
  const base = (Deno.env.get('SUPABASE_URL') ?? '').replace(/\/+$/, '');
  return `${base}/functions/v1/${funcao}`;
}

/** A URL que o TwiML App do Twilio chama (Voice Request URL). */
export function urlDoTwiml(): string {
  return urlDaFuncao('TWILIO_TWIML_URL', 'voz-twiml');
}

/** A URL dos avisos de estado, sem o `?ligacao=`. */
export function urlDeEstado(): string {
  return urlDaFuncao('TWILIO_STATUS_CALLBACK_URL', 'voz-status');
}

export const authToken = () => segredo('twilio_auth_token');
export const numeroDeOrigem = () => segredo('twilio_phone_number');

export async function credenciaisDaApi(): Promise<{
  accountSid: string;
  apiKeySid: string;
  apiKeySecret: string;
  twimlAppSid: string;
}> {
  const [accountSid, apiKeySid, apiKeySecret, twimlAppSid] = await Promise.all([
    segredo('twilio_account_sid'),
    segredo('twilio_api_key_sid'),
    segredo('twilio_api_key_secret'),
    segredo('twilio_twiml_app_sid'),
  ]);
  return { accountSid, apiKeySid, apiKeySecret, twimlAppSid };
}

/** 64 KB. Um webhook de voz do Twilio tem algumas centenas de bytes. */
export const TAMANHO_MAXIMO = 64 * 1024;

/** Lê o corpo cru com teto; `null` quando passa dele ou não dá para ler. */
export async function corpoComTeto(req: Request): Promise<string | null> {
  const declarado = Number(req.headers.get('content-length') ?? '0');
  if (Number.isFinite(declarado) && declarado > TAMANHO_MAXIMO) return null;
  try {
    const corpo = await req.text();
    return corpo.length > TAMANHO_MAXIMO ? null : corpo;
  } catch {
    return null;
  }
}
