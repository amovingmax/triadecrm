import { describe, expect, it } from 'vitest';

import { VIGENTES, obterPrompt, promptVigente } from '../src/catalogo';
import { esquemaDeSaida, prepararChamada } from '../src/nucleo/chamada';
import { MODELOS } from '../src/nucleo/versionamento';
import {
  type EntradaDaAvaliacao,
  avaliacaoDoAtendimentoV1 as prompt,
} from '../src/prompts/avaliacao-do-atendimento/v1';
import {
  LACUNAS_DO_ATENDIMENTO,
  avaliacaoDoAtendimentoV2 as v2,
} from '../src/prompts/avaliacao-do-atendimento/v2';

/**
 * A IA JUÍZA DA IMOVA (06/11/2026), SEM REDE.
 *
 * O que estes casos protegem é o que a qualidade da nota não mostra: o modelo e o
 * propósito (é por ele que o custo da juíza aparece separado), a nota que só pode ser
 * de 1 a 5 ou nula, o texto que encurta em vez de derrubar a avaliação, e o telefone
 * que o cliente escreve na conversa não chegando ao modelo. Se a nota bate com o que
 * uma pessoa daria, só se mede com conversas reais da Imova.
 */

const CONTATO = {
  leadId: 'lead-1',
  nome: 'Janio Ramalho',
  empresa: null,
  telefones: ['+5584988776655'],
};

const base = (): EntradaDaAvaliacao => prompt.exemplos[0]!.entrada;

/** Uma saída que passa, para os casos que mexem num campo só. */
const valida = () => ({ ...prompt.exemplos[0]!.saida });

