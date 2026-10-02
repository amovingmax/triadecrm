import { describe, expect, it } from 'vitest';

import { ICONE_DO_ITEM, iconeDoItem } from './icones';
import {
  abaDaUrl,
  agruparFila,
  agruparPorDia,
  hojeParaOCorte,
  montarProximosDias,
  alcanceDeQuemRespondeu,
  BLOCOS,
  blocosParaFazer,
  contarPendentesDeHoje,
  destinoDoItem,
  ehAvisoDoSistema,
  ehDosProximos,
  filaVisivel,
  metricasVisiveis,
  ressalvasDasMetricas,
  type ItemDoDia,
  type MetricaDoDia,
} from './tipos';

/**
 * O que estes testes travam é a promessa da tela: a ordem que o banco decidiu não
 * pode ser embaralhada pelo agrupamento, e cada motivo tem de levar ao lugar onde a
 * ação acontece — não a um índice genérico.
 */

function item(parcial: Partial<ItemDoDia>): ItemDoDia {
  return {
    prioridade: 3,
    tipo: 'tarefa_atrasada',
    motivo: 'Tarefa vencida há 2 h',
    titulo: 'Ligar D+1',
    quando: null,
    atrasoHoras: null,
    tarefaId: null,
    atividadeId: null,
    negocioId: null,
    organizacaoId: 'org-1',
    organizacao: 'Buffet Alvorada',
    bairro: 'Tirol',
    categoria: 'Buffet',
    temperatura: 'quente',
    funil: 'Captação de fornecedor',
    etapa: 'Em conversa',
    atendente: null,
    ...parcial,
  };
}

describe('agruparFila', () => {
  it('quebra a fila nas cinco faixas de urgência e preserva a ordem do banco', () => {
    const fila = [
      item({ prioridade: 1, tipo: 'reuniao_proxima', titulo: 'Reunião' }),
      item({ prioridade: 3, titulo: 'Tarefa vencida' }),
      item({ prioridade: 5, tipo: 'tarefa_hoje', titulo: 'Tarefa de hoje' }),
      item({ prioridade: 7, tipo: 'sem_proxima_acao', titulo: 'Sem próxima' }),
      item({ prioridade: 8, tipo: 'negocio_parado', titulo: 'Parado' }),
      item({ prioridade: 9, tipo: 'tarefa_futura', titulo: 'Futura' }),
    ];

    const blocos = agruparFila(fila);
    expect(blocos.map((b) => b.id)).toEqual([
      'agora',
      'hoje',
      'sem_proxima_acao',
      'parados',
      'depois',
    ]);
    expect(blocos[0]?.itens.map((i) => i.titulo)).toEqual(['Reunião', 'Tarefa vencida']);
    expect(blocos[4]?.itens).toHaveLength(1);
  });

  it('não devolve bloco vazio', () => {
    const blocos = agruparFila([item({ prioridade: 9, tipo: 'tarefa_futura' })]);
    expect(blocos.map((b) => b.id)).toEqual(['depois']);
  });

  it('não perde nenhuma linha pelo caminho', () => {
    const fila = [1, 2, 3, 4, 5, 6, 7, 8, 9].map((prioridade) => item({ prioridade }));
    const total = agruparFila(fila).reduce((soma, bloco) => soma + bloco.itens.length, 0);
    expect(total).toBe(fila.length);
  });

  it('conta como pendente tudo que não é o bloco do futuro', () => {
    const fila = [1, 4, 8, 9, 9].map((prioridade) => item({ prioridade }));
    expect(contarPendentesDeHoje(fila)).toBe(3);
  });
});

describe('destinoDoItem', () => {
  it('manda a interação sem resultado para o Registrar contato', () => {
    const destino = destinoDoItem(item({ tipo: 'desfecho_pendente', organizacaoId: 'abc' }));
    expect(destino?.href).toBe('/registrar?org=abc');
  });

  it('manda negócio sem próxima ação e negócio parado para o funil, filtrado no parceiro', () => {
    for (const tipo of ['sem_proxima_acao', 'negocio_parado'] as const) {
      const destino = destinoDoItem(item({ tipo }));
      expect(destino?.href).toBe('/funis?q=Buffet+Alvorada');
    }
  });

  it('leva o funil de produtor para a aba certa do quadro', () => {
    const destino = destinoDoItem(
      item({ tipo: 'sem_proxima_acao', funil: 'Produtor e cerimonialista' }),
    );
    expect(destino?.href).toBe('/funis?funil=produtor&q=Buffet+Alvorada');
  });

  it('manda tarefa e reunião para a ficha do parceiro', () => {
    expect(destinoDoItem(item({ tipo: 'tarefa_atrasada' }))?.href).toBe('/parceiros/org-1');
    expect(destinoDoItem(item({ tipo: 'reuniao_proxima' }))?.href).toBe('/parceiros/org-1');
  });

  it('não inventa link quando a interação não tem alvo resolvido', () => {
    expect(destinoDoItem(item({ organizacaoId: null }))).toBeNull();
  });
});

