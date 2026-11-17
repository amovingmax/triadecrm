import { describe, expect, it } from 'vitest';

import { lerPainel, type IaDoPainel, type VisitaDeHoje } from './dados';
import {
  codigoCurto,
  faltaPara,
  fraseDaIa,
  haQuanto,
  iniciais,
  nomeDoImovel,
  progressoDaMeta,
  proximaVisita,
  rotuloDaOrigem,
  seloDaVisita,
  textoDoEvento,
  variacao,
} from './formatos';

// O Painel do dia (17/11/2026): os textos e a leitura defensiva da resposta.

const AGORA = Date.parse('2026-11-17T15:00:00-03:00');

describe('variacao', () => {
  it('compara com o período anterior', () => {
    expect(variacao(7, 4, 'hoje')).toEqual({
      texto: '3 a mais que ontem',
      curta: '3',
      tom: 'sobe',
    });
    expect(variacao(2, 5, 'semana').texto).toBe('3 a menos que nos 7 dias anteriores');
    expect(variacao(3, 3, 'hoje')).toEqual({
      texto: 'igual a ontem',
      curta: 'igual',
      tom: 'igual',
    });
  });
});

describe('tempo', () => {
  it('há quanto tempo', () => {
    expect(haQuanto('2026-11-17T14:35:00-03:00', AGORA)).toBe('há 25 min');
    expect(haQuanto('2026-11-17T12:00:00-03:00', AGORA)).toBe('há 3 h');
    expect(haQuanto('2026-11-16T19:40:00-03:00', AGORA)).toBe('ontem, 19:40');
    expect(haQuanto('2026-11-12T10:00:00-03:00', AGORA)).toBe('12/11');
  });

  it('quanto falta para a visita', () => {
    expect(faltaPara('2026-11-17T16:20:00-03:00', AGORA)).toBe('em 1 h 20');
    expect(faltaPara('2026-11-17T15:30:00-03:00', AGORA)).toBe('em 30 min');
    expect(faltaPara('2026-11-17T15:03:00-03:00', AGORA)).toBe('agora');
    expect(faltaPara('2026-11-17T09:00:00-03:00', AGORA)).toBe('já passou');
  });
});

describe('imóvel e origem', () => {
  it('tira o sufixo da empresa do código', () => {
    expect(codigoCurto('TE0004_IMOVA')).toBe('TE0004');
    expect(codigoCurto('SA0012')).toBe('SA0012');
  });

  it('o nome do imóvel sem o preço depois da barra', () => {
    expect(nomeDoImovel('Repasse Loja de Plantas + Casa Anexa | R$ 120 mil', 'casa')).toBe(
      'Repasse Loja de Plantas + Casa Anexa',
    );
    expect(nomeDoImovel(null, 'sala_comercial')).toBe('Sala comercial');
    expect(nomeDoImovel(null, null)).toBe('Imóvel');
  });

  it('de onde o lead veio', () => {
    expect(rotuloDaOrigem('redes_sociais', 'instagram')).toBe('Instagram');
    expect(rotuloDaOrigem('placa', 'desconhecido')).toBe('Placa');
    expect(rotuloDaOrigem(null, null)).toBe('Identificando…');
  });

  it('as iniciais do avatar', () => {
    expect(iniciais('Juliana Rocha')).toBe('JR');
    expect(iniciais('Demo IA · Fábio Lins')).toBe('DL');
    expect(iniciais('')).toBe('?');
  });
});

describe('meta e IA', () => {
  it('a meta do mês em porcentagem', () => {
    expect(progressoDaMeta(3, 5)).toBe(60);
    expect(progressoDaMeta(7, 5)).toBe(100);
    expect(progressoDaMeta(3, null)).toBeNull();
  });

  const ia: IaDoPainel = { conversas: 12, visitas: 2, passadas: 1, atendendo: 3, eventos: [] };

  it('a frase da IA', () => {
    expect(fraseDaIa(ia, 'hoje')).toBe(
      'Atendeu 12 pessoas, marcou 2 visitas e passou 1 cliente para a equipe.',
    );
    expect(fraseDaIa({ ...ia, visitas: 0, passadas: 0, conversas: 1 }, 'hoje')).toBe(
      'Atendeu 1 pessoa.',
    );
    expect(fraseDaIa({ ...ia, conversas: 0, visitas: 0, passadas: 0 }, 'semana')).toBe(
      'Nenhuma conversa nos últimos 7 dias ainda.',
    );
  });

  it('cada ação da IA vira uma linha', () => {
    expect(
      textoDoEvento(
        {
          quando: '2026-11-17T14:20:00-03:00',
          acao: 'passou_para_pessoa',
          nome: 'Lucas',
          caminho: null,
          motivo: 'Quer negociar o valor, e a IA não negocia.',
          visitaEm: null,
          codigo: null,
        },
        AGORA,
      ),
    ).toBe('Passou Lucas para a equipe: quer negociar o valor, e a IA não negocia.');
    expect(
      textoDoEvento(
        {
          quando: '2026-11-17T13:00:00-03:00',
          acao: 'marcou_visita',
          nome: 'Rafael',
          caminho: null,
          motivo: null,
          visitaEm: '2026-11-17T19:00:00-03:00',
          codigo: 'TE0004_IMOVA',
        },
        AGORA,
      ),
    ).toBe('Marcou visita com Rafael hoje às 19:00 no TE0004.');
  });
});

