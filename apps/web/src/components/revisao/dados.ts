/**
 * Idas ao banco da Revisão, todas pelo cliente do navegador.
 *
 * O Postgres é quem manda: a fila, a criação e a decisão são funções `security
 * definer` (`radar_fila`, `radar_criar_candidato`, `radar_revisar_candidato` —
 * nomes de banco, que não mudaram quando a tela mudou de nome). Aqui só ficam a
 * montagem dos argumentos, a tradução do que volta e — o que mais importa nesta
 * tela — a tradução do ERRO: quem revisa nunca deve ler um código do Postgres.
 */
import { createClient } from '@/lib/supabase/client';

import {
  POR_PAGINA,
  type CandidatoDaFila,
  type FiltrosDaFila,
  type ResultadoDaFila,
  type ResumoDoRadar,
} from './tipos';

/** Chave de cache do TanStack Query para um recorte da fila. */
export function chaveDaFila(f: FiltrosDaFila) {
  return [
    'radar',
    'fila',
    f.situacao,
    f.fonteId,
    f.categoriaId,
    f.q.trim().toLowerCase(),
    f.soMarcados,
    f.pagina,
  ] as const;
}

export async function buscarFila(f: FiltrosDaFila): Promise<ResultadoDaFila> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc('radar_fila', {
    p_status: f.situacao,
    p_source_id: f.fonteId,
    p_category_id: f.categoriaId,
    p_q: f.q.trim() || null,
    p_so_marcados: f.soMarcados,
    p_limit: POR_PAGINA,
    p_offset: (f.pagina - 1) * POR_PAGINA,
  });

  if (error) throw new Error(error.message);

  const linhas = (data ?? []) as CandidatoDaFila[];
  return { linhas, total: linhas[0]?.total_count ?? 0 };
}

export async function buscarResumo(): Promise<ResumoDoRadar | null> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc('radar_resumo');
  if (error) throw new Error(error.message);
  return (data ?? null) as ResumoDoRadar | null;
}

// ---------------------------------------------------------------------------
// Leitura segura do que volta do banco
// ---------------------------------------------------------------------------

/** `jsonb` livre chega aqui como `unknown`: só objeto de verdade vira objeto. */
function objeto(valor: unknown): Record<string, unknown> {
  return typeof valor === 'object' && valor !== null && !Array.isArray(valor)
    ? (valor as Record<string, unknown>)
    : {};
}
function texto(valor: unknown): string | null {
  return typeof valor === 'string' && valor.trim() ? valor : null;
}
function listaDeTexto(valor: unknown): string[] {
  return Array.isArray(valor) ? valor.filter((v): v is string => typeof v === 'string') : [];
}

// ---------------------------------------------------------------------------
// Escritas
// ---------------------------------------------------------------------------

export type NovoCandidato = {
  nome: string;
  fonteId: number;
  categoriaId: number | null;
  telefone: string;
  instagram: string;
  site: string;
  cnpj: string;
  bairro: string;
  cidadeId: number | null;
  origemUrl: string;
  observacao: string;
};

export type RespostaDeCriacao =
  | { criado: true; candidatoId: string; marcas: string[]; naoContatar: boolean }
  | { criado: false; motivo: string; candidatoId?: string };

export async function criarCandidato(v: NovoCandidato): Promise<RespostaDeCriacao> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc('radar_criar_candidato', {
    p_name: v.nome,
    p_source_id: v.fonteId,
    p_category_id: v.categoriaId,
    p_phone: v.telefone.trim() || null,
    p_instagram: v.instagram.trim() || null,
    p_website: v.site.trim() || null,
    p_cnpj: v.cnpj.trim() || null,
    p_neighborhood: v.bairro.trim() || null,
    p_city_id: v.cidadeId,
    p_source_url: v.origemUrl.trim() || null,
    p_notes: v.observacao.trim() || null,
  });

  if (error) throw new Error(error.message);

  const r = objeto(data);
  if (r.created === true) {
    return {
      criado: true,
      candidatoId: String(r.candidate_id),
      marcas: listaDeTexto(r.flags),
      naoContatar: r.do_not_contact === true,
    };
  }
  return {
    criado: false,
    motivo: texto(r.reason) ?? 'desconhecido',
    candidatoId: texto(r.candidate_id) ?? undefined,
  };
}

