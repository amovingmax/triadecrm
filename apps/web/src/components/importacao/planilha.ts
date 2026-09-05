/**
 * Leitura de XLSX e CSV, sem dependência de biblioteca de planilha.
 *
 * Por que não uma biblioteca pronta: as duas candidatas custam caro de um jeito
 * ou de outro — a legada tem CVE de poluição de protótipo na versão que está no
 * npm, e a mantida entra em cerca de 1 MB no pacote do navegador para ler um
 * arquivo de 17 colunas. Aqui só é preciso DESCOMPACTAR (isso é `fflate`, 8 kB) e
 * varrer duas folhas de XML. O que este módulo lê está documentado abaixo, e o que
 * ele não lê recusa com mensagem em português em vez de devolver linha em branco.
 *
 * O que lê de um .xlsx
 *   · `sharedStrings.xml` (texto compartilhado) e `t="inlineStr"` (texto na célula);
 *   · `t="str"` (resultado de fórmula) e `t="b"` (verdadeiro/falso);
 *   · número puro e — o que mais importa nesta planilha — número com formato de
 *     DATA, convertido pelo calendário do Excel (1900, com o 29/02/1900 que não
 *     existiu) para ISO, que é o que o banco espera;
 *   · a aba escolhida por nome ("Contatos") ou a primeira com dados.
 *
 * O que NÃO lê, de propósito
 *   · fórmula (só o resultado que o Excel gravou), macro, imagem, formatação.
 *
 * Módulo puro: nada de DOM, nada de React. Roda no Web Worker e nos testes.
 */
import { unzipSync } from 'fflate';

import type { PlanilhaLida } from './tipos';

/**
 * Teto de linhas lidas de uma vez.
 *
 * Não é medo de arquivo grande: é que acima disso a planilha deixou de ser a
 * planilha-ponte de uma equipe de duas pessoas e virou uma base comprada, que
 * precisa de contrato anexado ao lote (RF-BAS-10) e de conversa antes do upload.
 */
export const TETO_DE_LINHAS = 20_000;

export class ErroDePlanilha extends Error {
  constructor(
    message: string,
    readonly comoResolver: string,
  ) {
    super(message);
    this.name = 'ErroDePlanilha';
  }
}

// ---------------------------------------------------------------------------
// CSV
// ---------------------------------------------------------------------------

/**
 * Descobre o separador contando ocorrências FORA de aspas na primeira linha.
 * O Excel em pt-BR exporta com `;`, o Google Sheets com `,` — e um nome de
 * empresa com vírgula ("Bar, drinks e chopp") derrubaria a contagem ingênua.
 */
export function descobrirSeparador(primeiraLinha: string): string {
  const candidatos = [';', ',', '\t', '|'];
  let melhor = ';';
  let maior = -1;
  for (const sep of candidatos) {
    let n = 0;
    let dentro = false;
    for (let i = 0; i < primeiraLinha.length; i += 1) {
      const c = primeiraLinha[i];
      if (c === '"') dentro = !dentro;
      else if (!dentro && c === sep) n += 1;
    }
    if (n > maior) {
      maior = n;
      melhor = sep;
    }
  }
  return maior > 0 ? melhor : ';';
}

/** CSV no padrão RFC 4180: aspas duplas, aspas escapadas por duplicação, CRLF ou LF. */
export function lerCsv(texto: string, nome = 'CSV'): PlanilhaLida {
  const semBom = texto.charCodeAt(0) === 0xfeff ? texto.slice(1) : texto;
  const primeiraQuebra = semBom.search(/\r?\n/);
  const sep = descobrirSeparador(primeiraQuebra === -1 ? semBom : semBom.slice(0, primeiraQuebra));

  const linhas: string[][] = [];
  let campo = '';
  let linha: string[] = [];
  let dentro = false;

  for (let i = 0; i < semBom.length; i += 1) {
    const c = semBom[i];
    if (dentro) {
      if (c === '"') {
        if (semBom[i + 1] === '"') {
          campo += '"';
          i += 1;
        } else {
          dentro = false;
        }
      } else {
        campo += c;
      }
      continue;
    }
    if (c === '"') {
      dentro = true;
    } else if (c === sep) {
      linha.push(campo);
      campo = '';
    } else if (c === '\n') {
      linha.push(campo);
      linhas.push(linha);
      linha = [];
      campo = '';
    } else if (c !== '\r') {
      campo += c;
    }
  }
  if (campo !== '' || linha.length > 0) {
    linha.push(campo);
    linhas.push(linha);
  }

  return montar(linhas, nome, [nome]);
}

