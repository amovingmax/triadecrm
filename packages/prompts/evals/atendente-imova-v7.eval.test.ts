import { describe, expect, it } from 'vitest';

import { VIGENTES, obterPrompt } from '../src/catalogo';
import { varrerMontagem } from '../src/nucleo/auditoria-pii';
import { esquemaDeSaida, prepararChamada } from '../src/nucleo/chamada';
import { BASE_DO_ENSAIO_V5 } from '../src/prompts/atendente-imova/cenarios-v5';
import { atendenteImovaV6 as v6, sistemaComBaseV6 } from '../src/prompts/atendente-imova/v6';
import {
  FERRAMENTA_BUSCAR_NO_MAPA,
  MAX_BUSCAS_NO_MAPA,
  MAX_VOLTAS_DO_ATENDENTE,
  atendenteImovaV7 as v7,
  sistemaComBaseV7,
} from '../src/prompts/atendente-imova/v7';

/**
 * `atendente-imova@v7` (23/11/2026): A V6 COM A BUSCA NO MAPA.
 *
 * Pedido do usuário: "devemos passar a instrução para IA sempre buscar no mapa de acordo
 * com a referência que o cliente passou para que possamos ver se as informações batem."
 * Prova-se aqui que a v7 é a v6 com só a ferramenta e um parágrafo a mais, que a v6
 * continua intacta (é a volta, e o que o worker usa sem mapa), e que a montagem passa na
 * auditoria. O laço e a ferramenta se provam no worker (`busca-no-mapa.test.ts`).
 */

const CONTATO = { leadId: 'lead-21', nome: 'Alinne Fernandes', empresa: null, telefones: ['+5584988776655'] };

describe('atendente-imova@v7', () => {
  it('deu lugar à v8 (24/11/2026) e continua no catálogo; a v6 também, sem ferramenta', () => {
    expect(VIGENTES['atendente-imova']).toBe(8);
    expect(obterPrompt('atendente-imova', 7)).toBe(v7);
    expect(obterPrompt('atendente-imova', 6)).toBe(v6);
    expect(v6.ferramentas).toBeUndefined();
    expect(v6.sistema).not.toMatch(/buscar_no_mapa/);
  });

  it('é a v6 com a ferramenta e um parágrafo, e nada mais', () => {
    expect(v7.versao).toBe(7);
    expect(v7.sistema.startsWith(v6.sistema)).toBe(true);
    const acrescimo = v7.sistema.slice(v6.sistema.length);
    expect(acrescimo).toMatch(/^\n\nA BUSCA NO MAPA:/);
    expect(acrescimo).toMatch(/Quando usar e o que\s+fazer com o resultado está no caderno/);
    expect(acrescimo).toMatch(/não\s+é fato para dizer ao cliente/);
    expect(acrescimo.length).toBeLessThan(500);
    expect(v7.entrada).toBe(v6.entrada);
    expect(v7.saida).toBe(v6.saida);
    expect(v7.montarMensagem).toBe(v6.montarMensagem);
    expect(v7.exemplos).toBe(v6.exemplos);
    expect([v7.modelo, v7.proposito, v7.escala, v7.maxTokens]).toEqual([v6.modelo, v6.proposito, v6.escala, v6.maxTokens]);
    expect(esquemaDeSaida(v7)).toEqual(esquemaDeSaida(v6));
  });

  it('declara uma ferramenta, buscar_no_mapa, com referência e cidade opcional', () => {
    expect(v7.ferramentas).toEqual([FERRAMENTA_BUSCAR_NO_MAPA]);
    expect(FERRAMENTA_BUSCAR_NO_MAPA.nome).toBe('buscar_no_mapa');
    expect(FERRAMENTA_BUSCAR_NO_MAPA.entrada).toMatchObject({
      type: 'object',
      required: ['referencia'],
      additionalProperties: false,
    });
    expect(Object.keys(FERRAMENTA_BUSCAR_NO_MAPA.entrada.properties as object)).toEqual(['referencia', 'cidade']);
    expect(FERRAMENTA_BUSCAR_NO_MAPA.descricao).toMatch(/Até três buscas por resposta/);
    expect(MAX_BUSCAS_NO_MAPA).toBe(3);
    expect(MAX_VOLTAS_DO_ATENDENTE).toBe(5);
    expect(Object.isFrozen(v7.ferramentas)).toBe(true);
    // O prefixo cacheável conta o sistema e a ferramenta.
    expect(v7.tokensDeSistema).toBeGreaterThan(v6.tokensDeSistema);
  });

  it('a montagem com a base passa na auditoria, como a da v6', () => {
    expect(varrerMontagem(sistemaComBaseV7(BASE_DO_ENSAIO_V5))).toEqual([]);
    expect(sistemaComBaseV7(BASE_DO_ENSAIO_V5).startsWith(sistemaComBaseV6(BASE_DO_ENSAIO_V5))).toBe(false);
    const exemplo = v7.exemplos[0];
    if (exemplo === undefined) throw new Error('a v6 tem exemplos');
    const chamada = prepararChamada({ ...v7, sistema: sistemaComBaseV7(BASE_DO_ENSAIO_V5) }, exemplo.entrada, CONTATO);
    expect(chamada.sistema).toContain('A BUSCA NO MAPA:');
    expect(chamada.mensagem).toBe(prepararChamada({ ...v6, sistema: sistemaComBaseV6(BASE_DO_ENSAIO_V5) }, exemplo.entrada, CONTATO).mensagem);
  });
});
