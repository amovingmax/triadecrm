-- =====================================================================
-- Limpeza de contas duplicadas (pedido e aprovação do Rafael, 22/09/2026)
--
-- "Tire os duplicados, elimine total do site os cadastros vindo matheus.admin e
-- heloiza.admin, e tire uma das contas de Rafael Abreu, deixe apenas a que
-- tiver com o email pessoal dele." Aprovado também apagar a conta de teste
-- "Prova Push".
--
-- ANTES de apagar, MOVE tudo o que é de cada conta velha para a conta que fica
-- (é a mesma pessoa): negócios, parceiros, conversas, tarefas, histórico,
-- lotes de ligação, setores. Sem isso, apagar a conta apagaria em cascata os
-- lotes de ligação dela e deixaria negócios e parceiros sem dono.
--
-- A EXCEÇÃO: as tabelas de trilha de auditoria são só-de-inclusão (gatilho
-- `app.forbid_change`: consentimentos, eventos e aceites do pré-cadastro,
-- proveniência de campo). Elas não são reescritas — trocar o autor de um
-- registro de consentimento é falsificar a prova. A conta que aparece nelas
-- não é apagada: fica DESATIVADA, fora da lista de permitidos, e a tela de
-- Pessoas passa a esconder desativados por padrão.
--
--   heloiza.admin@komune.app.br  → anaheloizalima98@gmail.com  (Ana Heloiza Lima)
--   matheus.admin@komune.app.br  → rondonfamiliav@gmail.com    (Matheus Rondon)
--   contato@komune.app.br        → rafael@rafaelabreu.com      (Rafael Abreu)
--   prova.push@teste.local       → sem herdeiro (conta de teste)
--
-- Por e-mail, não por id: num banco sem essas contas, nada acontece.
-- Rodar com `psql -1 -v ON_ERROR_STOP=1 -f` (uma transação só).
-- =====================================================================
do $$
declare
  par       record;
  v_velha   uuid;
  v_nova    uuid;
  r         record;
  n         int;
  v_trilha  boolean;
begin
  for par in
    select * from (values
      ('heloiza.admin@komune.app.br', 'anaheloizalima98@gmail.com'),
      ('matheus.admin@komune.app.br', 'rondonfamiliav@gmail.com'),
      ('contato@komune.app.br',       'rafael@rafaelabreu.com'),
      ('prova.push@teste.local',      null)) as x(velha, nova)
  loop
    select id into v_velha from auth.users where lower(email) = par.velha;
    continue when v_velha is null;
    v_nova := null;
    if par.nova is not null then
      select id into v_nova from auth.users where lower(email) = par.nova;
      if v_nova is null then
        raise notice 'pulando %: a conta que fica (%) não existe', par.velha, par.nova;
        continue;
      end if;
      delete from public.setor_membros m
       where m.profile_id = v_velha
         and exists (select 1 from public.setor_membros k
                      where k.profile_id = v_nova and k.setor_id = m.setor_id);
    end if;

    v_trilha := false;
    for r in
      select c.conrelid::regclass as tabela, a.attname as coluna,
             exists (select 1 from pg_trigger t
                      where t.tgrelid = c.conrelid and t.tgfoid = 'app.forbid_change'::regproc) as protegida
        from pg_constraint c
        join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any (c.conkey)
       where c.contype = 'f'
         and c.confrelid = 'public.profiles'::regclass
         and c.connamespace = 'public'::regnamespace
    loop
      execute format('select count(*) from %s where %I = $1', r.tabela, r.coluna) into n using v_velha;
      continue when n = 0;
      if r.protegida then
        v_trilha := true;
        raise notice '%: % linhas em %.% (trilha de auditoria: não é reescrita)',
          par.velha, n, r.tabela, r.coluna;
      elsif v_nova is not null then
        execute format('update %s set %I = $1 where %I = $2', r.tabela, r.coluna, r.coluna)
          using v_nova, v_velha;
        raise notice '% → %: %.% (% linhas)', par.velha, par.nova, r.tabela, r.coluna, n;
      end if;
    end loop;

    delete from public.allowed_users where lower(email::text) = par.velha;

    if v_trilha then
      update public.profiles set is_active = false where id = v_velha;
      raise notice 'conta DESATIVADA (aparece na trilha de auditoria): %', par.velha;
    else
      delete from auth.users where id = v_velha;
      raise notice 'conta apagada: %', par.velha;
    end if;
  end loop;
end $$;
