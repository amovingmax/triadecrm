/**
 * Sites de imobiliárias locais PERMITIDOS (veredito CONDICIONAL na auditoria
 * de 18/11/2026; só rodam depois que o dono libera a fonte, por
 * `public.mercado_fonte_liberar`). Porte de `coletar/anuncios/{lopes,
 * catalogue, imobibrasil, ibeda, imobinova, abreu}.mjs`.
 *
 * Condições da auditoria que valem para todos e que este arquivo respeita:
 *  - só páginas públicas de listagem, de imóvel e o mapa do site; nada de busca
 *    interna fechada pelo robots, formulário, API interna ou área logada;
 *  - só campos factuais (preço, área, quartos, vagas, bairro, link): sem foto,
 *    sem texto do anúncio, sem nome ou telefone de corretor;
 *  - o ritmo e o teto da lista (5 s entre páginas, 100 ou 200 por rodada), o
 *    robots.txt lido a cada rodada (`Navegador`).
 *
 * Sites lidos pelo mapa do site em rodízio (Catalogue e a plataforma
 * Imobibrasil): quem está no mapa e já foi lido antes, mas não foi relido
 * nesta rodada, continua no ar (`gravador.vistos`); quem saiu do mapa ganha
 * falta. Quem só está no mapa e nunca foi lido não entra (correção #11 da
 * verificação de 18/11).
 */
import { anuncioDeSite, ehRecusa, type CamposLidos, type Recusa } from '../anuncio';
import { Impressao, LoteDeAnuncios } from '../lote';
import { comoNome, deslug, semAcento } from '../texto';
import type { Coletor, ContextoDoColetor, ItemAnuncio, ResultadoDoColetor } from '../tipos';
import { entidades, jsonLd, locsDoSitemap, numeroBR, semTags } from '../web';

// ---------------------------------------------------------------------------
// Rodízio de leitura entre as rodadas (estado guardado na coleta)
// ---------------------------------------------------------------------------

const MAX_NO_RODIZIO = 5_000;

function lerRodizio(estado: Record<string, unknown>): Record<string, string> {
  const r = estado.lidos;
  if (!r || typeof r !== 'object' || Array.isArray(r)) return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(r as Record<string, unknown>))
    if (typeof v === 'string') out[k] = v;
  return out;
}

function podarRodizio(lidos: Record<string, string>): Record<string, string> {
  const pares = Object.entries(lidos).sort((a, b) => b[1].localeCompare(a[1]));
  return Object.fromEntries(pares.slice(0, MAX_NO_RODIZIO));
}

/**
 * Aviso de mapa ou lista vazia: o site pode ter mudado de formato. Sem nenhum
 * imóvel lido, a consulta NUNCA é "completa" (senão todos os anúncios da fonte
 * ganhariam falta e, em duas rodadas, sairiam do ar). O banco tem a mesma trava.
 */
const VAZIA =
  'nenhum imóvel reconhecido (o site mudou de formato?): a rodada não dá falta a ninguém';

function resultado(o: {
  lote: LoteDeAnuncios;
  impressao: Impressao;
  erros: string[];
  completa: boolean;
  consultasCompletas: string[];
  ctx: ContextoDoColetor;
  estado?: Record<string, unknown>;
  extra?: Record<string, unknown>;
}): ResultadoDoColetor {
  const parada = o.ctx.navegador.parada;
  const interrompida = parada !== null;
  return {
    completa: o.completa && !interrompida && o.erros.length === 0,
    // Cada coletor só põe aqui a consulta que leu até o fim (a busca inteira, o
    // mapa do site inteiro). O teto de páginas no meio do rodízio não invalida o
    // mapa já lido; um 429 ou 403 invalida tudo, na rodada (fecha com erro).
    consultasCompletas: o.consultasCompletas,
    hashBruto: o.impressao.fechar(),
    estado: o.estado,
    detalhes: {
      enviados: o.lote.ids.size,
      banco: o.lote.resumo,
      recusas: o.lote.recusas,
      pedidos: o.ctx.navegador.pedidos,
      fechados_pelo_robots: o.ctx.navegador.fechadosPeloRobots.length,
      parada,
      ...(o.extra ?? {}),
    },
    erros: o.erros,
  };
}

// ---------------------------------------------------------------------------
// Lopes: páginas públicas de busca de Natal e Parnamirim (bloco ng-state)
// ---------------------------------------------------------------------------

export function lerPaginaLopes(html: string): {
  itens: Array<Record<string, unknown>>;
  totalPaginas: number;
  total: number | null;
  links: Map<string, string>;
} {
  const m = String(html).match(/<script[^>]*id="ng-state"[^>]*>([\s\S]*?)<\/script>/);
  if (!m?.[1]) throw new Error('página sem o bloco ng-state (o site mudou?)');
  const j = JSON.parse(m[1]) as Record<string, unknown>;
  const k = Object.keys(j).find((x) => x.startsWith('search/geo'));
  type Prod = {
    content?: Array<Record<string, unknown>>;
    totalPages?: number;
    totalElements?: number;
  };
  let prod: Prod | undefined = k ? (j[k] as { products?: Prod } | undefined)?.products : undefined;
  if (!prod) {
    for (const v of Object.values(j)) {
      const b = (v as { b?: { products?: Prod } } | null)?.b?.products;
      if (b) {
        prod = b;
        break;
      }
    }
  }
  if (!prod) throw new Error('bloco ng-state sem a lista de imóveis');
  const links = new Map<string, string>();
  for (const x of String(html).matchAll(/href="(\/imovel\/([A-Z0-9]+)\/[^"]+)"/g))
    if (x[2] && x[1]) links.set(x[2], x[1]);
  return {
    itens: prod.content ?? [],
    totalPaginas: prod.totalPages ?? 1,
    total: prod.totalElements ?? null,
    links,
  };
}

const atributoLopes = (p: Record<string, unknown>, tipo: string): unknown =>
  ((p.attributes as Array<{ type?: string; value?: unknown }> | undefined) ?? []).find(
    (a) => a.type === tipo,
  )?.value ?? null;

