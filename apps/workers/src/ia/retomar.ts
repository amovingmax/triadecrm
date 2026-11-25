/**
 * A IA que atende retoma o contato com o cliente que parou de responder (Imova, 11/11/2026).
 *
 * O banco decide e grava (ADR-03): a rodada `app.ia_retomadas_rodar` (cron de 5 minutos)
 * acha a conversa em que a Imova falou por último, o cliente não respondeu e o dia 1 já é
 * devido — dentro da janela de 24 h e no horário permitido —, grava a etapa como
 * `na_fila` e põe este trabalho na fila `ai_jobs` (`retomar_conversa`). Os dias 3 e 7 são
 * modelo aprovado pela Meta e saem do próprio banco, sem passar por aqui.
 *
 * Este trabalho lê a conversa (`public.ia_retomada_entrada`), chama `retomar-conversa@v1`
 * pelo `executar()` (pseudonimização, auditoria de PII, `ai_runs`) e leva a decisão ao
 * banco:
 *
 *   retomar      → `public.ia_retomada_dizer` (confere tudo de novo e grava a mensagem
 *                  com a prova em `ia_respostas`, ação `retomou`)
 *   não retomar  → `public.ia_retomada_desistir` com `encerra`: as etapas seguintes
 *                  daquele silêncio também não saem
 *
 * Antes do primeiro modelo de um silêncio que a IA não leu (o texto do dia 1 não saiu),
 * a rodada pede só a leitura (`leitura_id`, revisão de 11/11/2026): a IA lê a conversa
 * com o mesmo prompt e o worker grava a decisão (`public.ia_retomada_leitura_gravar`):
 * segue, encerra ou falhou. Sem leitura que diga "segue", o modelo não sai.
 *
 * Diferente da atendente, aqui o silêncio é uma saída aceitável: ninguém está esperando
 * resposta. Quando a IA não consegue escrever (dado pessoal, orçamento, recusa, saída
 * fora do contrato, frase proibida), a etapa fica pulada com o motivo e nada sai. Só o
 * erro de rede e o 429/5xx voltam para a fila, porque repetir resolve.
 */
import { z } from 'zod';

import {
  type EntradaDaRetomadaV2,
  MODELOS,
  type PromptVersionado,
  type SaidaDaRetomadaV2,
  motivoParaNaoMandarV2,
  reidratar,
  retomarConversaV2,
  semTelefone,
} from '@komune/prompts';

import { ErroDaEsteira } from '../fila/esteira';
import { limparTexto, soOPrimeiroNome } from './atendente';
import { buscarContatoDaFicha } from './banco';
import { ErroDoModelo, RecusaDoModeloError, RespostaIlegivelError } from './cliente';
import {
  ChamadaBloqueadaError,
  type ContextoDaIa,
  OrcamentoEsgotadoError,
  executar,
  leadIdCurto,
} from './execucao';

const uuid = z.string().uuid();

/**
 * Dois trabalhos na mesma fila: `retomada_id` (escrever o texto do dia 1) ou
 * `leitura_id` (só ler a conversa e decidir, antes do primeiro modelo de um silêncio que
 * a IA ainda não leu: revisão de 11/11/2026). Um dos dois, nunca os dois.
 */
export const payloadDaRetomada = z
  .object({
    purpose: z.literal('retomar_conversa'),
    retomada_id: uuid.optional(),
    leitura_id: uuid.optional(),
    conversation_id: uuid,
    chave: z.string().min(1).max(200).optional(),
  })
  .refine((p) => (p.retomada_id === undefined) !== (p.leitura_id === undefined), {
    message: 'retomada_id ou leitura_id, um dos dois',
  });

