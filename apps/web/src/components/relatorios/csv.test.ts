import { describe, expect, it } from 'vitest';

import { montarCsv, nomeDoArquivo } from './csv';
import type { Coluna } from './tipos';

type Linha = { nome: string; alvos: number; taxa: string };

const COLUNAS: readonly Coluna<Linha>[] = [
  { chave: 'nome', rotulo: 'Categoria', texto: (l) => l.nome },
  { chave: 'grupo', rotulo: 'Grupo', soNoCsv: true, texto: () => 'Serviços' },
  { chave: 'alvos', rotulo: 'Alvos', numero: true, texto: (l) => String(l.alvos) },
  { chave: 'taxa', rotulo: 'Abertura', numero: true, texto: (l) => l.taxa },
];

describe('montarCsv', () => {
  it('escreve cabeçalho e linhas separados por ponto e vírgula, com BOM', () => {
    const csv = montarCsv(COLUNAS, [{ nome: 'Fotografia', alvos: 6, taxa: '12,5%' }]);
    expect(csv.startsWith('﻿')).toBe(true);
    expect(csv).toContain('Categoria;Grupo;Alvos;Abertura');
    expect(csv).toContain('Fotografia;Serviços;6;12,5%');
    expect(csv.endsWith('\r\n')).toBe(true);
  });

  it('leva a coluna que só existe no arquivo', () => {
    const csv = montarCsv(COLUNAS, [{ nome: 'DJs', alvos: 3, taxa: '' }]);
    expect(csv).toContain('DJs;Serviços;3;');
  });

  it('protege o texto que tem o próprio separador dentro', () => {
    const csv = montarCsv(COLUNAS, [
      { nome: 'Locais: salões, chácaras; praia', alvos: 8, taxa: '0,0%' },
    ]);
    expect(csv).toContain('"Locais: salões, chácaras; praia"');
  });

  it('dobra as aspas do texto, para a planilha não quebrar a linha', () => {
    const csv = montarCsv(COLUNAS, [{ nome: 'Buffet "do Zé"', alvos: 1, taxa: '' }]);
    expect(csv).toContain('"Buffet ""do Zé"""');
  });

  it('escreve só o cabeçalho quando não há linha', () => {
    expect(montarCsv(COLUNAS, [])).toBe('﻿Categoria;Grupo;Alvos;Abertura\r\n');
  });
});

describe('nomeDoArquivo', () => {
  it('carrega o painel e o período no nome', () => {
    expect(
      nomeDoArquivo('funil', { chave: 'trinta', de: '2026-08-06', ate: '2026-09-04' }),
    ).toBe('triade-funil-2026-08-06-a-2026-09-04.csv');
  });
});
