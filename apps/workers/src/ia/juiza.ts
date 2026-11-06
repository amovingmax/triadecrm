/**
 * A IA juíza da Imova (06/11/2026).
 *
 * Pedido do usuário: um relatório que mostre se a IA que atende tira as dúvidas bem, dá
 * informação útil e deixa o cliente satisfeito. Uma vez por dia o cron do seed da Imova
 * chama `app.ia_juiza_enfileirar()`, que põe na fila cada conversa:dia em que a IA
 * respondeu e que ainda não tem nota; este trabalho lê o dia pela porta do banco
 * (`public.ia_juiza_entrada`), pede a nota ao Haiku 5.5 (`avaliacao-do-atendimento`) e
 * a grava pela outra porta (`public.ia_juiza_gravar`). A tela de relatórios lê
 * `ia_atendimento_notas`, que só essa porta escreve.
 *
 * ## O que é de quem
 *
 * O banco escolhe as conversas, recorta as mensagens (10 de antes, o dia e 12 horas de
 * reação), corta os textos no teto e descarta nota fora de 1 a 5 (ADR-03). O worker só
 * troca uuid por etiqueta, pseudonimiza (por `executar`, o único caminho até a API) e
 * devolve os nomes ao texto que uma pessoa vai ler.
 *
 * ## Erros, pelo critério do resto do worker
 *
 *   DETERMINÍSTICO (sai da fila, o motivo fica no log): payload torto, conversa que não
 *     existe, empresa que não é a Imova, o modelo recusando o pedido (400/401), o
 *     guardrail de dado pessoal, o freio do orçamento (este volta pelo cron dos adiados).
 *   TRANSITÓRIO (volta com backoff): rede, 429, 5xx, e a RPC que não respondeu.
 *
 * Dia sem resposta da IA não é erro e não é chamada paga: sai como "sem o que fazer".
 *
 * ## O que ele nunca faz
 *
 * Não escreve para o cliente, não muda a conversa e não mexe no atendimento. E não põe
 * o porquê no log: depois de reidratado ele tem o nome do cliente, e o log do worker não
 * leva nome nem telefone.
 */
import { z } from 'zod';

import {
  ACOES_DA_IA_NO_DIA,
  ATITUDES_DO_CLIENTE,
  type EntradaDaAvaliacao,
  avaliacaoDoAtendimentoV1,
  encurtarTexto,
  reidratar,
} from '@komune/prompts';

import { ErroDaEsteira } from '../fila/esteira';
import { buscarContatoDaFicha } from './banco';
import { ErroDoModelo } from './cliente';
import { ErroDeterministico } from './erros';
import { type ContextoDaIa, executar, leadIdCurto } from './execucao';

const uuid = z.string().uuid();

/**
 * AAAA-MM-DD que existe no calendário. "2026-02-30" passaria pela forma e o banco
 * recusaria o `::date` a cada volta da fila, como se fosse rede.
 */
const diaDoCalendario = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'o dia vem como AAAA-MM-DD')
  .refine((dia) => {
    const data = new Date(`${dia}T12:00:00Z`);
    return !Number.isNaN(data.getTime()) && data.toISOString().slice(0, 10) === dia;
  }, 'não é um dia do calendário');

/** O que `app.ia_juiza_enfileirar` põe na fila (mais a `chave`, que a esteira usa). */
export const payloadDaJuiza = z.object({
  purpose: z.literal('avaliar_atendimento'),
  conversation_id: uuid,
  dia: diaDoCalendario,
});

/** O que `public.ia_juiza_entrada` devolve. */
const entradaDoBanco = z.object({
  existe: z.boolean(),
  conversation_id: uuid.optional(),
  organization_id: uuid.nullable().optional(),
  contact_id: uuid.nullable().optional(),
  dia: z.string().optional(),
  respostas: z.number().int().min(0).optional(),
  acoes: z.array(z.object({ acao: z.string(), quando: z.string() })).optional(),
  atitude_antes: z.string().nullable().optional(),
  atitude_depois: z.string().nullable().optional(),
  mensagens: z
    .array(
      z.object({
        id: uuid,
        de: z.enum(['cliente', 'ia', 'equipe', 'automatica']),
        quando: z.string(),
        texto: z.string().nullable(),
      }),
    )
    .optional(),
});

