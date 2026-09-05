import { z } from 'zod';
import type { Json, MsgStatus } from '@komune/schema';
import {
  FICHAS,
  type CodigoDeBloqueio,
  type FichaDaIntencao,
  type Intencao,
  type Responde,
} from '@komune/prompts';

import {
  ROTULO_ENTREGA,
  type EstadoDaJanela,
  type EstadoDoRascunho,
  type FioDaConversa,
  type MensagemDoFio,
  type OrigemDaMensagem,
  type RascunhoDaIa,
  type TipoDeRascunho,
  type VereditoDoValidador,
} from './tipos';

/**
 * A parte do inbox que é conta, e não desenho: a janela de 24 h, o estado de
 * entrega, o veredito do validador e a intenção que a IA devolveu.
 *
 * Fica separada dos componentes porque é o que decide o que a Heloísa PODE fazer
 * — responder livremente ou só por modelo, aprovar ou não —, e isso precisa ser
 * testável sem navegador (`mensagens.test.ts`).
 *
 * ===========================================================================
 * A BIBLIOTECA DE PROMPTS É A FONTE, NÃO UMA CÓPIA
 * ===========================================================================
 * As 25 intenções do R08 e os oito códigos do validador de promessas já existem
 * em `packages/prompts`, versionados e com evals. Esta tela os IMPORTA de lá.
 * Não é preciosismo: `Record<Intencao, string>` e `Record<CodigoDeBloqueio,
 * string>` são checados pelo compilador, então o dia em que alguém acrescentar
 * uma intenção ou um código de bloqueio ao pacote, esta tela fica VERMELHA no
 * `typecheck` até ganhar a frase em português. Uma cópia local ficaria calada e
 * mostraria o código cru (`PEDIU_TAXA_PRECO`) para quem está na rua.
 *
 * O que NÃO vem de lá é o texto em pt-BR: o pacote fala em códigos porque é ele
 * que conversa com o modelo. Quem conversa com gente é esta tela.
 */

// ---------------------------------------------------------------------------
// As linhas cruas, como saem do PostgREST
// ---------------------------------------------------------------------------

export type FioCru = {
  id: string;
  organization_id: string | null;
  contact_id: string | null;
  channel: string;
  peer_phone_e164: string;
  business_number: string;
  assignee_id: string;
  status: string;
  bot_paused: boolean;
  last_message_at: string | null;
  last_inbound_at: string | null;
  last_outbound_at: string | null;
  window_expires_at: string | null;
  unread_count: number;
  ai_summary: string | null;
  ai_intent: string | null;
  ai_confidence: number | null;
};

export type MensagemCrua = {
  id: string;
  conversation_id: string;
  organization_id: string | null;
  direction: string;
  type: string;
  status: string;
  body: string | null;
  media_path: string | null;
  media_mime: string | null;
  transcript: string | null;
  template_id: number | null;
  draft_id: string | null;
  author_kind: string;
  sent_by: string | null;
  approved_by: string | null;
  is_first_contact: boolean;
  business_initiated: boolean;
  optout_confirmation: boolean;
  origin: string;
  error_code: string | null;
  error_detail: string | null;
  created_at: string;
  sent_at: string | null;
  delivered_at: string | null;
  read_at: string | null;
  failed_at: string | null;
};

export type RascunhoCru = {
  id: string;
  organization_id: string;
  conversation_id: string | null;
  kind: string;
  status: string;
  proposed_body: string;
  proposed_claims: Json;
  validator: Json;
  prompt_version: string | null;
  final_body: string | null;
  foi_editado: boolean | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  discard_reason: string | null;
  created_at: string;
  expires_at: string;
};

// ---------------------------------------------------------------------------
// A janela de 24 h (R04 §2.1) — o relógio que decide o que pode sair
// ---------------------------------------------------------------------------

/**
 * Abaixo disto a janela vira contagem regressiva na tela, com o dígito em mono.
 *
 * Uma hora é o número da Meta lido pelo lado de quem trabalha: dentro dela ainda
 * dá para escrever, ligar, gravar um áudio e mandar. Acima dela o aviso viraria
 * ruído — "faltam 19 horas" não muda o que ninguém faz agora.
 */
export const JANELA_APERTADA_MIN = 60;

