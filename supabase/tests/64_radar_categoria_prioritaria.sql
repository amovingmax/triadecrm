-- =====================================================================
-- pgTAP — Radar: candidato de categoria prioritária (migração 20260922150000)
--
-- Antes da correção, marcar uma categoria como prioritária na tela do Radar
-- fazia todo candidato dela abortar na entrada ("malformed array literal").
-- =====================================================================
begin;
select plan(3);

-- Uma categoria prioritária, do jeito que a tela do Radar grava.
update public.app_settings
   set value = jsonb_set(value, '{categorias_prioritarias}',
                         jsonb_build_array((select min(id) from public.categories)))
 where key = 'radar.triagem';

select lives_ok($$
  insert into public.supplier_candidates (source_id, name, rating, reviews_count, category_id)
  select s.id, 'R64 Prioritário', 4.8, 30, (select min(id) from public.categories)
    from public.sources s where s.slug = 'casamentos_com_br'
$$, 'candidato de categoria prioritária entra na fila, já pontuado');

insert into public.supplier_candidates (source_id, name, rating, reviews_count, category_id)
select s.id, 'R64 Comum', 4.8, 30, (select max(id) from public.categories)
  from public.sources s where s.slug = 'casamentos_com_br';

select ok((select app.radar_pontuar(c.*) -> 'porque' from public.supplier_candidates c
            where c.name = 'R64 Prioritário') ? 'categoria prioritária',
  'o porquê diz que a categoria é prioritária');

select ok((select score from public.supplier_candidates where name = 'R64 Prioritário') >
          (select score from public.supplier_candidates where name = 'R64 Comum'),
  'com a mesma nota, a categoria prioritária pontua mais');

select * from finish();
rollback;
