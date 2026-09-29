-- =====================================================================
-- pgTAP — Arquivar a conversa (migração 20261002250000)
--
-- Rafael, 29/09/2026: "crie a funcionalidade de apagar o chat". Perguntado se
-- "apagar" era sumir da lista (com volta) ou apagar do banco (sem volta), ele
-- escolheu ARQUIVAR. Este arquivo prova as quatro coisas que fazem arquivar ser
-- diferente de apagar:
--
--   1. NADA É DESTRUÍDO. As mensagens continuam todas lá.
--   2. VOLTA COM UM CLIQUE.
--   3. E VOLTA SOZINHA quando o parceiro escreve. Sem isto, arquivar seria uma
--      armadilha: alguém arruma a lista na terça, o fornecedor responde na
--      quinta, e ninguém vê.
--   4. NINGUÉM ARQUIVA O QUE NÃO ENXERGA. Definer é para poder gravar, não para
--      furar a política de leitura.
--
-- Roda em transação e desfaz tudo.
-- =====================================================================
begin;
select plan(11);

insert into public.allowed_users (email, role, note) values
  ('h93.g@teste.local', 'gestor', 'pgTAP arquivar'),
  ('h93.e@teste.local', 'embaixador', 'pgTAP arquivar');
insert into auth.users (id, email, raw_user_meta_data) values
  ('a0000000-0000-4000-8000-000000009301'::uuid, 'h93.g@teste.local', '{"full_name":"Gil Gestor"}'),
  ('a0000000-0000-4000-8000-000000009302'::uuid, 'h93.e@teste.local', '{"full_name":"Ema Embaixadora"}');

update public.app_settings set value = jsonb_set(value, '{numero_padrao}', '"+5584999999300"')
 where key = 'whatsapp.envio';
update public.app_settings
   set value = value || '{"introducao_ativa": false, "lead_automatico": false,
                          "distribuicao_automatica": false, "ausencia_ativa": false,
                          "cumprimento_automatico": false}'::jsonb
 where key = 'atendimento';
update public.app_settings set value = jsonb_set(value, '{ativo}', 'false')
 where key = 'whatsapp.bot_de_entrada';

create function pg_temp.entrar(p_uid uuid, p_papel text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_uid, 'role', 'authenticated',
                      'app_metadata', json_build_object('app_role', p_papel))::text, true);
  execute 'set local role authenticated';
end $$;
create function pg_temp.sair() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '', true);
  execute 'reset role';
end $$;

create function pg_temp.conversa() returns uuid language plpgsql as $$
declare v_org uuid; v_conv uuid;
begin
  insert into public.organizations (name, phone_e164, source_id, collector)
  values ('Buffet do pgTAP 93', '+5584999999301',
          (select id from public.sources where slug = 'planilha'), 'pgtap93')
  returning id into v_org;
  insert into public.conversations (channel, business_number, peer_phone_e164, organization_id,
                                    assignee_id, status)
  values ('whatsapp'::app.channel, '+5584999999300', '+5584999999301', v_org,
          'a0000000-0000-4000-8000-000000009301'::uuid, 'aguardando_nos')
  returning id into v_conv;
  insert into public.messages (conversation_id, direction, type, status, body, author_kind, origin)
  values (v_conv, 'in'::app.msg_direction, 'text'::app.msg_type, 'received'::app.msg_status,
          'bom dia, me explica', 'system', 'crm');
  return v_conv;
end $$;
create temp table t93(chave text primary key, valor uuid);
insert into t93 values ('conv', pg_temp.conversa());
-- O `set local role authenticated` de `pg_temp.entrar` vale também para as
-- funções auxiliares: sem este grant, `pg_temp.conv()` morre com "permission
-- denied for table t93" no meio da asserção, e o erro fala da tabela do teste,
-- não da regra que se mede.
grant select on t93 to authenticated;
create function pg_temp.conv() returns uuid language sql stable as $$
  select valor from t93 where chave = 'conv'
