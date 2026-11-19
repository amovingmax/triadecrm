/**
 * Anúncios do Chaves na Mão SÓ pelo servidor MCP oficial do portal, sem login
 * (fonte `chavesnamao-mcp`, liberada pelo dono em 18/11/2026). Porte de
 * `coletar/anuncios/chavesnamao.mjs`.
 *
 * Por que é permitido (auditoria de 18/11/2026):
 *  - server card público (ferramenta `search_realty_listings`, "requiresAuth": false);
 *  - robots.txt: "Allow: /api/mcp" (conferido a cada rodada, `caminhoDeTeste`);
 *  - llms.txt: os agentes devem usar o MCP em vez de percorrer páginas;
 *  - limite publicado de 60 chamadas por minuto: aqui 1 por vez, com o
 *    intervalo da lista (1 s) e o teto de 600 chamadas por rodada; para no 429.
 * Nunca abre página HTML do portal (a fonte `chavesnamao-paginas` é PROIBIDA)
 * e não treina modelo com os dados (ai-train=no): a IA só lê números calculados.
 *
 * Cada busca é uma "consulta" (`consulta_id`, o rótulo da busca). Busca lida
 * até o fim (todas as páginas, até 300 anúncios, com o total dito pelo
 * portal) é completa: só os anúncios de consulta completa podem ganhar falta
 * e sair do ar. As buscas da prioridade 1 com mais de 300 anúncios se dividem
 * por faixa de preço. As das outras prioridades leem só 2 a 5 páginas e
 * nunca ficam completas: os anúncios delas saem do ar só pela validade da
 * régua (anúncio não visto há 8 dias vence). O mesmo vale para quem era de uma
 * busca que saiu do plano (o rótulo mudou): fica órfão e vence pela validade.
 */
import { anuncioDeSite, type Recusa } from '../anuncio';
import { Impressao, LoteDeAnuncios } from '../lote';
import { limparTitulo, logradouroDe, semAcento, slug } from '../texto';
import type { Coletor, ContextoDoColetor, ItemAnuncio, ResultadoDoColetor } from '../tipos';
import type { Navegador } from '../web';

const POR_PAGINA = 15;
const MAX_PAGINAS = 20;

export interface Tarefa {
  prio: number;
  rotulo: string;
  filtros: Record<string, string | number | undefined>;
  paginas: number;
  dividir: boolean;
}

const V = 'venda';
const A = 'aluguel';
const TERRENO = ['terreno', 'terreno comercial', 'terreno em condomínio'];
/** Os 10 bairros oficiais de Parnamirim da área da BONOR (`mercado_regioes`, parnamirim-bonor). */
const BONOR = [
  'Santos Reis',
  'Rosa dos Ventos',
  'Passagem de Areia',
  'Cohabinal',
  'Monte Castelo',
  'Vale do Sol',
  'Boa Esperança',
  'Bela Parnamirim',
  'Santa Tereza',
  'Centro',
];
const NUCLEO_BONOR = ['Santos Reis', 'Rosa dos Ventos'];

