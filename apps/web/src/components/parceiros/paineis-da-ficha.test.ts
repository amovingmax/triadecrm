import { describe, expect, it } from 'vitest';

import type { MensagemCrua } from '@/components/conversas/mensagens';
import type { AtividadeCrua, HistoricoCru } from '@/components/conversas/montagem';

import {
  arcoDaNota,
  contagemDosPassos,
  montarAtividade,
  montarLeituraDaFicha,
  contatoMaisRecente,
  montarProximosPassos,
  oQueFoiOUltimoContato,
  quando,
  type LeituraCruaDaFicha,
  type ReuniaoCrua,
  type TarefaCrua,
} from './paineis-da-ficha';

/**
 * O que estes testes protegem: os três painéis da ficha dizem o que foi dito, o
 * que está marcado e o que a IA leu. Nenhum dos três pode inventar — reunião que
 * não existe, nota sem leitura, mensagem contada duas vezes — e nenhum pode
 * esconder o que pede ação (tarefa atrasada, reunião sem desfecho, leitura velha).
 */

// 02/10/2026 (sexta), 15:00 em Natal (UTC-3).
const AGORA = new Date('2026-10-02T18:00:00Z');
const HELOISA = 'u-heloisa';
const JANIO = 'u-janio';
const PESSOAS = [
  { id: HELOISA, nome: 'Heloísa SDR (teste)' },
  { id: JANIO, nome: 'Janio Gestor (teste)' },
];

describe('a data, do jeito que se fala', () => {
  it('hoje, amanhã e ontem dispensam a data', () => {
    expect(quando('2026-10-02T15:14:00Z', AGORA, true).texto).toBe('hoje às 12:14');
    expect(quando('2026-10-03T12:30:00Z', AGORA, true).texto).toBe('amanhã às 09:30');
    expect(quando('2026-10-01T20:26:00Z', AGORA, true).texto).toBe('ontem às 17:26');
    expect(quando('2026-10-02T15:14:00Z', AGORA, false).texto).toBe('hoje');
  });

  it('na semana que vem pela frente, o dia da semana vai junto', () => {
    const segunda = quando('2026-10-05T17:00:00Z', AGORA, true);
    expect(segunda.texto).toBe('seg, 05/10 às 14:00');
    expect(segunda).toMatchObject({ palavra: 'seg, ', data: '05/10', hora: '14:00' });
    expect(quando('2026-10-07T12:00:00Z', AGORA, false).texto).toBe('qua, 07/10');
  });

  it('para o passado e para longe, só a data', () => {
    expect(quando('2026-09-30T16:06:00Z', AGORA, true).texto).toBe('30/09 13:06');
    expect(quando('2026-10-20T12:00:00Z', AGORA, false).texto).toBe('20/10');
    expect(quando('2025-12-20T12:00:00Z', AGORA, false).texto).toBe('20/12/2025');
  });

  it('o dia é o de Natal, não o de Londres', () => {
    // 02/10 às 23:30 de Natal já é 03/10 em UTC: continua sendo hoje.
    expect(quando('2026-10-03T02:30:00Z', AGORA, true).texto).toBe('hoje às 23:30');
  });
});

// ---------------------------------------------------------------------------
// Atividade
// ---------------------------------------------------------------------------

function mensagem(parcial: Partial<MensagemCrua> & { id: string }): MensagemCrua {
  return {
    conversation_id: 'c1',
    organization_id: 'o1',
    direction: 'in',
    type: 'text',
    status: 'received',
    body: 'oi',
    media_path: null,
    media_mime: null,
    transcript: null,
    template_id: null,
    draft_id: null,
    author_kind: 'system',
    sent_by: null,
    approved_by: null,
    is_first_contact: false,
    business_initiated: false,
    optout_confirmation: false,
    origin: 'crm',
    error_code: null,
    error_detail: null,
    created_at: '2026-10-02T15:14:00Z',
    sent_at: null,
    delivered_at: null,
    read_at: null,
    failed_at: null,
    ...parcial,
  };
}

