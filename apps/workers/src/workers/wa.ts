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
 * meio. Uma mensagem interrompida volta sozinha quando o `visibility timeout`
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
 */
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
} from '../whatsapp/ponte';
import { contagensDaSaidaZeradas, drenarSaida, type ContextoDaSaida } from '../whatsapp/saida';
import { criarPulso } from '../lib/pulso';

import type { WorkerContext } from '../lib/context';

/** Descanso entre voltas quando as duas filas estão vazias. */
const DESCANSO_MS = 5_000;

/** Quantos itens de cada fila por volta. Entrada é barata; saída, não. */
const LOTE_DE_ENTRADA = 10;
const LOTE_DE_SAIDA = 5;

/** O balde privado das mídias recebidas (migração 20260905000201). */
const BALDE_DE_MIDIAS = 'mensagens';

/** Sem `unref()`: um timer que não segura o laço mataria o worker no descanso. */
function dormir(ms: number): Promise<void> {
  return new Promise((resolva) => {
    setTimeout(resolva, ms);
  });
}

export async function runWa(ctx: WorkerContext<'wa'>): Promise<number> {
  const { env, logger, opcoes } = ctx;
  const umaVez = opcoes['uma-vez'] === true;

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

  const config = await lerConfigDeEnvio(cliente);

  const contextoDaEntrada: ContextoDaEntrada = {
    cliente,
    graph,
    logger,
    balde: BALDE_DE_MIDIAS,
    supabaseUrl: env.SUPABASE_URL,
    chaveServico: env.SUPABASE_SERVICE_ROLE_KEY,
  };
  const contextoDaSaida: ContextoDaSaida = { cliente, graph, logger, config };

  const entradas = contagensDaEntradaZeradas();
  const saidas = contagensDaSaidaZeradas();

  const pulso = criarPulso({ cliente, logger, worker: 'wa' });
  await pulso.bater('ok', null, {
    modo: umaVez ? 'uma-vez' : 'contínuo',
    graph: env.META_WA_GRAPH_URL ?? 'https://graph.facebook.com',
  });
  pulso.iniciar();

  let parando = false;
  const pedirParada = (sinal: string): void => {
    if (parando) return;
    parando = true;
    logger.info('parada pedida: o worker encerra depois da mensagem atual', { sinal });
  };
  process.on('SIGINT', () => pedirParada('SIGINT'));
  process.on('SIGTERM', () => pedirParada('SIGTERM'));

  let falhas = 0;

  try {
    for (;;) {
      if (parando) break;

      // 1 · O que chegou. Sempre antes do que sai.
      const lidas = await consumirEntrada(contextoDaEntrada, entradas, () => {
        falhas += 1;
      });

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
      await dormir(DESCANSO_MS);
    }

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
async function consumirEntrada(
  ctx: ContextoDaEntrada,
  contagens: ReturnType<typeof contagensDaEntradaZeradas>,
  aoFalhar: () => void,
): Promise<number> {
  const mensagens = await lerFila(ctx.cliente, FILA_ENTRADA, LOTE_DE_ENTRADA);

  for (const mensagem of mensagens) {
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
  return mensagens.length;
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
