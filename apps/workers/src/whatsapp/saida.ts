/**
 * O ENVIO (RF-CON-05, RF-CON-10, RF-CON-11, RF-CON-22; ADR-05, ADR-06).
 *
 * "ENVIA o que a pessoa aprovou — nunca o que a IA escreveu sozinha."
 *
 * Este arquivo NÃO decide se pode enviar. Quem decide é o banco, e decide duas
 * vezes: o gatilho `app.messages_guard` recusa a linha que não podia existir, e
 * `public.wa_saida_proximos` reconfere tudo de novo no instante da entrega —
 * supressão, janela de 24 h, janela de horário, teto do número, teto de volume
 * e, agora, se o template está aprovado pela Meta. O worker recebe o que já
 * passou por tudo isso.
 *
 * A garantia do ADR-05 não é deste arquivo e não podia ser: se ela fosse um
 * `if` aqui, bastaria um `curl` com a chave de serviço para contorná-la. Ela é
 * o gatilho de `messages`, que exige `draft_id` apontando para um rascunho em
 * `aprovado`, com `reviewed_by` preenchido, e com o corpo IGUAL ao
 * `final_body` que a pessoa aprovou. O worker não tem como enviar outra coisa:
 * o que ele lê da fila é o que já está na linha.
 *
 * O QUE ESTE ARQUIVO DECIDE
 * ---------------------------------------------------------------------------
 * Só a FORMA do envio: texto livre dentro da janela, template aprovado fora
 * dela. E o que fazer com o erro que voltar — `graph.ts` classifica, e a
 * resposta é `app.wa_sucesso` ou `app.wa_falha` (backoff e dead-letter).
 *
 * A CADÊNCIA HUMANA (R04 §4: intervalo aleatório de 45–180 s) é aplicada
 * entre envios INICIADOS PELA EMPRESA. Resposta dentro da janela sai na hora:
 * o R08 §0.1 mede que responder em ≤ 5 min multiplica a conversão por 9, e
 * esperar 45 segundos para responder quem acabou de escrever não imita gente —
 * atrasa gente.
 */
import {
  envioDeuCerto,
  envioFalhou,
  envioFalhouDeVez,
  esperaEntreEnvios,
  proximosEnvios,
} from './ponte';

import type { ClienteDaGraph, Envio } from './graph';
import type { ClienteDoBanco, ConfigDeEnvio, ItemDeSaida } from './ponte';
import type { Logger } from '../lib/log';

export interface ContextoDaSaida {
  cliente: ClienteDoBanco;
  graph: ClienteDaGraph;
  logger: Logger;
  config: ConfigDeEnvio;
  /** Substituível no teste: o intervalo entre envios iniciados pela empresa. */
  dormir?: (ms: number) => Promise<void>;
  /** Substituível no teste: o sorteio do intervalo. */
  sorteio?: () => number;
}

export interface ContagensDaSaida {
  enviados: number;
  falhados: number;
  reagendados: number;
  adiados: number;
  mortos: number;
}

export function contagensDaSaidaZeradas(): ContagensDaSaida {
  return { enviados: 0, falhados: 0, reagendados: 0, adiados: 0, mortos: 0 };
}

/**
 * A forma do envio para um item da fila.
 *
 * Devolve `null` com um motivo quando a forma não existe — o único caso hoje é
 * áudio: a biblioteca da Heloísa (R04 §6) tem os 7 registros de catálogo mas
 * nenhum arquivo gravado (`audio_assets.storage_path` está vazio em todos), e
 * não há de onde subir o ogg para a Meta. Fingir que sai seria mandar uma
 * mensagem vazia; falhar com a frase certa é o que a tela precisa mostrar.
 */
export function formaDoEnvio(
  item: ItemDeSaida,
): { ok: true; envio: Envio } | { ok: false; codigo: string; motivo: string } {
  if (item.tipo === 'audio') {
    return {
      ok: false,
      codigo: 'audio_sem_arquivo',
      motivo:
        'A biblioteca de áudios da Heloísa ainda não tem arquivo gravado (R04 §6): não há o que enviar.',
    };
  }

  // Fora da janela de 24 h a Meta só aceita template. `wa_saida_proximos` já
  // matou o que chegasse aqui sem modelo aprovado; este `if` é a segunda
  // fechadura, não a primeira.
  if (!item.janela_aberta) {
    if (item.modelo === null) {
      return {
        ok: false,
        codigo: 'sem_modelo_aprovado',
        motivo:
          'Fora da janela de 24 h e sem modelo aprovado pela Meta: a Meta só aceita template para iniciar conversa.',
      };
    }
    return {
      ok: true,
      envio: {
        tipo: 'template',
        para: item.para,
        nome: item.modelo.nome_meta,
        idioma: item.modelo.idioma,
        parametros: item.template_params.map((p) => (typeof p === 'string' ? p : String(p ?? ''))),
      },
    };
  }

  if (item.corpo === null) {
    return {
      ok: false,
      codigo: 'mensagem_sem_corpo',
      motivo: 'A mensagem está sem texto: não há o que enviar.',
    };
  }
  return { ok: true, envio: { tipo: 'texto', para: item.para, corpo: item.corpo } };
}

