/**
 * Idas ao banco do Radar, todas pelo cliente do navegador.
 *
 * O Postgres é quem manda: a fila, a criação e a decisão são funções `security
 * definer` (`radar_fila`, `radar_criar_candidato`, `radar_revisar_candidato`,
 * `radar_alternar_fonte`). Aqui só ficam a montagem dos argumentos, a tradução
 * do que volta e — o que mais importa nesta tela — a tradução do ERRO: quem
 * revisa nunca deve ler um código do Postgres.
 */
import { createClient } from '@/lib/supabase/client';

import {
  POR_PAGINA,
  type BatidaDeWorker,
  type CandidatoDaFila,
  type FilaDaEsteira,
  type FiltrosDaFila,
  type FonteDoRadar,
  type LoteDeColeta,
  type ResultadoDaFila,
  type ResumoDoRadar,
  type SaudeDaEsteira,
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
// Catálogo de fontes
// ---------------------------------------------------------------------------

/** Leitura segura de um campo de `sources.config`, que é jsonb livre. */
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

export type LinhaDeFonte = {
  id: number;
  slug: string;
  name: string;
  kind: FonteDoRadar['tipo'];
  base_url: string | null;
  legal_basis: string;
  terms_notes: string | null;
  robots_ok: boolean | null;
  is_enabled: boolean;
  rate_limit_seconds: number | string;
  config: unknown;
};

export async function buscarFontes(): Promise<FonteDoRadar[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from('sources')
    .select(
      'id, slug, name, kind, base_url, legal_basis, terms_notes, robots_ok, is_enabled, rate_limit_seconds, config',
    )
    .order('id');

  if (error) throw new Error(error.message);

  return ((data ?? []) as LinhaDeFonte[]).map(paraFonte);
}

/**
 * Traduz uma linha de `sources` para a fonte que a tela mostra.
 *
 * Fica separada e exportada porque `config` é jsonb livre: cada uma das 11 fontes
 * traz um conjunto diferente de chaves (umas têm `fields_whitelist`, outras têm
 * `cnaes` ou `sites`, o Instagram tem `manual_curation`), e nenhuma delas é
 * garantida. Toda leitura passa por guarda de tipo, e o teste cobre justamente as
 * formas que faltam campo.
 */
export function paraFonte(linha: LinhaDeFonte): FonteDoRadar {
  const config = objeto(linha.config);
  const coletor = objeto(config.collector);

  return {
    id: linha.id,
    slug: linha.slug,
    nome: linha.name,
    tipo: linha.kind,
    base_url: linha.base_url,
    base_legal: linha.legal_basis,
    avaliacao: linha.terms_notes,
    robots_ok: linha.robots_ok,
    ligada: linha.is_enabled,
    intervalo_segundos: Number(linha.rate_limit_seconds) || 0,
    fase: texto(coletor.phase),
    coletor: texto(coletor.kind),
    periodicidade: texto(coletor.schedule),
    coletor_pronto: coletor.enabled === true,
    categorias_do_catalogo: Array.isArray(coletor.catalogo)
      ? [
          ...new Set(
            coletor.catalogo
              .map((e) => texto(objeto(e).categoria_origem))
              .filter((c): c is string => c !== null),
          ),
        ]
      : [],
    campos: listaDeTexto(config.fields_whitelist),
    robots_nota: texto(config.robots),
    curadoria_manual: config.manual_curation === true,
  };
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
  | { ok: true; situacao: string; organizacaoId: string | null }
  | { ok: false; motivo: string; organizacaoId: string | null };

export async function revisarCandidato(args: {
  candidatoId: string;
  acao: AcaoDeRevisao;
  organizacaoId?: string | null;
  categoriaId?: number | null;
  motivo?: string | null;
}): Promise<RespostaDeRevisao> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc('radar_revisar_candidato', {
    p_candidate_id: args.candidatoId,
    p_acao: args.acao,
    p_organization_id: args.organizacaoId ?? null,
    p_category_id: args.categoriaId ?? null,
    p_reason: args.motivo ?? null,
  });

  if (error) throw new Error(error.message);

  const r = objeto(data);
  const organizacaoId = texto(r.organization_id);
  if (r.ok === true) {
    return { ok: true, situacao: texto(r.status) ?? 'revisado', organizacaoId };
  }
  return { ok: false, motivo: texto(r.reason) ?? 'desconhecido', organizacaoId };
}

export async function alternarFonte(
  fonteId: number,
  ligar: boolean,
): Promise<{ ok: boolean; motivo?: string }> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc('radar_alternar_fonte', {
    p_source_id: fonteId,
    p_enabled: ligar,
  });

  if (error) throw new Error(error.message);

  const r = objeto(data);
  return r.ok === true ? { ok: true } : { ok: false, motivo: texto(r.reason) ?? 'desconhecido' };
}

