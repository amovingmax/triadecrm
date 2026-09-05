/**
 * A batida de ponto do worker, agora no banco (RF-ADM-07).
 *
 * A tela do Radar precisa distinguir duas coisas que, sem isso, desenham a mesma
 * tela vazia: "não há nada para revisar hoje" e "o coletor está desligado há duas
 * horas". A primeira é um dia tranquilo; a segunda é um problema. O worker bate
 * ponto a cada 20 segundos em `worker_heartbeats`, e `esteira_saude()` considera
 * vivo quem bateu nos últimos 2 minutos — folga de seis batidas perdidas antes de
 * alguém ser acordado à toa.
 *
 * A batida nunca derruba o worker: falhar ao dizer "estou vivo" é motivo de log,
 * não de parar de trabalhar.
 */
import { hostname } from 'node:os';

import { baterPonto, type ClienteDoBanco } from '../ingest/esteira';
import type { Logger } from './log';

import pkg from '../../package.json' with { type: 'json' };

export const INTERVALO_DA_BATIDA_MS = 20_000;

export type StatusDoWorker = 'ok' | 'degradado' | 'parado';

export interface Pulso {
  /** Começa a bater sozinho, no intervalo padrão. */
  iniciar(): void;
  /** Bate agora. Usado ao iniciar, ao trocar de fila e ao encerrar. */
  bater(status: StatusDoWorker, fila?: string | null, detalhes?: Record<string, unknown>): Promise<void>;
  /** Soma ao acumulado que vai na próxima batida. */
  somar(processados: number, falhas: number): void;
  parar(): void;
}

export function criarPulso(argumentos: {
  cliente: ClienteDoBanco;
  logger: Logger;
  worker: string;
  instancia?: string;
}): Pulso {
  const instancia = argumentos.instancia ?? hostname();
  let processados = 0;
  let falhas = 0;
  let ultimoStatus: StatusDoWorker = 'ok';
  let ultimaFila: string | null = null;
  let ultimosDetalhes: Record<string, unknown> = {};
  let relogio: NodeJS.Timeout | null = null;

  const bater: Pulso['bater'] = async (status, fila, detalhes) => {
    ultimoStatus = status;
    if (fila !== undefined) ultimaFila = fila;
    if (detalhes !== undefined) ultimosDetalhes = detalhes;

    try {
      await baterPonto(argumentos.cliente, {
        worker: argumentos.worker,
        instancia,
        status,
        fila: ultimaFila,
        host: hostname(),
        versao: pkg.version,
        processados,
        falhas,
        detalhes: ultimosDetalhes,
      });
    } catch (erro) {
      argumentos.logger.warn('a batida de ponto não chegou ao banco', {
        erro: erro instanceof Error ? erro.message : String(erro),
      });
    }
  };

  return {
    iniciar() {
      if (relogio) return;
      relogio = setInterval(() => {
        void bater(ultimoStatus);
      }, INTERVALO_DA_BATIDA_MS);
      // O relógio não pode ser o motivo de o processo continuar vivo: quando o
      // trabalho acaba (`--uma-vez`), o worker sai.
      relogio.unref();
    },
    bater,
    somar(maisProcessados, maisFalhas) {
      processados += maisProcessados;
      falhas += maisFalhas;
    },
    parar() {
      if (relogio) clearInterval(relogio);
      relogio = null;
    },
  };
}
