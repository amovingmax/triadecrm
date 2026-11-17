// =============================================================================
// TRIADE — a API externa: ler o pedido (chave, caminho, consulta, corpo)
//
// Puro: recebe o que veio na requisição e devolve o que vai para o Postgres, ou
// a recusa. Nada aqui fala com rede ou banco. Quem decide se a chave vale, se a
// rota existe e se o escopo deixa é `public.api_atender` (migração
// 20261117200000); esta parte só garante que o que chega lá tem forma.
// =============================================================================

/** 256 KB. Um lead tem menos de 1 KB; o maior corpo legítimo é um texto de 4.096 letras. */
export const TAMANHO_MAXIMO = 256 * 1024;

/** `trd_<empresa>_<48 hexadecimais>`, como `app.api_chave_nova` gera. */
const FORMATO_DA_CHAVE = /^trd_[a-z]{2,20}_[0-9a-f]{48}$/;

/** Os quatro métodos que alguma rota usa. */
export const METODOS = ['GET', 'POST', 'PATCH', 'DELETE'] as const;
export type Metodo = (typeof METODOS)[number];

export type Recusa = { status: number; codigo: string; mensagem: string };

export type ChaveLida = { ok: true; chave: string; prefixo: string } | ({ ok: false } & Recusa);

/**
 * A chave vem em `Authorization: Bearer <chave>` ou em `X-Api-Key: <chave>`.
 * Os dois existem porque há integradores (planilhas, ferramentas sem código)
 * que só sabem pôr um cabeçalho com nome livre.
 */
export function lerChave(cabecalhos: Headers): ChaveLida {
  const autorizacao = cabecalhos.get('authorization') ?? '';
  const solta = cabecalhos.get('x-api-key') ?? '';
  let chave = '';
  const bearer = /^Bearer\s+(\S+)\s*$/i.exec(autorizacao.slice(0, 300));
  if (bearer) chave = bearer[1];
  else if (solta.trim().length > 0) chave = solta.trim().slice(0, 300);

  if (chave.length === 0) {
    return {
      ok: false,
      status: 401,
      codigo: 'chave_ausente',
      mensagem:
        'Mande a chave da API no cabeçalho Authorization: Bearer <chave>. A chave é criada em Ajustes → Integrações.',
    };
  }
  if (!FORMATO_DA_CHAVE.test(chave)) {
    return {
      ok: false,
      status: 401,
      codigo: 'chave_invalida',
      mensagem:
        'Esta não é uma chave da API do CRM. A chave começa com trd_ e é criada em Ajustes → Integrações.',
    };
  }
  // O começo (`trd_imova_3f9a1c`) é o que a tela mostra: pode ir para o log.
  return { ok: true, chave, prefixo: chave.slice(0, chave.indexOf('_', 4) + 7) };
}

/** SHA-256 em hexadecimal: é o que o banco guarda e compara. */
export async function resumoDaChave(chave: string): Promise<string> {
  const bruto = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(chave));
  return Array.from(new Uint8Array(bruto))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * O caminho depois do nome da função. O gateway entrega `/api/v1/fichas`; pela
 * URL pública inteira chega `/functions/v1/api/v1/fichas`. Os dois viram
 * `v1/fichas`. Barra no fim e barra dobrada não mudam nada.
 */
export function caminhoDaRota(pathname: string): string {
  let partes = pathname.split('/').filter((p) => p.length > 0);
  if (partes[0] === 'functions' && partes[1] === 'v1') partes = partes.slice(2);
  if (partes[0] === 'api') partes = partes.slice(1);
  return partes
    .map((p) => {
      try {
        return decodeURIComponent(p);
      } catch {
        return p;
      }
    })
    .join('/')
    .slice(0, 500);
}

/** A consulta como objeto de textos (o último valor de cada nome vence), com teto. */
export function consultaDaUrl(url: URL): Record<string, string> {
  const saida: Record<string, string> = {};
  let n = 0;
  for (const [nome, valor] of url.searchParams) {
    if (++n > 30) break;
    saida[nome.slice(0, 50)] = valor.slice(0, 500);
  }
  return saida;
}

export type CorpoLido = { ok: true; corpo: unknown } | ({ ok: false } & Recusa);

/** Lê o corpo cru com teto, sem confiar no Content-Length. */
export async function lerCorpoCru(req: Request, limite = TAMANHO_MAXIMO): Promise<string | null> {
  if (!req.body) return '';
  const leitor = req.body.getReader();
  const pedacos: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await leitor.read();
    if (done) break;
    total += value.byteLength;
    if (total > limite) {
      await leitor.cancel();
      return null;
    }
    pedacos.push(value);
  }
  const tudo = new Uint8Array(total);
  let pos = 0;
  for (const p of pedacos) {
    tudo.set(p, pos);
    pos += p.byteLength;
  }
  return new TextDecoder().decode(tudo);
}

/**
 * O corpo de POST e PATCH: vazio vira `null` (rotas como `/teste` não pedem
 * corpo); o resto tem de ser um objeto JSON.
 */
export function interpretarCorpo(texto: string | null): CorpoLido {
  if (texto === null) {
    return {
      ok: false,
      status: 413,
      codigo: 'corpo_grande_demais',
      mensagem: 'O corpo passa de 256 KB.',
    };
  }
  if (texto.trim().length === 0) return { ok: true, corpo: null };
  let corpo: unknown;
  try {
    corpo = JSON.parse(texto);
  } catch {
    return {
      ok: false,
      status: 400,
      codigo: 'corpo_invalido',
      mensagem: 'O corpo não é JSON válido. Mande Content-Type: application/json e um objeto.',
    };
  }
  if (corpo === null || typeof corpo !== 'object' || Array.isArray(corpo)) {
    return {
      ok: false,
      status: 400,
      codigo: 'corpo_invalido',
      mensagem: 'O corpo precisa ser um objeto JSON, por exemplo {"nome": "Maria"}.',
    };
  }
  return { ok: true, corpo };
}

/** `Idempotency-Key`, aparada; o banco recusa acima de 200 caracteres. */
export function chaveDeIdempotencia(cabecalhos: Headers): string | null {
  const v = (cabecalhos.get('idempotency-key') ?? '').trim();
  return v.length === 0 ? null : v.slice(0, 201);
}
