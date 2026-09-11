import type { OrgKind, Temperature } from '@komune/schema';

/**
 * Tipos da tela de Parceiros.
 *
 * As linhas vêm da RPC `public.search_organizations`. O gerador de tipos do Supabase
 * declara toda coluna de `returns table (...)` como não-nula, o que não é verdade
 * (categoria, cidade, bairro, responsável e etapa faltam com frequência na base real).
 * Por isso a linha é redeclarada aqui com os nulos honestos: é o que a interface tem
 * de tratar, e o TypeScript passa a cobrar o tratamento.
 */
export type LinhaParceiro = {
  id: string;
  name: string;
  kind: OrgKind;
  primary_category: string | null;
  city: string | null;
  neighborhood: string | null;
  /** Já vem mascarado do banco para sdr e embaixador (RF-BAS-14). */
  phone: string | null;
  instagram_handle: string | null;
  temperature: Temperature;
  owner: string | null;
  stage: string | null;
  next_action_at: string | null;
  last_activity_at: string | null;
  /** Dias inteiros desde o último contato; `null` quando nunca houve contato. */
  days_since_contact: number | null;
  /** Negócio passou do prazo da etapa (PRD §5.6): liga o pulso da barra térmica. */
  needs_attention: boolean;
  /**
   * O último contato DE GENTE — atividade com desfecho. Todos nulos quando ninguém
   * falou com o parceiro ainda, que é o caso de três quartos da base.
   *
   * São a leitura do CONTATO. `last_activity_at`/`days_since_contact` acima vêm do
   * negócio e alimentam a temperatura, que tem outra regra.
   */
  last_outcome_slug: string | null;
  /** O rótulo do desfecho, no vocabulário do catálogo: "Não atendeu", "Decisor interessado". */
  last_outcome_name: string | null;
  /** Houve conversa (`aberta`), tentou e não falou (`batida`) ou número inválido (`nenhuma`). */
  last_outcome_counts_as: PortaDoContato | null;
  /** A temperatura que o desfecho aplica, quando aplica. É ela que pinta a tag. */
  last_outcome_temperature: Temperature | null;
  last_contact_channel: string | null;
  last_contact_at: string | null;
  /** Quem fez o contato. Para duas pessoas não ligarem para o mesmo parceiro na mesma manhã. */
  last_contact_by: string | null;
  /** Quantos contatos de gente já houve. "Não atendeu" na quarta tentativa não é o da primeira. */
  contact_attempts: number;
  total_count: number;
};

/** O eixo `counts_as` do catálogo de desfechos (`app.door_kind`). */
export type PortaDoContato = 'aberta' | 'batida' | 'nenhuma';

/**
 * O filtro de contato, pelo ÚLTIMO contato de gente. Espelha os valores que
 * `search_organizations(p_contato)` aceita — a função recusa qualquer outro, porque
 * um filtro que falha em silêncio devolve a base inteira.
 */
export type SituacaoDoContato = 'nunca' | 'sem_conversa' | 'conversou' | 'invalido';

export const SITUACOES_DO_CONTATO: readonly { valor: SituacaoDoContato; rotulo: string }[] = [
  { valor: 'nunca', rotulo: 'Ainda não contatado' },
  { valor: 'sem_conversa', rotulo: 'Tentou, sem conversa' },
  { valor: 'conversou', rotulo: 'Já conversou' },
  { valor: 'invalido', rotulo: 'Número inválido' },
];

function ehSituacao(v: string): v is SituacaoDoContato {
  return SITUACOES_DO_CONTATO.some((s) => s.valor === v);
}

export type ResultadoBusca = {
  linhas: LinhaParceiro[];
  total: number;
};

// ---------------------------------------------------------------------------
// Catálogos que alimentam os filtros (lidos do banco no servidor)
// ---------------------------------------------------------------------------

