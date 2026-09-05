/**
 * O leitor de planilha, contra arquivos DE VERDADE.
 *
 * Os dois arquivos em `fixtures/` são a planilha-ponte do Dia 0: o .xlsx foi
 * produzido pelo Excel (estilos, validação de lista, três abas, `t="inlineStr"`)
 * e o .csv é a exportação em pt-BR (`;`, UTF-8 com BOM, CRLF). Testar contra XML
 * escrito à mão provaria só que o leitor concorda consigo mesmo.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import {
  colunaDaReferencia,
  descobrirSeparador,
  ErroDePlanilha,
  lerArquivo,
  lerCsv,
  lerXlsx,
  serialParaIso,
} from './planilha';

const bytes = (nome: string) =>
  new Uint8Array(readFileSync(fileURLToPath(new URL(`./fixtures/${nome}`, import.meta.url))));

const texto = (nome: string) =>
  readFileSync(fileURLToPath(new URL(`./fixtures/${nome}`, import.meta.url)), 'utf8');

describe('referência de célula', () => {
  it('traduz a coluna do Excel para índice', () => {
    expect(colunaDaReferencia('A1')).toBe(0);
    expect(colunaDaReferencia('B2')).toBe(1);
    expect(colunaDaReferencia('Q100')).toBe(16);
    expect(colunaDaReferencia('AA7')).toBe(26);
    expect(colunaDaReferencia('AB7')).toBe(27);
  });
});

describe('serial do Excel', () => {
  it('converte datas depois do 29/02/1900 que nunca existiu', () => {
    // 1 = 01/01/1900; 59 = 28/02/1900; 61 = 01/03/1900 (o 60 é o dia fantasma).
    expect(serialParaIso(1)).toBe('1900-01-01');
    expect(serialParaIso(59)).toBe('1900-02-28');
    expect(serialParaIso(61)).toBe('1900-03-01');
    // 04/09/2026, o Dia 1 do calendário do PRD.
    expect(serialParaIso(46269)).toBe('2026-09-04');
  });

  it('recusa o que não é data', () => {
    expect(serialParaIso(0)).toBeNull();
    expect(serialParaIso(-3)).toBeNull();
    expect(serialParaIso(Number.NaN)).toBeNull();
  });
});

describe('separador do CSV', () => {
  it('acha o ponto e vírgula do Excel em português', () => {
    expect(descobrirSeparador('nome;tipo;categoria')).toBe(';');
  });

  it('não se engana com vírgula dentro de aspas', () => {
    // Uma vírgula "de verdade" contra três dentro do nome da categoria.
    expect(descobrirSeparador('nome;"Bar, drinks, chopp";cidade')).toBe(';');
  });

  it('cai no ponto e vírgula quando a linha não tem separador nenhum', () => {
    expect(descobrirSeparador('nome')).toBe(';');
  });
});

describe('CSV da planilha-ponte', () => {
  const planilha = lerCsv(texto('planilha-ponte-preenchida.csv'), 'planilha.csv');

  it('tira o BOM e lê as 17 colunas', () => {
    expect(planilha.cabecalho).toHaveLength(17);
    expect(planilha.cabecalho[0]).toBe('nome*');
    expect(planilha.cabecalho[16]).toBe('observacoes');
  });

  it('lê todas as linhas de dados', () => {
    expect(planilha.linhas).toHaveLength(68);
  });

  it('preserva o ponto e vírgula dentro de aspas', () => {
    const linha = planilha.linhas.find((l) => l[0] === 'Vivier Recepções');
    expect(linha?.[3]).toBe('(84) 3207-3283');
    expect(linha?.[7]).toBe('Candelária');
  });

  it('mantém a vírgula que faz parte do nome da categoria', () => {
    const linha = planilha.linhas.find((l) => l[0] === 'Vovó Isa Biscoitos Artesanais');
    expect(linha?.[2]).toBe('Doces, bolos, confeitaria');
  });
});

describe('XLSX da planilha-ponte', () => {
  const planilha = lerXlsx(bytes('planilha-ponte-preenchida.xlsx'), 'Contatos');

  it('escolhe a aba pedida, mesmo não sendo a primeira', () => {
    expect(planilha.aba).toBe('Contatos');
    expect(planilha.abas).toEqual(['Instruções', 'Contatos', 'Listas']);
  });

  it('lê o mesmo conteúdo do CSV', () => {
    const csv = lerCsv(texto('planilha-ponte-preenchida.csv'), 'csv');
    expect(planilha.linhas).toHaveLength(csv.linhas.length);
    expect(planilha.linhas[0]).toEqual(csv.linhas[0]);
    expect(planilha.linhas.at(-1)).toEqual(csv.linhas.at(-1));
  });

  it('respeita a ordem das colunas mesmo com célula vazia no meio', () => {
    // "Multi Tendas Locações" não tem telefone e tem @: sem a leitura por
    // referência de célula, o @ escorregaria para a coluna do WhatsApp.
    const linha = planilha.linhas.find((l) => l[0] === 'Multi Tendas Locações');
    expect(linha?.[3]).toBe('');
    expect(linha?.[8]).toBe('@multitendas');
  });

  it('joga fora as linhas totalmente vazias do fim do arquivo', () => {
    expect(planilha.linhas.every((l) => l.some((c) => c !== ''))).toBe(true);
  });
});

describe('o template vazio', () => {
  it('lê o cabeçalho e devolve zero linhas quando só há a linha de exemplo apagada', () => {
    const vazio = lerXlsx(
      new Uint8Array(
        readFileSync(
          fileURLToPath(
            new URL('../../../../../docs/planilha-ponte/planilha-ponte-komune.xlsx', import.meta.url),
          ),
        ),
      ),
      'Contatos',
    );
    expect(vazio.aba).toBe('Contatos');
    expect(vazio.cabecalho[0]).toBe('nome*');
    // A linha de exemplo do template ("EXEMPLO — apagar esta linha") ainda está lá.
    expect(vazio.linhas).toHaveLength(1);
    expect(vazio.linhas[0]?.[0]).toContain('EXEMPLO');
  });
});

describe('arquivo que não serve', () => {
  it('recusa .xls antigo com instrução, não com erro de biblioteca', () => {
    expect(() => lerArquivo('lista.xls', new Uint8Array([1, 2, 3]))).toThrow(ErroDePlanilha);
    try {
      lerArquivo('lista.xls', new Uint8Array([1, 2, 3]));
    } catch (erro) {
      expect((erro as ErroDePlanilha).comoResolver).toContain('.xlsx');
    }
  });

  it('recusa extensão desconhecida', () => {
    expect(() => lerArquivo('contatos.pdf', new Uint8Array([1]))).toThrow(/não lê arquivo \.pdf/);
  });

  it('recusa um .xlsx que não é um zip', () => {
    expect(() => lerArquivo('quebrado.xlsx', new Uint8Array([0, 1, 2, 3]))).toThrow(
      /não é uma planilha/,
    );
  });
});

describe('escolha do leitor pela extensão', () => {
  it('lê .csv como texto e .xlsx como zip, com o mesmo resultado', () => {
    const doCsv = lerArquivo('planilha.csv', bytes('planilha-ponte-preenchida.csv'));
    const doXlsx = lerArquivo('planilha.xlsx', bytes('planilha-ponte-preenchida.xlsx'));
    expect(doCsv.linhas).toEqual(doXlsx.linhas);
  });
});