describe('avaliacao-do-atendimento@v1', () => {
  it('roda no Haiku 5.5, lê a conversa inteira e tem propósito próprio no custo', () => {
    expect(prompt.modelo).toBe(MODELOS.haiku55);
    expect(prompt.modelo).toBe('claude-haiku-5-5');
    expect(prompt.escala).toBe('conversa');
    expect(prompt.proposito).toBe('avaliar_atendimento');
    // A v2 (09/11/2026) é a vigente; a v1 fica no catálogo para voltar trocando um número.
    expect(obterPrompt('avaliacao-do-atendimento', 1)).toBe(prompt);
  });

  it('o texto é da Imova, avalia só a IA e diz que não vê a base', () => {
    expect(prompt.sistema).toMatch(/Imova Imobiliária/);
    expect(prompt.sistema).toMatch(/Só a IA/);
    expect(prompt.sistema).toMatch(/não vê a lista de imóveis nem o caderno/);
    expect(prompt.sistema).toMatch(/Passar para um corretor .* é o certo/s);
    expect(prompt.sistema).not.toMatch(/KOMUNE|Komune|fornecedor|evento|helo[ií]sa/i);
  });

  it('cada quesito tem a régua de 1 a 5 e o caso do null', () => {
    for (const quesito of ['duvida', 'informacao', 'satisfacao']) {
      const inicio = prompt.sistema.indexOf(`${quesito} —`);
      expect(inicio, quesito).toBeGreaterThan(-1);
      const trecho = prompt.sistema.slice(inicio, inicio + 1400);
      for (const n of ['5:', '4:', '3:', '2:', '1:', 'null:'])
        expect(trecho, `${quesito} ${n}`).toContain(n);
    }
    expect(prompt.sistema).toMatch(/subiu:/);
    expect(prompt.sistema).toMatch(/caiu:/);
    expect(prompt.sistema).toMatch(/igual:/);
  });

  it('a saída pede as três notas, o interesse, o porquê, o que melhorar e se faltou dado', () => {
    const esquema = esquemaDeSaida(prompt) as { properties: Record<string, unknown> };
    expect(Object.keys(esquema.properties).sort()).toEqual(
      [
        'dadosInsuficientes',
        'duvida',
        'informacao',
        'interesse',
        'melhorar',
        'porque',
        'satisfacao',
      ].sort(),
    );
  });

  it('a nota vai ao modelo como enum de 1 a 5 ou null: a saída estruturada não aceita mínimo e máximo', () => {
    const esquema = JSON.stringify(esquemaDeSaida(prompt));
    expect(esquema.match(/"enum":\[1,2,3,4,5\]/g)).toHaveLength(3);
    expect(esquema).not.toMatch(/"minimum"|"maximum"/);
    expect(esquema).toContain('até 300 caracteres');
    expect(esquema).toContain('até 200 caracteres');
  });

  it('nota fora de 1 a 5 é recusada; null é aceito', () => {
    for (const errada of [0, 6, 3.5, '4', -1]) {
      expect(() => prompt.saida.parse({ ...valida(), duvida: errada }), String(errada)).toThrow();
    }
    expect(
      prompt.saida.parse({ ...valida(), duvida: null, informacao: null, satisfacao: null }).duvida,
    ).toBeNull();
    expect(() => prompt.saida.parse({ ...valida(), interesse: 'aumentou' })).toThrow();
  });

  it('texto um pouco mais longo é encurtado na palavra até o teto do banco, não recusado', () => {
    const longa = 'A IA respondeu o valor do aluguel e do condomínio. '.repeat(12);
    const lida = prompt.saida.parse({ ...valida(), porque: longa, melhorar: longa });
    expect(lida.porque.length).toBeLessThanOrEqual(400);
    expect(lida.porque.endsWith('…')).toBe(true);
    expect(lida.melhorar?.length).toBeLessThanOrEqual(300);
    expect(lida.melhorar?.endsWith('…')).toBe(true);
    expect(prompt.saida.parse({ ...valida(), melhorar: null }).melhorar).toBeNull();
  });

  it('todo exemplo passa pelos dois schemas e cabe nos tamanhos que o prompt pede', () => {
    for (const exemplo of prompt.exemplos) {
      expect(() => prompt.entrada.parse(exemplo.entrada), exemplo.nome).not.toThrow();
      expect(() => prompt.saida.parse(exemplo.saida), exemplo.nome).not.toThrow();
      expect(exemplo.saida.porque.length, exemplo.nome).toBeLessThanOrEqual(300);
      expect(exemplo.saida.melhorar?.length ?? 0, exemplo.nome).toBeLessThanOrEqual(200);
      // O porquê é lido por gente no relatório: etiqueta de mensagem não diz nada lá.
      expect(exemplo.saida.porque, exemplo.nome).not.toMatch(/\[m\d+\]/);
    }
  });

  it('os exemplos são coerentes com a régua', () => {
    for (const exemplo of prompt.exemplos) {
      const { saida, entrada } = exemplo;
      // Sem dado para julgar, nenhuma nota inventada.
      if (saida.dadosInsuficientes) {
        expect([saida.duvida, saida.informacao, saida.satisfacao], exemplo.nome).toEqual([
          null,
          null,
          null,
        ]);
      }
      // Toda conversa de exemplo tem resposta da IA: é a única que chega ao modelo.
      expect(
        entrada.mensagens.some((m) => m.de === 'ia'),
        exemplo.nome,
      ).toBe(true);
      expect(entrada.respostas, exemplo.nome).toBeGreaterThan(0);
    }
    // Os exemplos cobrem as três direções do interesse e as notas altas e baixas.
    expect(new Set(prompt.exemplos.map((e) => e.saida.interesse))).toEqual(
      new Set(['subiu', 'igual', 'caiu']),
    );
    const notas = prompt.exemplos.flatMap((e) => [
      e.saida.duvida,
      e.saida.informacao,
      e.saida.satisfacao,
    ]);
    expect(notas).toContain(5);
    expect(notas).toContain(2);
    expect(notas).toContain(null);
  });

  it('os exemplos passam inteiros pela montagem e pela auditoria de PII', () => {
    for (const exemplo of prompt.exemplos) {
      expect(() => prepararChamada(prompt, exemplo.entrada, CONTATO), exemplo.nome).not.toThrow();
    }
  });

  it('a mensagem diz o dia, o que a IA fez e a atitude, e marca quem é a IA', () => {
    const chamada = prepararChamada(prompt, base(), CONTATO);
    expect(chamada.mensagem).toContain('dia avaliado: 05/11/2026');
    expect(chamada.mensagem).toContain('respostas da IA nesse dia: 2');
    expect(chamada.mensagem).toContain('- marcou visita em 05/11 às 09:40');
    expect(chamada.mensagem).toContain(
      'atitude do cliente no CRM antes do atendimento: interessado',
    );
    expect(chamada.mensagem).toContain('atitude do cliente no CRM depois: muito_interessado');
    expect(chamada.mensagem).toContain('[m2] em 05/11 às 09:31 — IA:');
    expect(chamada.mensagem).toContain('[m1] em 05/11 às 09:30 — cliente:');
  });

  it('a mensagem automática e a da equipe chegam rotuladas, para não contarem como IA', () => {
    const entrada: EntradaDaAvaliacao = {
      ...base(),
      mensagens: [
        ...base().mensagens,
        { messageId: 'm6', de: 'equipe', quando: '05/11 10:00', texto: 'Oi, aqui é a Ana.' },
        { messageId: 'm7', de: 'automatica', quando: '05/11 10:01', texto: 'Lembrete da visita.' },
      ],
    };
    const chamada = prepararChamada(prompt, entrada, CONTATO);
    expect(chamada.mensagem).toContain('[m6] em 05/11 às 10:00 — equipe: Oi');
    expect(chamada.mensagem).toContain('[m7] em 05/11 às 10:01 — automática: Lembrete');
  });

  it('o nome e o telefone que o cliente escreve na conversa não chegam ao modelo', () => {
    const entrada: EntradaDaAvaliacao = {
      ...base(),
      mensagens: [
        ...base().mensagens,
        {
          messageId: 'm6',
          de: 'cliente',
          quando: '05/11 09:45',
          texto:
            'Aqui é o Janio Ramalho. Se precisar, me liga no 84 99988-7766, é da minha esposa.',
        },
      ],
    };
    const chamada = prepararChamada(prompt, entrada, CONTATO);
    expect(chamada.mensagem).not.toMatch(/99988[-\s]?7766/);
    expect(chamada.mensagem).not.toContain('Janio Ramalho');
    expect(chamada.mensagem).toContain('é da minha esposa');
  });

  it('conversa no teto (80 mensagens) não vira telefone na junção da etiqueta, do dia e da hora', () => {
    const mensagens = Array.from({ length: 80 }, (_, i) => ({
      messageId: `m${i + 1}`,
      de: (i % 2 === 0 ? 'cliente' : 'ia') as 'cliente' | 'ia',
      quando: `${String(4 + (i % 2)).padStart(2, '0')}/11 ${String(8 + (i % 12)).padStart(2, '0')}:${String(10 + (i % 50)).padStart(2, '0')}`,
      texto:
        i % 3 === 0
          ? 'Tem 3 quartos e 2 vagas, até 600 mil'
          : 'O condomínio é R$ 600 e o IPTU R$ 1.200 por ano',
    }));
    const acoes = Array.from({ length: 40 }, (_, i) => ({
      acao: 'respondeu' as const,
      quando: `05/11 ${String(8 + (i % 12)).padStart(2, '0')}:${String(10 + i).padStart(2, '0')}`,
    }));
    expect(() =>
      prepararChamada(prompt, { ...base(), respostas: 40, acoes, mensagens }, CONTATO),
    ).not.toThrow();
  });

  it('o teto de saída deixa lugar para o raciocínio, sem passar do da leitura do cliente', () => {
    expect(prompt.maxTokens).toBeGreaterThanOrEqual(2000);
    expect(prompt.maxTokens).toBeLessThanOrEqual(4000);
  });
});

