import { describe, expect, it } from 'vitest';

import { validarSala } from './sala';

/**
 * O crivo da sala é o do banco (`profiles_sala_url_chk`): `https://` e nenhum
 * espaço. O que passa aqui e o banco recusa vira "não deu para salvar" sem
 * explicação, então os dois têm de concordar.
 */
const CRIVO_DO_BANCO = /^https:\/\/[^\s]+$/i;

describe('validarSala', () => {
  it('aceita o link completo e tira o espaço das pontas', () => {
    expect(validarSala('  https://meet.google.com/abc-defg-hij \n')).toEqual({
      ok: true,
      url: 'https://meet.google.com/abc-defg-hij',
    });
  });

  it('põe o https:// em quem colou sem', () => {
    expect(validarSala('meet.jit.si/komune-janio')).toEqual({
      ok: true,
      url: 'https://meet.jit.si/komune-janio',
    });
  });

  it('recusa vazio, espaço no meio, http e link incompleto', () => {
    for (const ruim of [
      '',
      '   ',
      'https://meet.google.com/abc def',
      'http://sala.com/x',
      'minhasala',
    ]) {
      expect(validarSala(ruim).ok, ruim).toBe(false);
    }
  });

  it('tudo o que aceita passa no crivo do banco', () => {
    for (const bom of [
      'https://zoom.us/j/123?pwd=abc',
      'whereby.com/janio',
      'HTTPS://Meet.Google.com/x',
    ]) {
      const r = validarSala(bom);
      expect(r.ok, bom).toBe(true);
      if (r.ok) expect(r.url).toMatch(CRIVO_DO_BANCO);
    }
  });
});
