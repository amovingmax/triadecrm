import { describe, expect, it } from 'vitest';

import {
  agruparPorDia,
  aplicarFiltros,
  cabeNaJanela,
  diasDesde,
  ehInteracao,
  escolherNegocio,
  momentoDaLista,
  montarConversas,
  montarLinhaDoTempo,
  normalizar,
  type AtividadeCrua,
  type CatalogosConversas,
  type HistoricoCru,
  type NegocioCru,
  type OrganizacaoCrua,
} from './montagem';
import type { FioCru, MensagemCrua, RascunhoCru } from './mensagens';
import { FILTROS_VAZIOS } from './tipos';

/**
 * O que estes testes protegem: a ORDEM da lista e a HONESTIDADE das linhas.
 *
 * Os dois erros que quebrariam a tela em campo são deixar o import da lista-semente
 * contar como conversa (a base inteira apareceria como "falei hoje") e deixar um
 * campo ausente virar um valor plausível ("sem contato" nunca é "hoje").
 */

const HELOISA = 'd0000000-0000-4000-8000-000000000d01';
const MATHEUS = 'd0000000-0000-4000-8000-000000000d03';

const CATALOGOS: CatalogosConversas = {
  pessoas: [
    { id: HELOISA, nome: 'Heloísa Cavalcanti' },
    { id: MATHEUS, nome: 'Matheus Rondon' },
  ],
  etapas: [
    { id: 1, nome: 'Identificado', funil: 'Captação' },
    { id: 2, nome: 'Demonstração marcada', funil: 'Captação' },
  ],
  desfechos: [
    { id: 10, nome: 'Não atendeu' },
    { id: 11, nome: 'Reunião marcada' },
  ],
};

function organizacao(id: string, nome: string): OrganizacaoCrua {
  return {
    id,
    name: nome,
    primary_category_name: 'Buffet',
    neighborhood: 'Ponta Negra',
    city_name: 'Natal',
    temperature: 'frio',
    phone_e164: '+5584999990000',
    phone_is_masked: true,
    do_not_contact: false,
  };
}

function atividade(parcial: Partial<AtividadeCrua> & { id: string; organization_id: string }): AtividadeCrua {
  return {
    deal_id: null,
    type: 'call',
    channel: 'phone',
    author_kind: 'human',
    occurred_at: '2026-09-04T17:00:00Z',
    body: null,
    duration_min: null,
    user_id: HELOISA,
    outcome_id: null,
    metadata: {},
    ...parcial,
  };
}

function negocio(parcial: Partial<NegocioCru> & { id: string; organization_id: string }): NegocioCru {
  return {
    stage_id: 1,
    status: 'open',
    owner_id: null,
    needs_attention: false,
    next_action: null,
    next_action_at: null,
    updated_at: '2026-09-04T17:00:00Z',
    ...parcial,
  };
}

describe('ehInteracao', () => {
  it('não conta o import da lista-semente como conversa', () => {
    expect(ehInteracao(atividade({ id: 'a', organization_id: 'o', type: 'system' }))).toBe(false);
    expect(ehInteracao(atividade({ id: 'b', organization_id: 'o', type: 'call' }))).toBe(true);
  });
});

describe('diasDesde', () => {
  const agora = new Date('2026-09-10T12:00:00Z');

  it('devolve null para quem nunca foi contatado, e não zero', () => {
    expect(diasDesde(null, agora)).toBeNull();
  });

  it('conta dias inteiros, como o banco', () => {
    expect(diasDesde('2026-09-10T11:00:00Z', agora)).toBe(0);
    expect(diasDesde('2026-09-04T12:00:00Z', agora)).toBe(6);
  });

  it('nunca devolve negativo quando a data está no futuro', () => {
    expect(diasDesde('2026-09-20T12:00:00Z', agora)).toBe(0);
  });
});

