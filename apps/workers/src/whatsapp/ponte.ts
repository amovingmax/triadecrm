/**
 * O banco visto do worker-wa: uma fachada fina sobre as RPCs de `public`.
 *
 * Mesma forma de `ingest/esteira.ts`, e pelo mesmo motivo: o cérebro é o
 * Postgres (ADR-03). Supressão, janela de 24 h, janela de horário, teto do
 * número, reconferência na entrega e idempotência por wamid já existem em
 * `app` (migração 20260905000200) e continuam lá. Este arquivo monta
 * argumento, traduz o que volta e dá NOME ao erro. Nenhuma regra de negócio
 * mora aqui, e é assim que precisa continuar.
 *
 * Por que não reusa `ingest/esteira.ts`: o `NomeDaFila` de lá é um tipo fechado
 * nas três filas do Radar, e alargá-lo para `wa_inbound`/`wa_outbound` mexeria
 * num arquivo de outro módulo para ganhar três linhas. As três chamadas de fila
 * daqui são as MESMAS funções de `public` — o que se repete é a assinatura, não
 * a regra.
 *
 * A conexão é HTTPS com a chave `service_role` (ADR-04). Ela ignora RLS: nada
 * neste arquivo pode ser chamado a partir do navegador.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

export type ClienteDoBanco = SupabaseClient;

export const FILA_ENTRADA = 'wa_inbound';
export const FILA_SAIDA = 'wa_outbound';

export function criarClienteWa(url: string, chaveServico: string): ClienteDoBanco {
  return createClient(url, chaveServico, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { 'x-worker': 'wa' } },
  });
}

/** Erro de conversa com o banco, já com o nome da operação. */
export class ErroDaPonte extends Error {
  constructor(
    readonly operacao: string,
    mensagem: string,
  ) {
    super(`${operacao}: ${mensagem}`);
    this.name = 'ErroDaPonte';
  }
}

async function rpc<T>(
  cliente: ClienteDoBanco,
  nome: string,
  argumentos: Record<string, unknown>,
): Promise<T> {
  const { data, error } = await cliente.rpc(nome, argumentos);
  if (error) throw new ErroDaPonte(nome, error.message);
  return data as T;
}

function objeto(valor: unknown): Record<string, unknown> {
  return typeof valor === 'object' && valor !== null && !Array.isArray(valor)
    ? (valor as Record<string, unknown>)
    : {};
}

function texto(valor: unknown): string | null {
  return typeof valor === 'string' && valor.trim() !== '' ? valor.trim() : null;
}

// ---------------------------------------------------------------------------
// Filas
// ---------------------------------------------------------------------------

export interface MensagemDaFila {
  msg_id: number;
  entregas: number;
  mensagem: Record<string, unknown>;
}

export async function lerFila(
  cliente: ClienteDoBanco,
  fila: string,
  quantidade = 5,
): Promise<MensagemDaFila[]> {
  const linhas = await rpc<unknown>(cliente, 'esteira_fila_ler', {
    p_queue: fila,
    p_qty: quantidade,
  });
  if (!Array.isArray(linhas)) return [];
  return linhas.map((linha) => {
    const l = objeto(linha);
    return {
      msg_id: Number(l.msg_id),
      entregas: Number(l.entregas ?? 0),
      mensagem: objeto(l.mensagem),
    };
  });
}

export async function concluir(
  cliente: ClienteDoBanco,
  fila: string,
  msgId: number,
  chave: string,
): Promise<void> {
  await rpc<boolean>(cliente, 'esteira_fila_concluir', {
    p_queue: fila,
    p_msg_id: msgId,
    p_key: chave,
  });
}

export type RespostaDeFalha = {
  acao: 'reagendado' | 'dead_letter' | 'arquivado_sem_dlq';
  tentativa: number;
};

export async function falhar(
  cliente: ClienteDoBanco,
  fila: string,
  msgId: number,
  chave: string,
  erro: string,
): Promise<RespostaDeFalha> {
  return rpc<RespostaDeFalha>(cliente, 'esteira_fila_falhar', {
    p_queue: fila,
    p_msg_id: msgId,
    p_key: chave,
    p_erro: erro.slice(0, 2000),
  });
}

// ---------------------------------------------------------------------------
// Entrada
// ---------------------------------------------------------------------------

export interface RespostaDeEntrada {
  novo: boolean;
  message_id: string | null;
  conversation_id: string | null;
}

