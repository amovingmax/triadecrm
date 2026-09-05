import { describe, expect, it } from 'vitest';
import type { z } from 'zod';

import {
  LIG_ATENDEU_RETORNA,
  LIG_NAO_ATENDEU,
  LIG_REUNIAO_MARCADA,
  LIG_SEM_INTERESSE,
  REU_AUTORIZOU,
} from '@/components/registro/catalogo.fixtures';

import {
  capturaDoNo,
  desviarParaObjecao,
  duracaoParaGravar,
  estadoAoDiscar,
  passoDaLigacao,
  responderNoRoteiro,
  segundosDecorridos,
} from './chamada-maquina';
import {
  DURACAO_MAXIMA_SEG,
  desfechosDaChamada,
  MAPA_RESULTADO_TECNICO,
  NO_DE_ABERTURA,
  noSchema,
  RESULTADOS_SEM_CONVERSA,
  saidaSchema,
  tabulacaoCoerente,
  tabularChamadaSchema,
  type DesfechoDeLigacao,
  type NoRoteiro,
  type SaidaDoNo,
} from './tipos';

/**
 * A tela de ligar não tinha teste nenhum (laudo da varredura §3.11) — 903 linhas, e o
 * defeito §3.8 morando na costura entre o cronômetro e o schema do pedido. Isto cobre
 * as cinco coisas que a tela decide sozinha:
 *
 *   1. a máquina de estados (discar → falando → tabular → recibo);
 *   2. a contagem do cronômetro;
 *   3. o avanço de nó do roteiro;
 *   4. o registro do caminho percorrido;
 *   5. a barra de tabulação, com os dois eixos do R13 §3.3.
 *
 * Nada aqui pede navegador: o miolo virou funções puras em `chamada-maquina.ts`, que é
 * o que a tela chama de verdade.
 */

// ---------------------------------------------------------------------------
// Um roteiro de mentira com a forma do de verdade (três nós e uma objeção)
// ---------------------------------------------------------------------------

function no(parcial: Omit<z.input<typeof noSchema>, 'variante'>): NoRoteiro {
  return noSchema.parse({ variante: 'ambas', saidas: [], ...parcial });
}

function saida(rotulo: string, destino: string, valor: string | null = null): SaidaDoNo {
  return saidaSchema.parse({ rotulo, destino, valor });
}

const SIM_E_AQUI = saida('É sim', 'volume');
const ABERTURA = no({
  id: NO_DE_ABERTURA,
  tipo: 'pergunta',
  texto: 'Oi, é do [empresa]? Aqui é [eu], da Komune.',
  saidas: [SIM_E_AQUI, saida('Está ocupado', 'fim_retorna')],
});

/** O nó em que o rótulo NÃO é a resposta: é instrução para quem liga. */
const RESPONDEU_QUANTOS = saida('Ele respondeu quantos', 'fim_interessado');
const VOLUME = no({
  id: 'volume',
  tipo: 'captura',
  texto: 'Quantos eventos o [empresa] faz por mês?',
  campo: 'eventos_por_mes',
  saidas: [RESPONDEU_QUANTOS, saida('Depende muito da época', 'fim_interessado')],
});

/** O nó em que o rótulo É a resposta, e um toque grava. */
const MAIS_PEDIDO = saida('Mais pedido', 'fim_interessado', 'mais_pedido');
const PREFERENCIA = no({
  id: 'preferencia',
  tipo: 'pergunta',
  texto: 'Mais pedido, ou pedido melhor?',
  campo: 'preferencia',
  saidas: [MAIS_PEDIDO, saida('Pedido melhor', 'fim_interessado', 'pedido_melhor')],
});

const VOLTAR_DA_OBJECAO = saida('Voltar', 'volume');
const OBJECAO_CARO = no({
  id: 'obj_caro',
  tipo: 'objecao',
  texto: 'Entendo. Quanto você paga hoje para aparecer?',
  saidas: [VOLTAR_DA_OBJECAO],
});

// ---------------------------------------------------------------------------
// 1. A máquina de estados
// ---------------------------------------------------------------------------

