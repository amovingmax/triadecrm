/**
 * Tipos e vocabulário do Radar (PRD §7.3, RF-RAD-*; anexo R03).
 *
 * As linhas vêm da RPC `public.radar_fila`. Como no resto do produto, os nulos
 * são redeclarados aqui à mão: o gerador de tipos do Supabase declara toda coluna
 * de `returns table (...)` como não-nula, e no Radar quase tudo pode faltar — é da
 * natureza de um alvo colhido em fonte pública.
 */

/** Situação de um candidato na esteira (enum `app.candidate_status`). */
export type SituacaoCandidato = 'novo' | 'aprovado' | 'recusado' | 'mesclado';

/** Filtro de situação da fila; `todos` não é valor do enum, é o "sem recorte". */
export type FiltroSituacao = SituacaoCandidato | 'todos';

/** Tipo da fonte (enum `app.source_kind`). */
export type TipoDeFonte = 'scrape' | 'import' | 'manual' | 'api' | 'referral';

/** Duplicata sugerida por `app.find_org_matches` para um candidato. */
export type Duplicata = {
  organization_id: string;
  name: string;
  /** 0 a 1. Só é exibida como porcentagem. */
  confidence: number;
  /** Regra que casou: cnpj, place_id, instagram, phone, domain, name_trgm... */
  reason: string;
};

export type CandidatoDaFila = {
  id: string;
  nome: string;
  status: SituacaoCandidato;
  fonte_id: number;
  fonte: string;
  fonte_tipo: TipoDeFonte;
  source_url: string | null;
  categoria_id: number | null;
  categoria: string | null;
  tipo: string;
  cidade: string | null;
  bairro: string | null;
  /** Já vem mascarado para sdr e embaixador (RF-BAS-14). */
  telefone: string | null;
  tem_telefone: boolean;
  instagram: string | null;
  site: string | null;
  cnpj: string | null;
  email: string | null;
  observacao: string | null;
  /** Avisos da higiene de entrada (RF-RAD-16). */
  sinalizacoes: string[];
  nao_contatar: boolean;
  /** Score do RF-RAD-12: nulo até o coletor existir. */
  pontuacao: number | null;
  coletado_em: string;
  coletor: string;
  criado_em: string;
  revisado_em: string | null;
  revisado_por: string | null;
  motivo_da_revisao: string | null;
  organizacao_id: string | null;
  duplicatas: Duplicata[];
  total_count: number;
};

export type ResultadoDaFila = {
  linhas: CandidatoDaFila[];
  total: number;
};

/** Uma fonte do catálogo (`public.sources`), com o registro de operação do RF-RAD-01. */
export type FonteDoRadar = {
  id: number;
  slug: string;
  nome: string;
  tipo: TipoDeFonte;
  base_url: string | null;
  base_legal: string;
  avaliacao: string | null;
  /** `null` = robots.txt ainda não avaliado; sem isso a fonte não liga (RF-RAD-01). */
  robots_ok: boolean | null;
  ligada: boolean;
  /** Segundos entre requisições (RF-RAD-03: nunca menos de 3 s em scraping). */
  intervalo_segundos: number;
  /** Fase do coletor no calendário: `mvp`, `v1` ou nada declarado. */
  fase: string | null;
  /** Tipo de coletor: http, csv_import, playwright, api, manual, spreadsheet... */
  coletor: string | null;
  /** Periodicidade planejada (mensal, trimestral, sob demanda). */
  periodicidade: string | null;
  /** O coletor desta fonte já está pronto para rodar? Hoje só o Casamentos.com.br tem adaptador escrito. */
  coletor_pronto: boolean;
  /** Campos que a fonte pode persistir (RF-RAD-04). */
  campos: string[];
  /** Trecho do robots.txt relevante, quando o anexo R03 registrou. */
  robots_nota: string | null;
  /** Fonte que hoje depende de curadoria humana (Instagram, Sympla). */
  curadoria_manual: boolean;
};

export type ResumoDoRadar = {
  novos: number;
  aprovados: number;
  mesclados: number;
  recusados: number;
  revisados_hoje: number;
  novos_sem_contato: number;
  novos_marcados: number;
  fontes_total: number;
  fontes_ligadas: number;
  fontes_com_coletor_pronto: number;
  organizacoes: number;
};

