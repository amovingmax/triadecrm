/**
 * Tipos e vocabulário da Revisão (PRD §7.3, RF-RAD-*).
 *
 * A tela mudou de nome em 25/09/2026; o banco não. `radar_fila`, `radar_resumo`
 * e `app.radar_pontuar` continuam com o nome que têm, e os invólucros aqui
 * carregam esse nome de propósito — quem procurar `ResumoDoRadar` no código
 * precisa achar a função `public.radar_resumo()` do outro lado.
 *
 * As linhas vêm da RPC `public.radar_fila`. Como no resto do produto, os nulos
 * são redeclarados aqui à mão: o gerador de tipos do Supabase declara toda
 * coluna de `returns table (...)` como não-nula, e aqui quase tudo pode faltar —
 * é da natureza de um alvo que entrou por lista, e não por conversa.
 */

/** Situação de um candidato na esteira (enum `app.candidate_status`). */
export type SituacaoCandidato = 'novo' | 'aprovado' | 'recusado' | 'mesclado';

/** Filtro de situação da fila; `todos` não é valor do enum, é o "sem recorte". */
export type FiltroSituacao = SituacaoCandidato | 'todos';

/**
 * O tipo da origem, como `app.source_kind` o escreve. Não é herança do catálogo
 * de fontes, que saiu em 25/09/2026: `public.radar_fila` devolve `fonte_tipo`
 * em cada linha, e a Revisão continua lendo isso.
 */
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

/**
 * As quatro faixas da triagem, no vocabulário que a tabela já usava num CHECK
 * desde o D4 — não em "alta/media/baixa", que seria um segundo idioma para a
 * mesma coisa.
 */
export type FaixaDaTriagem = 'A+' | 'A' | 'B' | 'C';

/** O que cada faixa quer dizer para quem revisa, em uma linha. */
export const EXPLICACAO_DA_FAIXA: Record<FaixaDaTriagem, string> = {
  'A+': 'Sinal forte: nota alta, muita avaliação e no lugar certo. Comece por estes.',
  A: 'Vale o trabalho de achar o contato.',
  B: 'Tem algum sinal, mas não se destaca.',
  C: 'A fonte não trouxe sinal nenhum sobre este. Pode valer, mas ninguém sabe ainda.',
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
  /**
   * Como a FONTE chamou isto (`source_record.category_source`, do registro mais
   * recente).
   *
   * "Sem categoria" não ajuda ninguém a escolher entre 19 opções; "o Google
   * chamou de Impressões fotográficas" ajuda. É este texto que torna os 155
   * presos na fila decidíveis, e é por ele que a fila passa a agrupar.
   */
  categoria_na_fonte: string | null;
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
  /** Pontuação da triagem (RF-RAD-12), 0-100. Nula até a primeira repontuação. */
  pontuacao: number | null;
  /**
   * A faixa da pontuação: A+, A, B, C. Vem do banco junto com a pontuação, e não
   * é calculada aqui de propósito — os cortes estão em `app_settings` e mudam
   * sem deploy. Recalcular no navegador criaria uma segunda régua que diverge da
   * primeira no dia em que alguém mexer nos cortes.
   */
  faixa: FaixaDaTriagem | null;
  /**
   * O que a IA achou do NOME: `sim`, `nao` ou `incerto`, com a frase dela.
   *
   * É OPINIÃO, e a tela precisa mostrar isso: ela não aprova, não recusa e não
   * tira ninguém da fila (RF-RAD-08). `null` quando a IA ainda não leu — o que é
   * o estado normal de um candidato recém-coletado.
   */
  ia_veredito: 'sim' | 'nao' | 'incerto' | null;
  ia_porque: string | null;
  /**
   * A categoria que a IA sugeriu, já casada com o catálogo — e só quando casou
   * EXATO por `app.chave_catalogo`.
   *
   * É OPINIÃO, e não decisão (RF-RAD-11): ela abre o diálogo já preenchida, e o
   * trabalho humano sai de *escolher entre 19* e vira *confirmar ou trocar*.
   * Nada vira ficha sozinho.
   */
  ia_categoria_id: number | null;
  ia_categoria: string | null;
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

export type ResumoDoRadar = {
  novos: number;
  aprovados: number;
  mesclados: number;
  recusados: number;
  revisados_hoje: number;
  novos_sem_contato: number;
  novos_marcados: number;
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
  novo: 'Esperando você',
  aprovado: 'Aprovados',
  mesclado: 'Mesclados',
  recusado: 'Recusados',
  todos: 'Todos',
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
      'Não há telefone, @, e-mail nem site. Virar parceiro cria a ficha na base, mas ninguém consegue falar com essa empresa ainda.',
  },
  suprimido: {
    rotulo: 'Pediu para não ser contatado',
    explicacao:
      'Este contato está na lista de supressão. Não pode virar parceiro, em nenhum modo.',
  },
  // As duas de 25/09/2026. Sem elas o cartão renderizava o nome interno da
  // flag: `cartao-candidato.tsx` faz `{nota?.rotulo ?? marca}`, e quem importou
  // os 20 buffets leu, literalmente, "⚠ ja_existe_na_base".
  ja_existe_na_base: {
    rotulo: 'Já está na base',
    explicacao:
      'Um parceiro parecido já existe. Junte os dois em vez de criar um repetido.',
  },
  telefone_compartilhado: {
    rotulo: 'Telefone de mais de um negócio',
    explicacao:
      'O mesmo número aparece em outros lugares do Google. Pode ser a mesma empresa com duas unidades, ou duas empresas que dividem o telefone — confira antes de decidir.',
  },
  // A terceira que faltava, achada na conferência de 25/09/2026 pelo mesmo
  // caminho das duas de cima: `public.esteira_processar_captura` copia
  // `mudou_na_fonte` do `source_record` para as marcas do candidato
  // (20261001090000:606), e sem esta entrada o cartão escrevia, literalmente,
  // "⚠ mudou_na_fonte · Confira este dado antes de decidir." — que é o nome
  // interno da marca e não diz nem o que mudou nem o que fazer.
  mudou_na_fonte: {
    rotulo: 'Mudou na fonte',
    explicacao:
      'A fonte trouxe este nome de novo, com dado diferente do que estava guardado — telefone, endereço, situação do CNPJ. O CRM completou o que faltava e devolveu para você conferir antes de decidir.',
  },
};

