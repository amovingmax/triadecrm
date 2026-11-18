/**
 * Sincronizar com o Canal Pro (18/11/2026), só na Imova.
 *
 * O pedido: "a gente deve estar recebendo todas as imagens cadastradas do
 * terreno dentro do nosso CRM", inclusive dos anúncios não publicados, e "só
 * lançar coisas que não tem ainda". O relatório em planilha do Canal Pro não traz
 * as fotos (só quantas são), e o favorito de 09/11 (branch fotos-do-canal-pro,
 * que nunca subiu) lia a página de UM anúncio aberto por vez.
 *
 * COMO O CANAL PRO ENTREGA A LISTA. O site do Canal Pro (canalpro.grupozap.com,
 * Vue 2 + Apollo) busca "Meus anúncios" numa API GraphQL, em
 * https://gandalf-api.grupozap.com/, com a consulta `listings(pageSize,
 * pageNumber)`. Ela devolve todos os anúncios da conta, em qualquer situação
 * (ACTIVE, INACTIVE, DRAFT, PENDING, BLOCKED), com `images { imageUrl resizedUrl
 * newResizedUrl }`, os contadores em `leads { views phoneView clickWhatsapp ... }`,
 * endereço, áreas, cômodos e preços. A sessão vai no cabeçalho Authorization (o
 * token da loja Vuex, `account/token`) e mais X-PublisherId, X-OdinID,
 * X-ContractID e X-PublisherContractType. Tudo isso foi lido no código público do
 * site (o pacote JavaScript que a página de login baixa), em 18/11/2026; nada foi
 * testado com o login de verdade antes de subir.
 *
 * O FAVORITO "Imova: sincronizar" é um endereço `javascript:` que a gestão guarda
 * uma vez na barra de favoritos e clica com o Canal Pro aberto e logado. Ele roda
 * NA aba do Canal Pro, com a sessão de quem clicou (o CRM não guarda senha nem
 * token): acha a loja do Vue, pede a lista página por página (100 por vez) e abre
 * o CRM numa aba nova com tudo no fragmento do endereço (`#d=`), que não vai a
 * servidor nenhum. A aba nova é aberta NA HORA do clique e só recebe o endereço
 * depois, para o bloqueador de janelas não a barrar.
 *
 * O CRM CONFERE ANTES DE GRAVAR (`conferir`): o que é novo, o que só atualiza
 * situação e números, o que é o mesmo imóvel com outro código (não entra) e o que
 * ganha fotos. Gravar é a mesma importação do relatório (`canal_pro_importar`,
 * com as linhas montadas aqui no formato da planilha) e a mesma rota de fotos do
 * sistema atual (`api/anuncios/importar/fotos`).
 *
 * Módulo puro (fora o `COLETOR`, que é texto), testado em
 * `sincronizar-canal-pro.test.ts`.
 */
import { chave } from '@/components/importacao/mapeamento';

import type { LinhaDoCanalPro } from './aba-dos-anuncios';
import { FOTOS_POR_ANUNCIO } from './arquivo-vrsync';
import { ativoNoCanalPro, tipoDoCrm, type AnuncioDoRelatorio } from './relatorio-canal-pro';
import type { AnuncioNaLista, Negocio } from './tipos';

/** A versão do pacote que o favorito manda. */
export const VERSAO_DO_PACOTE = 3;

/**
 * O corpo do favorito, em JavaScript puro: vai inteiro no endereço do favorito e
 * roda na página do Canal Pro, então não passa pelo compilador. Recebe o
 * documento, o endereço, a janela e o endereço do CRM, para o teste trocar por
 * imitações.
 */
