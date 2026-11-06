import { describe, expect, it } from 'vitest';

import { plataformaValida, tokenValido } from './avisos-no-celular';

describe('o endereço de push que o app entrega', () => {
  it('aceita o formato do Expo', () => {
    expect(tokenValido('ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]')).toBe(true);
    expect(tokenValido('ExpoPushToken[AbC_123-xyz0987654]')).toBe(true);
  });

  it('recusa o resto, que nunca chega ao banco', () => {
    expect(tokenValido('ExponentPushToken[curto]')).toBe(false);
    expect(tokenValido("ExponentPushToken[x'; drop table--]")).toBe(false);
    expect(tokenValido('qualquer coisa')).toBe(false);
    expect(tokenValido(42)).toBe(false);
  });

  it('só iPhone e Android', () => {
    expect(plataformaValida('ios')).toBe(true);
    expect(plataformaValida('android')).toBe(true);
    expect(plataformaValida('web')).toBe(false);
  });
});
