import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/**
 * Tabela de contraste do sistema visual, medida a partir dos VALORES LITERAIS de
 * `globals.css`. Não existia nada aqui até a rodada de correções da repaginação
 * Ocean Breeze, e foi assim que a paleta anterior conseguiu descer o texto
 * destrutivo para 3,99:1 e o placeholder do escuro para 3,72:1 sem que nada
 * quebrasse. Agora quebra.
 *
 * O que o teste garante, nos dois modos:
 *  - TEXTO (WCAG 1.4.3, mínimo 4,5:1) sobre fundo, cartão, popover, muted E sobre o
 *    preenchimento tênue correspondente (chip térmico, preenchimento destrutivo);
 *  - OBJETO GRÁFICO (WCAG 1.4.11, mínimo 3:1) para a barra térmica, a brasa cheia do
 *    destrutivo e a borda de controle (`--input`, que é o limite do Input, do
 *    SelectTrigger e do Button `outline`).
 *
 * Se um valor mudar, o teste falha dizendo qual par caiu e para quanto. Ele não
 * substitui medir na tela; ele impede a regressão silenciosa.
 */

const CSS = readFileSync(fileURLToPath(new URL('../../app/globals.css', import.meta.url)), 'utf8');

/** Declarações `--nome: valor;` do primeiro nível de cada bloco com este seletor. */
function declaracoes(seletor: string): Map<string, string> {
  const mapa = new Map<string, string>();
  const alvo = `${seletor} {`;
  let inicio = CSS.indexOf(alvo);

  while (inicio !== -1) {
    let profundidade = 1;
    let i = inicio + alvo.length;
    const abertura = i;
    while (i < CSS.length && profundidade > 0) {
      if (CSS[i] === '{') profundidade += 1;
      if (CSS[i] === '}') profundidade -= 1;
      i += 1;
    }
    const corpo = CSS.slice(abertura, i - 1);
    for (const achado of corpo.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
      const [, nome, valor] = achado;
      if (nome && valor) mapa.set(nome, valor.trim());
    }
    inicio = CSS.indexOf(alvo, i);
  }

  return mapa;
}

const CLARO = declaracoes(':root');
const ESCURO = new Map([...CLARO, ...declaracoes('.dark')]);

/** Cor em sRGB de 0 a 255, com alfa de 0 a 1. */
type Cor = { r: number; g: number; b: number; a: number };

function deHex(hex: string): Cor {
  const c = hex.replace('#', '');
  const largo = c.length === 3 ? [...c].map((x) => x + x).join('') : c;
  return {
    r: parseInt(largo.slice(0, 2), 16),
    g: parseInt(largo.slice(2, 4), 16),
    b: parseInt(largo.slice(4, 6), 16),
    a: 1,
  };
}

/**
 * Resolve um token no escopo do modo. Cobre o que o `globals.css` realmente usa em
 * cor: hexadecimal, `var(--outro)`, `rgb(r g b / a)` e
 * `color-mix(in oklab, <cor> N%, transparent)`, que é o preenchimento tênue do chip.
 * Misturar uma cor com `transparent` devolve a mesma cor com N% de alfa, e a
 * composição sobre a superfície acontece em sRGB, que é o que o navegador faz.
 */
function resolver(valor: string, escopo: Map<string, string>): Cor {
  const v = valor.trim();

  if (v.startsWith('#')) return deHex(v);

  const variavel = /^var\((--[\w-]+)\)$/.exec(v);
  if (variavel) {
    return token(variavel[1] ?? '', escopo);
  }

  const rgb = /^rgb\(\s*(\d+)\s+(\d+)\s+(\d+)\s*(?:\/\s*([\d.]+))?\s*\)$/.exec(v);
  if (rgb) {
    return {
      r: Number(rgb[1]),
      g: Number(rgb[2]),
      b: Number(rgb[3]),
      a: rgb[4] === undefined ? 1 : Number(rgb[4]),
    };
  }

  const mix = /^color-mix\(in oklab,\s*(.+?)\s+([\d.]+)%,\s*transparent\)$/.exec(v);
  if (mix) {
    const base = resolver(mix[1] ?? '', escopo);
    return { ...base, a: base.a * (Number(mix[2]) / 100) };
  }

  throw new Error(`valor de cor não suportado: ${v}`);
}

function token(nome: string, escopo: Map<string, string>): Cor {
  const valor = escopo.get(nome);
  if (!valor) throw new Error(`token não encontrado: ${nome}`);
  return resolver(valor, escopo);
}

/** Compõe `frente` (com alfa) sobre `fundo` opaco, em sRGB. */
function sobre(frente: Cor, fundo: Cor): Cor {
  return {
    r: frente.r * frente.a + fundo.r * (1 - frente.a),
    g: frente.g * frente.a + fundo.g * (1 - frente.a),
    b: frente.b * frente.a + fundo.b * (1 - frente.a),
    a: 1,
  };
}

function luminancia({ r, g, b }: Cor): number {
  const canal = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * canal(r) + 0.7152 * canal(g) + 0.0722 * canal(b);
}

function contraste(frente: Cor, fundo: Cor): number {
  const a = luminancia(sobre(frente, fundo));
  const b = luminancia(fundo);
  const [claro, escuro] = a > b ? [a, b] : [b, a];
  return (claro + 0.05) / (escuro + 0.05);
}