export type AcaoDeRevisao = 'aprovar' | 'mesclar' | 'recusar' | 'nao_contatar';

export type RespostaDeRevisao =
  | {
      ok: true;
      situacao: string;
      organizacaoId: string | null;
      /** Quantos outros o "valer para os outros N" aprovou junto. */
      irmasAprovadas?: number;
      /** A escolha virou regra do de-para agora? */
      virouRegra?: boolean;
    }
  | { ok: false; motivo: string; organizacaoId: string | null };

export async function revisarCandidato(args: {
  candidatoId: string;
  acao: AcaoDeRevisao;
  organizacaoId?: string | null;
  categoriaId?: number | null;
  motivo?: string | null;
  /**
   * "Valer para os outros N que também vieram como X."
   *
   * Grava a regra do de-para na hora, pulando o contador dos cinco freios, e
   * aprova os outros pelo mesmo caminho do cartão. Consentimento explícito vale
   * mais que contagem — mas só quando é explícito, e por isso o padrão é falso.
   */
  aprenderAgora?: boolean;
}): Promise<RespostaDeRevisao> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc('radar_revisar_candidato', {
    p_candidate_id: args.candidatoId,
    p_acao: args.acao,
    p_organization_id: args.organizacaoId ?? null,
    p_category_id: args.categoriaId ?? null,
    p_reason: args.motivo ?? null,
    p_aprender_agora: args.aprenderAgora ?? false,
  });

  if (error) throw new Error(error.message);

  const r = objeto(data);
  const organizacaoId = texto(r.organization_id);
  if (r.ok === true) {
    const irmas = objeto(r.irmas);
    const aprendizado = objeto(r.aprendizado);
    return {
      ok: true,
      situacao: texto(r.status) ?? 'revisado',
      organizacaoId,
      irmasAprovadas: typeof irmas.aprovados === 'number' ? irmas.aprovados : 0,
      virouRegra: aprendizado.virou_regra === true,
    };
  }
  return { ok: false, motivo: texto(r.reason) ?? 'desconhecido', organizacaoId };
}

/** Quantos outros nomes na fila vieram com o mesmo rótulo da fonte. */
export async function irmasPeloRotulo(candidatoId: string): Promise<number> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc('radar_irmas_pelo_rotulo', {
    p_candidate_id: candidatoId,
  });
  if (error) throw new Error(error.message);
  const r = objeto(data);
  return typeof r.outros === 'number' ? r.outros : 0;
}

/** O que voltou de um lote: a conta, e o motivo de cada um que não passou. */
export type RespostaDoLote = {
  aprovados: number;
  recusados: number;
  itens: Array<{ candidatoId: string; ok: boolean; motivo: string | null; nome: string | null }>;
};

/**
 * Aprova em lote os nomes que não têm decisão dentro.
 *
 * O banco laça sobre `public.radar_revisar_candidato` — o MESMO caminho do
 * cartão —, com subtransação por candidato e teto de 200. Não há caminho novo
 * de escrita: a recusa de candidato `do_not_contact`, a máscara de carteira
 * alheia e a reconferência da supressão viva continuam valendo, um a um, dentro
 * do laço.
 *
 * Mesclar, "não contatar" e "recusar" NÃO passam por aqui, e é de propósito:
 * a primeira é a decisão de qual ficha vence, e as outras duas escrevem
 * supressão ou exigem motivo escrito.
 */
export async function revisarLote(args: {
  ids: readonly string[];
  categoriaId?: number | null;
}): Promise<RespostaDoLote> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc('radar_revisar_lote', {
    p_ids: [...args.ids],
    p_category_id: args.categoriaId ?? null,
  });
  if (error) throw new Error(error.message);

  const r = objeto(data);
  if (r.ok !== true) throw new Error(`recusado:${texto(r.reason) ?? 'desconhecido'}`);
  const itens = Array.isArray(r.itens) ? r.itens : [];
  return {
    aprovados: typeof r.aprovados === 'number' ? r.aprovados : 0,
    recusados: typeof r.recusados === 'number' ? r.recusados : 0,
    itens: itens.map((i) => {
      const o = objeto(i);
      return {
        candidatoId: texto(o.candidate_id) ?? '',
        ok: o.ok === true,
        motivo: texto(o.reason),
        nome: texto(o.nome),
      };
    }),
  };
}