export type OpcaoCategoria = { id: number; slug: string; nome: string; grupo: string };
export type OpcaoCidade = { id: number; nome: string; uf: string; grandeNatal: boolean };
export type OpcaoEtapa = { id: number; nome: string; funil: string };
export type OpcaoPessoa = { id: string; nome: string };
export type OpcaoOrigem = { id: number; nome: string };

export type Catalogos = {
  categorias: OpcaoCategoria[];
  cidades: OpcaoCidade[];
  etapas: OpcaoEtapa[];
  pessoas: OpcaoPessoa[];
  origens: OpcaoOrigem[];
};

// ---------------------------------------------------------------------------
// Estado da busca
// ---------------------------------------------------------------------------

/** 50 por página: é o que cabe numa rolagem de polegar sem paginar a toda hora. */
export const POR_PAGINA = 50;

export type FiltrosParceiros = {
  /** Texto livre: nome, telefone em qualquer formato, @instagram, CNPJ ou bairro. */
  q: string;
  categoriaId: number | null;
  cidadeId: number | null;
  etapaId: number | null;
  responsavelId: string | null;
  /** Recorte pelo último contato de gente. */
  contato: SituacaoDoContato | null;
  /** Começa em 1. */
  pagina: number;
};

export const FILTROS_VAZIOS: FiltrosParceiros = {
  q: '',
  categoriaId: null,
  cidadeId: null,
  etapaId: null,
  responsavelId: null,
  contato: null,
  pagina: 1,
};

/** Há algum recorte aplicado? Separa "a base está vazia" de "o filtro não achou nada". */
export function temRecorte(f: FiltrosParceiros): boolean {
  return (
    f.q.trim() !== '' ||
    f.categoriaId !== null ||
    f.cidadeId !== null ||
    f.etapaId !== null ||
    f.responsavelId !== null ||
    f.contato !== null
  );
}

/** Quantos filtros de lista (fora a busca) estão ligados: alimenta o contador do botão. */
export function contarFiltros(f: FiltrosParceiros): number {
  return [f.categoriaId, f.cidadeId, f.etapaId, f.responsavelId, f.contato].filter(
    (v) => v !== null,
  ).length;
}

// ---------------------------------------------------------------------------
// Estado dos filtros na URL
// ---------------------------------------------------------------------------

/** Lê os filtros da query string (usada no servidor, a partir de `searchParams`). */
export function filtrosDaUrl(params: Record<string, string | string[] | undefined>) {
  const texto = (chave: string): string => {
    const v = params[chave];
    return typeof v === 'string' ? v : '';
  };
  const inteiro = (chave: string): number | null => {
    const n = Number.parseInt(texto(chave), 10);
    return Number.isFinite(n) && n > 0 ? n : null;
  };

  return {
    ...FILTROS_VAZIOS,
    q: texto('q'),
    categoriaId: inteiro('categoria'),
    cidadeId: inteiro('cidade'),
    etapaId: inteiro('etapa'),
    responsavelId: texto('responsavel') || null,
    // Valor desconhecido na URL vira "sem filtro", e não um erro: é um link velho
    // ou digitado à mão, e a lista inteira é uma resposta melhor que uma tela quebrada.
    contato: ehSituacao(texto('contato')) ? (texto('contato') as SituacaoDoContato) : null,
    pagina: inteiro('pagina') ?? 1,
  } satisfies FiltrosParceiros;
}

/** Escreve os filtros na query string, omitindo o que está no padrão. */
export function urlDosFiltros(f: FiltrosParceiros): string {
  const p = new URLSearchParams();
  if (f.q.trim()) p.set('q', f.q.trim());
  if (f.categoriaId) p.set('categoria', String(f.categoriaId));
  if (f.cidadeId) p.set('cidade', String(f.cidadeId));
  if (f.etapaId) p.set('etapa', String(f.etapaId));
  if (f.responsavelId) p.set('responsavel', f.responsavelId);
  if (f.contato) p.set('contato', f.contato);
  if (f.pagina > 1) p.set('pagina', String(f.pagina));
  const busca = p.toString();
  return busca ? `?${busca}` : '';
}