export const COLETOR = String.raw`function (d, l, j, crm) {
  function avisar(t) { j.alert('Imova: ' + t); }
  if (!/(^|\.)canal-?pro\.grupozap\.com$/.test(l.hostname)) {
    avisar('abra o Canal Pro (canalpro.grupozap.com), entre com o login da Imova e clique de novo no favorito.');
    return;
  }
  var raiz = null, app = d.getElementById('app');
  if (app && app.__vue__) raiz = app.__vue__.$root;
  if (!raiz) {
    var els = d.querySelectorAll('body *');
    for (var i = 0; i < els.length && i < 5000; i++) {
      if (els[i].__vue__) { raiz = els[i].__vue__.$root; break; }
    }
  }
  var loja = raiz && raiz.$store, tk = null, pub = null;
  try { tk = loja.getters['account/token'](); } catch (e) { tk = null; }
  if (!tk || !tk.token) {
    avisar('esta aba do Canal Pro não está logada. Entre com o login da Imova, abra Meus anúncios e clique de novo no favorito.');
    return;
  }
  try { pub = loja.getters['account/selectedPublisher']; } catch (e) { pub = null; }
  var cab = {
    'Content-Type': 'application/json',
    'Authorization': tk.token,
    'X-PublisherId': tk.publisherId,
    'X-OdinID': tk.odinId,
    'X-ContractID': tk.contractId,
    'X-PublisherContractType': tk.publisherContractType,
    'X-ClientID': 'CANALPRO_WEB',
    'X-Company': pub && pub.contract
  };
  for (var k in cab) { if (cab[k] === undefined || cab[k] === null || cab[k] === '') delete cab[k]; }
  var janela = j.open('', '_blank');
  try { janela.document.write('<p style="font:16px sans-serif;padding:24px">Imova: lendo os anúncios do Canal Pro…</p>'); } catch (e) {}
  var CAMPOS = 'externalId id status publicationType unitTypes usableAreas totalAreas bedrooms bathrooms suites parkingSpaces createdAt updatedAt ' +
    'address { city neighborhood street streetNumber zipCode state } ' +
    'pricingInfos { price businessType monthlyCondoFee yearlyIptu rentalInfo { period } } ' +
    'leads { views phoneView clickWhatsapp contactForm clickProposal clickSchedule } ' +
    'images { imageId imageUrl resizedUrl newResizedUrl }';
  // Do pedido mais completo ao mais simples: com título e descrição e com todas
  // as situações; sem título; sem o filtro de situação (o Canal Pro decide).
  var jeitos = [{ t: true, s: true }, { t: false, s: true }, { t: false, s: false }];
  var jeito = 0, todos = [];
  var SITUACOES = ['ACTIVE', 'INACTIVE', 'DRAFT', 'PENDING', 'BLOCKED'];
  function pagina(n) {
    var j0 = jeitos[jeito];
    var q = 'query listings($pageSize: Int, $pageNumber: Int' + (j0.s ? ', $listingStatus: [ListingStatusEnumType]' : '') + ') { ' +
      'listings(pageSize: $pageSize, pageNumber: $pageNumber' + (j0.s ? ', listingStatus: $listingStatus' : '') + ') { listListing { ' +
      (j0.t ? 'title description ' : '') + CAMPOS + ' } pageNumber totalPages totalResults } }';
    var vars = { pageSize: 100, pageNumber: n };
    if (j0.s) vars.listingStatus = SITUACOES;
    return j.fetch('https://gandalf-api.grupozap.com/', {
      method: 'POST', headers: cab,
      body: JSON.stringify({ operationName: 'listings', query: q, variables: vars })
    }).then(function (r) { return r.json(); });
  }
  function seguir(n) {
    return pagina(n).then(function (r) {
      var ls = r && r.data && r.data.listings;
      if (!ls && n === 1 && jeito < jeitos.length - 1 && r && r.errors && r.errors.length) { jeito++; return seguir(n); }
      if (!ls) throw new Error((r && r.errors && r.errors[0] && r.errors[0].message) || 'resposta sem anúncios');
      todos = todos.concat(ls.listListing || []);
      if (ls.totalPages && n < ls.totalPages && n < 30) return seguir(n + 1);
      return ls.totalResults;
    });
  }
  seguir(1).then(function (total) {
    var pacote = { v: 3, de: l.origin, em: new Date().toISOString(), total: total, jeito: jeito, anuncios: todos };
    var url = crm + '/anuncios/sincronizar#d=' + encodeURIComponent(JSON.stringify(pacote));
    if (janela && !janela.closed) janela.location.href = url; else l.href = url;
  })['catch'](function (e) {
    try { if (janela) janela.close(); } catch (x) {}
    avisar('o Canal Pro não entregou a lista (' + ((e && e.message) || e) + '). Recarregue a página do Canal Pro e clique de novo.');
  });
}`;