// ---------------------------------------------------------------------------
// XLSX
// ---------------------------------------------------------------------------

/** Entidades XML que aparecem em texto de planilha. */
function desescapar(s: string): string {
  if (!s.includes('&')) return s;
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&amp;/g, '&');
}

/** Concatena todos os `<t>` de um trecho (texto rico vem quebrado em vários). */
function textoDeT(trecho: string): string {
  let saida = '';
  const re = /<t[^>]*>([\s\S]*?)<\/t>|<t[^>]*\/>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(trecho)) !== null) saida += desescapar(m[1] ?? '');
  return saida;
}

/** `A1` → 0, `B1` → 1, `AA1` → 26. */
export function colunaDaReferencia(ref: string): number {
  let n = 0;
  for (let i = 0; i < ref.length; i += 1) {
    const c = ref.charCodeAt(i);
    if (c < 65 || c > 90) break;
    n = n * 26 + (c - 64);
  }
  return n - 1;
}

/** Formatos de data embutidos no Excel (ECMA-376, §18.8.30). */
const FORMATOS_DE_DATA = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 45, 46, 47, 27, 30, 36, 50, 57]);

/**
 * Serial do Excel → ISO `AAAA-MM-DD`.
 *
 * O Excel acha que 1900 foi bissexto (compatibilidade com o Lotus 1-2-3), então o
 * serial 60 é um 29/02/1900 que nunca existiu e tudo a partir do 61 está um dia
 * à frente. Sem esta correção, toda data de março de 1900 em diante sai errada em
 * um dia — e a planilha-ponte é feita de datas.
 */
export function serialParaIso(serial: number): string | null {
  if (!Number.isFinite(serial) || serial < 1 || serial > 2_958_465) return null;
  const dias = Math.floor(serial);
  const ms = (dias > 59 ? dias - 1 : dias) * 86_400_000 + Date.UTC(1899, 11, 31);
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

/** Índices de `cellXfs` cujo formato de número é de data. */
function estilosDeData(styles: string | undefined): Set<number> {
  const saida = new Set<number>();
  if (!styles) return saida;

  const personalizados = new Map<number, string>();
  const reFmt = /<numFmt[^>]*numFmtId="(\d+)"[^>]*formatCode="([^"]*)"[^>]*\/?>/g;
  let m: RegExpExecArray | null;
  while ((m = reFmt.exec(styles)) !== null) {
    personalizados.set(Number(m[1]), desescapar(m[2] ?? ''));
  }

  const bloco = /<cellXfs[^>]*>([\s\S]*?)<\/cellXfs>/.exec(styles);
  if (!bloco) return saida;
  const reXf = /<xf\b[^>]*>/g;
  let i = 0;
  while ((m = reXf.exec(bloco[1] ?? '')) !== null) {
    const id = Number(/numFmtId="(\d+)"/.exec(m[0])?.[1] ?? '0');
    const codigo = personalizados.get(id);
    // Um código personalizado é de data quando fala de dia, mês ou ano fora de
    // aspas — `[$-416]dd/mm/aaaa` é data; `#.##0,00 "m"` não é.
    const pareceData =
      codigo !== undefined && /[dmyhs]/i.test(codigo.replace(/"[^"]*"/g, '').replace(/\[[^\]]*\]/g, ''));
    if (FORMATOS_DE_DATA.has(id) || pareceData) saida.add(i);
    i += 1;
  }
  return saida;
}

type Aba = { nome: string; caminho: string };

