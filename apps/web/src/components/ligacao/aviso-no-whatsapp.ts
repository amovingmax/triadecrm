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
});
export type SituacaoDoAviso = z.infer<typeof situacaoDoAvisoSchema>;

export type FraseDoAviso = {
  texto: string;
  /** Ainda dá para tirar da fila. */
  podeCancelar: boolean;
};

/** Por que o aviso não entrou na fila, dito para quem acabou de ligar. */
const SEM_AVISO: Record<string, string> = {
  modelo_aguardando_meta: 'Sem aviso no WhatsApp: a mensagem ainda espera a aprovação da Meta.',
  mensagem_recente_sem_resposta:
    'Sem aviso no WhatsApp: já mandamos mensagem nas últimas 72 h e a pessoa não respondeu.',
  ja_na_fila: 'O aviso no WhatsApp já está na fila, por outra ligação.',
  ja_avisado_hoje: 'Esta pessoa já foi avisada hoje no WhatsApp.',
  nao_contatar: 'Sem aviso no WhatsApp: a pessoa pediu para não ser contatada.',
  sem_whatsapp: 'Sem aviso no WhatsApp: a ficha não tem número de WhatsApp.',
  aviso_pausado: 'Sem aviso no WhatsApp: os avisos estão pausados em Envios.',
  whatsapp_nao_configurado: 'Sem aviso no WhatsApp: o número da Komune não está configurado.',
};

/**
 * A frase do recibo. Nulo quando não há nada a dizer: chave desligada, ligação
 * atendida, ligação antiga — situações em que ninguém esperava aviso.
 */
export function fraseDoAviso(s: SituacaoDoAviso): FraseDoAviso | null {
  switch (s.situacao) {
    case 'pendente':
      // Sem a saudação: ela é a da hora do ENVIO, e ligação perdida às 18h é avisada
      // às 8h do dia seguinte, com "Bom dia".
      return {
        texto:
          'Aviso no WhatsApp na fila: "Tentamos entrar em contato com você por telefone…". Sai no horário do WhatsApp.',
        podeCancelar: true,
      };
    case 'enviada':
      return { texto: 'Aviso enviado no WhatsApp.', podeCancelar: false };
    case 'cancelada':
      return s.motivo === 'aviso_vencido'
        ? { texto: 'O aviso esperou demais e foi cancelado.', podeCancelar: false }
        : { texto: 'Aviso cancelado: nada vai para o WhatsApp.', podeCancelar: false };
    case 'pulada':
      return {
        texto:
          s.motivo && SEM_AVISO[s.motivo] ? SEM_AVISO[s.motivo]! : 'O aviso no WhatsApp não saiu.',
        podeCancelar: false,
      };
    case 'sem_aviso': {
      const texto = s.motivo ? SEM_AVISO[s.motivo] : undefined;
      return texto ? { texto, podeCancelar: false } : null;
    }
  }
}
