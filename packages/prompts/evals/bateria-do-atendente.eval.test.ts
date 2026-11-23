import { describe, expect, it } from 'vitest';

import { prepararChamada } from '../src/nucleo/chamada';
import {
  CASOS_DA_BATERIA,
  GRUPOS_DA_BATERIA,
  TETO_DE_CARACTERES,
  casosDaBateria,
  conferirCasoDaBateria,
  contarPerguntas,
  entradaDoCaso,
  quandoDaFala,
} from '../src/prompts/atendente-imova/bateria';
import { BASE_DO_ENSAIO_V5 } from '../src/prompts/atendente-imova/cenarios-v5';
import { atendenteImovaV7 as v7, sistemaComBaseV7 } from '../src/prompts/atendente-imova/v7';

/**
 * A bateria de ensaio da IA que atende (23/11/2026). Sem rede: prova que os 40 casos
 * montam uma entrada válida, que nenhum deles esbarra na auditoria de dado pessoal (uma
 * chamada barrada abriria tarefa para a equipe) e que a régua acerta e erra onde deve.
 * A rodada contra o modelo é `workers ai --ensaio=bateria`.
 */

describe('bateria do atendente: os casos', () => {
  it('são 40, com id único, e cobrem os quatro grupos', () => {
    expect(CASOS_DA_BATERIA).toHaveLength(40);
    const ids = CASOS_DA_BATERIA.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const grupo of GRUPOS_DA_BATERIA) {
      expect(CASOS_DA_BATERIA.some((c) => c.grupo === grupo)).toBe(true);
    }
    expect(CASOS_DA_BATERIA.filter((c) => c.critico).length).toBeGreaterThanOrEqual(12);
  });

  it('cada caso monta uma entrada que a v7 aceita, com a última fala do cliente', () => {
    for (const caso of CASOS_DA_BATERIA) {
      const entrada = entradaDoCaso(caso);
      expect(() => v7.entrada.parse(entrada), caso.id).not.toThrow();
      expect(entrada.mensagens.at(-1)?.de, caso.id).toBe('cliente');
      expect(caso.espera.acoes.length, caso.id).toBeGreaterThan(0);
    }
  });

  it('nenhum caso esbarra na auditoria de dado pessoal (a chamada sairia barrada)', () => {
    const prompt = { ...v7, sistema: sistemaComBaseV7(BASE_DO_ENSAIO_V5) };
    for (const caso of CASOS_DA_BATERIA) {
      expect(
        () =>
          prepararChamada(prompt, entradaDoCaso(caso), {
            leadId: `ensaio-${caso.id.toLowerCase()}`,
            nome: caso.nome,
          }),
        caso.id,
      ).not.toThrow();
    }
  });

  it('o horário da fala é o do banco, DD/MM HH:MM, e atravessa a meia-noite', () => {
    expect(quandoDaFala('2026-11-24T10:15', 1)).toBe('24/11 10:14');
    expect(quandoDaFala('2026-11-24T10:15', 4330)).toBe('21/11 10:05');
    expect(quandoDaFala('2026-11-01T00:05', 10)).toBe('31/10 23:55');
  });

  it('roda só os casos pedidos', () => {
    expect(casosDaBateria(['i01', ' A04 ']).map((c) => c.id)).toEqual(['I01', 'A04']);
    expect(casosDaBateria()).toBe(CASOS_DA_BATERIA);
  });
});

describe('bateria do atendente: a régua', () => {
  const caso = (id: string) => {
    const achado = CASOS_DA_BATERIA.find((c) => c.id === id);
    if (achado === undefined) throw new Error(id);
    return achado;
  };
  const comMapa = { temMapa: true };

  it('acerta a resposta certa do caso de Camurupim', () => {
    expect(
      conferirCasoDaBateria(
        caso('I01'),
        {
          acao: 'responder',
          mensagem:
            'Olá, tudo bem? É o terreno de frente para o mar em Tabatinga, perto de Camurupim? Se for, o valor de venda é R$ 520.000.',
          agenda: null,
        },
        comMapa,
      ),
    ).toEqual([]);
  });

  it('pega o "não temos", a área na confirmação e a pergunta repetida', () => {
    const falhas = conferirCasoDaBateria(
      caso('I02'),
      {
        acao: 'responder',
        mensagem: 'Não temos esse terreno. É o de 810 m²? Qual é o nome da avenida?',
        agenda: null,
      },
      comMapa,
    );
    expect(falhas.join(' | ')).toMatch(/não temos/);
    expect(falhas.join(' | ')).toMatch(/área numa pergunta/);
    expect(falhas.join(' | ')).toMatch(/pergunta a rua ou a avenida de novo/);
    expect(falhas.join(' | ')).toMatch(/2 perguntas/);
  });

  it('cobra o que vale para toda resposta: código, corretor, emoji, link e tamanho', () => {
    const falhas = conferirCasoDaBateria(
      caso('A01'),
      {
        acao: 'responder',
        mensagem: `Bom dia 😊 sou do TE0004_IMOVA e um corretor te liga. https://calendly.com/x ${'a'.repeat(TETO_DE_CARACTERES)}`,
        agenda: null,
      },
      comMapa,
    ).join(' | ');
    for (const trecho of ['código do anúncio', 'corretor', 'emoji', 'link', 'caracteres'])
      expect(falhas).toContain(trecho);
  });

  it('a ação errada, o tipo de link errado e a busca no mapa que faltou', () => {
    expect(
      conferirCasoDaBateria(
        caso('L01'),
        { acao: 'responder', mensagem: 'Desculpe a demora.', agenda: null },
        comMapa,
      ),
    ).toEqual(['ação responder; esperava passar_para_corretor']);
    expect(
      conferirCasoDaBateria(
        caso('G01'),
        {
          acao: 'enviar_link_da_agenda',
          mensagem: 'Vou te mandar o link da nossa agenda.',
          agenda: { tipo: 'visita', imovelCodigo: null },
        },
        comMapa,
      ),
    ).toEqual(['link de visita; esperava reuniao']);
    const semBusca = {
      acao: 'responder',
      mensagem: 'É o terreno de frente para o mar em Tabatinga?',
      agenda: null,
    } as const;
    expect(conferirCasoDaBateria(caso('I11'), semBusca, comMapa)).toEqual([
      'não buscou no mapa (nota 14)',
    ]);
    expect(conferirCasoDaBateria(caso('I11'), semBusca, { temMapa: false })).toEqual([]);
    expect(
      conferirCasoDaBateria(caso('I11'), { ...semBusca, ferramentas: ['buscar_no_mapa'] }, comMapa),
    ).toEqual([]);
  });

  it('passar sem texto é aceito; o que o texto devia dizer, não', () => {
    expect(
      conferirCasoDaBateria(
        caso('A05'),
        { acao: 'passar_para_corretor', mensagem: '', agenda: null },
        comMapa,
      ),
    ).toEqual([]);
    expect(
      conferirCasoDaBateria(
        caso('L01'),
        { acao: 'passar_para_corretor', mensagem: '', agenda: null },
        comMapa,
      ),
    ).toEqual(['não pede desculpa']);
  });

  it('o "tudo bem?" do cumprimento não conta como pergunta', () => {
    expect(contarPerguntas('Olá, tudo bem? Como posso te ajudar?')).toBe(1);
    expect(contarPerguntas('Qual dia? E qual período?')).toBe(2);
  });
});
