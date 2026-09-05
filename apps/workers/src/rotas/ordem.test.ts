import { describe, expect, it } from 'vitest';

import { matrizUtilizavel, resolverOrdem, trechosDaOrdem } from './ordem';

/**
 * A ordem das paradas. O que estes testes protegem:
 *
 * · rota ABERTA (ninguém volta à origem no fim da tarde) — somar a volta
 *   escolheria outro caminho;
 * · ótimo PROVADO até 7 paradas, que é o teto do RF-ROT-03;
 * · matriz com buraco (o OSRM devolve `null` quando não há caminho de carro)
 *   NÃO vira rota torta: vira `null`, e quem chama falha com motivo;
 * · empate resolve pela ordem de entrada, senão a mesma tarde sairia numa
 *   sequência diferente a cada recarregamento da tela.
 */

/** Matriz de um caminho reto: 0 → 1 → 2 → 3, cada salto 10, e voltar custa caro. */
function corredor(): number[][] {
  const n = 4;
  const m: number[][] = [];
  for (let i = 0; i < n; i += 1) {
    m.push(
      Array.from({ length: n }, (_, j) => (i === j ? 0 : j > i ? (j - i) * 10 : (i - j) * 1000)),
    );
  }
  return m;
}

describe('resolverOrdem', () => {
  it('devolve lista vazia quando não há parada', () => {
    expect(resolverOrdem([[0]], 0)).toEqual({ ordem: [], totalSegundos: 0, metodo: 'exaustiva' });
  });

  it('segue o corredor em vez de zigue-zaguear', () => {
    const resultado = resolverOrdem(corredor(), 3);
    expect(resultado).not.toBeNull();
    expect(resultado?.ordem).toEqual([1, 2, 3]);
    expect(resultado?.totalSegundos).toBe(30);
    expect(resultado?.metodo).toBe('exaustiva');
  });

  it('não paga a volta para casa: rota aberta', () => {
    // Ir 0→1 custa 1, 1→2 custa 1, mas voltar de 2 para 0 custaria 100. Uma
    // solução de rota FECHADA evitaria terminar em 2; a aberta não se importa.
    const m = [
      [0, 1, 5],
      [1, 0, 1],
      [100, 1, 0],
    ];
    expect(resolverOrdem(m, 2)?.ordem).toEqual([1, 2]);
    expect(resolverOrdem(m, 2)?.totalSegundos).toBe(2);
  });

  it('acha o ótimo numa matriz assimétrica (mão única muda o caminho)', () => {
    // 0→2 é barato, mas de 2 só se sai caro; o ótimo é 1, 2, 3 mesmo assim.
    const m = [
      [0, 10, 2, 30],
      [10, 0, 3, 8],
      [50, 40, 0, 4],
      [30, 8, 4, 0],
    ];
    const resultado = resolverOrdem(m, 3);
    // Confere contra a força bruta escrita à mão, para o teste não repetir a
    // implementação: todas as 6 ordens possíveis.
    const ordens = [
      [1, 2, 3],
      [1, 3, 2],
      [2, 1, 3],
      [2, 3, 1],
      [3, 1, 2],
      [3, 2, 1],
    ];
    const custos = ordens.map((o) => {
      let total = 0;
      let atual = 0;
      for (const p of o) {
        total += m[atual]?.[p] ?? 0;
        atual = p;
      }
      return total;
    });
    expect(resultado?.totalSegundos).toBe(Math.min(...custos));
  });

  it('no empate mantém a ordem de entrada (a mesma tarde não reordena sozinha)', () => {
    // Tudo custa 5: as seis ordens empatam. Só uma pode sair, sempre a mesma.
    const m = [
      [0, 5, 5, 5],
      [5, 0, 5, 5],
      [5, 5, 0, 5],
      [5, 5, 5, 0],
    ];
    expect(resolverOrdem(m, 3)?.ordem).toEqual([1, 2, 3]);
    expect(resolverOrdem(m, 3)?.ordem).toEqual(resolverOrdem(m, 3)?.ordem);
  });

  it('recusa a matriz quando o OSRM não achou caminho para uma parada', () => {
    const m = [
      [0, 10, Number.NaN],
      [10, 0, 5],
      [Number.NaN, 5, 0],
    ];
    expect(matrizUtilizavel(m, 2)).toBe(false);
    expect(resolverOrdem(m, 2)).toBeNull();
  });

  it('recusa matriz de tamanho errado em vez de ordenar por acaso', () => {
    expect(resolverOrdem([[0, 1]], 3)).toBeNull();
    expect(resolverOrdem([[0, 1], [1]], 1)).toBeNull();
  });

  it('acima do teto exaustivo usa heurística, e ela não piora o vizinho mais próximo', () => {
    // 9 paradas em linha: o vizinho mais próximo já acha o ótimo, e o 2-opt
    // não pode estragá-lo.
    const n = 10;
    const m = Array.from({ length: n }, (_, i) =>
      Array.from({ length: n }, (_, j) => Math.abs(i - j) * 7),
    );
    const resultado = resolverOrdem(m, n - 1);
    expect(resultado?.metodo).toBe('vizinho+2opt');
    expect(resultado?.ordem).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(resultado?.totalSegundos).toBe(63);
  });
});

describe('trechosDaOrdem', () => {
  it('recorta tempo e distância trecho a trecho, começando na origem', () => {
    const tempos = [
      [0, 100, 200],
      [100, 0, 50],
      [200, 50, 0],
    ];
    const distancias = [
      [0, 1000, 2000],
      [1000, 0, 500],
      [2000, 500, 0],
    ];
    expect(trechosDaOrdem(tempos, distancias, [2, 1])).toEqual([
      { segundos: 200, metros: 2000 },
      { segundos: 50, metros: 500 },
    ]);
  });

  it('trecho sem número vira zero, não NaN escondido no total', () => {
    const tempos = [
      [0, Number.NaN],
      [Number.NaN, 0],
    ];
    expect(trechosDaOrdem(tempos, tempos, [1])).toEqual([{ segundos: 0, metros: 0 }]);
  });
});
