// =============================================================================
// TRIADE — o arquivo VRSync dos anúncios da Imova (04/11/2026)
//
// Monta o XML que o Grupo OLX (ZAP, Viva Real e OLX) baixa a cada 12 horas pela
// URL colada no Canal Pro. Função pura: recebe o que `public.canal_pro_feed`
// devolveu e devolve o texto. Quem decide o que entra (no ar, sem pendência,
// sem exclusão) é o Postgres; aqui só se traduz para o vocabulário do VRSync.
//
// Referência: developers.grupozap.com/feeds/vrsync (exemplos, elementos
// Listing e Details), conferida em 04/11/2026. As decisões que a documentação
// deixa em aberto estão escritas onde são tomadas.
// =============================================================================

export type Negocio = 'venda' | 'aluguel' | 'venda_aluguel';
// Sem "triplo": o validador do Grupo OLX recusa TRIPLE (migração 20261104180000).
export type Destaque = 'padrao' | 'destaque' | 'super_destaque' | 'exclusivo' | 'superior';
export type Periodo = 'mensal' | 'diario' | 'semanal' | 'trimestral' | 'anual';
export type MostrarEndereco = 'completo' | 'rua' | 'bairro';

export interface AnuncioDoFeed {
  codigo: string;
  titulo: string;
  descricao: string;
  tipo: string;
  tipo_vrsync: string;
  uso: string;
  area: 'util' | 'total';
  negocio: Negocio;
  destaque: Destaque;
  preco_venda: number | null;
  preco_aluguel: number | null;
  periodo_aluguel: Periodo;
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
  fotos: string[];
}

export interface Imobiliaria {
  nome: string | null;
  email: string | null;
  telefone: string | null;
  site: string | null;
}

export interface RespostaDoFeed {
  ok: boolean;
  imobiliaria?: Imobiliaria;
  anuncios?: AnuncioDoFeed[];
}

const TRANSACAO: Record<Negocio, string> = {
  venda: 'For Sale',
  aluguel: 'For Rent',
  venda_aluguel: 'Sale/Rent',
};

const PUBLICACAO: Record<Destaque, string> = {
  padrao: 'STANDARD',
  destaque: 'PREMIUM',
  super_destaque: 'SUPER_PREMIUM',
  exclusivo: 'PREMIERE_1',
  superior: 'PREMIERE_2',
};

const PERIODO: Record<Periodo, string> = {
  mensal: 'Monthly',
  diario: 'Daily',
  semanal: 'Weekly',
  trimestral: 'Quarterly',
  anual: 'Yearly',
};

const MOSTRAR: Record<MostrarEndereco, string> = {
  completo: 'All',
  rua: 'Street',
  bairro: 'Neighborhood',
};

/** O VRSync pede a sigla no atributo e o nome no texto: `<State abbreviation="RN">`. */
const ESTADOS: Record<string, string> = {
  AC: 'Acre',
  AL: 'Alagoas',
  AP: 'Amapá',
  AM: 'Amazonas',
  BA: 'Bahia',
  CE: 'Ceará',
  DF: 'Distrito Federal',
  ES: 'Espírito Santo',
  GO: 'Goiás',
  MA: 'Maranhão',
  MT: 'Mato Grosso',
  MS: 'Mato Grosso do Sul',
  MG: 'Minas Gerais',
  PA: 'Pará',
  PB: 'Paraíba',
  PR: 'Paraná',
  PE: 'Pernambuco',
  PI: 'Piauí',
  RJ: 'Rio de Janeiro',
  RN: 'Rio Grande do Norte',
  RS: 'Rio Grande do Sul',
  RO: 'Rondônia',
  RR: 'Roraima',
  SC: 'Santa Catarina',
  SP: 'São Paulo',
  SE: 'Sergipe',
  TO: 'Tocantins',
};