describe('passoDaLigacao', () => {
  const mao = { chamada: false, atendeu: false, gravando: false, recibo: false };

  it('sem chamada aberta, o passo é discar', () => {
    expect(passoDaLigacao(mao)).toBe('discar');
  });

  it('com chamada e sem atendimento, o passo é tabular: os quatro botões técnicos são o que está na tela', () => {
    expect(passoDaLigacao({ ...mao, chamada: true })).toBe('tabular');
  });

  it('com atendimento, o passo é falando', () => {
    expect(passoDaLigacao({ ...mao, chamada: true, atendeu: true })).toBe('falando');
  });

  it('gravando é tabular, mesmo no meio da conversa: o commit já partiu', () => {
    expect(passoDaLigacao({ ...mao, chamada: true, atendeu: true, gravando: true })).toBe('tabular');
  });

  it('o recibo ganha de tudo, inclusive de uma chamada ainda não limpa', () => {
    expect(passoDaLigacao({ chamada: true, atendeu: true, gravando: true, recibo: true })).toBe(
      'recibo',
    );
  });

  it('o ciclo inteiro anda na ordem do R13 §3.4', () => {
    const ciclo = [
      { chamada: false, atendeu: false, gravando: false, recibo: false },
      { chamada: true, atendeu: false, gravando: false, recibo: false },
      { chamada: true, atendeu: true, gravando: false, recibo: false },
      { chamada: true, atendeu: true, gravando: true, recibo: false },
      { chamada: true, atendeu: true, gravando: false, recibo: true },
    ];
    expect(ciclo.map(passoDaLigacao)).toEqual([
      'discar',
      'tabular',
      'falando',
      'tabular',
      'recibo',
    ]);
  });
});

// ---------------------------------------------------------------------------
// 2. A contagem do cronômetro — e o teto do que pode ser gravado (§3.8)
// ---------------------------------------------------------------------------

describe('segundosDecorridos', () => {
  const inicio = Date.parse('2026-09-08T10:00:00-03:00');

  it('conta pelo relógio de parede, e não por tiques: a aba que dormiu volta em dia', () => {
    expect(segundosDecorridos(inicio, inicio)).toBe(0);
    expect(segundosDecorridos(inicio, inicio + 1_000)).toBe(1);
    expect(segundosDecorridos(inicio, inicio + 95_400)).toBe(95); // 1min35 depois de dormir
  });

  it('arredonda para o segundo mais próximo', () => {
    expect(segundosDecorridos(inicio, inicio + 1_499)).toBe(1);
    expect(segundosDecorridos(inicio, inicio + 1_500)).toBe(2);
  });

  it('nunca devolve negativo: quem carimba iniciada_em é o servidor', () => {
    expect(segundosDecorridos(inicio, inicio - 30_000)).toBe(0);
  });
});

