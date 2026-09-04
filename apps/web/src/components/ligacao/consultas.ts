'use client';

/**
 * A conversa do módulo de ligação com o Postgres — montagem e acompanhamento do lote
 * (R13 §3.1; PRD §5).
 *
 * Duas regras valem para o arquivo inteiro:
 *
 *  * **O banco decide.** A prévia desta tela é uma leitura; quem reserva, ordena e
 *    corta é `public.montar_lote`. Por isso a prévia nunca promete um número: ela
 *    mostra o que a base tem agora e o resumo da montagem diz o que entrou de fato.
 *  * **Recusa não é exceção.** `montar_lote` devolve `{montado:false, motivo}` para o
 *    que a pessoa pode corrigir e só levanta exceção em falha técnica.
 *
 * ---------------------------------------------------------------------------
 * Por que a prévia é montada no cliente, e não numa consulta só
 * ---------------------------------------------------------------------------
 * `app.call_candidates` — a função que a montagem usa — devolve o telefone e por isso
 * teve o `execute` revogado de `authenticated` (RF-BAS-14). A prévia então repete as
 * regras dela por cima do que a tela PODE ler: `organizations_view` (que já mascara o
 * telefone por papel), `deals`, `v_contact_cooldown` e `call_batch_items`.
 *
 * A base inteira são 100 organizações e 99 negócios: seis consultas pequenas, uma vez
 * por funil, e todo filtro depois disso é memória. É o que faz a prévia mudar no mesmo
 * quadro em que a pessoa mexe no filtro, sem uma ida à rede por toque.
 *
 * A repetição de regra é consciente e tem limite: o que a prévia NÃO consegue ver é a
 * `suppression_list` (guardada por hash, e a função que compara está no schema `app`,
 * fora do PostgREST). Quem vê é a montagem. Por isso a tela chama a prévia de
 * estimativa e mostra o resumo do banco depois de montar.
 */
import { z } from 'zod';

import { type OrgKind, type Temperature } from '@komune/schema';

import { createClient } from '@/lib/supabase/client';

import {
  MENSAGENS_DE_EXCLUSAO,
  RPC_MONTAR_LOTE,
  montarLoteSchema,
  type MontarLote,
  type MotivoDeExclusao,
  type OrdemDaFila,
  type StatusDoLote,
} from './tipos';

// ---------------------------------------------------------------------------
// Catálogos: funis, roteiros
// ---------------------------------------------------------------------------

/** Um funil que pode virar lote de ligação. */
export type FunilDeLigacao = { id: number; slug: string; nome: string };

/**
 * Os funis em que se disca.
 *
 * São dois, e não os três do banco: `ativacao` anda por eventos da plataforma Komune
 * (PRD §6) e não tem prospecção fria. Oferecê-lo aqui seria oferecer um lote que a
 * montagem devolveria vazio.
 */
const FUNIS_QUE_DISCAM: readonly string[] = ['fornecedor', 'produtor'];

export const CHAVE_FUNIS_DE_LIGACAO = ['ligacao', 'funis'] as const;

export async function carregarFunisDeLigacao(): Promise<FunilDeLigacao[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from('pipelines')
    .select('id, slug, name, position')
    .order('position', { ascending: true });

  if (error) throw error;

  return (data ?? [])
    .filter((funil) => FUNIS_QUE_DISCAM.includes(funil.slug))
    .map((funil) => ({ id: funil.id, slug: funil.slug, nome: funil.name }));
}

/** Um roteiro publicado, congelado no lote no dia da montagem. */
export type RoteiroPublicado = { id: string; slug: string; nome: string; versao: number };

export const CHAVE_ROTEIROS = ['ligacao', 'roteiros'] as const;

/**
 * Só os publicados: `montar_lote` recusa roteiro não publicado (`roteiro_invalido`),
 * então listar rascunho seria oferecer um caminho que o banco fecha.
 */
export async function carregarRoteirosPublicados(): Promise<RoteiroPublicado[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from('call_scripts')
    .select('id, slug, nome, versao')
    .eq('is_published', true)
    .order('nome', { ascending: true });

  if (error) throw error;
  return (data ?? []).map((r) => ({ id: r.id, slug: r.slug, nome: r.nome, versao: r.versao }));
}

