-- =====================================================================
-- pgTAP — O canal de chegada do lead (migração 20261109220000)
--
-- Pedido de 06/11/2026 para a Imova: saber por onde o lead conheceu a Imova
-- (Placa, Anúncios, Redes sociais, Outros; até 09/11/2026, Indicação). Este arquivo prova:
--
--   1. SÓ DA IMOVA: num banco da KOMUNE nada liga, nem com a chave gravada à
--      força, e a correção é recusada;
--   2. O EPISÓDIO: a primeira mensagem DA PESSOA abre a chegada; conversa que
--      nós abrimos, reação, número interno e o que é de antes de
--      aplicar_desde não abrem; "Oi" e foto no mesmo segundo abrem UMA; a
--      volta depois de 30 dias abre outra, antes disso não;
--   3. AS REGRAS, uma por palavra/link de partida (canal_padroes) e o anúncio
--      da Meta; "zap" sozinho não é o portal; "vi no portal" sem dizer qual
--      não é prova; a regra forte toma o lugar da fraca;
--   4. A CORREÇÃO de gente vence a regra, volta para a automática, fica no
--      histórico e só quem pode mexer na conversa corrige;
--   5. O FECHAMENTO em 24 h, sem sinal = Não identificado;
--   6. O WHATSAPP NÃO MUDA: nenhuma mensagem nova, nada na fila de saída, a
--      conversa fica igual, nenhum gatilho novo e nenhuma função nova escreve
--      em messages/conversations.
--
-- Roda em transação e desfaz tudo.
-- =====================================================================
begin;
select plan(73);

insert into public.allowed_users (email, role, note) values
  ('h137.g@teste.local', 'gestor', 'pgTAP 137'),
  ('h137.s@teste.local', 'sdr', 'pgTAP 137'),
  ('h137.l@teste.local', 'leitura', 'pgTAP 137');
insert into auth.users (id, email, raw_user_meta_data) values
  ('a0000000-0000-4000-8000-000000013701'::uuid, 'h137.g@teste.local', '{"full_name":"Gil Gestor"}'),
  ('a0000000-0000-4000-8000-000000013702'::uuid, 'h137.s@teste.local', '{"full_name":"Sara Sdr"}'),
  ('a0000000-0000-4000-8000-000000013703'::uuid, 'h137.l@teste.local', '{"full_name":"Leo Leitura"}');

-- Nada automático responde às mensagens de teste.
update public.app_settings set value = jsonb_set(value, '{numero_padrao}', '"+5584999913000"')
 where key = 'whatsapp.envio';
update public.app_settings
   set value = value || '{"introducao_ativa": false, "lead_automatico": false,
                          "distribuicao_automatica": false, "ausencia_ativa": false,
                          "cumprimento_automatico": false}'::jsonb
 where key = 'atendimento';
update public.app_settings set value = jsonb_set(value, '{ativo}', 'false')
 where key = 'whatsapp.bot_de_entrada';
update public.app_settings
   set value = jsonb_set(value, '{ficha,numeros_internos}', '["+5584999913099"]'::jsonb)
 where key = 'ia.crm_inteligente';

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

create temp table t137(chave text primary key, valor uuid);
grant select on t137 to authenticated;
create function pg_temp.id(p_chave text) returns uuid language sql stable as $$
  select valor from t137 where chave = p_chave
$$;
grant execute on function pg_temp.id(text) to authenticated;

create function pg_temp.conversa(p_chave text, p_tel text) returns uuid language plpgsql as $$
declare v uuid;
begin
  insert into public.conversations (channel, business_number, peer_phone_e164, peer_nome, assignee_id, status)
  values ('whatsapp'::app.channel, '+5584999913000', p_tel, 'Cliente ' || p_chave,
          'a0000000-0000-4000-8000-000000013701'::uuid, 'aguardando_nos')
  returning id into v;
  insert into t137 values (p_chave, v);
  return v;
end $$;

-- A pessoa escreveu; com o instante, o texto, o tipo e o conteúdo que o teste quiser.
create function pg_temp.dele(p_conv uuid, p_em timestamptz, p_body text default 'pgtap137 dele',
                             p_conteudo jsonb default null, p_tipo text default 'text')
