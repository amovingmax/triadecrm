-- =============================================================================
-- O SDR tem o poder do gestor, menos Ajustes (21/10/2026; RF-ADM-01)
-- =============================================================================
-- Pedido do usuário: "a tela do SDR deve ser idêntica à do gestor e à do admin
-- [...] a única diferença é que ele não vai conseguir entrar na aba de Ajustes",
-- e, perguntado sobre os botões que eram só da gestão: "Tudo igual ao gestor".
--
-- `app.is_manager()` é o poder da gestão no dia a dia, e passa a incluir o SDR:
-- montar e atribuir lote, mexer no que é de outra pessoa (negócio, tarefa,
-- conversa, tentativa de ligação), excluir e restaurar parceiro, marcar
-- Consultoria, mandar mensagem automática pela base (saudação e "aprovar e
-- mandar mensagem", com custo na Meta), definir meta, ver o dia, a meta e as
-- ligações de outra pessoa, gerar o relatório da semana, desfazer importação.
-- Nada no caminho de envio do WhatsApp usa esta função (`app.pode_enviar`,
-- `messages_guard`, `app.envio_um`, `app.wa_*` ficam como estão).
--
-- O que continua só de admin e gestor ganha nome próprio, `app.admin_ou_gestor()`
-- (o que `app.is_manager()` era até hoje):
--   * Ajustes: catálogos (categorias, cidades, feriados, resultados, motivos de
--     perda, etiquetas, setores, respostas rápidas, modelos, funis e etapas,
--     roteiros, áudios, fontes), `app_settings`, atendimento, telefonia, robô,
--     setores de uma pessoa, de-para de categorias, exportação LGPD;
--   * a tabela-base de `organizations` e `contacts`, onde está o telefone
--     inteiro: o SDR continua lendo e escrevendo pelas views, com o número
--     mascarado e o "Revelar" registrado (`app.reads_base_pii()` não muda);
--   * os registros de operação e LGPD: `pii_access_log`, `source_record`, a
--     leitura de `pre_registration_acceptances` (IP e navegador de quem aceitou),
--     `dead_letters`, `webhook_deliveries`, `komune_outbox`, `retention_runs`,
--     preços de modelo de IA.
-- Única exceção dentro de `app_settings`: os pesos da triagem (`radar.triagem`)
-- são editados na Revisão, e o SDR passa a editá-los como o gestor.
--
-- Fora de `is_manager`, abrem-se também ao SDR: a leitura da IA e a repontuação
-- da Revisão (`radar_triar_com_ia`, `radar_repontuar`, que listavam admin e
-- gestor), e a hierarquia (`app.acompanha`): o SDR acompanha o mesmo que o gestor
-- (os outros SDRs e o embaixador).
--
-- As políticas e as funções de Ajustes abaixo foram geradas das definições em
-- vigor, trocando só `app.is_manager()` por `app.admin_ou_gestor()`; os corpos
-- são os mesmos. Pode rodar de novo sem efeito.
--
-- Volta: `app.is_manager()` de novo com admin e gestor, e as duas funções da
-- Revisão e `app.acompanha` com as listas de antes (as políticas e funções de
-- Ajustes podem ficar com `app.admin_ou_gestor()`, que é a mesma regra).
-- =============================================================================


-- ===========================================================================
-- 1. As duas regras
-- ===========================================================================
create or replace function app.admin_ou_gestor()
returns boolean
language sql
stable
set search_path = ''
as $$
  select app.role() in ('admin'::app.user_role, 'gestor'::app.user_role)
$$;
comment on function app.admin_ou_gestor() is
  'Admin ou gestor: Ajustes, a tabela-base de organizations/contacts (telefone inteiro) e os registros de operação e LGPD. Desde 21/10/2026, é o que app.is_manager() era.';
revoke all on function app.admin_ou_gestor() from public, anon;
grant execute on function app.admin_ou_gestor() to authenticated, service_role;

create or replace function app.is_manager()
returns boolean
language sql
stable
set search_path = ''
as $$
  select app.role() in ('admin'::app.user_role, 'gestor'::app.user_role, 'sdr'::app.user_role)
$$;
comment on function app.is_manager() is
  'O poder da gestão no dia a dia (lote, meta, exclusão, Consultoria, mensagem automática, o que é de outra pessoa). Admin, gestor e, desde 21/10/2026, SDR. Ajustes é app.admin_ou_gestor().';


-- ===========================================================================
-- 2. A hierarquia: o SDR acompanha o mesmo que o gestor
-- ===========================================================================
create or replace function app.acompanha(p_alvo uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles p
     where p.id = p_alvo and p.is_active and p.id <> auth.uid()
       and (
         (app.role() = 'admin'::app.user_role
            and p.role in ('gestor'::app.user_role, 'sdr'::app.user_role, 'embaixador'::app.user_role))
         or
         (app.role() in ('gestor'::app.user_role, 'sdr'::app.user_role)
            and p.role in ('sdr'::app.user_role, 'embaixador'::app.user_role))
       ))
$$;


-- ===========================================================================
-- 3. O que fica com admin e gestor: políticas
-- ===========================================================================
alter policy ai_model_prices_select on public.ai_model_prices
  using ((select app.admin_ou_gestor()));

alter policy app_settings_insert on public.app_settings
  with check ((select app.admin_ou_gestor()));

alter policy app_settings_update on public.app_settings
  using ((select app.admin_ou_gestor()) or ((select app.is_manager()) and key = 'radar.triagem'))
  with check ((select app.admin_ou_gestor()) or ((select app.is_manager()) and key = 'radar.triagem'));

alter policy audio_assets_delete on public.audio_assets
  using ((select app.admin_ou_gestor()));

alter policy audio_assets_insert on public.audio_assets
  with check ((select app.admin_ou_gestor()));

alter policy audio_assets_update on public.audio_assets
  using ((select app.admin_ou_gestor()))
  with check ((select app.admin_ou_gestor()));

alter policy cadence_steps_delete on public.cadence_steps
  using ((select app.admin_ou_gestor()));

alter policy cadence_steps_insert on public.cadence_steps
  with check ((select app.admin_ou_gestor()));

alter policy cadence_steps_update on public.cadence_steps
  using ((select app.admin_ou_gestor()))
  with check ((select app.admin_ou_gestor()));

alter policy cadences_insert on public.cadences
  with check ((select app.admin_ou_gestor()));

alter policy cadences_update on public.cadences
  using ((select app.admin_ou_gestor()))
  with check ((select app.admin_ou_gestor()));

alter policy call_scripts_delete on public.call_scripts
  using ((select app.admin_ou_gestor()));

alter policy call_scripts_insert on public.call_scripts
  with check ((select app.admin_ou_gestor()));

alter policy call_scripts_update on public.call_scripts
  using ((select app.admin_ou_gestor()))
  with check ((select app.admin_ou_gestor()));

alter policy categories_delete on public.categories
  using ((select app.admin_ou_gestor()));

alter policy categories_insert on public.categories
  with check ((select app.admin_ou_gestor()));

alter policy categories_update on public.categories
  using ((select app.admin_ou_gestor()))
  with check ((select app.admin_ou_gestor()));

alter policy channel_windows_delete on public.channel_windows
  using ((select app.admin_ou_gestor()));

alter policy channel_windows_insert on public.channel_windows
  with check ((select app.admin_ou_gestor()));

alter policy channel_windows_update on public.channel_windows
  using ((select app.admin_ou_gestor()))
  with check ((select app.admin_ou_gestor()));

alter policy cities_delete on public.cities
  using ((select app.admin_ou_gestor()));

alter policy cities_insert on public.cities
  with check ((select app.admin_ou_gestor()));

alter policy cities_update on public.cities
  using ((select app.admin_ou_gestor()))
  with check ((select app.admin_ou_gestor()));

alter policy contacts_insert on public.contacts
  with check ((select app.admin_ou_gestor()));

alter policy contacts_select on public.contacts
  using (((select app.admin_ou_gestor()) OR (( SELECT app.reads_base_pii() AS reads_base_pii) AND (deleted_at IS NULL))));

alter policy contacts_update on public.contacts
  using ((select app.admin_ou_gestor()))
  with check ((select app.admin_ou_gestor()));

alter policy dead_letters_select on public.dead_letters
  using (app.admin_ou_gestor());

alter policy dead_letters_update on public.dead_letters
  using (app.admin_ou_gestor())
  with check (app.admin_ou_gestor());

alter policy holidays_delete on public.holidays
  using ((select app.admin_ou_gestor()));

alter policy holidays_insert on public.holidays
  with check ((select app.admin_ou_gestor()));

alter policy holidays_update on public.holidays
  using ((select app.admin_ou_gestor()))
  with check ((select app.admin_ou_gestor()));

alter policy ingest_queues_delete on public.ingest_queues
  using ((select app.admin_ou_gestor()));

alter policy ingest_queues_insert on public.ingest_queues
  with check ((select app.admin_ou_gestor()));

alter policy ingest_queues_update on public.ingest_queues
  using ((select app.admin_ou_gestor()))
  with check ((select app.admin_ou_gestor()));

alter policy interaction_outcomes_delete on public.interaction_outcomes
  using ((select app.admin_ou_gestor()));

alter policy interaction_outcomes_insert on public.interaction_outcomes
  with check ((select app.admin_ou_gestor()));

alter policy interaction_outcomes_update on public.interaction_outcomes
  using ((select app.admin_ou_gestor()))
  with check ((select app.admin_ou_gestor()));

alter policy komune_outbox_select on public.komune_outbox
  using ((select app.admin_ou_gestor()));

alter policy lost_reasons_delete on public.lost_reasons
  using ((select app.admin_ou_gestor()));

alter policy lost_reasons_insert on public.lost_reasons
  with check ((select app.admin_ou_gestor()));

alter policy lost_reasons_update on public.lost_reasons
  using ((select app.admin_ou_gestor()))
  with check ((select app.admin_ou_gestor()));

alter policy message_templates_delete on public.message_templates
  using ((select app.admin_ou_gestor()));

alter policy message_templates_insert on public.message_templates
  with check ((select app.admin_ou_gestor()));

alter policy message_templates_update on public.message_templates
  using ((select app.admin_ou_gestor()))
  with check ((select app.admin_ou_gestor()));

alter policy organizations_insert on public.organizations
  with check ((select app.admin_ou_gestor()));

alter policy organizations_select on public.organizations
  using (((select app.admin_ou_gestor()) OR (( SELECT app.reads_base_pii() AS reads_base_pii) AND (deleted_at IS NULL))));

alter policy organizations_update on public.organizations
  using ((select app.admin_ou_gestor()))
  with check ((select app.admin_ou_gestor()));

alter policy pii_access_log_select on public.pii_access_log
  using ((select app.admin_ou_gestor()));

alter policy pipelines_delete on public.pipelines
  using ((select app.admin_ou_gestor()));

alter policy pipelines_insert on public.pipelines
  with check ((select app.admin_ou_gestor()));

alter policy pipelines_update on public.pipelines
  using ((select app.admin_ou_gestor()))
  with check ((select app.admin_ou_gestor()));

alter policy pre_registration_acceptances_select on public.pre_registration_acceptances
  using ((select app.admin_ou_gestor()));

alter policy respostas_rapidas_escrita on public.respostas_rapidas
  using (app.admin_ou_gestor())
  with check (app.admin_ou_gestor());

alter policy retention_runs_select on public.retention_runs
  using ((select app.admin_ou_gestor()));

alter policy setores_escrita on public.setores
  using (app.admin_ou_gestor())
  with check (app.admin_ou_gestor());

alter policy source_category_map_delete on public.source_category_map
  using ((select app.admin_ou_gestor()));

alter policy source_category_map_insert on public.source_category_map
  with check ((select app.admin_ou_gestor()));

alter policy source_category_map_update on public.source_category_map
  using ((select app.admin_ou_gestor()))
  with check ((select app.admin_ou_gestor()));

alter policy source_category_proposta_delete on public.source_category_proposta
  using ((select app.admin_ou_gestor()));

alter policy source_record_select on public.source_record
  using ((select app.admin_ou_gestor()));

alter policy sources_delete on public.sources
  using ((select app.admin_ou_gestor()));

alter policy sources_insert on public.sources
  with check ((select app.admin_ou_gestor()));

alter policy sources_update on public.sources
  using ((select app.admin_ou_gestor()))
  with check ((select app.admin_ou_gestor()));

alter policy stage_equivalences_delete on public.stage_equivalences
  using ((select app.admin_ou_gestor()));

alter policy stage_equivalences_insert on public.stage_equivalences
  with check ((select app.admin_ou_gestor()));

alter policy stage_equivalences_update on public.stage_equivalences
  using ((select app.admin_ou_gestor()))
  with check ((select app.admin_ou_gestor()));

alter policy stages_delete on public.stages
  using ((select app.admin_ou_gestor()));

alter policy stages_insert on public.stages
  with check ((select app.admin_ou_gestor()));

alter policy stages_update on public.stages
  using ((select app.admin_ou_gestor()))
  with check ((select app.admin_ou_gestor()));

alter policy tags_delete on public.tags
  using ((select app.admin_ou_gestor()));

alter policy tags_insert on public.tags
  with check ((select app.admin_ou_gestor()));

alter policy tags_update on public.tags
  using ((select app.admin_ou_gestor()))
  with check ((select app.admin_ou_gestor()));

alter policy teams_delete on public.teams
  using ((select app.admin_ou_gestor()));

alter policy teams_insert on public.teams
  with check ((select app.admin_ou_gestor()));

alter policy teams_update on public.teams
  using ((select app.admin_ou_gestor()))
  with check ((select app.admin_ou_gestor()));

alter policy webhook_deliveries_select on public.webhook_deliveries
  using ((select app.admin_ou_gestor()));


-- ===========================================================================
-- 4. O que fica com admin e gestor: funções de Ajustes
-- ===========================================================================
CREATE OR REPLACE FUNCTION public.atendimento_configurar(p jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_texto text := nullif(btrim(coalesce(p ->> 'texto_ausencia', '')), '');
  v_intro text := nullif(btrim(coalesce(p ->> 'texto_introducao', '')), '');
  v_ola   text := nullif(btrim(coalesce(p ->> 'texto_tudo_bem', '')), '');
  v_hora  int  := nullif(btrim(coalesce(p ->> 'cumprimento_por_hora', '')), '')::int;
  v_novo  jsonb := '{}'::jsonb;
  k       text;
begin
  if auth.uid() is null or not app.admin_ou_gestor() then
    return jsonb_build_object('ok', false, 'motivo', 'sem_permissao');
  end if;
  foreach k in array array['lead_automatico', 'distribuicao_automatica',
                           'ausencia_ativa', 'introducao_ativa',
                           'cumprimento_automatico'] loop
    if p ? k then
      if jsonb_typeof(p -> k) <> 'boolean' then
        return jsonb_build_object('ok', false, 'motivo', 'valor_invalido', 'campo', k);
      end if;
      v_novo := v_novo || jsonb_build_object(k, p -> k);
    end if;
  end loop;
  if v_hora is not null and (v_hora < 1 or v_hora > 60) then
    return jsonb_build_object('ok', false, 'motivo', 'valor_invalido',
                              'campo', 'cumprimento_por_hora');
  end if;
  if v_hora is not null then
    v_novo := v_novo || jsonb_build_object('cumprimento_por_hora', v_hora);
  end if;
  if v_texto is not null and length(v_texto) > 1000 then
    return jsonb_build_object('ok', false, 'motivo', 'texto_longo_demais');
  end if;
  if v_intro is not null then
    if length(v_intro) > 1000 then
      return jsonb_build_object('ok', false, 'motivo', 'texto_longo_demais',
                                'campo', 'texto_introducao');
    end if;
    if position('{{' in v_intro) > 0 then
      return jsonb_build_object('ok', false, 'motivo', 'introducao_com_variavel');
    end if;
  end if;
  -- MESMA REGRA DO "TUDO BEM?", e pelo mesmo motivo: `app.wa_bot_dizer` copia o
  -- corpo CRU para o fio, então um `{{nome}}` sairia literal no WhatsApp do
  -- fornecedor. O teto é menor de propósito — esta é a mensagem curta do meio,
  -- e um texto de mil caracteres aqui já não seria um "tudo bem".
  if v_ola is not null then
    if length(v_ola) > 200 then
      return jsonb_build_object('ok', false, 'motivo', 'texto_longo_demais',
                                'campo', 'texto_tudo_bem');
    end if;
    if position('{{' in v_ola) > 0 then
      return jsonb_build_object('ok', false, 'motivo', 'tudo_bem_com_variavel');
    end if;
  end if;

  update public.app_settings set value = value || v_novo, updated_by = auth.uid()
   where key = 'atendimento';
  if v_texto is not null then
    update public.message_templates set body = v_texto where template_code = 'GEN-SYS-AUSENCIA';
  end if;
  if v_intro is not null then
    update public.message_templates set body = v_intro where template_code = 'GEN-SYS-INTRO';
  end if;
  if v_ola is not null then
    update public.message_templates set body = v_ola where template_code = 'GEN-SYS-TUDOBEM';
  end if;
  -- O lote que já está vivo aprende o ritmo novo agora, e não só no próximo que
  -- nascer: quem baixa de 6 para 2 está pisando no freio de um envio EM CURSO.
  if v_hora is not null then
    update public.envios_em_massa set por_hora = v_hora, atualizado_em = now()
     where continuo and status in ('agendado', 'enviando', 'pausado');
  end if;
  return jsonb_build_object('ok', true);
end $function$;

CREATE OR REPLACE FUNCTION public.definir_setores_da_pessoa(p_profile_id uuid, p_setores integer[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if auth.uid() is null or not app.admin_ou_gestor() then
    return jsonb_build_object('ok', false, 'motivo', 'sem_permissao');
  end if;
  if not exists (select 1 from public.profiles p where p.id = p_profile_id) then
    return jsonb_build_object('ok', false, 'motivo', 'pessoa_invalida');
  end if;
  delete from public.setor_membros
   where profile_id = p_profile_id and setor_id <> all (coalesce(p_setores, '{}'::int[]));
  insert into public.setor_membros (setor_id, profile_id)
  select s.id, p_profile_id from public.setores s
   where s.id = any (coalesce(p_setores, '{}'::int[]))
  on conflict do nothing;
  return jsonb_build_object('ok', true);
end $function$;

CREATE OR REPLACE FUNCTION public.exportar_lgpd(p_organization_id uuid, p_motivo text DEFAULT 'pedido_do_titular'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_uid uuid := auth.uid();
  v_res jsonb;
begin
  if v_uid is null then
    raise exception 'Usuário não autenticado' using errcode = '42501';
  end if;
  -- Exportação é poder: gestor, admin ou quem responde pelo titular
  -- (o encarregado tem papel `leitura` e é quem responde no PRD §4).
  if not (app.admin_ou_gestor() or app.reads_base_pii()) then
    return jsonb_build_object('ok', false, 'motivo', 'sem_permissao');
  end if;
  if coalesce(trim(p_motivo), '') = '' then
    return jsonb_build_object('ok', false, 'motivo', 'exportacao_exige_motivo');
  end if;

  v_res := app.lgpd_dossie(p_organization_id);
  if not coalesce((v_res ->> 'ok')::boolean, false) then
    return v_res;
  end if;

  insert into public.pii_access_log (actor_id, actor_role, action, entity_type, entity_id, scope)
  values (v_uid, app.role()::text, 'export_lgpd', 'organization', p_organization_id,
          jsonb_build_object('motivo', trim(p_motivo)));

  insert into public.consent_events (kind, organization_id, channel, evidence_text, recorded_by)
  values ('access_request'::app.consent_kind, p_organization_id, 'email'::app.channel,
          'Exportação do dossiê LGPD: ' || trim(p_motivo), v_uid);

  return v_res;
end $function$;

CREATE OR REPLACE FUNCTION public.komune_fila_status()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if auth.uid() is null or not app.admin_ou_gestor() then
    raise exception 'Sem permissão para ver a fila de integração' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'push_ativo', coalesce((select (s.value ->> 'push_ativo')::boolean
                              from public.app_settings s where s.key = 'integracao.komune'), false),
    'pendentes',   (select count(*) from public.komune_outbox where status = 'pendente'),
    'enviados',    (select count(*) from public.komune_outbox where status = 'enviado'),
    'falhados',    (select count(*) from public.komune_outbox where status = 'falhou'),
    'descartados', (select count(*) from public.komune_outbox where status = 'descartado'),
    'ultimo_descarte', (select jsonb_build_object('quando', o.updated_at,
                                                  'motivo', o.last_error,
                                                  'organizacao', o.organization_id)
                          from public.komune_outbox o
                         where o.status = 'descartado'
                         order by o.updated_at desc limit 1),
    'ultimo_erro', (select jsonb_build_object('quando', o.updated_at, 'erro', o.last_error,
                                              'tentativas', o.attempts, 'http', o.http_status)
                      from public.komune_outbox o
                     where o.last_error is not null and o.status <> 'descartado'
                     order by o.updated_at desc limit 1),
    'ultima_entrega_recebida', (select jsonb_build_object('quando', d.received_at,
                                                          'evento', d.event,
                                                          'resultado', d.result)
                                  from public.webhook_deliveries d
                                 where d.source = 'komune'
                                 order by d.received_at desc limit 1));
end $function$;

CREATE OR REPLACE FUNCTION public.ligar_cadencia(p_slug text, p_ativa boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_uid    uuid := auth.uid();
  v_papel  app.user_role;
  c        public.cadences%rowtype;
  v_ativas int;
begin
  if v_uid is null then
    raise exception 'Usuário não autenticado' using errcode = '42501';
  end if;
  v_papel := app.role();
  if not app.admin_ou_gestor() then
    return jsonb_build_object('ok', false, 'motivo', 'sem_permissao');
  end if;
  if p_ativa is null then
    return jsonb_build_object('ok', false, 'motivo', 'estado_ausente');
  end if;

  select * into c from public.cadences where slug = p_slug;
  if not found then
    return jsonb_build_object('ok', false, 'motivo', 'cadencia_inexistente');
  end if;

  if c.is_active = p_ativa then
    select count(*) into v_ativas from public.cadence_enrollments e
     where e.cadence_id = c.id and e.status = 'ativa'::app.cadence_status;
    return jsonb_build_object('ok', true, 'mudou', false, 'ativa', c.is_active,
                              'matriculas_ativas', v_ativas);
  end if;

  update public.cadences set is_active = p_ativa where id = c.id;

  select count(*) into v_ativas from public.cadence_enrollments e
   where e.cadence_id = c.id and e.status = 'ativa'::app.cadence_status;

  -- O gatilho `audit_cadences` já grava o antes e o depois da linha; esta
  -- entrada existe para o log dizer a INTENÇÃO com o nome que a tela usa.
  insert into public.audit_log (actor_id, actor_role, action, table_name, row_id, new_data)
  values (v_uid, v_papel::text,
          case when p_ativa then 'LIGAR_CADENCIA' else 'DESLIGAR_CADENCIA' end,
          'cadences', c.id::text,
          jsonb_build_object('cadencia', c.slug, 'ativa', p_ativa,
                             'matriculas_ativas', v_ativas));

  return jsonb_build_object('ok', true, 'mudou', true, 'ativa', p_ativa,
                            'matriculas_ativas', v_ativas);
end $function$;

CREATE OR REPLACE FUNCTION public.modelo_whatsapp_criar(p jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_nome   text := btrim(coalesce(p ->> 'nome', ''));
  v_cat    text := coalesce(p ->> 'categoria', 'marketing');
  v_corpo  text := btrim(coalesce(p ->> 'corpo', ''));
  v_botoes jsonb := coalesce(p -> 'botoes', '[]'::jsonb);
  v_erro   text;
  v_codigo text;
  v_id     int;
begin
  if auth.uid() is null or not app.admin_ou_gestor() then
    return jsonb_build_object('ok', false, 'motivo', 'sem_permissao');
  end if;
  if length(v_nome) not between 3 and 80 then
    return jsonb_build_object('ok', false, 'motivo', 'nome_invalido');
  end if;
  if v_cat not in ('marketing', 'utility') then
    return jsonb_build_object('ok', false, 'motivo', 'categoria_invalida');
  end if;
  v_erro := app.modelo_corpo_invalido(v_corpo);
  if v_erro is not null then
    return jsonb_build_object('ok', false, 'motivo', v_erro);
  end if;
  if not app.modelo_botoes_validos(v_botoes) then
    return jsonb_build_object('ok', false, 'motivo', 'botoes_invalidos');
  end if;

  -- Código legível e único: ENV-<nome>-<4 letras>.
  v_codigo := 'ENV-' || left(upper(regexp_replace(app.search_name(v_nome), '[^a-z0-9]+', '-', 'g')), 40)
              || '-' || upper(substr(md5(random()::text || clock_timestamp()::text), 1, 4));
  v_codigo := regexp_replace(v_codigo, '-+', '-', 'g');

  insert into public.message_templates (template_code, name, channel, category, segment, kind,
                                        language, body, botoes, is_active, version)
  values (v_codigo, v_nome, 'whatsapp'::app.channel, v_cat, 'GEN', 'envio',
          'pt_BR', v_corpo,
          (select coalesce(jsonb_agg(jsonb_build_object('tipo', b ->> 'tipo',
                                                        'texto', btrim(b ->> 'texto'))), '[]'::jsonb)
             from jsonb_array_elements(v_botoes) b),
          true, 1)
  returning id into v_id;

  return jsonb_build_object('ok', true, 'id', v_id, 'codigo', v_codigo);
end $function$;

CREATE OR REPLACE FUNCTION public.source_category_esquecer(p_source_id integer, p_texto text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_uid   uuid := auth.uid();
  v_chave text := app.chave_catalogo(p_texto);
  v_m     public.source_category_map;
begin
  if v_uid is null or not app.admin_ou_gestor() then
    raise exception 'Papel % não esquece regra de categoria', app.role() using errcode = '42501';
  end if;

  select * into v_m from public.source_category_map
   where source_id = p_source_id and category_source = v_chave;
  if v_m.source_id is null then
    return jsonb_build_object('ok', false, 'reason', 'regra_inexistente');
  end if;
  -- Regra SEMEADA é decisão de produto, e sai por migração. Deixar a tela
  -- apagá-la faria a próxima `db reset` trazê-la de volta sem aviso.
  if v_m.origem <> 'aprendido' then
    return jsonb_build_object('ok', false, 'reason', 'regra_semeada');
  end if;

  delete from public.source_category_map
   where source_id = p_source_id and category_source = v_chave;
  -- A proposta também sai: senão a próxima escolha reergueria a regra na hora,
  -- com o contador já cheio.
  delete from public.source_category_proposta
   where source_id = p_source_id and category_source = v_chave;

  insert into public.audit_log (actor_id, actor_role, action, table_name, row_id, old_data)
  values (v_uid, app.role()::text, 'ESQUECER_CATEGORIA', 'source_category_map',
          p_source_id || '|' || v_chave, to_jsonb(v_m));

  return jsonb_build_object('ok', true, 'esquecida', v_chave);
end $function$;

CREATE OR REPLACE FUNCTION public.voz_configurar(p jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_tel  jsonb;
  v_avi  jsonb;
begin
  if auth.uid() is null or not app.admin_ou_gestor() then
    return jsonb_build_object('ok', false, 'motivo', 'sem_permissao');
  end if;
  if p ? 'telefonia_ativa' and jsonb_typeof(p -> 'telefonia_ativa') <> 'boolean' then
    return jsonb_build_object('ok', false, 'motivo', 'valor_invalido', 'campo', 'telefonia_ativa');
  end if;
  if p ? 'aviso_ativo' and jsonb_typeof(p -> 'aviso_ativo') <> 'boolean' then
    return jsonb_build_object('ok', false, 'motivo', 'valor_invalido', 'campo', 'aviso_ativo');
  end if;

  -- `insert ... on conflict`, e não `update`: num banco em que a linha ainda não
  -- existe, a chave ligada na tela tem de ficar ligada, e não sumir em silêncio.
  if p ? 'telefonia_ativa' then
    insert into public.app_settings (key, value, description, updated_by)
    values ('voz.telefonia', jsonb_build_object('ativa', p -> 'telefonia_ativa'),
            'Ligação pelo navegador (Twilio). Liga e desliga em Ajustes → Ligações.', auth.uid())
    on conflict (key) do update
      set value = public.app_settings.value || excluded.value, updated_by = auth.uid();
  end if;
  if p ? 'aviso_ativo' then
    insert into public.app_settings (key, value, description, updated_by)
    values ('voz.aviso_nao_atendeu', jsonb_build_object('ativo', p -> 'aviso_ativo'),
            'Aviso no WhatsApp para quem não atendeu a ligação. Liga e desliga em Ajustes → Ligações.',
            auth.uid())
    on conflict (key) do update
      set value = public.app_settings.value || excluded.value, updated_by = auth.uid();
  end if;

  select s.value into v_tel from public.app_settings s where s.key = 'voz.telefonia';
  select s.value into v_avi from public.app_settings s where s.key = 'voz.aviso_nao_atendeu';
  return jsonb_build_object(
    'ok', true,
    'telefonia_ativa', coalesce((v_tel ->> 'ativa')::boolean, false),
    'aviso_ativo',     coalesce((v_avi ->> 'ativo')::boolean, false));
end $function$;

CREATE OR REPLACE FUNCTION public.wa_bot_ligar(p_ativo boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_valor jsonb;
begin
  if auth.uid() is null or not app.admin_ou_gestor() then
    raise exception 'Só gestor liga e desliga o bot de entrada' using errcode = '42501';
  end if;
  update public.app_settings
     set value = case when coalesce(p_ativo, false)
                      then jsonb_set(value, '{ativo}', 'true'::jsonb) - 'freio'
                      else jsonb_set(value, '{ativo}', 'false'::jsonb)
                 end,
         updated_at = now()
   where key = 'whatsapp.bot_de_entrada'
  returning value into v_valor;
  return coalesce(v_valor, '{}'::jsonb);
end $function$;


-- ===========================================================================
-- 5. A Revisão: a leitura da IA e a repontuação passam a ser do SDR também
-- ===========================================================================
CREATE OR REPLACE FUNCTION public.radar_repontuar()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_n int := 0;
begin
  if nullif(current_setting('request.jwt.claims', true), '') is not null
     and not app.e_o_worker()
     and not app.is_manager() then
    raise exception 'Papel % não repontua o Radar', app.role() using errcode = '42501';
  end if;

  with conta as (
    select c.id, app.radar_pontuar(c.*) as p
      from public.supplier_candidates c
     where c.status = 'novo'::app.candidate_status
  )
  update public.supplier_candidates c
     set score = (conta.p ->> 'score')::smallint,
         tier  = conta.p ->> 'tier'
    from conta
   where c.id = conta.id;

  get diagnostics v_n = row_count;
  return jsonb_build_object('ok', true, 'candidatos', v_n);
end $function$;

CREATE OR REPLACE FUNCTION public.radar_triar_com_ia()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_quantos  int;
  v_rodadas  int;
  v_freio    jsonb;
  v_fila     jsonb;
  v_enfileir int := 0;
  -- `i` NÃO é declarado: o `for i in 1..n` do plpgsql cria a própria variável,
  -- e declarar uma com o mesmo nome deixa uma sombra que o `supabase db lint`
  -- acusa — com razão, porque a de fora fica sempre nula.
begin
  if nullif(current_setting('request.jwt.claims', true), '') is not null
     and not app.e_o_worker()
     and not app.is_manager() then
    raise exception 'Papel % não pede a leitura da IA', app.role() using errcode = '42501';
  end if;

  select count(*)::int into v_quantos
    from public.supplier_candidates
   where status = 'novo'::app.candidate_status and ia_analisado_em is null;

  if v_quantos = 0 then
    return jsonb_build_object('ok', true, 'enfileirado', false, 'motivo', 'nada_para_ler');
  end if;

  -- O FREIO DO ORÇAMENTO, DITO ANTES E NÃO DEPOIS. Acima de 80% do teto só
  -- passam `classify_inbound` e `transcribe_audio` — a triagem não está na
  -- lista, e o trabalho seria enfileirado para morrer calado no worker. Quem
  -- clicou ficaria esperando um veredito que nunca vem. Agora a tela sabe.
  v_freio := app.ia_pode_gastar('triar_candidato');
  if not coalesce((v_freio ->> 'pode')::boolean, true) then
    return jsonb_build_object('ok', true, 'enfileirado', false,
                              'motivo', v_freio ->> 'motivo',
                              'gasto_usd', v_freio -> 'gasto_usd',
                              'teto_usd', v_freio -> 'teto_usd',
                              'esperando', v_quantos);
  end if;

  -- O lote é de 20, e o número é medido: com 30, a resposta do modelo gastou
  -- 1.875 tokens de saída e a segunda chamada estourou o teto, voltando com
  -- JSON cortado. Vinte cabe com folga.
  --
  -- Teto de 15 rodadas = 300 candidatos por pedido. Acima disso, quem quiser
  -- pede de novo — e aí é outra decisão, com a conta à vista.
  v_rodadas := least(ceil(v_quantos::numeric / 20)::int, 15);

  for i in 1..v_rodadas loop
    v_fila := app.ia_enfileirar('triar_candidato',
                jsonb_build_object('purpose', 'triar_candidato', 'limite', 20),
                'triar:'
                  || to_char((now() at time zone 'America/Fortaleza')::date, 'YYYY-MM-DD')
                  || ':' || i::text);
    if coalesce((v_fila ->> 'enfileirado')::boolean, false) then
      v_enfileir := v_enfileir + 1;
    end if;
  end loop;

  return jsonb_build_object('ok', true, 'enfileirado', v_enfileir > 0,
                            'rodadas', v_enfileir, 'esperando', v_quantos);
end $function$;
