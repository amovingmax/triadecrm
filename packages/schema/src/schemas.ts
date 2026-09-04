/**
 * Schemas zod da base de parceiros (RF-BAS-01..15) — a validação que a UI e os workers
 * fazem ANTES de falar com o banco.
 *
 * Cada regra aqui espelha uma regra que já existe no Postgres (CHECK, trigger de
 * normalização ou RPC): o banco continua sendo a autoridade (ADR-03); o zod só antecipa
 * o erro em português, no campo certo do formulário, e entrega o valor já normalizado.
 * Onde o banco for mais permissivo, o comentário diz por que o schema aperta.
 */

import { z } from 'zod';

import { Constants } from './database.types';
import { cnpjIsValid, normalizeCnpj, normalizeInstagram, normalizePhoneBr } from './normalizadores';
import type { FunctionArgs } from './tipos';

// ---------------------------------------------------------------------------
// Enums — construídos a partir de `Constants` (gerado do banco), para que um valor
// novo no enum SQL apareça aqui sozinho no próximo `pnpm db:types`.
// ---------------------------------------------------------------------------

export const orgKindSchema = z.enum(Constants.app.Enums.org_kind);
export const userRoleSchema = z.enum(Constants.app.Enums.user_role);
export const temperatureSchema = z.enum(Constants.app.Enums.temperature);
export const dealStatusSchema = z.enum(Constants.app.Enums.deal_status);
export const channelSchema = z.enum(Constants.app.Enums.channel);
export const sourceKindSchema = z.enum(Constants.app.Enums.source_kind);
export const activityTypeSchema = z.enum(Constants.app.Enums.activity_type);

/** Prioridade comercial do alvo (CHECK `deals.tier`); A+ = indicação (RF-BAS-15). */
export const tierSchema = z.enum(['A+', 'A', 'B', 'C']);

// ---------------------------------------------------------------------------
// Peças reutilizáveis
// ---------------------------------------------------------------------------

/** Colapsa espaços e apara as pontas, como o trigger faz com nome e razão social. */
const colapsarEspacos = (v: string): string => v.replace(/\s+/g, ' ').trim();

/** Texto livre opcional: vazio ou só espaços vira `null` (igual aos triggers). */
const textoOpcional = z
  .string()
  .nullish()
  .transform((v) => {
    const t = (v ?? '').trim();
    return t === '' ? null : t;
  });

/** Nome exigido, com espaços colapsados e tamanho mínimo. */
const nomeComMinimo = (minimo: number, mensagem: string) =>
  z
    .string({ error: mensagem })
    .transform(colapsarEspacos)
    .refine((v) => v.length >= minimo, { error: mensagem });

/**
 * CNPJ opcional: aceita com ou sem máscara, exige 14 dígitos com DV válido e devolve
 * só os dígitos. Espelha `app.organizations_normalize` (erro 23514 "CNPJ inválido").
 */
export const cnpjOpcionalSchema = z
  .string()
  .nullish()
  .refine((v) => (v ?? '').trim() === '' || cnpjIsValid(v), {
    error: 'CNPJ inválido: confira os 14 dígitos e os dígitos verificadores.',
  })
  .transform((v) => ((v ?? '').trim() === '' ? null : normalizeCnpj(v)));

/**
 * Telefone opcional normalizado para E.164 (RF-BAS-05). Espelha o trigger: vazio vira
 * `null`, preenchido e fora da regra é erro.
 */
export const telefoneOpcionalSchema = z
  .string()
  .nullish()
  .refine((v) => (v ?? '').trim() === '' || normalizePhoneBr(v) !== null, {
    error: 'Telefone inválido: use DDD + número (ex.: (84) 99999-1234).',
  })
  .transform((v) => ((v ?? '').trim() === '' ? null : normalizePhoneBr(v)));

/** Telefone obrigatório normalizado para E.164 (cadastro rápido, RF-BAS-15). */
export const telefoneObrigatorioSchema = z
  .string({ error: 'Informe o WhatsApp do parceiro.' })
  .refine((v) => normalizePhoneBr(v) !== null, {
    error: 'WhatsApp inválido: use DDD + número (ex.: (84) 99999-1234).',
  })
  .transform((v) => normalizePhoneBr(v) as string);

/**
 * `@instagram` opcional: aceita `@nome` ou URL de perfil e devolve o handle minúsculo.
 * Link de post/reel/story e rota de sistema não são perfil e são recusados aqui, antes
 * de virarem colisão no índice único (RF-BAS-08).
 */
