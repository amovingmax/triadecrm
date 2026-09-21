-- =====================================================================
-- Fase 1 — Atendimento em equipe: setores, fila por setor e transferência
--
-- Decisão do Rafael em 21/09/2026 (alinhamento com a referência de produto):
-- setores Comercial, Suporte e Financeiro; a conversa cai no setor certo; quem
-- atende pode transferir para uma pessoa ou para um setor, com nota, e quem
-- recebe fica sabendo. Nada é apagado: só colunas, tabelas e funções novas.
--
-- O QUE ENTRA
--   1. `setores` e `setor_membros` (quem trabalha em qual setor).
--   2. `conversations.setor_id`: toda conversa nasce num setor (o padrão é o
--      Comercial, porque quase tudo o que o CRM começa é captação) e o menu
--      automático do WhatsApp a muda quando a pessoa escolhe "financeiro" ou
--      "suporte".
--   3. `public.transferir_conversa`: para uma pessoa, ou para um setor — e,
--      como toda conversa precisa de alguém atendendo, o setor entrega a quem
--      tem menos conversas abertas nele. A nota fica registrada e vira tarefa
--      para quem recebe.
--   4. `public.definir_setores_da_pessoa`: Ajustes → Pessoas.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Setores
-- ---------------------------------------------------------------------
create table public.setores (
  id        int generated always as identity primary key,
  slug      text not null unique check (slug ~ '^[a-z][a-z0-9_]*$'),
  nome      text not null check (length(btrim(nome)) between 2 and 40),
  posicao   int not null default 0,
  ativo     boolean not null default true,
  criado_em timestamptz not null default now()
);
comment on table public.setores is
  'Setores do atendimento (Fase 1, 21/09/2026). A conversa cai num setor; a aba "Meu setor" mostra as conversas dos setores de quem está usando.';

insert into public.setores (slug, nome, posicao) values
  ('comercial', 'Comercial', 1),
  ('suporte', 'Suporte', 2),
  ('financeiro', 'Financeiro', 3);

create table public.setor_membros (
  setor_id   int  not null references public.setores (id) on delete cascade,
  profile_id uuid not null references public.profiles (id) on delete cascade,
  primary key (setor_id, profile_id)
);
create index setor_membros_pessoa on public.setor_membros (profile_id);

alter table public.setores enable row level security;
alter table public.setor_membros enable row level security;
create policy setores_select on public.setores for select to authenticated using (true);
create policy setores_escrita on public.setores for all to authenticated
  using (app.is_manager()) with check (app.is_manager());
create policy setor_membros_select on public.setor_membros for select to authenticated using (true);
grant select on public.setores, public.setor_membros to authenticated;
grant insert, update on public.setores to authenticated;

insert into public.app_settings (key, value, description) values
  ('atendimento', jsonb_build_object(
     'setor_padrao', 'comercial',
     'setor_por_intencao', jsonb_build_object(
       'parceria', 'comercial', 'cliente', 'comercial',
       'financeiro', 'financeiro', 'suporte', 'suporte')),
   'Atendimento em equipe: o setor em que a conversa nasce e para onde o menu automático do WhatsApp a manda, por intenção escolhida.')
on conflict (key) do nothing;

-- ---------------------------------------------------------------------
-- 2. A conversa tem setor
-- ---------------------------------------------------------------------
alter table public.conversations
  add column if not exists setor_id int references public.setores (id);
create index if not exists conversations_setor on public.conversations (setor_id);

create or replace function app.setor_por_slug(p_slug text)
returns int
language sql
stable
security definer
set search_path = ''
as $$
  select s.id from public.setores s where s.slug = p_slug and s.ativo
$$;

create or replace function app.setor_padrao()
returns int
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    app.setor_por_slug((select a.value ->> 'setor_padrao' from public.app_settings a
                         where a.key = 'atendimento')),
    app.setor_por_slug('comercial'))
$$;

