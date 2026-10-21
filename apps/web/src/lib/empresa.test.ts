import { describe, expect, it } from 'vitest';

import { EMPRESA, lerLinksDasEmpresas } from './empresa';

describe('empresa do site', () => {
  it('sem NEXT_PUBLIC_EMPRESA, o site é a KOMUNE (o que está no ar não precisa de variável nova)', () => {
    expect(EMPRESA.slug).toBe('komune');
  });

  it('o seletor só aparece com duas empresas conhecidas, e a atual entre elas', () => {
    const links = 'komune=https://ir.komune.app.br;imova=https://triade-imova.vercel.app/';
    expect(lerLinksDasEmpresas(links, 'komune')).toEqual([
      { slug: 'komune', nome: 'Komune', url: 'https://ir.komune.app.br', atual: true },
      { slug: 'imova', nome: 'Imova Imobiliária', url: 'https://triade-imova.vercel.app', atual: false },
    ]);
    expect(lerLinksDasEmpresas(undefined, 'komune')).toEqual([]);
    expect(lerLinksDasEmpresas('komune=https://ir.komune.app.br', 'komune')).toEqual([]);
    expect(lerLinksDasEmpresas('imova=https://a.app;outra=https://b.app', 'imova')).toEqual([]);
  });

  it('ignora empresa desconhecida, endereço sem http e repetição', () => {
    const links = 'komune=https://a.app;imova=ftp://b.app;imova=https://c.app;xpto=https://d.app;imova=https://e.app';
    expect(lerLinksDasEmpresas(links, 'imova').map((d) => d.url)).toEqual(['https://a.app', 'https://c.app']);
  });
});
