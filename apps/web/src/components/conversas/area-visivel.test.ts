import { describe, expect, it } from 'vitest';

import { medirAreaVisivel } from './area-visivel';

// O iPhone do usuário, no Safari (iOS 26), medido pelo diário do teclado em
// 04/11/2026: 699 px de área visível sem teclado e 362 com ele.
const IPHONE = { semTeclado: 699 };

describe('medirAreaVisivel', () => {
  it('teclado fechado: a camada é a tela inteira, com a folga da barrinha', () => {
    expect(
      medirAreaVisivel({ ...IPHONE, topoVisivel: 0, rolagem: 0, alturaVisivel: 699 }),
    ).toEqual({ topo: 0, altura: 699, teclado: false });
  });

  it('teclado aberto e a página de volta ao topo: a camada é a área visível, no topo', () => {
    expect(
      medirAreaVisivel({ ...IPHONE, topoVisivel: 0, rolagem: 0, alturaVisivel: 362 }),
    ).toEqual({ topo: 0, altura: 362, teclado: true });
  });

  it('o Safari insistiu em rolar 337: a camada acompanha o empurrão', () => {
    expect(
      medirAreaVisivel({ ...IPHONE, topoVisivel: 337, rolagem: 337, alturaVisivel: 362 }),
    ).toEqual({ topo: 337, altura: 362, teclado: true });
  });

  it('logo depois de a página voltar ao topo, o empurrão velho não leva a camada para baixo', () => {
    // A página já está em 0, mas o Safari ainda conta 337 de empurrão.
    expect(
      medirAreaVisivel({ ...IPHONE, topoVisivel: 337, rolagem: 0, alturaVisivel: 362 }),
    ).toEqual({ topo: 0, altura: 362, teclado: true });
  });

  it('a página rolou e o empurrão ainda não chegou (o diário viu 400 ms assim)', () => {
    expect(
      medirAreaVisivel({ ...IPHONE, topoVisivel: 0, rolagem: 337, alturaVisivel: 362 }),
    ).toEqual({ topo: 0, altura: 362, teclado: true });
  });

  it('teclado SUBINDO: a área já foi empurrada e a altura ainda não mudou, e a camada encolhe junto', () => {
    expect(
      medirAreaVisivel({ ...IPHONE, topoVisivel: 150, rolagem: 150, alturaVisivel: 699 }),
    ).toEqual({ topo: 150, altura: 549, teclado: true });
  });

  it('teclado aberto no Android: a janela encolhe junto e nada é empurrado', () => {
    expect(
      medirAreaVisivel({ semTeclado: 844, topoVisivel: 0, rolagem: 0, alturaVisivel: 520 }),
    ).toEqual({ topo: 0, altura: 520, teclado: true });
  });

  it('nunca menos que 40% da tela, por mais estranho que seja o número', () => {
    // O primeiro teste no iPhone: a conta antiga dava 362 − 337 = 25 px de camada.
    expect(
      medirAreaVisivel({ ...IPHONE, topoVisivel: 600, rolagem: 600, alturaVisivel: 699 }).altura,
    ).toBe(280);
    // …mas também nunca mais que a área visível.
    expect(
      medirAreaVisivel({ ...IPHONE, topoVisivel: 600, rolagem: 600, alturaVisivel: 200 }).altura,
    ).toBe(200);
  });
});
