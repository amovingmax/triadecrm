import { describe, expect, it } from 'vitest';

import {
  agruparPorBairro,
  BAIRRO_SEM_NOME,
  blocosDoDia,
  chaveDoCompromisso,
  conflitosDoCalendly,
  consultaDoMapa,
  contarPorDia,
  diaDaSemana,
  diasDaSemana,
  ehFimDeSemana,
  escolherResultado,
  faixaDeHoras,
  horaEmNatal,
  inicioDaSemana,
  janelaDeDias,
  linkDoMapa,
  lugarDeVerdade,
  mapaPorNome,
  naturezaDoCompromisso,
  numeroDoDia,
  ondeDoCompromisso,
  PELO_CALENDLY,
  proximoCompromisso,
  recortesDoCompromisso,
  resultadoDoDesfecho,
  rotuloDaSemana,
  rotuloSemanaCurto,
  somarDias,
  tituloDosAvisos,
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
    reuniaoId: null,
    fim: null,
    link: null,
    local: null,
    estado: null,
    marcadaPeloRobo: false,
    peloCalendly: false,
    emConflito: false,
    horaCombinada: false,
    novo: false,
    avisoEnviadoEm: null,
    reuniaoCriadaEm: null,
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
    resultado: null,
    reagendada: false,
    responsavelId: 'pessoa-1',
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

  it('na visita do Calendly, busca pelo endereço que o cliente escreveu', () => {
    const c = compromisso({ tipo: 'visita', peloCalendly: true, local: 'Rua das Algas, 120' });
    expect(mapaPorNome(c)).toBe(false);
    expect(consultaDoMapa(c)).toBe('Rua das Algas, 120, Tirol, Natal, RN');
  });

  it('o endereço da reunião presencial não vira busca de mapa da visita', () => {
    const c = compromisso({ tipo: 'reuniao', local: 'Sala da Imova' });
    expect(mapaPorNome(c)).toBe(true);
  });

  it('"Local a combinar" do banco não é endereço: o Maps busca pelo nome', () => {
    const c = compromisso({
      tipo: 'visita',
      peloCalendly: true,
      local: 'Local a combinar (o Calendly não informou)',
    });
    expect(mapaPorNome(c)).toBe(true);
    expect(consultaDoMapa(c)).toBe('Buffet Sabor, Tirol, Natal, RN');
  });

  it('sem lugar do Calendly, vale o endereço da ficha', () => {
    const c = compromisso({
      tipo: 'visita',
      local: 'Local a combinar (o anúncio IM0003 não tem endereço)',
      endereco: 'Av. Prudente de Morais, 100',
    });
    expect(consultaDoMapa(c)).toBe('Av. Prudente de Morais, 100, Tirol, Natal, RN');
  });

  it('o endereço do anúncio busca sem o código, que o Maps não conhece', () => {
    const c = compromisso({
      tipo: 'visita',
      peloCalendly: true,
      local: 'Rua Teste 154, 10, Ponta Negra, Natal (anúncio IM0003)',
    });
    expect(mapaPorNome(c)).toBe(false);
    expect(consultaDoMapa(c)).toBe('Rua Teste 154, 10, Ponta Negra, Natal, Tirol, Natal, RN');
  });
});

describe('lugar de verdade', () => {
  it('o "Local a combinar…" do banco vale como nada, em qualquer caixa', () => {
    expect(lugarDeVerdade('Local a combinar (o Calendly não informou)')).toBeNull();
    expect(lugarDeVerdade('  local a combinar ')).toBeNull();
    expect(lugarDeVerdade(null)).toBeNull();
    expect(lugarDeVerdade('   ')).toBeNull();
  });

  it('o resto é lugar, aparado', () => {
    expect(lugarDeVerdade(' Rua das Algas, 120 ')).toBe('Rua das Algas, 120');
    expect(lugarDeVerdade('Localiza Hertz, Ponta Negra')).toBe('Localiza Hertz, Ponta Negra');
  });
});

