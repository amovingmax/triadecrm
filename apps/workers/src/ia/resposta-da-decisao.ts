/**
 * "Escrever outra resposta" no aviso de decisão (Imova, 25/11/2026): a IA diz ao cliente
 * o que o admin escreveu, só com o tom ajustado (`resposta-da-decisao@v1`).
 *
 * O caminho: o admin escreve no cartão (`public.ia_decisao_decidir`, escolha `escrita`), o
 * banco põe `responder_decisao` na fila `ai_jobs`, e aqui a IA escreve; a fala sai por
 * `public.ia_decisao_dizer`, como fala da IA que atende (assinada "Imova", pela porteira).
 *
 * O que não pode acontecer é o cliente ficar sem a resposta que o admin já deu: se o modelo
 * falhar, recusar, o orçamento acabar ou a rede de segurança segurar o texto
 * (`motivoParaNaoMandarDaDecisao`: número que o admin não escreveu, código, "equipe"...),
 * sai o que o admin escreveu, como ele escreveu (`p_texto` nulo). Só rede, 429 e 5xx
 * voltam para a fila, porque repetir resolve.
 */
import { z } from 'zod';

import {
  type EntradaDaRespostaDaDecisao,
  motivoParaNaoMandarDaDecisao,
  reidratar,
  respostaDaDecisaoV1,
} from '@komune/prompts';

import { ErroDaEsteira } from '../fila/esteira';
import { limparTexto, soOPrimeiroNome } from './atendente';
import { buscarContatoDaFicha } from './banco';
import { ErroDoModelo, RecusaDoModeloError, RespostaIlegivelError } from './cliente';
import { ErroDeterministico } from './erros';
import {
  AlvoSuprimidoError,
  ChamadaBloqueadaError,
  OrcamentoEsgotadoError,
  type ContextoDaIa,
  executar,
  leadIdCurto,
} from './execucao';

const uuid = z.string().uuid();

/** O que `public.ia_decisao_decidir` põe na fila (mais a `chave`, que a esteira usa). */
export const payloadDaRespostaDaDecisao = z.object({
  purpose: z.literal('responder_decisao'),
  decisao_id: uuid,
  conversation_id: uuid,
});

/** O que `public.ia_decisao_entrada` devolve. */
const entradaDoBanco = z.object({
  existe: z.boolean(),
  conversation_id: uuid.optional(),
  organization_id: uuid.nullable().optional(),
  contact_id: uuid.nullable().optional(),
  nome: z.string().nullable().optional(),
  escolha: z.string().nullable().optional(),
  ja_respondida: z.boolean().optional(),
  pergunta: z.string().nullable().optional(),
  resposta_da_ia: z.string().nullable().optional(),
  texto_decidido: z.string().nullable().optional(),
  imovel: z.string().nullable().optional(),
});

export interface ResultadoDaRespostaDaDecisao {
  readonly feito: boolean;
  readonly motivo?: string;
  readonly aiRunId?: number;
  readonly custoUsd?: number;
  readonly detalhes?: Record<string, unknown>;
}

async function rpc(
  contexto: ContextoDaIa,
  funcao: string,
  argumentos: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const { data, error } = await contexto.cliente.rpc(funcao, argumentos);
  // Erro de RPC é rede ou banco fora do ar: volta para a fila com backoff.
  if (error) throw new ErroDaEsteira(funcao, error.message);
  return (data ?? {}) as Record<string, unknown>;
}

/** Sai o que o admin escreveu (sem o texto da IA), e fica o porquê no log. */
async function dizerOQueOAdminEscreveu(
  contexto: ContextoDaIa,
  decisaoId: string,
  porque: string,
  aiRunId: number | null,
): Promise<ResultadoDaRespostaDaDecisao> {
  const r = await rpc(contexto, 'ia_decisao_dizer', {
    p_id: decisaoId,
    p_texto: null,
    p_ai_run_id: aiRunId,
    p_prompt_version: null,
  });
  contexto.logger.warn('a resposta escrita pelo admin saiu como ele escreveu', {
    decisao_id: decisaoId,
    porque,
    saiu: r.ok === true,
    motivo: r.motivo ?? null,
  });
  return {
    feito: r.ok === true,
    motivo: r.ok === true ? `saiu_como_o_admin_escreveu:${porque}` : String(r.motivo ?? 'recusado'),
    ...(aiRunId === null ? {} : { aiRunId }),
  };
}