// ---------------------------------------------------------------------------
// A base da montagem
// ---------------------------------------------------------------------------

/**
 * Uma organização do funil, do jeito que a prévia precisa.
 *
 * `motivo` é `null` quando a organização entraria no lote hoje. Ele repete a ordem do
 * `case` de `app.call_candidates`, com uma diferença deliberada: a temperatura NÃO
 * entra aqui. Ela é o eixo da escolha (um lote tem origem única), então a tela filtra
 * por `temperatura` e conta as exclusões dentro do grupo escolhido — que é o número
 * que a pessoa quer ver ("dos 43 frios, 4 estão sem telefone"), e não "57 são de outra
 * temperatura".
 */
export type CandidatoDaBase = {
  organizationId: string;
  nome: string;
  kind: OrgKind;
  temperatura: Temperature;
  categoriaIds: number[];
  categoriaNome: string | null;
  cidade: string | null;
  bairro: string | null;
  temTelefone: boolean;
  /** Tentativas já acumuladas em lotes anteriores (soma de `call_batch_items.attempts`). */
  tentativas: number;
  /** Dias desde a última atividade do negócio; `null` quando nunca houve contato. */
  diasSemContato: number | null;
  motivo: MotivoDeExclusao | null;
};

/** Uma categoria com quantas organizações do funil ela tem — o filtro sem número mente. */
export type CategoriaDaBase = { id: number; nome: string; quantos: number };

export type BaseDaMontagem = {
  candidatos: CandidatoDaBase[];
  categorias: CategoriaDaBase[];
  bairros: string[];
  cidades: string[];
};

export function chaveDaBase(pipelineId: number | null) {
  return ['ligacao', 'base-da-montagem', pipelineId] as const;
}

/** Teto de leitura: a base real tem 100 organizações; o limite é rede de segurança. */
const TETO_DA_BASE = 1000;

const MS_POR_DIA = 24 * 60 * 60 * 1000;