returns uuid language plpgsql as $$
declare v uuid;
begin
  insert into public.messages (conversation_id, direction, type, status, body, author_kind, origin,
                               conteudo, created_at, reage_a)
  values (p_conv, 'in'::app.msg_direction, p_tipo::app.msg_type, 'received'::app.msg_status,
          case when p_tipo = 'reaction' then '👍' else p_body end, 'system', 'crm', p_conteudo, p_em,
          case when p_tipo = 'reaction'
               then (select m.id from public.messages m where m.conversation_id = p_conv limit 1) end)
  returning id into v;
  return v;
end $$;
create function pg_temp.nossa(p_conv uuid, p_em timestamptz) returns void language sql as $$
  insert into public.messages (conversation_id, direction, type, status, body, author_kind, origin,
                               sent_by, wa_message_id, created_at, sent_at)
  values (p_conv, 'out'::app.msg_direction, 'text'::app.msg_type, 'sent'::app.msg_status,
          'pgtap137 nossa', 'human', 'echo', 'a0000000-0000-4000-8000-000000013701'::uuid,
          'wamid.PGTAP137.' || gen_random_uuid(), p_em, p_em)
$$;

create function pg_temp.chegadas(p_conv uuid) returns int language sql stable as $$
  select count(*)::int from public.chegadas c where c.conversation_id = p_conv
$$;
create function pg_temp.ultima(p_conv uuid) returns uuid language sql stable as $$
  select c.id from public.chegadas c where c.conversation_id = p_conv order by c.inicio_em desc limit 1
$$;
grant execute on function pg_temp.ultima(uuid) to authenticated;
create function pg_temp.canal(p_conv uuid) returns text language sql stable as $$
  select c.canal || '/' || coalesce(case when c.canal_marcado is not null then c.subcanal_marcado
                                         else c.subcanal_automatico end, '-')
    from public.chegadas c where c.conversation_id = p_conv order by c.inicio_em desc limit 1
$$;

-- Uma pessoa nova que escreveu este texto há 2 dias: a chegada já passou das
-- 24 h, então o job decide e fecha na mesma rodada.
create function pg_temp.canal_de(p_texto text, p_conteudo jsonb default null) returns text
language plpgsql as $$
declare
  v uuid;
  n int := (select count(*) from t137) + 1;
begin
  v := pg_temp.conversa('r' || n, '+55849999' || lpad((13100 + n)::text, 5, '0'));
  perform pg_temp.dele(v, now() - interval '2 days', p_texto, p_conteudo);
  perform app.chegadas_rodar(1000);
  return pg_temp.canal(v);
end $$;

create function pg_temp.virar(p_empresa text) returns void language plpgsql as $$
begin
  alter table app.identidade disable trigger identidade_imutavel;
  alter table app.identidade disable trigger identidade_imutavel_truncate;
  delete from app.identidade;
  insert into app.identidade (empresa) values (p_empresa);
  alter table app.identidade enable trigger identidade_imutavel;
  alter table app.identidade enable trigger identidade_imutavel_truncate;
end $$;

-- A configuração do teste: ligada, sem IA, olhando os últimos 120 dias.
insert into public.app_settings (key, value, description)
values ('canal_de_chegada',
        jsonb_build_object('ligada', true, 'ia', false,
                           'aplicar_desde', to_char((now() at time zone 'America/Fortaleza')::date - 120, 'YYYY-MM-DD')),
        'pgTAP 137')
on conflict (key) do update set value = excluded.value;

-- A linha de base do WhatsApp, antes de qualquer função do canal.
create temp table t137_base as
  select (select count(*) from public.messages where direction = 'out'::app.msg_direction) as saidas,
         (select count(*) from pgmq.q_wa_outbound) as fila;

-- =====================================================================
-- 1. Só da Imova
-- =====================================================================
select pg_temp.conversa('k', '+5584999913001');
select pg_temp.dele(pg_temp.id('k'), now() - interval '1 hour', 'vi a placa');
select pg_temp.virar('komune');
select is(app.canal_de_chegada_config() ->> 'ligada', 'false',
  'no banco da KOMUNE o canal não liga, nem com a chave gravada');
select is(app.canal_de_chegada_config() ->> 'ia', 'false', 'nem a IA');
select is(app.chegadas_rodar(1000), '{"ligada": false}'::jsonb, 'o job não faz nada');
select pg_temp.entrar('a0000000-0000-4000-8000-000000013701'::uuid, 'gestor');
select is(public.chegada_marcar(gen_random_uuid(), 'placa') ->> 'motivo', 'desligada',
  'e a correção é recusada');
