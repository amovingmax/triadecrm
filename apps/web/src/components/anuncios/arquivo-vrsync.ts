/**
 * O arquivo VRSync do sistema atual, lido de volta (05/11/2026), só na Imova.
 *
 * Os anúncios da Imova chegam hoje ao Canal Pro "Via Integração" de OUTRO
 * sistema, com códigos como SA0012_IMOVA. O Canal Pro aceita um integrador só:
 * para o CRM assumir sem quebrar o vínculo de cada anúncio, ele precisa entrar
 * aqui com o MESMO código (ListingID) e com tudo — fotos, descrição, endereço.
 * Este módulo faz o caminho inverso de `supabase/functions/canal-pro-feed/vrsync.ts`:
 * recebe o XML que o sistema atual publica e devolve, para cada anúncio, as
 * chaves que `public.anuncio_importar` recebe, mais as URLs das fotos.
 *
 * O que não tem lugar no CRM (característica que a tela não conhece, unidade de
 * área estranha, mídia que não é foto nem vídeo do YouTube) não some calado:
 * vira aviso, por anúncio, para a pessoa conferir antes de trazer.
 *
 * Puro: roda no navegador (arquivo escolhido no computador) e no servidor (rota
 * `/api/anuncios/importar`). Testado em `arquivo-vrsync.test.ts`.
 *
 * Referência: developers.grupozap.com/feeds/vrsync (exemplos, Listing e
 * Details), conferida em 05/11/2026.
 */
import { XMLParser, XMLValidator } from 'fast-xml-parser';

import {
  CARACTERISTICAS,
  type Destaque,
  type MostrarEndereco,
  type Negocio,
  type PeriodoAluguel,
} from './tipos';

/** O que `public.anuncio_importar` recebe: o formulário de `anuncio_salvar`, o código e o destaque. */
export type DadosParaImportar = {
  codigo: string;
  titulo: string;
  descricao: string;
  tipo: string;
  negocio: Negocio;
  preco_venda: number | null;
  preco_aluguel: number | null;
  periodo_aluguel: PeriodoAluguel;
  condominio: number | null;
  iptu: number | null;
  iptu_periodo: 'anual' | 'mensal';
  area_util: number | null;
  area_total: number | null;
  quartos: number | null;
  suites: number | null;
  banheiros: number | null;
  vagas: number | null;
  caracteristicas: string[];
  cep: string | null;
  estado: string | null;
  cidade: string | null;
  bairro: string | null;
  endereco: string | null;
  numero: string | null;
  complemento: string | null;
  mostrar_endereco: MostrarEndereco;
  video_youtube: string | null;
  destaque: Destaque;
};

/** Um anúncio do arquivo: os dados, as fotos (capa primeiro) e o que não coube. */
export type AnuncioDoArquivo = DadosParaImportar & {
  fotos: string[];
  avisos: string[];
};

export type CabecalhoDoArquivo = {
  provedor: string | null;
  email: string | null;
  nome: string | null;
  publicadoEm: string | null;
};

export type ArquivoLido =
  | {
      ok: true;
      cabecalho: CabecalhoDoArquivo;
      anuncios: AnuncioDoArquivo[];
      /** O que ficou de fora do arquivo inteiro: sem código, código repetido ou inválido. */
      avisos: string[];
    }
  | {
      ok: false;
      motivo: 'nao_e_vrsync' | 'xml_invalido' | 'vazio';
      /** Onde o XML quebra, quando quebra. */
      linha?: number;
    };

/**
 * O check de `anuncios.codigo` (`app.codigo_de_anuncio_valido`): o ListingID passa
 * igual, ou não passa. De 1 a 50 caracteres, como o VRSync pede, sem espaço nas
 * pontas e sem < > nem caractere de controle; espaço no meio e acento valem, como
 * nos códigos do Canal Pro ("Casa extremox").
 */
export function codigoValido(codigo: string): boolean {
  const tamanho = [...codigo].length;
  return tamanho >= 1 && tamanho <= 50 && codigo === codigo.trim() && !/[<>\p{Cc}]/u.test(codigo);
}

