import type { Temperature } from '@komune/schema';

// Importa o módulo puro da escala, e não o índice de `components/temperatura`: o
// índice arrasta os componentes de tela (e o `motion`) para dentro de um arquivo que
// é só conta, e que roda no Vitest em ambiente node.
import { TEMPERATURAS_EM_ORDEM } from '@/components/temperatura/escala-termica';

import type { MudancaDeEtapa } from './dados';
import { diaDoInstante } from './periodo';

/**
 * A composição da base por temperatura, dia a dia, reconstruída do histórico de etapas.
 *
 * A regra é uma só: no fim de cada dia, cada negócio carrega a temperatura da etapa
 * em que estava naquele momento (PRD §5.6 — a etapa é o primeiro termo da fórmula de
 * temperatura). Não é a mesma coisa que `deals.temperature`, que também conta dias sem
 * contato e a última intenção declarada; por isso a tela mostra as duas leituras
 * separadas e diz qual é qual, em vez de fingir que são um número só.
 *
 * Lógica pura, sem rede e sem React, para poder ser testada.
 */

export type PontoDaSerie = {
  dia: string;
  total: number;
  porTemperatura: Record<Temperature, number>;
};

function zerado(): Record<Temperature, number> {
  const mapa = {} as Record<Temperature, number>;
  for (const definicao of TEMPERATURAS_EM_ORDEM) mapa[definicao.valor] = 0;
  return mapa;
}

/**
 * Percorre os dias uma vez só, aplicando as mudanças que já aconteceram até o fim de
 * cada um. As mudanças precisam vir ordenadas por `changed_at` (é como o banco as
 * devolve); mudança de etapa desconhecida (funil filtrado) é ignorada.
 */
export function montarSerie(
  mudancas: readonly MudancaDeEtapa[],
  temperaturaPorEtapa: ReadonlyMap<number, Temperature>,
  dias: readonly string[],
): PontoDaSerie[] {
  const temperaturaDoNegocio = new Map<string, Temperature>();
  let proxima = 0;

  return dias.map((dia) => {
    while (proxima < mudancas.length) {
      const mudanca = mudancas[proxima];
      if (!mudanca || diaDoInstante(mudanca.changed_at) > dia) break;
      const temperatura = temperaturaPorEtapa.get(mudanca.to_stage_id);
      if (temperatura) temperaturaDoNegocio.set(mudanca.deal_id, temperatura);
      proxima += 1;
    }

    const porTemperatura = zerado();
    for (const temperatura of temperaturaDoNegocio.values()) {
      porTemperatura[temperatura] += 1;
    }
    return { dia, total: temperaturaDoNegocio.size, porTemperatura };
  });
}

/** O primeiro dia com mudança registrada, ou `null` quando não há histórico. */
export function primeiroDiaComHistorico(mudancas: readonly MudancaDeEtapa[]): string | null {
  const primeira = mudancas[0];
  return primeira ? diaDoInstante(primeira.changed_at) : null;
}
