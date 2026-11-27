/**
 * A entrada e a saída do motor das vantagens. A entrada é a "base" B que o
 * `montarBase()` do protótipo monta (`js/55-argumentos.js`); a saída é o dossiê
 * argumentos-imovel@3. Os nomes dos campos são os do protótipo, de propósito:
 * o teste de ouro compara o JSON inteiro.
 */

/** Um anúncio de terceiros já limpo (grupo, área de referência e m²). */
export interface AnuncioDaBase {
  id: string;
  fonte: string;
  regiao: string;
  grupo: string;
  tipo?: string | null;
  subtipo?: string | null;
  area: number;
  area_total?: number | null;
  area_util?: number | null;
  preco: number;
  m2: number;
  quartos?: number | null;
  suites?: number | null;
  banheiros?: number | null;
  vagas?: number | null;
  esquina?: boolean | null;
  frente_mar?: boolean | null;
  vista_mar?: boolean | null;
  condominio_fechado?: boolean | null;
  frente_avenida?: boolean | null;
  lazer?: boolean | null;
  valor_condominio?: number | null;
  bairro?: string | null;
  cidade?: string | null;
  logradouro?: string | null;
  titulo?: string | null;
  /** O levantamento marcou como suspeito: fica fora de tudo. */
  usado_nas_medias?: boolean;
  ativo?: boolean;
  /** Dia da última coleta automática que viu o anúncio; nulo = só do levantamento manual (regra R3). */
  ultima_coleta_auto?: string | null;
  dist_praia_m?: number | null;
  [campo: string]: unknown;
}

/** A previsão do modelo de preço para a unidade (sem modelo, nula). */
export interface PrevisaoDoModelo {
  m2?: number | null;
  lo?: number | null;
  hi?: number | null;
  erro_pct?: number | null;
  [campo: string]: unknown;
}

/** Uma unidade da carteira da Imova (o imóvel; ou cada lote e o conjunto). */
export interface UnidadeDaCarteira {
  codigo: string;
  titulo?: string;
  regiao: string;
  grupo: string | null;
  area: number | null;
  area_terreno?: number | null;
  preco: number | null;
  m2: number | null;
  pv?: PrevisaoDoModelo | null;
  comparavel?: boolean;
  motivo_sem_m2?: string | null;
  atributos?: Record<string, unknown>;
  quartos?: number | null;
  suites?: number | null;
  vagas?: number | null;
  bairro?: string | null;
  [campo: string]: unknown;
}

export interface RegiaoDaBase {
  id: string;
  nome: string;
  tipo?: string;
  cidade: string;
  lat?: number | null;
  lng?: number | null;
  vizinhos: Array<{ id: string; km: number }>;
}

/** O efeito de uma característica no m² (modelo de preço hedônico). */
export interface EfeitoDoModelo {
  id: string;
  efeito: number;
  lo: number;
  hi: number;
  confiavel: boolean;
  n_com: number | null;
}

export interface MoradoresDoCenso {
  nivel?: string;
  renda_media_responsavel?: number | null;
  renda_mediana_responsavel?: number | null;
  crescimento_2010_2022_pct?: number | null;
  pct_uso_ocasional?: number | null;
  estrangeiros_residentes_municipio?: {
    pct_populacao?: number | null;
    natal_pct_para_comparar?: number | null;
    [campo: string]: unknown;
  } | null;
  municipio?: {
    nome?: string;
    renda_media_responsavel?: number | null;
    renda_mediana_responsavel?: number | null;
    crescimento_2010_2022_pct?: number | null;
    pct_uso_ocasional?: number | null;
    [campo: string]: unknown;
  };
  [campo: string]: unknown;
}

export interface PerfilDaRegiao {
  nome?: string;
  moradores?: MoradoresDoCenso;
  valorizacao?: unknown;
}

export interface LinhaDaCorrida {
  tipo: string;
  amostra: number;
  cidade: string;
  bairro: string;
  m2_mediana: number;
  [campo: string]: unknown;
}

