'use client';

import { createClient } from '@/lib/supabase/client';

import type { Periodo } from './periodo';

/**
 * A camada de dados do "relatório que vende" da Imova (09/11/2026; migração
 * 20261109210000_o_relatorio_que_vende).
 *
 * Cinco leituras, uma função `SECURITY DEFINER` por aba, cada uma devolvendo um
 * `jsonb` pronto (ADR-03: nenhuma conta aqui). As funções só existem no banco da
 * Imova, por isso não estão nos tipos gerados e as formas são descritas aqui, uma
 * vez. Dinheiro vem em REAIS (número), porcentagem de 0 a 100, chance de 0 a 1,
 * data e hora em ISO; a tela formata.
 */

async function rpc<T>(nome: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await createClient().rpc(nome as never, args as never);
  if (error) throw error;
  return data as T;
}

const doPeriodo = (periodo: Periodo) => ({ p_de: periodo.de, p_ate: periodo.ate });

// ---------------------------------------------------------------------------
// Peças comuns
// ---------------------------------------------------------------------------

/** O número do período e o do período anterior, do mesmo tamanho. */
export type Comparado = { agora: number | null; antes: number | null };

/** Um indicador com as 12 últimas semanas (a última é a semana corrente). */
export type KpiSemanal = Comparado & { semanas: (number | null)[] };

/**
 * As premissas da conta de dinheiro e da meta, em `app_settings`
 * (`relatorio.premissas`). Admin e gestor mudam (`pode_editar`).
 */
export type Premissas = {
  /** Comissão da venda, em % do valor do imóvel (padrão 6). */
  comissao_venda_pct: number;
  /** Comissão da locação, em aluguéis (padrão 1). */
  alugueis_na_locacao: number;
  /** Negócios por mês. Nulo = sem meta: o placar mostra só a previsão. */
  meta_mes: number | null;
  pode_editar: boolean;
};

export type NivelDeInteresse = 'muito' | 'interessado' | 'morno';

export type TipoDeImovel = 'apartamento' | 'casa' | 'terreno' | 'comercial' | 'outro';

/** Por que o lead está parado (Oportunidades). A ordem é a da urgência. */
export type SituacaoParada =
  | 'esperando' // quente esperando resposta há mais de 30 min
  | 'promessa' // a equipe prometeu e o prazo venceu
  | 'proposta' // proposta sem resposta há 3 dias ou mais
  | 'visita' // visitou e ninguém voltou a falar
  | 'combina' // combina com um imóvel da carteira e não recebeu
  | 'esfriando'; // era quente e parou de responder

export type Previsao = {
  /** 'AAAA-MM' */
  mes: string;
  dias_restantes: number;
  fechados: number;
  /** Fechados + os esperados do funil aberto até o fim do mês. */
  esperado: number;
  faixa_baixa: number;
  faixa_alta: number;
  meta: number | null;
  /** Negócios abertos em cada etapa × chance de fechar até o fim do mês (0 a 1). */
  por_etapa: { etapa: string; abertos: number; chance: number; esperado: number }[];
  ritmo: {
    visitas_por_negocio: number | null;
    /** De 0 a 1: das visitas marcadas, quanto aconteceu (90 dias). */
    comparecimento: number | null;
    visitas_marcadas_por_semana: number | null;
  };
};

export type LinhaImovel = {
  codigo: string;
  titulo: string;
  tipo: TipoDeImovel;
  negocio: 'venda' | 'aluguel' | 'venda_e_aluguel' | null;
  bairro: string | null;
  preco_venda: number | null;
  preco_aluguel: number | null;
  dias_no_ar: number | null;
  muito: number;
  interessado: number;
  morno: number;
  total: number;
  /** O lead mais quente deste imóvel (maior calor). */
  lider: { conversation_id: string; nome: string; calor: number } | null;
};