function atividade(parcial: Partial<AtividadeCrua> & { id: string }): AtividadeCrua {
  return {
    organization_id: 'o1',
    deal_id: null,
    type: 'call',
    channel: 'phone',
    author_kind: 'human',
    occurred_at: '2026-10-01T17:00:00Z',
    body: null,
    duration_min: null,
    user_id: HELOISA,
    outcome_id: null,
    metadata: {},
    ...parcial,
  };
}

function etapa(parcial: Partial<HistoricoCru> & { id: number }): HistoricoCru {
  return {
    deal_id: 'd1',
    changed_at: '2026-09-30T16:06:00Z',
    from_stage_id: 12,
    to_stage_id: 8,
    changed_by: HELOISA,
    reason: null,
    ...parcial,
  };
}

const ETAPAS = new Map([
  [12, 'Prospectado'],
  [8, 'Reunião marcada'],
]);

const SAIDA_DA_HELOISA = mensagem({
  id: 'm-saida',
  direction: 'out',
  status: 'sent',
  author_kind: 'human',
  sent_by: HELOISA,
  body: '*Heloísa:*\nClaro! Te explico na reunião.',
  created_at: '2026-10-01T19:58:00Z',
  sent_at: '2026-10-01T19:58:05Z',
});

function montar(parcial: Partial<Parameters<typeof montarAtividade>[0]> = {}, limite?: number) {
  return montarAtividade(
    {
      atividades: [],
      historico: [],
      mensagens: [],
      pessoas: PESSOAS,
      desfechos: [{ id: 11, nome: 'Atendeu, retorna depois' }],
      etapas: ETAPAS,
      ...parcial,
    },
    limite,
  );
}