/** O que buscar, em ordem de prioridade: primeiro onde a Imova tem imóvel, depois as vizinhas. */
export function montarPlano(): Tarefa[] {
  const p: Tarefa[] = [];
  type Op = { prio?: number; paginas?: number; dividir?: boolean; f?: Record<string, number> };
  const vistas = new Set<string>();
  // A mesma busca (mesmos filtros) só entra uma vez, na prioridade mais alta;
  // o rótulo leva o filtro de quartos, para a consulta ter nome único.
  const add = (
    prio: number,
    rotulo: string,
    f: Record<string, string | number | undefined>,
    o: Op = {},
  ) => {
    const filtros: Record<string, string | number | undefined> = { state: 'RN', ...f };
    const chave = JSON.stringify(Object.entries(filtros).sort(([a], [b]) => a.localeCompare(b)));
    if (vistas.has(chave)) return;
    vistas.add(chave);
    const nome = filtros.bedrooms ? `${rotulo} (${String(filtros.bedrooms)} quartos)` : rotulo;
    // Prioridade 1 (onde a Imova tem imóvel): busca com mais de 300 anúncios se
    // divide por faixa de preço, para cada faixa poder ser lida até o fim.
    p.push({
      prio,
      rotulo: nome,
      filtros,
      paginas: o.paginas ?? MAX_PAGINAS,
      dividir: o.dividir ?? prio === 1,
    });
  };
  const natal = (bairro: string, tipo: string, modo = V, o: Op = {}) =>
    add(
      o.prio ?? 1,
      `${tipo} ${modo} em ${bairro}`,
      {
        transaction: modo,
        propertyType: tipo,
        city: 'Natal',
        neighborhood: bairro,
        ...(o.f ?? {}),
      },
      o,
    );
  const parn = (bairro: string | null, tipo: string, modo = V, o: Op = {}) =>
    add(
      o.prio ?? 1,
      `${tipo} ${modo} em ${bairro ?? 'Parnamirim'}, Parnamirim`,
      {
        transaction: modo,
        propertyType: tipo,
        city: 'Parnamirim',
        ...(bairro ? { neighborhood: bairro } : {}),
        ...(o.f ?? {}),
      },
      o,
    );
  const cid = (cidade: string, bairro: string | null, tipo: string, modo = V, o: Op = {}) =>
    add(
      o.prio ?? 1,
      `${tipo} ${modo} em ${bairro ?? cidade}`,
      {
        transaction: modo,
        propertyType: tipo,
        city: cidade,
        ...(bairro ? { neighborhood: bairro } : {}),
        ...(o.f ?? {}),
      },
      o,
    );

  // 1) combinações em que a Imova tem imóvel (todas as páginas)
  for (const t of TERRENO) natal('Capim Macio', t); // Cidade Jardim sai pelo título
  for (const t of TERRENO) natal('Candelária', t);
  for (const t of ['terreno', 'terreno comercial']) natal('Pitimbu', t); // Satélite (o portal põe em Pitimbu)
  for (const t of ['terreno', 'terreno comercial'])
    add(1, `${t} acima de 2.000 m² em Natal`, {
      transaction: V,
      propertyType: t,
      city: 'Natal',
      minArea: 2000,
    });
  for (const b of BONOR) parn(b, 'terreno');
  for (const b of NUCLEO_BONOR) parn(b, 'terreno comercial');
  for (const t of ['terreno', 'terreno comercial'])
    add(1, `${t} acima de 2.000 m² em Parnamirim`, {
      transaction: V,
      propertyType: t,
      city: 'Parnamirim',
      minArea: 2000,
    });
  for (const t of TERRENO) cid('Tibau do Sul', 'Pipa', t);
  add(1, 'terreno acima de 2.000 m² em Tibau do Sul', {
    transaction: V,
    propertyType: 'terreno',
    city: 'Tibau do Sul',
    minArea: 2000,
  });
  for (const t of TERRENO) cid('Nísia Floresta', 'Tabatinga', t);
  natal('Potengi', 'casa');
  natal('Lagoa Nova', 'apartamento', V, { f: { bedrooms: 2 } });
  cid('Extremoz', null, 'casa');
  cid('Extremoz', null, 'casa em condomínio');
  for (const m of [V, A]) {
    for (const t of ['comercial', 'loja']) {
      natal('Ponta Negra', t, m);
      parn('Pirangi do Norte', t, m);
    }
  }

  // 2) comercial para alugar e galpões
  for (const b of ['Lagoa Nova', 'Capim Macio', 'Tirol', 'Petrópolis', 'Candelária'])
    for (const t of ['comercial', 'loja']) natal(b, t, A, { prio: 2, paginas: 4 });
  for (const b of ['Nova Parnamirim', 'Centro'])
    for (const t of ['comercial', 'loja']) parn(b, t, A, { prio: 2, paginas: 4 });
  for (const m of [A, V])
    add(
      2,
      `galpão ${m} em Parnamirim`,
      { transaction: m, propertyType: 'galpão', city: 'Parnamirim' },
      { paginas: 4 },
    );
  add(
    2,
    'galpão aluguel em Natal',
    { transaction: A, propertyType: 'galpão', city: 'Natal' },
    { paginas: 3 },
  );
  for (const b of ['Nova Parnamirim', ...NUCLEO_BONOR])
    for (const t of ['comercial', 'loja']) parn(b, t, V, { prio: 2, paginas: 3 });

  // 3) bairros de referência, à venda
  for (const t of ['casa', 'apartamento']) natal('Pitimbu', t, V, { prio: 3, paginas: 5 });
  for (const b of ['Tirol', 'Petrópolis', 'Candelária', 'Neópolis'])
    for (const t of ['apartamento', 'casa', 'terreno'])
      natal(b, t, V, { prio: 3, paginas: t === 'terreno' ? 3 : 5 });
  for (const b of ['Parque das Nações', 'Cotovelo'])
    for (const t of ['casa', 'terreno', 'apartamento', 'casa em condomínio'])
      parn(b, t, V, { prio: 3, paginas: 4 });
  for (const t of ['apartamento', 'casa', 'casa em condomínio', ...TERRENO])
    parn('Nova Parnamirim', t, V, { prio: 3, paginas: t.startsWith('terreno') ? 4 : 5 });

  // 4) o resto da carteira, à venda (amostra)
  for (const t of ['casa', 'apartamento', 'casa em condomínio'])
    natal('Capim Macio', t, V, { prio: 4, paginas: 4 });
  for (const t of ['casa', 'apartamento', 'casa em condomínio', 'terreno', 'terreno em condomínio'])
    natal('Ponta Negra', t, V, { prio: 4, paginas: 4 });
  for (const t of ['casa', 'terreno', 'apartamento'])
    natal('Lagoa Nova', t, V, { prio: 4, paginas: 4 });
  for (const t of ['terreno', 'apartamento']) natal('Potengi', t, V, { prio: 4, paginas: 3 });
  for (const b of ['Rosa dos Ventos', 'Santos Reis', 'Vale do Sol', 'Centro'])
    for (const t of ['casa', 'apartamento']) parn(b, t, V, { prio: 4, paginas: 2 });
  for (const t of ['casa', 'apartamento', 'terreno', 'casa em condomínio'])
    parn('Pirangi do Norte', t, V, { prio: 4, paginas: 3 });
  for (const t of ['casa', 'casa em condomínio']) {
    cid('Tibau do Sul', 'Pipa', t, V, { prio: 4, paginas: 3 });
    cid('Nísia Floresta', 'Tabatinga', t, V, { prio: 4, paginas: 3 });
  }
  // Tabatinga perdeu amostra em 18/11: o portal também usa "Barra de Tabatinga" (pendência 6 da verificação)
  for (const t of ['terreno', 'casa'])
    cid('Nísia Floresta', 'Barra de Tabatinga', t, V, { prio: 4, paginas: 3 });
  cid('Extremoz', null, 'terreno', V, { prio: 4, paginas: 4 });

  // 5) aluguel residencial (amostra)
  for (const b of ['Ponta Negra', 'Lagoa Nova', 'Capim Macio', 'Tirol', 'Petrópolis', 'Candelária'])
    natal(b, 'apartamento', A, { prio: 5, paginas: 3 });
  for (const b of ['Ponta Negra', 'Capim Macio', 'Candelária', 'Neópolis'])
    natal(b, 'casa', A, { prio: 5, paginas: 2 });
  for (const t of ['apartamento', 'casa']) {
    parn('Nova Parnamirim', t, A, { prio: 5, paginas: 3 });
    parn('Pirangi do Norte', t, A, { prio: 5, paginas: 2 });
    cid('Tibau do Sul', 'Pipa', t, A, { prio: 5, paginas: 2 });
  }
  cid('Extremoz', null, 'casa', A, { prio: 5, paginas: 2 });
  return p.sort((a, b) => a.prio - b.prio);
}