/**
 * O estado da janela a partir de `conversations.window_expires_at`, que o banco
 * deriva de `last_inbound_at` e ninguém escreve à mão.
 *
 * `nunca` não é o mesmo que `fechada`, e a diferença é a coisa mais importante
 * deste arquivo: com quem nunca escreveu para a gente não existe janela nenhuma.
 * Escrever "fechada" ali sugeriria que um dia ela esteve aberta, e mandaria a
 * Heloísa procurar no histórico uma resposta que nunca houve.
 */
export function estadoDaJanela(
  janelaExpiraEm: string | null,
  agora: Date = new Date(),
): EstadoDaJanela {
  if (!janelaExpiraEm) return { situacao: 'nunca' };
  const fim = new Date(janelaExpiraEm).getTime();
  const diffMin = Math.floor((fim - agora.getTime()) / 60_000);
  if (diffMin > 0) return { situacao: 'aberta', expiraEm: janelaExpiraEm, restanteMin: diffMin };
  return { situacao: 'fechada', expirouEm: janelaExpiraEm, fechadaHaMin: Math.max(0, -diffMin) };
}

/** Dentro da janela, texto e áudio são livres e gratuitos (R04 §2.1). */
export function podeEscreverLivre(estado: EstadoDaJanela): boolean {
  return estado.situacao === 'aberta';
}

/** "3 h 12 min", "47 min", "2 dias" — dígito separado da palavra, como o resto da casa. */
export function duracaoLonga(minutos: number): { numero: string; unidade: string }[] {
  const min = Math.max(0, minutos);
  if (min < 60) return [{ numero: String(min), unidade: ' min' }];
  if (min < 24 * 60) {
    const horas = Math.floor(min / 60);
    const resto = min % 60;
    const partes = [{ numero: String(horas), unidade: horas === 1 ? ' hora' : ' horas' }];
    if (resto > 0) partes.push({ numero: String(resto), unidade: ' min' });
    return partes;
  }
  const dias = Math.floor(min / (24 * 60));
  return [{ numero: String(dias), unidade: dias === 1 ? ' dia' : ' dias' }];
}

/** A mesma duração em uma unidade só, para caber numa linha de lista de 20rem. */
export function tempoCurto(minutos: number): { numero: string; unidade: string } {
  const min = Math.max(0, minutos);
  if (min < 60) return { numero: String(min), unidade: ' min' };
  if (min < 24 * 60) return { numero: String(Math.floor(min / 60)), unidade: ' h' };
  const dias = Math.floor(min / (24 * 60));
  return { numero: String(dias), unidade: dias === 1 ? ' dia' : ' dias' };
}

// ---------------------------------------------------------------------------
// O estado de entrega
// ---------------------------------------------------------------------------

/**
 * O tom da linha de entrega. Não é cor: a cromia desta interface pertence à
 * escala térmica. É peso de fonte e ícone.
 */
export type TomDaEntrega = 'normal' | 'espera' | 'falha';

export type Entrega = {
  rotulo: string;
  /** A frase honesta embaixo do rótulo; `null` quando o rótulo já basta. */
  detalhe: string | null;
  tom: TomDaEntrega;
};

/**
 * O que a pessoa precisa saber sobre esta mensagem ter chegado (ou não).
 *
 * O caso que exige texto, e não só um ícone, é `queued`. Hoje toda mensagem que
 * sai daqui fica ali: o worker que entrega existe e fala com a Cloud API
 * oficial, mas não tem número nem token da Meta para usar. Um relógio cinza sem
 * legenda deixaria a Heloísa achando que a mensagem saiu — e ela vai continuar
 * na fila, do mesmo jeito, no dia em que o worker estiver de pé e o número
 * suprimido do outro lado. O aviso do topo da tela é que conta QUANTO falta;
 * aqui só é preciso não mentir.
 */