/**
 * Pede uma coleta ao Radar.
 *
 * Uma chamada, uma transação no banco: abre o lote e enfileira o job. Não existe
 * caminho aqui para abrir um sem o outro, de propósito — foi assim que o lote de
 * 08/09 ficou em `previa` para sempre.
 *
 * `coletorDePe` é a diferença entre "o pedido entrou" e "os dados vêm". Com o
 * worker parado o lote fica na fila esperando a máquina, e a tela diz isso em vez
 * de deixar a pessoa achar que a coleta falhou.
 */
export async function coletarAgora(
  fonteId: number,
  categorias: string[] | null,
  maxPaginas: number,
): Promise<
  | { ok: true; batchId: string; rotulo: string; categorias: string[]; coletorDePe: boolean }
  | { ok: false; motivo: string; disponiveis?: string[] }
> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc('radar_coletar_agora', {
    p_source_id: fonteId,
    p_categorias: categorias && categorias.length > 0 ? categorias : null,
    p_max_paginas: maxPaginas,
  });

  if (error) throw new Error(error.message);

  const r = objeto(data);
  if (r.ok !== true) {
    return {
      ok: false,
      motivo: texto(r.motivo) ?? 'desconhecido',
      disponiveis: listaDeTexto(r.disponiveis),
    };
  }
  return {
    ok: true,
    batchId: texto(r.batch_id) ?? '',
    rotulo: texto(r.rotulo) ?? '',
    categorias: listaDeTexto(r.categorias),
    coletorDePe: r.coletor_de_pe === true,
  };
}

/** Motivos que a RPC de coleta devolve, escritos para quem apertou o botão. */
export const MOTIVO_DA_COLETA: Record<string, string> = {
  sem_permissao: 'O seu acesso não pede coleta.',
  origem_invalida: 'Essa fonte não existe mais no catálogo.',
  origem_desabilitada: 'Ligue a fonte antes de mandar coletar.',
  coletor_desligado:
    'O robô desta fonte ainda não foi escrito. Só o Casamentos.com.br tem coletor pronto.',
  sem_catalogo: 'Esta fonte não tem caminho de coleta configurado. Fale com quem cuida do banco.',
  categoria_fora_do_catalogo: 'Essa categoria não existe no catálogo desta fonte.',
  ja_rodando: 'Já há uma coleta desta fonte em andamento. Espere ela terminar.',
};

// ---------------------------------------------------------------------------
// Tradução de erro e de motivo
// ---------------------------------------------------------------------------

/** O que deu errado ao falar com o servidor, em português e com uma saída. */
export function mensagemDoErro(erro: unknown): string {
  const texto = erro instanceof Error ? erro.message : '';
  if (/não trabalha a fila|não revisa|não cadastra|42501|permission/i.test(texto)) {
    return 'O seu acesso não trabalha a fila do Radar.';
  }
  if (/jwt|autenticad/i.test(texto)) return 'A sua sessão expirou.';
  if (/fetch|network|failed/i.test(texto)) return 'O aplicativo não alcançou o servidor.';
  return 'O servidor não respondeu como esperado.';
}

