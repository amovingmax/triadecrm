/**
 * Do banco de mercado à base do motor: o que `public.mercado_motor_entrada()` e
 * `public.mercado_motor_anuncios()` (migração 20261127150000) devolvem vira a
 * base B que o motor do protótipo recebia de `montarBase()`.
 *
 * Portes do protótipo, com as mesmas regras:
 *   - os anúncios: `grupoDe`, `areaRef` e `prepararAnuncios` (js/00-base.js) e
 *     o classificador comercial (js/16-comercial.js);
 *   - a carteira: `unidadesDa` e `avaliarUnidade` (js/20-carteira.js), sem o
 *     modelo de preço (a previsão fica nula);
 *   - as macrorregiões: `mpMacro` (js/10-modelo-preco.js).
 * E o que o protótipo lia de arquivo e o CRM guarda em tabela:
 *   - o Censo (`mercado_ibge`) vira o perfil de cada região (`perfis.json`);
 *   - os alvarás do GeoMapas (`mercado_indices`, séries geomapas-alvara-*)
 *     viram `construcao.por_bairro`; o FipeZAP de Natal, `series.json`.
 *
 * O que o CRM ainda não tem e o motor deixa de usar (sem inventar): o modelo
 * de preço (preço P1 e atributo A1 não saem), a tabela inteira da Corrida dos
 * Bairros (o m² de apartamento C3 não sai), a procura por imóvel (só o
 * bloqueio G1) e o contexto de mercado (só o bloqueio S1 do bairro).
 */
import { ajustarModelos, baseDoGrupo } from './modelo-preco';
import { ARG_CADERNO } from './caderno';
import { semAc, temNum } from './estatistica';
import { FICHAS_DO_CADERNO, type FichaCurada, type LoteDaFicha } from './fichas';
import { ALVO_DO_PROTOTIPO } from './motor';
import type {
  AlvarasDoBairro,
  AnuncioDaBase,
  BaseDoMotor,
  FichaDaBase,
  PerfilDaRegiao,
  RegiaoDaBase,
  SerieFipe,
  UnidadeDaCarteira,
} from './tipos';

/* ------------------------------------------------------------------ */
/* O que o banco devolve                                              */
/* ------------------------------------------------------------------ */
export interface LinhaDaCarteira {
  codigo: string;
  origem?: string;
  anuncio_id?: string | null;
  tipo: string;
  sub?: string | null;
  negocio?: string | null;
  preco_venda?: number | null;
  preco_aluguel?: number | null;
  area_util?: number | null;
  area_total?: number | null;
  area_ref?: number | null;
  quartos?: number | null;
  suites?: number | null;
  vagas?: number | null;
  banheiros?: number | null;
  bairro?: string | null;
  cidade?: string | null;
  logradouro?: string | null;
  regiao_id?: string | null;
  situacao?: string | null;
  titulo?: string | null;
  caracteristicas?: string[];
}
export interface RegiaoDoBanco {
  id: string;
  nome: string;
  curto?: string;
  cidade: string;
  papel?: string;
  abrangencia?: string;
  lat?: number | null;
  lng?: number | null;
  vizinhos: Array<{ id: string; km: number }>;
  litoral?: boolean;
}
export interface LinhaDoCenso {
  escopo: string;
  nome: string;
  municipio: string;
  regiao_id?: string | null;
  ano?: number;
  populacao?: number | null;
  crescimento_2010_2022_pct?: number | null;
  renda_media_responsavel?: number | null;
  renda_mediana_responsavel?: number | null;
  pct_uso_ocasional?: number | null;
  dados?: Record<string, unknown> | null;
  definicao?: string | null;
}
export interface LinhaDeSerie {
  serie: string;
  mes: string;
  valor: number;
  nome?: string;
  local?: string | null;
  regiao_id?: string | null;
  amostra?: number | null;
  fonte?: string;
  url?: string;
}
export interface AnuncioDoBanco {
  id: string;
  fonte: string;
  id_externo: string;
  tipo: string;
  subtipo?: string | null;
  sub?: string | null;
  titulo?: string | null;
  preco: number | null;
  area_util?: number | null;
  area_total?: number | null;
  quartos?: number | null;
  suites?: number | null;
  banheiros?: number | null;
  vagas?: number | null;
  valor_condominio?: number | null;
  atributos?: Record<string, unknown> | null;
  bairro?: string | null;
  cidade?: string | null;
  logradouro?: string | null;
  regiao_id: string | null;
  origem?: string;
  visto_em?: string | null;
  possivel_mesmo_imovel?: boolean;
}
export interface EntradaDoBanco {
  hoje: string;
  rodada: string | null;
  carteira: LinhaDaCarteira[];
  regioes: RegiaoDoBanco[];
  ibge: LinhaDoCenso[];
  indices: LinhaDeSerie[];
  anuncios: AnuncioDoBanco[];
}