/** O teto de `public.anuncio_foto_adicionar`. */
export const FOTOS_POR_ANUNCIO = 40;

// ---------------------------------------------------------------------------
// Os vocabulários do VRSync, ao contrário
// ---------------------------------------------------------------------------

/**
 * PropertyType → tipo do CRM: a tabela de `app.anuncio_tipo` (migração
 * 20261104180000) invertida. O loft sai do CRM como "Residential / Apartment",
 * que aqui volta como apartamento; "Residential / Loft" (que a documentação
 * lista e o validador recusa) volta como loft. "Commercial / Loja" é forma
 * antiga que outros sistemas ainda mandam.
 */
export const TIPOS_DO_PORTAL: Readonly<Record<string, string>> = {
  'residential / apartment': 'apartamento',
  'residential / home': 'casa',
  'residential / condo': 'casa_condominio',
  'residential / village house': 'casa_vila',
  'residential / sobrado': 'sobrado',
  'residential / penthouse': 'cobertura',
  'residential / flat': 'flat',
  'residential / kitnet': 'kitnet',
  'residential / studio': 'studio',
  'residential / loft': 'loft',
  'residential / land lot': 'terreno',
  'residential / farm ranch': 'chacara',
  'residential / agricultural': 'fazenda_sitio',
  'commercial / office': 'sala_comercial',
  'commercial / consultorio': 'consultorio',
  'commercial / business': 'loja',
  'commercial / loja': 'loja',
  'commercial / building': 'imovel_comercial',
  'commercial / edificio comercial': 'predio_comercial',
  'commercial / edificio residencial': 'predio_residencial',
  'commercial / corporate floor': 'andar_corporativo',
  'commercial / industrial': 'galpao',
  'commercial / land lot': 'terreno_comercial',
  'commercial / garage': 'garagem',
  'commercial / hotel': 'hotel',
};

/**
 * A forma curta que o validador também aceita ("Apartment", "Home", "Land Lot"):
 * o nome depois da barra. Quando ele existe nos dois usos (Land Lot), vale o
 * residencial — a não ser que o UsageType diga Commercial.
 */
const TIPO_CURTO: Record<string, string> = Object.fromEntries(
  Object.entries(TIPOS_DO_PORTAL)
    .reverse()
    .map(([forma, tipo]) => [forma.split(' / ')[1]!, tipo]),
);

const NEGOCIO: Record<string, Negocio> = {
  'for sale': 'venda',
  sale: 'venda',
  'for rent': 'aluguel',
  rent: 'aluguel',
  'sale/rent': 'venda_aluguel',
  'for sale/rent': 'venda_aluguel',
  'sale/for rent': 'venda_aluguel',
};

const DESTAQUE: Record<string, Destaque> = {
  STANDARD: 'padrao',
  PREMIUM: 'destaque',
  SUPER_PREMIUM: 'super_destaque',
  PREMIERE_1: 'exclusivo',
  PREMIERE_2: 'superior',
};

const PERIODO: Record<string, PeriodoAluguel> = {
  monthly: 'mensal',
  daily: 'diario',
  weekly: 'semanal',
  quarterly: 'trimestral',
  yearly: 'anual',
};

const MOSTRAR: Record<string, MostrarEndereco> = {
  all: 'completo',
  street: 'rua',
  neighborhood: 'bairro',
};

/** O nome do estado, para quando o arquivo esquece o atributo `abbreviation`. */
const UF_DO_NOME: Record<string, string> = {
  acre: 'AC',
  alagoas: 'AL',
  amapa: 'AP',
  amazonas: 'AM',
  bahia: 'BA',
  ceara: 'CE',
  'distrito federal': 'DF',
  'espirito santo': 'ES',
  goias: 'GO',
  maranhao: 'MA',
  'mato grosso': 'MT',
  'mato grosso do sul': 'MS',
  'minas gerais': 'MG',
  para: 'PA',
  paraiba: 'PB',
  parana: 'PR',
  pernambuco: 'PE',
  piaui: 'PI',
  'rio de janeiro': 'RJ',
  'rio grande do norte': 'RN',
  'rio grande do sul': 'RS',
  rondonia: 'RO',
  roraima: 'RR',
  'santa catarina': 'SC',
  'sao paulo': 'SP',
  sergipe: 'SE',
  tocantins: 'TO',
};

