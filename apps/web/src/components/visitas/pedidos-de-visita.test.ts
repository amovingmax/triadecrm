import { describe, expect, it } from 'vitest';

import {
  type PedidoDeVisita,
  confirmacaoDaProposta,
  dentroDoPedido,
  diaEmFortaleza,
  diaUtilSeguinte,
  horaSugerida,
  horariosDoPeriodo,
  lerAguardando,
  lerPedido,
  lerResultado,
  linhaDoPedido,
  oQueSai,
  pedidosNaoVistos,
  problemaDoQuando,
  quandoEmFortaleza,
  quandoPedido,
  sugestaoParaAgendar,
  textoDaConfirmacao,
  textoDaDecisao,
  textoDaProposta,
  textoDaResposta,
} from './pedidos-de-visita';

/** O aviso do pedido de visita presencial (24 e 25/11/2026, só na Imova). */

const DO_BANCO = {
  id: 'p1',
  conversa_id: 'c1',
  cliente: 'Sílvia Rocha',
  caminho: '/conversas?org=o1',
  imovel_codigo: 'TE0004_IMOVA',
  imovel: 'o terreno em Praia de Tabatinga',
  titulo: 'Terreno em Praia de Tabatinga',
  lugar: 'Nísia Floresta/RN',
  anuncio_id: 'a1',
  data: '2026-11-26',
  periodo: 'manha',
  hora: null,
  dia_pedido: 'quinta-feira, 26/11, de manhã',
  como_disse: 'quinta de manhã',
  criado_em: '2026-11-24T13:15:00Z',
};

function pedido(mudanca: Partial<PedidoDeVisita> = {}): PedidoDeVisita {
  const base = lerPedido(DO_BANCO);
  if (base === null) throw new Error('o pedido do banco devia ler');
  return { ...base, ...mudanca };
}

/** Quarta, 25/11/2026, 10h15 em Fortaleza. */
const QUARTA = new Date('2026-11-25T13:15:00Z');

describe('o pedido como o banco devolve', () => {
  it('lê o que o aviso mostra: cliente, local, dia e horário pedidos', () => {
    expect(lerPedido(DO_BANCO)).toEqual({
      id: 'p1',
      conversaId: 'c1',
      cliente: 'Sílvia Rocha',
      caminho: '/conversas?org=o1',
      imovel: 'o terreno em Praia de Tabatinga',
      titulo: 'Terreno em Praia de Tabatinga',
      lugar: 'Nísia Floresta/RN',
      codigo: 'TE0004_IMOVA',
      data: '2026-11-26',
      periodo: 'manha',
      hora: null,
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
      hora: '9h',
      imovel: 'a casa em Ponta Negra',
    });
    expect(magro).toMatchObject({
      cliente: 'Um cliente',
      titulo: 'Casa em Ponta Negra',
      lugar: null,
      codigo: null,
      data: null,
      periodo: null,
      hora: null,
      diaPedido: 'dia a combinar',
    });
  });

  it('o dia e o horário pedidos, como o aviso mostra', () => {
    expect(quandoPedido(pedido())).toBe('Quinta-feira, 26/11 · de manhã');
    expect(quandoPedido(pedido({ data: '2026-11-28', periodo: 'manha', hora: '10:00' }))).toBe(
      'Sábado, 28/11 · 10h',
    );
    expect(quandoPedido(pedido({ periodo: null }))).toBe('Quinta-feira, 26/11');
    expect(quandoPedido(pedido({ data: null }))).toBe('Dia a combinar');
  });

  it('a notificação do sistema usa as palavras do cliente', () => {
    expect(linhaDoPedido(pedido())).toBe(
      'Sílvia Rocha quer ver o terreno em Praia de Tabatinga · quinta de manhã',
    );
  });
});

