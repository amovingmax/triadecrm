import { describe, expect, it } from 'vitest';

import {
  aindaTocando,
  botaoDaConversa,
  chamadaViva,
  dataCurta,
  fraseDaFaixa,
  fraseDoMotivo,
  juntarAsPerdidas,
  perdidasPrimeiro,
  quandoLigou,
  textoDaFaixa,
  textoDoSelo,
  textoPadraoDoPedido,
  type EstadoNaConversa,
  type Perdidas,
} from './logica';

function estado(extra: Partial<Extract<EstadoNaConversa, { ligada: true }>> = {}): EstadoNaConversa {
  return {
    ligada: true,
    permissao: 'sem_permissao',
    permanente: false,
    expira_em: null,
    nao_atendidas_seguidas: 0,
    proximo_pedido_em: null,
    janela_aberta: true,
    suprimida: false,
    horario: { aberta: true },
    ligacao_viva: null,
    ultima: null,
    ...extra,
  };
}

describe('o botão da conversa', () => {
  it('desligada, ou com quem pediu para sair: não aparece', () => {
    expect(botaoDaConversa({ ligada: false }, false).tipo).toBe('nenhum');
    expect(botaoDaConversa(estado({ suprimida: true }), false).tipo).toBe('nenhum');
    expect(botaoDaConversa(estado({ suprimida: true, permissao: 'aceita' }), false).tipo).toBe('nenhum');
  });

  it('sem permissão, pede; com a permissão, liga', () => {
    expect(botaoDaConversa(estado(), false)).toEqual({ tipo: 'pedir', desligado: false, nota: null });
    expect(botaoDaConversa(estado({ permissao: 'aceita' }), false)).toEqual({
      tipo: 'ligar',
      desligado: false,
      nota: null,
    });
  });

  it('vencida ou recusada volta a pedir, dentro dos limites da Meta', () => {
    expect(botaoDaConversa(estado({ permissao: 'venceu' }), false).tipo).toBe('pedir');
    expect(botaoDaConversa(estado({ permissao: 'recusada' }), false).tipo).toBe('pedir');
    const limite = botaoDaConversa(
      estado({ permissao: 'recusada', proximo_pedido_em: '2026-11-06T13:21:00Z' }),
      false,
    );
    expect(limite).toMatchObject({ tipo: 'pedir', desligado: true });
    expect(limite.tipo === 'pedir' && limite.nota).toContain('06/11');
  });

  it('fora das 24 h não se pede', () => {
    expect(botaoDaConversa(estado({ janela_aberta: false }), false)).toMatchObject({
      tipo: 'pedir',
      desligado: true,
    });
  });

  it('não liga fora do horário, nem durante outra ligação', () => {
    const aceita = { permissao: 'aceita' as const };
    expect(botaoDaConversa(estado({ ...aceita, horario: { aberta: false } }), false)).toMatchObject({
      tipo: 'ligar',
      desligado: true,
    });
    expect(botaoDaConversa(estado(aceita), true)).toMatchObject({ tipo: 'ligar', desligado: true });
    expect(botaoDaConversa(estado({ ...aceita, ligacao_viva: 'x' }), false)).toMatchObject({
      tipo: 'ligar',
      desligado: true,
    });
  });
});

describe('a faixa da conversa', () => {
  it('diz até quando vale, no fuso de Fortaleza', () => {
    expect(fraseDaFaixa(estado({ permissao: 'aceita', expira_em: '2026-11-06T13:21:00Z' }))).toBe(
      'O cliente permitiu ligações pelo WhatsApp até 06/11 10:21.',
    );
    expect(dataCurta('2026-11-06T13:21:00Z')).toBe('06/11 10:21');
  });

  it('a permanente não tem prazo', () => {
    expect(fraseDaFaixa(estado({ permissao: 'aceita', permanente: true }))).toContain('sem prazo');
  });

  it('avisa a partir da segunda sem resposta, antes de a Meta tirar', () => {
    const f = fraseDaFaixa(estado({ permissao: 'aceita', nao_atendidas_seguidas: 2 }));
    expect(f).toContain('2 ligações seguidas');
    expect(f).toContain('Com 4');
  });

  it('conta a ligação perdida, e não fala nada sem motivo', () => {
    expect(
      fraseDaFaixa(
        estado({
          ultima: {
            direcao: 'recebida',
            estado: 'perdida',
            tocou_em: '2026-10-30T13:21:00Z',
            duracao_seg: null,
            por: null,
          },
        }),
      ),
    ).toContain('ninguém atendeu');
    expect(fraseDaFaixa(estado())).toBeNull();
    expect(fraseDaFaixa({ ligada: false })).toBeNull();
    expect(
      fraseDaFaixa(
        estado({
          ultima: {
            direcao: 'recebida',
            estado: 'perdida',
            tocou_em: '2026-10-30T13:21:00Z',
            duracao_seg: null,
            por: null,
          },
          suprimida: true,
        }),
      ),
    ).toBeNull();
    expect(fraseDaFaixa(estado({ suprimida: true, permissao: 'aceita' }))).toBeNull();
  });
});