export function entregaDaMensagem(m: MensagemDoFio): Entrega {
  if (m.entrada) {
    return { rotulo: m.status === 'read' ? 'lida por você' : 'recebida', detalhe: null, tom: 'normal' };
  }
  switch (m.status) {
    case 'queued':
      return {
        rotulo: ROTULO_ENTREGA.queued,
        detalhe: 'ainda não saiu: espera o worker de envio e o número na Meta',
        tom: 'espera',
      };
    case 'failed':
      return {
        rotulo: ROTULO_ENTREGA.failed,
        detalhe: m.erroDetalhe ?? m.erroCodigo,
        tom: 'falha',
      };
    case 'sent':
      return { rotulo: ROTULO_ENTREGA.sent, detalhe: null, tom: 'normal' };
    case 'delivered':
      return { rotulo: ROTULO_ENTREGA.delivered, detalhe: null, tom: 'normal' };
    case 'read':
      return { rotulo: ROTULO_ENTREGA.read, detalhe: null, tom: 'normal' };
    default:
      return { rotulo: ROTULO_ENTREGA[m.status], detalhe: null, tom: 'normal' };
  }
}

/** Ordem de progresso da entrega, para o desenho de "quantos passos já andou". */
export const PASSOS_DA_ENTREGA: readonly MsgStatus[] = ['queued', 'sent', 'delivered', 'read'];

// ---------------------------------------------------------------------------
// As 25 intenções do R08, em português
// ---------------------------------------------------------------------------

/**
 * O rótulo humano de cada intenção.
 *
 * `Record<Intencao, string>` de propósito: se `packages/prompts` ganhar uma 26ª
 * intenção, o `typecheck` quebra aqui até alguém escrever a frase. É o oposto de
 * um `switch` com `default: 'Outro'`, que continuaria verde escondendo o código
 * cru na cara de quem está na rua.
 */
export const ROTULO_INTENCAO: Record<Intencao, string> = {
  INTERESSADO: 'demonstrou interesse',
  AUTORIZA_PRE_CADASTRO: 'autorizou o pré-cadastro',
  QUER_SABER_MAIS: 'quer entender melhor',
  PEDIU_TAXA_PRECO: 'perguntou a taxa',
  JA_USO_OUTRO: 'já usa outro canal',
  NAO_TRABALHO_COM_COMISSAO: 'não trabalha com comissão',
  MANDA_MATERIAL: 'pediu material por escrito',
  ME_CHAMA_DEPOIS: 'pediu para falar depois',
  SEM_INTERESSE_SUAVE: 'não tem interesse agora',
  SEM_INTERESSE_FIRME: 'não tem interesse',
  NAO_E_A_PESSOA: 'não é a pessoa certa',
  QUEM_E_VOCE: 'perguntou quem somos',
  E_ROBO: 'perguntou se é robô',
  OPT_OUT: 'pediu para não receber mais',
  HOSTIL: 'reclamou',
  AGENDAMENTO_ACEITO: 'aceitou o horário',
  AGENDAMENTO_CONTRAPROPOSTA: 'propôs outro horário',
  REAGENDAR: 'quer remarcar',
  PEDIU_LIGACAO: 'pediu uma ligação',
  INDICACAO: 'indicou outra pessoa',
  JA_CADASTRADO: 'já se cadastrou',
  PERGUNTA_CONTRATUAL: 'perguntou algo contratual',
  FORA_ESCOPO: 'assunto fora do escopo',
  AMBIGUO: 'mensagem ambígua',
  SILENCIO: 'sem resposta',
};

/** R08 §5.2: quem responde esta intenção. */
export const ROTULO_RESPONDE: Record<Responde, string> = {
  texto_fixo: 'resposta de texto fixo',
  ia: 'rascunho da IA',
  humano: 'uma pessoa responde',
  cadencia: 'o próximo toque da cadência',
};

const POR_INTENCAO = new Map(FICHAS.map((f) => [f.intencao as string, f]));

/**
 * A ficha da intenção que o banco guardou em `conversations.ai_intent`.
 *
 * Devolve `null` quando o texto não é uma das 25 — e é `null` mesmo, não uma
 * ficha inventada: se um dia o classificador gravar um rótulo que este pacote
 * não conhece, a tela precisa dizer "não reconheci", não fingir que entendeu.
 */
export function fichaDaIntencao(bruto: string | null): FichaDaIntencao | null {
  if (!bruto) return null;
  return POR_INTENCAO.get(bruto) ?? null;
}

/**
 * Confiança abaixo disto e a tela avisa: o R08 §5.3 manda escalar para humano
 * com confiança < 0,7 em duas mensagens seguidas. Quem aprova precisa ver o
 * primeiro caso, não o segundo.
 */
