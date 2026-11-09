/**
 * A IA que atende o cliente da Imova sozinha (06/11/2026).
 *
 * O banco põe na fila (`app.ia_atendente_enfileirar`, a cada 10 s) a conversa em que
 * a IA atende e cujo cliente parou de escrever; este trabalho lê a conversa, a base da
 * Imova (caderno e imóveis), chama o modelo e leva a decisão ao banco:
 *
 *   responder             → `public.ia_atendente_responder`
 *   marcar_visita         → `public.ia_atendente_marcar_visita` (e, se o horário foi
 *                           tomado, oferece as alternativas que o banco devolveu)
 *   passar_para_corretor  → `public.ia_atendente_passar` (avisa e entrega a uma pessoa)
 *   nao_responder         → `public.ia_atendente_registrar_silencio`
 *
 * Quem decide se AINDA dá para falar é o banco, no instante de gravar: a IA continua
 * atendendo ali, não chegou mensagem nova do cliente, a mensagem não foi respondida, o
 * teto por hora. O worker não repete essas regras (ADR-03).
 *
 * O QUE NÃO PODE ACONTECER É SILÊNCIO. Quando a IA não consegue responder (o guardrail
 * de dado pessoal segurou a chamada, o orçamento acabou, o modelo recusou ou devolveu
 * algo fora do combinado), a conversa vai para uma pessoa com o aviso padrão. Só o
 * erro de rede e o 429/5xx voltam para a fila, porque repetir resolve.
 */
import { z } from 'zod';

import {
  type BaseDoAtendenteV2,
  type EntradaDoAtendente,
  type ImovelDaBaseV2,
  type PromptVersionado,
  type SaidaDoAtendenteV2,
  CANAIS_DE_CHEGADA,
  MODELOS,
  atendenteImovaV2,
  reidratar,
  sistemaComBaseV2,
} from '@komune/prompts';

import { ErroDaEsteira } from '../fila/esteira';
import { buscarContatoDaFicha } from './banco';
import { ErroDoModelo, RespostaIlegivelError } from './cliente';
import {
  aplicarReconhecimentos,
  ensinarFotos,
  fotosReconhecidasDaConversa,
  reconhecerFotosDaConversa,
} from './fotos-dos-anuncios';
import {
  ChamadaBloqueadaError,
  type ContextoDaIa,
  OrcamentoEsgotadoError,
  executar,
  leadIdCurto,
} from './execucao';

const uuid = z.string().uuid();

export const payloadDoAtendente = z.object({
  purpose: z.literal('draft_reply'),
  conversation_id: uuid,
  message_id: uuid,
});

