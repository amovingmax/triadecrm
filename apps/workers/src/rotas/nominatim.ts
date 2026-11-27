/**
 * Geocodificação pelo Nominatim (OpenStreetMap) — RF-ROT-01.
 *
 * ## Por que Nominatim e não Google
 *
 * O R06 §5 fecha a porta do Google: "Google Maps/Places não pode virar base do
 * CRM. Os termos da Google Maps Platform proíbem 'copy and save business names,
 * addresses, or user reviews' e limitam cache a `place_id`". Guardar a
 * coordenada de um parceiro no banco é exatamente o "save" proibido. A coluna de
 * alternativa da mesma tabela do R06 diz o que usar: "OpenStreetMap (ODbL) para
 * geodados". A ODbL permite guardar e EXIGE atribuição — a licença que volta em
 * cada resposta é gravada com o dado (`geo_places.licenca`) e a tela credita o
 * OpenStreetMap.
 *
 * O Google Maps continua no produto para NAVEGAR (o link "Abrir no Maps" da tela
 * de rota). Abrir o app de mapas com um destino é uso de usuário final; o que os
 * termos proíbem é copiar a base deles.
 *
 * ## A política de uso, respeitada e não disfarçada
 *
 * https://operations.osmfoundation.org/policies/nominatim/ exige, para o serviço
 * público:
 *   1. **no máximo 1 requisição por segundo** — `INTERVALO_MINIMO_MS` é 1100 ms
 *      e o relógio é medido do fim de uma requisição ao começo da seguinte. Não
 *      há paralelismo neste módulo: uma pergunta por vez, na fila;
 *   2. **User-Agent identificando a aplicação**, com contato — vai carimbado, e
 *      o worker se recusa a rodar sem ele em vez de mandar um UA genérico;
 *   3. **cache dos resultados** — é a tabela `public.geo_places`. Cada pergunta é
 *      feita uma vez na vida; a base inteira de hoje são 21 perguntas.
 *
 * Nada aqui acelera, paraleliza ou troca de identidade. Se um dia o volume não
 * couber em 1 req/s, o caminho é subir um Nominatim próprio na máquina do Luiz —
 * não é apertar o acelerador no serviço público de quem doou os dados.
 */

/** Política do Nominatim: 1 req/s. 1100 ms dá folga para o relógio de rede. */
export const INTERVALO_MINIMO_MS = 1_100;

export const URL_PADRAO = 'https://nominatim.openstreetmap.org';

export type PerguntaDeGeocodificacao = {
  consulta: string;
  escopo: 'bairro' | 'cidade';
  city_id: number;
  neighborhood: string | null;
  alvos: number;
};

export type RespostaDoNominatim = {
  encontrado: boolean;
  lat?: number;
  lng?: number;
  /** `addresstype` do OSM: é dele que sai a precisão, no banco. */
  addresstype?: string;
  osm_type?: string;
  osm_id?: number;
  osm_class?: string;
  display_name?: string;
  /** [lat_min, lat_max, lon_min, lon_max], como o Nominatim entrega. */
  bbox?: [number, number, number, number];
  licenca?: string;
};

export class ErroDoNominatim extends Error {
  constructor(
    readonly motivo: 'http' | 'rede' | 'formato',
    mensagem: string,
  ) {
    super(mensagem);
    this.name = 'ErroDoNominatim';
  }
}

function numero(valor: unknown): number | undefined {
  const n =
    typeof valor === 'string' ? Number(valor) : typeof valor === 'number' ? valor : Number.NaN;
  return Number.isFinite(n) ? n : undefined;
}

function caixa(valor: unknown): [number, number, number, number] | undefined {
  if (!Array.isArray(valor) || valor.length !== 4) return undefined;
  const n = valor.map(numero);
  return n.every((v): v is number => v !== undefined)
    ? [n[0] as number, n[1] as number, n[2] as number, n[3] as number]
    : undefined;
}

/** Traduz o primeiro resultado do Nominatim. Lista vazia é resposta legítima. */
export function lerResposta(bruto: unknown): RespostaDoNominatim {
  if (!Array.isArray(bruto)) {
    throw new ErroDoNominatim(
      'formato',
      'O Nominatim devolveu algo que não é uma lista de lugares.',
    );
  }
  const primeiro = bruto[0] as Record<string, unknown> | undefined;
  if (!primeiro) return { encontrado: false };

  const lat = numero(primeiro.lat);
  const lng = numero(primeiro.lon);
  if (lat === undefined || lng === undefined) return { encontrado: false };

  return {
    encontrado: true,
    lat,
    lng,
    addresstype: typeof primeiro.addresstype === 'string' ? primeiro.addresstype : undefined,
    osm_type: typeof primeiro.osm_type === 'string' ? primeiro.osm_type : undefined,
    osm_id: numero(primeiro.osm_id),
    osm_class: typeof primeiro.category === 'string' ? primeiro.category : undefined,
    display_name: typeof primeiro.display_name === 'string' ? primeiro.display_name : undefined,
    bbox: caixa(primeiro.boundingbox),
    licenca: typeof primeiro.licence === 'string' ? primeiro.licence : undefined,
  };
}