/** Texto de elemento ou de atributo, com as cinco entidades do XML. */
export function escapar(valor: string): string {
  return valor
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Texto livre (título, descrição, nomes com acento) vai em CDATA, como a
 * documentação pede para evitar erro de codificação. Um "]]>" dentro do texto
 * fecharia a seção: ele é partido em duas.
 */
export function cdata(valor: string): string {
  return `<![CDATA[${valor.replace(/]]>/g, ']]]]><![CDATA[>')}]]>`;
}

/**
 * Quebra de linha na descrição: o portal só a mostra pela entidade `&lt;br&gt;`
 * dentro do CDATA (details.html#description). A entidade gasta 8 caracteres por
 * linha, e a descrição tem teto de 3.000: se a versão com quebras passar do
 * teto, vai o texto puro, que o portal aceita, só que em parágrafo único.
 */
export function descricaoDoPortal(texto: string): string {
  const limpo = texto.replace(/\r\n?/g, '\n').trim();
  const comQuebras = limpo.replace(/\n/g, '&lt;br&gt;\n');
  return comQuebras.length <= 3000 ? comQuebras : limpo;
}

/** "59090000" → "59090-000", o formato dos exemplos do VRSync. */
export function cepDoPortal(cep: string): string {
  return /^\d{8}$/.test(cep) ? `${cep.slice(0, 5)}-${cep.slice(5)}` : cep;
}

/** "2026-11-04T15:30:00", no fuso da operação (CLAUDE.md), sem deslocamento: é o formato do exemplo. */
export function dataDoCabecalho(agora: Date): string {
  const partes = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Fortaleza',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(agora)
      .map((p) => [p.type, p.value]),
  );
  return `${partes.year}-${partes.month}-${partes.day}T${partes.hour}:${partes.minute}:${partes.second}`;
}

function elemento(nome: string, conteudo: string, atributos: Record<string, string> = {}): string {
  const attrs = Object.entries(atributos)
    .map(([k, v]) => ` ${k}="${escapar(v)}"`)
    .join('');
  return `<${nome}${attrs}>${conteudo}</${nome}>`;
}

function numero(
  nome: string,
  valor: number | null | undefined,
  atributos: Record<string, string> = {},
): string {
  if (valor === null || valor === undefined || !Number.isFinite(valor)) return '';
  return elemento(nome, String(Math.trunc(valor)), atributos);
}

function texto(nome: string, valor: string | null | undefined, comCdata = false): string {
  if (valor === null || valor === undefined || valor.trim() === '') return '';
  return elemento(nome, comCdata ? cdata(valor) : escapar(valor));
}

function midia(a: AnuncioDoFeed, urlDaFoto: (caminho: string) => string): string {
  const itens: string[] = [];
  if (a.video_youtube) itens.push(elemento('Item', escapar(a.video_youtube), { medium: 'video' }));
  a.fotos.forEach((caminho, i) => {
    itens.push(
      elemento(
        'Item',
        escapar(urlDaFoto(caminho)),
        i === 0 ? { medium: 'image', primary: 'true' } : { medium: 'image' },
      ),
    );
  });
  return elemento('Media', itens.join(''));
}

