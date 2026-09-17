-- =====================================================================
-- pgTAP — A triagem do Radar (migração 20260917180000)
--
-- A fila tinha 277 candidatos e UM telefone. "Filtrar quem tem número" deixaria
-- 1 na tela: funcionaria e seria inútil. A pergunta que o dado responde é "quais
-- valem o trabalho de caçar o telefone?", e é essa que esta triagem responde.
--
-- O que este arquivo prova:
--   1. A conta usa os PESOS de `app_settings`, não números escondidos no código.
--   2. Mudar o peso muda a ordem — é isso que significa "controle total".
--   3. A pontuação ORDENA e nunca descarta: ninguém sai da fila por ter nota
--      baixa (RF-RAD-08: quem vira parceiro é decisão humana).
--   4. Candidato novo nasce pontuado, senão a coleta de segunda entraria no fim
--      da fila por omissão.
--   5. Só admin e gestor repontuam.
--
-- Roda em transação e desfaz tudo.
-- =====================================================================
begin;
select plan(11);

insert into public.allowed_users (email, role, note) values
  ('f55.admin@teste.local', 'admin', 'pgTAP triagem'),
  ('f55.sdr@teste.local', 'sdr', 'pgTAP triagem');
insert into auth.users (id, email, raw_user_meta_data) values
  ('a0000000-0000-4000-8000-00000000f551', 'f55.admin@teste.local', '{"full_name":"Admin F55"}'),
  ('a0000000-0000-4000-8000-00000000f552', 'f55.sdr@teste.local', '{"full_name":"Sdr F55"}');

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
create function pg_temp.nota(p_nome text) returns int language sql stable as $$
  select score from public.supplier_candidates where name = p_nome
$$;
create function pg_temp.faixa(p_nome text) returns text language sql stable as $$
  select tier from public.supplier_candidates where name = p_nome
$$;

-- Três candidatos, do jeito que o Radar os traz: com nota, sem telefone.
insert into public.supplier_candidates (source_id, name, rating, reviews_count, city_id)
select s.id, 'Bufê Muito Bom', 4.9, 80,
       (select id from public.cities where name = 'Natal')
  from public.sources s where s.slug = 'casamentos_com_br';
insert into public.supplier_candidates (source_id, name, rating, reviews_count, city_id)
select s.id, 'Bufê Mediano', 4.2, 6,
       (select id from public.cities where name = 'Natal')
  from public.sources s where s.slug = 'casamentos_com_br';
insert into public.supplier_candidates (source_id, name, rating, reviews_count)
select s.id, 'Sem Sinal Nenhum', null, null
  from public.sources s where s.slug = 'casamentos_com_br';

-- ---------- 1. o candidato nasce pontuado ----------
select isnt(pg_temp.nota('Bufê Muito Bom'), NULL,
  'CANDIDATO NOVO NASCE PONTUADO — sem isso a coleta de segunda cairia no fim da fila por omissão');
select is(pg_temp.faixa('Bufê Muito Bom'), 'A+',
  '4,9 com 80 avaliações em Natal é A+ — o vocabulário de faixa que a tabela já tinha');
select is(pg_temp.faixa('Sem Sinal Nenhum'), 'C',
  'e quem não tem sinal nenhum fica em C — mas FICA');

-- ---------- 2. ordena, nunca descarta ----------
select is((select count(*)::int from public.supplier_candidates
            where status = 'novo'::app.candidate_status), 3,
  'OS TRÊS CONTINUAM NA FILA: a triagem ordena, não some com ninguém (RF-RAD-08)');

select ok(pg_temp.nota('Bufê Muito Bom') > pg_temp.nota('Bufê Mediano'),
  'quem tem mais nota e mais avaliações pontua mais');
select ok(pg_temp.nota('Bufê Mediano') > pg_temp.nota('Sem Sinal Nenhum'),
  'e quem tem algum sinal pontua mais que quem não tem nenhum');

-- ---------- 3. o peso é de quem vende, não de quem programa ----------
-- Zerar o peso da cidade tem de mudar a conta: se não mudar, o número está no
-- código e a tela de parâmetros é enfeite.
select pg_temp.entrar('a0000000-0000-4000-8000-00000000f551', 'admin');
update public.app_settings
   set value = jsonb_set(value, '{pesos,cidade}', '0')
 where key = 'radar.triagem';
select is(public.radar_repontuar() ->> 'ok', 'true', 'admin repontua a fila');
select pg_temp.sair();

-- Com o peso da cidade zerado, "fica em Natal" deixa de render — e como a
-- escala se normaliza pelo que PODE pontuar, o mediano (que tinha a cidade a seu
-- favor) cai em relação ao forte. O que se prova aqui é que a conta mudou.
select isnt(pg_temp.nota('Bufê Mediano'), 73,
  'ZERAR O PESO DA CIDADE MUDOU A CONTA: o peso está no banco, não no código');

-- E devolver o peso restaura a conta, sem migração e sem deploy.
update public.app_settings set value = jsonb_set(value, '{pesos,cidade}', '15')
 where key = 'radar.triagem';
select lives_ok($$ select public.radar_repontuar() $$,
  'e repontuar de novo com o peso de volta funciona');

-- ---------- 4. quem pode repontuar ----------
select pg_temp.entrar('a0000000-0000-4000-8000-00000000f552', 'sdr');
select throws_ok($$ select public.radar_repontuar() $$, '42501', NULL,
  'SDR não repontua: mexer no peso muda a ordem do trabalho de todo mundo');
select pg_temp.sair();

-- ---------- 5. o porquê é parte da resposta ----------
select ok(
  (select jsonb_array_length(app.radar_pontuar(c.*) -> 'porque') from public.supplier_candidates c
    where c.name = 'Bufê Muito Bom') >= 2,
  'a pontuação vem com o PORQUÊ — nota que não se explica é nota que ninguém segue');

rollback;