/**
 * Um lugar de uma busca com vários resultados (a busca no mapa da IA da Imova,
 * 23/11/2026). `bairro` e `cidade` saem de `address` (pedido com `addressdetails=1`).
 */
export type LugarDoNominatim = {
  nome: string;
  /** `addresstype` do OSM (road, village, suburb, city, postcode…). */
  tipo: string;
  /** "categoria:tipo" do OSM (amenity:school, shop:supermarket…), quando vem (27/11/2026). */
  categoria?: string;
  bairro: string | null;
  cidade: string | null;
  lat: number;
  lng: number;
};

export type RespostaComVarios = { lugares: LugarDoNominatim[]; licenca?: string };

const CHAVES_DE_BAIRRO = ['suburb', 'neighbourhood', 'quarter', 'village', 'hamlet', 'city_district'] as const;
const CHAVES_DE_CIDADE = ['city', 'town', 'municipality', 'village'] as const;

function primeiroTexto(objeto: Record<string, unknown>, chaves: readonly string[]): string | null {
  for (const chave of chaves) {
    const valor = objeto[chave];
    if (typeof valor === 'string' && valor.trim() !== '') return valor.trim();
  }
  return null;
}

/** Traduz até `limite` resultados. Lista vazia é resposta legítima. */
export function lerLugares(bruto: unknown, limite: number): RespostaComVarios {
  if (!Array.isArray(bruto)) {
    throw new ErroDoNominatim('formato', 'O Nominatim devolveu algo que não é uma lista de lugares.');
  }
  const lugares: LugarDoNominatim[] = [];
  let licenca: string | undefined;
  for (const item of bruto.slice(0, limite)) {
    const r = (item ?? {}) as Record<string, unknown>;
    const lat = numero(r.lat);
    const lng = numero(r.lon);
    if (lat === undefined || lng === undefined) continue;
    const endereco = (r.address ?? {}) as Record<string, unknown>;
    const exibido = typeof r.display_name === 'string' ? r.display_name : '';
    const nome = (typeof r.name === 'string' && r.name.trim() !== '' ? r.name : exibido.split(',')[0] ?? '').trim();
    // Sem `address` (ou sem cidade nele), a cidade é a parte antes do estado no nome
    // exibido: "Avenida X, Camurupim, Nísia Floresta, Rio Grande do Norte, …".
    const partes = exibido.split(',').map((p) => p.trim());
    const doEstado = partes.findIndex((p) => /rio grande do norte/i.test(p));
    const cidade =
      primeiroTexto(endereco, CHAVES_DE_CIDADE) ?? (doEstado > 0 && partes[doEstado - 1] !== nome ? partes[doEstado - 1] ?? null : null);
    const bairro =
      primeiroTexto(endereco, CHAVES_DE_BAIRRO) ??
      (doEstado > 1 && partes[doEstado - 2] !== nome ? partes[doEstado - 2] ?? null : null);
    lugares.push({
      nome: nome || exibido.slice(0, 80),
      tipo: typeof r.addresstype === 'string' ? r.addresstype : typeof r.type === 'string' ? r.type : 'lugar',
      ...(typeof r.category === 'string' && typeof r.type === 'string'
        ? { categoria: `${r.category}:${r.type}` }
        : {}),
      bairro: bairro !== null && bairro !== cidade ? bairro : null,
      cidade,
      lat,
      lng,
    });
    if (licenca === undefined && typeof r.licence === 'string') licenca = r.licence;
  }
  return licenca === undefined ? { lugares } : { lugares, licenca };
}

export type ClienteDoNominatim = {
  buscar(consulta: string): Promise<RespostaDoNominatim>;
  /**
   * Até `limite` lugares (o de `criarClienteDoNominatim`, 3 por padrão), na caixa
   * `viewbox` quando houver. Mesma fila e mesmo intervalo de `buscar`.
   */
  buscarVarios(
    consulta: string,
    /** Outra caixa e outro limite só para esta busca (a busca perto do imóvel, 27/11/2026). */
    opcoes?: { viewbox?: string; limite?: number },
  ): Promise<RespostaComVarios>;
};

/**
 * O Rio Grande do Norte, para a busca no mapa da IA da Imova: oeste, norte, leste, sul (a ordem
 * do `viewbox` do Nominatim). Com `bounded=1`, nada de fora entra.
 */
export const CAIXA_DO_RN = '-38.6,-4.8,-34.9,-7.0';

