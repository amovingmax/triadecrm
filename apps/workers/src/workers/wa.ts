/**
 * worker-wa — o WhatsApp (D5, RF-CON, anexos R04 e R13; ADR-04, ADR-05, ADR-06).
 *
 * Duas filas e um laço burro, na forma do worker-ingest: lê fila, trata a
 * mensagem, bate ponto, repete. Toda a inteligência mora no Postgres (ADR-03) —
 * supressão, janela de 24 h, janela de horário, teto do número, reconferência
 * na entrega e idempotência por wamid. Aqui há transporte e ordem.
 *
 * A ORDEM DAS FILAS DENTRO DE UMA VOLTA, E POR QUE ELA É ESTA
 * ---------------------------------------------------------------------------
 *   1. `wa_inbound`  o que CHEGOU — e, dentro dele, o opt-out antes de tudo.
 *   2. varredura      as mensagens em `queued` que ainda não estavam na fila.
 *   3. `wa_outbound`  o que SAI.
 *
 * A entrada vem primeiro de propósito. Se um fornecedor escreveu "SAIR" há dez
 * segundos e há uma mensagem para ele na fila de saída, tratar a saída
 * primeiro entregaria a mensagem antes de a supressão existir. Nesta ordem, a
 * supressão é gravada na volta 1 e `app.wa_proximos` — que reconfere item a
 * item no instante da entrega — mata a mensagem na mesma volta.
 *
 * Isso não é a garantia: a garantia é a reconferência do banco, que vale mesmo
 * se a ordem mudar. Mas ordem que trabalha a favor da regra é ordem que não
 * precisa ser explicada duas vezes.
 *
 * ENCERRAMENTO: SIGINT e SIGTERM param depois da mensagem atual, nunca no
 * meio — e ACORDAM qualquer descanso (a cadência de 45–180 s entre envios, o
 * descanso de fila vazia, o intervalo entre pedidos de modelo), para que a
 * parada na nuvem caiba no prazo do SIGTERM antes do SIGKILL. Uma mensagem interrompida volta sozinha quando o `visibility timeout`
 * expira, mas terminar o que já começou é mais barato que reprocessar — e, no
 * WhatsApp, reprocessar um envio interrompido depois do POST e antes do
 * registro é o único jeito de mandar a mesma mensagem duas vezes.
 *
 * NADA SAI SOZINHO (ADR-05). Este worker não redige, não decide responder e
 * não chama modelo nenhum: ele envia o que uma pessoa aprovou — a garantia é o
 * gatilho `app.messages_guard` — e pede à fila `ai_jobs` o que a IA precisa
 * fazer. A única mensagem que sai sem alguém clicar é a confirmação de opt-out
 * do RF-CON-19, que é texto fixo enfileirado pelo próprio Postgres dentro da
 * transação da supressão.
 *
 * OS MODELOS NA META. Com `META_WA_BUSINESS_ACCOUNT_ID` definida, o worker manda
 * os modelos para aprovação e sincroniza o status na subida e a cada 30 min —
 * em segundo plano, porque a primeira passada pode levar um minuto e um minuto
 * sem ler a entrada é um minuto sem responder quem escreveu. Falha só vira log.
 *
 * DOIS COMANDOS DE UMA VEZ SÓ, que saem ao terminar:
 *   · `--conectar`            liga o número de ponta a ponta (`whatsapp/conectar.ts`);
 *   · `--sincronizar-modelos` só a passada dos modelos.
 */
import { avisarPorEmail, type EntradaParaAviso } from '../whatsapp/aviso-por-email';
import { ClienteDaGraph, VERSAO_PADRAO } from '../whatsapp/graph';
import {
  contagensDaEntradaZeradas,
  tratarEntrada,
  type ContextoDaEntrada,
} from '../whatsapp/entrada';
import {
  concluir,
  criarClienteWa,
  enfileirarPendentes,
  falhar,
  FILA_ENTRADA,
  lerFila,
  lerConfigDeEnvio,
  lerConfigDoAviso,
  lerConversasParaAviso,
} from '../whatsapp/ponte';
import { contagensDaSaidaZeradas, drenarSaida, type ContextoDaSaida } from '../whatsapp/saida';
import { configDaConexao, conectarNumero } from '../whatsapp/conectar';
import {
  criarSincronizacaoPeriodica,
  fraseDoResumo,
  sincronizarModelos,
  type SincronizacaoPeriodica,
} from '../whatsapp/modelos-meta';
import { dormir } from '../lib/dormir';
import { criarPulso } from '../lib/pulso';

import type { WorkerContext } from '../lib/context';

/** Descanso entre voltas quando as duas filas estão vazias. */
const DESCANSO_MS = 5_000;

/** Quantos itens de cada fila por volta. Entrada é barata; saída, não. */
const LOTE_DE_ENTRADA = 10;
const LOTE_DE_SAIDA = 5;

/** O balde privado das mídias recebidas (migração 20260905000201). */
const BALDE_DE_MIDIAS = 'mensagens';