describe('avaliacao-do-atendimento@v2: a lacuna', () => {
  const validaV2 = () => ({ ...v2.exemplos[0]!.saida });

  it('é a vigente, com o modelo, o propósito, a entrada e a mensagem da v1', () => {
    expect(VIGENTES['avaliacao-do-atendimento']).toBe(2);
    expect(promptVigente('avaliacao-do-atendimento')).toBe(v2);
    expect(v2.versao).toBe(2);
    expect(v2.modelo).toBe(prompt.modelo);
    expect(v2.proposito).toBe('avaliar_atendimento');
    expect(v2.escala).toBe('conversa');
    expect(v2.entrada).toBe(prompt.entrada);
    expect(v2.montarMensagem).toBe(prompt.montarMensagem);
    expect(v2.maxTokens).toBe(prompt.maxTokens);
    const entrada = prompt.exemplos[0]!.entrada;
    expect(prepararChamada(v2, entrada, CONTATO).mensagem).toBe(
      prepararChamada(prompt, entrada, CONTATO).mensagem,
    );
  });

  it('o texto é o da v1 com a régua da lacuna antes dos textos', () => {
    expect(
      v2.sistema.startsWith(
        prompt.sistema.slice(0, prompt.sistema.indexOf('OS TEXTOS:')).trimEnd(),
      ),
    ).toBe(true);
    const inicio = v2.sistema.indexOf('lacuna —');
    expect(inicio).toBeGreaterThan(v2.sistema.indexOf('interesse —'));
    expect(inicio).toBeLessThan(v2.sistema.indexOf('OS TEXTOS:'));
    for (const lacuna of LACUNAS_DO_ATENDIMENTO) {
      expect(v2.sistema, lacuna).toContain(`- ${lacuna}:`);
    }
    expect(prompt.sistema).not.toContain('lacuna');
  });

  it('a saída é a da v1 mais a lacuna, e a lacuna vai ao modelo como enum', () => {
    const esquema = esquemaDeSaida(v2) as {
      properties: Record<string, { enum?: unknown }>;
      required?: string[];
    };
    expect(Object.keys(esquema.properties).sort()).toEqual(
      [
        ...Object.keys((esquemaDeSaida(prompt) as { properties: object }).properties),
        'lacuna',
      ].sort(),
    );
    expect(esquema.properties.lacuna?.enum).toEqual([...LACUNAS_DO_ATENDIMENTO]);
    expect(esquema.required).toContain('lacuna');
  });

  it('lacuna fora da lista, ou faltando, é recusada: é estrutura, não texto', () => {
    expect(() => v2.saida.parse({ ...validaV2(), lacuna: 'demorou' })).toThrow();
    const { lacuna: _semLacuna, ...semLacuna } = validaV2();
    expect(() => v2.saida.parse(semLacuna)).toThrow();
    for (const lacuna of LACUNAS_DO_ATENDIMENTO) {
      expect(v2.saida.parse({ ...validaV2(), lacuna }).lacuna).toBe(lacuna);
    }
  });

  it('todo exemplo passa pelos dois schemas e pela auditoria de PII', () => {
    for (const exemplo of v2.exemplos) {
      expect(() => v2.entrada.parse(exemplo.entrada), exemplo.nome).not.toThrow();
      expect(() => v2.saida.parse(exemplo.saida), exemplo.nome).not.toThrow();
      expect(() => prepararChamada(v2, exemplo.entrada, CONTATO), exemplo.nome).not.toThrow();
      expect(exemplo.saida.porque.length, exemplo.nome).toBeLessThanOrEqual(300);
    }
  });

  it('os exemplos são coerentes: sem dado ou sem falha, nenhuma; com nota baixa, uma lacuna', () => {
    for (const { nome, saida } of v2.exemplos) {
      if (saida.dadosInsuficientes) expect(saida.lacuna, nome).toBe('nenhuma');
      const notas = [saida.duvida, saida.informacao, saida.satisfacao].filter(
        (n): n is 1 | 2 | 3 | 4 | 5 => n !== null,
      );
      if (notas.some((n) => n <= 2)) expect(saida.lacuna, nome).not.toBe('nenhuma');
      if (notas.length > 0 && notas.every((n) => n >= 4))
        expect(saida.lacuna, nome).toBe('nenhuma');
    }
    expect(new Set(v2.exemplos.map((e) => e.saida.lacuna))).toEqual(
      new Set(['nenhuma', 'nao_sabia_do_imovel', 'passou_sem_precisar']),
    );
  });
});
