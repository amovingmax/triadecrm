/**
 * O vocabulário da importação de planilha (RF-BAS-07).
 *
 * As 17 colunas são exatamente as da planilha-ponte (`docs/planilha-ponte/`), que
 * é o instrumento de transição do Dia 0: a equipe registra ali todo contato feito
 * entre 04 e 09/09 e, no D2, a planilha entra no CRM. Por isso os nomes de campo
 * aqui são os nomes do cabeçalho de lá, e não uma tradução nova.
 */
import type { AppRole } from '@/lib/auth/role';

/**
 * Espelho de `app.is_manager()`: quem desfaz um lote de importação (RF-BAS-17).
 *
 * Não é o mesmo conjunto de quem IMPORTA (`podeCriarParceiro`, que inclui sdr e
 * embaixador), e essa diferença era o §3.7 do laudo: a Heloísa é sdr, importava,
 * via o botão "Desfazer este lote", apertava e levava um 42501 traduzido como "o
 * servidor não respondeu como esperado". Quem decide continua sendo o Postgres;
 * isto só evita oferecer um botão que já se sabe que vai ser recusado.
 */
const PAPEIS_QUE_DESFAZEM: readonly AppRole[] = ['admin', 'gestor'];

export function podeDesfazerLote(papel: AppRole): boolean {
  return PAPEIS_QUE_DESFAZEM.includes(papel);
}

/** Campos que o CRM entende. A ordem é a de leitura da planilha. */
export const CAMPOS = [
  'nome',
  'tipo',
  'categoria',
  'whatsapp',
  'origem',
  'origem_detalhe',
  'cidade',
  'bairro',
  'instagram',
  'etapa',
  'responsavel',
  'ultimo_contato',
  'canal_ultimo_contato',
  'resultado',
  'proxima_acao',
  'data_proxima_acao',
  'observacoes',
] as const;

export type Campo = (typeof CAMPOS)[number];

/** Rótulo de cada campo na interface. */
export const ROTULO_CAMPO: Record<Campo, string> = {
  nome: 'Nome',
  tipo: 'Tipo',
  categoria: 'Categoria',
  whatsapp: 'WhatsApp',
  origem: 'Origem',
  origem_detalhe: 'Detalhe da origem',
  cidade: 'Cidade',
  bairro: 'Bairro',
  instagram: 'Instagram',
  etapa: 'Etapa',
  responsavel: 'Responsável',
  ultimo_contato: 'Último contato',
  canal_ultimo_contato: 'Canal do último contato',
  resultado: 'Resultado',
  proxima_acao: 'Próxima ação',
  data_proxima_acao: 'Data da próxima ação',
  observacoes: 'Observações',
};

/**
 * Campos sem os quais a linha não vira ficha.
 *
 * `origem` está aqui por LGPD, e não por capricho de esquema: a abertura da
 * conversa precisa dizer de onde veio o número (R06), e uma ficha que não sabe
 * responder isso não deveria ter nascido.
 */
export const CAMPOS_OBRIGATORIOS: readonly Campo[] = ['nome', 'categoria', 'origem'];

/**
 * Campos que a planilha-ponte não tem, mas que outras listas trazem.
 *
 * Os cinco últimos entraram com o CSV do `google-maps-scraper-kit` (spec do pivô
 * de 24/09/2026, §3.1): `app.importacao_normalizar` já sabia montar 9 chaves de
 * payload enquanto `app.payload_e_permitido` permitia 22, e o que o Maps entrega
 * de mais valioso — e-mail, endereço e o `cid` do lugar — caía nesse estreitamento.
 *
 * A ORDEM IMPORTA, e não é estética: `TODOS_OS_CAMPOS` é `[...CAMPOS, ...CAMPOS_EXTRAS]`,
 * `acharCampo` percorre os campos nessa ordem e para no primeiro acerto. Entrando
 * por último, nenhum campo novo pode roubar por semelhança uma coluna que hoje
 * casa com um campo antigo.
 *
 * `nota` e `avaliacoes_qtd` são sinal numérico de pontuação e NUNCA vão para a
 * tela como avaliação (RF-RAD-04): é a exceção consciente ao R06 SCR-02.
 */
export const CAMPOS_EXTRAS = [
  'cnpj',
  'site',
  'place_id',
  'email',
  'endereco',
  'nota',
  'avaliacoes_qtd',
] as const;
export type CampoExtra = (typeof CAMPOS_EXTRAS)[number];
export const ROTULO_EXTRA: Record<CampoExtra, string> = {
  cnpj: 'CNPJ',
  site: 'Site',
  place_id: 'ID do lugar no Maps',
  email: 'E-mail',
  endereco: 'Endereço',
  nota: 'Nota do Google',
  avaliacoes_qtd: 'Nº de avaliações',
};

export type CampoQualquer = Campo | CampoExtra;

export const TODOS_OS_CAMPOS: readonly CampoQualquer[] = [...CAMPOS, ...CAMPOS_EXTRAS];