// ---------------------------------------------------------------------------
// Tradução de erro e de motivo
// ---------------------------------------------------------------------------

/** O que deu errado ao falar com o servidor, em português e com uma saída. */
export function mensagemDoErro(erro: unknown): string {
  const texto = erro instanceof Error ? erro.message : '';
  if (/não trabalha a fila|não revisa|não cadastra|42501|permission/i.test(texto)) {
    return 'O seu acesso não trabalha a fila de revisão.';
  }
  if (/jwt|autenticad/i.test(texto)) return 'A sua sessão expirou.';
  if (/fetch|network|failed/i.test(texto)) return 'O aplicativo não alcançou o servidor.';
  return 'O servidor não respondeu como esperado.';
}

/** Motivos que a RPC de criação devolve, escritos para quem está cadastrando. */
export const MOTIVO_DA_CRIACAO: Record<string, string> = {
  nome_obrigatorio: 'Informe o nome da empresa.',
  origem_invalida: 'Essa origem não existe mais no catálogo de fontes.',
  origem_desabilitada: 'Essa fonte está desligada. Ligue-a na aba Fontes ou escolha outra.',
  categoria_invalida: 'Essa categoria não está mais ativa. Escolha outra.',
  cnpj_invalido: 'O CNPJ não fecha: confira os dígitos.',
  ja_esta_na_fila: 'Esse nome já está esperando na fila.',
};

/** Motivos que a RPC de revisão devolve. */
export const MOTIVO_DA_REVISAO: Record<string, string> = {
  candidato_inexistente: 'Esse nome não existe mais na fila.',
  ja_revisado: 'Alguém já decidiu esse nome. Atualize a fila.',
  motivo_obrigatorio: 'Escreva o motivo da recusa.',
  acao_invalida: 'Ação desconhecida.',
  candidato_nao_contatar:
    'Esse contato pediu para não ser procurado. Ele não pode virar parceiro.',
  categoria_obrigatoria: 'Escolha a categoria antes de aprovar.',
  // O seletor de categoria só aparece para quem está SEM categoria: quem já tem
  // uma, e ela foi tirada de uso no catálogo, não tem como trocá-la daqui. Sem
  // dizer isso, o nome fica preso na fila para sempre — "atualize e tente de
  // novo" nunca resolve, porque o problema não está na fila.
  categoria_invalida:
    'A categoria deste nome saiu de uso. Peça a um administrador para reativá-la, ou descarte e cadastre à mão com outra categoria.',
  organizacao_obrigatoria: 'Escolha com qual ficha mesclar.',
  organizacao_inexistente: 'Essa ficha não existe mais.',
  organizacao_fora_da_carteira:
    'Mesclar altera a ficha, e essa ficha não é sua. Peça ao gestor para mesclar ou para transferir a ficha para você.',
  ja_existe_na_base: 'Este nome já é parceiro. Junte com o que existe.',
};

// ===========================================================================
// OS PESOS DA TRIAGEM (migração 20260917180000)
// ===========================================================================
//
// Ficam em `app_settings`, e a RLS já resolve quem escreve: `app_settings_update`
// exige gestor. A tela não precisa de RPC — precisa de honestidade sobre o que
// acontece depois de salvar, que é repontuar a fila inteira.

/** O formato que a tela edita. O banco guarda em snake_case, dentro de um JSON. */
export interface PesosDaTriagem {
  pesoNota: number;
  pesoAvaliacoes: number;
  pesoCategoria: number;
  pesoCidade: number;
  notaMinima: number;
  avaliacoesParaValer: number;
  corteAMais: number;
  corteA: number;
  corteB: number;
  categoriasPrioritarias: number[];
  cidadesAlvo: string[];
}

const PESOS_PADRAO: PesosDaTriagem = {
  pesoNota: 35,
  pesoAvaliacoes: 25,
  pesoCategoria: 25,
  pesoCidade: 15,
  notaMinima: 4,
  avaliacoesParaValer: 10,
  corteAMais: 85,
  corteA: 65,
  corteB: 35,
  categoriasPrioritarias: [],
  cidadesAlvo: [],
};