/**
 * A busca foi lida até o fim? Só com o total CONHECIDO (a resposta trouxe
 * `totalPages` e `totalResults`), a última página lida, no máximo 300
 * anúncios (o que a ferramenta entrega) e pelo menos um anúncio visto. Sem a
 * paginação na resposta, ou com a busca vazia, não dá para dizer quem saiu.
 */
export function buscaCompleta(
  pag: { totalResults?: unknown; totalPages?: unknown },
  paginaLida: number,
  vistos: number,
): boolean {
  const total = pag.totalResults;
  const paginas = pag.totalPages;
  if (
    typeof total !== 'number' ||
    typeof paginas !== 'number' ||
    !Number.isFinite(total) ||
    !Number.isFinite(paginas)
  )
    return false;
  return vistos > 0 && total > 0 && paginaLida >= paginas && total <= POR_PAGINA * MAX_PAGINAS;
}

const FAIXAS: Record<string, Array<[number, number | null]>> = {
  venda: [
    [0, 150000],
    [150000, 250000],
    [250000, 400000],
    [400000, 600000],
    [600000, 900000],
    [900000, 1500000],
    [1500000, null],
  ],
  aluguel: [
    [0, 1500],
    [1500, 3000],
    [3000, 6000],
    [6000, null],
  ],
};