describe('montarConversas', () => {
  const agora = new Date('2026-09-10T12:00:00Z');

  const organizacoes = [
    organizacao('o1', 'Neuma Leão Buffet'),
    organizacao('o2', 'Accord Cerimonial'),
    organizacao('o3', 'Zeta Eventos'),
  ];

  const atividades: AtividadeCrua[] = [
    // o3 só tem o import: continua "sem contato".
    atividade({
      id: 'sys',
      organization_id: 'o3',
      type: 'system',
      channel: null,
      author_kind: 'system',
      user_id: null,
      occurred_at: '2026-09-09T10:00:00Z',
      body: 'Importado da lista-semente da pesquisa R09',
    }),
    atividade({ id: 'a1', organization_id: 'o1', occurred_at: '2026-09-08T14:00:00Z', outcome_id: 10 }),
    atividade({
      id: 'a2',
      organization_id: 'o1',
      occurred_at: '2026-09-09T14:00:00Z',
      outcome_id: 11,
      channel: 'whatsapp',
      type: 'message',
    }),
    atividade({
      id: 'a3',
      organization_id: 'o2',
      occurred_at: '2026-09-07T14:00:00Z',
      user_id: MATHEUS,
      channel: 'presencial',
      type: 'visit',
    }),
  ];

  const negocios = [
    negocio({ id: 'd1', organization_id: 'o1', stage_id: 2, owner_id: HELOISA }),
    negocio({ id: 'd2', organization_id: 'o2' }),
  ];

  const itens = montarConversas({ organizacoes, atividades, negocios, catalogos: CATALOGOS, agora });

  it('ordena por interação mais recente e joga quem nunca falou para o fim', () => {
    expect(itens.map((i) => i.id)).toEqual(['o1', 'o2', 'o3']);
    expect(itens[2]?.ultimaEm).toBeNull();
    expect(itens[2]?.diasSemContato).toBeNull();
    expect(itens[2]?.interacoes).toBe(0);
  });

  it('resume a última interação pelo nome do desfecho do catálogo', () => {
    expect(itens[0]?.resumo).toBe('Reunião marcada');
    expect(itens[0]?.ultimoCanal).toBe('whatsapp');
    expect(itens[0]?.interacoes).toBe(2);
  });

  it('junta os canais e quem falou, para os filtros', () => {
    expect([...(itens[0]?.canais ?? [])].sort()).toEqual(['phone', 'whatsapp']);
    expect(itens[1]?.quemFalou).toEqual([MATHEUS]);
  });

  it('traz a etapa e o dono do negócio em foco', () => {
    expect(itens[0]?.etapa).toBe('Demonstração marcada');
    expect(itens[0]?.funil).toBe('Captação');
    expect(itens[0]?.responsavel).toBe('Heloísa Cavalcanti');
    expect(itens[1]?.responsavel).toBeNull();
  });
});

describe('escolherNegocio', () => {
  it('prefere o negócio aberto ao fechado, mesmo que o fechado seja mais recente', () => {
    const aberto = negocio({ id: 'd1', organization_id: 'o1', updated_at: '2026-09-01T00:00:00Z' });
    const ganho = negocio({
      id: 'd2',
      organization_id: 'o1',
      status: 'won',
      updated_at: '2026-09-09T00:00:00Z',
    });
    expect(escolherNegocio([ganho, aberto])?.id).toBe('d1');
  });

  it('devolve null quando não há negócio', () => {
    expect(escolherNegocio([])).toBeNull();
  });
});

describe('cabeNaJanela', () => {
  it('separa "nunca falei" de "falei hoje"', () => {
    expect(cabeNaJanela(null, 'nunca')).toBe(true);
    expect(cabeNaJanela(0, 'nunca')).toBe(false);
    expect(cabeNaJanela(null, 'hoje')).toBe(false);
    expect(cabeNaJanela(0, 'hoje')).toBe(true);
  });

  it('nunca deixa quem não tem contato cair nas faixas de dias', () => {
    expect(cabeNaJanela(null, 'mais14')).toBe(false);
    expect(cabeNaJanela(null, 'ate3')).toBe(false);
    expect(cabeNaJanela(20, 'mais14')).toBe(true);
    expect(cabeNaJanela(8, 'mais7')).toBe(true);
    expect(cabeNaJanela(7, 'mais7')).toBe(false);
  });
});