/** O que o banco devolve em `public.ia_retomada_entrada` (a entrada da atendente, mais a retomada). */
const entradaDoBanco = z.object({
  existe: z.boolean(),
  pode: z.boolean().optional(),
  motivo: z.string().nullable().optional(),
  conversation_id: uuid.optional(),
  organization_id: uuid.nullable().optional(),
  contact_id: uuid.nullable().optional(),
  agora: z.string().optional(),
  agora_por_extenso: z.string().optional(),
  horas_sem_resposta: z.number().optional(),
  cliente: z.object({ nome: z.string().nullable() }).passthrough().optional(),
  imovel: z
    .object({
      codigo: z.string(),
      titulo: z.string().nullable().optional(),
      tipo: z.string().nullable().optional(),
      bairro: z.string().nullable().optional(),
      descricao: z.string().nullable().optional(),
      caracteristicas: z.unknown().optional(),
      disponivel: z.boolean().optional(),
    })
    .passthrough()
    .nullable()
    .optional(),
  mensagens: z
    .array(
      z.object({
        id: uuid,
        de: z.enum(['cliente', 'ia', 'equipe', 'sistema']),
        quem: z.string().nullable(),
        quando: z.string(),
        texto: z.string().nullable(),
      }),
    )
    .optional(),
});

export type EntradaDoBancoDaRetomada = z.infer<typeof entradaDoBanco>;

export interface ResultadoDaRetomada {
  readonly feito: boolean;
  readonly motivo?: string;
  readonly aiRunId?: number;
  readonly custoUsd?: number;
  readonly detalhes?: Record<string, unknown>;
}

/** "apartamento em Ponta Negra" a partir do que o banco sabe do imóvel. */
export function descricaoDoImovel(i: NonNullable<EntradaDoBancoDaRetomada['imovel']>): string {
  const tipo = (i.tipo ?? '').trim().toLowerCase().replace(/_/g, ' ');
  const bairro = (i.bairro ?? '').trim();
  const base = [tipo === '' ? 'imóvel' : tipo, bairro === '' ? null : `em ${bairro}`]
    .filter(Boolean)
    .join(' ');
  const titulo = (i.titulo ?? '').trim();
  return semTelefone(titulo === '' ? base : `${base} — ${titulo}`).slice(0, 200);
}

/**
 * O texto do anúncio de onde sai o gancho (retomar-conversa@v2, 25/11/2026): título,
 * descrição e características, sem preço (a retomada nunca fala de valor), sem código
 * (nunca escreve o código) e sem telefone. Até 1.200 caracteres.
 */
export function textoDoAnuncio(i: NonNullable<EntradaDoBancoDaRetomada['imovel']>): string {
  const caracteristicas = Array.isArray(i.caracteristicas)
    ? i.caracteristicas
        .map((c) =>
          typeof c === 'string'
            ? c
            : typeof c === 'object' && c !== null && 'nome' in c
              ? String((c as { nome: unknown }).nome)
              : '',
        )
        .filter((c) => c.trim() !== '')
    : [];
  const partes = [
    i.titulo ?? '',
    i.descricao ?? '',
    caracteristicas.length > 0 ? `Características: ${caracteristicas.join(', ')}.` : '',
  ];
  const limpo = partes
    .join('\n')
    // Só o trecho do preço, não a linha inteira: "Valor do repasse: R$ 120.000,00.",
    // "Aluguel mensal: R$ 5.500,00.", "| R$ 120 mil |", "Aluguel R$ 5.500".
    .replace(
      /(?:valor|pre[çc]o|aluguel|condom[íi]nio|iptu)[^.\n|:]{0,30}:?\s*R\$\s*[\d.,]*\d(?:\s*(?:mil|milh[õo]es|mi|k)(?!\p{L}))?\.?/giu,
      '',
    )
    // O preço do metro: "(R$ 250,00 o m²)".
    .replace(/\(?\s*R\$\s*[\d.,]*\d\s*(?:o|por)\s*m²\s*\)?/giu, '')
    .replace(/R\$\s*[\d.,]*\d(?:\s*(?:mil|milh[õo]es|mi|k)(?!\p{L}))?/giu, '')
    // O código (com o "Código" antes, quando houver).
    .replace(/c[óo]digo:?\s*(?=[A-Z]{2}\d{3,4})/giu, '')
    .replace(/(?<![\p{L}\d])[A-Z]{2}\d{3,4}(?:_IMOVA)?(?!\d)\.?/gu, '')
    // As sobras: separadores vazios, espaço antes de pontuação, linhas vazias.
    .replace(/(?:\s*\|)+\s*$/gmu, '')
    .replace(/\|\s*(?=\|)/gu, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/ +([.,;:])/g, '$1')
    .replace(/^[ .,;:|]+|[ ]+$/gmu, '')
    .replace(/\n{2,}/g, '\n')
    .trim();
  return semTelefone(limpo).slice(0, 1200);
}

