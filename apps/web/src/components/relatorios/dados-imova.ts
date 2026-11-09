'use client';

import { createClient } from '@/lib/supabase/client';

import type { Periodo } from './periodo';

/**
 * A camada de dados dos relatórios da Imova (06/11/2026; migração 20261109200000).
 *
 * Como em `dados.ts`, nenhuma conta acontece aqui: cada painel chama uma função
 * `SECURITY DEFINER` do Postgres e recebe as linhas prontas (ADR-03). As funções só
 * existem no banco da Imova, por isso não estão nos tipos gerados (que saem do banco
 * da KOMUNE) e as linhas são descritas aqui, uma vez — como a tela da IA que atende
 * faz com `ia_atendente_painel`.
 */

async function rpc<T>(nome: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await createClient().rpc(nome as never, args as never);
  if (error) throw error;
  return data as T;
}

const doPeriodo = (periodo: Periodo) => ({ p_de: periodo.de, p_ate: periodo.ate });

// ---------------------------------------------------------------------------
// Visão geral
// ---------------------------------------------------------------------------

export type ContagemComValor = { valor: string; clientes: number };

export type VisaoGeral = {
  periodo: { de: string; ate: string };
  contatos: {
    novos: number;
    atendidos: number;
    mediana_primeira_resposta_min: number | null;
    em_ate_15_min: number;
    nunca_responderam: number;
  };
  agora: {
    esperando_resposta: number;
    esperando_mais_de_1h: number;
    esperando_desde: string | null;
    muito_interessados: number;
    interessados: number;
    esfriando: number;
    quentes_sem_proximo_passo: number;
    proxima_acao_vencida: number;
  };
  visitas: {
    marcadas: number;
    pela_ia: number;
    aconteceram: number;
    realizadas: number;
    faltaram: number;
    canceladas: number;
    sem_desfecho: number;
    proximas: number;
  };
  funil: { etapa: string; posicao: number; chegaram: number; ganho: boolean }[];
  fechados: number;
  perdidos: number;
  objecoes: { objecao: string; conversas: number }[];
  procura: { clientes: number; finalidade: ContagemComValor[]; tipos: ContagemComValor[] };
  procura_e_oferta: { bairro: string; procurando: number; anuncios: number }[];
  anuncios: {
    no_ar: number;
    visualizacoes_periodo: number | null;
    contatos_periodo: number | null;
    conversas: number | null;
    ultima_foto: string | null;
  };
};

export const carregarVisaoGeral = (periodo: Periodo) =>
  rpc<VisaoGeral>('relatorio_imova_visao_geral', doPeriodo(periodo));

// ---------------------------------------------------------------------------
// Clientes quentes (o retrato de agora, sem período)
// ---------------------------------------------------------------------------

export type LinhaQuente = {
  conversation_id: string;
  organization_id: string | null;
  nome: string;
  quem: 'Cliente' | 'Proprietário' | 'Sem ficha';
  calor: number;
  atitude: string | null;
  antes_de_esfriar: string | null;
  atitude_desde: string | null;
  nota_ia: number | null;
  intencao: string | null;
  motivo_ia: string | null;
  objecoes: string[];
  procura: string | null;
  imovel_de_interesse: string | null;
  ultima_do_cliente: string | null;
  esperando_resposta: boolean;
  responsavel: string | null;
  etapa: string | null;
  proxima_acao: string | null;
  proxima_acao_em: string | null;
  visita_em: string | null;
};

export const CHAVE_QUENTES = ['relatorios', 'quentes'] as const;

export const carregarQuentes = () =>
  rpc<LinhaQuente[] | null>('relatorio_imova_quentes', { p_limite: 200 }).then((l) => l ?? []);

// ---------------------------------------------------------------------------
// Anúncios
// ---------------------------------------------------------------------------

export type LinhaAnuncio = {
  codigo: string;
  titulo: string | null;
  /** 'CRM' (tem cartão na aba Anúncios) ou 'Canal Pro' (só existe lá). */
  onde: string;
  situacao: string | null;
  bairro: string | null;
  preco_venda: number | null;
  preco_aluguel: number | null;
  visualizacoes: number | null;
  visualizacoes_periodo: number | null;
  contatos: number | null;
  contatos_periodo: number | null;
  taxa_de_contato: number | null;
  conversas: number;
  visitas: number;
  foto_em: string | null;
};

