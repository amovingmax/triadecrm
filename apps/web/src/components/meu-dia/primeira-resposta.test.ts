import { describe, expect, it } from 'vitest';

import {
  duracaoCurta,
  fraseDaEspera,
  fraseDaRegua,
  fraseDoAlvo,
  fraseSemRespondidas,
  fraseSemResponsavel,
  haQuanto,
  horaDoExpediente,
  lerPrimeiraResposta,
  linkDaLista,
  medianaEmTexto,
  noExpediente,
  rotuloDoDia,
  tomDoTempo,
  type EsperaAgora,
  type ReguaDaResposta,
} from './primeira-resposta';

/**
 * A primeira resposta no Meu dia novo da Imova. A conta é do banco
 * (`public.meu_dia_primeira_resposta`, pgTAP 151); aqui ficam a leitura do jsonb,
 * a cor e as frases. O que estes testes travam: a régua de cores nos degraus da
 * "espera em degraus" (15 e 60 min), a borda do alvo dentro, o zero que vira frase
 * e o relógio do banco, e não o do aparelho.
 */

const REGUA: ReguaDaResposta = { alvoMin: 15, gestaoMin: 60, inicio: '08:00', fim: '18:00' };
const AGORA = '2026-11-11T15:00:00-03:00';

describe('lerPrimeiraResposta', () => {
  it('lê o jsonb do banco, com a pessoa, os itens e a equipe', () => {
    const lido = lerPrimeiraResposta({
      regua: { alvo_min: 15, gestao_min: 60, expediente_inicio: '08:00', expediente_fim: '18:00' },
      dia: '2026-11-11',
      agora: AGORA,
      pessoa: {
        id: 'p1',
        esperando: 2,
        sem_responsavel: 1,
        itens: [
          {
            conversation_id: 'c1',
            nome: 'Maria Souza',
            caminho: '/conversas?org=o1',
            desde: '2026-11-11T12:50:00-03:00',
            minutos: 130,
            sem_responsavel: false,
          },
          { conversation_id: null, desde: AGORA },
        ],
        respondidas: 6,
        no_alvo: 3,
        mediana_min: 22.5,
      },
      equipe: {
        pessoas: [
          {
            id: 'p1',
            nome: 'Sol',
            papel: 'sdr',
            esperando: 1,
            mais_antiga: AGORA,
            mais_antiga_min: 0,
            respondidas: 5,
            no_alvo: 3,
            mediana_min: 15,
          },
        ],
        sem_responsavel: {
          esperando: 1,
          mais_antiga: null,
          respondidas: 0,
          no_alvo: 0,
          mediana_min: null,
        },
        total: {
          esperando: 2,
          mais_antiga: AGORA,
          respondidas: 5,
          no_alvo: 3,
          mediana_min: '15.0',
        },
      },
    });

    expect(lido.pessoa).toMatchObject({
      id: 'p1',
      esperando: 2,
      semResponsavel: 1,
      medianaMin: 22.5,
    });
    // Item sem conversa não vira linha de tela.
    expect(lido.pessoa.itens).toEqual([
      {
        conversaId: 'c1',
        nome: 'Maria Souza',
        caminho: '/conversas?org=o1',
        desde: '2026-11-11T12:50:00-03:00',
        minutos: 130,
        semResponsavel: false,
      },
    ]);
    expect(lido.equipe?.pessoas[0]).toMatchObject({
      id: 'p1',
      nome: 'Sol',
      medianaMin: 15,
      maisAntigaMin: 0,
    });
    expect(lido.equipe?.semResponsavel.medianaMin).toBeNull();
    // `numeric` grande chega como texto pelo PostgREST.
    expect(lido.equipe?.total.medianaMin).toBe(15);
  });

  it('sem a equipe (SDR) e com campos faltando, cai nos padrões', () => {
    const lido = lerPrimeiraResposta({ pessoa: {}, equipe: null });
    expect(lido.equipe).toBeNull();
    expect(lido.regua).toEqual(REGUA);
    expect(lido.pessoa).toMatchObject({
      esperando: 0,
      respondidas: 0,
      medianaMin: null,
      itens: [],
    });
  });

  it('não quebra com lixo', () => {
    expect(lerPrimeiraResposta(null).pessoa.itens).toEqual([]);
    expect(lerPrimeiraResposta('x').equipe).toBeNull();
  });
});

describe('tomDoTempo', () => {
  it('até o alvo, dentro; a borda conta como dentro', () => {
    expect(tomDoTempo(1, REGUA)).toBe('dentro');
    expect(tomDoTempo(15, REGUA)).toBe('dentro');
  });

  it('passou do alvo e não chegou à gestão, perto; passou da gestão, fora', () => {
    expect(tomDoTempo(15.5, REGUA)).toBe('perto');
    expect(tomDoTempo(60, REGUA)).toBe('perto');
    expect(tomDoTempo(73, REGUA)).toBe('fora');
  });

  it('sem número, neutro', () => {
    expect(tomDoTempo(null, REGUA)).toBe('neutro');
    expect(tomDoTempo(Number.NaN, REGUA)).toBe('neutro');
  });

  it('segue a régua do banco', () => {
    expect(tomDoTempo(20, { ...REGUA, alvoMin: 30 })).toBe('dentro');
  });
});