/** A entrada do prompt: rótulos curtos no lugar dos uuids (m1, m2...), as últimas 30 mensagens. */
export function montarEntradaDaRetomada(
  e: EntradaDoBancoDaRetomada,
  leadId: string,
): EntradaDaRetomadaV2 {
  const ultimas = (e.mensagens ?? []).slice(-30);
  return {
    leadId,
    agora: (e.agora ?? '').slice(0, 40),
    agoraPorExtenso: (e.agora_por_extenso ?? e.agora ?? '').slice(0, 80),
    horasSemResposta: Math.min(Math.max(Math.trunc(e.horas_sem_resposta ?? 1), 1), 24 * 31),
    cliente: { nome: e.cliente?.nome?.slice(0, 120) ?? null },
    imovel:
      e.imovel === null || e.imovel === undefined
        ? null
        : {
            codigo: e.imovel.codigo.slice(0, 80),
            descricao: descricaoDoImovel(e.imovel),
            anuncio: textoDoAnuncio(e.imovel),
            disponivel: e.imovel.disponivel === true,
          },
    mensagens: ultimas.map((m, indice) => ({
      messageId: `m${indice + 1}`,
      de: m.de,
      quem: m.quem === null ? null : m.quem.slice(0, 60),
      quando: m.quando.slice(0, 40),
      texto: (m.texto ?? '').slice(0, 2000),
    })),
  };
}

async function rpc<T = Record<string, unknown>>(
  contexto: ContextoDaIa,
  funcao: string,
  argumentos: Record<string, unknown>,
): Promise<T> {
  const { data, error } = await contexto.cliente.rpc(funcao, argumentos);
  if (error) throw new ErroDaEsteira(funcao, error.message);
  return data as T;
}

/** A etapa não sai: fica pulada com o motivo (e, com `encerra`, as seguintes também). */
async function desistir(
  contexto: ContextoDaIa,
  retomadaId: string,
  motivo: string,
  encerra: boolean,
  aiRunId: number | null,
  promptVersion: string | null,
): Promise<ResultadoDaRetomada> {
  const r = await rpc(contexto, 'ia_retomada_desistir', {
    p_retomada_id: retomadaId,
    p_motivo: motivo.slice(0, 300),
    p_encerra: encerra,
    p_ai_run_id: aiRunId,
    p_prompt_version: promptVersion,
  });
  contexto.logger.info('a retomada não saiu', {
    retomada_id: retomadaId,
    motivo,
    encerra,
    ok: r.ok === true,
  });
  return { feito: false, motivo, ...(aiRunId === null ? {} : { aiRunId }) };
}

type Lida =
  | {
      readonly lida: false;
      readonly motivo: string;
      readonly aiRunId: number | null;
      readonly versao: string;
    }
  | {
      readonly lida: true;
      readonly saida: SaidaDaRetomadaV2;
      readonly motivoDaIa: string;
      readonly nome: string | null;
      readonly mapa: Parameters<typeof reidratar>[1];
      readonly aiRunId: number;
      readonly custoUsd: number;
      readonly promptVersion: string;
    };

/**
 * A IA lê a conversa (`retomar-conversa@v1`, pelo `executar()`). Toda falha que repetir
 * não resolve vira `lida: false` com o motivo; rede, 429 e 5xx sobem para a fila tentar
 * de novo.
 */
