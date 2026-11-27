/**
 * O MODELO DE PREÇO no worker (27/11/2026): porte de `js/10-modelo-preco.js` do
 * protótipo (v2, 17/11/2026), só o que o motor das vantagens precisa.
 *
 * Até aqui o motor rodava sem ele (`efeitos` vazio): a comparação de preço (P1) e os
 * atributos que somam valor (A1) nunca saíam. Com ele, a homogeneização (quanto o
 * tamanho, os quartos e as vagas mudam o m²) e a previsão de cada imóvel nosso (`pv`)
 * passam a ser calculadas com os anúncios da própria rodada.
 *
 * O que é (igual ao protótipo):
 *   - regressão hedônica do log do m², separada para terreno e para construído;
 *   - fora: anúncio marcado como suspeito e terreno acima de 2 ha;
 *   - limpeza: corta o m² fora de 1,5 × intervalo interquartil (em log) dentro de
 *     região × tipo (recua para macrorregião × tipo e depois tipo, com menos de 8);
 *   - regiões: indicador próprio só com 8+ anúncios, dentro da macrorregião, encolhido
 *     para ela (Bayes empírico, variância entre regiões pelo método dos momentos);
 *   - tamanho em log-log, inclinação própria para apartamento;
 *   - regressão robusta de Huber (anúncio muito fora pesa menos);
 *   - característica sim/não só com 10+ anúncios de cada lado; pelo menos 5 anúncios
 *     por coeficiente; a que o modelo não separa (erro-padrão > 1) sai;
 *   - modelo só com 40 anúncios ou mais.
 * Fica de fora: a validação cruzada e a faixa de praia (o banco não tem a distância
 * até a praia), que o motor não lê.
 */
import { quantil, semAc, temNum } from './estatistica';
import type { AnuncioDaBase, EfeitoDoModelo, PrevisaoDoModelo } from './tipos';

const MIN_MODELO = 40;
const MP_MIN_REGIAO = 8;
const MP_MIN_INDICIO = 30;
const MP_MIN_FLAG = 10;
const MP_NIVEL = 0.9;
const MP_IQR = 1.5;
const MP_AREA_MAX_TERRENO = 20000;
const MP_TAU2_MIN = 0.0025;

type Base = 'terreno' | 'construido';
type Vetor = number[];
type Matriz = number[][];

const BASE_DO_GRUPO: Record<string, Base> = {
  terreno_todos: 'terreno',
  terreno_p: 'terreno',
  terreno_m: 'terreno',
  terreno_g: 'terreno',
  casa: 'construido',
  casa_condominio: 'construido',
  apartamento: 'construido',
};
export const baseDoGrupo = (g: string | null | undefined): Base | null =>
  (g && BASE_DO_GRUPO[g]) || null;
const grupoDoTerreno = (area: number): string =>
  area <= 500 ? 'terreno_p' : area <= 2000 ? 'terreno_m' : 'terreno_g';

/* ---------------- álgebra e distribuições ---------------- */
function inverter(M: Matriz): Matriz | null {
  const n = M.length;
  const A = M.map((r, i) => [...r, ...Array.from({ length: n }, (_, j) => +(i === j))]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(A[r]![c]!) > Math.abs(A[p]![c]!)) p = r;
    if (Math.abs(A[p]![c]!) < 1e-12) return null;
    [A[c], A[p]] = [A[p]!, A[c]!];
    const d = A[c]![c]!;
    for (let j = 0; j < 2 * n; j++) A[c]![j]! /= d;
    for (let r = 0; r < n; r++)
      if (r !== c) {
        const f = A[r]![c]!;
        if (f) for (let j = 0; j < 2 * n; j++) A[r]![j]! -= f * A[c]![j]!;
      }
  }
  return A.map((r) => r.slice(n));
}
const dot = (x: Vetor, b: Vetor): number => {
  let s = 0;
  for (let j = 0; j < x.length; j++) s += x[j]! * b[j]!;
  return s;
};
const mediana = (v: number[]): number | null =>
  v.length ? quantil([...v].sort((a, b) => a - b), 0.5) : null;
