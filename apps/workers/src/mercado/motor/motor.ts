/**
 * O motor v3 das vantagens (porte fiel de `motorEmPassos` em
 * `js/55-argumentos.js`, que é a porta de `nucleo-v3/nucleo.mjs`): limpeza da
 * base, parecidos por anel, homogeneização, veredito de preço, tamanho do
 * terreno com testes de sensibilidade, características (vagas, quartos,
 * suítes, área total), contagens de atributo (esquina, frente-mar), atributos
 * que somam valor (A1) e a região contra as outras (Censo, alvarás, Corrida).
 *
 * Mesma ordem e mesmas contas do protótipo: o teste de ouro (`ouro.test.ts`)
 * compara o dossiê inteiro. Diferenças de propósito, só fora do protótipo:
 *   - sem modelo de preço na rodada (`efeitos` vazio), o preço fica "sem
 *     comparação" e nenhum A1 sai (o protótipo sempre tinha o modelo);
 *   - a lista de imóveis e o dia da rodada vêm de fora (`OpcoesDoMotor`).
 */

import {
  binCdf,
  bh,
  brlCurto,
  dec,
  fmt,
  icMediana,
  ord,
  pct,
  percentil,
  pSinal,
  quantil,
  semAc,
  temNum,
  wilson,
} from './estatistica';
import { ols } from './ols';
import { pctDoLimiar, REGRAS_DO_DONO, type RegrasDasVantagens } from './regras-do-dono';
import type { AnuncioDaBase, BaseDoMotor, UnidadeDaCarteira } from './tipos';

/** A lista de imóveis do protótipo, na ordem em que o motor roda. */
export const ALVO_DO_PROTOTIPO = [
  'TE0006',
  'TE0001',
  'CA0001',
  'AP0001',
  'CA0002',
  'TE0002',
  'TE0003',
  'TE0005',
  'TE0004',
  'CA0003',
  'PT0001',
  'SA0012',
];

/** Os imóveis em que o caderno pede o valor total igual com igual (P3). */
export const P3_DO_CADERNO: Record<string, number> = { AP0001: 2, CA0002: 3 };

export interface OpcoesDoMotor {
  /** Os imóveis (código da carteira, sem lote), na ordem. */
  alvo?: string[];
  gerado_em?: string;
  /** As regras do dono (27/11/2026); o teste de ouro passa as do protótipo. */
  regras?: RegrasDasVantagens;
}

/* ---------------- tipos internos ---------------- */
type Faixa2 = [number | null, number | null];
interface Imovel extends UnidadeDaCarteira {
  censo_ok?: boolean;
  regras_preco_bloqueado?: string;
}
type Campo = string;
const val = (a: object, f: Campo): unknown => (a as Record<string, unknown>)[f];
const valN = (a: object, f: Campo): number => val(a, f) as number;

interface PosicaoPreco {
  n: number;
  med?: number | null;
  q1?: number | null;
  q3?: number | null;
  p?: number;
  kBom?: number;
  kRuim?: number;
  pSinal?: number;
  ic95?: Faixa2;
  ic80?: Faixa2;
  pior?: number;
  dif?: number;
}
export interface Anel {
  anel: number;
  nome: string;
  n: number;
  bruto?: number;
  repetidos?: number;
  manuais?: number;
  proprio_removido?: string[];
  possivel_mesmo: string[];
  med_cru?: number | null;
  dif_cru?: number;
  p_cru?: number;
  kBom?: number;
  pSinal?: number;
  pior?: number;
  ic95?: Faixa2;
  med_hom?: number | null;
  dif_hom?: number;
  q1_hom?: number | null;
  q3_hom?: number | null;
  ic80_hom?: Faixa2;
  amplitude80: number | null;
  q1_cru?: number | null;
  q3_cru?: number | null;
  fatores?: [number, number] | null;
  fixa?: [number, number] | null;
  so_interno?: boolean;
}
export interface AnalisePreco {
  aneis: Anel[];
  veredito: Record<string, unknown> | null;
  vantagem: {
    status: string;
    motivos?: string[];
    forca: string;
    n: number;
    kBom: number;
    med: number;
    pSinal: number;
  } | null;
  bloqueio: string[] | null;
  sens_avenida?: Record<string, unknown> & { n: number; dif_hom?: number };
  anel?: number | null;
  conferir?: string[];
  dif_modelo?: number | null;
  erro_modelo_regiao?: number | null;
  p5?: number | null;
}
interface Regua {
  n: number;
  menores?: number;
  S?: number;
  wilson95?: Faixa2;
  p?: number;
  med?: number | null;
  classe: string;
  trivial?: boolean;
}
export interface Sensibilidade extends Regua {
  manuais: number;
  sem_manuais: { n: number; menores?: number; S?: number; classe: string; trivial: boolean };
  porte: { limiar: number; n: number; menores?: number; S?: number; classe: string } | null;
  falhas: string[];
  forca: string | null;
  teto_r3: string | null;
}
export interface NomeDoLugar {
  texto: string;
  regra: string;
}
/** Uma tentativa de conjunto do tamanho (T1) e também o candidato inteiro: campos opcionais. */
export interface Candidato {
  id?: string;
  familia?: string;
  campo?: string;
  nosso?: number;
  onde?: string;
  onde_tipo?: string;
  regioes?: string[] | null;
  nome?: NomeDoLugar | null;
  faixa?: string | null;
  n?: number;
  k?: number;
  share?: number | null;
  informam?: number;
  informam_qualquer?: number;
  informam_validos?: number;
  de?: number;
  share_informam?: number;
  menores?: number;
  S?: number;
  wilson95?: Faixa2;
  p?: number | null;
  med?: number | null;
  classe?: string;
  manuais?: number;
  sem_manuais?: Sensibilidade['sem_manuais'];
  porte?: Sensibilidade['porte'];
  falhas?: string[];
  forca?: string | null;
  teto_r3?: string | null;
  bh?: boolean;
  conjuntos?: Candidato[];
  escolhido?: number;
  status?: string;
  trava_uso?: string | null;
  t19_caro?: string | null;
  porte_aplica?: boolean;
  comercial_grande?: boolean;
  iguais_ou_maiores?: number;
  absurdos?: string[];
  maiores_e_mais_baratos?: string[];
  com_igual_ou_mais?: number;
  dist?: Record<string, number>;
  limiar_empate?: number;
  variantes?: Record<string, unknown>;
  proprio_tirado?: string[];
  conta_larga?: number | null;
  taxa_base?: number;
  esperado?: number;
  p_taxa_base?: number;
  localidade?: Record<string, unknown> | null;
  efeito?: number;
  lo?: number;
  hi?: number;
  n_com?: number | null;
  coerente?: boolean;
  dif_hom?: number | null;
  boot_regiao_lo?: number | null;
  bloqueio?: string[];
}
export interface FatoDeRegiao {
  id: string;
  familia?: string;
  eixo?: string;
  forca: string | null;
  bloqueio?: string | null;
  nosso?: number;
  ref?: number;
  razao_media?: number;
  razao_mediana?: number | null;
  mun?: string;
  med_outros?: number | null;
  n_outros?: number;
  S?: number;
  nivel_area?: string;
  teto?: string;
  nota?: string;
  posicao_exata?: boolean;
  entre_os?: number | null;
  janelas?: Array<{
    janela: string;
    pos: number;
    u?: number;
    u_seguinte?: number;
    folga: number | null;
  }>;
  mesma_posicao_em?: number;
  folga_ate_o_seguinte?: number | null;
  bairros_com_ano_faltando?: number;
  pos?: number;
  de?: number;
  unidades?: number;
  bairro?: string;
  m2?: number;
  amostra?: number;
  segundo?: string | undefined;
  segundo_m2?: number | null;
  acima_fora_do_municipio?: string[];
  var12?: number;
  natal?: number;
  [campo: string]: unknown;
}
export interface ResultadoDoImovel {
  codigo: string;
  ref: string;
  titulo: unknown;
  regiao: string;
  grupo: string | null;
  area: number | null;
  preco: AnalisePreco;
  m2: number | null;
  candidatos: Candidato[];
  regiao_fatos: FatoDeRegiao[];
  hipoteses?: Record<string, unknown>;
  regiao_se_confirmar?: Array<{ id: string; forca: string | null }>;
}
export interface Extras {
  AP0001_P3?: ValorTotal;
  CA0002_P3?: ValorTotal;
  [chave: string]: unknown;
  a1_vagas_casas: {
    n: number;
    regioes: number;
    efeito: number;
    lo: number;
    hi: number;
    modelo: string;
  } | null;
}
export interface ValorTotal {
  n: number;
  pedem_mais: number;
  med: number | null;
  q1: number | null;
  pSinal: number;
  p: number;
  pior: number;
  manuais: number;
  nome: NomeDoLugar | null;
  quartos: unknown;
}
export interface SaidaDoMotor {
  out: {
    gerado_em: string;
    coleta: string;
    beta: Record<string, number>;
    b_quartos: number;
    b_vagas: number;
    anuncios_pagina: number;
    anuncios: number;
    suspeitos: number;
    fora_da_cidade_n: number;
    manuais: number;
    imoveis: ResultadoDoImovel[];
    procura?: {
      lider: { codigo: string; min: number; max: number };
      segundo: { codigo: string; min: number; max: number };
      p_lider_vs_2o: number;
      p_acima_da_media: number;
      total: number;
      periodo: unknown;
    } | null;
    construcao_cidade?: { alvaras_21_23: number; alvaras_17_19: number };
    extras: Extras;
  };
  LISTAS: Record<string, unknown>;
  A: AnuncioDaBase[];
  /**
   * A prova de cada vantagem que sai de anúncios: imóvel (ref) → id da vantagem →
   * os anúncios do conjunto contado (id da base, "fonte:id_externo"). Fica fora do
   * dossiê (não muda o teste de ouro); vai para `mercado_argumentos.prova`, que é
   * o que a equipe contesta (`app.mercado_argumentos_suspender`).
   */
  provas: Record<string, Record<string, string[]>>;
}

export const baseG = (gr: string | null | undefined): string | null | undefined =>
  /^terreno/.test(gr || '')
    ? 'terreno'
    : gr === 'apartamento'
      ? 'apartamento'
      : /^casa/.test(gr || '')
        ? 'casa'
        : gr;
