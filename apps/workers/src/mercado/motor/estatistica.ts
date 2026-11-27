/**
 * As contas do motor das vantagens: estatística exata (sem sorteio) e os
 * formatos de número e data das frases. Porte fiel de `js/55-argumentos.js`
 * (protótipo da Inteligência de mercado, §1 do ImovaIntel): a MESMA conta, na
 * mesma ordem, para o teste de ouro dar igual bit a bit.
 */

export const temNum = (v: unknown): v is number => typeof v === 'number' && isFinite(v);

/** Sem acento e em minúsculas (o `semAc` do protótipo). */
export const semAc = (s: unknown): string =>
  String(s || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();

export const ord = (v: unknown[]): number[] => v.filter(temNum).sort((a, b) => a - b);

export function quantil(s: number[], q: number): number | null {
  if (!s.length) return null;
  const p = (s.length - 1) * q;
  const b = Math.floor(p);
  const r = p - b;
  return s[b + 1] !== undefined ? s[b]! + r * (s[b + 1]! - s[b]!) : s[b]!;
}

/* lnC e binCdf guardam o que já calcularam: a mesma conta, na mesma ordem, sem repetir. */
const LNC = new Map<number, number>();
const BIN = new Map<string, number>();
export function lnC(n: number, k: number): number {
  const ch = n * 65536 + k;
  let s = LNC.get(ch);
  if (s !== undefined) return s;
  s = 0;
  for (let i = 1; i <= k; i++) s += Math.log(n - k + i) - Math.log(i);
  LNC.set(ch, s);
  return s;
}
export function binCdf(k: number, n: number, p = 0.5): number {
  if (k < 0) return 0;
  const ch = `${k}|${n}|${p}`;
  let r = BIN.get(ch);
  if (r !== undefined) return r;
  let s = 0;
  for (let i = 0; i <= Math.min(k, n); i++)
    s += Math.exp(lnC(n, i) + i * Math.log(p) + (n - i) * Math.log(1 - p));
  r = Math.min(1, s);
  BIN.set(ch, r);
  return r;
}
export const pSinal = (kRuim: number, n: number): number => binCdf(kRuim, n);

export function wilson(k: number, n: number, z = 1.96): { lo: number | null; hi: number | null } {
  if (!n) return { lo: null, hi: null };
  const p = k / n;
  const d = 1 + (z * z) / n;
  const c = p + (z * z) / (2 * n);
  const m = z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n));
  return { lo: (c - m) / d, hi: (c + m) / d };
}

export function icMediana(s: number[], conf: number): [number | null, number | null] {
  const n = s.length;
  const a = (1 - conf) / 2;
  let j = 0;
  for (let k = 1; k <= Math.floor(n / 2); k++) {
    if (binCdf(k - 1, n) <= a) j = k;
    else break;
  }
  return j ? [s[j - 1]!, s[n - j]!] : [null, null];
}

export function percentil(s: number[], v: number): number {
  let ab = 0;
  let ig = 0;
  for (const x of s) {
    if (x < v) ab++;
    else if (x === v) ig++;
  }
  return (ab + ig / 2) / s.length;
}

/** Benjamini-Hochberg: marca `bh` em cada item com p (q = 10%). */
export function bh<T extends { p: number | null | undefined; bh?: boolean }>(c: T[], q = 0.1): T[] {
  const s = c.filter((x) => temNum(x.p)).sort((a, b) => (a.p as number) - (b.p as number));
  const m = s.length;
  let kmax = 0;
  s.forEach((x, i) => {
    if ((x.p as number) <= ((i + 1) / m) * q) kmax = i + 1;
  });
  s.forEach((x, i) => {
    x.bh = i < kmax;
  });
  return c;
}

/* ---------------- formatos ---------------- */
export const pct = (x: unknown): string =>
  temNum(x) ? `${x > 0 ? '+' : x < 0 ? '−' : ''}${Math.abs(Math.round(x * 100))}%` : '—';
export const dec = (x: unknown, n = 2): string =>
  temNum(x) ? x.toFixed(n).replace('.', ',') : '—';
export const fmt = (n: unknown): string => Number(n).toLocaleString('pt-BR');
export const fmt1 = (n: unknown): string =>
  Number(n).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
export const brlCurto = (v: unknown): string =>
  !temNum(v)
    ? '—'
    : v >= 1e6
      ? `R$ ${(v / 1e6).toLocaleString('pt-BR', { maximumFractionDigits: 2 })} mi`
      : v >= 1e4
        ? `R$ ${Math.round(v / 1e3).toLocaleString('pt-BR')} mil`
        : `R$ ${fmt(Math.round(v))}`;

export const MESES_L = [
  'janeiro',
  'fevereiro',
  'março',
  'abril',
  'maio',
  'junho',
  'julho',
  'agosto',
  'setembro',
  'outubro',
  'novembro',
  'dezembro',
];
export const somaDias = (iso: string, d: number): string => {
  const t = new Date(`${iso}T12:00:00Z`);
  t.setUTCDate(t.getUTCDate() + d);
  return t.toISOString().slice(0, 10);
};
export const somaMeses = (iso: string, m: number): string => {
  const t = new Date(`${iso}T12:00:00Z`);
  t.setUTCMonth(t.getUTCMonth() + m);
  return t.toISOString().slice(0, 10);
};
/** Aposto ("Tibau do Sul, município de Pipa,") fecha com vírgula. */
export const apos = (s: string): string => (/,/.test(s) ? `${s},` : s);
export const dataBR = (iso: string | null | undefined): string =>
  iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : '';
export const mesDe = (iso: string): string => MESES_L[+String(iso).slice(5, 7) - 1]!;
/** A referência interna do caderno ("(FICHA 2)") sai do que vai ao cliente. */
export const semFicha = (t: string | null | undefined): string | null | undefined =>
  t == null
    ? t
    : String(t)
        .replace(/\s*\((?:FICHA|nota)\b[^)]*\)/gi, '')
        .trim();