/** O endereço `javascript:` do favorito, para o CRM em `crm` (sem barra no fim). */
export function favoritoDeSincronizar(crm: string): string {
  const base = crm.replace(/\/+$/, '');
  return `javascript:${encodeURIComponent(`(${COLETOR})(document,location,window,${JSON.stringify(base)});void 0`)}`;
}

// ---------------------------------------------------------------------------
// O pacote
// ---------------------------------------------------------------------------

type Cru = Record<string, unknown>;

/** Um anúncio como o Canal Pro devolve em `listListing` (só o que o CRM usa). */
export type AnuncioDoCanalPro = {
  externalId?: string | null;
  id?: string | null;
  title?: string | null;
  description?: string | null;
  status?: string | null;
  publicationType?: string | null;
  unitTypes?: string[] | null;
  usableAreas?: (number | string | null)[] | null;
  totalAreas?: (number | string | null)[] | null;
  bedrooms?: (number | string | null)[] | null;
  bathrooms?: (number | string | null)[] | null;
  suites?: (number | string | null)[] | null;
  parkingSpaces?: (number | string | null)[] | null;
  createdAt?: string | null;
  address?: {
    city?: string | null;
    neighborhood?: string | null;
    street?: string | null;
    streetNumber?: string | null;
    zipCode?: string | null;
    state?: string | null;
  } | null;
  pricingInfos?:
    | {
        price?: string | number | null;
        businessType?: string | null;
        monthlyCondoFee?: string | number | null;
        yearlyIptu?: string | number | null;
      }[]
    | null;
  leads?: {
    views?: number | null;
    phoneView?: number | null;
    clickWhatsapp?: number | null;
    contactForm?: number | null;
    clickProposal?: number | null;
    clickSchedule?: number | null;
  } | null;
  images?:
    | { imageUrl?: string | null; resizedUrl?: string | null; newResizedUrl?: string | null }[]
    | null;
};

export type PacoteDoCanalPro = {
  versao: number;
  /** De onde veio (o endereço do Canal Pro). */
  de: string;
  em: string;
  /** Quantos o Canal Pro disse que tem, para conferir com quantos vieram. */
  total: number | null;
  anuncios: AnuncioDoCanalPro[];
};

/** Até quantos anúncios o CRM aceita num pacote (o plano da Imova tem 10 vagas). */
const ANUNCIOS_NO_PACOTE = 2000;

/** Lê o pacote do fragmento do endereço (`#d=...`); null quando não é um pacote do favorito. */
export function lerPacote(fragmento: string): PacoteDoCanalPro | null {
  const m = /(?:^#|&)d=([^&]*)/.exec(fragmento.startsWith('#') ? fragmento : `#${fragmento}`);
  if (!m) return null;
  let cru: unknown;
  try {
    cru = JSON.parse(decodeURIComponent(m[1]!));
  } catch {
    return null;
  }
  if (!cru || typeof cru !== 'object') return null;
  const p = cru as Cru;
  if (p.v !== VERSAO_DO_PACOTE || !Array.isArray(p.anuncios)) return null;
  const anuncios = p.anuncios
    .filter((a): a is AnuncioDoCanalPro => !!a && typeof a === 'object')
    .slice(0, ANUNCIOS_NO_PACOTE);
  return {
    versao: VERSAO_DO_PACOTE,
    de: typeof p.de === 'string' ? p.de : '',
    em: typeof p.em === 'string' ? p.em : '',
    total: typeof p.total === 'number' ? p.total : null,
    anuncios,
  };
}

// ---------------------------------------------------------------------------
// Do Canal Pro para o formato do relatório
// ---------------------------------------------------------------------------

/** As situações do Canal Pro, com as palavras do relatório que ele exporta. */
const SITUACAO: Record<string, string> = {
  ACTIVE: 'Ativo',
  INACTIVE: 'Inativo',
  DRAFT: 'Rascunho',
  PENDING: 'Em processamento',
  PROCESSING: 'Em processamento',
  BLOCKED: 'Bloqueado',
};

/** Os tipos do Canal Pro (`unitTypes`), com as palavras do relatório. */
const TIPO: Record<string, string> = {
  APARTMENT: 'Apartamento',
  HOME: 'Casa',
  CONDOMINIUM: 'Casa de condomínio',
  VILLAGE_HOUSE: 'Casa de vila',
  TWO_STORY_HOUSE: 'Sobrado',
  PENTHOUSE: 'Cobertura',
  FLAT: 'Flat',
  KITNET: 'Kitnet',
  LOFT: 'Loft',
  STUDIO: 'Studio',
  ALLOTMENT_LAND: 'Lote/Terreno',
  RESIDENTIAL_ALLOTMENT_LAND: 'Lote/Terreno',
  COMMERCIAL_ALLOTMENT_LAND: 'Terreno comercial',
  FARM: 'Fazenda/Sítio',
  COUNTRY_HOUSE: 'Chácara',
  OFFICE: 'Sala/Conjunto',
  CLINIC: 'Consultório',
  BUSINESS: 'Ponto comercial/Loja/Box',
  COMMERCIAL_PROPERTY: 'Imóvel comercial',
  COMMERCIAL_BUILDING: 'Prédio comercial',
  RESIDENTIAL_BUILDING: 'Prédio residencial',
  SHED_DEPOSIT_WAREHOUSE: 'Galpão/Depósito/Armazém',
  PARKING_SPACE: 'Garagem',
  HOTEL: 'Hotel',
};

/** O primeiro número da lista; aceita número em texto ("3000") e arredonda (o banco quer inteiro). */
const primeiro = (v: (number | string | null)[] | null | undefined): number | null => {
  for (const x of Array.isArray(v) ? v : []) {
    const n = typeof x === 'number' ? x : typeof x === 'string' ? Number(x.replace(',', '.')) : NaN;
    if (Number.isFinite(n) && n >= 0) return Math.round(n);
  }
  return null;
};
const valor = (v: unknown): number | null => {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v.replace(',', '.')) : NaN;
  return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
};
const texto = (v: unknown): string | null =>
  typeof v === 'string' && v.trim() !== '' ? v.trim() : null;

