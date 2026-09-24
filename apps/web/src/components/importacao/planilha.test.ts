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

describe('título antes do cabeçalho', () => {
  /**
   * O caso real que quebrou: a planilha de fornecedores da Komune abre com um
   * título mesclado na linha 1 e o cabeçalho de verdade na linha 2. Célula
   * mesclada grava só na primeira posição, então a linha do título lê como UMA
   * coluna — e a leitura antiga a adotava, cortando as seis colunas de dados
   * para uma. A tela dizia "104 linhas · 1 colunas".
   */
  const comTitulo = [
    'FORNECEDORES PARA EVENTOS — NATAL/RN (levantamento julho/2026);;;;;',
    'Categoria;Fornecedor;Serviços oferecidos;Telefone / Contato;Endereço / Bairro;Avaliação Google',
    'Espaço e estrutura básica;Chácara Alvorada;Chácara para eventos com piscina;(84) 92172-1371;R. Eng. João Hélio Alves Rocha - Planalto, Natal;4,5',
    'Espaço e estrutura básica;Lótus Recepções;Casa de recepção com área verde;(84) 98807-3100;Av. Tropical, 170 - Pitimbu, Natal;4,9',
  ].join('\r\n');

  it('pula o título e adota a linha de baixo como cabeçalho', () => {
    const planilha = lerCsv(comTitulo, 'fornecedores.csv');
    expect(planilha.cabecalho).toEqual([
      'Categoria',
      'Fornecedor',
      'Serviços oferecidos',
      'Telefone / Contato',
      'Endereço / Bairro',
      'Avaliação Google',
    ]);
  });

  it('e as linhas de dados chegam inteiras, não cortadas a uma coluna', () => {
    const planilha = lerCsv(comTitulo, 'fornecedores.csv');
    expect(planilha.linhas).toHaveLength(2);
    expect(planilha.linhas[0]).toHaveLength(6);
    expect(planilha.linhas[0]?.[3]).toBe('(84) 92172-1371');
  });

  it('diz QUAL título ignorou, para a pessoa conferir o palpite', () => {
    const planilha = lerCsv(comTitulo, 'fornecedores.csv');
    expect(planilha.tituloIgnorado).toEqual([
      'FORNECEDORES PARA EVENTOS — NATAL/RN (levantamento julho/2026)',
    ]);
  });

  it('planilha sem título não ignora nada', () => {
    const planilha = lerCsv('Nome;Telefone\r\nBuffet Sabor;84999990001', 'simples.csv');
    expect(planilha.cabecalho).toEqual(['Nome', 'Telefone']);
    expect(planilha.tituloIgnorado).toEqual([]);
    expect(planilha.linhas).toHaveLength(1);
  });

  it('lista de uma coluna só continua funcionando: nada tem duas células, e a regra antiga vale', () => {
    // Sem esta exceção, uma planilha legítima de uma coluna perderia o cabeçalho
    // e a primeira ficha viraria o nome da coluna.
    const planilha = lerCsv('Nome\r\nBuffet Sabor\r\nMesas & Cia', 'lista.csv');
    expect(planilha.cabecalho).toEqual(['Nome']);
    expect(planilha.tituloIgnorado).toEqual([]);
    expect(planilha.linhas).toHaveLength(2);
  });
});

