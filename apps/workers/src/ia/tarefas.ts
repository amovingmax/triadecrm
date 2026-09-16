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
  INTENCOES_DA_FICHA,
  LIMIAR_DE_CONFIANCA,
  MAXIMO_DE_INAUDIVEIS,
  classificarIntencaoV1,
  decidirIntencao,
  decidirRoteamento,
  detectarOptOut,
  fichaDaConversaV1,
  followupLigacaoV1,
  reidratar,
  resumoLigacaoV1,
  transcricaoAudioV1,
  validarPromessas,
  viradaProvavel,
  type Intencao,
  type IntencaoDaFicha,
  type MapaDePseudonimos,
  type SaidaDaFicha,
} from '@komune/prompts';

import { ErroDeTranscricao, transcrever as transcreverAudio, type TranscricaoBruta } from './asr';
import {
  buscarContatoDaFicha,
  buscarConversa,
  buscarMensagem,
  buscarTentativa,
  criarRascunho,
  entradaDaFicha,
  escalarConversa,
  gravarClassificacao,
  gravarFicha,
  gravarResumoDaLigacao,
  gravarTranscricao,
} from './banco';
import {
  AlvoSuprimidoError,
  ChamadaBloqueadaError,
  executar,
  leadIdCurto,
  type ContextoDaIa,
} from './execucao';
import { enfileirarTrabalho } from './fila';

import { ErroDaEsteira, type ClienteDoBanco } from '../ingest/esteira';

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
  return (
    erro instanceof ErroDeterministico ||
    erro instanceof ChamadaBloqueadaError ||
    // Alvo suprimido é o mais determinístico de todos: repetir não muda o mundo
    // e cada volta é uma chamada paga (laudo §3.3).
    erro instanceof AlvoSuprimidoError
  );
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
  /**
   * O texto do ASR. Continua aceito pronto — é assim que o `faster-whisper` da
   * máquina dedicada entregaria (RF-CON-27) — e passou a ser OPCIONAL: sem ele, o
   * worker busca o áudio no Storage e chama o ASR ele mesmo (CRM Inteligente,
   * Fase 1). Áudio nunca vira token do Claude nos dois caminhos.
   */
  transcricao_bruta: z.string().min(1).max(12000).nullish(),
  confianca_asr: z.number().min(0).max(1).nullish(),
  duracao_seg: z.number().int().min(1).max(600).nullish(),
  /** Onde o `worker-wa` guardou o arquivo, quando foi ele que enfileirou. */
  media_path: z.string().max(400).nullish(),
  media_mime: z.string().max(80).nullish(),
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

const payloadDaFicha = z.object({
  purpose: z.literal('analisar_conversa'),
  conversation_id: uuid,
});