export type AlvarasDoBairro = Record<
  string,
  { n?: number; unidades?: number; [campo: string]: unknown }
>;

export interface SerieFipe {
  id: string;
  nome?: string;
  fonte?: string | null;
  ultimos: Array<[string, number]>;
}

export interface ProcuraDaCarteira {
  por_imovel?: Array<{
    codigo_carteira: string;
    conversas_min: number;
    conversas_max: number;
    [campo: string]: unknown;
  }>;
  conversas?: { leads_de_imovel?: number; [campo: string]: unknown };
  periodo?: unknown;
  [campo: string]: unknown;
}

/** A ficha do imóvel como o caderno a vê (fatos confirmados pela equipe). */
export interface FichaDaBase {
  codigo: string;
  codigo_crm?: string;
  titulo?: string;
  disponivel: boolean;
  regiao?: string;
  tipo?: string;
  finalidade?: string;
  atributos: Record<string, unknown>;
  bairro?: string;
}

/** A base B: tudo o que o motor recebe. */
export interface BaseDoMotor {
  anuncios: AnuncioDaBase[];
  ims: UnidadeDaCarteira[];
  reg: RegiaoDaBase[];
  /** Região → macrorregião (a do modelo de preço). */
  macro: Record<string, string>;
  /** Vazio quando a rodada não tem modelo de preço: preço e atributo não saem. */
  efeitos: { terreno: EfeitoDoModelo[]; construido: EfeitoDoModelo[] };
  perfis: Record<string, PerfilDaRegiao>;
  corrida: { cidade?: LinhaDaCorrida[]; coletado_em?: string; [campo: string]: unknown } | null;
  construcao: Record<string, AlvarasDoBairro> | null;
  fipe_natal: SerieFipe[];
  contexto_mercado: Array<{ texto: string; [campo: string]: unknown }> | null;
  procura: ProcuraDaCarteira | null;
  /** O dia da coleta (aaaa-mm-dd). */
  coleta: string;
  fichas: FichaDaBase[];
}

/* ------------------------------------------------------------------ */
/* A saída: o dossiê de cada imóvel (argumentos-imovel@3)             */
/* ------------------------------------------------------------------ */

export interface Validade {
  valido_ate: string | null;
  vence_com: string;
  motivo?: string;
}

export interface Vantagem {
  id: string;
  regra: string;
  familia: string;
  nivel: string;
  eixo: string;
  forca: string;
  status: string;
  texto_base: string;
  texto_curto?: string | null;
  ponte?: string;
  gatilhos: string[];
  so_com_preco_dito: boolean;
  explica_preco: boolean;
  numeros_obrigatorios: string[];
  comparacao?: {
    nosso: unknown;
    referencia: unknown;
    medida: string;
    n: number | null | undefined;
    conjunto?: string;
  };
  rigor?: Record<string, unknown>;
  prova: { fonte: string; data_dado: string; regra?: string };
  prova_cliente?: string;
  validade: Validade;
  aviso_obrigatorio?: string;
  retomada_v2?: boolean;
  supera?: { topo: boolean; regioes: string[]; bairros: string[] };
  _retomada?: boolean;
}

export interface Bloqueio {
  o_que: string;
  tipo: string;
  motivo: string;
  [campo: string]: unknown;
}

export interface ImovelDoDossie {
  ref: string;
  titulo_para_ia: string | undefined;
  regiao: string | null;
  disponivel: boolean;
  segmento: string | null;
  procura_conversas: [number, number] | null;
  ponto_apresentacao: string | null;
  ponto_usa?: { id: string };
  retomada: string[];
  retomada_v2: string[];
  nao_diga: string[];
  bloqueadas: Bloqueio[];
  avisos_equipe: string[];
  avisos_imovel: string[];
  vantagens: Vantagem[];
  propostas: Vantagem[];
  travas_objecao?: Record<string, { regra: string; o_que_fazer: string }>;
  possivel_mesmo_imovel?: boolean;
}

export interface Dossie {
  versao: string;
  rodada: Record<string, unknown>;
  imoveis: ImovelDoDossie[];
}
