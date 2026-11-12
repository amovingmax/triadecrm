/**
 * worker-wa — o WhatsApp (D5, RF-CON, anexos R04 e R13; ADR-04, ADR-05, ADR-06).
 *
 * Duas filas e um laço burro: lê fila, trata a
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
import { avisarDoAcumulo } from '../whatsapp/aviso-por-email';
import { recuperarMidias } from '../whatsapp/midias-atrasadas';
import { criarSincronizacaoDaAgenda } from '../agenda/sincronizar';
import { avisarDasReunioes } from '../whatsapp/reuniao-avisos';
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
  conferirAcumulo,
  lerConfigDoAviso,
  registrarAvisoDeAcumulo,
  type ClienteDoBanco,
} from '../whatsapp/ponte';
import { contagensDaSaidaZeradas, drenarSaida, type ContextoDaSaida } from '../whatsapp/saida';
import { configDaConexao, conectarNumero } from '../whatsapp/conectar';
import {
  criarSincronizacaoPeriodica,
  fraseDoResumo,
  sincronizarModelos,
  type SincronizacaoPeriodica,
} from '../whatsapp/modelos-meta';
import { criarSaudePeriodica, type SaudePeriodica } from '../whatsapp/saude';
import { criarLacoDasAcoes, fazerAcoes, type ContextoDasAcoes } from '../whatsapp/acoes';
import { dormir } from '../lib/dormir';
import { criarPulso } from '../lib/pulso';

import type { WorkerContext } from '../lib/context';
import type { Logger } from '../lib/log';

/** Descanso entre voltas quando as duas filas estão vazias. */
const DESCANSO_MS = 5_000;

/** Quantos itens de cada fila por volta. Entrada é barata; saída, não. */
const LOTE_DE_ENTRADA = 10;
const LOTE_DE_SAIDA = 5;

/** O balde privado das mídias recebidas (migração 20260905000201). */
const BALDE_DE_MIDIAS = 'mensagens';

/**
 * A passada de recuperação das mídias sem arquivo (`whatsapp/midias-atrasadas.ts`):
 * na subida e a cada dez minutos. Dez por passada, então um atraso de dias se
 * resolve em algumas voltas sem tomar o lugar da entrada e da saída.
 */
const INTERVALO_DA_RECUPERACAO_MS = 10 * 60_000;

/**
 * De quanto em quanto a agenda do Calendly vai ao Google e ao Calendly. Entre o
 * CRM marcar e o Calendly esconder o horário passam até ~15 s mais o tempo do
 * Calendly reler o Google Agenda.
 */
const INTERVALO_DA_AGENDA_MS = 15_000;

/**
 * De quanto em quanto o worker confere se as mensagens sem resposta passaram do
 * limite do aviso por e-mail (`aviso-por-email.ts`). O e-mail é para quando a
 * fila cresce, não para a mensagem que acabou de chegar: um minuto basta, e é
 * uma consulta só.
 */