describe('resumo do dia', () => {
  const metrica = (parcial: Partial<MetricaDoDia>): MetricaDoDia => ({
    metrica: 'doors_opened',
    rotulo: 'Portas abertas',
    meta: null,
    realizado: 3,
    percentual: null,
    mensuravel: true,
    fonte: 'activities cujo desfecho vale porta aberta',
    periodoInicio: '2026-09-04',
    periodoFim: '2026-09-04',
    ...parcial,
  });

  it('mostra os destaques mesmo sem meta definida', () => {
    const visiveis = metricasVisiveis([metrica({}), metrica({ metrica: 'visits_done' })]);
    expect(visiveis.map((m) => m.metrica)).toEqual(['doors_opened']);
  });

  it('mostra qualquer métrica que tenha meta, mesmo fora dos destaques', () => {
    const visiveis = metricasVisiveis([metrica({ metrica: 'visits_done', meta: 2 })]);
    expect(visiveis).toHaveLength(1);
  });

  it('nunca mostra métrica sem lastro como se fosse zero', () => {
    const visiveis = metricasVisiveis([
      metrica({ metrica: 'replies', mensuravel: false, realizado: null, meta: 5 }),
    ]);
    expect(visiveis).toHaveLength(0);
  });

  it('confessa o que não é medível e o que é aproximação', () => {
    const ressalvas = ressalvasDasMetricas([
      metrica({}),
      metrica({
        metrica: 'replies',
        rotulo: 'Respostas recebidas',
        mensuravel: false,
        fonte: 'Ainda não é medível: depende do inbox de WhatsApp (D5)',
      }),
      metrica({
        metrica: 'published',
        rotulo: 'Publicados',
        fonte: 'PROXY: entradas na etapa de ganho',
      }),
    ]);
    expect(ressalvas).toHaveLength(2);
    expect(ressalvas[0]).toContain('Respostas recebidas');
    expect(ressalvas[1]).toContain('é uma aproximação');
  });
});

describe('avisos do sistema não são tarefa de carteira', () => {
  const item = (parcial: Partial<ItemDoDia>): ItemDoDia => ({
    prioridade: 3,
    tipo: 'tarefa_atrasada',
    motivo: 'venceu',
    titulo: 'Ligar para o decisor',
    quando: null,
    atrasoHoras: 2,
    tarefaId: 't1',
    atividadeId: null,
    negocioId: 'n1',
    organizacaoId: 'o1',
    organizacao: 'Buffet Sabor do Mar',
    etapa: null,
    bairro: null,
    categoria: null,
    temperatura: null,
    funil: null,
    atendente: null,
    ...parcial,
  });

  const doSistema = item({
    titulo: 'Dead-letter ai_dlq: 1 mensagem morreu',
    motivo: 'Dead-letter ai_dlq: 1 mensagem morreu',
    negocioId: null,
    organizacaoId: null,
    organizacao: null,
  });

  it('vão para um bloco próprio, no fim da fila', () => {
    const blocos = agruparFila([item({}), doSistema]);
    expect(blocos.map((b) => b.id)).toEqual(['agora', 'sistema']);
    expect(blocos[1]?.recolhidoPorPadrao).toBe(true);
    expect(blocos[0]?.itens).toHaveLength(1);
  });

  it('e não contam como pendência da pessoa', () => {
    expect(contarPendentesDeHoje([item({}), doSistema])).toBe(1);
  });
});

/**
 * O item que o Rafael pediu em 28/09/2026. O que estes testes travam é o que
 * a tela promete: ele abre a fila, não é confundido com um aviso do motor, conta
 * como pendência da pessoa e leva para onde o trabalho acontece — Conversas, e
 * não a ficha.
 */