/** Característica do arquivo → o valor exato que a tela conhece (o arquivo às vezes erra a caixa). */
const CARACTERISTICA_DO_CRM = new Map(
  CARACTERISTICAS.flatMap((g) => g.itens.map((i) => [i.valor.toLowerCase(), i.valor] as const)),
);

/** Os tamanhos das colunas de `public.anuncios`: passar disso derrubaria o anúncio inteiro. */
const TETO = {
  titulo: 100,
  descricao: 3000,
  cidade: 80,
  bairro: 80,
  endereco: 120,
  numero: 20,
  complemento: 60,
  video: 200,
} as const;

// ---------------------------------------------------------------------------
// Texto
// ---------------------------------------------------------------------------

/**
 * O arquivo em texto, na codificação que ele declara. O Grupo OLX pede UTF-8,
 * mas há sistema que declara UTF-8 e grava em Latin-1: se o UTF-8 não fechar,
 * lê como Windows-1252, que é o que esses sistemas gravam de verdade.
 */
export function textoDoArquivo(bytes: Uint8Array): string {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes);
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be').decode(bytes);
  const inicio = new TextDecoder('windows-1252').decode(bytes.subarray(0, 300));
  const declarada = /<\?xml[^>]*encoding\s*=\s*["']([A-Za-z0-9._-]+)["']/i
    .exec(inicio)?.[1]
    ?.toLowerCase();
  if (declarada && !/^utf-?8$/.test(declarada)) {
    try {
      return new TextDecoder(declarada).decode(bytes);
    } catch {
      // Codificação que o navegador não conhece: tenta como UTF-8.
    }
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder('windows-1252').decode(bytes);
  }
}

/** As entidades que aparecem em descrição de imóvel; o resto fica como veio. */
const ENTIDADES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  bull: '•',
  middot: '·',
  ndash: '–',
  mdash: '—',
  hellip: '…',
  laquo: '«',
  raquo: '»',
  ldquo: '“',
  rdquo: '”',
  lsquo: '‘',
  rsquo: '’',
  ordm: 'º',
  ordf: 'ª',
  deg: '°',
  sup2: '²',
  copy: '©',
  reg: '®',
  aacute: 'á',
  eacute: 'é',
  iacute: 'í',
  oacute: 'ó',
  uacute: 'ú',
  acirc: 'â',
  ecirc: 'ê',
  ocirc: 'ô',
  atilde: 'ã',
  otilde: 'õ',
  agrave: 'à',
  ccedil: 'ç',
  uuml: 'ü',
  Aacute: 'Á',
  Eacute: 'É',
  Iacute: 'Í',
  Oacute: 'Ó',
  Uacute: 'Ú',
  Acirc: 'Â',
  Ecirc: 'Ê',
  Ocirc: 'Ô',
  Atilde: 'Ã',
  Otilde: 'Õ',
  Agrave: 'À',
  Ccedil: 'Ç',
};

function decodificar(texto: string): string {
  return texto.replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]*);/gi, (inteira, nome: string) => {
    if (nome[0] === '#') {
      const codigo =
        nome[1] === 'x' || nome[1] === 'X' ? parseInt(nome.slice(2), 16) : Number(nome.slice(1));
      return Number.isInteger(codigo) && codigo > 0 && codigo <= 0x10ffff
        ? String.fromCodePoint(codigo)
        : inteira;
    }
    return ENTIDADES[nome] ?? inteira;
  });
}

