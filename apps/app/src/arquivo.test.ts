import { describe, expect, it } from 'vitest';

import { FORMATOS, arquivoDaMensagem, nomeSeguro } from './arquivo';

const recado = (campos: Record<string, unknown>) =>
  JSON.stringify({
    tipo: 'baixar-arquivo',
    nome: 'triade-funil.xlsx',
    base64: 'UEsDBA==',
    ...campos,
  });

describe('o recado de arquivo do site', () => {
  it('a planilha, o CSV e a exportação passam, com o tipo de cada um', () => {
    expect(arquivoDaMensagem(recado({}))).toEqual({
      nome: 'triade-funil.xlsx',
      base64: 'UEsDBA==',
      tipo: FORMATOS.xlsx,
    });
    expect(arquivoDaMensagem(recado({ nome: 'triade-base-2026-11-05.csv' }))?.tipo).toBe(
      'text/csv',
    );
    expect(arquivoDaMensagem(recado({ nome: 'parceiro-dj-done.JSON' }))?.tipo).toBe(
      'application/json',
    );
  });

  it('outro recado (a cor da barra) ou texto qualquer não é arquivo', () => {
    expect(arquivoDaMensagem(JSON.stringify({ tipo: 'cor-da-barra', cor: '#000' }))).toBeNull();
    expect(arquivoDaMensagem('não é json')).toBeNull();
    expect(arquivoDaMensagem(recado({ base64: 42 }))).toBeNull();
  });

  it('conteúdo vazio, fora do base64 ou grande demais é recusado', () => {
    expect(arquivoDaMensagem(recado({ base64: '' }))).toBeNull();
    expect(arquivoDaMensagem(recado({ base64: 'abc$%' }))).toBeNull();
    expect(arquivoDaMensagem(recado({ base64: 'A'.repeat(28 * 1024 * 1024) }))).toBeNull();
  });
});

describe('o nome do arquivo no aparelho', () => {
  it('pasta e caractere de controle viram traço', () => {
    expect(nomeSeguro('relatório/semana.xlsx')).toBe('relatório-semana.xlsx');
    expect(nomeSeguro('C:\\planilhas\\funil.csv')).toBe('C--planilhas-funil.csv');
    expect(nomeSeguro('a\u0000b.csv')).toBe('a-b.csv');
  });

  it('formato desconhecido, nome oculto ou comprido demais é recusado', () => {
    expect(nomeSeguro('programa.exe')).toBeNull();
    expect(nomeSeguro('sem-extensao')).toBeNull();
    expect(nomeSeguro('.csv')).toBeNull();
    expect(nomeSeguro('../../segredo.csv')).toBeNull();
    expect(nomeSeguro(`${'a'.repeat(130)}.csv`)).toBeNull();
  });
});
