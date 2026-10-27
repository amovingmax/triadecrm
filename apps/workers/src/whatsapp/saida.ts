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
  saidaAindaVale,
} from './ponte';

import type { ClienteDaGraph, ContatoDoCartao, Envio, ParametrosDoModelo } from './graph';
import { ErroDoAudio, prepararAudio } from './audio-de-saida';
import { ErroDaMidia, prepararArquivo, prepararMidia, type Sondar } from './midia-de-saida';

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
  /** Substituível no teste: quem lê os codecs do vídeo (o `ffprobe`). */
  sondarVideo?: Sondar;
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
  const forma = formaDosTiposNovos(item) ?? formaDeSempre(item);
  // Responder citando vale para todo tipo (27/10/2026). Modelo fora da janela
  // também aceita `context`, mas a citação só faz sentido em conversa aberta.
  if (forma.ok && item.responde_a_wamid !== null && item.janela_aberta) {
    return { ok: true, envio: { ...forma.envio, responde: item.responde_a_wamid } };
  }
  return forma;
}

type Forma = { ok: true; envio: Envio } | { ok: false; codigo: string; motivo: string };

function semJanela(codigo: string, oQue: string): Forma {
  return {
    ok: false,
    codigo,
    motivo: `${oQue} só sai dentro das 24 h depois de a pessoa escrever: fora disso a Meta aceita só modelo aprovado.`,
  };
}

function numeroOuNulo(v: unknown): number | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
}

function textoOuNulo(v: unknown): string | null {
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : null;
}

/** `conteudo.contatos` → os contatos do cartão; o que não tiver forma fica de fora. */
export function contatosDoConteudo(conteudo: Record<string, unknown> | null): ContatoDoCartao[] {
  const lista = Array.isArray(conteudo?.contatos) ? conteudo.contatos : [];
  return lista.flatMap((bruto) => {
    if (typeof bruto !== 'object' || bruto === null) return [];
    const c = bruto as Record<string, unknown>;
    const nome = textoOuNulo(c.nome);
    const telefones = (Array.isArray(c.telefones) ? c.telefones : []).flatMap((t) => {
      if (typeof t === 'string') return textoOuNulo(t) ? [{ numero: t.trim() }] : [];
      if (typeof t !== 'object' || t === null) return [];
      const o = t as Record<string, unknown>;
      const numero = textoOuNulo(o.numero);
      if (numero === null) return [];
      const tipo = textoOuNulo(o.tipo);
      const waId = textoOuNulo(o.wa_id);
      return [{ numero, ...(tipo ? { tipo } : {}), ...(waId ? { wa_id: waId } : {}) }];
    });
    if (nome === null || telefones.length === 0) return [];
    const emails = (Array.isArray(c.emails) ? c.emails : []).flatMap((e) => {
      const t = textoOuNulo(e);
      return t ? [t] : [];
    });
    const empresa = textoOuNulo(c.empresa);
    return [
      { nome, telefones, ...(emails.length ? { emails } : {}), ...(empresa ? { empresa } : {}) },
    ];
  });
}

/**
 * Os tipos do WhatsApp completo (27/10/2026): reação, localização, cartão de
 * contato, documento, figurinha, botões, lista e pedir localização. Todos são
 * mensagem livre — só dentro da janela de 24 h. `null` = não é tipo novo.
 *
 * A forma de cada um já foi conferida no insert (`app.messages_forma`); aqui
 * só se traduz, e a conferência que se repete é a que protege a Meta de um
 * pedido sem sentido.
 */
