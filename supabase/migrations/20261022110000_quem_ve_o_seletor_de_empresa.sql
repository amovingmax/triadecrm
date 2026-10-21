-- =====================================================================
-- Quem vê o botão de trocar de empresa (decisão do usuário, 21/10/2026)
--
-- "Deve aparecer o botão de trocar o módulo para quem tem acesso aos dois
-- módulos. Para quem tem acesso somente a um módulo não deve aparecer nada."
--
-- Cada empresa tem o seu banco, e um banco não consulta o outro (modelo silo;
-- docs/operacao/multiempresa.md). Então quem sabe que a pessoa também trabalha
-- na outra empresa é o admin, que marca isso em Ajustes → Pessoas. Cada banco
-- guarda só a SUA marcação: "esta pessoa também acessa a <outra empresa>".
--
-- A marcação só mostra o botão. Quem entra na outra empresa continua decidido
-- pela lista de permitidos DELA; marcado por engano, a pessoa clica e a outra
-- empresa recusa o login, sem dado nenhum.
--
-- Só acrescenta: tabela nova, função nova, nada existente muda.
-- =====================================================================

create table if not exists public.acesso_a_outras_empresas (
  id          bigserial primary key,
  user_id     uuid not null references public.profiles (id) on delete cascade,
  empresa     text not null check (empresa ~ '^[a-z][a-z0-9-]{1,30}$'),
  created_at  timestamptz not null default now(),
  created_by  uuid default auth.uid() references public.profiles (id) on delete set null,
  unique (user_id, empresa)
);
alter table public.acesso_a_outras_empresas enable row level security;
comment on table public.acesso_a_outras_empresas is
  'Quem também tem acesso a outra empresa do Tríade (slug em empresa) e por isso vê o botão de trocar. Marcado pelo admin; só mostra o botão, não dá acesso.';

-- A própria empresa não entra: o botão já mostra a empresa atual.
create or replace function app.acesso_a_outras_empresas_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.empresa = (select i.empresa from app.identidade i) then
    raise exception 'A empresa "%" é a deste banco; marque só as outras.', new.empresa
      using errcode = '23514';
  end if;
  return new;
end $$;
revoke all on function app.acesso_a_outras_empresas_guard() from public, anon, authenticated;

drop trigger if exists acesso_a_outras_empresas_guard on public.acesso_a_outras_empresas;
create trigger acesso_a_outras_empresas_guard
  before insert or update on public.acesso_a_outras_empresas
  for each row execute function app.acesso_a_outras_empresas_guard();

-- Quem marcou e quando (RF-ADM-03), como a lista de permitidos.
drop trigger if exists audit_acesso_a_outras_empresas on public.acesso_a_outras_empresas;
create trigger audit_acesso_a_outras_empresas
  after insert or update or delete on public.acesso_a_outras_empresas
  for each row execute function app.audit();

-- Cada pessoa lê a própria marcação (é o que decide o botão dela); o admin lê e
-- muda a de todos. Marcar é inserir, desmarcar é apagar: não há UPDATE.
drop policy if exists acesso_outras_select on public.acesso_a_outras_empresas;
drop policy if exists acesso_outras_insert on public.acesso_a_outras_empresas;
drop policy if exists acesso_outras_delete on public.acesso_a_outras_empresas;
create policy acesso_outras_select on public.acesso_a_outras_empresas for select to authenticated
  using (user_id = (select auth.uid()) or (select app.is_admin()));
create policy acesso_outras_insert on public.acesso_a_outras_empresas for insert to authenticated
  with check ((select app.is_admin()));
create policy acesso_outras_delete on public.acesso_a_outras_empresas for delete to authenticated
  using ((select app.is_admin()));

revoke all on public.acesso_a_outras_empresas from anon;
revoke update on public.acesso_a_outras_empresas from authenticated;
grant select, insert, delete on public.acesso_a_outras_empresas to authenticated;
grant all on public.acesso_a_outras_empresas to service_role;
grant usage, select on sequence public.acesso_a_outras_empresas_id_seq to authenticated, service_role;

-- O que o site pergunta ao montar a tela: "a quais outras empresas eu tenho acesso?".
-- Sem argumento: responde sempre sobre quem está logado (RLS e auth.uid()).
create or replace function public.minhas_outras_empresas()
returns text[]
language sql
stable
set search_path = ''
as $$
  select coalesce(array_agg(a.empresa order by a.empresa), '{}')
  from public.acesso_a_outras_empresas a
  where a.user_id = (select auth.uid())
$$;
comment on function public.minhas_outras_empresas() is
  'As outras empresas (slugs) que a pessoa logada também acessa: o site mostra o botão de trocar só para elas.';
revoke all on function public.minhas_outras_empresas() from public, anon;
grant execute on function public.minhas_outras_empresas() to authenticated, service_role;
