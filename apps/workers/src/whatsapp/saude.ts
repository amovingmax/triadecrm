/**
 * A outra metade da saúde do número: perguntar à Graph.
 *
 * O webhook só avisa quando algo MUDA, e só dos campos que alguém assinou no
 * painel do app. A nota de qualidade em si (`GREEN`/`YELLOW`/`RED`) não chega
 * por webhook nenhum — o que chega é `FLAGGED`, que é a nota caindo. Quem sabe
 * a nota é `GET /{phone-number-id}`, e hoje o CRM a pede uma vez só, na
 * conexão (`conectar.ts`). Uma leitura de meia em meia hora é o que transforma
 * "soubemos quando conectamos" em "sabemos agora".
 *
 * Nenhuma decisão aqui: a linha vai para `public.wa_saude_registrar` e quem
 * decide o teto é `app.wa_teto_da_meta`, no banco (ADR-03).
 */
import { CAMPOS_DO_NUMERO, paraNumeroNaMeta } from './conectar';
import { registrarSaude } from './ponte';

import type { ClienteDaGraph } from './graph';
import type { ClienteDoBanco } from './ponte';
import type { Logger } from '../lib/log';

export interface ContextoDaSaude {
  readonly cliente: ClienteDoBanco;
  readonly graph: ClienteDaGraph;
  readonly phoneNumberId: string;
  readonly logger: Logger;
}

/** De meia em meia hora, como a sincronização de modelos. */
export const INTERVALO_DA_SAUDE_MS = 30 * 60 * 1000;

/**
 * Uma leitura. Falha de rede vira aviso e **não grava nada**.
 *
 * Gravar um "não consegui perguntar" como "sem restrição" seria pior que não
 * perguntar: a última linha que valia continuaria valendo, e é isso o certo —
 * o CRM esquecer o que sabia porque a rede caiu seria trocar uma informação
 * velha e verdadeira por uma nova e falsa.
 */
export async function lerSaudeDoNumero(ctx: ContextoDaSaude): Promise<void> {
  const lido = await ctx.graph.ler(ctx.phoneNumberId, { fields: CAMPOS_DO_NUMERO });
  if (!lido.ok) {
    ctx.logger.warn('não consegui perguntar à Meta como está o número', {
      phone_number_id: ctx.phoneNumberId,
      codigo: lido.codigo,
    });
    return;
  }
  const numero = paraNumeroNaMeta(lido.json);
  await registrarSaude(ctx.cliente, {
    numero: numero.numero,
    origem: 'graph',
    campo: 'phone_number',
    evento: numero.status,
    qualidade: numero.qualidade,
    payload: lido.json,
  });
  ctx.logger.info('a Meta respondeu como está o número', {
    phone_number_id: ctx.phoneNumberId,
    qualidade: numero.qualidade,
    status: numero.status,
    vazao: numero.vazao,
  });
}

export interface SaudePeriodica {
  /** Dispara em segundo plano se já deu a hora e nada estiver rodando. */
  talvezDisparar(): void;
  /**
   * Espera a leitura em curso. `interromper` existe para casar com
   * `SincronizacaoPeriodica` e com a chamada `await saude.encerrar(parando)`:
   * uma leitura é um GET só, e não há entre o que parar.
   */
  encerrar(interromper: boolean): Promise<void>;
}

/**
 * INSTÂNCIA PRÓPRIA, e não a dos modelos: aquela é `null` quando
 * `META_WA_BUSINESS_ACCOUNT_ID` está vazia (`workers/wa.ts`), e a saúde depende
 * do `phoneNumberId`, não da WABA. Um número conectado sem WABA configurada
 * continua precisando ser vigiado.
 *
 * Nota honesta: em `--uma-vez` a primeira batida sempre dispara uma leitura
 * (`proximaEm` começa em 0), exatamente como a dos modelos. É um GET por
 * execução, e é o preço de não haver estado entre execuções.
 */
export function criarSaudePeriodica(
  ctx: ContextoDaSaude,
  opcoes: {
    intervaloMs?: number;
    agora?: () => number;
    ler?: (ctx: ContextoDaSaude) => Promise<void>;
  } = {},
): SaudePeriodica {
  const intervalo = opcoes.intervaloMs ?? INTERVALO_DA_SAUDE_MS;
  const agora = opcoes.agora ?? Date.now;
  const ler = opcoes.ler ?? lerSaudeDoNumero;
  let proximaEm = 0;
  let emCurso: Promise<void> | null = null;
  let parar = false;

  return {
    talvezDisparar() {
      if (parar || emCurso !== null || agora() < proximaEm) return;
      proximaEm = agora() + intervalo;
      emCurso = ler(ctx)
        .catch((erro: unknown) => {
          // Nunca derruba o laço: um minuto sem ler a fila de entrada é um
          // minuto sem responder quem escreveu.
          ctx.logger.error('a leitura da saúde do número quebrou', {
            erro: erro instanceof Error ? erro.message : String(erro),
          });
        })
        .finally(() => {
          emCurso = null;
        });
    },
    async encerrar(interromper) {
      if (interromper) parar = true;
      if (emCurso !== null) await emCurso;
      parar = true;
    },
  };
}