function paraRespostaDeEntrada(bruto: unknown): RespostaDeEntrada {
  const r = objeto(bruto);
  return {
    novo: r.novo === true,
    message_id: texto(r.message_id),
    conversation_id: texto(r.conversation_id),
  };
}

export async function registrarEntrada(
  cliente: ClienteDoBanco,
  argumentos: {
    wamid: string;
    numeroDaEmpresa: string;
    de: string;
    tipo: string;
    corpo: string | null;
    mediaId: string | null;
    mediaMime: string | null;
    ocorridoEm: string;
  },
): Promise<RespostaDeEntrada> {
  return paraRespostaDeEntrada(
    await rpc<unknown>(cliente, 'wa_entrada_registrar', {
      p_wamid: argumentos.wamid,
      p_business_number: argumentos.numeroDaEmpresa,
      p_peer_phone: argumentos.de,
      p_type: argumentos.tipo,
      p_body: argumentos.corpo,
      p_media_id: argumentos.mediaId,
      p_media_mime: argumentos.mediaMime,
      p_occurred_at: argumentos.ocorridoEm,
    }),
  );
}

export async function registrarEco(
  cliente: ClienteDoBanco,
  argumentos: {
    wamid: string;
    numeroDaEmpresa: string;
    para: string;
    tipo: string;
    corpo: string | null;
    mediaId: string | null;
    mediaMime: string | null;
    ocorridoEm: string;
  },
): Promise<RespostaDeEntrada> {
  return paraRespostaDeEntrada(
    await rpc<unknown>(cliente, 'wa_eco_registrar', {
      p_wamid: argumentos.wamid,
      p_business_number: argumentos.numeroDaEmpresa,
      p_peer_phone: argumentos.para,
      p_type: argumentos.tipo,
      p_body: argumentos.corpo,
      p_media_id: argumentos.mediaId,
      p_media_mime: argumentos.mediaMime,
      p_occurred_at: argumentos.ocorridoEm,
    }),
  );
}

export async function registrarRecibo(
  cliente: ClienteDoBanco,
  argumentos: {
    wamid: string;
    estado: string;
    ocorridoEm: string;
    codigo: string | null;
    detalhe: string | null;
  },
): Promise<{ ok: boolean; motivo: string | null }> {
  const r = objeto(
    await rpc<unknown>(cliente, 'wa_status_registrar', {
      p_wamid: argumentos.wamid,
      p_status: argumentos.estado,
      p_ocorrido_em: argumentos.ocorridoEm,
      p_codigo: argumentos.codigo,
      p_detalhe: argumentos.detalhe,
    }),
  );
  return { ok: r.ok === true, motivo: texto(r.motivo) };
}

/**
 * Registra o opt-out e pede a confirmação de uma linha (RF-CON-19).
 *
 * O worker NÃO monta o texto da confirmação e não liga bandeira nenhuma: a
 * migração 20260905000300 estreitou a exceção, e `optout_confirmation` passou
 * a ser DERIVADA pelo banco a partir do estado (existe pedido de opt-out
 * registrado e ele ainda não foi confirmado). Mandá-la daqui seria recusado —
 * e é bom que seja: era exatamente por esse campo que um `insert` direto
 * atravessava a supressão inteira.
 *
 * `confirmacaoMotivo` vem preenchido quando a confirmação NÃO foi enfileirada
 * (`confirmacao_ja_enviada`, `sem_modelo_gen_sys_optout`, …). Sem ele o log
 * dizia só "false", que é a diferença entre "já saiu antes" e "não existe
 * modelo ativo" — duas coisas muito diferentes para quem lê o log às 2h.
 */
export async function registrarOptOut(
  cliente: ClienteDoBanco,
  conversationId: string,
  evidencia: string,
): Promise<{
  ok: boolean;
  motivo: string | null;
  confirmacaoEnfileirada: boolean;
  confirmacaoMotivo: string | null;
  confirmacaoDevendo: boolean;
}> {
  const r = objeto(
    await rpc<unknown>(cliente, 'wa_optout_registrar', {
      p_conversation_id: conversationId,
      p_evidencia: evidencia,
      p_confirmar: true,
    }),
  );
  return {
    ok: r.ok === true,
    motivo: texto(r.motivo),
    confirmacaoEnfileirada: r.confirmacao_enfileirada === true,
    confirmacaoMotivo: texto(r.confirmacao_motivo),
    // `confirmacaoDevendo` (20260905000400) é a diferença entre "já respondi"
    // e "não consegui responder". A segunda é uma dívida com quem pediu
    // silêncio, e quem a paga é app.wa_confirmacoes_reenfileirar quando ela
    // voltar a ser possível — não este worker.
    confirmacaoDevendo: r.confirmacao_devendo === true,
  };
}

