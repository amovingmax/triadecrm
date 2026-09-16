import { describe, expect, it } from 'vitest';

import {
  deQuandoE,
  diasDesde,
  linkDaPrioridade,
  ordenarPrioridades,
} from './pulso-formatos';
import type { PrioridadeDoPulso } from './pulso-dados';

/**
 * O Pulso sai às 18h30 e é lido às 7h da manhã seguinte. Tudo neste arquivo existe
 * por causa desse descompasso:
 *
 * 1. **"Ontem" responde; "17/09" faz calcular.** A tela diz de quando é o Pulso em
 *    palavra, até dois dias; depois vira data, porque aí o que importa é que o
 *    digest parou de sair.
 * 2. **A ordem das prioridades não depende do modelo.** Ele entrega mais ou menos
 *    ordenado; a tela garante.
 * 3. **Prioridade sem conversa não vira link.** Melhor uma linha sem link que um
 *    link que abre a conversa errada.
 */

const HOJE = new Date(2026, 8, 18, 7, 30); // 18/09/2026, 7h30

const prioridade = (
  urgencia: PrioridadeDoPulso['urgencia'],
  organizationId: string | null = 'org-1',
): PrioridadeDoPulso => ({
  leadId: 'lead-1',
  porque: 'x',
  acao: 'y',
  urgencia,
  conversationId: 'conversa-1',
  organizationId,
  nome: 'Buffet Aurora',
});

describe('de quando é o Pulso', () => {
  it('fala em palavra até anteontem', () => {
    expect(deQuandoE('2026-09-18', HOJE)).toBe('hoje');
    expect(deQuandoE('2026-09-17', HOJE)).toBe('ontem');
    expect(deQuandoE('2026-09-16', HOJE)).toBe('anteontem');
  });

  it('e vira data quando o digest parou de sair', () => {
    expect(deQuandoE('2026-09-11', HOJE)).toBe('11/09');
  });

  it('conta os dias, que é o que faz a tela avisar', () => {
    expect(diasDesde('2026-09-17', HOJE)).toBe(1);
    expect(diasDesde('2026-09-11', HOJE)).toBe(7);
    expect(diasDesde('2026-09-18', HOJE)).toBe(0);
  });

  it('data que não é data não quebra a tela', () => {
    expect(deQuandoE('sexta que vem', HOJE)).toBe('sexta que vem');
    expect(diasDesde('sexta que vem', HOJE)).toBe(0);
  });
});

describe('a ordem das prioridades', () => {
  it('hoje antes de amanhã, amanhã antes desta semana', () => {
    const ordenadas = ordenarPrioridades([
      prioridade('esta_semana'),
      prioridade('hoje'),
      prioridade('amanha'),
    ]);
    expect(ordenadas.map((p) => p.urgencia)).toEqual(['hoje', 'amanha', 'esta_semana']);
  });

  it('não altera a lista que recebeu', () => {
    const original = [prioridade('esta_semana'), prioridade('hoje')];
    ordenarPrioridades(original);
    expect(original.map((p) => p.urgencia)).toEqual(['esta_semana', 'hoje']);
  });
});

describe('o link da prioridade', () => {
  it('abre a conversa do parceiro', () => {
    expect(linkDaPrioridade(prioridade('hoje', 'abc-123'))).toBe('/conversas?org=abc-123');
  });

  it('e some quando não há para onde ir', () => {
    expect(linkDaPrioridade(prioridade('hoje', null))).toBeNull();
  });
});
