import { describe, expect, it } from 'vitest';

import { VIGENTES, obterPrompt, promptVigente } from '../src/catalogo';
import { varrerMontagem } from '../src/nucleo/auditoria-pii';
import { prepararChamada } from '../src/nucleo/chamada';
import { atendenteImovaV4 as v4 } from '../src/prompts/atendente-imova/v4';
import {
  FRASE_DA_VISITA,
  atendenteImovaV5 as v5,
  sistemaComBaseV5,
  trocarBloco,
} from '../src/prompts/atendente-imova/v5';
import { type CenarioDoAtendente, conferirCenario } from '../src/prompts/atendente-imova/cenarios-v3';
import { CENARIOS_DO_ATENDENTE_V4 } from '../src/prompts/atendente-imova/cenarios-v4';
import {
  BASE_DO_ENSAIO_V5,
  CENARIOS_DO_ATENDENTE_V5,
  FRASE_DA_VISITA_NA_MENSAGEM,
} from '../src/prompts/atendente-imova/cenarios-v5';

/**
 * `atendente-imova@v5` (12/11/2026): A V4 COM A VISITA PRESENCIAL SEM LINK, SEM REDE.
 *
 * Decisão do usuário (caderno, 12/11/2026, e entrevista do mesmo dia): o link da agenda é
 * só de reunião online; na visita, a IA pergunta o dia e o período, diz "Vou consultar um
 * horário em que entre na minha agenda e te retorno pra combinarmos" e passa a conversa.
 * Prova-se aqui que a v5 é a v4 com só o bloco da agenda (e a linha da saída) trocados, e
 * que os cenários medem a troca.
 */

const CONTATO = {
  leadId: 'lead-1',
  nome: 'Janio Ramalho',
  empresa: null,
  telefones: ['+5584988776655'],
};

const comBase = { ...v5, sistema: sistemaComBaseV5(BASE_DO_ENSAIO_V5) };

describe('atendente-imova@v5: o contrato', () => {
  it('é a vigente, e a v4 continua no catálogo', () => {
    expect(VIGENTES['atendente-imova']).toBe(5);
    expect(promptVigente('atendente-imova')).toBe(v5);
    expect(obterPrompt('atendente-imova', 5)).toBe(v5);
    expect(obterPrompt('atendente-imova', 4)).toBe(v4);
    expect(v5.versao).toBe(5);
  });

  it('a entrada, a saída, o modelo e a montagem são os da v4 (e da v3)', () => {
    expect(v5.entrada).toBe(v4.entrada);
    expect(v5.saida).toBe(v4.saida);
    expect(v5.modelo).toBe(v4.modelo);
    expect(v5.proposito).toBe(v4.proposito);
    expect(v5.montarMensagem).toBe(v4.montarMensagem);
    expect(v5.camposDoTriade).toEqual(v4.camposDoTriade);
    expect(v5.exemplos).toBe(v4.exemplos);
  });

  it('a visita não tem mais link, e a frase do usuário está lá, palavra por palavra', () => {
    expect(v4.sistema).toContain('A VISITA E A REUNIÃO (acao = enviar_link_da_agenda):');
    expect(v5.sistema).not.toContain('A VISITA E A REUNIÃO');
    expect(v5.sistema).not.toContain('mande o link. "rascunho"');
    expect(v5.sistema).toContain('A REUNIÃO ONLINE (acao = enviar_link_da_agenda):');
    expect(v5.sistema).toContain('A VISITA PRESENCIAL (ir ver um imóvel ou terreno): NUNCA mande o link');
    expect(v5.sistema).toContain(FRASE_DA_VISITA);
    expect(FRASE_DA_VISITA).toBe(
      'Vou consultar um horário em que entre na minha agenda e te retorno pra combinarmos.',
    );
    expect(v5.sistema).toContain('sempre {"tipo": "reuniao"');
  });

  it('fora do bloco da agenda e da linha da saída, o texto é o da v4, na mesma ordem', () => {
    const corte = (s: string): [string, string] => {
      const de = s.indexOf(s.includes('A VISITA E A REUNIÃO') ? 'A VISITA E A REUNIÃO' : 'A REUNIÃO ONLINE');
      const ate = s.indexOf('O QUE É DE GENTE');
      return [s.slice(0, de), s.slice(ate)];
    };
    const [antesV4, depoisV4] = corte(v4.sistema);
    const [antesV5, depoisV5] = corte(v5.sistema);
    expect(antesV5).toBe(antesV4);
    const soNaV4 = depoisV4.split('\n').filter((l) => !depoisV5.split('\n').includes(l));
    const soNaV5 = depoisV5.split('\n').filter((l) => !depoisV4.split('\n').includes(l));
    expect(soNaV4).toEqual([
      '- `agenda`: só em enviar_link_da_agenda (o tipo, e o código do imóvel na visita); senão',
      '  null.',
    ]);
    expect(soNaV5).toEqual([
      '- `agenda`: só em enviar_link_da_agenda, e então sempre {"tipo": "reuniao",',
      '  "imovelCodigo": null}; senão null.',
    ]);
  });

  it('a troca de bloco recusa marcador ausente, repetido ou fora de ordem', () => {
    expect(trocarBloco('a [x] b [y] c', '[x]', '[y]', 'N')).toBe('a N[y] c');
    expect(() => trocarBloco('a b', '[x]', 'b', 'N')).toThrow(/0 e 1 vez/);
    expect(() => trocarBloco('[x] [x] [y]', '[x]', '[y]', 'N')).toThrow(/2 e 1 vez/);
    expect(() => trocarBloco('[y] [x]', '[x]', '[y]', 'N')).toThrow(/antes do começo/);
  });

  it('o bloco de sistema com a base não tem dado pessoal', () => {
    expect(varrerMontagem(sistemaComBaseV5(BASE_DO_ENSAIO_V5))).toEqual([]);
  });
});