/** O que o banco devolve em `public.ia_entrada_do_atendente`. */
const entradaDoBanco = z.object({
  existe: z.boolean(),
  conversation_id: uuid.optional(),
  organization_id: uuid.nullable().optional(),
  contact_id: uuid.nullable().optional(),
  treino: z.boolean().optional(),
  atende: z.boolean().optional(),
  agora: z.string().optional(),
  agora_por_extenso: z.string().optional(),
  cliente: z
    .object({
      nome: z.string().nullable(),
      tem_ficha: z.boolean(),
      etapa: z.string().nullable(),
      perfil: z.array(z.object({ campo: z.string(), valor: z.string().nullable() })),
      visitas: z.array(z.object({ quando: z.string(), estado: z.string(), local: z.string().nullable() })),
      canal_de_chegada: z.string().nullable(),
    })
    .optional(),
  horarios_de_visita: z
    .array(z.object({ inicio: z.string(), quando_por_extenso: z.string() }).passthrough())
    .optional(),
  ultima_do_cliente: uuid.nullable().optional(),
  respostas_na_ultima_hora: z.number().optional(),
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

export type EntradaDoBancoDoAtendente = z.infer<typeof entradaDoBanco>;

const baseDoBanco = z.object({
  caderno: z.array(z.object({ id: z.number(), texto: z.string(), origem: z.string() })),
  imoveis: z.array(z.object({ codigo: z.string() }).passthrough()),
  versao: z.record(z.string(), z.unknown()).optional(),
});

/** Os modelos que a configuração pode escolher; qualquer outro valor fica no padrão. */
// O Haiku 5.5 desde 06/11/2026, a pedido do usuário (economia; migração 20261106180000).
const MODELOS_DO_ATENDENTE = new Set<string>([MODELOS.haiku55, MODELOS.sonnet55, MODELOS.opus55]);

export interface ResultadoDoAtendente {
  readonly feito: boolean;
  readonly motivo?: string;
  readonly aiRunId?: number;
  readonly custoUsd?: number;
  readonly detalhes?: Record<string, unknown>;
}

/**
 * O nome completo do cliente vira só o primeiro nome. O modelo enxerga o nome inteiro
 * como um marcador ([[NOME_1]]) e não tem como chamar "só o Janio": a troca é aqui,
 * depois de reidratar (pedido do treino em 06/11/2026: "chame o cliente só pelo
 * primeiro nome").
 */
export function soOPrimeiroNome(texto: string, nomeCompleto: string | null): string {
  const nome = (nomeCompleto ?? '').trim().replace(/\s+/g, ' ');
  const primeiro = nome.split(' ')[0] ?? '';
  if (nome === '' || primeiro === '' || primeiro === nome) return texto;
  return texto.split(nome).join(primeiro);
}

/** O texto que o CRM vê: marcador que sobrou da pseudonimização sai, espaço sobrando também. */
export function limparTexto(texto: string): string {
  return texto
    .replace(/\[\[[A-Z_]+_\d+\]\]/g, '')
    .replace(/[ \t]+([,.!?])/g, '$1')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/,\s*!/g, '!')
    .trim();
}

/**
 * A entrada do prompt, a partir do que o banco devolveu. As mensagens ganham rótulo
 * curto (m1, m2...) e os horários também (h1, h2...): o modelo nunca vê uuid nem
 * instante, e os mapas devolvem o rótulo ao banco.
 */
export function montarEntrada(
  e: EntradaDoBancoDoAtendente,
  leadId: string,
): {
  entrada: EntradaDoAtendente;
  horarios: Map<string, { inicio: string; quando: string }>;
  /** m1, m2... → o id da mensagem no banco (para a foto que o treino ensina). */
  rotulos: Map<string, string>;
} {
  const ultimas = (e.mensagens ?? []).slice(-40);
  const rotulos = new Map(ultimas.map((m, indice) => [`m${indice + 1}`, m.id]));
  const mensagens = ultimas.map((m, indice) => ({
    messageId: `m${indice + 1}`,
    de: m.de,
    quem: m.quem === null ? null : m.quem.slice(0, 60),
    quando: m.quando.slice(0, 40),
    texto: (m.texto ?? '').slice(0, 2000),
  }));
  const horarios = new Map<string, { inicio: string; quando: string }>();
  for (const [indice, h] of (e.horarios_de_visita ?? []).slice(0, 8).entries()) {
    horarios.set(`h${indice + 1}`, { inicio: h.inicio, quando: h.quando_por_extenso.slice(0, 80) });
  }
  const canal = e.cliente?.canal_de_chegada ?? null;
  return {
    horarios,
    rotulos,
    entrada: {
      leadId,
      agora: (e.agora ?? '').slice(0, 40),
      agoraPorExtenso: (e.agora_por_extenso ?? e.agora ?? '').slice(0, 80),
      treino: e.treino === true,
      cliente: {
        nome: e.cliente?.nome?.slice(0, 120) ?? null,
        temFicha: e.cliente?.tem_ficha ?? false,
        etapa: e.cliente?.etapa?.slice(0, 80) ?? null,
        perfil: (e.cliente?.perfil ?? [])
          .filter((p) => p.valor !== null && p.valor !== '')
          .slice(0, 12)
          .map((p) => ({ campo: p.campo.slice(0, 40), valor: (p.valor ?? '').slice(0, 200) })),
        visitas: (e.cliente?.visitas ?? []).slice(0, 5).map((v) => ({
          quando: v.quando.slice(0, 80),
          estado: v.estado.slice(0, 40),
          local: v.local === null ? null : v.local.slice(0, 200),
        })),
        canalDeChegada: (CANAIS_DE_CHEGADA as readonly string[]).includes(canal ?? '')
          ? (canal as EntradaDoAtendente['cliente']['canalDeChegada'])
          : null,
      },
      horariosDeVisita: [...horarios.entries()].map(([opcao, h]) => ({ opcao, quando: h.quando })),
      respostasNaUltimaHora: Math.max(0, Math.trunc(e.respostas_na_ultima_hora ?? 0)),
      mensagens,
    },
  };
}

/** O texto das alternativas quando o horário escolhido foi tomado entre a oferta e o aceite. */
export function textoDasAlternativas(alternativas: readonly { quando_por_extenso?: unknown }[]): string | null {
  const quando = alternativas
    .map((a) => (typeof a.quando_por_extenso === 'string' ? a.quando_por_extenso : null))
    .filter((q): q is string => q !== null)
    .slice(0, 3);
  if (quando.length === 0) return null;
  const lista = quando.length === 1 ? quando[0] : `${quando.slice(0, -1).join('; ')} ou ${quando[quando.length - 1]}`;
  return `Esse horário acabou de ser ocupado. Posso marcar ${lista}. Qual fica melhor para você?`;
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

async function modeloEscolhido(contexto: ContextoDaIa): Promise<string> {
  const { data } = await contexto.cliente.from('app_settings').select('value').eq('key', 'ia.atendente').maybeSingle();
  const valor = ((data as { value?: unknown } | null)?.value ?? {}) as Record<string, unknown>;
  return typeof valor.modelo === 'string' && MODELOS_DO_ATENDENTE.has(valor.modelo)
    ? valor.modelo
    : atendenteImovaV2.modelo;
}

/** Entrega a conversa a uma pessoa, com o aviso padrão e o motivo para a equipe. */
async function passarParaGente(
  contexto: ContextoDaIa,
  conversationId: string,
  messageId: string,
  motivo: string,
  aiRunId: number | null,
): Promise<ResultadoDoAtendente> {
  const r = await rpc(contexto, 'ia_atendente_passar', {
    p_conversation_id: conversationId,
    p_em_resposta_a: messageId,
    p_texto: null,
    p_motivo: motivo.slice(0, 300),
    p_ai_run_id: aiRunId,
    p_prompt_version: 'regra',
  });
  contexto.logger.warn('a IA que atende passou a conversa para uma pessoa', {
    conversation_id: conversationId,
    motivo,
    ok: r.ok === true,
    resultado: r.motivo ?? null,
  });
  return { feito: r.ok === true, motivo: `passou_para_pessoa: ${motivo}`, ...(aiRunId === null ? {} : { aiRunId }) };
}

export async function atenderCliente(contexto: ContextoDaIa, bruto: unknown): Promise<ResultadoDoAtendente> {
  const payload = payloadDoAtendente.parse(bruto);
  if (contexto.empresa !== 'imova') {
    return { feito: false, motivo: 'so_na_imova' };
  }

  const e = entradaDoBanco.parse(
    await rpc(contexto, 'ia_entrada_do_atendente', { p_conversation_id: payload.conversation_id }),
  );
  if (!e.existe) return { feito: false, motivo: 'conversa_nao_existe' };
  if (e.atende !== true) return { feito: false, motivo: 'ia_nao_atende' };
  // Chegou mensagem depois: o trabalho dela é que responde (ela tem a própria chave).
  if (e.ultima_do_cliente !== payload.message_id) return { feito: false, motivo: 'chegou_mensagem_nova' };
  if ((e.mensagens ?? []).length === 0) return { feito: false, motivo: 'conversa_vazia' };

  const base = baseDoBanco.parse(await rpc(contexto, 'ia_atendente_base', {})) as BaseDoAtendenteV2 & {
    versao?: Record<string, unknown>;
  };
  const leadId = leadIdCurto(e.organization_id ?? payload.conversation_id);

  // O nome e o telefone do cliente saem pseudonimizados. Sem ficha, o nome do perfil
  // do WhatsApp é o que existe, e é ele que entra na troca.
  const ficha = await buscarContatoDaFicha(contexto.cliente, e.organization_id ?? null, e.contact_id ?? null, null);
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
    conversationId: payload.conversation_id,
  };

  // A foto que o cliente mandou (09/11/2026): reconhecida antes de a IA escrever, e
  // escrita na conversa no lugar de "[foto]". Falha aqui não derruba a resposta.
  await reconhecerFotosDaConversa(
    contexto,
    payload.conversation_id,
    leadId,
    contato,
    vinculos,
    base.imoveis as readonly ImovelDaBaseV2[],
  );
  const reconhecidas = await fotosReconhecidasDaConversa(contexto, payload.conversation_id).catch(
    () => new Map(),
  );
  const { entrada, horarios, rotulos } = montarEntrada(
    { ...e, mensagens: aplicarReconhecimentos(e.mensagens ?? [], reconhecidas) },
    leadId,
  );

  const prompt: PromptVersionado<EntradaDoAtendente, SaidaDoAtendenteV2> = {
    ...atendenteImovaV2,
    modelo: (await modeloEscolhido(contexto)) as typeof atendenteImovaV2.modelo,
    sistema: sistemaComBaseV2(base),
  };

  let executada;
  try {
    executada = await executar(contexto, prompt, entrada, contato, vinculos);
  } catch (erro) {
    if (erro instanceof ChamadaBloqueadaError) {
      return passarParaGente(
        contexto,
        payload.conversation_id,
        payload.message_id,
        'a conversa tem um dado pessoal (telefone, e-mail ou @) que não pode ir para a IA',
        erro.aiRunId,
      );
    }
    if (erro instanceof OrcamentoEsgotadoError) {
      return passarParaGente(
        contexto,
        payload.conversation_id,
        payload.message_id,
        'o orçamento de IA do mês chegou ao limite',
        null,
      );
    }
    if (erro instanceof RespostaIlegivelError || (erro instanceof ErroDoModelo && !erro.transitorio)) {
      return passarParaGente(
        contexto,
        payload.conversation_id,
        payload.message_id,
        'a IA não conseguiu escrever a resposta',
        null,
      );
    }
    throw erro;
  }

  const saida = executada.saida;
  const texto = soOPrimeiroNome(limparTexto(reidratar(saida.mensagem, executada.mapa)), contato.nome);
  const comum = {
    p_conversation_id: payload.conversation_id,
    p_em_resposta_a: payload.message_id,
    p_ai_run_id: executada.aiRunId,
    p_prompt_version: executada.promptVersion,
  };
  const detalhes = {
    motivo: limparTexto(reidratar(saida.motivo, executada.mapa)),
    confianca: saida.confianca,
    modelo: prompt.modelo,
    base: base.versao ?? null,
  };

  // O treino: o que a equipe ensinou vai para o caderno antes da resposta, para a
  // próxima mensagem já ler.
  let anotadas = 0;
  if (e.treino === true && saida.anotacoes.length > 0) {
    anotadas = await rpc<number>(contexto, 'ia_atendente_anotar', {
      p_conversation_id: payload.conversation_id,
      p_message_id: payload.message_id,
      p_textos: saida.anotacoes.map((a) => limparTexto(reidratar(a, executada.mapa))),
    });
  }

  // O treino também ensina de qual anúncio é uma foto.
  let fotosEnsinadas = 0;
  if (e.treino === true && saida.fotosEnsinadas.length > 0) {
    fotosEnsinadas = await ensinarFotos(
      contexto,
      payload.conversation_id,
      saida.fotosEnsinadas.map((f) => ({ messageId: rotulos.get(f.messageId), codigo: f.imovelCodigo })),
    );
  }

  let resultado: Record<string, unknown>;
  switch (saida.acao) {
    case 'nao_responder': {
      await rpc(contexto, 'ia_atendente_registrar_silencio', {
        ...comum,
        p_motivo: detalhes.motivo,
        p_detalhes: detalhes,
      });
      resultado = { ok: true, motivo: 'nao_respondeu' };
      break;
    }
    case 'passar_para_corretor': {
      resultado = await rpc(contexto, 'ia_atendente_passar', {
        ...comum,
        p_texto: texto === '' ? null : texto,
        p_motivo: detalhes.motivo,
      });
      break;
    }
    case 'marcar_visita': {
      const horario = saida.visita === null ? undefined : horarios.get(saida.visita.opcao);
      if (horario === undefined || saida.visita === null || texto === '') {
        return passarParaGente(
          contexto,
          payload.conversation_id,
          payload.message_id,
          `o cliente quer marcar visita e a IA não achou um horário válido (${detalhes.motivo})`,
          executada.aiRunId,
        );
      }
      resultado = await rpc(contexto, 'ia_atendente_marcar_visita', {
        ...comum,
        p_inicio: horario.inicio,
        p_imovel_codigo: saida.visita.imovelCodigo,
        p_texto: texto,
      });
      if (resultado.ok !== true && resultado.motivo === 'horario_indisponivel') {
        const alternativas = textoDasAlternativas(
          Array.isArray(resultado.alternativas) ? (resultado.alternativas as { quando_por_extenso?: unknown }[]) : [],
        );
        if (alternativas !== null) {
          resultado = await rpc(contexto, 'ia_atendente_responder', {
            ...comum,
            p_texto: alternativas,
            p_detalhes: { ...detalhes, visita: 'horario_tomado' },
          });
          break;
        }
      }
      if (
        resultado.ok !== true &&
        !['chegou_mensagem_nova', 'ja_respondida', 'ia_nao_atende'].includes(String(resultado.motivo))
      ) {
        return passarParaGente(
          contexto,
          payload.conversation_id,
          payload.message_id,
          `o cliente quer visitar ${saida.visita.imovelCodigo ?? 'um imóvel'} em ${horario.quando}, e a IA não conseguiu marcar sozinha (${String(resultado.motivo)})`,
          executada.aiRunId,
        );
      }
      break;
    }
    case 'responder':
    default: {
      if (texto === '') {
        return passarParaGente(
          contexto,
          payload.conversation_id,
          payload.message_id,
          'a IA devolveu uma resposta vazia',
          executada.aiRunId,
        );
      }
      resultado = await rpc(contexto, 'ia_atendente_responder', { ...comum, p_texto: texto, p_detalhes: detalhes });
      break;
    }
  }

  contexto.logger.info('a IA que atende decidiu', {
    conversation_id: payload.conversation_id,
    acao: saida.acao,
    ok: resultado.ok === true,
    motivo: resultado.motivo ?? null,
    treino: e.treino === true,
    anotadas,
    fotos_ensinadas: fotosEnsinadas,
    confianca: saida.confianca,
    custo_usd: executada.custoUsd,
  });
  return {
    feito: resultado.ok === true,
    motivo: resultado.ok === true ? saida.acao : String(resultado.motivo ?? 'recusado'),
    aiRunId: executada.aiRunId,
    custoUsd: executada.custoUsd,
    detalhes: { acao: saida.acao, anotadas, fotosEnsinadas },
  };
}