describe('a ligação perdida (03/11/2026)', () => {
  const perdida = {
    direcao: 'recebida' as const,
    estado: 'perdida' as const,
    tocou_em: '2026-11-03T13:21:00Z',
    duracao_seg: null,
    por: null,
  };

  it('a faixa conta a perdida antes da permissão, e diz que dá para ligar de volta', () => {
    expect(fraseDaFaixa(estado({ ultima: perdida, permissao: 'aceita', permanente: true }))).toBe(
      'O cliente ligou em 03/11 10:21 e ninguém atendeu. Ele permite ligações: dá para ligar de volta.',
    );
    expect(fraseDaFaixa(estado({ ultima: perdida }))).toBe(
      'O cliente ligou em 03/11 10:21 e ninguém atendeu.',
    );
  });

  it('na conversa de quem só ligou, a perdida vem antes da nota do botão desligado', () => {
    // Quem nunca escreveu não tem a janela de 24 h: o botão de pedir fica desligado.
    const soLigou = estado({ ultima: perdida, janela_aberta: false });
    expect(textoDaFaixa(soLigou, false)).toEqual({
      texto: 'O cliente ligou em 03/11 10:21 e ninguém atendeu.',
      perdida: true,
    });
    expect(textoDaFaixa(estado({ janela_aberta: false }), false)).toEqual({
      texto: 'Só dá para pedir dentro das 24 h depois da última mensagem do cliente.',
      perdida: false,
    });
    expect(textoDaFaixa(estado(), false)).toBeNull();
  });

  it('a ligação feita pelo time sem resposta não é perdida do cliente', () => {
    const f = fraseDaFaixa(estado({ ultima: { ...perdida, direcao: 'feita' }, permissao: 'aceita' }));
    expect(f).not.toContain('ninguém atendeu');
  });

  it('o selo diz a hora se foi hoje e o dia se foi antes, no fuso de Fortaleza', () => {
    const agora = new Date('2026-11-03T20:00:00Z');
    expect(quandoLigou('2026-11-03T13:21:00Z', agora)).toBe('10:21');
    expect(quandoLigou('2026-11-02T13:21:00Z', agora)).toBe('02/11');
    // 02h30 de 04/11 em UTC ainda é 23h30 de 03/11 em Natal.
    expect(quandoLigou('2026-11-04T02:30:00Z', agora)).toBe('23:30');
    expect(textoDoSelo({ ultimaEm: '2026-11-03T13:21:00Z', quantas: 1 }, agora)).toBe(
      'Ligação perdida · 10:21',
    );
    expect(textoDoSelo({ ultimaEm: '2026-11-03T13:21:00Z', quantas: 3 }, agora)).toBe(
      '3 ligações perdidas · 10:21',
    );
  });

  it('as perdidas sobem, a mais recente primeiro, e o resto fica como estava', () => {
    const perdidas: Perdidas = new Map([
      ['c', { ultimaEm: '2026-11-03T12:00:00Z', quantas: 1 }],
      ['e', { ultimaEm: '2026-11-03T13:00:00Z', quantas: 2 }],
    ]);
    const linhas = ['a', 'b', 'c', 'd', 'e', null];
    expect(perdidasPrimeiro(linhas, (l) => l, perdidas)).toEqual(['e', 'c', 'a', 'b', 'd', null]);
    expect(perdidasPrimeiro(linhas, (l) => l, new Map())).toEqual(linhas);
  });

  it('a perdida entra em "Minhas" mesmo sem dono, sem repetir quem já estava', () => {
    const perdidas: Perdidas = new Map([
      ['sem-dono', { ultimaEm: '2026-11-03T12:00:00Z', quantas: 1 }],
      ['minha', { ultimaEm: '2026-11-03T12:00:00Z', quantas: 1 }],
    ]);
    const minhas = ['minha', 'outra-minha'];
    const todas = ['minha', 'outra-minha', 'sem-dono', 'de-outra-pessoa'];
    const id = (l: string) => l;
    expect(juntarAsPerdidas(minhas, todas, id, id, perdidas)).toEqual(['minha', 'outra-minha', 'sem-dono']);
    expect(juntarAsPerdidas(minhas, todas, id, id, new Map())).toEqual(minhas);
  });
});

describe('as regras pequenas', () => {
  it('o toque para de valer depois do prazo da Meta', () => {
    const agora = new Date('2026-10-30T13:00:00Z');
    expect(aindaTocando('2026-10-30T12:59:30Z', agora)).toBe(true);
    expect(aindaTocando('2026-10-30T12:58:00Z', agora)).toBe(false);
  });

  it('só os estados de antes do fim são vivos', () => {
    expect(chamadaViva('em_curso')).toBe(true);
    expect(chamadaViva('encerrada')).toBe(false);
    expect(chamadaViva('perdida')).toBe(false);
  });

  it('motivo desconhecido não fica sem frase', () => {
    expect(fraseDoMotivo('ja_atendida')).toContain('Outra pessoa');
    expect(fraseDoMotivo('nunca_visto').length).toBeGreaterThan(0);
    expect(fraseDoMotivo(undefined).length).toBeGreaterThan(0);
  });

  it('o texto do pedido não cita o nome de nenhuma opção do WhatsApp', () => {
    const t = textoPadraoDoPedido('Imova Imobiliária');
    expect(t).toContain('Imova Imobiliária');
    expect(t.toLowerCase()).not.toContain('sempre permitir');
    expect(t.length).toBeLessThanOrEqual(1024);
  });
});
