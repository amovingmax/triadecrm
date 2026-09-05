import { describe, expect, it } from 'vitest';

import { duracaoEmPortugues, naOrdemDaEsteira, ORDEM_DAS_FILAS } from './painel-coletor';

/**
 * O painel do coletor existe para responder uma pergunta só: dá para confiar na
 * fila abaixo? As duas funções puras que decidem o que a tela mostra são o tempo
 * desde a última batida e a ordem em que as filas aparecem — e as duas erram em
 * silêncio se ninguém olhar.
 */
describe('duracaoEmPortugues', () => {
  it('fala em segundos abaixo de um minuto', () => {
    expect(duracaoEmPortugues(0)).toEqual({ numero: 0, unidade: 'segundos' });
    expect(duracaoEmPortugues(1)).toEqual({ numero: 1, unidade: 'segundo' });
    expect(duracaoEmPortugues(59)).toEqual({ numero: 59, unidade: 'segundos' });
  });

  it('vira minutos, horas e dias na hora certa', () => {
    expect(duracaoEmPortugues(60)).toEqual({ numero: 1, unidade: 'minuto' });
    expect(duracaoEmPortugues(150)).toEqual({ numero: 2, unidade: 'minutos' });
    expect(duracaoEmPortugues(3600)).toEqual({ numero: 1, unidade: 'hora' });
    expect(duracaoEmPortugues(86_400)).toEqual({ numero: 1, unidade: 'dia' });
    expect(duracaoEmPortugues(200_000)).toEqual({ numero: 2, unidade: 'dias' });
  });

  it('nunca mostra tempo negativo, mesmo com relógio adiantado no navegador', () => {
    // `ha_segundos` vem do relógio do Postgres; se a máquina de quem olha estiver
    // adiantada, "há -3 segundos" seria a frase mais confusa possível.
    expect(duracaoEmPortugues(-5)).toEqual({ numero: 0, unidade: 'segundos' });
  });
});

describe('naOrdemDaEsteira', () => {
  it('mostra o caminho do trabalho, e não a ordem alfabética do banco', () => {
    // O banco devolve por nome, o que começaria por "Parou com erro" (ingest_dlq).
    const doBanco = [
      { fila: 'ingest_dlq' },
      { fila: 'ingest_jobs' },
      { fila: 'ingest_pages' },
      { fila: 'ingest_records' },
    ];
    expect([...doBanco].sort(naOrdemDaEsteira).map((f) => f.fila)).toEqual(ORDEM_DAS_FILAS);
  });

  it('joga uma fila desconhecida para o fim em vez de escondê-la', () => {
    const lista = [{ fila: 'ingest_futura' }, { fila: 'ingest_jobs' }];
    expect([...lista].sort(naOrdemDaEsteira).map((f) => f.fila)).toEqual([
      'ingest_jobs',
      'ingest_futura',
    ]);
  });
});
