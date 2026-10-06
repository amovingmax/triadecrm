import { describe, expect, it } from 'vitest';

import { deveMarcarComoLida } from './leitura-do-fio';

/**
 * Quando a conversa aberta conta como lida (06/10/2026).
 *
 *  1. Escolhida, na frente da pessoa e com mensagem por ler: marca.
 *  2. A que o desktop abriu sozinho não marca — o contador é do time.
 *  3. Janela escondida ou sem foco não é leitura.
 *  4. Sem fio ou sem nada por ler, não há o que marcar.
 */

const LENDO = { escolhida: true, naTela: true, fioId: 'f1', naoLidas: 2 };

describe('deveMarcarComoLida', () => {
  it('marca a conversa escolhida que está na frente da pessoa', () => {
    expect(deveMarcarComoLida(LENDO)).toBe(true);
  });

  it('não marca a que o desktop abriu sozinho: ninguém pediu para ver', () => {
    expect(deveMarcarComoLida({ ...LENDO, escolhida: false })).toBe(false);
  });

  it('não marca com a janela escondida ou sem foco: a mensagem chegou e ninguém viu', () => {
    expect(deveMarcarComoLida({ ...LENDO, naTela: false })).toBe(false);
  });

  it('não chama o banco quando não há o que marcar', () => {
    expect(deveMarcarComoLida({ ...LENDO, naoLidas: 0 })).toBe(false);
    expect(deveMarcarComoLida({ ...LENDO, fioId: null })).toBe(false);
  });
});