-- O setor de uma escolha do menu automático: chave → intenção → setor.
create or replace function app.setor_da_opcao_do_bot(p_chave text)
returns int
language sql
stable
security definer
set search_path = ''
as $$
  select app.setor_por_slug(
           (select a.value -> 'setor_por_intencao' ->> (o ->> 'intencao')
              from public.app_settings a
             where a.key = 'atendimento'))
    from public.app_settings b
    cross join lateral jsonb_array_elements(coalesce(b.value -> 'opcoes', '[]'::jsonb)) o
   where b.key = 'whatsapp.bot_de_entrada' and o ->> 'chave' = p_chave
   limit 1
$$;

create or replace function app.conversations_setor()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_setor int;
begin
  if tg_op = 'INSERT' then
    new.setor_id := coalesce(new.setor_id, app.setor_padrao());
  elsif new.bot_opcao is distinct from old.bot_opcao and new.bot_opcao is not null
        and new.setor_id is not distinct from old.setor_id then
    -- A pessoa disse no menu do que precisa: a conversa vai para esse setor.
    -- Só quando ninguém mexeu no setor na mesma operação.
    v_setor := app.setor_da_opcao_do_bot(new.bot_opcao);
    new.setor_id := coalesce(v_setor, new.setor_id);
  end if;
  return new;
end $$;

create trigger conversations_setor
  before insert or update of bot_opcao on public.conversations
  for each row execute function app.conversations_setor();

-- As conversas que já existem: pelo menu, se passaram por ele; senão, padrão.
update public.conversations c
   set setor_id = coalesce(app.setor_da_opcao_do_bot(c.bot_opcao), app.setor_padrao())
 where c.setor_id is null;

-- ---------------------------------------------------------------------
-- 3. Transferência
-- ---------------------------------------------------------------------
create table public.conversa_transferencias (
  id           bigint generated always as identity primary key,
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  de_pessoa    uuid references public.profiles (id),
  para_pessoa  uuid references public.profiles (id),
  de_setor     int references public.setores (id),
  para_setor   int references public.setores (id),
  nota         text check (nota is null or length(nota) <= 500),
  feita_por    uuid not null references public.profiles (id),
  feita_em     timestamptz not null default now()
);
create index conversa_transferencias_conversa on public.conversa_transferencias (conversation_id, feita_em desc);
comment on table public.conversa_transferencias is
  'Quem passou a conversa para quem, com a nota. É o "histórico junto" da transferência (Fase 1).';

alter table public.conversa_transferencias enable row level security;
create policy conversa_transferencias_select on public.conversa_transferencias
  for select to authenticated
  using (exists (select 1 from public.conversations c where c.id = conversation_id));
grant select on public.conversa_transferencias to authenticated;

-- Quem do setor recebe: a pessoa ativa, que escreve, com menos conversas
-- abertas. Empate: quem recebeu a última há mais tempo não importa aqui — o
-- desempate é pelo nome, para ser previsível. Setor sem ninguém: null.
create or replace function app.setor_quem_recebe(p_setor int)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select m.profile_id
    from public.setor_membros m
    join public.profiles p on p.id = m.profile_id
   where m.setor_id = p_setor
     and p.is_active
     and p.role in ('admin', 'gestor', 'sdr', 'embaixador')
   order by (select count(*) from public.conversations c
              where c.assignee_id = m.profile_id and c.status <> 'resolvida'),
            p.full_name
   limit 1
$$;