export async function registrarMidia(
  cliente: ClienteDoBanco,
  messageId: string,
  caminho: string,
): Promise<void> {
  await rpc<unknown>(cliente, 'wa_midia_registrar', {
    p_message_id: messageId,
    p_media_path: caminho,
  });
}

export async function pedirTrabalhoDeIa(
  cliente: ClienteDoBanco,
  proposito: string,
  payload: Record<string, unknown>,
  chave: string,
): Promise<{ enfileirado: boolean; motivo: string | null }> {
  const r = objeto(
    await rpc<unknown>(cliente, 'ia_fila_enfileirar', {
      p_purpose: proposito,
      p_payload: payload,
      p_key: chave,
    }),
  );
  return { enfileirado: r.enfileirado === true, motivo: texto(r.motivo) };
}

// ---------------------------------------------------------------------------
// Saída
// ---------------------------------------------------------------------------

export interface ModeloAprovado {
  codigo: string;
  nome_meta: string;
  idioma: string;
  categoria: string;
}

export interface ItemDeSaida {
  msg_id: number;
  message_id: string;
  conversation_id: string;
  business_number: string;
  para: string;
  tipo: string;
  corpo: string | null;
  template_params: unknown[];
  audio_asset_id: string | null;
  janela_aberta: boolean;
  modelo: ModeloAprovado | null;
}

export interface Recusado {
  message_id: string | null;
  motivo: string;
  acao: string;
  quando: string | null;
}

export interface LoteDeSaida {
  itens: ItemDeSaida[];
  recusados: Recusado[];
}

function paraItemDeSaida(bruto: unknown): ItemDeSaida | null {
  const i = objeto(bruto);
  const messageId = texto(i.message_id);
  const conversationId = texto(i.conversation_id);
  const para = texto(i.para);
  const numero = texto(i.business_number);
  if (messageId === null || conversationId === null || para === null || numero === null)
    return null;

  const m = objeto(i.modelo);
  const nomeMeta = texto(m.nome_meta);
  return {
    msg_id: Number(i.msg_id),
    message_id: messageId,
    conversation_id: conversationId,
    business_number: numero,
    para,
    tipo: texto(i.tipo) ?? 'text',
    corpo: texto(i.corpo),
    template_params: Array.isArray(i.template_params) ? i.template_params : [],
    audio_asset_id: texto(i.audio_asset_id),
    janela_aberta: i.janela_aberta === true,
    modelo:
      nomeMeta === null
        ? null
        : {
            codigo: texto(m.codigo) ?? '',
            nome_meta: nomeMeta,
            idioma: texto(m.idioma) ?? 'pt_BR',
            categoria: texto(m.categoria) ?? 'utility',
          },
  };
}

export async function proximosEnvios(
  cliente: ClienteDoBanco,
  quantidade: number,
): Promise<LoteDeSaida> {
  const bruto = objeto(await rpc<unknown>(cliente, 'wa_saida_proximos', { p_qty: quantidade }));
  const itens = (Array.isArray(bruto.itens) ? bruto.itens : [])
    .map(paraItemDeSaida)
    .filter((i): i is ItemDeSaida => i !== null);
  const recusados = (Array.isArray(bruto.recusados) ? bruto.recusados : []).map((r) => {
    const o = objeto(r);
    return {
      message_id: texto(o.message_id),
      motivo: texto(o.motivo) ?? 'desconhecido',
      acao: texto(o.acao) ?? 'desconhecido',
      quando: texto(o.quando),
    };
  });
  return { itens, recusados };
}

export async function enfileirarPendentes(
  cliente: ClienteDoBanco,
  quantidade = 50,
): Promise<{ enfileirados: number; ja_estavam: number }> {
  const r = objeto(
    await rpc<unknown>(cliente, 'wa_saida_enfileirar_pendentes', { p_qty: quantidade }),
  );
  return {
    enfileirados: Number(r.enfileirados ?? 0),
    ja_estavam: Number(r.ja_estavam ?? 0),
  };
}

export async function envioDeuCerto(
  cliente: ClienteDoBanco,
  argumentos: {
    msgId: number;
    messageId: string;
    wamid: string;
    custo: number | null;
    categoria: string | null;
  },
): Promise<void> {
  await rpc<boolean>(cliente, 'wa_saida_sucesso', {
    p_msg_id: argumentos.msgId,
    p_message_id: argumentos.messageId,
    p_wamid: argumentos.wamid,
    p_custo: argumentos.custo,
    p_categoria: argumentos.categoria,
  });
}

