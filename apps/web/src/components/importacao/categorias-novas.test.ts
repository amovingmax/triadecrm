/**
 * Os grupos de categoria nova, juntados entre pedaços da prévia.
 *
 * POR QUÊ este teste existe: o banco agrupa DENTRO da chamada, e
 * `pedirPrevia` parte a planilha em pedaços de 200 linhas. Sem a junção, uma
 * planilha de 600 linhas mostraria "Estúdio fotográfico" três vezes na tela de
 * resolver — três perguntas para uma resposta só, que é exatamente o que essa
 * tela existe para acabar.
 */
import { describe, expect, it } from 'vitest';

import { juntarCategoriasNovas } from './dados';
import type { CategoriaNova } from './tipos';

function g(nome: string, linhas: number, exemplos: string[], sug = 10): CategoriaNova {
  return {
    nome_na_fonte: nome,
    linhas,
    exemplos,
    sugestao_id: sug,
    sugestao_nome: 'Fotografia e vídeo',
  };
}

describe('juntarCategoriasNovas', () => {
  it('soma as linhas do mesmo nome vindo de pedaços diferentes', () => {
    const r = juntarCategoriasNovas([
      g('Estúdio fotográfico', 2, ['Show', 'Bruna']),
      g('Estúdio fotográfico', 3, ['Narah']),
    ]);
    expect(r).toHaveLength(1);
    expect(r[0]?.linhas).toBe(5);
  });

  it('junta os exemplos até três, sem repetir', () => {
    const r = juntarCategoriasNovas([
      g('Estúdio fotográfico', 2, ['Show', 'Bruna']),
      g('Estúdio fotográfico', 3, ['Bruna', 'Narah', 'Click']),
    ]);
    expect(r[0]?.exemplos).toEqual(['Show', 'Bruna', 'Narah']);
  });

  it('o grupo que destrava mais linhas vem primeiro', () => {
    const r = juntarCategoriasNovas([
      g('Loja de Presentes', 1, ['PICMIMOS']),
      g('Impressões fotográficas', 2, ['PROALBUNS']),
    ]);
    expect(r.map((x) => x.nome_na_fonte)).toEqual([
      'Impressões fotográficas',
      'Loja de Presentes',
    ]);
  });

  it('empate de linhas desempata por nome, em português', () => {
    const r = juntarCategoriasNovas([g('Ótica', 1, []), g('Acessórios', 1, [])]);
    expect(r.map((x) => x.nome_na_fonte)).toEqual(['Acessórios', 'Ótica']);
  });

  it('não muda a lista original', () => {
    const a = g('Estúdio fotográfico', 2, ['Show']);
    juntarCategoriasNovas([a, g('Estúdio fotográfico', 1, ['Bruna'])]);
    expect(a.exemplos).toEqual(['Show']);
    expect(a.linhas).toBe(2);
  });

  it('sem grupo nenhum, devolve lista vazia', () => {
    expect(juntarCategoriasNovas([])).toEqual([]);
  });
});
