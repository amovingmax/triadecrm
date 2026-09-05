/**
 * O que acontece com uma mensagem que CHEGOU (RF-CON-03, RF-CON-19, RF-CON-27).
 *
 * A fila `wa_inbound` traz três coisas, já traduzidas pela Edge Function:
 * mensagem recebida, eco do celular (Coexistence) e recibo de entrega. Esta é a
 * ordem em que uma mensagem recebida é tratada, e a ordem é a regra:
 *
 *   1. GRAVAR. Antes de julgar qualquer coisa. A mensagem em que alguém
 *      escreve "SAIR" é a prova do opt-out — barrá-la por causa do opt-out que
 *      ela mesma cria seria apagar o consentimento no instante em que é dado.
 *      O gatilho de `messages` já sabe disso e deixa toda mensagem recebida
 *      entrar, inclusive de quem está suprimido.
 *
 *   2. OPT-OUT. Imediatamente depois de gravar e ANTES de tudo o mais: antes de
 *      baixar mídia, antes de transcrever, antes de pensar em responder. Não
 *      passa por modelo nenhum (`optout.ts` explica por quê) e reusa o caminho
 *      único do banco (`app.registrar_optout_de_contato`, migração 001500).
 *      Quando dispara, o tratamento PARA aqui: quem pediu para sair não tem a
 *      voz transcrita nem a intenção classificada. Gastar um modelo com a
 *      mensagem de quem acabou de sair é gastar dinheiro para desrespeitar.
 *
 *   3. ÁUDIO. O R13 mudou a ordem do que a IA faz: o primeiro contato agora é
 *      por ligação e o WhatsApp é apoio — mas o fornecedor manda áudio de
 *      qualquer jeito. Então transcrever é a primeira coisa que a IA faz. Quem
 *      percebe que chegou áudio é este worker; quem transcreve é o worker-ai.
 *      A ponte é a fila `ai_jobs`.
 *
 *      O DOWNLOAD É AQUI, E TEM PRAZO. A URL de mídia da Meta vale ~5 minutos e
 *      só abre com o nosso bearer. Passá-la adiante para outro processo seria
 *      entregar uma chave que expira; por isso o worker-wa baixa os bytes na
 *      hora e guarda no balde privado, e o que vai na fila é o CAMINHO.
 *
 *   4. CLASSIFICAR. Enfileira `classify_inbound` para o worker-ai. Este worker
 *      não chama modelo nenhum: ele diz o que precisa ser feito.
 *
 * O QUE ESTE ARQUIVO NÃO FAZ: responder. Nada sai daqui (ADR-05). O que sai é
 * decidido por uma pessoa aprovando um rascunho, e a única exceção — a
 * confirmação de opt-out em uma linha — é texto fixo enfileirado pelo próprio
 * Postgres, dentro da transação da supressão.
 */
import { pediuParaSair } from './optout';
import {
  pedirTrabalhoDeIa,
  registrarEco,
  registrarEntrada,
  registrarMidia,
  registrarOptOut,
  registrarRecibo,
  type ClienteDoBanco,
} from './ponte';

import type { ClienteDaGraph } from './graph';
import type { Logger } from '../lib/log';

/** Tipos de mensagem cujo conteúdo é voz. `audio` cobre a nota de voz (PTT). */
const TIPOS_DE_VOZ: ReadonlySet<string> = new Set(['audio', 'voice']);

export interface ContextoDaEntrada {
  cliente: ClienteDoBanco;
  graph: ClienteDaGraph;
  logger: Logger;
  /** Onde os bytes de mídia são guardados. Vazio desliga o download. */
  balde: string;
  supabaseUrl: string;
  chaveServico: string;
}

export interface ContagensDaEntrada {
  mensagens: number;
  repetidas: number;
  ecos: number;
  recibos: number;
  optouts: number;
  transcricoes_pedidas: number;
  classificacoes_pedidas: number;
  midias_baixadas: number;
  ignorados: number;
}

export function contagensDaEntradaZeradas(): ContagensDaEntrada {
  return {
    mensagens: 0,
    repetidas: 0,
    ecos: 0,
    recibos: 0,
    optouts: 0,
    transcricoes_pedidas: 0,
    classificacoes_pedidas: 0,
    midias_baixadas: 0,
    ignorados: 0,
  };
}

function texto(v: unknown): string | null {
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : null;
}

/**
 * Trata um item da fila `wa_inbound`. Lança em erro transitório (o chamador
 * manda para `esteira_fila_falhar`, que aplica backoff); devolve normalmente
 * quando o item foi tratado — inclusive quando a decisão foi ignorá-lo, porque
 * repetir um item malformado cinco vezes não o conserta.
 */
