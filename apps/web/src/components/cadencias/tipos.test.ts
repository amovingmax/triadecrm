import { describe, expect, it } from 'vitest';

import {
  condicaoEmPortugues,
  condicoesDoPasso,
  contagemDeAtividade,
  contatosNaCadencia,
  metasDefinidas,
  metricasFeitas,
  nomeDoCanal,
  quandoOPassoVence,
  resumoSchema,
  visaoSchema,
  type Cadencia,
  type ResumoDoDia,
} from './tipos';

/**
 * O que estes testes travam:
 *
 * 1. **O vocabulário fechado da condição.** As oito chaves são validadas por gatilho
 *    no banco (`app.cadence_steps_validate`); esta é a metade que traduz. Chave nova
 *    tem de APARECER, ainda que feia — um passo com condição invisível pula gente sem
 *    ninguém entender por quê, e é o pior defeito possível numa régua.
 *
 * 2. **`data_combinada` não conta dias.** Ela lê a data que o parceiro pediu; escrever
 *    "D+0" ali significaria "hoje" para algo que pode ser daqui a três semanas.
 *
 * 3. **O parse.** As duas RPCs devolvem `jsonb`, então o tipo gerado é `Json`. Se uma
 *    migração renomear um campo, o erro tem de estourar aqui, no parse, com o nome do
 *    campo — e não três telas abaixo num `undefined`.
 */

describe('condicaoEmPortugues', () => {
  it('traduz as oito chaves do vocabulário fechado', () => {
    expect(condicaoEmPortugues('tem_telefone', true)).toBe('tem telefone');
    expect(condicaoEmPortugues('tem_instagram', true)).toBe('tem @instagram');
    expect(condicaoEmPortugues('bairro_geocodificado', true)).toBe('bairro no mapa');
    expect(condicaoEmPortugues('sem_resposta', true)).toBe('ainda não respondeu');
    expect(condicaoEmPortugues('claim_link_aberto', false)).toBe('não abriu o link');
    expect(condicaoEmPortugues('reivindicado', false)).toBe('ainda não reivindicou');
    expect(condicaoEmPortugues('tem_gancho', true)).toBe('tem gancho registrado');
    expect(condicaoEmPortugues('ultimo_desfecho_em', ['lig_nao_atendeu', 'lig_caixa_postal'])).toBe(
      'último desfecho: lig_nao_atendeu ou lig_caixa_postal',
    );
  });

  it('inverte a frase quando a condição é negativa', () => {
    expect(condicaoEmPortugues('tem_telefone', false)).toBe('sem telefone');
    expect(condicaoEmPortugues('sem_resposta', false)).toBe('já respondeu');
  });

  it('mostra chave desconhecida em vez de escondê-la', () => {
    expect(condicaoEmPortugues('condicao_nova_do_futuro', 7)).toBe('condicao_nova_do_futuro: 7');
  });

  it('lista as condições de um passo em ordem estável', () => {
    expect(condicoesDoPasso({ tem_telefone: true, sem_resposta: true })).toEqual([
      'ainda não respondeu',
      'tem telefone',
    ]);
    expect(condicoesDoPasso({})).toEqual([]);
  });
});

describe('quandoOPassoVence', () => {
  it('conta da matrícula e do passo anterior', () => {
    expect(quandoOPassoVence({ atraso_dias: 0, atraso_de: 'matricula' })).toBe(
      'no mesmo dia da entrada na cadência',
    );
    expect(quandoOPassoVence({ atraso_dias: 1, atraso_de: 'passo_anterior' })).toBe(
      '1 dia depois do passo anterior',
    );
    expect(quandoOPassoVence({ atraso_dias: 7, atraso_de: 'matricula' })).toBe(
      '7 dias depois da entrada na cadência',
    );
  });

  it('não conta dias quando quem manda é a data combinada', () => {
    expect(quandoOPassoVence({ atraso_dias: 0, atraso_de: 'data_combinada' })).toBe(
      'na data que o parceiro pediu',
    );
  });
});