/** Nome e arquivo de cada aba, na ordem do arquivo. */
function abasDoLivro(zip: Record<string, Uint8Array>, texto: (n: string) => string | undefined): Aba[] {
  const workbook = texto('xl/workbook.xml');
  if (!workbook) return [];

  const rels = texto('xl/_rels/workbook.xml.rels') ?? '';
  const alvoPorId = new Map<string, string>();
  const reRel = /<Relationship\b[^>]*\/?>/g;
  let m: RegExpExecArray | null;
  while ((m = reRel.exec(rels)) !== null) {
    const id = /Id="([^"]+)"/.exec(m[0])?.[1];
    const alvo = /Target="([^"]+)"/.exec(m[0])?.[1];
    if (id && alvo) alvoPorId.set(id, alvo.replace(/^\/?xl\//, '').replace(/^\.\//, ''));
  }

  const saida: Aba[] = [];
  const reSheet = /<sheet\b[^>]*\/?>/g;
  let ordem = 0;
  while ((m = reSheet.exec(workbook)) !== null) {
    ordem += 1;
    const nome = desescapar(/name="([^"]*)"/.exec(m[0])?.[1] ?? `Planilha ${ordem}`);
    const rid = /r:id="([^"]+)"/.exec(m[0])?.[1];
    const alvo = rid ? alvoPorId.get(rid) : undefined;
    const caminho = `xl/${alvo ?? `worksheets/sheet${ordem}.xml`}`;
    if (caminho in zip) saida.push({ nome, caminho });
  }
  return saida;
}

/**
 * Lê um .xlsx. `abaPreferida` escolhe pelo nome (sem acento e sem caixa); sem ela,
 * vale a primeira aba que tiver pelo menos uma linha de dados além do cabeçalho.
 */
export function lerXlsx(bytes: Uint8Array, abaPreferida?: string): PlanilhaLida {
  let zip: Record<string, Uint8Array>;
  try {
    zip = unzipSync(bytes);
  } catch {
    throw new ErroDePlanilha(
      'Este arquivo não é uma planilha do Excel.',
      'Salve como .xlsx ou .csv e tente de novo. Arquivo .xls antigo não serve.',
    );
  }

  const decodificar = new TextDecoder('utf-8');
  const texto = (nome: string): string | undefined => {
    const b = zip[nome];
    return b ? decodificar.decode(b) : undefined;
  };

  const abas = abasDoLivro(zip, texto);
  if (abas.length === 0) {
    throw new ErroDePlanilha(
      'A planilha não tem nenhuma aba legível.',
      'Abra o arquivo no Excel, confira se há dados e salve de novo como .xlsx.',
    );
  }

  // Texto compartilhado: o Excel guarda cada string uma vez só e as células
  // apontam para o índice.
  const compartilhadas: string[] = [];
  const sst = texto('xl/sharedStrings.xml');
  if (sst) {
    const re = /<si\b[^>]*>([\s\S]*?)<\/si>|<si\b[^>]*\/>/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(sst)) !== null) compartilhadas.push(textoDeT(m[1] ?? ''));
  }

  const datas = estilosDeData(texto('xl/styles.xml'));

  const chave = (s: string) =>
    s
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .trim()
      .toLowerCase();

  const escolhida = abaPreferida
    ? abas.find((a) => chave(a.nome) === chave(abaPreferida))
    : undefined;

  const nomes = abas.map((a) => a.nome);
  const ordem = escolhida ? [escolhida] : abas;
  let melhor: PlanilhaLida | null = null;

  for (const aba of ordem) {
    const xml = texto(aba.caminho);
    if (!xml) continue;
    const lida = montar(linhasDaAba(xml, compartilhadas, datas), aba.nome, nomes);
    if (lida.linhas.length > 0) return lida;
    if (!melhor || lida.cabecalho.length > melhor.cabecalho.length) melhor = lida;
  }

  if (!melhor) {
    throw new ErroDePlanilha(
      'Não deu para ler nenhuma aba desta planilha.',
      'Abra o arquivo no Excel e salve de novo como .xlsx.',
    );
  }
  return melhor;
}

