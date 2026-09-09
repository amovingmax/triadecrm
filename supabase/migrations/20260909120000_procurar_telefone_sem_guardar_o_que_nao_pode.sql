-- =====================================================================
-- 20260909120000 — Procurar telefone sem guardar o que não pode (RF-BAS-05, RF-RAD-04)
--
-- 34 das 100 fichas em produção não têm telefone. Todas vieram da lista-semente
-- do anexo R09, que já as marca com `sem_telefone_no_r09` — e nenhuma delas tem
-- CNPJ, @instagram, site ou e-mail. Só nome e categoria. Um terço da base parado.
--
-- ---------------------------------------------------------------------------
-- A RESTRIÇÃO QUE DECIDE O DESENHO
-- ---------------------------------------------------------------------------
-- O R03 §2.4 é explícito: os Termos do Google **proíbem armazenar conteúdo do
-- Places**, exceto `place_id` (e lat/lng por 30 dias). O telefone que a API
-- devolve NÃO pode ser gravado. O anexo prescreve o uso certo: Places é *gatilho
-- de descoberta*, e o dado definitivo se obtém com o próprio fornecedor.
--
-- É por isso que esta migração não tem coluna nova para telefone, nem tabela de
-- cache. Ela guarda duas coisas, e só:
--
--   1. `organizations.place_id` — o único campo que os Termos permitem guardar
--      sem prazo. Ele já existia (2ª chave de dedup, RF-BAS-08) e continua com
--      esse papel: da segunda busca em diante, a ficha já sabe qual lugar é, e a
--      consulta fica mais barata e mais precisa.
--   2. Uma linha em `audit_log`. Uma busca no Places é dinheiro (SKU Enterprise,
--      mil grátis por mês) e é uma consulta sobre um negócio real. Sem registro,
--      ninguém sabe quem procurou o quê nem quanto a operação está gastando.
--
-- O telefone encontrado atravessa o servidor, aparece na tela e morre ali. Ele
-- entra na ficha pelo caminho de sempre — alguém liga, fala com o fornecedor, e
-- registra o contato. Aí o dado é da relação, e não do cache do Google.
-- =====================================================================

create or replace function app.registrar_busca_de_telefone(
  p_organization_id uuid,
  p_place_id        text,
  p_achou           boolean
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid  uuid := auth.uid();
  v_org  public.organizations;
begin
  select * into v_org from public.organizations o where o.id = p_organization_id;
  if v_org.id is null then
    return jsonb_build_object('ok', false, 'motivo', 'ficha_inexistente');
  end if;

  -- `place_id` é o único conteúdo do Places que pode ficar. Só preenche quando
  -- está vazio: sobrescrever apagaria uma correspondência que alguém já
  -- confirmou, e o índice único de dedup existe justamente para ela.
  if p_place_id is not null and v_org.place_id is null then
    update public.organizations
       set place_id = p_place_id
     where id = p_organization_id;
  end if;

  insert into public.audit_log (actor_id, actor_role, action, table_name, row_id, new_data)
  values (v_uid, app.role()::text, 'places.busca_de_telefone', 'organizations',
          p_organization_id::text,
          -- O NÚMERO NÃO ENTRA AQUI. Guardar o telefone no registro de auditoria
          -- seria guardar conteúdo do Places por uma porta lateral, e é o mesmo
          -- que os Termos proíbem pela porta da frente.
          jsonb_build_object('achou', p_achou, 'place_id', p_place_id));

  return jsonb_build_object('ok', true, 'place_id_gravado',
                            p_place_id is not null and v_org.place_id is null);
end
$$;

comment on function app.registrar_busca_de_telefone(uuid, text, boolean) is
  'Registra uma busca de telefone no Google Places: guarda o place_id (único campo que os Termos do Google permitem armazenar) e audita a consulta. O TELEFONE NÃO É GRAVADO em lugar nenhum, nem no audit_log — ele aparece na tela e morre ali, e entra na ficha só quando o fornecedor o confirma numa ligação.';

revoke all on function app.registrar_busca_de_telefone(uuid, text, boolean) from public, anon, authenticated;
grant execute on function app.registrar_busca_de_telefone(uuid, text, boolean) to service_role;


-- ---------------------------------------------------------------------------
-- A ficha que a busca precisa
-- ---------------------------------------------------------------------------
-- Nome, bairro e cidade montam a consulta textual. Vem numa função só porque a
-- rota do servidor não pode ler `organizations` com o cliente da pessoa e ainda
-- assim garantir que o bairro veio da MESMA ficha do nome — e uma consulta
-- textual montada com o nome de um e o bairro de outro devolve o telefone
-- errado, que é o pior defeito possível aqui.

create or replace function app.ficha_para_busca_de_telefone(p_organization_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id',           o.id,
    'nome',         o.name,
    'bairro',       o.neighborhood,
    'cidade',       c.name,
    'uf',           c.state,
    'place_id',     o.place_id,
    'tem_telefone', o.phone_e164 is not null,
    'nao_contatar', o.do_not_contact,
    'categoria',    (select ca.name
                       from public.organization_categories oc
                       join public.categories ca on ca.id = oc.category_id
                      where oc.organization_id = o.id and oc.is_primary
                      limit 1)
  )
  from public.organizations o
  left join public.cities c on c.id = o.city_id
  where o.id = p_organization_id
$$;

comment on function app.ficha_para_busca_de_telefone(uuid) is
  'Nome, bairro, cidade e categoria de uma ficha, para montar a consulta textual do Places. Numa consulta só: nome de uma ficha com bairro de outra devolveria o telefone errado.';

revoke all on function app.ficha_para_busca_de_telefone(uuid) from public, anon, authenticated;
grant execute on function app.ficha_para_busca_de_telefone(uuid) to service_role;