/** Motivos que a RPC de criação devolve, escritos para quem está cadastrando. */
export const MOTIVO_DA_CRIACAO: Record<string, string> = {
  nome_obrigatorio: 'Informe o nome do candidato.',
  origem_invalida: 'Essa origem não existe mais no catálogo de fontes.',
  origem_desabilitada: 'Essa fonte está desligada. Ligue-a na aba Fontes ou escolha outra.',
  categoria_invalida: 'Essa categoria não está mais ativa. Escolha outra.',
  cnpj_invalido: 'O CNPJ não fecha: confira os dígitos.',
  ja_esta_na_fila: 'Esse alvo já está esperando revisão na fila.',
};

/** Motivos que a RPC de revisão devolve. */
export const MOTIVO_DA_REVISAO: Record<string, string> = {
  candidato_inexistente: 'Esse candidato não existe mais.',
  ja_revisado: 'Alguém já revisou esse candidato. Atualize a fila.',
  motivo_obrigatorio: 'Escreva o motivo da recusa.',
  acao_invalida: 'Ação desconhecida.',
  candidato_nao_contatar:
    'Esse contato pediu para não ser procurado. Ele não pode virar parceiro.',
  categoria_obrigatoria: 'Escolha a categoria antes de aprovar.',
  // O seletor de categoria só aparece para candidato SEM categoria: quem já tem
  // uma, e ela foi tirada de uso no catálogo, não tem como trocá-la daqui. Sem
  // dizer isso, o alvo fica preso na fila para sempre — "atualize e tente de
  // novo" nunca resolve, porque o problema não está na fila.
  categoria_invalida:
    'A categoria deste alvo saiu de uso no catálogo. Peça a um administrador para reativá-la, ou recuse o alvo e cadastre-o pelo cadastro rápido com outra categoria.',
  organizacao_obrigatoria: 'Escolha com qual ficha mesclar.',
  organizacao_inexistente: 'Essa ficha não existe mais.',
  organizacao_fora_da_carteira:
    'Mesclar altera a ficha, e essa ficha não é sua. Peça ao gestor para mesclar ou para transferir a ficha para você.',
  ja_existe_na_base: 'Esse alvo já está na base. Mescle com a ficha em vez de aprovar.',
};

/** Motivos que a RPC de ligar/desligar fonte devolve (RF-RAD-01). */
export const MOTIVO_DA_FONTE: Record<string, string> = {
  fonte_inexistente: 'Essa fonte não existe mais.',
  robots_nao_avaliado:
    'O robots.txt desta fonte ainda não foi avaliado. Sem essa checagem registrada a fonte não liga.',
  robots_proibe_coleta: 'O robots.txt desta fonte proíbe a coleta. Ela não pode ser ligada.',
  termos_nao_avaliados: 'Os termos de uso desta fonte ainda não foram avaliados.',
};

// ---------------------------------------------------------------------------
// Saúde da esteira: o coletor está vivo? (RF-ADM-07)
// ---------------------------------------------------------------------------

/**
 * `public.esteira_saude()` recusa quem não escreve na base (`leitura`,
 * `financeiro`) com 42501. Isso não é erro de tela: é o papel certo vendo o que
 * lhe cabe. A função devolve `null` nesse caso, e o painel diz uma frase em vez
 * de mostrar um alarme vermelho para quem não tem o que fazer com ele.
 */
export async function buscarSaudeDaEsteira(): Promise<SaudeDaEsteira | null> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc('esteira_saude');
  if (error) {
    if (/42501|não lê a saúde|permission/i.test(error.message)) return null;
    throw new Error(error.message);
  }

  const bruto = objeto(data);
  return {
    workers: Array.isArray(bruto.workers) ? (bruto.workers as BatidaDeWorker[]) : [],
    filas: Array.isArray(bruto.filas) ? (bruto.filas as FilaDaEsteira[]) : [],
    coletor_vivo: bruto.coletor_vivo === true,
    lotes_rodando: Number(bruto.lotes_rodando) || 0,
    capturas_por_expurgar: Number(bruto.capturas_por_expurgar) || 0,
    registros_por_resolver: Number(bruto.registros_por_resolver) || 0,
    ultimo_expurgo: texto(bruto.ultimo_expurgo),
  };
}

type LinhaDeLote = {
  id: string;
  label: string;
  status: LoteDeColeta['status'];
  stats: unknown;
  error: string | null;
  started_at: string | null;
  finished_at: string | null;
  created_at: string;
  sources: { name: string } | { name: string }[] | null;
};

