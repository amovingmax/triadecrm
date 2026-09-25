/**
 * Uma passada na fila `reuniao_avisos` (ADR-15).
 *
 * Roda no worker-wa, e não num worker novo: é nele que já vivem a chave do
 * Resend e o laço que lê fila. Segundo worker para mandar um e-mail seria
 * infraestrutura nova para um problema que não existe.
 *
 * SE O E-MAIL FALHAR, A REUNIÃO FICA MARCADA. Sem discussão: ela já foi gravada
 * e confirmada ao parceiro antes de o Resend entrar na história. O que acontece
 * é a mensagem voltar para a fila com backoff, tentar cinco vezes e cair em
 * `reuniao_avisos_dlq` — e, como fila silenciosa também é falha silenciosa,
 * `reunioes.aviso_enviado_em` continua nulo e o cartão na Agenda diz que
 * ninguém foi avisado.
 *
 * E "aviso desligado" NÃO é falha. Com `notificacoes.email.ativo = false`, ou
 * numa máquina sem `RESEND_API_KEY` configurada e sem destinatário, a mensagem
 * é ARQUIVADA: fila que arquiva o que não tinha para onde ir é fila; fila que
 * manda isso para a dead-letter é alarme que ninguém mais lê.
 */

import { avisarDaReuniao } from './aviso-de-reuniao';
import type { ConfiguracaoDoAviso } from './aviso-por-email';
import {
  concluirAvisoDeReuniao,
  falharAvisoDeReuniao,
  lerConfigDoAviso,
  marcarAvisoDeReuniaoEnviado,
  proximosAvisosDeReuniao,
  type ClienteDoBanco,
} from './ponte';
import type { Logger } from '../lib/log';

/** Quantos avisos por volta. O aviso não tem SLA de segundos. */
const LOTE = 5;

export async function avisarDasReunioes(
  cliente: ClienteDoBanco,
  chaveDoResend: string | undefined,
  logger: Logger,
  buscar: typeof fetch = fetch,
): Promise<number> {
  let tratados = 0;
  try {
    const avisos = await proximosAvisosDeReuniao(cliente, LOTE);
    if (avisos.length === 0) return 0;

    const crua = await lerConfigDoAviso(cliente);
    const config: ConfiguracaoDoAviso = {
      ativo: crua.ativo,
      para: crua.para,
      de: crua.de,
      responderPara: crua.responder_para,
      urlDoCrm: crua.url_do_crm,
    };

    for (const aviso of avisos) {
      const r = await avisarDaReuniao(aviso, config, chaveDoResend, logger, buscar);
      tratados += 1;

      if (r.ok) {
        // A marca vem ANTES do arquivamento: se o processo morrer no meio, a
        // mensagem volta e é reenviada — um e-mail a mais é barato, um
        // compromisso que ninguém sabe que existe não é.
        await marcarAvisoDeReuniaoEnviado(cliente, aviso.reuniaoId);
        await concluirAvisoDeReuniao(cliente, aviso.msgId, aviso.chave);
        continue;
      }

      if (r.motivo === 'desligado') {
        await concluirAvisoDeReuniao(cliente, aviso.msgId, aviso.chave);
        continue;
      }

      await falharAvisoDeReuniao(
        cliente,
        aviso.msgId,
        aviso.chave,
        `aviso de reunião: ${r.motivo}${r.transitorio ? ' (transitório)' : ''}`,
      );
    }
  } catch (erro) {
    // Esta fila não derruba o laço do worker: o que ela carrega é aviso, e a
    // reunião já está gravada.
    logger.error('não deu para tratar a fila de avisos de reunião', {
      erro: (erro as Error).message,
    });
  }
  return tratados;
}
