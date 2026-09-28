import { describe, expect, it } from 'vitest';

import { itemDaLinha, type LinhaDaFila } from './consultas';

/**
 * A fronteira entre `public.meu_dia` e a tela.
 *
 * O que se mede aqui é o MAPEAMENTO, e não o tipo: um teste que monta um objeto
 * literal e lê de volta o próprio campo não mede nada — ele passaria com o
 * `map` vazio. O que pode quebrar de verdade é uma coluna nova não chegar do
 * outro lado, e é isso que as três asserções abaixo cercam.
 *
 * `atendente` chegou em 28/09/2026 (ADR-17): a fila de quem respondeu deixou de
 * ser filtrada por dono, então a linha passou a precisar dizer a quem ela está
 * endereçada.
 */

function linha(parcial: Partial<LinhaDaFila> = {}): LinhaDaFila {
  return {
    prioridade: 0,
    tipo: 'conversa_esperando',
    motivo: 'Respondeu e ninguém falou com ele desde então',
    titulo: 'Responder no WhatsApp',
    quando: '2026-09-28T12:00:00-03:00',
    atraso_horas: 2.5,
    task_id: null,
    activity_id: null,
    deal_id: null,
    organization_id: null,
    organizacao: null,
    bairro: null,
    categoria: null,
    temperatura: null,
    funil: null,
    etapa: null,
    ...parcial,
  };
}

describe('itemDaLinha', () => {
  it('leva o nome de quem a conversa aponta até a tela', () => {
    expect(itemDaLinha(linha({ atendente: 'Ana' })).atendente).toBe('Ana');
  });

  it('deixa nulo quando a conversa já é minha — o banco cala de propósito', () => {
    // "Endereçada a mim" em toda linha da minha própria fila é um rótulo que a
    // pessoa aprende a não ler, então `public.meu_dia` devolve NULL nesse caso.
    expect(itemDaLinha(linha({ atendente: null })).atendente).toBeNull();
  });

  it('não quebra quando a coluna nem vem: a aba aberta antes do deploy chama a RPC antiga', () => {
    // Este é o caso que o teste existe para pegar. Sem o `?? null`, a tela
    // recebia `undefined` e a linha de contexto renderizava vazia em vez de
    // simplesmente não renderizar.
    const { atendente, ...semColuna } = linha({ atendente: 'Ana' });
    expect(atendente).toBe('Ana');
    expect(itemDaLinha(semColuna as LinhaDaFila).atendente).toBeNull();
  });
});