/** Varre `<row>`/`<c>` de uma aba e devolve a matriz de textos. */
function linhasDaAba(xml: string, compartilhadas: string[], datas: Set<number>): string[][] {
  const saida: string[][] = [];
  const reRow = /<row\b([^>]*)>([\s\S]*?)<\/row>|<row\b[^>]*\/>/g;
  let mRow: RegExpExecArray | null;

  while ((mRow = reRow.exec(xml)) !== null) {
    const corpo = mRow[2];
    if (!corpo) {
      saida.push([]);
      continue;
    }
    const linha: string[] = [];
    const reC = /<c\b([^>]*)>([\s\S]*?)<\/c>|<c\b([^>]*)\/>/g;
    let mC: RegExpExecArray | null;
    let proxima = 0;

    while ((mC = reC.exec(corpo)) !== null) {
      const attrs = mC[1] ?? mC[3] ?? '';
      const conteudo = mC[2] ?? '';
      const ref = /r="([A-Z]+\d+)"/.exec(attrs)?.[1];
      const col = ref ? colunaDaReferencia(ref) : proxima;
      proxima = col + 1;
      while (linha.length < col) linha.push('');

      const tipo = /t="([^"]+)"/.exec(attrs)?.[1] ?? 'n';
      const estilo = Number(/s="(\d+)"/.exec(attrs)?.[1] ?? '-1');
      let valor = '';

      if (tipo === 'inlineStr') {
        valor = textoDeT(conteudo);
      } else {
        const bruto = desescapar(/<v[^>]*>([\s\S]*?)<\/v>/.exec(conteudo)?.[1] ?? '');
        if (tipo === 's') {
          valor = compartilhadas[Number(bruto)] ?? '';
        } else if (tipo === 'b') {
          valor = bruto === '1' ? 'verdadeiro' : 'falso';
        } else if (tipo === 'str' || tipo === 'e') {
          valor = bruto;
        } else if (bruto !== '' && datas.has(estilo)) {
          valor = serialParaIso(Number(bruto)) ?? bruto;
        } else {
          valor = bruto;
        }
      }
      linha.push(valor);
    }
    saida.push(linha);
  }
  return saida;
}

// ---------------------------------------------------------------------------
// Comum
// ---------------------------------------------------------------------------

function vazia(linha: string[]): boolean {
  return linha.every((c) => c.trim() === '');
}

/**
 * Primeira linha não vazia vira cabeçalho; o resto vira dados.
 *
 * Uma linha em branco NO MEIO não encerra a leitura (é comum a equipe separar
 * blocos com uma linha vazia), mas também não vira ficha vazia: some.
 */
function montar(bruto: string[][], aba: string, abas: string[]): PlanilhaLida {
  const primeira = bruto.findIndex((l) => !vazia(l));
  const titulos = primeira === -1 ? undefined : bruto[primeira];
  if (titulos === undefined) {
    return { aba, abas, cabecalho: [], linhas: [], cortadas: 0 };
  }

  const cabecalho = titulos.map((c) => c.trim());
  while (cabecalho.length > 0 && cabecalho[cabecalho.length - 1] === '') cabecalho.pop();

  const corpo = bruto.slice(primeira + 1).filter((l) => !vazia(l));
  const cortadas = Math.max(0, corpo.length - TETO_DE_LINHAS);
  const linhas = corpo.slice(0, TETO_DE_LINHAS).map((l) => {
    const igual = l.slice(0, cabecalho.length).map((c) => c.trim());
    while (igual.length < cabecalho.length) igual.push('');
    return igual;
  });

  return { aba, abas, cabecalho, linhas, cortadas };
}

/** Escolhe o leitor pelo nome do arquivo. */
export function lerArquivo(nome: string, bytes: Uint8Array): PlanilhaLida {
  const ext = nome.toLowerCase().split('.').pop() ?? '';
  if (ext === 'csv' || ext === 'txt') {
    return lerCsv(new TextDecoder('utf-8').decode(bytes), nome);
  }
  if (ext === 'xlsx' || ext === 'xlsm') {
    return lerXlsx(bytes, 'Contatos');
  }
  if (ext === 'xls') {
    throw new ErroDePlanilha(
      'Arquivo .xls é do Excel antigo e não pode ser lido aqui.',
      'Abra no Excel e salve como .xlsx (ou exporte em .csv).',
    );
  }
  throw new ErroDePlanilha(
    `O CRM não lê arquivo .${ext || 'sem extensão'}.`,
    'Envie a planilha em .xlsx ou .csv.',
  );
}