export const CONFIANCA_BAIXA = 0.7;

// ---------------------------------------------------------------------------
// O validador de promessas (RF-CON-24)
// ---------------------------------------------------------------------------

/** Cada código do validador, dito para quem vai decidir se manda mesmo assim. */
export const ROTULO_BLOQUEIO: Record<CodigoDeBloqueio, string> = {
  valor_nao_autorizado: 'número, preço ou prazo fora da base',
  palavra_proibida: 'palavra proibida no tom de voz',
  url_fora_da_lista: 'link fora da lista permitida',
  claim_sem_base: 'afirmação sem fato na base de conhecimento',
  financeiro_sem_resposta: 'dúvida de dinheiro fora da FAQ aprovada',
  tamanho: 'passou do tamanho combinado',
  emoji_demais: 'emoji demais',
  caixa_alta: 'caixa alta',
};

const motivoSchema = z.object({
  codigo: z.string(),
  trecho: z.string().default(''),
  explicacao: z.string().default(''),
});

const vereditoSchema = z.union([
  z.object({ situacao: z.literal('aprovado') }),
  z.object({
    situacao: z.literal('substituido'),
    motivos: z.array(motivoSchema).default([]),
  }),
  z.object({
    situacao: z.literal('bloqueado'),
    motivos: z.array(motivoSchema).default([]),
    queda: z.enum(['texto_fixo', 'humano']).nullable().default(null),
  }),
]);

/**
 * Lê `message_drafts.validator` — o veredito como ele saiu de `packages/prompts`.
 *
 * Falha para `sem_registro`, e não para `aprovado`. É a diferença entre "o
 * guardrail rodou e passou" e "ninguém sabe se o guardrail rodou": a segunda
 * merece um aviso na tela, e tratá-la como aprovação seria inventar uma garantia
 * que não existe.
 */
export function lerValidador(valor: Json): VereditoDoValidador {
  const lido = vereditoSchema.safeParse(valor);
  if (!lido.success) return { situacao: 'sem_registro', motivos: [], queda: null };
  const v = lido.data;
  if (v.situacao === 'aprovado') return { situacao: 'aprovado', motivos: [], queda: null };
  if (v.situacao === 'substituido') {
    return { situacao: 'substituido', motivos: v.motivos, queda: null };
  }
  return { situacao: 'bloqueado', motivos: v.motivos, queda: v.queda };
}

/** O validador apitou? É a pergunta que decide se a tela mostra o bloco de aviso. */
export function validadorApitou(v: VereditoDoValidador): boolean {
  return v.situacao === 'bloqueado' || v.situacao === 'substituido' || v.situacao === 'sem_registro';
}

// ---------------------------------------------------------------------------
// Das linhas cruas para o que a tela usa
// ---------------------------------------------------------------------------

const ORIGENS: readonly string[] = ['crm', 'echo', 'import'];
const TIPOS_DE_RASCUNHO: readonly string[] = [
  'followup_ligacao',
  'resposta',
  'objecao',
  'onboarding',
  'reativacao',
  'outro',
];
const ESTADOS_DE_RASCUNHO: readonly string[] = [
  'pendente',
  'aprovado',
  'enviado',
  'descartado',
  'expirado',
];
const ESTADOS_DE_FIO: readonly string[] = [
  'aguardando_nos',
  'aguardando_parceiro',
  'robo',
  'resolvida',
];
const TIPOS_DE_MENSAGEM: readonly string[] = [
  'text',
  'audio',
  'image',
  'video',
  'document',
  'template',
  'interactive',
  'reaction',
  'system',
];
const ESTADOS_DE_ENTREGA: readonly string[] = [
  'queued',
  'sent',
  'delivered',
  'read',
  'failed',
  'received',
];
const AUTORES: readonly string[] = ['human', 'bot_fixed', 'bot_ai', 'system'];
const CANAIS: readonly string[] = ['whatsapp', 'instagram', 'email', 'phone', 'presencial', 'other'];