export function itemDaLopes(
  p: Record<string, unknown>,
  links: Map<string, string>,
  origem: string,
): CamposLidos {
  const dto = (p.locationDTO as Record<string, string | undefined> | undefined) ?? {};
  const tipoTexto = String(p.divisionUnitType ?? p.type ?? '');
  const area = numeroBR(atributoLopes(p, 'area_attr'));
  const subPrice = String(p.subPrice ?? '');
  const href = links.get(String(p.id));
  const casa = /casa|sobrado/i.test(tipoTexto);
  const geo = (p.geolocation as { lat?: number; lng?: number } | undefined) ?? {};
  return {
    id_externo: String(p.id),
    modo: (p.dealType ?? 'sale') === 'rent' ? 'aluguel' : 'venda',
    tipoTexto,
    titulo: `${tipoTexto} à venda em ${dto.neighborhood ?? ''}, ${dto.city ?? ''}`.trim(),
    preco: numeroBR(p.sellingPriceFormat ?? p.priceFormat),
    // Casa: a área única do cartão parece ser a do lote (m² de casa 40% abaixo
    // das outras fontes em 18/11). Vai para a área total, marcada como ambígua:
    // o banco tira da conta do m² até a área construída ser conferida.
    ...(casa ? { area_total: area, marcas: ['area_ambigua'] } : { area_unica: area }),
    quartos: numeroBR(atributoLopes(p, 'bedroom_attr')),
    banheiros: numeroBR(atributoLopes(p, 'bathroom_attr')),
    vagas: numeroBR(atributoLopes(p, 'parking_lots_attr')),
    condominio: /condom/i.test(subPrice) ? numeroBR(subPrice) : null,
    bairro: dto.neighborhood ?? (String(p.neighborhood ?? '').split(',')[0] || null),
    cidade: dto.city ?? null,
    logradouro: typeof p.street === 'string' ? p.street : null,
    lat: (p.lat as number | undefined) ?? geo.lat ?? null,
    lng: (p.lng as number | undefined) ?? geo.lng ?? null,
    url: href ? `${origem}${href}` : `${origem}/imovel/${String(p.id)}`,
    bruto: {
      id: p.id,
      tipo: tipoTexto,
      preco: p.sellingPriceFormat ?? p.priceFormat,
      area: area,
      bairro: dto.neighborhood,
      cidade: dto.city,
      logradouro: p.street,
      lat: p.lat,
      lng: p.lng,
    },
  };
}

export const coletorLopes: Coletor = {
  chave: 'anuncios/lopes',
  maxPedidosPadrao: 200,
  caminhoDeTeste: '/busca/venda/br/rn/natal',
  async coletar(ctx) {
    const origem = 'https://www.lopes.com.br';
    const lote = new LoteDeAnuncios(ctx.gravador);
    const impressao = new Impressao();
    const erros: string[] = [];
    const consultasCompletas: string[] = [];
    const buscas = [
      { id: 'busca-natal', caminho: '/busca/venda/br/rn/natal' },
      { id: 'busca-parnamirim', caminho: '/busca/venda/br/rn/parnamirim' },
    ];
    const lidas: Record<string, unknown> = {};
    for (const b of buscas) {
      const itens: Array<ItemAnuncio | Recusa> = [];
      const unicos = new Set<string>();
      let total: number | null = null;
      let ok = true;
      let paginas = 0;
      for (let pg = 1; pg <= 50; pg += 1) {
        const url = `${origem}${b.caminho}${pg > 1 ? `/pagina/${pg}` : ''}`;
        const r = await ctx.navegador.pagina(url);
        if (!r?.texto) {
          ok = false;
          erros.push(
            `${url}: ${r ? `HTTP ${r.status}${r.erro ? ` ${r.erro}` : ''}` : (ctx.navegador.parada ?? 'robots fecha')}`,
          );
          break;
        }
        let pag: ReturnType<typeof lerPaginaLopes>;
        try {
          pag = lerPaginaLopes(r.texto);
        } catch (e) {
          ok = false;
          erros.push(`${url}: ${e instanceof Error ? e.message : String(e)}`);
          break;
        }
        paginas += 1;
        total = pag.total;
        for (const p of pag.itens) {
          unicos.add(String(p.id));
          const campos = itemDaLopes(p, pag.links, origem);
          impressao.somar({ url, sha256_pagina: r.sha256, item: campos.bruto });
          itens.push(
            anuncioDeSite(
              { ...campos, hash_bruto: r.sha256, data_dado: ctx.dia, consulta_id: b.id },
              ctx.regioes,
            ),
          );
        }
        if (pg >= pag.totalPaginas || pag.itens.length === 0) break;
      }
      // Só é varredura completa se todos os imóveis apareceram (a paginação às vezes repete), e se houve algum.
      const completa = ok && total !== null && unicos.size > 0 && unicos.size >= total;
      if (ok && unicos.size === 0) erros.push(`${b.id}: ${VAZIA}`);
      await lote.consulta(itens, completa);
      if (completa) consultasCompletas.push(b.id);
      lidas[b.id] = { total, distintos: unicos.size, paginas, completa };
    }
    await lote.esvaziar();
    return resultado({
      lote,
      impressao,
      erros,
      completa: consultasCompletas.length === buscas.length,
      consultasCompletas,
      ctx,
      extra: { buscas: lidas },
    });
  },
};

// ---------------------------------------------------------------------------
// Catalogue Imóveis: mapa do site + página do imóvel (__NEXT_DATA__)
// ---------------------------------------------------------------------------

const RE_CATALOGUE =
  /\/imovel\/(venda|locacao|venda-e-locacao)\/([^/]+)\/([^/]+)\/([^/]+)\/(\d+)\/?$/;