function numeroOuNulo(valor: unknown): number | null {
  return typeof valor === 'number' && Number.isFinite(valor) ? valor : null;
}

/** As últimas corridas de coleta, para a tela dizer o que o robô trouxe e quando. */
export async function buscarColetasRecentes(limite = 3): Promise<LoteDeColeta[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from('import_batches')
    .select('id, label, status, stats, error, started_at, finished_at, created_at, sources(name)')
    .eq('kind', 'coleta')
    .order('created_at', { ascending: false })
    .limit(limite);

  if (error) throw new Error(error.message);

  return ((data ?? []) as LinhaDeLote[]).map((linha) => {
    const estatisticas = objeto(linha.stats);
    const fonte = Array.isArray(linha.sources) ? linha.sources[0] : linha.sources;
    return {
      id: linha.id,
      rotulo: linha.label,
      status: linha.status,
      fonte: fonte ? fonte.name : null,
      capturas: numeroOuNulo(estatisticas.capturas),
      candidatos: numeroOuNulo(estatisticas.candidatos),
      erro: linha.error,
      comecou_em: linha.started_at,
      terminou_em: linha.finished_at,
      criado_em: linha.created_at,
    };
  });
}

// ===========================================================================
// AGENDAR COLETA (migração 20260917170000)
// ===========================================================================
//
// Mandar o Radar trabalhar era `ingest --agendar` num terminal. A tela dizia
// "coletor parado, fila vazia" e quem olhava concluía que o Radar estava
// quebrado — quando o que faltava era uma ordem. Esta é a ordem.

/** O que a tela diz quando o banco recusa. Motivo sem frase é defeito silencioso. */
export const MOTIVOS_DA_COLETA: Record<string, string> = {
  fonte_inexistente: 'Esta fonte não existe mais no catálogo.',
  fonte_desligada:
    'Esta fonte está desligada. Ligar exige conferir o robots.txt e os termos dela (RF-RAD-01).',
  coleta_em_andamento: 'Já existe uma coleta desta fonte esperando ou rodando. Espere ela terminar.',
  origem_invalida: 'Esta fonte não existe mais no catálogo.',
  origem_desabilitada: 'Esta fonte está desligada.',
  lote_recusado: 'O banco não abriu o lote da coleta.',
  fila_recusou: 'O lote abriu, mas a ordem não entrou na fila. Tente de novo.',
};

export interface ColetaAgendada {
  readonly lote: string;
  readonly rotulo: string;
  readonly fonte: string;
  readonly maxPaginas: number;
}

export async function agendarColeta(argumentos: {
  fonteId: number;
  maxPaginas: number;
  categorias?: string[] | null;
  rotulo?: string | null;
}): Promise<ColetaAgendada> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc('radar_agendar_coleta', {
    p_source_id: argumentos.fonteId,
    p_categorias: argumentos.categorias ?? null,
    p_max_paginas: argumentos.maxPaginas,
    p_rotulo: argumentos.rotulo ?? null,
  });

  if (error) {
    // 42501 é a recusa por papel: só admin e gestor agendam, porque a coleta
    // gasta o limite da fonte e responde pelo robots.txt.
    throw new Error(
      error.code === '42501'
        ? 'Seu perfil não agenda coleta. Peça a um admin ou gestor.'
        : mensagemDoErro(error),
    );
  }

  const bruto = objeto(data);
  if (!bruto.ok) {
    const motivo = typeof bruto.motivo === 'string' ? bruto.motivo : '';
    throw new Error(MOTIVOS_DA_COLETA[motivo] ?? 'A coleta não foi agendada.');
  }

  return {
    lote: String(bruto.lote),
    rotulo: String(bruto.rotulo ?? ''),
    fonte: String(bruto.fonte ?? ''),
    maxPaginas: Number(bruto.max_paginas) || 1,
  };
}

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
        ? 'Seu perfil não repontua o Radar. Peça a um admin ou gestor.'
        : mensagemDoErro(error),
    );
  }
  const r = objeto(data);
  return { candidatos: Number(r.candidatos) || 0 };
}
