'use client';

import { z } from 'zod';
import { Constants } from '@komune/schema';

import { createClient } from '@/lib/supabase/client';

import {
  COLUNAS_DO_LOTE,
  loteDaLinha,
  type LinhaDeLote,
  type LoteResumido,
} from './chamada-contexto';
import {
  MENSAGENS_DE_RECUSA_DA_CHAMADA,
  MENSAGENS_DE_RECUSA_DA_DISCAGEM,
  noSchema,
  resultadoTabulacaoSchema,
  RPC_DEVOLVER_ITEM,
  RPC_MARCAR_NAO_LIGAR,
  RPC_INICIAR_CHAMADA,
  RPC_MONTAR_LOTE,
  RPC_TABULAR_CHAMADA,
  type ItemDoLote,
  type MontarLote,
  type MotivoDeExclusao,
  type ResultadoTabulacao,
  type Roteiro,
  type TabularChamada,
  type VarianteRoteiro,
} from './tipos';

/**
 * A ponte entre a tela e as cinco RPCs do módulo (migração 20260904001300).
 *
 * Regra da casa, herdada de `components/registro/gravar.ts`: **nenhum texto do
 * Postgres chega à tela.** Recusa prevista volta nomeada pelo banco
 * (`{ok:false, motivo}`) e vira frase pronta; exceção (rede, sessão, RLS) vira uma
 * frase que diz o que fazer, e o texto cru fica no console de quem depura.
 *
 * O telefone só existe aqui dentro: ele vem de `proximo_da_fila` e de
 * `iniciar_chamada`, que o revelam com registro em `pii_access_log` (RF-BAS-14).
 * Nenhuma consulta desta tela lê `call_batch_items.phone_e164` direto — o `select`
 * daquela coluna nem sequer é concedido a `authenticated`.
 */

export class ErroDaLigacao extends Error {
  readonly podeTentarDeNovo: boolean;

  constructor(mensagem: string, podeTentarDeNovo: boolean, causa?: unknown) {
    super(mensagem, { cause: causa });
    this.name = 'ErroDaLigacao';
    this.podeTentarDeNovo = podeTentarDeNovo;
  }
}

/** Traduz o código do PostgREST numa frase que diz o que fazer. */
function levantar(codigo: string | null | undefined, causa: unknown): never {
  switch (codigo) {
    case '42501':
      throw new ErroDaLigacao('Seu perfil não pode trabalhar lotes de ligação.', false, causa);
    case 'PGRST301':
    case '401':
      throw new ErroDaLigacao('Sua sessão expirou. Entre de novo para continuar.', false, causa);
    case 'PGRST202':
      throw new ErroDaLigacao(
        'Esta versão da tela não conversa com o servidor. Recarregue a página.',
        false,
        causa,
      );
    default:
      throw new ErroDaLigacao(
        'Não deu para falar com o servidor. Verifique a conexão e tente de novo.',
        true,
        causa,
      );
  }
}

/** O servidor respondeu num formato que esta versão da tela não entende. */
function levantarFormato(causa: unknown): never {
  throw new ErroDaLigacao(
    'O servidor respondeu de um jeito que esta versão da tela não entende. Recarregue a página.',
    false,
    causa,
  );
}

// ---------------------------------------------------------------------------
// Montar o lote
// ---------------------------------------------------------------------------

const MOTIVOS_DE_EXCLUSAO = [
  'sem_telefone',
  'suprimido',
  'nao_contatar',
  'em_janela_de_recontato',
  'reservado_em_outro_lote',
  'sem_negocio_aberto',
  'temperatura_diferente',
] as const satisfies readonly MotivoDeExclusao[];

const montagemSchema = z.discriminatedUnion('montado', [
  z.object({
    montado: z.literal(true),
    lote_id: z.uuid(),
    pedidos: z.number().int(),
    entraram: z.number().int(),
    excluidos: z.record(z.string(), z.number().int()).default({}),
    roteiro_id: z.uuid(),
    roteiro_versao: z.number().int(),
  }),
  z.object({
    montado: z.literal(false),
    motivo: z.enum(['sem_permissao', 'tamanho_invalido', 'funil_invalido', 'roteiro_invalido']),
    detalhe: z.string().nullable(),
  }),
]);

export type Montagem = z.infer<typeof montagemSchema>;

export const MENSAGENS_DE_RECUSA_DA_MONTAGEM: Record<
  Extract<Montagem, { montado: false }>['motivo'],
  string