/* ------------------------------------------------------------------ */
/* Os grupos de comparação (js/00-base.js e js/16-comercial.js)       */
/* ------------------------------------------------------------------ */
interface Classificavel {
  tipo?: unknown;
  titulo?: unknown;
  subtipo?: unknown;
  area_util?: unknown;
  area_total?: unknown;
  comercial?: unknown;
  condominio_fechado?: unknown;
}
const areaCom = (a: Classificavel): number | null =>
  temNum(a.area_util) && a.area_util > 0
    ? a.area_util
    : temNum(a.area_total) && a.area_total > 0
      ? a.area_total
      : null;
const RE_GALPAO = /galp|barrac|deposito|armaz|logist/;
const RE_TIPO_COM = /galp|barrac|deposito|armaz|logist|^sala|^conj|^loja|^ponto|comerc/;
/** O classificador comercial do protótipo: {g: grupo ou null (fora das contas), m: motivo} ou null. */
export function tipoComercial(a: Classificavel): { g: string | null; m: string } | null {
  const t = semAc(a.tipo);
  const tit = semAc(a.titulo);
  const ar = areaCom(a);
  if (/terreno|lote/.test(t)) return null;
  const carteiraCasa = a.comercial === true && /^(casa|sobrado|predio|imovel)/.test(t);
  if (!carteiraCasa && !RE_TIPO_COM.test(t)) return null;
  if (/hotel|pousada|hostel|\bflats?\b|resort/.test(tit))
    return { g: null, m: 'hotel ou pousada: fora das contas' };
  if (carteiraCasa) return { g: 'loja_ponto', m: 'casa com ponto comercial (ficha da carteira)' };
  const temComercio =
    /\b(comercial|comerciais|comercio|loja|lojas|ponto|restaurante|bar|lanchonete|clinica|escritorio|empresa|empresarial|negocio|galpao|sala|salas)\b/.test(
      tit,
    );
  if (/\b(predio|edificio)\b/.test(tit) && !/\b(loja|lojas|ponto|sala|salas)\b/.test(tit))
    return { g: null, m: 'prédio inteiro: fora das contas' };
  const sub = semAc(a.subtipo);
  const doPortal =
    /comercial|comercio|loja|sala|galp|barrac|deposito/.test(sub) ||
    /(casa|sobrado) comercial/.test(t);
  if (
    !temComercio &&
    !doPortal &&
    /\b(casa|casas|duplex|mansao|condominio|apartamento|dormitorios?|quartos?|chales?|suites?)\b/.test(
      tit,
    )
  )
    return { g: null, m: 'residência anunciada como comercial: fora das contas' };
  if (/(casa|sobrado).*comercial/.test(sub) && !/^(sala|conj)/.test(t) && !RE_GALPAO.test(t))
    return /\bsala\b/.test(tit) && temNum(ar) && ar <= 150
      ? { g: 'sala', m: 'casa comercial com título de sala' }
      : { g: 'loja_ponto', m: 'casa comercial (categoria do portal)' };
  if (RE_GALPAO.test(t)) return { g: 'galpao', m: 'tipo do anúncio' };
  if (/^(sala|conj)/.test(t))
    return /\b(loja|ponto|restaurante)\b/.test(tit)
      ? { g: 'loja_ponto', m: 'sala com título de loja ou restaurante' }
      : { g: 'sala', m: 'tipo do anúncio' };
  if (/^(loja|ponto)/.test(t))
    return RE_GALPAO.test(tit) && !/\b(loja|ponto)\b/.test(tit)
      ? { g: 'galpao', m: 'loja com título de galpão' }
      : { g: 'loja_ponto', m: 'tipo do anúncio' };
  if (/(casa|sobrado) comercial/.test(t))
    return /\bsala\b/.test(tit) && temNum(ar) && ar <= 150
      ? { g: 'sala', m: 'casa comercial com título de sala' }
      : { g: 'loja_ponto', m: 'casa comercial' };
  if (RE_GALPAO.test(tit)) return { g: 'galpao', m: 'título' };
  if (/\bsala\b/.test(tit))
    return temNum(ar) && ar > 200
      ? { g: 'loja_ponto', m: 'título diz sala, mas tem mais de 200 m²' }
      : { g: 'sala', m: 'título' };
  if (temComercio) return { g: 'loja_ponto', m: 'título' };
  if (temNum(ar))
    return ar <= 60
      ? { g: 'sala', m: 'sem pista no título; até 60 m²' }
      : { g: 'loja_ponto', m: 'sem pista no título; acima de 60 m²' };
  return { g: null, m: 'sem pista no título nem área' };
}

