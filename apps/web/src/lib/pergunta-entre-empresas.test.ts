import { describe, expect, it } from 'vitest';

import {
  assinarPergunta,
  conferirPergunta,
  lerResposta,
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
    ...assinarPergunta(SEGREDO, { de: 'imova', para: 'komune', email: 'contato@komune.app.br', em: AGORA }),
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
    const assinada = assinarPergunta(SEGREDO, { de: 'imova', para: 'komune', email: '  Contato@Komune.App.BR ', em: AGORA });
    expect(assinada.email).toBe('contato@komune.app.br');
    expect(assinada.assinatura).toBe(pergunta().assinatura);
  });

  it('recusa quem não tem o segredo', () => {
    const deFora = assinarPergunta('outro-segredo', { de: 'imova', para: 'komune', email: 'contato@komune.app.br', em: AGORA });
    expect(conferirPergunta(SEGREDO, deFora, 'komune', AGORA)).toEqual({ ok: false, motivo: 'assinatura' });
  });

  it('recusa a pergunta com o e-mail trocado depois de assinada', () => {
    expect(conferirPergunta(SEGREDO, pergunta({ email: 'outra.pessoa@komune.app.br' }), 'komune', AGORA)).toEqual({
      ok: false,
      motivo: 'assinatura',
    });
  });

  it('recusa a pergunta feita para a outra empresa', () => {
    expect(conferirPergunta(SEGREDO, pergunta(), 'imova', AGORA)).toEqual({ ok: false, motivo: 'outro_destino' });
  });

  it('recusa a pergunta fora do prazo, para trás e para a frente', () => {
    const fora = VALIDADE_DA_PERGUNTA_S + 1;
    expect(conferirPergunta(SEGREDO, pergunta(), 'komune', AGORA + fora)).toEqual({ ok: false, motivo: 'vencida' });
    expect(conferirPergunta(SEGREDO, pergunta(), 'komune', AGORA - fora)).toEqual({ ok: false, motivo: 'vencida' });
    expect(conferirPergunta(SEGREDO, pergunta(), 'komune', AGORA + VALIDADE_DA_PERGUNTA_S).ok).toBe(true);
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
      expect(conferirPergunta(SEGREDO, corpo, 'komune', AGORA)).toEqual({ ok: false, motivo: 'malformada' });
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
    for (const corpo of [null, {}, { ok: false }, { empresa: 'komune', entra: 'sim' }, { entra: true }]) {
      expect(lerResposta(corpo, 'komune')).toBe(false);
    }
  });
});
