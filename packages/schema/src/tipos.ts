/**
 * Atalhos de tipo em cima de `database.types.ts` (gerado por `pnpm db:types`).
 *
 * O gerador só cria os helpers `Tables`/`TablesInsert`/`TablesUpdate`/`Enums`/
 * `CompositeTypes` mirando o schema padrão (`public`). Como todos os enums do CRM
 * vivem no schema privado `app`, e como as RPCs são a interface real do app com o
 * banco, este arquivo acrescenta o que falta: `Functions`, `FunctionArgs`,
 * `FunctionReturns`, `AppEnum` e os apelidos nominais mais usados na UI.
 */

import type { Database } from './database.types';

/** Nome de uma tabela ou view do schema `public`. */
export type TableName = keyof (Database['public']['Tables'] & Database['public']['Views']);

/** Nome de uma RPC exposta pela API (schema `public`). */
export type FunctionName = keyof Database['public']['Functions'];

/** Assinatura completa de uma RPC: `{ Args, Returns }`. */
export type Functions<Nome extends FunctionName> = Database['public']['Functions'][Nome];

/** Argumentos de uma RPC — o que vai em `supabase.rpc('nome', args)`. */
export type FunctionArgs<Nome extends FunctionName> = Functions<Nome>['Args'];

/** Retorno de uma RPC. */
export type FunctionReturns<Nome extends FunctionName> = Functions<Nome>['Returns'];

/** Nome de um enum do schema privado `app` (é onde todos eles moram). */
export type AppEnumName = keyof Database['app']['Enums'];

/** Valores de um enum do schema `app`: `AppEnum<'temperature'>` → 'frio' | 'morno' | … */
export type AppEnum<Nome extends AppEnumName> = Database['app']['Enums'][Nome];

// Apelidos nominais dos enums usados pela UI e pelos workers (PRD Apêndice D).
export type OrgKind = AppEnum<'org_kind'>;
export type UserRole = AppEnum<'user_role'>;
export type Temperature = AppEnum<'temperature'>;
export type DealStatus = AppEnum<'deal_status'>;
export type ActivityType = AppEnum<'activity_type'>;
export type TaskStatus = AppEnum<'task_status'>;
export type TaskKind = AppEnum<'task_kind'>;
export type Channel = AppEnum<'channel'>;
export type MsgDirection = AppEnum<'msg_direction'>;
export type MsgType = AppEnum<'msg_type'>;
export type MsgStatus = AppEnum<'msg_status'>;
export type ConsentKind = AppEnum<'consent_kind'>;
export type PreregStatus = AppEnum<'prereg_status'>;
export type ReviewStatus = AppEnum<'review_status'>;
export type SourceKind = AppEnum<'source_kind'>;
export type GoalMetric = AppEnum<'goal_metric'>;
export type GoalPeriod = AppEnum<'goal_period'>;

// Linhas mais manipuladas (`Tables<'x'>` continua disponível para as demais).
export type OrganizationRow = Database['public']['Tables']['organizations']['Row'];
export type ContactRow = Database['public']['Tables']['contacts']['Row'];
export type DealRow = Database['public']['Tables']['deals']['Row'];

/** Retorno da RPC de cadastro rápido (RF-BAS-15), que devolve `jsonb`. */
export type QuickCreateOrganizationResult =
  | { created: true; organization_id: string; deal_id: string }
  | {
      created: false;
      reason:
        | 'nome_obrigatorio'
        | 'telefone_invalido'
        | 'telefone_suprimido'
        | 'telefone_ja_cadastrado'
        | 'telefone_de_contato_existente'
        | 'categoria_invalida'
        | 'origem_invalida'
        | 'origem_desabilitada';
      existing_id?: string;
    };