describe('nomeDoCanal', () => {
  it('nomeia o canal pela ação que vira tarefa', () => {
    expect(nomeDoCanal('phone')).toBe('Ligação');
    expect(nomeDoCanal('presencial')).toBe('Visita');
    expect(nomeDoCanal('whatsapp')).toBe('WhatsApp');
  });
});

describe('contagemDeAtividade', () => {
  it('faz plural em português, sem "(s)"', () => {
    expect(contagemDeAtividade('call', 1)).toBe('ligação');
    expect(contagemDeAtividade('call', 3)).toBe('ligações');
    expect(contagemDeAtividade('visit', 2)).toBe('visitas');
    expect(contagemDeAtividade('message', 2)).toBe('mensagens');
  });

  it('deixa passar tipo que ainda não tem nome', () => {
    expect(contagemDeAtividade('tipo_novo', 1)).toBe('tipo_novo');
  });
});

describe('contatosNaCadencia', () => {
  const base = {
    ativas: 0,
    pausadas: 0,
    concluidas: 0,
    encerradas: 0,
    esperando_o_primeiro: 0,
  };

  function cadencia(matriculas: Partial<typeof base>): Cadencia {
    return {
      id: 1,
      slug: 'voz_primeiro',
      nome: 'Primeiro contato por voz',
      ativa: true,
      funil: 'fornecedor',
      max_toques: 5,
      limite_dias: 14,
      etapa_do_fim: 'nutricao',
      exige_gancho: false,
      exige_autorizacao: false,
      nota_de_entrada: null,
      descricao: null,
      matriculas: { ...base, ...matriculas },
      passos: [],
    };
  }

  it('conta quem está dentro — ativa e pausada, nunca concluída', () => {
    expect(contatosNaCadencia(cadencia({ ativas: 3, pausadas: 2, concluidas: 40 }))).toBe(5);
    expect(contatosNaCadencia(cadencia({ encerradas: 12 }))).toBe(0);
  });
});

describe('metas do resumo', () => {
  const metas: ResumoDoDia['metas'] = [
    { metrica: 'calls_made', rotulo: 'Ligações', meta: null, realizado: 3, mensuravel: true },
    { metrica: 'doors_opened', rotulo: 'Portas abertas', meta: 3, realizado: 0, mensuravel: true },
    { metrica: 'replies', rotulo: 'Respostas', meta: null, realizado: null, mensuravel: false },
  ];

  it('só chama de "feito" a métrica mensurável com número', () => {
    expect(metricasFeitas(metas).map((m) => m.metrica)).toEqual(['calls_made']);
  });

  it('só cobra contra meta que alguém combinou', () => {
    expect(metasDefinidas(metas).map((m) => m.metrica)).toEqual(['doors_opened']);
  });
});

describe('parse das RPCs', () => {
  it('recusa a visão sem o bloco de envio — que é o que sustenta a honestidade da tela', () => {
    expect(() =>
      visaoSchema.parse({
        gerado_em: '2026-09-05T10:00:00Z',
        dia: '2026-09-05',
        papel: 'sdr',
        pode_ligar_desligar: false,
        dia_de_operacao: true,
        agendador: [],
        canais: [],
        cadencias: [],
      }),
    ).toThrow();
  });

  it('aceita agendador e canais nulos: cron vazio não pode derrubar a tela', () => {
    const visao = visaoSchema.parse({
      gerado_em: '2026-09-05T10:00:00Z',
      dia: '2026-09-05',
      papel: 'sdr',
      pode_ligar_desligar: false,
      dia_de_operacao: true,
      agendador: null,
      canais: null,
      envio: {
        modo_automatico: false,
        modo_automatico_decisao: 'ADR-05',
        worker_whatsapp: { visto_em: null, ativo: false },
      },
      cadencias: [],
    });
    expect(visao.agendador).toEqual([]);
    expect(visao.canais).toEqual([]);
  });

  it('recusa o resumo sem `sem_registro`: é o que separa "não fez" de "não registrou"', () => {
    expect(() => resumoSchema.parse({ dia: '2026-09-05' })).toThrow();
  });
});