describe('CSV do google-maps-scraper-kit', () => {
  const cru = texto('maps-natal-buffet.csv');
  const maps = lerCsv(cru, 'maps-natal-buffet.csv');

  it('descobre a vírgula do kit, e não o ponto e vírgula do Excel', () => {
    const primeiraLinha = cru.slice(1).split('\n')[0] ?? '';
    expect(descobrirSeparador(primeiraLinha)).toBe(',');
  });

  it('tira o BOM e lê as 29 colunas', () => {
    expect(cru.charCodeAt(0)).toBe(0xfeff);
    expect(maps.cabecalho).toHaveLength(29);
    expect(maps.cabecalho[0]).toBe('link');
    expect(maps.cabecalho[13]).toBe('cid');
    expect(maps.cabecalho[26]).toBe('emails');
    expect(maps.cabecalho.at(-1)).toBe('linkedin');
  });

  it('lê as 20 linhas, sem confundir o cabeçalho com título', () => {
    expect(maps.linhas).toHaveLength(20);
    expect(maps.tituloIgnorado).toEqual([]);
    expect(maps.cortadas).toBe(0);
  });

  it('nenhuma linha escorregou de coluna', () => {
    // `montar` preenche e corta toda linha no tamanho do cabeçalho, então
    // `l.length === 29` seria verdade mesmo com uma vírgula a mais ou a menos
    // no arquivo. O que denuncia o escorregão é o CONTEÚDO de duas colunas
    // distantes: o `cid` tem 20 dígitos e o fuso é o mesmo nas 20 linhas.
    expect(maps.linhas.filter((l) => !/^\d{20}$/.test(l[13] ?? ''))).toEqual([]);
    expect(maps.linhas.filter((l) => l[18] !== 'America/Fortaleza')).toEqual([]);
  });

  it('preserva a vírgula de dentro do endereço entre aspas', () => {
    const linha = maps.linhas.find((l) => l[1] === 'Buffet Sabor do Sol');
    expect(linha?.[3]).toBe('Av. Eng. Roberto Freire, 1234 - Capim Macio, Natal - RN, 59082-095');
  });

  it('preserva a vírgula de dentro da descrição entre aspas', () => {
    const linha = maps.linhas.find((l) => l[1] === 'Espaço Jardim das Artes');
    expect(linha?.[15]).toBe('Salão climatizado, jardim e estacionamento, com cozinha de apoio');
  });

  it('o telefone fixo chega inteiro', () => {
    const linha = maps.linhas.find((l) => l[1] === 'Salão Mirante do Forte');
    expect(linha?.[7]).toBe('+55 84 3999-9001');
  });

  it('lugar sem e-mail chega com a coluna vazia, e com telefone', () => {
    const linha = maps.linhas.find((l) => l[1] === 'Espaço Verde Ponta Negra');
    expect(linha?.[26]).toBe('');
    expect(linha?.[7]).toBe('+55 84 99999-0005');
    // Sem nota e sem nº de avaliações: um lugar recém-cadastrado no Maps.
    expect(linha?.[9]).toBe('');
    expect(linha?.[10]).toBe('');
  });

  it('endereço sem bairro chega como veio, sem completar nada', () => {
    const linha = maps.linhas.find((l) => l[1] === 'Tendas Coqueiral');
    expect(linha?.[3]).toBe('Rodovia BR-101, Km 12, Parnamirim - RN, 59146-000');
  });

  it('o mesmo cid aparece duas vezes, com telefone e nota diferentes', () => {
    const repetidas = maps.linhas.filter((l) => l[13] === '10453218876690042117');
    expect(repetidas).toHaveLength(2);
    expect(repetidas[0]?.[7]).toBe('+55 84 99999-0001');
    expect(repetidas[1]?.[7]).toBe('+55 84 99999-0013');
    expect(repetidas[0]?.[10]).toBe('4.7');
    expect(repetidas[1]?.[10]).toBe('4.8');
  });

  it('o ponto e vírgula de dentro do e-mail não vira separador', () => {
    const linha = maps.linhas.find((l) => l[1] === 'Casa de Festas Pequeno Reino');
    expect(linha?.[26]).toBe(
      'festas@pequenoreinonatal.com.br;financeiro@pequenoreinonatal.com.br',
    );
  });

  it('nenhum telefone da fixture pode ser de alguém de verdade', () => {
    const fora = maps.linhas
      .map((l) => l[7] ?? '')
      .filter((t) => t !== '' && !/^\+55 84 (99999-00\d\d|3999-9001)$/.test(t));
    expect(fora).toEqual([]);
  });
});
