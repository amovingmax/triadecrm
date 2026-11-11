import { describe, expect, it } from 'vitest';

import {
  acaoDoLead,
  destinoDosLeads,
  ehAlvoDeLead,
  leadDaUrl,
  linhaDoLead,
  pisoDepois,
  textoDoAvisoDeLead,
} from './aviso-de-lead';

const ID = '3f2b8a10-1c2d-4e5f-8a9b-0c1d2e3f4a5b';

describe('acaoDoLead', () => {
  it('fala o que a pessoa fez, com a visita na frente', () => {
    expect(acaoDoLead(['CONTACT_FORM', 'VISIT_REQUEST'])).toBe('pediu uma visita');
    expect(acaoDoLead(['CLICK_WHATSAPP', 'CONTACT_FORM'])).toBe('preencheu o formulário');
    expect(acaoDoLead(['CONTACT_CHAT'])).toBe('mandou mensagem pelo chat');
  });
  it('mensagem sem tipo, ou tipo desconhecido, é "escreveu pelo portal"', () => {
    expect(acaoDoLead(['MENSAGEM_NO_PORTAL'])).toBe('escreveu pelo portal');
    expect(acaoDoLead([])).toBe('escreveu pelo portal');
  });
});

describe('textoDoAvisoDeLead', () => {
  it('um lead: nome, ação e anúncio', () => {
    expect(
      textoDoAvisoDeLead(
        [{ id: ID, nome: 'Maria Souza', acao: 'pediu uma visita', codigo: 'IM0003' }],
        'Imova',
      ),
    ).toEqual({
      titulo: 'Imova · Novo lead do portal',
      corpo: 'Maria Souza pediu uma visita · IM0003',
    });
  });
  it('sem nome e sem código, não inventa', () => {
    expect(linhaDoLead({ id: ID, nome: '  ', acao: 'escreveu pelo portal', codigo: null })).toBe(
      'Alguém escreveu pelo portal',
    );
  });
  it('vários: conta e diz até três nomes', () => {
    const lead = (nome: string) => ({ id: ID, nome, acao: 'x', codigo: null });
    expect(textoDoAvisoDeLead([lead('Ana'), lead('Bia')], 'Imova')).toEqual({
      titulo: 'Imova · 2 leads novos do portal',
      corpo: 'Ana e Bia',
    });
    expect(
      textoDoAvisoDeLead(
        [lead('Ana'), lead('Bia'), lead('Caio'), lead('Duda'), lead('Eva')],
        'Imova',
      ).corpo,
    ).toBe('Ana, Bia, Caio e mais 2');
  });
});

describe('destinoDosLeads', () => {
  it('um lead abre a ficha dele; vários, a lista', () => {
    expect(destinoDosLeads([ID])).toBe(`/anuncios/leads?lead=${ID}`);
    expect(destinoDosLeads([ID, ID])).toBe('/anuncios/leads');
    expect(destinoDosLeads([])).toBe('/anuncios/leads');
  });
});

describe('ehAlvoDeLead', () => {
  it('separa o alvo do lead do alvo da conversa', () => {
    expect(ehAlvoDeLead({ lead: ID })).toBe(true);
    expect(ehAlvoDeLead({ conversaId: ID, organizacaoId: null })).toBe(false);
    expect(ehAlvoDeLead(null)).toBe(false);
    expect(ehAlvoDeLead('x')).toBe(false);
  });
});

describe('leadDaUrl', () => {
  it('aceita só um uuid', () => {
    expect(leadDaUrl(` ${ID.toUpperCase()} `)).toBe(ID);
    expect(leadDaUrl('abc')).toBeNull();
    expect(leadDaUrl(['x'])).toBeNull();
    expect(leadDaUrl(undefined)).toBeNull();
  });
});

describe('pisoDepois', () => {
  it('anda para o mais recente e nunca volta', () => {
    const piso = '2026-11-11T12:00:00+00:00';
    expect(
      pisoDepois(piso, [
        { escreveuEm: '2026-11-11T12:05:00+00:00' },
        { escreveuEm: '2026-11-11T12:03:00+00:00' },
      ]),
    ).toBe('2026-11-11T12:05:00+00:00');
    expect(pisoDepois(piso, [{ escreveuEm: '2026-11-11T11:00:00+00:00' }])).toBe(piso);
    expect(pisoDepois(piso, [])).toBe(piso);
  });
});