export const instagramOpcionalSchema = z
  .string()
  .nullish()
  .refine((v) => (v ?? '').trim() === '' || normalizeInstagram(v) !== null, {
    error: '@instagram inválido: informe o perfil (@nome), não um link de post ou reel.',
  })
  .transform((v) => ((v ?? '').trim() === '' ? null : normalizeInstagram(v)));

/** E-mail opcional em minúsculas (a coluna é `citext`). */
export const emailOpcionalSchema = z
  .string()
  .nullish()
  .refine((v) => (v ?? '').trim() === '' || z.email().safeParse((v ?? '').trim()).success, {
    error: 'E-mail inválido.',
  })
  .transform((v) => {
    const t = (v ?? '').trim().toLowerCase();
    return t === '' ? null : t;
  });

const uuidOpcional = z
  .uuid({ error: 'Identificador inválido.' })
  .nullish()
  .transform((v) => v ?? null);

const inteiroPositivoOpcional = z
  .number()
  .int()
  .positive()
  .nullish()
  .transform((v) => v ?? null);

const dataHoraOpcional = z.iso
  .datetime({ offset: true, error: 'Data/hora inválida (use ISO 8601).' })
  .nullish()
  .transform((v) => v ?? null);

const numeroOpcional = z
  .number()
  .nullish()
  .transform((v) => v ?? null);

/**
 * ADR-09: CPF, dados bancários e Pix não entram no CRM — nem por campo personalizado
 * criado na importação a partir do cabeçalho da planilha (RF-BAS-07). Mesma lista da
 * constraint `organizations_custom_sem_dados_sensiveis`.
 */
export const CHAVES_CUSTOM_PROIBIDAS = [
  'cpf',
  'CPF',
  'pix',
  'PIX',
  'chave_pix',
  'conta',
  'conta_bancaria',
  'agencia',
  'banco',
  'cartao',
] as const;

export const customFieldsSchema = z
  .record(z.string(), z.unknown())
  .refine(
    (obj) =>
      !Object.keys(obj).some((k) => (CHAVES_CUSTOM_PROIBIDAS as readonly string[]).includes(k)),
    {
      error:
        'Campo personalizado com dado sensível (CPF, Pix, dados bancários) não é aceito no CRM (ADR-09).',
    },
  );

// ---------------------------------------------------------------------------
// Organização (RF-BAS-01, RF-BAS-02, RF-BAS-04, RF-BAS-07, RF-BAS-10)
// ---------------------------------------------------------------------------

export const organizationSchema = z
  .object({
    kind: orgKindSchema.default('fornecedor'),
    // O banco exige apenas `length(trim(name)) > 0`; o schema mantém o mesmo piso.
    name: nomeComMinimo(1, 'Informe o nome do parceiro.'),
    legal_name: textoOpcional,
    cnpj: cnpjOpcionalSchema,
    phone_e164: telefoneOpcionalSchema,
    email: emailOpcionalSchema,
    instagram_handle: instagramOpcionalSchema,
    website: textoOpcional,
    city_id: inteiroPositivoOpcional,
    neighborhood: textoOpcional,
    address: textoOpcional,
    lat: numeroOpcional,
    lng: numeroOpcional,
    price_range: textoOpcional,
    rating: z
      .number()
      .min(0)
      .max(5, { error: 'A nota vai de 0 a 5.' })
      .nullish()
      .transform((v) => v ?? null),
    reviews_count: z
      .number()
      .int()
      .min(0)
      .nullish()
      .transform((v) => v ?? null),
    description: textoOpcional,
    // Origem obrigatória (RF-BAS-10): `organizations.source_id` é NOT NULL.
    source_id: z.number({ error: 'Informe a origem do dado.' }).int().positive(),
    source_url: textoOpcional,
    collector: textoOpcional,
    owner_id: uuidOpcional,
    // Override manual por estrelas: 1 frio, 2 morno, 3 quente (PRD §5.6).
    temperature_override: z
      .number()
      .int()
      .min(1)
      .max(3)
      .nullish()
      .transform((v) => v ?? null),
    temperature_override_reason: textoOpcional,
    is_natural_person: z.boolean().default(false),
    vip: z.boolean().default(false),
    custom: customFieldsSchema.default({}),
  })
  .check((ctx) => {
    // constraint organizations_override_needs_reason
    if (ctx.value.temperature_override !== null && ctx.value.temperature_override_reason === null) {
      ctx.issues.push({
        code: 'custom',
        input: ctx.value.temperature_override_reason,
        path: ['temperature_override_reason'],
        message: 'Explique por que a temperatura foi forçada (PRD §5.6).',
      });
    }
  });