export function lerImovelCatalogue(html: string): Record<string, unknown> {
  const m = String(html).match(/<script[^>]*id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (!m?.[1]) throw new Error('página sem __NEXT_DATA__');
  const p = (
    JSON.parse(m[1]) as {
      props?: {
        initialProps?: {
          pageProps?: { template?: { data?: { property?: Record<string, unknown> } } };
        };
      };
    }
  )?.props?.initialProps?.pageProps?.template?.data?.property;
  if (!p || !p.idtProperty) throw new Error('página sem os dados do imóvel');
  return p;
}

/** Uma página de imóvel da Catalogue → um item por modo (venda e aluguel viram dois). */
export function itensDaCatalogue(
  p: Record<string, unknown>,
  url: string,
): Array<CamposLidos | { recusa: string }> {
  if (p.indStatus !== undefined && p.indStatus !== null && p.indStatus !== 1)
    return [{ recusa: 'imóvel inativo no site' }];
  const tipoTexto = [p.namCategory, p.namSubCategory].filter(Boolean).join(' ');
  const terreno = /terreno/i.test(tipoTexto);
  const mostraMapa = !!p.flgShowMapSite;
  const base = {
    tipoTexto,
    titulo: (p.desTitleSite as string | undefined) ?? null,
    area_total: numeroBR(p.prop_char_2),
    area_util: terreno ? null : numeroBR(p.prop_char_95 ?? p.prop_char_1),
    quartos: numeroBR(p.prop_char_5),
    suites: numeroBR(p.prop_char_6),
    banheiros: numeroBR(p.prop_char_7),
    vagas: numeroBR(p.totalGarages ?? p.prop_char_12),
    condominio: numeroBR(p.valCondominium),
    bairro: (p.namDistrict as string | undefined) ?? null,
    cidade: (p.namCity as string | undefined) ?? null,
    lat: mostraMapa ? Number(p.latitude) : null,
    lng: mostraMapa ? Number(p.longitude) : null,
    url,
    data_dado: String(p.dtaUpdate ?? '').slice(0, 10) || null,
    bruto: {
      id: p.idtProperty,
      tipo: tipoTexto,
      bairro: p.namDistrict,
      cidade: p.namCity,
      area_total: p.prop_char_2,
      area_util: p.prop_char_95 ?? p.prop_char_1,
      quartos: p.prop_char_5,
      suites: p.prop_char_6,
      vagas: p.totalGarages,
      atualizado_em: p.dtaUpdate,
    },
  };
  const tipoNeg = String(p.indType ?? 'S');
  const out: Array<CamposLidos | { recusa: string }> = [];
  const venda = numeroBR(p.valSales);
  const aluguel = numeroBR(p.valLocation);
  if (/S|A/.test(tipoNeg) && !p.flgHideValSaleSite && venda)
    out.push({ ...base, id_externo: String(p.idtProperty), modo: 'venda', preco: venda });
  if (/L|A/.test(tipoNeg) && !p.flgHideValLocationSite && aluguel)
    out.push({
      ...base,
      id_externo: `${String(p.idtProperty)}-aluguel`,
      modo: 'aluguel',
      preco: aluguel,
    });
  if (out.length === 0) out.push({ recusa: 'sem preço publicado' });
  return out;
}

export const coletorCatalogue: Coletor = {
  chave: 'anuncios/catalogue',
  maxPedidosPadrao: 100,
  async coletar(ctx) {
    const origem = 'https://catalogueimoveis.com.br';
    const lote = new LoteDeAnuncios(ctx.gravador);
    const impressao = new Impressao();
    const erros: string[] = [];
    const lidos = lerRodizio(ctx.estadoAnterior);
    const r0 = await ctx.navegador.pagina(`${origem}/sitemaps/propertys.xml`);
    if (!r0?.texto) {
      erros.push(
        `mapa do site: ${r0 ? `HTTP ${r0.status}` : (ctx.navegador.parada ?? 'robots fecha')}`,
      );
      return resultado({
        lote,
        impressao,
        erros,
        completa: false,
        consultasCompletas: [],
        ctx,
        estado: { lidos },
      });
    }
    impressao.somar({ mapa: r0.sha256 });
    type Entrada = { u: string; id: string; idsNoBanco: string[] };
    const nossos: Entrada[] = [];
    for (const u of locsDoSitemap(r0.texto)) {
      const m = u.match(RE_CATALOGUE);
      if (!m) continue;
      const [, modo, , cidade, bairro, id] = m;
      if (!id) continue;
      if (
        !ctx.regioes.regiaoDe({
          cidade: deslug(cidade),
          bairro: deslug(bairro),
          texto: deslug(bairro),
        })
      )
        continue;
      const idsNoBanco = [
        ...(modo !== 'locacao' ? [id] : []),
        ...(modo !== 'venda' ? [`${id}-aluguel`] : []),
      ];
      nossos.push({ u, id, idsNoBanco });
    }
    nossos.sort(
      (a, b) => (lidos[a.id] ?? '').localeCompare(lidos[b.id] ?? '') || Number(a.id) - Number(b.id),
    );
    const relidos = new Set<string>();
    const itens: Array<ItemAnuncio | Recusa> = [];
    for (const x of nossos) {
      const r = await ctx.navegador.pagina(x.u);
      if (!r) break;
      if (!r.texto) {
        if (r.status !== 404 && r.status !== 410) erros.push(`${x.u}: HTTP ${r.status}`);
        else relidos.add(x.id); // saiu do site: não é tocado, ganha falta
        continue;
      }
      let p: Record<string, unknown>;
      try {
        p = lerImovelCatalogue(r.texto);
      } catch (e) {
        erros.push(`${x.u}: ${e instanceof Error ? e.message : String(e)}`);
        continue;
      }
      relidos.add(x.id);
      lidos[x.id] = ctx.dia;
      for (const c of itensDaCatalogue(p, x.u)) {
        if ('recusa' in c) {
          itens.push(c);
          continue;
        }
        impressao.somar({ url: x.u, sha256_pagina: r.sha256, item: c.bruto });
        itens.push(
          anuncioDeSite(
            {
              ...c,
              hash_bruto: r.sha256,
              consulta_id: 'mapa-do-site',
              data_dado: c.data_dado ?? ctx.dia,
            },
            ctx.regioes,
          ),
        );
      }
    }
    const mapaLido = nossos.length > 0;
    if (!mapaLido) erros.push(`mapa do site: ${VAZIA}`);
    await lote.consulta(itens, mapaLido);
    await lote.esvaziar();
    // No mapa e não relido nesta rodada: continua no ar (se já estiver no banco).
    const vistos = nossos.filter((x) => !relidos.has(x.id)).flatMap((x) => x.idsNoBanco);
    const tocados = vistos.length > 0 ? await ctx.gravador.vistos(vistos) : 0;
    return resultado({
      lote,
      impressao,
      erros,
      completa: mapaLido,
      consultasCompletas: mapaLido ? ['mapa-do-site'] : [],
      ctx,
      estado: { lidos: podarRodizio(lidos) },
      extra: { no_mapa: nossos.length, relidos: relidos.size, vistos_no_mapa: tocados },
    });
  },
};

// ---------------------------------------------------------------------------
// Plataforma Imobibrasil: Marta de Graglia, Zil Monteiro, Primore, Tatiana Maia, JL
// ---------------------------------------------------------------------------

/** Origem (com o esquema que o próprio site usa: #8 da verificação) e cidade padrão de cada site. */
export const SITES_IMOBIBRASIL: Record<string, { origem: string; cidadePadrao: string }> = {
  'marta-de-graglia-imoveis': {
    origem: 'https://www.martadegragliaimoveis.com.br',
    cidadePadrao: 'Tibau do Sul',
  },
  'zil-monteiro': { origem: 'https://www.zilmonteiro.com.br', cidadePadrao: 'Tibau do Sul' },
  'primore-imoveis': { origem: 'https://www.primoreimoveisrn.com.br', cidadePadrao: 'Natal' },
  'tatiana-maia-imoveis': { origem: 'http://www.tatianamaiaimoveis.com.br', cidadePadrao: 'Natal' },
  'jl-imoveis-rn': { origem: 'http://www.jlimoveisrn.com.br', cidadePadrao: 'Natal' },
};

const CIDADES_RN = [
  'natal',
  'parnamirim',
  'tibau do sul',
  'nisia floresta',
  'extremoz',
  'sao goncalo do amarante',
  'macaiba',
  'ceara mirim',
  'sao jose de mipibu',
  'goianinha',
  'canguaretama',
  'baia formosa',
  'senador georgino avelino',
  'arez',
  'touros',
  'rio do fogo',
  'maxaranguape',
  'sao miguel do gostoso',
];
const MODOS_DO_LINK: Record<string, 'venda' | 'aluguel' | null> = {
  venda: 'venda',
  locacao: 'aluguel',
  aluguel: 'aluguel',
  temporada: null,
};

/** /imovel/2674067/apartamento-venda-tibau-do-sul-rn-praia-da-pipa → { id, modo, cidade, bairro } */
export function lerLinkImobibrasil(u: string): {
  id: string;
  modo: 'venda' | 'aluguel' | null;
  cidade: string | null;
  bairro: string | null;
  tipoSlug: string | null;
} | null {
  const m = String(u).match(/\/imovel\/(\d+)\/([a-z0-9-]+)\/?$/i);
  if (!m?.[1] || !m[2]) return null;
  const s = m[2].toLowerCase();
  const mm = s.match(/-(venda|locacao|aluguel|temporada)(?:-|$)/);
  const modo = mm?.[1] ? (MODOS_DO_LINK[mm[1]] ?? null) : null;
  const depois = mm && mm.index !== undefined ? s.slice(mm.index + mm[0].length) : s;
  let cidade: string | null;
  let bairro: string | null;
  const rn = depois.match(/^(.*?)-rn(?:-(.*))?$/);
  if (rn) {
    cidade = deslug(rn[1]);
    bairro = rn[2] ? deslug(rn[2]) : null;
  } else {
    const t = deslug(depois);
    const c = CIDADES_RN.find((x) => t === x || t.startsWith(`${x} `));
    if (c) {
      cidade = c;
      bairro = t.slice(c.length).trim() || null;
    } else {
      cidade = null;
      bairro = t || null;
    }
  }
  return {
    id: m[1],
    modo,
    cidade,
    bairro,
    tipoSlug: mm && mm.index !== undefined ? s.slice(0, mm.index) : null,
  };
}

const rotulo = (txt: string, re: RegExp): string | null => txt.match(re)?.[1] ?? null;

/** Lê uma página de imóvel da plataforma (schema.org + a ficha). */
export function lerImovelImobibrasil(html: string): {
  nome: string;
  preco: number | null;
  modo: 'venda' | 'aluguel' | null;
  tipoTexto: string | null;
  cidade: string | null;
  bairro: string | null;
  area_total: number | null;
  area_util: number | null;
  area_construida: number | null;
  area_terreno: number | null;
  quartos: number | null;
  suites: number | null;
  banheiros: number | null;
  vagas: number | null;
  condominio: number | null;
  sob_consulta: boolean;
} {
  const blocos = jsonLd(html);
  const tipos = (b: Record<string, unknown>): string =>
    ([] as unknown[]).concat(b['@type'] ?? []).join(' ');
  const prod = blocos.find((b) => /Product/.test(tipos(b)));
  const acao = blocos.find((b) => /BuyAction|RentAction|LeaseAction/.test(tipos(b)));
  const objeto = (acao?.object ?? {}) as { name?: string; address?: { addressLocality?: string } };
  const nome = entidades((prod?.name as string | undefined) ?? objeto.name ?? '');
  const t = semTags(html);
  const ofertas = (prod?.offers ?? {}) as { price?: unknown };
  const preco = numeroBR(ofertas.price ?? acao?.price);
  const sinal = `${nome} ${acao ? tipos(acao) : ''}`;
  const modo = /para Loca|para Alug|RentAction|LeaseAction/i.test(sinal)
    ? 'aluguel'
    : /para Venda|BuyAction/i.test(sinal)
      ? 'venda'
      : null;
  const tipoTexto = nome.match(/^(.*?)\s+para\s+(Venda|Loca|Alug|Temporada)/i)?.[1] ?? null;
  const cidade =
    objeto.address?.addressLocality ?? nome.match(/,\s*([^,/]+?)\s*\/\s*RN/)?.[1] ?? null;
  const bairro =
    nome.match(/\bbairro\s+([^,]+)/i)?.[1] ??
    rotulo(
      t,
      /\bBairro:\s*(.+?)\s*(?:›|Cidade:|Estado:|Condom|Zona:|Regi[ãa]o:|Ponto de|CEP|Observa|Valor|Área|$)/,
    ) ??
    null;
  const area = (re: RegExp): number | null => numeroBR(rotulo(t, re));
  return {
    nome,
    preco,
    modo,
    tipoTexto,
    cidade: cidade ? entidades(cidade).trim() : null,
    bairro: bairro ? bairro.trim() : null,
    area_total: area(/Área Total:\s*([\d.,]+)\s*m/i),
    area_util: area(/Área Útil:\s*([\d.,]+)\s*m/i) ?? area(/Área Privativa:\s*([\d.,]+)\s*m/i),
    area_construida: area(/Área Constru[íi]da:\s*([\d.,]+)\s*m/i),
    area_terreno: area(/Área (?:do )?Terreno:\s*([\d.,]+)\s*m/i),
    quartos: numeroBR(nome.match(/(\d+)\s*dormit/i)?.[1]),
    suites: numeroBR(nome.match(/(\d+)\s*su[íi]te/i)?.[1]),
    banheiros: numeroBR(nome.match(/(\d+)\s*banheiro/i)?.[1]),
    vagas: numeroBR(nome.match(/(\d+)\s*(?:vagas?|garage)/i)?.[1]),
    condominio: numeroBR(rotulo(t, /Condom[íi]nio\s*R\$\s*([\d.,]+)/i)),
    sob_consulta: !preco && /consulte|sob consulta/i.test(t),
  };
}

export const coletorImobibrasil: Coletor = {
  chave: 'anuncios/imobibrasil',
  maxPedidosPadrao: 100,
  async coletar(ctx) {
    const site = SITES_IMOBIBRASIL[ctx.fonte.id];
    const lote = new LoteDeAnuncios(ctx.gravador);
    const impressao = new Impressao();
    const erros: string[] = [];
    if (!site) {
      erros.push(`a fonte ${ctx.fonte.id} não é um site conhecido da plataforma`);
      return resultado({ lote, impressao, erros, completa: false, consultasCompletas: [], ctx });
    }
    const lidos = lerRodizio(ctx.estadoAnterior);
    const r0 = await ctx.navegador.pagina(`${site.origem}/sitemap.xml`);
    if (!r0?.texto) {
      erros.push(
        `mapa do site: ${r0 ? `HTTP ${r0.status}` : (ctx.navegador.parada ?? 'robots fecha')}`,
      );
      return resultado({
        lote,
        impressao,
        erros,
        completa: false,
        consultasCompletas: [],
        ctx,
        estado: { lidos },
      });
    }
    impressao.somar({ mapa: r0.sha256 });
    type Entrada = {
      u: string;
      l: NonNullable<ReturnType<typeof lerLinkImobibrasil>>;
      prioridade: number;
      certo: boolean;
    };
    const fila: Entrada[] = [];
    for (const u of new Set(locsDoSitemap(r0.texto))) {
      const l = lerLinkImobibrasil(u);
      if (!l?.modo) continue;
      const cidade = l.cidade ?? ctx.regioes.cidadePeloBairro(l.bairro);
      const reg = cidade
        ? ctx.regioes.regiaoDe({ cidade, bairro: l.bairro ?? '', texto: l.bairro ?? '' })
        : null;
      if (l.cidade && !reg) continue; // cidade no link e fora do estudo
      fila.push({ u, l, prioridade: reg ? 0 : 1, certo: reg !== null });
    }
    fila.sort(
      (a, b) =>
        a.prioridade - b.prioridade ||
        (lidos[a.l.id] ?? '').localeCompare(lidos[b.l.id] ?? '') ||
        Number(a.l.id) - Number(b.l.id),
    );
    const relidos = new Set<string>();
    const itens: Array<ItemAnuncio | Recusa> = [];
    for (const x of fila) {
      // O link do anúncio leva o esquema do próprio site (a JL não tem https válido: #8 da verificação).
      const url = x.u.replace(/^https?:\/\/[^/]+/, site.origem);
      const r = await ctx.navegador.pagina(url);
      if (!r) break;
      if (!r.texto) {
        if (r.status === 404 || r.status === 410) relidos.add(x.l.id);
        else erros.push(`${url}: HTTP ${r.status}`);
        continue;
      }
      let p: ReturnType<typeof lerImovelImobibrasil>;
      try {
        p = lerImovelImobibrasil(r.texto);
      } catch (e) {
        erros.push(`${url}: ${e instanceof Error ? e.message : String(e)}`);
        continue;
      }
      relidos.add(x.l.id);
      lidos[x.l.id] = ctx.dia;
      if (!p.preco) {
        lote.recusar(p.sob_consulta ? 'preço sob consulta' : 'sem preço publicado');
        continue;
      }
      const tipoTexto = p.tipoTexto ?? deslug(x.l.tipoSlug);
      const terreno = /terreno|lote/i.test(tipoTexto);
      const casa = /casa|sobrado/i.test(semAcento(tipoTexto));
      const bairro = p.bairro ?? (x.l.bairro ? comoNome(x.l.bairro) : null);
      // #6 da verificação: sem cidade na página nem no link, a cidade sai do bairro; nunca a "cidade padrão" às cegas.
      const cidade =
        p.cidade ??
        (x.l.cidade ? comoNome(x.l.cidade) : null) ??
        ctx.regioes.cidadePeloBairro(bairro);
      const campos: CamposLidos = {
        id_externo: x.l.id,
        modo: p.modo ?? x.l.modo ?? 'venda',
        tipoTexto,
        titulo: p.nome,
        preco: p.preco,
        area_total: p.area_terreno ?? p.area_total,
        // #7 da verificação: na casa, a área construída vem antes da "útil".
        area_util: terreno
          ? null
          : casa
            ? (p.area_construida ?? p.area_util)
            : (p.area_util ?? p.area_construida),
        quartos: p.quartos,
        suites: p.suites,
        banheiros: p.banheiros,
        vagas: p.vagas,
        condominio: p.condominio,
        bairro,
        cidade,
        url,
        hash_bruto: r.sha256,
        data_dado: ctx.dia,
        consulta_id: 'mapa-do-site',
        marcas:
          casa && p.area_util && p.area_construida && p.area_util > 1.05 * p.area_construida
            ? ['areas_trocadas']
            : [],
        bruto: {
          id: x.l.id,
          titulo: p.nome,
          preco: p.preco,
          area_total: p.area_total,
          area_util: p.area_util,
          area: p.area_construida,
          bairro,
          cidade,
        },
      };
      impressao.somar({ url, sha256_pagina: r.sha256, item: campos.bruto });
      const a = anuncioDeSite(campos, ctx.regioes);
      if (ehRecusa(a)) relidos.add(x.l.id);
      itens.push(a);
    }
    const mapaLido = fila.length > 0;
    if (!mapaLido) erros.push(`mapa do site: ${VAZIA}`);
    await lote.consulta(itens, mapaLido);
    await lote.esvaziar();
    // Todo o mapa que não foi relido continua no ar (o banco só toca quem já gravou antes).
    const vistos = fila.filter((x) => !relidos.has(x.l.id)).map((x) => x.l.id);
    const tocados = vistos.length > 0 ? await ctx.gravador.vistos(vistos) : 0;
    return resultado({
      lote,
      impressao,
      erros,
      completa: mapaLido,
      consultasCompletas: mapaLido ? ['mapa-do-site'] : [],
      ctx,
      estado: { lidos: podarRodizio(lidos) },
      extra: { na_fila: fila.length, relidos: relidos.size, vistos_no_mapa: tocados },
    });
  },
};

// ---------------------------------------------------------------------------
// Ibeda: páginas de bairro do mapa do site (schema.org Product)
// ---------------------------------------------------------------------------

const RE_BAIRRO_IBEDA =
  /^https:\/\/ibeda\.com\.br\/imoveis\/(a-venda|para-alugar)\/([a-z-]+)-rn\/([a-z0-9-]+)\/?$/;
const TIPO_EN: Record<string, string> = {
  Apartment: 'apartamento',
  House: 'casa',
  SingleFamilyResidence: 'casa',
  Residence: 'casa',
  Place: '',
  LandForm: 'terreno',
  Accommodation: '',
};

export function lerPaginaIbeda(
  html: string,
  modo: 'venda' | 'aluguel',
): { itens: Array<CamposLidos & { nome: string }>; proxima: string | null } {
  const itens: Array<CamposLidos & { nome: string }> = [];
  for (const b of jsonLd(html)) {
    const tipos = ([] as unknown[]).concat(b['@type'] ?? []).map(String);
    if (!tipos.includes('Product')) continue;
    const ofertas = (b.offers ?? {}) as { url?: string; price?: unknown };
    const url = ofertas.url ?? null;
    if (!url) continue;
    const nome = entidades(b.name ?? '');
    const id = url.match(/-id-(\d+)\/?$/)?.[1];
    if (!id) continue;
    const area = numeroBR(url.match(/-(\d+(?:-\d+)?)m2-id-/)?.[1]?.replace('-', '.'));
    const loc = nome.match(/\s-\s([^,]+),\s*([^,]+?)-RN\b/);
    const rua = nome.match(/\sem\s(.+?)\s-\s/)?.[1] ?? null;
    const tipoEn = tipos
      .filter((t) => t !== 'Product')
      .map((t) => TIPO_EN[t] ?? t)
      .join(' ')
      .trim();
    const tipoPt = nome.match(/^(.+?)\s(em|à|para)\s/)?.[1] ?? '';
    itens.push({
      nome,
      id_externo: modo === 'aluguel' ? `${id}-aluguel` : id,
      modo,
      tipoTexto: `${tipoEn} ${tipoPt}`.trim() || nome,
      titulo: nome.replace(/\s+por\s+R\$.*$/, ''),
      preco: numeroBR(ofertas.price),
      area_unica: area,
      quartos: typeof b.numberOfBedrooms === 'number' ? b.numberOfBedrooms : null,
      banheiros: typeof b.numberOfBathroomsTotal === 'number' ? b.numberOfBathroomsTotal : null,
      bairro: loc?.[1]?.trim() ?? null,
      cidade: loc?.[2]?.trim() ?? null,
      logradouro: rua,
      url,
      bruto: {
        id,
        titulo: nome,
        preco: ofertas.price,
        area,
        bairro: loc?.[1],
        cidade: loc?.[2],
        logradouro: rua,
        url,
      },
    });
  }
  const proxima = String(html).match(/<link rel="next" href="([^"]+)"/)?.[1] ?? null;
  return { itens, proxima: proxima ? entidades(proxima) : null };
}

