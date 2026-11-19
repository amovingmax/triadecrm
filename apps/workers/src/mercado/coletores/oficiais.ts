/**
 * Séries de fontes oficiais e abertas, gravadas em `mercado_indices` (um ponto
 * por série e mês; o banco faz o upsert por `serie, mes`). Porte de
 * `coletar/{fipezap,bcb,siconfi,corrida,construcao}.mjs`.
 *
 *  - FipeZAP: só a planilha pública da Fipe (downloads.fipe.org.br), decisão do
 *    dono. Nada do domínio do portal. O texto não cita o portal (#12 da
 *    verificação de 18/11).
 *  - Banco Central: crédito imobiliário no RN (Olinda) e IVG-R (SGS 21340).
 *  - Tesouro (SICONFI): ITBI arrecadado por mês (RREO) e no ano (DCA).
 *  - A Corrida dos Bairros: mediana do m² pedido por bairro (CC BY 4.0). A
 *    fonte nasce desligada (o dono decide); o coletor existe para quando ela
 *    for liberada.
 *  - GeoMapas da Prefeitura do Natal: alvarás e habite-se por bairro e ano.
 */
import { Impressao, indicesSemRepetir } from '../lote';
import { slug } from '../texto';
import type { Coletor, ContextoDoColetor, LinhaIndice, ResultadoDoColetor } from '../tipos';
import { lerDoZip } from '../zip';

const mesDe = (ym: string): string => `${ym.slice(0, 7)}-01`;

function resultadoDeSerie(
  ctx: ContextoDoColetor,
  impressao: Impressao,
  gravados: number,
  erros: string[],
  extra: Record<string, unknown> = {},
): ResultadoDoColetor {
  return {
    completa: erros.length === 0 && ctx.navegador.parada === null,
    hashBruto: impressao.fechar(),
    detalhes: {
      pontos_gravados: gravados,
      pedidos: ctx.navegador.pedidos,
      parada: ctx.navegador.parada,
      ...extra,
    },
    erros,
  };
}

// ---------------------------------------------------------------------------
// FipeZAP (planilha da Fipe, aba "Natal")
// ---------------------------------------------------------------------------

const desfazer = (s: string): string =>
  s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");

