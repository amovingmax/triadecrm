import { describe, expect, it } from 'vitest';

import {
  aindaTocando,
  botaoDaConversa,
  chamadaViva,
  dataCurta,
  fraseDaFaixa,
  fraseDoMotivo,
  textoPadraoDoPedido,
  type EstadoNaConversa,
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
    expect(fraseDaFaixa(estado({ suprimida: true, permissao: 'aceita' }))).toBeNull();
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