describe('aplicarFiltros', () => {
  const agora = new Date('2026-09-10T12:00:00Z');
  const itens = montarConversas({
    organizacoes: [organizacao('o1', 'Neuma Leão Buffet'), organizacao('o2', 'Accord Cerimonial')],
    atividades: [
      atividade({ id: 'a1', organization_id: 'o1', occurred_at: '2026-09-10T09:00:00Z' }),
      atividade({
        id: 'a2',
        organization_id: 'o2',
        occurred_at: '2026-08-01T09:00:00Z',
        user_id: MATHEUS,
        channel: 'whatsapp',
        type: 'message',
      }),
    ],
    negocios: [],
    catalogos: CATALOGOS,
    agora,
  });

  it('busca sem acento e sem caixa', () => {
    expect(aplicarFiltros(itens, { ...FILTROS_VAZIOS, q: 'neuma leao' }).map((i) => i.id)).toEqual([
      'o1',
    ]);
  });

  it('busca também por bairro e categoria', () => {
    expect(aplicarFiltros(itens, { ...FILTROS_VAZIOS, q: 'ponta negra' })).toHaveLength(2);
    expect(aplicarFiltros(itens, { ...FILTROS_VAZIOS, q: 'buffet' })).toHaveLength(2);
  });

  it('filtra por quem registrou a interação, e não só pelo dono do negócio', () => {
    expect(
      aplicarFiltros(itens, { ...FILTROS_VAZIOS, responsavelId: MATHEUS }).map((i) => i.id),
    ).toEqual(['o2']);
  });

  it('filtra por canal usado em qualquer interação', () => {
    expect(aplicarFiltros(itens, { ...FILTROS_VAZIOS, canal: 'whatsapp' }).map((i) => i.id)).toEqual(
      ['o2'],
    );
  });

  it('filtra por faixa de dias sem contato', () => {
    expect(aplicarFiltros(itens, { ...FILTROS_VAZIOS, janela: 'mais14' }).map((i) => i.id)).toEqual([
      'o2',
    ]);
  });
});

describe('normalizar', () => {
  it('tira acento e caixa, como unaccent + lower', () => {
    expect(normalizar('  Cerimonial ODINEIDE Melo ')).toBe('cerimonial odineide melo');
    expect(normalizar('Neuma Leão')).toBe('neuma leao');
  });
});

describe('montarLinhaDoTempo', () => {
  const atividades: AtividadeCrua[] = [
    atividade({
      id: 'sys',
      organization_id: 'o1',
      type: 'system',
      channel: null,
      author_kind: 'system',
      user_id: null,
      occurred_at: '2026-09-01T10:00:00Z',
      body: 'Importado da lista-semente da pesquisa R09',
    }),
    atividade({
      id: 'a1',
      organization_id: 'o1',
      occurred_at: '2026-09-04T17:46:09Z',
      outcome_id: 11,
      duration_min: 12,
      metadata: { com_quem: 'decisor', door_opened: true },
    }),
  ];

  const historico: HistoricoCru[] = [
    {
      id: 1,
      deal_id: 'd1',
      changed_at: '2026-09-04T17:46:09Z',
      from_stage_id: 1,
      to_stage_id: 2,
      changed_by: HELOISA,
      reason: 'Reunião marcada (ligacao)',
    },
  ];

  const eventos = montarLinhaDoTempo({ atividades, historico, catalogos: CATALOGOS });

  it('põe tudo numa coluna só, do mais antigo ao mais recente', () => {
    expect(eventos.map((e) => e.id)).toEqual(['atividade:sys', 'atividade:a1', 'etapa:1']);
  });

  it('mantém a atividade antes da mudança de etapa que ela causou, no mesmo segundo', () => {
    expect(eventos[1]?.genero).toBe('interacao');
    expect(eventos[2]?.genero).toBe('etapa');
  });

  it('marca o import como origem, não como interação', () => {
    expect(eventos[0]?.genero).toBe('origem');
    expect(eventos[0]?.titulo).toBe('Entrou na base');
    expect(eventos[0]?.autorTipo).toBe('system');
  });

  it('traduz desfecho, com quem e porta aberta', () => {
    expect(eventos[1]?.desfecho).toBe('Reunião marcada');
    expect(eventos[1]?.comQuem).toBe('O dono / decisor');
    expect(eventos[1]?.portaAberta).toBe(true);
    expect(eventos[1]?.duracaoMin).toBe(12);
  });

  it('não afirma com quem quando o registro disse "não sei dizer"', () => {
    const [evento] = montarLinhaDoTempo({
      atividades: [
        atividade({ id: 'x', organization_id: 'o1', metadata: { com_quem: 'nao_informado' } }),
      ],
      historico: [],
      catalogos: CATALOGOS,
    });
    expect(evento?.comQuem).toBeNull();
  });

  it('nomeia a mudança de etapa com as duas pontas', () => {
    expect(eventos[2]?.titulo).toBe('De Identificado para Demonstração marcada');
    expect(eventos[2]?.autor).toBe('Heloísa Cavalcanti');
  });
});