select pg_temp.sair();
select is(pg_temp.chegadas(pg_temp.id('k')), 0, 'nenhuma chegada nasce');
select pg_temp.virar('imova');

-- =====================================================================
-- 2. O episódio
-- =====================================================================
select app.chegadas_rodar(1000);
select is(pg_temp.chegadas(pg_temp.id('k')), 1, 'na Imova, a primeira mensagem da pessoa abre uma chegada');
select is((select c.primeira_mensagem_id from public.chegadas c where c.conversation_id = pg_temp.id('k')),
          (select m.id from public.messages m where m.conversation_id = pg_temp.id('k')),
  'e a chegada aponta para ela');

select pg_temp.conversa('nos', '+5584999913002');
select pg_temp.nossa(pg_temp.id('nos'), now() - interval '3 days');
select pg_temp.dele(pg_temp.id('nos'), now() - interval '2 days', 'quero saber mais');
select pg_temp.conversa('mesmo_segundo', '+5584999913003');
select pg_temp.dele(pg_temp.id('mesmo_segundo'), date_trunc('second', now()) - interval '1 hour', 'Oi');
select pg_temp.dele(pg_temp.id('mesmo_segundo'), date_trunc('second', now()) - interval '1 hour', 'tudo bem?');
select pg_temp.conversa('volta', '+5584999913004');
select pg_temp.dele(pg_temp.id('volta'), now() - interval '80 days', 'Oi, quero alugar');
select pg_temp.nossa(pg_temp.id('volta'), now() - interval '79 days');
select pg_temp.dele(pg_temp.id('volta'), now() - interval '20 days', 'Oi de novo, vi no insta');
select pg_temp.dele(pg_temp.id('volta'), now() - interval '5 days', 'e aquele apartamento?');
select pg_temp.conversa('antiga', '+5584999913005');
select pg_temp.dele(pg_temp.id('antiga'), now() - interval '130 days', 'Oi');
select pg_temp.conversa('reacao', '+5584999913006');
select pg_temp.nossa(pg_temp.id('reacao'), now() - interval '40 days');
select pg_temp.dele(pg_temp.id('reacao'), now() - interval '1 day', null, null, 'reaction');
select pg_temp.conversa('interno', '+5584999913099');
select pg_temp.dele(pg_temp.id('interno'), now() - interval '1 day', 'teste do time');
select app.chegadas_rodar(1000);
select is(pg_temp.chegadas(pg_temp.id('nos')), 0, 'conversa que nós abrimos não é chegada: a pessoa não nos procurou');
select is(pg_temp.chegadas(pg_temp.id('mesmo_segundo')), 1, '"Oi" e "tudo bem?" no mesmo segundo abrem UMA chegada');
select is(pg_temp.chegadas(pg_temp.id('volta')), 2,
  'quem volta depois de 30 dias de silêncio chega de novo; a mensagem de 15 dias depois, não');
select is(pg_temp.canal(pg_temp.id('volta')), 'redes_sociais/instagram',
  'e a volta tem o canal dela');
select is((select count(*)::int from public.canal_por_conversa where conversation_id = pg_temp.id('volta')), 1,
  'a etiqueta de Conversas é uma por conversa (a chegada mais recente)');
select is((select inicio_em from public.canal_por_conversa where conversation_id = pg_temp.id('volta')),
          (select max(inicio_em) from public.chegadas where conversation_id = pg_temp.id('volta')),
  'e é a da volta');
select is(pg_temp.chegadas(pg_temp.id('antiga')), 0, 'o que é de antes de aplicar_desde fica de fora');
select is(pg_temp.chegadas(pg_temp.id('reacao')), 0, 'reação não abre chegada');
select is(pg_temp.chegadas(pg_temp.id('interno')), 0, 'número interno do time não é lead');
select is((app.chegadas_rodar(1000) ->> 'chegadas_novas')::int, 0, 'rodar de novo não duplica nada');

-- =====================================================================
-- 3. As regras
-- =====================================================================
select is(pg_temp.canal_de('Olá! Quero mais informações',
            '{"anuncio": {"tipo": "ad", "titulo": "Apto Ponta Negra", "id": "123"}}'::jsonb),
  'anuncios/meta_anuncio', 'clique no anúncio da Meta é Anúncios');
select ok((select regra_forte from public.chegadas where id = pg_temp.ultima(pg_temp.id('r' || (select count(*) from t137))))
          and (select motivo from public.chegadas where id = pg_temp.ultima(pg_temp.id('r' || (select count(*) from t137))))
              like 'Clicou no anúncio "Apto Ponta Negra" em __/__',
  'regra forte, e o porquê diz o anúncio e o dia');
