-- =====================================================================
-- pgTAP — A trava do caderno (migração 20261127200000, Imova)
--
-- Prova:
--   1. o que faria a IA parar é achado, com o trecho (o "1.338,99, 2.021" de
--      19/11, telefone, e-mail, @, Instagram), e valor, data e medida passam;
--   2. a limpeza troca o trecho por "[número tirado]" / "[contato tirado]";
--   3. "Ensinar" e o lápis recusam dizendo o trecho, e aceitam o texto limpo;
--   4. "Corrigir" recusa a correção com o problema;
--   5. o gatilho recusa qualquer outro caminho (insert e update do texto).
--
-- Só na Imova. Roda em transação e desfaz tudo.
-- =====================================================================
begin;

do $$
begin
  if (select i.empresa from app.identidade i) = 'komune' then
    raise exception 'pgTAP 211 é da Imova: rode no banco local da Imova';
  end if;
end $$;

select plan(18);

insert into public.allowed_users (email, role, note) values ('g211@teste.local', 'gestor', 'pgTAP 211');
insert into auth.users (id, email, raw_user_meta_data) values
  ('a0000000-0000-4000-8000-000000021101'::uuid, 'g211@teste.local', '{"full_name":"Gil Gestor"}');

create function pg_temp.entrar() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', 'a0000000-0000-4000-8000-000000021101', 'role', 'authenticated',
                      'app_metadata', json_build_object('app_role', 'gestor'))::text, true);
  execute 'set local role authenticated';
end $$;
create function pg_temp.sair() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '', true);
  execute 'reset role';
end $$;

-- ---------------------------------------------------------------------
-- 1. O que travaria
-- ---------------------------------------------------------------------
select is(app.ia_caderno_problema('FICHA 5. TERRENO: (a) O valor é R$ 520.000 (equipe, 23/11). (d) 12 m por 68 m.'),
          null, 'valor, data e medida com letra no meio passam');
select is(app.ia_caderno_problema('FICHA 4. PIPA: os lotes têm 1.338,99, 2.021 m² ao lado do parque.'),
          '{"motivo": "telefone", "trecho": "1.338,99, 2.021"}'::jsonb,
          'o "1.338,99, 2.021" de 19/11 é achado, com o trecho');
select is(app.ia_caderno_problema('Para visitar, ligue (84) 98820-9001.') ->> 'motivo', 'telefone', 'telefone');
select is(app.ia_caderno_problema('Mande para contato@imova.com.br') ->> 'trecho', 'contato@imova.com.br', 'e-mail');
select is(app.ia_caderno_problema('Siga @imovaimobiliaria no Instagram') ->> 'motivo', 'contato', '@');
select is(app.ia_caderno_problema('Veja instagram.com/imova para fotos') ->> 'motivo', 'contato', 'Instagram');
select is(app.ia_caderno_problema('Os 1.338 m² e os 2.021 m² somam mais de 3 mil.'), null,
          'os mesmos números separados por palavras passam');

-- ---------------------------------------------------------------------
-- 2. A limpeza
-- ---------------------------------------------------------------------
select is(app.ia_caderno_sem_problema('os lotes têm 1.338,99, 2.021 m² e o e-mail contato@imova.com.br'),
          'os lotes têm [número tirado] m² e o e-mail [contato tirado]', 'o trecho vira a marca');
select is(app.ia_caderno_problema(app.ia_caderno_sem_problema('ligue 84 98820-9001 ou 84 3201-1234')), null,
          'depois da limpeza, nada trava');

-- ---------------------------------------------------------------------
-- 3. "Ensinar" e o lápis
-- ---------------------------------------------------------------------
select pg_temp.entrar();
select is(public.ia_caderno_escrever('FICHA 99. TESTE: os lotes têm 1.338,99, 2.021 m².', null) - 'tipo',
          '{"ok": false, "motivo": "trava_a_ia", "trecho": "1.338,99, 2.021"}'::jsonb,
          '"Ensinar" recusa dizendo o trecho');
select is((public.ia_caderno_escrever('FICHA 99. TESTE: os lotes têm 1.338,99 m² e 2.021 m².', null) ->> 'ok')::boolean,
          true, 'o mesmo texto com palavras entre os números entra');
select is(public.ia_caderno_escrever('FICHA 99. TESTE: ligue 84 98820-9001.',
            (select id from public.ia_caderno where texto like 'FICHA 99. TESTE%')) ->> 'motivo',
          'trava_a_ia', 'o lápis também recusa');
select is((select texto from public.ia_caderno where texto like 'FICHA 99. TESTE%'),
          'FICHA 99. TESTE: os lotes têm 1.338,99 m² e 2.021 m².', 'e a nota fica como estava');

-- ---------------------------------------------------------------------
-- 4. "Corrigir"
-- ---------------------------------------------------------------------
select is(public.ia_resposta_avaliar(gen_random_uuid(), 'corrigir', 'O certo é ligar para 84 98820-9001.') ->> 'motivo',
          'trava_a_ia', 'a correção com telefone é recusada antes de virar nota');
select is(public.ia_resposta_avaliar(gen_random_uuid(), 'corrigir', 'O certo é dizer que a sala tem energia própria.') ->> 'motivo',
          'resposta_inexistente', 'a correção limpa passa pela trava');
select pg_temp.sair();

-- ---------------------------------------------------------------------
-- 5. O gatilho, para qualquer outro caminho
-- ---------------------------------------------------------------------
select throws_ok(
  $$insert into public.ia_caderno (texto, origem) values ('NOTA: ligue 84 98820-9001.', 'tela')$$,
  '22023', null, 'o insert direto com telefone é recusado');
select throws_ok(
  $$update public.ia_caderno set texto = texto || ' 1.338,99, 2.021' where texto like 'FICHA 99. TESTE%'$$,
  '22023', null, 'e o update que traria o problema também');
select lives_ok(
  $$update public.ia_caderno set ativo = false where texto like 'FICHA 99. TESTE%'$$,
  'mexer em outra coluna continua livre');

select * from finish();
rollback;