describe('a atividade do parceiro', () => {
  it('a mais nova em cima, e cada tipo com o seu título', () => {
    const { itens } = montar({
      mensagens: [
        mensagem({ id: 'm-entrada', body: 'Podemos confirmar a reunião de segunda?' }),
        SAIDA_DA_HELOISA,
      ],
      historico: [etapa({ id: 2 })],
      atividades: [
        atividade({
          id: 'a-origem',
          type: 'system',
          channel: null,
          author_kind: 'system',
          user_id: null,
          occurred_at: '2026-09-30T15:52:00Z',
          body: 'Importado de planilha',
        }),
      ],
      criadaEm: '2026-09-30T15:52:00Z',
    });

    expect(itens.map((i) => [i.tipo, i.titulo, i.detalhe])).toEqual([
      ['recebida', 'Mensagem recebida', 'Podemos confirmar a reunião de segunda?'],
      ['enviada', 'Heloísa respondeu', 'Claro! Te explico na reunião.'],
      ['etapa', 'Mudou de etapa', 'Prospectado → Reunião marcada'],
      ['origem', 'Entrou na base', 'Importado de planilha'],
    ]);
  });

  it('a assinatura "*Heloísa:*" não é fala: sai do texto e vira o título', () => {
    const [item] = montar({ mensagens: [SAIDA_DA_HELOISA] }).itens;
    expect(item?.detalhe).not.toContain('*');
    expect(item?.citacao).toBe(true);
  });

  it('o que saiu com a janela fechada não é "respondeu"', () => {
    const titulo = (m: Partial<MensagemCrua>) =>
      montar({ mensagens: [{ ...SAIDA_DA_HELOISA, ...m }] }).itens[0]?.titulo;
    expect(titulo({ business_initiated: true })).toBe('Heloísa escreveu');
    expect(titulo({ type: 'template', template_id: 3 })).toBe('Heloísa enviou um modelo');
    expect(titulo({ status: 'failed' })).toBe('Mensagem não entregue');
    expect(titulo({ author_kind: 'bot_fixed', sent_by: null })).toBe('Resposta automática');
  });

  it('áudio sem transcrição diz o que chegou, e não finge uma fala', () => {
    const [item] = montar({ mensagens: [mensagem({ id: 'm1', type: 'audio', body: null })] }).itens;
    expect(item).toMatchObject({ detalhe: 'Mensagem de áudio', citacao: false });
  });

  it('texto longo é cortado com reticências', () => {
    const [item] = montar({ mensagens: [mensagem({ id: 'm1', body: 'a'.repeat(300) })] }).itens;
    expect(item?.detalhe).toHaveLength(120);
    expect(item?.detalhe?.endsWith('…')).toBe(true);
  });

  it('a atividade que espelha uma mensagem carregada não aparece duas vezes', () => {
    const { itens } = montar({
      mensagens: [mensagem({ id: 'm1' })],
      atividades: [atividade({ id: 'a1', type: 'message', channel: 'whatsapp', message_id: 'm1' })],
    });
    expect(itens).toHaveLength(1);
    expect(itens[0]?.tipo).toBe('recebida');
  });

  it('ligação registrada mostra a superfície, o desfecho e a observação', () => {
    const [item] = montar({
      atividades: [atividade({ id: 'a1', outcome_id: 11, body: 'Pediu para ligar às 16h.' })],
    }).itens;
    expect(item).toMatchObject({
      tipo: 'interacao',
      titulo: 'Ligação · Atendeu, retorna depois',
      detalhe: 'Pediu para ligar às 16h.',
    });
    // Sem observação, diz quem registrou.
    expect(montar({ atividades: [atividade({ id: 'a2' })] }).itens[0]?.detalhe).toBe('por Heloísa');
  });

  it('entrar na base e entrar no funil no mesmo instante é uma linha só', () => {
    const origem = atividade({
      id: 'a-origem',
      type: 'system',
      channel: null,
      occurred_at: '2026-09-30T15:52:34Z',
    });
    const entrou = etapa({
      id: 1,
      from_stage_id: null,
      to_stage_id: 12,
      changed_at: '2026-09-30T15:52:34Z',
    });
    const criadaEm = '2026-09-30T15:52:34Z';
    expect(
      montar({ atividades: [origem], historico: [entrou], criadaEm }).itens.map((i) => i.titulo),
    ).toEqual(['Entrou na base']);
    // Entrou no funil dias depois de entrar na base: aí é notícia.
    const depois = { ...entrou, changed_at: '2026-10-01T12:00:00Z' };
    expect(montar({ atividades: [origem], historico: [depois], criadaEm }).itens[0]).toMatchObject({
      titulo: 'Entrou no funil',
      detalhe: 'Prospectado',
    });
  });

  it('nascer na etapa de entrada não é entrar no funil: o funil começa no contato', () => {
    // 07/10/2026: "Prospectado" deixou de ser coluna. Com a etapa marcada como
    // de entrada, a linha diz onde a ficha está de fato.
    const nasceu = etapa({
      id: 1,
      from_stage_id: null,
      to_stage_id: 12,
      changed_at: '2026-10-01T12:00:00Z',
    });
    expect(
      montar({ historico: [nasceu], etapasDeEntrada: new Set([12]) }).itens[0],
    ).toMatchObject({ titulo: 'Entrou em Prospectados', detalhe: 'Ainda não contatado' });
    // E quando sai dela, é uma mudança de etapa como outra qualquer.
    const subiu = etapa({ id: 2, from_stage_id: 12, to_stage_id: 13, changed_at: '2026-10-02T12:00:00Z' });
    expect(
      montar({ historico: [subiu, nasceu], etapasDeEntrada: new Set([12]) }).itens[0]?.titulo,
    ).toBe('Mudou de etapa');
  });

  it('registro do sistema que não nasceu com a ficha não é "Entrou na base"', () => {
    // O motor também grava "Candidato do Radar mesclado nesta ficha" e parecidos.
    // Um mês depois da entrada, isso não pode aparecer como "Entrou na base · hoje".
    const mescla = atividade({
      id: 'a-mescla',
      type: 'system',
      channel: null,
      user_id: null,
      occurred_at: '2026-10-02T14:00:00Z',
      body: 'Candidato do Radar mesclado nesta ficha',
    });
    const [item] = montar({ atividades: [mescla], criadaEm: '2026-09-01T12:00:00Z' }).itens;
    expect(item).toMatchObject({
      titulo: 'Registro do sistema',
      detalhe: 'Candidato do Radar mesclado nesta ficha',
      contato: false,
    });
    // Sem saber quando a ficha nasceu, nenhum registro é chamado de entrada.
    expect(montar({ atividades: [mescla] }).itens[0]?.titulo).toBe('Registro do sistema');
  });

  it('mensagem que a Meta recusou aparece na lista, mas não é contato', () => {
    const falhou = { ...SAIDA_DA_HELOISA, id: 'm-falhou', status: 'failed' };
    const antiga = mensagem({ id: 'm-antiga', created_at: '2026-09-28T15:00:00Z' });
    const atividadeComFalha = montar({ mensagens: [falhou, antiga] });
    expect(atividadeComFalha.itens[0]).toMatchObject({
      titulo: 'Mensagem não entregue',
      contato: false,
    });
    // O contato mais recente é a mensagem recebida dias antes, e não o envio que falhou.
    expect(contatoMaisRecente(atividadeComFalha)?.id).toBe('mensagem:m-antiga');
    expect(oQueFoiOUltimoContato(atividadeComFalha, '2026-10-01T19:58:05Z')).toBeNull();
    expect(contatoMaisRecente(null)).toBeNull();
  });

  it('no mesmo segundo, a mudança de etapa fica acima do que a causou', () => {
    const em = '2026-10-01T17:00:00Z';
    const { itens } = montar({
      atividades: [atividade({ id: 'a1', occurred_at: em })],
      historico: [etapa({ id: 2, changed_at: em })],
    });
    expect(itens.map((i) => i.tipo)).toEqual(['etapa', 'interacao']);
  });

  it('mostra as últimas e avisa que há mais', () => {
    const mensagens = Array.from({ length: 7 }, (_, i) =>
      mensagem({ id: `m${i}`, body: `texto ${i}`, created_at: `2026-10-02T1${i}:00:00Z` }),
    );
    const resumo = montar({ mensagens });
    expect(resumo.itens).toHaveLength(5);
    expect(resumo.itens[0]?.detalhe).toBe('texto 6');
    expect(resumo.haMais).toBe(true);
    expect(montar({ mensagens: mensagens.slice(0, 3) }).haMais).toBe(false);
  });
});