export type LinhaSituacao = {
  situacao: SituacaoParada;
  leads: number;
  /** Comissão provável, em reais. */
  valor: number;
  /** Soma dos imóveis à venda envolvidos, em reais. */
  venda: number;
  /** Soma dos aluguéis mensais envolvidos, em reais. */
  aluguel: number;
  /** Chance média da etapa (0 a 1). */
  chance: number;
};

export type Sugestao = {
  impacto_valor: number;
  impacto_tipo: 'reais' | 'leads' | 'compradores' | 'visitas';
  /** Complemento do número ("de comissão provável", "perguntaram"). */
  unidade: string;
  acao: string;
  porque: string;
  destino: 'oportunidades' | 'imoveis' | 'funil' | 'ia';
  /** O código do imóvel ou o id da conversa, quando a sugestão é de um. */
  alvo: string | null;
};

// ---------------------------------------------------------------------------
// 1. Visão geral — relatorio_imova_painel_visao(p_de, p_ate)
// ---------------------------------------------------------------------------

export type PainelVisao = {
  periodo: { de: string; ate: string };
  kpis: {
    leads_novos: KpiSemanal;
    /** Mediana, em minutos. Menos é melhor. */
    primeira_resposta_min: KpiSemanal;
    visitas_marcadas: KpiSemanal & { pela_ia: number };
    propostas: KpiSemanal;
    fechados: KpiSemanal & { perdidos: number };
    /** Comissão provável parada agora e na foto de ontem. Subir é ruim. */
    comissao_parada: { agora: number; ontem: number | null; semanas: (number | null)[] };
  };
  sugestoes: Sugestao[];
  previsao: Previsao;
  premissas: Premissas;
  /** Os 6 imóveis com mais leads interessados. */
  imoveis: LinhaImovel[];
  funil: { etapa: string; leads: number }[];
  ia: {
    /** Nota média (1 a 5) por semana, da mais antiga para a atual (até 10). */
    notas: { semana: string; nota: number | null }[];
    versoes: { versao: string; desde: string }[];
    /** Últimas 4 semanas × as 4 anteriores. */
    mais_interesse: Comparado;
    visitas: Comparado;
    resolvidas: Comparado;
  };
  mesa: { valor: number; leads: number; situacoes: LinhaSituacao[] };
};

export const carregarPainelVisao = (periodo: Periodo) =>
  rpc<PainelVisao>('relatorio_imova_painel_visao', doPeriodo(periodo));

// ---------------------------------------------------------------------------
// 2. Imóveis — relatorio_imova_painel_imoveis(p_de, p_ate)
//              relatorio_imova_painel_imovel(p_codigo, p_de, p_ate)
// ---------------------------------------------------------------------------

export type PainelImoveis = {
  kpis: {
    no_ar: number;
    a_venda: number;
    para_alugar: number;
    /** Leads diferentes interessados em pelo menos um imóvel. */
    leads_interessados: number;
    /** Pares lead × imóvel. */
    interesses: number;
    muito_interessados: number;
    /** Muito interessados sem próxima ação em dia. */
    muito_sem_acao: number;
    sem_interessado: number;
    sem_interessado_exemplo: { codigo: string; titulo: string; dias_no_ar: number | null } | null;
  };
  /** Todos os imóveis no ar, do mais procurado para o menos. */
  imoveis: LinhaImovel[];
  /** Quando o conselheiro (IA) rodou pela última vez. Nulo = nunca. */
  conselho_em: string | null;
};

export type LeadDoImovel = {
  conversation_id: string;
  /** A ficha, quando o lead já é uma: a conversa abre por ela. */
  organization_id: string | null;
  nome: string;
  calor: number;
  nivel: NivelDeInteresse;
  /** O que aconteceu, numa frase (da IA; sem ela, da ficha). */
  situacao: string | null;
  /** O que falar ou fazer com esta pessoa (da IA). */
  falar: string | null;
  dono: string | null;
};

