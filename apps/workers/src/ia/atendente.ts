/**
 * A IA que atende o cliente da Imova sozinha (06/11/2026).
 *
 * O banco põe na fila (`app.ia_atendente_enfileirar`, a cada 10 s) a conversa em que
 * a IA atende e cujo cliente parou de escrever; este trabalho lê a conversa, a base da
 * Imova (caderno e imóveis), chama o modelo e leva a decisão ao banco:
 *
 *   responder              → `public.ia_atendente_responder`
 *   enviar_link_da_agenda  → `public.ia_atendente_enviar_link` (11/11/2026, prompt v3: o
 *                            link da agenda, de visita com o imóvel ou de reunião; o
 *                            cliente escolhe o horário no Calendly)
 *   passar_para_corretor   → `public.ia_atendente_passar` (avisa e entrega a uma pessoa)
 *   nao_responder          → `public.ia_atendente_registrar_silencio`
 *
 * A visita marcada pela própria IA (`marcar_visita`, prompt v2) saiu em 11/11/2026: a
 * versão do prompt é a que este arquivo importa (a configuração `ia.atendente` escolhe
 * só o modelo), e a v3 não tem mais essa ação.
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
  type ConviteDaAgenda,
  type EntradaDoAtendenteV3,
  type ImovelDaBaseV2,
  type PromptVersionado,
  type SaidaDoAtendenteV3,
  type TipoDaAgenda,
  CANAIS_DE_CHEGADA,
  MODELOS,
  TIPOS_DA_AGENDA,
  atendenteImovaV3,
  reidratar,
  sistemaComBaseV3,
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
  // Os links da agenda que já saíram (11/11/2026, `agenda_convites`): até cinco, o mais
  // novo primeiro. Lidos um a um em `convitesDaEntrada`; uma forma inesperada aqui vira
  // lista vazia, e não derruba a resposta.
  convites_da_agenda: z.array(z.unknown()).optional().catch(undefined),
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

/** Um link da agenda como o banco devolve em `convites_da_agenda`. */
const conviteDoBanco = z.object({
  tipo: z.enum(TIPOS_DA_AGENDA),
  imovel_codigo: z.string().nullable().optional(),
  enviado_em: z.string(),
  agendado: z.boolean().nullable().optional(),
});

const FORTALEZA = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Fortaleza',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

/**
 * O instante do banco (ISO) como o prompt lê: AAAA-MM-DDTHH:MM, no relógio de Natal.
 * Com o "T": com espaço, todo instante de 2027 tem dez dígitos seguidos começando por
 * DDD, e a auditoria de dado pessoal barraria a chamada (achado de 11/11/2026).
 */
export function instanteDeFortaleza(iso: string): string | null {
  const data = new Date(iso);
  if (Number.isNaN(data.getTime())) return null;
  const partes = Object.fromEntries(FORTALEZA.formatToParts(data).map((p) => [p.type, p.value]));
  return `${partes.year}-${partes.month}-${partes.day}T${partes.hour}:${partes.minute}`;
}

/** Os links da agenda que o modelo lê: só os de forma conhecida, no máximo cinco. */
export function convitesDaEntrada(brutos: readonly unknown[] | undefined): ConviteDaAgenda[] {
  const convites: ConviteDaAgenda[] = [];
  for (const bruto of brutos ?? []) {
    const lido = conviteDoBanco.safeParse(bruto);
    if (!lido.success) continue;
    const enviadoEm = instanteDeFortaleza(lido.data.enviado_em);
    if (enviadoEm === null) continue;
    const codigo = lido.data.imovel_codigo?.trim() ?? '';
    convites.push({
      tipo: lido.data.tipo,
      imovelCodigo: lido.data.tipo === 'visita' && codigo !== '' ? codigo.slice(0, 80) : null,
      enviadoEm,
      agendado: lido.data.agendado === true,
    });
    if (convites.length === 5) break;
  }
  return convites;
}

/**
 * O link do Calendly que a IA (ou a equipe) já mandou volta na conversa como
 * "[link da agenda]". O modelo não precisa dele, e ele leva preenchidos o nome e o
 * telefone do cliente.
 */
