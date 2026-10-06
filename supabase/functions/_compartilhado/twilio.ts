// =============================================================================
// TRIADE — o que as funções de voz precisam saber do Twilio
//
// Sem SDK, pelo mesmo motivo de `postgrest.ts`: são três coisas pequenas e
// documentadas, e nenhuma delas justifica uma dependência numa função que
// carrega segredo e responde a webhook de fora.
//
//   1. A ASSINATURA DO WEBHOOK (`X-Twilio-Signature`):
//        base = URL exata que o Twilio chamou
//               + cada parâmetro do POST, em ordem alfabética de nome,
//                 nome e valor colados, sem separador
//        assinatura = base64(HMAC_SHA1(auth token, base))
//      A URL é a CONFIGURADA, não a de `req.url`: atrás do gateway do Supabase
//      a função enxerga outro host, e a assinatura deixaria de bater sem nada
//      estar errado.
//
//   2. A CREDENCIAL DO SOFTPHONE (Access Token): um JWT HS256 assinado com o
//      segredo da API Key, com a concessão de voz apontando para o TwiML App.
//      Só SAÍDA: sem `incoming`, o navegador não recebe chamada nenhuma.
//
//   3. O TwiML: XML pequeno, montado com escape — o número e a URL entram como
//      texto, nunca como marcação.
// =============================================================================

import { iguaisEmTempoConstante } from './assinatura.ts';

const codificador = new TextEncoder();

function base64(bytes: ArrayBuffer | Uint8Array): string {
  const vetor = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let binario = '';
  for (const b of vetor) binario += String.fromCharCode(b);
  return btoa(binario);
}

function base64Url(bytes: ArrayBuffer | Uint8Array): string {
  return base64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function hmac(
  algoritmo: 'SHA-1' | 'SHA-256',
  chave: string,
  base: string,
): Promise<ArrayBuffer> {
  const k = await crypto.subtle.importKey(
    'raw',
    codificador.encode(chave),
    { name: 'HMAC', hash: algoritmo },
    false,
    ['sign'],
  );
  return await crypto.subtle.sign('HMAC', k, codificador.encode(base));
}

// ---------------------------------------------------------------------------
// 1. Assinatura do webhook
// ---------------------------------------------------------------------------

/** A base canônica: URL + (nome + valor) de cada parâmetro, em ordem de nome. */
export function baseDoTwilio(url: string, parametros: Record<string, string>): string {
  return Object.keys(parametros)
    .sort()
    .reduce((base, nome) => base + nome + parametros[nome], url);
}

export async function assinarComoTwilio(
  authToken: string,
  url: string,
  parametros: Record<string, string>,
): Promise<string> {
  return base64(await hmac('SHA-1', authToken, baseDoTwilio(url, parametros)));
}

export type ConferenciaDoTwilio =
  { ok: true } | { ok: false; codigo: 'assinatura_ausente' | 'assinatura_invalida' };

export async function verificarDoTwilio(opcoes: {
  authToken: string;
  url: string;
  parametros: Record<string, string>;
  assinaturaRecebida: string | null;
}): Promise<ConferenciaDoTwilio> {
  if (!opcoes.assinaturaRecebida) return { ok: false, codigo: 'assinatura_ausente' };
  const esperada = await assinarComoTwilio(opcoes.authToken, opcoes.url, opcoes.parametros);
  return iguaisEmTempoConstante(esperada, opcoes.assinaturaRecebida)
    ? { ok: true }
    : { ok: false, codigo: 'assinatura_invalida' };
}

/** Corpo `application/x-www-form-urlencoded` → objeto. Nome repetido: vale o último. */
export function parametrosDoFormulario(corpoCru: string): Record<string, string> {
  const saida: Record<string, string> = {};
  for (const [nome, valor] of new URLSearchParams(corpoCru)) saida[nome] = valor;
  return saida;
}

// ---------------------------------------------------------------------------
// 2. Credencial do softphone
// ---------------------------------------------------------------------------

/** Uma hora. O navegador pede outra antes de vencer (`tokenWillExpire`). */
export const VALIDADE_DA_CREDENCIAL_SEG = 3600;

export async function credencialDeVoz(opcoes: {
  accountSid: string;
  apiKeySid: string;
  apiKeySecret: string;
  twimlAppSid: string;
  identidade: string;
  validadeSeg?: number;
  agoraSeg?: number;
}): Promise<string> {
  const agora = opcoes.agoraSeg ?? Math.floor(Date.now() / 1000);
  const cabecalho = { typ: 'JWT', alg: 'HS256', cty: 'twilio-fpa;v=1' };
  const corpo = {
    jti: `${opcoes.apiKeySid}-${agora}-${crypto.randomUUID().slice(0, 8)}`,
    iss: opcoes.apiKeySid,
    sub: opcoes.accountSid,
    iat: agora,
    exp: agora + (opcoes.validadeSeg ?? VALIDADE_DA_CREDENCIAL_SEG),
    grants: {
      identity: opcoes.identidade,
      voice: { outgoing: { application_sid: opcoes.twimlAppSid } },
    },
  };
  const base =
    base64Url(codificador.encode(JSON.stringify(cabecalho))) +
    '.' +
    base64Url(codificador.encode(JSON.stringify(corpo)));
  return `${base}.${base64Url(await hmac('SHA-256', opcoes.apiKeySecret, base))}`;
}

// ---------------------------------------------------------------------------
// 3. TwiML
// ---------------------------------------------------------------------------

function xml(texto: string): string {
  return texto
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** Segundos que o telefone do parceiro toca antes de virar "não atendeu". */
export const SEGUNDOS_TOCANDO = 30;

/**
 * Liga o navegador ao telefone. `answerOnBridge` faz quem ligou ouvir o toque de
 * verdade, e a chamada só conta como atendida quando alguém atende do outro lado.
 * Sem `record`: gravação está fora desta versão.
 */
export function twimlDiscar(opcoes: { para: string; de: string; urlDeEstado: string }): string {
  return (
    '<?xml version="1.0" encoding="UTF-8"?>' +
    `<Response><Dial callerId="${xml(opcoes.de)}" answerOnBridge="true" timeout="${SEGUNDOS_TOCANDO}">` +
    `<Number statusCallback="${xml(opcoes.urlDeEstado)}" statusCallbackMethod="POST" ` +
    `statusCallbackEvent="initiated ringing answered completed">${xml(opcoes.para)}</Number>` +
    '</Dial></Response>'
  );
}

/** Encerra sem discar para ninguém. */
export function twimlDesligar(): string {
  return '<?xml version="1.0" encoding="UTF-8"?><Response><Hangup/></Response>';
}

export function respostaTwiml(corpo: string, status = 200): Response {
  return new Response(corpo, {
    status,
    headers: { 'Content-Type': 'text/xml; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