describe('os horários', () => {
  it('de meia em meia hora dentro do período; sem período, o dia comercial', () => {
    expect(horariosDoPeriodo('manha')).toEqual([
      '08:00',
      '08:30',
      '09:00',
      '09:30',
      '10:00',
      '10:30',
      '11:00',
      '11:30',
    ]);
    expect(horariosDoPeriodo('noite').at(-1)).toBe('20:30');
    expect(horariosDoPeriodo(null)[0]).toBe('08:00');
    expect(horariosDoPeriodo(null).at(-1)).toBe('17:30');
  });

  it('a hora sugerida: a pedida, a do período ou 9h', () => {
    expect(horaSugerida(pedido({ hora: '10:30' }))).toBe('10:30');
    expect(horaSugerida(pedido({ periodo: 'tarde' }))).toBe('14:00');
    expect(horaSugerida(pedido({ periodo: null }))).toBe('09:00');
  });

  it('Agendar abre no dia útil seguinte ao pedido, na hora pedida', () => {
    expect(sugestaoParaAgendar(pedido(), QUARTA)).toEqual({ dia: '2026-11-27', hora: '09:00' });
    // Sexta → segunda.
    expect(sugestaoParaAgendar(pedido({ data: '2026-11-27' }), QUARTA).dia).toBe('2026-11-30');
    // Sem dia (ou dia que passou): o dia útil seguinte a hoje.
    expect(sugestaoParaAgendar(pedido({ data: null }), QUARTA).dia).toBe('2026-11-26');
    expect(sugestaoParaAgendar(pedido({ data: '2026-11-20' }), QUARTA).dia).toBe('2026-11-26');
    expect(diaUtilSeguinte('2026-11-28')).toBe('2026-11-30');
  });

  it('o dia de hoje em Fortaleza e o instante que vai ao banco', () => {
    expect(diaEmFortaleza(QUARTA)).toBe('2026-11-25');
    // 23h30 em Fortaleza ainda é o mesmo dia (02h30 UTC do dia seguinte).
    expect(diaEmFortaleza(new Date('2026-11-26T02:30:00Z'))).toBe('2026-11-25');
    expect(quandoEmFortaleza('2026-11-26', '09:00')).toBe('2026-11-26T09:00:00-03:00');
    expect(quandoEmFortaleza('', '09:00')).toBeNull();
    expect(quandoEmFortaleza('2026-11-26', '9h')).toBeNull();
  });

  it('o que não serve: vazio, no passado, sábado ou domingo', () => {
    expect(problemaDoQuando('2026-11-26', '09:00', QUARTA)).toBeNull();
    expect(problemaDoQuando('', '09:00', QUARTA)).toBe('Escolha o dia e o horário.');
    expect(problemaDoQuando('2026-11-25', '08:00', QUARTA)).toMatch(/ainda não passaram/);
    expect(problemaDoQuando('2026-11-28', '10:00', QUARTA)).toMatch(/sábado nem domingo/);
  });
});

describe('a mensagem que o cliente vai receber (igual à do banco)', () => {
  it('a confirmação, com "ao" ou "à" conforme o imóvel', () => {
    expect(textoDaConfirmacao('o terreno em Praia de Tabatinga', '2026-11-26', '09:00')).toBe(
      'Combinado! Sua visita ao terreno em Praia de Tabatinga ficou para quinta-feira, 26/11, às 9h. Qualquer coisa, é só me chamar por aqui.',
    );
    expect(textoDaConfirmacao('a casa em Ponta Negra', '2026-11-27', '10:30')).toMatch(
      /^Combinado! Sua visita à casa em Ponta Negra ficou para sexta-feira, 27\/11, às 10h30\./,
    );
    expect(textoDaConfirmacao('TE0004', '2026-11-27', '10:00')).toMatch(/Sua visita ao imóvel/);
  });

  it('a proposta: "Nesse dia", "Nesse horário" ou só a pergunta quando ele não disse o dia', () => {
    expect(textoDaProposta(pedido(), '2026-11-27', '09:00')).toBe(
      'Nesse dia não vamos conseguir. Pode ser sexta-feira, 27/11, às 9h?',
    );
    expect(textoDaProposta(pedido(), '2026-11-26', '14:00')).toBe(
      'Nesse horário não vamos conseguir. Pode ser quinta-feira, 26/11, às 14h?',
    );
    expect(textoDaProposta(pedido({ data: null }), '2026-11-27', '09:00')).toBe(
      'Pode ser sexta-feira, 27/11, às 9h?',
    );
  });

  it('Agendar dentro do que o cliente pediu confirma; fora, propõe', () => {
    expect(dentroDoPedido(pedido(), '2026-11-26', '10:30')).toBe(true);
    expect(dentroDoPedido(pedido(), '2026-11-26', '14:00')).toBe(false);
    expect(dentroDoPedido(pedido({ hora: '10:00' }), '2026-11-26', '10:00')).toBe(true);
    expect(dentroDoPedido(pedido({ hora: '10:00' }), '2026-11-26', '10:30')).toBe(false);
    expect(dentroDoPedido(pedido({ periodo: null }), '2026-11-26', '16:00')).toBe(true);
    expect(dentroDoPedido(pedido({ data: null }), '2026-11-26', '10:00')).toBe(false);
    expect(oQueSai(pedido(), '2026-11-26', '11:00').decisao).toBe('aprovada');
    expect(oQueSai(pedido(), '2026-11-27', '11:00')).toEqual({
      decisao: 'outro_dia',
      texto: 'Nesse dia não vamos conseguir. Pode ser sexta-feira, 27/11, às 11h?',
    });
  });
});

