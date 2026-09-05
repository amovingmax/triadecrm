/**
 * Os quatro trabalhos da IA, na ordem do R13.
 *
 *   1. transcribe_audio  — o áudio que o fornecedor mandou vira texto legível.
 *   2. summarize_call    — a ligação vira três linhas na ficha.
 *   3. draft_followup    — o WhatsApp de depois da ligação vira RASCUNHO.
 *   4. classify_inbound  — a mensagem recebida vira intenção e decisão.
 *
 * A ordem não é gosto. Com o primeiro contato virando ligação (R13), o
 * fornecedor responde por áudio mesmo quando a gente escreve: áudio que ninguém
 * ouve é conversa que não anda. Depois vem entender a ligação que já aconteceu,
 * depois escrever o retorno, e só então classificar o que chega — que é o fluxo
 * que só existe de verdade quando o WhatsApp estiver de pé.
 *
 * ## Duas naturezas de erro, tratadas diferente (a mesma regra do coletor)
 *
 *   TRANSITÓRIO   (rede, 429, 5xx): a mensagem falha, ganha backoff e volta.
 *   DETERMINÍSTICO (payload torto, registro que não existe, guardrail de PII):
 *     repetir não muda nada. A mensagem é CONCLUÍDA, o motivo vai para o log e
 *     — no caso do guardrail — para uma tarefa e para `ai_runs`. Deixar isso
 *     girando cinco vezes só atrasaria a dead-letter e gastaria a mesma recusa
 *     cinco vezes. No caso da IA, gastar de novo é gastar dinheiro de novo.
 *
 * ## O que este arquivo NUNCA faz
 *
 * Não envia mensagem. Não aprova rascunho. Não tira ninguém da supressão. O
 * rascunho que a IA escreve entra em `message_drafts` como `pendente` e espera
 * uma pessoa (ADR-05, RF-CON-22) — e não é este código que garante isso, é o
 * gatilho `app.message_drafts_guard`, que exige `auth.uid()` para aprovar. Um
 * worker com chave de serviço não consegue preencher a condição nem em teoria.
 */
import { z } from 'zod';

import {
  INTENCOES,
  LIMIAR_DE_CONFIANCA,
  MAXIMO_DE_INAUDIVEIS,
  classificarIntencaoV1,
  decidirIntencao,
  decidirRoteamento,
  detectarOptOut,
  followupLigacaoV1,
  reidratar,
  resumoLigacaoV1,
  transcricaoAudioV1,
  validarPromessas,
  viradaProvavel,
  type Intencao,
  type MapaDePseudonimos,
} from '@komune/prompts';

import {
  buscarContatoDaFicha,
  buscarConversa,
  buscarMensagem,
  buscarTentativa,
  criarRascunho,
  escalarConversa,
  gravarClassificacao,
  gravarResumoDaLigacao,
  gravarTranscricao,
} from './banco';
import { ChamadaBloqueadaError, executar, leadIdCurto, type ContextoDaIa } from './execucao';
import { enfileirarTrabalho } from './fila';

import type { ClienteDoBanco } from '../ingest/esteira';

/**
 * Erro que não adianta repetir: o mundo teria de mudar, não a tentativa.
 * A mensagem é concluída na fila e o motivo fica no log.
 */
export class ErroDeterministico extends Error {
  constructor(motivo: string) {
    super(motivo);
    this.name = 'ErroDeterministico';
  }
}

export function eDeterministico(erro: unknown): boolean {
  return erro instanceof ErroDeterministico || erro instanceof ChamadaBloqueadaError;
}

/**
 * RF-CON-27: no MVP, áudio recebido vai SEMPRE para uma pessoa. A transcrição
 * serve para ela ler em 5 segundos em vez de ouvir 40 — não para o robô decidir
 * sozinho. É constante, e não configuração, porque afrouxá-la é decisão de
 * produto (Rafael/Heloísa), não de operação.
 */
const AUDIO_SEMPRE_HUMANO = true;

// ---------------------------------------------------------------------------
// Os payloads da fila
// ---------------------------------------------------------------------------

const uuid = z.string().uuid();