const dormirPadrao = (ms: number): Promise<void> =>
  new Promise((resolva) => {
    setTimeout(resolva, ms);
  });

/**
 * Drena um lote da fila de saída. Devolve quantos itens foram tratados — zero
 * significa fila vazia, e é o sinal de que o laço pode descansar.
 */
export async function drenarSaida(
  ctx: ContextoDaSaida,
  quantidade: number,
  contagens: ContagensDaSaida,
): Promise<number> {
  const lote = await proximosEnvios(ctx.cliente, quantidade);

  for (const recusado of lote.recusados) {
    if (recusado.acao === 'adiado') contagens.adiados += 1;
    else contagens.mortos += 1;
    ctx.logger.info('envio recusado na entrega', {
      message_id: recusado.message_id,
      motivo: recusado.motivo,
      acao: recusado.acao,
      quando: recusado.quando,
    });
  }

  const dormir = ctx.dormir ?? dormirPadrao;
  let primeiro = true;

  for (const item of lote.itens) {
    // Cadência humana só entre mensagens iniciadas pela empresa (R04 §4).
    if (!primeiro && !item.janela_aberta) {
      await dormir(esperaEntreEnvios(ctx.config, ctx.sorteio));
    }
    primeiro = false;

    const forma = formaDoEnvio(item);
    if (!forma.ok) {
      contagens.falhados += 1;
      // Sem forma de envio não há tentativa que ajude: encerra de uma vez.
      await envioFalhouDeVez(ctx.cliente, {
        msgId: item.msg_id,
        messageId: item.message_id,
        erro: forma.motivo,
        codigo: forma.codigo,
      });
      ctx.logger.warn('envio impossível', {
        message_id: item.message_id,
        codigo: forma.codigo,
      });
      continue;
    }

    const resultado = await ctx.graph.enviar(forma.envio);
    if (resultado.ok) {
      contagens.enviados += 1;
      await envioDeuCerto(ctx.cliente, {
        msgId: item.msg_id,
        messageId: item.message_id,
        wamid: resultado.wamid,
        // O custo real vem do recibo de entrega da Meta; aqui não se inventa
        // número. `billable_category` é a do modelo, que é o que já se sabe.
        custo: null,
        categoria: item.modelo?.categoria ?? null,
      });
      // Nunca o corpo da mensagem no log (guardrail do CLAUDE.md).
      ctx.logger.info('mensagem enviada', {
        message_id: item.message_id,
        conversation_id: item.conversation_id,
        forma: forma.envio.tipo,
        janela_aberta: item.janela_aberta,
      });
      continue;
    }

    // Definitivo: encerra sem backoff (a tabela de erros de graph.ts decide).
    if (!resultado.retentar) {
      contagens.falhados += 1;
      await envioFalhouDeVez(ctx.cliente, {
        msgId: item.msg_id,
        messageId: item.message_id,
        erro: resultado.mensagem,
        codigo: resultado.codigo,
      });
      ctx.logger.error('envio recusado pela Meta e encerrado', {
        message_id: item.message_id,
        codigo: resultado.codigo,
        http: resultado.httpStatus,
      });
      continue;
    }

    // Transitório: backoff e dead-letter ficam com o Postgres.
    const falha = await envioFalhou(ctx.cliente, {
      msgId: item.msg_id,
      messageId: item.message_id,
      erro: resultado.mensagem,
      codigo: resultado.codigo,
    });
    if (falha.acao === 'reagendado') {
      contagens.reagendados += 1;
      ctx.logger.warn('envio reagendado', {
        message_id: item.message_id,
        codigo: resultado.codigo,
        tentativa: falha.tentativa,
      });
    } else {
      contagens.falhados += 1;
      ctx.logger.error('envio falhou além do teto de tentativas', {
        message_id: item.message_id,
        codigo: resultado.codigo,
        acao: falha.acao,
      });
    }
  }

  return lote.itens.length;
}
