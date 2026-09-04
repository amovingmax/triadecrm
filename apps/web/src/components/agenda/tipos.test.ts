import { describe, expect, it } from 'vitest';

import {
  agruparPorBairro,
  BAIRRO_SEM_NOME,
  blocosDoDia,
  consultaDoMapa,
  contarPorDia,
  diaDaSemana,
  diasDaSemana,
  ehFimDeSemana,
  horaEmNatal,
  inicioDaSemana,
  janelaDeDias,
  linkDoMapa,
  mapaPorNome,
  numeroDoDia,
  proximoCompromisso,
  recortesDoCompromisso,
  rotuloDaSemana,
  rotuloSemanaCurto,
  somarDias,
  type Compromisso,
} from './tipos';
import type { DesfechoCatalogo } from '@/components/registro/tipos';

/**
 * O que estes testes seguram: a aritmética de calendário (que não pode depender do
 * fuso da máquina de quem roda), a régua de horário de Natal, os recortes dos blocos
 * do dia e o recorte de desfechos que a agenda oferece.
 */

function compromisso(parcial: Partial<Compromisso> = {}): Compromisso {
  return {
    taskId: parcial.taskId ?? crypto.randomUUID(),
    natureza: 'marcado',
    tipo: 'reuniao',
    titulo: 'Reunião na data',
    quando: '2026-09-10T13:30:00.000Z',
    concluido: false,
    organizationId: 'org-1',
    organizacao: 'Buffet Sabor',
    bairro: 'Tirol',
    cidade: 'Natal',
    endereco: null,
    categoria: 'Buffet',
    temperatura: 'quente',
    precisaAtencao: false,
    dealId: 'deal-1',
    pipelineId: 1,
    etapa: 'Reunião marcada',
    etapaId: 8,
    diasSemContato: 3,
    naoContatar: false,
    ...parcial,
  };
}

describe('calendário', () => {
  it('soma dias atravessando a virada do mês', () => {
    expect(somarDias('2026-09-30', 1)).toBe('2026-10-01');
    expect(somarDias('2026-01-01', -1)).toBe('2025-12-31');
  });

  it('numera a semana em ISO (segunda = 1, domingo = 7)', () => {
    expect(diaDaSemana('2026-09-07')).toBe(1);
    expect(diaDaSemana('2026-09-13')).toBe(7);
    expect(ehFimDeSemana('2026-09-12')).toBe(true);
    expect(ehFimDeSemana('2026-09-11')).toBe(false);
  });

  it('acha a segunda-feira da semana, inclusive a partir de um domingo', () => {
    expect(inicioDaSemana('2026-09-10')).toBe('2026-09-07');
    expect(inicioDaSemana('2026-09-13')).toBe('2026-09-07');
    expect(inicioDaSemana('2026-09-07')).toBe('2026-09-07');
  });

  it('lista os sete dias e o rótulo da semana', () => {
    expect(diasDaSemana('2026-09-07')).toEqual([
      '2026-09-07',
      '2026-09-08',
      '2026-09-09',
      '2026-09-10',
      '2026-09-11',
      '2026-09-12',
      '2026-09-13',
    ]);
    expect(rotuloDaSemana('2026-09-07')).toBe('07/09 a 13/09');
    expect(rotuloSemanaCurto('2026-09-07')).toBe('seg');
    expect(numeroDoDia('2026-09-07')).toBe('07');
  });

  it('abre a janela de busca no fuso de Natal, do primeiro dia ao fim do último', () => {
    expect(janelaDeDias('2026-09-07', '2026-09-13')).toEqual({
      de: '2026-09-07T00:00:00-03:00',
      ate: '2026-09-14T00:00:00-03:00',
    });
  });

  it('mostra a hora no relógio de Natal, não no do aparelho', () => {
    // 13:30 UTC é 10:30 em America/Fortaleza (UTC−3 o ano inteiro).
    expect(horaEmNatal('2026-09-10T13:30:00.000Z')).toBe('10:30');
  });
});

describe('blocos do dia', () => {
  const itens = [
    compromisso({ taskId: 't2', quando: '2026-09-10T17:00:00.000Z' }),
    compromisso({ taskId: 't1', quando: '2026-09-10T12:00:00.000Z' }),
    compromisso({
      taskId: 't3',
      natureza: 'visita',
      tipo: 'visita',
      quando: '2026-09-10T19:00:00.000Z',
    }),
    compromisso({ taskId: 't4', natureza: 'a_marcar', quando: '2026-09-10T20:00:00.000Z' }),
    compromisso({ taskId: 't5', concluido: true }),
  ];

  it('separa marcados, visitas, a marcar e concluídos, cada um em ordem de relógio', () => {
    const blocos = blocosDoDia(itens);
    expect(blocos.marcados.map((c) => c.taskId)).toEqual(['t1', 't2']);
    expect(blocos.visitas.map((c) => c.taskId)).toEqual(['t3']);
    expect(blocos.aMarcar.map((c) => c.taskId)).toEqual(['t4']);
    expect(blocos.concluidos.map((c) => c.taskId)).toEqual(['t5']);
  });

  it('conta por dia sem contar o que já foi registrado', () => {
    const contagem = contarPorDia(itens);
    expect(contagem.get('2026-09-10')).toBe(4);
  });

  it('acha o próximo compromisso a partir de um instante', () => {
    expect(proximoCompromisso(itens, '2026-09-10T13:00:00.000Z')?.taskId).toBe('t2');
    expect(proximoCompromisso(itens, '2026-09-11T00:00:00.000Z')).toBeNull();
  });
});

