/**
 * Que endereço o servidor do CRM pode buscar a pedido de alguém (05/11/2026).
 *
 * O importador do sistema atual busca, no servidor, a URL que a pessoa cola (o
 * arquivo VRSync) e as URLs das fotos que vêm dentro dele. Sem esta regra, o
 * servidor viraria uma porta para a rede de dentro: a API do Supabase local, o
 * serviço de metadados da nuvem (169.254.169.254), a API interna da função. Por
 * isso só passa http/https para a internet aberta, na porta padrão, sem usuário
 * e senha no endereço.
 *
 * `permitirLocal` (só fora de produção) libera a rede local e qualquer porta,
 * para ensaiar com o arquivo servido pela própria máquina. O link-local e o
 * serviço de metadados continuam fechados mesmo assim: ninguém ensaia com eles.
 *
 * A rota confere duas vezes: o endereço escrito (aqui) e o IP de verdade, depois
 * de resolver o nome (`ipPermitido`, no `lookup` da conexão). Puro, testado em
 * `seguranca-de-url.test.ts`.
 */

export type UrlAvaliada =
  { ok: true; url: URL } | { ok: false; motivo: 'url_invalida' | 'url_bloqueada' };

/** Nomes que nunca são a internet aberta. */
const SEMPRE_FECHADOS = new Set(['metadata', 'metadata.google.internal', 'instance-data']);

/** Até onde vai um endereço colado por gente. */
const TAMANHO_MAXIMO = 2048;

// ---------------------------------------------------------------------------
// IPv4
// ---------------------------------------------------------------------------

function ipv4(texto: string): number[] | null {
  const partes = texto.split('.');
  if (partes.length !== 4) return null;
  const n = partes.map((p) => (/^\d{1,3}$/.test(p) ? Number(p) : NaN));
  return n.every((x) => x >= 0 && x <= 255) ? n : null;
}

type Faixa = 'publico' | 'local' | 'fechado';

function faixaIpv4([a, b, c]: number[]): Faixa {
  if (a === undefined || b === undefined || c === undefined) return 'fechado';
  // Link-local, inclusive o serviço de metadados da nuvem: fechado sempre.
  if (a === 169 && b === 254) return 'fechado';
  // Multicast, reservado e broadcast: não há o que buscar lá.
  if (a >= 224) return 'fechado';
  if (
    a === 0 || // "esta rede"
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) || // CGNAT
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0 && (c === 0 || c === 2)) || // IETF e documentação
    (a === 198 && (b === 18 || b === 19)) || // testes de desempenho
    (a === 198 && b === 51 && c === 100) || // documentação
    (a === 203 && b === 0 && c === 113) // documentação
  )
    return 'local';
  return 'publico';
}

// ---------------------------------------------------------------------------
// IPv6
// ---------------------------------------------------------------------------

/** "2001:db8::1" → os 8 grupos de 16 bits; aceita o IPv4 no fim ("::ffff:10.0.0.1"). */
function ipv6(texto: string): number[] | null {
  let t = texto.replace(/^\[|\]$/g, '').replace(/%.*$/, '');
  if (!t.includes(':')) return null;
  const v4 = /(\d{1,3}(?:\.\d{1,3}){3})$/.exec(t);
  if (v4) {
    const n = ipv4(v4[1]!);
    if (!n) return null;
    t = `${t.slice(0, v4.index)}${((n[0]! << 8) | n[1]!).toString(16)}:${((n[2]! << 8) | n[3]!).toString(16)}`;
  }
  const metades = t.split('::');
  if (metades.length > 2) return null;
  const grupo = (s: string) => (s === '' ? [] : s.split(':'));
  const antes = grupo(metades[0]!);
  const depois = metades.length === 2 ? grupo(metades[1]!) : [];
  const faltam = 8 - antes.length - depois.length;
  if (metades.length === 1 ? faltam !== 0 : faltam < 1) return null;
  const todos = [
    ...antes,
    ...Array<string>(metades.length === 2 ? faltam : 0).fill('0'),
    ...depois,
  ];
  if (!todos.every((g) => /^[0-9a-f]{1,4}$/i.test(g))) return null;
  return todos.map((g) => parseInt(g, 16));
}