export const coletorIbeda: Coletor = {
  chave: 'anuncios/ibeda',
  maxPedidosPadrao: 100,
  async coletar(ctx) {
    const origem = 'https://ibeda.com.br';
    const lote = new LoteDeAnuncios(ctx.gravador);
    const impressao = new Impressao();
    const erros: string[] = [];
    const consultasCompletas: string[] = [];
    const r0 = await ctx.navegador.pagina(`${origem}/bairros-sitemap.xml`);
    if (!r0?.texto) {
      erros.push(
        `mapa do site: ${r0 ? `HTTP ${r0.status}` : (ctx.navegador.parada ?? 'robots fecha')}`,
      );
      return resultado({ lote, impressao, erros, completa: false, consultasCompletas, ctx });
    }
    const paginas = locsDoSitemap(r0.texto)
      .map((u) => ({ u, m: u.match(RE_BAIRRO_IBEDA) }))
      .filter((x): x is { u: string; m: RegExpMatchArray } => x.m !== null)
      .map(({ u, m }) => ({
        u,
        modo: (m[1] === 'a-venda' ? 'venda' : 'aluguel') as 'venda' | 'aluguel',
        cidade: deslug(m[2]),
        bairro: deslug(m[3]),
      }))
      .filter(
        (x) =>
          ctx.regioes.regiaoDe({ cidade: x.cidade, bairro: x.bairro, texto: x.bairro }) !== null,
      )
      .sort((a, b) => (a.modo === 'venda' ? 0 : 1) - (b.modo === 'venda' ? 0 : 1));
    let todas = true;
    for (const p of paginas) {
      const consultaId = `bairro-${p.modo}-${p.bairro.replace(/\s+/g, '-')}`;
      let url: string | null = p.u;
      let n = 0;
      let ok = true;
      let lidosNaConsulta = 0;
      const itens: Array<ItemAnuncio | Recusa> = [];
      while (url && n < 20) {
        const r = await ctx.navegador.pagina(url);
        if (!r?.texto) {
          ok = false;
          if (r) erros.push(`${url}: HTTP ${r.status}`);
          break;
        }
        const pag = lerPaginaIbeda(r.texto, p.modo);
        n += 1;
        lidosNaConsulta += pag.itens.length;
        for (const it of pag.itens) {
          impressao.somar({ url, sha256_pagina: r.sha256, item: it.bruto });
          itens.push(
            anuncioDeSite(
              { ...it, hash_bruto: r.sha256, data_dado: ctx.dia, consulta_id: consultaId },
              ctx.regioes,
            ),
          );
        }
        url = pag.proxima && (await ctx.navegador.podePedir(pag.proxima)) ? pag.proxima : null;
        if (pag.proxima && !url) ok = false;
      }
      if (url) ok = false; // passou de 20 páginas
      if (ok && lidosNaConsulta === 0) {
        ok = false; // página de bairro sem nenhum Product: não diz quem saiu
        erros.push(`${p.u}: ${VAZIA}`);
      }
      await lote.consulta(itens, ok);
      if (ok) consultasCompletas.push(consultaId);
      else todas = false;
      if (ctx.navegador.parada) break;
    }
    await lote.esvaziar();
    return resultado({
      lote,
      impressao,
      erros,
      completa: todas,
      consultasCompletas,
      ctx,
      extra: { paginas_de_bairro: paginas.length },
    });
  },
};

