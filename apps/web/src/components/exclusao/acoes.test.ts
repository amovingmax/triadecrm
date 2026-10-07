import { describe, expect, it } from 'vitest';

import {
  recadoDaExclusao,
  resumoDoRecibo,
  rotuloDoCampoDuplicado,
  type ReciboDaExclusao,
} from './acoes';

/**
 * O que estes testes protegem: o texto que a pessoa lê depois de excluir. É ele
 * que diz o que foi levado junto — e um aviso que erra o número, ou que mostra
 * `pre_cadastro_em_andamento` em vez de uma frase, ensina a não ler aviso.
 */

const NADA: ReciboDaExclusao = {
  nome: 'Buffet Aurora',
  reunioesCanceladas: 0,
  tarefasCanceladas: 0,
  enviosCancelados: 0,
  conversasDesligadas: 0,
};

describe('o que a exclusão do parceiro levou junto', () => {
  it('sem nada pendente não inventa frase: quem chama usa o texto padrão', () => {
    expect(resumoDoRecibo(NADA)).toBeNull();
  });

  it('uma coisa só, no singular', () => {
    expect(resumoDoRecibo({ ...NADA, tarefasCanceladas: 1 })).toBe('1 tarefa cancelada.');
    expect(resumoDoRecibo({ ...NADA, reunioesCanceladas: 1 })).toBe('1 reunião cancelada.');
  });

  it('mais de uma, no plural e com "e" antes da última', () => {
    expect(resumoDoRecibo({ ...NADA, reunioesCanceladas: 1, tarefasCanceladas: 2 })).toBe(
      '1 reunião cancelada e 2 tarefas canceladas.',
    );
    expect(
      resumoDoRecibo({ ...NADA, reunioesCanceladas: 2, tarefasCanceladas: 3, enviosCancelados: 1 }),
    ).toBe('2 reuniões canceladas, 3 tarefas canceladas e 1 mensagem tirada da fila.');
  });

  it('a conversa desligada não entra na frase: ela não foi cancelada, foi para o arquivo', () => {
    expect(resumoDoRecibo({ ...NADA, conversasDesligadas: 1 })).toBeNull();
  });
});

describe('a recusa vira frase, nunca o código do banco', () => {
  it.each([
    'sem_permissao',
    'nao_encontrado',
    'motivo_obrigatorio',
    'ja_e_cliente',
    'pre_cadastro_em_andamento',
    'anonimizado',
    'duplicado',
    'nao_encontrada',
    'ja_concluida',
  ])('%s tem frase própria', (motivo) => {
    const frase = recadoDaExclusao(motivo);
    expect(frase).not.toContain('_');
    expect(frase).not.toBe(recadoDaExclusao('motivo_que_nao_existe'));
  });

  it('motivo desconhecido (função nova no banco, tela antiga) cai numa frase que dá saída', () => {
    expect(recadoDaExclusao('qualquer_coisa')).toBe(
      'Não deu para falar com o servidor. Tente de novo.',
    );
  });

  it('cliente e pré-cadastro dizem POR QUE não dá, e não só que não dá', () => {
    expect(recadoDaExclusao('ja_e_cliente')).toMatch(/cliente da Komune/);
    expect(recadoDaExclusao('pre_cadastro_em_andamento')).toMatch(/pré-cadastro em andamento/);
  });
});

describe('o que bateu na restauração', () => {
  it('diz o campo do jeito que se fala', () => {
    expect(rotuloDoCampoDuplicado('telefone')).toBe('o mesmo telefone');
    expect(rotuloDoCampoDuplicado('cnpj')).toBe('o mesmo CNPJ');
    expect(rotuloDoCampoDuplicado('instagram')).toBe('o mesmo Instagram');
    expect(rotuloDoCampoDuplicado('google_maps')).toBe('o mesmo lugar no Google Maps');
  });

  it('sem campo, não mostra "undefined"', () => {
    expect(rotuloDoCampoDuplicado(undefined)).toBe('os mesmos dados');
  });
});