export async function runWa(ctx: WorkerContext<'wa'>): Promise<number> {
  const { env, logger, opcoes } = ctx;
  const umaVez = opcoes['uma-vez'] === true;
  const conectar = opcoes.conectar !== undefined;
  const soModelos = opcoes['sincronizar-modelos'] !== undefined;

  const cliente = criarClienteWa(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

  // A base da Graph API é variável de ambiente para que o dublê local
  // (`supabase/functions/_dubles/meta-graph-duble.mjs`) possa ocupar o lugar
  // dela em teste. Não existe credencial da Meta neste repositório.
  const graph = new ClienteDaGraph({
    baseUrl: env.META_WA_GRAPH_URL ?? 'https://graph.facebook.com',
    versao: env.META_WA_API_VERSION ?? VERSAO_PADRAO,
    phoneNumberId: env.META_WA_PHONE_NUMBER_ID,
    token: env.META_WA_ACCESS_TOKEN,
  });

  // ---- Comandos de uma vez só ----------------------------------------------
  if (conectar) {
    const conexao = configDaConexao(env);
    if (!conexao.ok) {
      process.stderr.write(
        [
          '`workers wa --conectar` precisa destas variáveis (modelo em .env.example):',
          ...conexao.faltando.map((f) => `  - ${f}`),
          '',
        ].join('\n'),
      );
      return 1;
    }
    return conectarNumero({ cliente, graph, logger, config: conexao.config });
  }

  if (soModelos) {
    if (!env.META_WA_BUSINESS_ACCOUNT_ID) {
      process.stderr.write(
        '`workers wa --sincronizar-modelos` precisa de META_WA_BUSINESS_ACCOUNT_ID (o id da conta do WhatsApp Business).\n',
      );
      return 1;
    }
    const r = await sincronizarModelos({
      cliente,
      graph,
      wabaId: env.META_WA_BUSINESS_ACCOUNT_ID,
      logger,
    });
    if (!r.ok) {
      process.stderr.write(
        `✗ Sincronização de modelos parou: ${r.erro} (até ali: ${fraseDoResumo(r.resumo)}).\n`,
      );
      return 1;
    }
    process.stdout.write(
      `${r.resumo.falhas > 0 ? '✗' : '✓'} Modelos: ${fraseDoResumo(r.resumo)}.\n`,
    );
    return r.resumo.falhas > 0 ? 1 : 0;
  }

  // ---- O laço --------------------------------------------------------------
  const config = await lerConfigDeEnvio(cliente);

  // A parada acorda todo descanso (lib/dormir.ts).
  let parando = false;
  const parada = new AbortController();
  const dormirAtePararem = (ms: number): Promise<void> => dormir(ms, parada.signal);

  const modelos: SincronizacaoPeriodica | null = env.META_WA_BUSINESS_ACCOUNT_ID
    ? criarSincronizacaoPeriodica({
        cliente,
        graph,
        wabaId: env.META_WA_BUSINESS_ACCOUNT_ID,
        logger,
        dormir: dormirAtePararem,
      })
    : null;
  if (modelos === null) {
    logger.info(
      'META_WA_BUSINESS_ACCOUNT_ID vazia: os modelos não são sincronizados com a Meta por este worker',
    );
  }

  const contextoDaEntrada: ContextoDaEntrada = {
    cliente,
    graph,
    logger,
    chegaram: [],
    balde: BALDE_DE_MIDIAS,
    supabaseUrl: env.SUPABASE_URL,
    chaveServico: env.SUPABASE_SERVICE_ROLE_KEY,
  };
  const contextoDaSaida: ContextoDaSaida = {
    cliente,
    graph,
    logger,
    config,
    dormir: dormirAtePararem,
    deveParar: () => parando,
  };

  const entradas = contagensDaEntradaZeradas();
  const saidas = contagensDaSaidaZeradas();

  const pulso = criarPulso({ cliente, logger, worker: 'wa' });
  await pulso.bater('ok', null, {
    modo: umaVez ? 'uma-vez' : 'contínuo',
    graph: env.META_WA_GRAPH_URL ?? 'https://graph.facebook.com',
  });
  pulso.iniciar();

  const pedirParada = (sinal: string): void => {
    if (parando) return;
    parando = true;
    parada.abort();
    logger.info('parada pedida: o worker encerra depois da mensagem atual', { sinal });
  };
  process.on('SIGINT', () => pedirParada('SIGINT'));
  process.on('SIGTERM', () => pedirParada('SIGTERM'));

  let falhas = 0;

  try {
    for (;;) {
      if (parando) break;

      // 0 · Os modelos na Meta, em segundo plano, quando der a hora.
      modelos?.talvezDisparar();

      // 1 · O que chegou. Sempre antes do que sai.
      const lidas = await consumirEntrada(
        contextoDaEntrada,
        entradas,
        () => {
          falhas += 1;
        },
        () => parando,
      );
      // 1b · Avisar o time. Um e-mail por lote: cinco mensagens em dez segundos
      //      são uma conversa, e cinco e-mails são ruído.
      await avisarDoQueChegou(contextoDaEntrada, env.RESEND_API_KEY);
      if (parando) break;

      // 2 · O que a tela aprovou e ainda não estava na fila.
      const pendentes = await enfileirarPendentes(cliente, 50);

      // 3 · O que sai.
      const enviadas = await drenarSaida(contextoDaSaida, LOTE_DE_SAIDA, saidas);

      await pulso.bater(falhas > 0 ? 'degradado' : 'ok', null, {
        ...entradas,
        ...saidas,
        modo: umaVez ? 'uma-vez' : 'contínuo',
      });
      pulso.somar(lidas + enviadas, 0);

      if (lidas > 0 || enviadas > 0 || pendentes.enfileirados > 0) continue;
      if (umaVez) break;
      await dormirAtePararem(DESCANSO_MS);
    }

    // `--uma-vez` deixa a passada dos modelos terminar; um sinal a interrompe
    // entre um modelo e outro.
    await modelos?.encerrar(parando);

    logger.info('worker-wa encerrado', { ...entradas, ...saidas, falhas });
    await pulso.bater('parado', null, {
      ...entradas,
      ...saidas,
      encerrado_em: new Date().toISOString(),
    });
    return falhas > 0 ? 1 : 0;
  } finally {
    pulso.parar();
  }
}

/**
 * Uma passada na fila de entrada. Erro numa mensagem não derruba as outras: ela
 * vai para `esteira_fila_falhar`, que aplica backoff e, no teto, manda para
 * `wa_dlq` — a dead-letter PRÓPRIA do WhatsApp, para que ninguém precise
 * procurar mensagem de fornecedor no meio das falhas do Radar.
 */
/**
 * Manda o aviso do lote e esvazia a lista. Nada aqui derruba o laço: o e-mail é
 * conforto do time, e a mensagem do parceiro já está gravada.
 */
async function avisarDoQueChegou(ctx: ContextoDaEntrada, chave: string | undefined): Promise<void> {
  const chegaram = ctx.chegaram ?? [];
  if (chegaram.length === 0) return;
  ctx.chegaram = [];
  try {
    const config = await lerConfigDoAviso(ctx.cliente);
    if (!config.ativo || config.para.length === 0) return;
    const conversas = await lerConversasParaAviso(
      ctx.cliente,
      chegaram.map((c) => c.conversationId),
    );
    const entradas: EntradaParaAviso[] = chegaram.map((c) => {
      const conversa = conversas.get(c.conversationId);
      return {
        ficha: conversa?.ficha ?? null,
        organizationId: conversa?.organization_id ?? null,
        telefone: conversa?.telefone ?? null,
        opcao: conversa?.opcao ?? null,
        texto: c.texto,
      };
    });
    await avisarPorEmail(
      entradas,
      { ativo: config.ativo, para: config.para, de: config.de, urlDoCrm: config.url_do_crm },
      chave,
      ctx.logger,
    );
  } catch (erro) {
    ctx.logger.error('aviso do lote falhou', { erro: (erro as Error).message });
  }
}

async function consumirEntrada(
  ctx: ContextoDaEntrada,
  contagens: ReturnType<typeof contagensDaEntradaZeradas>,
  aoFalhar: () => void,
  deveParar: () => boolean,
): Promise<number> {
  const mensagens = await lerFila(ctx.cliente, FILA_ENTRADA, LOTE_DE_ENTRADA);

  let tratadas = 0;
  for (const mensagem of mensagens) {
    // Parada entre uma mensagem e outra: o resto volta com o visibility timeout.
    if (deveParar()) break;
    tratadas += 1;
    const chave = chaveDaMensagem(mensagem.mensagem);
    try {
      await tratarEntrada(ctx, mensagem.mensagem, contagens);
      await concluir(ctx.cliente, FILA_ENTRADA, mensagem.msg_id, chave);
    } catch (erro) {
      aoFalhar();
      const texto = erro instanceof Error ? erro.message : String(erro);
      const resultado = await falhar(ctx.cliente, FILA_ENTRADA, mensagem.msg_id, chave, texto);
      ctx.logger.error('mensagem de entrada falhou', {
        msg_id: mensagem.msg_id,
        tentativa: resultado.tentativa,
        acao: resultado.acao,
        erro: texto,
      });
    }
  }
  return tratadas;
}

/**
 * A chave de idempotência viaja DENTRO da mensagem, como na esteira de
 * ingestão: é a mesma que a Edge Function gravou em `ingest_dedup` ao
 * enfileirar, e deduzi-la aqui seria inventá-la duas vezes.
 */
export function chaveDaMensagem(mensagem: Record<string, unknown>): string {
  const chave = mensagem.chave;
  return typeof chave === 'string' && chave.trim() !== '' ? chave.trim() : '';
}
