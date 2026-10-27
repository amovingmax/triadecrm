import type { Json, MsgDirection, MsgStatus, MsgType } from '@komune/schema';

/**
 * Os grupos de WhatsApp do CRM (27/10/2026; migração `20261027110000`, §8).
 *
 * Moram fora de `conversations` e `messages` de propósito (o fio 1:1 tem
 * telefone, opt-out, funil e janela por pessoa; o grupo não tem nada disso), e
 * por isso a tela também mora fora de `components/conversas`: aqui é a aba
 * "Grupos" de Conversas, com lista, fio e painel próprios.
 *
 * O que a Meta deixa (API de grupos, só para conta oficial, a OBA):
 *   * até 8 pessoas, contando o número da empresa;
 *   * ninguém é posto dentro: entra quem toca no link de convite (e, com a
 *     aprovação ligada, quem o time aprovar); quem é tirado não volta pelo link;
 *   * mensagem livre só nas 24 h depois que alguém do grupo escreveu;
 *   * texto, foto, vídeo, áudio e documento (nada de botão, lista, localização);
 *   * até 3 mensagens fixadas, de 1 a 30 dias.
 *
 * Tudo o que mexe no WhatsApp vira um pedido em `wa_acoes`, que o worker-wa faz
 * na próxima volta (5 s parado). A tela lê o pedido para dizer "esperando a
 * Meta…" e, quando a Meta recusa, o porquê.
 */

export type EstadoDoGrupo = 'criando' | 'ativo' | 'suspenso' | 'apagado' | 'falhou';
export type Aprovacao = 'auto_approve' | 'approval_required';

export interface GrupoCru {
  id: string;
  assunto: string;
  descricao: string | null;
  aprovacao: Aprovacao;
  link_convite: string | null;
  foto_path: string | null;
  estado: EstadoDoGrupo;
  erro: string | null;
  participantes_total: number | null;
  last_message_at: string | null;
  last_inbound_at: string | null;
  unread_count: number;
  criado_em: string;
  apagado_em: string | null;
  organization_id: string | null;
}

export const COLUNAS_DO_GRUPO =
  'id, assunto, descricao, aprovacao, link_convite, foto_path, estado, erro, participantes_total, last_message_at, last_inbound_at, unread_count, criado_em, apagado_em, organization_id';

export interface MensagemDoGrupoCrua {
  id: string;
  grupo_id: string;
  direction: MsgDirection;
  type: MsgType;
  tipo_na_meta: string | null;
  status: MsgStatus;
  wa_message_id: string | null;
  de_wa_id: string | null;
  de_nome: string | null;
  sent_by: string | null;
  body: string | null;
  media_path: string | null;
  media_mime: string | null;
  media_nome: string | null;
  conteudo: Json | null;
  responde_a: string | null;
  reage_a: string | null;
  error_code: string | null;
  error_detail: string | null;
  created_at: string;
  apagada_em: string | null;
  fixada_ate: string | null;
}

export const COLUNAS_DA_MENSAGEM =
  'id, grupo_id, direction, type, tipo_na_meta, status, wa_message_id, de_wa_id, de_nome, sent_by, body, media_path, media_mime, media_nome, conteudo, responde_a, reage_a, error_code, error_detail, created_at, apagada_em, fixada_ate';

export interface ParticipanteCru {
  wa_id: string;
  nome: string | null;
  entrou_em: string | null;
  saiu_em: string | null;
}

export interface PedidoCru {
  pedido_id: string;
  wa_id: string | null;
  criado_em: string;
  decisao: string | null;
}

export interface AcaoCrua {
  id: number;
  tipo: string;
  estado: 'pendente' | 'fazendo' | 'feita' | 'falhou' | 'descartada';
  erro: string | null;
  pedida_em: string;
  feita_em: string | null;
}

/** Uma conversa 1:1 para onde o convite pode ir. */
export interface ConversaParaConvite {
  id: string;
  peer_nome: string | null;
  peer_phone_e164: string;
  last_inbound_at: string | null;
  window_expires_at: string | null;
}

/** Os tetos da Meta para grupo. */
export const TETO_DE_PESSOAS = 8;
export const TETO_DE_FIXADAS = 3;
export const DIAS_PARA_FIXAR = [1, 7, 30] as const;
export const TETO_DO_NOME = 128;
export const TETO_DA_DESCRICAO = 2048;
export const TETO_DO_TEXTO = 4096;

/** A pessoa do time, para dizer quem mandou o que saiu daqui. */
export type PessoaDoTime = { id: string; nome: string };
