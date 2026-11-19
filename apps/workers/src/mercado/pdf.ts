/**
 * Texto de um PDF simples (fontes WinAnsi, como os do Diário Oficial do
 * Natal), sem biblioteca. Porte de `textoDoPdf` de `coletar/obras.mjs`.
 *
 * Percorre "stream … endstream"; pula imagem, fonte e metadado; limita cada
 * stream a 8 MB descomprimido e o texto da edição a 3 MB (proteção de memória).
 */
import { inflateSync } from 'node:zlib';

const cp1252 = new TextDecoder('windows-1252');

export function textoDoPdf(buf: Buffer): string {
  const s = buf.toString('latin1');
  const saida: string[] = [];
  let pos = 0;
  let total = 0;
  while (total < 3e6) {
    const k = s.indexOf('stream', pos);
    if (k < 0) break;
    if (s.startsWith('endstream', k - 3)) {
      pos = k + 6;
      continue;
    }
    let ini = k + 6;
    if (s[ini] === '\r') ini += 1;
    if (s[ini] === '\n') ini += 1;
    else {
      pos = k + 6;
      continue;
    }
    const fim = s.indexOf('endstream', ini);
    if (fim < 0) break;
    const dic = s.slice(Math.max(s.lastIndexOf(' obj', k), k - 800), k);
    pos = fim + 9;
    if (
      !/FlateDecode/.test(dic) ||
      /\/Subtype\s*\/(Image|XML|Form)|\/Type\s*\/(XRef|ObjStm|Metadata|XObject)|\/Length[123]\b|\/Width\b|FontFile/.test(
        dic,
      )
    )
      continue;
    let dados: Buffer;
    try {
      dados = inflateSync(buf.subarray(ini, fim), { maxOutputLength: 8e6 });
    } catch {
      continue;
    }
    const c = dados.toString('latin1');
    if (!/\bBT\b/.test(c) || !/T[Jj]/.test(c)) continue;
    const t = conteudoParaTexto(c);
    total += t.length;
    saida.push(t);
  }
  return saida
    .join('\n')
    .replace(/-\n(?=[a-zà-ú])/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n');
}

type Item = string | number | Item[] | '[';

function conteudoParaTexto(c: string): string {
  let out = '';
  let i = 0;
  const pilha: Item[] = [];
  const lerString = (): string => {
    let prof = 1;
    const bytes: number[] = [];
    i += 1;
    while (i < c.length && prof) {
      const ch = c[i] ?? '';
      if (ch === '\\') {
        const n = c[i + 1] ?? '';
        const mapa: Record<string, number> = {
          n: 10,
          r: 13,
          t: 9,
          b: 8,
          f: 12,
          '(': 40,
          ')': 41,
          '\\': 92,
        };
        const m = mapa[n];
        if (m !== undefined) {
          bytes.push(m);
          i += 2;
          continue;
        }
        if (/[0-7]/.test(n)) {
          const o = c.slice(i + 1, i + 4).match(/^[0-7]{1,3}/)?.[0] ?? '0';
          bytes.push(Number.parseInt(o, 8) & 255);
          i += 1 + o.length;
          continue;
        }
        if (n === '\r' || n === '\n') {
          i += 2;
          continue;
        }
        i += 1;
        continue;
      }
      if (ch === '(') prof += 1;
      else if (ch === ')') {
        prof -= 1;
        if (!prof) {
          i += 1;
          break;
        }
      }
      bytes.push(ch.charCodeAt(0) & 255);
      i += 1;
    }
    return cp1252.decode(Uint8Array.from(bytes));
  };
  while (i < c.length) {
    const ch = c[i] ?? '';
    if (ch === '(') {
      pilha.push(lerString());
      continue;
    }
    if (out.length > 2e6 || pilha.length > 1e5) break;
    if (ch === '<' && c[i + 1] !== '<') {
      const f = c.indexOf('>', i);
      if (f < 0) break;
      const hex = c.slice(i + 1, f).replace(/\s/g, '');
      const b: number[] = [];
      for (let k = 0; k < hex.length; k += 2)
        b.push(Number.parseInt(hex.slice(k, k + 2).padEnd(2, '0'), 16));
      pilha.push(cp1252.decode(Uint8Array.from(b)));
      i = f + 1;
      continue;
    }
    if (ch === '[') {
      pilha.push('[');
      i += 1;
      continue;
    }
    if (ch === ']') {
      const arr: Item[] = [];
      while (pilha.length && pilha[pilha.length - 1] !== '[') arr.unshift(pilha.pop() as Item);
      pilha.pop();
      pilha.push(arr);
      i += 1;
      continue;
    }
    if (/\s/.test(ch)) {
      i += 1;
      continue;
    }
    const tok = c.slice(i).match(/^[^\s()<>[\]/]+|^\/[^\s()<>[\]/]*/)?.[0] ?? ch;
    i += tok.length;
    if (/^-?[\d.]+$/.test(tok)) {
      pilha.push(Number(tok));
      continue;
    }
    if (tok.startsWith('/')) {
      pilha.push(tok);
      continue;
    }
    switch (tok) {
      case 'Tj': {
        const x = pilha.pop();
        out += typeof x === 'string' ? x : '';
        break;
      }
      case "'":
      case '"': {
        const x = pilha.pop();
        out += `\n${typeof x === 'string' ? x : ''}`;
        break;
      }
      case 'TJ': {
        const a = pilha.pop();
        if (Array.isArray(a))
          for (const x of a)
            out += typeof x === 'string' ? x : typeof x === 'number' && x < -250 ? ' ' : '';
        break;
      }
      case 'Td':
      case 'TD': {
        const ty = pilha[pilha.length - 1];
        out += typeof ty === 'number' && Math.abs(ty) > 0.01 ? '\n' : ' ';
        break;
      }
      case 'T*':
      case 'Tm':
      case 'ET':
        out += '\n';
        break;
      default:
        break;
    }
    if (!['Tj', 'TJ', "'", '"'].includes(tok)) pilha.length = 0;
  }
  return out;
}
