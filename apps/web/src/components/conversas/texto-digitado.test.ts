import { describe, expect, it } from 'vitest';

import {
  TETO_DE_TEXTOS,
  VALIDADE_MS,
  aparar,
  comTexto,
  lerGuardado,
  paraGuardar,
  previaDoDigitado,
  type TextoDigitado,
} from './texto-digitado';

/**
 * O que estes testes protegem: o texto que a pessoa digitou não some ao trocar de
 * conversa, não vaza de uma conversa para outra, e o que foi enviado não volta
 * como rascunho. O armazenamento do navegador e a caixa em si são provados no
 * navegador; aqui fica a parte pura.
 */

const AGORA = 1_800_000_000_000;

describe('o texto por enviar de cada conversa', () => {
  it('guarda por conversa, sem misturar uma com a outra', () => {
    let textos = comTexto(new Map(), 'fio-a', 'Oi, Carla!', AGORA);
    textos = comTexto(textos, 'fio-b', 'Bom dia, Jôsy', AGORA + 1);
    expect(textos.get('fio-a')?.texto).toBe('Oi, Carla!');
    expect(textos.get('fio-b')?.texto).toBe('Bom dia, Jôsy');
  });

  it('guarda como foi digitado, com o espaço do fim: a caixa não pode comer a tecla', () => {
    const textos = comTexto(new Map(), 'fio-a', 'Oi ', AGORA);
    expect(textos.get('fio-a')?.texto).toBe('Oi ');
  });

  it('caixa limpa apaga a entrada: é o que acontece depois de enviar', () => {
    const antes = comTexto(new Map(), 'fio-a', 'Já vou ver', AGORA);
    const depois = comTexto(antes, 'fio-a', '', AGORA + 1);
    expect(depois.has('fio-a')).toBe(false);
    expect(depois.size).toBe(0);
  });

  it('não muda o mapa que recebeu', () => {
    const antes = comTexto(new Map(), 'fio-a', 'um', AGORA);
    comTexto(antes, 'fio-a', 'dois', AGORA + 1);
    expect(antes.get('fio-a')?.texto).toBe('um');
  });
});

describe('o que o aparelho guarda tem limite', () => {
  it('texto esquecido há mais de 30 dias some', () => {
    const velho = new Map<string, TextoDigitado>([
      ['fio-velho', { texto: 'esqueci', em: AGORA - VALIDADE_MS - 1 }],
      ['fio-novo', { texto: 'de ontem', em: AGORA - 1000 }],
    ]);
    const restam = aparar(velho, AGORA);
    expect([...restam.keys()]).toEqual(['fio-novo']);
  });

  it('passando do teto, saem os mexidos há mais tempo', () => {
    let textos = new Map<string, TextoDigitado>();
    for (let i = 0; i < TETO_DE_TEXTOS + 5; i += 1) {
      textos = new Map(comTexto(textos, `fio-${i}`, `texto ${i}`, AGORA + i));
    }
    expect(textos.size).toBe(TETO_DE_TEXTOS);
    expect(textos.has('fio-0')).toBe(false);
    expect(textos.has(`fio-${TETO_DE_TEXTOS + 4}`)).toBe(true);
  });

  it('dentro do limite, devolve o mesmo mapa: a lista não repinta à toa', () => {
    const textos = new Map<string, TextoDigitado>([['fio-a', { texto: 'x', em: AGORA }]]);
    expect(aparar(textos, AGORA)).toBe(textos);
  });
});

describe('ida e volta ao armazenamento do navegador', () => {
  it('o que foi guardado volta igual', () => {
    const textos = comTexto(new Map(), 'fio-a', 'Oi!\nTudo bem?', AGORA);
    const json = paraGuardar(textos);
    expect(lerGuardado(json, AGORA).get('fio-a')).toEqual({ texto: 'Oi!\nTudo bem?', em: AGORA });
  });

  it('nada guardado não ocupa o aparelho', () => {
    expect(paraGuardar(new Map())).toBeNull();
    expect(lerGuardado(null, AGORA).size).toBe(0);
  });

  it('conteúdo estragado, de outra versão ou mexido à mão vira "nada guardado"', () => {
    expect(lerGuardado('{não é json', AGORA).size).toBe(0);
    expect(lerGuardado('[]', AGORA).size).toBe(0);
    expect(lerGuardado('"texto"', AGORA).size).toBe(0);
    expect(lerGuardado('{"fio-a":"solto"}', AGORA).size).toBe(0);
    expect(lerGuardado('{"fio-a":{"texto":"","em":1}}', AGORA).size).toBe(0);
    expect(lerGuardado('{"fio-a":{"texto":"oi","em":"ontem"}}', AGORA).size).toBe(0);
  });

  it('ao ler, o que venceu já não volta', () => {
    const json = JSON.stringify({ 'fio-a': { texto: 'velho', em: AGORA - VALIDADE_MS - 1 } });
    expect(lerGuardado(json, AGORA).size).toBe(0);
  });
});

describe('o que a lista mostra depois de "Rascunho:"', () => {
  it('o começo do texto, numa linha só', () => {
    expect(previaDoDigitado('É assim que deveria\nfuncionar')).toBe(
      'É assim que deveria funcionar',
    );
  });

  it('texto longo ganha reticências', () => {
    const previa = previaDoDigitado('a'.repeat(200));
    expect(previa).toHaveLength(80);
    expect(previa?.endsWith('…')).toBe(true);
  });

  it('só espaços não é rascunho', () => {
    expect(previaDoDigitado('   \n ')).toBeNull();
    expect(previaDoDigitado('')).toBeNull();
    expect(previaDoDigitado(null)).toBeNull();
    expect(previaDoDigitado(undefined)).toBeNull();
  });
});
