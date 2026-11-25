import { describe, expect, it } from 'vitest';

import {
  type PedidoDeVisita,
  diaEmFortaleza,
  lerPedido,
  lerResultado,
  linhaDoPedido,
  pedidosNaoVistos,
  quandoEmFortaleza,
  sugestaoParaDecidir,
  textoDaDecisao,
} from './pedidos-de-visita';

/** O pedido de visita presencial que a IA combinou (24/11/2026, só na Imova). */

const DO_BANCO = {
  id: 'p1',
  conversa_id: 'c1',
  cliente: 'Sílvia Rocha',
  caminho: '/conversas?org=o1',
  imovel_codigo: 'TE0004_IMOVA',
  imovel: 'o terreno em Tabatinga',
  anuncio_id: 'a1',
  data: '2026-11-26',
  periodo: 'manha',
  dia_pedido: 'quinta-feira, 26/11, de manhã',
  como_disse: 'quinta de manhã',
  criado_em: '2026-11-24T13:15:00Z',
};

function pedido(mudanca: Partial<PedidoDeVisita> = {}): PedidoDeVisita {
  const base = lerPedido(DO_BANCO);
  if (base === null) throw new Error('o pedido do banco devia ler');
  return { ...base, ...mudanca };
}

/** Terça, 24/11/2026, 10h15 em Fortaleza. */
const TERCA = new Date('2026-11-24T13:15:00Z');

describe('o pedido como o banco devolve', () => {
  it('lê o que o cartão mostra', () => {
    expect(lerPedido(DO_BANCO)).toEqual({
      id: 'p1',
      conversaId: 'c1',
      cliente: 'Sílvia Rocha',
      caminho: '/conversas?org=o1',
      imovel: 'o terreno em Tabatinga',
      data: '2026-11-26',
      periodo: 'manha',
      diaPedido: 'quinta-feira, 26/11, de manhã',
      comoDisse: 'quinta de manhã',
      criadoEm: '2026-11-24T13:15:00Z',
    });
  });

  it('sem id, conversa ou data de criação, não lê; o resto tem padrão', () => {
    expect(lerPedido({ ...DO_BANCO, id: null })).toBeNull();
    expect(lerPedido(null)).toBeNull();
    const magro = lerPedido({
      id: 'p2',
      conversa_id: 'c2',
      criado_em: '2026-11-24T13:00:00Z',
      periodo: 'madrugada',
    });
    expect(magro).toMatchObject({
      cliente: 'Um cliente',
      imovel: 'o imóvel',
      data: null,
      periodo: null,
      diaPedido: 'dia a combinar',
    });
  });

  it('a linha do cartão usa as palavras do cliente', () => {
    expect(linhaDoPedido(pedido())).toBe(
      'Sílvia Rocha quer ver o terreno em Tabatinga · quinta de manhã',
    );
    expect(linhaDoPedido(pedido({ comoDisse: null }))).toBe(
      'Sílvia Rocha quer ver o terreno em Tabatinga · quinta-feira, 26/11, de manhã',
    );
  });
});

describe('o dia e a hora do formulário', () => {
  it('o dia de hoje e de amanhã em Fortaleza', () => {
    expect(diaEmFortaleza(TERCA)).toBe('2026-11-24');
    expect(diaEmFortaleza(TERCA, 1)).toBe('2026-11-25');
    // 23h30 em Fortaleza ainda é o mesmo dia (02h30 UTC do dia seguinte).
    expect(diaEmFortaleza(new Date('2026-11-25T02:30:00Z'))).toBe('2026-11-24');
  });

  it('aprovar traz o dia pedido e a hora do período', () => {
    expect(sugestaoParaDecidir(pedido(), 'aprovada', TERCA)).toEqual({
      dia: '2026-11-26',
      hora: '09:00',
    });
    expect(sugestaoParaDecidir(pedido({ periodo: 'tarde' }), 'aprovada', TERCA)).toEqual({
      dia: '2026-11-26',
      hora: '14:00',
    });
  });

  it('sem dia (ou dia que passou), amanhã; outro dia é o dia seguinte ao pedido', () => {
    expect(sugestaoParaDecidir(pedido({ data: null, periodo: null }), 'aprovada', TERCA)).toEqual({
      dia: '2026-11-25',
      hora: '09:00',
    });
    expect(sugestaoParaDecidir(pedido({ data: '2026-11-20' }), 'aprovada', TERCA).dia).toBe(
      '2026-11-25',
    );
    expect(sugestaoParaDecidir(pedido(), 'outro_dia', TERCA)).toEqual({
      dia: '2026-11-27',
      hora: '09:00',
    });
    expect(sugestaoParaDecidir(pedido({ data: '2026-11-30' }), 'outro_dia', TERCA).dia).toBe(
      '2026-12-01',
    );
  });

  it('o instante que vai ao banco é de Fortaleza', () => {
    expect(quandoEmFortaleza('2026-11-26', '09:00')).toBe('2026-11-26T09:00:00-03:00');
    expect(quandoEmFortaleza('', '09:00')).toBeNull();
    expect(quandoEmFortaleza('2026-11-26', '9h')).toBeNull();
  });
});

describe('o que o cartão diz depois da decisão', () => {
  const ok = lerResultado({ ok: true, mensagem_saiu: true, na_agenda: true });

  it('aprovada: confirmação e Agenda; sem ficha, lembra de marcar; sem mensagem, avisa', () => {
    expect(textoDaDecisao('aprovada', ok)).toEqual({
      titulo: 'Visita aprovada',
      descricao: 'O cliente recebeu a confirmação e a visita está na Agenda.',
      tom: 'sucesso',
    });
    expect(textoDaDecisao('aprovada', { ...ok, naAgenda: false }).tom).toBe('aviso');
    expect(textoDaDecisao('aprovada', { ...ok, mensagemSaiu: false }).descricao).toMatch(
      /A mensagem não saiu/,
    );
  });

  it('outro dia e recusar', () => {
    expect(textoDaDecisao('outro_dia', ok).titulo).toBe('Outro dia proposto');
    expect(textoDaDecisao('recusada', lerResultado({ ok: true })).descricao).toMatch(
      /Nada foi enviado/,
    );
  });

  it('o primeiro admin vale: quem chega depois sabe quem decidiu', () => {
    expect(
      textoDaDecisao(
        'aprovada',
        lerResultado({ ok: false, motivo: 'ja_decidido', por: 'Ana Admin' }),
      ),
    ).toEqual({
      titulo: 'Esse pedido já foi decidido',
      descricao: 'Quem decidiu foi Ana Admin.',
      tom: 'aviso',
    });
    expect(
      textoDaDecisao('aprovada', lerResultado({ ok: false, motivo: 'quando_invalido' })).descricao,
    ).toMatch(/ainda não passaram/);
  });
});

describe('o toque só para o que ainda não foi visto', () => {
  it('separa os novos', () => {
    const a = pedido();
    const b = pedido({ id: 'p2' });
    expect(pedidosNaoVistos([a, b], new Set(['p1'])).map((p) => p.id)).toEqual(['p2']);
    expect(pedidosNaoVistos([a], new Set(['p1']))).toEqual([]);
  });
});