export type DetalheImovel = {
  imovel: LinhaImovel;
  funil: {
    visualizacoes: number | null;
    contatos: number | null;
    interessados: number;
    visitas: number;
    propostas: number;
  };
  /** Leads novos interessados por semana, 8 semanas, da mais antiga para a atual. */
  semanas: { inicio: string; novos: number }[];
  entrou_no_ar_em: string | null;
  leads: LeadDoImovel[];
  sugestoes: { tipo: 'falar' | 'fazer'; acao: string; porque: string }[];
  sugestoes_em: string | null;
  perguntas: { tema: string; leads: number }[];
  objecoes: { objecao: string; leads: number }[];
};

export const carregarPainelImoveis = (periodo: Periodo) =>
  rpc<PainelImoveis>('relatorio_imova_painel_imoveis', doPeriodo(periodo));

export const carregarDetalheImovel = (codigo: string, periodo: Periodo) =>
  rpc<DetalheImovel>('relatorio_imova_painel_imovel', { p_codigo: codigo, ...doPeriodo(periodo) });

// ---------------------------------------------------------------------------
// 3. Oportunidades — relatorio_imova_painel_oportunidades()  (agora, sem período)
// ---------------------------------------------------------------------------

export type LinhaDaFila = {
  conversation_id: string;
  /** A ficha, quando o lead já é uma: a conversa abre por ela. */
  organization_id: string | null;
  nome: string;
  calor: number;
  nivel: NivelDeInteresse | null;
  codigo: string | null;
  imovel: string | null;
  situacao: SituacaoParada;
  /** Desde quando está assim (a mensagem sem resposta, o prazo, a visita...). */
  desde: string | null;
  porque: string;
  fazer: string;
  /** `fazer` veio do conselheiro (IA); falso = texto padrão da situação. */
  fazer_da_ia: boolean;
  /** Comissão provável, em reais. Nulo = sem valor conhecido. */
  valor: number | null;
  chance: number;
  dono: string | null;
};

export type PainelOportunidades = {
  atualizado_em: string;
  premissas: Premissas;
  valor: number;
  valor_ontem: number | null;
  leads: number;
  leads_ontem: number | null;
  resolvidas_ontem: number | null;
  mais_antiga: { nome: string; dias: number; situacao: SituacaoParada } | null;
  situacoes: LinhaSituacao[];
  /** Cada lead uma vez, na situação mais urgente. Até 60. */
  fila: LinhaDaFila[];
  /** `dono` nulo = sem dono. */
  donos: { dono: string | null; leads: number; valor: number }[];
};

export const carregarPainelOportunidades = () =>
  rpc<PainelOportunidades>('relatorio_imova_painel_oportunidades', {});

// ---------------------------------------------------------------------------
// 4. Funil e equipe — relatorio_imova_painel_funil(p_de, p_ate)
// ---------------------------------------------------------------------------

export type CampoQueVende = 'valor_maximo' | 'forma_pagamento' | 'prazo_mudanca' | 'decide_com' | 'bairros';

export type FaixaDeResposta = 'ate_5' | '5_15' | '15_60' | '1_4h' | 'mais_4h';

export type LinhaPessoaVende = {
  pessoa_id: string;
  nome: string;
  atendeu: number;
  primeira_resposta_min: number | null;
  visitas_marcadas: number;
  marca_visita_pct: number | null;
  visitas_feitas: number;
  propostas: number;
  visita_proposta_pct: number | null;
  fechou: number;
  promessas_em_dia_pct: number | null;
  /** Comissão provável parada agora, em reais. */
  parado_valor: number;
  /** Mediana de dias entre a visita e a proposta. */
  dias_visita_proposta: number | null;
};

