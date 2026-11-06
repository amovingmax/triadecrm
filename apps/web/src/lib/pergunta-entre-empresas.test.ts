import { createHmac } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  assinarPergunta,
  conferirPergunta,
  lerResposta,
  VALIDADE_DA_ENTRADA_S,
  VALIDADE_DA_PERGUNTA_S,
} from './pergunta-entre-empresas';

/**
 * A pergunta "este e-mail entra aí?" entre os servidores das empresas. O que estes
 * testes travam: só quem tem o segredo pergunta; a pergunta não serve para outra
 * empresa nem depois do prazo; e quem perguntou só acredita na resposta da empresa
 * a quem perguntou.
 */

const SEGREDO = 'segredo-de-teste-entre-empresas';
const AGORA = 1_792_000_000;

function pergunta(extra: Record<string, unknown> = {}) {
  return {
    ...assinarPergunta(SEGREDO, {
      de: 'imova',
      para: 'komune',
      email: 'contato@komune.app.br',
      em: AGORA,
    }),
    ...extra,
  };
}

describe('conferirPergunta', () => {
  it('aceita a pergunta assinada com o segredo, para esta empresa, no prazo', () => {
    expect(conferirPergunta(SEGREDO, pergunta(), 'komune', AGORA)).toEqual({
      ok: true,
      pergunta: { de: 'imova', para: 'komune', email: 'contato@komune.app.br', em: AGORA },
    });
  });

  it('assina o e-mail já em minúsculas e sem espaços', () => {
    const assinada = assinarPergunta(SEGREDO, {
      de: 'imova',
      para: 'komune',
      email: '  Contato@Komune.App.BR ',
      em: AGORA,
    });
    expect(assinada.email).toBe('contato@komune.app.br');
    expect(assinada.assinatura).toBe(pergunta().assinatura);
  });

  it('recusa quem não tem o segredo', () => {
    const deFora = assinarPergunta('outro-segredo', {
      de: 'imova',
      para: 'komune',
      email: 'contato@komune.app.br',
      em: AGORA,
    });
    expect(conferirPergunta(SEGREDO, deFora, 'komune', AGORA)).toEqual({
      ok: false,
      motivo: 'assinatura',
    });
  });

  it('recusa a pergunta com o e-mail trocado depois de assinada', () => {
    expect(
      conferirPergunta(SEGREDO, pergunta({ email: 'outra.pessoa@komune.app.br' }), 'komune', AGORA),
    ).toEqual({
      ok: false,
      motivo: 'assinatura',
    });
  });

  it('recusa a pergunta feita para a outra empresa', () => {
    expect(conferirPergunta(SEGREDO, pergunta(), 'imova', AGORA)).toEqual({
      ok: false,
      motivo: 'outro_destino',
    });
  });

  it('recusa a pergunta fora do prazo, para trás e para a frente', () => {
    const fora = VALIDADE_DA_PERGUNTA_S + 1;
    expect(conferirPergunta(SEGREDO, pergunta(), 'komune', AGORA + fora)).toEqual({
      ok: false,
      motivo: 'vencida',
    });
    expect(conferirPergunta(SEGREDO, pergunta(), 'komune', AGORA - fora)).toEqual({
      ok: false,
      motivo: 'vencida',
    });
    expect(conferirPergunta(SEGREDO, pergunta(), 'komune', AGORA + VALIDADE_DA_PERGUNTA_S).ok).toBe(
      true,
    );
  });

  it('recusa o que não é pergunta', () => {
    for (const corpo of [
      null,
      'texto',
      {},
      pergunta({ de: 'outra-empresa' }),
      pergunta({ de: 'komune' }),
      pergunta({ em: '1792000000' }),
      pergunta({ assinatura: 'curta' }),
    ]) {
      expect(conferirPergunta(SEGREDO, corpo, 'komune', AGORA)).toEqual({
        ok: false,
        motivo: 'malformada',
      });
    }
  });
});