// ---------------------------------------------------------------------------
// Imobinova (Pipa): a lista pública de imóveis (cartões)
// ---------------------------------------------------------------------------

export function lerPaginaImobinova(
  html: string,
): Array<CamposLidos & { bairroPeloTitulo: boolean }> {
  const limpo = String(html).replace(/<!--[\s\S]*?-->/g, ' '); // há preços antigos dentro de comentários
  const itens: Array<CamposLidos & { bairroPeloTitulo: boolean }> = [];
  for (const c of limpo.split(/<article class="card c49-property-card"/).slice(1)) {
    const id = c.match(/id="property-(\d+)"/)?.[1];
    if (!id) continue;
    const url =
      c.match(/href="(https:\/\/www\.imobinovapipa\.com\.br\/\d+\/imoveis\/[^"]+)"/)?.[1] ?? null;
    const titulo = semTags(c.match(/c49-property-card_title">([\s\S]*?)<\/h2>/)?.[1] ?? '');
    const tipo = semTags(c.match(/c49-property-card_type">([\s\S]*?)<\/span>/)?.[1] ?? '');
    const end = semTags(c.match(/c49-property-card_address">([\s\S]*?)<\/div>/)?.[1] ?? '');
    const precoTxt = semTags(
      c.match(/c49-property-card_(?:rent|sell)-price">([\s\S]*?)<\/div>/)?.[1] ?? '',
    );
    const modo: 'venda' | 'aluguel' = /loca|alug/i.test(precoTxt)
      ? 'aluguel'
      : /venda/i.test(precoTxt)
        ? 'venda'
        : /\/imoveis\/locacao-/.test(url ?? '')
          ? 'aluguel'
          : 'venda';
    const idx = c.indexOf('c49-property-card_price');
    const t = semTags(idx >= 0 ? c.slice(idx) : '');
    const em = end.match(/^(.*?),\s*([^,]+?)\s*-\s*RN$/i);
    const pipaNoTitulo = !em && /\bpipa\b/i.test(titulo);
    itens.push({
      id_externo: id,
      modo,
      tipoTexto: tipo,
      titulo,
      preco: numeroBR(precoTxt.match(/R\$\s*([\d.,]+)/)?.[1]),
      area_unica: numeroBR(t.match(/([\d.,]+)\s*m²/)?.[1]),
      quartos: numeroBR(t.match(/(\d+)\s*quartos?/i)?.[1]),
      banheiros: numeroBR(t.match(/(\d+)\s*banh/i)?.[1]),
      vagas: numeroBR(t.match(/(\d+)\s*vagas?/i)?.[1]),
      condominio: numeroBR(t.match(/Condom[íi]nio\s*R\$\s*([\d.,]+)/i)?.[1]),
      // Sem bairro no cartão: só vale "Pipa" quando o próprio título diz (e fica marcado).
      bairro: em?.[1]?.trim() ?? (pipaNoTitulo ? 'Praia da Pipa' : null),
      cidade: em?.[2]?.trim() ?? end.match(/^([^,]+?)\s*-\s*RN$/i)?.[1] ?? null,
      url,
      bairroPeloTitulo: pipaNoTitulo,
      bruto: { id, titulo, tipo, preco: precoTxt, endereco: end, url },
    });
  }
  return itens;
}

export const coletorImobinova: Coletor = {
  chave: 'anuncios/imobinova',
  maxPedidosPadrao: 100,
  async coletar(ctx) {
    const origem = 'https://www.imobinovapipa.com.br';
    const lote = new LoteDeAnuncios(ctx.gravador);
    const impressao = new Impressao();
    const erros: string[] = [];
    const itens: Array<ItemAnuncio | Recusa> = [];
    const vistos = new Set<string>();
    let completa = false;
    let paginas = 0;
    for (let pg = 1; pg <= 40; pg += 1) {
      const url = `${origem}/imobiliaria/imoveis${pg > 1 ? `/0/${pg}` : ''}`;
      const r = await ctx.navegador.pagina(url);
      if (!r) break;
      if (!r.texto) {
        erros.push(`${url}: HTTP ${r.status}`);
        break;
      }
      const lidos = lerPaginaImobinova(r.texto);
      paginas += 1;
      if (lidos.length === 0) {
        // Página vazia DEPOIS de páginas com cartões: acabou. Já na primeira: o site mudou.
        completa = pg > 1;
        if (pg === 1) erros.push(`${url}: ${VAZIA}`);
        break;
      }
      let novos = 0;
      for (const it of lidos) {
        if (!vistos.has(it.id_externo)) novos += 1;
        vistos.add(it.id_externo);
        impressao.somar({ url, sha256_pagina: r.sha256, item: it.bruto });
        if (!it.preco) {
          itens.push({ recusa: 'sem preço publicado' });
          continue;
        }
        const { bairroPeloTitulo, ...campos } = it;
        itens.push(
          anuncioDeSite(
            {
              ...campos,
              hash_bruto: r.sha256,
              data_dado: ctx.dia,
              consulta_id: 'lista',
              marcas: bairroPeloTitulo ? ['bairro_pelo_titulo'] : [],
            },
            ctx.regioes,
          ),
        );
      }
      if (novos === 0 && pg > 1) {
        completa = true; // página repetida: acabou
        break;
      }
      if (!r.texto.includes(`/imobiliaria/imoveis/0/${pg + 1}"`)) {
        completa = true; // sem link para a página seguinte: acabou
        break;
      }
    }
    await lote.consulta(itens, completa);
    await lote.esvaziar();
    return resultado({
      lote,
      impressao,
      erros,
      completa,
      consultasCompletas: completa ? ['lista'] : [],
      ctx,
      extra: { paginas },
    });
  },
};

// ---------------------------------------------------------------------------
// Abreu Imóveis: as listas públicas do menu (cartões). ai-train=no.
// ---------------------------------------------------------------------------

export function listasDoMenuAbreu(
  html: string,
): Array<{ modo: 'venda' | 'aluguel'; caminho: string }> {
  const vistas = new Set<string>();
  const out: Array<{ modo: 'venda' | 'aluguel'; caminho: string }> = [];
  for (const m of String(html).matchAll(
    /href="(https:\/\/www\.abreuimoveis\.com\.br)?(\/pesquisa-de-imoveis\/\?locacao_venda=([VL])[^"]*)"/g,
  )) {
    const caminho = (m[2] ?? '').replace(/&amp;/g, '&');
    if (!caminho || vistas.has(caminho)) continue;
    vistas.add(caminho);
    out.push({ modo: m[3] === 'V' ? 'venda' : 'aluguel', caminho });
  }
  return out;
}

export interface CartaoAbreu {
  id: string;
  href: string | null;
  titulo: string;
  valores: Array<{ preco: number | null; letra: string | null }>;
  quartos: number | null;
  bairro: string | null;
  cidade: string | null;
  tipoLink: string | null;
  categoria: string | null;
  area_construida: number | null;
  area_util: number | null;
  area_total: number | null;
  area_terreno: number | null;
}

export function lerPaginaAbreu(html: string): { itens: CartaoAbreu[]; total: number | null } {
  const itens: CartaoAbreu[] = [];
  for (const c of String(html)
    .split(/class="muda_card1/)
    .slice(1)) {
    const id = c.match(/toggleFavorito\((\d+)\)/)?.[1];
    if (!id) continue;
    const href = c.match(/href="(\/(?:comprar|alugar)\/[^"]+\/\d+)"/)?.[1] ?? null;
    const precoTxt = semTags(
      c.match(/class="card-valores">([\s\S]*?)<\/div>\s*<\/div>/)?.[1] ?? '',
    );
    const titulo = semTags(
      c.match(/<h2[^>]*class="card-titulo[^"]*"[^>]*>([\s\S]*?)<\/h2>/)?.[1] ?? '',
    );
    const local = semTags(c.match(/class="card-bairro-cidade-texto">([\s\S]*?)<\/div>/)?.[1] ?? '');
    const areas: Record<string, number | null> = {};
    for (const m of c.matchAll(
      /<div class="([a-z-]+)-ico[^"]*"[^>]*><span><\/span><span>([^<]*)<\/span><div>([^<]*)<\/div>/g,
    )) {
      if (m[1]) areas[m[1]] = numeroBR(entidades(m[2]).replace(/m².*/, ''));
    }
    const partes = (href ?? '').split('/');
    const loc = local.match(/^(.*?)\s*-\s*([^/]+?)\s*\/\s*RN$/i);
    itens.push({
      id,
      href,
      titulo,
      valores: [...precoTxt.matchAll(/R\$\s*([\d.,]+)\s*([VL])?/g)].map((m) => ({
        preco: numeroBR(m[1]),
        letra: m[2] ?? null,
      })),
      quartos: numeroBR(semTags(c).match(/(\d+)\s*(?:dorm|quarto)/i)?.[1]),
      bairro: loc?.[1]?.trim() ?? (partes[5] ? deslug(partes[5]) : null),
      cidade: loc?.[2]?.trim() ?? (partes[2] ? deslug(partes[2]) : null),
      tipoLink: partes[4] ? deslug(partes[4]) : null,
      categoria: partes[3] ? deslug(partes[3]) : null,
      area_construida: areas['a-const'] ?? null,
      area_util: areas['a-util'] ?? areas['a-priv'] ?? null,
      area_total: areas['a-total'] ?? null,
      area_terreno: areas['a-terr'] ?? null,
    });
  }
  const total = numeroBR(
    semTags(String(html).slice(0, 200_000)).match(
      /([\d.]+)\s*im[óo]veis para (?:venda|loca)/i,
    )?.[1],
  );
  return { itens, total };
}

export const coletorAbreu: Coletor = {
  chave: 'anuncios/abreu',
  maxPedidosPadrao: 100,
  async coletar(ctx) {
    const origem = 'https://www.abreuimoveis.com.br';
    const lote = new LoteDeAnuncios(ctx.gravador);
    const impressao = new Impressao();
    const erros: string[] = [];
    const consultasCompletas: string[] = [];
    const r0 = await ctx.navegador.pagina(`${origem}/`);
    const listas = r0?.texto ? listasDoMenuAbreu(r0.texto) : [];
    if (listas.length === 0) {
      erros.push(
        `página inicial sem as listas do menu (${r0 ? `HTTP ${r0.status}` : (ctx.navegador.parada ?? 'robots fecha')})`,
      );
      return resultado({ lote, impressao, erros, completa: false, consultasCompletas, ctx });
    }
    for (const [i, L] of listas.entries()) {
      const consultaId = `lista-${L.modo}-${i + 1}`;
      const itens: Array<ItemAnuncio | Recusa> = [];
      const vistos = new Set<string>();
      let total: number | null = null;
      let ok = true;
      for (let pg = 1; pg <= 60; pg += 1) {
        const url = `${origem}${L.caminho}${pg > 1 ? `&&pag=${pg}` : ''}`;
        const r = await ctx.navegador.pagina(url);
        if (!r?.texto) {
          ok = false;
          if (r) erros.push(`${url}: HTTP ${r.status}`);
          break;
        }
        const pag = lerPaginaAbreu(r.texto);
        total = total ?? pag.total;
        const novos = pag.itens.filter((it) => !vistos.has(it.id));
        if (novos.length === 0) break;
        for (const it of novos) {
          vistos.add(it.id);
          impressao.somar({ url, sha256_pagina: r.sha256, item: it });
          const letra = L.modo === 'venda' ? 'V' : 'L';
          const v =
            it.valores.find((x) => x.letra === letra) ??
            (it.valores.length === 1 && !it.valores[0]?.letra ? it.valores[0] : null);
          if (!v?.preco) {
            itens.push({ recusa: 'sem preço publicado' });
            continue;
          }
          const tipoTexto = it.tipoLink ?? it.categoria ?? '';
          const terreno = /terreno|lote/i.test(tipoTexto);
          const casa = /casa|sobrado/i.test(tipoTexto);
          itens.push(
            anuncioDeSite(
              {
                id_externo: L.modo === 'aluguel' ? `${it.id}-aluguel` : it.id,
                modo: L.modo,
                tipoTexto,
                titulo: it.titulo,
                preco: v.preco,
                area_total: it.area_terreno ?? it.area_total,
                area_util: terreno
                  ? null
                  : casa
                    ? (it.area_construida ?? it.area_util)
                    : (it.area_util ?? it.area_construida),
                quartos: it.quartos,
                bairro: it.bairro,
                cidade: it.cidade,
                url: it.href ? `${origem}${it.href}` : null,
                hash_bruto: r.sha256,
                data_dado: ctx.dia,
                consulta_id: consultaId,
                bruto: {
                  id: it.id,
                  titulo: it.titulo,
                  preco: v.preco,
                  area_total: it.area_total,
                  area_util: it.area_util,
                  bairro: it.bairro,
                  cidade: it.cidade,
                },
              },
              ctx.regioes,
            ),
          );
        }
        if (total && vistos.size >= total) break;
      }
      const completa = ok && total !== null && vistos.size > 0 && vistos.size >= total;
      if (ok && vistos.size === 0) erros.push(`${consultaId}: ${VAZIA}`);
      await lote.consulta(itens, completa);
      if (completa) consultasCompletas.push(consultaId);
      if (ctx.navegador.parada) break;
    }
    await lote.esvaziar();
    return resultado({
      lote,
      impressao,
      erros,
      completa: consultasCompletas.length === listas.length,
      consultasCompletas,
      ctx,
      extra: { listas: listas.length },
    });
  },
};
