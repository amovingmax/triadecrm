import { describe, expect, it } from 'vitest';

import { formatarProximaAcao } from './formatos';

/**
 * O contrato que importa aqui é a SEPARAÇÃO da frase: só o dígito pode receber a
 * IBM Plex Mono. Vestir "em 4 d" inteiro de mono põe preposição e unidade em outra
 * família no meio de uma linha de Poppins, contra a regra escrita no próprio
 * `formatos.ts`. Os testes fixam qual pedaço é número e qual é palavra.
 */
describe('formatarProximaAcao', () => {
  const emDias = (dias: number) => {
    const alvo = new Date();
    alvo.setHours(12, 0, 0, 0);
    alvo.setDate(alvo.getDate() + dias);
    return formatarProximaAcao(alvo.toISOString());
  };

  it('devolve nulo quando não há próxima ação', () => {
    expect(formatarProximaAcao(null)).toBeNull();
    expect(formatarProximaAcao(undefined)).toBeNull();
  });

  it('não põe número nenhum em "hoje", "amanhã" e "ontem"', () => {
    for (const [dias, texto] of [
      [0, 'hoje'],
      [1, 'amanhã'],
      [-1, 'ontem'],
    ] as const) {
      const acao = emDias(dias);
      expect(acao?.numero).toBeNull();
      expect(acao?.texto).toBe(texto);
    }
  });

  it('isola o dígito e deixa "em" e "d" como palavra', () => {
    const acao = emDias(4);
    expect(acao).toMatchObject({ prefixo: 'em ', numero: '4', sufixo: ' d', atrasada: false });
    expect(acao?.texto).toBe('em 4 d');
  });

  it('isola o dígito também no atraso, e marca a linha como atrasada', () => {
    const acao = emDias(-3);
    expect(acao).toMatchObject({ prefixo: '', numero: '3', sufixo: ' d atrás', atrasada: true });
    expect(acao?.texto).toBe('3 d atrás');
  });

  it('marca atraso em "ontem" e nunca em "hoje" ou "amanhã"', () => {
    expect(emDias(-1)?.atrasada).toBe(true);
    expect(emDias(0)?.atrasada).toBe(false);
    expect(emDias(1)?.atrasada).toBe(false);
  });
});
