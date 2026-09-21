-- =====================================================================
-- Fase 3 — Automações do atendimento
--
-- Plano aprovado pelo Rafael em 21/09/2026: distribuição automática, mensagem
-- de fora do horário, respostas prontas com "/", etiquetas e "virar tarefa".
-- Só acréscimos; cada automação liga e desliga em Ajustes → Atendimento.
--
--   1. DISTRIBUIÇÃO: conversa nova de quem não tem responsável na base cai com
--      quem tem menos conversas abertas no setor; quando o menu automático manda
--      a conversa para outro setor, ela vai para alguém desse setor.
--   2. FORA DO HORÁRIO: quem escreve fora de seg–sex 8h–17h45 (ou em feriado)
--      recebe uma resposta automática, no máximo uma a cada 12 h por conversa, e
--      nunca por cima do menu automático.
--   3. RESPOSTAS PRONTAS: atalhos de texto ("/preco") que a caixa de resposta
--      oferece ao digitar "/".
--   4. VIRAR TAREFA: uma mensagem vira tarefa com prazo e responsável.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 0. Configuração
-- ---------------------------------------------------------------------
update public.app_settings
   set value = value
               || case when value ? 'distribuicao_automatica' then '{}'::jsonb
                       else '{"distribuicao_automatica": true}'::jsonb end
               || case when value ? 'ausencia_ativa' then '{}'::jsonb
                       else '{"ausencia_ativa": true}'::jsonb end
 where key = 'atendimento';

create or replace function app.atendimento_liga(p_chave text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select (s.value ->> p_chave)::boolean from public.app_settings s
                    where s.key = 'atendimento'), false)
$$;

-- ---------------------------------------------------------------------
-- 1. Distribuição automática
-- ---------------------------------------------------------------------
-- Roda ANTES de `conversations_before_write` (ordem alfabética dos gatilhos),
-- que é quem escolhe o dono padrão: o dono do parceiro, ou a pessoa de
-- `inbox.responsavel_padrao`. Parceiro com dono continua com ele — quem já
-- conversa com o fornecedor segue conversando. Só a conversa sem ninguém
-- natural é distribuída.
create or replace function app.conversations_a_distribuir()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_setor int;
  v_quem  uuid;
begin
  if new.assignee_id is not null or not app.atendimento_liga('distribuicao_automatica') then
    return new;
  end if;
  if new.organization_id is not null and exists (
       select 1 from public.organizations o
        join public.profiles p on p.id = o.owner_id and p.is_active
       where o.id = new.organization_id) then
    return new;
  end if;
  v_setor := coalesce(new.setor_id, app.setor_padrao());
  v_quem := app.setor_quem_recebe(v_setor);
  if v_quem is not null then
    new.setor_id := v_setor;
    new.assignee_id := v_quem;
  end if;
  return new;
end $$;

create trigger conversations_a_distribuir
  before insert on public.conversations
  for each row execute function app.conversations_a_distribuir();

-- O menu automático muda o setor → a conversa vai para alguém do setor novo,
-- se quem atende hoje não é de lá. Recriada a partir da 20260922100000.
create or replace function app.conversations_setor()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_setor int;
  v_quem  uuid;
begin
  if tg_op = 'INSERT' then
    new.setor_id := coalesce(new.setor_id, app.setor_padrao());
  elsif new.bot_opcao is distinct from old.bot_opcao and new.bot_opcao is not null
        and new.setor_id is not distinct from old.setor_id then
    v_setor := app.setor_da_opcao_do_bot(new.bot_opcao);
    new.setor_id := coalesce(v_setor, new.setor_id);
    -- NOVO (Fase 3)
    if v_setor is not null and v_setor is distinct from old.setor_id
       and app.atendimento_liga('distribuicao_automatica')
       and not exists (select 1 from public.setor_membros m
                        where m.setor_id = v_setor and m.profile_id = new.assignee_id) then
      v_quem := app.setor_quem_recebe(v_setor);
      new.assignee_id := coalesce(v_quem, new.assignee_id);
    end if;
  end if;
  return new;
end $$;

-- ---------------------------------------------------------------------
-- 2. Fora do horário
-- ---------------------------------------------------------------------
insert into public.message_templates (template_code, name, channel, category, segment, kind,
                                      language, body, is_active, version)
