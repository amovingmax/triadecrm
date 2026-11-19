/**
 * Monta o item que vai a `public.mercado_anuncios_registrar` a partir dos
 * campos FACTUAIS lidos numa fonte (preço, áreas, quartos, vagas, bairro,
 * link). Nunca foto, texto do anúncio, nome ou telefone de corretor: condição
 * da auditoria para as fontes CONDICIONAIS. Porte de
 * `coletar/anuncios/_site-anuncio.mjs`, com as correções da verificação de
 * 18/11 (`_redesign/pipeline/relatorio-coleta-2026-11-18.md`, §7):
 *
 *  - #5: "Loteamento" no tipo da fonte é lote em condomínio (atributo
 *    `condominio_fechado`, que o banco usa no `sub`);
 *  - #7: em casa, a área construída vem antes da "útil" (`areaConstruida`);
 *    útil maior que a total fica para o banco marcar (`areas_trocadas`) e usar
 *    a menor;
 *  - repasse, ágio, cota, fração e permuta não entram: não são o preço do
 *    imóvel inteiro.
 */
import { urlBloqueada } from './bloqueio';
import type { Regioes } from './regioes';
import type { ItemAnuncio } from './tipos';
import {
  ehRepasseOuCota,
  limparTitulo,
  logradouroDe,
  sinaisDe,
  tipoDe,
  TIPOS_CONSTRUIDOS,
} from './texto';

export interface CamposLidos {
  id_externo: string;
  modo: 'venda' | 'aluguel';
  tipoTexto?: string | null;
  titulo?: string | null;
  preco?: number | null;
  area_util?: number | null;
  area_total?: number | null;
  /** Quando a fonte dá uma área só: vai para o lote (terreno) ou para a útil (construído). */
  area_unica?: number | null;
  /** Casa: a área construída (#7 da verificação: vem antes da "útil"). */
  area_construida?: number | null;
  quartos?: number | null;
  suites?: number | null;
  banheiros?: number | null;
  vagas?: number | null;
  condominio?: number | null;
  bairro?: string | null;
  cidade?: string | null;
  logradouro?: string | null;
  lat?: number | null;
  lng?: number | null;
  url: string | null;
  data_dado?: string | null;
  hash_bruto?: string | null;
  consulta_id?: string | null;
  consulta_completa?: boolean;
  marcas?: string[];
  /** Os campos factuais como vieram (o banco guarda só os da régua `bruto_campos`). */
  bruto?: Record<string, unknown>;
}

export type Recusa = { recusa: string };

const positivo = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null;
const inteiro = (v: unknown): number | null => {
  const n = positivo(v);
  return n === null ? null : Math.round(n);
};
const inteiroOuZero = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) && v >= 0 && v < 100 ? Math.round(v) : null;

/** Link canônico: sem ?…, sem #… e sem barra no fim (igual a `app.mercado_url_canonica`). */
export function urlCanonica(u: string | null | undefined): string | null {
  if (!u) return null;
  try {
    const x = new URL(u);
    x.hash = '';
    x.search = '';
    return `${x.protocol}//${x.host.toLowerCase()}${x.pathname.replace(/\/+$/, '')}`;
  } catch {
    return null;
  }
}

/** Coordenada dentro do Rio Grande do Norte e arredores, ou nada. */
function coordenada(lat: unknown, lng: unknown): { lat: number; lng: number } | null {
  const a = typeof lat === 'number' ? lat : Number(lat);
  const o = typeof lng === 'number' ? lng : Number(lng);
  if (!Number.isFinite(a) || !Number.isFinite(o)) return null;
  if (a < -7.5 || a > -4.5 || o < -38.8 || o > -34.5) return null;
  return { lat: Math.round(a * 1e6) / 1e6, lng: Math.round(o * 1e6) / 1e6 };
}