/** Sem acento e minúsculo, com um espaço só: para comparar nomes. */
function chave(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s*\/\s*/g, ' / ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Texto de uma linha: entidades decodificadas, tags fora, espaços juntos. */
function linhaUnica(bruto: string): string {
  return decodificar(bruto)
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * A descrição como o CRM guarda: texto puro com quebra de linha. O portal
 * formata pela entidade `&lt;br&gt;` dentro do CDATA (às vezes sem o ponto e
 * vírgula, como no exemplo da própria documentação); há quem mande `<br>` de
 * verdade. Negrito, itálico e outras tags saem — o CRM não as guarda.
 */
export function descricaoDoArquivo(bruto: string): string {
  return decodificar(bruto.replace(/&lt;\s*br\s*\/?\s*&gt;?/gi, '<br>'))
    .replace(/\r\n?/g, '\n')
    .replace(/<br\s*\/?>[ \t]*\n?/gi, '\n')
    .replace(/<\/(p|div)\s*>[ \t]*\n?/gi, '\n')
    .replace(/<li\b[^>]*>/gi, '\n• ')
    .replace(/<\/?[a-z][^>]*>/gi, '')
    .replace(/ /g, ' ')
    .split('\n')
    .map((l) => l.replace(/[ \t]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Número do arquivo. O VRSync pede inteiro sem ponto nem vírgula, mas há quem
 * mande "860000.00", "1.287" ou "32,20": os três são entendidos. Negativo e
 * lixo → null.
 */
export function numeroDoArquivo(bruto: string | null): number | null {
  if (bruto === null) return null;
  let t = bruto.trim().replace(/^R\$/i, '').replace(/\s/g, '');
  if (t === '') return null;
  if (/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(t)) t = t.replace(/\./g, '').replace(',', '.');
  else if (/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(t)) t = t.replace(/,/g, '');
  else if (/^\d+,\d+$/.test(t)) t = t.replace(',', '.');
  if (!/^\d+(\.\d+)?$/.test(t)) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

// ---------------------------------------------------------------------------
// A árvore do XML
// ---------------------------------------------------------------------------

type No = unknown;

function filho(no: No, nome: string): No {
  const n = Array.isArray(no) ? no[0] : no;
  return n && typeof n === 'object' ? (n as Record<string, unknown>)[nome] : undefined;
}

function lista(no: No): No[] {
  if (no === undefined || no === null) return [];
  return Array.isArray(no) ? no : [no];
}

/** O texto do elemento (com ou sem atributos); null quando o elemento não existe. */
function textoDe(no: No): string | null {
  const n = Array.isArray(no) ? no[0] : no;
  if (n === undefined || n === null) return null;
  if (typeof n === 'string') return n;
  if (typeof n === 'number' || typeof n === 'boolean') return String(n);
  if (typeof n === 'object') {
    const t = (n as Record<string, unknown>)['#text'];
    return typeof t === 'string' || typeof t === 'number' ? String(t) : '';
  }
  return null;
}

function atributo(no: No, nome: string): string | null {
  const n = Array.isArray(no) ? no[0] : no;
  if (!n || typeof n !== 'object') return null;
  const v = (n as Record<string, unknown>)[`@_${nome}`];
  return typeof v === 'string' ? v.trim() : null;
}

/** Texto curto: uma linha, vazio vira null. */
function campo(no: No): string | null {
  const t = textoDe(no);
  if (t === null) return null;
  const limpo = linhaUnica(t);
  return limpo === '' ? null : limpo;
}

const LEITOR = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  // `vr:ListingDataFeed` e `ListingDataFeed` são a mesma coisa.
  removeNSPrefix: true,
  // Tudo fica texto: "007" é código, não o número 7.
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: true,
  isArray: (nome, _caminho, _folha, ehAtributo) =>
    !ehAtributo && (nome === 'Listing' || nome === 'Item' || nome === 'Feature'),
});

// ---------------------------------------------------------------------------
// O anúncio
// ---------------------------------------------------------------------------

function cortar(
  valor: string | null,
  teto: number,
  rotulo: string,
  avisos: string[],
): string | null {
  if (valor === null || valor.length <= teto) return valor;
  avisos.push(`${rotulo} passou de ${teto} letras e foi cortado.`);
  return valor.slice(0, teto).trimEnd();
}

function tipoDoArquivo(
  propertyType: string | null,
  usageType: string | null,
  avisos: string[],
): string {
  if (!propertyType) {
    avisos.push('O arquivo não diz o tipo do imóvel: entrou como apartamento. Confira.');
    return 'apartamento';
  }
  const forma = chave(propertyType);
  const uso = chave(usageType ?? '');
  const tipo =
    TIPOS_DO_PORTAL[forma] ??
    (uso === 'commercial' ? TIPOS_DO_PORTAL[`commercial / ${forma}`] : undefined) ??
    TIPO_CURTO[forma];
  if (tipo) return tipo;
  avisos.push(`O tipo “${propertyType}” o CRM não conhece: entrou como apartamento. Confira.`);
  return 'apartamento';
}

function negocioDoArquivo(
  transacao: string | null,
  temVenda: boolean,
  temAluguel: boolean,
  avisos: string[],
): Negocio {
  const negocio = transacao ? NEGOCIO[chave(transacao).replace(/ \/ /g, '/')] : undefined;
  if (negocio) return negocio;
  const deduzido: Negocio =
    temVenda && temAluguel ? 'venda_aluguel' : temAluguel ? 'aluguel' : 'venda';
  avisos.push(
    transacao
      ? `O negócio “${transacao}” o CRM não conhece: pelos preços, entrou como ${deduzido.replace('_', ' e ')}.`
      : `O arquivo não diz se é venda ou aluguel: pelos preços, entrou como ${deduzido.replace('_', ' e ')}.`,
  );
  return deduzido;
}

function destaqueDoArquivo(publicacao: string | null, avisos: string[]): Destaque {
  if (!publicacao) return 'padrao';
  const destaque = DESTAQUE[publicacao.trim().toUpperCase()];
  if (destaque) return destaque;
  avisos.push(
    `O destaque “${publicacao}” não existe no CRM (o validador do Grupo OLX recusa): entrou como Destaque.`,
  );
  return 'destaque';
}

/** Valor em reais, inteiro. `aceitaZero`: condomínio e IPTU zero querem dizer isento. */
function dinheiro(no: No, rotulo: string, avisos: string[], aceitaZero = false): number | null {
  const bruto = textoDe(no);
  if (bruto === null || bruto.trim() === '') return null;
  const n = numeroDoArquivo(bruto);
  if (n === null || !Number.isSafeInteger(Math.trunc(n))) {
    avisos.push(`${rotulo} “${bruto.trim()}” ilegível: ficou vazio.`);
    return null;
  }
  const inteiro = Math.trunc(n);
  if (inteiro === 0 && !aceitaZero) return null;
  return inteiro;
}

/** Área em m² inteiros. Hectare vira m²; outra unidade fica vazia, com aviso. */
function area(no: No, rotulo: string, avisos: string[]): number | null {
  const bruto = textoDe(no);
  if (bruto === null || bruto.trim() === '') return null;
  const unidade = chave(atributo(no, 'unit') ?? 'square metres');
  const n = numeroDoArquivo(bruto.replace(/\s*(m²|m2|ha)$/i, ''));
  if (n === null) {
    avisos.push(`${rotulo} “${bruto.trim()}” ilegível: ficou vazia.`);
    return null;
  }
  let m2: number;
  if (/^(square (metres|meters)|m2|m²|metros quadrados)$/.test(unidade)) m2 = Math.trunc(n);
  else if (/^(hectare|hectares|ha)$/.test(unidade)) m2 = Math.round(n * 10000);
  else {
    avisos.push(
      `${rotulo} veio em “${atributo(no, 'unit')}”, que o CRM não converte: ficou vazia.`,
    );
    return null;
  }
  if (m2 <= 0 || m2 > 2_000_000_000) return null;
  return m2;
}

function contagem(no: No, rotulo: string, maximo: number, avisos: string[]): number | null {
  const bruto = textoDe(no);
  if (bruto === null || bruto.trim() === '') return null;
  const n = numeroDoArquivo(bruto);
  if (n === null || !Number.isInteger(n) || n > maximo) {
    avisos.push(`${rotulo} “${bruto.trim()}” não é um número de 0 a ${maximo}: ficou vazio.`);
    return null;
  }
  return n;
}

function ehYoutube(url: URL): boolean {
  return /(^|\.)(youtube\.com|youtube-nocookie\.com|youtu\.be)$/i.test(url.hostname);
}

function urlDaWeb(texto: string): URL | null {
  try {
    const url = new URL(texto);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url : null;
  } catch {
    return null;
  }
}

function midia(no: No, avisos: string[]): { fotos: string[]; video_youtube: string | null } {
  const capa: string[] = [];
  const resto: string[] = [];
  const vistas = new Set<string>();
  let video: string | null = null;
  const outras = new Map<string, number>();
  let quebradas = 0;

  for (const item of lista(filho(no, 'Item'))) {
    const endereco = (textoDe(item) ?? '').trim();
    const url = urlDaWeb(endereco);
    const tipo =
      atributo(item, 'medium')?.toLowerCase() ??
      // Sem `medium`: se a URL tem cara de foto, é foto.
      (url && /\.(jpe?g|png|webp)$/i.test(url.pathname) ? 'image' : 'sem tipo');
    if (tipo === 'image') {
      if (!url) {
        quebradas++;
        continue;
      }
      if (vistas.has(url.href)) continue;
      vistas.add(url.href);
      (atributo(item, 'primary') === 'true' && capa.length === 0 ? capa : resto).push(url.href);
    } else if (tipo === 'video' && url && ehYoutube(url) && url.href.length <= TETO.video) {
      if (video === null) video = url.href;
      else outras.set('vídeo a mais', (outras.get('vídeo a mais') ?? 0) + 1);
    } else if (tipo === 'video') {
      outras.set('vídeo fora do YouTube', (outras.get('vídeo fora do YouTube') ?? 0) + 1);
    } else {
      outras.set(tipo, (outras.get(tipo) ?? 0) + 1);
    }
  }

  const fotos = [...capa, ...resto];
  if (quebradas) {
    avisos.push(
      `${quebradas} ${quebradas === 1 ? 'foto tem endereço' : 'fotos têm endereço'} que não é da web: ${quebradas === 1 ? 'ficou' : 'ficaram'} de fora.`,
    );
  }
  if (fotos.length > FOTOS_POR_ANUNCIO) {
    avisos.push(
      `O anúncio tem ${fotos.length} fotos; o CRM guarda até ${FOTOS_POR_ANUNCIO}: as últimas ficaram de fora.`,
    );
  }
  if (outras.size) {
    avisos.push(
      `Mídia que o CRM não guarda ficou de fora: ${[...outras].map(([t, n]) => `${n} × ${t}`).join(', ')}.`,
    );
  }
  return { fotos: fotos.slice(0, FOTOS_POR_ANUNCIO), video_youtube: video };
}

function caracteristicas(no: No, avisos: string[]): string[] {
  const conhecidas = new Set<string>();
  const desconhecidas = new Set<string>();
  for (const f of lista(filho(no, 'Feature'))) {
    const valor = campo(f);
    if (!valor) continue;
    const doCrm = CARACTERISTICA_DO_CRM.get(valor.toLowerCase());
    if (doCrm) conhecidas.add(doCrm);
    else desconhecidas.add(valor);
  }
  if (desconhecidas.size) {
    avisos.push(
      `Características que o CRM não tem ficaram de fora: ${[...desconhecidas].join(', ')}.`,
    );
  }
  return [...conhecidas];
}

function local(no: No, avisos: string[]) {
  const mostrarBruto = atributo(no, 'displayAddress');
  let mostrar: MostrarEndereco = 'rua';
  if (mostrarBruto) {
    const m = MOSTRAR[mostrarBruto.toLowerCase()];
    if (m) mostrar = m;
    else
      avisos.push(
        `O “mostrar endereço” “${mostrarBruto}” não existe: ficou “a rua, sem o número”.`,
      );
  }

  const estado = filho(no, 'State');
  const sigla = atributo(estado, 'abbreviation')?.toUpperCase() ?? '';
  const nomeDoEstado = campo(estado);
  const uf = /^[A-Z]{2}$/.test(sigla)
    ? sigla
    : ((nomeDoEstado && UF_DO_NOME[chave(nomeDoEstado)]) ??
      (nomeDoEstado && /^[A-Za-z]{2}$/.test(nomeDoEstado) ? nomeDoEstado.toUpperCase() : null));

  const cepBruto = campo(filho(no, 'PostalCode'));
  const cepDigitos = cepBruto?.replace(/\D/g, '') ?? '';
  let cep: string | null = null;
  if (cepDigitos.length === 8) cep = cepDigitos;
  else if (cepBruto) avisos.push(`O CEP “${cepBruto}” não tem 8 números: ficou vazio.`);

  return {
    mostrar_endereco: mostrar,
    estado: uf,
    cidade: cortar(campo(filho(no, 'City')), TETO.cidade, 'A cidade', avisos),
    bairro: cortar(campo(filho(no, 'Neighborhood')), TETO.bairro, 'O bairro', avisos),
    endereco: cortar(campo(filho(no, 'Address')), TETO.endereco, 'O endereço', avisos),
    numero: cortar(campo(filho(no, 'StreetNumber')), TETO.numero, 'O número', avisos),
    complemento: cortar(campo(filho(no, 'Complement')), TETO.complemento, 'O complemento', avisos),
    cep,
  };
}

function anuncio(listing: No, codigo: string): AnuncioDoArquivo {
  const avisos: string[] = [];
  const det = filho(listing, 'Details');

  const titulo = cortar(campo(filho(listing, 'Title')), TETO.titulo, 'O título', avisos) ?? '';

  let descricao = descricaoDoArquivo(textoDe(filho(det, 'Description')) ?? '');
  if (descricao.length > TETO.descricao) {
    avisos.push(`A descrição passou de ${TETO.descricao} letras e foi cortada.`);
    descricao = descricao.slice(0, TETO.descricao).trimEnd();
  }

  const precoVenda = dinheiro(filho(det, 'ListPrice'), 'O preço de venda', avisos);
  const aluguel = filho(det, 'RentalPrice');
  const precoAluguel = dinheiro(aluguel, 'O aluguel', avisos);
  const negocio = negocioDoArquivo(
    campo(filho(listing, 'TransactionType')),
    precoVenda !== null,
    precoAluguel !== null,
    avisos,
  );

  const periodoBruto = atributo(aluguel, 'period');
  let periodo: PeriodoAluguel = 'mensal';
  if (periodoBruto) {
    const p = PERIODO[periodoBruto.toLowerCase()];
    if (p) periodo = p;
    else avisos.push(`O período do aluguel “${periodoBruto}” não existe: ficou por mês.`);
  }

  // IPTU: o elemento novo (Iptu, com período) vale sobre o antigo (YearlyTax, anual).
  const iptuNovo = filho(det, 'Iptu');
  let iptu = dinheiro(iptuNovo, 'O IPTU', avisos, true);
  let iptuPeriodo: 'anual' | 'mensal' =
    atributo(iptuNovo, 'period')?.toLowerCase() === 'monthly' ? 'mensal' : 'anual';
  if (iptu === null) {
    iptu = dinheiro(filho(det, 'YearlyTax'), 'O IPTU', avisos, true);
    iptuPeriodo = 'anual';
  }

  const { fotos, video_youtube } = midia(filho(listing, 'Media'), avisos);

  return {
    codigo,
    titulo,
    descricao,
    tipo: tipoDoArquivo(campo(filho(det, 'PropertyType')), campo(filho(det, 'UsageType')), avisos),
    negocio,
    preco_venda: negocio === 'aluguel' ? null : precoVenda,
    preco_aluguel: negocio === 'venda' ? null : precoAluguel,
    periodo_aluguel: periodo,
    condominio: dinheiro(filho(det, 'PropertyAdministrationFee'), 'O condomínio', avisos, true),
    iptu,
    iptu_periodo: iptuPeriodo,
    area_util: area(filho(det, 'LivingArea'), 'A área útil', avisos),
    area_total: area(filho(det, 'LotArea'), 'A área total', avisos),
    quartos: contagem(filho(det, 'Bedrooms'), 'Quartos', 99, avisos),
    suites: contagem(filho(det, 'Suites'), 'Suítes', 99, avisos),
    banheiros: contagem(filho(det, 'Bathrooms'), 'Banheiros', 99, avisos),
    vagas: contagem(filho(det, 'Garage'), 'Vagas', 999, avisos),
    caracteristicas: caracteristicas(filho(det, 'Features'), avisos),
    ...local(filho(listing, 'Location'), avisos),
    video_youtube,
    destaque: destaqueDoArquivo(campo(filho(listing, 'PublicationType')), avisos),
    fotos,
    avisos,
  };
}

// ---------------------------------------------------------------------------
// O arquivo
// ---------------------------------------------------------------------------

/** O arquivo inteiro. Não lança: o que não dá para ler volta como `{ ok: false, motivo }`. */
export function lerArquivoVrsync(xml: string): ArquivoLido {
  const texto = xml.replace(/^﻿/, '').trim();
  if (texto === '') return { ok: false, motivo: 'vazio' };

  const valido = XMLValidator.validate(texto, { allowBooleanAttributes: true });
  if (valido !== true) {
    // Página de login, HTML de erro, outro formato: não é que o XML quebrou.
    return /<([A-Za-z_][\w.-]*:)?ListingDataFeed[\s>]/.test(texto)
      ? { ok: false, motivo: 'xml_invalido', linha: valido.err.line }
      : { ok: false, motivo: 'nao_e_vrsync' };
  }

  let arvore: unknown;
  try {
    arvore = LEITOR.parse(texto);
  } catch {
    return { ok: false, motivo: 'xml_invalido' };
  }
  const raiz = filho(arvore, 'ListingDataFeed');
  if (raiz === undefined) return { ok: false, motivo: 'nao_e_vrsync' };

  const listings = lista(filho(filho(raiz, 'Listings'), 'Listing'));
  if (listings.length === 0) return { ok: false, motivo: 'vazio' };

  const cabecalho = filho(raiz, 'Header');
  const avisos: string[] = [];
  const anuncios: AnuncioDoArquivo[] = [];
  const codigos = new Set<string>();

  listings.forEach((listing, i) => {
    const codigo = campo(filho(listing, 'ListingID'));
    const nome = campo(filho(listing, 'Title'));
    const qual = nome ? `“${nome.slice(0, 60)}”` : `o ${i + 1}º do arquivo`;
    if (!codigo) {
      avisos.push(`Um anúncio sem código (ListingID) ficou de fora: ${qual}.`);
      return;
    }
    if (!codigoValido(codigo)) {
      avisos.push(
        `O código “${codigo}” não serve de código no CRM (até 50 caracteres, sem < nem >): ${qual} ficou de fora.`,
      );
      return;
    }
    if (codigos.has(codigo)) {
      avisos.push(`O código ${codigo} aparece mais de uma vez: valeu o primeiro.`);
      return;
    }
    codigos.add(codigo);
    anuncios.push(anuncio(listing, codigo));
  });

  return {
    ok: true,
    cabecalho: {
      provedor: campo(filho(cabecalho, 'Provider')),
      email: campo(filho(cabecalho, 'Email')),
      nome: campo(filho(cabecalho, 'ContactName')),
      publicadoEm: campo(filho(cabecalho, 'PublishDate')),
    },
    anuncios,
    avisos,
  };
}

/** Só os dados que vão ao banco: sem as fotos (que vão pela rota) nem os avisos. */
export function dadosParaImportar(a: AnuncioDoArquivo): DadosParaImportar {
  const { fotos: _fotos, avisos: _avisos, ...dados } = a;
  return dados;
}