values ('GEN-SYS-AUSENCIA', 'Fora do horário (automática)', 'whatsapp', 'service', 'GEN', 'sistema',
        'pt_BR',
        'Oi! Recebemos sua mensagem. Nosso horário é de segunda a sexta, das 8h às 17h45, e a gente responde assim que voltar.',
        true, 1)
on conflict (template_code) do nothing;

create or replace function app.ausencia_responder(p_message_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  m public.messages%rowtype;
  c public.conversations%rowtype;
  v_tpl int := (select t.id from public.message_templates t where t.template_code = 'GEN-SYS-AUSENCIA' and t.is_active);
  v_msg uuid;
begin
  select * into m from public.messages where id = p_message_id;
  if not found or m.direction <> 'in'::app.msg_direction then
    return jsonb_build_object('respondeu', false, 'motivo', 'nao_e_entrada');
  end if;
  if not app.atendimento_liga('ausencia_ativa') or v_tpl is null then
    return jsonb_build_object('respondeu', false, 'motivo', 'desligada');
  end if;
  select * into c from public.conversations where id = m.conversation_id;
  if coalesce((app.janela_do_canal(c.channel, now(), true) ->> 'aberta')::boolean, false) then
    return jsonb_build_object('respondeu', false, 'motivo', 'dentro_do_horario');
  end if;
  if app.wa_motivo_de_recusa(c.organization_id, c.contact_id, c.peer_phone_e164) is not null
     or app.wa_parece_optout(coalesce(m.body, '')) then
    return jsonb_build_object('respondeu', false, 'motivo', 'contato_suprimido');
  end if;
  -- Nunca por cima de outra resposta automática da mesma chegada (o menu).
  if exists (select 1 from public.messages x
              where x.conversation_id = c.id and x.direction = 'out'::app.msg_direction
                and x.created_at >= m.created_at) then
    return jsonb_build_object('respondeu', false, 'motivo', 'ja_respondida');
  end if;
  if exists (select 1 from public.messages x
              where x.conversation_id = c.id and x.template_id = v_tpl
                and x.created_at > now() - interval '12 hours') then
    return jsonb_build_object('respondeu', false, 'motivo', 'ja_avisou');
  end if;

  v_msg := app.wa_bot_dizer(c.id, 'GEN-SYS-AUSENCIA');
  return jsonb_build_object('respondeu', v_msg is not null, 'message_id', v_msg);
end $$;

create or replace function app.messages_x_ausencia()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  begin
    perform app.ausencia_responder(new.id);
  exception when others then
    raise warning 'ausencia_responder(%): %', new.id, sqlerrm;
  end;
  return null;
end $$;

-- `x`: depois do menu automático e antes do lead automático (`zz`).
create trigger messages_x_ausencia
  after insert on public.messages
  for each row when (new.direction = 'in'::app.msg_direction)
  execute function app.messages_x_ausencia();

-- ---------------------------------------------------------------------
-- 3. Respostas prontas
-- ---------------------------------------------------------------------
create table public.respostas_rapidas (
  id         int generated always as identity primary key,
  atalho     text not null unique check (atalho ~ '^[a-z0-9][a-z0-9_-]{1,29}$'),
  titulo     text not null check (length(btrim(titulo)) between 2 and 60),
  texto      text not null check (length(btrim(texto)) between 1 and 1000),
  ativo      boolean not null default true,
  criado_por uuid references public.profiles (id) default auth.uid(),
  criado_em  timestamptz not null default now()
);
comment on table public.respostas_rapidas is
  'Atalhos de texto da caixa de resposta ("/preco"). Fase 3. Quem escreve usa; gestor e admin cadastram.';
alter table public.respostas_rapidas enable row level security;
create policy respostas_rapidas_select on public.respostas_rapidas
  for select to authenticated using (true);
create policy respostas_rapidas_escrita on public.respostas_rapidas
  for all to authenticated using (app.is_manager()) with check (app.is_manager());
grant select, insert, update, delete on public.respostas_rapidas to authenticated;

insert into public.respostas_rapidas (atalho, titulo, texto, criado_por) values
  ('custo', 'Quanto custa', 'Estar na Komune é de graça: não tem mensalidade nem adesão. Só existe custo quando vocês fecham um serviço pela plataforma.', null),
  ('cadastro', 'Link do cadastro', 'O cadastro leva 5 minutos e é grátis: https://admin.komune.app.br/seja-parceiro', null),
  ('horario', 'Nosso horário', 'Nosso horário é de segunda a sexta, das 8h às 17h45.', null);

-- ---------------------------------------------------------------------
-- 4. Configurar o atendimento (Ajustes → Atendimento)
-- ---------------------------------------------------------------------
create or replace function public.atendimento_configurar(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_texto text := nullif(btrim(coalesce(p ->> 'texto_ausencia', '')), '');
  v_novo  jsonb := '{}'::jsonb;
  k       text;
begin
  if auth.uid() is null or not app.is_manager() then
    return jsonb_build_object('ok', false, 'motivo', 'sem_permissao');
  end if;
  foreach k in array array['lead_automatico', 'distribuicao_automatica', 'ausencia_ativa'] loop
    if p ? k then
      if jsonb_typeof(p -> k) <> 'boolean' then
        return jsonb_build_object('ok', false, 'motivo', 'valor_invalido', 'campo', k);
      end if;
      v_novo := v_novo || jsonb_build_object(k, p -> k);
    end if;
  end loop;
  if v_texto is not null and length(v_texto) > 1000 then
    return jsonb_build_object('ok', false, 'motivo', 'texto_longo_demais');
  end if;

  update public.app_settings set value = value || v_novo, updated_by = auth.uid()
   where key = 'atendimento';
  if v_texto is not null then
    update public.message_templates set body = v_texto where template_code = 'GEN-SYS-AUSENCIA';
  end if;
  return jsonb_build_object('ok', true);
end $$;

-- ---------------------------------------------------------------------
-- 5. Virar tarefa
-- ---------------------------------------------------------------------
create or replace function public.virar_tarefa(p_message_id uuid, p_titulo text default null,
                                               p_quando timestamptz default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_eu   uuid := auth.uid();
  m      public.messages%rowtype;
  c      public.conversations%rowtype;
  v_tit  text;
  v_id   uuid;
begin
  if v_eu is null or not app.can_write() then
    return jsonb_build_object('ok', false, 'motivo', 'sem_permissao');
  end if;
  select * into m from public.messages where id = p_message_id;
  if not found then
    return jsonb_build_object('ok', false, 'motivo', 'mensagem_inexistente');
  end if;
  select * into c from public.conversations where id = m.conversation_id;
  if not (app.sees_all() or c.assignee_id = v_eu
          or (c.organization_id is not null and app.org_is_visible(c.organization_id))) then
    return jsonb_build_object('ok', false, 'motivo', 'mensagem_inexistente');
  end if;
  v_tit := left(coalesce(nullif(btrim(p_titulo), ''),
                         nullif(regexp_replace(btrim(coalesce(m.body, '')), '\s+', ' ', 'g'), ''),
                         'Retomar a conversa no WhatsApp'), 200);
  insert into public.tasks (title, kind, priority, due_at, assignee_id, organization_id,
                            contact_id, created_by, origin)
  values (v_tit, 'follow_up'::app.task_kind, 2,
          coalesce(p_quando,
                   ((app.next_business_day((now() at time zone 'America/Fortaleza')::date) + time '09:00')
                     at time zone 'America/Fortaleza')),
          v_eu, c.organization_id, c.contact_id, v_eu, 'manual')
  returning id into v_id;
  return jsonb_build_object('ok', true, 'task_id', v_id, 'titulo', v_tit);
end $$;

-- ---------------------------------------------------------------------
-- 6. Permissões
-- ---------------------------------------------------------------------
revoke all on function app.atendimento_liga(text) from public, anon, authenticated;
revoke all on function app.conversations_a_distribuir() from public, anon, authenticated;
revoke all on function app.ausencia_responder(uuid) from public, anon, authenticated;
revoke all on function app.messages_x_ausencia() from public, anon, authenticated;
revoke all on function public.atendimento_configurar(jsonb) from public, anon;
grant execute on function public.atendimento_configurar(jsonb) to authenticated;
revoke all on function public.virar_tarefa(uuid, text, timestamptz) from public, anon;
grant execute on function public.virar_tarefa(uuid, text, timestamptz) to authenticated;
