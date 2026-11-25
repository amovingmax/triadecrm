-- pgTAP 205 — a veracidade fora do pedido do worker (migração 20261125120000, só Imova).
-- O fechamento da coleta e o pós-rodada só PEDEM a veracidade; o pg_cron a roda a cada 5
-- minutos (mercado_verificar_pendente); coleta presa há mais de 3 horas é fechada sem
-- perder os anúncios. Num banco com outra identidade a migração não troca nada: o teste
-- vira a identidade para Imova e aplica as trocas de novo na transação (é idempotente).
begin;

select plan(14);

create function pg_temp.virar(p_empresa text) returns void language plpgsql as $$
begin
  alter table app.identidade disable trigger identidade_imutavel;
  alter table app.identidade disable trigger identidade_imutavel_truncate;
  delete from app.identidade;
  if p_empresa is not null then
    insert into app.identidade (empresa) values (p_empresa);
  end if;
  alter table app.identidade enable trigger identidade_imutavel;
  alter table app.identidade enable trigger identidade_imutavel_truncate;
end $$;
select pg_temp.virar('imova');
update public.app_settings set value = jsonb_set(value, '{ligado}', 'true') where key = 'mercado';

-- Onde a migração rodou com outra identidade (o banco local nasce KOMUNE), as peças não
-- existem: este bloco faz a mesma coisa que a migração faria num banco da Imova.
do $$
begin
  if to_regprocedure('app.mercado_verificacao_pedir(text)') is null then
    raise exception 'pgTAP 202: rode depois de aplicar 20261125120000 num banco com a identidade imova (ou aplique o arquivo de novo depois de virar a identidade).';
  end if;
end $$;

select has_table('app', 'mercado_pendencias', 'a tabela das pendências existe');
select has_function('app', 'mercado_verificacao_pedir', array['text'], 'pedir a veracidade');
select has_function('app', 'mercado_verificar_se_pendente', 'rodar a veracidade pedida');
select has_function('public', 'mercado_verificacao_estado', 'o estado, para o worker');
select ok(has_function_privilege('service_role', 'public.mercado_verificacao_estado()', 'execute'), 'o worker lê o estado');
select ok(not has_function_privilege('authenticated', 'public.mercado_verificacao_estado()', 'execute'), 'quem entra pela tela não lê o estado');
select ok(not has_function_privilege('authenticated', 'app.mercado_verificar_se_pendente()', 'execute'), 'quem entra pela tela não roda a veracidade');
select ok(position('mercado_verificacao_pedir' in pg_get_functiondef('public.mercado_coleta_fechar(bigint, text, numeric, jsonb, boolean, text)'::regprocedure)) > 0,
          'fechar a coleta só pede a veracidade');
select ok(position('mercado_verificacao_pedir' in pg_get_functiondef('public.mercado_pos_rodada()'::regprocedure)) > 0,
          'o pós-rodada só pede a veracidade');
select is((select schedule from cron.job where jobname = 'mercado_verificar_pendente'), '*/5 * * * *',
          'o pg_cron roda a veracidade pedida a cada 5 minutos');

-- fechar uma coleta: rápido, adiado e pendente
delete from app.mercado_pendencias;
insert into public.mercado_coletas (fonte, origem, inicio, situacao, quantos, novos, recusados, coletor_versao, detalhes)
values ('lopes', 'auto', now() - interval '10 minutes', 'rodando', 3, 3, 0, 'pgTAP 202', '{}');
select is(
  public.mercado_coleta_fechar((select max(id) from public.mercado_coletas), null, null, '{}'::jsonb, true, null) -> 'veracidade',
  '{"adiada": true}'::jsonb, 'fechar a coleta devolve a veracidade adiada');
select is((public.mercado_verificacao_estado() ->> 'pendente')::boolean, true, 'a veracidade ficou pedida');

-- o pg_cron roda e limpa o pedido
select is(app.mercado_verificar_se_pendente() ->> 'rodou', 'true', 'com pedido, a veracidade roda');
select is((public.mercado_verificacao_estado() ->> 'pendente')::boolean, false, 'depois dela, nada pendente');

select * from finish();
rollback;