// ---------------------------------------------------------------------------
// Catálogos e filtros
// ---------------------------------------------------------------------------

export type OpcaoSimples = { id: number; nome: string };
/** Fonte como opção de filtro e de formulário; `ligada` decide se pode ser escolhida. */
export type OpcaoFonte = { id: number; nome: string; ligada: boolean };
export type OpcaoCategoriaRadar = { id: number; slug: string; nome: string; grupo: string };
export type OpcaoCidadeRadar = { id: number; nome: string; grandeNatal: boolean };

export type CatalogosDoRadar = {
  categorias: OpcaoCategoriaRadar[];
  cidades: OpcaoCidadeRadar[];
  origens: OpcaoFonte[];
};

export type FiltrosDaFila = {
  situacao: FiltroSituacao;
  fonteId: number | null;
  categoriaId: number | null;
  q: string;
  soMarcados: boolean;
  pagina: number;
};

export const FILTROS_INICIAIS: FiltrosDaFila = {
  situacao: 'novo',
  fonteId: null,
  categoriaId: null,
  q: '',
  soMarcados: false,
  pagina: 1,
};

export const POR_PAGINA = 20;

export function temRecorteNaFila(f: FiltrosDaFila): boolean {
  return Boolean(f.fonteId || f.categoriaId || f.q.trim() || f.soMarcados);
}

// ---------------------------------------------------------------------------
// Vocabulário
// ---------------------------------------------------------------------------

export const ROTULO_SITUACAO: Record<FiltroSituacao, string> = {
  novo: 'Esperando revisão',
  aprovado: 'Aprovados',
  mesclado: 'Mesclados',
  recusado: 'Recusados',
  todos: 'Todos',
};

export const ROTULO_TIPO_DE_FONTE: Record<TipoDeFonte, string> = {
  scrape: 'Coleta em página pública',
  import: 'Importação de arquivo',
  api: 'API oficial',
  manual: 'Cadastro à mão',
  referral: 'Indicação',
};

/** O que cada marca da higiene de entrada quer dizer, e o que fazer com ela. */
export const EXPLICACAO_DA_MARCA: Record<string, { rotulo: string; explicacao: string }> = {
  cpf_descartado: {
    rotulo: 'CPF descartado',
    explicacao:
      'O nome vinha com um CPF colado (típico de MEI). O número foi apagado na entrada e não está guardado em lugar nenhum.',
  },
  ddd_de_fora: {
    rotulo: 'DDD de fora',
    explicacao:
      'O telefone não é do RN nem de estado vizinho. Confira antes de aprovar: pode ser erro de digitação ou empresa de outra praça.',
  },
  instagram_fora_do_padrao: {
    rotulo: '@ fora do padrão',
    explicacao:
      'O que veio no campo do Instagram não é um @ válido e não foi guardado. Corrija pela ficha depois de aprovar.',
  },
  telefone_invalido: {
    rotulo: 'Telefone impossível',
    explicacao:
      'O número não fecha como telefone brasileiro e não foi guardado. Procure o número certo antes de aprovar.',
  },
  cnpj_invalido: {
    rotulo: 'CNPJ não fecha',
    explicacao: 'O dígito verificador do CNPJ está errado; ele não foi guardado.',
  },
  sem_contato: {
    rotulo: 'Sem canal de contato',
    explicacao:
      'Não há telefone, @, e-mail nem site. Aprovar cria a ficha, mas ninguém consegue falar com esse alvo ainda.',
  },
  suprimido: {
    rotulo: 'Pediu para não ser contatado',
    explicacao:
      'Este contato está na lista de supressão (RF-ADM-04). Não pode virar alvo, em nenhum modo.',
  },
};

/** Como a duplicata foi encontrada, em português. */
export const ROTULO_DA_REGRA: Record<string, string> = {
  cnpj: 'mesmo CNPJ',
  place_id: 'mesmo local no Google Maps',
  instagram: 'mesmo @ no Instagram',
  phone: 'mesmo WhatsApp',
  landline_neighborhood: 'mesmo fixo, no mesmo bairro',
  domain: 'mesmo site',
  name_trgm: 'nome muito parecido',
};

/**
 * Nome em português de cada campo da lista permitida do RF-RAD-04.
 *
 * No banco eles são chaves técnicas (`fields_whitelist`), porque é o worker quem
 * vai lê-las. Na tela, quem lê é a Heloísa.
 */
