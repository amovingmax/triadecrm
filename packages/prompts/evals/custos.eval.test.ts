import { describe, expect, it } from 'vitest';

import {
  CATALOGO,
  CHAMADAS_POR_MES,
  FATOR_BATCH,
  LIMITE_DE_ALERTA_USD,
  ORCAMENTO_MENSAL_USD,
  PRECOS,
  VOLUME_MENSAL,
  avaliarOrcamento,
  custoDaChamada,
  estimarTokens,
  passouDoAlerta,
  projetar,
  promptVigente,
} from '../src/index';

/**
 * Custo por chamada e projeção do mês (PRD §10; `ai_runs.cost_usd`).
 *
 * Este arquivo é a fonte dos números de `docs/operacao/prompts-e-custos.md`: se um
 * prompt engordar, a conta muda aqui antes de o documento ficar mentiroso. Os preços são
 * os da API da Anthropic em 05/09/2026, em US$ por milhão de tokens.
 */

interface LinhaDaTabela {
  readonly id: string;
  readonly modelo: string;
  readonly tokensDeSistema: number;
  readonly tokensDaMensagem: number;
  readonly tokensDeSaida: number;
  readonly semCache: number;
  readonly comCache: number;
}

/** A mesma conta que o documento publica, feita a partir do primeiro exemplo de cada prompt. */
function tabela(): readonly LinhaDaTabela[] {
  return (Object.keys(CATALOGO) as (keyof typeof CATALOGO)[]).map((id) => {
    const prompt = promptVigente(id);
    const exemplo = prompt.exemplos[0];
    const tokensDaMensagem = estimarTokens(
      exemplo === undefined ? '' : prompt.montarMensagem(exemplo.entrada as never),
    );
    const tokensDeSaida = estimarTokens(exemplo === undefined ? '' : JSON.stringify(exemplo.saida));
    const tokensDeSistema = prompt.tokensDeSistema;
    return {
      id,
      modelo: prompt.modelo,
      tokensDeSistema,
      tokensDaMensagem,
      tokensDeSaida,
      semCache: custoDaChamada(prompt.modelo, {
        entrada: tokensDeSistema + tokensDaMensagem,
        saida: tokensDeSaida,
      }),
      comCache: custoDaChamada(prompt.modelo, {
        entrada: tokensDaMensagem,
        saida: tokensDeSaida,
        leituraDeCache: tokensDeSistema,
      }),
    };
  });
}

describe('preços e conta por chamada', () => {
  it('os preços da tabela são os da API em 05/09/2026', () => {
    expect(PRECOS['claude-haiku-4-5']).toEqual({
      entrada: 1.0,
      saida: 5.0,
      escritaDeCache: 1.25,
      leituraDeCache: 0.1,
    });
    expect(PRECOS['claude-sonnet-5']).toEqual({
      entrada: 2.0,
      saida: 10.0,
      escritaDeCache: 2.5,
      leituraDeCache: 0.2,
    });
  });

  it('um milhão de tokens custa exatamente o preço de tabela', () => {
    expect(custoDaChamada('claude-haiku-4-5', { entrada: 1_000_000, saida: 0 })).toBe(1);
    expect(custoDaChamada('claude-sonnet-5', { entrada: 0, saida: 1_000_000 })).toBe(10);
  });

  it('leitura de cache custa um décimo da entrada, e o Batch custa metade de tudo', () => {
    const cheio = custoDaChamada('claude-haiku-4-5', { entrada: 100_000, saida: 0 });
    const cacheado = custoDaChamada('claude-haiku-4-5', {
      entrada: 0,
      saida: 0,
      leituraDeCache: 100_000,
    });
    expect(cacheado).toBeCloseTo(cheio * 0.1, 5);
    expect(
      custoDaChamada('claude-haiku-4-5', { entrada: 100_000, saida: 0 }, { batch: true }),
    ).toBe(cheio * FATOR_BATCH);
  });

  it('a tabela publicada no documento bate com o código', () => {
    expect(tabela()).toEqual([
      {
        id: 'transcricao-audio',
        modelo: 'claude-haiku-4-5',
        tokensDeSistema: 446,
        tokensDaMensagem: 79,
        tokensDeSaida: 91,
        semCache: 0.00098,
        comCache: 0.00058,
      },
      {
        id: 'resumo-ligacao',
        modelo: 'claude-sonnet-5',
        tokensDeSistema: 486,
        tokensDaMensagem: 268,
        tokensDeSaida: 101,
        semCache: 0.00252,
        comCache: 0.00164,
      },
      {
        id: 'followup-ligacao',
        modelo: 'claude-sonnet-5',
        tokensDeSistema: 1154,
        tokensDaMensagem: 90,
        tokensDeSaida: 119,
        semCache: 0.00368,
        comCache: 0.0016,
      },
      {
        id: 'classificar-intencao',
        modelo: 'claude-haiku-4-5',
        tokensDeSistema: 966,
        tokensDaMensagem: 49,
        tokensDeSaida: 55,
        semCache: 0.00129,
        comCache: 0.00042,
      },
    ]);
  });
});

describe('projeção do mês e alerta de 80%', () => {
  it('as chamadas por mês saem das premissas de volume, não de palpite', () => {
    expect(VOLUME_MENSAL.ligacoesPorDia).toBe(60);
    expect(CHAMADAS_POR_MES).toEqual({
      'transcricao-audio': 252,
      'resumo-ligacao': 441,
      'followup-ligacao': 441,
      'classificar-intencao': 840,
    });
  });

  it('o mês inteiro, sem cache, fica em torno de US$ 4', () => {
    const total = tabela().reduce((soma, linha) => {
      const chamadas = CHAMADAS_POR_MES[linha.id] ?? 0;
      return soma + linha.semCache * chamadas;
    }, 0);
    expect(total).toBeGreaterThan(3.5);
    expect(total).toBeLessThan(4.5);
  });

  it('projetar devolve a linha que o documento publica', () => {
    const prompt = promptVigente('classificar-intencao');
    expect(
      projetar(prompt, { entrada: 1015, saida: 55 }, CHAMADAS_POR_MES['classificar-intencao'] ?? 0),
    ).toEqual({
      id: 'classificar-intencao',
      versao: 1,
      modelo: 'claude-haiku-4-5',
      chamadasPorMes: 840,
      custoPorChamada: 0.00129,
      custoMensal: 1.08,
    });
  });

  it('o alerta de 80% dispara no valor certo', () => {
    expect(ORCAMENTO_MENSAL_USD).toBe(25);
    expect(LIMITE_DE_ALERTA_USD).toBe(20);
    expect(passouDoAlerta(19.99)).toBe(false);
    expect(passouDoAlerta(20)).toBe(true);
  });

  it('o ritmo do mês avisa antes de o acumulado bater os 80%', () => {
    // Cinco dias úteis, US$ 9 gastos: o acumulado ainda não passou de 20, mas no ritmo
    // o mês fecha em 37,80 — e é este o aviso que chega a tempo.
    expect(avaliarOrcamento(9, 5)).toEqual({
      gastoUsd: 9,
      projecaoDoMesUsd: 37.8,
      situacao: 'ritmo_acima',
    });
    expect(avaliarOrcamento(1, 5).situacao).toBe('ok');
    expect(avaliarOrcamento(21, 20).situacao).toBe('passou_de_80');
  });
});
