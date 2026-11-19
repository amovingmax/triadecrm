/**
 * FORA DA RODADA desde 18/11/2026 (revisão): nenhuma fonte da lista aponta
 * para este coletor (a migração 20261118219000 deixa `osm-overpass` sem
 * coletor). Três motivos: (1) o robots.txt do overpass-api.de fecha /api/
 * ("Disallow: /api/"), e o navegador respeita o robots, então toda rodada
 * pararia com erro; (2) `lerPontosParaMedir` só lê ponto "exata" ou
 * "esquina", e os sites dão ponto "aproximada"; (3) os imóveis da Imova não
 * têm coordenada no CRM (a tabela `anuncios` não tem lat/lng). O código fica
 * para quando o dono escolher a fonte: o extrato da Geofabrik (osm-geofabrik,
 * PERMITIDA) lido na máquina, ou um Overpass próprio; e quando a carteira
 * tiver coordenada com precisão no banco. Pendência no CHANGELOG.
 *
 * Proximidades pelo OpenStreetMap (Overpass, `osm-overpass`): a distância em
 * linha reta de cada ponto até a praia (linha de costa), escola, supermercado,
 * hospital, posto de saúde, shopping e via principal, gravada em
 * `mercado_proximidades`. Porte de `coletar/proximidades.mjs`.
 *
 * Política de uso respeitada (auditoria de 18/11/2026):
 *  - uma consulta por área, com todas as categorias juntas; uma por vez, com
 *    o intervalo da lista (10 s) e o teto dela (30 por rodada); para no 429;
 *  - menos de 10 MB por rodada (`MAX_BYTES`);
 *  - só o overpass-api.de (o espelho reserva nasce desligado na lista);
 *  - o nome e o id de quem editou o mapa nunca são guardados; ficam a versão e
 *    a data do elemento; atribuição ODbL em cada linha (padrão da tabela).
 *
 * Só mede ponto "exata" ou "esquina" (a tabela recusa outro): ponto de rua, de
 * bairro ou aproximado não vira distância. Hoje a carteira não tem ponto no
 * CRM e os sites dão ponto "aproximada", então a rodada pode terminar sem
 * consulta nenhuma, e diz isso.
 */
import { Impressao } from '../lote';
import type {
  Coletor,
  ContextoDoColetor,
  LinhaProximidade,
  PontoParaMedir,
  ResultadoDoColetor,
} from '../tipos';

const MARGEM_M = 2_500;
const AREA_MAX_KM2 = 500;
const MAX_BYTES = 9.5e6;
const KY = 110_574;

type Caixa = { s: number; o: number; n: number; l: number };

const kx = (lat: number): number => 111_320 * Math.cos((lat * Math.PI) / 180);
export const distancia = (p: [number, number], q: [number, number]): number =>
  Math.hypot((q[0] - p[0]) * kx(p[1]), (q[1] - p[1]) * KY);

export function distanciaDaLinha(p: [number, number], linha: Array<[number, number]>): number {
  if (linha.length === 1 && linha[0]) return distancia(p, linha[0]);
  let melhor = Number.POSITIVE_INFINITY;
  const k = kx(p[1]);
  for (let i = 0; i < linha.length - 1; i += 1) {
    const a = linha[i];
    const b = linha[i + 1];
    if (!a || !b) continue;
    const ax = (a[0] - p[0]) * k;
    const ay = (a[1] - p[1]) * KY;
    const dx = (b[0] - p[0]) * k - ax;
    const dy = (b[1] - p[1]) * KY - ay;
    const L = dx * dx + dy * dy;
    const t = L ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / L)) : 0;
    melhor = Math.min(melhor, Math.hypot(ax + t * dx, ay + t * dy));
  }
  return melhor;
}

export function caixaDe(pts: ReadonlyArray<[number, number]>, margem = MARGEM_M): Caixa {
  const lat = pts.map((p) => p[1]);
  const lng = pts.map((p) => p[0]);
  const lat0 = (Math.min(...lat) + Math.max(...lat)) / 2;
  const dLat = margem / KY;
  const dLng = margem / kx(lat0);
  const r4 = (x: number): number => Math.round(x * 1e4) / 1e4;
  return {
    s: r4(Math.min(...lat) - dLat),
    o: r4(Math.min(...lng) - dLng),
    n: r4(Math.max(...lat) + dLat),
    l: r4(Math.max(...lng) + dLng),
  };
}
const areaKm2 = (c: Caixa): number =>
  ((c.n - c.s) * KY * ((c.l - c.o) * kx((c.n + c.s) / 2))) / 1e6;
const uniao = (a: Caixa, b: Caixa): Caixa => ({
  s: Math.min(a.s, b.s),
  o: Math.min(a.o, b.o),
  n: Math.max(a.n, b.n),
  l: Math.max(a.l, b.l),
});
const cruza = (a: Caixa, b: Caixa): boolean => a.s <= b.n && b.s <= a.n && a.o <= b.l && b.o <= a.l;

