/**
 * A ordem das paradas da tarde, a partir da matriz de tempos do OSRM (RF-ROT-03).
 *
 * ## Este arquivo não sabe o que é uma rua
 *
 * Ele recebe uma matriz de tempos JÁ CALCULADA pelo OSRM sobre o grafo de ruas
 * do Rio Grande do Norte e escolhe a ordem que soma menos tempo. Nada aqui
 * calcula distância: não existe Haversine, não existe "linha reta" e não existe
 * fallback que finja rota quando o OSRM não responde. Se a matriz não chegou,
 * quem chama trata o erro — inventar uma ordem por proximidade em linha reta e
 * chamar de rota seria mandar a Heloísa atravessar o Rio Potengi a pé.
 *
 * ## Por que o problema é pequeno, e por que isso importa
 *
 * O RF-ROT-03 fecha a tarde em 3 a 6 visitas, teto 6. Com 6 paradas e origem
 * fixa existem 6! = 720 ordens possíveis: dá para testar TODAS e ter a ordem
 * ótima de verdade, em menos de um milissegundo. Heurística com nome bonito só
 * entra acima disso — e acima disso, hoje, não existe.
 *
 * É rota ABERTA: começa na origem e termina na última visita. Ninguém volta ao
 * ponto de partida no fim da tarde (a Heloísa vai para casa), então somar o
 * trecho de volta empurraria a ordem para o lado errado.
 *
 * ## Empate
 *
 * Duas ordens com o mesmo tempo total acontecem o tempo todo aqui, porque
 * várias paradas dividem o MESMO centroide de bairro (seis fornecedores em
 * Capim Macio são um ponto só para o OSRM, com 0 s entre eles). O desempate é
 * pelo horário da tarefa, e depois pela posição original: a mesma entrada
 * sempre devolve a mesma saída, senão a tela reordenaria sozinha a cada
 * recarregamento.
 */

/** Matriz quadrada de durações em segundos. `m[i][j]` = tempo de i até j. */
export type MatrizDeTempos = readonly (readonly number[])[];

export type ResultadoDaOrdem = {
  /** Índices das paradas (1..n na matriz), na ordem de visita. */
  ordem: number[];
  /** Soma dos trechos, em segundos, da origem até a última parada. */
  totalSegundos: number;
  /** `exaustiva` = ótimo provado; `vizinho+2opt` = heurística (7 paradas ou mais). */
  metodo: 'exaustiva' | 'vizinho+2opt';
};

/** Teto acima do qual a busca exaustiva deixa de caber no tempo de uma tela. */
const TETO_EXAUSTIVO = 7;

function soma(matriz: MatrizDeTempos, ordem: readonly number[]): number {
  let total = 0;
  let atual = 0;
  for (const proximo of ordem) {
    total += valor(matriz, atual, proximo);
    atual = proximo;
  }
  return total;
}

function valor(matriz: MatrizDeTempos, de: number, para: number): number {
  const linha = matriz[de];
  const v = linha?.[para];
  return typeof v === 'number' && Number.isFinite(v) ? v : Number.POSITIVE_INFINITY;
}

/**
 * A matriz é utilizável? O OSRM devolve `null` no lugar do tempo quando não
 * encontra caminho entre dois pontos (ilha, coordenada no meio do mar). Uma
 * matriz assim não vira rota, e é melhor dizer isso do que ordenar por acaso.
 */
export function matrizUtilizavel(matriz: MatrizDeTempos, n: number): boolean {
  if (matriz.length !== n + 1) return false;
  for (let i = 0; i <= n; i += 1) {
    const linha = matriz[i];
    if (!linha || linha.length !== n + 1) return false;
    for (let j = 0; j <= n; j += 1) {
      if (i !== j && !Number.isFinite(linha[j])) return false;
    }
  }
  return true;
}

/** Todas as permutações de `itens`, em ordem lexicográfica estável. */
function permutacoes(itens: readonly number[]): number[][] {
  if (itens.length <= 1) return [[...itens]];
  const saida: number[][] = [];
  for (let i = 0; i < itens.length; i += 1) {
    const cabeca = itens[i] as number;
    const resto = [...itens.slice(0, i), ...itens.slice(i + 1)];
    for (const cauda of permutacoes(resto)) saida.push([cabeca, ...cauda]);
  }
  return saida;
}