function detalhes(a: AnuncioDoFeed): string {
  const brl = { currency: 'BRL' };
  // Área: terreno, galpão, chácara e fazenda mandam a total (LotArea); o resto,
  // a útil (LivingArea). O portal recusa anúncio sem nenhum LivingArea ("requer
  // que ao menos um valor seja fornecido"), então nos tipos de área total ele
  // vai com a útil, se houver, ou com a própria total.
  const m2 = { unit: 'square metres' };
  const areaUtil = a.area === 'total' ? (a.area_util ?? a.area_total) : a.area_util;
  // Quartos: kitnet é sempre 0 e pode faltar (vai sem); studio pede o número,
  // com mínimo 0 (vai 0 se ninguém disse).
  const quartos = a.tipo === 'kitnet' ? null : a.tipo === 'studio' ? (a.quartos ?? 0) : a.quartos;
  const caracteristicas = a.caracteristicas.length
    ? elemento('Features', a.caracteristicas.map((c) => elemento('Feature', escapar(c))).join(''))
    : '';
  return elemento(
    'Details',
    [
      elemento('UsageType', escapar(a.uso)),
      elemento('PropertyType', escapar(a.tipo_vrsync)),
      elemento('Description', cdata(descricaoDoPortal(a.descricao))),
      a.negocio !== 'aluguel' ? numero('ListPrice', a.preco_venda, brl) : '',
      a.negocio !== 'venda'
        ? numero('RentalPrice', a.preco_aluguel, { ...brl, period: PERIODO[a.periodo_aluguel] })
        : '',
      numero('PropertyAdministrationFee', a.condominio, brl),
      numero('Iptu', a.iptu, {
        ...brl,
        period: a.iptu_periodo === 'mensal' ? 'Monthly' : 'Yearly',
      }),
      numero('LotArea', a.area_total, m2),
      numero('LivingArea', areaUtil, m2),
      numero('Bedrooms', quartos),
      numero('Bathrooms', a.banheiros),
      numero('Suites', a.suites),
      numero('Garage', a.vagas, { type: 'Parking Space' }),
      caracteristicas,
    ].join(''),
  );
}

function local(a: AnuncioDoFeed): string {
  const uf = (a.estado ?? '').toUpperCase();
  return elemento(
    'Location',
    [
      elemento('Country', 'Brasil', { abbreviation: 'BR' }),
      uf ? elemento('State', cdata(ESTADOS[uf] ?? uf), { abbreviation: uf }) : '',
      texto('City', a.cidade, true),
      texto('Neighborhood', a.bairro, true),
      texto('Address', a.endereco, true),
      texto('StreetNumber', a.numero),
      // "Essa informação não vai aparecer nos portais" (listing.html#location).
      texto('Complement', a.complemento, true),
      a.cep ? elemento('PostalCode', cepDoPortal(a.cep)) : '',
    ].join(''),
    { displayAddress: MOSTRAR[a.mostrar_endereco] },
  );
}

function contato(i: Imobiliaria): string {
  return elemento(
    'ContactInfo',
    [
      texto('Name', i.nome, true),
      texto('Email', i.email),
      texto('Website', i.site),
      texto('Telephone', i.telefone),
    ].join(''),
  );
}

function anuncio(a: AnuncioDoFeed, i: Imobiliaria, urlDaFoto: (caminho: string) => string): string {
  return elemento(
    'Listing',
    [
      elemento('ListingID', escapar(a.codigo)),
      elemento('Title', cdata(a.titulo.trim())),
      elemento('TransactionType', TRANSACAO[a.negocio]),
      elemento('PublicationType', PUBLICACAO[a.destaque]),
      midia(a, urlDaFoto),
      detalhes(a),
      local(a),
      contato(i),
    ].join('\n'),
  );
}

/**
 * O arquivo inteiro. `urlDaFoto` transforma o caminho no balde na URL pública
 * que o robô do Grupo OLX baixa.
 */
export function montarVrsync(
  imobiliaria: Imobiliaria,
  anuncios: AnuncioDoFeed[],
  urlDaFoto: (caminho: string) => string,
  agora: Date = new Date(),
): string {
  const cabecalho = elemento(
    'Header',
    [
      elemento('Provider', 'Tríade'),
      texto('Email', imobiliaria.email),
      texto('ContactName', imobiliaria.nome, true),
      elemento('PublishDate', dataDoCabecalho(agora)),
      texto('Telephone', imobiliaria.telefone),
    ].join(''),
  );
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<ListingDataFeed xmlns="http://www.vivareal.com/schemas/1.0/VRSync"',
    '                 xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"',
    '                 xsi:schemaLocation="http://www.vivareal.com/schemas/1.0/VRSync  http://xml.vivareal.com/vrsync.xsd">',
    cabecalho,
    '<Listings>',
    ...anuncios.map((a) => anuncio(a, imobiliaria, urlDaFoto)),
    '</Listings>',
    '</ListingDataFeed>',
    '',
  ].join('\n');
}