export type Organization = z.output<typeof organizationSchema>;
export type OrganizationInput = z.input<typeof organizationSchema>;

// ---------------------------------------------------------------------------
// Contato (RF-BAS-03)
// ---------------------------------------------------------------------------

export const contactSchema = z
  .object({
    full_name: nomeComMinimo(1, 'Informe o nome da pessoa.'),
    first_name: textoOpcional,
    phone_e164: telefoneOpcionalSchema,
    email: emailOpcionalSchema,
    instagram_handle: instagramOpcionalSchema,
    role_title: textoOpcional,
    is_decision_maker: z.boolean().default(false),
    preferred_channel: channelSchema.default('whatsapp'),
    // Mantido pelos eventos de consentimento; aqui só é lido/enviado como veio.
    do_not_contact: z.boolean().default(false),
    source_id: inteiroPositivoOpcional,
    notes: textoOpcional,
  })
  // `first_name` vazio é derivado do primeiro nome, como faz app.contacts_normalize().
  .transform((v) => ({
    ...v,
    first_name: v.first_name ?? (v.full_name.split(' ')[0] || null),
  }));

export type Contact = z.output<typeof contactSchema>;
export type ContactInput = z.input<typeof contactSchema>;

// ---------------------------------------------------------------------------
// Negócio (RF-FUN-01..08)
// ---------------------------------------------------------------------------

export const dealSchema = z
  .object({
    organization_id: z.uuid({ error: 'Negócio precisa de um parceiro.' }),
    pipeline_id: z.number({ error: 'Informe o funil.' }).int().positive(),
    stage_id: z.number({ error: 'Informe a etapa.' }).int().positive(),
    status: dealStatusSchema.default('open'),
    owner_id: uuidOpcional,
    primary_contact_id: uuidOpcional,
    source_id: inteiroPositivoOpcional,
    tier: tierSchema.nullish().transform((v) => v ?? null),
    score: z
      .number()
      .int()
      .min(0)
      .max(100, { error: 'O score vai de 0 a 100.' })
      .nullish()
      .transform((v) => v ?? null),
    next_action: textoOpcional,
    next_action_at: dataHoraOpcional,
    lost_reason_id: inteiroPositivoOpcional,
    paused_until: dataHoraOpcional,
    stage_change_reason: textoOpcional,
  })
  .check((ctx) => {
    // constraint deals_paused_needs_date: "pausado" só existe com data de retomada.
    if (ctx.value.status === 'paused' && ctx.value.paused_until === null) {
      ctx.issues.push({
        code: 'custom',
        input: ctx.value.paused_until,
        path: ['paused_until'],
        message: 'Negócio pausado precisa de data de retomada.',
      });
    }
  });

export type Deal = z.output<typeof dealSchema>;
export type DealInput = z.input<typeof dealSchema>;

// ---------------------------------------------------------------------------
// Cadastro rápido (RF-BAS-15) — os quatro campos da RPC public.quick_create_organization
// ---------------------------------------------------------------------------

export const quickCreateOrganizationInput = z.object({
  // Dois caracteres: "J" e "." não são nome de parceiro e o cadastro rápido é o
  // caminho de campo, sem revisão posterior (o banco só exige > 0).
  name: nomeComMinimo(2, 'Informe o nome do parceiro (pelo menos 2 caracteres).'),
  category_id: z.number({ error: 'Escolha a categoria.' }).int().positive(),
  phone: telefoneObrigatorioSchema,
  source_id: z
    .number({ error: 'Escolha a origem (como você chegou nesse parceiro).' })
    .int()
    .positive(),
  kind: orgKindSchema.default('fornecedor'),
});

export type QuickCreateOrganization = z.output<typeof quickCreateOrganizationInput>;
export type QuickCreateOrganizationFormInput = z.input<typeof quickCreateOrganizationInput>;

/** Converte a entrada validada nos argumentos da RPC `quick_create_organization`. */
export function toQuickCreateOrganizationArgs(
  entrada: QuickCreateOrganization,
): FunctionArgs<'quick_create_organization'> {
  return {
    p_name: entrada.name,
    p_category_id: entrada.category_id,
    p_phone: entrada.phone,
    p_source_id: entrada.source_id,
    p_kind: entrada.kind,
  };
}