const PAYLOADS = {
  transcribe_audio: payloadDaTranscricao,
  summarize_call: payloadDoResumo,
  draft_followup: payloadDoFollowUp,
  classify_inbound: payloadDaClassificacao,
  analisar_conversa: payloadDaFicha,
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

  // Quem ouve não é o Claude. Ou o texto do ASR já veio no payload, ou este worker
  // busca o arquivo e chama o provedor de transcrição antes de gastar modelo.
  const bruta =
    payload.transcricao_bruta != null && payload.duracao_seg != null
      ? {
          texto: payload.transcricao_bruta,
          confianca: payload.confianca_asr ?? 0.8,
          duracaoSeg: payload.duracao_seg,
        }
      : await ouvirOAudio(contexto, payload.media_path ?? null, payload.media_mime ?? null);

  const executada = await executar(
    contexto,
    transcricaoAudioV1,
    {
      leadId: leadIdCurto(ficha.organizationId),
      canal: 'whatsapp',
      duracaoSeg: bruta.duracaoSeg,
      transcricaoBruta: bruta.texto,
      confiancaAsr: bruta.confianca,
      contexto: payload.contexto ?? null,
    },
    contatoDoPrompt(ficha),
    { organizationId: ficha.organizationId, contactId: ficha.contactId, conversationId: conversa.id },
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

/**
 * Busca o áudio no Storage e manda para o ASR.
 *
 * Erro aqui é nomeado e classificado: sem caminho, sem provedor ou sem chave é
 * determinístico (repetir paga a mesma recusa); rede e 5xx do provedor voltam pela
 * fila com backoff. É o mesmo critério do resto do worker.
 */
async function ouvirOAudio(
  contexto: ContextoDaIa,
  caminho: string | null,
  mime: string | null,
): Promise<TranscricaoBruta> {
  const transcritor = contexto.transcritor;
  if (transcritor === undefined) {
    throw new ErroDeterministico(
      'este worker subiu sem transcritor de áudio: configure GROQ_API_KEY (ia.transcricao em app_settings)',
    );
  }
  if (caminho === null) {
    throw new ErroDeterministico(
      'trabalho de áudio sem transcrição pronta e sem media_path: não há o que ouvir',
    );
  }

  const { data, error } = await contexto.cliente.storage.from(transcritor.balde).download(caminho);
  if (error || !data) {
    throw new ErroDeterministico(
      `áudio ${caminho} não está no balde ${transcritor.balde}: ${error?.message ?? 'sem corpo'}`,
    );
  }

  const bytes = new Uint8Array(await data.arrayBuffer());
  try {
    return await transcreverAudio(
      { bytes, nome: caminho.split('/').pop() ?? 'audio.ogg', mime: mime ?? data.type ?? 'audio/ogg' },
      transcritor.config,
      transcritor.chave,
    );
  } catch (erro) {
    if (erro instanceof ErroDeTranscricao && !erro.transitorio) {
      throw new ErroDeterministico(erro.message);
    }
    throw erro;
  }
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
    { organizationId: tentativa.organizationId, contactId: tentativa.contactId, activityId: tentativa.activityId },
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
    { organizationId: tentativa.organizationId, contactId: tentativa.contactId, activityId: tentativa.activityId },
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
    { organizationId: ficha.organizationId, contactId: ficha.contactId, conversationId: conversa.id },
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
// 5. A ficha da conversa (CRM Inteligente, Fase 2)
// ---------------------------------------------------------------------------

/**
 * O dossiê de uma conversa: o que ela é, o quanto indica fechamento, o que a
 * sustenta, o que foi prometido e o que o CRM ainda não sabe.
 *
 * As duas pontas são do Postgres (`app.ia_entrada_da_ficha` e
 * `app.ia_gravar_ficha`): ele monta a entrada numa consulta só e grava a saída
 * numa transação só, conferindo cada evidência contra as mensagens da própria
 * conversa. Esta função é o meio — e só o meio.
 *
 * **Por que o modelo não vê o uuid das mensagens.** Ele recebe `m1`, `m2`, `m3`,
 * na ordem da conversa, e devolve a evidência citando essas etiquetas. Duas razões:
 * uuid é caro em token e, sobretudo, etiqueta que o modelo não conhece ele não
 * consegue inventar — um `m9` numa conversa de quatro mensagens cai aqui, antes
 * de chegar ao banco, e o que sobreviver ainda é conferido lá.
 */
async function analisarConversa(
  contexto: ContextoDaIa,
  bruto: unknown,
): Promise<ResultadoDoTrabalho> {
  const payload = interpretarPayload(payloadDaFicha, bruto);
  const entrada = await entradaDaFicha(contexto.cliente, payload.conversation_id);
  if (entrada === null) {
    throw new ErroDeterministico(`conversa ${payload.conversation_id} não existe`);
  }
  if (entrada.mensagens.length === 0) {
    // A janela fechou sem mensagem nova (a análise anterior já a cobriu). Não é
    // erro e não é chamada paga: é a fila fazendo o que deveria.
    return { proposito: 'analisar_conversa', feito: false, motivo: 'sem_mensagem_nova' };
  }

  // etiqueta → uuid. É por este mapa que a evidência volta a apontar para o banco.
  const porEtiqueta = new Map<string, string>();
  const mensagens = entrada.mensagens.map((m, indice) => {
    const etiqueta = `m${indice + 1}`;
    porEtiqueta.set(etiqueta, m.id);
    return { messageId: etiqueta, de: m.de, quando: m.quando, texto: m.texto };
  });

  const ficha = await buscarContatoDaFicha(
    contexto.cliente,
    entrada.organizationId,
    entrada.contactId,
    null,
  );
  // O lead precisa ser o MESMO em toda análise desta conversa: conversa fora da
  // base não tem organização, e sortear um id novo a cada chamada tiraria do
  // modelo a única âncora estável que ele tem.
  const leadId = leadIdCurto(entrada.organizationId ?? entrada.conversationId);

  const executada = await executar(
    contexto,
    fichaDaConversaV1,
    {
      leadId,
      agora: entrada.agora,
      etapa: entrada.etapa,
      etapasValidas: entrada.etapasValidas.slice(0, 20),
      responsavel: entrada.responsavel,
      temperaturaAtual: temperaturaConhecida(entrada.temperatura),
      ultimaIntencao: intencaoDaFicha(entrada.ultimaIntencao),
      fichaAnterior: entrada.fichaAnterior === null ? null : entrada.fichaAnterior.slice(0, 2000),
      compromissosAbertos: entrada.compromissosAbertos
        .slice(0, 20)
        .map((c) => ({ id: c.id, oQue: c.oQue, prazo: c.prazo })),
      mensagens,
      camposVazios: entrada.camposVazios.slice(0, 20),
    },
    { ...contatoDoPrompt({ ...ficha, organizationId: entrada.organizationId }), leadId },
    {
      organizationId: entrada.organizationId,
      contactId: entrada.contactId,
      conversationId: entrada.conversationId,
    },
  );

  const saida = comMessageIdDeVerdade(executada.saida, porEtiqueta);
  const gravada = await gravarFicha(
    contexto.cliente,
    entrada.conversationId,
    saida,
    executada.aiRunId,
    executada.promptVersion,
    entrada.ateMessageId ?? entrada.mensagens[entrada.mensagens.length - 1]?.id ?? null,
  );

  contexto.logger.info('ficha da conversa atualizada', {
    conversation_id: entrada.conversationId,
    intencao: executada.saida.intencao,
    score: executada.saida.scoreIntencao,
    mensagens: mensagens.length,
    primeira_analise: entrada.analisadaEm === null,
    ...gravada,
  });

  return {
    proposito: 'analisar_conversa',
    feito: true,
    aiRunId: executada.aiRunId,
    custoUsd: executada.custoUsd,
    detalhes: {
      intencao: executada.saida.intencao,
      score: executada.saida.scoreIntencao,
      alertas: executada.saida.alertas,
      ...gravada,
    },
  };
}

/**
 * A evidência volta a apontar para o banco — e a que aponta para etiqueta que não
 * existe some aqui mesmo. É a primeira das duas peneiras; a segunda é o banco,
 * que confere o uuid contra as mensagens da conversa.
 */
function comMessageIdDeVerdade(
  saida: SaidaDaFicha,
  porEtiqueta: ReadonlyMap<string, string>,
): Record<string, unknown> {
  const real = (etiqueta: string): string | null => porEtiqueta.get(etiqueta) ?? null;
  const comId = <T extends { messageId: string }>(itens: readonly T[]): T[] =>
    itens
      .map((item) => ({ ...item, messageId: real(item.messageId) }))
      .filter((item): item is T => item.messageId !== null);

  return {
    ...saida,
    sinais: comId(saida.sinais),
    compromissosNovos: comId(saida.compromissosNovos),
    compromissosCumpridos: comId(saida.compromissosCumpridos),
    dadosExtraidos: comId(saida.dadosExtraidos),
  };
}

function temperaturaConhecida(
  valor: string | null,
): 'frio' | 'morno' | 'quente' | 'cliente' | 'cliente_ativo' | null {
  const conhecidas = ['frio', 'morno', 'quente', 'cliente', 'cliente_ativo'] as const;
  return (conhecidas as readonly string[]).includes(valor ?? '')
    ? (valor as (typeof conhecidas)[number])
    : null;
}

function intencaoDaFicha(valor: string | null): IntencaoDaFicha | null {
  return valor !== null && (INTENCOES_DA_FICHA as readonly string[]).includes(valor)
    ? (valor as IntencaoDaFicha)
    : null;
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
  analisar_conversa: analisarConversa,
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

  // ------------------------------------------------------------------------
  // A PERGUNTA DE SUPRESSÃO, ANTES DE QUALQUER COISA (laudo §3.3, RF-CON-18)
  // ------------------------------------------------------------------------
  // É a primeira instrução do consumidor, e é assim de propósito: as quatro
  // funções abaixo LEEM a ficha (nome, telefone, e-mail) para montar o
  // contexto da pseudonimização, e a chamada ao modelo custa dinheiro. Fazer
  // a pergunta depois seria fazê-la tarde.
  //
  // A forma é a de `public.proximo_da_fila` e a de `app.komune_proximos`: uma
  // pergunta ao banco, motivo NOMEADO na resposta, e o trabalho devolvido como
  // "sem o que fazer" — nunca como falha. Falha giraria com backoff até a
  // dead-letter, e repetir não muda o mundo: quem pediu para sair continuou
  // tendo pedido para sair.
  //
  // A LIMPEZA da fila é do outro lado (`app.consent_apply` chama
  // `app.ia_cancelar_trabalhos` desde a migração 20260905000803). As duas
  // existem porque nenhuma sozinha basta: a limpeza não alcança a mensagem
  // que um worker já leu, e a pergunta não impede a fila de crescer.
  if (await alvoSuprimido(contexto, proposito, payload)) {
    contexto.logger.warn('trabalho descartado: o alvo está suprimido', {
      proposito,
      chave: typeof payload.chave === 'string' ? payload.chave : null,
      // Sem telefone e sem nome no log, como em todo o resto do worker.
      guardrail: 'RF-CON-18',
    });
    return { proposito, feito: false, motivo: 'alvo_suprimido' };
  }

  return TRABALHOS[proposito](contexto, payload);
}

/**
 * O alvo deste trabalho está suprimido?
 *
 * Quem responde é o Postgres (`app.ia_trabalho_suprimido`, pela boca
 * `public.ia_alvo_suprimido`), porque é lá que o estado mora e é lá que ele
 * muda — repetir a regra em TypeScript criaria uma segunda verdade que
 * envelhece sozinha (ADR-03).
 *
 * Erro de rede aqui NÃO libera o trabalho: a exceção sobe, a mensagem volta
 * para a fila com backoff e alguém tenta de novo. "Não sei" não pode virar
 * "então vou" — é a mesma decisão que a portaria do Radar toma quando o
 * robots.txt fica inalcançável.
 */
async function alvoSuprimido(
  contexto: ContextoDaIa,
  proposito: PropositoConhecido,
  payload: Record<string, unknown>,
): Promise<boolean> {
  const { data, error } = await contexto.cliente.rpc('ia_alvo_suprimido', {
    p_purpose: proposito,
    p_payload: payload,
  });
  if (error) throw new ErroDaEsteira('ia_alvo_suprimido', error.message);
  const resposta = (data ?? {}) as Record<string, unknown>;
  return resposta.suprimido === true;
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