const quad = (M: Matriz, x: Vetor): number => {
  let s = 0;
  for (let i = 0; i < x.length; i++) {
    if (!x[i]) continue;
    let t = 0;
    for (let j = 0; j < x.length; j++) t += M[i]![j]! * x[j]!;
    s += x[i]! * t;
  }
  return s;
};
function quantilNormal(p: number): number {
  const a = [
    -39.69683028665376, 220.9460984245205, -275.9285104469687, 138.357751867269,
    -30.66479806614716, 2.506628277459239,
  ];
  const b = [
    -54.47609879822406, 161.5858368580409, -155.6989798598866, 66.80131188771972,
    -13.28068155288572,
  ];
  const c = [
    -0.007784894002430293, -0.3223964580411365, -2.400758277161838, -2.549732539343734,
    4.374664141464968, 2.938163982698783,
  ];
  const d = [0.007784695709041462, 0.3224671290700398, 2.445134137142996, 3.754408661907416];
  if (p < 0.02425) {
    const q = Math.sqrt(-2 * Math.log(p));
    return (
      (((((c[0]! * q + c[1]!) * q + c[2]!) * q + c[3]!) * q + c[4]!) * q + c[5]!) /
      ((((d[0]! * q + d[1]!) * q + d[2]!) * q + d[3]!) * q + 1)
    );
  }
  if (p > 0.97575) return -quantilNormal(1 - p);
  const q = p - 0.5;
  const r = q * q;
  return (
    ((((((a[0]! * r + a[1]!) * r + a[2]!) * r + a[3]!) * r + a[4]!) * r + a[5]!) * q) /
    (((((b[0]! * r + b[1]!) * r + b[2]!) * r + b[3]!) * r + b[4]!) * r + 1)
  );
}
/** Quantil t de Student (Cornish-Fisher; exata a 3 casas para gl ≥ 8). */
function quantilT(p: number, gl: number): number {
  const z = quantilNormal(p);
  if (!(gl > 0)) return z;
  const z2 = z * z;
  return (
    z +
    (z * (z2 + 1)) / (4 * gl) +
    (z * (5 * z2 * z2 + 16 * z2 + 3)) / (96 * gl * gl) +
    (z * (3 * z2 ** 3 + 19 * z2 * z2 + 17 * z2 - 15)) / (384 * gl ** 3) +
    (z * (79 * z2 ** 4 + 776 * z2 ** 3 + 1482 * z2 * z2 - 1920 * z2 - 945)) / (92160 * gl ** 4)
  );
}
const NAO_NULOS = new WeakMap<Matriz, number[][]>();
function naoNulos(X: Matriz): number[][] {
  let z = NAO_NULOS.get(X);
  if (!z) {
    z = X.map((r) => {
      const o: number[] = [];
      for (let j = 0; j < r.length; j++) if (r[j]) o.push(j);
      return o;
    });
    NAO_NULOS.set(X, z);
  }
  return z;
}
function gram(X: Matriz, w: Vetor | null, pen: Vetor): Matriz {
  const n = X.length;
  const k = X[0]!.length;
  const Z = naoNulos(X);
  const A = Array.from({ length: k }, () => new Array<number>(k).fill(0));
  for (let t = 0; t < n; t++) {
    const r = X[t]!;
    const z = Z[t]!;
    const wt = w ? w[t]! : 1;
    if (!wt) continue;
    for (let p = 0; p < z.length; p++) {
      const i = z[p]!;
      const ri = r[i]! * wt;
      const Ai = A[i]!;
      for (let q = p; q < z.length; q++) Ai[z[q]!]! += ri * r[z[q]!]!;
    }
  }
  for (let i = 0; i < k; i++) {
    for (let j = 0; j < i; j++) A[i]![j] = A[j]![i]!;
    A[i]![i]! += pen[i]!;
  }
  return A;
}
function cholesky(A: Matriz): Matriz | null {
  const k = A.length;
  const L = Array.from({ length: k }, () => new Array<number>(k).fill(0));
  for (let i = 0; i < k; i++)
    for (let j = 0; j <= i; j++) {
      let s = A[i]![j]!;
      for (let q = 0; q < j; q++) s -= L[i]![q]! * L[j]![q]!;
      if (i === j) {
        if (!(s > 1e-12)) return null;
        L[i]![i] = Math.sqrt(s);
      } else L[i]![j] = s / L[j]![j]!;
    }
  return L;
}
function resolverCholesky(L: Matriz, v: Vetor): Vetor {
  const k = L.length;
  const z = new Array<number>(k);
  const x = new Array<number>(k);
  for (let i = 0; i < k; i++) {
    let s = v[i]!;
    for (let q = 0; q < i; q++) s -= L[i]![q]! * z[q]!;
    z[i] = s / L[i]![i]!;
  }
  for (let i = k - 1; i >= 0; i--) {
    let s = z[i]!;
    for (let q = i + 1; q < k; q++) s -= L[q]![i]! * x[q]!;
    x[i] = s / L[i]![i]!;
  }
  return x;
}
interface Solucao {
  b: Vetor;
  A: Matriz;
  inv?: Matriz;
  w?: Vetor;
}
function resolver(X: Matriz, y: Vetor, w: Vetor | null, pen: Vetor, comInversa = true): Solucao | null {
  const n = X.length;
  const k = X[0]!.length;
  const Z = naoNulos(X);
  const v = new Array<number>(k).fill(0);
  for (let t = 0; t < n; t++) {
    const r = X[t]!;
    const wt = w ? w[t]! : 1;
    if (!wt) continue;
    for (const i of Z[t]!) v[i]! += r[i]! * wt * y[t]!;
  }
  const A = gram(X, w, pen);
  const L = comInversa ? null : cholesky(A);
  if (L) return { b: resolverCholesky(L, v), A };
  const inv = inverter(A);
  if (!inv) return null;
  return { b: inv.map((r) => dot(r, v)), inv, A };
}
function ajusteRobusto(
  X: Matriz,
  y: Vetor,
  pen: Vetor,
  comInversa = true,
): (Solucao & { w: Vetor }) | null {
  let sol = resolver(X, y, null, pen, false);
  if (!sol) return null;
  let w = y.map(() => 1);
  for (let it = 0; it < 30; it++) {
    const Z = naoNulos(X);
    const r = y.map((v, t) => {
      let p = 0;
      for (const j of Z[t]!) p += X[t]![j]! * sol!.b[j]!;
      return v - p;
    });
    const s = 1.4826 * (mediana(r.map(Math.abs)) ?? 0) || 1e-9;
    const c = 1.345 * s;
    const w2 = r.map((v) => (Math.abs(v) <= c ? 1 : c / Math.abs(v)));
    const nova = resolver(X, y, w2, pen, false);
    if (!nova) break;
    let dif = 0;
    for (let j = 0; j < nova.b.length; j++) dif = Math.max(dif, Math.abs(nova.b[j]! - sol.b[j]!));
    sol = nova;
    w = w2;
    if (dif < 1e-5) break;
  }
  if (comInversa && !sol.inv) {
    const inv = inverter(sol.A);
    if (!inv) return null;
    sol = { ...sol, inv };
  }
  return { ...sol, w };
}
interface Estatisticas {
  yh: Vetor;
  gl: number;
  s2: number;
  r2: number;
  cov: Matriz;
  se: Vetor;
}
function estatisticas(
  X: Matriz,
  y: Vetor,
  fit: Solucao & { w: Vetor; inv: Matriz },
  pen: Vetor,
): Estatisticas {
  const n = X.length;
  const k = X[0]!.length;
  const { b, inv, w } = fit;
  const yh = X.map((r) => dot(r, b));
  const res = y.map((v, t) => v - yh[t]!);
  const pef = k - inv.reduce((s, row, i) => s + row[i]! * pen[i]!, 0);
  const gl = Math.max(1, n - pef);
  const sse = res.reduce((s, v) => s + v * v, 0);
  const s2 = sse / gl;
  const my = y.reduce((a, c) => a + c, 0) / n;
  const sst = y.reduce((s, v) => s + (v - my) ** 2, 0);
  const M = gram(
    X,
    w.map((v) => v * v),
    pen,
  );
  const IM = inv.map((r) =>
    Array.from({ length: k }, (_, j) => {
      let s = 0;
      for (let q = 0; q < k; q++) s += r[q]! * M[q]![j]!;
      return s;
    }),
  );
  const cov = IM.map((r) =>
    Array.from({ length: k }, (_, j) => {
      let s = 0;
      for (let q = 0; q < k; q++) s += r[q]! * inv[q]![j]!;
      return s2 * s;
    }),
  );
  return {
    yh,
    gl,
    s2,
    r2: sst ? 1 - sse / sst : 0,
    cov,
    se: cov.map((r, i) => Math.sqrt(Math.max(0, r[i]!))),
  };
}