async function lerComAIa(
  contexto: ContextoDaIa,
  e: EntradaDoBancoDaRetomada,
  conversationId: string,
): Promise<Lida> {
  const leadId = leadIdCurto(e.organization_id ?? conversationId);
  const ficha = await buscarContatoDaFicha(
    contexto.cliente,
    e.organization_id ?? null,
    e.contact_id ?? null,
    null,
  );
  const contato = {
    leadId,
    nome: ficha.nome ?? e.cliente?.nome ?? null,
    empresa: ficha.empresa,
    telefones: ficha.telefones,
    emails: ficha.emails,
    instagram: ficha.instagram,
  };
  const vinculos = {
    organizationId: e.organization_id ?? null,
    contactId: e.contact_id ?? null,
    conversationId,
  };

  // O modelo é o do prompt (Haiku 5.5): a retomada é curta e não carrega a base da Imova.
  const prompt: PromptVersionado<EntradaDaRetomadaV2, SaidaDaRetomadaV2> = retomarConversaV2;
  const versao = `${prompt.id}@v${prompt.versao}`;
  try {
    const executada = await executar(
      contexto,
      prompt,
      montarEntradaDaRetomada(e, leadId),
      contato,
      vinculos,
    );
    return {
      lida: true,
      saida: executada.saida,
      motivoDaIa: limparTexto(reidratar(executada.saida.motivo, executada.mapa)).slice(0, 200),
      nome: contato.nome,
      mapa: executada.mapa,
      aiRunId: executada.aiRunId,
      custoUsd: executada.custoUsd,
      promptVersion: executada.promptVersion,
    };
  } catch (erro) {
    if (erro instanceof ChamadaBloqueadaError) {
      return { lida: false, motivo: 'dado_pessoal_na_conversa', aiRunId: erro.aiRunId, versao };
    }
    if (erro instanceof OrcamentoEsgotadoError) {
      return { lida: false, motivo: 'orcamento_de_ia_no_limite', aiRunId: null, versao };
    }
    if (erro instanceof RecusaDoModeloError) {
      return { lida: false, motivo: 'o_modelo_recusou', aiRunId: null, versao };
    }
    if (
      erro instanceof RespostaIlegivelError ||
      (erro instanceof ErroDoModelo && !erro.transitorio)
    ) {
      return { lida: false, motivo: 'a_ia_nao_conseguiu_escrever', aiRunId: null, versao };
    }
    throw erro;
  }
}

/** Os textos de onde um número da retomada pode vir: a conversa e o imóvel. */
export function contextoDosNumeros(e: EntradaDoBancoDaRetomada): string[] {
  const imovel =
    e.imovel === null || e.imovel === undefined
      ? []
      : [e.imovel.codigo, descricaoDoImovel(e.imovel), textoDoAnuncio(e.imovel)];
  return [...(e.mensagens ?? []).map((m) => m.texto ?? ''), ...imovel];
}

/**
 * A leitura antes do primeiro modelo (revisão de 11/11/2026): a IA lê a conversa só
 * para decidir. Segue, encerra (o cliente fechou o assunto), ou falhou — e aí o modelo
 * daquele dia não sai (`sem_leitura_da_ia`, falha fechada). O texto que o modelo
 * escreveu é descartado: quem sai é o modelo aprovado pela Meta.
 */
async function lerAntesDoModelo(
  contexto: ContextoDaIa,
  leituraId: string,
  conversationId: string,
): Promise<ResultadoDaRetomada> {
  const gravar = async (
    decisao: 'segue' | 'encerra' | 'falhou',
    motivo: string,
    aiRunId: number | null,
    promptVersion: string | null,
  ): Promise<ResultadoDaRetomada> => {
    const r = await rpc(contexto, 'ia_retomada_leitura_gravar', {
      p_leitura_id: leituraId,
      p_decisao: decisao,
      p_motivo: motivo.slice(0, 300),
      p_ai_run_id: aiRunId,
      p_prompt_version: promptVersion,
    });
    contexto.logger.info('a IA leu o silêncio antes do modelo', {
      leitura_id: leituraId,
      decisao,
      motivo,
      ok: r.ok === true,
    });
    return {
      feito: decisao !== 'falhou' && r.ok === true,
      motivo: `leitura_${decisao}`,
      ...(aiRunId === null ? {} : { aiRunId }),
    };
  };

  const e = entradaDoBanco.parse(
    await rpc(contexto, 'ia_retomada_leitura_entrada', { p_leitura_id: leituraId }),
  );
  if (!e.existe) return { feito: false, motivo: 'leitura_nao_existe' };
  if (e.motivo === 'ja_resolvida') return { feito: false, motivo: 'ja_resolvida' };
  if (e.pode !== true) return gravar('falhou', e.motivo ?? 'nao_pode', null, null);
  if ((e.mensagens ?? []).length === 0) return gravar('falhou', 'conversa_vazia', null, null);

  const lida = await lerComAIa(contexto, e, conversationId);
  if (!lida.lida) return gravar('falhou', lida.motivo, lida.aiRunId, lida.versao);
  return gravar(
    lida.saida.retomar ? 'segue' : 'encerra',
    lida.motivoDaIa,
    lida.aiRunId,
    lida.promptVersion,
  );
}