export type PainelFunilEquipe = {
  periodo: { de: string; ate: string };
  kpis: {
    lead_visita: Comparado;
    visita_proposta: Comparado;
    proposta_fechado: Comparado;
    /** Mediana de dias do primeiro contato ao fechamento. */
    ciclo_dias: Comparado;
    perdidos: number;
    perdidos_para_outra: number;
  };
  previsao: Previsao;
  premissas: Premissas;
  funil: {
    etapa: string;
    leads: number;
    antes: number;
    /** % da etapa anterior que chegou aqui (nulo na primeira). */
    passou: number | null;
    passou_antes: number | null;
    /** Mediana do tempo desde a etapa anterior, em horas. */
    tempo_horas: number | null;
    /** O que mais travou quem parou ANTES desta etapa (% de quem parou). */
    trava: { motivo: string; pct: number }[];
  }[];
  ciclo_dias: number | null;
  velocidade: { faixa: FaixaDeResposta; leads: number; visitas: number }[];
  perguntas: { campo: CampoQueVende; sabe_pct: number | null; nao_sabe_pct: number | null; falta_em: number }[];
  objecoes: { objecao: string; leads: number; visitaram_pct: number | null }[];
  perdas: { motivo: string; negocios: number }[];
  /** Nulo enquanto o canal de chegada não estiver no ar. */
  canais: { canal: string; leads_pct: number; vendas_pct: number }[] | null;
  equipe: LinhaPessoaVende[];
  ia: { atendeu: number; primeira_resposta_min: number | null; visitas_marcadas: number };
  mensagens: { texto: string; enviados: number; visitas_pct: number }[];
  mensagens_media_visita_pct: number | null;
};

export const carregarPainelFunil = (periodo: Periodo) =>
  rpc<PainelFunilEquipe>('relatorio_imova_painel_funil', doPeriodo(periodo));

// ---------------------------------------------------------------------------
// 5. Progresso da IA — relatorio_imova_painel_ia()  (desde que a IA começou)
// ---------------------------------------------------------------------------

export type SemanaDaIA = {
  /** A segunda-feira da semana (AAAA-MM-DD). */
  inicio: string;
  conversas: number;
  duvida: number | null;
  informacao: number | null;
  satisfacao: number | null;
  subiu_pct: number | null;
  igual_pct: number | null;
  caiu_pct: number | null;
  resolvidas_pct: number | null;
  visitas: number;
};

export type LacunaDaIA =
  | 'condominio_iptu'
  | 'financiamento'
  | 'fotos'
  | 'demorou_visita'
  | 'passou_sem_precisar'
  | 'nao_sabia_do_imovel'
  | 'tom'
  | 'outra';

export type FaixaDePassagem = 'ate_15' | '15_60' | '1_2h' | 'mais_2h' | 'sem_resposta';

export type PainelProgressoIA = {
  desde: string | null;
  /** Até 12 semanas, da mais antiga para a atual. */
  semanas: SemanaDaIA[];
  versoes: {
    /** 'atendente-imova@v2' */
    versao: string;
    desde: string;
    /** Nota média e % de "subiu" nas 2 semanas antes e depois da versão. */
    nota_antes: number | null;
    nota_depois: number | null;
    subiu_antes: number | null;
    subiu_depois: number | null;
  }[];
  kpis: {
    nota: Comparado;
    mais_interesse: Comparado;
    visitas: Comparado;
    resolvidas: Comparado;
    custo_mes_usd: number;
    custo_por_visita_usd: Comparado;
    teto_mes_usd: number | null;
  };
  lacunas: { lacuna: LacunaDaIA; agora: number; antes: number }[];
  passagem: { faixa: FaixaDePassagem; leads: number; visitaram: number; esfriaram: number }[];
  passagem_mediana_min: number | null;
};

export const carregarPainelIA = () => rpc<PainelProgressoIA>('relatorio_imova_painel_ia', {});

// ---------------------------------------------------------------------------
// Premissas — relatorio_imova_premissas_salvar(...)
// ---------------------------------------------------------------------------

export const salvarPremissas = (p: {
  comissao_venda_pct: number;
  alugueis_na_locacao: number;
  meta_mes: number | null;
}) =>
  rpc<Premissas>('relatorio_imova_premissas_salvar', {
    p_comissao_venda_pct: p.comissao_venda_pct,
    p_alugueis_na_locacao: p.alugueis_na_locacao,
    p_meta_mes: p.meta_mes,
  });
