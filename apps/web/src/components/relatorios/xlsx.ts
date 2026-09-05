import { zipSync, strToU8 } from 'fflate';

import type { Periodo } from './periodo';
import type { Coluna } from './tipos';

/**
 * Exportação em XLSX do que está na tela (RF-REL-09: "arquivos com dados brutos",
 * que é a preferência declarada do Rafael no R07 §4).
 *
 * Por que escrever o arquivo à mão em vez de instalar uma biblioteca: um .xlsx é um
 * zip com cinco arquivos de XML, e o zip já está no projeto — `apps/web` usa
 * `fflate` (8 kB) para LER a planilha da importação. Instalar `xlsx` ou `exceljs`
 * (600 kB a 1 MB) para escrever uma tabela sem fórmula, sem imagem e sem aba
 * múltipla seria pagar a conta inteira por uma linha do orçamento.
 *
 * As colunas são as MESMAS que desenham a tabela e escrevem o CSV (`Coluna<L>`), na
 * mesma ordem: "exportar o que está na tela" só é verdade quando a tela e os dois
 * arquivos saem da mesma definição.
 *
 * A diferença para o CSV é que aqui o número entra como NÚMERO, e não como texto:
 * a coluna marcada `numero` tem o texto em português (`1.234`, `28,0%`) convertido
 * de volta para o valor, com o formato do Excel por cima. Sem isso a planilha não
 * soma, que é a única razão de alguém querer XLSX em vez de CSV.
 */

/** O que uma célula vira dentro do arquivo. */
type Celula =
  | { tipo: 'texto'; texto: string }
  | { tipo: 'numero'; valor: number; formato: 'inteiro' | 'decimal' | 'percentual' };

/** Índices de `cellXfs` em `styles.xml`, na ordem em que são declarados lá embaixo. */
const ESTILO = { corpo: 0, cabecalho: 1, inteiro: 2, decimal: 3, percentual: 4 } as const;

const NUMERO_PT = /^-?\d{1,3}(\.\d{3})*(,\d+)?$|^-?\d+(,\d+)?$/;

/**
 * Devolve o valor por trás do texto em português, ou a própria string quando aquele
 * texto não é um número (o marcador `n/d`, um rótulo, uma célula vazia).
 *
 * `1.234` vira 1234; `28,0%` vira 0.28 com formato de percentual (é assim que o
 * Excel guarda percentual, e é o que faz `=MÉDIA()` de uma coluna de taxas dar o
 * número certo em vez de 2800%).
 */
export function celulaDoTexto(texto: string, ehNumero: boolean): Celula {
  const limpo = texto.trim();
  if (!ehNumero || limpo === '') return { tipo: 'texto', texto: limpo };

  const percentual = limpo.endsWith('%');
  const corpo = percentual ? limpo.slice(0, -1).trim() : limpo;
  if (!NUMERO_PT.test(corpo)) return { tipo: 'texto', texto: limpo };

  const valor = Number(corpo.replace(/\./g, '').replace(',', '.'));
  if (!Number.isFinite(valor)) return { tipo: 'texto', texto: limpo };

  if (percentual) return { tipo: 'numero', valor: valor / 100, formato: 'percentual' };
  return {
    tipo: 'numero',
    valor,
    formato: corpo.includes(',') ? 'decimal' : 'inteiro',
  };
}

/** `0 -> A`, `25 -> Z`, `26 -> AA`. */
export function colunaExcel(indice: number): string {
  let n = indice;
  let letras = '';
  do {
    letras = String.fromCharCode(65 + (n % 26)) + letras;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return letras;
}

function escapar(texto: string): string {
  return (
    texto
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      // Caracteres de controle não são XML válido e derrubam o Excel na abertura.
      .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/gu, '')
  );
}

function celulaXml(referencia: string, celula: Celula, estilo: number): string {
  if (celula.tipo === 'numero') {
    return `<c r="${referencia}" s="${estilo}"><v>${celula.valor}</v></c>`;
  }
  if (celula.texto === '') return `<c r="${referencia}" s="${estilo}"/>`;
  return `<c r="${referencia}" s="${estilo}" t="inlineStr"><is><t xml:space="preserve">${escapar(
    celula.texto,
  )}</t></is></c>`;
}

/** Largura de coluna em "caracteres", estimada pelo conteúdo mais longo. */
function largura(valores: readonly string[]): number {
  const maior = valores.reduce((maximo, valor) => Math.max(maximo, valor.length), 0);
  return Math.min(Math.max(maior + 2, 9), 46);
}