/** Junta os pontos em áreas de consulta (uma por região, unidas quando se cruzam, até 500 km²). */
export function areasDeConsulta(
  pontos: readonly PontoParaMedir[],
): Array<{ caixa: Caixa; pontos: PontoParaMedir[] }> {
  const porRegiao = new Map<string, PontoParaMedir[]>();
  for (const p of pontos) {
    const k = p.regiao_id ?? `sem-regiao-${Math.round(p.lat * 10)}-${Math.round(p.lng * 10)}`;
    porRegiao.set(k, [...(porRegiao.get(k) ?? []), p]);
  }
  const areas = [...porRegiao.values()].map((ps) => ({
    caixa: caixaDe(ps.map((p) => [p.lng, p.lat] as [number, number])),
    pontos: ps,
  }));
  let mudou = true;
  while (mudou) {
    mudou = false;
    for (let i = 0; i < areas.length && !mudou; i += 1) {
      for (let j = i + 1; j < areas.length && !mudou; j += 1) {
        const a = areas[i];
        const b = areas[j];
        if (!a || !b) continue;
        const u = uniao(a.caixa, b.caixa);
        if (cruza(a.caixa, b.caixa) && areaKm2(u) <= AREA_MAX_KM2) {
          areas[i] = { caixa: u, pontos: [...a.pontos, ...b.pontos] };
          areas.splice(j, 1);
          mudou = true;
        }
      }
    }
  }
  return areas;
}

export const consultaOverpass = (
  c: Caixa,
): string => `[out:json][timeout:180][bbox:${c.s},${c.o},${c.n},${c.l}];
(
  nwr["amenity"~"^(school|hospital|clinic)$"];
  nwr["healthcare"~"^(centre|hospital)$"];
  nwr["shop"~"^(supermarket|mall)$"];
);
out center meta;
(
  way["highway"~"^(trunk|primary|secondary)$"];
  way["natural"="coastline"];
  nwr["natural"="beach"];
);
out geom meta;`;

type Categoria = LinhaProximidade['categoria'];

export function categoriaDe(t: Record<string, string> | undefined): [Categoria, string] | null {
  if (!t) return null;
  if (t.amenity === 'school') return ['escola', 'amenity=school'];
  if (t.amenity === 'hospital') return ['hospital', 'amenity=hospital'];
  if (t.healthcare === 'hospital') return ['hospital', 'healthcare=hospital'];
  if (t.amenity === 'clinic') return ['posto_saude', 'amenity=clinic'];
  if (t.healthcare === 'centre') return ['posto_saude', 'healthcare=centre'];
  if (t.shop === 'supermarket') return ['mercado', 'shop=supermarket'];
  if (t.shop === 'mall') return ['shopping', 'shop=mall'];
  if (/^(trunk|primary|secondary)$/.test(t.highway ?? ''))
    return ['avenida', `highway=${t.highway ?? ''}`];
  if (t.natural === 'coastline') return ['costa', 'natural=coastline'];
  if (t.natural === 'beach') return ['praia', 'natural=beach'];
  return null;
}

export interface ElementoDoMapa {
  type: 'node' | 'way' | 'relation';
  id: number;
  version?: number;
  timestamp?: string;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  geometry?: Array<{ lat: number; lon: number } | null>;
  members?: Array<{ geometry?: Array<{ lat: number; lon: number } | null> }>;
  tags?: Record<string, string>;
}