> = {
  sem_permissao: 'Seu perfil não monta lote de ligação.',
  tamanho_invalido: 'O lote tem de ter entre 1 e 60 contatos.',
  funil_invalido: 'Esse funil não existe mais. Recarregue a tela.',
  roteiro_invalido: 'Esse roteiro não está publicado. Escolha outro.',
};

/** Só os motivos que o contrato conhece; um motivo novo do banco é ignorado na soma. */
export function excluidosConhecidos(
  bruto: Record<string, number>,
): Partial<Record<MotivoDeExclusao, number>> {
  const limpo: Partial<Record<MotivoDeExclusao, number>> = {};
  for (const motivo of MOTIVOS_DE_EXCLUSAO) {
    const n = bruto[motivo];
    if (typeof n === 'number' && n > 0) limpo[motivo] = n;
  }
  return limpo;
}

export async function montarLote(entrada: MontarLote): Promise<Montagem> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc(RPC_MONTAR_LOTE, {
    p_nome: entrada.nome,
    p_pipeline_id: entrada.pipelineId,
    p_temperatura_origem: entrada.temperaturaOrigem,
    p_roteiro_id: entrada.roteiroId,
    p_categoria_ids: entrada.categoriaIds,
    p_ordem: entrada.ordem,
    p_tamanho: entrada.tamanho,
    p_max_tentativas: entrada.maxTentativas,
    p_horas_entre_tentativas: entrada.horasEntreTentativas,
    p_meta_ligacoes: entrada.metaLigacoes,
    p_inicia_em: entrada.iniciaEm,
    p_termina_em: entrada.terminaEm,
  });
  if (error) levantar(error.code, error);

  const lido = montagemSchema.safeParse(data);
  if (!lido.success) levantarFormato(lido.error);
  return lido.data;
}

// ---------------------------------------------------------------------------
// Ler um lote (leitura direta da tabela: `call_batches` não guarda telefone)
// ---------------------------------------------------------------------------

/**
 * O lote recém-montado, para a tela abrir sem esperar um `router.refresh()`.
 *
 * É `select` direto porque `call_batches` não tem PII e a política já resolve a
 * visibilidade (`app.sees_all()` ou dono). Os contadores `total`, `pending` e
 * `talked` são materializados pelo gatilho `app.call_batches_refresh_counts`, então
 * reler o lote é uma consulta só e nunca uma contagem.
 */
export async function lerLote(loteId: string): Promise<LoteResumido | null> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from('call_batches')
    .select(COLUNAS_DO_LOTE)
    .eq('id', loteId)
    .maybeSingle();
  if (error) levantar(error.code, error);
  if (!data) return null;
  return loteDaLinha(data as LinhaDeLote);
}

// ---------------------------------------------------------------------------
// O próximo da fila
// ---------------------------------------------------------------------------

const itemSchema = z.object({
  id: z.uuid(),
  lote_id: z.uuid(),
  organization_id: z.uuid(),
  nome: z.string(),
  kind: z.enum(Constants.app.Enums.org_kind),
  categoria: z.string().nullish(),
  bairro: z.string().nullish(),
  cidade: z.string().nullish(),
  telefone: z.string(),
  contato_id: z.uuid().nullish(),
  contato_nome: z.string().nullish(),
  origem_slug: z.string().nullish(),
  origem_url: z.string().nullish(),
  deal_id: z.uuid().nullish(),
  etapa_id: z.number().int().nullish(),
  etapa: z.string().nullish(),
  temperatura: z.enum(Constants.app.Enums.temperature),
  status: z.enum(['fila', 'em_andamento', 'concluido', 'devolvido']),
  posicao: z.number().int(),
  tentativas: z.number().int(),
  agendado_para: z.string().nullish(),
  ultima_tentativa_em: z.string().nullish(),
  observacao: z.string().nullish(),
});

const proximoSchema = z.discriminatedUnion('ok', [
  z.object({
    ok: z.literal(true),
    item: itemSchema,
    roteiro: z.object({
      id: z.uuid(),
      versao: z.number().int(),
      arvore: z.array(noSchema).min(1),
    }),
    variante: z.enum(['fornecedor', 'produtor']),
    restantes: z.number().int(),
    fecha_em: z.string().nullish(),
  }),
  z.object({
    ok: z.literal(false),
    motivo: z.enum([
      'sem_permissao',
      'lote_de_outro_dono',
      'lote_encerrado',
      'fora_do_periodo',
      'fora_da_janela',
      'fila_vazia',
    ]),
    detalhe: z.string().nullish(),
    abre_em: z.string().nullish(),
  }),
]);

