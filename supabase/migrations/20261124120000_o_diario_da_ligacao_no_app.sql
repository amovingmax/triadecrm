-- =============================================================================
-- O diário da ligação no app do iPhone (24/11/2026).
--
-- No primeiro teste de verdade (24/11, 10h27 e 10h28) a Meta atendeu, mas o cliente
-- não ouviu nada; e com o app fechado pelo usuário o iPhone não tocou. O app 1.1.1
-- anota cada passo da ligação (o app abriu pelo aviso? o iPhone ligou o áudio? a
-- conexão subiu? quantos bytes foram e vieram?) e manda as linhas ao servidor com o
-- convite da ligação, para ninguém precisar de um Mac com o iPhone no cabo.
--
-- `public.voip_diario(convite, linhas)`: só o serviço (a função `wa-chamada-app`, ação
-- `diario`). Aceita o convite de uma ligação dos últimos 2 dias, em qualquer estado
-- (o diário chega também depois do fim), até 300 linhas de até 300 caracteres. Sem
-- telefone: o app só anota passos, estados e números.
-- =============================================================================

create table if not exists app.voip_diarios (
  id          bigint generated always as identity primary key,
  chamada_id  uuid not null,
  pessoa_id   uuid,
  recebido_em timestamptz not null default now(),
  linhas      jsonb not null
);
create index if not exists voip_diarios_chamada on app.voip_diarios (chamada_id, recebido_em);
alter table app.voip_diarios enable row level security;
revoke all on app.voip_diarios from anon, authenticated;
comment on table app.voip_diarios is
  'O diário do app do iPhone em cada ligação (passos, estados do áudio e da conexão). Só leitura do time técnico; some em 30 dias.';

create or replace function public.voip_diario(p_convite text, p_linhas jsonb) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  c app.voip_convites%rowtype;
  v jsonb;
begin
  if p_convite is null or p_convite !~ '^[A-Za-z0-9_-]{40,60}$' then
    return jsonb_build_object('ok', false, 'motivo', 'convite_invalido');
  end if;
  select * into c from app.voip_convites
   where hash = extensions.digest(p_convite, 'sha256')
     and criado_em > now() - interval '2 days';
  if not found then
    return jsonb_build_object('ok', false, 'motivo', 'convite_invalido');
  end if;
  if p_linhas is null or jsonb_typeof(p_linhas) <> 'array' then
    return jsonb_build_object('ok', false, 'motivo', 'pedido_invalido');
  end if;
  -- Até 300 linhas, cada uma texto de até 300 caracteres.
  select coalesce(jsonb_agg(left(l #>> '{}', 300) order by n), '[]'::jsonb) into v
    from jsonb_array_elements(p_linhas) with ordinality as e(l, n)
   where n <= 300 and jsonb_typeof(l) = 'string';
  delete from app.voip_diarios where recebido_em < now() - interval '30 days';
  insert into app.voip_diarios (chamada_id, pessoa_id, linhas) values (c.chamada_id, c.pessoa_id, v);
  return jsonb_build_object('ok', true, 'linhas', jsonb_array_length(v));
end;
$$;
revoke all on function public.voip_diario(text, jsonb) from public, anon, authenticated;
grant execute on function public.voip_diario(text, jsonb) to service_role;
comment on function public.voip_diario(text, jsonb) is
  'O app do iPhone manda o diário da ligação com o convite (wa-chamada-app, ação diario).';