export function montarMensagens(
  cruas: MensagemCrua[],
  nomeDaPessoa: Map<string, string>,
): MensagemDoFio[] {
  return cruas
    .map((m): MensagemDoFio => {
      const entrada = m.direction === 'in';
      return {
        id: m.id,
        fioId: m.conversation_id,
        // A mensagem que saiu vale pela hora em que saiu; a que ainda está na
        // fila só tem a hora em que entrou nela, e é essa que a linha usa.
        em: (entrada ? m.created_at : (m.sent_at ?? m.created_at)) || m.created_at,
        entrada,
        tipo: TIPOS_DE_MENSAGEM.includes(m.type) ? (m.type as MensagemDoFio['tipo']) : 'system',
        status: ESTADOS_DE_ENTREGA.includes(m.status)
          ? (m.status as MensagemDoFio['status'])
          : 'queued',
        texto: m.body?.trim() || null,
        midiaCaminho: m.media_path,
        midiaTipo: m.media_mime,
        transcricao: m.transcript?.trim() || null,
        autorTipo: AUTORES.includes(m.author_kind)
          ? (m.author_kind as MensagemDoFio['autorTipo'])
          : 'system',
        autor: m.sent_by ? (nomeDaPessoa.get(m.sent_by) ?? null) : null,
        aprovadoPor: m.approved_by ? (nomeDaPessoa.get(m.approved_by) ?? null) : null,
        origem: (ORIGENS.includes(m.origin) ? m.origin : 'crm') as OrigemDaMensagem,
        iniciadaPelaEmpresa: m.business_initiated,
        primeiroContato: m.is_first_contact,
        confirmacaoDeOptout: m.optout_confirmation,
        porModelo: m.template_id !== null || m.type === 'template',
        erroCodigo: m.error_code,
        erroDetalhe: m.error_detail?.trim() || null,
        enviadaEm: m.sent_at,
        entregueEm: m.delivered_at,
        lidaEm: m.read_at,
        falhouEm: m.failed_at,
      };
    })
    .sort((a, b) => a.em.localeCompare(b.em) || a.id.localeCompare(b.id));
}

export function montarFio(cru: FioCru, nomeDaPessoa: Map<string, string>): FioDaConversa {
  return {
    id: cru.id,
    organizacaoId: cru.organization_id,
    canal: (CANAIS.includes(cru.channel) ? cru.channel : 'whatsapp') as FioDaConversa['canal'],
    telefoneParceiro: cru.peer_phone_e164,
    numeroDaEmpresa: cru.business_number,
    responsavelId: cru.assignee_id,
    responsavel: nomeDaPessoa.get(cru.assignee_id) ?? null,
    estado: (ESTADOS_DE_FIO.includes(cru.status)
      ? cru.status
      : 'aguardando_nos') as FioDaConversa['estado'],
    roboPausado: cru.bot_paused,
    naoLidas: cru.unread_count,
    ultimaEm: cru.last_message_at,
    ultimaEntradaEm: cru.last_inbound_at,
    janelaExpiraEm: cru.window_expires_at,
    intencao: cru.ai_intent,
    confianca: cru.ai_confidence,
    resumo: cru.ai_summary?.trim() || null,
  };
}

const afirmacoesSchema = z.array(z.string()).catch([]);

export function montarRascunho(cru: RascunhoCru): RascunhoDaIa {
  return {
    id: cru.id,
    organizacaoId: cru.organization_id,
    fioId: cru.conversation_id,
    tipo: (TIPOS_DE_RASCUNHO.includes(cru.kind) ? cru.kind : 'outro') as TipoDeRascunho,
    estado: (ESTADOS_DE_RASCUNHO.includes(cru.status)
      ? cru.status
      : 'pendente') as EstadoDoRascunho,
    proposto: cru.proposed_body,
    final: cru.final_body,
    foiEditado: cru.foi_editado ?? false,
    afirmacoes: afirmacoesSchema.parse(cru.proposed_claims),
    validador: lerValidador(cru.validator),
    promptVersao: cru.prompt_version,
    criadoEm: cru.created_at,
    expiraEm: cru.expires_at,
    revisadoPor: cru.reviewed_by,
    revisadoEm: cru.reviewed_at,
    motivoDoDescarte: cru.discard_reason,
  };
}