export async function retomarConversa(
  contexto: ContextoDaIa,
  bruto: unknown,
): Promise<ResultadoDaRetomada> {
  const payload = payloadDaRetomada.parse(bruto);
  if (contexto.empresa !== 'imova') {
    return { feito: false, motivo: 'so_na_imova' };
  }
  if (payload.leitura_id !== undefined) {
    return lerAntesDoModelo(contexto, payload.leitura_id, payload.conversation_id);
  }
  const retomadaId = payload.retomada_id!;

  const e = entradaDoBanco.parse(
    await rpc(contexto, 'ia_retomada_entrada', { p_retomada_id: retomadaId }),
  );
  if (!e.existe) return { feito: false, motivo: 'retomada_nao_existe' };
  if (e.motivo === 'ja_resolvida') return { feito: false, motivo: 'ja_resolvida' };
  if (e.pode !== true) {
    // O cliente respondeu, a equipe assumiu, pediu para sair...: quem decide é o banco,
    // e a etapa sai da fila com o motivo dele, sem chamar o modelo.
    return desistir(contexto, retomadaId, e.motivo ?? 'nao_pode', false, null, null);
  }
  if ((e.mensagens ?? []).length === 0) {
    return desistir(contexto, retomadaId, 'conversa_vazia', false, null, null);
  }

  const lida = await lerComAIa(contexto, e, payload.conversation_id);
  if (!lida.lida) {
    return desistir(contexto, retomadaId, lida.motivo, false, lida.aiRunId, lida.versao);
  }
  if (!lida.saida.retomar) {
    return desistir(
      contexto,
      retomadaId,
      `a_ia_decidiu_nao_retomar: ${lida.motivoDaIa}`,
      true,
      lida.aiRunId,
      lida.promptVersion,
    );
  }

  const texto = soOPrimeiroNome(limparTexto(reidratar(lida.saida.mensagem, lida.mapa)), lida.nome);
  const proibido = motivoParaNaoMandarV2(texto, contextoDosNumeros(e));
  if (proibido !== null) {
    return desistir(
      contexto,
      retomadaId,
      `texto_fora_das_regras: ${proibido}`,
      false,
      lida.aiRunId,
      lida.promptVersion,
    );
  }

  const r = await rpc(contexto, 'ia_retomada_dizer', {
    p_retomada_id: retomadaId,
    p_texto: texto,
    p_detalhes: {
      motivo: lida.motivoDaIa,
      confianca: lida.saida.confianca,
      modelo: MODELOS.haiku55,
    },
    p_ai_run_id: lida.aiRunId,
    p_prompt_version: lida.promptVersion,
  });
  contexto.logger.info('a IA retomou o contato', {
    conversation_id: payload.conversation_id,
    retomada_id: retomadaId,
    ok: r.ok === true,
    motivo: r.motivo ?? null,
    confianca: lida.saida.confianca,
    custo_usd: lida.custoUsd,
  });
  return {
    feito: r.ok === true,
    motivo: r.ok === true ? 'retomou' : String(r.motivo ?? 'recusado'),
    aiRunId: lida.aiRunId,
    custoUsd: lida.custoUsd,
  };
}
