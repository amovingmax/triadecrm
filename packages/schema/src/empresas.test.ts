import { describe, expect, it } from 'vitest';

import { EMPRESAS, empresaPorSlug } from './empresas';

describe('empresas', () => {
  it('a KOMUNE guarda, letra por letra, os textos que estavam no código antes da Imova', () => {
    const k = EMPRESAS.komune;
    expect(k.nome).toBe('Komune');
    expect(k.nomeDoNumero).toBe('KOMUNE');
    expect(k.tituloDoApp).toBe('Tríade');
    expect(k.descricaoDoLogin).toBe('CRM de captação da Komune.');
    expect(k.descricaoDoApp).toBe(
      'CRM de captação da KOMUNE: parceiros, Revisão, funis, conversas de WhatsApp, agenda, metas e relatórios.',
    );
    expect(k.admins).toEqual({ ou: 'Rafael, Luiz ou Matheus', e: 'Rafael, Luiz e Matheus', tecnicos: 'Luiz ou Matheus' });
    expect(k.tipos).toEqual({ fornecedor: 'Fornecedor', produtor: 'Produtor', cerimonialista: 'Cerimonialista' });
    expect(k.modulos).toEqual({ plataformaKomune: true, ia: true, atitudeDoCliente: false });
    expect(k.gruposDeCategoria).toEqual({});
    expect(k.origens).toBeNull();
  });

  it('a Imova fala a origem do contato sem evento, Natal de evento nem KOMUNE', () => {
    const { origens } = EMPRESAS.imova;
    expect(origens).not.toBeNull();
    for (const frase of [...Object.values(origens!.porFonte), origens!.padrao]) {
      expect(frase).not.toMatch(/komune|evento|fornecedor/i);
    }
  });

  it('a Imova não herda nome, pessoas nem módulos da KOMUNE', () => {
    const i = EMPRESAS.imova;
    for (const texto of [i.nome, i.nomeDoNumero, i.descricaoDoLogin, i.descricaoDoApp, i.admins.ou, i.admins.e]) {
      expect(texto).not.toMatch(/komune|rafael|luiz|matheus|heloísa/i);
    }
    expect(i.tituloDoApp).not.toBe(EMPRESAS.komune.tituloDoApp);
    expect(i.modulos).toEqual({ plataformaKomune: false, ia: false, atitudeDoCliente: true });
    expect(i.tipos.cerimonialista).toBeNull();
  });

  it('a política de privacidade é página do CRM só na Imova; a da KOMUNE mora no site dela', () => {
    expect(EMPRESAS.komune.privacidade).toBeNull();
    const p = EMPRESAS.imova.privacidade;
    expect(p).not.toBeNull();
    for (const texto of Object.values(p!)) {
      expect(texto).not.toMatch(/komune|rafael|luiz|matheus|heloísa|dennis/i);
    }
    expect(p!.email).toMatch(/@imovaimobiliaria\.com\.br$/);
  });

  it('a controladora da Imova é a pessoa jurídica: CNPJ e CRECI da empresa, não o do corretor', () => {
    const { registro } = EMPRESAS.imova.privacidade!;
    expect(registro).toMatch(/CNPJ \d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}/);
    expect(registro).toContain('CRECI-RN 9825');
    expect(registro).not.toContain('7260');
  });

  it('sem empresa no ambiente é a KOMUNE; empresa desconhecida é erro, não KOMUNE', () => {
    expect(empresaPorSlug(undefined).slug).toBe('komune');
    expect(empresaPorSlug('imova').slug).toBe('imova');
    expect(() => empresaPorSlug('imovaa')).toThrow(/não existe/);
  });
});
