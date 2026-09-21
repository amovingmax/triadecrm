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
  acoesHumanasDoWhatsapp,
  envioDeuCerto,
  envioFalhou,
  envioFalhouDeVez,
  esperaEntreEnvios,
  proximosEnvios,
} from './ponte';

import type { ClienteDaGraph, Envio, ParametrosDoModelo } from './graph';
import { ErroDoAudio, prepararAudio } from './audio-de-saida';

/**
 * O balde privado das mídias (migração `20260905000201`). O mesmo de onde o
 * áudio recebido é lido: entrada e saída moram juntas, por conversa.
 */
const BALDE_DAS_MIDIAS = 'mensagens';
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
  /** Substituível no teste: o relógio do aviso de pendências. */
  agora?: () => number;
  /**
   * O worker está parando (SIGTERM)? Conferido antes de cada envio — inclusive
   * logo depois do descanso da cadência, que acorda com o sinal. O que ficou
   * do lote sem ser enviado volta sozinho quando o `visibility timeout` da
   * `wa_outbound` (120 s) expira; reler não conta como tentativa.
   */
  deveParar?: () => boolean;
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
    // Áudio gravado na tela: o arquivo está no balde privado, e quem o sobe para
    // a Meta é o laço de envio (`mediaId` entra lá, depois do upload).
    if (item.media_path !== null && item.media_path !== '') {
      return { ok: true, envio: { para: item.para, tipo: 'audio' } };
    }
    // Sem arquivo é a biblioteca da Heloísa (R04 §6): os sete registros de
    // catálogo seguem sem ogg gravado, e não há de onde subir nada.
    return {
      ok: false,
      codigo: 'audio_sem_arquivo',
      motivo:
        'A biblioteca de áudios da Heloísa ainda não tem arquivo gravado (R04 §6): não há o que enviar.',
    };
  }

  // A resposta automática ao botão de um envio em massa: texto com UM botão de
  // link. Só existe dentro da janela — a pessoa acabou de tocar num botão.
  if (item.tipo === 'interactive') {
    const p = Array.isArray(item.template_params) ? {} : item.template_params;
    const rotulo = typeof p.botao === 'string' ? p.botao : '';
    const url = typeof p.url === 'string' ? p.url : '';
    if (!item.janela_aberta || item.corpo === null || rotulo === '' || !url.startsWith('https://')) {
      return {
        ok: false,
        codigo: 'link_fora_da_janela',
        motivo:
          'A mensagem com botão de link só sai dentro das 24 h depois de a pessoa responder, e precisa de texto, rótulo e endereço.',
      };
    }
    return { ok: true, envio: { tipo: 'link', para: item.para, corpo: item.corpo, rotulo, url } };
  }

  // Modelo COM botões sai como modelo mesmo dentro da janela: mandado como
  // texto, os botões — que são a razão de ele existir — sumiriam.
  const comBotoes = item.modelo !== null && item.botoes.length > 0;

  // Fora da janela de 24 h a Meta só aceita template. `wa_saida_proximos` já
  // matou o que chegasse aqui sem modelo aprovado; este `if` é a segunda
  // fechadura, não a primeira.
  if (!item.janela_aberta || comBotoes) {
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
        parametros: parametrosDoItem(item.template_params),
        ...botaoDeLinkDoItem(item),
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

/** O botão de link do modelo, com o código do item como sufixo da URL. */
function botaoDeLinkDoItem(item: ItemDeSaida): { botaoDeLink?: { indice: number; sufixo: string } } {
  const indice = item.botoes.findIndex((b) => b.tipo === 'link');
  return indice < 0 ? {} : { botaoDeLink: { indice, sufixo: item.link_codigo } };
}

/**
 * `messages.template_params` em duas eras: LISTA para os modelos posicionais
 * antigos (`{{1}}`), OBJETO para os nomeados (`{"nome":"Maria"}`). A forma do
 * dado decide a forma do envio — o banco não precisa dizer qual é qual. A
 * limpeza do valor (quebra de linha, tab, espaço repetido) é de `graph.ts`,
 * que é quem conhece a regra da Meta.
 */
export function parametrosDoItem(bruto: ItemDeSaida['template_params']): ParametrosDoModelo {
  const comoTexto = (v: unknown): string =>
    typeof v === 'string' ? v : v === null || v === undefined ? '' : String(v);
  if (Array.isArray(bruto)) return bruto.map(comoTexto);
  return Object.fromEntries(Object.entries(bruto).map(([nome, valor]) => [nome, comoTexto(valor)]));
}

const dormirPadrao = (ms: number): Promise<void> =>
  new Promise((resolva) => {
    setTimeout(resolva, ms);
  });

/**
 * A PENDÊNCIA QUE SÓ UMA PESSOA DESTRAVA (RF-CON-19, migração 20260905000400).
 *
 * Enquanto o GEN-SYS-OPTOUT não estiver aprovado no Meta Business, quem pede
 * para sair mais de 24 h depois da última mensagem NÃO recebe a confirmação: a
 * Meta só aceita template aprovado fora da janela (R04 §2.1). O banco já não
 * morre calado — ele fica devendo por escrito, em `public.wa_confirmacoes_
 * devidas`, e `app.wa_confirmacoes_reenfileirar` paga sozinha quando voltar a
 * ser possível. Mas uma dívida que ninguém lê é uma dívida que ninguém paga.
 *
 * Só na fila VAZIA, e no máximo de 15 em 15 minutos: o aviso é para ser lido,
 * e aviso repetido a cada volta do laço vira ruído que se aprende a ignorar.
 */
const INTERVALO_DO_AVISO_MS = 15 * 60 * 1000;
let ultimoAvisoEm = 0;

/** Só para o teste: zera o relógio do aviso. */
export function reiniciarAvisoDePendencias(): void {
  ultimoAvisoEm = 0;
}

async function avisarPendencias(ctx: ContextoDaSaida, agora: number): Promise<void> {
  if (agora - ultimoAvisoEm < INTERVALO_DO_AVISO_MS) return;
  ultimoAvisoEm = agora;
  let acoes;
  try {
    acoes = await acoesHumanasDoWhatsapp(ctx.cliente);
  } catch (erro) {
    // Um painel que não responde não pode derrubar o envio.
    ctx.logger.warn('não deu para ler a saúde do WhatsApp', {
      erro: erro instanceof Error ? erro.message : String(erro),
    });
    return;
  }
  for (const acao of acoes) {
    ctx.logger.error('AÇÃO HUMANA PENDENTE no WhatsApp', {
      o_que: acao.oQue,
      quem: acao.quem,
      porque: acao.porque,
      pessoas_esperando: acao.pessoasEsperando,
    });
  }
}

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

  for (const [indice, item] of lote.itens.entries()) {
    if (ctx.deveParar?.()) {
      ctx.logger.info('parada pedida: o resto do lote volta para a fila sozinho', {
        nao_enviados: lote.itens.length - indice,
      });
      break;
    }
    // Cadência humana só entre mensagens iniciadas pela empresa (R04 §4).
    if (!primeiro && !item.janela_aberta) {
      await dormir(esperaEntreEnvios(ctx.config, ctx.sorteio));
      // O descanso acorda com a parada: não se envia depois de acordar por ela.
      if (ctx.deveParar?.()) {
        ctx.logger.info('parada pedida: o resto do lote volta para a fila sozinho', {
          nao_enviados: lote.itens.length - indice,
        });
        break;
      }
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

    // Áudio não vai por valor: o arquivo do balde vira um `media id` na Meta
    // antes de a mensagem citá-lo. Só aqui, no instante do envio — subir na hora
    // da gravação gastaria upload por áudio que a janela de 24 h vai recusar.
    let envio = forma.envio;
    if (envio.tipo === 'audio' && envio.mediaId === undefined) {
      const subida = await subirOAudio(ctx, item);
      if (!subida.ok) {
        contagens.falhados += 1;
        if (subida.retentar) {
          const falha = await envioFalhou(ctx.cliente, {
            msgId: item.msg_id,
            messageId: item.message_id,
            erro: subida.motivo,
            codigo: subida.codigo,
          });
          ctx.logger.warn('áudio não subiu; volta para a fila', {
            message_id: item.message_id,
            codigo: subida.codigo,
            tentativa: falha.tentativa,
          });
          continue;
        }
        await envioFalhouDeVez(ctx.cliente, {
          msgId: item.msg_id,
          messageId: item.message_id,
          erro: subida.motivo,
          codigo: subida.codigo,
        });
        ctx.logger.error('áudio impossível de enviar', {
          message_id: item.message_id,
          codigo: subida.codigo,
        });
        continue;
      }
      envio = { ...envio, mediaId: subida.mediaId };
    }

    const resultado = await ctx.graph.enviar(envio);
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
        forma: envio.tipo,
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

  // Fila vazia é o momento de olhar para o que NÃO está na fila: a
  // confirmação de opt-out que ninguém consegue mandar (RF-CON-19).
  if (lote.itens.length === 0 && lote.recusados.length === 0) {
    await avisarPendencias(ctx, (ctx.agora ?? Date.now)());
  }

  return lote.itens.length;
}

/**
 * O arquivo do balde vira um `media id` da Meta.
 *
 * Três passos e três jeitos de falhar, cada um com um desfecho diferente:
 *
 * 1. **Baixar do balde.** Falhou = problema nosso, transitório: volta para a
 *    fila. O arquivo não some sozinho.
 * 2. **Preparar** (trocar a embalagem do webm, conferir teto e tipo). Falhou =
 *    o arquivo é o que é; tentar de novo dá o mesmo. Morre com o motivo escrito.
 *    A exceção é `ffmpeg_ausente`: isso é configuração da imagem, e a mensagem
 *    precisa dizer isso em vez de culpar o áudio de quem gravou.
 * 3. **Subir para a Meta.** Quem decide se vale repetir é a resposta dela.
 */
async function subirOAudio(
  ctx: ContextoDaSaida,
  item: ItemDeSaida,
): Promise<
  { ok: true; mediaId: string } | { ok: false; motivo: string; codigo: string; retentar: boolean }
> {
  const caminho = item.media_path;
  if (caminho === null || caminho === '') {
    return { ok: false, motivo: 'a mensagem de áudio não tem arquivo', codigo: 'audio_sem_arquivo', retentar: false };
  }

  const { data, error } = await ctx.cliente.storage.from(BALDE_DAS_MIDIAS).download(caminho);
  if (error || !data) {
    return {
      ok: false,
      motivo: `o arquivo do áudio não foi lido do balde: ${error?.message ?? 'sem corpo'}`,
      codigo: 'audio_nao_lido',
      retentar: true,
    };
  }

  let pronto;
  try {
    pronto = await prepararAudio({
      bytes: new Uint8Array(await data.arrayBuffer()),
      mime: item.media_mime,
    });
  } catch (erro) {
    const doAudio = erro instanceof ErroDoAudio;
    return {
      ok: false,
      motivo: (erro as Error).message,
      codigo: doAudio ? erro.codigo : 'audio_ilegivel',
      // Imagem sem ffmpeg é conserto de deploy, e a mensagem espera por ele.
      retentar: doAudio && erro.codigo === 'ffmpeg_ausente',
    };
  }

  const subida = await ctx.graph.subirMidia(pronto);
  if (!subida.ok) {
    return { ok: false, motivo: subida.motivo, codigo: 'audio_recusado_pela_meta', retentar: subida.retentar };
  }
  return { ok: true, mediaId: subida.mediaId };
}