/** O código do anúncio no Canal Pro: o ListingID que o sistema publicou (ou o id de lá). */
export function codigoDoCanalPro(a: AnuncioDoCanalPro): string | null {
  return texto(a.externalId) ?? texto(a.id);
}

/** Apagado no Canal Pro, ou sem código: não entra. */
export function entraNaSincronizacao(a: AnuncioDoCanalPro): boolean {
  return codigoDoCanalPro(a) !== null && a.status !== 'DELETED';
}

export function situacaoNoCanalPro(a: AnuncioDoCanalPro): string | null {
  return a.status ? (SITUACAO[a.status] ?? a.status) : null;
}

export function negocioNoCanalPro(a: AnuncioDoCanalPro): Negocio | null {
  const tipos = new Set((a.pricingInfos ?? []).map((p) => p?.businessType));
  if (tipos.has('SALE') && tipos.has('RENTAL')) return 'venda_aluguel';
  if (tipos.has('RENTAL')) return 'aluguel';
  if (tipos.has('SALE')) return 'venda';
  return null;
}

/** "Padrão" ou um dos destaques, como o relatório escreve. */
function destaqueNoCanalPro(a: AnuncioDoCanalPro): string | null {
  if (!a.publicationType) return null;
  if (a.publicationType === 'STANDARD') return 'Padrão';
  if (/SUPER/.test(a.publicationType)) return 'Super destaque';
  return 'Destaque';
}

/** Os contatos que o Canal Pro conta para o anúncio (todo meio, sem as visualizações). */
export function contatosNoCanalPro(a: AnuncioDoCanalPro): number | null {
  const l = a.leads;
  if (!l) return null;
  const partes = [l.phoneView, l.clickWhatsapp, l.contactForm, l.clickProposal, l.clickSchedule];
  if (partes.every((p) => typeof p !== 'number')) return null;
  return partes.reduce<number>((s, p) => s + (typeof p === 'number' ? p : 0), 0);
}

/** "DD-MM-AAAA", como a coluna Criação do relatório (o banco lê assim). */
function diaDoRelatorio(iso: string | null | undefined): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? '');
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
}

/**
 * As fotos do anúncio, na ordem do Canal Pro, cada uma com as versões que a rota
 * tenta (a maior primeiro). Os endereços redimensionados do Grupo OLX vêm com
 * moldes (`{action}`, `{width}x{height}`), que viram a versão grande.
 */
