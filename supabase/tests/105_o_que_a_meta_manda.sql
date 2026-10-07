-- =====================================================================
-- pgTAP — O que a Meta manda e o CRM não conhecia (migração 20261007120000)
--
-- Quatro mensagens seguidas apareciam como "Aviso do WhatsApp sem arquivo
-- guardado". Este arquivo prova:
--
--   1. A FIGURINHA entra como imagem, com o tipo original guardado, e cai na
--      fila de recuperação de mídias do worker (é assim que ela é baixada);
--   2. A RESPOSTA DE BOTÃO entra como botão, com o texto;
--   3. O QUE A META NÃO ENTREGA (`unsupported`) continua entrando, como aviso,
--      mas agora com o nome guardado;
--   4. O QUE O CRM JÁ CONHECIA não ganha tipo original nenhum;
--   5. A TRADUÇÃO nunca falha, e reentrega não duplica.
--
-- Roda em transação e desfaz tudo.
-- =====================================================================
begin;
select plan(14);

insert into public.allowed_users (email, role, note) values ('m105.g@teste.local', 'gestor', 'pgTAP 105');
insert into auth.users (id, email, raw_user_meta_data)
values ('a0000000-0000-4000-8000-000000010501', 'm105.g@teste.local', '{"full_name":"Gil Gestor"}');

-- Sem robô, sem lead automático: aqui se mede a entrada, não o que vem depois.
update public.app_settings set value = jsonb_set(value, '{numero_padrao}', '"+5584999910500"')
 where key = 'whatsapp.envio';
update public.app_settings set value = jsonb_set(value, '{ativo}', 'false')
 where key = 'whatsapp.bot_de_entrada';
update public.app_settings set value = jsonb_set(value, '{lead_automatico}', 'false')
 where key = 'atendimento';

create function pg_temp.linha(p_wamid text) returns table (tipo text, tipo_na_meta text, corpo text)
language sql security definer set search_path = '' as $$
  select type::text, tipo_na_meta, body from public.messages where wa_message_id = p_wamid
$$;

set role service_role;
select public.wa_entrada_registrar('wamid.M105.FIG', '+5584999910500', '+5584999910599', 'sticker', null, 'mid-105', 'image/webp');
select public.wa_entrada_registrar('wamid.M105.BOT', '+5584999910500', '+5584999910599', 'button', 'Quero saber mais');
select public.wa_entrada_registrar('wamid.M105.UNS', '+5584999910500', '+5584999910599', 'unsupported');
select public.wa_entrada_registrar('wamid.M105.TXT', '+5584999910500', '+5584999910599', 'text', 'oi');
select public.wa_entrada_registrar('wamid.M105.IMG', '+5584999910500', '+5584999910599', 'image', null, 'mid-105b', 'image/jpeg');
create temp table r105 as
  select public.wa_entrada_registrar('wamid.M105.FIG', '+5584999910500', '+5584999910599', 'sticker', null, 'mid-105', 'image/webp') as j;
reset role;

-- 1 · a figurinha
select results_eq($$select tipo, tipo_na_meta from pg_temp.linha('wamid.M105.FIG')$$,
  $$values ('image'::text, 'sticker'::text)$$,
  'a figurinha entra como imagem, e o tipo da Meta fica guardado');
select is(
  (select count(*)::int from public.wa_midias_sem_arquivo(100) r
     join public.messages m on m.id = r.message_id where m.wa_message_id = 'wamid.M105.FIG'),
  1, 'e entra na fila de recuperação de mídias do worker: é assim que o arquivo chega');

-- 2 · o botão
select results_eq($$select tipo, tipo_na_meta, corpo from pg_temp.linha('wamid.M105.BOT')$$,
  $$values ('interactive'::text, 'button'::text, 'Quero saber mais'::text)$$,
  'a resposta a um botão de modelo entra como botão, com o texto');

-- 3 · o que a Meta não entrega
select results_eq($$select tipo, tipo_na_meta from pg_temp.linha('wamid.M105.UNS')$$,
  $$values ('system'::text, 'unsupported'::text)$$,
  'o que a Meta não entrega continua entrando, agora com o nome');

-- 4 · o que já era conhecido
select is((select tipo_na_meta from pg_temp.linha('wamid.M105.TXT')), null,
  'texto não ganha tipo original: os dois coincidem');
select is((select tipo_na_meta from pg_temp.linha('wamid.M105.IMG')), null,
  'nem foto');

-- 5 · a tradução e a reentrega
select is((select j ->> 'novo' from r105), 'false', 'reentrega da figurinha não cria uma segunda linha');
select is((select count(*)::int from public.messages where wa_message_id = 'wamid.M105.FIG'), 1,
  'continua uma só');
select is(app.wa_tipo_da_meta('sticker')::text,  'image',       'tradução: sticker → image');
select is(app.wa_tipo_da_meta('button')::text,   'interactive', 'tradução: button → interactive');
select is(app.wa_tipo_da_meta('VIDEO')::text,    'video',       'tradução: maiúscula não atrapalha');
select is(app.wa_tipo_da_meta(null)::text,       'text',        'tradução: sem tipo é texto');
select is(app.wa_tipo_da_meta('location')::text, 'system',      'tradução: o que o enum não conhece vira system');

set local role authenticated;
select throws_ok($$select app.wa_tipo_da_meta('sticker')$$, '42501', null,
  'a tradução não é superfície de API');
reset role;

select * from finish();
rollback;
