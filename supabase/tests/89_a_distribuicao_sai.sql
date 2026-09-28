-- =====================================================================
-- pgTAP — A distribuição automática sai (migração 20261002170000)
--
-- POR QUE
-- Rafael, 28/09/2026: "não distribua automático, estamos com operadores
-- reduzidos que nem logam às vezes". Distribuir para quem não entra é o mesmo
-- que esconder: a conversa fica com nome, e o nome não abre o CRM.
--
-- O QUE ESTE ARQUIVO NÃO DEIXA ALGUÉM ACREDITAR
-- Desligar a distribuição NÃO cria conversa sem dono: `assignee_id` é `not null`
-- (20260905000200:613) e `app.conversations_before_write` (:675) preenche numa
-- cascata — dono da ficha, `inbox.responsavel_padrao`, primeiro perfil ativo
-- admin/gestor/sdr, e só então exceção. O que muda é QUAL dono. Por isso a
-- asserção 3 existe: ela é a razão de a 20261002180000 (a fila de todos) subir
-- na mesma rodada. Sem ela, desligar a distribuição só trocaria um nome errado
-- por outro nome errado.
--
-- E A CONSEQUÊNCIA QUE NÃO ESTAVA NO PEDIDO (asserção 6)
-- `app.conversations_setor()` (20260922120000:101) lê a MESMA chave. Com ela
-- desligada, o menu do bot continua mudando o setor da conversa e deixa de
-- reencaminhá-la para alguém desse setor. Está aqui por escrito para ninguém
-- descobrir isso por acidente daqui a três meses.
--
-- NENHUMA asserção conta linha absoluta em tabela compartilhada.
-- Roda em transação e desfaz tudo.
-- =====================================================================
begin;
select plan(6);

-- ---------- utilitários de sessão (simulam o JWT do PostgREST) ----------
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

-- ---------- o ambiente ----------
insert into public.allowed_users (email, role, note) values
  ('h89.gestor@teste.local', 'gestor', 'pgTAP distribuição sai'),
  ('h89.sdr1@teste.local',   'sdr',    'pgTAP distribuição sai'),
  ('h89.sdr2@teste.local',   'sdr',    'pgTAP distribuição sai');
insert into auth.users (id, email, raw_user_meta_data) values
  ('a0000000-0000-4000-8000-000000008901'::uuid, 'h89.gestor@teste.local', '{"full_name":"Gil Gestor"}'),
  ('a0000000-0000-4000-8000-000000008902'::uuid, 'h89.sdr1@teste.local',   '{"full_name":"Sara SDR"}'),
  ('a0000000-0000-4000-8000-000000008903'::uuid, 'h89.sdr2@teste.local',   '{"full_name":"Ana SDR"}');

create function pg_temp.gestor() returns uuid language sql stable as $$ select 'a0000000-0000-4000-8000-000000008901'::uuid $$;
create function pg_temp.sdr1()   returns uuid language sql stable as $$ select 'a0000000-0000-4000-8000-000000008902'::uuid $$;
create function pg_temp.sdr2()   returns uuid language sql stable as $$ select 'a0000000-0000-4000-8000-000000008903'::uuid $$;

-- Os dois sdr são do Comercial (o setor padrão); nenhum deles é do Financeiro,
-- que é para onde a opção 3 do menu do bot manda — é essa diferença que a
-- asserção 6 mede.
insert into public.setor_membros (setor_id, profile_id)
values (app.setor_por_slug('comercial'), pg_temp.sdr1()),
       (app.setor_por_slug('comercial'), pg_temp.sdr2());

update public.app_settings set value = jsonb_set(value, '{numero_padrao}', '"+5584999998900"')
 where key = 'whatsapp.envio';
-- O bot de entrada fica desligado: ele responderia sozinho e escreveria saída na
-- conversa. Aqui a pergunta é só sobre QUEM recebe a conversa, não sobre texto.
update public.app_settings set value = jsonb_set(value, '{ativo}', 'false')
 where key = 'whatsapp.bot_de_entrada';