export function semOLinkDaAgenda(texto: string): string {
  return texto.replace(/(?:https?:\/\/)?(?:www\.)?calendly\.com\/[^\s)>\]]*/gi, '[link da agenda]');
}

/** O agora do banco ("AAAA-MM-DD HH:MM") com o "T" (ver `instanteDeFortaleza`). */
function agoraComT(agora: string | undefined): string {
  return (agora ?? '').slice(0, 40).replace(/^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2})/, '$1T$2');
}

/**
 * A entrada do prompt, a partir do que o banco devolveu. As mensagens ganham rótulo
 * curto (m1, m2...): o modelo nunca vê uuid, e o mapa devolve o rótulo ao banco. Os
 * horários de visita não vão mais ao modelo (v3, 11/11/2026); vão os links da agenda
 * que já saíram.
 */
export function montarEntrada(
  e: EntradaDoBancoDoAtendente,
  leadId: string,
): {
  entrada: EntradaDoAtendenteV3;
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
    texto: semOLinkDaAgenda(m.texto ?? '').slice(0, 2000),
  }));
  const canal = e.cliente?.canal_de_chegada ?? null;
  return {
    rotulos,
    entrada: {
      leadId,
      agora: agoraComT(e.agora),
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
          ? (canal as EntradaDoAtendenteV3['cliente']['canalDeChegada'])
          : null,
      },
      convitesDaAgenda: convitesDaEntrada(e.convites_da_agenda),
      respostasNaUltimaHora: Math.max(0, Math.trunc(e.respostas_na_ultima_hora ?? 0)),
      mensagens,
    },
  };
}

/** As travas de sempre: o banco não deixou falar, e a próxima rodada lê tudo de novo. */
const TRAVAS_DE_SEMPRE = new Set(['chegou_mensagem_nova', 'ja_respondida', 'ia_nao_atende']);

/** Recusas do link que viram pergunta ao cliente, e não silêncio nem passagem. */
const RECUSAS_QUE_PERGUNTAM_O_IMOVEL = new Set(['visita_sem_imovel', 'imovel_desconhecido']);

/**
 * A pergunta curta quando o banco não achou o imóvel da visita: sem ele não há link,
 * porque toda visita da Imova tem código e endereço. Não pede o código (decisão do
 * treino, 11/11/2026): pergunta onde ele viu.
 */
export function perguntaDoImovel(motivo: string): string {
  return motivo === 'imovel_desconhecido'
    ? 'Não encontrei esse imóvel por aqui. Onde você viu o anúncio? Assim confirmo qual é e te mando o link para escolher o horário da visita.'
    : 'Para eu te mandar o link da visita, qual imóvel você quer ver? Pode me dizer o bairro ou onde viu o anúncio.';
}

/** O começo da mensagem do link quando o modelo não escreveu nada que sirva. */
export function textoDoLink(tipo: TipoDaAgenda): string {
  return tipo === 'visita'
    ? 'Vou te mandar o link da agenda para você escolher o melhor dia e horário da visita.'
    : 'Vou te mandar o link da agenda para você escolher o melhor horário para conversar com um dos nossos corretores.';
}

/**
 * O texto do modelo como vai ao banco no link: sem endereço de site nenhum (o modelo
 * nunca escreve URL; se escrever, sai aqui) e, vazio, o texto padrão do tipo.
 */
export function textoParaOLink(texto: string, tipo: TipoDaAgenda): string {
  const limpo = limparTexto(texto.replace(/(?:https?:\/\/|www\.)\S+|\b[\w.-]+\.(?:com|ly|br)(?:\/\S*)?/gi, ''))
    .replace(/[:\s]+$/u, '')
    .trim();
  if (limpo === '') return textoDoLink(tipo);
  return /[.!?…]$/u.test(limpo) ? limpo : `${limpo}.`;
}