select is(pg_temp.canal_de('Olá!', '{"anuncio": {"tipo": "post", "titulo": "Casa no Tirol"}}'::jsonb),
  'redes_sociais/meta_post', 'publicação orgânica com o botão do WhatsApp é Redes sociais');
select is(pg_temp.canal_de('Oi, vi esse aqui https://www.zapimoveis.com.br/imovel/venda-apto-123'),
  'anuncios/portal_zap', 'link do ZAP Imóveis');
select is(pg_temp.canal_de('https://www.vivareal.com.br/imovel/apto-456/'),
  'anuncios/portal_vivareal', 'link do Viva Real');
select is(pg_temp.canal_de('olha esse https://www.olx.com.br/imoveis/789'),
  'anuncios/portal_olx', 'link da OLX');
select is(pg_temp.canal_de('Vi no Zap Imóveis a casa de vocês'), 'anuncios/portal_zap', 'falou do ZAP Imóveis');
select is(pg_temp.canal_de('achei no viva real'), 'anuncios/portal_vivareal', 'falou do Viva Real');
select is(pg_temp.canal_de('Olá! Tenho interesse em lote/terreno, Avenida Heronides Xavier da Silva, 75 - Rosa dos Ventos, Parnamirim - RN que encontrei no Zap: https://www.zapimoveis.com.br/imovel/venda-terreno-lote-condominio-rosa-dos-ventos-parnamirim-rn-3500m2-id-2900741798/.  Código da oferta: TE0002_IMOVA. Código do anúncio no Zap: 2900741798'),
  'anuncios/portal_zap', 'o texto pronto do botão de WhatsApp do ZAP (print de 06/11/2026)');
select is((select codigo_do_anuncio from public.chegadas
            where id = pg_temp.ultima(pg_temp.id('r' || (select count(*) from t137))))
          , 'TE0002_IMOVA', 'e o código da oferta fica na chegada');
select alike((select motivo from public.chegadas
               where id = pg_temp.ultima(pg_temp.id('r' || (select count(*) from t137)))),
  'Veio pelo botão de WhatsApp do ZAP Imóveis (anúncio TE0002_IMOVA)%', 'o porquê diz de qual anúncio');
select is(pg_temp.canal_de('Olá! Tenho interesse em casa que encontrei no Zap. Código da oferta: CA0001_IMOVA'),
  'anuncios/portal_zap', 'sem o link, "que encontrei no Zap" basta');
select is(pg_temp.canal_de('Olá! Tenho interesse em apartamento que encontrei no Viva Real'),
  'anuncios/portal_vivareal', 'o mesmo molde no Viva Real');
select is(pg_temp.canal_de('Te chamei no zap ontem, lembra?'), 'nao_identificado/desconhecido',
  '"zap" sozinho é o WhatsApp, não o portal');
select is(pg_temp.canal_de('Tenho interesse neste imóvel que vi no portal'), 'nao_identificado/desconhecido',
  '"vi no portal", sem dizer qual, não é prova: os portais não mandam texto pronto ao WhatsApp da Imova');
select is(pg_temp.canal_de('Achei na OLX'), 'anuncios/portal_olx', 'falou da OLX');
select is(pg_temp.canal_de('Bom dia, vi o anúncio de vocês'), 'anuncios/anuncio_outro', 'falou de um anúncio');
select is(pg_temp.canal_de('Passei em frente e vi a placa'), 'placa/texto_da_placa', 'falou da placa');
select is(pg_temp.canal_de('Tem uma placa de vende no terreno da esquina'), 'placa/texto_da_placa',
  '"placa de vende" também');
select is(pg_temp.canal_de('Vi o banner de vocês na avenida'), 'placa/texto_da_placa', 'banner conta como placa');
select is(pg_temp.canal_de('Esse prédio tem placa solar?'), 'nao_identificado/desconhecido',
  'placa solar não é a placa da Imova');
select is(pg_temp.canal_de('https://www.instagram.com/p/abc123/'), 'redes_sociais/instagram', 'link do Instagram');
select is(pg_temp.canal_de('vi no insta'), 'redes_sociais/instagram', 'falou do Instagram');
select is(pg_temp.canal_de('Boa tarde! Vi um anúncio de vocês no Instagram'), 'anuncios/meta_anuncio',
  'anúncio no Instagram é Anúncios, não Redes sociais (09/11/2026)');
