/**
 * Os contratos entre os coletores, a rodada e o banco.
 *
 * Um coletor não conhece o banco: recebe o contexto (a fonte da lista, o
 * navegador educado, as regiões, o estado da rodada anterior) e entrega o que
 * leu a um `Gravador`. Na rodada de verdade o gravador chama as funções do
 * banco; no ensaio e nos testes, ele só guarda na memória.
 */
import type { Logger } from '../lib/log';
import type { Regioes } from './regioes';
import type { Navegador } from './web';

/** A linha de `mercado_fontes` que o worker lê (só o que ele usa). */
export interface FonteDaLista {
  id: string;
  nome: string;
  grupo: string;
  url: string | null;
  veredito: 'PERMITIDA' | 'CONDICIONAL' | 'PROIBIDA';
  intervalo_min_seg: number | null;
  max_por_rodada: number | null;
  licenca: string | null;
  frequencia: string;
  coletor: string | null;
  liberada: boolean;
  reconferir: boolean;
  pode_coletar: boolean;
}

/** Um anúncio no formato de `public.mercado_anuncios_registrar`. */
export interface ItemAnuncio {
  id_externo: string;
  url: string;
  modo: 'venda' | 'aluguel';
  tipo: string;
  subtipo?: string | null;
  titulo?: string | null;
  preco?: number | null;
  area_util?: number | null;
  area_total?: number | null;
  quartos?: number | null;
  suites?: number | null;
  banheiros?: number | null;
  vagas?: number | null;
  valor_condominio?: number | null;
  atributos?: Record<string, boolean | number>;
  bairro?: string | null;
  cidade?: string | null;
  logradouro?: string | null;
  localidade?: string | null;
  regiao_id?: string | null;
  lat?: number | null;
  lng?: number | null;
  loc_precisao?: 'exata' | 'esquina' | 'rua' | 'bairro' | 'aproximada' | null;
  consulta_id?: string | null;
  consulta_completa?: boolean;
  data_dado?: string | null;
  hash_bruto?: string | null;
  marcas?: string[];
  bruto?: Record<string, unknown>;
}

/** Um ponto de série mensal (`mercado_indices`). */
export interface LinhaIndice {
  serie: string;
  /** Primeiro dia do mês do dado (AAAA-MM-01). */
  mes: string;
  valor: number;
  nome: string;
  unidade: string;
  local?: string | null;
  regiao_id?: string | null;
  sub?: string | null;
  modo?: 'venda' | 'aluguel' | null;
  amostra?: number | null;
  aproximado?: boolean;
  metodo: string;
  url: string;
  obs?: string | null;
}

/** Um ato ou obra (`mercado_obras`). */
export interface LinhaObra {
  id_externo: string;
  url: string;
  documento?: string | null;
  tipo: 'alvara' | 'habite_se' | 'licenca' | 'loteamento' | 'obra_publica' | 'outro';
  fase: 'prevista' | 'contratada' | 'em_andamento' | 'concluida';
  orgao?: string | null;
  objeto: string;
  local_texto?: string | null;
  bairro?: string | null;
  cidade?: string | null;
  regiao_id?: string | null;
  lat?: number | null;
  lng?: number | null;
  precisao_ponto?: 'exata' | 'esquina' | 'rua' | 'bairro' | 'aproximada' | null;
  unidades?: number | null;
  valor?: number | null;
  publicado_em: string;
}

/** O que fica perto de um imóvel nosso ou de um anúncio (`mercado_proximidades`). */
export interface LinhaProximidade {
  imovel_codigo?: string | null;
  mercado_anuncio_id?: string | null;
  categoria:
    | 'praia'
    | 'costa'
    | 'escola'
    | 'mercado'
    | 'hospital'
    | 'clinica'
    | 'posto_saude'
    | 'shopping'
    | 'avenida'
    | 'parque'
    | 'farmacia'
    | 'transporte'
    | 'outro';
  osm_tipo: 'node' | 'way' | 'relation';
  osm_id: number;
  osm_versao?: number | null;
  osm_timestamp?: string | null;
  etiqueta: string;
  nome?: string | null;
  lat?: number | null;
  lng?: number | null;
  distancia_m: number;
  precisao_ponto: 'exata' | 'esquina';
  url: string;
  data_dado: string;
}

export interface ResumoDaGravacao {
  novos: number;
  atualizados: number;
  ignorados: number;
  recusados: number;
  erros: Array<{ id_externo?: string; erro: string }>;
}

/** Quem recebe o que o coletor leu. Grava em lotes e devolve o que o banco disse. */
export interface Gravador {
  anuncios(itens: readonly ItemAnuncio[]): Promise<ResumoDaGravacao>;
  /** Anúncios vistos no índice (mapa do site) e não relidos nesta rodada: continuam no ar. */
  vistos(idsExternos: readonly string[]): Promise<number>;
  indices(linhas: readonly LinhaIndice[]): Promise<number>;
  obras(linhas: readonly LinhaObra[]): Promise<number>;
  proximidades(linhas: readonly LinhaProximidade[]): Promise<number>;
}

/** Um ponto que o coletor de proximidades mede (anúncio com ponto exato). */
export interface PontoParaMedir {
  mercado_anuncio_id?: string;
  imovel_codigo?: string;
  regiao_id: string | null;
  lat: number;
  lng: number;
  precisao: 'exata' | 'esquina';
}

export interface ContextoDoColetor {
  fonte: FonteDaLista;
  navegador: Navegador;
  regioes: Regioes;
  gravador: Gravador;
  logger: Logger;
  /** Hoje, em Fortaleza (AAAA-MM-DD). */
  dia: string;
  /** Até quando a rodada pode trabalhar (epoch ms). */
  prazo: number;
  /** O estado que a última rodada boa desta fonte deixou (cursor, rodízio). */
  estadoAnterior: Record<string, unknown>;
  /** Lê os pontos a medir (só o coletor de proximidades usa). */
  pontos?: () => Promise<PontoParaMedir[]>;
  agora?: () => number;
}

export interface ResultadoDoColetor {
  /** A fonte foi lida até o fim, sem interrupção nem erro (vai para o relatório da coleta). */
  completa: boolean;
  /**
   * As consultas (`consulta_id`) lidas até o fim nesta rodada. Só anúncio de
   * consulta completa que não apareceu ganha falta (e, com 2, sai do ar):
   * uma busca interrompida não diz nada sobre quem saiu.
   */
  consultasCompletas?: string[];
  /** Impressão digital (sha256) do bruto da rodada inteira. */
  hashBruto: string | null;
  /** O estado para a próxima rodada (vai em `mercado_coletas.detalhes.estado`). */
  estado?: Record<string, unknown>;
  /** Contagens e avisos para `mercado_coletas.detalhes`. */
  detalhes: Record<string, unknown>;
  erros: string[];
}

export interface Coletor {
  /** O nome em `mercado_fontes.coletor` (ex.: "anuncios/chavesnamao"). */
  readonly chave: string;
  /** Hosts a mais que a fonte usa, além do host do `url` dela na lista. */
  readonly hostsExtras?: readonly string[];
  /** Ritmo mínimo do coletor (ms), se for mais lento que o da fonte. */
  readonly intervaloMinimoMs?: number;
  /** Teto de pedidos quando a lista não dá um. */
  readonly maxPedidosPadrao: number;
  /** O caminho que precisa estar aberto no robots para a fonte rodar. */
  readonly caminhoDeTeste?: string;
  coletar(ctx: ContextoDoColetor): Promise<ResultadoDoColetor>;
}