describe('visitas por bairro', () => {
  it('agrupa por bairro, ordena os grupos pelo primeiro horário e joga o sem bairro para o fim', () => {
    const grupos = agruparPorBairro([
      compromisso({ taskId: 'a', bairro: null, quando: '2026-09-11T11:00:00.000Z' }),
      compromisso({ taskId: 'b', bairro: 'Potengi', quando: '2026-09-11T13:00:00.000Z' }),
      compromisso({ taskId: 'c', bairro: 'Tirol', quando: '2026-09-11T12:00:00.000Z' }),
      compromisso({ taskId: 'd', bairro: 'Potengi', quando: '2026-09-11T11:30:00.000Z' }),
    ]);
    expect(grupos.map((g) => g.bairro)).toEqual(['Potengi', 'Tirol', BAIRRO_SEM_NOME]);
    expect(grupos[0]?.itens.map((c) => c.taskId)).toEqual(['d', 'b']);
  });

  it('desempata visitas do mesmo horário por nome, para a ordem não mudar a cada carga', () => {
    const mesmaHora = '2026-09-11T12:00:00.000Z';
    const grupos = agruparPorBairro([
      compromisso({ taskId: 'z', bairro: 'Potengi', organizacao: 'Zeca', quando: mesmaHora }),
      compromisso({ taskId: 'a', bairro: 'Potengi', organizacao: 'Ana', quando: mesmaHora }),
      compromisso({ taskId: 'm', bairro: 'Alecrim', organizacao: 'Marcos', quando: mesmaHora }),
    ]);
    expect(grupos.map((g) => g.bairro)).toEqual(['Alecrim', 'Potengi']);
    expect(grupos[1]?.itens.map((c) => c.organizacao)).toEqual(['Ana', 'Zeca']);
  });
});

describe('link do mapa', () => {
  it('busca pelo endereço quando existe', () => {
    const c = compromisso({ endereco: 'Av. Prudente de Morais, 100' });
    expect(mapaPorNome(c)).toBe(false);
    expect(consultaDoMapa(c)).toBe('Av. Prudente de Morais, 100, Tirol, Natal, RN');
  });

  it('busca pelo nome quando não há endereço na base', () => {
    const c = compromisso();
    expect(mapaPorNome(c)).toBe(true);
    expect(consultaDoMapa(c)).toBe('Buffet Sabor, Tirol, Natal, RN');
    expect(linkDoMapa(c)).toContain('https://www.google.com/maps/search/?api=1&query=');
  });
});

describe('recortes do catálogo', () => {
  function desfecho(parcial: Partial<DesfechoCatalogo>): DesfechoCatalogo {
    return {
      id: 1,
      slug: 'reu_interessado',
      name: 'Realizada, interessado',
      surfaces: ['reuniao'],
      position: 1,
      cooldown_days: 0,
      can_reactivate: true,
      next_action_kind: 'message',
      next_action_label: 'Pedir autorização hoje',
      next_action_offset_days: 0,
      target_stage_slug: 'apresentacao_realizada',
      sets_temperature: 'quente',
      requires_lost_reason: false,
      counts_as: 'aberta',
      ...parcial,
    } as DesfechoCatalogo;
  }

  const catalogo = [
    desfecho({ id: 1, slug: 'reu_interessado', position: 1 }),
    desfecho({ id: 2, slug: 'reu_no_show', name: 'No-show', position: 2, counts_as: 'batida' }),
    desfecho({ id: 3, slug: 'reu_reagendada', name: 'Reagendada', position: 3 }),
    desfecho({ id: 4, slug: 'vis_nao_estava', name: 'Não estava', surfaces: ['visita'] }),
    desfecho({
      id: 5,
      slug: 'vis_funcionario',
      name: 'Falei com funcionário',
      surfaces: ['visita'],
    }),
  ];

  it('separa realizada, ausente e reagendar na reunião', () => {
    const { realizada, ausente, reagendar } = recortesDoCompromisso(catalogo, compromisso());
    expect(realizada.map((d) => d.slug)).toEqual(['reu_interessado']);
    expect(ausente.map((d) => d.slug)).toEqual(['reu_no_show']);
    expect(reagendar.map((d) => d.slug)).toEqual(['reu_reagendada']);
  });

  it('na visita, "não estava" é o ausente e não há reagendar', () => {
    const { realizada, ausente, reagendar } = recortesDoCompromisso(
      catalogo,
      compromisso({ tipo: 'visita', natureza: 'visita' }),
    );
    expect(realizada.map((d) => d.slug)).toEqual(['vis_funcionario']);
    expect(ausente.map((d) => d.slug)).toEqual(['vis_nao_estava']);
    expect(reagendar).toEqual([]);
  });

  it('para quem pediu para parar não sobra desfecho que crie tarefa', () => {
    const { realizada, ausente, reagendar } = recortesDoCompromisso(
      catalogo,
      compromisso({ naoContatar: true }),
    );
    expect([...realizada, ...ausente, ...reagendar]).toEqual([]);
  });
});