const BASE_DO_GRUPO: Record<string, string> = {
  terreno_todos: 'terreno',
  terreno_p: 'terreno',
  terreno_m: 'terreno',
  terreno_g: 'terreno',
  casa: 'construido',
  casa_condominio: 'construido',
  apartamento: 'construido',
  loja_ponto: 'comercial',
  sala: 'comercial',
  galpao: 'comercial',
};
export function grupoDe(a: Classificavel): string | null {
  const c = tipoComercial(a);
  if (c?.g) return c.g;
  const t = semAc(a.tipo);
  if (/terreno|lote/.test(t)) {
    const ar = (a.area_total ?? a.area_util) as unknown;
    if (!temNum(ar)) return null;
    return ar <= 500 ? 'terreno_p' : ar <= 2000 ? 'terreno_m' : 'terreno_g';
  }
  if (/condom/.test(t)) return 'casa_condominio';
  if (/^casa|sobrado/.test(t)) return a.condominio_fechado ? 'casa_condominio' : 'casa';
  if (/apart|flat|cobertura/.test(t)) return 'apartamento';
  return null;
}
export function areaRef(a: Classificavel): number | null {
  const g = grupoDe(a);
  if (!g) return null;
  const v = BASE_DO_GRUPO[g] === 'terreno' ? (a.area_total ?? a.area_util) : (a.area_util ?? null);
  return temNum(v) ? v : null;
}