/** O que está perto de cada ponto: o mais perto de cada categoria (com nome, se houver), dentro do alcance da consulta. */
export function medir(
  ponto: PontoParaMedir,
  elementos: readonly ElementoDoMapa[],
  caixa: Caixa,
  dataDoMapa: string,
): LinhaProximidade[] {
  const p: [number, number] = [ponto.lng, ponto.lat];
  // Alcance: até onde a consulta enxerga em volta do ponto. Além disso, pode haver um mais perto fora da área.
  const alcance = Math.min(
    distancia(p, [caixa.o, p[1]]),
    distancia(p, [caixa.l, p[1]]),
    distancia(p, [p[0], caixa.s]),
    distancia(p, [p[0], caixa.n]),
  );
  const melhores = new Map<
    Categoria,
    { d: number; e: ElementoDoMapa; etiqueta: string; centro: [number, number] }
  >();
  for (const e of elementos) {
    const cat = categoriaDe(e.tags);
    if (!cat) continue;
    const linhas: Array<Array<[number, number]>> = [];
    if (e.geometry)
      linhas.push(
        e.geometry.filter((x): x is { lat: number; lon: number } => !!x).map((x) => [x.lon, x.lat]),
      );
    for (const m of e.members ?? [])
      if (m.geometry)
        linhas.push(
          m.geometry
            .filter((x): x is { lat: number; lon: number } => !!x)
            .map((x) => [x.lon, x.lat]),
        );
    let centro: [number, number] | null =
      e.type === 'node' && e.lon !== undefined && e.lat !== undefined
        ? [e.lon, e.lat]
        : e.center
          ? [e.center.lon, e.center.lat]
          : null;
    const usaLinha =
      ['avenida', 'costa', 'praia'].includes(cat[0]) && linhas.some((l) => l.length > 0);
    if (!centro && linhas.length) {
      const g = linhas.flat();
      if (g.length)
        centro = [
          g.reduce((s, x) => s + x[0], 0) / g.length,
          g.reduce((s, x) => s + x[1], 0) / g.length,
        ];
    }
    if (!centro) continue;
    const d = usaLinha
      ? Math.min(...linhas.filter((l) => l.length > 0).map((l) => distanciaDaLinha(p, l)))
      : distancia(p, centro);
    if (d > alcance) continue;
    // Prefere o ponto com nome (sem nome não vai à frase); a costa não tem nome.
    const atual = melhores.get(cat[0]);
    const temNome = !!e.tags?.name;
    const atualTemNome = !!atual?.e.tags?.name;
    const melhor =
      !atual ||
      (cat[0] !== 'costa' && temNome && !atualTemNome) ||
      ((temNome === atualTemNome || cat[0] === 'costa') && d < atual.d);
    if (melhor) melhores.set(cat[0], { d, e, etiqueta: cat[1], centro });
  }
  return [...melhores.entries()].map(([categoria, x]) => ({
    ...(ponto.imovel_codigo
      ? { imovel_codigo: ponto.imovel_codigo }
      : { mercado_anuncio_id: ponto.mercado_anuncio_id ?? null }),
    categoria,
    osm_tipo: x.e.type,
    osm_id: x.e.id,
    osm_versao: x.e.version ?? null,
    osm_timestamp: x.e.timestamp ?? null,
    etiqueta: x.etiqueta,
    nome: x.e.tags?.name ?? (categoria === 'avenida' ? (x.e.tags?.ref ?? null) : null),
    lat: Math.round(x.centro[1] * 1e6) / 1e6,
    lng: Math.round(x.centro[0] * 1e6) / 1e6,
    distancia_m: Math.round(x.d),
    precisao_ponto: ponto.precisao,
    url: `https://www.openstreetmap.org/${x.e.type}/${x.e.id}`,
    data_dado: dataDoMapa,
  }));
}

export const coletorProximidades: Coletor = {
  chave: 'proximidades',
  maxPedidosPadrao: 30,
  intervaloMinimoMs: 10_000,
  caminhoDeTeste: '/api/interpreter',
  async coletar(ctx: ContextoDoColetor): Promise<ResultadoDoColetor> {
    const impressao = new Impressao();
    const erros: string[] = [];
    const pontos = ctx.pontos ? await ctx.pontos() : [];
    if (pontos.length === 0) {
      return {
        completa: true,
        hashBruto: null,
        detalhes: {
          pontos: 0,
          consultas: 0,
          aviso:
            'nenhum ponto exato ou de esquina para medir (a carteira não tem ponto no CRM e os sites dão ponto aproximado): nada foi consultado',
        },
        erros,
      };
    }
    const servidor = ctx.fonte.url ?? 'https://overpass-api.de/api/interpreter';
    const areas = areasDeConsulta(pontos);
    let bytes = 0;
    let consultas = 0;
    let n = 0;
    for (const a of areas) {
      if (bytes > MAX_BYTES || ctx.navegador.parada) break;
      const r = await ctx.navegador.pagina(servidor, {
        metodo: 'POST',
        corpo: new URLSearchParams({ data: consultaOverpass(a.caixa) }).toString(),
        cabecalhos: { 'Content-Type': 'application/x-www-form-urlencoded' },
        aceitar: 'application/json',
        tempo: 200_000,
        tentativas: 0,
      });
      if (!r?.texto) {
        erros.push(
          `área ${JSON.stringify(a.caixa)}: ${r ? `HTTP ${r.status}` : (ctx.navegador.parada ?? 'robots fecha')}`,
        );
        continue;
      }
      consultas += 1;
      bytes += r.texto.length;
      let d: { elements?: ElementoDoMapa[]; osm3s?: { timestamp_osm_base?: string } };
      try {
        d = JSON.parse(r.texto) as typeof d;
      } catch {
        erros.push('resposta do Overpass não é JSON');
        continue;
      }
      if (!Array.isArray(d.elements)) {
        erros.push('resposta do Overpass sem elements');
        continue;
      }
      // Quem editou o mapa não é dado nosso: sai antes de qualquer uso.
      for (const e of d.elements as Array<
        ElementoDoMapa & { user?: unknown; uid?: unknown; changeset?: unknown }
      >) {
        delete e.user;
        delete e.uid;
        delete e.changeset;
      }
      impressao.somar(r.sha256 ?? '');
      const dataDoMapa = (d.osm3s?.timestamp_osm_base ?? '').slice(0, 10) || ctx.dia;
      const linhas = a.pontos.flatMap((p) => medir(p, d.elements ?? [], a.caixa, dataDoMapa));
      if (linhas.length > 0) n += await ctx.gravador.proximidades(linhas);
    }
    return {
      completa: erros.length === 0 && ctx.navegador.parada === null,
      hashBruto: impressao.fechar(),
      detalhes: {
        pontos: pontos.length,
        areas: areas.length,
        consultas,
        bytes,
        gravados: n,
        pedidos: ctx.navegador.pedidos,
        parada: ctx.navegador.parada,
      },
      erros,
    };
  },
};