create or replace function public.transferir_conversa(p_conversation_id uuid,
                                                      p_para_pessoa uuid default null,
                                                      p_para_setor int default null,
                                                      p_nota text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_eu     uuid := auth.uid();
  c        public.conversations%rowtype;
  v_pessoa uuid;
  v_setor  int;
  v_nota   text := nullif(btrim(coalesce(p_nota, '')), '');
  v_nome   text;
begin
  if v_eu is null or not app.can_write() then
    return jsonb_build_object('ok', false, 'motivo', 'sem_permissao');
  end if;
  select * into c from public.conversations where id = p_conversation_id for update;
  if not found
     or not (app.sees_all() or c.assignee_id = v_eu
             or (c.organization_id is not null and app.org_is_visible(c.organization_id))) then
    return jsonb_build_object('ok', false, 'motivo', 'conversa_inexistente');
  end if;
  if p_para_pessoa is null and p_para_setor is null then
    return jsonb_build_object('ok', false, 'motivo', 'sem_destino');
  end if;
  if v_nota is not null and length(v_nota) > 500 then
    return jsonb_build_object('ok', false, 'motivo', 'nota_longa_demais');
  end if;

  v_setor := coalesce(p_para_setor, c.setor_id);
  if p_para_setor is not null
     and not exists (select 1 from public.setores s where s.id = p_para_setor and s.ativo) then
    return jsonb_build_object('ok', false, 'motivo', 'setor_invalido');
  end if;

  if p_para_pessoa is not null then
    if not exists (select 1 from public.profiles p
                    where p.id = p_para_pessoa and p.is_active
                      and p.role in ('admin', 'gestor', 'sdr', 'embaixador')) then
      return jsonb_build_object('ok', false, 'motivo', 'pessoa_invalida');
    end if;
    v_pessoa := p_para_pessoa;
  else
    -- Só o setor: ele entrega a quem tem menos conversas abertas. Setor sem
    -- ninguém cadastrado: a conversa muda de setor e fica com quem está.
    v_pessoa := coalesce(app.setor_quem_recebe(p_para_setor), c.assignee_id);
  end if;

  if v_pessoa = c.assignee_id and v_setor is not distinct from c.setor_id then
    return jsonb_build_object('ok', false, 'motivo', 'nada_mudou');
  end if;

  update public.conversations
     set assignee_id = v_pessoa, setor_id = v_setor, updated_at = now()
   where id = c.id;

  insert into public.conversa_transferencias (conversation_id, de_pessoa, para_pessoa,
                                              de_setor, para_setor, nota, feita_por)
  values (c.id, c.assignee_id, v_pessoa, c.setor_id, v_setor, v_nota, v_eu);

  -- Quem recebe fica sabendo: uma tarefa para agora, com a nota.
  if v_pessoa is distinct from v_eu and v_pessoa is distinct from c.assignee_id then
    v_nome := coalesce((select o.name from public.organizations o where o.id = c.organization_id),
                       c.peer_phone_e164);
    insert into public.tasks (title, kind, priority, due_at, assignee_id, organization_id,
                              contact_id, created_by, origin)
    values (left('Conversa passada para você: ' || v_nome
                 || coalesce(' — ' || v_nota, ''), 300),
            'message'::app.task_kind, 1, now(), v_pessoa, c.organization_id, c.contact_id,
            v_eu, 'manual');
  end if;

  return jsonb_build_object('ok', true, 'para', app.primeiro_nome(v_pessoa),
                            'setor', (select s.nome from public.setores s where s.id = v_setor));
end $$;

-- ---------------------------------------------------------------------
-- 4. Quem é de qual setor
-- ---------------------------------------------------------------------
create or replace function public.definir_setores_da_pessoa(p_profile_id uuid, p_setores int[])
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not app.is_manager() then
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
end $$;

-- ---------------------------------------------------------------------
-- 5. Permissões
-- ---------------------------------------------------------------------
revoke all on function app.setor_por_slug(text) from public, anon, authenticated;
revoke all on function app.setor_padrao() from public, anon, authenticated;
revoke all on function app.setor_da_opcao_do_bot(text) from public, anon, authenticated;
revoke all on function app.conversations_setor() from public, anon, authenticated;
revoke all on function app.setor_quem_recebe(int) from public, anon, authenticated;
revoke all on function public.transferir_conversa(uuid, uuid, int, text) from public, anon;
grant execute on function public.transferir_conversa(uuid, uuid, int, text) to authenticated;
revoke all on function public.definir_setores_da_pessoa(uuid, int[]) from public, anon;
grant execute on function public.definir_setores_da_pessoa(uuid, int[]) to authenticated;

create trigger audit_setor_membros after insert or update or delete on public.setor_membros
  for each row execute function app.audit();