describe('duracaoCurta', () => {
  it('fala como o time', () => {
    expect(duracaoCurta(0.4)).toBe('menos de 1 min');
    expect(duracaoCurta(12)).toBe('12 min');
    expect(duracaoCurta(22.5)).toBe('23 min');
    expect(duracaoCurta(60)).toBe('1 h');
    expect(duracaoCurta(130)).toBe('2 h 10');
    expect(duracaoCurta(125)).toBe('2 h 05');
    expect(duracaoCurta(28 * 60)).toBe('1 d 4 h');
    expect(duracaoCurta(48 * 60)).toBe('2 d');
    expect(duracaoCurta(12 * 24 * 60 + 300)).toBe('12 d');
  });
});

describe('a espera', () => {
  it('"3 esperando · a mais antiga há 2 h 10", pelo relógio do banco', () => {
    expect(fraseDaEspera(3, '2026-11-11T12:50:00-03:00', AGORA)).toBe(
      '3 esperando · a mais antiga há 2 h 10',
    );
    expect(fraseDaEspera(1, '2026-11-11T14:20:00-03:00', AGORA)).toBe('1 esperando há 40 min');
    expect(fraseDaEspera(0, null, AGORA)).toBeNull();
  });

  it('avisa quando a espera é de todos, no singular e no plural', () => {
    expect(fraseSemResponsavel(0, 3)).toBeNull();
    expect(fraseSemResponsavel(1, 1)).toBe('Está sem responsável: aparece para todos que atendem.');
    expect(fraseSemResponsavel(2, 2)).toMatch(/^Todas estão sem responsável/);
    expect(fraseSemResponsavel(1, 4)).toBe(
      '1 delas está sem responsável e aparece para todos que atendem.',
    );
    expect(fraseSemResponsavel(2, 4)).toMatch(/^2 delas estão sem responsável e aparecem/);
  });

  it('o relógio nunca anda para trás', () => {
    expect(haQuanto('2026-11-11T15:05:00-03:00', AGORA)).toBe('há menos de 1 min');
  });

  it('diz o tempo no expediente só quando ele difere do relógio', () => {
    const daNoite: EsperaAgora = {
      conversaId: 'c',
      nome: 'Maria',
      caminho: '/conversas',
      desde: '2026-11-10T22:00:00-03:00',
      minutos: 420,
      semResponsavel: false,
    };
    expect(noExpediente(daNoite, AGORA)).toBe('7 h no expediente');
    expect(
      noExpediente({ ...daNoite, desde: '2026-11-11T14:30:00-03:00', minutos: 30 }, AGORA),
    ).toBeNull();
    expect(
      noExpediente(
        { ...daNoite, desde: '2026-11-11T07:00:00-03:00', minutos: 0 },
        '2026-11-11T07:40:00-03:00',
      ),
    ).toBe('fora do expediente');
  });
});

describe('hoje', () => {
  it('"X de Y em até 15 min" e a mediana', () => {
    expect(fraseDoAlvo({ respondidas: 6, noAlvo: 3, medianaMin: 22.5 }, REGUA)).toBe(
      '3 de 6 em até 15 min',
    );
    expect(medianaEmTexto(22.5)).toBe('23 min');
    expect(medianaEmTexto(null)).toBeNull();
  });

  it('sem nada respondido, uma frase, não um zero', () => {
    expect(fraseDoAlvo({ respondidas: 0, noAlvo: 0, medianaMin: null }, REGUA)).toBeNull();
    expect(fraseSemRespondidas(0, true)).toBe('Nenhuma espera respondida hoje ainda.');
    expect(fraseSemRespondidas(2, true)).toMatch(/^Nenhuma resposta hoje ainda\./);
    expect(fraseSemRespondidas(2, false)).toBe('Nenhuma espera respondida neste dia.');
  });

  it('a régua em uma frase', () => {
    expect(horaDoExpediente('08:00')).toBe('8h');
    expect(horaDoExpediente('17:30')).toBe('17h30');
    expect(fraseDaRegua(REGUA)).toBe(
      'Alvo: responder em até 15 min de expediente (8h às 18h, dias úteis).',
    );
  });
});

describe('rotuloDoDia', () => {
  it('"Hoje", ou o dia da leitura', () => {
    expect(rotuloDoDia('2026-11-11', '2026-11-11')).toBe('Hoje');
    expect(rotuloDoDia('2026-11-10', '2026-11-11')).toBe('Em 10/11');
    expect(rotuloDoDia('', '2026-11-11')).toBe('Hoje');
  });
});

describe('linkDaLista', () => {
  it('no próprio dia, Conversas; no de outra pessoa, as que ela atende', () => {
    expect(linkDaLista('p1', true)).toBe('/conversas');
    expect(linkDaLista('p1', false)).toBe('/conversas?ver=todas&atendente=p1');
  });
});
