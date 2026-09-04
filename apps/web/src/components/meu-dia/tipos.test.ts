import { describe, expect, it } from 'vitest';

import {
  agruparFila,
  contarPendentesDeHoje,
  destinoDoItem,
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