export async function envioFalhou(
  cliente: ClienteDoBanco,
  argumentos: { msgId: number; messageId: string; erro: string; codigo: string },
): Promise<RespostaDeFalha> {
  return rpc<RespostaDeFalha>(cliente, 'wa_saida_falha', {
    p_msg_id: argumentos.msgId,
    p_message_id: argumentos.messageId,
    p_erro: argumentos.erro.slice(0, 2000),
    p_codigo: argumentos.codigo,
  });
}

/**
 * Erro que não melhora com repetição: encerra a mensagem sem backoff. Quem
 * distingue transitório de definitivo é a tabela de erros de `graph.ts`.
 */
export async function envioFalhouDeVez(
  cliente: ClienteDoBanco,
  argumentos: { msgId: number; messageId: string; erro: string; codigo: string },
): Promise<void> {
  await rpc<unknown>(cliente, 'wa_saida_falha_definitiva', {
    p_msg_id: argumentos.msgId,
    p_message_id: argumentos.messageId,
    p_erro: argumentos.erro.slice(0, 2000),
    p_codigo: argumentos.codigo,
  });
}

// ---------------------------------------------------------------------------
// Configuração de envio (RF-CON-10, R04 §4)
// ---------------------------------------------------------------------------

export interface ConfigDeEnvio {
  intervaloMinSeg: number;
  intervaloMaxSeg: number;
}

export const CONFIG_DE_ENVIO_PADRAO: ConfigDeEnvio = {
  intervaloMinSeg: 45,
  intervaloMaxSeg: 180,
};

/**
 * O intervalo aleatório entre envios (R04 §4: "45–180 s"). Está em
 * `app_settings` porque é operação, não código: quem aumenta o volume é quem
 * opera o número, e mudar isso não pode exigir deploy.
 */
export async function lerConfigDeEnvio(cliente: ClienteDoBanco): Promise<ConfigDeEnvio> {
  const { data, error } = await cliente
    .from('app_settings')
    .select('value')
    .eq('key', 'whatsapp.envio')
    .maybeSingle();
  if (error || data === null) return CONFIG_DE_ENVIO_PADRAO;
  const v = objeto((data as { value?: unknown }).value);
  const min = Number(v.intervalo_min_seg);
  const max = Number(v.intervalo_max_seg);
  return {
    intervaloMinSeg:
      Number.isFinite(min) && min >= 0 ? min : CONFIG_DE_ENVIO_PADRAO.intervaloMinSeg,
    intervaloMaxSeg: Number.isFinite(max) && max > 0 ? max : CONFIG_DE_ENVIO_PADRAO.intervaloMaxSeg,
  };
}

/** Cadência humana: um número aleatório de milissegundos dentro do intervalo. */
export function esperaEntreEnvios(config: ConfigDeEnvio, sorteio = Math.random): number {
  const min = Math.max(0, config.intervaloMinSeg);
  const max = Math.max(min, config.intervaloMaxSeg);
  return Math.round((min + sorteio() * (max - min)) * 1000);
}

// ---------------------------------------------------------------------------
// Saúde do WhatsApp (RF-CON-19)
// ---------------------------------------------------------------------------

/**
 * Uma pendência que SÓ uma pessoa destrava. Hoje há uma que importa: enquanto
 * o GEN-SYS-OPTOUT não estiver aprovado no Meta Business, quem pede para sair
 * mais de 24 h depois da última mensagem não recebe a confirmação do
 * RF-CON-19 — a Meta só aceita template aprovado fora da janela (R04 §2.1).
 *
 * O worker não conserta isso e não deve tentar. Ele grita, porque uma
 * pendência que mora só num comentário de migração não é vista por ninguém.
 */
export interface AcaoHumana {
  oQue: string;
  quem: string | null;
  porque: string | null;
  pessoasEsperando: number | null;
}

export async function acoesHumanasDoWhatsapp(cliente: ClienteDoBanco): Promise<AcaoHumana[]> {
  const r = objeto(await rpc<unknown>(cliente, 'wa_saude', {}));
  const lista = Array.isArray(r.acao_humana) ? r.acao_humana : [];
  return lista.map((item) => {
    const a = objeto(item);
    const n = Number(a.pessoas_esperando);
    return {
      oQue: texto(a.o_que) ?? 'pendência sem descrição',
      quem: texto(a.quem),
      porque: texto(a.porque),
      pessoasEsperando: Number.isFinite(n) ? n : null,
    };
  });
}
