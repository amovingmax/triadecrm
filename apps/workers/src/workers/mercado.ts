/**
 * worker-mercado — a coleta da inteligência de mercado da Imova (18/11/2026).
 *
 * O pg_cron de segunda e quinta às 6h (Fortaleza) põe na fila `mercado_coleta`
 * uma mensagem por fonte que pode ser coletada e está no prazo da frequência
 * dela (`app.mercado_coleta_enfileirar`, migração 20261118210000). Este laço
 * lê a fila, uma fonte por vez, e para cada uma chama `executarFonte`
 * (`mercado/rodada.ts`). Quando a fila esvazia, chama `mercado_pos_rodada`:
 * veracidade de novo e, na segunda, a amostra da semana para a equipe.
 *
 * Modos:
 *   (sem opção)        laço contínuo: lê a fila, dorme quando vazia.
 *   --uma-vez          esvazia a fila uma vez, roda o pós-rodada e sai.
 *   --fonte=<id>       roda UMA fonte agora, fora da fila (as mesmas travas:
 *                      pode_coletar, chave ligada, robots.txt), e sai.
 *   --fonte=<id> --ensaio
 *                      lê a fonte de verdade, mas NÃO grava nada: imprime o
 *                      que gravaria. Serve para conferir um coletor novo.
 *
 * Nada aqui decide o que pode ser coletado: é a lista `mercado_fontes`.
 * Encerramento: SIGINT e SIGTERM param depois da fonte atual, nunca no meio.
 *
 * Só na Imova: na subida, o worker lê `mercado_worker_estado`. No banco da
 * KOMUNE (onde a migração não cria nada) ele registra o motivo e sai com 0,
 * sem bater ponto, para um serviço com reinício automático não virar laço.
 *
 * As vantagens: o motor que monta a lista de cada imóvel
 * (`mercado_argumentos_propor`) ainda não foi portado do protótipo
 * (`js/55-argumentos.js`). Até lá, nenhuma vantagem é proposta nem renovada
 * pelo worker, e o pós-rodada avisa isso no log. Decidido: quando portado, ele
 * roda aqui, no pós-rodada, DEPOIS da veracidade (pendência no CHANGELOG).
 */
import { criarPulso } from '../lib/pulso';
import {
  abrirColeta,
  concluirPedido,
  criarClienteDeMercado,
  falharPedido,
  fecharColeta,
  FILAS_DE_MERCADO,
  gravadorDeEnsaio,
  gravadorDoBanco,
  lerEstadoAnterior,
  lerEstadoDoMercado,
  lerFonte,
  lerPontosParaMedir,
  lerRegioes,
  lerRotulosBloqueados,
  motivoDoBancoErrado,
  posRodada,
  proximosPedidos,
  type ClienteDoBanco,
} from '../mercado/banco';
import { executarFonte, type DependenciasDaRodada, type DesfechoDaRodada } from '../mercado/rodada';

import type { Logger } from '../lib/log';
import type { WorkerContext } from '../lib/context';

const DESCANSO_MS = 60_000;

/** O motor de vantagens ainda não roda no worker (ver o cabeçalho). */
export const MOTOR_DE_VANTAGENS_NO_WORKER = false;

/** Pós-rodada: veracidade e amostra (banco); depois, o motor de vantagens, quando existir. */
async function depoisDaRodada(cliente: ClienteDoBanco, logger: Logger): Promise<void> {
  logger.info('pós-rodada', { ...(await posRodada(cliente)) });
  if (!MOTOR_DE_VANTAGENS_NO_WORKER) {
    logger.warn(
      'vantagens: o motor ainda não foi portado para o worker; nenhuma vantagem foi proposta nem renovada nesta rodada (as aprovadas vencem pela validade e voltam para aprovação)',
    );
  }
}

function dormir(ms: number): Promise<void> {
  return new Promise((resolva) => {
    setTimeout(resolva, ms);
  });
}

export function dependenciasDoBanco(cliente: ClienteDoBanco): DependenciasDaRodada {
  return {
    lerFonte: (id) => lerFonte(cliente, id),
    lerRegioes: () => lerRegioes(cliente),
    lerRotulosBloqueados: () => lerRotulosBloqueados(cliente),
    lerEstadoAnterior: (fonte) => lerEstadoAnterior(cliente, fonte),
    lerPontos: () => lerPontosParaMedir(cliente),
    lerEstado: (fonte) => lerEstadoDoMercado(cliente, fonte),
    abrirColeta: async (fonte, versao, detalhes) => {
      const r = await abrirColeta(cliente, fonte, versao, detalhes);
      return r.ok ? { ok: true, coleta_id: r.coleta_id } : { ok: false, motivo: r.motivo };
    },
    gravador: (coletaId, fonte) => gravadorDoBanco(cliente, coletaId, fonte),
    fecharColeta: (a) => fecharColeta(cliente, a),
  };
}

/** O desfecho de uma fonte decide o que acontece com a mensagem da fila. */
export function destinoDoPedido(d: DesfechoDaRodada): 'concluir' | 'falhar' {
  // "Não roda" (recolhida, desligada, robots fechado) e "parou" (429/403) não
  // são tentados de novo no mesmo dia: a próxima rodada da agenda decide.
  return d.tipo === 'falhou' ? 'falhar' : 'concluir';
}

