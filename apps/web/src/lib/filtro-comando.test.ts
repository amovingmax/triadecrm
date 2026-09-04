import { describe, expect, it } from 'vitest';

import { filtrarComando, semAcento } from '@/lib/filtro-comando';

describe('semAcento', () => {
  it('tira acento e caixa', () => {
    expect(semAcento('Relatórios')).toBe('relatorios');
    expect(semAcento('Aparência')).toBe('aparencia');
    expect(semAcento('MEU DIA')).toBe('meu dia');
  });
});

describe('filtrarComando', () => {
  it('mostra tudo enquanto ninguém digitou', () => {
    expect(filtrarComando('Parceiros', '')).toBe(1);
    expect(filtrarComando('Parceiros', '   ')).toBe(1);
  });

  it('acha sem acento, nos dois sentidos', () => {
    expect(filtrarComando('Relatórios', 'relatorios')).toBe(1);
    expect(filtrarComando('Relatorios', 'relatórios')).toBe(1);
  });

  it('não exige a ordem das palavras', () => {
    expect(filtrarComando('Novo parceiro', 'novo parc')).toBe(1);
    expect(filtrarComando('Novo parceiro', 'parceiro novo')).toBe(1);
  });

  it('procura também nas palavras-chave do item', () => {
    expect(filtrarComando('Novo parceiro', 'cadastrar', ['cadastrar', 'criar'])).toBe(1);
    expect(filtrarComando('Novo parceiro', 'fornecedor', ['cadastrar', 'criar'])).toBe(0);
  });

  it('esconde quando um dos termos não aparece', () => {
    expect(filtrarComando('Funis', 'funis kanban')).toBe(0);
    expect(filtrarComando('Agenda', 'radar')).toBe(0);
  });
});