/** Um resultado do portal (só os campos que a ferramenta devolve). */
export interface ResultadoDoPortal {
  id?: string | number;
  title?: string;
  url?: string;
  propertyType?: string;
  transaction?: string;
  priceBRL?: number;
  areaM2?: number;
  bedrooms?: number;
  bathrooms?: number;
  parkingSpots?: number;
  imageUrl?: string;
  location?: { state?: string; city?: string; neighborhood?: string };
  [outro: string]: unknown;
}

/** Cópia para o bruto: título limpo de telefone e sem o texto de apresentação. */
export const paraBruto = (r: ResultadoDoPortal): Record<string, unknown> => {
  const { cta: _cta, description: _d, ...resto } = r as Record<string, unknown>;
  return { ...resto, title: limparTitulo(r.title) };
};

/** Um resultado do portal → item do banco (ou o motivo de ficar fora). */
export function normalizar(
  r: ResultadoDoPortal,
  consultaId: string,
  hashDaPagina: string | null,
  ctx: Pick<ContextoDoColetor, 'regioes' | 'dia'>,
): ItemAnuncio | Recusa {
  const loc = r.location ?? {};
  if (loc.state && loc.state !== 'RN') return { recusa: 'fora do RN' };
  if (r.id === undefined || r.id === null || String(r.id).trim() === '')
    return { recusa: 'sem id' };
  const titulo = limparTitulo(r.title);
  const modo = semAcento(r.transaction).startsWith('alug') ? 'aluguel' : 'venda';
  return anuncioDeSite(
    {
      id_externo: String(r.id),
      modo,
      tipoTexto: r.propertyType ?? null,
      titulo: r.title ?? null,
      preco: typeof r.priceBRL === 'number' && r.priceBRL >= 1 ? Math.round(r.priceBRL) : null,
      area_unica: typeof r.areaM2 === 'number' && r.areaM2 > 0 ? r.areaM2 : null,
      quartos: r.bedrooms ?? null,
      banheiros: r.bathrooms ?? null,
      vagas: r.parkingSpots ?? null,
      bairro: loc.neighborhood ?? null,
      cidade: loc.city ?? null,
      logradouro: logradouroDe({
        titulo,
        imagem: r.imageUrl ?? null,
        cidade: loc.city ?? null,
        bairro: loc.neighborhood ?? null,
        tipoDaFonte: r.propertyType ?? null,
      }),
      url: r.url ?? null,
      data_dado: ctx.dia,
      hash_bruto: hashDaPagina,
      consulta_id: consultaId,
      bruto: paraBruto(r),
    },
    ctx.regioes,
  );
}

// ---------------------------------------------------------------------------
// Cliente MCP (JSON-RPC por HTTP, "streamable HTTP")
// ---------------------------------------------------------------------------

export class ClienteMcp {
  private seq = 0;
  private sessao: string | null = null;

  constructor(
    private readonly navegador: Navegador,
    private readonly endpoint: string,
  ) {}