function vizinhoMaisProximo(matriz: MatrizDeTempos, n: number): number[] {
  const faltando = new Set<number>(Array.from({ length: n }, (_, i) => i + 1));
  const ordem: number[] = [];
  let atual = 0;
  while (faltando.size > 0) {
    let melhor = -1;
    let melhorTempo = Number.POSITIVE_INFINITY;
    for (const candidato of faltando) {
      const t = valor(matriz, atual, candidato);
      // `<` e não `<=`: no empate fica o de menor índice, que é o mais cedo na
      // agenda (a lista chega ordenada por horário).
      if (t < melhorTempo) {
        melhorTempo = t;
        melhor = candidato;
      }
    }
    if (melhor < 0) break;
    ordem.push(melhor);
    faltando.delete(melhor);
    atual = melhor;
  }
  return ordem;
}

function doisOpt(matriz: MatrizDeTempos, inicial: readonly number[]): number[] {
  let melhor = [...inicial];
  let melhorTotal = soma(matriz, melhor);
  let melhorou = true;
  while (melhorou) {
    melhorou = false;
    for (let i = 0; i < melhor.length - 1; i += 1) {
      for (let j = i + 1; j < melhor.length; j += 1) {
        const candidato = [
          ...melhor.slice(0, i),
          ...melhor.slice(i, j + 1).reverse(),
          ...melhor.slice(j + 1),
        ];
        const total = soma(matriz, candidato);
        if (total < melhorTotal - 1e-9) {
          melhor = candidato;
          melhorTotal = total;
          melhorou = true;
        }
      }
    }
  }
  return melhor;
}

/**
 * A ordem de visita das `n` paradas (índices 1..n da matriz), partindo do
 * índice 0 (a origem).
 *
 * Devolve `null` quando a matriz não serve — e "não serve" inclui o caso em que
 * o OSRM não achou caminho para uma das paradas. Nesse caso a rota FALHA, com
 * motivo, em vez de sair torta.
 */
export function resolverOrdem(matriz: MatrizDeTempos, n: number): ResultadoDaOrdem | null {
  if (n <= 0) return { ordem: [], totalSegundos: 0, metodo: 'exaustiva' };
  if (!matrizUtilizavel(matriz, n)) return null;

  const indices = Array.from({ length: n }, (_, i) => i + 1);

  if (n <= TETO_EXAUSTIVO) {
    let melhor = indices;
    let melhorTotal = Number.POSITIVE_INFINITY;
    for (const candidato of permutacoes(indices)) {
      const total = soma(matriz, candidato);
      // Estritamente menor: o primeiro candidato de um empate vence, e o
      // primeiro é sempre o que respeita a ordem de chegada da lista.
      if (total < melhorTotal - 1e-9) {
        melhorTotal = total;
        melhor = candidato;
      }
    }
    return { ordem: melhor, totalSegundos: melhorTotal, metodo: 'exaustiva' };
  }

  const ordem = doisOpt(matriz, vizinhoMaisProximo(matriz, n));
  return { ordem, totalSegundos: soma(matriz, ordem), metodo: 'vizinho+2opt' };
}

/** Os trechos (tempo e distância) de uma ordem já resolvida, na sequência. */
export function trechosDaOrdem(
  tempos: MatrizDeTempos,
  distancias: MatrizDeTempos,
  ordem: readonly number[],
): { segundos: number; metros: number }[] {
  const trechos: { segundos: number; metros: number }[] = [];
  let atual = 0;
  for (const proximo of ordem) {
    const s = valor(tempos, atual, proximo);
    const m = valor(distancias, atual, proximo);
    trechos.push({
      segundos: Number.isFinite(s) ? Math.round(s) : 0,
      metros: Number.isFinite(m) ? Math.round(m) : 0,
    });
    atual = proximo;
  }
  return trechos;
}