describe('duracaoParaGravar (laudo §3.8)', () => {
  it('deixa passar a duração de uma ligação normal', () => {
    expect(duracaoParaGravar(0)).toBe(0);
    expect(duracaoParaGravar(184)).toBe(184);
    expect(duracaoParaGravar(DURACAO_MAXIMA_SEG)).toBe(DURACAO_MAXIMA_SEG);
  });

  it('corta no teto do banco a chamada que ficou aberta mais de duas horas', () => {
    // Três horas de aba esquecida: o cronômetro marca 10.800, e o campo aceita 7.200.
    expect(duracaoParaGravar(10_800)).toBe(DURACAO_MAXIMA_SEG);
  });

  it('o pedido de tabulação de uma chamada de 3 h continua VÁLIDO — era ele que a tela recusava', () => {
    const tresHoras = segundosDecorridos(0, 3 * 60 * 60 * 1000);
    const pedido = {
      clientKey: '3f6c1f1e-1f2a-4a3b-8c4d-5e6f70819293',
      chamadaId: '11111111-2222-4333-8444-555555555555',
      itemId: '66666666-7777-4888-8999-aaaaaaaaaaaa',
      resultado: 'atendida_humano' as const,
      outcomeId: LIG_ATENDEU_RETORNA.id,
      comQuem: 'decisor' as const,
      caminhoScript: [NO_DE_ABERTURA, 'volume'],
      duracaoSeg: duracaoParaGravar(tresHoras),
      capturas: {},
      pediuParaNaoLigar: false,
    };

    expect(tresHoras).toBe(10_800);
    expect(tabularChamadaSchema.safeParse(pedido).success).toBe(true);
  });

  it('o teto da tela é o mesmo teto do schema: um segundo a mais é recusado', () => {
    const base = {
      clientKey: '3f6c1f1e-1f2a-4a3b-8c4d-5e6f70819293',
      chamadaId: '11111111-2222-4333-8444-555555555555',
      itemId: '66666666-7777-4888-8999-aaaaaaaaaaaa',
      resultado: 'nao_atendeu' as const,
      outcomeId: null,
      comQuem: 'ninguem' as const,
      caminhoScript: [],
      capturas: {},
      pediuParaNaoLigar: false,
    };
    expect(tabularChamadaSchema.safeParse({ ...base, duracaoSeg: DURACAO_MAXIMA_SEG }).success).toBe(
      true,
    );
    expect(
      tabularChamadaSchema.safeParse({ ...base, duracaoSeg: DURACAO_MAXIMA_SEG + 1 }).success,
    ).toBe(false);
  });

  it('não deixa passar fração nem lixo: o campo do banco é inteiro', () => {
    expect(duracaoParaGravar(12.7)).toBe(12);
    expect(duracaoParaGravar(Number.NaN)).toBe(0);
    expect(duracaoParaGravar(-5)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 3 e 4. O avanço de nó e o registro do caminho
// ---------------------------------------------------------------------------

describe('o caminho pelo roteiro', () => {
  it('a chamada começa na abertura, sem atendimento, e a abertura já está no caminho', () => {
    const estado = estadoAoDiscar();
    expect(estado).toEqual({
      noAtual: NO_DE_ABERTURA,
      caminho: [NO_DE_ABERTURA],
      capturas: {},
      atendeu: false,
    });
  });

  it('o PRIMEIRO toque numa resposta afirma que alguém atendeu (R13 §3.3)', () => {
    const depois = responderNoRoteiro(estadoAoDiscar(), ABERTURA, SIM_E_AQUI);
    expect(depois.atendeu).toBe(true);
    expect(depois.noAtual).toBe('volume');
  });

  it('cada destino entra no caminho, na ordem, e repetição não é limpa', () => {
    let estado = estadoAoDiscar();
    estado = responderNoRoteiro(estado, ABERTURA, SIM_E_AQUI);
    estado = desviarParaObjecao(estado, OBJECAO_CARO);
    estado = responderNoRoteiro(estado, OBJECAO_CARO, VOLTAR_DA_OBJECAO);
    estado = responderNoRoteiro(estado, VOLUME, RESPONDEU_QUANTOS);

    expect(estado.caminho).toEqual([
      NO_DE_ABERTURA,
      'volume',
      'obj_caro',
      'volume',
      'fim_interessado',
    ]);
    expect(estado.noAtual).toBe('fim_interessado');
  });

  it('a objeção é alcançável de qualquer nó e também afirma o atendimento', () => {
    const estado = desviarParaObjecao(estadoAoDiscar(), OBJECAO_CARO);
    expect(estado.atendeu).toBe(true);
    expect(estado.noAtual).toBe('obj_caro');
    expect(estado.caminho).toEqual([NO_DE_ABERTURA, 'obj_caro']);
  });

  it('grava no campo o VALOR declarado pela saída, nunca o rótulo do botão', () => {
    const estado = responderNoRoteiro(estadoAoDiscar(), PREFERENCIA, MAIS_PEDIDO);
    expect(estado.capturas).toEqual({ preferencia: 'mais_pedido' });
  });

  it('saída sem valor não escreve nada: campo vazio é honesto, campo com a frase errada não', () => {
    const estado = responderNoRoteiro(estadoAoDiscar(), VOLUME, RESPONDEU_QUANTOS);
    expect(estado.capturas).toEqual({});
  });

  it('o que a pessoa escreveu tem precedência sobre o valor do botão', () => {
    const escrito = { ...estadoAoDiscar(), capturas: { preferencia: '4 por mês' } };
    const estado = responderNoRoteiro(escrito, PREFERENCIA, MAIS_PEDIDO);
    expect(estado.capturas).toEqual({ preferencia: '4 por mês' });
  });

  it('capturaDoNo devolve o texto do campo do nó em foco, e string vazia quando não há campo', () => {
    const estado = { ...estadoAoDiscar(), capturas: { eventos_por_mes: '4' } };
    expect(capturaDoNo(estado, VOLUME)).toBe('4');
    expect(capturaDoNo(estado, ABERTURA)).toBe('');
    expect(capturaDoNo(estado, null)).toBe('');
  });

  it('responder não muda o estado anterior (a tela guarda o caminho em useState)', () => {
    const antes = estadoAoDiscar();
    responderNoRoteiro(antes, ABERTURA, SIM_E_AQUI);
    expect(antes.caminho).toEqual([NO_DE_ABERTURA]);
    expect(antes.atendeu).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 5. A barra de tabulação: os dois eixos do R13 §3.3
// ---------------------------------------------------------------------------

const LIG_NAO_ATENDEU_NA_LIGACAO: DesfechoDeLigacao = {
  ...LIG_NAO_ATENDEU,
  requires_answer: false,
};
const LIG_ATENDEU_RETORNA_NA_LIGACAO: DesfechoDeLigacao = {
  ...LIG_ATENDEU_RETORNA,
  requires_answer: true,
};
const CATALOGO_DA_LIGACAO: DesfechoDeLigacao[] = [
  LIG_NAO_ATENDEU_NA_LIGACAO,
  LIG_ATENDEU_RETORNA_NA_LIGACAO,
  { ...LIG_SEM_INTERESSE, requires_answer: true },
  { ...LIG_REUNIAO_MARCADA, requires_answer: true },
];

describe('a barra de tabulação (dois eixos)', () => {
  it('sem conversa, a barra não oferece desfecho comercial nenhum', () => {
    for (const resultado of RESULTADOS_SEM_CONVERSA) {
      expect(desfechosDaChamada(CATALOGO_DA_LIGACAO, resultado)).toEqual([]);
    }
  });

  it('com conversa, oferece só os desfechos que exigem atendimento', () => {
    const oferecidos = desfechosDaChamada(CATALOGO_DA_LIGACAO, 'atendida_humano');
    expect(oferecidos.map((d) => d.slug)).toEqual([
      'lig_atendeu_retorna',
      'lig_sem_interesse',
      'lig_reuniao_marcada',
    ]);
    expect(oferecidos.map((d) => d.slug)).not.toContain('lig_nao_atendeu');
  });

  it('quem manda é a coluna requires_answer, não a lista de slugs do cliente', () => {
    // O gestor marcou um sexto desfecho como comercial (RF-ADM-02): entra sem deploy.
    const comNovo = [...CATALOGO_DA_LIGACAO, { ...REU_AUTORIZOU, requires_answer: true }];
    expect(desfechosDaChamada(comNovo, 'atendida_humano').map((d) => d.slug)).toContain(
      'reu_autorizou',
    );
  });

  it('desfecho comercial sem atendimento é incoerente, e atendimento sem desfecho também', () => {
    expect(tabulacaoCoerente('nao_atendeu', null)).toBe(true);
    expect(tabulacaoCoerente('nao_atendeu', LIG_ATENDEU_RETORNA_NA_LIGACAO)).toBe(false);
    expect(tabulacaoCoerente('atendida_humano', null)).toBe(false);
    expect(tabulacaoCoerente('atendida_humano', LIG_ATENDEU_RETORNA_NA_LIGACAO)).toBe(true);
    // "Não atendeu" é do eixo técnico: nem como desfecho de uma chamada atendida vale.
    expect(tabulacaoCoerente('atendida_humano', LIG_NAO_ATENDEU_NA_LIGACAO)).toBe(false);
  });

  it('o eixo técnico resolve sozinho o desfecho do catálogo, sem ninguém escolher', () => {
    expect(MAPA_RESULTADO_TECNICO.nao_atendeu).toBe('lig_nao_atendeu');
    expect(MAPA_RESULTADO_TECNICO.ocupado).toBe('lig_nao_atendeu');
    expect(MAPA_RESULTADO_TECNICO.caixa_postal).toBe('lig_caixa_postal');
    expect(MAPA_RESULTADO_TECNICO.numero_invalido).toBe('lig_numero_errado');
    expect(MAPA_RESULTADO_TECNICO.atendida_humano).toBeNull();
  });

  it('o schema recusa o pedido que promete uma conversa que não houve', () => {
    const base = {
      clientKey: '3f6c1f1e-1f2a-4a3b-8c4d-5e6f70819293',
      chamadaId: '11111111-2222-4333-8444-555555555555',
      itemId: '66666666-7777-4888-8999-aaaaaaaaaaaa',
      comQuem: 'ninguem' as const,
      caminhoScript: [],
      duracaoSeg: 30,
      capturas: {},
      pediuParaNaoLigar: false,
    };
    expect(
      tabularChamadaSchema.safeParse({ ...base, resultado: 'nao_atendeu', outcomeId: 11 }).success,
    ).toBe(false);
    expect(
      tabularChamadaSchema.safeParse({
        ...base,
        resultado: 'atendida_humano',
        outcomeId: null,
        comQuem: 'decisor',
      }).success,
    ).toBe(false);
  });
});
