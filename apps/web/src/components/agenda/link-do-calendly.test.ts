import { describe, expect, it } from 'vitest';

import {
  erroAoGravarOLink,
  lerConfiguracaoDoLink,
  PERGUNTAS_DO_CALENDLY,
  validarLinkDoCalendly,
} from './link-do-calendly-regra';

/** O campo "Link do Calendly" do admin (11/11/2026, só na Imova). */

describe('o link do Calendly', () => {
  it('aceita o link do evento, com ou sem https, e tira o que vem depois do ?', () => {
    const esperado = 'https://calendly.com/contato-imovaimobiliaria/30min';
    expect(validarLinkDoCalendly(esperado)).toEqual({ ok: true, link: esperado });
    expect(validarLinkDoCalendly(' calendly.com/contato-imovaimobiliaria/30min/ ')).toEqual({
      ok: true,
      link: esperado,
    });
    expect(validarLinkDoCalendly(`${esperado}?month=2026-11#topo`)).toEqual({
      ok: true,
      link: esperado,
    });
  });

  it('recusa o que não é do Calendly, sem https ou sem o evento', () => {
    for (const entrada of [
      '',
      'http://calendly.com/contato-imovaimobiliaria/30min',
      'https://calendly.com.golpe.io/x',
      'https://www.google.com/agenda',
      'https://calendly.com/',
      'isso não é link',
    ]) {
      expect(validarLinkDoCalendly(entrada).ok).toBe(false);
    }
  });

  it('lê a configuração sem apagar o resto, e linha ausente é nada cadastrado', () => {
    expect(
      lerConfiguracaoDoLink({
        link: 'https://calendly.com/contato-imovaimobiliaria/30min',
        dono_email: 'x@y.z',
        link_visita: null,
      }),
    ).toEqual({
      link: 'https://calendly.com/contato-imovaimobiliaria/30min',
      linkVisita: null,
      linkReuniao: null,
    });
    expect(lerConfiguracaoDoLink(null)).toEqual({
      link: null,
      linkVisita: null,
      linkReuniao: null,
    });
  });

  it('as perguntas aparecem na ordem do preenchimento', () => {
    expect(PERGUNTAS_DO_CALENDLY).toEqual([
      'O que você quer marcar? (Visita a um imóvel / Reunião)',
      'Telefone (WhatsApp)',
      'Endereço ou código do imóvel',
    ]);
  });

  it('a recusa do banco vira frase', () => {
    expect(erroAoGravarOLink('42501')).toBe('Só um admin muda o link do Calendly.');
    expect(erroAoGravarOLink(undefined, 'link_invalido')).toMatch(/https:\/\/calendly\.com/);
    expect(erroAoGravarOLink(undefined)).toMatch(/Não deu para gravar/);
  });
});
