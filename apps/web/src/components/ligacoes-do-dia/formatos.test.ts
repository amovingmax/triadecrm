import { describe, expect, it } from 'vitest';

import {
  comQuemFalou,
  duracao,
  duracaoDaLigacao,
  horaDe,
  jornada,
  resultadoDaLigacao,
  rotuloDoResultado,
  somarOTime,
  taxaDeAtendimento,
} from './formatos';
import type { PessoaDoDia } from './tipos';

/**
 * O dia de quem ligou, em texto (pivô de 06/10/2026).
 *
 *  1. A hora é a de Natal, não a do aparelho de quem abre o relatório.
 *  2. A duração é exata onde importa: segundos enquanto a conta é de minutos.
 *  3. Quem não atendeu não tem duração; quem não tabulou é "Sem resultado".
 *  4. A linha de cima do time soma só quem ligou.
 */

function pessoa(parcial: Partial<PessoaDoDia>): PessoaDoDia {
  return {
    pessoa_id: 'p',
    nome: 'Ana',
    papel: 'sdr',
    primeira_em: null,
    ultima_em: null,
    ligacoes: 0,
    atendidas: 0,
    nao_atendidas: 0,
    sem_resultado: 0,
    tempo_falado_seg: 0,
    contatos: 0,
    reunioes_marcadas: 0,
    pediram_para_nao_ligar: 0,
    outros_registros: 0,
    resultados: [],
    lista: null,
    ...parcial,
  };
}

describe('horaDe', () => {
  it('mostra a hora de Natal, e não a do banco (UTC)', () => {
    // 13:05 UTC é 10:05 em Fortaleza (UTC−3, sem horário de verão).
    expect(horaDe('2026-10-06T13:05:00+00:00')).toBe('10:05');
  });

  it('devolve null para o que não é data', () => {
    expect(horaDe(null)).toBeNull();
    expect(horaDe('ontem')).toBeNull();
  });
});

describe('duracao', () => {
  it('mostra segundos enquanto a conta é de minutos', () => {
    expect(duracao(0)).toBe('0 s');
    expect(duracao(45)).toBe('45 s');
    expect(duracao(60)).toBe('1 min');
    expect(duracao(200)).toBe('3 min 20 s');
  });

  it('acima de uma hora, larga os segundos', () => {
    expect(duracao(3600)).toBe('1 h');
    expect(duracao(4339)).toBe('1 h 12 min');
  });

  it('trata vazio e negativo como zero', () => {
    expect(duracao(null)).toBe('0 s');
    expect(duracao(-5)).toBe('0 s');
  });
});

describe('duracaoDaLigacao', () => {
  it('quem não atendeu não tem duração', () => {
    expect(duracaoDaLigacao({ resultado: 'nao_atendeu', duracao_seg: 0 })).toBe('—');
    expect(duracaoDaLigacao({ resultado: null, duracao_seg: null })).toBe('—');
  });

  it('quem atendeu tem a duração exata', () => {
    expect(duracaoDaLigacao({ resultado: 'atendida_humano', duracao_seg: 180 })).toBe('3 min');
  });
});

describe('taxaDeAtendimento', () => {
  it('é a parte das ligações que alguém atendeu', () => {
    expect(taxaDeAtendimento({ ligacoes: 5, atendidas: 2 })).toBe(40);
  });

  it('sem ligação não há taxa, e não "0%"', () => {
    expect(taxaDeAtendimento({ ligacoes: 0, atendidas: 0 })).toBeNull();
  });
});

describe('jornada', () => {
  it('vai da primeira à última ligação', () => {
    expect(
      jornada({
        primeira_em: '2026-10-06T13:00:00+00:00',
        ultima_em: '2026-10-06T19:42:00+00:00',
      }),
    ).toBe('das 10:00 às 16:42');
  });

  it('uma ligação só não é um intervalo', () => {
    const uma = '2026-10-06T13:00:00+00:00';
    expect(jornada({ primeira_em: uma, ultima_em: uma })).toBe('às 10:00');
  });

  it('quem não ligou não tem jornada', () => {
    expect(jornada({ primeira_em: null, ultima_em: null })).toBeNull();
  });
});

describe('como terminou', () => {
  it('desfecho do catálogo aparece pelo nome que a gestão deu', () => {
    expect(rotuloDoResultado({ chave: 'lig_reuniao_marcada', nome: 'Reunião marcada' })).toBe(
      'Reunião marcada',
    );
  });

  it('resultado da linha aparece em português', () => {
    expect(rotuloDoResultado({ chave: 'caixa_postal', nome: null })).toBe('Caixa postal');
    expect(rotuloDoResultado({ chave: 'sem_resultado', nome: null })).toBe('Sem resultado');
  });

  it('a ligação que começou e não foi tabulada é "Sem resultado"', () => {
    expect(resultadoDaLigacao({ resultado: null, desfecho_nome: null })).toBe('Sem resultado');
  });

  it('a que atendeu mostra o desfecho; a que não atendeu, o que deu na linha', () => {
    expect(resultadoDaLigacao({ resultado: 'atendida_humano', desfecho_nome: 'Interessado' })).toBe(
      'Interessado',
    );
    expect(resultadoDaLigacao({ resultado: 'atendida_humano', desfecho_nome: null })).toBe(
      'Atendeu, sem desfecho',
    );
    expect(resultadoDaLigacao({ resultado: 'nao_atendeu', desfecho_nome: null })).toBe(
      'Não atendeu',
    );
  });
});

describe('comQuemFalou', () => {
  it('"não informado" some em vez de ocupar a linha', () => {
    expect(comQuemFalou('nao_informado')).toBeNull();
    expect(comQuemFalou(null)).toBeNull();
  });

  it('o que foi informado aparece com o rótulo do catálogo', () => {
    expect(comQuemFalou('decisor')).toEqual(expect.any(String));
  });
});

describe('somarOTime', () => {
  it('soma as ligações e conta como pessoa só quem ligou', () => {
    const soma = somarOTime([
      pessoa({ ligacoes: 5, atendidas: 2, tempo_falado_seg: 240, reunioes_marcadas: 1 }),
      pessoa({ ligacoes: 1, atendidas: 0 }),
      pessoa({ ligacoes: 0 }),
    ]);
    expect(soma).toEqual({
      pessoas: 2,
      ligacoes: 6,
      atendidas: 2,
      tempoFaladoSeg: 240,
      reunioesMarcadas: 1,
    });
  });
});
