import { describe, expect, it } from 'vitest';

import {
  acompanhaEquipe,
  pessoaPedida,
  pessoasAcompanhadas,
  type PessoaDoTime,
} from './hierarquia';
import { APP_ROLES } from './role';

const TIME: PessoaDoTime[] = [
  { id: 'rafael', nome: 'Rafael', papel: 'admin' },
  { id: 'matheus', nome: 'Matheus', papel: 'admin' },
  { id: 'barbara', nome: 'Bárbara', papel: 'gestor' },
  { id: 'janio', nome: 'Janio', papel: 'gestor' },
  { id: 'heloisa', nome: 'Heloísa', papel: 'sdr' },
  { id: 'gustavo', nome: 'Gustavo', papel: 'sdr' },
  { id: 'emb', nome: 'Ana Embaixadora', papel: 'embaixador' },
  { id: 'dennis', nome: 'Dennis', papel: 'financeiro' },
  { id: 'leitor', nome: 'Leitor', papel: 'leitura' },
  { id: 'robo', nome: 'Robô', papel: 'bot' },
  { id: 'sem', nome: 'Sem papel', papel: null },
];

describe('quem acompanha quem', () => {
  it('o admin vê gestores, SDRs e embaixadores, mas não outro admin', () => {
    const lista = pessoasAcompanhadas({ id: 'rafael', nome: 'Rafael', papel: 'admin' }, TIME);
    expect(lista.map((p) => p.id)).toEqual([
      'rafael',
      'emb',
      'barbara',
      'gustavo',
      'heloisa',
      'janio',
    ]);
  });

  it('o gestor vê SDRs e embaixadores, mas não outro gestor nem o admin', () => {
    const lista = pessoasAcompanhadas({ id: 'janio', nome: 'Janio', papel: 'gestor' }, TIME);
    expect(lista.map((p) => p.id)).toEqual(['janio', 'emb', 'gustavo', 'heloisa']);
  });

  it('quem não acompanha ninguém vê só a si mesmo', () => {
    for (const papel of ['sdr', 'embaixador', 'leitura', 'financeiro', 'bot'] as const) {
      expect(acompanhaEquipe(papel)).toBe(false);
      expect(pessoasAcompanhadas({ id: 'eu', nome: 'Eu', papel }, TIME)).toEqual([
        { id: 'eu', nome: 'Eu', papel },
      ]);
    }
  });

  it('só admin e gestor ligam o seletor de pessoa', () => {
    expect(APP_ROLES.filter(acompanhaEquipe)).toEqual(['admin', 'gestor']);
  });

  it('`?pessoa=` fora da lista abre o dia de quem entrou', () => {
    const lista = [{ id: 'janio' }, { id: 'heloisa' }];
    expect(pessoaPedida('heloisa', lista, 'janio')).toBe('heloisa');
    expect(pessoaPedida('rafael', lista, 'janio')).toBe('janio');
    expect(pessoaPedida(['heloisa'], lista, 'janio')).toBe('janio');
    expect(pessoaPedida(undefined, lista, 'janio')).toBe('janio');
  });
});
