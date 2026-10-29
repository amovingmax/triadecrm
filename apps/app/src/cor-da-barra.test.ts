import { describe, expect, it } from 'vitest';

import { corDaMensagem, estiloDaBarra } from './cor-da-barra';

const mensagem = (dados: unknown) => JSON.stringify(dados);

describe('corDaMensagem', () => {
  it('lê as duas cores que o site publica', () => {
    expect(corDaMensagem(mensagem({ tipo: 'cor-da-barra', cor: '#0f172a' }))).toBe('#0f172a');
    expect(corDaMensagem(mensagem({ tipo: 'cor-da-barra', cor: '#F0F8FF' }))).toBe('#f0f8ff');
  });

  it('a forma curta vira a longa', () => {
    expect(corDaMensagem(mensagem({ tipo: 'cor-da-barra', cor: '#fff' }))).toBe('#ffffff');
  });

  it('ignora qualquer outra mensagem', () => {
    expect(corDaMensagem('não é json')).toBeNull();
    expect(corDaMensagem(mensagem(null))).toBeNull();
    expect(corDaMensagem(mensagem({ tipo: 'outra', cor: '#000000' }))).toBeNull();
    expect(corDaMensagem(mensagem({ tipo: 'cor-da-barra', cor: 'red' }))).toBeNull();
    expect(corDaMensagem(mensagem({ tipo: 'cor-da-barra', cor: 'url(javascript:1)' }))).toBeNull();
    expect(corDaMensagem(mensagem({ tipo: 'cor-da-barra', cor: 12 }))).toBeNull();
  });
});

describe('estiloDaBarra', () => {
  it('letras claras no tema escuro e escuras no claro', () => {
    expect(estiloDaBarra('#0f172a')).toBe('light-content');
    expect(estiloDaBarra('#f0f8ff')).toBe('dark-content');
    expect(estiloDaBarra('#000000')).toBe('light-content');
    expect(estiloDaBarra('#ffffff')).toBe('dark-content');
  });
});
