/**
 * worker-rotas — a rota da tarde da Heloísa (RF-ROT-01 a RF-ROT-03; ADR-04).
 *
 * O laço é o mesmo dos outros três: lê a fila, trata a mensagem, bate ponto,
 * repete. Duas responsabilidades, e nada além:
 *
 *   1. `--geocodificar`: uma passada pelo Nominatim para dar coordenada a quem
 *      não tem (RF-ROT-01). Acaba e sai.
 *   2. o laço de `rotas_jobs`: para cada pedido, pergunta a matriz de tempos ao
 *      OSRM, resolve a ordem e grava.
 *
 * ## O que ele NUNCA faz
 *
 * Não decide quem entra na rota. Quem decide é `app.rota_alvos`, no Postgres,
 * chamada de dentro de `public.rota_proximas` (antes de entregar coordenada
 * nenhuma ao OSRM) e de novo em `public.rota_gravar_ordem`, parada a parada
 * (ADR-03; a forma é a do dreno da Komune, 20260905000100). Um contato
 * suprimido às 13:55 não entra numa rota calculada às 13:50, e não é este
 * arquivo que garante isso — é o banco.
 *
 * Não inventa rota. Se o OSRM não responde, o plano fica `falhou` com o motivo
 * escrito, e a tela mostra o motivo. Não existe caminho neste worker que
 * calcule distância em linha reta e chame de rota.
 *
 * Encerramento: SIGINT e SIGTERM param depois do pedido atual, nunca no meio.
 */
import { criarPulso } from '../lib/pulso';
import {
  concluirPedido,
  criarClienteDeRotas,
  falharPedido,
  falharRota,
  gravarOrdem,
  proximosPedidos,
  FILAS_DE_ROTAS,
  type ParadaGravada,
  type PedidoDeRota,
} from '../rotas/banco';
import { geocodificarPendentes } from '../rotas/geocodificar';
import { criarClienteDoNominatim } from '../rotas/nominatim';
import { ErroDoOsrm, matrizDeTempos } from '../rotas/osrm';
import { resolverOrdem, trechosDaOrdem } from '../rotas/ordem';

import type { ClienteDoBanco } from '../rotas/banco';
import type { WorkerContext } from '../lib/context';
import type { Logger } from '../lib/log';

/** Descanso entre voltas quando a fila está vazia. */
const DESCANSO_MS = 3_000;

/** Quantos pedidos por leitura. Um pedido é uma chamada ao OSRM e é rápido. */
const POR_LEITURA = 3;

function dormir(ms: number): Promise<void> {
  return new Promise((resolva) => {
    setTimeout(resolva, ms);
  });
}

/**
 * Um pedido: matriz no OSRM, ordem, gravação.
 *
 * Devolve o número de paradas gravadas. Erro do OSRM sobe — quem chama decide
 * entre devolver a mensagem à fila (falha de rede, tenta de novo) e encerrar o
 * plano com motivo.
 */
export async function tratarPedido(argumentos: {
  cliente: ClienteDoBanco;
  osrmUrl: string;
  pedido: PedidoDeRota;
  logger: Logger;
  fetchImpl?: typeof fetch;
}): Promise<{ gravadas: number; metodo: string }> {
  const { pedido, logger } = argumentos;

  const matriz = await matrizDeTempos({
    baseUrl: argumentos.osrmUrl,
    origem: { lat: pedido.origem.lat, lng: pedido.origem.lng },
    paradas: pedido.paradas.map((p) => ({ lat: p.lat, lng: p.lng })),
    fetchImpl: argumentos.fetchImpl,
  });

  const resolvido = resolverOrdem(matriz.duracoes, pedido.paradas.length);
  if (!resolvido) {
    throw new ErroDoOsrm(
      'sem_caminho',
      'O OSRM não achou caminho de carro para pelo menos uma das paradas. ' +
        'Coordenada provavelmente fora da malha do Rio Grande do Norte.',
    );
  }

  const trechos = trechosDaOrdem(matriz.duracoes, matriz.distancias, resolvido.ordem);
  const paradas: ParadaGravada[] = resolvido.ordem.map((indice, posicao) => {
    // `indice` é 1-based na matriz porque a origem ocupa o índice 0.
    const parada = pedido.paradas[indice - 1];
    const trecho = trechos[posicao];
    return {
      task_id: parada?.task_id ?? '',
      segundos_do_anterior: trecho?.segundos ?? 0,
      metros_do_anterior: trecho?.metros ?? 0,
    };
  });

  const totalMetros = trechos.reduce((soma, t) => soma + t.metros, 0);
  const gravado = await gravarOrdem(
    argumentos.cliente,
    pedido.plano_id,
    paradas,
    Math.round(resolvido.totalSegundos),
    totalMetros,
  );

  if (gravado.descartadas.length > 0) {
    logger.warn('paradas descartadas na gravação: o banco reconferiu e elas não valem mais', {
      plano_id: pedido.plano_id,
      descartadas: gravado.descartadas,
    });
  }

  logger.info('rota pronta', {
    plano_id: pedido.plano_id,
    dia: pedido.dia,
    paradas: gravado.gravadas,
    metodo: resolvido.metodo,
    minutos: Math.round(gravado.total_segundos / 60),
    km: Math.round(gravado.total_metros / 100) / 10,
  });

  return { gravadas: gravado.gravadas, metodo: resolvido.metodo };
}

