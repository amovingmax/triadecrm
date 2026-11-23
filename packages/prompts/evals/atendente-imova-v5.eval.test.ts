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
import type { CenarioDoAtendente } from '../src/prompts/atendente-imova/cenarios-v3';
import { CENARIOS_DO_ATENDENTE_V4 } from '../src/prompts/atendente-imova/cenarios-v4';
import {
  BASE_DO_ENSAIO_V5,
  CENARIOS_DE_VISITA_V5,
  CENARIOS_DO_ATENDENTE_V5,
  CENARIOS_QUE_PERGUNTAM_O_DIA_V5,
  FRASE_DA_VISITA_NA_MENSAGEM,
  conferirCenarioV5,
} from '../src/prompts/atendente-imova/cenarios-v5';

/**
 * `atendente-imova@v5` (12/11/2026): A V4 COM A VISITA PRESENCIAL SEM LINK, SEM REDE.
 *
 * Decisão do usuário (caderno, 12/11/2026, e entrevista do mesmo dia): o link da agenda é
 * só de reunião online; na visita, a IA pergunta o dia e o período, diz "Vou consultar um
 * horário em que entre na minha agenda e te retorno pra combinarmos" e passa a conversa.
 * Prova-se aqui que a v5 é a v4 com só os trechos da agenda trocados, e que a régua
 * recusa as respostas erradas que a revisão de 12/11 achou passando.
 */

const CONTATO = {
  leadId: 'lead-1',
  nome: 'Janio Ramalho',
  empresa: null,
  telefones: ['+5584988776655'],
};

const comBase = { ...v5, sistema: sistemaComBaseV5(BASE_DO_ENSAIO_V5) };

describe('atendente-imova@v5: o contrato', () => {
  it('continua no catálogo (a vigente é a v6, desde 17/11/2026), e a v4 também', () => {
    expect(VIGENTES['atendente-imova']).toBe(7);
    expect(promptVigente('atendente-imova')).not.toBe(v5);
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
    expect(v5.sistema).toContain('A visita nunca fica sem passagem.');
    expect(v5.sistema).toContain('Imóvel "pausado": não pergunte o dia');
    expect(v5.sistema).toContain(FRASE_DA_VISITA);
    expect(FRASE_DA_VISITA).toBe(
      'Vou consultar um horário em que entre na minha agenda e te retorno pra combinarmos.',
    );
    expect(v5.sistema).toContain('sempre {"tipo": "reuniao"');
    // A reunião não leva imóvel embaixo, e não é "por vídeo" (o usuário disse "online").
    expect(v5.sistema).not.toContain('o CRM põe embaixo\n  o imóvel e o link');
    expect(v5.sistema).not.toMatch(/conversa por v[íi]deo/);
  });

  it('fora dos trechos trocados, o texto é o da v4, linha por linha e na mesma ordem', () => {
    const [antesV4, depoisV4] = [
      v4.sistema.slice(0, v4.sistema.indexOf('A VISITA E A REUNIÃO')),
      v4.sistema.slice(v4.sistema.indexOf('O QUE É DE GENTE')),
    ];
    const [antesV5, depoisV5] = [
      v5.sistema.slice(0, v5.sistema.indexOf('A REUNIÃO ONLINE')),
      v5.sistema.slice(v5.sistema.indexOf('O QUE É DE GENTE')),
    ];
    expect(antesV5).toBe(antesV4);
    const linhasV4 = depoisV4.split('\n');
    const linhasV5 = depoisV5.split('\n');
    const soNaV4 = linhasV4.filter((l) => !linhasV5.includes(l));
    const soNaV5 = linhasV5.filter((l) => !linhasV4.includes(l));
    // A regra de verdade 2 (o pausado), a linha da mensagem e a linha da agenda na saída.
    expect(soNaV4).toEqual([
      '   diga que vai confirmar a disponibilidade com o corretor antes de qualquer visita.',
      '- `mensagem`: o que vai para o cliente. No link da agenda, só o começo: o CRM põe embaixo',
      '  o imóvel e o link.',
      '- `agenda`: só em enviar_link_da_agenda (o tipo, e o código do imóvel na visita); senão',
      '  null.',
    ]);
    expect(soNaV5).toEqual([
      '   não afirme que está disponível; a visita a ele segue A VISITA PRESENCIAL.',
      '- `mensagem`: o que vai para o cliente. No link da agenda, só o começo: o CRM põe o link',
      '  embaixo.',
      '- `agenda`: só em enviar_link_da_agenda, e então sempre {"tipo": "reuniao",',
      '  "imovelCodigo": null}; senão null.',
    ]);
    // O resto, na mesma ordem e sem repetição.
    expect(linhasV5.filter((l) => !soNaV5.includes(l))).toEqual(linhasV4.filter((l) => !soNaV4.includes(l)));
  });

  it('a troca de bloco recusa marcador ausente, repetido ou fora de ordem', () => {
    expect(trocarBloco('a [x] b [y] c', '[x]', '[y]', 'N')).toBe('a N[y] c');
    expect(() => trocarBloco('a b', '[x]', 'b', 'N')).toThrow(/0 e 1 vez/);
    expect(() => trocarBloco('[x] [x] [y]', '[x]', '[y]', 'N')).toThrow(/2 e 1 vez/);
    expect(() => trocarBloco('[y] [x]', '[x]', '[y]', 'N')).toThrow(/antes do começo/);
  });

  it('o bloco de sistema com a base não tem dado pessoal e leva a nota AGENDA sem o endereço', () => {
    const texto = sistemaComBaseV5(BASE_DO_ENSAIO_V5);
    expect(varrerMontagem(texto)).toEqual([]);
    expect(texto).toContain('[30] AGENDA: Quando o cliente quiser visitar o imóvel');
    expect(texto).not.toMatch(/calendly/i);
  });
});

