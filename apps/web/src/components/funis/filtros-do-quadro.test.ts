import { describe, expect, it } from 'vitest';

import {
  contarRecortesDoQuadro,
  filtrosQuadroDaUrl,
  FILTROS_QUADRO_PADRAO,
  temRecorteNoQuadro,
  urlDosFiltrosQuadro,
} from './tipos';

/**
 * O filtro de canal no quadro (28/09/2026, ADR-16). O que estes testes guardam
 * é a ida e a volta pela URL: o quadro vive em link colado no WhatsApp do time,
 * e um recorte que não sobrevive à volta manda a pessoa para o quadro inteiro
 * sem avisar.
 */
describe('o canal na URL do quadro', () => {
  it('lê o canal da query string', () => {
    expect(filtrosQuadroDaUrl({ canal: 'phone' }).canal).toBe('phone');
  });

  it('ignora canal que não existe no enum do banco', () => {
    expect(filtrosQuadroDaUrl({ canal: 'pombo-correio' }).canal).toBeNull();
  });

  it('escreve e lê de volta o mesmo recorte', () => {
    const filtros = { ...FILTROS_QUADRO_PADRAO, canal: 'whatsapp' as const, q: 'buffet' };
    const busca = urlDosFiltrosQuadro(filtros);
    const params = Object.fromEntries(new URLSearchParams(busca.replace(/^\?/, '')));
    expect(filtrosQuadroDaUrl(params)).toMatchObject({ canal: 'whatsapp', q: 'buffet' });
  });

  it('sem canal, nada vai para a URL', () => {
    expect(urlDosFiltrosQuadro(FILTROS_QUADRO_PADRAO)).toBe('');
  });

  it('o canal conta como recorte: "a etapa está vazia" não é "o filtro não achou"', () => {
    expect(temRecorteNoQuadro(FILTROS_QUADRO_PADRAO)).toBe(false);
    expect(temRecorteNoQuadro({ ...FILTROS_QUADRO_PADRAO, canal: 'phone' })).toBe(true);
    expect(contarRecortesDoQuadro({ ...FILTROS_QUADRO_PADRAO, canal: 'phone' })).toBe(1);
    expect(
      contarRecortesDoQuadro({ ...FILTROS_QUADRO_PADRAO, canal: 'phone', apenasMeus: true }),
    ).toBe(2);
  });

  it('a etapa aberta NÃO conta como recorte: no celular ela é a coluna visível', () => {
    expect(temRecorteNoQuadro({ ...FILTROS_QUADRO_PADRAO, etapaId: 3 })).toBe(false);
  });
});