describe('onde acontece', () => {
  it('a sala diz a plataforma', () => {
    expect(ondeDoCompromisso({ link: 'https://meet.google.com/abc-defg-hij', local: null })).toEqual({
      formato: 'online',
      texto: 'On-line · Google Meet',
    });
    expect(ondeDoCompromisso({ link: 'https://us02web.zoom.us/j/123', local: null })?.texto).toBe(
      'On-line · Zoom',
    );
    expect(ondeDoCompromisso({ link: 'https://exemplo.com/sala', local: null })?.texto).toBe(
      'On-line',
    );
  });

  it('sem sala, o endereço; sem nada, nada', () => {
    expect(ondeDoCompromisso({ link: null, local: ' Rua das Algas, 120 ' })).toEqual({
      formato: 'presencial',
      texto: 'Rua das Algas, 120',
    });
    expect(ondeDoCompromisso({ link: '  ', local: null })).toBeNull();
    expect(ondeDoCompromisso({ link: 'não é link', local: null })?.texto).toBe('On-line');
  });

  it('"Local a combinar" não vira linha de onde; o código do anúncio aparece', () => {
    expect(
      ondeDoCompromisso({ link: null, local: 'Local a combinar (o Calendly não informou)' }),
    ).toBeNull();
    expect(
      ondeDoCompromisso({ link: null, local: 'Rua Teste 154, 10, Ponta Negra (anúncio IM0003)' })
        ?.texto,
    ).toBe('Rua Teste 154, 10, Ponta Negra (anúncio IM0003)');
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


/**
 * A reunião virou objeto do banco (ADR-15), e a tela lê a reunião — não o eco.
 * O que estes testes seguram é a fronteira: quando a linha de `reunioes` manda,
 * e quando a `meeting` antiga, sem objeto, continua sendo lida pela régua velha.
 */
describe('reunião e eco', () => {
  it('a chave de lista prefere a reunião ao eco', () => {
    expect(chaveDoCompromisso(compromisso({ reuniaoId: 'r1', taskId: 't1' }))).toBe('r1');
  });

  it('sem reunião, a chave continua sendo a da tarefa', () => {
    expect(chaveDoCompromisso(compromisso({ reuniaoId: null, taskId: 't1' }))).toBe('t1');
  });

  it('"marcado" passa a querer dizer "tem linha em reunioes"', () => {
    expect(
      naturezaDoCompromisso({ reuniaoId: 'r1', tipo: 'reuniao', etapaId: null }, new Set()),
    ).toBe('marcado');
  });

  it('a etapa que exige meeting_at continua classificando a `meeting` ANTIGA, sem reunião', () => {
    expect(
      naturezaDoCompromisso({ reuniaoId: null, tipo: 'reuniao', etapaId: 5 }, new Set([5])),
    ).toBe('marcado');
  });

  it('e sem reunião nem etapa de hora marcada, é apresentação a combinar', () => {
    expect(
      naturezaDoCompromisso({ reuniaoId: null, tipo: 'reuniao', etapaId: 4 }, new Set([5])),
    ).toBe('a_marcar');
  });

  it('visita é visita, com reunião ou sem', () => {
    expect(
      naturezaDoCompromisso({ reuniaoId: 'r1', tipo: 'visita', etapaId: 5 }, new Set([5])),
    ).toBe('visita');
  });

  it('a reunião do Calendly sem linha em reunioes (a do conflito) tem hora: é marcada', () => {
    expect(
      naturezaDoCompromisso(
        { reuniaoId: null, tipo: 'reuniao', etapaId: 4, peloCalendly: true },
        new Set([5]),
      ),
    ).toBe('marcado');
  });

  it('mostra 10h20–11h00, e não só o começo: é a primeira vez que o produto tem fim', () => {
    expect(
      faixaDeHoras({ quando: '2026-10-01T13:20:00.000Z', fim: '2026-10-01T14:00:00.000Z' }),
    ).toBe('10h20–11h00');
  });

  it('sem fim, mostra só a hora — a `meeting` antiga não ganha fim inventado', () => {
    expect(faixaDeHoras({ quando: '2026-10-01T13:20:00.000Z', fim: null })).toBe('10h20');
  });
});

describe('o que vem do Calendly', () => {
  // 10h00 de Natal = 13h00 UTC.
  const as10 = '2026-11-12T13:00:00.000Z';

  it('reunião do Calendly em cima de outra reunião: só a do Calendly leva o selo', () => {
    const daEquipe = compromisso({ taskId: 'equipe', quando: as10, fim: '2026-11-12T13:40:00.000Z' });
    const doCalendly = compromisso({
      taskId: 'calendly',
      quando: '2026-11-12T13:15:00.000Z',
      fim: '2026-11-12T13:45:00.000Z',
      peloCalendly: true,
    });
    expect([...conflitosDoCalendly([daEquipe, doCalendly])]).toEqual(['calendly']);
  });

  it('encostar não é sobrepor, como na trava do banco', () => {
    const antes = compromisso({ taskId: 'a', quando: as10, fim: '2026-11-12T13:30:00.000Z' });
    const depois = compromisso({
      taskId: 'b',
      quando: '2026-11-12T13:30:00.000Z',
      fim: '2026-11-12T14:00:00.000Z',
      peloCalendly: true,
    });
    expect(conflitosDoCalendly([antes, depois]).size).toBe(0);
  });

  it('sem fim guardado, vale a duração padrão: 45 min a visita, 40 a reunião', () => {
    const visita = compromisso({ taskId: 'v', tipo: 'visita', natureza: 'visita', quando: as10 });
    const as1040 = compromisso({ taskId: 'c1', quando: '2026-11-12T13:40:00.000Z', peloCalendly: true });
    const as1045 = compromisso({ taskId: 'c2', quando: '2026-11-12T13:45:00.000Z', peloCalendly: true });
    expect([...conflitosDoCalendly([visita, as1040])]).toEqual(['c1']);
    expect(conflitosDoCalendly([visita, as1045]).size).toBe(0);
  });

  it('o que já foi feito e o que está "a marcar" não ocupam horário', () => {
    const feito = compromisso({ taskId: 'f', quando: as10, concluido: true });
    const aMarcar = compromisso({ taskId: 'm', quando: as10, natureza: 'a_marcar' });
    const doCalendly = compromisso({ taskId: 'c', quando: as10, peloCalendly: true });
    expect(conflitosDoCalendly([feito, aMarcar, doCalendly]).size).toBe(0);
  });

  it('dois do Calendly no mesmo horário: os dois levam o selo', () => {
    const um = compromisso({ taskId: 'um', quando: as10, peloCalendly: true });
    const outro = compromisso({ taskId: 'outro', quando: as10, peloCalendly: true });
    expect(conflitosDoCalendly([um, outro])).toEqual(new Set(['um', 'outro']));
  });

  it('o título do aviso: só Calendly, só uma pessoa, ou a mistura', () => {
    const cal = { quemMarcou: PELO_CALENDLY };
    expect(tituloDosAvisos([cal])).toBe('Novo agendamento pelo Calendly');
    expect(tituloDosAvisos([cal, cal])).toBe('2 agendamentos novos pelo Calendly');
    expect(tituloDosAvisos([{ quemMarcou: 'Gina' }])).toBe('Gina marcou um compromisso na sua agenda');
    expect(tituloDosAvisos([cal, { quemMarcou: 'Gina' }])).toBe(
      '2 compromissos novos na sua agenda, da equipe e do Calendly',
    );
    expect(tituloDosAvisos([{ quemMarcou: 'Gina' }, { quemMarcou: 'Rui' }])).toBe(
      '2 compromissos novos na sua agenda, marcados pela equipe',
    );
  });
});

describe('a porta de remarcar é uma só', () => {
  const catalogo: DesfechoCatalogo[] = [
    {
      slug: 'reu_reagendada',
      label: 'Reagendada',
      surfaces: ['reuniao'],
      creates_task: true,
      requires_meeting_at: true,
      sort_order: 1,
      is_active: true,
      com_quem_default: null,
      requires_note: false,
      is_negative: false,
    } as unknown as DesfechoCatalogo,
    {
      slug: 'reu_interessado',
      label: 'Interessado',
      surfaces: ['reuniao'],
      creates_task: true,
      requires_meeting_at: false,
      sort_order: 2,
      is_active: true,
      com_quem_default: null,
      requires_note: false,
      is_negative: false,
    } as unknown as DesfechoCatalogo,
  ];

  it('compromisso COM reunião não oferece "Reagendada" na folha: remarcar é o botão do cartão', () => {
    expect(recortesDoCompromisso(catalogo, compromisso({ reuniaoId: 'r1' })).reagendar).toEqual([]);
  });

  it('compromisso SEM reunião continua oferecendo, porque é o único caminho que ele tem', () => {
    expect(
      recortesDoCompromisso(catalogo, compromisso({ reuniaoId: null })).reagendar.length,
    ).toBeGreaterThan(0);
  });
});
describe('o resultado do compromisso (cor do cartão)', () => {
  function desfecho(parcial: Partial<DesfechoCatalogo>): DesfechoCatalogo {
    return {
      id: 1,
      slug: 'reu_interessado',
      name: 'Realizada, interessado',
      surfaces: ['reuniao'],
      position: 1,
      cooldown_days: 0,
      can_reactivate: true,
      next_action_kind: null,
      next_action_label: null,
      next_action_offset_days: 0,
      target_stage_slug: 'apresentacao_realizada',
      sets_temperature: 'quente',
      requires_lost_reason: false,
      counts_as: 'aberta',
      ...parcial,
    } as DesfechoCatalogo;
  }

  it('autorizou é sucesso com troféu, e a frase "Parceiro autorizou"', () => {
    const r = resultadoDoDesfecho(
      desfecho({
        slug: 'reu_autorizou',
        name: 'Realizada, autorizou',
        target_stage_slug: 'cadastro_em_andamento',
      }),
      'reuniao',
    );
    expect(r).toEqual({
      tom: 'sucesso',
      rotulo: 'Parceiro autorizou',
      desfecho: 'Realizada, autorizou',
      trofeu: true,
    });
  });

  it('o troféu é do DESFECHO, não da etapa: "Cadastro iniciado na hora" leva ao mesmo lugar e não ganha', () => {
    // Desde 07/10/2026 os dois desfechos têm o mesmo destino (a etapa "Autorizou"
    // saiu do funil). Decidir pela etapa daria troféu a quem não autorizou nada.
    const r = resultadoDoDesfecho(
      desfecho({
        slug: 'vis_cadastro_iniciado',
        name: 'Cadastro iniciado na hora',
        surfaces: ['visita'],
        target_stage_slug: 'cadastro_em_andamento',
      }),
      'visita',
    );
    expect(r).toMatchObject({ tom: 'sucesso', rotulo: 'Cadastro iniciado na hora', trofeu: false });
  });

  it('interessado é sucesso, sem troféu: o troféu é só da autorização', () => {
    expect(resultadoDoDesfecho(desfecho({}), 'reuniao')).toEqual({
      tom: 'sucesso',
      rotulo: 'Realizada, interessado',
      desfecho: 'Realizada, interessado',
      trofeu: false,
    });
    expect(
      resultadoDoDesfecho(
        desfecho({
          slug: 'vis_decisor_interessado',
          name: 'Decisor interessado',
          surfaces: ['visita'],
          target_stage_slug: 'respondeu',
        }),
        'visita',
      ),
    ).toMatchObject({ tom: 'sucesso', rotulo: 'Decisor interessado', trofeu: false });
  });

  it('"agora não" é adiado, com o nome do catálogo', () => {
    expect(
      resultadoDoDesfecho(
        desfecho({
          slug: 'vis_decisor_agora_nao',
          name: 'Decisor, agora não',
          surfaces: ['visita'],
          target_stage_slug: 'nutricao',
          sets_temperature: 'frio',
        }),
        'visita',
      ),
    ).toMatchObject({ tom: 'adiado', rotulo: 'Decisor, agora não', trofeu: false });
  });

  it('no-show é ausência: "Parceiro não compareceu" na reunião, "não estava" na visita', () => {
    expect(
      resultadoDoDesfecho(
        desfecho({ slug: 'reu_no_show', name: 'No-show', target_stage_slug: null }),
        'reuniao',
      ),
    ).toMatchObject({ tom: 'ausente', rotulo: 'Parceiro não compareceu' });
    expect(
      resultadoDoDesfecho(
        desfecho({ slug: 'vis_nao_estava', name: 'Não estava / fechado', surfaces: ['visita'] }),
        'visita',
      ),
    ).toMatchObject({ tom: 'ausente', rotulo: 'Parceiro não estava' });
  });

  it('reagendada tem o tom próprio, e perdido é perda', () => {
    expect(
      resultadoDoDesfecho(desfecho({ slug: 'reu_reagendada', name: 'Reagendada' }), 'reuniao'),
    ).toMatchObject({ tom: 'reagendado', rotulo: 'Reagendada' });
    expect(
      resultadoDoDesfecho(
        desfecho({ slug: 'reu_nao', name: 'Realizada, não', target_stage_slug: 'perdido' }),
        'reuniao',
      ),
    ).toMatchObject({ tom: 'perda', rotulo: 'Parceiro recusou' });
  });

  it('o resto é neutro, com o nome do catálogo — inclusive desfecho novo do gestor', () => {
    // Mesma etapa e mesma temperatura do "interessado": só o slug separa os dois.
    expect(
      resultadoDoDesfecho(
        desfecho({ slug: 'reu_objecao', name: 'Realizada, com objeção' }),
        'reuniao',
      ),
    ).toMatchObject({ tom: 'neutro', rotulo: 'Realizada, com objeção' });
    expect(
      resultadoDoDesfecho(
        desfecho({
          slug: 'reu_novo_do_gestor',
          name: 'Cadastro na hora',
          target_stage_slug: 'cadastro_em_andamento',
        }),
        'reuniao',
      ),
    ).toMatchObject({ tom: 'sucesso', rotulo: 'Cadastro na hora' });
  });
});

describe('de qual registro sai o resultado (opção A, sem banco)', () => {
  // Reunião às 10h30 de quinta, 10/09, em Natal.
  const quando = '2026-09-10T13:30:00.000Z';
  const r = (registradoEm: string, desfechoId: number) => ({ registradoEm, desfechoId });

  it('fechada pela Agenda: vale o último registro até o fechamento, mesmo antes do dia', () => {
    // Registrado na quarta (véspera) e fechado segundos depois; a ligação de sexta não conta.
    expect(
      escolherResultado({ quando, fechadoEm: '2026-09-09T15:00:02.000Z' }, [
        r('2026-09-09T11:00:00.000Z', 1),
        r('2026-09-09T15:00:01.000Z', 2),
        r('2026-09-11T12:00:00.000Z', 3),
      ]),
    ).toEqual(r('2026-09-09T15:00:01.000Z', 2));
  });

  it('fechada, mas sem registro perto do fechamento: sem resultado, e não um chute', () => {
    expect(
      escolherResultado({ quando, fechadoEm: '2026-09-10T15:00:00.000Z' }, [
        r('2026-09-01T12:00:00.000Z', 1),
      ]),
    ).toBeNull();
  });

  it('sem fechamento: vale o mais recente do dia — não a ligação que confirmou', () => {
    expect(
      escolherResultado({ quando, fechadoEm: null }, [
        r('2026-09-10T11:00:00.000Z', 1),
        r('2026-09-10T14:20:00.000Z', 2),
      ]),
    ).toEqual(r('2026-09-10T14:20:00.000Z', 2));
  });

  it('sem fechamento e sem registro no dia: o primeiro depois dele; o dia é o de Natal', () => {
    expect(
      escolherResultado({ quando, fechadoEm: null }, [
        r('2026-09-12T12:00:00.000Z', 3),
        r('2026-09-11T12:00:00.000Z', 4),
      ]),
    ).toEqual(r('2026-09-11T12:00:00.000Z', 4));
    // 01:30 UTC de sexta = 22:30 de quinta em Natal: ainda é o dia do compromisso.
    expect(
      escolherResultado({ quando, fechadoEm: null }, [r('2026-09-11T01:30:00.000Z', 5)]),
    ).toEqual(r('2026-09-11T01:30:00.000Z', 5));
    expect(escolherResultado({ quando, fechadoEm: null }, [])).toBeNull();
  });
});
