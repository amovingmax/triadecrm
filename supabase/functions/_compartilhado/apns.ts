// =============================================================================
// TRIADE — o aviso de chamada da Apple (PushKit), direto, sem o Expo.
//
// O serviço de push do Expo só manda o aviso comum. A tela de chamada do iPhone com o
// app fechado precisa do aviso de VOZ da Apple (`apns-push-type: voip`), mandado ao
// servidor da Apple com a chave de avisos da conta (.p8) e um JWT ES256 assinado aqui.
//
// A chave de avisos da conta Apple da KOMUNE é a "Aurora push" (Q2FD3T3CSC), a mesma
// que o Expo usa para os avisos comuns do app (CHANGELOG de 06/11/2026): uma chave de
// avisos serve a todos os apps da equipe e aos dois tipos de aviso.
//
// Sem rede aqui dentro, menos `enviarAvisoDeChamada`. Testes em `apns.test.ts`.
// =============================================================================

export const SERVIDOR_DA_APPLE = 'https://api.push.apple.com';
export const SERVIDOR_DE_TESTE_DA_APPLE = 'https://api.sandbox.push.apple.com';

/** O tópico do aviso de voz é o identificador do app com `.voip` no fim. */
export function topicoDeVoz(idDoApp: string): string {
  return `${idDoApp}.voip`;
}

function base64url(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64urlTexto(texto: string): string {
  return base64url(new TextEncoder().encode(texto));
}

/**
 * O conteúdo do arquivo .p8 (PEM, "BEGIN PRIVATE KEY"). Aceita também o PEM inteiro
 * em base64 numa linha só, que é como ele cabe num segredo do Supabase sem quebras.
 */
export function derDaChave(p8: string): Uint8Array {
  let texto = p8.trim();
  if (!texto.includes('BEGIN')) {
    try {
      const decodificado = atob(texto.replace(/\s+/g, ''));
      if (decodificado.includes('BEGIN')) texto = decodificado;
    } catch {
      // não era base64 do PEM: segue como o corpo da chave
    }
  }
  const corpo = texto
    .replace(/-----BEGIN [A-Z ]+-----/g, '')
    .replace(/-----END [A-Z ]+-----/g, '')
    .replace(/\s+/g, '');
  const bin = atob(corpo);
  const der = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) der[i] = bin.charCodeAt(i);
  return der;
}

export type ChaveDaApple = { p8: string; chaveId: string; equipeId: string };

/** O JWT de provedor da Apple: ES256, `kid` = id da chave, `iss` = equipe, `iat` em segundos. */
export async function jwtDaApple(chave: ChaveDaApple, agoraSeg: number): Promise<string> {
  const cabecalho = base64urlTexto(JSON.stringify({ alg: 'ES256', kid: chave.chaveId }));
  const corpo = base64urlTexto(JSON.stringify({ iss: chave.equipeId, iat: agoraSeg }));
  const privada = await crypto.subtle.importKey(
    'pkcs8',
    derDaChave(chave.p8),
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign'],
  );
  // A Web Crypto devolve a assinatura já no formato do JWS (r || s, 64 bytes).
  const assinatura = new Uint8Array(
    await crypto.subtle.sign(
      { name: 'ECDSA', hash: 'SHA-256' },
      privada,
      new TextEncoder().encode(`${cabecalho}.${corpo}`),
    ),
  );
  return `${cabecalho}.${corpo}.${base64url(assinatura)}`;
}

// A Apple recusa JWT com mais de 1 h e reclama de troca a cada poucos minutos
// (`TooManyProviderTokenUpdates`): um por 40 minutos, por processo.
const VALIDADE_DO_JWT_SEG = 40 * 60;
let jwtGuardado: { chaveId: string; jwt: string; feitoEm: number } | null = null;

export async function jwtEmUso(chave: ChaveDaApple, agoraSeg = Math.floor(Date.now() / 1000)): Promise<string> {
  if (
    jwtGuardado &&
    jwtGuardado.chaveId === chave.chaveId &&
    agoraSeg - jwtGuardado.feitoEm < VALIDADE_DO_JWT_SEG
  ) {
    return jwtGuardado.jwt;
  }
  const jwt = await jwtDaApple(chave, agoraSeg);
  jwtGuardado = { chaveId: chave.chaveId, jwt, feitoEm: agoraSeg };
  return jwt;
}

/** Só para teste. */
export function esquecerJwt(): void {
  jwtGuardado = null;
}

// -----------------------------------------------------------------------------
// O que vai dentro do aviso (o app lê em `apps/app/src/chamada.ts`)
// -----------------------------------------------------------------------------

export type AvisoDeChamada =
  | {
      evento: 'tocar';
      chamada: string;
      quem: string;
      empresa: string;
      empresaNome: string;
      caminho: string | null;
      convite: string;
      funcao: string;
    }
  | { evento: 'parar'; chamada: string; motivo: string | null };

/** O corpo do aviso de voz. Sem telefone: o nome que a tela de chamada mostra e o convite. */
export function corpoDoAviso(a: AvisoDeChamada): Record<string, unknown> {
  if (a.evento === 'parar') {
    return { triade: { v: 1, evento: 'parar', chamada: a.chamada, motivo: a.motivo } };
  }
  return {
    triade: {
      v: 1,
      evento: 'tocar',
      chamada: a.chamada,
      // A tela de chamada corta nomes longos; o limite evita aviso gordo à toa.
      quem: a.quem.slice(0, 80),
      empresa: a.empresa,
      empresa_nome: a.empresaNome.slice(0, 60),
      caminho: a.caminho,
      convite: a.convite,
      funcao: a.funcao,
    },
  };
}

export type ResultadoDaApple = { status: number; motivo: string | null };

/**
 * Manda um aviso de chamada a um aparelho. O "tocar" vence em 45 s (a Meta dá de 30
 * a 60 s para atender: tocar depois disso engana); o "parar" em 2 minutos.
 */
export async function enviarAvisoDeChamada(opcoes: {
  token: string;
  sandbox: boolean;
  topico: string;
  jwt: string;
  aviso: AvisoDeChamada;
  agoraSeg?: number;
  servidor?: string;
}): Promise<ResultadoDaApple> {
  const agora = opcoes.agoraSeg ?? Math.floor(Date.now() / 1000);
  const servidor =
    opcoes.servidor ?? (opcoes.sandbox ? SERVIDOR_DE_TESTE_DA_APPLE : SERVIDOR_DA_APPLE);
  const vence = agora + (opcoes.aviso.evento === 'tocar' ? 45 : 120);
  const controle = new AbortController();
  const tempo = setTimeout(() => controle.abort(), 8_000);
  try {
    const r = await fetch(`${servidor}/3/device/${opcoes.token}`, {
      method: 'POST',
      headers: {
        authorization: `bearer ${opcoes.jwt}`,
        'apns-push-type': 'voip',
        'apns-topic': opcoes.topico,
        'apns-priority': '10',
        'apns-expiration': String(vence),
        'content-type': 'application/json',
      },
      body: JSON.stringify(corpoDoAviso(opcoes.aviso)),
      signal: controle.signal,
    });
    const texto = await r.text();
    let motivo: string | null = null;
    if (!r.ok) {
      try {
        motivo = (JSON.parse(texto) as { reason?: string }).reason ?? null;
      } catch {
        motivo = null;
      }
    }
    return { status: r.status, motivo };
  } catch (e) {
    return { status: 0, motivo: e instanceof Error ? e.name : 'falha_de_rede' };
  } finally {
    clearTimeout(tempo);
  }
}