export async function tratarEntrada(
  ctx: ContextoDaEntrada,
  item: Record<string, unknown>,
  contagens: ContagensDaEntrada,
): Promise<void> {
  const tipo = texto(item.tipo);
  if (tipo === 'recibo') return tratarRecibo(ctx, item, contagens);
  if (tipo === 'eco') return tratarEco(ctx, item, contagens);
  if (tipo === 'mensagem') return tratarMensagem(ctx, item, contagens);

  contagens.ignorados += 1;
  ctx.logger.warn('item da fila de entrada com tipo desconhecido', { tipo });
}

async function tratarRecibo(
  ctx: ContextoDaEntrada,
  item: Record<string, unknown>,
  contagens: ContagensDaEntrada,
): Promise<void> {
  const wamid = texto(item.wamid);
  const estado = texto(item.estado);
  if (wamid === null || estado === null) {
    contagens.ignorados += 1;
    return;
  }
  const r = await registrarRecibo(ctx.cliente, {
    wamid,
    estado,
    ocorridoEm: texto(item.ocorrido_em) ?? new Date().toISOString(),
    codigo: texto(item.codigo),
    detalhe: texto(item.detalhe),
  });
  contagens.recibos += 1;
  if (!r.ok) {
    // "mensagem_desconhecida" acontece de verdade: o recibo do eco pode chegar
    // antes do eco. Não é erro — é a fila fazendo o trabalho dela na próxima
    // volta. Fica em `debug` para não virar ruído.
    ctx.logger.debug('recibo sem efeito', { wamid, estado, motivo: r.motivo });
  }
}

async function tratarEco(
  ctx: ContextoDaEntrada,
  item: Record<string, unknown>,
  contagens: ContagensDaEntrada,
): Promise<void> {
  const wamid = texto(item.wamid);
  const para = texto(item.para);
  const numero = texto(item.numero_da_empresa);
  if (wamid === null || para === null || numero === null) {
    contagens.ignorados += 1;
    return;
  }
  const r = await registrarEco(ctx.cliente, {
    wamid,
    numeroDaEmpresa: numero,
    para,
    tipo: texto(item.tipo_da_mensagem) ?? 'text',
    corpo: texto(item.texto),
    mediaId: texto(item.media_id),
    mediaMime: texto(item.media_mime),
    ocorridoEm: texto(item.ocorrido_em) ?? new Date().toISOString(),
  });
  if (r.novo) contagens.ecos += 1;
  else contagens.repetidas += 1;
}

async function tratarMensagem(
  ctx: ContextoDaEntrada,
  item: Record<string, unknown>,
  contagens: ContagensDaEntrada,
): Promise<void> {
  const wamid = texto(item.wamid);
  const de = texto(item.de);
  const numero = texto(item.numero_da_empresa);
  if (wamid === null || de === null || numero === null) {
    contagens.ignorados += 1;
    ctx.logger.warn('mensagem da fila sem wamid ou sem número', { wamid });
    return;
  }

  const tipoDaMensagem = texto(item.tipo_da_mensagem) ?? 'text';
  const corpo = texto(item.texto);

  // 1 · Gravar. Sempre, e antes de julgar.
  const gravada = await registrarEntrada(ctx.cliente, {
    wamid,
    numeroDaEmpresa: numero,
    de,
    tipo: tipoDaMensagem,
    corpo,
    mediaId: texto(item.media_id),
    mediaMime: texto(item.media_mime),
    ocorridoEm: texto(item.ocorrido_em) ?? new Date().toISOString(),
  });

  if (!gravada.novo) {
    // Reentrega da Meta. O índice único em `wa_message_id` fez o trabalho.
    contagens.repetidas += 1;
    ctx.logger.debug('mensagem já conhecida (reentrega)', { wamid });
    return;
  }
  contagens.mensagens += 1;

  const conversationId = gravada.conversation_id;
  const messageId = gravada.message_id;
  if (conversationId === null || messageId === null) {
    ctx.logger.error('mensagem gravada sem conversa: nada mais é seguro daqui', { wamid });
    return;
  }

  // 2 · OPT-OUT. Antes de tudo o mais.
  const veredito = pediuParaSair(corpo);
  if (veredito.pediu) {
    const r = await registrarOptOut(
      ctx.cliente,
      conversationId,
      `Pedido por escrito no WhatsApp (regra "${veredito.evidencia}").`,
    );
    contagens.optouts += 1;
    ctx.logger.info('opt-out registrado', {
      conversation_id: conversationId,
      regra: veredito.regra,
      evidencia: veredito.evidencia,
      confirmacao_enfileirada: r.confirmacaoEnfileirada,
      confirmacao_motivo: r.confirmacaoMotivo,
      motivo: r.motivo,
    });
    // O tratamento PARA aqui. Sem transcrição, sem classificação.
    return;
  }

  // 3 · Áudio: baixar agora (a URL da Meta expira) e pedir a transcrição.
  const mediaId = texto(item.media_id);
  if (TIPOS_DE_VOZ.has(tipoDaMensagem) && mediaId !== null) {
    const caminho = await guardarMidia(ctx, { mediaId, messageId, conversationId });
    if (caminho !== null) {
      contagens.midias_baixadas += 1;
      await registrarMidia(ctx.cliente, messageId, caminho);
    }
    const pedido = await pedirTrabalhoDeIa(
      ctx.cliente,
      'transcribe_audio',
      {
        message_id: messageId,
        conversation_id: conversationId,
        media_path: caminho,
        media_id: mediaId,
        media_mime: texto(item.media_mime),
      },
      wamid,
    );
    if (pedido.enfileirado) contagens.transcricoes_pedidas += 1;
    ctx.logger.info('transcrição pedida', {
      message_id: messageId,
      guardada: caminho !== null,
      enfileirado: pedido.enfileirado,
    });
    // Sem transcrição não há o que classificar: quem enfileira a
    // classificação, para áudio, é o worker-ai depois de transcrever.
    return;
  }

  // 4 · Classificar (RF-CON-20). Quem chama o modelo é o worker-ai.
  if (corpo !== null) {
    const pedido = await pedirTrabalhoDeIa(
      ctx.cliente,
      'classify_inbound',
      { message_id: messageId, conversation_id: conversationId },
      wamid,
    );
    if (pedido.enfileirado) contagens.classificacoes_pedidas += 1;
  }
}