function formaDosTiposNovos(item: ItemDeSaida): Forma | null {
  const c = item.conteudo;
  const base = { para: item.para };

  if (item.tipo === 'reaction') {
    if (item.reage_a_wamid === null) {
      return {
        ok: false,
        codigo: 'reacao_sem_alvo',
        motivo: 'A mensagem reagida não tem id na Meta (não chegou a sair?): não há a que reagir.',
      };
    }
    if (!item.janela_aberta) return semJanela('reacao_fora_da_janela', 'A reação');
    return {
      ok: true,
      envio: { ...base, tipo: 'reacao', alvo: item.reage_a_wamid, emoji: item.corpo ?? '' },
    };
  }

  if (item.tipo === 'location') {
    const latitude = numeroOuNulo(c?.latitude);
    const longitude = numeroOuNulo(c?.longitude);
    if (latitude === null || longitude === null) {
      return { ok: false, codigo: 'localizacao_sem_coordenada', motivo: 'A localização está sem latitude ou longitude.' };
    }
    if (!item.janela_aberta) return semJanela('localizacao_fora_da_janela', 'A localização');
    const nome = textoOuNulo(c?.nome);
    const endereco = textoOuNulo(c?.endereco);
    return {
      ok: true,
      envio: {
        ...base,
        tipo: 'localizacao',
        latitude,
        longitude,
        ...(nome ? { nome } : {}),
        ...(endereco ? { endereco } : {}),
      },
    };
  }

  if (item.tipo === 'contacts') {
    const contatos = contatosDoConteudo(c);
    if (contatos.length === 0) {
      return { ok: false, codigo: 'cartao_sem_contato', motivo: 'O cartão está sem contato com nome e telefone.' };
    }
    if (!item.janela_aberta) return semJanela('cartao_fora_da_janela', 'O cartão de contato');
    return { ok: true, envio: { ...base, tipo: 'contatos', contatos } };
  }

  if (item.tipo === 'document') {
    if (item.media_path === null || item.media_path === '') {
      return { ok: false, codigo: 'midia_sem_arquivo', motivo: 'O documento está sem arquivo: não há o que enviar.' };
    }
    if (!item.janela_aberta) return semJanela('midia_fora_da_janela', 'O documento');
    return {
      ok: true,
      envio: {
        ...base,
        tipo: 'documento',
        nome: item.media_nome ?? 'documento',
        ...(item.corpo ? { legenda: item.corpo } : {}),
      },
    };
  }

  if (item.tipo === 'image' && item.tipo_na_meta === 'sticker') {
    if (item.media_path === null || item.media_path === '') {
      return { ok: false, codigo: 'midia_sem_arquivo', motivo: 'A figurinha está sem arquivo: não há o que enviar.' };
    }
    if (!item.janela_aberta) return semJanela('midia_fora_da_janela', 'A figurinha');
    return { ok: true, envio: { ...base, tipo: 'figurinha' } };
  }

  const interativo =
    item.tipo === 'interactive' && typeof c?.interativo === 'object' && c.interativo !== null
      ? (c.interativo as Record<string, unknown>)
      : null;
  if (interativo !== null) {
    if (!item.janela_aberta) return semJanela('interativo_fora_da_janela', 'A pergunta com botões');
    if (item.corpo === null) {
      return { ok: false, codigo: 'mensagem_sem_corpo', motivo: 'A pergunta está sem texto.' };
    }
    if (interativo.tipo === 'botoes') {
      const botoes = (Array.isArray(interativo.botoes) ? interativo.botoes : []).flatMap((b) => {
        const t = textoOuNulo(b);
        return t ? [t] : [];
      });
      if (botoes.length === 0) {
        return { ok: false, codigo: 'botoes_vazios', motivo: 'A pergunta está sem botões.' };
      }
      return { ok: true, envio: { ...base, tipo: 'botoes', corpo: item.corpo, botoes } };
    }
    if (interativo.tipo === 'lista') {
      const itens = (Array.isArray(interativo.itens) ? interativo.itens : []).flatMap((i) => {
        if (typeof i !== 'object' || i === null) return [];
        const o = i as Record<string, unknown>;
        const titulo = textoOuNulo(o.titulo);
        const descricao = textoOuNulo(o.descricao);
        return titulo ? [{ titulo, ...(descricao ? { descricao } : {}) }] : [];
      });
      const botao = textoOuNulo(interativo.botao);
      if (itens.length === 0 || botao === null) {
        return { ok: false, codigo: 'lista_vazia', motivo: 'A lista está sem opções ou sem o nome do botão.' };
      }
      return { ok: true, envio: { ...base, tipo: 'lista', corpo: item.corpo, botao, itens } };
    }
    if (interativo.tipo === 'pedir_localizacao') {
      return { ok: true, envio: { ...base, tipo: 'pedir_localizacao', corpo: item.corpo } };
    }
    return { ok: false, codigo: 'interativo_desconhecido', motivo: 'Mensagem interativa de um tipo que o CRM não manda.' };
  }

  return null;
}