describe('quem respondeu entra no topo', () => {
  const conversa = () =>
    item({
      prioridade: 0,
      tipo: 'conversa_esperando',
      titulo: 'Responder no WhatsApp',
      motivo: 'A janela de 24 h fecha em 21 h',
      tarefaId: null,
      negocioId: null,
    });

  it('abre a fila num bloco próprio, antes de tudo', () => {
    const blocos = agruparFila([item({ prioridade: 1, tipo: 'reuniao_proxima' }), conversa()]);
    expect(blocos.map((b) => b.id)).toEqual(['respondeu', 'agora']);
  });

  it('conversa sem ficha NÃO é aviso do sistema', () => {
    // Sem isto ela cairia no bloco recolhido do fim, que é onde vão os avisos do
    // motor — e sumiria da vista exatamente como sumia antes.
    expect(ehAvisoDoSistema({ ...conversa(), organizacaoId: null, organizacao: null })).toBe(false);
  });

  it('conta como pendente do dia', () => {
    expect(contarPendentesDeHoje([conversa()])).toBe(1);
  });

  it('leva para a conversa, e para a aba de fora da base quando não há ficha', () => {
    expect(destinoDoItem(conversa())?.href).toBe('/conversas?aba=responderam&org=org-1');
    expect(destinoDoItem({ ...conversa(), organizacaoId: null })?.href).toBe('/conversas?aba=fora');
  });

  it('o ícone é o de escrever, pelo verbo do título', () => {
    expect(iconeDoItem(conversa())).toBe('escrever');
    expect(ICONE_DO_ITEM.conversa_esperando).toBeDefined();
  });
});

describe('as três abas', () => {
  it('"Para fazer" é a fila sem o bloco do futuro, e o aviso do sistema continua no fim', () => {
    const blocos = agruparFila([
      item({ prioridade: 3 }),
      item({ prioridade: 9, tipo: 'tarefa_futura' }),
      item({ organizacaoId: null, negocioId: null, titulo: 'Dead-letter ai_dlq' }),
    ]);
    expect(blocosParaFazer(blocos).map((b) => b.id)).toEqual(['agora', 'sistema']);
  });

  it('"Para fazer" continua abrindo com quem respondeu e está esperando', () => {
    const blocos = agruparFila([
      item({ prioridade: 1, tipo: 'reuniao_proxima' }),
      item({ prioridade: 9, tipo: 'tarefa_futura' }),
      item({ prioridade: 0, tipo: 'conversa_esperando', titulo: 'Responder no WhatsApp' }),
    ]);
    const paraFazer = blocosParaFazer(blocos);
    expect(paraFazer.map((b) => b.id)).toEqual(['respondeu', 'agora']);
    expect(paraFazer[0]?.titulo).toBe('Responderam e estão esperando');
  });

  it('os blocos de hoje se chamam "Urgente" e "Até o fim do dia"', () => {
    const titulo = (id: string) => BLOCOS.find((b) => b.id === id)?.titulo;
    expect(titulo('agora')).toBe('Urgente');
    expect(titulo('hoje')).toBe('Até o fim do dia');
  });

  it('"Próximos dias" agrupa por dia em ordem de data e deixa o sem data por último', () => {
    const diaDe = (iso: string) => iso.slice(0, 10);
    // A ordem em que a `meu_dia` devolveu a base local: 29/09, 02/10, 30/09, 01/10.
    const dias = agruparPorDia(
      [
        item({ titulo: 'a', quando: '2026-09-29T09:00:00-03:00' }),
        item({ titulo: 'sem', quando: null }),
        item({ titulo: 'd', quando: '2026-10-02T10:00:00-03:00' }),
        item({ titulo: 'b', quando: '2026-09-30T15:00:00-03:00' }),
        item({ titulo: 'c', quando: '2026-10-01T10:00:00-03:00' }),
        item({ titulo: 'a2', quando: '2026-09-29T08:00:00-03:00' }),
      ],
      diaDe,
    );
    expect(dias.map((d) => [d.dia, d.itens.map((i) => i.titulo)])).toEqual([
      ['2026-09-29', ['a2', 'a']],
      ['2026-09-30', ['b']],
      ['2026-10-01', ['c']],
      ['2026-10-02', ['d']],
      [null, ['sem']],
    ]);
  });

  it('a aba da URL só aceita as três, e o resto abre em "Para fazer"', () => {
    expect(abaDaUrl('feito')).toBe('feito');
    expect(abaDaUrl('proximos')).toBe('proximos');
    expect(abaDaUrl('qualquer')).toBe('fazer');
    expect(abaDaUrl(['feito'])).toBe('fazer');
    expect(abaDaUrl(undefined)).toBe('fazer');
  });
});

