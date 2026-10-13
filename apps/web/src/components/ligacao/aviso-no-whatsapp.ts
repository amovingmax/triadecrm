import { z } from 'zod';

import type { ResultadoTecnico } from './tipos';

/**
 * O aviso no WhatsApp para quem não atendeu (migração 20261013090000).
 *
 * Quem põe o aviso na fila é o BANCO, no gatilho da tabulação: esta tela só conta
 * o que aconteceu e oferece o "Não avisar". Por isso aqui não há regra de quem
 * recebe — há a frase de cada situação, para o recibo não prometer um aviso que
 * não vai sair nem esconder um que vai.
 */

export const RPC_AVISO_SITUACAO = 'aviso_ligacao_situacao' as const;
export const RPC_AVISO_CANCELAR = 'aviso_ligacao_cancelar' as const;

/** Os resultados da linha que pedem aviso: os mesmos de `app.aviso_ligacao_pede`. */
export const RESULTADOS_COM_AVISO = [
  'nao_atendeu',
  'caixa_postal',
  'ocupado',
] as const satisfies readonly ResultadoTecnico[];

export function resultadoPedeAviso(resultado: ResultadoTecnico): boolean {
  return (RESULTADOS_COM_AVISO as readonly ResultadoTecnico[]).includes(resultado);
}

export const situacaoDoAvisoSchema = z.object({
  ok: z.literal(true),
  situacao: z.enum(['pendente', 'enviada', 'pulada', 'cancelada', 'sem_aviso']),
  motivo: z.string().nullable().optional(),
  /** O texto que sai (ou saiu). Antes do envio, o do período de agora. */
  texto: z.string().nullable().optional(),
  /** A entrega da mensagem no WhatsApp, quando ela já existe (`app.msg_status`). */
  entrega: z
    .enum(['queued', 'sent', 'delivered', 'read', 'failed', 'received'])
    .nullable()
    .optional(),
  enviada_em: z.string().nullable().optional(),
  organization_id: z.string().nullable().optional(),
});
export type SituacaoDoAviso = z.infer<typeof situacaoDoAvisoSchema>;

/**
 * O tom do cartão, no vocabulário da casa: `destaque` é a menta (faixa, disco e
 * selo, como o cartão "Nova mensagem"); `falha` é o vermelho de erro; `neutro` é o
 * cinza de quem não precisa agir.
 */
export type TomDoAviso = 'destaque' | 'falha' | 'neutro';

export type EstadoDoAviso = {
  tom: TomDoAviso;
  /** O selo em maiúsculas ao lado do título: em que pé está. */
  selo: string;
  titulo: string;
  detalhe: string;
  /** Mostra a prévia da mensagem no balão de saída. */
  balao: boolean;
  /** Ainda dá para tirar da fila. */
  podeCancelar: boolean;
  /** A mensagem existe e pode ser vista na conversa. */
  naConversa: boolean;
  /** Ainda vai mudar: a tela pergunta de novo. */
  andando: boolean;
};

/** Por que o aviso não saiu, dito para quem acabou de ligar. */
const POR_QUE_NAO: Record<string, string> = {
  modelo_aguardando_meta: 'A mensagem ainda espera a aprovação da Meta.',
  mensagem_recente_sem_resposta: 'Já mandamos mensagem nas últimas 72 h e a pessoa não respondeu.',
  ja_na_fila: 'Já tem um aviso na fila para esta pessoa, de outra ligação.',
  ja_avisado_hoje: 'Esta pessoa já foi avisada hoje.',
  nao_contatar: 'A pessoa pediu para não ser contatada.',
  ficha_sem_whatsapp: 'A ficha não tem número de WhatsApp.',
  sem_whatsapp: 'A ficha não tem número de WhatsApp.',
  aviso_pausado: 'Os avisos estão pausados em Envios.',
  whatsapp_nao_configurado: 'O número de WhatsApp da Komune não está configurado.',
};

/** A entrega no WhatsApp, no selo: o mesmo vocabulário da tela de Conversas. */
const SELO_DA_ENTREGA: Record<string, string> = {
  queued: 'Enviando',
  sent: 'Enviado',
  delivered: 'Entregue',
  read: 'Lido',
};

/**
 * O cartão do aviso no recibo da ligação. Nulo quando não há nada a dizer: chave
 * desligada, ligação atendida, ligação antiga — situações em que ninguém esperava
 * aviso.
 */
export function estadoDoAviso(
  s: SituacaoDoAviso,
  saiuAs: string | null = null,
): EstadoDoAviso | null {
  const base = { balao: false, podeCancelar: false, naConversa: false, andando: false };
  switch (s.situacao) {
    case 'pendente':
      return {
        ...base,
        tom: 'destaque',
        selo: 'Na fila',
        titulo: 'Aviso no WhatsApp a caminho',
        detalhe: 'Sai pelo número da Komune no horário do WhatsApp (seg a sex, 8h às 17h45).',
        balao: true,
        podeCancelar: true,
        andando: true,
      };
    case 'enviada':
      if (s.entrega === 'failed') {
        return {
          ...base,
          tom: 'falha',
          selo: 'Não saiu',
          titulo: 'O aviso no WhatsApp não saiu',
          detalhe: 'O WhatsApp recusou o envio. O motivo está na conversa.',
          naConversa: true,
        };
      }
      return {
        ...base,
        tom: 'destaque',
        selo: SELO_DA_ENTREGA[s.entrega ?? 'queued'] ?? 'Enviado',
        titulo: 'Aviso enviado no WhatsApp',
        detalhe:
          s.entrega === 'queued' || !s.entrega
            ? 'Saindo agora pelo número da Komune.'
            : `Saiu pelo número da Komune${saiuAs ? ` às ${saiuAs}` : ''}. Já está na conversa.`,
        balao: true,
        naConversa: true,
        andando: s.entrega !== 'read',
      };
    case 'cancelada':
      return {
        ...base,
        tom: 'neutro',
        selo: 'Cancelado',
        titulo: 'Aviso cancelado',
        detalhe:
          s.motivo === 'aviso_vencido'
            ? 'Esperou mais de 3 dias na fila e não saiu.'
            : 'Nada vai para o WhatsApp.',
      };
    case 'pulada':
      return {
        ...base,
        tom: 'neutro',
        selo: 'Não enviado',
        titulo: 'O aviso no WhatsApp não saiu',
        detalhe: (s.motivo && POR_QUE_NAO[s.motivo]) || 'A regra de envio do WhatsApp não deixou.',
      };
    case 'sem_aviso': {
      const detalhe = s.motivo ? POR_QUE_NAO[s.motivo] : undefined;
      return detalhe
        ? { ...base, tom: 'neutro', selo: 'Sem aviso', titulo: 'Sem aviso no WhatsApp', detalhe }
        : null;
    }
  }
}