export async function responderDecisao(
  contexto: ContextoDaIa,
  bruto: unknown,
): Promise<ResultadoDaRespostaDaDecisao> {
  const lido = payloadDaRespostaDaDecisao.safeParse(bruto);
  if (!lido.success) {
    const problemas = lido.error.issues
      .map((i) => `${i.path.join('.') || '(raiz)'}: ${i.message}`)
      .join('; ');
    throw new ErroDeterministico(`payload da resposta da decisão fora do contrato — ${problemas}`);
  }
  const payload = lido.data;
  if (contexto.empresa !== 'imova') return { feito: false, motivo: 'so_na_imova' };

  const bruta = entradaDoBanco.safeParse(
    await rpc(contexto, 'ia_decisao_entrada', { p_id: payload.decisao_id }),
  );
  if (!bruta.success) {
    throw new ErroDeterministico(
      `ia_decisao_entrada fora do contrato — ${bruta.error.issues[0]?.message ?? '?'}`,
    );
  }
  const e = bruta.data;
  if (!e.existe) return { feito: false, motivo: 'decisao_nao_existe' };
  if (e.escolha !== 'escrita') return { feito: false, motivo: 'nao_e_resposta_escrita' };
  // A mesma decisão entregue de novo pela fila (o worker caiu depois de mandar).
  if (e.ja_respondida === true) return { feito: false, motivo: 'ja_respondida' };
  const respostaDaImova = (e.texto_decidido ?? '').trim();
  if (respostaDaImova === '') return { feito: false, motivo: 'sem_texto_do_admin' };

  const leadId = leadIdCurto(e.organization_id ?? payload.conversation_id);
  const ficha = await buscarContatoDaFicha(
    contexto.cliente,
    e.organization_id ?? null,
    e.contact_id ?? null,
    null,
  );
  const contato = {
    leadId,
    nome: ficha.nome ?? e.nome ?? null,
    empresa: ficha.empresa,
    telefones: ficha.telefones,
    emails: ficha.emails,
    instagram: ficha.instagram,
  };
  const vinculos = {
    organizationId: e.organization_id ?? null,
    contactId: e.contact_id ?? null,
    conversationId: payload.conversation_id,
  };
  const entrada: EntradaDaRespostaDaDecisao = {
    leadId,
    cliente: { nome: contato.nome },
    imovel: e.imovel ?? null,
    pergunta: (e.pergunta ?? '').trim().slice(0, 300) || 'O cliente quer uma resposta da Imova.',
    oQueAIaDisse: e.resposta_da_ia?.trim().slice(0, 600) || null,
    respostaDaImova: respostaDaImova.slice(0, 600),
  };

  let executada;
  try {
    executada = await executar(contexto, respostaDaDecisaoV1, entrada, contato, vinculos);
  } catch (erro) {
    if (erro instanceof OrcamentoEsgotadoError) {
      return dizerOQueOAdminEscreveu(contexto, payload.decisao_id, 'orcamento', erro.aiRunId);
    }
    if (erro instanceof ChamadaBloqueadaError) {
      return dizerOQueOAdminEscreveu(contexto, payload.decisao_id, 'dado_pessoal', erro.aiRunId);
    }
    // Pediu para sair depois da decisão: nada sai.
    if (erro instanceof AlvoSuprimidoError) return { feito: false, motivo: 'alvo_suprimido' };
    if (
      erro instanceof RecusaDoModeloError ||
      erro instanceof RespostaIlegivelError ||
      (erro instanceof ErroDoModelo && !erro.transitorio)
    ) {
      return dizerOQueOAdminEscreveu(
        contexto,
        payload.decisao_id,
        'erro_do_modelo',
        erro instanceof RecusaDoModeloError ? erro.aiRunId : null,
      );
    }
    // Rede, 429 e 5xx: volta para a fila com backoff.
    throw erro;
  }

  const texto = soOPrimeiroNome(
    limparTexto(reidratar(executada.saida.mensagem, executada.mapa)),
    contato.nome,
  );
  const motivo = motivoParaNaoMandarDaDecisao(texto, [
    entrada.pergunta,
    entrada.respostaDaImova,
    entrada.oQueAIaDisse,
  ]);
  if (motivo !== null) {
    return dizerOQueOAdminEscreveu(contexto, payload.decisao_id, motivo, executada.aiRunId);
  }

  const r = await rpc(contexto, 'ia_decisao_dizer', {
    p_id: payload.decisao_id,
    p_texto: texto,
    p_ai_run_id: executada.aiRunId,
    p_prompt_version: executada.promptVersion,
  });
  // Só o que não identifica ninguém: nem nome, nem o texto.
  contexto.logger.info('a IA disse ao cliente a resposta escrita pelo admin', {
    decisao_id: payload.decisao_id,
    conversation_id: payload.conversation_id,
    saiu: r.ok === true,
    como: r.como ?? null,
    motivo: r.motivo ?? null,
    custo_usd: executada.custoUsd,
  });
  return {
    feito: r.ok === true,
    ...(r.ok === true ? {} : { motivo: String(r.motivo ?? 'recusado') }),
    aiRunId: executada.aiRunId,
    custoUsd: executada.custoUsd,
    detalhes: { como: r.como ?? null },
  };
}
