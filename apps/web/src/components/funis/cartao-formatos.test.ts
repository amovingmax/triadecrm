import { describe, expect, it } from 'vitest';

import {
  formatarCategoriaELocal,
  formatarParado,
  formatarPrazoProximaAcao,
  rotuloResponsavel,
} from './cartao-formatos';
import type { CartaoQuadro } from './tipos';

/**
 * O que estes testes protegem: o cartão do funil escreve prazo em cima de um estado
 * que o BANCO calculou em America/Fortaleza. Se a contagem de dias daqui contradisser
 * aquele estado, o cartão passa a mentir para quem está na rua ("atrasada" com um
 * "em 2 d" ao lado). Então cada caso abaixo é um par estado + data, e o que se afirma
 * é que a frase nunca briga com o estado.
 *
 * As datas são escritas com o deslocamento de Natal (-03:00) de propósito: o fuso é
 * fixo, sem horário de verão, e assim o teste independe do relógio da máquina.
 */

/** Um cartão qualquer, com só o que cada teste precisa por cima. */
function cartao(parcial: Partial<CartaoQuadro>): CartaoQuadro {
  return {
    deal_id: '00000000-0000-4000-8000-000000000001',
    organization_id: '00000000-0000-4000-8000-000000000002',
    organization_name: 'Abracadabra Festas',
    primary_category: 'Buffet infantil',
    city: 'Natal',
    neighborhood: 'Tirol',
    owner_id: null,
    owner_name: null,
    temperature: 'frio',
    needs_attention: false,
    status: 'open',
    tier: null,
    score: null,
    entered_stage_at: '2026-09-01T09:00:00-03:00',
    days_in_stage: 3,
    is_rotting: false,
    last_activity_at: null,
    days_since_contact: null,
    next_action: null,
    next_action_at: null,
    next_action_state: 'sem',
    updated_at: '2026-09-01T09:00:00-03:00',
    ...parcial,
  };
}

const AGORA = new Date('2026-09-04T14:00:00-03:00');

describe('formatarPrazoProximaAcao', () => {
  it('sem ação marcada pede atenção e não inventa data', () => {
    const prazo = formatarPrazoProximaAcao('sem', null, AGORA);
    expect(prazo.prefixo).toBe('Sem próxima ação');
    expect(prazo.numero).toBeNull();
    expect(prazo.urgente).toBe(true);
  });

  it('estado sem data cai na frase de ausência, mesmo se o estado disser outra coisa', () => {
    // Defesa contra dado incoerente: o cartão prefere calar a escrever "Hoje, Invalid Date".
    expect(formatarPrazoProximaAcao('hoje', null, AGORA).prefixo).toBe('Sem próxima ação');
    expect(formatarPrazoProximaAcao('agendada', 'não é data', AGORA).prefixo).toBe(
      'Sem próxima ação',
    );
  });

  it('hoje mostra a hora, em mono, e não é urgente', () => {
    const prazo = formatarPrazoProximaAcao('hoje', '2026-09-04T09:00:00-03:00', AGORA);
    expect(prazo.prefixo).toBe('Hoje, ');
    expect(prazo.numero).toBe('09:00');
    expect(prazo.urgente).toBe(false);
  });

  it('hoje continua sendo hoje às 23h, porque a conta é por dia de calendário em Natal', () => {
    const quaseMeiaNoite = new Date('2026-09-04T23:30:00-03:00');
    const prazo = formatarPrazoProximaAcao('agendada', '2026-09-05T09:00:00-03:00', quaseMeiaNoite);
    expect(prazo.prefixo).toBe('Amanhã, ');
    expect(prazo.numero).toBe('09:00');
  });

  it('agendada para depois de amanhã conta os dias', () => {
    const prazo = formatarPrazoProximaAcao('agendada', '2026-09-08T09:00:00-03:00', AGORA);
    expect(prazo.prefixo).toBe('Em ');
    expect(prazo.numero).toBe('4');
    expect(prazo.unidade).toBe('d');
    expect(prazo.urgente).toBe(false);
  });

  it('agendada com contagem zero ou negativa não escreve "em 0 d": vira hoje', () => {
    const prazo = formatarPrazoProximaAcao('agendada', '2026-09-04T09:00:00-03:00', AGORA);
    expect(prazo.prefixo).toBe('Hoje, ');
  });

  it('atrasada de um dia é "Venceu ontem", sem número solto', () => {
    const prazo = formatarPrazoProximaAcao('atrasada', '2026-09-03T09:00:00-03:00', AGORA);
    expect(prazo.prefixo).toBe('Venceu ontem');
    expect(prazo.numero).toBeNull();
    expect(prazo.urgente).toBe(true);
  });

  it('atrasada de vários dias conta o atraso e pede peso', () => {
    const prazo = formatarPrazoProximaAcao('atrasada', '2026-08-30T09:00:00-03:00', AGORA);
    expect(prazo.prefixo).toBe('Atrasada ');
    expect(prazo.numero).toBe('5');
    expect(prazo.urgente).toBe(true);
  });

  it('atrasada com data de hoje nunca vira "atrasada 0 d"', () => {
    const prazo = formatarPrazoProximaAcao('atrasada', '2026-09-04T09:00:00-03:00', AGORA);
    expect(prazo.prefixo).toBe('Venceu ontem');
  });

  it('nenhuma frase visível usa travessão', () => {
    const estados = ['sem', 'hoje', 'agendada', 'atrasada'] as const;
    for (const estado of estados) {
      const prazo = formatarPrazoProximaAcao(estado, '2026-09-08T09:00:00-03:00', AGORA);
      expect(`${prazo.prefixo}${prazo.numero ?? ''}${prazo.unidade}${prazo.descricao}`).not.toMatch(
        /[—–]/,
      );
    }
  });
});

describe('formatarCategoriaELocal', () => {
  it('junta categoria, bairro e cidade sem repetir separador', () => {
    expect(formatarCategoriaELocal(cartao({}))).toBe('Buffet infantil · Tirol, Natal');
  });

  it('sem bairro, mostra só a cidade', () => {
    expect(formatarCategoriaELocal(cartao({ neighborhood: null }))).toBe('Buffet infantil · Natal');
  });

  it('sem categoria, não deixa o separador órfão', () => {
    expect(formatarCategoriaELocal(cartao({ primary_category: null }))).toBe('Tirol, Natal');
  });

  it('sem nada, devolve vazio para o cartão decidir o texto de ausência', () => {
    expect(
      formatarCategoriaELocal(cartao({ primary_category: null, neighborhood: null, city: null })),
    ).toBe('');
  });
});

describe('rotuloResponsavel', () => {
  it('sem dono é o bolo comum, não um erro', () => {
    expect(rotuloResponsavel(null)).toBe('Sem responsável');
    expect(rotuloResponsavel('   ')).toBe('Sem responsável');
  });

  it('com dono, mostra o nome sem espaço sobrando', () => {
    expect(rotuloResponsavel(' Heloísa ')).toBe('Heloísa');
  });
});

describe('formatarParado', () => {
  it('separa a palavra, o número e a unidade, para só o número sair em mono', () => {
    const parado = formatarParado(4);
    expect(parado.rotulo).toBe('Parado há ');
    expect(parado.numero).toBe('4');
    expect(parado.unidade).toBe('d');
  });

  it('no mesmo dia, diz só "Parado"', () => {
    expect(formatarParado(0).numero).toBeNull();
    expect(formatarParado(0).rotulo).toBe('Parado');
  });

  it('um dia é dia, não dias', () => {
    expect(formatarParado(1).descricao).toContain('1 dia nesta etapa');
  });
});
