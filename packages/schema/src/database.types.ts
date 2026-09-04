export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  app: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      deal_cards: {
        Row: {
          card: Json | null
          deal_id: string | null
          next_action_at: string | null
          next_action_state: string | null
          org_deleted_at: string | null
          organization_id: string | null
          organization_name: string | null
          owner_id: string | null
          pipeline_id: number | null
          search_name: string | null
          stage_id: number | null
        }
        Relationships: []
      }
      portas: {
        Row: {
          aberta: boolean | null
          activity_id: string | null
          batida: boolean | null
          channel: Database["app"]["Enums"]["channel"] | null
          deal_id: string | null
          desfecho: string | null
          dia: string | null
          hora: number | null
          occurred_at: string | null
          organization_id: string | null
          outcome_id: number | null
          sem_desfecho: boolean | null
          superficie: Database["app"]["Enums"]["interaction_surface"] | null
          type: Database["app"]["Enums"]["activity_type"] | null
          user_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "activities_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "deal_cards"
            referencedColumns: ["deal_id"]
          },
        ]
      }
      portas_contadas: {
        Row: {
          aberta: boolean | null
          aberta_conta: boolean | null
          activity_id: string | null
          batida: boolean | null
          batida_conta: boolean | null
          channel: Database["app"]["Enums"]["channel"] | null
          deal_id: string | null
          desfecho: string | null
          dia: string | null
          hora: number | null
          occurred_at: string | null
          organization_id: string | null
          outcome_id: number | null
          sem_desfecho: boolean | null
          superficie: Database["app"]["Enums"]["interaction_surface"] | null
          type: Database["app"]["Enums"]["activity_type"] | null
          user_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "activities_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "deal_cards"
            referencedColumns: ["deal_id"]
          },
        ]
      }
    }
    Functions: {
      business_days: { Args: { p_ate: string; p_de: string }; Returns: number }
      call_batch_is_mine: { Args: { p_batch: string }; Returns: boolean }
      call_batch_is_visible: { Args: { p_batch: string }; Returns: boolean }
      call_candidates: {
        Args: {
          p_categoria_ids: number[]
          p_ordem: Database["app"]["Enums"]["call_order"]
          p_pipeline_id: number
          p_seed: number
          p_temperatura_origem: Database["app"]["Enums"]["temperature"]
        }
        Returns: {
          contact_id: string
          deal_id: string
          motivo: string
          ordem: number
          organization_id: string
          phone_e164: string
          stage_id: number
        }[]
      }
      call_window: { Args: { p_at?: string }; Returns: Json }
      call_window_hours: {
        Args: { p_dow: number }
        Returns: {
          ate: number
          de: number
        }[]
      }
      can_write: { Args: never; Returns: boolean }
      cnpj_is_valid: { Args: { c: string }; Returns: boolean }
      compute_temperature: {
        Args: {
          p_last_activity_at: string
          p_last_intent: string
          p_override: number
          p_stage_temperature: Database["app"]["Enums"]["temperature"]
          p_status: Database["app"]["Enums"]["deal_status"]
        }
        Returns: Record<string, unknown>
      }
      contact_is_visible: { Args: { p_contact: string }; Returns: boolean }
      cpf_is_valid: { Args: { c: string }; Returns: boolean }
      ddd_da_regiao: { Args: { p_phone: string }; Returns: boolean }
      deal_set_intent: {
        Args: {
          p_at: string
          p_claim?: boolean
          p_deal_id: string
          p_intent: string
        }
        Returns: boolean
      }
      expirar_reservas: { Args: never; Returns: number }
      find_org_matches: {
        Args: { n: Json; p_threshold?: number }
        Returns: {
          confidence: number
          organization_id: string
          reason: string
        }[]
      }
      goal_bounds: {
        Args: {
          p_period: Database["app"]["Enums"]["goal_period"]
          p_ref: string
        }
        Returns: {
          period_end: string
          period_start: string
        }[]
      }
      instante_local: {
        Args: { p_dia: string; p_hora: number }
        Returns: string
      }
      interaction_surface: {
        Args: {
          p_channel: Database["app"]["Enums"]["channel"]
          p_type: Database["app"]["Enums"]["activity_type"]
        }
        Returns: Database["app"]["Enums"]["interaction_surface"]
      }
      is_admin: { Args: never; Returns: boolean }
      is_manager: { Args: never; Returns: boolean }
      is_shared_web_host: { Args: { d: string }; Returns: boolean }
      is_suppressed: {
        Args: { p_cnpj?: string; p_instagram?: string; p_phone?: string }
        Returns: boolean
      }
      is_suppressed_target: {
        Args: { p_contact_id?: string; p_organization_id: string }
        Returns: boolean
      }
      mask_phone: { Args: { p: string }; Returns: string }
      next_business_day: {
        Args: { p_days?: number; p_from: string }
        Returns: string
      }
      normalize_cnpj: { Args: { c: string }; Returns: string }
      normalize_instagram: { Args: { h: string }; Returns: string }
      normalize_phone_br: { Args: { p: string }; Returns: string }
      org_is_editable: { Args: { p_org: string }; Returns: boolean }
      org_is_mine: { Args: { p_org: string }; Returns: boolean }
      org_is_visible: { Args: { p_org: string }; Returns: boolean }
      outcome_for_call_result: {
        Args: { p_result: Database["app"]["Enums"]["call_result"] }
        Returns: string
      }
      proxima_abertura: { Args: { p_dia: string }; Returns: string }
      reads_base_pii: { Args: never; Returns: boolean }
      recompute_temperatures: { Args: never; Returns: number }
      role: { Args: never; Returns: Database["app"]["Enums"]["user_role"] }
      search_name: { Args: { n: string }; Returns: string }
      sees_all: { Args: never; Returns: boolean }
      sha256_hex: { Args: { t: string }; Returns: string }
      stage_for: {
        Args: { p_pipeline_id: number; p_slug: string }
        Returns: Database["public"]["Tables"]["stages"]["Row"][]
        SetofOptions: {
          from: "*"
          to: "stages"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      suppress: {
        Args: {
          p_channel: Database["app"]["Enums"]["channel"]
          p_event_id: string
          p_kind: string
          p_reason: string
          p_value: string
        }
        Returns: undefined
      }
      validar_roteiro: { Args: { p_arvore: Json }; Returns: string[] }
      website_domain: { Args: { u: string }; Returns: string }
    }
    Enums: {
      activity_type:
        | "call"
        | "visit"
        | "meeting"
        | "message"
        | "note"
        | "email"
        | "stage_change"
        | "system"
      call_batch_status: "rascunho" | "ativo" | "pausado" | "encerrado"
      call_item_status: "fila" | "em_andamento" | "concluido" | "devolvido"
      call_order: "prioridade" | "mais_parado" | "aleatorio"
      call_provider: "manual"
      call_result:
        | "atendida_humano"
        | "nao_atendeu"
        | "caixa_postal"
        | "ocupado"
        | "numero_invalido"
        | "chamada_muda"
        | "queda_de_linha"
      candidate_status: "novo" | "aprovado" | "recusado" | "mesclado"
      channel:
        | "whatsapp"
        | "instagram"
        | "email"
        | "phone"
        | "presencial"
        | "other"
      consent_kind:
        | "contact_optin"
        | "contact_optout"
        | "data_use_authorized"
        | "photo_use_authorized"
        | "data_use_revoked"
        | "access_request"
        | "erasure_request"
        | "erasure_done"
      deal_status: "open" | "won" | "lost" | "paused" | "nurturing"
      door_kind: "aberta" | "batida" | "nenhuma"
      goal_metric:
        | "new_targets"
        | "doors_knocked"
        | "doors_opened"
        | "calls_made"
        | "replies"
        | "meetings_booked"
        | "meetings_done"
        | "visits_done"
        | "pre_registrations"
        | "published"
      goal_period: "day" | "week" | "month"
      interaction_surface:
        | "whatsapp"
        | "ligacao"
        | "visita"
        | "reuniao"
        | "instagram_dm"
        | "triagem"
      msg_direction: "in" | "out"
      msg_status:
        | "queued"
        | "sent"
        | "delivered"
        | "read"
        | "failed"
        | "received"
      msg_type:
        | "text"
        | "audio"
        | "image"
        | "video"
        | "document"
        | "template"
        | "interactive"
        | "reaction"
        | "system"
      org_kind:
        | "fornecedor"
        | "produtor"
        | "cerimonialista"
        | "espaco"
        | "empresa"
        | "outro"
      prereg_status:
        | "pending"
        | "draft_created"
        | "link_sent"
        | "in_progress"
        | "completed"
        | "published"
        | "rejected"
        | "expired"
      review_status: "new" | "approved" | "rejected" | "merged" | "duplicate"
      source_kind: "scrape" | "import" | "manual" | "api" | "referral"
      task_kind:
        | "call"
        | "visit"
        | "meeting"
        | "message"
        | "follow_up"
        | "other"
      task_status: "todo" | "doing" | "done" | "cancelled"
      temperature: "frio" | "morno" | "quente" | "cliente" | "cliente_ativo"
      user_role:
        | "admin"
        | "gestor"
        | "sdr"
        | "embaixador"
        | "leitura"
        | "financeiro"
        | "bot"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      activities: {
        Row: {
          author_kind: string
          body: string | null
          channel: Database["app"]["Enums"]["channel"] | null
          contact_id: string | null
          created_at: string
          deal_id: string | null
          duration_min: number | null
          id: string
          message_id: string | null
          metadata: Json
          occurred_at: string
          organization_id: string | null
          outcome_id: number | null
          type: Database["app"]["Enums"]["activity_type"]
          user_id: string | null
        }
        Insert: {
          author_kind?: string
          body?: string | null
          channel?: Database["app"]["Enums"]["channel"] | null
          contact_id?: string | null
          created_at?: string
          deal_id?: string | null
          duration_min?: number | null
          id?: string
          message_id?: string | null
          metadata?: Json
          occurred_at?: string
          organization_id?: string | null
          outcome_id?: number | null
          type: Database["app"]["Enums"]["activity_type"]
          user_id?: string | null
        }
        Update: {
          author_kind?: string
          body?: string | null
          channel?: Database["app"]["Enums"]["channel"] | null
          contact_id?: string | null
          created_at?: string
          deal_id?: string | null
          duration_min?: number | null
          id?: string
          message_id?: string | null
          metadata?: Json
          occurred_at?: string
          organization_id?: string | null
          outcome_id?: number | null
          type?: Database["app"]["Enums"]["activity_type"]
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "activities_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "activities_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "activities_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "deals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "activities_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "activities_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "activities_outcome_id_fkey"
            columns: ["outcome_id"]
            isOneToOne: false
            referencedRelation: "interaction_outcomes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "activities_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "activities_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "team_directory"
            referencedColumns: ["id"]
          },
        ]
      }
      allowed_domains: {
        Row: {
          created_at: string
          default_role: Database["app"]["Enums"]["user_role"]
          domain: string
          id: number
          is_active: boolean
        }
        Insert: {
          created_at?: string
          default_role?: Database["app"]["Enums"]["user_role"]
          domain: string
          id?: number
          is_active?: boolean
        }
        Update: {
          created_at?: string
          default_role?: Database["app"]["Enums"]["user_role"]
          domain?: string
          id?: number
          is_active?: boolean
        }
        Relationships: []
      }
      allowed_users: {
        Row: {
          created_at: string
          created_by: string | null
          email: string
          id: number
          note: string | null
          role: Database["app"]["Enums"]["user_role"]
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          email: string
          id?: number
          note?: string | null
          role?: Database["app"]["Enums"]["user_role"]
        }
        Update: {
          created_at?: string
          created_by?: string | null
          email?: string
          id?: number
          note?: string | null
          role?: Database["app"]["Enums"]["user_role"]
        }
        Relationships: [
          {
            foreignKeyName: "allowed_users_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "allowed_users_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "team_directory"
            referencedColumns: ["id"]
          },
        ]
      }
      audio_assets: {
        Row: {
          context: string | null
          created_at: string
          duration_sec: number | null
          id: string
          is_active: boolean
          recorded_by: string | null
          segment: string | null
          slug: string
          storage_path: string | null
          title: string
          transcript: string | null
          updated_at: string
          version: number
        }
        Insert: {
          context?: string | null
          created_at?: string
          duration_sec?: number | null
          id?: string
          is_active?: boolean
          recorded_by?: string | null
          segment?: string | null
          slug: string
          storage_path?: string | null
          title: string
          transcript?: string | null
          updated_at?: string
          version?: number
        }
        Update: {
          context?: string | null
          created_at?: string
          duration_sec?: number | null
          id?: string
          is_active?: boolean
          recorded_by?: string | null
          segment?: string | null
          slug?: string
          storage_path?: string | null
          title?: string
          transcript?: string | null
          updated_at?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "audio_assets_recorded_by_fkey"
            columns: ["recorded_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "audio_assets_recorded_by_fkey"
            columns: ["recorded_by"]
            isOneToOne: false
            referencedRelation: "team_directory"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_log: {
        Row: {
          action: string
          actor_id: string | null
          actor_role: string | null
          created_at: string
          id: number
          new_data: Json | null
          old_data: Json | null
          row_id: string
          table_name: string
        }
        Insert: {
          action: string
          actor_id?: string | null
          actor_role?: string | null
          created_at?: string
          id?: number
          new_data?: Json | null
          old_data?: Json | null
          row_id: string
          table_name: string
        }
        Update: {
          action?: string
          actor_id?: string | null
          actor_role?: string | null
          created_at?: string
          id?: number
          new_data?: Json | null
          old_data?: Json | null
          row_id?: string
          table_name?: string
        }
        Relationships: []
      }
      call_attempts: {
        Row: {
          activity_id: string | null
          atendida_em: string | null
          batch_id: string
          caminho_script: string[]
          capturas: Json
          client_key: string | null
          contact_id: string | null
          created_at: string
          duracao_seg: number | null
          encerrada_em: string | null
          id: string
          iniciada_em: string
          item_id: string
          organization_id: string
          outcome_id: number | null
          provedor: Database["app"]["Enums"]["call_provider"]
          resultado: Database["app"]["Enums"]["call_result"] | null
          script_id: string | null
          script_version: number | null
          user_id: string
          variante: string | null
        }
        Insert: {
          activity_id?: string | null
          atendida_em?: string | null
          batch_id: string
          caminho_script?: string[]
          capturas?: Json
          client_key?: string | null
          contact_id?: string | null
          created_at?: string
          duracao_seg?: number | null
          encerrada_em?: string | null
          id?: string
          iniciada_em?: string
          item_id: string
          organization_id: string
          outcome_id?: number | null
          provedor?: Database["app"]["Enums"]["call_provider"]
          resultado?: Database["app"]["Enums"]["call_result"] | null
          script_id?: string | null
          script_version?: number | null
          user_id: string
          variante?: string | null
        }
        Update: {
          activity_id?: string | null
          atendida_em?: string | null
          batch_id?: string
          caminho_script?: string[]
          capturas?: Json
          client_key?: string | null
          contact_id?: string | null
          created_at?: string
          duracao_seg?: number | null
          encerrada_em?: string | null
          id?: string
          iniciada_em?: string
          item_id?: string
          organization_id?: string
          outcome_id?: number | null
          provedor?: Database["app"]["Enums"]["call_provider"]
          resultado?: Database["app"]["Enums"]["call_result"] | null
          script_id?: string | null
          script_version?: number | null
          user_id?: string
          variante?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "call_attempts_activity_id_fkey"
            columns: ["activity_id"]
            isOneToOne: false
            referencedRelation: "activities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "call_attempts_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "call_batches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "call_attempts_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "call_attempts_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "call_attempts_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "call_batch_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "call_attempts_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "call_attempts_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "call_attempts_outcome_id_fkey"
            columns: ["outcome_id"]
            isOneToOne: false
            referencedRelation: "interaction_outcomes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "call_attempts_script_id_fkey"
            columns: ["script_id"]
            isOneToOne: false
            referencedRelation: "call_scripts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "call_attempts_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "call_attempts_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "team_directory"
            referencedColumns: ["id"]
          },
        ]
      }
      call_batch_items: {
        Row: {
          attempts: number
          batch_id: string
          contact_id: string | null
          created_at: string
          deal_id: string | null
          id: string
          last_attempt_at: string | null
          note: string | null
          organization_id: string
          phone_e164: string
          position: number
          reserved_by: string | null
          reserved_until: string | null
          scheduled_at: string | null
          stage_id: number | null
          status: Database["app"]["Enums"]["call_item_status"]
          updated_at: string
        }
        Insert: {
          attempts?: number
          batch_id: string
          contact_id?: string | null
          created_at?: string
          deal_id?: string | null
          id?: string
          last_attempt_at?: string | null
          note?: string | null
          organization_id: string
          phone_e164: string
          position: number
          reserved_by?: string | null
          reserved_until?: string | null
          scheduled_at?: string | null
          stage_id?: number | null
          status?: Database["app"]["Enums"]["call_item_status"]
          updated_at?: string
        }
        Update: {
          attempts?: number
          batch_id?: string
          contact_id?: string | null
          created_at?: string
          deal_id?: string | null
          id?: string
          last_attempt_at?: string | null
          note?: string | null
          organization_id?: string
          phone_e164?: string
          position?: number
          reserved_by?: string | null
          reserved_until?: string | null
          scheduled_at?: string | null
          stage_id?: number | null
          status?: Database["app"]["Enums"]["call_item_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "call_batch_items_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "call_batches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "call_batch_items_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "call_batch_items_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "call_batch_items_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "deals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "call_batch_items_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "call_batch_items_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "call_batch_items_reserved_by_fkey"
            columns: ["reserved_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "call_batch_items_reserved_by_fkey"
            columns: ["reserved_by"]
            isOneToOne: false
            referencedRelation: "team_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "call_batch_items_stage_id_fkey"
            columns: ["stage_id"]
            isOneToOne: false
            referencedRelation: "stages"
            referencedColumns: ["id"]
          },
        ]
      }
      call_batches: {
        Row: {
          created_at: string
          ends_on: string
          id: string
          max_attempts: number
          min_hours_between_attempts: number
          nome: string
          order_mode: Database["app"]["Enums"]["call_order"]
          owner_id: string
          pending: number
          pipeline_id: number
          script_id: string
          script_version: number
          seed: number
          starts_on: string
          status: Database["app"]["Enums"]["call_batch_status"]
          talked: number
          target_calls: number | null
          temperature_origin: Database["app"]["Enums"]["temperature"]
          total: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          ends_on: string
          id?: string
          max_attempts?: number
          min_hours_between_attempts?: number
          nome: string
          order_mode?: Database["app"]["Enums"]["call_order"]
          owner_id: string
          pending?: number
          pipeline_id: number
          script_id: string
          script_version: number
          seed?: number
          starts_on: string
          status?: Database["app"]["Enums"]["call_batch_status"]
          talked?: number
          target_calls?: number | null
          temperature_origin: Database["app"]["Enums"]["temperature"]
          total?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          ends_on?: string
          id?: string
          max_attempts?: number
          min_hours_between_attempts?: number
          nome?: string
          order_mode?: Database["app"]["Enums"]["call_order"]
          owner_id?: string
          pending?: number
          pipeline_id?: number
          script_id?: string
          script_version?: number
          seed?: number
          starts_on?: string
          status?: Database["app"]["Enums"]["call_batch_status"]
          talked?: number
          target_calls?: number | null
          temperature_origin?: Database["app"]["Enums"]["temperature"]
          total?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "call_batches_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "call_batches_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "team_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "call_batches_pipeline_id_fkey"
            columns: ["pipeline_id"]
            isOneToOne: false
            referencedRelation: "pipelines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "call_batches_script_id_fkey"
            columns: ["script_id"]
            isOneToOne: false
            referencedRelation: "call_scripts"
            referencedColumns: ["id"]
          },
        ]
      }
      call_scripts: {
        Row: {
          arvore: Json
          created_at: string
          created_by: string | null
          id: string
          is_published: boolean
          nome: string
          published_at: string | null
          slug: string
          versao: number
        }
        Insert: {
          arvore: Json
          created_at?: string
          created_by?: string | null
          id?: string
          is_published?: boolean
          nome: string
          published_at?: string | null
          slug: string
          versao: number
        }
        Update: {
          arvore?: Json
          created_at?: string
          created_by?: string | null
          id?: string
          is_published?: boolean
          nome?: string
          published_at?: string | null
          slug?: string
          versao?: number
        }
        Relationships: [
          {
            foreignKeyName: "call_scripts_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "call_scripts_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "team_directory"
            referencedColumns: ["id"]
          },
        ]
      }
      categories: {
        Row: {
          created_at: string
          group: string
          id: number
          is_active: boolean
          komune_category_key: string | null
          name: string
          position: number
          priority: number
          slug: string
        }
        Insert: {
          created_at?: string
          group: string
          id?: number
          is_active?: boolean
          komune_category_key?: string | null
          name: string
          position?: number
          priority?: number
          slug: string
        }
        Update: {
          created_at?: string
          group?: string
          id?: number
          is_active?: boolean
          komune_category_key?: string | null
          name?: string
          position?: number
          priority?: number
          slug?: string
        }
        Relationships: []
      }
      cities: {
        Row: {
          created_at: string
          ibge_code: string | null
          id: number
          is_metro_natal: boolean
          name: string
          state: string
        }
        Insert: {
          created_at?: string
          ibge_code?: string | null
          id?: number
          is_metro_natal?: boolean
          name: string
          state: string
        }
        Update: {
          created_at?: string
          ibge_code?: string | null
          id?: number
          is_metro_natal?: boolean
          name?: string
          state?: string
        }
        Relationships: []
      }
      consent_events: {
        Row: {
          channel: Database["app"]["Enums"]["channel"] | null
          contact_id: string | null
          created_at: string
          evidence_message_id: string | null
          evidence_text: string | null
          evidence_url: string | null
          id: string
          kind: Database["app"]["Enums"]["consent_kind"]
          occurred_at: string
          organization_id: string | null
          recorded_by: string | null
        }
        Insert: {
          channel?: Database["app"]["Enums"]["channel"] | null
          contact_id?: string | null
          created_at?: string
          evidence_message_id?: string | null
          evidence_text?: string | null
          evidence_url?: string | null
          id?: string
          kind: Database["app"]["Enums"]["consent_kind"]
          occurred_at?: string
          organization_id?: string | null
          recorded_by?: string | null
        }
        Update: {
          channel?: Database["app"]["Enums"]["channel"] | null
          contact_id?: string | null
          created_at?: string
          evidence_message_id?: string | null
          evidence_text?: string | null
          evidence_url?: string | null
          id?: string
          kind?: Database["app"]["Enums"]["consent_kind"]
          occurred_at?: string
          organization_id?: string | null
          recorded_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "consent_events_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "consent_events_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "consent_events_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "consent_events_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "consent_events_recorded_by_fkey"
            columns: ["recorded_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "consent_events_recorded_by_fkey"
            columns: ["recorded_by"]
            isOneToOne: false
            referencedRelation: "team_directory"
            referencedColumns: ["id"]
          },
        ]
      }
      contacts: {
        Row: {
          anonymized_at: string | null
          created_at: string
          deleted_at: string | null
          do_not_contact: boolean
          email: string | null
          first_name: string | null
          full_name: string
          id: string
          instagram_handle: string | null
          is_decision_maker: boolean
          notes: string | null
          phone_e164: string | null
          preferred_channel: Database["app"]["Enums"]["channel"]
          role_title: string | null
          source_id: number | null
          updated_at: string
        }
        Insert: {
          anonymized_at?: string | null
          created_at?: string
          deleted_at?: string | null
          do_not_contact?: boolean
          email?: string | null
          first_name?: string | null
          full_name: string
          id?: string
          instagram_handle?: string | null
          is_decision_maker?: boolean
          notes?: string | null
          phone_e164?: string | null
          preferred_channel?: Database["app"]["Enums"]["channel"]
          role_title?: string | null
          source_id?: number | null
          updated_at?: string
        }
        Update: {
          anonymized_at?: string | null
          created_at?: string
          deleted_at?: string | null
          do_not_contact?: boolean
          email?: string | null
          first_name?: string | null
          full_name?: string
          id?: string
          instagram_handle?: string | null
          is_decision_maker?: boolean
          notes?: string | null
          phone_e164?: string | null
          preferred_channel?: Database["app"]["Enums"]["channel"]
          role_title?: string | null
          source_id?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "contacts_source_id_fkey"
            columns: ["source_id"]
            isOneToOne: false
            referencedRelation: "sources"
            referencedColumns: ["id"]
          },
        ]
      }
      deal_stage_history: {
        Row: {
          changed_at: string
          changed_by: string | null
          deal_id: string
          from_stage_id: number | null
          id: number
          reason: string | null
          to_stage_id: number
        }
        Insert: {
          changed_at?: string
          changed_by?: string | null
          deal_id: string
          from_stage_id?: number | null
          id?: number
          reason?: string | null
          to_stage_id: number
        }
        Update: {
          changed_at?: string
          changed_by?: string | null
          deal_id?: string
          from_stage_id?: number | null
          id?: number
          reason?: string | null
          to_stage_id?: number
        }
        Relationships: [
          {
            foreignKeyName: "deal_stage_history_changed_by_fkey"
            columns: ["changed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deal_stage_history_changed_by_fkey"
            columns: ["changed_by"]
            isOneToOne: false
            referencedRelation: "team_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deal_stage_history_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "deals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deal_stage_history_from_stage_id_fkey"
            columns: ["from_stage_id"]
            isOneToOne: false
            referencedRelation: "stages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deal_stage_history_to_stage_id_fkey"
            columns: ["to_stage_id"]
            isOneToOne: false
            referencedRelation: "stages"
            referencedColumns: ["id"]
          },
        ]
      }
      deals: {
        Row: {
          ai_next_action: Json | null
          ai_summary: string | null
          created_at: string
          entered_stage_at: string
          id: string
          last_activity_at: string | null
          last_intent: string | null
          last_intent_at: string | null
          lost_at: string | null
          lost_reason_id: number | null
          needs_attention: boolean
          next_action: string | null
          next_action_at: string | null
          organization_id: string
          owner_id: string | null
          paused_until: string | null
          pipeline_id: number
          primary_contact_id: string | null
          score: number | null
          score_breakdown: Json | null
          source_id: number | null
          stage_change_reason: string | null
          stage_id: number
          status: Database["app"]["Enums"]["deal_status"]
          temperature: Database["app"]["Enums"]["temperature"]
          tier: string | null
          updated_at: string
          won_at: string | null
        }
        Insert: {
          ai_next_action?: Json | null
          ai_summary?: string | null
          created_at?: string
          entered_stage_at?: string
          id?: string
          last_activity_at?: string | null
          last_intent?: string | null
          last_intent_at?: string | null
          lost_at?: string | null
          lost_reason_id?: number | null
          needs_attention?: boolean
          next_action?: string | null
          next_action_at?: string | null
          organization_id: string
          owner_id?: string | null
          paused_until?: string | null
          pipeline_id: number
          primary_contact_id?: string | null
          score?: number | null
          score_breakdown?: Json | null
          source_id?: number | null
          stage_change_reason?: string | null
          stage_id: number
          status?: Database["app"]["Enums"]["deal_status"]
          temperature?: Database["app"]["Enums"]["temperature"]
          tier?: string | null
          updated_at?: string
          won_at?: string | null
        }
        Update: {
          ai_next_action?: Json | null
          ai_summary?: string | null
          created_at?: string
          entered_stage_at?: string
          id?: string
          last_activity_at?: string | null
          last_intent?: string | null
          last_intent_at?: string | null
          lost_at?: string | null
          lost_reason_id?: number | null
          needs_attention?: boolean
          next_action?: string | null
          next_action_at?: string | null
          organization_id?: string
          owner_id?: string | null
          paused_until?: string | null
          pipeline_id?: number
          primary_contact_id?: string | null
          score?: number | null
          score_breakdown?: Json | null
          source_id?: number | null
          stage_change_reason?: string | null
          stage_id?: number
          status?: Database["app"]["Enums"]["deal_status"]
          temperature?: Database["app"]["Enums"]["temperature"]
          tier?: string | null
          updated_at?: string
          won_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "deals_lost_reason_id_fkey"
            columns: ["lost_reason_id"]
            isOneToOne: false
            referencedRelation: "lost_reasons"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deals_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deals_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deals_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deals_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "team_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deals_pipeline_id_fkey"
            columns: ["pipeline_id"]
            isOneToOne: false
            referencedRelation: "pipelines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deals_primary_contact_id_fkey"
            columns: ["primary_contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deals_primary_contact_id_fkey"
            columns: ["primary_contact_id"]
            isOneToOne: false
            referencedRelation: "contacts_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deals_source_id_fkey"
            columns: ["source_id"]
            isOneToOne: false
            referencedRelation: "sources"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deals_stage_id_fkey"
            columns: ["stage_id"]
            isOneToOne: false
            referencedRelation: "stages"
            referencedColumns: ["id"]
          },
        ]
      }
      goals: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          metric: Database["app"]["Enums"]["goal_metric"]
          note: string | null
          period: Database["app"]["Enums"]["goal_period"]
          period_start: string
          target: number
          team_id: number | null
          updated_at: string
          user_id: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          metric: Database["app"]["Enums"]["goal_metric"]
          note?: string | null
          period: Database["app"]["Enums"]["goal_period"]
          period_start: string
          target: number
          team_id?: number | null
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          metric?: Database["app"]["Enums"]["goal_metric"]
          note?: string | null
          period?: Database["app"]["Enums"]["goal_period"]
          period_start?: string
          target?: number
          team_id?: number | null
          updated_at?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "goals_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "goals_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "team_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "goals_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "goals_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "goals_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "team_directory"
            referencedColumns: ["id"]
          },
        ]
      }
      holidays: {
        Row: {
          date: string
          id: number
          name: string
          scope: string
        }
        Insert: {
          date: string
          id?: number
          name: string
          scope?: string
        }
        Update: {
          date?: string
          id?: number
          name?: string
          scope?: string
        }
        Relationships: []
      }
      interaction_outcomes: {
        Row: {
          can_reactivate: boolean
          cooldown_days: number
          counts_as: Database["app"]["Enums"]["door_kind"]
          created_at: string
          id: number
          is_active: boolean
          name: string
          next_action_kind: Database["app"]["Enums"]["task_kind"] | null
          next_action_label: string | null
          next_action_offset_days: number | null
          position: number
          requires_answer: boolean
          requires_lost_reason: boolean
          sets_temperature: Database["app"]["Enums"]["temperature"] | null
          slug: string
          surfaces: Database["app"]["Enums"]["interaction_surface"][]
          target_stage_slug: string | null
        }
        Insert: {
          can_reactivate?: boolean
          cooldown_days?: number
          counts_as?: Database["app"]["Enums"]["door_kind"]
          created_at?: string
          id?: number
          is_active?: boolean
          name: string
          next_action_kind?: Database["app"]["Enums"]["task_kind"] | null
          next_action_label?: string | null
          next_action_offset_days?: number | null
          position?: number
          requires_answer?: boolean
          requires_lost_reason?: boolean
          sets_temperature?: Database["app"]["Enums"]["temperature"] | null
          slug: string
          surfaces: Database["app"]["Enums"]["interaction_surface"][]
          target_stage_slug?: string | null
        }
        Update: {
          can_reactivate?: boolean
          cooldown_days?: number
          counts_as?: Database["app"]["Enums"]["door_kind"]
          created_at?: string
          id?: number
          is_active?: boolean
          name?: string
          next_action_kind?: Database["app"]["Enums"]["task_kind"] | null
          next_action_label?: string | null
          next_action_offset_days?: number | null
          position?: number
          requires_answer?: boolean
          requires_lost_reason?: boolean
          sets_temperature?: Database["app"]["Enums"]["temperature"] | null
          slug?: string
          surfaces?: Database["app"]["Enums"]["interaction_surface"][]
          target_stage_slug?: string | null
        }
        Relationships: []
      }
      lost_reasons: {
        Row: {
          id: number
          is_active: boolean
          name: string
          position: number
          slug: string
        }
        Insert: {
          id?: number
          is_active?: boolean
          name: string
          position?: number
          slug: string
        }
        Update: {
          id?: number
          is_active?: boolean
          name?: string
          position?: number
          slug?: string
        }
        Relationships: []
      }
      message_templates: {
        Row: {
          audio_asset_id: string | null
          body: string
          category: string
          channel: Database["app"]["Enums"]["channel"]
          created_at: string
          id: number
          is_active: boolean
          kind: string | null
          language: string
          meta_status: string | null
          meta_template_name: string | null
          name: string
          segment: string | null
          template_code: string
          updated_at: string
          variables: Json
          variant: string | null
          version: number
        }
        Insert: {
          audio_asset_id?: string | null
          body: string
          category?: string
          channel?: Database["app"]["Enums"]["channel"]
          created_at?: string
          id?: number
          is_active?: boolean
          kind?: string | null
          language?: string
          meta_status?: string | null
          meta_template_name?: string | null
          name: string
          segment?: string | null
          template_code: string
          updated_at?: string
          variables?: Json
          variant?: string | null
          version?: number
        }
        Update: {
          audio_asset_id?: string | null
          body?: string
          category?: string
          channel?: Database["app"]["Enums"]["channel"]
          created_at?: string
          id?: number
          is_active?: boolean
          kind?: string | null
          language?: string
          meta_status?: string | null
          meta_template_name?: string | null
          name?: string
          segment?: string | null
          template_code?: string
          updated_at?: string
          variables?: Json
          variant?: string | null
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "message_templates_audio_asset_id_fkey"
            columns: ["audio_asset_id"]
            isOneToOne: false
            referencedRelation: "audio_assets"
            referencedColumns: ["id"]
          },
        ]
      }
      organization_categories: {
        Row: {
          category_id: number
          created_at: string
          is_primary: boolean
          organization_id: string
        }
        Insert: {
          category_id: number
          created_at?: string
          is_primary?: boolean
          organization_id: string
        }
        Update: {
          category_id?: number
          created_at?: string
          is_primary?: boolean
          organization_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "organization_categories_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "organization_categories_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "organization_categories_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations_view"
            referencedColumns: ["id"]
          },
        ]
      }
      organization_contacts: {
        Row: {
          contact_id: string
          created_at: string
          is_primary: boolean
          organization_id: string
          role: string | null
        }
        Insert: {
          contact_id: string
          created_at?: string
          is_primary?: boolean
          organization_id: string
          role?: string | null
        }
        Update: {
          contact_id?: string
          created_at?: string
          is_primary?: boolean
          organization_id?: string
          role?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "organization_contacts_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "organization_contacts_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "organization_contacts_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "organization_contacts_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations_view"
            referencedColumns: ["id"]
          },
        ]
      }
      organization_tags: {
        Row: {
          organization_id: string
          tag_id: number
        }
        Insert: {
          organization_id: string
          tag_id: number
        }
        Update: {
          organization_id?: string
          tag_id?: number
        }
        Relationships: [
          {
            foreignKeyName: "organization_tags_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "organization_tags_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "organization_tags_tag_id_fkey"
            columns: ["tag_id"]
            isOneToOne: false
            referencedRelation: "tags"
            referencedColumns: ["id"]
          },
        ]
      }
      organizations: {
        Row: {
          address: string | null
          anonymized_at: string | null
          city_id: number | null
          cnpj: string | null
          collected_at: string
          collector: string
          created_at: string
          custom: Json
          deleted_at: string | null
          description: string | null
          do_not_contact: boolean
          email: string | null
          id: string
          instagram_handle: string | null
          is_natural_person: boolean
          kind: Database["app"]["Enums"]["org_kind"]
          komune_supplier_id: string | null
          lat: number | null
          legal_name: string | null
          lng: number | null
          name: string
          neighborhood: string | null
          owner_id: string | null
          phone_e164: string | null
          place_id: string | null
          price_range: string | null
          rating: number | null
          reviews_count: number | null
          search_name: string | null
          source_id: number
          source_url: string | null
          temperature: Database["app"]["Enums"]["temperature"]
          temperature_override: number | null
          temperature_override_at: string | null
          temperature_override_by: string | null
          temperature_override_reason: string | null
          updated_at: string
          vip: boolean
          website: string | null
          website_domain: string | null
        }
        Insert: {
          address?: string | null
          anonymized_at?: string | null
          city_id?: number | null
          cnpj?: string | null
          collected_at?: string
          collector: string
          created_at?: string
          custom?: Json
          deleted_at?: string | null
          description?: string | null
          do_not_contact?: boolean
          email?: string | null
          id?: string
          instagram_handle?: string | null
          is_natural_person?: boolean
          kind?: Database["app"]["Enums"]["org_kind"]
          komune_supplier_id?: string | null
          lat?: number | null
          legal_name?: string | null
          lng?: number | null
          name: string
          neighborhood?: string | null
          owner_id?: string | null
          phone_e164?: string | null
          place_id?: string | null
          price_range?: string | null
          rating?: number | null
          reviews_count?: number | null
          search_name?: string | null
          source_id: number
          source_url?: string | null
          temperature?: Database["app"]["Enums"]["temperature"]
          temperature_override?: number | null
          temperature_override_at?: string | null
          temperature_override_by?: string | null
          temperature_override_reason?: string | null
          updated_at?: string
          vip?: boolean
          website?: string | null
          website_domain?: string | null
        }
        Update: {
          address?: string | null
          anonymized_at?: string | null
          city_id?: number | null
          cnpj?: string | null
          collected_at?: string
          collector?: string
          created_at?: string
          custom?: Json
          deleted_at?: string | null
          description?: string | null
          do_not_contact?: boolean
          email?: string | null
          id?: string
          instagram_handle?: string | null
          is_natural_person?: boolean
          kind?: Database["app"]["Enums"]["org_kind"]
          komune_supplier_id?: string | null
          lat?: number | null
          legal_name?: string | null
          lng?: number | null
          name?: string
          neighborhood?: string | null
          owner_id?: string | null
          phone_e164?: string | null
          place_id?: string | null
          price_range?: string | null
          rating?: number | null
          reviews_count?: number | null
          search_name?: string | null
          source_id?: number
          source_url?: string | null
          temperature?: Database["app"]["Enums"]["temperature"]
          temperature_override?: number | null
          temperature_override_at?: string | null
          temperature_override_by?: string | null
          temperature_override_reason?: string | null
          updated_at?: string
          vip?: boolean
          website?: string | null
          website_domain?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "organizations_city_id_fkey"
            columns: ["city_id"]
            isOneToOne: false
            referencedRelation: "cities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "organizations_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "organizations_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "team_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "organizations_source_id_fkey"
            columns: ["source_id"]
            isOneToOne: false
            referencedRelation: "sources"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "organizations_temperature_override_by_fkey"
            columns: ["temperature_override_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "organizations_temperature_override_by_fkey"
            columns: ["temperature_override_by"]
            isOneToOne: false
            referencedRelation: "team_directory"
            referencedColumns: ["id"]
          },
        ]
      }
      pii_access_log: {
        Row: {
          action: string
          actor_id: string
          actor_role: string | null
          created_at: string
          entity_id: string | null
          entity_type: string | null
          id: number
          scope: Json | null
        }
        Insert: {
          action: string
          actor_id: string
          actor_role?: string | null
          created_at?: string
          entity_id?: string | null
          entity_type?: string | null
          id?: number
          scope?: Json | null
        }
        Update: {
          action?: string
          actor_id?: string
          actor_role?: string | null
          created_at?: string
          entity_id?: string | null
          entity_type?: string | null
          id?: number
          scope?: Json | null
        }
        Relationships: []
      }
      pipelines: {
        Row: {
          created_at: string
          id: number
          kind: Database["app"]["Enums"]["org_kind"]
          name: string
          position: number
          slug: string
        }
        Insert: {
          created_at?: string
          id?: number
          kind: Database["app"]["Enums"]["org_kind"]
          name: string
          position?: number
          slug: string
        }
        Update: {
          created_at?: string
          id?: number
          kind?: Database["app"]["Enums"]["org_kind"]
          name?: string
          position?: number
          slug?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          city_id: number | null
          created_at: string
          daily_digest_at: string
          full_name: string
          id: string
          is_active: boolean
          phone_e164: string | null
          role: Database["app"]["Enums"]["user_role"]
          team_id: number | null
          updated_at: string
        }
        Insert: {
          city_id?: number | null
          created_at?: string
          daily_digest_at?: string
          full_name: string
          id: string
          is_active?: boolean
          phone_e164?: string | null
          role?: Database["app"]["Enums"]["user_role"]
          team_id?: number | null
          updated_at?: string
        }
        Update: {
          city_id?: number | null
          created_at?: string
          daily_digest_at?: string
          full_name?: string
          id?: string
          is_active?: boolean
          phone_e164?: string | null
          role?: Database["app"]["Enums"]["user_role"]
          team_id?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "profiles_city_id_fkey"
            columns: ["city_id"]
            isOneToOne: false
            referencedRelation: "cities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "profiles_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      sources: {
        Row: {
          base_url: string | null
          config: Json
          created_at: string
          id: number
          is_enabled: boolean
          kind: Database["app"]["Enums"]["source_kind"]
          legal_basis: string
          name: string
          rate_limit_seconds: number
          robots_ok: boolean | null
          slug: string
          terms_notes: string | null
        }
        Insert: {
          base_url?: string | null
          config?: Json
          created_at?: string
          id?: number
          is_enabled?: boolean
          kind: Database["app"]["Enums"]["source_kind"]
          legal_basis?: string
          name: string
          rate_limit_seconds?: number
          robots_ok?: boolean | null
          slug: string
          terms_notes?: string | null
        }
        Update: {
          base_url?: string | null
          config?: Json
          created_at?: string
          id?: number
          is_enabled?: boolean
          kind?: Database["app"]["Enums"]["source_kind"]
          legal_basis?: string
          name?: string
          rate_limit_seconds?: number
          robots_ok?: boolean | null
          slug?: string
          terms_notes?: string | null
        }
        Relationships: []
      }
      stage_equivalences: {
        Row: {
          canonical_slug: string
          created_at: string
          id: number
          note: string | null
          pipeline_id: number
          stage_slug: string
        }
        Insert: {
          canonical_slug: string
          created_at?: string
          id?: never
          note?: string | null
          pipeline_id: number
          stage_slug: string
        }
        Update: {
          canonical_slug?: string
          created_at?: string
          id?: never
          note?: string | null
          pipeline_id?: number
          stage_slug?: string
        }
        Relationships: [
          {
            foreignKeyName: "stage_equivalences_pipeline_id_fkey"
            columns: ["pipeline_id"]
            isOneToOne: false
            referencedRelation: "pipelines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stage_equivalences_pipeline_id_stage_slug_fkey"
            columns: ["pipeline_id", "stage_slug"]
            isOneToOne: false
            referencedRelation: "stages"
            referencedColumns: ["pipeline_id", "slug"]
          },
        ]
      }
      stages: {
        Row: {
          automations: Json
          created_at: string
          id: number
          is_dormant: boolean
          is_lost: boolean
          is_optout: boolean
          is_terminal: boolean
          is_won: boolean
          name: string
          pipeline_id: number
          position: number
          required_fields: Json
          sla_hours: number | null
          slug: string
          temperature: Database["app"]["Enums"]["temperature"]
        }
        Insert: {
          automations?: Json
          created_at?: string
          id?: number
          is_dormant?: boolean
          is_lost?: boolean
          is_optout?: boolean
          is_terminal?: boolean
          is_won?: boolean
          name: string
          pipeline_id: number
          position: number
          required_fields?: Json
          sla_hours?: number | null
          slug: string
          temperature?: Database["app"]["Enums"]["temperature"]
        }
        Update: {
          automations?: Json
          created_at?: string
          id?: number
          is_dormant?: boolean
          is_lost?: boolean
          is_optout?: boolean
          is_terminal?: boolean
          is_won?: boolean
          name?: string
          pipeline_id?: number
          position?: number
          required_fields?: Json
          sla_hours?: number | null
          slug?: string
          temperature?: Database["app"]["Enums"]["temperature"]
        }
        Relationships: [
          {
            foreignKeyName: "stages_pipeline_id_fkey"
            columns: ["pipeline_id"]
            isOneToOne: false
            referencedRelation: "pipelines"
            referencedColumns: ["id"]
          },
        ]
      }
      supplier_candidates: {
        Row: {
          address: string | null
          category_id: number | null
          city_id: number | null
          cnpj: string | null
          collected_at: string
          collector: string
          created_at: string
          created_by: string | null
          do_not_contact: boolean
          email: string | null
          external_id: string | null
          flags: string[]
          id: string
          instagram_handle: string | null
          is_natural_person: boolean
          kind: Database["app"]["Enums"]["org_kind"]
          legal_name: string | null
          name: string
          neighborhood: string | null
          notes: string | null
          organization_id: string | null
          payload: Json
          phone_e164: string | null
          place_id: string | null
          rating: number | null
          review_reason: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          reviews_count: number | null
          score: number | null
          search_name: string | null
          source_id: number
          source_url: string | null
          status: Database["app"]["Enums"]["candidate_status"]
          tier: string | null
          updated_at: string
          website: string | null
          website_domain: string | null
        }
        Insert: {
          address?: string | null
          category_id?: number | null
          city_id?: number | null
          cnpj?: string | null
          collected_at?: string
          collector: string
          created_at?: string
          created_by?: string | null
          do_not_contact?: boolean
          email?: string | null
          external_id?: string | null
          flags?: string[]
          id?: string
          instagram_handle?: string | null
          is_natural_person?: boolean
          kind?: Database["app"]["Enums"]["org_kind"]
          legal_name?: string | null
          name: string
          neighborhood?: string | null
          notes?: string | null
          organization_id?: string | null
          payload?: Json
          phone_e164?: string | null
          place_id?: string | null
          rating?: number | null
          review_reason?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          reviews_count?: number | null
          score?: number | null
          search_name?: string | null
          source_id: number
          source_url?: string | null
          status?: Database["app"]["Enums"]["candidate_status"]
          tier?: string | null
          updated_at?: string
          website?: string | null
          website_domain?: string | null
        }
        Update: {
          address?: string | null
          category_id?: number | null
          city_id?: number | null
          cnpj?: string | null
          collected_at?: string
          collector?: string
          created_at?: string
          created_by?: string | null
          do_not_contact?: boolean
          email?: string | null
          external_id?: string | null
          flags?: string[]
          id?: string
          instagram_handle?: string | null
          is_natural_person?: boolean
          kind?: Database["app"]["Enums"]["org_kind"]
          legal_name?: string | null
          name?: string
          neighborhood?: string | null
          notes?: string | null
          organization_id?: string | null
          payload?: Json
          phone_e164?: string | null
          place_id?: string | null
          rating?: number | null
          review_reason?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          reviews_count?: number | null
          score?: number | null
          search_name?: string | null
          source_id?: number
          source_url?: string | null
          status?: Database["app"]["Enums"]["candidate_status"]
          tier?: string | null
          updated_at?: string
          website?: string | null
          website_domain?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "supplier_candidates_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplier_candidates_city_id_fkey"
            columns: ["city_id"]
            isOneToOne: false
            referencedRelation: "cities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplier_candidates_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplier_candidates_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "team_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplier_candidates_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplier_candidates_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplier_candidates_reviewed_by_fkey"
            columns: ["reviewed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplier_candidates_reviewed_by_fkey"
            columns: ["reviewed_by"]
            isOneToOne: false
            referencedRelation: "team_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplier_candidates_source_id_fkey"
            columns: ["source_id"]
            isOneToOne: false
            referencedRelation: "sources"
            referencedColumns: ["id"]
          },
        ]
      }
      suppression_list: {
        Row: {
          channel: Database["app"]["Enums"]["channel"] | null
          created_at: string
          created_by: string | null
          hash: string
          id: number
          kind: string
          reason: string | null
          source_event_id: string | null
        }
        Insert: {
          channel?: Database["app"]["Enums"]["channel"] | null
          created_at?: string
          created_by?: string | null
          hash: string
          id?: number
          kind: string
          reason?: string | null
          source_event_id?: string | null
        }
        Update: {
          channel?: Database["app"]["Enums"]["channel"] | null
          created_at?: string
          created_by?: string | null
          hash?: string
          id?: number
          kind?: string
          reason?: string | null
          source_event_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "suppression_list_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "suppression_list_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "team_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "suppression_list_source_event_id_fkey"
            columns: ["source_event_id"]
            isOneToOne: false
            referencedRelation: "consent_events"
            referencedColumns: ["id"]
          },
        ]
      }
      tags: {
        Row: {
          color: string | null
          created_at: string
          id: number
          name: string
        }
        Insert: {
          color?: string | null
          created_at?: string
          id?: number
          name: string
        }
        Update: {
          color?: string | null
          created_at?: string
          id?: number
          name?: string
        }
        Relationships: []
      }
      tasks: {
        Row: {
          assignee_id: string | null
          completed_at: string | null
          contact_id: string | null
          created_at: string
          created_by: string | null
          deal_id: string | null
          due_at: string | null
          id: string
          kind: Database["app"]["Enums"]["task_kind"]
          organization_id: string | null
          origin: string
          priority: number
          status: Database["app"]["Enums"]["task_status"]
          title: string
          updated_at: string
        }
        Insert: {
          assignee_id?: string | null
          completed_at?: string | null
          contact_id?: string | null
          created_at?: string
          created_by?: string | null
          deal_id?: string | null
          due_at?: string | null
          id?: string
          kind?: Database["app"]["Enums"]["task_kind"]
          organization_id?: string | null
          origin?: string
          priority?: number
          status?: Database["app"]["Enums"]["task_status"]
          title: string
          updated_at?: string
        }
        Update: {
          assignee_id?: string | null
          completed_at?: string | null
          contact_id?: string | null
          created_at?: string
          created_by?: string | null
          deal_id?: string | null
          due_at?: string | null
          id?: string
          kind?: Database["app"]["Enums"]["task_kind"]
          organization_id?: string | null
          origin?: string
          priority?: number
          status?: Database["app"]["Enums"]["task_status"]
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "tasks_assignee_id_fkey"
            columns: ["assignee_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_assignee_id_fkey"
            columns: ["assignee_id"]
            isOneToOne: false
            referencedRelation: "team_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "team_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "deals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations_view"
            referencedColumns: ["id"]
          },
        ]
      }
      teams: {
        Row: {
          created_at: string
          id: number
          name: string
        }
        Insert: {
          created_at?: string
          id?: number
          name: string
        }
        Update: {
          created_at?: string
          id?: number
          name?: string
        }
        Relationships: []
      }
    }
    Views: {
      contacts_view: {
        Row: {
          anonymized_at: string | null
          created_at: string | null
          deleted_at: string | null
          do_not_contact: boolean | null
          email: string | null
          first_name: string | null
          full_name: string | null
          id: string | null
          instagram_handle: string | null
          is_decision_maker: boolean | null
          notes: string | null
          phone_e164: string | null
          phone_is_masked: boolean | null
          preferred_channel: Database["app"]["Enums"]["channel"] | null
          role_title: string | null
          source_id: number | null
          updated_at: string | null
        }
        Insert: {
          anonymized_at?: string | null
          created_at?: string | null
          deleted_at?: string | null
          do_not_contact?: boolean | null
          email?: string | null
          first_name?: string | null
          full_name?: string | null
          id?: string | null
          instagram_handle?: string | null
          is_decision_maker?: boolean | null
          notes?: string | null
          phone_e164?: never
          phone_is_masked?: never
          preferred_channel?: Database["app"]["Enums"]["channel"] | null
          role_title?: string | null
          source_id?: number | null
          updated_at?: string | null
        }
        Update: {
          anonymized_at?: string | null
          created_at?: string | null
          deleted_at?: string | null
          do_not_contact?: boolean | null
          email?: string | null
          first_name?: string | null
          full_name?: string | null
          id?: string | null
          instagram_handle?: string | null
          is_decision_maker?: boolean | null
          notes?: string | null
          phone_e164?: never
          phone_is_masked?: never
          preferred_channel?: Database["app"]["Enums"]["channel"] | null
          role_title?: string | null
          source_id?: number | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "contacts_source_id_fkey"
            columns: ["source_id"]
            isOneToOne: false
            referencedRelation: "sources"
            referencedColumns: ["id"]
          },
        ]
      }
      organizations_view: {
        Row: {
          address: string | null
          anonymized_at: string | null
          city_id: number | null
          city_name: string | null
          cnpj: string | null
          collected_at: string | null
          collector: string | null
          created_at: string | null
          custom: Json | null
          deleted_at: string | null
          description: string | null
          do_not_contact: boolean | null
          email: string | null
          id: string | null
          instagram_handle: string | null
          is_natural_person: boolean | null
          kind: Database["app"]["Enums"]["org_kind"] | null
          komune_supplier_id: string | null
          lat: number | null
          legal_name: string | null
          lng: number | null
          name: string | null
          neighborhood: string | null
          owner_id: string | null
          phone_e164: string | null
          phone_is_masked: boolean | null
          price_range: string | null
          primary_category_id: number | null
          primary_category_name: string | null
          rating: number | null
          reviews_count: number | null
          search_name: string | null
          source_id: number | null
          source_url: string | null
          temperature: Database["app"]["Enums"]["temperature"] | null
          temperature_override: number | null
          temperature_override_at: string | null
          temperature_override_by: string | null
          temperature_override_reason: string | null
          updated_at: string | null
          vip: boolean | null
          website: string | null
          website_domain: string | null
        }
        Relationships: [
          {
            foreignKeyName: "organization_categories_category_id_fkey"
            columns: ["primary_category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "organizations_city_id_fkey"
            columns: ["city_id"]
            isOneToOne: false
            referencedRelation: "cities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "organizations_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "organizations_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "team_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "organizations_source_id_fkey"
            columns: ["source_id"]
            isOneToOne: false
            referencedRelation: "sources"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "organizations_temperature_override_by_fkey"
            columns: ["temperature_override_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "organizations_temperature_override_by_fkey"
            columns: ["temperature_override_by"]
            isOneToOne: false
            referencedRelation: "team_directory"
            referencedColumns: ["id"]
          },
        ]
      }
      team_directory: {
        Row: {
          city_id: number | null
          full_name: string | null
          id: string | null
          is_active: boolean | null
          role: Database["app"]["Enums"]["user_role"] | null
          team_id: number | null
        }
        Insert: {
          city_id?: number | null
          full_name?: string | null
          id?: string | null
          is_active?: boolean | null
          role?: Database["app"]["Enums"]["user_role"] | null
          team_id?: number | null
        }
        Update: {
          city_id?: number | null
          full_name?: string | null
          id?: string | null
          is_active?: boolean | null
          role?: Database["app"]["Enums"]["user_role"] | null
          team_id?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "profiles_city_id_fkey"
            columns: ["city_id"]
            isOneToOne: false
            referencedRelation: "cities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "profiles_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      v_call_script_steps: {
        Row: {
          attempt_id: string | null
          batch_id: string | null
          iniciada_em: string | null
          no_id: string | null
          organization_id: string | null
          outcome_id: number | null
          passo: number | null
          resultado: Database["app"]["Enums"]["call_result"] | null
          script_id: string | null
          script_version: number | null
          ultimo_no: boolean | null
          user_id: string | null
          variante: string | null
        }
        Relationships: [
          {
            foreignKeyName: "call_attempts_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "call_batches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "call_attempts_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "call_attempts_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "call_attempts_outcome_id_fkey"
            columns: ["outcome_id"]
            isOneToOne: false
            referencedRelation: "interaction_outcomes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "call_attempts_script_id_fkey"
            columns: ["script_id"]
            isOneToOne: false
            referencedRelation: "call_scripts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "call_attempts_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "call_attempts_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "team_directory"
            referencedColumns: ["id"]
          },
        ]
      }
      v_contact_cooldown: {
        Row: {
          blocked_forever: boolean | null
          cooldown_until: string | null
          organization_id: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      custom_access_token_hook: { Args: { event: Json }; Returns: Json }
      deal_stage_timeline: {
        Args: { p_deal_id: string }
        Returns: {
          changed_at: string
          changed_by: string
          changed_by_name: string
          from_stage_id: number
          from_stage_name: string
          id: number
          reason: string
          to_stage_id: number
          to_stage_name: string
        }[]
      }
      devolver_item_do_lote: {
        Args: { p_item_id: string; p_motivo?: string }
        Returns: Json
      }
      goal_progress: {
        Args: {
          p_period?: Database["app"]["Enums"]["goal_period"]
          p_ref?: string
          p_user_id?: string
        }
        Returns: {
          dias_uteis_decorridos: number
          dias_uteis_total: number
          fonte: string
          mensuravel: boolean
          meta: number
          metrica: string
          metrica_rotulo: string
          percentual: number
          periodo: Database["app"]["Enums"]["goal_period"]
          periodo_fim: string
          periodo_inicio: string
          pessoa_id: string
          pessoa_nome: string
          realizado: number
          ritmo_necessario: number
        }[]
      }
      iniciar_chamada: { Args: { p_item_id: string }; Returns: Json }
      meu_dia: {
        Args: { p_limite?: number; p_user_id?: string }
        Returns: {
          activity_id: string
          atraso_horas: number
          bairro: string
          categoria: string
          deal_id: string
          etapa: string
          funil: string
          motivo: string
          organizacao: string
          organization_id: string
          prioridade: number
          quando: string
          task_id: string
          temperatura: Database["app"]["Enums"]["temperature"]
          tipo: string
          titulo: string
        }[]
      }
      montar_lote: {
        Args: {
          p_categoria_ids?: number[]
          p_horas_entre_tentativas?: number
          p_inicia_em?: string
          p_max_tentativas?: number
          p_meta_ligacoes?: number
          p_nome: string
          p_ordem?: Database["app"]["Enums"]["call_order"]
          p_pipeline_id: number
          p_roteiro_id: string
          p_tamanho?: number
          p_temperatura_origem: Database["app"]["Enums"]["temperature"]
          p_termina_em?: string
        }
        Returns: Json
      }
      move_deal: {
        Args: {
          p_deal_id: string
          p_expected_stage_id?: number
          p_fields?: Json
          p_next_action?: Json
          p_reason?: string
          p_to_stage_id: number
        }
        Returns: Json
      }
      pipeline_board: {
        Args: {
          p_limit_per_stage?: number
          p_offset?: number
          p_only_mine?: boolean
          p_owner_id?: string
          p_pipeline_id: number
          p_q?: string
          p_stage_id?: number
        }
        Returns: Json
      }
      proximo_da_fila: { Args: { p_lote_id: string }; Returns: Json }
      quick_create_organization: {
        Args: {
          p_category_id: number
          p_kind?: Database["app"]["Enums"]["org_kind"]
          p_name: string
          p_phone: string
          p_source_id: number
        }
        Returns: Json
      }
      radar_alternar_fonte: {
        Args: { p_enabled: boolean; p_source_id: number }
        Returns: Json
      }
      radar_criar_candidato: {
        Args: {
          p_category_id?: number
          p_city_id?: number
          p_cnpj?: string
          p_instagram?: string
          p_name: string
          p_neighborhood?: string
          p_notes?: string
          p_phone?: string
          p_source_id: number
          p_source_url?: string
          p_website?: string
        }
        Returns: Json
      }
      radar_fila: {
        Args: {
          p_category_id?: number
          p_limit?: number
          p_offset?: number
          p_q?: string
          p_so_marcados?: boolean
          p_source_id?: number
          p_status?: string
        }
        Returns: {
          bairro: string
          categoria: string
          categoria_id: number
          cidade: string
          cnpj: string
          coletado_em: string
          coletor: string
          criado_em: string
          duplicatas: Json
          email: string
          fonte: string
          fonte_id: number
          fonte_tipo: Database["app"]["Enums"]["source_kind"]
          id: string
          instagram: string
          motivo_da_revisao: string
          nao_contatar: boolean
          nome: string
          observacao: string
          organizacao_id: string
          pontuacao: number
          revisado_em: string
          revisado_por: string
          sinalizacoes: string[]
          site: string
          source_url: string
          status: Database["app"]["Enums"]["candidate_status"]
          telefone: string
          tem_telefone: boolean
          tipo: Database["app"]["Enums"]["org_kind"]
          total_count: number
        }[]
      }
      radar_resumo: { Args: never; Returns: Json }
      radar_revisar_candidato: {
        Args: {
          p_acao: string
          p_candidate_id: string
          p_category_id?: number
          p_organization_id?: string
          p_reason?: string
        }
        Returns: Json
      }
      registrar_contato: {
        Args: {
          p_authorization_evidence?: string
          p_body?: string
          p_client_key: string
          p_com_quem?: string
          p_deal_id?: string
          p_duration_min?: number
          p_expected_stage_id?: number
          p_lost_reason_id?: number
          p_meeting_at?: string
          p_meeting_format?: string
          p_next_action_at?: string
          p_next_action_kind?: Database["app"]["Enums"]["task_kind"]
          p_next_action_title?: string
          p_occurred_at?: string
          p_organization_id: string
          p_outcome_id: number
        }
        Returns: Json
      }
      relatorio_funil: {
        Args: { p_ate?: string; p_de?: string; p_pipeline_id?: number }
        Returns: {
          alcancaram: number
          chegaram_ate: number
          conversao_acumulada: number
          conversao_etapa: number
          coorte: number
          entradas_no_periodo: number
          etapa_id: number
          etapa_nome: string
          etapa_slug: string
          funil_id: number
          funil_nome: string
          funil_slug: string
          is_dormente: boolean
          is_ganho: boolean
          is_perda: boolean
          mediana_dias_na_etapa: number
          na_linha_do_funil: boolean
          negocios_agora: number
          negocios_parados: number
          p75_dias_na_etapa: number
          posicao: number
          sla_horas: number
          temperatura: Database["app"]["Enums"]["temperature"]
        }[]
      }
      relatorio_por_bairro: {
        Args: { p_ate?: string; p_de?: string }
        Returns: {
          bairro: string
          cidade: string
          com_telefone: number
          negocios_abertos: number
          organizacoes: number
          portas_abertas_periodo: number
          portas_batidas_periodo: number
          publicados: number
          sem_contato: number
          taxa_abertura: number
        }[]
      }
      relatorio_por_categoria: {
        Args: { p_ate?: string; p_de?: string }
        Returns: {
          categoria_id: number
          categoria_nome: string
          categoria_slug: string
          com_telefone: number
          etiqueta: string
          grupo: string
          negocios_abertos: number
          negocios_quentes: number
          organizacoes: number
          perdidos: number
          portas_abertas_periodo: number
          portas_batidas_periodo: number
          prioridade: number
          publicados: number
          sem_contato: number
          taxa_abertura: number
        }[]
      }
      relatorio_por_fonte: {
        Args: { p_ate?: string; p_de?: string }
        Returns: {
          alvos: number
          autorizaram: number
          com_contato_valido: number
          contatados: number
          fonte_id: number
          fonte_nome: string
          fonte_slug: string
          pct_autorizaram: number
          pct_com_contato: number
          pct_contatados: number
          pct_publicados: number
          pct_responderam: number
          publicados: number
          responderam: number
          tipo: Database["app"]["Enums"]["source_kind"]
        }[]
      }
      relatorio_por_horario: {
        Args: { p_ate?: string; p_de?: string }
        Returns: {
          faixa: string
          hora_inicio: number
          portas_abertas: number
          portas_batidas: number
          superficie: Database["app"]["Enums"]["interaction_surface"]
          taxa_abertura: number
          toques: number
        }[]
      }
      relatorio_por_responsavel: {
        Args: { p_ate?: string; p_de?: string }
        Returns: {
          alvos_novos: number
          cadastros_iniciados: number
          ligacoes: number
          mediana_atraso_horas: number
          mensagens: number
          negocios_abertos: number
          negocios_ganhos: number
          negocios_parados: number
          negocios_perdidos: number
          negocios_sem_proxima_acao: number
          papel: Database["app"]["Enums"]["user_role"]
          percentual_no_prazo: number
          pessoa_id: string
          pessoa_nome: string
          portas_abertas: number
          portas_batidas: number
          publicados: number
          reunioes_marcadas: number
          reunioes_realizadas: number
          tarefas_com_prazo: number
          tarefas_no_prazo: number
          tarefas_vencidas_abertas: number
          visitas: number
        }[]
      }
      reveal_contact_phone: { Args: { p_contact_id: string }; Returns: string }
      reveal_phone: { Args: { p_organization_id: string }; Returns: string }
      search_organizations: {
        Args: {
          p_category_id?: number
          p_city_id?: number
          p_kind?: Database["app"]["Enums"]["org_kind"]
          p_limit?: number
          p_offset?: number
          p_owner_id?: string
          p_stage_id?: number
          q?: string
        }
        Returns: {
          city: string
          days_since_contact: number
          id: string
          instagram_handle: string
          kind: Database["app"]["Enums"]["org_kind"]
          last_activity_at: string
          name: string
          needs_attention: boolean
          neighborhood: string
          next_action_at: string
          owner: string
          phone: string
          primary_category: string
          stage: string
          temperature: Database["app"]["Enums"]["temperature"]
          total_count: number
        }[]
      }
      tabular_chamada: {
        Args: {
          p_agendar_para?: string
          p_caminho_script?: string[]
          p_capturas?: Json
          p_chamada_id: string
          p_client_key: string
          p_com_quem?: string
          p_duracao_seg?: number
          p_item_id: string
          p_lost_reason_id?: number
          p_observacao?: string
          p_outcome_id?: number
          p_pediu_para_nao_ligar?: boolean
          p_resultado: Database["app"]["Enums"]["call_result"]
          p_reuniao_em?: string
          p_reuniao_formato?: string
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  app: {
    Enums: {
      activity_type: [
        "call",
        "visit",
        "meeting",
        "message",
        "note",
        "email",
        "stage_change",
        "system",
      ],
      call_batch_status: ["rascunho", "ativo", "pausado", "encerrado"],
      call_item_status: ["fila", "em_andamento", "concluido", "devolvido"],
      call_order: ["prioridade", "mais_parado", "aleatorio"],
      call_provider: ["manual"],
      call_result: [
        "atendida_humano",
        "nao_atendeu",
        "caixa_postal",
        "ocupado",
        "numero_invalido",
        "chamada_muda",
        "queda_de_linha",
      ],
      candidate_status: ["novo", "aprovado", "recusado", "mesclado"],
      channel: [
        "whatsapp",
        "instagram",
        "email",
        "phone",
        "presencial",
        "other",
      ],
      consent_kind: [
        "contact_optin",
        "contact_optout",
        "data_use_authorized",
        "photo_use_authorized",
        "data_use_revoked",
        "access_request",
        "erasure_request",
        "erasure_done",
      ],
      deal_status: ["open", "won", "lost", "paused", "nurturing"],
      door_kind: ["aberta", "batida", "nenhuma"],
      goal_metric: [
        "new_targets",
        "doors_knocked",
        "doors_opened",
        "calls_made",
        "replies",
        "meetings_booked",
        "meetings_done",
        "visits_done",
        "pre_registrations",
        "published",
      ],
      goal_period: ["day", "week", "month"],
      interaction_surface: [
        "whatsapp",
        "ligacao",
        "visita",
        "reuniao",
        "instagram_dm",
        "triagem",
      ],
      msg_direction: ["in", "out"],
      msg_status: ["queued", "sent", "delivered", "read", "failed", "received"],
      msg_type: [
        "text",
        "audio",
        "image",
        "video",
        "document",
        "template",
        "interactive",
        "reaction",
        "system",
      ],
      org_kind: [
        "fornecedor",
        "produtor",
        "cerimonialista",
        "espaco",
        "empresa",
        "outro",
      ],
      prereg_status: [
        "pending",
        "draft_created",
        "link_sent",
        "in_progress",
        "completed",
        "published",
        "rejected",
        "expired",
      ],
      review_status: ["new", "approved", "rejected", "merged", "duplicate"],
      source_kind: ["scrape", "import", "manual", "api", "referral"],
      task_kind: ["call", "visit", "meeting", "message", "follow_up", "other"],
      task_status: ["todo", "doing", "done", "cancelled"],
      temperature: ["frio", "morno", "quente", "cliente", "cliente_ativo"],
      user_role: [
        "admin",
        "gestor",
        "sdr",
        "embaixador",
        "leitura",
        "financeiro",
        "bot",
      ],
    },
  },
  public: {
    Enums: {},
  },
} as const