export type RespostaDoProximo =
  | {
      ok: true;
      item: ItemDoLote;
      roteiro: Roteiro;
      variante: VarianteRoteiro;
      restantes: number;
      fechaEm: string | null;
    }
  | {
      ok: false;
      motivo: Extract<z.infer<typeof proximoSchema>, { ok: false }>['motivo'];
      detalhe: string | null;
      abreEm: string | null;
    };

export const MENSAGENS_DE_RECUSA_DA_FILA: Record<
  Extract<RespostaDoProximo, { ok: false }>['motivo'],
  string
> = {
  sem_permissao: 'Seu perfil não trabalha lotes de ligação.',
  lote_de_outro_dono: 'Este lote é de outra pessoa. Abra um lote seu.',
  lote_encerrado: 'Este lote foi encerrado. Monte o lote de hoje.',
  fora_do_periodo: 'Este lote não vale para hoje. Monte o lote de hoje.',
  fora_da_janela: 'Fora do horário de ligação. A fila volta na próxima janela.',
  fila_vazia: 'Acabou a fila deste lote.',
};

/**
 * Puxa o próximo contato e RESERVA o item (`em_andamento`) por 30 minutos.
 *
 * `nome`, `slug` e a versão do roteiro não vêm da RPC (ela devolve só a árvore
 * congelada do lote), então o chamador passa o que já leu do catálogo de roteiros.
 * É o mesmo roteiro: `montar_lote` gravou `script_id` no lote e a RPC devolve a
 * árvore por esse id.
 */
export async function puxarProximo(
  loteId: string,
  roteiroConhecido: { slug: string; nome: string },
): Promise<RespostaDoProximo> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc('proximo_da_fila', { p_lote_id: loteId });
  if (error) levantar(error.code, error);

  const lido = proximoSchema.safeParse(data);
  if (!lido.success) levantarFormato(lido.error);

  if (!lido.data.ok) {
    return {
      ok: false,
      motivo: lido.data.motivo,
      detalhe: lido.data.detalhe ?? null,
      abreEm: lido.data.abre_em ?? null,
    };
  }

  const i = lido.data.item;
  return {
    ok: true,
    item: {
      id: i.id,
      loteId: i.lote_id,
      organizationId: i.organization_id,
      nome: i.nome,
      kind: i.kind,
      categoria: i.categoria ?? null,
      bairro: i.bairro ?? null,
      cidade: i.cidade ?? null,
      telefone: i.telefone,
      contatoId: i.contato_id ?? null,
      contatoNome: i.contato_nome ?? null,
      origemSlug: i.origem_slug ?? '',
      origemUrl: i.origem_url ?? null,
      dealId: i.deal_id ?? null,
      etapaId: i.etapa_id ?? null,
      etapa: i.etapa ?? null,
      temperatura: i.temperatura,
      status: i.status,
      posicao: i.posicao,
      tentativas: i.tentativas,
      agendadoPara: i.agendado_para ?? null,
      ultimaTentativaEm: i.ultima_tentativa_em ?? null,
      observacao: i.observacao ?? null,
    },
    roteiro: {
      id: lido.data.roteiro.id,
      slug: roteiroConhecido.slug,
      nome: roteiroConhecido.nome,
      versao: lido.data.roteiro.versao,
      nos: lido.data.roteiro.arvore,
    },
    variante: lido.data.variante,
    restantes: lido.data.restantes,
    fechaEm: lido.data.fecha_em ?? null,
  };
}

// ---------------------------------------------------------------------------
// Abrir a chamada
// ---------------------------------------------------------------------------

const chamadaSchema = z.discriminatedUnion('ok', [
  z.object({
    ok: z.literal(true),
    chamada: z.object({
      id: z.uuid(),
      item_id: z.uuid(),
      telefone: z.string(),
      iniciada_em: z.string(),
      provedor: z.literal('manual'),
    }),
  }),
  z.object({
    ok: z.literal(false),
    motivo: z.string(),
    detalhe: z.string().nullish(),
    abre_em: z.string().nullish(),
  }),
]);

export type RespostaDaChamada =
  | { ok: true; chamadaId: string; itemId: string; telefone: string; iniciadaEm: string }
  | { ok: false; frase: string; abreEm: string | null };