/**
 * A ordem da fila de aprovação: quem expira primeiro aparece primeiro.
 *
 * Não é a ordem de chegada. Um rascunho vive três dias (`expires_at`), e o que
 * está para vencer hoje à noite é o que some sozinho se ninguém olhar — que é
 * exatamente o modo pelo qual uma fila de aprovação deixa de existir na prática.
 */
export function ordenarFila(rascunhos: RascunhoDaIa[]): RascunhoDaIa[] {
  return [...rascunhos].sort(
    (a, b) => a.expiraEm.localeCompare(b.expiraEm) || a.criadoEm.localeCompare(b.criadoEm),
  );
}

// ---------------------------------------------------------------------------
// As recusas do envio, traduzidas
// ---------------------------------------------------------------------------

/**
 * Por que a recusa do envio chega por EXCEÇÃO, e não por `{ok:false}`.
 *
 * Não existe RPC de envio: a tela insere em `messages` e quem decide é o gatilho
 * `app.messages_guard`, que levanta exceção com o motivo dentro do texto
 * ("Envio recusado: teto_do_numero (RF-CON-10, RF-CON-11, RF-CON-18)"). São os
 * mesmos motivos que `app.pode_enviar` devolve, e é por eles que a frase é
 * escolhida — nunca pelo texto cru do Postgres, que fala de trigger e de RF.
 *
 * Esta tabela é um CONTRATO com o banco, e um contrato que ninguém compila:
 * se um motivo for renomeado lá, aqui ninguém quebra, só some a frase e a
 * pessoa vê "não deu para falar com o servidor". Por isso os `mensagens.test.ts`
 * guardam as duas frases exatas que o gatilho levantou de verdade.
 */
export const MOTIVOS_DE_RECUSA_DO_ENVIO: Record<string, string> = {
  contato_suprimido: 'Este parceiro pediu para não receber mais mensagens. Nada sai para ele.',
  numero_suprimido: 'Este número está na lista de supressão. Nada sai para ele.',
  contato_apagado: 'Esta pessoa foi apagada da base. Nada sai para ela.',
  organizacao_apagada: 'Esta ficha foi apagada da base. Nada sai para ela.',
  sem_janela_e_sem_template:
    'A janela de 24 h fechou. Fora dela só sai modelo aprovado pela Meta, não texto livre.',
  teto_do_numero: 'O teto de primeiros contatos do dia acabou neste número. Amanhã abre de novo.',
  teto_iniciadas_dia: 'O número já mandou o máximo de mensagens do dia.',
  teto_iniciadas_hora: 'O número já mandou o máximo da hora. Tente daqui a pouco.',
  janela_fora_de_hora: 'Fora do horário de envio combinado (RF-CON-11).',
  janela_domingo: 'Domingo não sai mensagem.',
  janela_feriado: 'Feriado não sai mensagem.',
  janela_antes_da_abertura: 'Ainda não abriu o horário de envio de hoje.',
  janela_canal_sem_janela: 'Este canal não tem janela de envio configurada.',
  conversa_inexistente: 'Esta conversa não existe mais. Recarregue a página.',
};

/**
 * O motivo, extraído do texto da exceção — e procurado por igualdade, não por
 * "contém".
 *
 * Os três lugares onde o banco recusa escrevem o motivo depois de dois-pontos:
 *   `Envio recusado: teto_do_numero (RF-CON-10, ...)`      — messages_guard, insert
 *   `Entrega recusada na saída: contato_suprimido — ...`   — messages_guard, update
 *   `Rascunho recusado na origem: numero_suprimido (...)`  — message_drafts_guard
 *
 * Uma varredura por substring funcionaria hoje, porque nenhum motivo é pedaço
 * de outro. Mas "funciona porque a tabela ainda não tem duas entradas parecidas"
 * é o tipo de coisa que deixa de ser verdade num commit de outra pessoa, e o
 * defeito seria a frase errada na tela — silencioso. Capturar o token e comparar
 * por igualdade não tem esse jeito de quebrar.
 */
export function fraseDaRecusaDoEnvio(texto: string): string | null {
  const achado = /recusad[oa][^:]*:\s*([a-z_]+)/.exec(texto);
  const motivo = achado?.[1];
  if (!motivo) return null;
  return MOTIVOS_DE_RECUSA_DO_ENVIO[motivo] ?? null;
}