export async function carregarBaseDaMontagem(pipelineId: number): Promise<BaseDaMontagem> {
  const supabase = createClient();

  const [negocios, organizacoes, vinculos, categorias, esperas, reservas] = await Promise.all([
    supabase
      .from('deals')
      .select('id, organization_id, status, temperature, last_activity_at')
      .eq('pipeline_id', pipelineId)
      .limit(TETO_DA_BASE),
    supabase
      .from('organizations_view')
      .select('id, name, kind, phone_e164, do_not_contact, neighborhood, city_name')
      .is('deleted_at', null)
      .limit(TETO_DA_BASE),
    supabase.from('organization_categories').select('organization_id, category_id'),
    supabase
      .from('categories')
      .select('id, name, position')
      .eq('is_active', true)
      .order('position'),
    supabase.from('v_contact_cooldown').select('organization_id, cooldown_until, blocked_forever'),
    supabase
      .from('call_batch_items')
      .select('organization_id, status, attempts')
      .limit(TETO_DA_BASE),
  ]);

  const falha =
    negocios.error ??
    organizacoes.error ??
    vinculos.error ??
    categorias.error ??
    esperas.error ??
    reservas.error;
  if (falha) throw falha;

  const agora = Date.now();
  const porOrganizacao = new Map((organizacoes.data ?? []).map((o) => [o.id, o]));
  const nomeDaCategoria = new Map((categorias.data ?? []).map((c) => [c.id, c.name]));

  const categoriasDaOrganizacao = new Map<string, number[]>();
  for (const vinculo of vinculos.data ?? []) {
    const lista = categoriasDaOrganizacao.get(vinculo.organization_id) ?? [];
    lista.push(vinculo.category_id);
    categoriasDaOrganizacao.set(vinculo.organization_id, lista);
  }

  const esperaDaOrganizacao = new Map(
    (esperas.data ?? [])
      .filter((e): e is typeof e & { organization_id: string } => e.organization_id !== null)
      .map((e) => [e.organization_id, e]),
  );

  const reservadas = new Set<string>();
  const tentativasAcumuladas = new Map<string, number>();
  for (const item of reservas.data ?? []) {
    if (item.status === 'fila' || item.status === 'em_andamento') {
      reservadas.add(item.organization_id);
    }
    tentativasAcumuladas.set(
      item.organization_id,
      (tentativasAcumuladas.get(item.organization_id) ?? 0) + item.attempts,
    );
  }

  const candidatos: CandidatoDaBase[] = [];
  for (const negocio of negocios.data ?? []) {
    const organizacao = porOrganizacao.get(negocio.organization_id);
    // Fora de `organizations_view` = apagada ou invisível para este papel: não é
    // exclusão a explicar, é linha que não existe para quem está olhando.
    if (!organizacao) continue;

    const espera = esperaDaOrganizacao.get(organizacao.id);
    const temTelefone = (organizacao.phone_e164 ?? '').trim().length > 0;

    // A MESMA ordem do `case` de `app.call_candidates`. A `suppression_list` fica de
    // fora porque é guardada por hash e só a montagem consegue compará-la.
    const motivo: MotivoDeExclusao | null =
      negocio.status !== 'open'
        ? 'sem_negocio_aberto'
        : !temTelefone
          ? 'sem_telefone'
          : organizacao.do_not_contact
            ? 'nao_contatar'
            : espera?.blocked_forever
              ? 'em_janela_de_recontato'
              : espera?.cooldown_until && Date.parse(espera.cooldown_until) > agora
                ? 'em_janela_de_recontato'
                : reservadas.has(organizacao.id)
                  ? 'reservado_em_outro_lote'
                  : null;

    const idsDeCategoria = categoriasDaOrganizacao.get(organizacao.id) ?? [];

    candidatos.push({
      organizationId: organizacao.id,
      nome: organizacao.name,
      kind: organizacao.kind,
      temperatura: negocio.temperature,
      categoriaIds: idsDeCategoria,
      categoriaNome: nomeDaCategoria.get(idsDeCategoria[0] ?? -1) ?? null,
      cidade: organizacao.city_name,
      bairro: organizacao.neighborhood,
      temTelefone,
      tentativas: tentativasAcumuladas.get(organizacao.id) ?? 0,
      diasSemContato: negocio.last_activity_at
        ? Math.floor((agora - Date.parse(negocio.last_activity_at)) / MS_POR_DIA)
        : null,
      motivo,
    });
  }

  // Só as categorias que existem nesta base, com quantas organizações cada uma tem:
  // um filtro que oferece 60 categorias para uma base de 50 negócios faz a pessoa
  // caçar. A contagem é a que dá sentido à escolha.
  const quantosPorCategoria = new Map<number, number>();
  for (const candidato of candidatos) {
    for (const id of candidato.categoriaIds) {
      quantosPorCategoria.set(id, (quantosPorCategoria.get(id) ?? 0) + 1);
    }
  }

  return {
    candidatos,
    categorias: [...quantosPorCategoria.entries()]
      .map(([id, quantos]) => ({ id, nome: nomeDaCategoria.get(id) ?? `Categoria ${id}`, quantos }))
      .sort((a, b) => b.quantos - a.quantos || a.nome.localeCompare(b.nome, 'pt-BR')),
    bairros: valoresUnicos(candidatos.map((c) => c.bairro)),
    cidades: valoresUnicos(candidatos.map((c) => c.cidade)),
  };
}

function valoresUnicos(valores: readonly (string | null)[]): string[] {
  return [...new Set(valores.filter((v): v is string => Boolean(v && v.trim())))].sort((a, b) =>
    a.localeCompare(b, 'pt-BR'),
  );
}

// ---------------------------------------------------------------------------
// Montar o lote
// ---------------------------------------------------------------------------

/**
 * O que `public.montar_lote` devolve. A forma está fixada na migração
 * 20260904001300 (`jsonb_build_object`) e é revalidada aqui: jsonb sem schema é
 * `any` com outro nome, e este é o retorno que decide se o lote existe.
 */
const resultadoDaMontagemSchema = z.discriminatedUnion('montado', [
  z.object({
    montado: z.literal(true),
    lote_id: z.uuid(),
    pedidos: z.number().int(),
    entraram: z.number().int(),
    excluidos: z.record(z.string(), z.number().int()),
    roteiro_id: z.uuid(),
    roteiro_versao: z.number().int(),
  }),
  z.object({
    montado: z.literal(false),
    motivo: z.string(),
    detalhe: z.string().nullable(),
  }),
]);