export type EntradaDoBancoDaJuiza = z.infer<typeof entradaDoBanco>;

export interface ResultadoDaJuiza {
  readonly feito: boolean;
  readonly motivo?: string;
  readonly aiRunId?: number;
  readonly custoUsd?: number;
  readonly detalhes?: Record<string, unknown>;
}

function conhecido<T extends string>(
  lista: readonly T[],
  valor: string | null | undefined,
): T | null {
  return valor !== null && valor !== undefined && (lista as readonly string[]).includes(valor)
    ? (valor as T)
    : null;
}

/**
 * A entrada do prompt, a partir do que o banco devolveu. As mensagens ganham etiqueta
 * curta (m1, m2...) no lugar do uuid, como na leitura do cliente: uuid é caro em token
 * e não diz nada ao modelo. Ação e atitude que o prompt não conhece ficam de fora, em
 * vez de derrubar a avaliação: uma etiqueta nova no banco não pode parar a fila.
 */
export function montarEntrada(
  e: EntradaDoBancoDaJuiza,
  dia: string,
  leadId: string,
): EntradaDaAvaliacao {
  const acoes = (e.acoes ?? [])
    .map((a) => ({ acao: conhecido(ACOES_DA_IA_NO_DIA, a.acao), quando: a.quando.slice(0, 40) }))
    .filter((a): a is EntradaDaAvaliacao['acoes'][number] => a.acao !== null)
    .slice(0, 60);
  return {
    leadId,
    dia,
    respostas: Math.max(1, Math.trunc(e.respostas ?? 1)),
    acoes,
    atitudeAntes: conhecido(ATITUDES_DO_CLIENTE, e.atitude_antes),
    atitudeDepois: conhecido(ATITUDES_DO_CLIENTE, e.atitude_depois),
    mensagens: (e.mensagens ?? []).slice(0, 80).map((m, indice) => ({
      messageId: `m${indice + 1}`,
      de: m.de,
      quando: m.quando.slice(0, 40),
      texto: (m.texto ?? '').slice(0, 1200),
    })),
  };
}

/** O texto já com os nomes de volta, no teto da coluna, cortado na palavra. */
function caber(texto: string, maximo: number): string {
  return encurtarTexto(maximo)(texto) as string;
}

async function rpc(
  contexto: ContextoDaIa,
  funcao: string,
  argumentos: Record<string, unknown>,
): Promise<unknown> {
  const { data, error } = await contexto.cliente.rpc(funcao, argumentos);
  // Erro de RPC é rede ou banco fora do ar: volta para a fila com backoff.
  if (error) throw new ErroDaEsteira(funcao, error.message);
  return data;
}

