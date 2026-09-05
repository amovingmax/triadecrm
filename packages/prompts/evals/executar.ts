import { describe, expect, it } from 'vitest';

/**
 * O executor dos evals.
 *
 * Um eval que sempre passa não é eval: é decoração verde no CI. Por isso um caso pode
 * ser marcado como **conhecido** — a resposta certa está em `esperado`, a resposta que a
 * versão atual dá está em `conhecido.obtido`, e o teste afirma as duas coisas:
 *
 * - hoje o resultado é o errado conhecido, e
 * - o resultado errado **ainda não é** o certo.
 *
 * Consequência: no dia em que alguém melhorar o prompt ou a regra, o caso conhecido fica
 * VERMELHO. Isso é o comportamento desejado — é o aviso de que o caso virou régua nova e
 * deve ser promovido a caso normal (apagar o bloco `conhecido`). Eval que fica verde
 * quando o mundo melhora não mede nada.
 *
 * `conhecidosEsperados` é a segunda trava: o número de casos conhecidos é declarado na
 * chamada. Acrescentar um caso errado sem admitir que ele existe quebra a suíte.
 */

export interface CasoConhecido<Saida> {
  /** O que a versão atual devolve hoje. */
  readonly obtido: Saida;
  /** Por que erra, e o que precisaria mudar para acertar. */
  readonly motivo: string;
  /** Desde quando é conhecido, para o caso não envelhecer calado. */
  readonly desde: string;
}

export interface CasoDeEval<Entrada, Saida> {
  readonly nome: string;
  readonly entrada: Entrada;
  /** A resposta certa. É ela que o caso persegue, mesmo quando é conhecido. */
  readonly esperado: Saida;
  readonly conhecido?: CasoConhecido<Saida>;
}

export interface OpcoesDoEval {
  /** Quantos casos desta suíte a versão atual erra. Declarado, nunca descoberto. */
  readonly conhecidosEsperados: number;
}

export function rodarEvals<Entrada, Saida>(
  titulo: string,
  casos: readonly CasoDeEval<Entrada, Saida>[],
  executar: (entrada: Entrada) => Saida,
  opcoes: OpcoesDoEval,
): void {
  const conhecidos = casos.filter((caso) => caso.conhecido !== undefined);

  describe(titulo, () => {
    for (const caso of casos) {
      const { conhecido } = caso;
      if (conhecido === undefined) {
        it(caso.nome, () => {
          expect(executar(caso.entrada)).toEqual(caso.esperado);
        });
        continue;
      }
      it(`[conhecido] ${caso.nome} — ${conhecido.motivo} (desde ${conhecido.desde})`, () => {
        const obtido = executar(caso.entrada);
        expect(obtido).toEqual(conhecido.obtido);
        // Se esta linha falhar, o caso passou a acertar: apague o bloco `conhecido`.
        expect(obtido).not.toEqual(caso.esperado);
      });
    }

    it(`a régua: ${conhecidos.length} de ${casos.length} casos ainda erram`, () => {
      expect(conhecidos.map((caso) => caso.nome).length).toBe(opcoes.conhecidosEsperados);
    });
  });
}