export const okC = (c: unknown): boolean => c === 'A' || c === 'B';
export const bairroLimpo = (a: { bairro?: unknown }): string =>
  String(a.bairro || '')
    .replace(/\s*\(.*\)\s*/g, '')
    // Resto de HTML do site de origem ("Praia da Pipa &rsaquo;", 27/11/2026).
    .replace(/&[a-z]+;|[›»]/gi, '')
    .trim() || '?';

/** O motor tem o modelo de preço desta rodada? Sem ele, preço e A1 não saem. */
export function temModeloDePreco(B: BaseDoMotor): boolean {
  const t = B.efeitos?.terreno ?? [];
  const c = B.efeitos?.construido ?? [];
  return (
    t.some((e) => e.id === 'log_area') &&
    ['log_area', 'log_area_apto', 'quartos', 'vagas'].every((id) => c.some((e) => e.id === id))
  );
}

export function rodarMotor(B: BaseDoMotor, opcoes: OpcoesDoMotor = {}): SaidaDoMotor {
  const ALVO = opcoes.alvo ?? ALVO_DO_PROTOTIPO;
  const comModelo = temModeloDePreco(B);
  const REGRAS = opcoes.regras ?? REGRAS_DO_DONO;
  const LIMIAR = REGRAS.limiarPreco;
  const PCT = pctDoLimiar(REGRAS);
  const REGm = Object.fromEntries(B.reg.map((r) => [r.id, r]));
  const CIDADES_RN = [
    'natal',
    'parnamirim',
    'macaiba',
    'sao goncalo do amarante',
    'extremoz',
    'nisia floresta',
    'tibau do sul',
    'ceara-mirim',
    'sao jose de mipibu',
    'goianinha',
    'canguaretama',
    'touros',
    'maxaranguape',
  ];
  const cidadeDaRegiao = (reg: string): string =>
    REGm[reg]?.cidade
      ? semAc(REGm[reg].cidade)
      : reg.startsWith('natal')
        ? 'natal'
        : reg.startsWith('parnamirim')
          ? 'parnamirim'
          : reg.startsWith('tibau')
            ? 'tibau do sul'
            : reg.startsWith('nisia')
              ? 'nisia floresta'
              : reg.startsWith('extremoz')
                ? 'extremoz'
                : semAc(reg);
  const RX_CID = new Map<string, RegExp>();
  const rxCid = (x: string): RegExp => {
    let r = RX_CID.get(x);
    if (!r) {
      r = new RegExp(`\\b${x}\\b`);
      RX_CID.set(x, r);
    }
    return r;
  };
  const OC = new Map<AnuncioDaBase, string | null>();
  const outraCidade = (a: AnuncioDaBase): string | null => {
    if (OC.has(a)) return OC.get(a)!;
    const t = semAc(a.titulo).replace(/nova parnamirim/g, 'parnamirim');
    const c = cidadeDaRegiao(a.regiao);
    const o = CIDADES_RN.filter((x) => x !== 'natal' && x !== c && rxCid(x).test(t));
    const r = o.length && !rxCid(c).test(t) ? o[0]! : null;
    OC.set(a, r);
    return r;
  };
  const A0 = B.anuncios.filter((a) => a.usado_nas_medias !== false);
  const FORA_DA_CIDADE = A0.filter((a) => outraCidade(a)).map((a) => ({
    id: a.id,
    regiao: a.regiao,
    grupo: a.grupo,
    cidade_no_titulo: outraCidade(a),
    titulo: a.titulo,
  }));
  const A = A0.filter((a) => !outraCidade(a));
  const CONDOMINIOS_CONHECIDOS = ['cidade raros', 'vila dos ventos', 'pipa golf', 'sun7'];
  const loteCondominio = (a: AnuncioDaBase): boolean =>
    a.condominio_fechado === true ||
    /condom/i.test(a.subtipo || '') ||
    /condominio|loteamento fechado|\bcond\b/.test(semAc(a.titulo)) ||
    CONDOMINIOS_CONHECIDOS.some((c) => semAc(a.titulo).includes(c));
  const manual = (a: AnuncioDaBase): boolean => !a.ultima_coleta_auto;
  const LOCALIDADE: Record<
    string,
    { nome: string; teste: (a: AnuncioDaBase) => boolean; regiao_txt: string }
  > = {
    'tibau-do-sul-pipa': {
      nome: 'na vila de Pipa',
      teste: (a) =>
        /^(pipa|praia de pipa)$/.test(semAc(a.bairro)) &&
        !/sibauma|golf|cabeceira|rn-?003|rn 003|zona rural|cacimbinha|minas|sun7/.test(
          semAc(a.titulo),
        ),
      regiao_txt: 'em Pipa e arredores, no município de Tibau do Sul',
    },
    'nisia-floresta-tabatinga': {
      nome: 'em Tabatinga',
      teste: (a) => /tabatinga/.test(semAc(a.bairro)),
      regiao_txt: 'no litoral de Nísia Floresta, de Búzios a Barreta',
    },
  };
  function regioesDoAnel(reg: string, anel: number): string[] {
    const r = REGm[reg];
    const viz = r?.vizinhos || [];
    if (anel === 0) return [reg];
    if (anel === 1) return [reg, ...viz.filter((v) => v.km <= 3).map((v) => v.id)];
    if (anel === 2) return [reg, ...viz.filter((v) => v.km <= 6).map((v) => v.id)];
    const m = B.macro[reg];
    return [
      ...new Set([
        reg,
        ...viz.filter((v) => v.km <= 6).map((v) => v.id),
        ...Object.keys(B.macro).filter((x) => B.macro[x] === m),
      ]),
    ];
  }
  const ANEL_TXT = [
    'mesma região',
    'região e vizinhas até 3 km',
    'região e vizinhas até 6 km',
    'mesma macrorregião',
  ];
  function mesmoTipo(a: AnuncioDaBase, im: Imovel): boolean {
    if (baseG(a.grupo) !== baseG(im.grupo)) return false;
    if (
      baseG(im.grupo) === 'casa' &&
      (a.grupo === 'casa_condominio') !== (im.grupo === 'casa_condominio')
    )
      return false;
    if (baseG(im.grupo) === 'terreno' && loteCondominio(a) !== !!im.atributos?.condominio_fechado)
      return false;
    return true;
  }
  function casaAtributos(a: AnuncioDaBase, im: Imovel): boolean {
    const f = im.atributos?.frente_mar;
    if (f == null) return true;
    return (a.frente_mar === true) === f;
  }
  const FAIXA = (im: Imovel): [number, number] =>
    baseG(im.grupo) === 'casa' ? [2 / 3, 1.5] : [0.5, 2];
  const areaIm = (im: Imovel): unknown => (temNum(im.area) ? im.area : im.area_terreno);
  const areaA = (a: AnuncioDaBase, im: Imovel): unknown =>
    temNum(im.area) ? a.area : a.area_total;
  const perto3 = (a: AnuncioDaBase, im: Imovel): boolean => {
    const ai = areaIm(im);
    const aa = areaA(a, im);
    return temNum(ai) && temNum(aa) && Math.abs(aa / ai - 1) <= 0.03;
  };
  const proprio = (a: AnuncioDaBase, im: Imovel): boolean =>
    a.regiao === im.regiao &&
    temNum(im.preco) &&
    perto3(a, im) &&
    Math.abs(a.preco / im.preco - 1) <= 0.03;
  const talvezMesmo = (a: AnuncioDaBase, im: Imovel): boolean =>
    a.regiao === im.regiao &&
    temNum(im.preco) &&
    perto3(a, im) &&
    a.preco / im.preco >= 0.6 &&
    a.preco / im.preco <= 1.4 &&
    !(
      im.bairro &&
      a.bairro &&
      !semAc(im.bairro).includes(semAc(a.bairro)) &&
      !semAc(a.bairro).includes(semAc(im.bairro).split(' ')[0]!)
    );
  function juntarRepetidos(l: AnuncioDaBase[]): { lista: AnuncioDaBase[]; repetidos: number } {
    const s = l.slice().sort((x, y) => x.preco - y.preco);
    const usado = new Array<boolean>(s.length).fill(false);
    const out: AnuncioDaBase[] = [];
    let rep = 0;
    for (let i = 0; i < s.length; i++) {
      if (usado[i]) continue;
      usado[i] = true;
      out.push(s[i]!);
      for (let j = i + 1; j < s.length && s[j]!.preco <= s[i]!.preco * 1.03; j++) {
        const x = s[i]!;
        const y = s[j]!;
        if (
          usado[j] ||
          y.regiao !== x.regiao ||
          baseG(y.grupo) !== baseG(x.grupo) ||
          Math.abs(y.area / x.area - 1) > 0.02
        )
          continue;
        if (temNum(x.quartos) && temNum(y.quartos) && x.quartos !== y.quartos) continue;
        if (x.logradouro && y.logradouro && semAc(x.logradouro) !== semAc(y.logradouro)) continue;
        usado[j] = true;
        rep++;
      }
    }
    return { lista: out, repetidos: rep };
  }
  interface Parecidos {
    lista: AnuncioDaBase[];
    bruto?: number;
    repetidos?: number;
    proprio_removido?: string[];
    possivel_mesmo?: string[];
    possivel_mesmo_lista?: AnuncioDaBase[];
    proprio_lista?: AnuncioDaBase[];
    manuais?: number;
    regioes: string[];
    so_interno?: boolean;
  }
  function parecidos(
    im: Imovel,
    anel: number,
    {
      faixa = FAIXA(im),
      fixa = null,
      regs = null,
    }: {
      faixa?: [number, number] | null;
      fixa?: [number, number] | null;
      regs?: string[] | null;
    } = {},
  ): Parecidos {
    const R = new Set(regs || regioesDoAnel(im.regiao, anel));
    let l = A.filter((a) => R.has(a.regiao) && mesmoTipo(a, im) && casaAtributos(a, im));
    if (fixa) l = l.filter((a) => a.area >= fixa[0] && a.area <= fixa[1]);
    else if (faixa)
      l = l.filter((a) => a.area >= im.area! * faixa[0] && a.area <= im.area! * faixa[1]);
    const fora = l.filter((a) => proprio(a, im));
    l = l.filter((a) => !proprio(a, im));
    const mesmo = l.filter((a) => talvezMesmo(a, im));
    const j = juntarRepetidos(l);
    return {
      lista: j.lista,
      bruto: l.length,
      repetidos: j.repetidos,
      proprio_removido: fora.map((a) => `${a.fonte} R$ ${a.preco} ${a.area} m²`),
      possivel_mesmo: mesmo.map(
        (a) =>
          `${a.fonte}, ${brlCurto(a.preco)}, ${fmt(Math.round(a.area))} m² (${bairroLimpo(a)})`,
      ),
      possivel_mesmo_lista: mesmo,
      proprio_lista: fora,
      manuais: j.lista.filter(manual).length,
      regioes: [...R],
    };
  }
  /* homogeneização (NBR 14653-2, fatores do modelo da Imova) */
  const efC = (id: string): number =>
    B.efeitos.construido.find((e) => e.id === id)?.efeito as number;
  const efT = (id: string): number => B.efeitos.terreno.find((e) => e.id === id)?.efeito as number;
  const BETA: Record<string, number> = {
    terreno: Math.log(1 + efT('log_area')) / Math.log(1.1),
    casa: Math.log(1 + efC('log_area')) / Math.log(1.1),
  };
  BETA.apartamento = Math.log(1 + efC('log_area_apto')) / Math.log(1.1);
  const BQ = Math.log(1 + efC('quartos'));
  const BV = Math.log(1 + efC('vagas'));
  function homog(a: AnuncioDaBase, im: Imovel): { m2: number; f: number } {
    const t = baseG(im.grupo) as string;
    let f = Math.pow(im.area! / a.area, BETA[t] as number);
    if (t !== 'terreno') {
      const q = (v: unknown): number => Math.min(temNum(v) ? v : 3, 6);
      const v = (x: unknown): number => Math.min(temNum(x) ? x : 2, 6);
      if (temNum(im.quartos)) f *= Math.exp(BQ * (q(im.quartos) - q(a.quartos)));
      if (temNum(im.vagas)) f *= Math.exp(BV * (v(im.vagas) - v(a.vagas)));
    }
    return { m2: a.m2 * f, f };
  }
  /* veredito interno de preço e vantagem de preço */
  function posicaoPreco(vals: unknown[], nosso: number): PosicaoPreco {
    const s = ord(vals);
    const n = s.length;
    if (!n) return { n: 0 };
    const med = quantil(s, 0.5);
    const kRuim = s.filter((v) => v <= nosso).length;
    const kBom = n - kRuim;
    const p = percentil(s, nosso);
    const k10 = Math.ceil(n * 0.1);
    const s2 = s.slice(0, n - k10);
    return {
      n,
      med,
      q1: quantil(s, 0.25),
      q3: quantil(s, 0.75),
      p,
      kBom,
      kRuim,
      pSinal: pSinal(kRuim, n),
      ic95: icMediana(s, 0.95),
      ic80: icMediana(s, 0.8),
      pior: percentil(s2, nosso),
      dif: nosso / med! - 1,
    };
  }
  const LISTAS: Record<string, unknown> = {};
  /**
   * Sem o modelo de preço (o worker ainda não tem o hedônico do protótipo): o
   * preço nunca vira vantagem, mas as conferências que não dependem do modelo
   * continuam valendo, porque travam o valor total (P3) e o "achei mais barato":
   * o possível mesmo imóvel anunciado por outro preço e o 5º percentil do tipo.
   * Os parecidos são os mesmos anéis do protótipo, só sem a homogeneização.
   */
  function precoSemModelo(im: Imovel, m2: number, comercialGrande: boolean): AnalisePreco {
    const R: AnalisePreco = { aneis: [], veredito: null, vantagem: null, bloqueio: null };
    const listas: Parecidos[] = [];
    for (const anel of comercialGrande ? [0, 3] : [0, 1, 2, 3]) {
      const fixa: [number, number] | null =
        comercialGrande && im.area! >= 5000 ? [5000, 20000] : null;
      const c = parecidos(im, anel, { fixa });
      const cru = posicaoPreco(
        c.lista.map((a) => a.m2),
        m2,
      );
      listas.push(c);
      R.aneis.push({
        anel,
        nome: ANEL_TXT[anel]!,
        n: cru.n,
        bruto: c.bruto,
        repetidos: c.repetidos,
        manuais: c.manuais,
        possivel_mesmo: c.possivel_mesmo!,
        med_cru: cru.med,
        dif_cru: cru.dif,
        p_cru: cru.p,
        kBom: cru.kBom,
        pSinal: cru.pSinal,
        pior: cru.pior,
        amplitude80: null,
      });
    }
    let i = R.aneis.findIndex((a) => a.n >= 20);
    if (i < 0) i = R.aneis.findIndex((a) => a.n >= 10);
    const esc =
      i >= 0
        ? R.aneis[i]!
        : R.aneis
            .slice()
            .reverse()
            .find((a) => a.n >= 5) || null;
    R.anel = esc ? esc.anel : null;
    if (esc) PROVA_DO_PRECO.set(im.codigo, listas[R.aneis.indexOf(esc)]?.lista ?? []);
    const p5 = (() => {
      const s = ord(
        A.filter((a) => a.regiao === im.regiao && baseG(a.grupo) === baseG(im.grupo)).map(
          (a) => a.m2,
        ),
      );
      return s.length >= 20 ? quantil(s, 0.05) : null;
    })();
    const conferir: string[] = [];
    if (temNum(p5) && m2 < p5)
      conferir.push(`abaixo do 5º percentil do tipo na região (R$ ${Math.round(p5)})`);
    if (esc && esc.possivel_mesmo.length)
      conferir.push(
        `possível o mesmo imóvel anunciado por outro preço: ${esc.possivel_mesmo.join('; ')}`,
      );
    R.conferir = conferir;
    R.dif_modelo = null;
    R.erro_modelo_regiao = null;
    R.p5 = p5;
    R.veredito = { rotulo: 'sem comparação', motivo: 'sem o modelo de preço desta rodada' };
    return R;
  }
  const PROVAS: Record<string, Record<string, string[]>> = {};
  const PROVA_DO_PRECO = new Map<string, AnuncioDaBase[]>();
  const LISTA_DA_TENTATIVA = new Map<Candidato, AnuncioDaBase[]>();
  const guardar = (ref: string, id: string, lista: AnuncioDaBase[] | undefined): void => {
    if (!lista) return;
    (PROVAS[ref] ??= {})[id] = [...new Set(lista.map((a) => a.id))].sort();
  };
  function analisarPreco(im: Imovel): AnalisePreco {
    const R: AnalisePreco = { aneis: [], veredito: null, vantagem: null, bloqueio: null };
    if (!im.comparavel || !temNum(im.m2) || !/^(terreno|casa|apartamento)/.test(im.grupo || '')) {
      R.veredito = { rotulo: 'sem comparação', motivo: im.motivo_sem_m2 || 'sem m² comparável' };
      return R;
    }
    const m2 = im.m2;
    const comercialGrande =
      baseG(im.grupo) === 'terreno' && !!im.atributos?.comercial && im.area! >= 1500;
    if (!comModelo) return precoSemModelo(im, m2, comercialGrande);
    const aneis = comercialGrande ? [0, 3] : [0, 1, 2, 3];
    const listas: Parecidos[] = [];
    for (const anel of aneis) {
      const fixa: [number, number] | null =
        comercialGrande && im.area! >= 5000 ? [5000, 20000] : null;
      const c = parecidos(im, anel, { fixa });
      const cru = posicaoPreco(
        c.lista.map((a) => a.m2),
        m2,
      );
      const hom = posicaoPreco(
        c.lista.map((a) => homog(a, im).m2),
        m2,
      );
      const fs = c.lista.map((a) => homog(a, im).f);
      listas.push(c);
      R.aneis.push({
        anel,
        nome: ANEL_TXT[anel]!,
        n: cru.n,
        bruto: c.bruto,
        repetidos: c.repetidos,
        manuais: c.manuais,
        proprio_removido: c.proprio_removido,
        possivel_mesmo: c.possivel_mesmo!,
        med_cru: cru.med,
        dif_cru: cru.dif,
        p_cru: cru.p,
        kBom: cru.kBom,
        pSinal: cru.pSinal,
        pior: cru.pior,
        ic95: cru.ic95,
        med_hom: hom.med,
        dif_hom: hom.dif,
        q1_hom: hom.q1,
        q3_hom: hom.q3,
        ic80_hom: hom.ic80,
        amplitude80: hom.ic80 && hom.ic80[0] ? (hom.ic80[1]! - hom.ic80[0]) / hom.med! : null,
        q1_cru: cru.q1,
        q3_cru: cru.q3,
        fatores: fs.length ? [Math.min(...fs), Math.max(...fs)] : null,
        fixa,
      });
    }
    if (R.aneis.every((a) => a.n < 5) && im.atributos?.frente_mar === true) {
      const ef = efT('frente_mar');
      for (const anel of [0, 1, 2, 3]) {
        const Rg = new Set(regioesDoAnel(im.regiao, anel));
        const l = juntarRepetidos(
          A.filter(
            (a) =>
              Rg.has(a.regiao) &&
              mesmoTipo(a, im) &&
              a.area >= im.area! * 0.5 &&
              a.area <= im.area! * 2 &&
              !proprio(a, im),
          ),
        ).lista;
        const vals = l.map((a) => homog(a, im).m2 * (a.frente_mar === true ? 1 : 1 + ef));
        const hom = posicaoPreco(vals, m2);
        const cru = posicaoPreco(
          l.map((a) => a.m2),
          m2,
        );
        listas.push({ lista: l, regioes: [...Rg], so_interno: true });
        R.aneis.push({
          anel,
          nome: `${ANEL_TXT[anel]!} (sem casar frente-mar; fator +${Math.round(ef * 100)}% nos que não são)`,
          n: hom.n,
          med_cru: cru.med,
          dif_cru: cru.dif,
          p_cru: cru.p,
          kBom: cru.kBom,
          pSinal: cru.pSinal,
          pior: cru.pior,
          med_hom: hom.med,
          dif_hom: hom.dif,
          q1_hom: hom.q1,
          q3_hom: hom.q3,
          ic80_hom: hom.ic80,
          amplitude80: hom.ic80 && hom.ic80[0] ? (hom.ic80[1]! - hom.ic80[0]) / hom.med! : null,
          possivel_mesmo: [],
          so_interno: true,
          q1_cru: cru.q1,
          q3_cru: cru.q3,
        });
      }
      const k = R.aneis.map((a, i) => (a.so_interno ? i : -1)).filter((i) => i >= 0);
      R.aneis = k.map((i) => R.aneis[i]!);
      listas.splice(0, listas.length, ...k.map((i) => listas[i]!));
    }
    if (comercialGrande && im.atributos?.frente_avenida === true) {
      const Rg = new Set(regioesDoAnel(im.regiao, 3));
      const l = juntarRepetidos(
        A.filter(
          (a) =>
            Rg.has(a.regiao) &&
            mesmoTipo(a, im) &&
            a.frente_avenida === true &&
            a.area >= im.area! * 0.5 &&
            a.area <= im.area! * 2 &&
            !proprio(a, im),
        ),
      ).lista;
      const cru = posicaoPreco(
        l.map((a) => a.m2),
        m2,
      );
      const hom = posicaoPreco(
        l.map((a) => homog(a, im).m2),
        m2,
      );
      R.sens_avenida = {
        n: cru.n,
        med_cru: cru.med,
        dif_cru: cru.dif,
        med_hom: hom.med,
        dif_hom: hom.dif,
      };
    }
    let i = R.aneis.findIndex((a) => a.n >= 20);
    let teto: string | null = null;
    if (i < 0) {
      i = R.aneis.findIndex((a) => a.n >= 10);
      teto = 'B';
    }
    const esc =
      i >= 0
        ? R.aneis[i]!
        : R.aneis
            .slice()
            .reverse()
            .find((a) => a.n >= 5) || null;
    R.anel = esc ? esc.anel : null;
    if (esc) LISTAS[im.codigo] = { ...listas[R.aneis.indexOf(esc)], anel: esc.nome };
    if (esc) PROVA_DO_PRECO.set(im.codigo, listas[R.aneis.indexOf(esc)]?.lista ?? []);
    const pv = im.pv;
    const difMod = pv && temNum(pv.m2) ? m2 / pv.m2 - 1 : null;
    const p5 = (() => {
      const s = ord(
        A.filter((a) => a.regiao === im.regiao && baseG(a.grupo) === baseG(im.grupo)).map(
          (a) => a.m2,
        ),
      );
      return s.length >= 20 ? quantil(s, 0.05) : null;
    })();
    const conferir: string[] = [];
    if (pv && temNum(pv.lo) && m2 < pv.lo)
      conferir.push(`abaixo da faixa de 90% do modelo (R$ ${Math.round(pv.lo)})`);
    if (temNum(difMod) && difMod < -0.4)
      conferir.push(`${Math.round(-difMod * 100)}% abaixo do previsto pelo modelo`);
    if (temNum(p5) && m2 < p5)
      conferir.push(`abaixo do 5º percentil do tipo na região (R$ ${Math.round(p5)})`);
    if (esc && esc.possivel_mesmo.length)
      conferir.push(
        `possível o mesmo imóvel anunciado por outro preço: ${esc.possivel_mesmo.join('; ')}`,
      );
    R.conferir = conferir;
    R.dif_modelo = difMod;
    R.erro_modelo_regiao = (pv?.erro_pct as number | null | undefined) ?? null;
    R.p5 = p5;
    if (!esc)
      R.veredito = {
        rotulo: 'sem comparação',
        motivo: `menos de 5 parecidos em todos os anéis (${R.aneis.map((a) => a.n).join(', ')})`,
      };
    else {
      const d = esc.dif_hom!;
      const semPrec = esc.n < 10 || (temNum(esc.amplitude80) && esc.amplitude80 > 0.5);
      const inconcl =
        temNum(difMod) &&
        ((Math.sign(d) !== Math.sign(difMod) && Math.abs(d) > 0.15 && Math.abs(difMod) > 0.15) ||
          Math.abs(d - difMod) > 0.25);
      let rot =
        Math.abs(d) <= 0.15
          ? 'no preço'
          : m2 >= esc.q1_hom! && m2 <= esc.q3_hom!
            ? d > 0
              ? 'um pouco acima'
              : 'um pouco abaixo'
            : d > 0
              ? 'acima'
              : 'abaixo';
      if (semPrec && rot !== 'no preço') {
        const lim =
          esc.ic80_hom && esc.ic80_hom[0]
            ? d > 0
              ? m2 / esc.ic80_hom[1]! - 1
              : m2 / esc.ic80_hom[0] - 1
            : null;
        rot = `${d > 0 ? 'acima' : 'abaixo'}, sem precisão para medir quanto${temNum(lim) && Math.abs(lim) > 0.15 ? ` (pelo menos ${pct(lim)} contra a ponta da faixa de 80%)` : ''}`;
      }
      if (
        R.sens_avenida &&
        R.sens_avenida.n >= 5 &&
        R.sens_avenida.dif_hom! <= 0.15 &&
        rot !== 'no preço'
      )
        rot = `inconclusivo (contra os ${R.sens_avenida.n} terrenos de avenida fica ${pct(R.sens_avenida.dif_hom)})`;
      const ant = R.aneis
        .slice(0, R.aneis.indexOf(esc))
        .reverse()
        .find((a) => a.n >= 10);
      if (
        ant &&
        (Math.abs(ant.dif_hom!) <= 0.15 !== Math.abs(d) <= 0.15 ||
          Math.sign(ant.dif_hom!) !== Math.sign(d)) &&
        Math.abs(ant.dif_hom! - d) > 0.25
      )
        rot = `inconclusivo (muda conforme o conjunto: ${pct(ant.dif_hom)} com ${ant.n} em "${ant.nome}", ${pct(d)} com ${esc.n} em "${esc.nome}")`;
      if (inconcl && rot !== 'no preço') rot = 'inconclusivo (homogeneização e modelo discordam)';
      R.veredito = {
        rotulo: rot,
        dif_hom: d,
        dif_cru: esc.dif_cru,
        n: esc.n,
        anel: esc.nome,
        med_cru: esc.med_cru,
        med_hom: esc.med_hom,
        q1_hom: esc.q1_hom,
        q3_hom: esc.q3_hom,
        so_interno: !!esc.so_interno,
        ajustar_preco: /^(acima|um pouco acima)$/.test(rot) && !conferir.length && !esc.so_interno,
        impacto_ic80_topo: esc.ic80_hom && esc.ic80_hom[1] ? esc.ic80_hom[1] : null,
      };
    }
    const motivos: string[] = [];
    if (!esc || esc.n < 10) motivos.push(`parecidos insuficientes (n = ${esc ? esc.n : 0} < 10)`);
    else {
      if (!(m2 <= LIMIAR * esc.med_cru!))
        motivos.push(`nosso m² não está ${PCT} abaixo da mediana crua (${pct(esc.dif_cru)})`);
      if (!(m2 <= LIMIAR * esc.med_hom!)) motivos.push(`nem da homogeneizada (${pct(esc.dif_hom)})`);
      if (!(esc.pSinal! <= 0.05)) motivos.push(`teste do sinal não passa (p = ${dec(esc.pSinal)})`);
      if (!(esc.pior! <= 0.4)) motivos.push(`pior caso falha (percentil ${dec(esc.pior)})`);
      const prox = R.aneis[i + 1];
      if (prox && prox.n >= 10 && m2 > prox.med_cru!)
        motivos.push(`vira desvantagem no anel seguinte (${pct(prox.dif_cru)})`);
    }
    if (im.regras_preco_bloqueado) motivos.push(im.regras_preco_bloqueado);
    const passa = !motivos.length;
    if (passa && conferir.length)
      R.vantagem = {
        status: 'conferir',
        motivos: conferir,
        forca: esc!.n >= 20 && esc!.p_cru! <= 0.25 && !teto ? 'A' : 'B',
        n: esc!.n,
        kBom: esc!.kBom!,
        med: esc!.med_cru!,
        pSinal: esc!.pSinal!,
      };
    else if (passa)
      R.vantagem = {
        status: 'usar',
        forca: esc!.n >= 20 && esc!.p_cru! <= 0.25 && !teto ? 'A' : 'B',
        n: esc!.n,
        kBom: esc!.kBom!,
        med: esc!.med_cru!,
        pSinal: esc!.pSinal!,
      };
    else R.bloqueio = motivos;
    return R;
  }
  /* características (maior é melhor) */
  function maiorQue(vals: unknown[], nosso: number, { minN = 20 } = {}): Regua {
    const s = ord(vals);
    const n = s.length;
    if (!n) return { n: 0, classe: 'sem dado' };
    const menores = s.filter((v) => v < nosso).length;
    const kRuim = n - menores;
    const S = menores / n;
    const w = wilson(menores, n);
    const p = pSinal(kRuim, n);
    let classe: string;
    if (n >= minN) classe = S >= 0.75 && w.lo! >= 0.6 ? 'A' : S >= 0.65 && p <= 0.05 ? 'B' : 'não';
    else if (n >= 10) classe = S >= 0.85 && p <= 0.01 ? 'B' : 'não';
    else classe = 'amostra pequena';
    return { n, menores, S, wilson95: [w.lo, w.hi], p, med: quantil(s, 0.5), classe };
  }
  function contagem(
    lista: AnuncioDaBase[],
    f: Campo,
    { texto = true } = {},
  ): {
    n: number;
    k: number;
    share: number | null;
    wilson95: Faixa2;
    p: number | null;
    classe: string;
  } {
    const n = lista.length;
    const k = lista.filter((a) => val(a, f) === true).length;
    const w = wilson(k, n);
    const classe =
      n < 20
        ? 'amostra pequena'
        : k / n <= 0.25 && w.hi! < 0.5
          ? texto
            ? 'B'
            : k / n <= 0.1 && w.hi! <= 0.2
              ? 'A'
              : 'B'
          : 'comum';
    return {
      n,
      k,
      share: n ? k / n : null,
      wilson95: [w.lo, w.hi],
      p: n ? binCdf(k, n) : null,
      classe,
    };
  }
  const PORTE_MIN = 1500;
  function nomeDoConjunto(L: AnuncioDaBase[], im: Imovel, ondeTipo: string): NomeDoLugar | null {
    if (!L.length) return null;
    const cont: Record<string, number> = {};
    L.forEach((a) => (cont[bairroLimpo(a)] = (cont[bairroLimpo(a)] || 0) + 1));
    const ord2 = Object.entries(cont).sort((a, b) => b[1] - a[1]);
    const [top, nTop] = ord2[0]!;
    const cidades = [...new Set(L.map((a) => cidadeDaRegiao(a.regiao)))];
    const cidadeNome =
      (
        {
          natal: 'Natal',
          parnamirim: 'Parnamirim',
          extremoz: 'Extremoz',
          'tibau do sul': 'Tibau do Sul',
          'nisia floresta': 'Nísia Floresta',
        } as Record<string, string>
      )[cidades[0]!] || cidades[0];
    const prep = (b: string): string =>
      /^(potengi|tirol|centro)$/i.test(semAc(b)) ? `no ${b}` : `em ${b}`;
    if (top !== '?' && nTop / L.length >= 0.9)
      return { texto: prep(top), regra: `${nTop} de ${L.length} no bairro ${top} (≥ 90%)` };
    if (ord2.length <= 4 && !cont['?']) {
      const meu = bairroLimpo(im);
      const ns = ord2
        .map((x) => x[0])
        .sort((a, b) => Number(semAc(b) === semAc(meu)) - Number(semAc(a) === semAc(meu)));
      return {
        texto: `em ${ns.length === 1 ? ns[0] : `${ns.slice(0, -1).join(', ')} e ${ns.at(-1)}`}`,
        regra: `todos os ${L.length} nestes bairros: ${ord2.map((x) => x.join(' ')).join(', ')}`,
      };
    }
    if (cidades.length === 1)
      return {
        texto: `em ${cidadeNome}${ondeTipo === 'macro' && cidades[0] === 'parnamirim' ? ', fora das praias' : ''}`,
        regra: `todos os ${L.length} no município de ${cidadeNome}; nenhum bairro chega a 90% (o maior: ${top}, ${nTop})`,
      };
    return { texto: LOCALIDADE[im.regiao]?.regiao_txt || 'na região', regra: 'mais de uma cidade' };
  }
  function limparAbsurdos(
    L: AnuncioDaBase[],
    nosso: number,
    campo: Campo,
  ): { L: AnuncioDaBase[]; absurdos: string[] } {
    const med = quantil(ord(L.map((a) => a.m2)), 0.5);
    const abs = L.filter((a) => temNum(a.m2) && temNum(med) && a.m2 < 0.2 * med);
    const tirar = abs.filter((a) => valN(a, campo) < nosso);
    return {
      L: L.filter((a) => !tirar.includes(a)),
      absurdos: abs.map(
        (a) =>
          `${val(a, campo) as number} m² por R$ ${a.preco} (${bairroLimpo(a)}, ${a.fonte})${tirar.includes(a) ? ': tirado' : ': fica (conta contra nós)'}`,
      ),
    };
  }
  function sensibilidade(
    L: AnuncioDaBase[],
    _im: Imovel,
    nosso: number,
    campo: Campo,
    { porte = false } = {},
  ): Sensibilidade {
    const base = maiorQue(
      L.map((a) => val(a, campo)),
      nosso,
    );
    const man = L.filter(manual).length;
    const semMan: Regua = man
      ? maiorQue(
          L.filter((a) => !manual(a)).map((a) => val(a, campo)),
          nosso,
        )
      : { ...base, trivial: true };
    const lim = Math.min(1000, Math.round(nosso / 3));
    const dentro = porte
      ? maiorQue(
          L.filter((a) => valN(a, campo) >= lim).map((a) => val(a, campo)),
          nosso,
        )
      : null;
    const falhas: string[] = [];
    if (!okC(base.classe))
      falhas.push(`régua original: ${base.menores ?? 0} de ${base.n} (${base.classe})`);
    if (!okC(semMan.classe))
      falhas.push(
        `sem os anúncios manuais: ${semMan.menores ?? 0} de ${semMan.n} (${semMan.classe})`,
      );
    if (dentro && !okC(dentro.classe))
      falhas.push(
        `dentro do porte (${lim} m² ou mais): ${dentro.menores ?? 0} de ${dentro.n} (${dentro.classe})`,
      );
    let forca: string | null = falhas.length
      ? null
      : [base.classe, semMan.classe, dentro?.classe].filter(Boolean).every((c) => c === 'A')
        ? 'A'
        : 'B';
    let teto: string | null = null;
    if (forca === 'A' && L.length && man / L.length > 0.5) {
      forca = 'B';
      teto = `R3: ${man} de ${L.length} só do levantamento manual`;
    }
    return {
      ...base,
      manuais: man,
      sem_manuais: {
        n: semMan.n,
        menores: semMan.menores,
        S: semMan.S,
        classe: semMan.classe,
        trivial: !!semMan.trivial,
      },
      porte: dentro
        ? { limiar: lim, n: dentro.n, menores: dentro.menores, S: dentro.S, classe: dentro.classe }
        : null,
      falhas,
      forca,
      teto_r3: teto,
    };
  }
  const listaTamanho = (im: Imovel, regs: string[]): AnuncioDaBase[] => {
    const R = new Set(regs);
    return juntarRepetidos(A.filter((a) => R.has(a.regiao) && mesmoTipo(a, im) && !proprio(a, im)))
      .lista;
  };
  function tamanhoTerreno(im: Imovel): Candidato {
    const area = im.area!;
    const comercialGrande = !!im.atributos?.comercial && area >= PORTE_MIN;
    const porte = area >= PORTE_MIN;
    const loc = LOCALIDADE[im.regiao];
    interface Plano {
      onde_tipo: string;
      L: AnuncioDaBase[];
      nome?: NomeDoLugar;
      minimo?: number;
      regs?: string[];
    }
    const plano: Plano[] = [];
    const doReg = listaTamanho(im, [im.regiao]);
    if (loc) {
      const lv = doReg.filter(loc.teste);
      plano.push({
        onde_tipo: 'localidade',
        L: lv,
        nome: { texto: loc.nome, regra: 'todos na localidade (LOCALIDADE)' },
        minimo: 20,
      });
    }
    plano.push({ onde_tipo: 'regiao', L: doReg, regs: [im.regiao] });
    if (comercialGrande)
      plano.push({
        onde_tipo: 'macro',
        L: listaTamanho(im, regioesDoAnel(im.regiao, 3)),
        regs: regioesDoAnel(im.regiao, 3),
      });
    else
      for (const anel of [1, 2]) {
        const regs = regioesDoAnel(im.regiao, anel);
        if (regs.length > plano.at(-1)!.regs!.length)
          plano.push({ onde_tipo: `anel${anel}`, L: listaTamanho(im, regs), regs });
      }
    const tentativas: Candidato[] = plano.map((p) => {
      const c = limparAbsurdos(p.L, area, 'area');
      if (p.minimo && c.L.length < p.minimo)
        return {
          onde_tipo: p.onde_tipo,
          n: c.L.length,
          nome: p.nome,
          falhas: [`menos de ${p.minimo} anúncios na localidade`],
          forca: null,
        };
      const t = sensibilidade(c.L, im, area, 'area', { porte });
      const nome = p.nome || nomeDoConjunto(c.L, im, p.onde_tipo);
      /* lugar que não se pode nomear ("na região", mais de uma cidade) não vai para o cliente */
      if (nome && nome.regra === 'mais de uma cidade' && nome.texto === 'na região') {
        t.falhas = [...(t.falhas || []), 'lugar sem nome verificável (mais de uma cidade)'];
        t.forca = null;
      }
      const maioresMaisBaratos = c.L.filter(
        (a) => a.area >= area && temNum(im.preco) && a.preco < im.preco,
      ).map((a) => `${a.area} m² por R$ ${a.preco} (${bairroLimpo(a)})`);
      const tentativa: Candidato = {
        onde_tipo: p.onde_tipo,
        regioes: p.regs || null,
        nome,
        ...t,
        iguais_ou_maiores: c.L.filter((a) => a.area >= area).length,
        absurdos: c.absurdos,
        maiores_e_mais_baratos: maioresMaisBaratos,
      };
      LISTA_DA_TENTATIVA.set(tentativa, c.L);
      return tentativa;
    });
    const i = tentativas.findIndex((x) => x.forca);
    const ocup = im.atributos?.ocupacao_max_pct;
    return {
      id: 'T1.area',
      familia: 'tamanho',
      campo: 'área do terreno',
      nosso: area,
      porte_aplica: porte,
      comercial_grande: comercialGrande,
      conjuntos: tentativas,
      escolhido: i,
      forca: i >= 0 ? tentativas[i]!.forca : null,
      status: i < 0 ? 'bloqueado' : ocup ? 'bloqueado' : 'usar',
      trava_uso: ocup
        ? `a ficha limita a ocupação a ${String(ocup)}% do lote e os parecidos não informam a deles: tamanho não se compara (como a P1)`
        : null,
      t19_caro:
        i >= 0
          ? tentativas[i]!.maiores_e_mais_baratos!.length
            ? `não responde "caro" nem "achei mais barato": ${tentativas[i]!.maiores_e_mais_baratos!.length} parecido(s) maior(es) ou igual(is) pedem menos no total`
            : 'pode responder a caro'
          : null,
    };
  }
  /* região contra as outras */
  const P = B.perfis;
  function regiao(im: Imovel): FatoDeRegiao[] {
    const out: FatoDeRegiao[] = [];
    const pf = P[im.regiao]?.moradores;
    if (!pf) return out;
    const mun = pf.municipio || {};
    const litoral = /pipa|tabatinga|pirangi|cotovelo/.test(im.regiao);
    const comercialTerreno = baseG(im.grupo) === 'terreno' && im.atributos?.comercial;
    const areaOk = im.censo_ok !== false;
    const bairroOficial =
      /bairro oficial do IBGE/.test(pf.nivel || '') && !/BONOR/.test(pf.nivel || '');
    const mesmaAreaMunicipio = /^munic/i.test(pf.nivel || '');
    const outrosMunicipios = (): number[] => [
      ...new Map(
        Object.values(P)
          .map((v) => v.moradores?.municipio)
          .filter(
            (m): m is NonNullable<typeof m> =>
              !!m && temNum(m.crescimento_2010_2022_pct) && m.nome !== mun.nome,
          )
          .map((m) => [m.nome, m.crescimento_2010_2022_pct as number]),
      ).values(),
    ];
    if (
      temNum(pf.renda_media_responsavel) &&
      temNum(mun.renda_media_responsavel) &&
      !mesmaAreaMunicipio
    ) {
      const rm = pf.renda_media_responsavel / mun.renda_media_responsavel;
      const rd = temNum(pf.renda_mediana_responsavel)
        ? pf.renda_mediana_responsavel / (mun.renda_mediana_responsavel as number)
        : null;
      const menor = rd == null ? rm : Math.min(rm, rd);
      const forca = menor >= 1.2 ? 'B' : null;
      const bloq = !areaOk
        ? 'área do Censo diferente da do imóvel ou bairro não confirmado'
        : litoral
          ? 'litoral: quem compra não mora lá'
          : comercialTerreno
            ? 'terreno comercial: conta gente em volta, não renda'
            : !forca
              ? 'renda abaixo de 1,2 vez a do município'
              : null;
      out.push({
        id: 'C2.renda',
        familia: 'regiao',
        eixo: 'regiao_vs_outras',
        forca: bloq ? null : forca,
        bloqueio: bloq,
        nosso: pf.renda_media_responsavel,
        ref: mun.renda_media_responsavel,
        razao_media: rm,
        razao_mediana: rd,
        mun: mun.nome,
      });
    }
    if (temNum(pf.crescimento_2010_2022_pct) || mesmaAreaMunicipio) {
      const c = pf.crescimento_2010_2022_pct as number;
      if (mesmaAreaMunicipio) {
        const outros = outrosMunicipios();
        const med = quantil(ord(outros), 0.5);
        const S = outros.filter((v) => v < c).length / outros.length;
        out.push({
          id: 'C2.populacao',
          familia: 'regiao',
          eixo: 'regiao_vs_outras',
          forca: c - med! >= 20 && S >= 0.7 ? 'B' : null,
          teto: 'B (4 a 6 municípios para comparar)',
          nosso: c,
          med_outros: med,
          n_outros: outros.length,
          S,
          mun: mun.nome,
          nivel_area: 'municipio',
          bloqueio:
            c - med! >= 20 && S >= 0.7 ? null : 'não passa 20 pontos acima dos outros municípios',
        });
      } else if (bairroOficial && areaOk) {
        const d = c - (mun.crescimento_2010_2022_pct as number);
        out.push({
          id: 'C2.populacao',
          familia: 'regiao',
          eixo: 'regiao_vs_outras',
          forca: d >= 20 ? 'A' : d >= 10 ? 'B' : null,
          nosso: c,
          ref: mun.crescimento_2010_2022_pct as number,
          mun: mun.nome,
          nivel_area: 'bairro',
          bloqueio:
            d >= 10
              ? null
              : c < (mun.crescimento_2010_2022_pct as number)
                ? 'desfavorável'
                : 'menos de 10 pontos acima',
        });
      }
    } else if (litoral && temNum(mun.crescimento_2010_2022_pct)) {
      const outros = outrosMunicipios();
      const med = quantil(ord(outros), 0.5);
      const S =
        outros.filter((v) => v < (mun.crescimento_2010_2022_pct as number)).length / outros.length;
      const c = mun.crescimento_2010_2022_pct;
      out.push({
        id: 'C2.populacao_municipio',
        familia: 'regiao',
        eixo: 'regiao_vs_outras',
        forca: c - med! >= 20 && S >= 0.7 ? 'B' : 'C',
        nosso: c,
        med_outros: med,
        n_outros: outros.length,
        S,
        mun: mun.nome,
        nota: 'dado do município, dito como do município; vantagem só com 20 pontos acima dos outros municípios, senão fato de contexto (C)',
      });
    }
    if (
      litoral &&
      temNum(pf.pct_uso_ocasional) &&
      temNum(mun.pct_uso_ocasional) &&
      pf.pct_uso_ocasional >= 1.3 * mun.pct_uso_ocasional
    )
      out.push({
        id: 'C1.veraneio',
        familia: 'regiao',
        eixo: 'perfil',
        forca: 'C',
        nosso: pf.pct_uso_ocasional,
        ref: mun.pct_uso_ocasional,
        mun: mun.nome,
      });
    return out;
  }
  const construcaoB = B.construcao || {};
  const alvaraU = (v: Record<string, { n?: number; unidades?: number }>, y: string): number =>
    v[`alvara_${y}`]?.unidades || 0;
  const alvaraN = (v: Record<string, { n?: number; unidades?: number }>, y: string): number =>
    v[`alvara_${y}`]?.n || 0;
  const CONS = Object.entries(construcaoB)
    .map(([k, v]) => {
      const s = (ys: string[]): number => ys.reduce((t, y) => t + alvaraU(v, y), 0);
      const n = (ys: string[]): number => ys.reduce((t, y) => t + alvaraN(v, y), 0);
      return {
        bairro: k,
        u: s(['2021', '2022', '2023']),
        n1: n(['2021', '2022', '2023']),
        n0: n(['2017', '2018', '2019']),
        pos: 0,
      };
    })
    .sort((a, b) => b.u - a.u);
  CONS.forEach((r, i) => (r.pos = i + 1));
  const NCID1 = CONS.reduce((t, r) => t + r.n1, 0);
  const NCID0 = CONS.reduce((t, r) => t + r.n0, 0);
  const JANELAS = [
    ['2021', '2022', '2023'],
    ['2022', '2023'],
    ['2020', '2021', '2022', '2023'],
    ['2019', '2020', '2021', '2022', '2023'],
    ['2017', '2018', '2019', '2020', '2021', '2022', '2023'],
    ['2020', '2021', '2022'],
  ];
  function posicoesNasJanelas(
    nomeBairro: string,
  ): Array<{ janela: string; pos: number; u?: number; u_seguinte?: number; folga: number | null }> {
    return JANELAS.map((ys) => {
      const l = Object.entries(construcaoB)
        .map(([k, v]) => ({ bairro: k, u: ys.reduce((t, y) => t + alvaraU(v, y), 0) }))
        .sort((a, b) => b.u - a.u);
      const i = l.findIndex((x) => semAc(x.bairro) === semAc(nomeBairro));
      return {
        janela: `${ys[0]}-${ys.at(-1)}`,
        pos: i + 1,
        u: l[i]?.u,
        u_seguinte: l[i + 1]?.u,
        folga: l[i + 1]?.u ? l[i]!.u / l[i + 1]!.u - 1 : null,
      };
    });
  }
  function construcao(nomeBairro: string): FatoDeRegiao | null {
    const r = CONS.find((x) => semAc(x.bairro) === semAc(nomeBairro));
    if (!r) return null;
    const jan = posicoesNasJanelas(nomeBairro);
    const igual = jan.filter((j) => j.pos === r.pos).length;
    const folga = jan[0]!.folga;
    const exata = igual >= 4 && temNum(folga) && folga > 0.1;
    const K = exata ? r.pos : [3, 5, 10, 15].find((k) => jan.every((j) => j.pos <= k)) || null;
    const S = K ? (CONS.length - K) / (CONS.length - 1) : 0;
    const forcaV3 = !K
      ? null
      : exata
        ? S >= 0.85
          ? 'A'
          : S >= 0.7
            ? 'B'
            : null
        : S >= 0.7
          ? 'B'
          : null;
    const anosFaltando = Object.values(construcaoB).filter((v) =>
      ['2017', '2018', '2019', '2020', '2021', '2022', '2023'].some((y) => !v[`alvara_${y}`]),
    ).length;
    const pc = NCID1 / (NCID1 + NCID0);
    const pCres = 1 - binCdf(r.n1 - 1, r.n0 + r.n1, pc);
    return {
      id: 'C2.construcao',
      familia: 'regiao',
      eixo: 'regiao_vs_outras',
      forca: forcaV3,
      posicao_exata: exata,
      entre_os: exata ? null : K,
      janelas: jan,
      mesma_posicao_em: igual,
      folga_ate_o_seguinte: folga,
      bairros_com_ano_faltando: anosFaltando,
      pos: r.pos,
      de: CONS.length,
      unidades: r.u,
      alvaras_21_23: r.n1,
      alvaras_17_19: r.n0,
      razao_bairro: r.n0 ? r.n1 / r.n0 : null,
      razao_cidade: NCID1 / NCID0,
      p_cresceu: pCres,
      cresceu_passa: pCres < 0.1,
      bairro: nomeBairro,
    };
  }
  function nivelApto(nomeBairro: string): FatoDeRegiao | null {
    const l = (B.corrida?.cidade || [])
      .filter((x) => x.tipo === 'apartamento' && x.amostra >= 30 && x.cidade === 'Natal')
      .sort((a, b) => b.m2_mediana - a.m2_mediana);
    const i = l.findIndex((x) => semAc(x.bairro) === semAc(nomeBairro));
    if (i < 0) return null;
    const S = (l.length - 1 - i) / (l.length - 1);
    const todos = (B.corrida?.cidade || [])
      .filter((x) => x.tipo === 'apartamento')
      .sort((a, b) => b.m2_mediana - a.m2_mediana);
    const li = l[i]!;
    const acimaFora = todos
      .filter((x) => x.m2_mediana > li.m2_mediana && x.cidade !== 'Natal')
      .map((x) => `${x.bairro} (${x.cidade}) R$ ${x.m2_mediana}, ${x.amostra} anúncios`);
    const doMunicipio = todos.filter((x) => x.cidade === 'Natal');
    const posMun = doMunicipio.findIndex((x) => semAc(x.bairro) === semAc(nomeBairro)) + 1;
    return {
      id: 'C3.nivel_apto',
      familia: 'regiao',
      eixo: 'regiao_vs_outras',
      forca: S >= 0.7 ? 'B' : null,
      teto: 'B (1º e 2º não se separam em cada fonte: z ≈ 0,8 contra o 2º; o que sustenta é a concordância com o FipeZAP)',
      pos_no_municipio_sem_corte: posMun,
      acima_fora_do_municipio: acimaFora,
      pos: i + 1,
      de: l.length,
      m2: li.m2_mediana,
      amostra: li.amostra,
      segundo: l[1] && `${l[1].bairro} R$ ${l[1].m2_mediana}`,
      segundo_m2: l[1]?.m2_mediana ?? null,
      uso: 'só para quem vai construir ou incorporar',
      bairro: nomeBairro,
    };
  }
  function valorizacao(nomeBairro: string): FatoDeRegiao | null {
    const txt = (B.contexto_mercado || []).map((x) => x.texto).join(' ');
    const m = txt.match(new RegExp(`${nomeBairro} R\\$ ([\\d.]+) \\(\\+([\\d,]+)%\\)`));
    if (!m) return null;
    const v = +m[2]!.replace(',', '.');
    const natal = 7.68;
    return {
      id: 'S1.valorizacao_bairro',
      familia: 'serie',
      eixo: 'regiao_vs_outras',
      forca: null,
      var12: v,
      natal,
      pp: +(v - natal).toFixed(2),
      leituras: 1,
      fonte_exata: false,
      bairro: nomeBairro,
      bloqueio:
        v - natal >= 3
          ? 'falta 3 leituras seguidas e o número extraído do PDF'
          : v > natal
            ? `só ${dec(v - natal, 1)} ponto acima de Natal (precisa de 3) numa leitura de gráfico`
            : 'abaixo de Natal: nunca citar o índice do bairro',
    };
  }
  /* rodar nos imóveis */
  const out: SaidaDoMotor['out'] = {
    gerado_em: opcoes.gerado_em ?? '2026-11-18',
    coleta: B.coleta,
    beta: BETA,
    b_quartos: BQ,
    b_vagas: BV,
    anuncios_pagina: B.anuncios.length,
    anuncios: A.length,
    suspeitos: B.anuncios.length - A0.length,
    fora_da_cidade_n: FORA_DA_CIDADE.length,
    manuais: A.filter(manual).length,
    imoveis: [],
    extras: { a1_vagas_casas: null },
  };
  const nomeBairroDe: Record<string, string> = {
    'natal-capim-macio': 'Capim Macio',
    'natal-ponta-negra': 'Ponta Negra',
    'natal-lagoa-nova': 'Lagoa Nova',
    'natal-potengi': 'Potengi',
  };
  for (const ref of ALVO) {
    const cad = REGRAS.caderno[ref];
    const cod = cad?.unidade || ref;
    const M = cad?.motor || {};
    const im0 = B.ims.find((x) => x.codigo === cod);
    if (!im0) continue;
    const im: Imovel = { ...im0, censo_ok: M.censo_ok, regras_preco_bloqueado: M.preco_bloqueado };
    const r: ResultadoDoImovel = {
      codigo: cod,
      ref,
      titulo: im.titulo,
      regiao: im.regiao,
      grupo: im.grupo,
      area: im.area,
      preco: analisarPreco(im),
      m2: im.m2,
      candidatos: [],
      regiao_fatos: [],
    };
    const t = baseG(im.grupo);
    if (/^(terreno|casa|apartamento)$/.test(t || '')) {
      const doTipoReg = juntarRepetidos(
        A.filter(
          (a) => a.regiao === im.regiao && mesmoTipo(a, im) && !(temNum(im.area) && proprio(a, im)),
        ),
      ).lista;
      const loc = LOCALIDADE[im.regiao];
      const doTipoLoc = loc ? doTipoReg.filter(loc.teste) : null;
      if (t === 'terreno') {
        const t1 = tamanhoTerreno(im);
        r.candidatos.push(t1);
        if (t1.escolhido! >= 0)
          guardar(ref, 'T1.area', LISTA_DA_TENTATIVA.get(t1.conjuntos![t1.escolhido!]!));
      }
      if (t === 'casa' || t === 'apartamento') {
        const base = A.filter(
          (a) => a.regiao === im.regiao && mesmoTipo(a, im) && (!loc || loc.teste(a)),
        );
        const parecidasLista = temNum(im.area)
          ? juntarRepetidos(
              base.filter(
                (a) =>
                  a.area >= im.area! * FAIXA(im)[0] &&
                  a.area <= im.area! * FAIXA(im)[1] &&
                  !proprio(a, im),
              ),
            ).lista
          : juntarRepetidos(base).lista;
        const ondeN = nomeDoConjunto(parecidasLista, im, 'regiao');
        const onde = ondeN?.texto || 'no bairro';
        for (const f of ['vagas', 'quartos', 'suites']) {
          const nossoF = val(im, f);
          if (!temNum(nossoF)) continue;
          const inf = parecidasLista.filter((a) => temNum(val(a, f)));
          const m = maiorQue(
            inf.map((a) => val(a, f)),
            nossoF,
          );
          const share = inf.length / (parecidasLista.length || 1);
          const sv = sensibilidade(inf, im, nossoF, f);
          guardar(ref, `R1.${f}`, inf);
          const mmb = inf
            .filter((a) => valN(a, f) >= nossoF && temNum(im.preco) && a.preco < im.preco)
            .map((a) => `${valN(a, f)} ${f} por R$ ${a.preco}`);
          const faixaTxt = temNum(im.area)
            ? `${Math.ceil(im.area * FAIXA(im)[0])} a ${Math.floor(im.area * FAIXA(im)[1])} m²`
            : null;
          r.candidatos.push({
            id: `R1.${f}`,
            familia: f === 'vagas' ? 'raridade' : 'atributo',
            campo: f,
            nosso: nossoF,
            onde,
            nome: ondeN,
            faixa: faixaTxt,
            informam: inf.length,
            de: parecidasLista.length,
            share_informam: share,
            ...m,
            sem_manuais: sv.sem_manuais,
            manuais: sv.manuais,
            falhas: sv.falhas,
            classe:
              share < 0.6
                ? `menos de 60% informam (${Math.round(share * 100)}%)`
                : sv.forca || m.classe,
            forca: share < 0.6 ? null : sv.forca,
            com_igual_ou_mais: inf.filter((a) => valN(a, f) >= nossoF).length,
            dist: Object.fromEntries(
              Object.entries(
                inf.reduce<Record<string, number>>((o, a) => {
                  const k = String(val(a, f));
                  o[k] = (o[k] || 0) + 1;
                  return o;
                }, {}),
              ),
            ),
            maiores_e_mais_baratos: mmb,
          });
        }
        const aTerr = t === 'casa' ? (im.area_terreno ?? im.atributos?.area_total) : null;
        if (temNum(aTerr)) {
          const ref2 = temNum(im.area)
            ? parecidasLista
            : juntarRepetidos(base.filter((a) => !proprio(a, im))).lista;
          const valido = (a: AnuncioDaBase): boolean =>
            temNum(a.area_total) && (!temNum(a.area_util) || a.area_total >= 1.2 * a.area_util);
          const informamQualquer = ref2.filter((a) => temNum(a.area_total)).length;
          const vl = ref2.filter(valido);
          const share = vl.length / (ref2.length || 1);
          const limEmp = aTerr / 1.15;
          const sv = sensibilidade(
            vl.map((a) => ({ ...a, terr: a.area_total })),
            im,
            limEmp,
            'terr',
          );
          guardar(ref, 'T1.area_terreno', vl);
          const variantes = {
            com_1_1: (() => {
              const v = ref2.filter(
                (a) =>
                  temNum(a.area_total) &&
                  (!temNum(a.area_util) || a.area_total >= 1.1 * a.area_util),
              );
              return {
                n: v.length,
                share: v.length / (ref2.length || 1),
                menores_sem_empate: v.filter((a) => (a.area_total as number) < aTerr).length,
              };
            })(),
            sem_empate: {
              n: vl.length,
              menores: vl.filter((a) => (a.area_total as number) < aTerr).length,
            },
          };
          const motivo =
            share < 0.6
              ? `só ${vl.length} de ${ref2.length} (${Math.round(share * 100)}%) informam uma área total válida (a regra pede 60%)`
              : null;
          r.candidatos.push({
            id: 'T1.area_terreno',
            familia: 'tamanho',
            campo: temNum(im.area)
              ? 'área do terreno entre as casas parecidas'
              : 'área total entre as casas do mesmo tipo (sem área construída)',
            nosso: aTerr,
            limiar_empate: Math.floor(limEmp),
            onde,
            nome: ondeN,
            de: ref2.length,
            informam_qualquer: informamQualquer,
            informam_validos: vl.length,
            share_informam: share,
            n: sv.n,
            menores: sv.menores,
            S: sv.S,
            wilson95: sv.wilson95,
            p: sv.p,
            med: quantil(ord(vl.map((a) => a.area_total)), 0.5),
            sem_manuais: sv.sem_manuais,
            manuais: sv.manuais,
            falhas: [...(motivo ? [motivo] : []), ...sv.falhas],
            forca: motivo ? null : sv.forca,
            classe: motivo || sv.forca || sv.classe,
            variantes,
            faixa: temNum(im.area)
              ? `${Math.ceil(im.area * FAIXA(im)[0])} a ${Math.floor(im.area * FAIXA(im)[1])} m²`
              : null,
            proprio_tirado: base
              .filter((a) => proprio(a, im))
              .map(
                (a) =>
                  `${a.area_total} m² de área total por R$ ${a.preco}: ${(a.titulo || '').slice(0, 70)}`,
              ),
            maiores_e_mais_baratos: vl
              .filter(
                (a) => (a.area_total as number) >= aTerr && temNum(im.preco) && a.preco < im.preco,
              )
              .map((a) => `${a.area_total} m² por R$ ${a.preco}`),
          });
        }
      }
      const contarAtributo = (f: Campo, provaDe?: string): Candidato => {
        const usaLoc = !!doTipoLoc && doTipoLoc.length >= 20;
        const conj = usaLoc ? doTipoLoc! : doTipoReg;
        if (provaDe) guardar(provaDe, `R1.${f}`, conj);
        const onde = usaLoc ? loc!.nome : loc ? loc.regiao_txt : 'na região';
        const c = contagem(conj, f, { texto: true });
        const baseTipo = A.filter((a) => mesmoTipo(a, im));
        const p0 = baseTipo.filter((a) => val(a, f) === true).length / (baseTipo.length || 1);
        const pBase = binCdf(c.k, c.n, p0);
        const ondeC = nomeDoConjunto(conj, im, 'regiao');
        const larga =
          f === 'frente_mar'
            ? conj.filter(
                (a) =>
                  a.frente_mar === true ||
                  /beira[ -]?mar/.test(semAc(`${a.titulo} ${a.logradouro}`)),
              ).length
            : null;
        return {
          id: `R1.${f}`,
          familia: 'raridade',
          campo: f,
          onde: ondeC?.texto || onde,
          nome: ondeC,
          ...c,
          conta_larga: larga,
          taxa_base: p0,
          esperado: p0 * c.n,
          p_taxa_base: pBase,
          classe:
            larga != null && larga / c.n > 0.25
              ? `conta larga ${larga} de ${c.n} (${Math.round((larga / c.n) * 100)}%) passa de 25%`
              : pBase > 0.05
                ? `não fica abaixo da taxa de base do campo (${dec(p0 * 100, 1)}% em toda a base: esperado ${dec(p0 * c.n, 1)} de ${c.n}, achado ${c.k}; p = ${dec(pBase)})`
                : c.classe,
          localidade: doTipoLoc ? contagem(doTipoLoc, f) : null,
        };
      };
      for (const f of ['esquina', 'frente_mar'])
        if (
          (im.atributos?.[f] === true && M.censo_ok !== false) ||
          (f === 'esquina' && M.contar_esquina)
        ) {
          if (im.atributos?.[f] !== true) continue;
          r.candidatos.push(contarAtributo(f, ref));
        }
      /* hipótese (só para a tela: "o que este pedido libera"): a mesma contagem, como se a equipe confirmasse a esquina */
      if (t === 'terreno' && !r.candidatos.some((c) => c.id === 'R1.esquina')) {
        const h = contarAtributo('esquina');
        r.hipoteses = {
          'R1.esquina': {
            classe: h.classe,
            forca: okC(h.classe) ? h.classe : null,
            n: h.n,
            k: h.k,
          },
        };
      }
      const efs = t === 'terreno' ? B.efeitos.terreno : B.efeitos.construido;
      for (const e of comModelo ? efs : []) {
        if (['log_area', 'log_area_apto', 'apartamento'].includes(e.id)) continue;
        if (t === 'apartamento' && e.id === 'condominio_fechado') continue;
        const temos =
          e.id === 'vagas'
            ? temNum(im.vagas) && im.vagas > 2
            : e.id === 'quartos'
              ? temNum(im.quartos) && im.quartos > 3
              : im.atributos?.[e.id] === true;
        if (!temos) continue;
        const esc = r.preco.aneis.find((a) => a.anel === r.preco.anel);
        const coerente = esc ? Math.abs(esc.dif_hom!) <= 0.15 || esc.dif_hom! < 0 : false;
        const n_com = e.id === 'vagas' ? 1803 : e.id === 'quartos' ? 2204 : e.n_com;
        const ROB = (
          {
            frente_mar: { boot_regiao_lo: 0.14, sem_modelo: 1.4, passa4: true },
            frente_avenida: { boot_regiao_lo: 0.14, sem_modelo: 0.014, passa4: false },
            vagas: { boot_regiao_lo: 0.039, passa4: true },
            quartos: { boot_regiao_lo: 0.03, passa4: true },
            condominio_fechado: { passa4: true },
          } as Record<string, { boot_regiao_lo?: number; sem_modelo?: number; passa4: boolean }>
        )[e.id] || { passa4: false };
        const motivos: string[] = [];
        if (!e.confiavel) motivos.push('margem de 95% cruza o zero');
        if (!ROB.passa4)
          motivos.push(
            `não passa nos 4 testes (sem modelo dá ${ROB.sem_modelo != null ? pct(ROB.sem_modelo) : '?'})`,
          );
        if (!((n_com as number) >= 30))
          motivos.push(`só ${n_com} anúncios com o atributo (mínimo 30)`);
        if (!coerente)
          motivos.push(
            `incoerente: mesmo homogeneizado com o atributo, o nosso fica ${esc ? pct(esc.dif_hom) : '?'} (fora do 'no preço')`,
          );
        if (M.ficha5a) motivos.push('FICHA 5A: preço em correção, não explicar preço');
        r.candidatos.push({
          id: `A1.${e.id}`,
          familia: 'atributo',
          efeito: e.efeito,
          lo: e.lo,
          hi: e.hi,
          n_com,
          coerente,
          dif_hom: esc ? esc.dif_hom : null,
          boot_regiao_lo: ROB.boot_regiao_lo ?? null,
          classe: motivos.length
            ? 'não'
            : Math.min(e.lo, ROB.boot_regiao_lo ?? e.lo) >= 0.2
              ? 'A'
              : 'B',
          bloqueio: motivos,
        });
      }
    }
    r.regiao_fatos = regiao(im);
    /* hipótese: a região como se a equipe confirmasse o bairro (só para a tela) */
    if (M.censo_ok === false)
      r.regiao_se_confirmar = regiao({ ...im, censo_ok: undefined })
        .filter((f) => f.forca)
        .map((f) => ({ id: f.id, forca: f.forca }));
    const nomeB = nomeBairroDe[im.regiao];
    if (nomeB) {
      const c = construcao(nomeB);
      if (c) r.regiao_fatos.push(c);
      const v = valorizacao(nomeB);
      if (v) r.regiao_fatos.push(v);
      if (t === 'terreno') {
        const n = nivelApto(nomeB);
        if (n) r.regiao_fatos.push(n);
      }
    }
    const comP = r.candidatos
      .flatMap((c) =>
        c.conjuntos ? c.conjuntos.map((x) => ({ ref: x, p: x.p })) : [{ ref: c, p: c.p }],
      )
      .filter((x) => temNum(x.p)) as Array<{ ref: Candidato; p: number; bh?: boolean }>;
    bh(comP);
    comP.forEach((x) => (x.ref.bh = x.bh));
    out.imoveis.push(r);
  }
  {
    const pi = (B.procura?.por_imovel || [])
      .map((x) => ({ codigo: x.codigo_carteira, min: x.conversas_min, max: x.conversas_max }))
      .sort((a, b) => b.min - a.min);
    const [a, b] = pi;
    const tot = B.procura?.conversas?.leads_de_imovel || 16;
    out.procura =
      a && b
        ? {
            lider: a,
            segundo: b,
            p_lider_vs_2o: 1 - binCdf(a.min - 1, a.min + b.max),
            p_acima_da_media: 1 - binCdf(a.min - 1, tot, 1 / 12),
            total: tot,
            periodo: B.procura?.periodo,
          }
        : null;
  }
  out.construcao_cidade = { alvaras_21_23: NCID1, alvaras_17_19: NCID0 };
  for (const r of out.imoveis)
    for (const c of r.candidatos) {
      for (const x of c.conjuntos || [c])
        if (x.classe === 'A' && temNum(x.manuais) && x.n && x.manuais / x.n > 0.5) {
          x.classe = 'B';
          x.teto_r3 = `R3: ${x.manuais} de ${x.n} anúncios só do levantamento manual`;
        }
    }
  const manuaisDe = (lista: AnuncioDaBase[]): number => lista.filter(manual).length;
  const X = out.extras;
  function valorTotal(im: Imovel): ValorTotal {
    const l = juntarRepetidos(
      A.filter(
        (a) =>
          a.regiao === im.regiao &&
          mesmoTipo(a, im) &&
          a.quartos === im.atributos?.quartos &&
          temNum(a.preco) &&
          !(temNum(im.area) && proprio(a, im)),
      ),
    ).lista;
    guardar(im.codigo, 'P3.valor_total', l);
    const s = ord(l.map((a) => a.preco));
    const n = s.length;
    const nosso = im.preco as number;
    const kRuim = s.filter((v) => v <= nosso).length;
    return {
      n,
      pedem_mais: n - kRuim,
      med: quantil(s, 0.5),
      q1: quantil(s, 0.25),
      pSinal: pSinal(kRuim, n),
      p: percentil(s, nosso),
      pior: percentil(s.slice(0, n - Math.ceil(n * 0.1)), nosso),
      manuais: manuaisDe(l),
      nome: nomeDoConjunto(l, im, 'regiao'),
      quartos: im.atributos?.quartos,
    };
  }
  for (const [cod, quartos] of Object.entries(P3_DO_CADERNO)) {
    const imP = B.ims.find((x) => x.codigo === cod);
    if (imP && temNum(imP.preco))
      X[`${cod}_P3`] = valorTotal({
        ...imP,
        atributos: { ...imP.atributos, quartos: imP.atributos?.quartos ?? quartos },
      });
  }
  X.fipe_natal = B.fipe_natal;
  /* A1 de vagas, só com casas de rua (núcleo §3.3): ln(m²) por ln(área), quartos, vagas e região */
  X.a1_vagas_casas = (() => {
    const cs = B.anuncios.filter(
      (a) =>
        a.usado_nas_medias !== false &&
        a.grupo === 'casa' &&
        temNum(a.m2) &&
        temNum(a.vagas) &&
        temNum(a.area) &&
        a.area > 0,
    );
    if (cs.length < 30) return null;
    const regs = [...new Set(cs.map((a) => a.regiao))];
    const Xm = cs.map((a) => [
      1,
      Math.log(a.area),
      temNum(a.quartos) ? Math.min(a.quartos, 6) : 3,
      Math.min(a.vagas as number, 6),
      ...regs.slice(1).map((g) => (a.regiao === g ? 1 : 0)),
    ]);
    const o = (() => {
      try {
        return ols(
          Xm,
          cs.map((a) => Math.log(a.m2)),
        );
      } catch {
        return null;
      }
    })();
    if (!o || !o.b || !o.se || !temNum(o.b[3]) || !temNum(o.se[3])) return null;
    const b = o.b[3];
    const se = o.se[3];
    return {
      n: cs.length,
      regioes: regs.length,
      efeito: Math.exp(b) - 1,
      lo: Math.exp(b - 1.96 * se) - 1,
      hi: Math.exp(b + 1.96 * se) - 1,
      modelo: 'ln(m²) ~ ln(área) + quartos + vagas + região, só casas de rua (sem condomínio)',
    };
  })();
  X.fora_da_cidade = FORA_DA_CIDADE;
  X.lotes_cond_v3 = A.filter(
    (a) =>
      baseG(a.grupo) === 'terreno' &&
      loteCondominio(a) &&
      !(
        a.condominio_fechado === true ||
        /condom/i.test(a.subtipo || '') ||
        /condom[ií]nio|loteamento fechado/i.test(a.titulo || '')
      ),
  ).map((a) => `${a.regiao}: ${a.titulo}`);
  for (const r of out.imoveis) guardar(r.ref, 'P1.m2', PROVA_DO_PRECO.get(r.codigo));
  return { out, LISTAS, A, provas: PROVAS };
}
