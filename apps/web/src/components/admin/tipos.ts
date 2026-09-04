/**
 * Tipos e vocabulário da tela de Admin (PRD §7.9, RF-ADM-01 a RF-ADM-06).
 *
 * A tela tem três partes que não se misturam: quem tem acesso (pessoas), as listas
 * que o CRM usa para funcionar (catálogos) e as ferramentas de LGPD. Cada parte é uma
 * aba, e cada aba tem seções. Aba e seção vivem na URL para que um link possa apontar
 * direto para "a auditoria de ontem" sem obrigar quem abre a procurar.
 */
import type { AppRole } from '@/lib/auth/role';

export type Aba = 'pessoas' | 'catalogos' | 'lgpd';

export const ABAS: readonly { id: Aba; rotulo: string; descricao: string }[] = [
  {
    id: 'pessoas',
    rotulo: 'Pessoas',
    descricao: 'Quem entra no CRM, com que papel, e quem está na lista de permitidos.',
  },
  {
    id: 'catalogos',
    rotulo: 'Catálogos',
    descricao: 'As listas que o CRM usa para classificar, agendar e decidir sozinho.',
  },
  {
    id: 'lgpd',
    rotulo: 'LGPD',
    descricao: 'Quem pediu para parar, quem viu telefone, o que mudou e a exportação.',
  },
];

/** Seções da aba de catálogos. A ordem é a do uso diário, não a alfabética. */
export type SecaoCatalogo =
  'categorias' | 'cidades' | 'feriados' | 'motivos' | 'desfechos' | 'modelos';

export const SECOES_CATALOGO: readonly SecaoCatalogo[] = [
  'categorias',
  'cidades',
  'feriados',
  'motivos',
  'desfechos',
  'modelos',
];

export const ROTULO_CATALOGO: Record<SecaoCatalogo, string> = {
  categorias: 'Categorias',
  cidades: 'Cidades',
  feriados: 'Feriados',
  motivos: 'Motivos de perda',
  desfechos: 'Desfechos',
  modelos: 'Modelos de mensagem',
};

/** Seções da aba de LGPD. */
export type SecaoLgpd = 'supressao' | 'telefones' | 'auditoria' | 'exportar';

export const SECOES_LGPD: readonly SecaoLgpd[] = [
  'supressao',
  'telefones',
  'auditoria',
  'exportar',
];

export const ROTULO_LGPD: Record<SecaoLgpd, string> = {
  supressao: 'Lista de supressão',
  telefones: 'Telefones revelados',
  auditoria: 'Auditoria',
  exportar: 'Exportar parceiro',
};

/**
 * Papéis que podem ser atribuídos na tela.
 *
 * `bot` fica de fora de propósito: é a identidade dos workers (service role restrito
 * por RLS, RF-ADM-01) e não pertence a uma pessoa. Dar `bot` a alguém no dropdown
 * seria conceder um papel que não foi desenhado para ter dono.
 */
export const PAPEIS_ATRIBUIVEIS: readonly AppRole[] = [
  'admin',
  'gestor',
  'sdr',
  'embaixador',
  'leitura',
  'financeiro',
];

/** Uma linha em português para cada papel, para a pessoa saber o que está concedendo. */
export const O_QUE_O_PAPEL_FAZ: Record<AppRole, string> = {
  admin: 'Tudo, inclusive papéis, auditoria e exportação.',
  gestor: 'Gerencia a base, os catálogos e as metas; lê telefone sem revelar.',
  sdr: 'Trabalha a carteira em campo; telefone só pelo botão que fica registrado.',
  embaixador: 'Vê apenas os parceiros que indicou; sem telefone completo e sem exportar.',
  leitura: 'Só lê. Não cria, não move e não envia.',
  financeiro: 'Leitura com telefone de base, para conciliação.',
  bot: 'Identidade dos workers. Não é dada a pessoas.',
};

export type Pessoa = {
  id: string;
  nome: string;
  papel: AppRole;
  ativo: boolean;
  timeId: number | null;
  time: string | null;
  criadoEm: string;
};

export type Permitido = {
  id: number;
  email: string;
  papel: AppRole;
  nota: string | null;
  criadoEm: string;
  /** Id de quem autorizou; o nome é resolvido na tela, com o diretório do time. */
  criadoPorId: string | null;
};