const INTERVALO_DO_ACUMULO_MS = 60_000;

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

  // A saúde do número tem instância PRÓPRIA: a dos modelos é `null` sem WABA
  // configurada, e um número conectado sem WABA continua precisando ser
  // vigiado. O que ela depende é do `phoneNumberId`.
  const saude: SaudePeriodica = criarSaudePeriodica({
    cliente,
    graph,
    phoneNumberId: env.META_WA_PHONE_NUMBER_ID,
    logger,
  });

  const contextoDaEntrada: ContextoDaEntrada = {
    cliente,
    graph,
    logger,
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

  // As ações que não são mensagem (ler, digitando, bloquear, grupos, perfil)
  // têm laço próprio: o das mensagens pode ficar minutos no intervalo entre
  // aberturas, e "digitando…" atrasado não serve para nada.
  const contextoDasAcoes: ContextoDasAcoes = {
    cliente,
    graph,
    logger,
    phoneNumberId: env.META_WA_PHONE_NUMBER_ID,
    appId: env.META_APP_ID,
  };
  const acoes = criarLacoDasAcoes(contextoDasAcoes, { dormir: dormirAtePararem });

  // A agenda do Calendly (só na Imova): o espelho "Ocupado" no Google e os
  // cancelamentos que o CRM pede ao Calendly. Sem as duas chaves, não faz nada.
  const agenda = criarSincronizacaoDaAgenda({
    cliente,
    logger,
    tokenCalendly: env.CALENDLY_TOKEN,
    credencialGoogle: env.GOOGLE_AGENDA_CREDENCIAL,
    subGoogle: env.GOOGLE_AGENDA_SUB,
  });
  if (agenda.ligada) {
    // Até 11/11/2026 isto dizia "google: true" só por a variável existir, com o
    // espelho desligado no banco (sem google_agenda_id) e até com a chave torta.
    // Aqui vai só o que o worker sabe na partida; se o espelho está ligado, a
    // primeira passada diz ("espelho no Google ligado" ou "espelho desligado: …").
    logger.info('agenda do Calendly ligada neste worker', {
      cancelaNoCalendly: agenda.cancelaNoCalendly,
      credencialDoGoogleLida: agenda.credencialDoGoogle,
      googleEmNomeDeUmUsuario: env.GOOGLE_AGENDA_SUB !== undefined,
    });
  }

  const pulso = criarPulso({ cliente, logger, worker: 'wa' });
  await pulso.bater('ok', null, {
    modo: umaVez ? 'uma-vez' : 'contínuo',
    graph: env.META_WA_GRAPH_URL ?? 'https://graph.facebook.com',
  });
  pulso.iniciar();
  if (!umaVez) acoes.iniciar();

  const pedirParada = (sinal: string): void => {
    if (parando) return;
    parando = true;
    parada.abort();
    logger.info('parada pedida: o worker encerra depois da mensagem atual', { sinal });
  };
  process.on('SIGINT', () => pedirParada('SIGINT'));
  process.on('SIGTERM', () => pedirParada('SIGTERM'));

  let falhas = 0;
  let proximaRecuperacao = 0;
  let proximaAgenda = 0;
  let proximoAcumulo = 0;

  try {
    for (;;) {
      if (parando) break;

      // 0 · Os modelos na Meta e a saúde do número, em segundo plano, quando
      //     der a hora. Nenhum dos dois derruba o laço.
      modelos?.talvezDisparar();
      saude.talvezDisparar();

      // 1 · O que chegou. Sempre antes do que sai.
      const lidas = await consumirEntrada(
        contextoDaEntrada,
        entradas,
        () => {
          falhas += 1;
        },
        () => parando,
      );
      // 1b · Avisar o time por e-mail só quando acumula: mais de 30 mensagens
      //      sem resposta desde o último aviso (11/11/2026). Uma conferência
      //      por minuto; nunca lança.
      if (Date.now() >= proximoAcumulo) {
        proximoAcumulo = Date.now() + INTERVALO_DO_ACUMULO_MS;
        await avisarSeAcumulou(cliente, env.RESEND_API_KEY, logger);
      }

      // 1c · Reunião marcada: um e-mail por reunião. A reunião JÁ está
      //      gravada e já foi confirmada ao parceiro quando isto roda — se o
      //      Resend cair, a mensagem volta para a fila com backoff, tenta
      //      cinco vezes e cai em `reuniao_avisos_dlq`. E, como fila
      //      silenciosa também é falha silenciosa, `aviso_enviado_em`
      //      continua nulo e o cartão na Agenda diz que ninguém foi avisado.
      await avisarDasReunioes(cliente, env.RESEND_API_KEY, logger);

      // 1d · Mídia que chegou sem arquivo — antes de 02/10/2026 só o áudio era
      //      baixado, e o que chega com o worker parado também fica sem: buscar
      //      de novo na Meta enquanto ela guarda o arquivo. Falha só vira log.
      if (Date.now() >= proximaRecuperacao) {
        proximaRecuperacao = Date.now() + INTERVALO_DA_RECUPERACAO_MS;
        try {
          await recuperarMidias(contextoDaEntrada);
        } catch (erro) {
          logger.warn('a recuperação de mídias falhou', {
            erro: erro instanceof Error ? erro.message : String(erro),
          });
        }
      }
      if (parando) break;

      // 1e · No `--uma-vez`, as ações rodam aqui, uma passada só.
      if (umaVez) await fazerAcoes(contextoDasAcoes);

      // 1f · A agenda do Calendly, a cada 15 s: o bloco "Ocupado" no Google é o
      //      que esconde do cliente o horário que o CRM ocupou, e o cancelamento
      //      no Calendly é o que devolve o horário e avisa o cliente. Nunca lança.
      if (agenda.ligada && Date.now() >= proximaAgenda) {
        proximaAgenda = Date.now() + INTERVALO_DA_AGENDA_MS;
        await agenda.rodar();
      }

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
    await saude.encerrar(parando);
    await acoes.encerrar();

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
 * Confere a conta das mensagens sem resposta e, se o banco disser que passou do
 * limite, manda o e-mail e registra o aviso — só depois que o Resend aceitou,
 * para que um e-mail que falhou seja tentado de novo na próxima conferência.
 * Nada aqui derruba o laço: o e-mail é conforto do time, e as mensagens já
 * estão gravadas.
 */
async function avisarSeAcumulou(
  cliente: ClienteDoBanco,
  chave: string | undefined,
  logger: Logger,
): Promise<void> {
  try {
    const config = await lerConfigDoAviso(cliente);
    if (!config.ativo || config.para.length === 0) return;
    const acumulo = await conferirAcumulo(cliente);
    if (!acumulo.mandar) return;
    const mandou = await avisarDoAcumulo(
      acumulo,
      {
        ativo: config.ativo,
        para: config.para,
        de: config.de,
        responderPara: config.responder_para,
        urlDoCrm: config.url_do_crm,
      },
      chave,
      logger,
    );
    if (mandou) await registrarAvisoDeAcumulo(cliente, acumulo);
  } catch (erro) {
    logger.error('aviso das mensagens acumuladas falhou', { erro: (erro as Error).message });
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
