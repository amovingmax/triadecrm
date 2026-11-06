import { describe, expect, it } from 'vitest';

import { montarOrigens, origemCurta, origemDaConversa } from './origem-no-portal-dados';

/**
 * A etiqueta "Veio do anúncio" da conversa (05/11/2026, só na Imova): só de quem
 * mandou mensagem, achada pela conversa e depois pela ficha, um lead por
 * conversa e por ficha, o Lead Certo nunca "veio", e o descartado só vale na
 * falta de outro.
 */

type Linha = Parameters<typeof montarOrigens>[0][number];

function linha(parcial: Partial<Linha>): Linha {
  return {
    id: 'l1',
    organization_id: 'org1',
    conversation_id: null,
    grupo: 'mensagem',
    chegou_por: null,
    chegou_em: null,
    client_listing_id: 'SA0012_IMOVA',
    anuncio_codigo: 'SA0012_IMOVA',
    anuncio_id: 'a1',
    lead_certo: false,
    mcmv: false,
    tipos: ['CLICK_WHATSAPP'],
    recebido_no_portal_em: null,
    recebido_em: '2026-11-05T12:00:00Z',
    situacao: 'novo',
    ...parcial,
  };
}

const daFicha = (m: ReturnType<typeof montarOrigens>, org: string) =>
  origemDaConversa(m, { conversaId: null, organizacaoId: org });

describe('a origem no portal, por ficha', () => {
  it('fica com o lead mais recente da ficha', () => {
    const m = montarOrigens([
      linha({ id: 'velho', recebido_em: '2026-11-01T12:00:00Z', anuncio_codigo: 'SA0001_IMOVA' }),
      linha({ id: 'novo', recebido_em: '2026-11-05T12:00:00Z' }),
    ]);
    expect(daFicha(m, 'org1')).toMatchObject({
      leadId: 'novo',
      frase: 'Veio do anúncio SA0012_IMOVA · WhatsApp',
      anuncioId: 'a1',
    });
  });

  it('o descartado só vale quando não há outro', () => {
    const m = montarOrigens([
      linha({ id: 'descartado', situacao: 'descartado', recebido_em: '2026-11-05T12:00:00Z' }),
      linha({ id: 'aberto', recebido_em: '2026-11-02T12:00:00Z' }),
      linha({ id: 'so', organization_id: 'org2', situacao: 'descartado' }),
    ]);
    expect(daFicha(m, 'org1')?.leadId).toBe('aberto');
    expect(daFicha(m, 'org2')).toMatchObject({ leadId: 'so', descartado: true });
  });

  it('Lead Certo diz "Parecido com" e não leva ao anúncio como se fosse dele', () => {
    const m = montarOrigens([linha({ lead_certo: true, tipos: ['CONTACT_FORM'] })]);
    const o = daFicha(m, 'org1')!;
    expect(o.frase).toBe('Parecido com o anúncio SA0012_IMOVA · Formulário');
    expect(o.parecido).toBe(true);
    expect(o.anuncioId).toBeNull();
    expect(origemCurta(o)).toBe('parecido com o anúncio SA0012_IMOVA');
  });

  it('lead sem ficha nem conversa não entra; sem código, a linha do nome não diz nada', () => {
    const m = montarOrigens([
      linha({ organization_id: null }),
      linha({ organization_id: 'org3', anuncio_codigo: null, client_listing_id: null, mcmv: true }),
    ]);
    expect(daFicha(m, 'org1')).toBeNull();
    expect(daFicha(m, 'org3')?.frase).toBe('Simulação do Minha Casa Minha Vida · WhatsApp');
    expect(origemCurta(daFicha(m, 'org3'))).toBeNull();
    expect(origemCurta(null)).toBeNull();
  });
});

describe('só quem mandou mensagem, achado pela conversa', () => {
  it('quem só clicou não ganha etiqueta, nem pela ficha', () => {
    const m = montarOrigens([
      linha({ id: 'clicou', grupo: 'clicou', conversation_id: 'conv1', chegou_por: null }),
    ]);
    expect(origemDaConversa(m, { conversaId: 'conv1', organizacaoId: 'org1' })).toBeNull();
  });

  it('a conversa sem ficha (a ficha automática ainda não rodou) é achada pelo id', () => {
    const m = montarOrigens([
      linha({
        organization_id: null,
        conversation_id: 'conv1',
        chegou_por: 'whatsapp',
        chegou_em: '2026-11-05T12:10:00Z',
      }),
    ]);
    const o = origemDaConversa(m, { conversaId: 'conv1', organizacaoId: null });
    expect(o).toMatchObject({
      frase: 'Veio do anúncio SA0012_IMOVA · WhatsApp',
      chegouEm: '2026-11-05T12:10:00Z',
    });
  });

  it('a conversa vem antes da ficha', () => {
    const m = montarOrigens([
      // O lead do chat do portal, na ficha, mais recente.
      linha({ id: 'chat', chegou_por: 'chat', recebido_em: '2026-11-05T15:00:00Z' }),
      // O lead que escreveu NESTA conversa do WhatsApp.
      linha({
        id: 'wpp',
        anuncio_codigo: 'TE0002_IMOVA',
        conversation_id: 'conv1',
        chegou_por: 'whatsapp',
        recebido_em: '2026-11-05T12:00:00Z',
      }),
    ]);
    expect(origemDaConversa(m, { conversaId: 'conv1', organizacaoId: 'org1' })?.leadId).toBe('wpp');
    // Outra conversa da mesma ficha cai no lead mais recente da ficha.
    expect(origemDaConversa(m, { conversaId: 'conv2', organizacaoId: 'org1' })).toMatchObject({
      leadId: 'chat',
      frase: 'Veio do anúncio SA0012_IMOVA · Chat do portal',
    });
  });
});