function formaDeSempre(item: ItemDeSaida): Forma {
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

  // Foto e vídeo escolhidos na tela (16/10/2026). Mídia livre só existe dentro
  // da janela de 24 h: fora dela a Meta aceita só modelo aprovado, e mídia não é
  // modelo. `wa_saida_proximos` já mata o que chega fora da janela sem modelo;
  // este `if` é a segunda fechadura.
  if (item.tipo === 'image' || item.tipo === 'video') {
    if (item.media_path === null || item.media_path === '') {
      return {
        ok: false,
        codigo: 'midia_sem_arquivo',
        motivo: 'A mensagem de foto ou vídeo está sem arquivo: não há o que enviar.',
      };
    }
    if (!item.janela_aberta) {
      return {
        ok: false,
        codigo: 'midia_fora_da_janela',
        motivo:
          'Foto e vídeo só saem dentro das 24 h depois de a pessoa escrever: fora disso a Meta aceita só modelo aprovado.',
      };
    }
    return {
      ok: true,
      envio: {
        tipo: item.tipo === 'image' ? 'imagem' : 'video',
        para: item.para,
        ...(item.corpo ? { legenda: item.corpo } : {}),
      },
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

    // Áudio, foto e vídeo não vão por valor: o arquivo do balde vira um `media
    // id` na Meta antes de a mensagem citá-lo. Só aqui, no instante do envio —
    // subir antes gastaria upload por arquivo que a janela de 24 h vai recusar.
    let envio = forma.envio;
    if (
      (envio.tipo === 'audio' ||
        envio.tipo === 'imagem' ||
        envio.tipo === 'video' ||
        envio.tipo === 'documento' ||
        envio.tipo === 'figurinha') &&
      envio.mediaId === undefined
    ) {
      const subida = await subirOArquivo(ctx, item, envio.tipo);
      if (!subida.ok) {
        contagens.falhados += 1;
        if (subida.retentar) {
          const falha = await envioFalhou(ctx.cliente, {
            msgId: item.msg_id,
            messageId: item.message_id,
            erro: subida.motivo,
            codigo: subida.codigo,
          });
          ctx.logger.warn('arquivo não subiu; volta para a fila', {
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
        ctx.logger.error('arquivo impossível de enviar', {
          message_id: item.message_id,
          codigo: subida.codigo,
        });
        continue;
      }
      envio = { ...envio, mediaId: subida.mediaId };
    }

    // A última pergunta (27/10/2026): alguém apagou a mensagem enquanto ela
    // esperava o intervalo entre aberturas ou subia o arquivo? Então ela não
    // sai. Quem tirou da fila foi o "apagar" (`mensagem_apagar`), que já
    // gravou o cancelamento; aqui só se arquiva o item.
    if (!(await saidaAindaVale(ctx.cliente, item.message_id))) {
      await tirarDaFilaOCancelado(ctx, item);
      ctx.logger.info('mensagem cancelada antes de sair', { message_id: item.message_id });
      continue;
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
 * O arquivo do balde vira um `media id` da Meta — áudio, foto ou vídeo.
 *
 * Três passos e três jeitos de falhar, cada um com um desfecho diferente:
 *
 * 1. **Baixar do balde.** Falhou = problema nosso, transitório: volta para a
 *    fila. O arquivo não some sozinho.
 * 2. **Preparar** (o áudio vira ogg; a foto e o vídeo são conferidos: tipo,
 *    teto e, no vídeo, os codecs). Falhou = o arquivo é o que é; tentar de novo
 *    dá o mesmo. Morre com o motivo escrito. A exceção é a ferramenta que falta
 *    na imagem (`ffmpeg_ausente`, `ffprobe_ausente`): isso é configuração, e a
 *    mensagem espera o conserto em vez de culpar o arquivo de quem enviou.
 * 3. **Subir para a Meta.** Quem decide se vale repetir é a resposta dela.
 */
/**
 * Tira da fila um item que não vai mais sair (cancelado). `wa_saida_falha_
 * definitiva` só arquiva o item da `wa_outbound` e não reescreve a mensagem,
 * que já está `failed` com o motivo "cancelada".
 */
async function tirarDaFilaOCancelado(ctx: ContextoDaSaida, item: ItemDeSaida): Promise<void> {
  await envioFalhouDeVez(ctx.cliente, {
    msgId: item.msg_id,
    messageId: item.message_id,
    erro: 'Cancelada antes de sair.',
    codigo: 'cancelada',
  });
}

export async function subirOArquivo(
  ctx: Pick<ContextoDaSaida, 'cliente' | 'graph' | 'sondarVideo'>,
  item: Pick<ItemDeSaida, 'media_path' | 'media_mime' | 'media_nome'>,
  tipo: 'audio' | 'imagem' | 'video' | 'documento' | 'figurinha',
): Promise<
  { ok: true; mediaId: string } | { ok: false; motivo: string; codigo: string; retentar: boolean }
> {
  // O prefixo dos códigos que já existiam continua `audio_`: é o que as linhas
  // antigas e o painel de falhas já conhecem.
  const prefixo = tipo === 'audio' ? 'audio' : 'midia';
  const caminho = item.media_path;
  if (caminho === null || caminho === '') {
    return {
      ok: false,
      motivo: 'a mensagem não tem arquivo',
      codigo: `${prefixo}_sem_arquivo`,
      retentar: false,
    };
  }

  const { data, error } = await ctx.cliente.storage.from(BALDE_DAS_MIDIAS).download(caminho);
  if (error || !data) {
    return {
      ok: false,
      motivo: `o arquivo não foi lido do balde: ${error?.message ?? 'sem corpo'}`,
      codigo: `${prefixo}_nao_lido`,
      retentar: true,
    };
  }

  const bytes = new Uint8Array(await data.arrayBuffer());
  let pronto;
  try {
    pronto =
      tipo === 'audio'
        ? await prepararAudio({ bytes, mime: item.media_mime })
        : tipo === 'documento' || tipo === 'figurinha'
          ? prepararArquivo(tipo === 'documento' ? 'document' : 'sticker', {
              bytes,
              mime: item.media_mime,
              nome: item.media_nome,
            })
          : await prepararMidia(
              tipo === 'imagem' ? 'image' : 'video',
              { bytes, mime: item.media_mime },
              ctx.sondarVideo,
            );
  } catch (erro) {
    const conhecido = erro instanceof ErroDoAudio || erro instanceof ErroDaMidia;
    const codigo = conhecido ? erro.codigo : `${prefixo}_ilegivel`;
    return {
      ok: false,
      motivo: (erro as Error).message,
      codigo,
      // Imagem do worker sem ffmpeg é conserto de deploy, e a mensagem espera por ele.
      retentar: codigo === 'ffmpeg_ausente' || codigo === 'ffprobe_ausente',
    };
  }

  const subida = await ctx.graph.subirMidia(pronto);
  if (!subida.ok) {
    return {
      ok: false,
      motivo: subida.motivo,
      codigo: `${prefixo}_recusado_pela_meta`,
      retentar: subida.retentar,
    };
  }
  return { ok: true, mediaId: subida.mediaId };
}