describe('o que foi o último contato', () => {
  const recebida = montar({ mensagens: [mensagem({ id: 'm1' })] });

  it('diz o que foi e a que horas, quando é do mesmo dia do último contato', () => {
    expect(oQueFoiOUltimoContato(recebida, '2026-10-02T15:14:00Z')).toEqual({
      texto: 'mensagem recebida',
      hora: '12:14',
    });
    const ligacao = montar({ atividades: [atividade({ id: 'a1', outcome_id: 11 })] });
    expect(oQueFoiOUltimoContato(ligacao, '2026-10-01T17:00:00Z')?.texto).toBe('ligação');
  });

  it('em dias diferentes não mistura a hora de um com a data do outro', () => {
    expect(oQueFoiOUltimoContato(recebida, '2026-09-28T15:00:00Z')).toBeNull();
  });

  it('mudança de etapa e entrada na base não são contato', () => {
    const soEtapa = montar({ historico: [etapa({ id: 2 })] });
    expect(oQueFoiOUltimoContato(soEtapa, '2026-09-30T16:06:00Z')).toBeNull();
    expect(oQueFoiOUltimoContato(null, '2026-09-30T16:06:00Z')).toBeNull();
    expect(oQueFoiOUltimoContato(recebida, null)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Próximos passos
// ---------------------------------------------------------------------------

function reuniao(parcial: Partial<ReuniaoCrua> & { id: string }): ReuniaoCrua {
  return {
    formato: 'online',
    inicio: '2026-10-05T17:00:00Z',
    fim: '2026-10-05T17:40:00Z',
    estado: 'marcada',
    link: 'https://meet.google.com/sala',
    local: null,
    dono_id: HELOISA,
    task_id: null,
    ...parcial,
  };
}

function tarefa(parcial: Partial<TarefaCrua> & { id: string }): TarefaCrua {
  return {
    title: 'Enviar a tabela de taxas',
    kind: 'follow_up',
    status: 'todo',
    due_at: '2026-10-02T20:00:00Z',
    assignee_id: HELOISA,
    ...parcial,
  };
}

const NOMES = new Map(PESSOAS.map((p) => [p.id, p.nome]));

describe('os próximos passos', () => {
  it('a reunião primeiro, depois as tarefas por prazo', () => {
    const p = montarProximosPassos(
      {
        reunioes: [reuniao({ id: 'r1' })],
        tarefas: [
          tarefa({ id: 't2', title: 'Pedir fotos do espaço', due_at: '2026-10-07T12:00:00Z' }),
          tarefa({ id: 't1' }),
        ],
        pessoas: NOMES,
      },
      AGORA,
    );
    expect(p.passos.map((x) => x.titulo)).toEqual([
      'Reunião on-line',
      'Enviar a tabela de taxas',
      'Pedir fotos do espaço',
    ]);
    expect(p.passos[0]).toMatchObject({
      apoio: 'com Heloísa',
      sala: 'https://meet.google.com/sala',
      selo: null,
    });
    expect(p.passos[0]?.quando?.texto).toBe('seg, 05/10 às 14:00');
    expect(p.passos[1]).toMatchObject({ apoio: 'Tarefa · Heloísa', selo: 'vence hoje' });
    expect(p.passos[2]?.quando?.texto).toBe('qua, 07/10');
    expect(contagemDosPassos(p)).toBe('1 reunião · 2 tarefas');
  });

  it('só a tarefa leva o id que o botão de excluir usa; a reunião sai pela Agenda', () => {
    const p = montarProximosPassos(
      {
        reunioes: [reuniao({ id: 'r1' })],
        tarefas: [tarefa({ id: 't1' })],
        pessoas: NOMES,
      },
      AGORA,
    );
    // O id cru de `tasks`, e não o `tarefa:t1` da chave da lista: é o que
    // `public.tarefa_excluir` recebe.
    expect(p.passos.map((x) => [x.tipo, x.tarefaId])).toEqual([
      ['reuniao', null],
      ['tarefa', 't1'],
    ]);
  });

  it('a tarefa que é o eco de uma reunião não lista a reunião duas vezes', () => {
    const p = montarProximosPassos(
      {
        reunioes: [reuniao({ id: 'r1', task_id: 't-eco' })],
        tarefas: [tarefa({ id: 't-eco', title: 'Reunião com Abracadabra', kind: 'meeting' })],
        pessoas: NOMES,
      },
      AGORA,
    );
    expect(p.passos).toHaveLength(1);
    expect(p.tarefas).toBe(0);
  });

  it('o eco de reunião cancelada também não vira tarefa', () => {
    const p = montarProximosPassos(
      {
        reunioes: [reuniao({ id: 'r1', estado: 'cancelada', task_id: 't-eco' })],
        tarefas: [tarefa({ id: 't-eco', kind: 'meeting' })],
        pessoas: NOMES,
      },
      AGORA,
    );
    expect(p.passos).toEqual([]);
    expect(p.proximaReuniao).toBeNull();
  });

  it('reunião encerrada não é próximo passo', () => {
    for (const estado of ['realizada', 'nao_compareceu', 'cancelada', 'remarcada']) {
      const p = montarProximosPassos(
        { reunioes: [reuniao({ id: 'r1', estado })], tarefas: [], pessoas: NOMES },
        AGORA,
      );
      expect(p.reunioes).toBe(0);
    }
  });

  it('reunião que passou e segue "marcada" aguarda resultado, e não sobe ao cabeçalho', () => {
    const p = montarProximosPassos(
      {
        reunioes: [
          reuniao({ id: 'passada', inicio: '2026-10-02T13:20:00Z', fim: '2026-10-02T14:00:00Z' }),
          reuniao({ id: 'futura' }),
        ],
        tarefas: [],
        pessoas: NOMES,
      },
      AGORA,
    );
    expect(p.passos[0]).toMatchObject({ selo: 'aguarda resultado', sala: null });
    expect(p.proximaReuniao?.id).toBe('reuniao:futura');
  });

  it('reunião presencial mostra o lugar, e não tem sala', () => {
    const p = montarProximosPassos(
      {
        reunioes: [
          reuniao({
            id: 'r1',
            formato: 'presencial',
            local: 'Av. Roberto Freire, 100',
            link: null,
          }),
        ],
        tarefas: [],
        pessoas: NOMES,
      },
      AGORA,
    );
    expect(p.passos[0]).toMatchObject({
      titulo: 'Reunião presencial',
      apoio: 'com Heloísa · Av. Roberto Freire, 100',
      sala: null,
    });
  });

  it('tarefa de hoje cuja hora já passou está atrasada, e não "vence hoje"', () => {
    // AGORA são 15:00 em Natal. A das 09:00 já venceu; a das 17:00 ainda vence.
    const p = montarProximosPassos(
      {
        reunioes: [],
        tarefas: [
          tarefa({ id: 'manha', title: 'Da manhã', due_at: '2026-10-02T12:00:00Z' }),
          tarefa({ id: 'tarde', title: 'Da tarde', due_at: '2026-10-02T20:00:00Z' }),
        ],
        pessoas: NOMES,
      },
      AGORA,
    );
    expect(p.passos.map((x) => [x.titulo, x.selo])).toEqual([
      ['Da manhã', 'atrasada'],
      ['Da tarde', 'vence hoje'],
    ]);
  });

  it('tarefa atrasada, sem prazo e já feita', () => {
    const p = montarProximosPassos(
      {
        reunioes: [],
        tarefas: [
          tarefa({ id: 'sem', due_at: null, title: 'Sem prazo' }),
          tarefa({
            id: 'velha',
            due_at: '2026-10-01T20:00:00Z',
            title: 'Atrasada',
            kind: 'message',
          }),
          tarefa({ id: 'feita', status: 'done' }),
          tarefa({ id: 'cancelada', status: 'cancelled' }),
        ],
        pessoas: NOMES,
      },
      AGORA,
    );
    expect(p.passos.map((x) => [x.titulo, x.selo, x.apoio])).toEqual([
      ['Atrasada', 'atrasada', 'Mensagem · Heloísa'],
      ['Sem prazo', null, 'Tarefa · Heloísa'],
    ]);
    expect(p.passos[1]?.quando).toBeNull();
  });

  it('lista os primeiros e conta os que ficaram de fora', () => {
    const tarefas = Array.from({ length: 8 }, (_, i) =>
      tarefa({ id: `t${i}`, due_at: `2026-10-1${i}T12:00:00Z` }),
    );
    const p = montarProximosPassos({ reunioes: [], tarefas, pessoas: NOMES }, AGORA);
    expect(p.passos).toHaveLength(5);
    expect(p.ocultos).toBe(3);
    expect(p.tarefas).toBe(8);
  });

  it('a contagem não escreve o que é zero', () => {
    expect(contagemDosPassos({ reunioes: 0, tarefas: 1 })).toBe('1 tarefa');
    expect(contagemDosPassos({ reunioes: 2, tarefas: 0 })).toBe('2 reuniões');
    expect(contagemDosPassos({ reunioes: 0, tarefas: 0 })).toBe('');
  });
});

// ---------------------------------------------------------------------------
// A leitura da IA
// ---------------------------------------------------------------------------

function leitura(parcial: Partial<LeituraCruaDaFicha> = {}): LeituraCruaDaFicha {
  return {
    resumo: 'Interessada em entrar na plataforma. Perguntou pelo valor da taxa.',
    intencao: 'PEDIU_TAXA_PRECO',
    score_intencao: 72,
    sentimento: 'positivo',
    sinais: [{ tipo: 'informou_data', polaridade: 'positivo', forca: 'forte' }],
    objecoes: ['preco'],
    alertas: [],
    proxima_acao: 'Confirmar a reunião e levar a tabela de taxas.',
    dados_insuficientes: false,
    analisada_em: '2026-10-02T15:15:00Z',
    ...parcial,
  };
}

describe('a leitura da IA na ficha', () => {
  it('sem linha no banco não há leitura: nada de nota inventada', () => {
    expect(montarLeituraDaFicha(null)).toBeNull();
  });

  it('a nota, a faixa, as etiquetas e a sugestão', () => {
    const l = montarLeituraDaFicha(leitura());
    expect(l).toMatchObject({
      nota: 72,
      faixa: 'engajado',
      sugestao: 'Confirmar a reunião e levar a tabela de taxas.',
      curtaDemais: false,
      desatualizada: false,
    });
    expect(l?.etiquetas).toEqual([
      { rotulo: 'Intenção', valor: 'perguntou a taxa' },
      { rotulo: 'Sentimento', valor: 'positivo' },
      { rotulo: 'Objeção', valor: 'preço' },
    ]);
  });

  it('a objeção vem no vocabulário do prompt e vai para a tela com acento', () => {
    const l = montarLeituraDaFicha(leitura({ objecoes: ['confianca', 'concorrente'] }));
    expect(l?.etiquetas.filter((e) => e.rotulo === 'Objeção').map((e) => e.valor)).toEqual([
      'confiança',
      'concorrente',
    ]);
    // Valor que a tela não conhece aparece como veio, em vez de sumir.
    const nova = montarLeituraDaFicha(leitura({ objecoes: ['logistica'] }));
    expect(nova?.etiquetas.find((e) => e.rotulo === 'Objeção')?.valor).toBe('logistica');
  });

  it('intenção que a tela não conhece cai na faixa da nota, nunca em caixa alta', () => {
    const l = montarLeituraDaFicha(leitura({ intencao: 'INTENCAO_NOVA' }));
    expect(l?.etiquetas[0]).toEqual({ rotulo: 'Intenção', valor: 'engajado' });
  });

  it('alerta que repete a intenção não entra duas vezes', () => {
    const l = montarLeituraDaFicha(
      leitura({ intencao: 'PRONTO_PARA_FECHAR', alertas: ['pronto_para_fechar', 'risco_perda'] }),
    );
    expect(l?.etiquetas.map((e) => `${e.rotulo} ${e.valor}`)).toEqual([
      'Intenção pronto para fechar',
      'Sentimento positivo',
      'Objeção preço',
      'Alerta risco de perder',
    ]);
  });

  it('alerta vira etiqueta, com o rótulo de gente', () => {
    const l = montarLeituraDaFicha(leitura({ alertas: ['risco_perda'], objecoes: [] }));
    expect(l?.etiquetas.at(-1)).toEqual({ rotulo: 'Alerta', valor: 'risco de perder' });
  });

  it('conversa curta demais: há linha, mas não há o que afirmar', () => {
    const l = montarLeituraDaFicha(leitura({ dados_insuficientes: true, sinais: [] }));
    expect(l?.curtaDemais).toBe(true);
  });

  it('se o parceiro escreveu bem depois da leitura, ela está desatualizada', () => {
    const analisada = '2026-10-02T15:15:00Z';
    const fresca = montarLeituraDaFicha(
      leitura({ analisada_em: analisada }),
      '2026-10-02T15:25:00Z',
    );
    const velha = montarLeituraDaFicha(
      leitura({ analisada_em: analisada }),
      '2026-10-02T17:00:00Z',
    );
    expect(fresca?.desatualizada).toBe(false);
    expect(velha?.desatualizada).toBe(true);
  });

  it('texto em branco não vira resumo nem sugestão', () => {
    const l = montarLeituraDaFicha(leitura({ resumo: '  ', proxima_acao: '' }));
    expect(l?.resumo).toBeNull();
    expect(l?.sugestao).toBeNull();
  });

  it('o arco do medidor acompanha a nota e não passa do círculo', () => {
    const { perimetro, preenchido } = arcoDaNota(50, 10);
    expect(preenchido).toBeCloseTo(perimetro / 2);
    expect(arcoDaNota(140, 10).preenchido).toBeCloseTo(perimetro);
    expect(arcoDaNota(-5, 10).preenchido).toBe(0);
  });
});
