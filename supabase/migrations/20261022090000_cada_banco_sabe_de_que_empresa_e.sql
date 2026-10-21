-- ===========================================================================
-- TRÍADE — cada banco sabe de que empresa é (22/10/2026; plano multiempresa)
--
-- O mesmo CRM passa a servir duas empresas, a KOMUNE e a Imova Imobiliária,
-- cada uma com o SEU projeto Supabase (banco, logins, arquivos e WhatsApp
-- próprios). As migrações são as mesmas nos dois bancos; o que muda é o dado.
-- Pedido do usuário: "uma pessoa subir comando do banco para o projeto errado
-- não deve acontecer". Não pode depender de cuidado: o banco tem de recusar.
--
-- Esta migração cria a identidade do banco: uma linha só, em `app.identidade`,
-- que diz de que empresa ele é. Ela não sabe qual empresa é — a mesma migração
-- roda nos dois bancos. A identidade é gravada uma vez, por quem monta o banco:
--
--   * `app.definir_identidade('komune', true)` no banco da KOMUNE (que já tem
--     dados; o `true` é a confirmação de que é ele mesmo), pelo
--     `scripts/publicar-banco.mjs`, que só confirma quando o projeto é o que o
--     arquivo de empresas diz;
--   * `app.definir_identidade('imova')` no seed da Imova, num banco vazio.
--
-- Depois de gravada, a identidade não muda nem some (UPDATE, DELETE e TRUNCATE
-- são recusados). Gravar outra empresa num banco que já tem identidade é recusado;
-- gravar a primeira identidade num banco que já tem parceiros, sem confirmar, é
-- recusado — é o que impede o seed da Imova de entrar no banco da KOMUNE mesmo
-- antes de a KOMUNE ter a sua identidade.
--
-- `app.exigir_empresa(slug)` é a primeira linha de todo seed e script de uma
-- empresa: aborta se o banco não for dela. `public.empresa_do_banco()` deixa o
-- site e os workers conferirem, ao ligar, se estão no banco certo.
--
-- Idempotente: pode ser reaplicada.
--
-- COMO DESFAZER (só antes de qualquer banco ter identidade gravada):
--   drop function if exists public.empresa_do_banco();
--   drop function if exists app.exigir_empresa(text);
--   drop function if exists app.definir_identidade(text, boolean);
--   drop table if exists app.identidade;
--   drop function if exists app.identidade_imutavel();
-- ===========================================================================

create table if not exists app.identidade (
  unica       boolean primary key default true check (unica),
  empresa     text not null check (empresa ~ '^[a-z][a-z0-9-]{1,30}$'),
  definida_em timestamptz not null default now()
);
comment on table app.identidade is
  'De que empresa é este banco. Uma linha só, gravada uma vez (app.definir_identidade) e imutável.';

-- Sem política: só as funções abaixo (security definer) leem e gravam.
alter table app.identidade enable row level security;

create or replace function app.identidade_imutavel()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'A identidade do banco não muda nem some depois de gravada.'
    using errcode = '42501';
end $$;

drop trigger if exists identidade_imutavel on app.identidade;
create trigger identidade_imutavel
  before update or delete on app.identidade
  for each row execute function app.identidade_imutavel();

drop trigger if exists identidade_imutavel_truncate on app.identidade;
create trigger identidade_imutavel_truncate
  before truncate on app.identidade
  for each statement execute function app.identidade_imutavel();

-- Grava a identidade uma vez. Repetir a mesma empresa não faz nada; outra
-- empresa é recusada. Num banco que já tem parceiros, a primeira gravação só
-- passa com `p_banco_com_dados = true`.
create or replace function app.definir_identidade(p_empresa text, p_banco_com_dados boolean default false)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_atual text;
begin
  select i.empresa into v_atual from app.identidade i;
  if v_atual = p_empresa then
    return v_atual;
  end if;
  if v_atual is not null then
    raise exception 'Este banco é da empresa "%"; não pode virar "%".', v_atual, p_empresa
      using errcode = '42501';
  end if;
  if not p_banco_com_dados and exists (select 1 from public.organizations) then
    raise exception 'Este banco já tem parceiros e ainda não tem identidade. Gravar "%" aqui exige confirmação de que é o banco certo.', p_empresa
      using errcode = '42501';
  end if;
  insert into app.identidade (empresa) values (p_empresa);
  return p_empresa;
end $$;

-- Primeira linha de todo seed e script de uma empresa.
create or replace function app.exigir_empresa(p_empresa text)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_atual text;
begin
  select i.empresa into v_atual from app.identidade i;
  if v_atual is distinct from p_empresa then
    raise exception 'Este banco é da empresa "%", e este comando é da "%". Nada foi feito.',
      coalesce(v_atual, '(sem identidade)'), p_empresa
      using errcode = '42501';
  end if;
end $$;

-- O site e os workers conferem, ao ligar, se o banco é o da empresa deles.
create or replace function public.empresa_do_banco()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select i.empresa from app.identidade i
$$;
comment on function public.empresa_do_banco() is
  'De que empresa é este banco (null antes de a identidade ser gravada).';

revoke all on table app.identidade from public, anon, authenticated;
revoke all on function app.identidade_imutavel() from public, anon, authenticated;
revoke all on function app.definir_identidade(text, boolean) from public, anon, authenticated;
revoke all on function app.exigir_empresa(text) from public, anon, authenticated;
revoke all on function public.empresa_do_banco() from public, anon;
grant execute on function public.empresa_do_banco() to authenticated, service_role;
