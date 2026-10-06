import { describe, expect, it } from 'vitest';

import { fraseDaMensagemAutomatica, MOTIVO_DA_REVISAO, mensagemDoErro } from './dados';

/**
 * O que a Revisão diz quando o banco recusa. Motivo sem frase é defeito
 * silencioso: quem revisou 40 candidatos e levou um "23514" na cara não sabe se
 * errou, se o CRM caiu, ou se aquele alvo simplesmente não pode entrar.
 */
describe('mensagemDoErro', () => {
  it('nunca devolve texto cru do Postgres', () => {
    expect(mensagemDoErro(new Error('permission denied for function radar_fila'))).toBe(
      'O seu acesso não trabalha a fila de revisão.',
    );
    expect(mensagemDoErro(new Error('JWT expired'))).toBe('A sua sessão expirou.');
    expect(mensagemDoErro(new Error('TypeError: Failed to fetch'))).toBe(
      'O aplicativo não alcançou o servidor.',
    );
    expect(mensagemDoErro(new Error('duplicate key value violates unique constraint'))).toBe(
      'O servidor não respondeu como esperado.',
    );
    expect(mensagemDoErro('qualquer coisa')).toBe('O servidor não respondeu como esperado.');
  });
});

describe('motivos traduzidos', () => {
  it('cobre todos os motivos que a RPC de revisão devolve', () => {
    for (const motivo of [
      'candidato_inexistente',
      'ja_revisado',
      'motivo_obrigatorio',
      'acao_invalida',
      'candidato_nao_contatar',
      'categoria_obrigatoria',
      'organizacao_obrigatoria',
      'organizacao_inexistente',
      'organizacao_fora_da_carteira',
      'ja_existe_na_base',
    ]) {
      expect(MOTIVO_DA_REVISAO[motivo]).toBeTruthy();
    }
  });
});

describe('o que dizer de "Aprovar e mandar mensagem" (pivô de 06/10/2026)', () => {
  it('sem pedido de mensagem, não há o que dizer', () => {
    expect(fraseDaMensagemAutomatica(undefined)).toBeNull();
  });

  it('entrou na fila: diz que sai, e onde o lead vai aparecer', () => {
    const uma = fraseDaMensagemAutomatica({ ligada: true, naFila: 1 });
    expect(uma?.saiu).toBe(true);
    expect(uma?.texto).toMatch(/entrou na fila/);
    expect(uma?.texto).toMatch(/Conversas/);

    const varias = fraseDaMensagemAutomatica({ ligada: true, naFila: 12 });
    expect(varias?.saiu).toBe(true);
    expect(varias?.texto).toMatch(/^12 mensagens/);
    expect(varias?.texto).toMatch(/aos poucos/);
  });

  it('chave geral desligada: aprovou, e avisa que ninguém foi procurado', () => {
    const r = fraseDaMensagemAutomatica({ ligada: false, naFila: 0 });
    expect(r?.saiu).toBe(false);
    expect(r?.texto).toMatch(/desligada em Ajustes/);
  });

  it('ligada e nada na fila: a fila não aceitou, e a tela não finge que mandou', () => {
    const r = fraseDaMensagemAutomatica({ ligada: true, naFila: 0 });
    expect(r?.saiu).toBe(false);
    expect(r?.texto).toMatch(/não entrou na fila/);
  });
});