export function anuncioDeSite(o: CamposLidos, regioes: Regioes): ItemAnuncio | Recusa {
  const tipo = tipoDe(o.tipoTexto ?? '', o.titulo ?? '') ?? tipoDe(o.titulo ?? '', o.titulo ?? '');
  if (!tipo || tipo === 'rural' || tipo === 'outro')
    return { recusa: `tipo fora do estudo (${o.tipoTexto ?? '?'})` };
  const url = urlCanonica(o.url);
  if (!url) return { recusa: 'sem link' };
  if (urlBloqueada(url)) return { recusa: 'link de domínio proibido' };
  if (ehRepasseOuCota(o.titulo)) return { recusa: 'repasse, ágio, cota ou fração' };
  const reg = regioes.regiaoDe({
    cidade: o.cidade,
    bairro: o.bairro,
    texto: `${o.titulo ?? ''} ${o.bairro ?? ''}`,
  });
  if (!reg) return { recusa: o.cidade ? 'fora das regiões do estudo' : 'sem cidade' };

  const titulo = limparTitulo(o.titulo);
  const sinais = sinaisDe(o.titulo ?? '', o.tipoTexto ?? '');
  const atributos: Record<string, boolean> = { ...sinais };
  if (tipo === 'casa_condominio') atributos.condominio_fechado = true;

  let areaUtil = positivo(o.area_construida) ?? positivo(o.area_util);
  let areaTotal = positivo(o.area_total);
  const unica = positivo(o.area_unica);
  if (unica !== null) {
    if (tipo === 'terreno') areaTotal = areaTotal ?? unica;
    else areaUtil = areaUtil ?? unica;
  }
  if (tipo === 'terreno') {
    areaTotal = areaTotal ?? areaUtil;
    areaUtil = null;
  } else if (!TIPOS_CONSTRUIDOS.has(tipo)) {
    areaUtil = null;
  }

  const marcas = new Set(o.marcas ?? []);
  if (reg.porTitulo) marcas.add('regiao_pelo_titulo');
  const ponto = coordenada(o.lat, o.lng);
  const logradouro = o.logradouro
    ? String(o.logradouro)
        .replace(/,?\s*\d+.*$/, '')
        .trim() || null
    : logradouroDe({ titulo, cidade: o.cidade, bairro: o.bairro });

  return {
    id_externo: String(o.id_externo),
    url,
    modo: o.modo,
    tipo,
    subtipo: o.tipoTexto ? String(o.tipoTexto).slice(0, 80) : null,
    titulo,
    preco: positivo(o.preco) !== null ? Math.round(o.preco as number) : null,
    area_util: areaUtil,
    area_total: areaTotal,
    quartos: inteiroOuZero(o.quartos),
    suites: inteiroOuZero(o.suites),
    banheiros: inteiroOuZero(o.banheiros),
    vagas: inteiroOuZero(o.vagas),
    valor_condominio: inteiro(o.condominio),
    atributos,
    bairro: o.bairro ? String(o.bairro).slice(0, 120) : null,
    cidade: o.cidade ? String(o.cidade).slice(0, 120) : null,
    logradouro: logradouro ? logradouro.slice(0, 200) : null,
    regiao_id: reg.regiao,
    // Ponto dado pelo site: nunca se sabe se é o do imóvel ou o do bairro.
    // Fica "aproximada" e não serve para distância nem para identidade.
    lat: ponto?.lat ?? null,
    lng: ponto?.lng ?? null,
    loc_precisao: ponto ? 'aproximada' : null,
    consulta_id: o.consulta_id ?? null,
    consulta_completa: o.consulta_completa ?? true,
    data_dado: o.data_dado ?? null,
    hash_bruto: o.hash_bruto ?? null,
    marcas: [...marcas],
    bruto: o.bruto ?? {},
  };
}

export const ehRecusa = (x: ItemAnuncio | Recusa): x is Recusa => 'recusa' in x;

/** Conta recusas por motivo (sem o detalhe entre parênteses). */
export function contarRecusa(recusas: Record<string, number>, motivo: string): void {
  const k = motivo.replace(/\s*\(.*$/, '');
  recusas[k] = (recusas[k] ?? 0) + 1;
}
