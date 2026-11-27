/**
 * Mínimos quadrados (o `ols` de `js/10-modelo-preco.js` do protótipo), só o que
 * o motor das vantagens usa: a regressão de vagas em casas de rua (A1, núcleo
 * §3.3). Porte fiel, na mesma ordem de operações (o teste de ouro compara o
 * número até o último bit).
 */

const NAO_NULOS = new WeakMap<number[][], number[][]>();
function naoNulos(X: number[][]): number[][] {
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

/** Soma de pesos × x xᵀ (só nos índices não nulos) + diag(pen). */
function gram(X: number[][], w: number[] | null, pen: number[]): number[][] {
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

function inverter(M: number[][]): number[][] | null {
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

const dot = (x: number[], b: number[]): number => {
  let s = 0;
  for (let j = 0; j < x.length; j++) s += x[j]! * b[j]!;
  return s;
};

export interface ResultadoOls {
  b: number[];
  se: number[];
  r2: number;
  sigma: number;
  n: number;
  k: number;
  yh: number[];
}

/** b = (X'X + diag(pen))⁻¹ X'y, com o erro-padrão de cada coeficiente. */
export function ols(X: number[][], y: number[]): ResultadoOls | null {
  const k = X[0]!.length;
  const pen = Array.from({ length: k }, (_, j) => (j ? 1e-6 : 0));
  const n = X.length;
  const Z = naoNulos(X);
  const v = new Array<number>(k).fill(0);
  for (let t = 0; t < n; t++) {
    const r = X[t]!;
    for (const i of Z[t]!) v[i]! += r[i]! * 1 * y[t]!;
  }
  const A = gram(X, null, pen);
  const inv = inverter(A);
  if (!inv) return null;
  const b = inv.map((r) => dot(r, v));
  // mpEstatisticas com w = 1
  const w = y.map(() => 1);
  const yh = X.map((r) => dot(r, b));
  const res = y.map((val, t) => val - yh[t]!);
  const pef = k - inv.reduce((s, row, i) => s + row[i]! * pen[i]!, 0);
  const gl = Math.max(1, n - pef);
  const sse = res.reduce((s, val) => s + val * val, 0);
  const s2 = sse / gl;
  const my = y.reduce((a, c) => a + c, 0) / n;
  const sst = y.reduce((s, val) => s + (val - my) ** 2, 0);
  const M = gram(
    X,
    w.map((x) => x * x),
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
    b,
    se: cov.map((r, i) => Math.sqrt(Math.max(0, r[i]!))),
    r2: sst ? 1 - sse / sst : 0,
    sigma: Math.sqrt(s2),
    n,
    k,
    yh,
  };
}