$$;
create function pg_temp.mensagens() returns int language sql stable as $$
  select count(*)::int from public.messages where conversation_id = pg_temp.conv()
$$;
create function pg_temp.arquivada() returns boolean language sql stable as $$
  select arquivada_em is not null from public.conversations where id = pg_temp.conv()
$$;

-- =====================================================================
-- 1. Arquiva, e nada é destruído
-- =====================================================================
select ok(not pg_temp.arquivada(), 'a conversa nasce fora do arquivo');

select pg_temp.entrar('a0000000-0000-4000-8000-000000009301'::uuid, 'gestor');
select is(public.conversa_arquivar(pg_temp.conv()) ->> 'ok', 'true',
  'quem atende arquiva a própria conversa');
select pg_temp.sair();

select ok(pg_temp.arquivada(), 'e ela fica marcada como arquivada');
select is(pg_temp.mensagens(), 1,
  'A DIFERENÇA ENTRE ARQUIVAR E APAGAR: a mensagem continua inteira no fio');
select is((select arquivada_por from public.conversations where id = pg_temp.conv()),
  'a0000000-0000-4000-8000-000000009301'::uuid,
  'e fica registrado quem arquivou, para quem abrir saber a quem perguntar');

-- =====================================================================
-- 2. Volta com um clique
-- =====================================================================
select pg_temp.entrar('a0000000-0000-4000-8000-000000009301'::uuid, 'gestor');
select is(public.conversa_arquivar(pg_temp.conv(), false) ->> 'ok', 'true',
  'e desarquiva pela mesma porta');
select pg_temp.sair();
select ok(not pg_temp.arquivada(), 'a conversa voltou para a lista');

-- =====================================================================
-- 3. Volta SOZINHA quando o parceiro escreve
-- =====================================================================
select pg_temp.entrar('a0000000-0000-4000-8000-000000009301'::uuid, 'gestor');
select public.conversa_arquivar(pg_temp.conv());
select pg_temp.sair();
select ok(pg_temp.arquivada(), 'arquivada de novo, para o próximo caso');

insert into public.messages (conversation_id, direction, type, status, body, author_kind, origin)
values (pg_temp.conv(), 'in'::app.msg_direction, 'text'::app.msg_type,
        'received'::app.msg_status, 'oi, pensei melhor', 'system', 'crm');
select ok(not pg_temp.arquivada(),
  'o parceiro escreveu e a conversa VOLTOU sozinha: arquivar diz "nada a fazer agora", não "não me importa mais"');

-- E saída nossa NÃO desarquiva: quem arquivou não quer a conversa de volta
-- porque o robô ou alguém mandou alguma coisa — só porque a pessoa respondeu.
select pg_temp.entrar('a0000000-0000-4000-8000-000000009301'::uuid, 'gestor');
select public.conversa_arquivar(pg_temp.conv());
select pg_temp.sair();
insert into public.messages (conversation_id, direction, type, status, body,
                             author_kind, sent_by, origin)
values (pg_temp.conv(), 'out'::app.msg_direction, 'text'::app.msg_type, 'queued'::app.msg_status,
        'oi', 'human', 'a0000000-0000-4000-8000-000000009301'::uuid, 'crm');
select ok(pg_temp.arquivada(), 'mas mensagem NOSSA não desarquiva: quem volta é a pessoa, não nós');

-- =====================================================================
-- 4. Ninguém arquiva o que não enxerga
-- =====================================================================
select pg_temp.entrar('a0000000-0000-4000-8000-000000009302'::uuid, 'embaixador');
select is(public.conversa_arquivar(pg_temp.conv(), false) ->> 'motivo', 'sem_permissao',
  'o embaixador não arquiva (nem desarquiva) conversa que a RLS não lhe mostra');
select pg_temp.sair();

select * from finish();
rollback;