/** Abre `call_attempts`, conta a tentativa, estende a reserva e devolve o telefone. */
export async function abrirChamada(itemId: string): Promise<RespostaDaChamada> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc(RPC_INICIAR_CHAMADA, { p_item_id: itemId });
  if (error) levantar(error.code, error);

  const lido = chamadaSchema.safeParse(data);
  if (!lido.success) levantarFormato(lido.error);

  if (!lido.data.ok) {
    return {
      ok: false,
      frase:
        MENSAGENS_DE_RECUSA_DA_DISCAGEM[lido.data.motivo] ??
        MENSAGENS_DE_RECUSA_DA_CHAMADA[
          lido.data.motivo as keyof typeof MENSAGENS_DE_RECUSA_DA_CHAMADA
        ] ??
        'Não deu para abrir esta ligação. Puxe o próximo da fila.',
      abreEm: lido.data.abre_em ?? null,
    };
  }
  return {
    ok: true,
    chamadaId: lido.data.chamada.id,
    itemId: lido.data.chamada.item_id,
    telefone: lido.data.chamada.telefone,
    iniciadaEm: lido.data.chamada.iniciada_em,
  };
}

// ---------------------------------------------------------------------------
// Tabular
// ---------------------------------------------------------------------------

export async function tabularChamada(pedido: TabularChamada): Promise<ResultadoTabulacao> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc(RPC_TABULAR_CHAMADA, {
    p_client_key: pedido.clientKey,
    p_chamada_id: pedido.chamadaId,
    p_item_id: pedido.itemId,
    p_resultado: pedido.resultado,
    p_com_quem: pedido.comQuem,
    p_outcome_id: pedido.outcomeId,
    p_caminho_script: pedido.caminhoScript,
    p_duracao_seg: pedido.duracaoSeg,
    p_observacao: pedido.observacao,
    p_capturas: pedido.capturas,
    p_agendar_para: pedido.agendarPara,
    p_lost_reason_id: pedido.lostReasonId,
    p_reuniao_em: pedido.reuniaoEm,
    p_reuniao_formato: pedido.reuniaoFormato,
    p_pediu_para_nao_ligar: pedido.pediuParaNaoLigar,
  });
  if (error) levantar(error.code, error);

  const lido = resultadoTabulacaoSchema.safeParse(data);
  if (!lido.success) levantarFormato(lido.error);
  return lido.data;
}

/** A frase de uma recusa prevista da tabulação, pronta para a tela. */
export function fraseDaRecusaDaChamada(
  resultado: Extract<ResultadoTabulacao, { tabulado: false }>,
): string {
  return MENSAGENS_DE_RECUSA_DA_CHAMADA[resultado.motivo];
}

// ---------------------------------------------------------------------------
// Devolver o item sem tabular
// ---------------------------------------------------------------------------

/**
 * Devolve o item à fila sem tabular (ela desistiu antes de discar, ou errou o
 * contato). Falha em silêncio de propósito: a reserva expira sozinha em 30 minutos
 * (`app.expirar_reservas`, `pg_cron`), então nada se perde se este pedido não sair.
 */
export async function devolverItem(itemId: string, motivo?: string): Promise<void> {
  const supabase = createClient();
  await supabase.rpc(RPC_DEVOLVER_ITEM, { p_item_id: itemId, p_motivo: motivo ?? null });
}

// ---------------------------------------------------------------------------
// Opt-out imediato
// ---------------------------------------------------------------------------

/**
 * Grava o "não me ligue mais" NA HORA, sem esperar a tabulação.
 *
 * Por que não espera: o guardrail do produto é suprimir no instante do pedido. Se
 * isto só valesse no commit, quem pedisse para sair e visse a ligação cair — ou o
 * operador sair pelo menu — continuaria na fila. Foi medido acontecendo.
 *
 * A RPC é idempotente por (organização, pessoa), então marcar de novo no commit não
 * duplica nada: `tabular_chamada` continua mandando `p_pediu_para_nao_ligar`, e é ele
 * que garante a supressão mesmo se ESTA chamada não sair (rede caindo, aba morrendo).
 * Duas portas para a mesma consequência é de propósito — a barata falha aberta.
 *
 * O efeito colateral aceito: o negócio pode ir para a etapa de opt-out agora e ser
 * movido de novo pelo desfecho no commit. Supressão é garantia, etapa é apresentação;
 * perder um opt-out é inaceitável, e o cartão aparecer numa etapa por um instante não.
 */
export async function marcarNaoLigarMais(entrada: {
  itemId: string;
  organizationId?: string | null;
  contactId?: string | null;
  evidencia?: string | null;
}): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase.rpc(RPC_MARCAR_NAO_LIGAR, {
    p_item_id: entrada.itemId,
    p_organization_id: entrada.organizationId ?? null,
    p_contact_id: entrada.contactId ?? null,
    p_evidencia: entrada.evidencia ?? null,
  });
  if (error) levantar(error.code, error);
}