/**
 * Toda marca que o banco sabe escrever, para o teste provar que nenhuma chega
 * à tela como nome interno.
 *
 * A lista é a do comentário de `public.source_record.flags`
 * (`20260904001600:422`) mais `ja_existe_na_base`, que
 * `app.resolver_source_record` põe no candidato.
 */
export const MARCAS_QUE_O_BANCO_ESCREVE: readonly string[] = [
  'cpf_descartado',
  'telefone_invalido',
  'ddd_de_fora',
  'instagram_fora_do_padrao',
  'cnpj_invalido',
  'sem_contato',
  'suprimido',
  'mudou_na_fonte',
  'telefone_compartilhado',
  'ja_existe_na_base',
];

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

// ---------------------------------------------------------------------------
// Retenção (PRD §10.6)
// ---------------------------------------------------------------------------

/**
 * Candidato em "novo" é apagado aos 90 dias de `created_at` por
 * `app.aplicar_retencao` (20260904001600), no cron das 04:00 de Fortaleza.
 * Cada rodada deixa relatório em `public.retention_runs`.
 *
 * O número mora aqui em espelho, não em contrato: quem manda é o banco. Se um
 * dia a regra mudar lá, esta constante mente — e é por isso que ela diz de onde
 * veio, em vez de só existir.
 */
export const PRAZO_DE_RETENCAO_DIAS = 90;

/** Quantos dias faltam para a retenção apagar este candidato. Nulo se a data não der. */
export function diasAteSumir(criadoEm: string | null, agora: Date): number | null {
  if (!criadoEm) return null;
  const nascimento = new Date(criadoEm);
  if (Number.isNaN(nascimento.getTime())) return null;
  const vividos = Math.floor((agora.getTime() - nascimento.getTime()) / 86_400_000);
  return Math.max(0, PRAZO_DE_RETENCAO_DIAS - vividos);
}