function visita(parcial: Partial<VisitaDeHoje>): VisitaDeHoje {
  return {
    taskId: 't1',
    quando: '2026-11-17T16:00:00-03:00',
    tipo: 'visit',
    titulo: 'Visita',
    feito: false,
    cliente: 'Carla',
    organizationId: null,
    caminho: null,
    local: null,
    imovel: null,
    confirmacao: null,
    marcadaPor: null,
    ...parcial,
  };
}

describe('agenda', () => {
  it('o selo: feita, confirmação e quem marcou', () => {
    expect(seloDaVisita(visita({ feito: true }))?.rotulo).toBe('Feita');
    expect(seloDaVisita(visita({ confirmacao: 'confirmou', marcadaPor: 'ia' }))?.rotulo).toBe(
      'Cliente confirmou',
    );
    expect(seloDaVisita(visita({ marcadaPor: 'ia' }))?.rotulo).toBe('Marcada pela IA');
    expect(seloDaVisita(visita({}))).toBeNull();
  });

  it('a próxima visita é a primeira por fazer', () => {
    const agenda = [
      visita({ taskId: 'a', quando: '2026-11-17T09:00:00-03:00', feito: true }),
      visita({ taskId: 'b', quando: '2026-11-17T19:00:00-03:00' }),
      visita({ taskId: 'c', quando: '2026-11-17T20:30:00-03:00' }),
    ];
    expect(proximaVisita(agenda, AGORA)).toBe('b');
  });
});

describe('lerPainel', () => {
  it('lê a resposta inteira e tolera campo faltando', () => {
    const painel = lerPainel({
      periodo: { nome: 'semana', de: '2026-11-11', ate: '2026-11-17' },
      ve_tudo: true,
      numeros: {
        dias: ['2026-11-16', '2026-11-17'],
        leads: { agora: 7, antes: '4', serie: [3, 4] },
        visitas: { agora: 2, antes: 1, serie: [1, 1], pela_ia: 1 },
        fechados: {
          agora: 1,
          antes: 0,
          no_mes: 3,
          meta_mes: 5,
          ultimo: { nome: 'Família', por: 'Janio', quando: 'x' },
        },
      },
      ia: {
        conversas: 3,
        visitas: 1,
        passadas: 1,
        atendendo: 2,
        eventos: [{ acao: 'desconhecida', quando: 'x' }],
      },
      leads: [
        { conversation_id: 'c1', chegou: '2026-11-17T10:00:00-03:00', nome: 'Ana', situacao: 'ia' },
        { nome: 'sem id' },
      ],
      imoveis: [{ codigo: 'TE0004_IMOVA', interessados: 9 }],
      agenda: [
        {
          task_id: 't1',
          quando: '2026-11-17T19:00:00-03:00',
          confirmacao: 'talvez',
          marcada_por: 'ia',
        },
      ],
      precisa: {
        total: 8,
        itens: [{ tipo: 'ia', titulo: 'Lucas', acao: 'responder' }, { tipo: 'outro' }],
      },
    });
    expect(painel.periodo.nome).toBe('semana');
    expect(painel.numeros?.leads).toEqual({ agora: 7, antes: 4, serie: [3, 4] });
    expect(painel.numeros?.visitas.pelaIa).toBe(1);
    expect(painel.numeros?.fechados.metaMes).toBe(5);
    expect(painel.ia?.eventos).toEqual([]);
    expect(painel.leads).toHaveLength(1);
    expect(painel.agenda[0]?.confirmacao).toBeNull();
    expect(painel.agenda[0]?.marcadaPor).toBe('ia');
    expect(painel.precisa).toEqual({
      total: 8,
      itens: [
        {
          tipo: 'ia',
          titulo: 'Lucas',
          detalhe: null,
          quando: null,
          caminho: null,
          acao: 'responder',
        },
      ],
    });
  });

  it('sem permissão para a empresa, os blocos da empresa voltam nulos', () => {
    const painel = lerPainel({
      ve_tudo: false,
      numeros: null,
      ia: null,
      leads: null,
      imoveis: null,
      agenda: [],
      precisa: {},
    });
    expect(painel.numeros).toBeNull();
    expect(painel.leads).toBeNull();
    expect(painel.precisa).toEqual({ total: 0, itens: [] });
  });
});