export type ResultadoDaMontagem = z.infer<typeof resultadoDaMontagemSchema>;

/** Recusa esperada do `montar_lote`, já em pt-BR. O texto cru do Postgres nunca sobe. */
export const MENSAGENS_DE_RECUSA_DA_MONTAGEM: Record<string, string> = {
  sem_permissao: 'Seu perfil não monta lote de ligação. Fale com o gestor.',
  tamanho_invalido: 'O tamanho do lote precisa ficar entre 1 e 60 contatos.',
  funil_invalido: 'Esse funil não existe mais. Recarregue a tela e escolha de novo.',
  roteiro_invalido: 'Esse roteiro não está publicado. Escolha outro.',
};

export function mensagemDaRecusaDaMontagem(motivo: string): string {
  return (
    MENSAGENS_DE_RECUSA_DA_MONTAGEM[motivo] ??
    'O banco recusou a montagem. Confira os campos e tente de novo.'
  );
}

/**
 * Monta o lote e reserva os contatos.
 *
 * O pedido passa pelo `montarLoteSchema` antes de sair — é ele que garante nome, faixa
 * de tamanho e datas sem gastar uma ida à rede. Depois disso quem manda é o banco: a
 * reserva é um `on conflict do nothing` sobre dois índices únicos parciais, e é por
 * isso que `entraram` pode ser menor que `pedidos` mesmo com a prévia dizendo outra
 * coisa — alguém montou lote entre a prévia e o clique.
 */
export async function montarLote(entrada: MontarLote): Promise<ResultadoDaMontagem> {
  const supabase = createClient();
  const p = montarLoteSchema.parse(entrada);

  const { data, error } = await supabase.rpc(RPC_MONTAR_LOTE, {
    p_nome: p.nome,
    p_pipeline_id: p.pipelineId,
    p_temperatura_origem: p.temperaturaOrigem,
    p_roteiro_id: p.roteiroId,
    p_categoria_ids: p.categoriaIds,
    p_ordem: p.ordem,
    p_tamanho: p.tamanho,
    p_max_tentativas: p.maxTentativas,
    p_horas_entre_tentativas: p.horasEntreTentativas,
    p_meta_ligacoes: p.metaLigacoes ?? undefined,
    p_inicia_em: p.iniciaEm,
    p_termina_em: p.terminaEm,
  });

  if (error) throw error;

  const analisado = resultadoDaMontagemSchema.safeParse(data);
  if (!analisado.success) {
    throw new Error('O servidor respondeu sem dizer se o lote foi montado.');
  }
  return analisado.data;
}

/** Os motivos de exclusão que o banco devolveu, já como frases da tela. */
export function exclusoesEmFrases(
  excluidos: Record<string, number>,
): { motivo: string; quantos: number; frase: string }[] {
  return Object.entries(excluidos)
    .filter(([, quantos]) => quantos > 0)
    .map(([motivo, quantos]) => ({
      motivo,
      quantos,
      frase: MENSAGENS_DE_EXCLUSAO[motivo as MotivoDeExclusao] ?? motivo.replace(/_/g, ' '),
    }))
    .sort((a, b) => b.quantos - a.quantos);
}

// ---------------------------------------------------------------------------
// Acompanhar: a lista de lotes
// ---------------------------------------------------------------------------

/**
 * Um lote na lista, com os quatro números que respondem "como foi o dia":
 * quantos faltam, quantos foram feitos, quantos atenderam, quantas reuniões saíram.
 */
export type LoteNaLista = {
  id: string;
  nome: string;
  status: StatusDoLote;
  dono: string;
  ehMeu: boolean;
  funilId: number;
  funil: string;
  temperaturaOrigem: Temperature;
  ordem: OrdemDaFila;
  roteiro: string;
  roteiroVersao: number;
  maxTentativas: number;
  metaLigacoes: number | null;
  iniciaEm: string;
  terminaEm: string;
  criadoEm: string;
  /** Itens do lote. */
  total: number;
  /** Ainda na fila. */
  faltam: number;
  /** Já tabulados (`total - pending`). */
  feitos: number;
  /** Itens em que alguém atendeu (`call_attempts.resultado = atendida_humano`). */
  atenderam: number;
  /** Desfecho `lig_reuniao_marcada` nas chamadas do lote. */
  reunioes: number;
};