select is(pg_temp.canal_de('Vi no face um post patrocinado'), 'anuncios/meta_anuncio', '"patrocinado" também');
select is(pg_temp.canal_de('Vi no face o post'), 'redes_sociais/facebook', 'falou do Facebook');
select is(pg_temp.canal_de('Vi o vídeo no TikTok'), 'redes_sociais/tiktok', 'falou do TikTok');
select is(pg_temp.canal_de('Vi no YouTube'), 'redes_sociais/youtube', 'falou do YouTube');
select is(pg_temp.canal_de('A Maria me indicou vocês'), 'outros/indicacao', 'indicação é Outros (09/11/2026)');
select is(pg_temp.canal_de('Me passaram o seu contato'), 'outros/indicacao', '"me passaram o contato" também');
select is(pg_temp.canal_de('Oi, tudo bem?'), 'nao_identificado/desconhecido', 'sem sinal, Não identificado');
select ok(app.canal_subcanal_valido('outros', 'indicacao') and app.canal_subcanal_valido('outros', 'site')
          and app.canal_subcanal_valido('outros', 'google') and app.canal_subcanal_valido('outros', 'outro_meio')
          and not app.canal_subcanal_valido('outros', 'instagram') and not app.canal_subcanal_valido('indicacao', 'indicacao'),
  'Outros: indicação, site, Google ou outro meio; Indicação deixou de ser canal');
select is((select count(*)::int from public.canal_padroes where ativo), 18,
  'as 18 palavras e links de partida estão ativos');

-- A regra forte toma o lugar da fraca, numa chegada ainda aberta.
select pg_temp.conversa('fraca', '+5584999913010');
select pg_temp.dele(pg_temp.id('fraca'), now() - interval '20 minutes', 'vi no insta');
select app.chegadas_rodar(1000);
select is(pg_temp.canal(pg_temp.id('fraca')), 'redes_sociais/instagram', 'a regra fraca decide logo');
select is((select situacao from public.chegadas where conversation_id = pg_temp.id('fraca')), 'lendo',
  'e a chegada continua aberta');
select pg_temp.dele(pg_temp.id('fraca'), now() - interval '10 minutes', 'é este: https://www.vivareal.com.br/x');
select app.chegadas_rodar(1000);
select is(pg_temp.canal(pg_temp.id('fraca')), 'anuncios/portal_vivareal', 'a forte toma o lugar da fraca');

-- =====================================================================
-- 4. A correção de gente
-- =====================================================================
select pg_temp.entrar('a0000000-0000-4000-8000-000000013702'::uuid, 'sdr');
select is(public.chegada_marcar(pg_temp.ultima(pg_temp.id('fraca')), 'placa') ->> 'subcanal', 'texto_da_placa',
  'o SDR corrige; sem subcanal, "Falou da placa"');
select pg_temp.sair();
select is(pg_temp.canal(pg_temp.id('fraca')), 'placa/texto_da_placa', 'a correção vale');
select is((select decidido_por from public.chegadas_na_lista where id = pg_temp.ultima(pg_temp.id('fraca'))), 'gente',
  'e a tela diz que foi gente');
select alike((select motivo from public.chegadas_na_lista where id = pg_temp.ultima(pg_temp.id('fraca'))),
  'Corrigido por Sara em __/__', 'com o nome e o dia');
select pg_temp.dele(pg_temp.id('fraca'), now() - interval '5 minutes', 'https://www.zapimoveis.com.br/y');
select app.chegadas_rodar(1000);
select is(pg_temp.canal(pg_temp.id('fraca')), 'placa/texto_da_placa', 'regra nova não passa por cima de gente');
select pg_temp.entrar('a0000000-0000-4000-8000-000000013701'::uuid, 'gestor');
select is(public.chegada_marcar(pg_temp.ultima(pg_temp.id('fraca')), 'outro') ->> 'motivo', 'canal_invalido',
  '"outro" (no singular) não é canal');
select is(public.chegada_marcar(pg_temp.ultima(pg_temp.id('fraca')), 'indicacao') ->> 'motivo', 'canal_invalido',
  'Indicação não é mais canal: é o detalhe de Outros');
select is(public.chegada_marcar(pg_temp.ultima(pg_temp.id('fraca')), 'placa', 'instagram') ->> 'motivo',
  'subcanal_invalido', 'subcanal de outro canal é recusado');