describe('lerResposta', () => {
  it('só vale "entra" vindo da empresa a quem se perguntou', () => {
    expect(lerResposta({ empresa: 'komune', entra: true }, 'komune')).toBe(true);
    expect(lerResposta({ empresa: 'komune', entra: false }, 'komune')).toBe(false);
    expect(lerResposta({ empresa: 'imova', entra: true }, 'komune')).toBe(false);
  });

  it('resposta estranha esconde o botão', () => {
    for (const corpo of [
      null,
      {},
      { ok: false },
      { empresa: 'komune', entra: 'sim' },
      { entra: true },
    ]) {
      expect(lerResposta(corpo, 'komune')).toBe(false);
    }
  });
});

describe('o pedido de entrada da troca de empresa (06/11/2026)', () => {
  const base = { de: 'komune', para: 'imova', email: 'janio@komune.app.br', em: AGORA } as const;

  it('a pergunta do seletor continua assinada como nas versões no ar', () => {
    const antiga = createHmac('sha256', SEGREDO)
      .update(
        ['triade-seletor', 'v1', 'komune', 'imova', 'janio@komune.app.br', String(AGORA)].join(
          '\n',
        ),
      )
      .digest('hex');
    expect(assinarPergunta(SEGREDO, base).assinatura).toBe(antiga);
  });

  it('aceita o pedido de entrada assinado para entrada', () => {
    const pedido = assinarPergunta(SEGREDO, base, 'entrada');
    expect(conferirPergunta(SEGREDO, pedido, 'imova', AGORA, 'entrada')).toMatchObject({
      ok: true,
    });
  });

  it('uma pergunta do seletor não vale como pedido de entrada, nem o contrário', () => {
    expect(
      conferirPergunta(SEGREDO, assinarPergunta(SEGREDO, base), 'imova', AGORA, 'entrada'),
    ).toEqual({
      ok: false,
      motivo: 'assinatura',
    });
    expect(
      conferirPergunta(SEGREDO, assinarPergunta(SEGREDO, base, 'entrada'), 'imova', AGORA),
    ).toEqual({ ok: false, motivo: 'assinatura' });
  });

  it('o pedido de entrada vence em um minuto', () => {
    const pedido = assinarPergunta(SEGREDO, base, 'entrada');
    expect(
      conferirPergunta(SEGREDO, pedido, 'imova', AGORA + VALIDADE_DA_ENTRADA_S, 'entrada'),
    ).toMatchObject({ ok: true });
    expect(
      conferirPergunta(SEGREDO, pedido, 'imova', AGORA + VALIDADE_DA_ENTRADA_S + 1, 'entrada'),
    ).toEqual({ ok: false, motivo: 'vencida' });
  });
});

describe('o aparelho levado à outra empresa (avisos no celular, 06/11/2026)', () => {
  const base = { de: 'imova', para: 'komune', email: 'janio@komune.app.br', em: AGORA } as const;
  const extra = 'registrar|ios|ExponentPushToken[abcdefghij0123456789]';

  it('o endereço de push vai dentro da assinatura: trocado no caminho, é recusado', () => {
    const pedido = assinarPergunta(SEGREDO, { ...base, extra }, 'aparelho');
    expect(conferirPergunta(SEGREDO, pedido, 'komune', AGORA, 'aparelho')).toMatchObject({
      ok: true,
    });
    expect(
      conferirPergunta(
        SEGREDO,
        { ...pedido, extra: 'registrar|ios|ExponentPushToken[outroAparelho0123456]' },
        'komune',
        AGORA,
        'aparelho',
      ),
    ).toEqual({ ok: false, motivo: 'assinatura' });
  });

  it('um pedido de entrada não serve como pedido de aparelho', () => {
    const entrada = assinarPergunta(SEGREDO, { ...base, extra }, 'entrada');
    expect(conferirPergunta(SEGREDO, entrada, 'komune', AGORA, 'aparelho')).toEqual({
      ok: false,
      motivo: 'assinatura',
    });
  });
});