/**
 * Baixa a mídia da Meta e a guarda no balde privado. Devolve o caminho, ou
 * `null` quando não deu — e não dar não é motivo para a mensagem falhar: ela
 * já está gravada, e o áudio pode ser recuperado à mão enquanto a URL vale.
 *
 * O caminho é `<conversa>/<mensagem>.<ext>`: agrupa por fio, que é como a
 * retenção do PRD §10.6 apaga (365 dias, metadados preservados).
 */
async function guardarMidia(
  ctx: ContextoDaEntrada,
  argumentos: { mediaId: string; messageId: string; conversationId: string },
): Promise<string | null> {
  if (ctx.balde === '') return null;

  const meta = await ctx.graph.midia(argumentos.mediaId);
  if (!meta.ok) {
    ctx.logger.warn('não consegui os metadados da mídia', {
      message_id: argumentos.messageId,
      motivo: meta.motivo,
    });
    return null;
  }
  const bytes = await ctx.graph.baixar(meta.url);
  if (!bytes.ok) {
    ctx.logger.warn('não consegui baixar a mídia', {
      message_id: argumentos.messageId,
      motivo: bytes.motivo,
    });
    return null;
  }

  const extensao = extensaoDoMime(meta.mime);
  const caminho = `${argumentos.conversationId}/${argumentos.messageId}${extensao}`;

  try {
    const resposta = await fetch(
      `${ctx.supabaseUrl.replace(/\/+$/, '')}/storage/v1/object/${ctx.balde}/${caminho}`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${ctx.chaveServico}`,
          'Content-Type': meta.mime.split(';')[0]?.trim() ?? 'application/octet-stream',
          'x-upsert': 'true',
        },
        body: bytes.bytes as unknown as BodyInit,
      },
    );
    if (!resposta.ok) {
      ctx.logger.warn('o balde recusou a mídia', {
        message_id: argumentos.messageId,
        http: resposta.status,
        detalhe: (await resposta.text()).slice(0, 200),
      });
      return null;
    }
  } catch (erro) {
    ctx.logger.warn('falha ao guardar a mídia', {
      message_id: argumentos.messageId,
      erro: erro instanceof Error ? erro.message : String(erro),
    });
    return null;
  }
  return caminho;
}

/** `audio/ogg; codecs=opus` → `.ogg`. Só o que a Cloud API entrega. */
export function extensaoDoMime(mime: string): string {
  const base = mime.split(';')[0]?.trim().toLowerCase() ?? '';
  const tabela: Record<string, string> = {
    'audio/ogg': '.ogg',
    'audio/opus': '.ogg',
    'audio/mpeg': '.mp3',
    'audio/mp4': '.m4a',
    'audio/amr': '.amr',
    'audio/aac': '.aac',
    'image/jpeg': '.jpg',
    'image/png': '.png',
    'image/webp': '.webp',
    'video/mp4': '.mp4',
    'video/3gpp': '.3gp',
    'application/pdf': '.pdf',
  };
  return tabela[base] ?? '.bin';
}