  private async chamar(
    metodo: string,
    params: unknown,
    notificacao = false,
  ): Promise<{ resultado: unknown; sha256: string | null; texto: string | null }> {
    const corpo = notificacao
      ? { jsonrpc: '2.0', method: metodo, params }
      : { jsonrpc: '2.0', id: ++this.seq, method: metodo, params };
    const r = await this.navegador.pagina(this.endpoint, {
      metodo: 'POST',
      corpo: JSON.stringify(corpo),
      aceitar: 'application/json, text/event-stream',
      cabecalhos: {
        'Content-Type': 'application/json',
        ...(this.sessao ? { 'Mcp-Session-Id': this.sessao } : {}),
      },
      tempo: 30_000,
    });
    if (!r)
      throw new Error(
        `MCP ${metodo}: pedido não saiu (${this.navegador.parada ?? 'robots ou teto'})`,
      );
    const s = r.cabecalhos['mcp-session-id'];
    if (s) this.sessao = s;
    if (r.status === 429 || r.status === 403)
      throw new Error(`MCP ${metodo}: HTTP ${r.status} (o portal pediu para parar)`);
    if (notificacao) return { resultado: null, sha256: r.sha256, texto: r.texto };
    if (r.erro || !r.texto) throw new Error(`MCP ${metodo}: ${r.erro ?? `HTTP ${r.status}`}`);
    const json = lerJsonRpc(r.texto, r.tipo);
    if (json.error)
      throw new Error(`MCP ${metodo}: ${json.error.code ?? ''} ${json.error.message ?? ''}`.trim());
    return { resultado: json.result, sha256: r.sha256, texto: r.texto };
  }

  async conectar(): Promise<{ servidor: unknown }> {
    const ini = await this.chamar('initialize', {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 'coletor-de-dados-publicos', version: '1.0' },
    });
    await this.chamar('notifications/initialized', {}, true);
    const lista = (await this.chamar('tools/list', {})).resultado as {
      tools?: Array<{ name?: string }>;
    } | null;
    if (!(lista?.tools ?? []).some((t) => t.name === 'search_realty_listings')) {
      throw new Error('o servidor não oferece mais search_realty_listings');
    }
    return { servidor: (ini.resultado as { serverInfo?: unknown } | null)?.serverInfo ?? null };
  }

  async buscar(args: Record<string, unknown>): Promise<{
    resposta: {
      results?: ResultadoDoPortal[];
      pagination?: { totalResults?: number; totalPages?: number };
    };
    sha256: string | null;
  }> {
    const { resultado, sha256 } = await this.chamar('tools/call', {
      name: 'search_realty_listings',
      arguments: args,
    });
    const res = resultado as {
      isError?: boolean;
      content?: Array<{ type?: string; text?: string }>;
    } | null;
    if (res?.isError)
      throw new Error(`ferramenta: ${String(res.content?.[0]?.text ?? 'erro').slice(0, 200)}`);
    const texto = res?.content?.find((c) => c.type === 'text')?.text;
    if (!texto) throw new Error('resposta sem texto');
    return {
      resposta: JSON.parse(texto) as {
        results?: ResultadoDoPortal[];
        pagination?: { totalResults?: number; totalPages?: number };
      },
      sha256,
    };
  }
}

/** A resposta pode vir como JSON puro ou como evento SSE ("data: {...}"). */
export function lerJsonRpc(
  texto: string,
  tipo: string | null,
): { result?: unknown; error?: { code?: number; message?: string } } {
  if ((tipo ?? '').includes('event-stream')) {
    const linhas = texto.split('\n').filter((l) => l.startsWith('data:'));
    const ultima = linhas[linhas.length - 1];
    if (!ultima) throw new Error('evento SSE sem dados');
    return JSON.parse(ultima.slice(5)) as {
      result?: unknown;
      error?: { code?: number; message?: string };
    };
  }
  return JSON.parse(texto) as { result?: unknown; error?: { code?: number; message?: string } };
}