describe('agruparPorDia', () => {
  it('quebra a coluna em dias no fuso de Natal', () => {
    const eventos = montarLinhaDoTempo({
      atividades: [
        // 2026-09-05T01:00Z é 04/09 às 22h em Natal: tem de cair no dia 4.
        atividade({ id: 'a', organization_id: 'o1', occurred_at: '2026-09-05T01:00:00Z' }),
        atividade({ id: 'b', organization_id: 'o1', occurred_at: '2026-09-05T14:00:00Z' }),
      ],
      historico: [],
      catalogos: CATALOGOS,
    });

    const dias = agruparPorDia(eventos);
    expect(dias.map((d) => d.chave)).toEqual(['2026-09-04', '2026-09-05']);
    expect(dias[0]?.eventos).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// O inbox: as mensagens na mesma coluna, e o que elas mudam na lista
// ---------------------------------------------------------------------------

function fio(parcial: Partial<FioCru> & { id: string; organization_id: string }): FioCru {
  return {
    contact_id: null,
    channel: 'whatsapp',
    peer_phone_e164: '+5584999880011',
    business_number: '+5584999990000',
    assignee_id: HELOISA,
    status: 'aguardando_nos',
    bot_paused: false,
    last_message_at: null,
    last_inbound_at: null,
    last_outbound_at: null,
    window_expires_at: null,
    unread_count: 0,
    ai_summary: null,
    ai_intent: null,
    ai_confidence: null,
    ...parcial,
  };
}

function rascunho(parcial: Partial<RascunhoCru> & { id: string; organization_id: string }): RascunhoCru {
  return {
    conversation_id: null,
    kind: 'resposta',
    status: 'pendente',
    proposed_body: 'A gente pode conversar quinta às 9h30?',
    proposed_claims: [],
    validator: { situacao: 'aprovado', texto: 'x' },
    prompt_version: 'followup-ligacao@v1',
    final_body: null,
    foi_editado: null,
    reviewed_by: null,
    reviewed_at: null,
    discard_reason: null,
    created_at: '2026-09-10T09:00:00Z',
    expires_at: '2026-09-13T09:00:00Z',
    ...parcial,
  };
}

function mensagemCrua(
  parcial: Partial<MensagemCrua> & { id: string; conversation_id: string },
): MensagemCrua {
  return {
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
    created_at: '2026-09-10T10:00:00Z',
    sent_at: null,
    delivered_at: null,
    read_at: null,
    failed_at: null,
    ...parcial,
  };
}

describe('montarLinhaDoTempo com mensagens', () => {
  /**
   * A promessa que o módulo carregava desde o D5, escrita no cabeçalho de
   * `tipos.ts`: "quando o WhatsApp entrar, cada mensagem vira mais um evento
   * DESTA MESMA coluna". Este teste é o que impede alguém de cumpri-la com uma
   * aba separada — que é a saída fácil e apaga a relação de causa entre a
   * ligação e o WhatsApp que veio depois dela.
   */
  it('a mensagem entra na mesma coluna, na posição cronológica dela', () => {
    const eventos = montarLinhaDoTempo({
      atividades: [
        atividade({ id: 'lig', organization_id: 'o1', occurred_at: '2026-09-10T14:00:00Z' }),
      ],
      historico: [],
      mensagens: [
        mensagemCrua({ id: 'm1', conversation_id: 'f1', created_at: '2026-09-10T14:20:00Z' }),
        mensagemCrua({ id: 'm0', conversation_id: 'f1', created_at: '2026-09-10T09:00:00Z' }),
      ],
      catalogos: CATALOGOS,
    });

    expect(eventos.map((e) => e.id)).toEqual(['mensagem:m0', 'atividade:lig', 'mensagem:m1']);
    expect(eventos[2]?.genero).toBe('mensagem');
    expect(eventos[2]?.mensagem?.texto).toBe('oi');
    expect(eventos[0]?.mensagem?.entrada).toBe(true);
  });

  it('no mesmo segundo: a interação, depois a mensagem, depois a etapa que elas causaram', () => {
    const instante = '2026-09-10T14:00:00Z';
    const eventos = montarLinhaDoTempo({
      atividades: [atividade({ id: 'lig', organization_id: 'o1', occurred_at: instante })],
      historico: [
        {
          id: 1,
          deal_id: 'd1',
          changed_at: instante,
          from_stage_id: 1,
          to_stage_id: 2,
          changed_by: HELOISA,
          reason: null,
        },
      ],
      mensagens: [mensagemCrua({ id: 'm', conversation_id: 'f1', created_at: instante })],
      catalogos: CATALOGOS,
    });

    expect(eventos.map((e) => e.genero)).toEqual(['interacao', 'mensagem', 'etapa']);
  });

  it('sem mensagens, a coluna é exatamente a de antes', () => {
    const semParametro = montarLinhaDoTempo({
      atividades: [atividade({ id: 'a', organization_id: 'o1' })],
      historico: [],
      catalogos: CATALOGOS,
    });
    expect(semParametro).toHaveLength(1);
    expect(semParametro[0]?.mensagem).toBeNull();
  });
});

describe('montarConversas com o inbox', () => {
  const agora = new Date('2026-09-10T12:00:00Z');
  const organizacoes = [organizacao('o1', 'Neuma Leão Buffet'), organizacao('o2', 'Accord Cerimonial')];

  it('pendura o fio, o contador de não lidas e o rascunho na ficha certa', () => {
    const [item] = montarConversas({
      organizacoes: [organizacao('o1', 'Neuma Leão Buffet')],
      atividades: [],
      negocios: [],
      catalogos: CATALOGOS,
      fios: [fio({ id: 'f1', organization_id: 'o1', unread_count: 3 })],
      rascunhos: [rascunho({ id: 'r1', organization_id: 'o1', conversation_id: 'f1' })],
      agora,
    });

    expect(item?.fio?.id).toBe('f1');
    expect(item?.naoLidas).toBe(3);
    expect(item?.rascunhoPendente?.id).toBe('r1');
  });

  it('mensagem por ler sobe na frente de quem foi contatado hoje', () => {
    const itens = montarConversas({
      organizacoes,
      // o2 teve ligação HOJE; o1 não tem atividade nenhuma, só mensagem por ler.
      atividades: [atividade({ id: 'a', organization_id: 'o2', occurred_at: '2026-09-10T11:00:00Z' })],
      negocios: [],
      catalogos: CATALOGOS,
      fios: [
        fio({
          id: 'f1',
          organization_id: 'o1',
          unread_count: 1,
          last_message_at: '2026-09-09T18:00:00Z',
        }),
      ],
      agora,
    });

    expect(itens.map((i) => i.id)).toEqual(['o1', 'o2']);
  });

  it('a última mensagem do fio conta para a ordem, mesmo sem atividade registrada', () => {
    const itens = montarConversas({
      organizacoes,
      atividades: [atividade({ id: 'a', organization_id: 'o2', occurred_at: '2026-09-10T08:00:00Z' })],
      negocios: [],
      catalogos: CATALOGOS,
      // Sem "por ler" (já lida): quem decide é só o instante.
      fios: [fio({ id: 'f1', organization_id: 'o1', last_message_at: '2026-09-10T11:00:00Z' })],
      agora,
    });

    expect(itens.map((i) => i.id)).toEqual(['o1', 'o2']);
    expect(momentoDaLista(itens[0]!)).toBe('2026-09-10T11:00:00Z');
  });

  it('sem fio nenhum, a ordem continua sendo a que já era', () => {
    const itens = montarConversas({
      organizacoes,
      atividades: [atividade({ id: 'a', organization_id: 'o2', occurred_at: '2026-09-10T08:00:00Z' })],
      negocios: [],
      catalogos: CATALOGOS,
      agora,
    });
    expect(itens.map((i) => i.id)).toEqual(['o2', 'o1']);
    expect(itens[0]?.fio).toBeNull();
    expect(itens[0]?.naoLidas).toBe(0);
  });

  it('com dois rascunhos na mesma ficha, vale o que expira primeiro', () => {
    const [item] = montarConversas({
      organizacoes: [organizacao('o1', 'Neuma Leão Buffet')],
      atividades: [],
      negocios: [],
      catalogos: CATALOGOS,
      rascunhos: [
        rascunho({ id: 'depois', organization_id: 'o1', expires_at: '2026-09-14T09:00:00Z' }),
        rascunho({ id: 'antes', organization_id: 'o1', expires_at: '2026-09-11T09:00:00Z' }),
      ],
      agora,
    });
    expect(item?.rascunhoPendente?.id).toBe('antes');
  });
});