export const ROTULO_DO_CAMPO: Record<string, string> = {
  name: 'nome',
  category: 'categoria',
  address: 'endereço',
  neighborhood: 'bairro',
  cep: 'CEP',
  source_url: 'link de origem',
  rating: 'nota',
  reviews_count: 'nº de avaliações',
  price_from: 'preço "a partir de"',
  capacity: 'capacidade',
  place_id: 'identificador do local no Maps',
  primary_type: 'tipo principal',
  phone: 'telefone',
  phone_from_bio: 'telefone da bio',
  phone_from_text: 'telefone no texto do anúncio',
  website: 'site',
  lat: 'latitude',
  lng: 'longitude',
  instagram_handle: '@instagram',
  followers_count: 'nº de seguidores',
  media_count: 'nº de publicações',
  description: 'descrição',
  events_count: 'nº de eventos',
};

/** Nome em português do tipo de coletor previsto para cada fonte (`config.collector.kind`). */
export const ROTULO_DO_COLETOR: Record<string, string> = {
  http: 'leitura de página',
  csv_import: 'carga do arquivo da Receita',
  playwright: 'navegador automatizado',
  api: 'API oficial',
  business_discovery: 'API oficial do Instagram',
  manual: 'cadastro por pessoa',
  spreadsheet: 'importação de planilha',
};

// ---------------------------------------------------------------------------
// Saúde da esteira de coleta (RF-ADM-07; RPC `public.esteira_saude`)
// ---------------------------------------------------------------------------

/** Uma batida de ponto de worker (`public.worker_heartbeats`). */
export type BatidaDeWorker = {
  worker: string;
  instancia: string;
  status: 'ok' | 'degradado' | 'parado';
  fila: string | null;
  versao: string | null;
  host: string | null;
  ultima_batida: string;
  /** Segundos desde a última batida, contados pelo relógio do banco. */
  ha_segundos: number;
  /** O veredito do banco: batida nos últimos 2 minutos. A tela não recalcula isso. */
  vivo: boolean;
  processados: number;
  falhas: number;
};

/** Profundidade de uma fila `pgmq` da esteira. */
export type FilaDaEsteira = {
  fila: string;
  na_fila: number;
  visiveis: number;
  mais_antigo_segundos: number | null;
  total_ja_enfileirado: number;
};

export type SaudeDaEsteira = {
  workers: BatidaDeWorker[];
  filas: FilaDaEsteira[];
  coletor_vivo: boolean;
  lotes_rodando: number;
  capturas_por_expurgar: number;
  registros_por_resolver: number;
  ultimo_expurgo: string | null;
};

/** Um lote de coleta (`public.import_batches`), como a tela do Radar precisa dele. */
export type LoteDeColeta = {
  id: string;
  rotulo: string;
  status: 'previa' | 'na_fila' | 'rodando' | 'concluido' | 'falhou' | 'desfeito';
  fonte: string | null;
  capturas: number | null;
  candidatos: number | null;
  erro: string | null;
  comecou_em: string | null;
  terminou_em: string | null;
  criado_em: string;
};

/** Nome em português de cada fila da esteira, para quem lê a tela não ver `ingest_dlq`. */
export const ROTULO_DA_FILA: Record<string, { nome: string; explicacao: string }> = {
  ingest_jobs: {
    nome: 'Coletas a planejar',
    explicacao: 'Ordens de coleta esperando o robô ler o catálogo da fonte e montar as páginas.',
  },
  ingest_pages: {
    nome: 'Páginas a buscar',
    explicacao: 'Listagens esperando a vez, no intervalo que cada fonte permite.',
  },
  ingest_records: {
    nome: 'Capturas a resolver',
    explicacao: 'O que já foi baixado e ainda vai virar candidato na fila de revisão.',
  },
  ingest_dlq: {
    nome: 'Parou com erro',
    explicacao:
      'O que falhou além do limite de tentativas. Ninguém tenta de novo sozinho: é leitura de gente.',
  },
};

export const ROTULO_DO_LOTE: Record<LoteDeColeta['status'], string> = {
  previa: 'Aberto, ainda sem ordem na fila',
  na_fila: 'Esperando o coletor',
  rodando: 'Em andamento',
  concluido: 'Concluída',
  falhou: 'Parou com erro',
  desfeito: 'Desfeita',
};