export const coletorChavesNaMao: Coletor = {
  chave: 'anuncios/chavesnamao',
  maxPedidosPadrao: 600,
  caminhoDeTeste: '/api/mcp/',
  async coletar(ctx: ContextoDoColetor): Promise<ResultadoDoColetor> {
    const endpoint = ctx.fonte.url ?? 'https://www.chavesnamao.com.br/api/mcp/';
    const mcp = new ClienteMcp(ctx.navegador, endpoint);
    const lote = new LoteDeAnuncios(ctx.gravador);
    const impressao = new Impressao();
    const erros: string[] = [];
    const consultasCompletas: string[] = [];
    const tarefasLidas: Array<Record<string, unknown>> = [];
    const agora = ctx.agora ?? Date.now;
    let interrompida = false;

    const info = await mcp.conectar();
    const fila = montarPlano();
    for (let i = 0; i < fila.length; i += 1) {
      const tf = fila[i];
      if (!tf) continue;
      if (agora() > ctx.prazo - 5_000 || ctx.navegador.parada) {
        interrompida = true;
        break;
      }
      const consultaId = slug(tf.rotulo);
      const itens: Array<ItemAnuncio | Recusa> = [];
      let total: number | null = null;
      let lidas = 0;
      let completa = false;
      let dividida = false;
      try {
        for (let pg = 1; pg <= Math.min(tf.paginas, MAX_PAGINAS); pg += 1) {
          const { resposta, sha256 } = await mcp.buscar({ filters: tf.filtros, page: pg });
          lidas += 1;
          const pag = resposta.pagination ?? {};
          total = pag.totalResults ?? total;
          const resultados = resposta.results ?? [];
          impressao.somar({
            tarefa: tf.rotulo,
            pagina: pg,
            pagination: pag,
            results: resultados.map(paraBruto),
          });
          for (const r of resultados) itens.push(normalizar(r, consultaId, sha256, ctx));
          // Busca grande demais: divide por faixa de preço (só nas prioritárias).
          if (
            pg === 1 &&
            tf.dividir &&
            (pag.totalResults ?? 0) > POR_PAGINA * MAX_PAGINAS &&
            !tf.filtros.minPrice &&
            !tf.filtros.maxPrice
          ) {
            const faixas = FAIXAS[String(tf.filtros.transaction)] ?? [];
            fila.splice(
              i + 1,
              0,
              ...faixas.map(([lo, hi]) => ({
                ...tf,
                dividir: false,
                rotulo: `${tf.rotulo} (R$ ${lo}–${hi ?? '+'})`,
                filtros: { ...tf.filtros, minPrice: lo || undefined, maxPrice: hi ?? undefined },
              })),
            );
            dividida = true;
            break;
          }
          const ultima = !pag.totalPages || pg >= pag.totalPages || resultados.length === 0;
          if (ultima) {
            completa = buscaCompleta(pag, pg, itens.length);
            break;
          }
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        erros.push(`${tf.rotulo}: ${msg}`);
        if (/429|403|pediu para parar|não saiu/.test(msg)) interrompida = true;
      }
      if (!dividida) {
        await lote.consulta(itens, completa);
        if (completa) consultasCompletas.push(consultaId);
      }
      tarefasLidas.push({
        rotulo: tf.rotulo,
        prio: tf.prio,
        total,
        paginas: lidas,
        completa,
        dividida,
      });
      if (interrompida) break;
    }
    await lote.esvaziar();
    ctx.logger.info('chaves na mão: rodada lida', {
      buscas: tarefasLidas.length,
      completas: consultasCompletas.length,
      enviados: lote.ids.size,
      novos: lote.resumo.novos,
      pedidos: ctx.navegador.pedidos,
    });
    return {
      completa: !interrompida && erros.length === 0,
      hashBruto: impressao.fechar(),
      consultasCompletas,
      detalhes: {
        servidor: info.servidor,
        buscas: tarefasLidas.length,
        buscas_completas: consultasCompletas.length,
        buscas_no_plano: fila.length,
        interrompida,
        enviados: lote.ids.size,
        banco: lote.resumo,
        recusas: lote.recusas,
        pedidos: ctx.navegador.pedidos,
      },
      erros,
    };
  },
};