export async function runMercado(ctx: WorkerContext<'mercado'>): Promise<number> {
  const { env, logger, opcoes } = ctx;
  const cliente = criarClienteDeMercado(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
  const deps = dependenciasDoBanco(cliente);
  const contato = env.COLETOR_CONTATO;

  const fonteAvulsa = typeof opcoes.fonte === 'string' ? opcoes.fonte : null;
  if (opcoes.ensaio === true && !fonteAvulsa) {
    logger.error('--ensaio precisa de --fonte=<id>: o ensaio é de uma fonte só');
    return 2;
  }

  // Banco errado (KOMUNE, ou sem a migração): sai sem bater ponto e sem erro.
  const bancoErrado = motivoDoBancoErrado(await lerEstadoDoMercado(cliente));
  if (bancoErrado) {
    logger.warn('worker-mercado não sobe neste banco', { motivo: bancoErrado });
    return 0;
  }

  if (fonteAvulsa) {
    const ensaio = opcoes.ensaio === true ? gravadorDeEnsaio() : null;
    const d = await executarFonte(deps, {
      fonteId: fonteAvulsa,
      coletorPedido: null,
      logger,
      contato,
      ensaio: ensaio ? { gravador: ensaio } : undefined,
    });
    if (ensaio) {
      process.stdout.write(
        `${JSON.stringify({ fonte: fonteAvulsa, desfecho: d.tipo, ...(d.tipo === 'ok' ? { detalhes: d.resultado.detalhes, erros: d.resultado.erros } : d), gravaria: ensaio.contagem, amostra: ensaio.amostra }, null, 2)}\n`,
      );
    } else {
      logger.info('fonte avulsa', {
        fonte: fonteAvulsa,
        desfecho: d.tipo,
        ...(d.tipo === 'ok' ? {} : d),
      });
      if (d.tipo !== 'nao_roda') await depoisDaRodada(cliente, logger);
    }
    return d.tipo === 'falhou' ? 1 : 0;
  }

  const umaVez = opcoes['uma-vez'] === true;
  const pulso = criarPulso({ cliente, logger, worker: 'mercado' });
  const contagens = { fontes: 0, falhas: 0, nao_rodaram: 0 };
  await pulso.bater('ok', FILAS_DE_MERCADO.coleta, { modo: umaVez ? 'uma-vez' : 'contínuo' });
  pulso.iniciar();

  let parando = false;
  const pedirParada = (sinal: string): void => {
    if (parando) return;
    parando = true;
    logger.info('parada pedida: o worker encerra depois da fonte atual', { sinal });
  };
  process.on('SIGINT', () => pedirParada('SIGINT'));
  process.on('SIGTERM', () => pedirParada('SIGTERM'));

  let trabalhouDesdeOPos = false;
  try {
    for (;;) {
      if (parando) break;
      const [pedido] = await proximosPedidos(cliente, 1);
      if (!pedido) {
        if (trabalhouDesdeOPos) {
          try {
            await depoisDaRodada(cliente, logger);
          } catch (e) {
            logger.error('o pós-rodada falhou', {
              erro: e instanceof Error ? e.message : String(e),
            });
          }
          trabalhouDesdeOPos = false;
        }
        if (umaVez) break;
        await dormir(DESCANSO_MS);
        continue;
      }
      trabalhouDesdeOPos = true;
      let d: DesfechoDaRodada;
      try {
        d = await executarFonte(deps, {
          fonteId: pedido.fonte,
          coletorPedido: pedido.coletor,
          logger,
          contato,
        });
      } catch (e) {
        d = {
          tipo: 'falhou',
          erro: e instanceof Error ? e.message : String(e),
          coletaId: null,
          fechamento: null,
        };
      }
      if (destinoDoPedido(d) === 'falhar') {
        const r = await falharPedido(cliente, pedido, d.tipo === 'falhou' ? d.erro : 'falhou');
        contagens.falhas += 1;
        pulso.somar(0, 1);
        logger.error('a coleta da fonte falhou', {
          fonte: pedido.fonte,
          acao: r.acao,
          tentativa: r.tentativa,
          erro: d.tipo === 'falhou' ? d.erro : null,
        });
      } else {
        await concluirPedido(cliente, pedido);
        if (d.tipo === 'nao_roda') contagens.nao_rodaram += 1;
        else contagens.fontes += 1;
        pulso.somar(1, 0);
        logger.info('fonte terminada', {
          fonte: pedido.fonte,
          desfecho: d.tipo,
          ...(d.tipo === 'nao_roda' || d.tipo === 'parou' ? { motivo: d.motivo } : {}),
        });
      }
    }
  } finally {
    pulso.parar();
    await pulso.bater(contagens.falhas > 0 ? 'degradado' : 'parado', FILAS_DE_MERCADO.coleta, {
      ...contagens,
    });
  }
  logger.info('worker-mercado encerrado', { ...contagens });
  return 0;
}
