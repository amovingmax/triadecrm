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
  await lerLimiteDoNumero(ctx, numero.numero);
}

/**
 * O campo do limite de conversas por dia na Graph. O antigo,
 * `messaging_limit_tier`, a Meta aposentou quando o limite passou a ser do
 * portfólio; este é o que a documentação manda pedir no lugar (12/11/2026).
 */
export const CAMPO_DO_LIMITE = 'whatsapp_business_manager_messaging_limit';

/**
 * O tier ("TIER_2K") na resposta da Graph. A documentação mostra o valor como
 * texto; aceita também um objeto com `current_limit` ou `tier`, para não
 * perder a leitura se a forma mudar. Qualquer outra coisa é "não disse".
 */
export function limiteDaResposta(json: unknown): string | null {
  if (typeof json !== 'object' || json === null) return null;
  const bruto = (json as Record<string, unknown>)[CAMPO_DO_LIMITE];
  const valor =
    typeof bruto === 'string'
      ? bruto
      : typeof bruto === 'object' && bruto !== null
        ? ((bruto as Record<string, unknown>).current_limit ?? (bruto as Record<string, unknown>).tier)
        : null;
  if (typeof valor !== 'string') return null;
  const tier = valor.trim().toUpperCase();
  return /^TIER_[A-Z0-9]+$/.test(tier) ? tier : null;
}

/**
 * O limite numa leitura PRÓPRIA, depois da nota: se a Graph recusar o campo,
 * a nota já foi gravada. Até 12/11/2026 o CRM nunca pediu o limite, e o teto
 * da Meta ficava "não sei" (migração 20261112110000).
 */
async function lerLimiteDoNumero(ctx: ContextoDaSaude, numero: string | null): Promise<void> {
  const lido = await ctx.graph.ler(ctx.phoneNumberId, { fields: CAMPO_DO_LIMITE });
  if (!lido.ok) {
    ctx.logger.warn('a Meta não disse o limite de conversas do número', {
      phone_number_id: ctx.phoneNumberId,
      codigo: lido.codigo,
    });
    return;
  }
  const tier = limiteDaResposta(lido.json);
  if (tier === null) return;
  await registrarSaude(ctx.cliente, {
    numero,
    origem: 'graph',
    campo: 'phone_number',
    evento: 'LIMITE',
    limite_atual: tier,
    payload: lido.json,
  });
  ctx.logger.info('a Meta disse o limite de conversas do número', {
    phone_number_id: ctx.phoneNumberId,
    limite: tier,
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
