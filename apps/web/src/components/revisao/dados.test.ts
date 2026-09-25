import { describe, expect, it } from 'vitest';

import { MOTIVO_DA_REVISAO, mensagemDoErro } from './dados';

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
