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
  // O `(cid)` não é decoração: o CSV do Maps tem uma coluna chamada `place_id`
  // que NÃO é esta — o CRM guarda o `cid` (ADR-12). Sem o parêntese, o recibo
  // diz "ID do lugar no Maps" e a coluna `place_id` aparece entre as ignoradas,
  // e quem confere conclui que o CRM perdeu o identificador.
  place_id: 'ID do lugar no Maps (cid)',
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
  /**
   * O texto CRU da categoria, como a fonte escreveu.
   *
   * É o que a tela de resolver agrupa e o que o cartão da fila mostra. Sem ele
   * a pergunta continuaria sendo por linha.
   */
  categoria_origem: string | null;
  avisos: string[];
};

export type Contagem = Partial<Record<Decisao, number>>;

/** Uma categoria do catálogo do CRM, para as listas suspensas da importação. */
export type CategoriaDoCatalogo = { id: number; nome: string };

/**
 * Um nome de categoria que a fonte usou e o CRM não conhece.
 *
 * A unidade da pergunta mudou: era uma decisão por LINHA (36 cartões nas 40
 * linhas de 25/09/2026), passa a ser uma por NOME (13), e a resposta fica
 * gravada em `public.source_category_map` — na lista seguinte, zero.
 */
export type CategoriaNova = {
  nome_na_fonte: string;
  linhas: number;
  /** Até três nomes de empresa. Não é enfeite: ver §3 abaixo. */
  exemplos: string[];
  /**
   * A sugestão por radical de palavra. NUNCA vem marcada.
   *
   * Pré-marcar e deixar confirmar tudo num clique é o carimbo silencioso com
   * outro nome: na lista do buffet ele transformaria "Restaurante
   * self-service" em Buffet adulto, o funil erraria, a meta de déficit
   * erraria, e alguém abriria conversa com o pitch errado.
   */
  sugestao_id: number | null;
  sugestao_nome: string | null;
};

export type Previa = {
  contagem: Contagem;
  linhas: LinhaDaPrevia[];
  categoriasNovas: CategoriaNova[];
};

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
  entra: 'viram parceiro',
  duplicata: 'já estão na base',
  revisao: 'param na fila',
  nao_contatar: 'já pediram para não receber',
  repetida: 'já tinham entrado',
  erro: 'não entram',
};

/**
 * Uma frase que explica o grupo inteiro, no plural, para quem nunca importou nada.
 *
 * QUATRO DESTAS FRASES MENTIAM, e as quatro foram conferidas contra o código
 * em 25/09/2026:
 *   · `entra` prometia "a etapa e o responsável da planilha". O CSV do Maps não
 *     tem nem etapa nem responsável, e `app.promover_candidato` nasce com
 *     `v_owner := coalesce(p_owner_id, auth.uid())` (20260905000100:425) e a
 *     primeira etapa do funil (:514-518): quem importou vira o dono.
 *   · `revisao` citava "o nome se parece com uma ficha existente". A prévia só
 *     manda para `revisao` por `categoria_desconhecida` e `origem_desconhecida`
 *     (20260924130000:652-659); nome parecido cai em `duplicata`, no `elsif` de
 *     cima. `parecida_com_ficha` é código morto.
 *   · `nao_contatar` dizia que "o número entra na lista de supressão". É ao
 *     contrário: a linha cai aí porque `v_cand.do_not_contact` JÁ era verdadeiro
 *     (20260904001820:920-921). Importar NUNCA põe ninguém na supressão, e lida
 *     por um gestor a frase antiga fazia acreditar que resolvia opt-out.
 *   · `duplicata` falava em "candidato" e "recusar", que são nomes internos.
 */
export const EXPLICACAO_DECISAO: Record<Decisao, string> = {
  entra:
    'Entram na base e no funil, na primeira etapa, com você como responsável. Se o arquivo trouxer etapa ou responsável, vale o que está nele.',
  duplicata:
    'Nada é sobrescrito. Cada uma para na fila, com o parceiro parecido já apontado, para você juntar os dois ou descartar.',
  revisao:
    'O CRM não reconheceu a categoria que veio no arquivo. Você escolhe a categoria na fila e elas viram parceiro.',
  nao_contatar:
    'Essas empresas já tinham pedido para parar. Não entram, e ninguém volta a escrever.',
  repetida:
    'Vieram numa importação anterior, ou repetidas dentro deste mesmo arquivo. Nada é criado de novo.',
  erro: 'Sem nome, ou sem telefone, @ e CNPJ: não há como falar com essa empresa. Corrija no arquivo e mande de novo.',
};

/**
 * A frase debaixo do botão de gravar, montada da contagem.
 *
 * POR QUÊ: "12 viram ficha agora; o resto vai para a fila de Revisão ou não
 * entra" escondia justamente o que a pessoa precisa saber antes de clicar —
 * quantas param na fila, e por quê. A frase agora nomeia cada grupo com o seu
 * número, e "o resto" deixa de existir.
 */