function planilhaXml<L>(colunas: readonly Coluna<L>[], linhas: readonly L[]): string {
  const cols = colunas
    .map((coluna, i) => {
      const textos = [coluna.rotulo, ...linhas.map((linha) => coluna.texto(linha))];
      return `<col min="${i + 1}" max="${i + 1}" width="${largura(textos)}" customWidth="1"/>`;
    })
    .join('');

  const cabecalho = colunas
    .map((coluna, i) =>
      celulaXml(`${colunaExcel(i)}1`, { tipo: 'texto', texto: coluna.rotulo }, ESTILO.cabecalho),
    )
    .join('');

  const corpo = linhas
    .map((linha, l) => {
      const celulas = colunas
        .map((coluna, c) => {
          const celula = celulaDoTexto(coluna.texto(linha), coluna.numero === true);
          const estilo = celula.tipo === 'numero' ? ESTILO[celula.formato] : ESTILO.corpo;
          return celulaXml(`${colunaExcel(c)}${l + 2}`, celula, estilo);
        })
        .join('');
      return `<row r="${l + 2}">${celulas}</row>`;
    })
    .join('');

  const ultima = `${colunaExcel(Math.max(colunas.length - 1, 0))}${linhas.length + 1}`;

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols>${cols}</cols><sheetData><row r="1">${cabecalho}</row>${corpo}</sheetData><autoFilter ref="A1:${ultima}"/></worksheet>`;
}

/**
 * `styles.xml` mínimo: uma fonte normal, uma em negrito para o cabeçalho, e três
 * formatos de número — inteiro com separador de milhar, decimal com uma casa e
 * percentual com uma casa. O Excel em português lê `#,##0` com a pontuação do
 * sistema de quem abre, então o arquivo sai correto em qualquer máquina.
 */
const ESTILOS_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="2"><numFmt numFmtId="164" formatCode="#,##0.0"/><numFmt numFmtId="165" formatCode="0.0%"/></numFmts><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="5"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/><xf numFmtId="3" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;

const TIPOS_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`;

const RELS_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`;

const RELS_PASTA_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`;

/**
 * Nome de aba do Excel: no máximo 31 caracteres e sem `: \ / ? * [ ]`.
 * Nome inválido faz o Excel recusar o arquivo inteiro, sem dizer por quê.
 */
export function nomeDaAba(bruto: string): string {
  const limpo = bruto.replace(/[:\\/?*[\]]/g, ' ').trim();
  return (limpo === '' ? 'Relatório' : limpo).slice(0, 31);
}

function pastaXml(aba: string): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${escapar(
    aba,
  )}" sheetId="1" r:id="rId1"/></sheets></workbook>`;
}

/** Monta o .xlsx inteiro em memória e devolve os bytes. */
export function montarXlsx<L>(
  aba: string,
  colunas: readonly Coluna<L>[],
  linhas: readonly L[],
): Uint8Array {
  return zipSync(
    {
      '[Content_Types].xml': strToU8(TIPOS_XML),
      '_rels/.rels': strToU8(RELS_XML),
      'xl/workbook.xml': strToU8(pastaXml(nomeDaAba(aba))),
      'xl/_rels/workbook.xml.rels': strToU8(RELS_PASTA_XML),
      'xl/styles.xml': strToU8(ESTILOS_XML),
      'xl/worksheets/sheet1.xml': strToU8(planilhaXml(colunas, linhas)),
    },
    { level: 6 },
  );
}

/** `triade-funil-2026-08-06-a-2026-09-04.xlsx` */
export function nomeDoArquivoXlsx(painel: string, periodo: Periodo): string {
  return `triade-${painel}-${periodo.de}-a-${periodo.ate}.xlsx`;
}

/** Entrega o arquivo ao navegador. Só roda no cliente, a partir de um clique. */
export function baixarXlsx(nome: string, bytes: Uint8Array): void {
  // `slice()` corta um ArrayBuffer próprio: o buffer que o fflate devolve pode ser
  // uma janela sobre um buffer maior, e o Blob levaria junto o que não é do arquivo.
  const blob = new Blob([bytes.slice().buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  const endereco = URL.createObjectURL(blob);
  const ancora = document.createElement('a');
  ancora.href = endereco;
  ancora.download = nome;
  document.body.append(ancora);
  ancora.click();
  ancora.remove();
  URL.revokeObjectURL(endereco);
}
