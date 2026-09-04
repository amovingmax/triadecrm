import { describe, expect, it } from 'vitest';

import { Constants } from './database.types';
import {
  contactSchema,
  customFieldsSchema,
  dealSchema,
  organizationSchema,
  orgKindSchema,
  quickCreateOrganizationInput,
  temperatureSchema,
  toQuickCreateOrganizationArgs,
} from './schemas';

/** Organização mínima válida (origem é obrigatória — RF-BAS-10). */
const organizacaoMinima = { name: 'Buffet São João', source_id: 1 };

describe('enums espelhados do banco', () => {
  it('org_kind e temperature vêm de Constants (gerado por pnpm db:types)', () => {
    expect(orgKindSchema.options).toEqual(Constants.app.Enums.org_kind);
    expect(temperatureSchema.options).toEqual(Constants.app.Enums.temperature);
    expect(orgKindSchema.safeParse('fornecedor').success).toBe(true);
    expect(orgKindSchema.safeParse('padaria').success).toBe(false);
  });
});

describe('organizationSchema', () => {
  it('normaliza nome, CNPJ, telefone, @instagram e e-mail como os triggers', () => {
    const org = organizationSchema.parse({
      ...organizacaoMinima,
      name: '  Buffet   São  João ',
      cnpj: '12.345.678/0001-95',
      phone_e164: '(84) 99999-1234',
      instagram_handle: 'https://www.instagram.com/Buffet.SaoJoao/?hl=pt',
      email: '  Contato@BuffetSaoJoao.com.BR ',
    });
    expect(org.name).toBe('Buffet São João');
    expect(org.cnpj).toBe('12345678000195');
    expect(org.phone_e164).toBe('+5584999991234');
    expect(org.instagram_handle).toBe('buffet.saojoao');
    expect(org.email).toBe('contato@buffetsaojoao.com.br');
    expect(org.kind).toBe('fornecedor');
    expect(org.vip).toBe(false);
  });

  it('transforma string vazia em NULL, igual ao trigger', () => {
    const org = organizationSchema.parse({
      ...organizacaoMinima,
      cnpj: '',
      phone_e164: '   ',
      instagram_handle: '',
      neighborhood: '  ',
      email: '',
    });
    expect(org.cnpj).toBeNull();
    expect(org.phone_e164).toBeNull();
    expect(org.instagram_handle).toBeNull();
    expect(org.neighborhood).toBeNull();
    expect(org.email).toBeNull();
  });

  it('recusa CNPJ com DV errado, telefone fora da regra e link de post do Instagram', () => {
    expect(
      organizationSchema.safeParse({ ...organizacaoMinima, cnpj: '12345678000196' }).success,
    ).toBe(false);
    expect(
      organizationSchema.safeParse({ ...organizacaoMinima, phone_e164: '84 89999-1234' }).success,
    ).toBe(false);
    expect(
      organizationSchema.safeParse({
        ...organizacaoMinima,
        instagram_handle: 'https://www.instagram.com/p/CxYz123/',
      }).success,
    ).toBe(false);
  });

  it('exige origem (RF-BAS-10) e nome não vazio', () => {
    expect(organizationSchema.safeParse({ name: 'Sem origem' }).success).toBe(false);
    expect(organizationSchema.safeParse({ name: '   ', source_id: 1 }).success).toBe(false);
  });

  it('exige motivo quando a temperatura é forçada (PRD §5.6)', () => {
    const semMotivo = organizationSchema.safeParse({
      ...organizacaoMinima,
      temperature_override: 3,
    });
    expect(semMotivo.success).toBe(false);
    if (!semMotivo.success) {
      expect(semMotivo.error.issues[0]?.path).toEqual(['temperature_override_reason']);
    }
    expect(
      organizationSchema.safeParse({
        ...organizacaoMinima,
        temperature_override: 3,
        temperature_override_reason: 'Fechou pela Bárbara na feira',
      }).success,
    ).toBe(true);
    expect(
      organizationSchema.safeParse({ ...organizacaoMinima, temperature_override: 4 }).success,
    ).toBe(false);
  });

  it('recusa campo personalizado com CPF ou Pix (ADR-09), aceita campo comum (RF-BAS-07)', () => {
    expect(customFieldsSchema.safeParse({ cpf: '12345678901' }).success).toBe(false);
    expect(customFieldsSchema.safeParse({ chave_pix: '84999991234' }).success).toBe(false);
    expect(customFieldsSchema.safeParse({ banco: 'itau' }).success).toBe(false);
    expect(customFieldsSchema.safeParse({ capacidade: '200 pessoas' }).success).toBe(true);
    expect(
      organizationSchema.safeParse({ ...organizacaoMinima, custom: { cpf: '12345678901' } })
        .success,
    ).toBe(false);
    expect(organizationSchema.parse(organizacaoMinima).custom).toEqual({});
  });

  it('mantém a nota entre 0 e 5', () => {
    expect(organizationSchema.safeParse({ ...organizacaoMinima, rating: 4.7 }).success).toBe(true);
    expect(organizationSchema.safeParse({ ...organizacaoMinima, rating: 5.4 }).success).toBe(false);
  });
});

