import { describe, expect, it } from 'vitest';

import type { LigacaoDoNativo } from '../modules/triade-chamada';
import { avisoDaLinha, fraseDoMotivo, iniciais, relogio, rotuloDoEstado } from './chamada';

const linha: LigacaoDoNativo = {
  chamada: 'x',
  quem: 'Maria Cliente',
  estado: 'em_curso',
  atendidaEm: 1_000,
  mudo: false,
  motivo: null,
  caminho: null,
  empresa: 'imova',
  em: 0,
};

describe('a tela do app durante a ligação', () => {
  it('o relógio conta a conversa a partir do aceite', () => {
    expect(rotuloDoEstado(linha, 1_000 + 7_400)).toBe('0:07');
    expect(rotuloDoEstado(linha, 1_000 + 750_000)).toBe('12:30');
    expect(rotuloDoEstado({ ...linha, atendidaEm: null }, 0)).toBe('Em ligação');
    expect(rotuloDoEstado({ ...linha, estado: 'conectando' }, 0)).toBe('Conectando…');
    expect(rotuloDoEstado({ ...linha, estado: 'encerrada' }, 0)).toBe('Ligação encerrada');
  });

  it('o relógio passa de uma hora e nunca fica negativo', () => {
    expect(relogio(3723)).toBe('1:02:03');
    expect(relogio(-5)).toBe('0:00');
  });

  it('só a ligação que não deu certo traz frase, e com o porquê', () => {
    expect(avisoDaLinha(linha)).toBeNull();
    expect(avisoDaLinha({ ...linha, estado: 'encerrada' })).toBeNull();
    expect(avisoDaLinha({ ...linha, estado: 'falhou', motivo: 'ja_atendida' })).toMatch(/já atendeu/);
    expect(avisoDaLinha({ ...linha, estado: 'falhou', motivo: 'microfone' })).toMatch(/Ajustes do iPhone/);
  });

  it('o motivo desconhecido também tem frase', () => {
    expect(fraseDoMotivo('qualquer')).toMatch(/não pôde ser atendida/);
    expect(fraseDoMotivo(null)).toMatch(/não pôde ser atendida/);
  });

  it('as iniciais do nome', () => {
    expect(iniciais('Maria Cliente')).toBe('MC');
    expect(iniciais('  joão  ')).toBe('J');
    expect(iniciais('Ana de Souza Lima')).toBe('AL');
    expect(iniciais('')).toBe('?');
  });
});