export const CHAVE_LOTES = ['ligacao', 'lotes'] as const;

/** Slug do desfecho que conta como reunião. Está no catálogo desde a seed do D5. */
const SLUG_REUNIAO = 'lig_reuniao_marcada';

const TETO_DE_LOTES = 100;
const TETO_DE_CHAMADAS = 5000;

export async function carregarLotes(): Promise<LoteNaLista[]> {
  const supabase = createClient();

  const sessao = await supabase.auth.getUser();
  const meuId = sessao.data.user?.id ?? null;

  const [lotes, funis, pessoas, roteiros, desfechoDeReuniao] = await Promise.all([
    supabase
      .from('call_batches')
      .select(
        'id, nome, owner_id, status, pipeline_id, temperature_origin, script_id, script_version, order_mode, max_attempts, target_calls, starts_on, ends_on, total, pending, talked, created_at',
      )
      .order('created_at', { ascending: false })
      .limit(TETO_DE_LOTES),
    supabase.from('pipelines').select('id, name'),
    supabase.from('profiles').select('id, full_name'),
    supabase.from('call_scripts').select('id, nome'),
    supabase.from('interaction_outcomes').select('id').eq('slug', SLUG_REUNIAO).maybeSingle(),
  ]);

  const falha = lotes.error ?? funis.error ?? pessoas.error ?? roteiros.error;
  if (falha) throw falha;

  const idDaReuniao = desfechoDeReuniao.data?.id ?? null;
  const reunioesPorLote = new Map<string, number>();
  if (idDaReuniao !== null && (lotes.data ?? []).length > 0) {
    const chamadas = await supabase
      .from('call_attempts')
      .select('batch_id')
      .eq('outcome_id', idDaReuniao)
      .limit(TETO_DE_CHAMADAS);
    if (chamadas.error) throw chamadas.error;
    for (const chamada of chamadas.data ?? []) {
      reunioesPorLote.set(chamada.batch_id, (reunioesPorLote.get(chamada.batch_id) ?? 0) + 1);
    }
  }

  const nomeDoFunil = new Map((funis.data ?? []).map((f) => [f.id, f.name]));
  const nomeDaPessoa = new Map((pessoas.data ?? []).map((p) => [p.id, p.full_name]));
  const nomeDoRoteiro = new Map((roteiros.data ?? []).map((r) => [r.id, r.nome]));

  return (lotes.data ?? []).map((lote) => ({
    id: lote.id,
    nome: lote.nome,
    status: lote.status,
    dono: nomeDaPessoa.get(lote.owner_id) ?? 'Alguém do time',
    ehMeu: lote.owner_id === meuId,
    funilId: lote.pipeline_id,
    funil: nomeDoFunil.get(lote.pipeline_id) ?? 'Funil',
    temperaturaOrigem: lote.temperature_origin,
    ordem: lote.order_mode,
    roteiro: nomeDoRoteiro.get(lote.script_id) ?? 'Roteiro',
    roteiroVersao: lote.script_version,
    maxTentativas: lote.max_attempts,
    metaLigacoes: lote.target_calls,
    iniciaEm: lote.starts_on,
    terminaEm: lote.ends_on,
    criadoEm: lote.created_at,
    total: lote.total,
    faltam: lote.pending,
    feitos: lote.total - lote.pending,
    atenderam: lote.talked,
    reunioes: reunioesPorLote.get(lote.id) ?? 0,
  }));
}

/**
 * Encerra o lote e devolve à base todo mundo que ainda estava na fila.
 *
 * É a única saída honesta para um lote que não vai ser terminado: enquanto ele existir
 * `ativo`, os contatos dele seguem reservados e ninguém mais consegue ligar para
 * aquele buffet. Quem devolve os itens é o gatilho `call_batches_on_close`.
 */
export async function encerrarLote(loteId: string): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase
    .from('call_batches')
    .update({ status: 'encerrado' })
    .eq('id', loteId);

  if (error) throw error;
}
