import { describe, expect, it } from 'vitest';

import type { Temperature } from '@komune/schema';

import type { MudancaDeEtapa } from './dados';
import { montarSerie, primeiroDiaComHistorico } from './serie-temperatura';

/** Prospectado é frio, Respondeu é morno, Reunião marcada é quente. */
const TEMPERATURA_POR_ETAPA = new Map<number, Temperature>([
  [1, 'frio'],
  [3, 'morno'],
  [5, 'quente'],
]);

/** O fuso é America/Fortaleza (UTC-3): 02:00 UTC ainda é o dia anterior em Natal. */
const MUDANCAS: MudancaDeEtapa[] = [
  { deal_id: 'a', to_stage_id: 1, changed_at: '2026-09-02T12:00:00Z' },
  { deal_id: 'b', to_stage_id: 1, changed_at: '2026-09-03T12:00:00Z' },
  { deal_id: 'a', to_stage_id: 3, changed_at: '2026-09-03T18:00:00Z' },
  { deal_id: 'a', to_stage_id: 5, changed_at: '2026-09-05T02:00:00Z' },
];

const DIAS = ['2026-09-02', '2026-09-03', '2026-09-04', '2026-09-05'];

describe('montarSerie', () => {
  it('conta cada negócio na temperatura da etapa em que ele estava no fim do dia', () => {
    const serie = montarSerie(MUDANCAS, TEMPERATURA_POR_ETAPA, DIAS);

    expect(serie.map((ponto) => ponto.total)).toEqual([1, 2, 2, 2]);
    expect(serie[0]?.porTemperatura.frio).toBe(1);
    // No dia 3 o negócio "a" já respondeu: um morno e um frio.
    expect(serie[1]?.porTemperatura).toMatchObject({ frio: 1, morno: 1, quente: 0 });
  });

  it('põe a mudança das 02:00 UTC no dia 4, que é o dia dela em Natal', () => {
    const serie = montarSerie(MUDANCAS, TEMPERATURA_POR_ETAPA, DIAS);
    // 05/09 às 02:00 UTC é 04/09 às 23:00 em Natal: o negócio já entra quente no dia 4.
    expect(serie[2]?.porTemperatura).toMatchObject({ frio: 1, morno: 0, quente: 1 });
    // E o dia 5, sem mudança nova, repete a foto do dia 4.
    expect(serie[3]?.porTemperatura).toMatchObject({ frio: 1, morno: 0, quente: 1 });
  });

  it('ignora etapa que não está no mapa, em vez de contar errado', () => {
    const serie = montarSerie(
      [{ deal_id: 'z', to_stage_id: 99, changed_at: '2026-09-02T12:00:00Z' }],
      TEMPERATURA_POR_ETAPA,
      DIAS,
    );
    expect(serie.every((ponto) => ponto.total === 0)).toBe(true);
  });

  it('devolve um ponto por dia pedido, mesmo sem histórico nenhum', () => {
    expect(montarSerie([], TEMPERATURA_POR_ETAPA, DIAS)).toHaveLength(4);
  });
});

describe('primeiroDiaComHistorico', () => {
  it('devolve o dia da primeira mudança, no fuso de Natal', () => {
    expect(primeiroDiaComHistorico(MUDANCAS)).toBe('2026-09-02');
  });

  it('devolve nulo quando não há histórico', () => {
    expect(primeiroDiaComHistorico([])).toBeNull();
  });
});