select is(public.chegada_marcar(pg_temp.ultima(pg_temp.id('fraca')), null) ->> 'canal', 'anuncios',
  'nulo volta para a automática');
select pg_temp.sair();
select is(pg_temp.canal(pg_temp.id('fraca')), 'anuncios/portal_vivareal',
  'que é o sinal forte mais antigo: entre dois links, vale o primeiro contato');
select is((select count(*)::int from public.chegada_historico h
            where h.chegada_id = pg_temp.ultima(pg_temp.id('fraca')) and h.por_quem = 'pessoa'), 2,
  'as duas mexidas de gente ficam no histórico');
select pg_temp.entrar('a0000000-0000-4000-8000-000000013703'::uuid, 'leitura');
select is(public.chegada_marcar(pg_temp.ultima(pg_temp.id('fraca')), 'placa') ->> 'motivo', 'sem_permissao',
  'quem só lê não corrige');
select pg_temp.sair();

-- =====================================================================
-- 5. O fechamento
-- =====================================================================
select pg_temp.conversa('fecha', '+5584999913011');
select pg_temp.dele(pg_temp.id('fecha'), now() - interval '10 minutes', 'Oi, boa tarde');
select app.chegadas_rodar(1000);
select is((select situacao || '/' || coalesce(canal, '-') from public.chegadas
            where conversation_id = pg_temp.id('fecha')), 'lendo/-', 'sem sinal, a chegada espera aberta');
select is(app.chegada_avaliar(pg_temp.ultima(pg_temp.id('fecha')), now() + interval '25 hours'), 'fechada',
  'em 24 h fecha');
select is((select canal || ' · ' || motivo from public.chegadas where conversation_id = pg_temp.id('fecha')),
  'nao_identificado · Sem sinal nas primeiras 24 h', 'como Não identificado, com o porquê');

-- =====================================================================
-- 6. O WhatsApp não muda
-- =====================================================================
select is((select count(*) from public.messages m where m.direction = 'out'::app.msg_direction
            and m.body is distinct from 'pgtap137 nossa'),
  (select saidas from t137_base), 'nenhuma mensagem de saída nasceu além das do próprio teste');
select is((select count(*) from pgmq.q_wa_outbound), (select fila from t137_base),
  'e nada entrou na fila de saída do WhatsApp');

create temp table t137_k as
  select row(c.status, c.bot_paused, c.window_expires_at, c.unread_count, c.assignee_id,
             c.last_message_at, c.snoozed_until, c.arquivada_em, c.updated_at)::text as antes
    from public.conversations c where c.id = pg_temp.id('k');
select pg_temp.entrar('a0000000-0000-4000-8000-000000013701'::uuid, 'gestor');
select public.chegada_marcar(pg_temp.ultima(pg_temp.id('k')), 'outros', 'indicacao');
select pg_temp.sair();
select app.chegadas_rodar(1000);
select app.chegada_avaliar(pg_temp.ultima(pg_temp.id('k')), now() + interval '30 hours');
select is((select row(c.status, c.bot_paused, c.window_expires_at, c.unread_count, c.assignee_id,
                      c.last_message_at, c.snoozed_until, c.arquivada_em, c.updated_at)::text
             from public.conversations c where c.id = pg_temp.id('k')),
  (select antes from t137_k), 'a conversa fica igual, até o updated_at');
select is((select count(*)::int from pg_trigger t join pg_proc p on p.oid = t.tgfoid
            where t.tgrelid in ('public.messages'::regclass, 'public.conversations'::regclass)
              and not t.tgisinternal and p.proname ~ '(canal|chegada)'), 0,
  'nenhum gatilho do canal em messages ou conversations');
select is((select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname in ('app', 'public')
              and p.proname in ('chegadas_rodar', 'chegada_avaliar', 'chegada_regras', 'chegada_definir',
                                'chegada_anotar', 'chegada_marcar', 'canal_sinal_do_portal', 'canal_enfileirar_ia')
              and (p.prosrc ~* 'insert\s+into\s+public\.messages' or p.prosrc ~* 'update\s+public\.conversations'
                   or p.prosrc ~* 'wa_outbound' or p.prosrc ~* 'wa_acoes' or p.prosrc ~* 'pode_enviar')), 0,
  'nenhuma função do canal grava mensagem, mexe na conversa ou toca a saída do WhatsApp');

select * from finish();
rollback;