export const carregarAnuncios = (periodo: Periodo) =>
  rpc<LinhaAnuncio[] | null>('relatorio_imova_anuncios', doPeriodo(periodo)).then((l) => l ?? []);

// ---------------------------------------------------------------------------
// Mensagens que funcionam
// ---------------------------------------------------------------------------

export type TipoDeModelo = 'modelo' | 'resposta_rapida' | 'texto_repetido';

export type LinhaMensagem = {
  chave: string;
  tipo: TipoDeModelo;
  nome: string | null;
  texto: string;
  envios: number;
  conversas: number;
  maduros: number;
  responderam: number;
  interessaram: number;
  visitas: number;
  taxa_resposta: number | null;
  taxa_positiva: number | null;
  taxa_visita: number | null;
  ultimo_envio: string;
};

export const carregarMensagens = (periodo: Periodo) =>
  rpc<LinhaMensagem[] | null>('relatorio_imova_mensagens', { ...doPeriodo(periodo), p_minimo: 3 }).then(
    (l) => l ?? [],
  );

// ---------------------------------------------------------------------------
// A IA que atende
// ---------------------------------------------------------------------------

export type NotaDaJuiza = {
  conversation_id: string;
  organization_id: string | null;
  nome: string;
  dia: string;
  duvida: number | null;
  informacao: number | null;
  satisfacao: number | null;
  interesse: 'subiu' | 'igual' | 'caiu' | null;
  porque: string | null;
  melhorar: string | null;
  media: number;
};

export type SemanaDaIa = {
  semana: string;
  respostas: number;
  conversas: number;
  visitas: number;
  passadas: number;
  boas: number;
  corrigidas: number;
  maduras: number;
  continuou: number;
  interesse_conversas: number;
  interesse_subiu: number;
  avaliadas: number;
  duvida: number | null;
  informacao: number | null;
  satisfacao: number | null;
};

export type RelatorioDaIa = {
  periodo: { de: string; ate: string };
  ia: { ligada: boolean; modo: string | null } | null;
  totais: {
    respostas: number;
    conversas: number;
    visitas_marcadas: number;
    visitas_realizadas: number;
    visitas_faltou: number;
    passadas: number;
    silencios: number;
    boas: number;
    corrigidas: number;
    maduras: number;
    continuou: number;
    mediana_resposta_seg: number | null;
    no_treino: number;
    pediram_para_parar: number;
    custo_usd: number;
  };
  interesse: {
    conversas: number;
    subiu: number;
    igual: number;
    caiu: number;
    sem_dado: number;
    nota_antes: number | null;
    nota_depois: number | null;
    com_nota: number;
  };
  juiza: {
    ligada: boolean;
    avaliadas: number;
    duvida: number | null;
    informacao: number | null;
    satisfacao: number | null;
    subiu: number;
    igual: number;
    caiu: number;
    piores: NotaDaJuiza[];
    melhores: NotaDaJuiza[];
  };
  semanas: SemanaDaIa[];
};

export const carregarRelatorioDaIa = (periodo: Periodo) =>
  rpc<RelatorioDaIa>('relatorio_imova_ia', doPeriodo(periodo));

// ---------------------------------------------------------------------------
// Ajudantes de tela
// ---------------------------------------------------------------------------

/**
 * Onde abrir a conversa de uma linha: a ficha leva para `?org=`; quem ainda não é
 * ficha, pela própria conversa (`?cliente=`), como a aba Clientes faz.
 */
export function linkDaConversa(organizacaoId: string | null, conversaId: string): string {
  return organizacaoId ? `/conversas?org=${organizacaoId}` : `/conversas?cliente=${conversaId}`;
}

/** Percentual de uma parte sobre o todo, `null` sem denominador. */
export function porcento(parte: number, todo: number): number | null {
  return todo > 0 ? Math.round((parte * 1000) / todo) / 10 : null;
}