function faixaIpv6(g: number[]): Faixa {
  const [g0 = 0, g1 = 0, g2 = 0, g3 = 0, g4 = 0, g5 = 0, g6 = 0, g7 = 0] = g;
  const embutido = [g6 >> 8, g6 & 0xff, g7 >> 8, g7 & 0xff];
  const zerosAte5 = g0 === 0 && g1 === 0 && g2 === 0 && g3 === 0 && g4 === 0;
  // ::ffff:a.b.c.d (IPv4 mapeado) e ::a.b.c.d (compatível): vale o IPv4 de dentro.
  if (zerosAte5 && (g5 === 0xffff || (g5 === 0 && (g6 !== 0 || g7 > 1))))
    return faixaIpv4(embutido);
  // :: e ::1.
  if (zerosAte5 && g5 === 0 && g6 === 0) return g7 === 1 ? 'local' : 'fechado';
  // NAT64 (64:ff9b::/96): o IPv4 de dentro.
  if (g0 === 0x64 && g1 === 0xff9b && g2 === 0 && g3 === 0 && g4 === 0 && g5 === 0)
    return faixaIpv4(embutido);
  // 6to4 (2002::/16): o IPv4 vem logo depois do prefixo.
  if (g0 === 0x2002) return faixaIpv4([g1 >> 8, g1 & 0xff, g2 >> 8, g2 & 0xff]);
  // Teredo (2001::/32), documentação (2001:db8::/32) e descarte (100::/64).
  if (
    (g0 === 0x2001 && (g1 === 0 || g1 === 0xdb8)) ||
    (g0 === 0x100 && g1 === 0 && g2 === 0 && g3 === 0)
  )
    return 'fechado';
  if ((g0 & 0xffc0) === 0xfe80) return 'fechado'; // link-local
  if ((g0 & 0xff00) === 0xff00) return 'fechado'; // multicast
  if ((g0 & 0xfe00) === 0xfc00 || (g0 & 0xffc0) === 0xfec0) return 'local'; // rede privada
  return 'publico';
}

// ---------------------------------------------------------------------------
// A regra
// ---------------------------------------------------------------------------

/** O IP (v4 ou v6) pode ser alcançado pelo servidor? Endereço que não é IP: não. */
export function ipPermitido(ip: string, permitirLocal = false): boolean {
  const v4 = ipv4(ip);
  const v6 = v4 ? null : ipv6(ip);
  const faixa = v4 ? faixaIpv4(v4) : v6 ? faixaIpv6(v6) : 'fechado';
  return faixa === 'publico' || (permitirLocal && faixa === 'local');
}

/**
 * O endereço colado, pronto para buscar — ou o motivo de não buscar. Sem
 * "https://" na frente, a regra põe (é como a pessoa copia da barra do navegador).
 */
export function avaliarUrl(texto: string, permitirLocal = false): UrlAvaliada {
  let bruto = texto.trim();
  if (bruto === '' || bruto.length > TAMANHO_MAXIMO) return { ok: false, motivo: 'url_invalida' };
  if (!/^[a-z][a-z0-9+.-]*:/i.test(bruto)) bruto = `https://${bruto}`;
  let url: URL;
  try {
    url = new URL(bruto);
  } catch {
    return { ok: false, motivo: 'url_invalida' };
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:')
    return { ok: false, motivo: 'url_invalida' };
  if (url.username || url.password) return { ok: false, motivo: 'url_bloqueada' };
  if (!permitirLocal && url.port !== '' && url.port !== '80' && url.port !== '443')
    return { ok: false, motivo: 'url_bloqueada' };

  // O `URL` já escreve 2130706433 e 0x7f.1 como 127.0.0.1.
  const host = url.hostname.toLowerCase().replace(/\.$/, '');
  if (host === '') return { ok: false, motivo: 'url_invalida' };
  if (SEMPRE_FECHADOS.has(host)) return { ok: false, motivo: 'url_bloqueada' };
  if (host.startsWith('[') || ipv4(host)) {
    return ipPermitido(host, permitirLocal)
      ? { ok: true, url }
      : { ok: false, motivo: 'url_bloqueada' };
  }
  // Nome sem ponto, localhost e os domínios que só existem dentro de uma rede.
  const soDeDentro =
    !host.includes('.') ||
    host === 'localhost' ||
    /\.(localhost|local|internal|intranet|lan|home\.arpa)$/.test(host);
  if (soDeDentro && !permitirLocal) return { ok: false, motivo: 'url_bloqueada' };
  return { ok: true, url };
}