/** Alfa arbitrário sobre um token, como `bg-destructive/10` faz no Tailwind. */
function comAlfa(cor: Cor, alfa: number): Cor {
  return { ...cor, a: alfa };
}

const MODOS = [
  { nome: 'claro', escopo: CLARO },
  { nome: 'escuro', escopo: ESCURO },
] as const;

/** As quatro superfícies opacas onde texto e marca podem cair. */
const SUPERFICIES = ['--background', '--card', '--popover', '--muted'] as const;

const TEMPERATURAS = ['frio', 'morno', 'quente', 'cliente', 'cliente-ativo'] as const;

const MINIMO_TEXTO = 4.5;
const MINIMO_GRAFICO = 3;

describe.each(MODOS)('contraste no modo $nome', ({ escopo }) => {
  it('a barra térmica passa em 3:1 sobre toda superfície (WCAG 1.4.11)', () => {
    for (const t of TEMPERATURAS) {
      for (const superficie of SUPERFICIES) {
        const razao = contraste(token(`--${t}`, escopo), token(superficie, escopo));
        expect(`${t} sobre ${superficie}: ${razao.toFixed(2)}`).toBe(
          `${t} sobre ${superficie}: ${Math.max(razao, MINIMO_GRAFICO).toFixed(2)}`,
        );
      }
    }
  });

  it('a variante de texto da escala passa em 4,5:1 sobre o próprio chip', () => {
    for (const t of TEMPERATURAS) {
      for (const superficie of SUPERFICIES) {
        const chip = sobre(token(`--${t}-fundo`, escopo), token(superficie, escopo));
        const razao = contraste(token(`--${t}-texto`, escopo), chip);
        expect(`${t} sobre chip sobre ${superficie}: ${razao.toFixed(2)}`).toBe(
          `${t} sobre chip sobre ${superficie}: ${Math.max(razao, MINIMO_TEXTO).toFixed(2)}`,
        );
      }
    }
  });

  it('temperaturas vizinhas continuam distinguíveis entre si', () => {
    // Não é critério da WCAG: é a promessa de leitura de relance do produto. O piso
    // é o par mais fraco medido depois de abrir o degrau verde do escuro (1,96:1).
    for (let i = 1; i < TEMPERATURAS.length; i += 1) {
      const anterior = token(`--${TEMPERATURAS[i - 1]}`, escopo);
      const atual = token(`--${TEMPERATURAS[i]}`, escopo);
      expect(contraste(anterior, atual)).toBeGreaterThanOrEqual(1.13);
    }
  });

  it('o texto destrutivo passa em 4,5:1 sobre o preenchimento a 10%', () => {
    const tinta = token('--destructive-texto', escopo);
    const brasa = token('--destructive', escopo);

    for (const superficie of SUPERFICIES) {
      const fundo = token(superficie, escopo);
      const preenchido = sobre(comAlfa(brasa, 0.1), fundo);

      for (const [onde, cor] of [
        [superficie, fundo],
        [`${superficie} + destructive/10`, preenchido],
      ] as const) {
        const razao = contraste(tinta, cor);
        expect(`destrutivo sobre ${onde}: ${razao.toFixed(2)}`).toBe(
          `destrutivo sobre ${onde}: ${Math.max(razao, MINIMO_TEXTO).toFixed(2)}`,
        );
      }
    }
  });

  it('a brasa cheia do destrutivo passa em 3:1 como objeto gráfico', () => {
    for (const superficie of SUPERFICIES) {
      expect(
        contraste(token('--destructive', escopo), token(superficie, escopo)),
      ).toBeGreaterThanOrEqual(MINIMO_GRAFICO);
    }
  });

  it('a borda de controle (--input) passa em 3:1 em toda superfície', () => {
    // É o limite visível do Input, do SelectTrigger e do Button `outline`.
    for (const superficie of SUPERFICIES) {
      const razao = contraste(token('--input', escopo), token(superficie, escopo));
      expect(`--input sobre ${superficie}: ${razao.toFixed(2)}`).toBe(
        `--input sobre ${superficie}: ${Math.max(razao, MINIMO_GRAFICO).toFixed(2)}`,
      );
    }
  });

  it('o placeholder passa em 4,5:1 sobre o campo, inclusive dentro da folha', () => {
    // O campo é `bg-transparent` nos dois modos: o `dark:bg-input/30` herdado do
    // shadcn pintava 30% de um cinza-azulado claro e derrubava o placeholder para
    // 3,72:1 dentro do popover, que é o fundo da folha de cadastro rápido.
    for (const superficie of SUPERFICIES) {
      const razao = contraste(token('--muted-foreground', escopo), token(superficie, escopo));
      expect(`placeholder sobre ${superficie}: ${razao.toFixed(2)}`).toBe(
        `placeholder sobre ${superficie}: ${Math.max(razao, MINIMO_TEXTO).toFixed(2)}`,
      );
    }
  });

  it('o corpo do texto passa em 4,5:1 em toda superfície', () => {
    for (const superficie of SUPERFICIES) {
      expect(
        contraste(token('--foreground', escopo), token(superficie, escopo)),
      ).toBeGreaterThanOrEqual(MINIMO_TEXTO);
    }
  });
});
