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

export type ClienteDoNominatim = {
  buscar(consulta: string): Promise<RespostaDoNominatim>;
};

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
}): ClienteDoNominatim {
  const base = (argumentos.baseUrl ?? URL_PADRAO).replace(/\/+$/, '');
  const intervalo = argumentos.intervaloMs ?? INTERVALO_MINIMO_MS;
  const buscarNaRede = argumentos.fetchImpl ?? fetch;
  const dormir =
    argumentos.dormir ?? ((ms: number) => new Promise<void>((resolva) => setTimeout(resolva, ms)));

  let ultimoFim = 0;
  let fila: Promise<unknown> = Promise.resolve();

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
  };
}