-- A conversa nasce como o webhook a cria: SEM ficha e SEM dono, para não cair no
-- degrau "dono da ficha" da cascata do before_write.
create function pg_temp.conversa_sem_ficha(p_tel text) returns uuid language sql as $$
  insert into public.conversations (channel, business_number, peer_phone_e164,
                                    status, last_inbound_at, last_message_at)
  values ('whatsapp'::app.channel, app.wa_numero_padrao(), p_tel,
          'aguardando_nos', now(), now())
  returning id
$$;

-- O fallback do before_write (20260905000200:686-692), escrito aqui com a MESMA
-- ordenação, porque a asserção 3 precisa dizer que é ELE, e não o setor.
create function pg_temp.fallback() returns uuid language sql stable as $$
  select p.id from public.profiles p
   where p.is_active and p.role in ('admin'::app.user_role, 'gestor'::app.user_role,
                                    'sdr'::app.user_role)
   order by case p.role when 'admin'::app.user_role then 0
                        when 'gestor'::app.user_role then 1 else 2 end, p.created_at
   limit 1
$$;

-- =====================================================================
-- 1 · O PADRÃO DO BANCO RECÉM-RESETADO
-- =====================================================================
select ok(not app.atendimento_liga('distribuicao_automatica'),
  'depois das migrações a distribuição nasce DESLIGADA: o db reset não a religa pelas costas');

-- =====================================================================
-- 2 e 3 · CONVERSA NOVA CONTINUA TENDO DONO — mas é OUTRO dono
-- =====================================================================
select pg_temp.conversa_sem_ficha('+5584999998901');

select isnt((select assignee_id from public.conversations where peer_phone_e164 = '+5584999998901'),
  null,
  'conversa nova continua com dono: assignee_id é not null e a cascata do before_write o preenche — desligar a distribuição não cria órfão');

select is((select assignee_id from public.conversations where peer_phone_e164 = '+5584999998901'),
  pg_temp.fallback(),
  'o dono é o fallback do before_write, não app.setor_quem_recebe: é isto que faz a fila de quem respondeu precisar ser de todos');

-- =====================================================================
-- 4 e 5 · O INTERRUPTOR CONTINUA SENDO UM INTERRUPTOR
-- =====================================================================
select pg_temp.entrar(pg_temp.gestor(), 'gestor');
select is(public.atendimento_configurar('{"distribuicao_automatica": true}') ->> 'ok', 'true',
  'o gestor religa em Ajustes → Atendimento, sem deploy: isto é uma chave, não uma remoção de código');
select pg_temp.sair();

-- O ESPERADO É CAPTURADO ANTES DO INSERT: app.setor_quem_recebe escolhe quem tem
-- menos conversas ABERTAS (20260922100000:184), e o próprio insert mudaria a
-- resposta se ela fosse avaliada depois. Guardar numa tabela temporária congela
-- a pergunta no instante certo.
create table pg_temp.esperado as select app.setor_quem_recebe(app.setor_padrao()) as quem;
select pg_temp.conversa_sem_ficha('+5584999998902');
select is((select assignee_id from public.conversations where peer_phone_e164 = '+5584999998902'),
  (select quem from pg_temp.esperado),
  'religada, a distribuição volta a entregar a quem tem menos conversas abertas no setor: o comportamento não foi apagado, só desligado');

-- =====================================================================
-- 6 · A CONSEQUÊNCIA FORA DO PEDIDO, medida e não escondida
-- =====================================================================
-- Com a chave DESLIGADA, o menu do bot muda o setor e NÃO reencaminha
-- (app.conversations_setor, 20260922120000:101). A opção '3' é o Financeiro, e
-- nenhum dos dois sdr é membro dele — sem a chave, o `if` inteiro é pulado.
select public.atendimento_configurar('{"distribuicao_automatica": false}');
create table pg_temp.dono_antes as
  select assignee_id, setor_id from public.conversations where peer_phone_e164 = '+5584999998902';
update public.conversations set bot_opcao = '3' where peer_phone_e164 = '+5584999998902';

select is(
  (select c.assignee_id::text || '|' || (c.setor_id is distinct from a.setor_id)::text
     from public.conversations c, pg_temp.dono_antes a
    where c.peer_phone_e164 = '+5584999998902'),
  (select a.assignee_id::text || '|true' from pg_temp.dono_antes a),
  'com a chave desligada o menu do bot MUDA o setor e NÃO reencaminha: consequência que o Rafael não pediu e precisa saber');

select * from finish();
rollback;