function numero(v: unknown, padrao: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : padrao;
}

export async function lerPesosDaTriagem(): Promise<PesosDaTriagem> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from('app_settings')
    .select('value')
    .eq('key', 'radar.triagem')
    .maybeSingle();

  if (error) throw new Error(mensagemDoErro(error));

  const v = objeto(data?.value);
  const pesos = objeto(v.pesos);
  const categorias = Array.isArray(v.categorias_prioritarias) ? v.categorias_prioritarias : [];
  const cidades = Array.isArray(v.cidades_alvo) ? v.cidades_alvo : [];

  return {
    pesoNota: numero(pesos.nota, PESOS_PADRAO.pesoNota),
    pesoAvaliacoes: numero(pesos.avaliacoes, PESOS_PADRAO.pesoAvaliacoes),
    pesoCategoria: numero(pesos.categoria, PESOS_PADRAO.pesoCategoria),
    pesoCidade: numero(pesos.cidade, PESOS_PADRAO.pesoCidade),
    notaMinima: numero(v.nota_minima, PESOS_PADRAO.notaMinima),
    avaliacoesParaValer: numero(v.avaliacoes_para_valer, PESOS_PADRAO.avaliacoesParaValer),
    corteAMais: numero(v.corte_a_mais, PESOS_PADRAO.corteAMais),
    corteA: numero(v.corte_a, PESOS_PADRAO.corteA),
    corteB: numero(v.corte_b, PESOS_PADRAO.corteB),
    categoriasPrioritarias: categorias.filter((c): c is number => typeof c === 'number'),
    cidadesAlvo: cidades.filter((c): c is string => typeof c === 'string'),
  };
}

export async function salvarPesosDaTriagem(p: PesosDaTriagem): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase
    .from('app_settings')
    .update({
      value: {
        nota_minima: p.notaMinima,
        avaliacoes_para_valer: p.avaliacoesParaValer,
        cidades_alvo: p.cidadesAlvo,
        categorias_prioritarias: p.categoriasPrioritarias,
        pesos: {
          nota: p.pesoNota,
          avaliacoes: p.pesoAvaliacoes,
          categoria: p.pesoCategoria,
          cidade: p.pesoCidade,
        },
        corte_a_mais: p.corteAMais,
        corte_a: p.corteA,
        corte_b: p.corteB,
      },
    })
    .eq('key', 'radar.triagem');

  if (error) {
    // A policy `app_settings_update` exige gestor. Dizer isso em português evita
    // a pessoa achar que o CRM quebrou quando ela apenas não pode.
    throw new Error(
      error.code === '42501' || error.code === 'PGRST116'
        ? 'Seu perfil não muda os pesos da triagem. Peça a um admin ou gestor.'
        : mensagemDoErro(error),
    );
  }
}

/** Recalcula a fila inteira com os pesos atuais. Devolve quantos mudaram. */
export async function repontuarORadar(): Promise<{ candidatos: number }> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc('radar_repontuar');
  if (error) {
    throw new Error(
      error.code === '42501'
        ? 'Seu perfil não repontua a fila. Peça a um admin ou gestor.'
        : mensagemDoErro(error),
    );
  }
  const r = objeto(data);
  return { candidatos: Number(r.candidatos) || 0 };
}

/**
 * Pede ao worker a leitura dos candidatos que a IA ainda não viu.
 *
 * O banco enfileira com chave do dia: apertar duas vezes na mesma tarde não
 * gasta duas chamadas ao modelo.
 */
export async function pedirLeituraDaIa(): Promise<{
  enfileirado: boolean;
  esperando: number;
  /** Quantas rodadas de 20 entraram na fila do worker. */
  rodadas: number;
  motivo?: string;
}> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc('radar_triar_com_ia');
  if (error) {
    throw new Error(
      error.code === '42501'
        ? 'Seu perfil não pede a leitura da IA. Peça a um admin ou gestor.'
        : mensagemDoErro(error),
    );
  }
  const r = objeto(data);
  return {
    enfileirado: r.enfileirado === true,
    esperando: Number(r.esperando) || 0,
    rodadas: Number(r.rodadas) || 0,
    motivo: typeof r.motivo === 'string' ? r.motivo : undefined,
  };
}