export type Dominio = {
  id: number;
  dominio: string;
  papelPadrao: AppRole;
  ativo: boolean;
};

export type DadosPessoas = {
  pessoas: Pessoa[];
  times: { id: number; nome: string }[];
};

export type DadosPermitidos = {
  permitidos: Permitido[];
  dominios: Dominio[];
};

export type Categoria = {
  id: number;
  slug: string;
  nome: string;
  grupo: string;
  prioridade: number;
  ativo: boolean;
  parceiros: number;
};

export type Cidade = {
  id: number;
  nome: string;
  uf: string;
  grandeNatal: boolean;
  parceiros: number;
};

export type Feriado = {
  id: number;
  data: string;
  nome: string;
  escopo: string;
};

export type MotivoDePerda = {
  id: number;
  slug: string;
  nome: string;
  ativo: boolean;
  posicao: number;
  negocios: number;
};

export type Desfecho = {
  id: number;
  slug: string;
  nome: string;
  superficies: string[];
  ativo: boolean;
  silencioDias: number;
  podeReativar: boolean;
  proximaAcaoRotulo: string | null;
  proximaAcaoDias: number | null;
  etapaDestino: string | null;
  temperatura: string | null;
  exigeMotivoDePerda: boolean;
  contaComo: string;
  usos: number;
};

export type ModeloDeMensagem = {
  id: number;
  codigo: string;
  nome: string;
  canal: string;
  categoria: string;
  segmento: string | null;
  variante: string | null;
  corpo: string;
  variaveis: string[];
  versao: number;
  ativo: boolean;
  statusMeta: string | null;
};

export type DadosCatalogos = {
  categorias: Categoria[];
  cidades: Cidade[];
  feriados: Feriado[];
  motivos: MotivoDePerda[];
  desfechos: Desfecho[];
  modelos: ModeloDeMensagem[];
};

export type LinhaSupressao = {
  id: number;
  hash: string;
  tipo: string;
  motivo: string | null;
  canal: string | null;
  quando: string;
  quemId: string | null;
  parceiro: string | null;
  parceiroId: string | null;
  evidencia: string | null;
};

export type ParceiroSemContato = {
  id: string;
  nome: string;
  bairro: string | null;
  cidade: string | null;
};

export type LinhaTelefoneRevelado = {
  id: number;
  quemId: string;
  papel: string | null;
  acao: string;
  parceiro: string | null;
  parceiroId: string | null;
  quando: string;
};

export type LinhaAuditoria = {
  id: number;
  quemId: string | null;
  papel: string | null;
  acao: string;
  tabela: string;
  registroId: string;
  registro: string | null;
  mudancas: { campo: string; de: string | null; para: string | null; oculto: boolean }[];
  quando: string;
};

/** Recorte dos dois registros da aba LGPD: uma pessoa e um dia. */
export type FiltroRegistro = {
  pessoaId: string | null;
  dia: string | null;
};

export const FILTRO_VAZIO: FiltroRegistro = { pessoaId: null, dia: null };

export const POR_PAGINA = 50;

/**
 * Aba e seção iniciais vindas da query string.
 *
 * Ficam aqui, e não no componente de tela, porque a página do servidor precisa
 * CHAMAR estas funções: importar uma função de um módulo `use client` no servidor
 * devolve uma referência de cliente, não a função.
 */
export function abaDaUrl(valor: string | string[] | undefined): Aba {
  const texto = Array.isArray(valor) ? valor[0] : valor;
  return ABAS.some((item) => item.id === texto) ? (texto as Aba) : 'pessoas';
}

export function catalogoDaUrl(aba: Aba, valor: string | string[] | undefined): SecaoCatalogo {
  const texto = Array.isArray(valor) ? valor[0] : valor;
  if (aba === 'catalogos' && SECOES_CATALOGO.includes(texto as SecaoCatalogo)) {
    return texto as SecaoCatalogo;
  }
  return 'categorias';
}

export function lgpdDaUrl(aba: Aba, valor: string | string[] | undefined): SecaoLgpd {
  const texto = Array.isArray(valor) ? valor[0] : valor;
  if (aba === 'lgpd' && SECOES_LGPD.includes(texto as SecaoLgpd)) {
    return texto as SecaoLgpd;
  }
  return 'supressao';
}