/** Lê a aba "Natal" da planilha (xlsx em bytes) e devolve os pontos mês a mês. */
export function lerPlanilhaFipezap(xlsx: Buffer): Array<{
  mes: string;
  indice: number | null;
  var12: number | null;
  venda: number;
  aluguel: number | null;
  rent: number | null;
}> {
  const texto = (nome: string): string => {
    const b = lerDoZip(xlsx, nome);
    if (!b) throw new Error(`a planilha não tem ${nome}`);
    return b.toString('utf8');
  };
  const wb = texto('xl/workbook.xml');
  const rels = texto('xl/_rels/workbook.xml.rels');
  const folha = [...wb.matchAll(/<sheet [^>]*>/g)]
    .map((m) => m[0])
    .find((t) => /name="Natal"/.test(t));
  const rid = folha?.match(/r:id="([^"]+)"/)?.[1];
  if (!rid) throw new Error('aba Natal não encontrada');
  const rel = [...rels.matchAll(/<Relationship [^>]*>/g)]
    .map((m) => m[0])
    .find((t) => t.includes(`Id="${rid}"`));
  const alvo = rel?.match(/Target="([^"]+)"/)?.[1]?.replace(/^\/?xl\//, '');
  if (!alvo) throw new Error('aba Natal sem arquivo');
  const compartilhadas = lerDoZip(xlsx, 'xl/sharedStrings.xml');
  const ss = compartilhadas
    ? [...compartilhadas.toString('utf8').matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) =>
        desfazer((m[1] ?? '').replace(/<[^>]+>/g, '')),
      )
    : [];
  const xml = texto(`xl/${alvo}`);
  // Colunas conferidas em 17/11/2026: B data, C índice, M variação em 12 meses,
  // R venda R$/m², AL aluguel R$/m², AQ rentabilidade do aluguel ao mês.
  const COL: Record<string, string> = {
    B: 'data',
    C: 'indice',
    M: 'var12',
    R: 'venda',
    AL: 'aluguel',
    AQ: 'rent',
  };
  const cab: Record<string, string> = {};
  const linhas: Array<Record<string, string>> = [];
  for (const [, n, corpo] of xml.matchAll(/<row [^>]*r="(\d+)"[^>]*>([\s\S]*?)<\/row>/g)) {
    const o: Record<string, string> = {};
    for (const c of (corpo ?? '').matchAll(/<c r="([A-Z]+)\d+"([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const [, col = '', at = '', dentro] = c;
      let v = dentro?.match(/<v>([\s\S]*?)<\/v>/)?.[1] ?? '';
      if (/t="s"/.test(at) && v) v = ss[Number(v)] ?? '';
      if (Number(n) <= 4 && v) cab[`${n}${col}`] = v;
      const nomeDaColuna = COL[col];
      if (nomeDaColuna) o[nomeDaColuna] = v;
    }
    if (/^\d+$/.test(o.data ?? '')) linhas.push(o);
  }
  if (cab['3R'] !== 'Preço médio (R$/m²)' || cab['3AL'] !== 'Preço médio (R$/m²)') {
    throw new Error('a planilha mudou de formato (colunas R e AL)');
  }
  const mes = (serial: number): string => {
    const d = new Date(Date.UTC(1899, 11, 30) + serial * 864e5);
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
  };
  const num = (v: string | undefined): number | null =>
    v && v !== '.' && Number.isFinite(Number(v)) ? Number(v) : null;
  return linhas
    .map((o) => ({
      mes: mes(Number(o.data)),
      indice: num(o.indice),
      var12: num(o.var12),
      venda: num(o.venda),
      aluguel: num(o.aluguel),
      rent: num(o.rent),
    }))
    .filter(
      (
        o,
      ): o is {
        mes: string;
        indice: number | null;
        var12: number | null;
        venda: number;
        aluguel: number | null;
        rent: number | null;
      } => o.venda !== null,
    );
}

const URL_FIPEZAP = 'https://downloads.fipe.org.br/indices/fipezap/fipezap-serieshistoricas.xlsx';

export function linhasDoFipezap(
  pontos: ReturnType<typeof lerPlanilhaFipezap>,
  url = URL_FIPEZAP,
): LinhaIndice[] {
  const obs = 'Índice FipeZAP (Fipe), média móvel de 3 meses, imóveis residenciais.';
  const base = { local: 'Natal', metodo: 'planilha', url, obs };
  const out: LinhaIndice[] = [];
  for (const p of pontos) {
    out.push({
      ...base,
      serie: 'fipezap-natal-venda',
      mes: mesDe(p.mes),
      valor: Math.round(p.venda * 100) / 100,
      nome: 'FipeZAP Natal: preço médio de venda',
      unidade: 'R$/m²',
      modo: 'venda',
    });
    if (p.aluguel !== null)
      out.push({
        ...base,
        serie: 'fipezap-natal-aluguel',
        mes: mesDe(p.mes),
        valor: Math.round(p.aluguel * 100) / 100,
        nome: 'FipeZAP Natal: preço médio do aluguel',
        unidade: 'R$/m² ao mês',
        modo: 'aluguel',
      });
    if (p.var12 !== null)
      out.push({
        ...base,
        serie: 'fipezap-natal-var12',
        mes: mesDe(p.mes),
        valor: Math.round(p.var12 * 10_000) / 100,
        nome: 'FipeZAP Natal: variação do preço de venda em 12 meses',
        unidade: '%',
        modo: 'venda',
      });
    if (p.rent !== null)
      out.push({
        ...base,
        serie: 'fipezap-natal-rentabilidade',
        mes: mesDe(p.mes),
        valor: Math.round(p.rent * 120_000) / 100,
        nome: 'FipeZAP Natal: rentabilidade do aluguel',
        unidade: '% ao ano',
        obs: 'Índice FipeZAP (Fipe): a planilha dá a rentabilidade ao mês; aqui ela vai multiplicada por 12.',
      });
  }
  return out;
}

export const coletorFipezap: Coletor = {
  chave: 'fipezap',
  // O robots.txt de downloads.fipe.org.br redireciona para a página "não
  // encontrada" do site da própria Fipe (conferido em 18/11/2026: 302 para
  // http://www.fipe.org.br/pt-br/pagina-nao-encontrada, 301 para https, 404).
  // A RFC 9309 manda seguir até 5 redirecionamentos, mesmo para outro host, e
  // 404 no fim é "sem regra". Sem este host declarado, o navegador recusaria o
  // salto (host fora da fonte) e a Fipe nunca rodaria. É a mesma instituição
  // da planilha que o dono liberou; nada do domínio do portal.
  hostsExtras: ['www.fipe.org.br'],
  maxPedidosPadrao: 5,
  async coletar(ctx) {
    const impressao = new Impressao();
    const url =
      ctx.fonte.url && /downloads\.fipe\.org\.br/.test(ctx.fonte.url) ? ctx.fonte.url : URL_FIPEZAP;
    const r = await ctx.navegador.pagina(url, { binario: true, aceitar: '*/*', tempo: 180_000 });
    if (!r?.bytes)
      return resultadoDeSerie(ctx, impressao, 0, [
        `planilha: ${r ? `HTTP ${r.status}` : (ctx.navegador.parada ?? 'robots fecha')}`,
      ]);
    impressao.somar(r.sha256 ?? '');
    const linhas = linhasDoFipezap(lerPlanilhaFipezap(r.bytes), url);
    const n = await ctx.gravador.indices(linhas);
    return resultadoDeSerie(ctx, impressao, n, [], { ultimo_mes: linhas.at(-1)?.mes ?? null });
  },
};

// ---------------------------------------------------------------------------
// Banco Central
// ---------------------------------------------------------------------------

const OLINDA =
  'https://olinda.bcb.gov.br/olinda/servico/MercadoImobiliario/versao/v1/odata/mercadoimobiliario';
const SERIES_BCB: Array<[string, string, string]> = [
  [
    'credito_contratacao_contratado_pf_sfh_rn',
    'Crédito imobiliário contratado no RN (SFH, pessoa física)',
    'R$ no mês',
  ],
  [
    'credito_contratacao_contratado_pf_fgts_rn',
    'Crédito imobiliário contratado no RN (FGTS, pessoa física)',
    'R$ no mês',
  ],
  ['credito_contratacao_taxa_pf_sfh_rn', 'Juros do financiamento no RN (SFH)', '% ao ano'],
  ['credito_contratacao_ltv_pf_sfh_rn', 'Parte financiada do imóvel no RN (LTV, SFH)', '%'],
  [
    'credito_estoque_inadimplencia_pf_sfh_rn',
    'Inadimplência do crédito imobiliário no RN (SFH)',
    '%',
  ],
];

export function linhasDoOlinda(
  info: string,
  nome: string,
  unidade: string,
  dado: { value?: Array<{ Data?: string; Valor?: unknown }> },
  url: string,
): LinhaIndice[] {
  return (dado.value ?? [])
    .map((x) => ({ mes: String(x.Data ?? '').slice(0, 7), valor: Number(x.Valor) }))
    .filter((p) => /^\d{4}-\d{2}$/.test(p.mes) && Number.isFinite(p.valor))
    .map((p) => ({
      serie: `bcb-${info}`,
      mes: mesDe(p.mes),
      valor: p.valor,
      nome,
      unidade,
      local: 'RN',
      metodo: 'API Olinda (dados abertos)',
      url,
      obs: 'Banco Central do Brasil, estatísticas do mercado imobiliário.',
    }));
}

export function linhasDoIvgr(
  dado: Array<{ data?: string; valor?: unknown }>,
  url: string,
): LinhaIndice[] {
  return dado
    .map((x) => {
      const [, m, a] = String(x.data ?? '').split('/');
      return { mes: a && m ? `${a}-${m}` : '', valor: Number(x.valor) };
    })
    .filter((p) => /^\d{4}-\d{2}$/.test(p.mes) && Number.isFinite(p.valor))
    .map((p) => ({
      serie: 'bcb-ivgr',
      mes: mesDe(p.mes),
      valor: p.valor,
      nome: 'IVG-R: valor dos imóveis dados em garantia (Brasil)',
      unidade: 'índice',
      local: 'Brasil',
      metodo: 'API SGS (série 21340)',
      url,
      obs: 'Índice nacional do Banco Central, baseado em laudos de avaliação. Não há recorte do RN.',
    }));
}

export const coletorBcb: Coletor = {
  chave: 'bcb',
  hostsExtras: ['api.bcb.gov.br'],
  maxPedidosPadrao: 20,
  async coletar(ctx) {
    const impressao = new Impressao();
    const erros: string[] = [];
    let n = 0;
    for (const [info, nome, unidade] of SERIES_BCB) {
      const url = `${OLINDA}?$format=json&$top=120&$orderby=Data%20desc&$filter=Info%20eq%20'${info}'`;
      const r = await ctx.navegador.json<{ value?: Array<{ Data?: string; Valor?: unknown }> }>(
        url,
      );
      if (!r) {
        erros.push(`${info}: ${ctx.navegador.parada ?? 'sem resposta'}`);
        continue;
      }
      impressao.somar(r.resposta.sha256 ?? '');
      n += await ctx.gravador.indices(linhasDoOlinda(info, nome, unidade, r.dado, url));
    }
    const ano = Number(ctx.dia.slice(0, 4));
    const urlIvgr = `https://api.bcb.gov.br/dados/serie/bcdata.sgs.21340/dados?formato=json&dataInicial=01/01/${ano - 9}`;
    const ivgr = await ctx.navegador.json<Array<{ data?: string; valor?: unknown }>>(urlIvgr);
    if (ivgr && Array.isArray(ivgr.dado)) {
      impressao.somar(ivgr.resposta.sha256 ?? '');
      n += await ctx.gravador.indices(linhasDoIvgr(ivgr.dado, urlIvgr));
    } else erros.push(`IVG-R: ${ctx.navegador.parada ?? 'sem resposta'}`);
    return resultadoDeSerie(ctx, impressao, n, erros);
  },
};

// ---------------------------------------------------------------------------
// Tesouro Nacional (SICONFI): ITBI
// ---------------------------------------------------------------------------

const CIDADES_ITBI: Array<[string, string]> = [
  ['2408102', 'Natal'],
  ['2403251', 'Parnamirim'],
  ['2414209', 'Tibau do Sul'],
  ['2408201', 'Nísia Floresta'],
  ['2403608', 'Extremoz'],
];
const API_SICONFI = 'https://apidatalake.tesouro.gov.br/ords/siconfi/tt';

export const mesMenos = (ym: string, k: number): string => {
  const [a, m] = ym.split('-').map(Number);
  const d = new Date(Date.UTC(a ?? 1970, (m ?? 1) - 1 - k, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
};

/** Um RREO (Anexo 3) → ITBI de cada mês (o período p termina no mês 2p; MR-k é k meses antes). */
export function mesesDoRreo(
  dado: { items?: Array<{ conta?: string; coluna?: string; valor?: number }> },
  ano: number,
  periodo: number,
): Record<string, number> | null {
  const itens = (dado.items ?? []).filter(
    (x) => x.conta === 'ITBI' && /^<MR(-\d+)?>$/.test(x.coluna ?? ''),
  );
  if (itens.length === 0) return null;
  const mr = `${ano}-${String(periodo * 2).padStart(2, '0')}`;
  const out: Record<string, number> = {};
  for (const x of itens) {
    const k = Number(x.coluna?.match(/-(\d+)/)?.[1] ?? 0);
    if (typeof x.valor === 'number') out[mesMenos(mr, k)] = x.valor;
  }
  return out;
}

export const coletorSiconfi: Coletor = {
  chave: 'siconfi',
  maxPedidosPadrao: 200,
  async coletar(ctx) {
    const impressao = new Impressao();
    const erros: string[] = [];
    let n = 0;
    const ano = Number(ctx.dia.slice(0, 4));
    const rreo = async (
      ente: string,
      a: number,
      p: number,
    ): Promise<{ meses: Record<string, number>; url: string } | null> => {
      const url = `${API_SICONFI}/rreo?an_exercicio=${a}&nr_periodo=${p}&co_tipo_demonstrativo=RREO&no_anexo=RREO-Anexo%2003&id_ente=${ente}`;
      const r = await ctx.navegador.json<{
        items?: Array<{ conta?: string; coluna?: string; valor?: number }>;
      }>(url, { tempo: 60_000 });
      if (!r) return null;
      const meses = mesesDoRreo(r.dado, a, p);
      if (!meses) return null;
      impressao.somar(r.resposta.sha256 ?? '');
      return { meses, url };
    };
    for (const [ente, nome] of CIDADES_ITBI) {
      if (ctx.navegador.parada) break;
      const meses: Record<string, { valor: number; url: string }> = {};
      // O último período de cada ano cobre 12 meses: dois anos dão até 24. Cidade atrasada: volta até 4 anos.
      for (let a = ano; a >= ano - 4; a -= 1) {
        if (a < ano - 1 && Object.keys(meses).length > 0) break;
        for (let p = 6; p >= 1; p -= 1) {
          const r = await rreo(ente, a, p);
          if (r) {
            for (const [m, v] of Object.entries(r.meses)) meses[m] = { valor: v, url: r.url };
            break;
          }
        }
      }
      const linhas: LinhaIndice[] = Object.entries(meses).map(([m, x]) => ({
        serie: `itbi-${ente}`,
        mes: mesDe(m),
        valor: Math.round(x.valor),
        nome: `ITBI arrecadado por mês: ${nome}`,
        unidade: 'R$',
        local: nome,
        metodo: 'API SICONFI (RREO, Anexo 3)',
        url: x.url,
        obs: 'Tesouro Nacional, SICONFI. Mês de pico costuma ser lançamento ou venda grande.',
      }));
      if (linhas.length > 0) n += await ctx.gravador.indices(linhas);
      // Total do ano (DCA, Anexo I-C, "Receitas Brutas Realizadas" da conta do ITBI), no mês 12.
      for (let a = ano - 3; a <= ano - 1; a += 1) {
        const url = `${API_SICONFI}/dca?an_exercicio=${a}&id_ente=${ente}&no_anexo=DCA-Anexo%20I-C`;
        const r = await ctx.navegador.json<{
          items?: Array<{ cod_conta?: string; coluna?: string; valor?: number }>;
        }>(url, { tempo: 60_000 });
        const it = r?.dado.items?.find(
          (x) =>
            /^RO1\.1\.1\.2\.53\.0\.0$/.test(x.cod_conta ?? '') &&
            /Receitas Brutas Realizadas/i.test(x.coluna ?? ''),
        );
        if (!r || !it || typeof it.valor !== 'number') continue;
        impressao.somar(r.resposta.sha256 ?? '');
        n += await ctx.gravador.indices([
          {
            serie: `itbi-anual-${ente}`,
            mes: `${a}-12-01`,
            valor: Math.round(it.valor),
            nome: `ITBI arrecadado no ano: ${nome}`,
            unidade: 'R$ no ano',
            local: nome,
            metodo: 'API SICONFI (DCA, Anexo I-C)',
            url,
            obs: 'Total do ano inteiro, marcado no mês 12.',
          },
        ]);
      }
    }
    return resultadoDeSerie(ctx, impressao, n, erros);
  },
};

// ---------------------------------------------------------------------------
// A Corrida dos Bairros (CSV aberto, CC BY 4.0)
// ---------------------------------------------------------------------------

/** Bairro do CSV → região do sistema; aproximado = o bairro do CSV não é a região em si. */
const MAPA_CORRIDA: Array<[string, string, Array<[string, boolean]>]> = [
  [
    'Natal',
    'Capim Macio',
    [
      ['natal-capim-macio', false],
      ['natal-cidade-jardim', true],
    ],
  ],
  ['Natal', 'Ponta Negra', [['natal-ponta-negra', false]]],
  ['Natal', 'Lagoa Nova', [['natal-lagoa-nova', false]]],
  ['Natal', 'Potengi', [['natal-potengi', false]]],
  ['Natal', 'Pitimbu', [['natal-satelite', true]]],
  ['Natal', 'Tirol', [['natal-tirol', false]]],
  ['Natal', 'Petrópolis', [['natal-petropolis', false]]],
  ['Natal', 'Candelária', [['natal-candelaria', false]]],
  ['Natal', 'Neópolis', [['natal-neopolis', false]]],
  ['Parnamirim', 'Vale do Sol', [['parnamirim-bonor', true]]],
  ['Parnamirim', 'Nova Parnamirim', [['parnamirim-nova-parnamirim', false]]],
  ['Parnamirim', 'Parque das Nações', [['parnamirim-parque-das-nacoes', false]]],
  ['Parnamirim', 'Cotovelo (Distrito Litoral)', [['parnamirim-cotovelo', false]]],
  ['Parnamirim', 'Pirangi do Norte (Distrito Litoral)', [['parnamirim-pirangi', false]]],
  ['Parnamirim', 'Pirangi do Norte', [['parnamirim-pirangi', false]]],
];
const MESES: Record<string, number> = {
  janeiro: 1,
  fevereiro: 2,
  marco: 3,
  abril: 4,
  maio: 5,
  junho: 6,
  julho: 7,
  agosto: 8,
  setembro: 9,
  outubro: 10,
  novembro: 11,
  dezembro: 12,
};

export function linhasDaCorrida(
  csv: string,
  url: string,
  existe: (regiao: string) => boolean,
): LinhaIndice[] {
  const texto = csv.trim();
  if (!/^cidade,bairro,tipo,modo,mediana_rs_m2/.test(texto))
    throw new Error('CSV com cabeçalho diferente');
  const [cab, ...linhas] = texto.split(/\r?\n/);
  const k = (cab ?? '').split(',');
  const out: LinhaIndice[] = [];
  for (const l of linhas) {
    const v = l.split(',');
    const o = Object.fromEntries(k.map((c, i) => [c, v[i] ?? '']));
    const coleta = String(o.coleta ?? '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .match(/^([a-z]+)\/(\d{4})$/);
    const mesN = coleta?.[1] ? MESES[coleta[1]] : undefined;
    if (!coleta?.[2] || !mesN) continue;
    const mediana = Number(o.mediana_rs_m2);
    if (!Number.isFinite(mediana) || mediana <= 0) continue;
    const modo = o.modo === 'aluguel' ? 'aluguel' : o.modo === 'venda' ? 'venda' : null;
    if (!modo || !/^[a-z_]{2,40}$/.test(String(o.tipo))) continue;
    for (const [cidade, bairro, regioes] of MAPA_CORRIDA) {
      if (o.cidade !== cidade || o.bairro !== bairro) continue;
      for (const [regiao, aproximado] of regioes) {
        if (!existe(regiao)) continue;
        out.push({
          serie: `corrida-${regiao}-${String(o.tipo)}-${modo}`.slice(0, 81),
          mes: `${coleta[2]}-${String(mesN).padStart(2, '0')}-01`,
          valor: mediana,
          nome: `A Corrida dos Bairros: m² mediano pedido (${String(o.tipo)}, ${modo}) em ${bairro}`,
          unidade: modo === 'venda' ? 'R$/m²' : 'R$/m² ao mês',
          local: bairro,
          regiao_id: regiao,
          sub: String(o.tipo),
          modo,
          amostra: Number.isFinite(Number(o.n_anuncios)) ? Math.round(Number(o.n_anuncios)) : null,
          aproximado,
          metodo: 'csv',
          url,
          obs: 'A Corrida dos Bairros (Minuto Jaraguá), CC BY 4.0: crédito sempre.',
        });
      }
    }
  }
  // "Pirangi do Norte" e "Pirangi do Norte (Distrito Litoral)" caem na mesma
  // série: fica a linha de maior amostra (a mesma regra do gravador).
  return indicesSemRepetir(out).linhas;
}

export const coletorCorrida: Coletor = {
  chave: 'corrida',
  maxPedidosPadrao: 6,
  caminhoDeTeste: '/rn/natal/dados.csv',
  async coletar(ctx) {
    const impressao = new Impressao();
    const erros: string[] = [];
    let n = 0;
    for (const cidade of ['natal', 'parnamirim']) {
      const url = `https://acorridadosbairros.com.br/rn/${cidade}/dados.csv`;
      const r = await ctx.navegador.pagina(url, { aceitar: 'text/csv,*/*;q=0.5' });
      if (!r?.texto) {
        erros.push(
          `${cidade}: ${r ? `HTTP ${r.status}` : (ctx.navegador.parada ?? 'robots fecha')}`,
        );
        continue;
      }
      impressao.somar(r.sha256 ?? '');
      try {
        n += await ctx.gravador.indices(
          linhasDaCorrida(r.texto, url, (id) => ctx.regioes.existe(id)),
        );
      } catch (e) {
        erros.push(`${cidade}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    return resultadoDeSerie(ctx, impressao, n, erros);
  },
};

// ---------------------------------------------------------------------------
// GeoMapas (Prefeitura do Natal): alvarás e habite-se por bairro e ano
// ---------------------------------------------------------------------------

interface CamadaGeomapas {
  id?: unknown;
  nome: string;
  link: string;
}

export function camadasDoCatalogo(o: unknown, acc: CamadaGeomapas[] = []): CamadaGeomapas[] {
  if (Array.isArray(o)) for (const v of o) camadasDoCatalogo(v, acc);
  else if (o && typeof o === 'object') {
    const x = o as Record<string, unknown>;
    if (
      typeof x.nome === 'string' &&
      typeof x.link === 'string' &&
      x.link !== '#' &&
      /^(Construção|Multifamiliar)$/.test(x.nome)
    ) {
      acc.push({ id: x.id, nome: x.nome, link: x.link });
    }
    for (const v of Object.values(x)) camadasDoCatalogo(v, acc);
  }
  return acc;
}

const acentos = (t: string): number => [...t].filter((ch) => ch.charCodeAt(0) > 127).length;
/** A chave do bairro junta as grafias: sem acento, sem caixa, e hífen, ponto ou espaço contam igual ("Dix-Sept Rosado" = "Dix Sept Rosado"). */
const chaveDoBairro = (b: string): string =>
  b
    .replace(/^N\. ?S\.? /i, 'Nossa Senhora ')
    .replace(/ do Nazar/i, ' de Nazar')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

/**
 * Soma as linhas da mesma série e mês (o corte da série em 70 caracteres pode
 * juntar dois bairros; o upsert não aceita a mesma chave duas vezes no lote).
 */
export function somarPorSerie(linhas: readonly LinhaIndice[]): LinhaIndice[] {
  const out = new Map<string, LinhaIndice>();
  for (const l of linhas) {
    const chave = `${l.serie}|${l.mes}`;
    const atual = out.get(chave);
    if (!atual) {
      out.set(chave, { ...l });
      continue;
    }
    atual.valor += l.valor;
    if (atual.local !== l.local) {
      atual.local = [atual.local, l.local].filter(Boolean).join(' + ');
      atual.regiao_id = atual.regiao_id === l.regiao_id ? atual.regiao_id : null;
      atual.obs = `${atual.obs ?? ''} Soma de grafias ou bairros com a mesma série.`.trim();
    }
  }
  return [...out.values()];
}

/** Soma alvarás e habite-se por bairro e ano das camadas (GeoJSON). */
export function contarAlvaras(
  geojsons: Array<{ features?: Array<{ properties?: Record<string, unknown> }> }>,
): Map<
  string,
  { bairro: string; tipo: 'alvara' | 'habite_se'; ano: string; n: number; unidades: number }
> {
  const out = new Map<
    string,
    { bairro: string; tipo: 'alvara' | 'habite_se'; ano: string; n: number; unidades: number }
  >();
  for (const g of geojsons) {
    for (const f of g.features ?? []) {
      const p = f.properties ?? {};
      const m = String(p.DocAno ?? '').match(/(Alvar[áa]|Habite-se)_(\d{4})/i);
      if (!m?.[1] || !m[2]) continue;
      const tipo = /habite/i.test(m[1]) ? 'habite_se' : 'alvara';
      const bairro = String(p.Bairro ?? '?')
        .trim()
        .replace(/^N\. ?S\.? /i, 'Nossa Senhora ');
      const chave = `${chaveDoBairro(bairro)}|${tipo}|${m[2]}`;
      const atual = out.get(chave) ?? { bairro, tipo, ano: m[2], n: 0, unidades: 0 };
      atual.n += 1;
      const u = Number(String(p.NumUnidade ?? '').replace(',', '.'));
      if (Number.isFinite(u)) atual.unidades += u;
      // Fica o rótulo com acento (o mesmo bairro vem escrito de jeitos diferentes conforme o ano).
      if (acentos(bairro) > acentos(atual.bairro)) atual.bairro = bairro;
      out.set(chave, atual);
    }
  }
  return out;
}

export const coletorGeomapas: Coletor = {
  chave: 'construcao',
  maxPedidosPadrao: 60,
  async coletar(ctx) {
    const impressao = new Impressao();
    const erros: string[] = [];
    const origem = 'https://geomapas.natal.rn.gov.br';
    const cat = await ctx.navegador.json<unknown>(`${origem}/api.php?listar_todos`);
    if (!cat)
      return resultadoDeSerie(ctx, impressao, 0, [
        `catálogo: ${ctx.navegador.parada ?? 'sem resposta'}`,
      ]);
    impressao.somar(cat.resposta.sha256 ?? '');
    const geojsons: Array<{ features?: Array<{ properties?: Record<string, unknown> }> }> = [];
    const camadas = camadasDoCatalogo(cat.dado);
    for (const c of camadas) {
      const r = await ctx.navegador.json<{
        features?: Array<{ properties?: Record<string, unknown> }>;
      }>(`${origem}/uploads/${encodeURIComponent(c.link)}.geojson`, { tempo: 120_000 });
      if (!r?.dado.features) {
        erros.push(`camada ${c.link}: ${ctx.navegador.parada ?? 'sem dados'}`);
        continue;
      }
      impressao.somar(r.resposta.sha256 ?? '');
      geojsons.push(r.dado);
    }
    const linhas: LinhaIndice[] = [];
    for (const x of contarAlvaras(geojsons).values()) {
      const regiao = ctx.regioes.regiaoDe({ cidade: 'Natal', bairro: x.bairro })?.regiao ?? null;
      const rotulo = x.tipo === 'alvara' ? 'Alvarás de construção' : 'Habite-se multifamiliar';
      const base = {
        mes: `${x.ano}-01-01`,
        local: x.bairro,
        regiao_id: regiao,
        metodo: 'camada GeoMapas (contagem do ano)',
        url: `${origem}/`,
        obs: 'Prefeitura do Natal (SEMURB). Contagem do ANO inteiro, gravada no mês 1 do ano.',
      };
      const s = `geomapas-${x.tipo === 'alvara' ? 'alvara' : 'habite-se'}-${slug(x.bairro)}`.slice(
        0,
        70,
      );
      linhas.push({
        ...base,
        serie: s,
        valor: x.n,
        nome: `${rotulo} no ano: ${x.bairro}`,
        unidade: 'documentos no ano',
      });
      if (x.unidades > 0)
        linhas.push({
          ...base,
          serie: `${s}-unidades`,
          valor: x.unidades,
          nome: `${rotulo}, unidades no ano: ${x.bairro}`,
          unidade: 'unidades no ano',
        });
    }
    const somadas = somarPorSerie(linhas);
    const n = somadas.length > 0 ? await ctx.gravador.indices(somadas) : 0;
    return resultadoDeSerie(ctx, impressao, n, erros, { camadas: camadas.length });
  },
};