const payloadDaTranscricao = z.object({
  purpose: z.literal('transcribe_audio'),
  message_id: uuid,
  /** O que o faster-whisper devolveu (RF-CON-27). Áudio não vira token. */
  transcricao_bruta: z.string().min(1).max(12000),
  confianca_asr: z.number().min(0).max(1),
  duracao_seg: z.number().int().min(1).max(600),
  contexto: z.string().max(400).nullish(),
});

const payloadDoResumo = z.object({
  purpose: z.literal('summarize_call'),
  attempt_id: uuid,
});

const payloadDoFollowUp = z.object({
  purpose: z.literal('draft_followup'),
  attempt_id: uuid,
  /** RF-CON-15: o gancho vem do CRM. Sem gancho, a mensagem só retoma o combinado. */
  gancho: z.string().max(240).nullish(),
});

const payloadDaClassificacao = z.object({
  purpose: z.literal('classify_inbound'),
  message_id: uuid,
});

const PAYLOADS = {
  transcribe_audio: payloadDaTranscricao,
  summarize_call: payloadDoResumo,
  draft_followup: payloadDoFollowUp,
  classify_inbound: payloadDaClassificacao,
} as const;

export type PropositoConhecido = keyof typeof PAYLOADS;

export function ePropositoConhecido(valor: unknown): valor is PropositoConhecido {
  return typeof valor === 'string' && valor in PAYLOADS;
}