export function fraseDaPrevia(contagem: Contagem): string {
  const entra = contagem.entra ?? 0;
  const resto = ORDEM_DAS_DECISOES.filter((d) => d !== 'entra')
    .map((d) => ({ decisao: d, n: contagem[d] ?? 0 }))
    .filter((g) => g.n > 0);
  const total = entra + resto.reduce((soma, g) => soma + g.n, 0);

  const cabeca =
    entra === 0
      ? 'Nenhuma vira parceiro agora.'
      : `${entra} ${entra === 1 ? 'vira parceiro' : 'viram parceiro'} agora.`;
  if (resto.length === 0) return cabeca;

  const partes = resto.map((g) => {
    switch (g.decisao) {
      case 'duplicata':
        return `${g.n} ${g.n === 1 ? 'para' : 'param'} na fila porque já ${g.n === 1 ? 'está' : 'estão'} na base`;
      case 'revisao':
        return `${g.n} ${g.n === 1 ? 'para' : 'param'} na fila esperando categoria`;
      case 'nao_contatar':
        return `${g.n} já ${g.n === 1 ? 'pediu' : 'pediram'} para não receber`;
      case 'repetida':
        return `${g.n} já ${g.n === 1 ? 'tinha' : 'tinham'} entrado`;
      default:
        return `${g.n} não ${g.n === 1 ? 'entra' : 'entram'}`;
    }
  });
  const outras = total - entra;
  const lista =
    partes.length === 1 ? partes[0]! : `${partes.slice(0, -1).join(', ')} e ${partes.at(-1)!}`;
  return `${cabeca} ${outras === 1 ? 'A outra não some' : `As outras ${outras} não somem`}: ${lista}.`;
}

/**
 * O que dizer quando NENHUMA linha virou parceiro.
 *
 * POR QUÊ: o aviso de hoje olhava só `contagem.entra === 0` e afirmava sempre
 * "Nada novo entrou: essas linhas já estavam na base." No lote dos fotógrafos
 * de 25/09/2026 NENHUMA era duplicata — 19 pararam por categoria e 1 deu erro.
 * A tela disse o contrário do que tinha acabado de acontecer.
 *
 * A frase agora se monta do MAIOR grupo, que é o que de fato explica o zero. O
 * empate desempata por `ORDEM_DAS_DECISOES`, que já põe o que exige decisão na
 * frente.
 */
export function fraseDeZero(contagem: Contagem): string {
  const grupos = ORDEM_DAS_DECISOES.filter((d) => d !== 'entra').map((d) => ({
    decisao: d,
    n: contagem[d] ?? 0,
  }));
  const maior = grupos.reduce((a, b) => (b.n > a.n ? b : a), grupos[0]!);
  if (maior.n === 0) return 'Nenhuma linha entrou.';

  const n = maior.n;
  const plural = n === 1 ? 'a' : 'as';
  switch (maior.decisao) {
    case 'duplicata':
      return `Nada novo entrou — ess${plural} ${n} já ${n === 1 ? 'estava' : 'estavam'} na base.`;
    case 'revisao':
      return `Nenhuma virou parceiro ainda: ${plural === 'a' ? 'a' : 'as'} ${n} ${
        n === 1 ? 'parou' : 'pararam'
      } na fila esperando categoria.`;
    case 'nao_contatar':
      return `Nenhuma entrou: ${n} já ${n === 1 ? 'tinha pedido' : 'tinham pedido'} para não receber.`;
    case 'repetida':
      return `Nada novo entrou — ess${plural} ${n} já ${n === 1 ? 'tinha' : 'tinham'} entrado antes.`;
    default:
      return `Nenhuma entrou: ${n} ${n === 1 ? 'linha' : 'linhas'} sem nome ou sem contato.`;
  }
}

/** Motivos que as funções do banco devolvem, escritos para quem está importando. */
export const MOTIVO: Record<string, string> = {
  sem_nome: 'A linha não tem nome.',
  sem_contato: 'Sem WhatsApp, sem @ e sem CNPJ: não há como falar com essa empresa.',
  pediu_para_parar: 'Já tinha pedido para não receber. Não entra, e ninguém volta a escrever.',
  repetida_no_arquivo: 'A mesma empresa aparece mais de uma vez na planilha.',
  ja_existe_na_base: 'Já tem parceiro na base.',
  categoria_desconhecida: 'A categoria não bate com nenhuma do catálogo.',
  origem_desconhecida: 'A origem não bate com nenhuma fonte cadastrada.',
  ja_importado: 'Já tinha entrado numa importação anterior.',
  lote_anterior: 'Veio de um lote anterior.',
  ja_revisado: 'Esse nome já foi decidido.',
  sem_candidato: 'O CRM não conseguiu montar este nome.',
  campo_fora_da_whitelist: 'A linha trazia um campo que o CRM não pode guardar.',
  sem_identidade_na_fonte: 'A linha não tem como ser reconhecida na próxima importação.',
  promocao_recusada: 'A ficha não pôde ser criada.',
  categoria_obrigatoria: 'Sem categoria não dá para escolher o funil.',
  categoria_invalida: 'Essa categoria não está mais ativa.',
  candidato_nao_contatar: 'Esse contato está na lista de supressão.',
  captura_recusada: 'O CRM recusou a linha.',
  processamento_recusado: 'O CRM não conseguiu processar a linha.',
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