/** O banco ainda não tem a função (a migração do convite não foi publicada). */
function funcaoQueNaoExiste(erro: unknown): boolean {
  return (
    erro instanceof ErroDaEsteira &&
    /could not find the function|does not exist|PGRST202|42883/i.test(erro.message)
  );
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

/** O modelo que a configuração escolheu (`ia.atendente.modelo`), ou o padrão da versão. */
export async function modeloEscolhido(contexto: ContextoDaIa): Promise<string> {
  const { data } = await contexto.cliente.from('app_settings').select('value').eq('key', 'ia.atendente').maybeSingle();
  const valor = ((data as { value?: unknown } | null)?.value ?? {}) as Record<string, unknown>;
  return typeof valor.modelo === 'string' && MODELOS_DO_ATENDENTE.has(valor.modelo)
    ? valor.modelo
    : atendenteImovaV3.modelo;
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
  const { entrada, rotulos } = montarEntrada(
    { ...e, mensagens: aplicarReconhecimentos(e.mensagens ?? [], reconhecidas) },
    leadId,
  );

  const prompt: PromptVersionado<EntradaDoAtendenteV3, SaidaDoAtendenteV3> = {
    ...atendenteImovaV3,
    modelo: (await modeloEscolhido(contexto)) as typeof atendenteImovaV3.modelo,
    sistema: sistemaComBaseV3(base),
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
  // O que de fato saiu: na recusa do imóvel, a ação do modelo era o link e o que saiu
  // foi a pergunta.
  let feita: string = saida.acao;
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
    case 'enviar_link_da_agenda': {
      if (saida.agenda === null) {
        return passarParaGente(
          contexto,
          payload.conversation_id,
          payload.message_id,
          `o cliente quer marcar uma visita ou conversa, e a IA não disse se é visita ou reunião (${detalhes.motivo})`,
          executada.aiRunId,
        );
      }
      const { tipo } = saida.agenda;
      // Na reunião o imóvel não vai: um código que o modelo pôs ali faria o banco recusar
      // por "imóvel desconhecido" uma conversa que não precisa de imóvel.
      const imovelCodigo = tipo === 'visita' ? saida.agenda.imovelCodigo?.trim() || null : null;
      const agenda = { tipo, imovelCodigo };
      try {
        resultado = await rpc(contexto, 'ia_atendente_enviar_link', {
          ...comum,
          p_tipo: tipo,
          p_imovel_codigo: imovelCodigo,
          p_texto: textoParaOLink(texto, tipo),
        });
      } catch (erro) {
        if (!funcaoQueNaoExiste(erro)) throw erro;
        return passarParaGente(
          contexto,
          payload.conversation_id,
          payload.message_id,
          `o cliente quer ${tipo === 'visita' ? `visitar ${imovelCodigo ?? 'um imóvel'}` : 'marcar uma conversa'}, e o banco ainda não manda o link da agenda (ia_atendente_enviar_link)`,
          executada.aiRunId,
        );
      }
      if (resultado.ok === true) break;
      const recusa = String(resultado.motivo ?? 'recusado');
      // Sem o imóvel não há link de visita: a IA pergunta qual, em vez de calar.
      if (RECUSAS_QUE_PERGUNTAM_O_IMOVEL.has(recusa)) {
        resultado = await rpc(contexto, 'ia_atendente_responder', {
          ...comum,
          p_texto: perguntaDoImovel(recusa),
          p_detalhes: { ...detalhes, agenda: { ...agenda, recusa } },
        });
        feita = 'perguntou_o_imovel';
        break;
      }
      if (!TRAVAS_DE_SEMPRE.has(recusa)) {
        return passarParaGente(
          contexto,
          payload.conversation_id,
          payload.message_id,
          `o cliente quer ${tipo === 'visita' ? `visitar ${imovelCodigo ?? 'um imóvel'}` : 'marcar uma conversa com um corretor'}, e a IA não conseguiu mandar o link da agenda (${recusa})`,
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
    feita,
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
    motivo: resultado.ok === true ? feita : String(resultado.motivo ?? 'recusado'),
    aiRunId: executada.aiRunId,
    custoUsd: executada.custoUsd,
    detalhes: { acao: saida.acao, anotadas, fotosEnsinadas, ...(saida.agenda === null ? {} : { agenda: saida.agenda }) },
  };
}
