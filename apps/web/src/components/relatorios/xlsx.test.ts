import { unzipSync, strFromU8 } from 'fflate';
import { describe, expect, it } from 'vitest';

import type { Coluna } from './tipos';
import { celulaDoTexto, colunaExcel, montarXlsx, nomeDaAba, nomeDoArquivoXlsx } from './xlsx';

type Linha = { nome: string; alvos: number; taxa: string; mediana: string };

const COLUNAS: readonly Coluna<Linha>[] = [
  { chave: 'nome', rotulo: 'Categoria', texto: (l) => l.nome },
  { chave: 'grupo', rotulo: 'Grupo', soNoCsv: true, texto: () => 'Serviços' },
  { chave: 'alvos', rotulo: 'Alvos', numero: true, texto: (l) => String(l.alvos) },
  { chave: 'taxa', rotulo: 'Abertura', numero: true, texto: (l) => l.taxa },
  { chave: 'mediana', rotulo: 'Mediana (d)', numero: true, texto: (l) => l.mediana },
];

const LINHAS: Linha[] = [
  { nome: 'Fotografia e vídeo', alvos: 1234, taxa: '12,5%', mediana: '3,5' },
  { nome: 'Buffet "do Zé" & cia <bar>', alvos: 0, taxa: '', mediana: 'n/d' },
];

/** Descompacta o .xlsx e devolve o XML de uma das partes. */
function parte(bytes: Uint8Array, caminho: string): string {
  const conteudo = unzipSync(bytes)[caminho];
  if (!conteudo) throw new Error(`O arquivo gerado não tem ${caminho}`);
  return strFromU8(conteudo);
}

describe('celulaDoTexto', () => {
  it('lê o inteiro em português com ponto de milhar', () => {
    expect(celulaDoTexto('1.234', true)).toEqual({
      tipo: 'numero',
      valor: 1234,
      formato: 'inteiro',
    });
  });

  it('lê o decimal com vírgula', () => {
    expect(celulaDoTexto('3,5', true)).toEqual({ tipo: 'numero', valor: 3.5, formato: 'decimal' });
  });

  it('guarda percentual como fração, que é como o Excel guarda', () => {
    expect(celulaDoTexto('28,0%', true)).toEqual({
      tipo: 'numero',
      valor: 0.28,
      formato: 'percentual',
    });
  });

  it('mantém o marcador de sem dado como texto, e não como zero', () => {
    expect(celulaDoTexto('n/d', true)).toEqual({ tipo: 'texto', texto: 'n/d' });
  });

  it('deixa a célula vazia vazia', () => {
    expect(celulaDoTexto('', true)).toEqual({ tipo: 'texto', texto: '' });
  });

  it('não converte coluna que não é de número', () => {
    expect(celulaDoTexto('1.234', false)).toEqual({ tipo: 'texto', texto: '1.234' });
  });

  it('aceita negativo', () => {
    expect(celulaDoTexto('-7', true)).toEqual({ tipo: 'numero', valor: -7, formato: 'inteiro' });
  });

  it('recusa texto que só parece número', () => {
    expect(celulaDoTexto('12.3', true)).toEqual({ tipo: 'texto', texto: '12.3' });
    expect(celulaDoTexto('2026-09-07', true)).toEqual({ tipo: 'texto', texto: '2026-09-07' });
  });
});

describe('colunaExcel', () => {
  it('vai de A a Z e depois AA', () => {
    expect(colunaExcel(0)).toBe('A');
    expect(colunaExcel(25)).toBe('Z');
    expect(colunaExcel(26)).toBe('AA');
    expect(colunaExcel(27)).toBe('AB');
  });
});

describe('nomeDaAba', () => {
  it('tira o que o Excel proíbe e corta em 31 caracteres', () => {
    expect(nomeDaAba('Funil: etapa/conversão')).toBe('Funil  etapa conversão');
    expect(nomeDaAba('a'.repeat(60))).toHaveLength(31);
    expect(nomeDaAba('   ')).toBe('Relatório');
  });
});

describe('montarXlsx', () => {
  const bytes = montarXlsx('Categorias', COLUNAS, LINHAS);

  it('produz um zip com as seis partes que o Excel exige', () => {
    expect(Object.keys(unzipSync(bytes)).sort()).toEqual([
      '[Content_Types].xml',
      '_rels/.rels',
      'xl/_rels/workbook.xml.rels',
      'xl/styles.xml',
      'xl/workbook.xml',
      'xl/worksheets/sheet1.xml',
    ]);
  });

  it('leva as mesmas colunas do CSV, inclusive a que só existe no arquivo', () => {
    const sheet = parte(bytes, 'xl/worksheets/sheet1.xml');
    expect(sheet).toContain('<t xml:space="preserve">Categoria</t>');
    expect(sheet).toContain('<t xml:space="preserve">Grupo</t>');
    expect(sheet).toContain('<t xml:space="preserve">Mediana (d)</t>');
  });

  it('escreve número como número, e não como texto', () => {
    const sheet = parte(bytes, 'xl/worksheets/sheet1.xml');
    expect(sheet).toContain('<c r="C2" s="2"><v>1234</v></c>');
    expect(sheet).toContain('<c r="D2" s="4"><v>0.125</v></c>');
    expect(sheet).toContain('<c r="E2" s="3"><v>3.5</v></c>');
  });

  it('escapa o que quebraria o XML', () => {
    const sheet = parte(bytes, 'xl/worksheets/sheet1.xml');
    expect(sheet).toContain('Buffet &quot;do Zé&quot; &amp; cia &lt;bar&gt;');
  });

  it('mostra o zero como zero e o sem dado como texto', () => {
    const sheet = parte(bytes, 'xl/worksheets/sheet1.xml');
    expect(sheet).toContain('<c r="C3" s="2"><v>0</v></c>');
    expect(sheet).toContain('<t xml:space="preserve">n/d</t>');
  });

  it('congela o cabeçalho e liga o filtro na faixa certa', () => {
    const sheet = parte(bytes, 'xl/worksheets/sheet1.xml');
    expect(sheet).toContain('state="frozen"');
    expect(sheet).toContain('<autoFilter ref="A1:E3"/>');
  });

  it('nomeia a aba', () => {
    expect(parte(bytes, 'xl/workbook.xml')).toContain('name="Categorias"');
  });

  it('escreve só o cabeçalho quando não há linha', () => {
    const vazio = montarXlsx('Vazio', COLUNAS, []);
    const sheet = parte(vazio, 'xl/worksheets/sheet1.xml');
    expect(sheet).toContain('<row r="1">');
    expect(sheet).not.toContain('<row r="2">');
  });
});

describe('nomeDoArquivoXlsx', () => {
  it('carrega o painel e o período no nome', () => {
    expect(
      nomeDoArquivoXlsx('funil', { chave: 'trinta', de: '2026-08-06', ate: '2026-09-04' }),
    ).toBe('triade-funil-2026-08-06-a-2026-09-04.xlsx');
  });
});