describe('o que o aviso diz depois da decisão', () => {
  const ok = lerResultado({ ok: true, mensagem_saiu: true, na_agenda: true });

  it('aceita: confirmação e Agenda; sem ficha, lembra de marcar; sem mensagem, avisa', () => {
    expect(textoDaDecisao('aprovada', ok)).toEqual({
      titulo: 'Visita aceita',
      descricao: 'O cliente recebeu a confirmação e a visita está na sua Agenda.',
      tom: 'sucesso',
    });
    expect(textoDaDecisao('aprovada', { ...ok, naAgenda: false }).tom).toBe('aviso');
    expect(textoDaDecisao('aprovada', { ...ok, mensagemSaiu: false }).descricao).toMatch(
      /A mensagem não saiu/,
    );
  });

  it('outro horário: a proposta e a reserva; não é possível: nada sai', () => {
    expect(textoDaDecisao('outro_dia', ok)).toMatchObject({
      titulo: 'Novo horário enviado',
      descricao: expect.stringMatching(/reservado na sua Agenda/),
    });
    expect(textoDaDecisao('recusada', lerResultado({ ok: true })).descricao).toMatch(
      /Nada foi enviado/,
    );
  });

  it('a Agenda recusou: diz por quê', () => {
    const ocupado = lerResultado({
      ok: false,
      motivo: 'agenda_recusou',
      agenda: {
        ok: false,
        motivo: 'horario_ocupado',
        conflitos: [{ titulo: 'Visita: Lia Campos' }],
      },
    });
    expect(ocupado.conflitos).toEqual(['Visita: Lia Campos']);
    expect(textoDaDecisao('aprovada', ocupado)).toEqual({
      titulo: 'Esse horário já está ocupado na sua Agenda',
      descricao: 'Já tem: Visita: Lia Campos. Escolha outro horário.',
      tom: 'erro',
    });
    expect(
      textoDaDecisao(
        'aprovada',
        lerResultado({ ok: false, motivo: 'agenda_recusou', agenda: { motivo: 'dia_nao_util' } }),
      ).descricao,
    ).toMatch(/Sábado, domingo e feriado/);
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
  });
});

describe('a proposta esperando o cliente', () => {
  const doBanco = {
    id: 'p9',
    conversa_id: 'c9',
    cliente: 'Lia Campos',
    caminho: '/conversas?org=o9',
    imovel: 'a casa em Ponta Negra',
    marcada_para: '2026-11-27T14:30:00+00:00',
    quando: 'sexta-feira, 27/11, às 11h30',
    proposto_por: 'Rafael Abreu',
    na_agenda: true,
  };

  it('lê a proposta e monta a confirmação que sai quando o cliente aceita', () => {
    const a = lerAguardando(doBanco);
    expect(a).toMatchObject({ cliente: 'Lia Campos', propostoPor: 'Rafael Abreu', naAgenda: true });
    if (a === null) throw new Error('devia ler');
    expect(confirmacaoDaProposta(a)).toBe(
      'Combinado! Sua visita à casa em Ponta Negra ficou para sexta-feira, 27/11, às 11h30. Qualquer coisa, é só me chamar por aqui.',
    );
    expect(lerAguardando({ ...doBanco, id: null })).toBeNull();
  });

  it('o que o aviso diz depois de marcar a resposta', () => {
    expect(textoDaResposta(true, lerResultado({ ok: true, mensagem_saiu: true }))).toMatchObject({
      titulo: 'Visita confirmada',
      tom: 'sucesso',
    });
    expect(textoDaResposta(false, lerResultado({ ok: true })).titulo).toBe(
      'Reserva tirada da Agenda',
    );
    expect(
      textoDaResposta(true, lerResultado({ ok: false, motivo: 'ja_respondido', por: 'Janio' }))
        .descricao,
    ).toBe('Quem marcou foi Janio.');
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