describe('contactSchema', () => {
  it('colapsa o nome, deriva o primeiro nome e normaliza telefone e @', () => {
    const contato = contactSchema.parse({
      full_name: ' Maria   da Silva ',
      phone_e164: '84 99999-4321',
      instagram_handle: '@Maria.Silva',
    });
    expect(contato.full_name).toBe('Maria da Silva');
    expect(contato.first_name).toBe('Maria');
    expect(contato.phone_e164).toBe('+5584999994321');
    expect(contato.instagram_handle).toBe('maria.silva');
    expect(contato.preferred_channel).toBe('whatsapp');
    expect(contato.do_not_contact).toBe(false);
  });

  it('preserva o primeiro nome informado', () => {
    expect(
      contactSchema.parse({ full_name: 'João Pedro Souza', first_name: 'JP' }).first_name,
    ).toBe('JP');
  });

  it('recusa telefone inválido e nome vazio', () => {
    expect(
      contactSchema.safeParse({ full_name: 'Tel inválido', phone_e164: '84 89999-0000' }).success,
    ).toBe(false);
    expect(contactSchema.safeParse({ full_name: '  ' }).success).toBe(false);
  });
});

describe('dealSchema', () => {
  const negocioMinimo = {
    organization_id: 'b0000000-0000-4000-8000-000000000101',
    pipeline_id: 1,
    stage_id: 1,
  };

  it('aceita o mínimo e aplica os padrões do banco', () => {
    const negocio = dealSchema.parse(negocioMinimo);
    expect(negocio.status).toBe('open');
    expect(negocio.tier).toBeNull();
    expect(negocio.score).toBeNull();
  });

  it('exige data de retomada quando o negócio é pausado (deals_paused_needs_date)', () => {
    const semData = dealSchema.safeParse({ ...negocioMinimo, status: 'paused' });
    expect(semData.success).toBe(false);
    if (!semData.success) {
      expect(semData.error.issues[0]?.path).toEqual(['paused_until']);
    }
    expect(
      dealSchema.safeParse({
        ...negocioMinimo,
        status: 'paused',
        paused_until: '2026-09-20T12:00:00Z',
      }).success,
    ).toBe(true);
  });

  it('valida tier, score e identificadores', () => {
    expect(dealSchema.safeParse({ ...negocioMinimo, tier: 'A+' }).success).toBe(true);
    expect(dealSchema.safeParse({ ...negocioMinimo, tier: 'D' }).success).toBe(false);
    expect(dealSchema.safeParse({ ...negocioMinimo, score: 101 }).success).toBe(false);
    expect(dealSchema.safeParse({ ...negocioMinimo, organization_id: 'nao-e-uuid' }).success).toBe(
      false,
    );
  });
});

describe('quickCreateOrganizationInput (RF-BAS-15)', () => {
  const entrada = {
    name: 'Buffet São João',
    category_id: 3,
    phone: '(84) 99999-1234',
    source_id: 2,
  };

  it('valida os quatro campos e devolve o WhatsApp em E.164', () => {
    const parsed = quickCreateOrganizationInput.parse(entrada);
    expect(parsed.name).toBe('Buffet São João');
    expect(parsed.phone).toBe('+5584999991234');
    expect(parsed.kind).toBe('fornecedor');
  });

  it('exige nome com pelo menos 2 caracteres', () => {
    expect(quickCreateOrganizationInput.safeParse({ ...entrada, name: 'J' }).success).toBe(false);
    expect(quickCreateOrganizationInput.safeParse({ ...entrada, name: ' Jô ' }).success).toBe(true);
  });

  it('recusa WhatsApp que não normaliza e origem/categoria ausentes', () => {
    expect(
      quickCreateOrganizationInput.safeParse({ ...entrada, phone: '84 89999-1234' }).success,
    ).toBe(false);
    expect(quickCreateOrganizationInput.safeParse({ ...entrada, phone: '' }).success).toBe(false);
    const semOrigem: Record<string, unknown> = { ...entrada };
    delete semOrigem.source_id;
    expect(quickCreateOrganizationInput.safeParse(semOrigem).success).toBe(false);
    expect(quickCreateOrganizationInput.safeParse({ ...entrada, category_id: 0 }).success).toBe(
      false,
    );
  });

  it('aceita produtor e cerimonialista como tipo', () => {
    expect(quickCreateOrganizationInput.parse({ ...entrada, kind: 'cerimonialista' }).kind).toBe(
      'cerimonialista',
    );
  });

  it('monta os argumentos da RPC public.quick_create_organization', () => {
    expect(toQuickCreateOrganizationArgs(quickCreateOrganizationInput.parse(entrada))).toEqual({
      p_name: 'Buffet São João',
      p_category_id: 3,
      p_phone: '+5584999991234',
      p_source_id: 2,
      p_kind: 'fornecedor',
    });
  });
});