export function fotosDoCanalPro(a: AnuncioDoCanalPro): string[][] {
  const preencher = (url: string, largura: number, altura: number) =>
    url
      .replace(/\{action\}/g, 'fit-in')
      .replace(/\{width\}/g, String(largura))
      .replace(/\{height\}/g, String(altura))
      .replace(/\{description\}/g, 'foto');
  const fotos: string[][] = [];
  for (const imagem of a.images ?? []) {
    if (!imagem) continue;
    const versoes: string[] = [];
    for (const cru of [imagem.imageUrl, imagem.newResizedUrl, imagem.resizedUrl]) {
      const url = texto(cru);
      if (!url) continue;
      for (const [w, h] of [
        [1920, 1080],
        [870, 707],
      ] as const) {
        const pronta = preencher(url, w, h);
        if (/^https?:\/\//.test(pronta) && !/[{}]/.test(pronta) && !versoes.includes(pronta)) {
          versoes.push(pronta);
        }
      }
    }
    if (versoes.length) fotos.push(versoes.slice(0, 4));
  }
  return fotos.slice(0, FOTOS_POR_ANUNCIO);
}

/** Uma linha no formato do relatório do Canal Pro, que `canal_pro_importar` recebe. */
export function paraORelatorio(a: AnuncioDoCanalPro): AnuncioDoRelatorio | null {
  const codigo = codigoDoCanalPro(a);
  if (!codigo || !entraNaSincronizacao(a)) return null;
  const tipo = a.unitTypes?.[0]
    ? (TIPO[a.unitTypes[0]] ?? a.unitTypes[0].replace(/_/g, ' '))
    : null;
  const venda = (a.pricingInfos ?? []).find((p) => p?.businessType === 'SALE');
  const aluguel = (a.pricingInfos ?? []).find((p) => p?.businessType === 'RENTAL');
  const precos = venda ?? aluguel;
  const end = a.address ?? {};
  const areaUtil = primeiro(a.usableAreas);
  const areaTotal = primeiro(a.totalAreas);
  const contatos = contatosNoCanalPro(a);
  const visualizacoes = typeof a.leads?.views === 'number' ? a.leads.views : null;
  const fotos = (a.images ?? []).filter(Boolean).length;
  const endereco = [texto(end.street), texto(end.streetNumber)].filter(Boolean).join(', ') || null;
  const situacao = situacaoNoCanalPro(a);
  const destaque = destaqueNoCanalPro(a);
  const linha: Record<string, string> = {};
  const por = (k: string, v: string | number | null | undefined) => {
    if (v !== null && v !== undefined && String(v).trim() !== '') linha[k] = String(v);
  };
  por('Código do Imóvel', codigo);
  por('ID Interno', texto(a.id));
  por('Título do imóvel', texto(a.title));
  por('Descrição', texto(a.description));
  por('Tipo do imóvel', tipo);
  por('Status do anúncio', situacao);
  por('Tipo do anúncio', destaque);
  por('CEP', texto(end.zipCode));
  por('Endereço', endereco);
  por('Bairro', texto(end.neighborhood));
  por('Cidade', texto(end.city));
  por('Estado', texto(end.state));
  por('Quartos', primeiro(a.bedrooms));
  por('Suítes', primeiro(a.suites));
  por('Banheiros', primeiro(a.bathrooms));
  por('Vagas', primeiro(a.parkingSpaces));
  por('Área útil', areaUtil);
  por('Área total', areaTotal);
  por('Valor de Venda', valor(venda?.price));
  por('Valor do aluguel', valor(aluguel?.price));
  por('Condomínio/mês', valor(precos?.monthlyCondoFee));
  por('IPTU/ano', valor(precos?.yearlyIptu));
  por('Número de fotos', fotos);
  por('Total de visualizações', visualizacoes);
  por('Total de contatos', contatos);
  por('Criação', diaDoRelatorio(a.createdAt));
  por('Veio de', 'Sincronização com o Canal Pro');
  return {
    codigo,
    titulo: texto(a.title),
    tipo,
    tipo_crm: tipoDoCrm(tipo),
    negocio: negocioNoCanalPro(a),
    preco_venda: valor(venda?.price),
    preco_aluguel: valor(aluguel?.price),
    bairro: texto(end.neighborhood),
    cidade: texto(end.city),
    endereco,
    area: areaUtil ?? areaTotal,
    quartos: primeiro(a.bedrooms),
    destaque,
    situacao,
    link:
      a.status === 'ACTIVE' && texto(a.id)
        ? `https://www.zapimoveis.com.br/imovel/imovel-id-${texto(a.id)}`
        : null,
    linha,
  };
}

