import { describe, expect, it } from 'vitest';

import { levaAOutraTela, type Aqui, type Toque } from './retorno-do-toque-regra';

const AQUI: Aqui = { origem: 'http://localhost:3000', caminho: '/parceiros', busca: '' };
const FICHA = 'http://localhost:3000/parceiros/6529fed3-d6a9-4847-838d-22be2e45db49';

function toque(mudar: Partial<Toque> = {}): Toque {
  return {
    botao: 0,
    comTecla: false,
    href: FICHA,
    alvo: '',
    baixar: false,
    dentroDeControle: false,
    noMenu: false,
    ...mudar,
  };
}

describe('levaAOutraTela', () => {
  it('o toque num cartão da lista leva à ficha', () => {
    expect(levaAOutraTela(toque(), AQUI)).toBe(true);
  });

  it('mudar só o filtro do endereço também é outra tela', () => {
    expect(
      levaAOutraTela(toque({ href: 'http://localhost:3000/parceiros?temperatura=quente' }), AQUI),
    ).toBe(true);
  });

  it('o mesmo endereço, ou só o #, não é', () => {
    expect(levaAOutraTela(toque({ href: 'http://localhost:3000/parceiros' }), AQUI)).toBe(false);
    expect(levaAOutraTela(toque({ href: 'http://localhost:3000/parceiros#topo' }), AQUI)).toBe(
      false,
    );
  });

  it('abrir em outra aba ou janela não troca esta tela', () => {
    expect(levaAOutraTela(toque({ comTecla: true }), AQUI)).toBe(false);
    expect(levaAOutraTela(toque({ botao: 1 }), AQUI)).toBe(false);
    expect(levaAOutraTela(toque({ alvo: '_blank' }), AQUI)).toBe(false);
    expect(levaAOutraTela(toque({ alvo: '_self' }), AQUI)).toBe(true);
  });

  it('download, outro site e endereço inválido ficam de fora', () => {
    expect(levaAOutraTela(toque({ baixar: true }), AQUI)).toBe(false);
    expect(levaAOutraTela(toque({ href: 'https://wa.me/5584999999999' }), AQUI)).toBe(false);
    expect(levaAOutraTela(toque({ href: 'tel:+5584999999999' }), AQUI)).toBe(false);
    expect(levaAOutraTela(toque({ href: 'não é endereço' }), AQUI)).toBe(false);
  });

  it('o botão dentro do cartão e o item do menu têm o retorno deles', () => {
    expect(levaAOutraTela(toque({ dentroDeControle: true }), AQUI)).toBe(false);
    expect(levaAOutraTela(toque({ noMenu: true }), AQUI)).toBe(false);
  });
});
