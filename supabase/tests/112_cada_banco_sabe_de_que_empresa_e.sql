-- =====================================================================
-- pgTAP — Cada banco sabe de que empresa é
--         (migração 20261022090000_cada_banco_sabe_de_que_empresa_e.sql)
--
--   1. a identidade mora em `app.identidade`, com RLS e fora do alcance
--      de quem entra pelo site;
--   2. gravada uma vez, não muda nem some (UPDATE, DELETE, TRUNCATE);
--   3. outra empresa num banco que já tem identidade é recusada;
--   4. a primeira identidade num banco com parceiros só passa confirmada;
--   5. `app.exigir_empresa` aborta no banco de outra empresa;
--   6. o site lê a identidade por `public.empresa_do_banco()`; anônimo não.
--
-- Roda em transação e desfaz tudo. O seed local grava 'komune'; o teste
-- apaga a identidade (com a trava desligada só dentro da transação) para
-- começar do zero.
-- =====================================================================
begin;
select plan(17);

alter table app.identidade disable trigger identidade_imutavel;
alter table app.identidade disable trigger identidade_imutavel_truncate;
delete from app.identidade;
alter table app.identidade enable trigger identidade_imutavel;
alter table app.identidade enable trigger identidade_imutavel_truncate;

select has_table('app', 'identidade', 'a identidade mora no esquema privado');
select is((select relrowsecurity from pg_class where oid = 'app.identidade'::regclass), true,
          'a tabela da identidade tem RLS');
select is(public.empresa_do_banco(), null, 'sem identidade, o banco não diz de quem é');
select throws_ok($$select app.exigir_empresa('imova')$$, '42501', null,
                 'sem identidade, nenhum comando de empresa passa');

-- Um parceiro no banco: a primeira identidade precisa de confirmação.
insert into public.organizations (name, source_id, collector)
values ('Parceiro do teste de identidade', (select min(id) from public.sources), 'teste local');

select throws_ok($$select app.definir_identidade('imova')$$, '42501', null,
                 'banco com parceiros e sem identidade recusa gravar sem confirmação');
select is(app.definir_identidade('komune', true), 'komune', 'com a confirmação, grava');
select is(public.empresa_do_banco(), 'komune', 'o banco diz de quem é');
select is(app.definir_identidade('komune'), 'komune', 'repetir a mesma empresa não faz nada');
select throws_ok($$select app.definir_identidade('imova', true)$$, '42501', null,
                 'outra empresa é recusada, mesmo confirmada');
select lives_ok($$select app.exigir_empresa('komune')$$, 'o comando da própria empresa passa');
select throws_ok($$select app.exigir_empresa('imova')$$, '42501', null,
                 'o comando de outra empresa aborta');

select throws_ok($$update app.identidade set empresa = 'imova'$$, '42501', null,
                 'a identidade não muda');
select throws_ok($$delete from app.identidade$$, '42501', null, 'a identidade não some');
select throws_ok($$truncate app.identidade$$, '42501', null, 'nem por truncate');

-- Quem entra pelo site: lê pela função, não toca na tabela nem grava.
set local role authenticated;
select is(public.empresa_do_banco(), 'komune', 'o site lê a identidade pela função');
select throws_ok($$select app.definir_identidade('imova', true)$$, '42501', null,
                 'quem entra pelo site não grava identidade');
reset role;

set local role anon;
select throws_ok($$select public.empresa_do_banco()$$, '42501', null, 'anônimo não lê a identidade');
reset role;

select * from finish();
rollback;