// ---------------------------------------------------------------------------
// A conferência antes de gravar
// ---------------------------------------------------------------------------

/**
 * O mesmo imóvel com outro código, como `public.canal_pro_parece_com` decide no
 * banco: mesma cidade, a área igual à útil ou à total do anúncio do CRM e, quando
 * os dois dizem, o mesmo bairro.
 */
export function pareceComNoCrm(
  r: Pick<AnuncioDoRelatorio, 'codigo' | 'cidade' | 'bairro' | 'area'>,
  anuncios: readonly Pick<
    AnuncioNaLista,
    'id' | 'codigo' | 'cidade' | 'bairro' | 'area_util' | 'area_total' | 'excluido_em'
  >[],
): string | null {
  if (r.area === null || !chave(r.cidade ?? '')) return null;
  const achado = anuncios.find(
    (a) =>
      !a.excluido_em &&
      a.codigo !== r.codigo &&
      chave(a.cidade ?? '') === chave(r.cidade ?? '') &&
      (a.area_util === r.area || a.area_total === r.area) &&
      (!chave(r.bairro ?? '') ||
        !chave(a.bairro ?? '') ||
        chave(a.bairro ?? '') === chave(r.bairro ?? '')),
  );
  return achado?.id ?? null;
}

export type ModoDasFotos = 'se_vazio' | 'trocar';

export type FotosParaTrazer = {
  codigo: string;
  /** Null nos novos: o anúncio do CRM só existe depois de gravar. */
  anuncioId: string | null;
  tem: number;
  vem: number;
  modo: ModoDasFotos;
  urls: string[][];
};

export type Conferencia = {
  /** Quantos vieram (sem os apagados no Canal Pro). */
  vieram: number;
  /** Quantos o Canal Pro disse que tem. */
  total: number | null;
  /** Códigos diferentes no pacote, inclusive os apagados: é o que se compara com `total`. */
  distintos: number;
  /** A lista veio inteira? Sem o total, ou com menos códigos que ele, não. */
  inteira: boolean;
  linhas: AnuncioDoRelatorio[];
  novos: { codigo: string; titulo: string | null; situacao: string | null }[];
  /** Mesmo código que um anúncio do CRM (ou ligado a um): só atualizam situação e números. */
  casam: { codigo: string; anuncioId: string }[];
  /**
   * Mesmo imóvel de um anúncio do CRM (ou de um novo desta mesma lista), com outro
   * código: não entram como anúncio novo.
   */
  copias: {
    codigo: string;
    situacao: string | null;
    anuncioId: string | null;
    codigoNoCrm: string;
  }[];
  fotos: FotosParaTrazer[];
  /** O CRM e o Canal Pro juntos passam do teto: a troca fica para o editor. */
  semTroca: { codigo: string; tem: number; vem: number }[];
  /** Estavam na última lista do Canal Pro e não vieram agora. */
  sairam: string[];
};

/**
 * Compara o que veio do Canal Pro com o que o CRM já tem, sem gravar nada. As
 * fotos vêm quando o Canal Pro tem MAIS que o CRM: no anúncio sem foto, todas; no
 * que tem algumas, o CRM troca pelas de lá (a rota só troca se todas chegarem).
 * Ficam como estão: o CRM com mais fotos; o anúncio que o CRM já publica (o
 * Grupo OLX lê o arquivo do CRM, então o CRM é a fonte); e o que passaria do teto
 * de fotos somando as duas (vai em `semTroca`).
 *
 * Os novos seguem a ordem do banco (`canal_pro_importar`: ativos primeiro, depois
 * pelo código): dois do mesmo imóvel só trazem o primeiro; o outro é cópia dele.
 */