/**
 * Cliente serializado: a próxima pergunta só sai depois de `INTERVALO_MINIMO_MS`
 * do fim da anterior. O relógio é do processo, não da chamada — duas chamadas
 * feitas ao mesmo tempo entram em fila em vez de saírem juntas.
 */
export function criarClienteDoNominatim(argumentos: {
  baseUrl?: string;
  userAgent: string;
  intervaloMs?: number;
  fetchImpl?: typeof fetch;
  dormir?: (ms: number) => Promise<void>;
  /** Só para `buscarVarios`: quantos resultados (1 a 10; padrão 3). */
  limite?: number;
  /** Só para `buscarVarios`: a caixa onde procurar ("oeste,norte,leste,sul"), fechada. */
  viewbox?: string;
}): ClienteDoNominatim {
  if (argumentos.userAgent.trim() === '') {
    throw new ErroDoNominatim('formato', 'Sem User-Agent o Nominatim não é chamado (política de uso).');
  }
  const base = (argumentos.baseUrl ?? URL_PADRAO).replace(/\/+$/, '');
  const intervalo = argumentos.intervaloMs ?? INTERVALO_MINIMO_MS;
  const buscarNaRede = argumentos.fetchImpl ?? fetch;
  const dormir =
    argumentos.dormir ?? ((ms: number) => new Promise<void>((resolva) => setTimeout(resolva, ms)));

  let ultimoFim = 0;
  let fila: Promise<unknown> = Promise.resolve();

  const limite = Math.min(Math.max(Math.trunc(argumentos.limite ?? 3), 1), 10);
  const caixa = argumentos.viewbox === undefined ? '' : `&viewbox=${encodeURIComponent(argumentos.viewbox)}&bounded=1`;

  const pedir = async (url: string): Promise<unknown> => {
    const espera = intervalo - (Date.now() - ultimoFim);
    if (espera > 0) await dormir(espera);
    try {
      const resposta = await buscarNaRede(url, {
        headers: { 'User-Agent': argumentos.userAgent, 'Accept-Language': 'pt-BR' },
      });
      if (!resposta.ok) {
        throw new ErroDoNominatim('http', `O Nominatim respondeu HTTP ${resposta.status}.`);
      }
      return (await resposta.json()) as unknown;
    } catch (erro) {
      if (erro instanceof ErroDoNominatim) throw erro;
      throw new ErroDoNominatim(
        'rede',
        `Não deu para falar com o Nominatim: ${erro instanceof Error ? erro.message : String(erro)}`,
      );
    } finally {
      ultimoFim = Date.now();
    }
  };

  const varios = async (
    consulta: string,
    opcoes: { viewbox?: string; limite?: number } = {},
  ): Promise<RespostaComVarios> => {
    const lim =
      opcoes.limite === undefined ? limite : Math.min(Math.max(Math.trunc(opcoes.limite), 1), 10);
    const cx =
      opcoes.viewbox === undefined ? caixa : `&viewbox=${encodeURIComponent(opcoes.viewbox)}&bounded=1`;
    return lerLugares(
      await pedir(
        `${base}/search?format=jsonv2&limit=${lim}&countrycodes=br&addressdetails=1${cx}` +
          `&q=${encodeURIComponent(consulta)}`,
      ),
      lim,
    );
  };

  const uma = async (consulta: string): Promise<RespostaDoNominatim> => {
    const espera = intervalo - (Date.now() - ultimoFim);
    if (espera > 0) await dormir(espera);

    const url =
      `${base}/search?format=jsonv2&limit=1&countrycodes=br&addressdetails=1` +
      `&q=${encodeURIComponent(consulta)}`;

    try {
      const resposta = await buscarNaRede(url, {
        headers: { 'User-Agent': argumentos.userAgent, 'Accept-Language': 'pt-BR' },
      });
      if (!resposta.ok) {
        throw new ErroDoNominatim('http', `O Nominatim respondeu HTTP ${resposta.status}.`);
      }
      return lerResposta(await resposta.json());
    } catch (erro) {
      if (erro instanceof ErroDoNominatim) throw erro;
      throw new ErroDoNominatim(
        'rede',
        `Não deu para falar com o Nominatim: ${erro instanceof Error ? erro.message : String(erro)}`,
      );
    } finally {
      ultimoFim = Date.now();
    }
  };

  return {
    buscar(consulta) {
      const proxima = fila.then(
        () => uma(consulta),
        () => uma(consulta),
      );
      fila = proxima.catch(() => undefined);
      return proxima;
    },
    buscarVarios(consulta, opcoes) {
      const proxima = fila.then(
        () => varios(consulta, opcoes),
        () => varios(consulta, opcoes),
      );
      fila = proxima.catch(() => undefined);
      return proxima;
    },
  };
}