describe('atendente-imova@v5: os cenários do ensaio', () => {
  it('são os da v4, com as visitas trocadas e três a mais', () => {
    expect(CENARIOS_DO_ATENDENTE_V5).toHaveLength(CENARIOS_DO_ATENDENTE_V4.length + 3);
    const nomes = CENARIOS_DO_ATENDENTE_V5.map((c) => c.nome);
    expect(new Set(nomes).size).toBe(nomes.length);
    // Nenhum cenário da v5 aceita link de visita.
    for (const c of CENARIOS_DO_ATENDENTE_V5) {
      if (c.espera.acoes.includes('enviar_link_da_agenda')) {
        expect(c.espera.agenda?.tipo, c.nome).toBe('reuniao');
      }
    }
  });

  it('toda conversa passa pelo schema e pela auditoria, com a base do ensaio', () => {
    for (const cenario of CENARIOS_DO_ATENDENTE_V5) {
      expect(() => prepararChamada(comBase, cenario.entrada, CONTATO), cenario.nome).not.toThrow();
    }
  });

  it('a resposta boa de cada cenário passa pelo schema e pelo conferidor', () => {
    for (const cenario of CENARIOS_DO_ATENDENTE_V5) {
      expect(() => v5.saida.parse(cenario.respostaBoa), cenario.nome).not.toThrow();
      expect(conferirCenario(cenario, cenario.respostaBoa), cenario.nome).toEqual([]);
    }
  });

  const cenario = (trecho: RegExp): CenarioDoAtendente => {
    const achado = CENARIOS_DO_ATENDENTE_V5.find((c) => trecho.test(c.nome));
    if (achado === undefined) throw new Error(`sem o cenário ${trecho.source}`);
    return achado;
  };

  it('o link da visita é erro em todo cenário de visita', () => {
    const deVisita = CENARIOS_DO_ATENDENTE_V5.filter((c) => !c.espera.acoes.includes('enviar_link_da_agenda'));
    expect(deVisita.length).toBeGreaterThan(8);
    for (const c of deVisita) {
      expect(
        conferirCenario(c, {
          ...c.respostaBoa,
          acao: 'enviar_link_da_agenda',
          agenda: { tipo: 'visita', imovelCodigo: 'IM0007' },
          mensagem: 'Vou te mandar o link da agenda para você escolher o horário da visita.',
        }),
        c.nome,
      ).not.toEqual([]);
    }
  });

  it('com o dia dito, perguntar de novo é erro, e a frase sem passar também', () => {
    const respondeu = cenario(/^respondeu o dia da visita/);
    expect(
      conferirCenario(respondeu, {
        ...respondeu.respostaBoa,
        acao: 'responder',
        mensagem: 'Qual dia e período ficam melhores pra você?',
      }),
    ).not.toEqual([]);
    expect(
      conferirCenario(respondeu, { ...respondeu.respostaBoa, acao: 'responder' }),
    ).not.toEqual([]);
    expect(
      conferirCenario(respondeu, {
        ...respondeu.respostaBoa,
        mensagem: 'Vou verificar e te retorno.',
      }),
    ).not.toEqual([]);
    expect(FRASE_DA_VISITA_NA_MENSAGEM.test(FRASE_DA_VISITA)).toBe(true);
  });

  it('o horário proposto não pode virar visita marcada', () => {
    const amanha = cenario(/amanhã às 10h/);
    expect(
      conferirCenario(amanha, {
        ...amanha.respostaBoa,
        mensagem: `Combinado, amanhã às 10h! ${FRASE_DA_VISITA}`,
      }),
    ).not.toEqual([]);
  });

  it('o link da reunião continua: pedido de novo, sai de novo', () => {
    const reuniao = cenario(/^pediu o link da reunião de novo/);
    expect(conferirCenario(reuniao, reuniao.respostaBoa)).toEqual([]);
    expect(
      conferirCenario(reuniao, { ...reuniao.respostaBoa, acao: 'responder', agenda: null }),
    ).not.toEqual([]);
  });
});