export function conferir(
  pacote: PacoteDoCanalPro,
  anuncios: readonly AnuncioNaLista[],
  linhasDoCanalPro: readonly Pick<LinhaDoCanalPro, 'codigo' | 'anuncio_id'>[],
): Conferencia {
  const vivos = anuncios.filter((a) => !a.excluido_em);
  const porCodigo = new Map(anuncios.map((a) => [a.codigo, a]));
  const ligados = new Map(
    linhasDoCanalPro.filter((l) => l.anuncio_id).map((l) => [l.codigo, l.anuncio_id!]),
  );
  const distintos = new Set(
    pacote.anuncios.map(codigoDoCanalPro).filter((c): c is string => c !== null),
  ).size;
  const resultado: Conferencia = {
    vieram: 0,
    total: pacote.total,
    distintos,
    inteira: pacote.total !== null && distintos >= pacote.total,
    linhas: [],
    novos: [],
    casam: [],
    copias: [],
    fotos: [],
    semTroca: [],
    sairam: [],
  };
  const vistos = new Set<string>();
  const candidatos: { linha: AnuncioDoRelatorio; urls: string[][] }[] = [];
  for (const cru of pacote.anuncios) {
    const linha = paraORelatorio(cru);
    if (!linha || vistos.has(linha.codigo)) continue;
    vistos.add(linha.codigo);
    resultado.vieram += 1;
    resultado.linhas.push(linha);
    const urls = fotosDoCanalPro(cru);
    const doCrm =
      porCodigo.get(linha.codigo) ??
      anuncios.find((a) => a.id === ligados.get(linha.codigo)) ??
      null;
    if (doCrm) {
      // Excluído no CRM: a linha entra (situação e números), mas nada volta para ele.
      if (doCrm.excluido_em) continue;
      resultado.casam.push({ codigo: linha.codigo, anuncioId: doCrm.id });
      const crmEhAFonte = doCrm.situacao === 'no_ar' && doCrm.ultima_leitura_do_portal !== null;
      if (urls.length > doCrm.fotos && !crmEhAFonte) {
        if (doCrm.fotos > 0 && doCrm.fotos + urls.length > FOTOS_POR_ANUNCIO) {
          resultado.semTroca.push({ codigo: doCrm.codigo, tem: doCrm.fotos, vem: urls.length });
        } else {
          resultado.fotos.push({
            codigo: doCrm.codigo,
            anuncioId: doCrm.id,
            tem: doCrm.fotos,
            vem: urls.length,
            modo: doCrm.fotos === 0 ? 'se_vazio' : 'trocar',
            urls,
          });
        }
      }
      continue;
    }
    const igual = pareceComNoCrm(linha, vivos);
    if (igual) {
      const a = vivos.find((x) => x.id === igual)!;
      resultado.copias.push({
        codigo: linha.codigo,
        situacao: linha.situacao,
        anuncioId: a.id,
        codigoNoCrm: a.codigo,
      });
      continue;
    }
    candidatos.push({ linha, urls });
  }
  // Os novos, na ordem do banco; cada um aceito vira referência para os seguintes.
  candidatos.sort(
    (x, y) =>
      Number(ativoNoCanalPro(y.linha.situacao)) - Number(ativoNoCanalPro(x.linha.situacao)) ||
      (x.linha.codigo < y.linha.codigo ? -1 : x.linha.codigo > y.linha.codigo ? 1 : 0),
  );
  const aceitos: Parameters<typeof pareceComNoCrm>[1][number][] = [];
  for (const { linha, urls } of candidatos) {
    const igual = pareceComNoCrm(linha, aceitos);
    if (igual) {
      resultado.copias.push({
        codigo: linha.codigo,
        situacao: linha.situacao,
        anuncioId: null,
        codigoNoCrm: igual,
      });
      continue;
    }
    aceitos.push({
      id: linha.codigo,
      codigo: linha.codigo,
      cidade: linha.cidade,
      bairro: linha.bairro,
      area_util: linha.area,
      area_total: linha.area,
      excluido_em: null,
    });
    resultado.novos.push({ codigo: linha.codigo, titulo: linha.titulo, situacao: linha.situacao });
    if (urls.length) {
      resultado.fotos.push({
        codigo: linha.codigo,
        anuncioId: null,
        tem: 0,
        vem: urls.length,
        modo: 'se_vazio',
        urls,
      });
    }
  }
  resultado.sairam = linhasDoCanalPro
    .map((l) => l.codigo)
    .filter((c) => !vistos.has(c))
    .sort((x, y) => x.localeCompare(y, 'pt-BR'));
  return resultado;
}

/** Quantas fotos a sincronização traz, ao todo. */
export function fotosQueVem(c: Pick<Conferencia, 'fotos'>): number {
  return c.fotos.reduce((s, f) => s + (f.modo === 'trocar' ? f.vem - f.tem : f.vem), 0);
}