export async function runRotas(ctx: WorkerContext<'rotas'>): Promise<number> {
  const { env, logger, opcoes } = ctx;
  const umaVez = opcoes['uma-vez'] === true;
  const soGeocodificar = opcoes.geocodificar === true;

  const cliente = criarClienteDeRotas(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
  const pulso = criarPulso({ cliente, logger, worker: 'rotas' });

  if (soGeocodificar) {
    const nominatim = criarClienteDoNominatim({
      baseUrl: env.NOMINATIM_URL,
      userAgent: env.NOMINATIM_USER_AGENT,
    });
    await pulso.bater('ok', null, { modo: 'geocodificar', fonte: 'nominatim/openstreetmap' });
    const resumo = await geocodificarPendentes({ cliente, nominatim, logger });
    await pulso.bater(resumo.falhas > 0 ? 'degradado' : 'ok', null, {
      modo: 'geocodificar',
      ...resumo,
    });
    logger.info('geocodificação concluída', { ...resumo });
    return resumo.falhas > 0 && resumo.encontradas === 0 ? 1 : 0;
  }

  const contagens = { tratados: 0, falhas: 0, paradas: 0 };
  await pulso.bater('ok', FILAS_DE_ROTAS.trabalhos, {
    modo: umaVez ? 'uma-vez' : 'contínuo',
    osrm: env.OSRM_URL,
  });
  pulso.iniciar();

  let parando = false;
  const pedirParada = (sinal: string): void => {
    if (parando) return;
    parando = true;
    logger.info('parada pedida: o worker encerra depois do pedido atual', { sinal });
  };
  process.on('SIGINT', () => pedirParada('SIGINT'));
  process.on('SIGTERM', () => pedirParada('SIGTERM'));

  try {
    for (;;) {
      if (parando) break;

      const pedidos = await proximosPedidos(cliente, POR_LEITURA);

      for (const pedido of pedidos) {
        try {
          const { gravadas } = await tratarPedido({
            cliente,
            osrmUrl: env.OSRM_URL,
            pedido,
            logger,
          });
          await concluirPedido(cliente, pedido.msg_id, pedido.chave);
          contagens.tratados += 1;
          contagens.paradas += gravadas;
          pulso.somar(1, 0);
        } catch (erro) {
          const texto = erro instanceof Error ? erro.message : String(erro);
          contagens.falhas += 1;
          pulso.somar(0, 1);

          const resultado = await falharPedido(cliente, pedido.msg_id, pedido.chave, texto);
          // Só quando a esteira desiste (dead-letter) o plano é encerrado como
          // falho: enquanto houver tentativa, dizer "falhou" na tela seria
          // mentir sobre algo que ainda vai ser tentado.
          if (resultado.acao !== 'retry') {
            await falharRota(cliente, pedido.plano_id, texto);
          }
          logger.error('o pedido de rota falhou', {
            plano_id: pedido.plano_id,
            acao: resultado.acao,
            tentativa: resultado.tentativa,
            erro: texto,
          });
        }
      }

      if (umaVez && pedidos.length === 0) break;
      if (pedidos.length === 0) await dormir(DESCANSO_MS);
    }
  } finally {
    pulso.parar();
    await pulso.bater(contagens.falhas > 0 ? 'degradado' : 'parado', FILAS_DE_ROTAS.trabalhos, {
      ...contagens,
    });
  }

  logger.info('worker-rotas encerrado', { ...contagens });
  return 0;
}