/** O campo é obrigatório? Aceita qualquer campo, e não só os da planilha-ponte. */
export function ehObrigatorio(campo: CampoQualquer): boolean {
  return (CAMPOS_OBRIGATORIOS as readonly string[]).includes(campo);
}

export function rotuloDoCampo(campo: CampoQualquer): string {
  return campo in ROTULO_CAMPO
    ? ROTULO_CAMPO[campo as Campo]
    : ROTULO_EXTRA[campo as CampoExtra];
}

// ---------------------------------------------------------------------------
// A origem do lote
// ---------------------------------------------------------------------------

/** Uma fonte do catálogo que aceita arquivo: o que o seletor de origem lista. */
export type OrigemDeArquivo = {
  /** `sources.id` — é o `source_id` do lote em `import_batches`. */
  id: number;
  /** `sources.slug` — só serve para a tela escolher o padrão. */
  slug: string;
  /**
   * `sources.name`, e é ele que vai injetado em cada linha.
   *
   * O slug também casaria: `app.importacao_fonte` procura por
   * `app.chave_catalogo(s.name) = k or app.chave_catalogo(s.slug) = k`
   * (`20260904001820:227-229`), e as duas chaves levam à mesma linha. Manda-se
   * o NOME porque é o texto que a pessoa acabou de ler no seletor, e é o texto
   * que volta para a tela: `public.importacao_previa` devolve a coluna "Origem"
   * como `v_n ->> 'source_nome'` (`:748`), ou seja, o nome que está no banco.
   * Escrever o nome faz a ida e a volta dizerem a mesma coisa.
   */
  nome: string;
};

/**
 * A fonte entra no seletor quando `config.entrada_por_arquivo` é verdadeiro.
 *
 * Não é `kind = 'import'` nem `is_enabled`: `is_enabled` governa a COLETA
 * automática (`public.esteira_abrir_lote` só o consulta para `p_kind = 'coleta'`,
 * `20260904001600:1788-1790`), e a fonte do Maps nasce desligada de propósito —
 * a raspagem roda fora do CRM, num Docker em 127.0.0.1. Quem diz "esta fonte
 * entra por arquivo que uma pessoa sobe" é a chave da config, e só ela.
 *
 * Aceita `true` e `"true"`: o jsonb guarda booleano, e um filtro de PostgREST
 * por `config->>entrada_por_arquivo` devolveria texto.
 */
export function ehEntradaPorArquivo(config: unknown): boolean {
  if (typeof config !== 'object' || config === null) return false;
  const valor = (config as Record<string, unknown>).entrada_por_arquivo;
  return valor === true || valor === 'true';
}

// ---------------------------------------------------------------------------
// O arquivo lido
// ---------------------------------------------------------------------------

/** O que o leitor devolve, seja de XLSX ou de CSV. */
export type PlanilhaLida = {
  /** Nome da aba lida (o CSV usa o nome do arquivo). */
  aba: string;
  /** Abas encontradas no arquivo, para a pessoa saber que existem outras. */
  abas: string[];
  cabecalho: string[];
  /** Linhas de dados, já sem o cabeçalho e sem as linhas totalmente vazias. */
  linhas: string[][];
  /** Linhas que existiam no arquivo e foram cortadas pelo teto de leitura. */
  cortadas: number;
  /**
   * Linhas ignoradas ANTES do cabeçalho — o título que quase toda planilha tem
   * na primeira linha. Zero na maioria dos arquivos.
   *
   * A tela precisa disto para dizer o que fez: pular linha em silêncio é como
   * a pessoa passa vinte minutos procurando uma coluna que o CRM decidiu que
   * não existia.
   */
  tituloIgnorado: string[];
};

/** Mapa coluna → campo. O índice é a posição da coluna no cabeçalho. */
export type Mapa = Partial<Record<CampoQualquer, number>>;

// ---------------------------------------------------------------------------
// O que o banco devolve
// ---------------------------------------------------------------------------

export type Decisao = 'entra' | 'duplicata' | 'revisao' | 'nao_contatar' | 'erro' | 'repetida';

export type Duplicata = {
  organization_id: string;
  nome: string;
  visivel: boolean;
  confianca: number;
  chave: string;
};

export type LinhaDaPrevia = {
  linha: number;
  nome: string | null;
  decisao: Decisao;
  motivo: string | null;
  duplicata: Duplicata | null;
  categoria: string | null;
  cidade: string | null;
  origem: string | null;
  etapa: string | null;
  responsavel: string | null;
  telefone: string | null;
  avisos: string[];
};

export type Contagem = Partial<Record<Decisao, number>>;

export type Previa = { contagem: Contagem; linhas: LinhaDaPrevia[] };

export type LinhaGravada = {
  linha: number;
  nome: string | null;
  decisao: Decisao;
  motivo: string | null;
  organization_id: string | null;
  organizacao: string | null;
  candidate_id: string | null;
};

export type Recibo = {
  loteId: string;
  rotulo: string;
  contagem: Contagem;
  linhas: LinhaGravada[];
  desfazerAte: string | null;
};