/* ---------------- dados de entrada ---------------- */
function agrupar<T>(l: T[], f: (a: T) => string): Record<string, T[]> {
  const o: Record<string, T[]> = {};
  for (const a of l) (o[f(a)] ||= []).push(a);
  return o;
}
function contar<T>(l: T[], f: (a: T) => string): Record<string, number> {
  const o: Record<string, number> = {};
  for (const a of l) {
    const k = f(a);
    o[k] = (o[k] || 0) + 1;
  }
  return o;
}
type Ponto = AnuncioDaBase;
function flag(a: Ponto, f: string, base: Base): boolean {
  if (f === 'apartamento') return a.grupo === 'apartamento';
  if (f === 'condominio_fechado')
    return base === 'construido'
      ? a.grupo === 'casa_condominio' || (a.grupo !== 'apartamento' && a.condominio_fechado === true)
      : a.condominio_fechado === true;
  return a[f] === true;
}
function foraDoEscopo(a: Ponto, base: Base): string | null {
  if (base === 'terreno' && a.area > MP_AREA_MAX_TERRENO)
    return 'terreno acima de 2 hectares (gleba: outro mercado)';
  if (a.usado_nas_medias === false) return 'marcado como suspeito no levantamento';
  return null;
}
const BAIRRO = new WeakMap<object, string>();
const bairroDe = (a: Ponto): string => {
  let b = BAIRRO.get(a);
  if (b === undefined) {
    b = semAc(String(a.bairro || '').split(/[(,]/)[0]).trim();
    BAIRRO.set(a, b);
  }
  return b;
};

interface Contexto {
  macroDe: (reg: string) => string;
}

function cercas(pts: Ponto[], cx: Contexto): (a: Ponto) => { lo: number; hi: number } | null {
  const niveis: Array<(a: Ponto) => string> = [
    (a) => `${a.regiao}|${a.grupo}`,
    (a) => `${cx.macroDe(a.regiao)}|${a.grupo}`,
    (a) => a.grupo,
  ];
  const mapas = niveis.map((f) => {
    const o: Record<string, { lo: number; hi: number }> = {};
    for (const [k, l] of Object.entries(agrupar(pts, f))) {
      if (l.length < MP_MIN_REGIAO) continue;
      const s = l.map((a) => Math.log(a.m2)).sort((x, y) => x - y);
      const q1 = quantil(s, 0.25)!;
      const q3 = quantil(s, 0.75)!;
      const d = Math.max(MP_IQR * (q3 - q1), 0.3);
      o[k] = { lo: q1 - d, hi: q3 + d };
    }
    return o;
  });
  return (a) => {
    for (let i = 0; i < niveis.length; i++) {
      const c = mapas[i]![niveis[i]!(a)];
      if (c) return c;
    }
    return null;
  };
}

/* ---------------- desenho do modelo ---------------- */
interface Desenho {
  base: Base;
  macros: string[];
  devRegs: string[];
  subs: string[];
  apto: boolean;
  interApto: boolean;
  flags: string[];
  nums: string[];
  medianas: Record<string, number>;
  nomes: string[];
  c0: number;
}
function desenhar(base: Base, pts: Ponto[], cx: Contexto, tirar: string[] = []): Desenho {
  const n = pts.length;
  const nMac = contar(pts, (a) => cx.macroDe(a.regiao));
  const nReg = contar(pts, (a) => a.regiao);
  const macros = Object.keys(nMac).sort((a, b) => nMac[b]! - nMac[a]!);
  const devRegs: string[] = [];
  for (const rs of Object.values(agrupar(Object.keys(nReg), (r) => cx.macroDe(r)))) {
    if (rs.length < 2) continue;
    devRegs.push(...rs.filter((r) => nReg[r]! >= MP_MIN_REGIAO).sort((a, b) => nReg[b]! - nReg[a]!));
  }
  const subs: string[] = [];
  for (const [reg, l] of Object.entries(agrupar(pts, (a) => a.regiao))) {
    const g = contar(l, bairroDe);
    if (Object.keys(g).length < 2) continue;
    subs.push(...Object.keys(g).filter((b) => b && g[b]! >= MP_MIN_REGIAO).map((b) => `${reg}|${b}`));
  }
  const conta = (f: string): number => pts.filter((a) => flag(a, f, base)).length;
  const nApto = base === 'construido' ? conta('apartamento') : 0;
  const apto = base === 'construido' && nApto >= MP_MIN_FLAG && n - nApto >= MP_MIN_FLAG;
  const interApto = apto && nApto >= 3 * MP_MIN_FLAG && n - nApto >= 3 * MP_MIN_FLAG;
  const candidatos =
    base === 'terreno'
      ? ['esquina', 'frente_mar', 'vista_mar', 'condominio_fechado', 'frente_avenida']
      : ['condominio_fechado', 'lazer', 'vista_mar', 'frente_mar', 'frente_avenida'];
  const flags = candidatos.filter((f) => {
    if (tirar.includes(f)) return false;
    const t = conta(f);
    return t >= MP_MIN_FLAG && n - t >= MP_MIN_FLAG;
  });
  const medianas: Record<string, number> = {};
  const nums = (base === 'construido' ? ['quartos', 'suites', 'vagas'] : []).filter((c) => {
    if (tirar.includes(c)) return false;
    const v = pts.map((a) => a[c]).filter(temNum) as number[];
    if (v.length < n * 0.6) return false;
    medianas[c] = mediana(v)!;
    return v.filter((x) => x !== medianas[c]).length >= MP_MIN_FLAG;
  });
  const nomes = [
    '(base)',
    ...macros.slice(1).map((m) => `macro:${m}`),
    ...devRegs.map((r) => `reg:${r}`),
    ...subs.map((s) => `sub:${s}`),
    'log_area',
  ];
  if (apto) nomes.push('apartamento');
  if (interApto) nomes.push('log_area_apto');
  nomes.push(...flags, ...nums);
  return {
    base,
    macros,
    devRegs,
    subs,
    apto,
    interApto,
    flags,
    nums,
    medianas,
    nomes,
    c0: Math.log(base === 'terreno' ? 1000 : 100),
  };
}
function linha(d: Desenho, a: Ponto, cx: Contexto): Vetor {
  const la = Math.log(a.area);
  const mac = cx.macroDe(a.regiao);
  const x = [1];
  for (let i = 1; i < d.macros.length; i++) x.push(+(mac === d.macros[i]));
  for (const r of d.devRegs) x.push(+(a.regiao === r));
  if (d.subs.length) {
    const k = `${a.regiao}|${bairroDe(a)}`;
    for (const s of d.subs) x.push(+(k === s));
  }
  x.push(la - d.c0);
  const ap = a.grupo === 'apartamento';
  if (d.apto) x.push(+ap);
  if (d.interApto) x.push(ap ? la - Math.log(80) : 0);
  for (const f of d.flags) x.push(+flag(a, f, d.base));
  for (const c of d.nums) {
    const v = a[c];
    x.push(temNum(v) ? Math.min(v, 6) : d.medianas[c]!);
  }
  return x;
}
const penalidades = (d: Desenho, lambda: number, lambdaSub = 0): Vetor =>
  d.nomes.map((n, j) =>
    j === 0 ? 0 : n.startsWith('reg:') ? lambda : n.startsWith('sub:') ? lambdaSub : 1e-6,
  );
function sem(d: Desenho, niveis: Array<'reg' | 'sub'>): Desenho {
  const semReg = niveis.includes('reg');
  const semSub = niveis.includes('sub');
  return {
    ...d,
    devRegs: semReg ? [] : d.devRegs,
    subs: semSub ? [] : d.subs,
    nomes: d.nomes.filter(
      (n) => !(semReg && n.startsWith('reg:')) && !(semSub && n.startsWith('sub:')),
    ),
  };
}
function momentos(
  usados: Ponto[],
  y: Vetor,
  dSem: Desenho,
  lambda: number,
  lambdaSub: number,
  chave: (a: Ponto) => string,
  devs: string[],
  pai: (k: string) => string,
  cx: Contexto,
): { tau2: number; s2w: number } | null {
  const X0 = usados.map((a) => linha(dSem, a, cx));
  const f0 = ajusteRobusto(X0, y, penalidades(dSem, lambda, lambdaSub), false);
  if (!f0) return null;
  const grupos = agrupar(
    usados.map((a, t) => ({ k: chave(a), r: y[t]! - dot(X0[t]!, f0.b) })),
    (o) => o.k,
  );
  let ssw = 0;
  let glw = 0;
  const media: Record<string, number> = {};
  for (const [k, l] of Object.entries(grupos)) {
    const m = l.reduce((s, o) => s + o.r, 0) / l.length;
    media[k] = m;
    ssw += l.reduce((s, o) => s + (o.r - m) ** 2, 0);
    glw += l.length - 1;
  }
  const s2w = ssw / Math.max(1, glw);
  const pais = new Set(devs.map(pai)).size;
  const soma = devs.reduce(
    (s, k) => s + (grupos[k] ? media[k]! ** 2 - s2w / grupos[k]!.length : 0),
    0,
  );
  return { tau2: Math.max(0, soma / Math.max(1, devs.length - pais)), s2w };
}

/** O que sai de um modelo (terreno ou construído). */
export interface ModeloAjustado {
  base: Base;
  n: number;
  r2: number;
  efeitos: EfeitoDoModelo[];
  /** A previsão do m² de um imóvel (região, grupo, área e o que mais o modelo usa). */
  prever(o: Partial<Ponto> & { regiao: string; area: number; grupo?: string | null }): PrevisaoDoModelo | null;
}

function ajustar(base: Base, todos: Ponto[], cx: Contexto): ModeloAjustado | null {
  const pts: Ponto[] = [];
  for (const a of todos) if (!foraDoEscopo(a, base)) pts.push(a);
  const cerca = cercas(pts, cx);
  const usados = pts.filter((a) => {
    const c = cerca(a);
    if (!c) return true;
    const l = Math.log(a.m2);
    return l >= c.lo && l <= c.hi;
  });
  if (usados.length < MIN_MODELO) return null;
  const y = usados.map((a) => Math.log(a.m2));
  const tirar: string[] = [];
  let d = desenhar(base, usados, cx);
  while (d.nomes.length > 1 && usados.length < 5 * d.nomes.length) {
    const sobra = [...d.nums.slice().reverse(), ...d.flags.slice().reverse()][0];
    if (!sobra) break;
    tirar.push(sobra);
    d = desenhar(base, usados, cx, tirar);
  }
  let tau2 = 0;
  let lambda: number | null = null;
  let tau2Sub = 0;
  let lambdaSub = 0;
  if (d.devRegs.length) {
    const m = momentos(usados, y, sem(d, ['reg', 'sub']), 0, 0, (a) => a.regiao, d.devRegs, cx.macroDe, cx);
    if (m && m.tau2 >= MP_TAU2_MIN) {
      tau2 = m.tau2;
      lambda = m.s2w / m.tau2;
    } else {
      tau2 = 0;
      d = sem(d, ['reg']);
    }
  }
  if (d.subs.length) {
    const m = momentos(
      usados,
      y,
      sem(d, ['sub']),
      lambda ?? 0,
      0,
      (a) => `${a.regiao}|${bairroDe(a)}`,
      d.subs,
      (s) => s.split('|')[0]!,
      cx,
    );
    if (m && m.tau2 >= MP_TAU2_MIN) {
      tau2Sub = m.tau2;
      lambdaSub = m.s2w / m.tau2;
    } else d = sem(d, ['sub']);
  }
  let fit: Solucao & { w: Vetor; inv: Matriz };
  let est: Estatisticas;
  for (;;) {
    const pen = penalidades(d, lambda ?? 0, lambdaSub);
    const X = usados.map((a) => linha(d, a, cx));
    const f = ajusteRobusto(X, y, pen);
    if (!f || !f.inv) return null;
    fit = f as Solucao & { w: Vetor; inv: Matriz };
    est = estatisticas(X, y, fit, pen);
    const se = est.se;
    const ruins = d.nomes
      .map((nm, j) => ({ nm, se: se[j]! }))
      .filter((o) => [...d.flags, ...d.nums].includes(o.nm) && o.se > 1);
    if (!ruins.length) break;
    tirar.push(ruins.sort((a, b) => b.se - a.se)[0]!.nm);
    const dd = desenhar(base, usados, cx, tirar);
    d = {
      ...dd,
      devRegs: d.devRegs,
      subs: d.subs,
      nomes: dd.nomes.filter((n) =>
        n.startsWith('reg:')
          ? d.devRegs.includes(n.slice(4))
          : n.startsWith('sub:')
            ? d.subs.includes(n.slice(4))
            : true,
      ),
    };
  }
  const b = fit.b;
  const { cov, s2, gl } = est;
  const tq = quantilT(0.5 + MP_NIVEL / 2, gl);
  const t95 = quantilT(0.975, gl);
  const contReg = contar(usados, (a) => a.regiao);
  const contCel = contar(usados, (a) => `${a.regiao}|${a.grupo}`);
  const regsDaMacro = agrupar(Object.keys(contReg), cx.macroDe);
  const areas = usados.map((a) => a.area);
  const faixaArea = [Math.min(...areas), Math.max(...areas)] as const;
  const j = (nm: string): number => d.nomes.indexOf(nm);
  const comb = (idx: number[]): { b: number; se: number } => {
    const v = idx.reduce((s, p) => s + idx.reduce((q, r) => q + cov[p]![r]!, 0), 0);
    return { b: idx.reduce((s, p) => s + b[p]!, 0), se: Math.sqrt(Math.max(0, v)) };
  };
  const nCom = (id: string): number | null =>
    ['log_area', 'log_area_apto', 'apartamento', 'quartos', 'suites', 'vagas'].includes(id)
      ? 0
      : usados.filter(
          (a) => a[id] === true || (id === 'condominio_fechado' && a.grupo === 'casa_condominio'),
        ).length;
  const efeitos: EfeitoDoModelo[] = [];
  const empurrar = (id: string, escala: 'area' | 'vezes', idx: number[]): void => {
    const c = comb(idx);
    const f = escala === 'area' ? (v: number) => Math.pow(1.1, v) - 1 : (v: number) => Math.exp(v) - 1;
    const lo = f(c.b - t95 * c.se);
    const hi = f(c.b + t95 * c.se);
    efeitos.push({ id, efeito: f(c.b), lo, hi, confiavel: lo > 0 || hi < 0, n_com: nCom(id) });
  };
  empurrar('log_area', 'area', [j('log_area')]);
  if (d.interApto) empurrar('log_area_apto', 'area', [j('log_area'), j('log_area_apto')]);
  if (d.apto) empurrar('apartamento', 'vezes', [j('apartamento')]);
  for (const f of [...d.flags, ...d.nums]) empurrar(f, 'vezes', [j(f)]);
  const prever: ModeloAjustado['prever'] = (o) => {
    const reg = o.regiao;
    const mac = cx.macroDe(reg);
    if (!d.macros.includes(mac)) return null;
    const area = o.area;
    if (!temNum(area) || area <= 0) return null;
    const grupo =
      base === 'terreno'
        ? grupoDoTerreno(area)
        : o.grupo && baseDoGrupo(o.grupo) === 'construido'
          ? o.grupo
          : 'casa';
    const a = { ...o, area, grupo } as Ponto;
    const unica = (contReg[reg] || 0) > 0 && regsDaMacro[mac]?.length === 1;
    const x = linha(d, a, cx);
    const lm = dot(x, b);
    const proprio = d.devRegs.includes(reg) || unica;
    const sub = d.subs.includes(`${reg}|${bairroDe(a)}`);
    const se = Math.sqrt(s2 + quad(cov, x) + (proprio || !tau2 ? 0 : tau2) + (sub ? 0 : tau2Sub));
    const nR = contReg[reg] || 0;
    const nC = contCel[`${reg}|${grupo}`] || 0;
    const foraFaixa = area < faixaArea[0] * 0.8 || area > faixaArea[1] * 1.25;
    return {
      m2: Math.exp(lm),
      lo: Math.exp(lm - tq * se),
      hi: Math.exp(lm + tq * se),
      erro_pct: null,
      n_regiao: nR,
      n_celula: nC,
      indicio: nR < MP_MIN_INDICIO || nC < MP_MIN_INDICIO || foraFaixa,
    };
  };
  return { base, n: usados.length, r2: est.r2, efeitos, prever };
}

/** Os dois modelos da rodada; um deles nulo quando não há anúncios suficientes. */
export interface ModelosDePreco {
  terreno: ModeloAjustado | null;
  construido: ModeloAjustado | null;
}

/**
 * Ajusta os dois modelos com os anúncios da rodada (os mesmos que o motor conta). A
 * macrorregião de cada região vem de fora (`macroDe` da entrada), a mesma do motor.
 */
export function ajustarModelos(
  anuncios: AnuncioDaBase[],
  macroDe: (reg: string) => string,
): ModelosDePreco {
  const cx: Contexto = { macroDe };
  const daBase = (b: Base): Ponto[] =>
    anuncios.filter((a) => baseDoGrupo(a.grupo) === b && temNum(a.m2) && a.m2 > 0 && a.area > 0);
  const tentar = (b: Base): ModeloAjustado | null => {
    try {
      return ajustar(b, daBase(b), cx);
    } catch {
      return null;
    }
  };
  return { terreno: tentar('terreno'), construido: tentar('construido') };
}