export interface ResultadoDoTrabalho {
  readonly proposito: PropositoConhecido;
  readonly feito: boolean;
  readonly motivo?: string;
  readonly aiRunId?: number;
  readonly custoUsd?: number;
  readonly detalhes?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// 1. Transcrever o áudio recebido (R13, RF-CON-27)
// ---------------------------------------------------------------------------

async function transcrever(
  contexto: ContextoDaIa,
  bruto: unknown,
): Promise<ResultadoDoTrabalho> {
  const payload = interpretarPayload(payloadDaTranscricao, bruto);
  const mensagem = await buscarMensagem(contexto.cliente, payload.message_id);
  if (mensagem === null) {
    throw new ErroDeterministico(`mensagem ${payload.message_id} não existe`);
  }
  const conversa = await buscarConversa(contexto.cliente, mensagem.conversationId);
  if (conversa === null) {
    throw new ErroDeterministico(`conversa ${mensagem.conversationId} não existe`);
  }

  const ficha = await buscarContatoDaFicha(
    contexto.cliente,
    conversa.organizationId ?? mensagem.organizationId,
    conversa.contactId ?? mensagem.contactId,
    conversa.telefone,
  );

  const executada = await executar(
    contexto,
    transcricaoAudioV1,
    {
      leadId: leadIdCurto(ficha.organizationId),
      canal: 'whatsapp',
      duracaoSeg: payload.duracao_seg,
      transcricaoBruta: payload.transcricao_bruta,
      confiancaAsr: payload.confianca_asr,
      contexto: payload.contexto ?? null,
    },
    contatoDoPrompt(ficha),
    { organizationId: ficha.organizationId, conversationId: conversa.id },
  );

  // Reidratar aqui é correto: `messages.transcript` é lido por gente.
  await gravarTranscricao(
    contexto.cliente,
    mensagem.id,
    reidratar(executada.saida.textoLimpo, executada.mapa),
  );

  const roteamento = decidirRoteamento(executada.saida, { modoMvp: AUDIO_SEMPRE_HUMANO });
  if (roteamento.destino === 'humano') {
    await escalarConversa(contexto.cliente, conversa.id);
  } else {
    await enfileirarTrabalho(contexto.cliente, 'classify_inbound', `msg:${mensagem.id}`, {
      message_id: mensagem.id,
    });
  }

  contexto.logger.info('áudio transcrito', {
    message_id: mensagem.id,
    confianca: executada.saida.confianca,
    inaudiveis: executada.saida.trechosInaudiveis,
    maximo_de_inaudiveis: MAXIMO_DE_INAUDIVEIS,
    destino: roteamento.destino,
    motivos: roteamento.motivos,
  });

  return {
    proposito: 'transcribe_audio',
    feito: true,
    aiRunId: executada.aiRunId,
    custoUsd: executada.custoUsd,
    detalhes: { destino: roteamento.destino, motivos: roteamento.motivos },
  };
}

// ---------------------------------------------------------------------------
// 2. Resumir a ligação (R13 §3.2)
// ---------------------------------------------------------------------------

async function resumirLigacao(
  contexto: ContextoDaIa,
  bruto: unknown,
): Promise<ResultadoDoTrabalho> {
  const payload = interpretarPayload(payloadDoResumo, bruto);
  const tentativa = await buscarTentativa(contexto.cliente, payload.attempt_id);
  if (tentativa === null) {
    throw new ErroDeterministico(`tentativa de ligação ${payload.attempt_id} não existe`);
  }
  // Ninguém atendeu: não há conversa para resumir, e `lig_nao_atendeu` é
  // tabulação automática, sem texto e sem modelo (é a premissa de custo do
  // CHAMADAS_POR_MES em packages/prompts).
  if (tentativa.caminho.length === 0) {
    return { proposito: 'summarize_call', feito: false, motivo: 'caminho_vazio' };
  }
  if (tentativa.activityId === null) {
    throw new ErroDeterministico(
      `a tentativa ${tentativa.id} não tem atividade: sem ela o resumo não teria onde ser lido`,
    );
  }

  const ficha = await buscarContatoDaFicha(
    contexto.cliente,
    tentativa.organizationId,
    tentativa.contactId,
  );

  const executada = await executar(
    contexto,
    resumoLigacaoV1,
    {
      leadId: leadIdCurto(tentativa.organizationId),
      variante: tentativa.variante,
      duracaoSeg: tentativa.duracaoSeg,
      caminho: tentativa.caminho,
      capturas: tentativa.capturas,
      anotacao: tentativa.anotacao,
      desfecho: tentativa.desfecho,
    },
    contatoDoPrompt(ficha),
    { organizationId: tentativa.organizationId, activityId: tentativa.activityId },
  );

  const saida = executada.saida;
  const porRegra = viradaProvavel(tentativa.caminho);
  if (porRegra !== null && saida.noDeVirada !== porRegra) {
    // A regra do R13 §3.2 não substitui o modelo: confere. Divergência é sinal
    // para o eval, não motivo para recusar o resumo.
    contexto.logger.info('o nó de virada do modelo diverge da regra', {
      attempt_id: tentativa.id,
      do_modelo: saida.noDeVirada,
      por_regra: porRegra,
    });
  }

  await gravarResumoDaLigacao(contexto.cliente, tentativa.activityId, {
    resumo: reidratar(saida.resumo, executada.mapa),
    combinado: saida.combinado === null ? null : reidratar(saida.combinado, executada.mapa),
    objecoes: saida.objecoes.map((o) => reidratar(o, executada.mapa)),
    fatos: saida.fatos.map((f) => reidratar(f, executada.mapa)),
    noDeVirada: saida.noDeVirada,
    noDeViradaPorRegra: porRegra,
    precisaDeRevisao: saida.precisaDeRevisao,
    promptVersion: executada.promptVersion,
    aiRunId: executada.aiRunId,
  });

  // O ciclo do R13: liga, resume, escreve. O follow-up é outro trabalho porque
  // é outro modelo, outro custo e outra chance de falhar sozinho.
  const enfileirado = await enfileirarTrabalho(
    contexto.cliente,
    'draft_followup',
    `attempt:${tentativa.id}`,
    { attempt_id: tentativa.id },
  );

  return {
    proposito: 'summarize_call',
    feito: true,
    aiRunId: executada.aiRunId,
    custoUsd: executada.custoUsd,
    detalhes: { followup_enfileirado: enfileirado.enfileirado },
  };
}

// ---------------------------------------------------------------------------
// 3. Redigir o follow-up (R13 §1; ADR-05; RF-CON-24)
// ---------------------------------------------------------------------------

async function redigirFollowUp(
  contexto: ContextoDaIa,
  bruto: unknown,
): Promise<ResultadoDoTrabalho> {
  const payload = interpretarPayload(payloadDoFollowUp, bruto);
  const tentativa = await buscarTentativa(contexto.cliente, payload.attempt_id);
  if (tentativa === null) {
    throw new ErroDeterministico(`tentativa de ligação ${payload.attempt_id} não existe`);
  }
  if (tentativa.activityId === null) {
    throw new ErroDeterministico(`a tentativa ${tentativa.id} não tem atividade`);
  }

  const resumo = await lerResumoDaFicha(contexto.cliente, tentativa.activityId);
  if (resumo === null) {
    throw new ErroDeterministico(
      `a atividade ${tentativa.activityId} ainda não tem resumo: o follow-up cita a ligação, e sem resumo ele viraria mensagem genérica`,
    );
  }

  const ficha = await buscarContatoDaFicha(
    contexto.cliente,
    tentativa.organizationId,
    tentativa.contactId,
  );

  const executada = await executar(
    contexto,
    followupLigacaoV1,
    {
      leadId: leadIdCurto(tentativa.organizationId),
      variante: tentativa.variante,
      segmento: tentativa.segmento,
      resumoDaLigacao: resumo.resumo.slice(0, 600),
      combinado: resumo.combinado === null ? null : resumo.combinado.slice(0, 240),
      objecoes: resumo.objecoes.slice(0, 6).map((o) => o.slice(0, 160)),
      desfecho: tentativa.desfecho,
      gancho: payload.gancho ?? null,
    },
    contatoDoPrompt(ficha),
    { organizationId: tentativa.organizationId, activityId: tentativa.activityId },
  );

  // RF-CON-24: o validador roda DEPOIS do modelo e ANTES de qualquer pessoa ver.
  const veredito = validarPromessas({
    texto: executada.saida.mensagem,
    claims: executada.saida.claims,
  });

  const corpo =
    veredito.situacao === 'bloqueado' ? executada.saida.mensagem : veredito.texto;
  const validador: Record<string, unknown> = {
    situacao: veredito.situacao,
    motivos: veredito.situacao === 'aprovado' ? [] : veredito.motivos,
    queda: veredito.situacao === 'bloqueado' ? veredito.queda : null,
    por_que: executada.saida.porQue,
    conferido_em: new Date().toISOString(),
  };

  // O áudio é escolhido, nunca inventado: `proposed_audio_slug` tem FK para
  // `audio_assets`, e um slug que não existe derrubaria o insert inteiro.
  const audio = await audioQueExiste(contexto, executada.saida.audioSugerido);

  const conversationId = await conversaDaFicha(contexto.cliente, tentativa.organizationId);

  const rascunhoId = await criarRascunho(contexto.cliente, {
    organizationId: tentativa.organizationId,
    conversationId,
    contactId: tentativa.contactId,
    dealId: tentativa.dealId,
    tipo: 'followup_ligacao',
    aiRunId: executada.aiRunId,
    promptVersion: executada.promptVersion,
    // Reidratado: é uma pessoa que vai ler e enviar.
    corpo: reidratar(corpo, executada.mapa),
    audio,
    claims: executada.saida.claims,
    validador,
  });

  contexto.logger.info('rascunho de follow-up na fila de aprovação', {
    draft_id: rascunhoId,
    attempt_id: tentativa.id,
    validador: veredito.situacao,
    // ADR-05, dito na saída do worker para não sobrar dúvida:
    aprovacao: 'pendente de pessoa',
  });

  return {
    proposito: 'draft_followup',
    feito: true,
    aiRunId: executada.aiRunId,
    custoUsd: executada.custoUsd,
    detalhes: { draft_id: rascunhoId, validador: veredito.situacao },
  };
}

// ---------------------------------------------------------------------------
// 4. Classificar a mensagem recebida (RF-CON-19, RF-CON-20)
// ---------------------------------------------------------------------------

async function classificarEntrada(
  contexto: ContextoDaIa,
  bruto: unknown,
): Promise<ResultadoDoTrabalho> {
  const payload = interpretarPayload(payloadDaClassificacao, bruto);
  const mensagem = await buscarMensagem(contexto.cliente, payload.message_id);
  if (mensagem === null) {
    throw new ErroDeterministico(`mensagem ${payload.message_id} não existe`);
  }
  const texto = mensagem.corpo ?? mensagem.transcricao;
  if (texto === null) {
    return { proposito: 'classify_inbound', feito: false, motivo: 'mensagem_sem_texto' };
  }
  const conversa = await buscarConversa(contexto.cliente, mensagem.conversationId);
  if (conversa === null) {
    throw new ErroDeterministico(`conversa ${mensagem.conversationId} não existe`);
  }

  // RF-CON-19: a regra de opt-out roda ANTES de qualquer IA, sobre o texto como
  // a pessoa escreveu. Quem pediu para sair não vira chamada paga — e a decisão
  // não pode depender de o modelo concordar.
  const optOut = detectarOptOut(texto);
  if (optOut !== null) {
    const decisao = decidirIntencao({ mensagem: texto, saidaDoModelo: null });
    await gravarClassificacao(contexto.cliente, conversa.id, decisao.intencao, decisao.confianca);
    await escalarConversa(contexto.cliente, conversa.id);
    contexto.logger.warn('opt-out reconhecido por regra, sem chamar o modelo', {
      message_id: mensagem.id,
      regra: optOut.id,
      amplo: optOut.amplo,
      // A supressão em si (do_not_contact + suppression_list) é do worker de
      // WhatsApp, que é quem trata `wa_inbound`. Aqui fica o registro e a
      // conversa parada — nada sai enquanto isso.
      pendente: 'supressao_e_confirmacao_sao_do_worker_wa',
    });
    return {
      proposito: 'classify_inbound',
      feito: true,
      detalhes: { intencao: decisao.intencao, origem: 'regra', regra: optOut.id },
    };
  }

  const ficha = await buscarContatoDaFicha(
    contexto.cliente,
    conversa.organizationId ?? mensagem.organizationId,
    conversa.contactId ?? mensagem.contactId,
    conversa.telefone,
  );

  const executada = await executar(
    contexto,
    classificarIntencaoV1,
    {
      leadId: leadIdCurto(ficha.organizationId),
      canal: 'whatsapp',
      mensagem: texto.slice(0, 4000),
      resumoDaConversa: conversa.resumo === null ? null : conversa.resumo.slice(0, 2800),
      ultimaIntencao: intencaoConhecida(conversa.ultimaIntencao),
      jaRecebeuAudio: await jaRecebeuAudio(contexto.cliente, conversa.id),
    },
    contatoDoPrompt(ficha),
    { organizationId: ficha.organizationId, conversationId: conversa.id },
  );

  const decisao = decidirIntencao({
    mensagem: texto,
    saidaDoModelo: executada.saida,
    intencaoAnterior: intencaoConhecida(conversa.ultimaIntencao),
    confiancaAnteriorBaixa:
      conversa.confiancaAnterior !== null && conversa.confiancaAnterior < LIMIAR_DE_CONFIANCA,
    vip: conversa.vip,
  });

  await gravarClassificacao(contexto.cliente, conversa.id, decisao.intencao, decisao.confianca);
  if (decisao.escalar || decisao.responde === 'humano') {
    await escalarConversa(contexto.cliente, conversa.id);
  }

  contexto.logger.info('mensagem classificada', {
    message_id: mensagem.id,
    intencao: decisao.intencao,
    origem: decisao.origem,
    confianca: decisao.confianca,
    responde: decisao.responde,
    escalar: decisao.escalar,
    motivos: decisao.motivosDeEscalada,
  });

  return {
    proposito: 'classify_inbound',
    feito: true,
    aiRunId: executada.aiRunId,
    custoUsd: executada.custoUsd,
    detalhes: {
      intencao: decisao.intencao,
      escalar: decisao.escalar,
      motivos: decisao.motivosDeEscalada,
    },
  };
}

// ---------------------------------------------------------------------------
// O despachante
// ---------------------------------------------------------------------------

const TRABALHOS: Readonly<
  Record<PropositoConhecido, (contexto: ContextoDaIa, bruto: unknown) => Promise<ResultadoDoTrabalho>>
> = {
  transcribe_audio: transcrever,
  summarize_call: resumirLigacao,
  draft_followup: redigirFollowUp,
  classify_inbound: classificarEntrada,
};

export async function tratarTrabalho(
  contexto: ContextoDaIa,
  payload: Record<string, unknown>,
): Promise<ResultadoDoTrabalho> {
  const proposito = payload.purpose;
  if (!ePropositoConhecido(proposito)) {
    throw new ErroDeterministico(
      `propósito "${String(proposito)}" não tem tratamento no worker-ai: ` +
        `os que têm são ${Object.keys(TRABALHOS).join(', ')}`,
    );
  }
  return TRABALHOS[proposito](contexto, payload);
}

// ---------------------------------------------------------------------------
// Auxiliares
// ---------------------------------------------------------------------------

function interpretarPayload<T>(schema: z.ZodType<T>, bruto: unknown): T {
  const lido = schema.safeParse(bruto);
  if (!lido.success) {
    const problemas = lido.error.issues
      .map((i) => `${i.path.join('.') || '(raiz)'}: ${i.message}`)
      .join('; ');
    throw new ErroDeterministico(`payload da fila fora do contrato — ${problemas}`);
  }
  return lido.data;
}

function contatoDoPrompt(ficha: {
  organizationId: string | null;
  nome: string | null;
  empresa: string | null;
  telefones: string[];
  emails: string[];
  instagram: string | null;
}): {
  leadId: string;
  nome: string | null;
  empresa: string | null;
  telefones: string[];
  emails: string[];
  instagram: string | null;
} {
  return {
    leadId: leadIdCurto(ficha.organizationId),
    nome: ficha.nome,
    empresa: ficha.empresa,
    telefones: ficha.telefones,
    emails: ficha.emails,
    instagram: ficha.instagram,
  };
}

function intencaoConhecida(valor: string | null): Intencao | null {
  return valor !== null && (INTENCOES as readonly string[]).includes(valor)
    ? (valor as Intencao)
    : null;
}

async function jaRecebeuAudio(cliente: ClienteDoBanco, conversationId: string): Promise<boolean> {
  const { count } = await cliente
    .from('messages')
    .select('id', { count: 'exact', head: true })
    .eq('conversation_id', conversationId)
    .eq('direction', 'in')
    .eq('type', 'audio');
  return (count ?? 0) > 0;
}

interface ResumoLido {
  readonly resumo: string;
  readonly combinado: string | null;
  readonly objecoes: string[];
}

/** O resumo é lido de onde a tela lê. Um lugar só, e é o mesmo dos dois lados. */
async function lerResumoDaFicha(
  cliente: ClienteDoBanco,
  activityId: string,
): Promise<ResumoLido | null> {
  const { data } = await cliente
    .from('activities')
    .select('metadata')
    .eq('id', activityId)
    .maybeSingle();
  const metadata = (data as { metadata?: unknown } | null)?.metadata;
  if (typeof metadata !== 'object' || metadata === null) return null;
  const guardado = (metadata as Record<string, unknown>).resumo_ia;
  if (typeof guardado !== 'object' || guardado === null) return null;
  const linha = guardado as Record<string, unknown>;
  const resumo = typeof linha.resumo === 'string' ? linha.resumo : null;
  if (resumo === null || resumo.trim() === '') return null;
  return {
    resumo,
    combinado: typeof linha.combinado === 'string' ? linha.combinado : null,
    objecoes: Array.isArray(linha.objecoes)
      ? linha.objecoes.filter((o): o is string => typeof o === 'string')
      : [],
  };
}

async function conversaDaFicha(
  cliente: ClienteDoBanco,
  organizationId: string,
): Promise<string | null> {
  const { data } = await cliente
    .from('conversations')
    .select('id')
    .eq('organization_id', organizationId)
    .order('last_message_at', { ascending: false, nullsFirst: false })
    .limit(1)
    .maybeSingle();
  return (data as { id: string } | null)?.id ?? null;
}

async function audioQueExiste(
  contexto: ContextoDaIa,
  slug: string | null,
): Promise<string | null> {
  if (slug === null || slug.trim() === '') return null;
  const { data } = await contexto.cliente
    .from('audio_assets')
    .select('slug')
    .eq('slug', slug)
    .maybeSingle();
  if (data !== null) return slug;
  contexto.logger.warn('o modelo sugeriu um áudio que não existe na biblioteca', { slug });
  return null;
}

export type { MapaDePseudonimos };