export type LoteAnterior = {
  id: string;
  rotulo: string;
  status: string;
  stats: Contagem;
  criado_em: string;
  terminou_em: string | null;
  desfazer_ate: string;
  pode_desfazer: boolean;
  quem: string | null;
  organizacoes: number;
};

/** Ordem em que os grupos aparecem na prévia: primeiro o que exige decisão. */
export const ORDEM_DAS_DECISOES: readonly Decisao[] = [
  'entra',
  'duplicata',
  'revisao',
  'nao_contatar',
  'repetida',
  'erro',
];

export const ROTULO_DECISAO: Record<Decisao, string> = {
  entra: 'Entra na base',
  duplicata: 'Já existe',
  revisao: 'Vai para revisão',
  nao_contatar: 'Não contatar',
  repetida: 'Já importado antes',
  erro: 'Não dá para importar',
};

/** Uma frase que explica o grupo inteiro, no plural, para quem nunca importou nada. */
export const EXPLICACAO_DECISAO: Record<Decisao, string> = {
  entra: 'Viram ficha e negócio no funil, com a etapa e o responsável da planilha.',
  duplicata:
    'Já tem ficha na base. Nada é sobrescrito: cada uma vira candidato na fila do Radar, onde você mescla ou recusa.',
  revisao:
    'Falta um dado que o CRM não pode adivinhar (categoria, origem) ou o nome se parece com uma ficha existente. Vão para a fila do Radar.',
  nao_contatar:
    'Pediram para parar. Não viram alvo: o número entra na lista de supressão e ninguém volta a escrever.',
  repetida:
    'Já tinham entrado: numa importação anterior, ou numa linha acima desta mesma planilha. Nada é criado de novo.',
  erro: 'Falta o nome ou falta qualquer forma de contato. Corrija na planilha e importe de novo.',
};

/** Motivos que as funções do banco devolvem, escritos para quem está importando. */
export const MOTIVO: Record<string, string> = {
  sem_nome: 'A linha não tem nome.',
  sem_contato: 'Sem WhatsApp, sem @ e sem CNPJ: não há como falar com essa empresa.',
  pediu_para_parar: 'Pediu para parar. O número vai para a lista de supressão.',
  repetida_no_arquivo: 'A mesma empresa aparece mais de uma vez na planilha.',
  ja_existe_na_base: 'Já tem ficha na base.',
  parecida_com_ficha: 'O nome se parece com o de uma ficha que já existe.',
  categoria_desconhecida: 'A categoria não bate com nenhuma do catálogo.',
  origem_desconhecida: 'A origem não bate com nenhuma fonte cadastrada.',
  ja_importado: 'Já tinha entrado numa importação anterior.',
  lote_anterior: 'Veio de um lote anterior.',
  ja_revisado: 'Esse candidato já foi revisado no Radar.',
  sem_candidato: 'A esteira não conseguiu montar o candidato.',
  campo_fora_da_whitelist: 'A linha trazia um campo que a esteira não pode guardar.',
  sem_identidade_na_fonte: 'A linha não tem como ser reconhecida na próxima importação.',
  promocao_recusada: 'A ficha não pôde ser criada.',
  categoria_obrigatoria: 'Sem categoria não dá para escolher o funil.',
  categoria_invalida: 'Essa categoria não está mais ativa.',
  candidato_nao_contatar: 'Esse contato está na lista de supressão.',
  captura_recusada: 'A esteira recusou a linha.',
  processamento_recusado: 'A esteira não conseguiu processar a linha.',
};

/** Avisos da normalização: o que mudou ou o que ficou sem resolver, linha a linha. */
export const AVISO: Record<string, string> = {
  telefone_invalido: 'WhatsApp fora do padrão: ficou sem telefone.',
  instagram_invalido: 'O @ não parece um perfil do Instagram.',
  cnpj_invalido: 'O CNPJ não fecha nos dígitos.',
  categoria_desconhecida: 'Categoria não reconhecida.',
  categoria_aproximada: 'Categoria casada por semelhança: confira.',
  cidade_desconhecida: 'Cidade fora do catálogo.',
  origem_desconhecida: 'Origem não reconhecida.',
  etapa_desconhecida: 'Etapa não reconhecida: o negócio nasce na primeira do funil.',
  etapa_aproximada: 'Etapa casada por semelhança: confira.',
  responsavel_desconhecido: 'Responsável não encontrado: a ficha fica com você.',
  responsavel_ambiguo: 'Mais de uma pessoa com esse nome: a ficha fica com você.',
  tipo_diferente_da_categoria: 'O tipo discorda da categoria. Quem manda é a categoria.',
  data_invalida: 'Data que não dá para ler.',
  cpf_descartado: 'Havia um CPF na linha. Foi apagado antes de gravar: o CRM não guarda CPF.',
};

export function textoDoMotivo(motivo: string | null): string | null {
  if (!motivo) return null;
  return MOTIVO[motivo] ?? null;
}

export function textoDoAviso(aviso: string): string {
  return AVISO[aviso] ?? aviso;
}