export async function avaliarAtendimento(
  contexto: ContextoDaIa,
  bruto: unknown,
): Promise<ResultadoDaJuiza> {
  const lido = payloadDaJuiza.safeParse(bruto);
  if (!lido.success) {
    const problemas = lido.error.issues
      .map((i) => `${i.path.join('.') || '(raiz)'}: ${i.message}`)
      .join('; ');
    throw new ErroDeterministico(`payload da juíza fora do contrato — ${problemas}`);
  }
  const payload = lido.data;
  // O prompt é de imobiliária e as portas só existem no banco da Imova: na KOMUNE o
  // trabalho não deveria nem nascer (`app.ia_juiza_config` desliga fora da Imova).
  if (contexto.empresa !== 'imova') return { feito: false, motivo: 'so_na_imova' };

  const bruta = entradaDoBanco.safeParse(
    await rpc(contexto, 'ia_juiza_entrada', {
      p_conversation_id: payload.conversation_id,
      p_dia: payload.dia,
    }),
  );
  if (!bruta.success) {
    // O banco respondeu fora do combinado: repetir traz a mesma resposta.
    throw new ErroDeterministico(
      `ia_juiza_entrada fora do contrato — ${bruta.error.issues[0]?.message ?? '?'}`,
    );
  }
  const e = bruta.data;
  if (!e.existe) throw new ErroDeterministico(`conversa ${payload.conversation_id} não existe`);
  // A IA não respondeu nesse dia, ou o que ela respondeu foi apagado no CRM: não há o
  // que julgar, e chamar o modelo seria pagar por uma nota inventada.
  const mensagens = e.mensagens ?? [];
  if ((e.respostas ?? 0) === 0 || mensagens.length === 0 || !mensagens.some((m) => m.de === 'ia')) {
    return { feito: false, motivo: 'sem_resposta_da_ia' };
  }

  // O lead precisa ser o mesmo em toda avaliação desta conversa, como na leitura: conversa
  // fora da base não tem organização, e o id da conversa é a âncora que sobra.
  const leadId = leadIdCurto(e.organization_id ?? payload.conversation_id);
  const entrada = montarEntrada(e, payload.dia, leadId);
  // O nome e o telefone da ficha entram na troca: o cliente escreve o próprio nome, e a
  // IA o chama pelo nome.
  const ficha = await buscarContatoDaFicha(
    contexto.cliente,
    e.organization_id ?? null,
    e.contact_id ?? null,
    null,
  );

  let executada;
  try {
    executada = await executar(
      contexto,
      avaliacaoDoAtendimentoV1,
      entrada,
      {
        leadId,
        nome: ficha.nome,
        empresa: ficha.empresa,
        telefones: ficha.telefones,
        emails: ficha.emails,
        instagram: ficha.instagram,
      },
      {
        organizationId: e.organization_id ?? null,
        contactId: e.contact_id ?? null,
        conversationId: payload.conversation_id,
      },
    );
  } catch (erro) {
    // 400 e 401 não mudam com o tempo: repetir é pagar a mesma recusa até a dead-letter.
    // Rede, 429 e 5xx (transitórios) sobem como vieram e voltam com backoff.
    if (erro instanceof ErroDoModelo && !erro.transitorio) {
      throw new ErroDeterministico(`o modelo recusou a avaliação: ${erro.message}`);
    }
    throw erro;
  }

  // O porquê e a sugestão são lidos por gente no relatório: os nomes trocados na ida
  // voltam aqui, como na leitura do cliente. O nome de verdade pode ser mais longo que
  // o marcador, e o texto é encurtado de novo para o banco não cortar no meio da palavra.
  const nota = executada.saida;
  const saida = {
    ...nota,
    porque: caber(reidratar(nota.porque, executada.mapa), 400),
    melhorar: nota.melhorar === null ? null : caber(reidratar(nota.melhorar, executada.mapa), 300),
  };

  const gravada = (await rpc(contexto, 'ia_juiza_gravar', {
    p_conversation_id: payload.conversation_id,
    p_dia: payload.dia,
    p_saida: saida,
    p_ai_run_id: executada.aiRunId,
    p_prompt_version: executada.promptVersion,
  })) as { ok?: unknown; motivo?: unknown; respostas?: unknown } | null;
  if (gravada?.ok !== true) {
    // A conversa sumiu entre a leitura e a gravação: a chamada já foi paga, e repetir
    // não traz a conversa de volta.
    throw new ErroDeterministico(
      `a nota de ${payload.conversation_id} em ${payload.dia} não foi gravada: ${String(gravada?.motivo ?? 'sem resposta')}`,
    );
  }

  const detalhes = {
    duvida: nota.duvida,
    informacao: nota.informacao,
    satisfacao: nota.satisfacao,
    interesse: nota.interesse,
    dados_insuficientes: nota.dadosInsuficientes,
    respostas: typeof gravada.respostas === 'number' ? gravada.respostas : (e.respostas ?? null),
  };
  contexto.logger.info('a IA juíza deu nota ao atendimento', {
    conversation_id: payload.conversation_id,
    dia: payload.dia,
    mensagens: entrada.mensagens.length,
    ...detalhes,
    custo_usd: executada.custoUsd,
  });
  return { feito: true, aiRunId: executada.aiRunId, custoUsd: executada.custoUsd, detalhes };
}