/** Os anúncios do banco, limpos como o protótipo limpava (`prepararAnuncios`, modo venda). */
export function prepararAnuncios(lista: AnuncioDoBanco[]): AnuncioDaBase[] {
  const vistos = new Set<string>();
  const out: AnuncioDaBase[] = [];
  for (const x of lista) {
    if (!x.regiao_id) continue;
    const at = x.atributos ?? {};
    const sim = (k: string): boolean | null =>
      typeof at[k] === 'boolean' ? (at[k] as boolean) : null;
    const a: AnuncioDaBase = {
      id: `${x.fonte}:${x.id_externo}`,
      fonte: x.fonte,
      regiao: x.regiao_id,
      grupo: '',
      tipo: x.tipo,
      subtipo: x.subtipo ?? null,
      area: 0,
      area_total: x.area_total ?? null,
      area_util: x.area_util ?? null,
      preco: x.preco as number,
      m2: 0,
      quartos: x.quartos ?? null,
      suites: x.suites ?? null,
      banheiros: x.banheiros ?? null,
      vagas: x.vagas ?? null,
      esquina: sim('esquina'),
      frente_mar: sim('frente_mar'),
      vista_mar: sim('vista_mar'),
      condominio_fechado: sim('condominio_fechado'),
      frente_avenida: sim('frente_avenida'),
      lazer: sim('lazer'),
      valor_condominio: x.valor_condominio ?? null,
      bairro: x.bairro ?? null,
      cidade: x.cidade ?? null,
      logradouro: x.logradouro ?? null,
      titulo: x.titulo ?? null,
      usado_nas_medias: true,
      ativo: true,
      // Só do levantamento manual (origem manual): fica de fora da conta "sem os manuais" (R3).
      ultima_coleta_auto: x.origem === 'manual' ? null : (x.visto_em ?? null),
      dist_praia_m: null,
    };
    const g = grupoDe(a);
    const ar = areaRef(a);
    if (!g || !temNum(a.preco) || !temNum(ar) || ar < 8) continue;
    if (a.preco < 10000) continue;
    a.grupo = g;
    a.area = ar;
    a.m2 = a.preco / ar;
    if (a.m2 < 15 || a.m2 > 60000) continue;
    const k2 = `${a.regiao}|${g}|venda|${Math.round(a.preco)}|${Math.round(ar)}`;
    if (vistos.has(k2)) continue;
    vistos.add(k2);
    out.push(a);
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* As macrorregiões (js/10-modelo-preco.js)                           */
/* ------------------------------------------------------------------ */
const MP_MACROS = [
  { id: 'extremoz', chaves: ['extremoz', 'genipabu', 'gracandu', 'pitangui'] },
  { id: 'pipa', chaves: ['pipa', 'tibau do sul', 'cacimbinhas'] },
  {
    id: 'litoral-sul',
    chaves: [
      'pirangi',
      'cotovelo',
      'tabatinga',
      'buzios',
      'barreta',
      'camurupim',
      'pium',
      'distrito litoral',
      'nisia floresta',
    ],
  },
  {
    id: 'parnamirim-urbano',
    chaves: ['nova parnamirim', 'bonor', 'parque das nacoes', 'emaus', 'parnamirim'],
  },
  {
    id: 'natal-sul',
    chaves: [
      'capim macio',
      'cidade jardim',
      'ponta negra',
      'neopolis',
      'candelaria',
      'satelite',
      'pitimbu',
    ],
  },
  {
    id: 'natal-centro-leste',
    chaves: [
      'tirol',
      'petropolis',
      'lagoa nova',
      'nova descoberta',
      'barro vermelho',
      'lagoa seca',
      'alecrim',
      'cidade alta',
      'ribeira',
      'rocas',
      'praia do meio',
      'areia preta',
      'mae luiza',
    ],
  },
  {
    id: 'natal-norte',
    chaves: [
      'potengi',
      'pajucara',
      'lagoa azul',
      'igapo',
      'nossa senhora da apresentacao',
      'redinha',
      'salinas',
    ],
  },
  {
    id: 'natal-oeste',
    chaves: [
      'guarapes',
      'planalto',
      'felipe camarao',
      'cidade da esperanca',
      'bom pastor',
      'quintas',
      'dix sept rosado',
      'cidade nova',
      'nossa senhora de nazare',
      'nordeste',
    ],
  },
];
export function macroDe(
  reg: string,
  regioes: Array<{ id: string; nome?: string; cidade?: string }>,
): string {
  const r = regioes.find((x) => x.id === reg);
  const alvo = semAc(`${reg} ${r?.nome || ''}`)
    .replace(/[-_,()]/g, ' ')
    .replace(/\s+/g, ' ');
  const M = MP_MACROS.find((m) => m.chaves.some((c) => alvo.includes(c)));
  return M ? M.id : `cidade:${semAc(r?.cidade || String(reg).split('-')[0]).replace(/\s+/g, '-')}`;
}

/* ------------------------------------------------------------------ */
/* Censo, alvarás e FipeZAP                                           */
/* ------------------------------------------------------------------ */
const ORDEM_DO_ESCOPO = ['bairro', 'setores', 'distrito', 'municipio'];
/**
 * O perfil de cada região: a linha do Censo da própria região (`regiao_id`;
 * `definicao` é o "nível" que o motor lê: "bairro oficial do IBGE",
 * "município ...", "N setores censitários ...") e a do município dela
 * (escopo municipio, nome = município).
 */
export function perfisDoCenso(
  ibge: LinhaDoCenso[],
  regioes: RegiaoDoBanco[],
): Record<string, PerfilDaRegiao> {
  const out: Record<string, PerfilDaRegiao> = {};
  const municipio = (cidade: string): LinhaDoCenso | undefined =>
    ibge.find(
      (g) =>
        g.escopo === 'municipio' &&
        semAc(g.nome) === semAc(cidade) &&
        semAc(g.municipio) === semAc(cidade),
    );
  for (const r of regioes) {
    const g = ibge
      .filter((x) => x.regiao_id === r.id)
      .sort((a, b) => ORDEM_DO_ESCOPO.indexOf(a.escopo) - ORDEM_DO_ESCOPO.indexOf(b.escopo))[0];
    if (!g) continue;
    const m = municipio(r.cidade);
    const est = g.dados?.estrangeiros_residentes_municipio;
    out[r.id] = {
      nome: g.nome,
      moradores: {
        nivel: g.definicao ?? undefined,
        renda_media_responsavel: g.renda_media_responsavel ?? null,
        renda_mediana_responsavel: g.renda_mediana_responsavel ?? null,
        crescimento_2010_2022_pct: g.crescimento_2010_2022_pct ?? null,
        pct_uso_ocasional: g.pct_uso_ocasional ?? null,
        ...(est && typeof est === 'object'
          ? { estrangeiros_residentes_municipio: est as Record<string, number | null> }
          : {}),
        ...(m
          ? {
              municipio: {
                nome: m.municipio,
                renda_media_responsavel: m.renda_media_responsavel ?? null,
                renda_mediana_responsavel: m.renda_mediana_responsavel ?? null,
                crescimento_2010_2022_pct: m.crescimento_2010_2022_pct ?? null,
                pct_uso_ocasional: m.pct_uso_ocasional ?? null,
              },
            }
          : {}),
      },
    };
  }
  return out;
}

/** As séries anuais do GeoMapas (geomapas-alvara-<bairro> e -unidades) no formato `construcao.por_bairro`. */
export function alvarasPorBairro(indices: LinhaDeSerie[]): Record<string, AlvarasDoBairro> | null {
  const out: Record<string, AlvarasDoBairro> = {};
  for (const x of indices) {
    if (!/^geomapas-alvara-/.test(x.serie) || !x.local) continue;
    const ano = String(x.mes).slice(0, 4);
    const k = `alvara_${ano}`;
    const b = (out[x.local] ??= {});
    const item = (b[k] ??= {});
    if (/-unidades$/.test(x.serie)) item.unidades = Number(x.valor);
    else item.n = Number(x.valor);
  }
  return Object.keys(out).length ? out : null;
}

const SERIES_FIPE = [
  'fipezap-natal-venda',
  'fipezap-natal-aluguel',
  'fipezap-natal-var12',
  'fipezap-natal-rentabilidade',
];
export function fipeDeNatal(indices: LinhaDeSerie[]): SerieFipe[] {
  const out: SerieFipe[] = [];
  for (const id of SERIES_FIPE) {
    const pts = indices
      .filter((x) => x.serie === id)
      .sort((a, b) => String(a.mes).localeCompare(String(b.mes)));
    const ult = pts.at(-1);
    if (!ult) continue;
    out.push({
      id,
      nome: ult.nome,
      fonte: ult.url ?? null,
      ultimos: pts
        .slice(-3)
        .map((p) => [String(p.mes).slice(0, 7), Number(p.valor)] as [string, number]),
    });
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* A carteira (js/20-carteira.js)                                     */
/* ------------------------------------------------------------------ */
const TIPO_BASE: Record<string, string> = {
  terreno: 'terreno',
  lote: 'terreno',
  terreno_comercial: 'terreno',
  casa: 'construido',
  casa_condominio: 'construido',
  casa_vila: 'construido',
  sobrado: 'construido',
  apartamento: 'construido',
  cobertura: 'construido',
  flat: 'construido',
  loja: 'comercial',
  ponto: 'comercial',
  sala: 'comercial',
  sala_comercial: 'comercial',
  consultorio: 'comercial',
  imovel_comercial: 'comercial',
  predio_comercial: 'comercial',
  andar_corporativo: 'comercial',
  galpao: 'comercial',
};
const TIPOS_COMERCIAIS =
  /^(terreno_comercial|loja|ponto|sala|sala_comercial|consultorio|imovel_comercial|predio_comercial|andar_corporativo|galpao)$/;
const FINALIDADE_NOME: Record<string, string> = {
  venda: 'venda',
  aluguel: 'aluguel',
  repasse: 'repasse de locação',
};

/** A ficha do imóvel como o motor a vê: o CRM (vivo) com os fatos curados do caderno por cima. */
interface FichaInterna {
  codigo: string;
  codigo_crm: string;
  titulo: string;
  regiao: string;
  bairro: string | null;
  cidade: string | null;
  logradouro: string | null;
  tipo: string;
  finalidade: string;
  disponivel: boolean;
  comparar: boolean;
  area_ambigua: number | null;
  area_terreno: number | null;
  area_construida: number | null;
  preco_total: number | null;
  lotes: LoteDaFicha[];
  venda_conjunto: FichaCurada['venda_conjunto'] | null;
  atributos: Record<string, unknown>;
}
interface Unidade {
  unidade: string;
  codigo: string;
  titulo: string;
  area_terreno: number | null;
  area_construida: number | null;
  preco: number | null;
  preco_deducao?: number | null;
  area_aproximada?: boolean;
  principal: boolean;
}
const baseDaFicha = (f: FichaInterna): string | null => TIPO_BASE[semAc(f.tipo)] || null;
function unidadesDa(f: FichaInterna): Unidade[] {
  const lotes = f.lotes;
  const base = baseDaFicha(f);
  if (!lotes.length)
    return [
      {
        unidade: 'imovel',
        codigo: f.codigo,
        titulo: f.titulo,
        area_terreno: f.area_terreno,
        area_construida: f.area_construida,
        preco: f.finalidade === 'venda' ? f.preco_total : null,
        principal: true,
      },
    ];
  const n = lotes.length;
  const vc = f.venda_conjunto || { permitida: null };
  const soma = lotes.reduce((s, l) => s + (temNum(l.area_terreno) ? l.area_terreno : 0), 0) || null;
  const precoConj = vc.preco ?? f.preco_total ?? null;
  const deduzido = /dedu/i.test(String(vc.origem || '')) || vc.permitida == null;
  return [
    ...lotes.map((l, k) => ({
      unidade: 'lote',
      codigo: l.codigo || `${f.codigo}-L${k + 1}`,
      titulo: `Lote ${k + 1} de ${n} · ${f.titulo}`,
      area_terreno: l.area_terreno ?? null,
      area_construida: null,
      preco: l.preco ?? null,
      area_aproximada: !!l.area_aproximada,
      principal: false,
    })),
    {
      unidade: 'conjunto',
      codigo: f.codigo,
      titulo: `${f.titulo}: os ${n} juntos`,
      area_terreno: base === 'terreno' ? (f.area_terreno ?? soma) : null,
      area_construida: null,
      preco: temNum(precoConj) && !deduzido ? precoConj : null,
      preco_deducao: temNum(precoConj) && deduzido ? precoConj : null,
      principal: true,
    },
  ];
}
function avaliarUnidade(f: FichaInterna, u: Unidade): UnidadeDaCarteira {
  const at = f.atributos;
  const base = baseDaFicha(f);
  const venda = f.finalidade === 'venda' && f.comparar !== false && f.disponivel !== false;
  const ambigua = temNum(f.area_ambigua);
  const fake: Record<string, unknown> = {
    ...at,
    regiao: f.regiao,
    tipo: f.tipo,
    modo: venda ? 'venda' : 'aluguel',
    carteira: true,
    preco: u.preco,
    area_total: base === 'terreno' ? u.area_terreno : ambigua ? null : u.area_terreno,
    area_util: base === 'terreno' ? null : ambigua ? null : u.area_construida,
    bairro: f.bairro,
    cidade: f.cidade,
    titulo: f.titulo,
    logradouro: f.logradouro,
  };
  const g = grupoDe(fake);
  const ar = g ? areaRef(fake) : null;
  const area = temNum(ar) && ar > 0 ? ar : null;
  const m2 = venda && temNum(u.preco) && area ? u.preco / area : null;
  const motivo = !venda
    ? f.disponivel === false
      ? 'não está disponível'
      : `é ${FINALIDADE_NOME[f.finalidade] || f.finalidade}, não venda`
    : ambigua
      ? `não se sabe se os ${f.area_ambigua} m² são construídos ou do terreno`
      : base === 'construido' && !temNum(u.area_construida)
        ? 'falta área construída'
        : base === 'terreno' && !temNum(u.area_terreno)
          ? 'falta área do terreno'
          : !g
            ? 'tipo sem grupo de comparação'
            : temNum(u.preco_deducao)
              ? 'o preço do conjunto é só uma conta (o proprietário ainda não disse se vende junto)'
              : !temNum(u.preco)
                ? u.unidade === 'lote'
                  ? 'falta o preço do lote'
                  : 'falta o preço'
                : null;
  const row: UnidadeDaCarteira = {
    ficha: f.codigo,
    codigo: u.codigo,
    codigo_crm: f.codigo_crm,
    titulo: u.titulo,
    regiao: f.regiao,
    bairro: f.bairro,
    unidade: u.unidade,
    principal: u.principal,
    grupo: g,
    area,
    area_terreno: u.area_terreno,
    area_construida: u.area_construida,
    preco: u.preco,
    m2,
    pv: null,
    motivo_sem_m2: motivo,
    comparavel: venda && temNum(m2),
    atributos: at,
  };
  for (const k of Object.keys(fake)) if (!(k in row)) row[k] = fake[k];
  return row;
}

/* ------------------------------------------------------------------ */
/* O código do CRM → o imóvel do caderno                              */
/* ------------------------------------------------------------------ */
const chaveDoCodigo = (s: string): string => semAc(s).replace(/[^a-z0-9]/g, '');
const ALIASES: Record<string, string> = Object.fromEntries(
  Object.entries(FICHAS_DO_CADERNO).map(([ref, f]) => [chaveDoCodigo(f.codigo_crm), ref]),
);
/** O código do caderno (TE0001) de um código do CRM (TE0001_IMOVA, IM0001, "Edifício Simone"...). */
export function refDoCodigo(codigo: string): string {
  if (FICHAS_DO_CADERNO[codigo] || ARG_CADERNO[codigo]) return codigo;
  const porNome = ALIASES[chaveDoCodigo(codigo)];
  if (porNome) return porNome;
  const m = /^([A-Za-z]{2}\d{4})_IMOVA$/i.exec(codigo.trim());
  return m ? m[1]!.toUpperCase() : codigo;
}

const disponivelNoCrm = (l: LinhaDaCarteira): boolean =>
  l.origem === 'canal_pro'
    ? !/pausad|desativ|inativ|vendid|exclu|rascunho/i.test(String(l.situacao ?? ''))
    : l.situacao === 'no_ar';

function fichaDoCrm(l: LinhaDaCarteira, ref: string): FichaInterna {
  const cur = FICHAS_DO_CADERNO[ref];
  const tipo = cur?.tipo ?? l.tipo;
  const base = TIPO_BASE[semAc(tipo)] || null;
  const numerosDoCrm = Object.fromEntries(
    (['quartos', 'suites', 'vagas', 'banheiros'] as const)
      .filter((k) => temNum(l[k]))
      .map((k) => [k, l[k]]),
  );
  return {
    codigo: ref,
    codigo_crm: l.codigo,
    titulo: l.titulo || ref,
    regiao: cur?.regiao ?? l.regiao_id ?? '',
    bairro: l.bairro ?? null,
    cidade: l.cidade ?? null,
    logradouro: l.logradouro ?? null,
    tipo,
    finalidade: cur?.finalidade ?? (l.negocio === 'aluguel' ? 'aluguel' : 'venda'),
    disponivel: (cur?.disponivel ?? true) && disponivelNoCrm(l),
    comparar: cur?.comparar ?? true,
    area_ambigua: cur?.area_ambigua ?? null,
    area_terreno:
      base === 'terreno'
        ? (cur?.area_terreno ?? l.area_ref ?? l.area_total ?? null)
        : (l.area_total ?? null),
    area_construida: base === 'terreno' ? null : (l.area_util ?? null),
    preco_total: l.preco_venda ?? null,
    lotes: cur?.lotes ?? [],
    venda_conjunto: cur?.venda_conjunto ?? null,
    // Os números vivem no CRM; os fatos confirmados, no caderno. Tipo comercial no CRM é uso comercial.
    atributos: {
      ...(TIPOS_COMERCIAIS.test(semAc(l.tipo)) ? { comercial: true } : {}),
      ...(cur?.atributos ?? {}),
      ...numerosDoCrm,
    },
  };
}

/* ------------------------------------------------------------------ */
/* A base                                                             */
/* ------------------------------------------------------------------ */
export interface BaseMontada {
  base: BaseDoMotor;
  /** Os imóveis que o motor mede (disponíveis), na ordem do protótipo e depois por código. */
  alvo: string[];
  /** Todos os imóveis da carteira (os indisponíveis saem com tudo vencido). */
  ordem: string[];
  /** Código do caderno → a linha da carteira no CRM (o código que o banco usa). */
  carteira: Record<string, LinhaDaCarteira>;
  /** Id do anúncio na base (fonte:id_externo) → o uuid e a fonte no banco. */
  anuncios: Map<string, { uuid: string; fonte: string }>;
  avisos: string[];
}

export function montarBaseDoBanco(e: EntradaDoBanco): BaseMontada {
  const avisos: string[] = [];
  const coleta = e.rodada ?? e.hoje;
  const anuncios = prepararAnuncios(e.anuncios);
  const uuids = new Map(
    e.anuncios.map((x) => [`${x.fonte}:${x.id_externo}`, { uuid: x.id, fonte: x.fonte }]),
  );
  const reg: RegiaoDaBase[] = e.regioes.map((r) => ({
    id: r.id,
    nome: r.nome,
    tipo: r.papel,
    cidade: r.cidade,
    lat: r.lat ?? null,
    lng: r.lng ?? null,
    vizinhos: Array.isArray(r.vizinhos) ? r.vizinhos : [],
  }));
  const ids = [...new Set([...anuncios.map((a) => a.regiao), ...reg.map((r) => r.id)])];
  const macro = Object.fromEntries(ids.map((r) => [r, macroDe(r, reg)]));

  const carteira: Record<string, LinhaDaCarteira> = {};
  for (const l of e.carteira) {
    const ref = refDoCodigo(l.codigo);
    const ja = carteira[ref];
    if (ja) {
      avisos.push(
        `dois anúncios do CRM viram o mesmo imóvel ${ref}: ${ja.codigo} e ${l.codigo} (fica o que está no ar)`,
      );
      if (disponivelNoCrm(ja) || !disponivelNoCrm(l)) continue;
    }
    carteira[ref] = l;
  }
  const fichasInternas = Object.entries(carteira).map(([ref, l]) => fichaDoCrm(l, ref));
  const ims: UnidadeDaCarteira[] = [];
  const fichas: FichaDaBase[] = [];
  for (const f of fichasInternas) {
    if (!f.regiao)
      avisos.push(
        `${f.codigo_crm}: sem região de mercado (bairro "${f.bairro}", cidade "${f.cidade}")`,
      );
    fichas.push({
      codigo: f.codigo,
      codigo_crm: f.codigo_crm,
      titulo: f.titulo,
      disponivel: f.disponivel,
      regiao: f.regiao,
      tipo: f.tipo,
      finalidade: f.finalidade,
      atributos: f.atributos,
      bairro: f.bairro ?? undefined,
    });
    if (!f.disponivel || !f.regiao) continue;
    for (const u of unidadesDa(f)) ims.push(avaliarUnidade(f, u));
  }
  // O modelo de preço (27/11/2026): ajustado com os anúncios da rodada; cada imóvel nosso
  // ganha a previsão (`pv`), que o motor usa para conferir o preço que parece baixo demais.
  const modelos = ajustarModelos(anuncios, (r) => macro[r] ?? macroDe(r, reg));
  for (const u of ims) {
    if (!temNum(u.area) || !u.grupo) continue;
    const m = baseDoGrupo(u.grupo) === 'terreno' ? modelos.terreno : modelos.construido;
    if (m === null) continue;
    u.pv = m.prever({ ...(u as Record<string, unknown>), regiao: u.regiao, area: u.area, grupo: u.grupo });
  }
  if (modelos.terreno === null) avisos.push('modelo de preço de terreno: anúncios insuficientes (preço de terreno não sai)');
  if (modelos.construido === null) avisos.push('modelo de preço de casa e apartamento: anúncios insuficientes (preço deles não sai)');
  const disponiveis = new Set(ims.map((i) => i.ficha as string));
  const naOrdem = (l: string[]): string[] => [
    ...ALVO_DO_PROTOTIPO.filter((r) => l.includes(r)),
    ...l.filter((r) => !ALVO_DO_PROTOTIPO.includes(r)).sort(),
  ];
  const alvo = naOrdem([...disponiveis]);
  const ordem = naOrdem(Object.keys(carteira));
  const base: BaseDoMotor = {
    anuncios,
    ims,
    reg,
    macro,
    // O modelo de preço da rodada (27/11/2026, `modelo-preco.ts`): homogeneização, P1 e A1.
    efeitos: { terreno: modelos.terreno?.efeitos ?? [], construido: modelos.construido?.efeitos ?? [] },
    perfis: perfisDoCenso(e.ibge, e.regioes),
    // A Corrida dos Bairros no banco só tem os nossos bairros: o "1º do município" não se mede (pendência).
    corrida: null,
    construcao: alvarasPorBairro(e.indices),
    fipe_natal: fipeDeNatal(e.indices),
    contexto_mercado: null,
    procura: null,
    coleta,
    fichas,
  };
  return { base, alvo, ordem, carteira, anuncios: uuids, avisos };
}