/**
 * NENHUMA LINHA DA `meu_dia` SOME ENTRE AS ABAS.
 *
 * Com a fila partida em "Para fazer" e "Próximos dias", o risco novo é uma prioridade
 * cair no vão entre as duas: estar fora dos blocos de hoje E fora do futuro. A tabela
 * abaixo é o que `public.meu_dia` devolve hoje (20261002180000, blocos 0 a 9: a
 * conversa esperando, a reunião próxima, o desfecho pendente, as tarefas por prazo e
 * o negócio pelo motivo mais urgente). Uma prioridade nova na função tem de entrar
 * aqui e num bloco de `BLOCOS` — é o que o segundo teste cobra.
 */
describe('toda prioridade da meu_dia tem aba', () => {
  const DA_MEU_DIA = [
    [0, 'conversa_esperando', '2026-09-30T08:00:00-03:00'],
    [1, 'reuniao_proxima', '2026-09-30T10:00:00-03:00'],
    [2, 'desfecho_pendente', '2026-09-29T15:00:00-03:00'],
    [3, 'tarefa_atrasada', '2026-09-28T09:00:00-03:00'],
    [4, 'proxima_acao_atrasada', '2026-09-27T09:00:00-03:00'],
    [5, 'tarefa_hoje', '2026-09-30T17:00:00-03:00'],
    [6, 'proxima_acao_hoje', '2026-09-30T18:00:00-03:00'],
    [7, 'sem_proxima_acao', null],
    [8, 'negocio_parado', '2026-10-05T09:00:00-03:00'],
    [9, 'tarefa_futura', '2026-10-02T09:00:00-03:00'],
    [9, 'tarefa_sem_data', null],
  ] as const;

  const onde = (linha: ItemDoDia) => {
    const naFazer = blocosParaFazer(agruparFila([linha])).some((b) => b.itens.includes(linha));
    const nosProximos = ehDosProximos(linha);
    return { naFazer, nosProximos };
  };

  it('cada linha cai em exatamente uma das duas abas', () => {
    for (const [prioridade, tipo, quando] of DA_MEU_DIA) {
      for (const comParceiro of [true, false]) {
        const linha = item({
          prioridade,
          tipo,
          quando,
          // Sem parceiro e sem negócio vira aviso do sistema, que mora em "Para fazer".
          ...(comParceiro ? {} : { organizacaoId: null, organizacao: null, negocioId: null }),
        });
        const { naFazer, nosProximos } = onde(linha);
        expect({
          prioridade,
          tipo,
          comParceiro,
          abas: Number(naFazer) + Number(nosProximos),
        }).toEqual({ prioridade, tipo, comParceiro, abas: 1 });
      }
    }
  });

  it('as faixas de BLOCOS cobrem 0 a 9 sem repetir nenhuma', () => {
    const faixas = BLOCOS.flatMap((b) => b.prioridades);
    expect([...faixas].sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    const daFuncao = [...new Set(DA_MEU_DIA.map(([prioridade]) => prioridade))];
    expect(daFuncao.every((p) => faixas.includes(p))).toBe(true);
  });
});

describe('dia de outra pessoa', () => {
  it('toda linha leva só à ficha: registrar ou mover gravaria no nome de quem olha', () => {
    for (const tipo of ['desfecho_pendente', 'sem_proxima_acao', 'negocio_parado'] as const) {
      expect(destinoDoItem(item({ tipo }), { somenteLeitura: true })).toEqual({
        href: '/parceiros/org-1',
        onde: 'a ficha do parceiro',
      });
    }
    expect(destinoDoItem(item({ tipo: 'desfecho_pendente' }))?.href).toBe('/registrar?org=org-1');
  });

  it('a conversa do embaixador também leva à ficha, e a de fora da base não vira link', () => {
    const conversa = item({ prioridade: 0, tipo: 'conversa_esperando' });
    expect(destinoDoItem(conversa, { somenteLeitura: true })?.href).toBe('/parceiros/org-1');
    expect(
      destinoDoItem({ ...conversa, organizacaoId: null }, { somenteLeitura: true }),
    ).toBeNull();
  });

  it('o bloco de quem respondeu segue o papel da pessoa do dia, como a meu_dia', () => {
    expect(alcanceDeQuemRespondeu('admin')).toBe('todos');
    expect(alcanceDeQuemRespondeu('gestor')).toBe('todos');
    expect(alcanceDeQuemRespondeu('sdr')).toBe('todos');
    expect(alcanceDeQuemRespondeu('embaixador')).toBe('propria');
    expect(alcanceDeQuemRespondeu('leitura')).toBe('nenhuma');
    expect(alcanceDeQuemRespondeu(null)).toBe('nenhuma');
  });

  it('a fila comum de quem respondeu some do dia de outra pessoa, e só dela', () => {
    const fila = [
      item({ prioridade: 0, tipo: 'conversa_esperando' }),
      item({ prioridade: 3, tipo: 'tarefa_atrasada' }),
    ];
    const tipos = (itens: readonly ItemDoDia[]) => itens.map((i) => i.tipo);

    // O próprio dia: tudo o que o banco devolveu, qualquer que seja o papel.
    expect(tipos(filaVisivel(fila, { doProprio: true, alcance: 'todos' }))).toEqual([
      'conversa_esperando',
      'tarefa_atrasada',
    ]);
    // O dia de uma SDR aberto pelo gestor: a fila de todos não é dela.
    expect(tipos(filaVisivel(fila, { doProprio: false, alcance: 'todos' }))).toEqual([
      'tarefa_atrasada',
    ]);
    // O dia de um embaixador: as conversas vieram endereçadas a ele, e ficam.
    expect(tipos(filaVisivel(fila, { doProprio: false, alcance: 'propria' }))).toEqual([
      'conversa_esperando',
      'tarefa_atrasada',
    ]);
  });
});

describe('os próximos dias lidos por conta própria', () => {
  /**
   * O defeito que estes testes guardam: a aba saía da fila, que tem teto de 60
   * linhas e deixa o futuro por último. Quem tinha 60 pendências marcava uma
   * reunião e não a via aqui. Agora as linhas nascem das tarefas, e têm de ser as
   * MESMAS que a faixa 9 da `public.meu_dia` montaria.
   */
  const PARCEIRO = {
    id: 'o1',
    name: 'Abracadabra Festas',
    neighborhood: 'Tirol',
    primary_category_name: 'Buffet infantil',
    do_not_contact: false,
  };
  const NEGOCIO = {
    id: 'd1',
    temperature: 'quente' as const,
    funil: 'Captação de fornecedor',
    etapa: 'Reunião marcada',
  };
  const tarefa = (
    parcial: Partial<Parameters<typeof montarProximosDias>[0]['tarefas'][number]>,
  ) => ({
    id: 't1',
    title: 'Reunião com Abracadabra Festas',
    due_at: '2026-10-05T12:30:00+00:00',
    deal_id: 'd1',
    organization_id: 'o1',
    ...parcial,
  });

  it('a tarefa com data à frente vira a mesma linha que a fila montaria', () => {
    const [linha] = montarProximosDias({
      tarefas: [tarefa({})],
      parceiros: [PARCEIRO],
      negocios: [NEGOCIO],
    });
    expect(linha).toEqual({
      prioridade: 9,
      tipo: 'tarefa_futura',
      motivo: 'Tarefa agendada',
      titulo: 'Reunião com Abracadabra Festas',
      quando: '2026-10-05T12:30:00+00:00',
      atrasoHoras: null,
      tarefaId: 't1',
      atividadeId: null,
      negocioId: 'd1',
      organizacaoId: 'o1',
      organizacao: 'Abracadabra Festas',
      bairro: 'Tirol',
      categoria: 'Buffet infantil',
      temperatura: 'quente',
      funil: 'Captação de fornecedor',
      etapa: 'Reunião marcada',
      atendente: null,
    });
    expect(ehDosProximos(linha as ItemDoDia)).toBe(true);
  });

  it('não há teto: setenta compromissos entram os setenta', () => {
    const tarefas = Array.from({ length: 70 }, (_, i) => tarefa({ id: `t${i}` }));
    expect(
      montarProximosDias({ tarefas, parceiros: [PARCEIRO], negocios: [NEGOCIO] }),
    ).toHaveLength(70);
  });

  it('tarefa sem prazo entra como "sem data"', () => {
    const [linha] = montarProximosDias({
      tarefas: [tarefa({ due_at: null })],
      parceiros: [PARCEIRO],
      negocios: [],
    });
    expect(linha).toMatchObject({
      tipo: 'tarefa_sem_data',
      motivo: 'Tarefa sem prazo',
      quando: null,
    });
  });

  it('parceiro que pediu para não ser contatado não aparece', () => {
    expect(
      montarProximosDias({
        tarefas: [tarefa({})],
        parceiros: [{ ...PARCEIRO, do_not_contact: true }],
        negocios: [NEGOCIO],
      }),
    ).toEqual([]);
  });

  it('parceiro apagado (a view não o devolve) não aparece', () => {
    expect(
      montarProximosDias({ tarefas: [tarefa({})], parceiros: [], negocios: [NEGOCIO] }),
    ).toEqual([]);
  });

  it('para quem não vê a base inteira, parceiro fora da vista não esconde o compromisso', () => {
    // O gestor marca para o embaixador uma reunião num parceiro que é de outra
    // pessoa. A view não devolve o parceiro, mas o compromisso é dele e tem de
    // aparecer: sem os dados do parceiro, com o título da tarefa.
    const [linha] = montarProximosDias({
      tarefas: [tarefa({})],
      parceiros: [],
      negocios: [],
      parceiroForaDaVista: 'mantem',
    });
    expect(linha).toMatchObject({
      titulo: 'Reunião com Abracadabra Festas',
      organizacaoId: 'o1',
      organizacao: null,
      tipo: 'tarefa_futura',
    });
    // Parceiro que pediu para não ser contatado continua fora, para todo mundo.
    expect(
      montarProximosDias({
        tarefas: [tarefa({})],
        parceiros: [{ ...PARCEIRO, do_not_contact: true }],
        negocios: [],
        parceiroForaDaVista: 'mantem',
      }),
    ).toEqual([]);
  });

  it('app aberto desde ontem: o corte é o dia de hoje, e não o da tela', () => {
    // A tela abriu em 01/10 e ficou aberta; agora é 02/10. Cortando por 01/10, as
    // tarefas de 02/10 apareceriam aqui como "Amanhã".
    expect(hojeParaOCorte('2026-10-01', '2026-10-02')).toBe('2026-10-02');
    // Tela aberta hoje: o mesmo dia.
    expect(hojeParaOCorte('2026-10-02', '2026-10-02')).toBe('2026-10-02');
    // Relógio do aparelho atrasado não puxa o corte para trás.
    expect(hojeParaOCorte('2026-10-02', '2026-09-30')).toBe('2026-10-02');
    // Virada de mês e de ano se comparam certo como texto.
    expect(hojeParaOCorte('2026-12-31', '2027-01-01')).toBe('2027-01-01');
  });

  it('aviso do motor, sem parceiro e sem negócio, não é compromisso', () => {
    expect(
      montarProximosDias({
        tarefas: [tarefa({ organization_id: null, deal_id: null, title: 'Dead-letter ai_dlq' })],
        parceiros: [],
        negocios: [],
      }),
    ).toEqual([]);
  });

  it('sem o negócio a linha sai, só sem funil e etapa', () => {
    const [linha] = montarProximosDias({
      tarefas: [tarefa({})],
      parceiros: [PARCEIRO],
      negocios: [],
    });
    expect(linha).toMatchObject({ organizacao: 'Abracadabra Festas', funil: null, etapa: null });
  });

  it('agrupa por dia como o resto da aba', () => {
    const itens = montarProximosDias({
      tarefas: [
        tarefa({ id: 'b', due_at: '2026-10-06T16:40:00+00:00' }),
        tarefa({ id: 'a', due_at: '2026-10-05T12:30:00+00:00' }),
        tarefa({ id: 'c', due_at: null }),
      ],
      parceiros: [PARCEIRO],
      negocios: [NEGOCIO],
    });
    const dias = agruparPorDia(itens, (iso) => iso.slice(0, 10));
    expect(dias.map((d) => [d.dia, d.itens.map((i) => i.tarefaId)])).toEqual([
      ['2026-10-05', ['a']],
      ['2026-10-06', ['b']],
      [null, ['c']],
    ]);
  });
});
