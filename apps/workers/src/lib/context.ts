import type { OpcoesDoComando, WorkerCommand } from '../cli';
import type { WorkerEnv } from './env';
import type { Logger } from './log';

/** Tudo que um worker recebe ao iniciar: comando, opções da linha, ambiente validado e logger já nomeado. */
export interface WorkerContext<C extends WorkerCommand = WorkerCommand> {
  command: C;
  env: WorkerEnv<C>;
  logger: Logger;
  opcoes: OpcoesDoComando;
}

/** Um worker recebe o contexto e devolve o código de saída do processo. */
export type WorkerRunner<C extends WorkerCommand> = (ctx: WorkerContext<C>) => Promise<number>;
