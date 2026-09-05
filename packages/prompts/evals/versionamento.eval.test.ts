import { z } from 'zod';
import { describe, expect, it } from 'vitest';

import {
  CATALOGO,
  INVENTARIO,
  MODELOS,
  VIGENTES,
  definirPrompt,
  esquemaDeSaida,
  estimarTokens,
  obterPrompt,
  promptVigente,
  selecionar,
  versaoDoPrompt,
} from '../src/index';

/**
 * A promessa do pacote: **trocar a versão de um prompt não quebra quem chama a anterior.**
 *
 * A prova é feita com um catálogo de mentira de duas versões, porque hoje todos os
 * prompts estão em v1 e uma promessa só vale quando é exercitada. As duas versões têm
 * schemas de saída diferentes de propósito: se `selecionar` perdesse o tipo da versão
 * pedida, este arquivo não compilaria.
 */

const v1 = definirPrompt({
  id: 'exemplo',
  versao: 1,
  modelo: MODELOS.haiku,
  proposito: 'classify_inbound' as const,
  entrada: z.object({ texto: z.string() }),
  saida: z.object({ rotulo: z.string() }),
  sistema: 'v1: devolve um rótulo.',
  camposDeTexto: ['texto'],
  camposDoTriade: [],
  maxTokens: 100,
  montarMensagem: (dados) => dados.texto,
  exemplos: [],
});

const v2 = definirPrompt({
  id: 'exemplo',
  versao: 2,
  modelo: MODELOS.sonnet,
  proposito: 'classify_inbound' as const,
  entrada: z.object({ texto: z.string(), contexto: z.string().nullable() }),
  // A v2 acrescenta um campo obrigatório na saída: é a mudança que quebraria quem
  // continuasse lendo a v1 se o catálogo devolvesse a versão errada.
  saida: z.object({ rotulo: z.string(), confianca: z.number() }),
  sistema: 'v2: devolve um rótulo e a confiança.',
  camposDeTexto: ['texto', 'contexto'],
  camposDoTriade: [],
  maxTokens: 200,
  montarMensagem: (dados) => `${dados.contexto ?? '—'}\n${dados.texto}`,
  exemplos: [],
});

const CATALOGO_DE_TESTE = { exemplo: { 1: v1, 2: v2 } } as const;

describe('versionamento: a v2 não mexe na v1', () => {
  it('cada versão devolve a si mesma, com o próprio modelo e o próprio texto', () => {
    expect(selecionar(CATALOGO_DE_TESTE, 'exemplo', 1).modelo).toBe('claude-haiku-4-5');
    expect(selecionar(CATALOGO_DE_TESTE, 'exemplo', 2).modelo).toBe('claude-sonnet-5');
    expect(selecionar(CATALOGO_DE_TESTE, 'exemplo', 1).sistema).toContain('v1:');
    expect(selecionar(CATALOGO_DE_TESTE, 'exemplo', 2).sistema).toContain('v2:');
  });

  it('cada versão valida com o próprio schema', () => {
    const daV1 = selecionar(CATALOGO_DE_TESTE, 'exemplo', 1);
    const daV2 = selecionar(CATALOGO_DE_TESTE, 'exemplo', 2);
    // O que serve para a v1 continua servindo, mesmo com a v2 publicada.
    expect(daV1.saida.parse({ rotulo: 'ok' })).toEqual({ rotulo: 'ok' });
    // E a v2 exige o que a v1 não exigia.
    expect(() => daV2.saida.parse({ rotulo: 'ok' })).toThrow();
    expect(daV2.saida.parse({ rotulo: 'ok', confianca: 0.9 })).toEqual({
      rotulo: 'ok',
      confianca: 0.9,
    });
  });

  it('o tipo da versão pedida é preservado em tempo de compilação', () => {
    // Se `selecionar` devolvesse um tipo apagado, `rotulo` não existiria aqui.
    const saidaDaV1: { rotulo: string } = selecionar(CATALOGO_DE_TESTE, 'exemplo', 1).saida.parse({
      rotulo: 'ok',
    });
    const saidaDaV2: { rotulo: string; confianca: number } = selecionar(
      CATALOGO_DE_TESTE,
      'exemplo',
      2,
    ).saida.parse({ rotulo: 'ok', confianca: 0.5 });
    expect(saidaDaV1.rotulo).toBe('ok');
    expect(saidaDaV2.confianca).toBe(0.5);
  });

  it('pedir uma versão que não existe falha com o id e a versão na mensagem', () => {
    const catalogo = CATALOGO_DE_TESTE as unknown as Record<
      string,
      Record<number, { readonly versao: number }>
    >;
    expect(() => selecionar(catalogo, 'exemplo', 7)).toThrow(/exemplo@v7/);
    expect(() => selecionar(catalogo, 'inexistente', 1)).toThrow(/inexistente@v1/);
  });

  it('uma versão publicada é imutável', () => {
    expect(Object.isFrozen(v1)).toBe(true);
    expect(() => {
      (v1 as { maxTokens: number }).maxTokens = 999;
    }).toThrow();
  });
});

describe('catálogo do Tríade', () => {
  it('tem os quatro prompts, na ordem de prioridade do R13', () => {
    expect(Object.keys(CATALOGO)).toEqual([
      'transcricao-audio',
      'resumo-ligacao',
      'followup-ligacao',
      'classificar-intencao',
    ]);
  });

  it('toda versão vigente existe no catálogo', () => {
    for (const [id, versao] of Object.entries(VIGENTES)) {
      const prompt = selecionar(CATALOGO, id as keyof typeof CATALOGO, versao);
      expect(prompt.versao).toBe(versao);
    }
  });

  it('obterPrompt e promptVigente apontam para o mesmo objeto enquanto a vigente for a v1', () => {
    expect(obterPrompt('resumo-ligacao', 1)).toBe(promptVigente('resumo-ligacao'));
  });

  it('o id da versão que vai para ai_runs é id@vN', () => {
    expect(versaoDoPrompt(obterPrompt('followup-ligacao', 1))).toBe('followup-ligacao@v1');
  });

  it('cada prompt tem um propósito distinto: é por ele que o custo é agrupado', () => {
    const propositos = INVENTARIO.map((prompt) => prompt.proposito);
    expect(new Set(propositos).size).toBe(propositos.length);
  });

  it('o tamanho do bloco estável acompanha o texto, sem número escrito à mão', () => {
    for (const id of Object.keys(CATALOGO) as (keyof typeof CATALOGO)[]) {
      const prompt = promptVigente(id);
      expect(prompt.tokensDeSistema, id).toBe(estimarTokens(prompt.sistema));
    }
    for (const metadados of INVENTARIO) {
      expect(metadados.tokensDeSistema, metadados.id).toBeGreaterThan(0);
    }
  });

  it('todo campo declarado como texto existe no schema de entrada', () => {
    for (const id of Object.keys(CATALOGO) as (keyof typeof CATALOGO)[]) {
      const prompt = promptVigente(id);
      const forma = z.toJSONSchema(prompt.entrada) as {
        properties?: Record<string, unknown>;
      };
      for (const campo of prompt.camposDeTexto) {
        expect(Object.keys(forma.properties ?? {}), `${id}.${campo}`).toContain(campo);
      }
    }
  });

  it('todo schema de saída vira JSON Schema para a saída estruturada', () => {
    for (const id of Object.keys(CATALOGO) as (keyof typeof CATALOGO)[]) {
      expect(esquemaDeSaida(promptVigente(id))['type'], id).toBe('object');
    }
  });
});
