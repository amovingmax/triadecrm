/**
 * A passada de recuperação das mídias (02/10/2026).
 *
 * A URL de uma mídia da Meta vale minutos — por isso o worker baixa na chegada
 * (`entrada.ts`). Mas até esta data ele só baixava ÁUDIO, e tudo o que chegou
 * enquanto ele estava parado também ficou sem arquivo. O `media_id` continua
 * servindo para pedir uma URL nova enquanto a Meta guarda o arquivo (até 30
 * dias), e é isso que esta passada faz: pega no banco as mídias recebidas sem
 * arquivo (`wa_midias_sem_arquivo`), baixa, guarda no balde e registra. A que
 * não der fica anotada (`wa_midia_falhou`); na terceira falha ela sai da fila,
 * para uma mídia que a Meta já apagou não ocupar o lugar das outras.
 *
 * Não manda nada para ninguém e não pede transcrição: o áudio recuperado só
 * ganha o arquivo para o player. Quem transcreve é o caminho da chegada.
 */
import { guardarMidia, type ContextoDaEntrada } from './entrada';
import { lerMidiasSemArquivo, registrarFalhaDeMidia, registrarMidia } from './ponte';

export interface ResumoDaRecuperacao {
  vistas: number;
  baixadas: number;
  falhas: number;
}

/** Quantas mídias por passada: a passada roda dentro da volta do worker. */
export const LOTE_DA_RECUPERACAO = 10;

export async function recuperarMidias(
  ctx: ContextoDaEntrada,
  limite: number = LOTE_DA_RECUPERACAO,
): Promise<ResumoDaRecuperacao> {
  const resumo: ResumoDaRecuperacao = { vistas: 0, baixadas: 0, falhas: 0 };
  // Sem balde configurado não há onde guardar: nem pergunta ao banco.
  if (ctx.balde === '') return resumo;

  const pendentes = await lerMidiasSemArquivo(ctx.cliente, limite);
  for (const midia of pendentes) {
    resumo.vistas += 1;
    const caminho = await guardarMidia(ctx, {
      mediaId: midia.mediaId,
      messageId: midia.messageId,
      conversationId: midia.conversationId,
    });
    if (caminho !== null) {
      await registrarMidia(ctx.cliente, midia.messageId, caminho);
      resumo.baixadas += 1;
    } else {
      await registrarFalhaDeMidia(ctx.cliente, midia.messageId, 'nao_baixou');
      resumo.falhas += 1;
    }
  }
  if (resumo.vistas > 0) {
    ctx.logger.info('recuperação de mídias', { ...resumo });
  }
  return resumo;
}