describe('atendente-imova@v5: os cenários do ensaio', () => {
  const cenario = (trecho: RegExp): CenarioDoAtendente => {
    const achado = CENARIOS_DO_ATENDENTE_V5.find((c) => trecho.test(c.nome));
    if (achado === undefined) throw new Error(`sem o cenário ${trecho.source}`);
    return achado;
  };

  it('são os da v4, com as visitas trocadas e quatro a mais', () => {
    expect(CENARIOS_DO_ATENDENTE_V5).toHaveLength(CENARIOS_DO_ATENDENTE_V4.length + 4);
    const nomes = CENARIOS_DO_ATENDENTE_V5.map((c) => c.nome);
    expect(new Set(nomes).size).toBe(nomes.length);
    for (const nome of CENARIOS_DE_VISITA_V5) expect(nomes, nome).toContain(nome);
    for (const nome of CENARIOS_QUE_PERGUNTAM_O_DIA_V5) expect(CENARIOS_DE_VISITA_V5.has(nome), nome).toBe(true);
    expect(CENARIOS_DE_VISITA_V5.size).toBe(11);
    // Só a reunião aceita o link.
    for (const c of CENARIOS_DO_ATENDENTE_V5) {
      if (c.espera.acoes.includes('enviar_link_da_agenda')) {
        expect(c.espera.agenda?.tipo, c.nome).toBe('reuniao');
        expect(CENARIOS_DE_VISITA_V5.has(c.nome), c.nome).toBe(false);
      }
    }
  });

  it('toda conversa passa pelo schema e pela auditoria, com a base do ensaio', () => {
    for (const c of CENARIOS_DO_ATENDENTE_V5) {
      expect(() => prepararChamada(comBase, c.entrada, CONTATO), c.nome).not.toThrow();
    }
  });

  it('a resposta boa de cada cenário passa pelo schema e pela régua da v5', () => {
    for (const c of CENARIOS_DO_ATENDENTE_V5) {
      expect(() => v5.saida.parse(c.respostaBoa), c.nome).not.toThrow();
      expect(conferirCenarioV5(c, c.respostaBoa), c.nome).toEqual([]);
    }
  });

  it('em todo cenário de visita, o link (de visita ou com o imóvel na reunião) é erro', () => {
    for (const nome of CENARIOS_DE_VISITA_V5) {
      const c = cenario(new RegExp(`^${nome.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`));
      for (const agenda of [
        { tipo: 'visita' as const, imovelCodigo: 'IM0007' },
        { tipo: 'reuniao' as const, imovelCodigo: 'IM0007' },
      ]) {
        expect(
          conferirCenarioV5(c, {
            ...c.respostaBoa,
            acao: 'enviar_link_da_agenda',
            agenda,
            mensagem: 'Segue o link para escolher o horário.',
          }),
          `${c.nome} (${agenda.tipo})`,
        ).not.toEqual([]);
      }
    }
  });

  it('perguntar outra coisa no lugar do dia é erro, mesmo com "Boa tarde"', () => {
    for (const nome of CENARIOS_QUE_PERGUNTAM_O_DIA_V5) {
      const c = CENARIOS_DO_ATENDENTE_V5.find((x) => x.nome === nome)!;
      for (const mensagem of [
        'Boa tarde! Qual imóvel você quer visitar?',
        'Boa tarde! Prefere comprar ou alugar?',
        'Boa tarde! Quer que eu te mande o [link da agenda]?',
      ]) {
        expect(
          conferirCenarioV5(c, { ...c.respostaBoa, acao: 'responder', agenda: null, mensagem }),
          `${nome}: ${mensagem}`,
        ).not.toEqual([]);
      }
    }
  });

  it('passar a visita sem a frase, falando em corretor ou sem "Visita:" no motivo é erro', () => {
    for (const nome of CENARIOS_DE_VISITA_V5) {
      const c = CENARIOS_DO_ATENDENTE_V5.find((x) => x.nome === nome)!;
      if (!c.espera.acoes.includes('passar_para_corretor')) continue;
      const boa = { ...c.respostaBoa, acao: 'passar_para_corretor' as const, agenda: null };
      expect(conferirCenarioV5(c, { ...boa, mensagem: 'Já vou passar para um corretor.', motivo: 'Visita: IM0007' }), nome).not.toEqual([]);
      expect(
        conferirCenarioV5(c, { ...boa, mensagem: `${FRASE_DA_VISITA} Já vou te passar para um corretor.`, motivo: 'Visita: IM0007' }),
        nome,
      ).not.toEqual([]);
      expect(conferirCenarioV5(c, { ...boa, mensagem: FRASE_DA_VISITA, motivo: 'Quer visitar o IM0007.' }), nome).not.toEqual([]);
      expect(conferirCenarioV5(c, { ...boa, mensagem: FRASE_DA_VISITA, motivo: 'Visita: IM0007 · dia a combinar.' }), nome).toEqual([]);
    }
  });

  it('a visita dada por marcada é erro, mesmo com a frase', () => {
    for (const trecho of [/^respondeu o dia da visita/, /amanhã às 10h/]) {
      const c = cenario(trecho);
      expect(
        conferirCenarioV5(c, { ...c.respostaBoa, mensagem: `Combinado, te espero lá! ${FRASE_DA_VISITA}` }),
        c.nome,
      ).not.toEqual([]);
    }
    expect(FRASE_DA_VISITA_NA_MENSAGEM.test(FRASE_DA_VISITA)).toBe(true);
  });

  it('o "ok, obrigado" depois da pergunta do dia não é silêncio', () => {
    const c = cenario(/^perguntou o dia e ele só agradeceu/);
    expect(conferirCenarioV5(c, { ...c.respostaBoa, acao: 'nao_responder', mensagem: '' })).not.toEqual([]);
  });

  it('o pausado passa já: perguntar o dia é erro', () => {
    const c = cenario(/^imóvel pausado/);
    expect(
      conferirCenarioV5(c, { ...c.respostaBoa, acao: 'responder', mensagem: 'Boa tarde! Qual dia e período ficam melhores pra você?' }),
    ).not.toEqual([]);
  });

  it('o link da reunião continua: pedido de novo, sai de novo', () => {
    const c = cenario(/^pediu o link da reunião de novo/);
    expect(conferirCenarioV5(c, c.respostaBoa)).toEqual([]);
    expect(conferirCenarioV5(c, { ...c.respostaBoa, acao: 'responder', agenda: null })).not.toEqual([]);
  });
});
