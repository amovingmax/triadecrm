import { describe, expect, it } from 'vitest';

import { tagDoCodigo, tagDoTipo, tagTrocavel, TIPOS_DE_IMOVEL } from './tipos';

/**
 * As tags do código (20261110100000), que saem sozinhas do tipo. O espelho do
 * banco: `tagDoTipo` tem de dar o mesmo que `app.anuncio_tag_do_tipo` para
 * todos os tipos, e `tagDoCodigo` o mesmo que `app.anuncio_tag_do_codigo` (o
 * pgTAP 141 confere o lado do banco).
 */
describe('tags do código do anúncio', () => {
  it('são só TE, SA, IM e CO, sem PT', () => {
    expect([...new Set(TIPOS_DE_IMOVEL.map((t) => tagDoTipo(t.id)))].sort()).toEqual([
      'CO',
      'IM',
      'SA',
      'TE',
    ]);
  });

  it('cada tipo dá a tag do banco', () => {
    const esperado: Record<string, string> = {
      terreno: 'TE',
      terreno_comercial: 'TE',
      sala_comercial: 'SA',
      consultorio: 'SA',
      apartamento: 'IM',
      casa: 'IM',
      casa_condominio: 'IM',
      casa_vila: 'IM',
      sobrado: 'IM',
      cobertura: 'IM',
      flat: 'IM',
      kitnet: 'IM',
      studio: 'IM',
      loft: 'IM',
      chacara: 'IM',
      fazenda_sitio: 'IM',
      loja: 'CO',
      imovel_comercial: 'CO',
      predio_comercial: 'CO',
      predio_residencial: 'CO',
      andar_corporativo: 'CO',
      galpao: 'CO',
      garagem: 'CO',
      hotel: 'CO',
    };
    const obtido = Object.fromEntries(TIPOS_DE_IMOVEL.map((t) => [t.id, tagDoTipo(t.id)]));
    expect(obtido).toEqual(esperado);
  });

  it('só o código que o CRM deu tem tag', () => {
    expect(tagDoCodigo('TE0006')).toBe('TE');
    expect(tagDoCodigo('SA0013')).toBe('SA');
    expect(tagDoCodigo('IM12345')).toBe('IM');
    expect(tagDoCodigo('TE0001_IMOVA')).toBeNull();
    expect(tagDoCodigo('PT0001')).toBeNull();
    expect(tagDoCodigo('IMV-0001')).toBeNull();
    expect(tagDoCodigo('Casa extremox')).toBeNull();
    expect(tagDoCodigo('te0006')).toBeNull();
  });

  it('o código só segue o tipo no rascunho do CRM que nunca foi ao ar', () => {
    const rascunho = { origem: 'crm', situacao: 'rascunho' as const, publicado_em: null };
    expect(tagTrocavel(rascunho)).toBe(true);
    expect(tagTrocavel({ ...rascunho, origem: 'sistema_atual' })).toBe(false);
    expect(tagTrocavel({ ...rascunho, origem: 'relatorio_canal_pro' })).toBe(false);
    expect(tagTrocavel({ ...rascunho, situacao: 'no_ar' })).toBe(false);
    expect(
      tagTrocavel({ ...rascunho, situacao: 'pausado', publicado_em: '2026-11-09T12:00:00Z' }),
    ).toBe(false);
  });
});
