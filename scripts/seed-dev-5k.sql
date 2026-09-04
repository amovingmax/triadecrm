-- =====================================================================
-- KOMUNE CRM — carga de DESENVOLVIMENTO: 5.000 parceiros realistas.
--
-- Para que serve: medir a tela de Parceiros (busca, filtros, paginação) com um
-- volume parecido com o da operação real de Natal, e dar ao time uma base com
-- cara de verdade para validar leitura de tela em campo.
--
-- NÃO É A SEED DO PRODUTO. A seed oficial (catálogos, funis, modelos) é
-- `supabase/seed.sql` e roda no `supabase db reset`. Esta carga é local,
-- reaplicável e apaga só o que ela mesma criou: toda organização criada aqui
-- leva `collector = 'seed-dev-5k'`, que é a marca de limpeza. Nunca aplique
-- este arquivo em produção.
--
-- Uso:  pnpm db:seed-dev
--   ou: docker exec -i supabase_db_komune-crm psql -U postgres -d postgres \
--         -v ON_ERROR_STOP=1 -f scripts/seed-dev-5k.sql
--
-- O que gera:
--   * 4 perfis de desenvolvimento (quando ainda não existem), para o filtro
--     "responsável" ter mais de uma opção;
--   * 5.000 organizações com nome coerente com a categoria, bairro de Natal ou
--     cidade da Grande Natal, telefone E.164 válido e único, @instagram único,
--     site e CNPJ com dígito verificador correto em parte da base;
--   * um negócio por organização, distribuído pelas etapas do funil na proporção
--     de um funil real (muita prospecção, pouca publicação), com `last_activity_at`
--     espalhado no tempo — a temperatura e o `needs_attention` saem sozinhos dos
--     gatilhos (PRD §5.6), não são escritos aqui;
--   * um segundo negócio no funil de ativação para quem já foi publicado, para a
--     lista ter as temperaturas `cliente` e `cliente_ativo`.
--
-- Determinístico: sem random(). Tudo deriva do índice da série, então duas
-- máquinas com a mesma seed oficial produzem a mesma base.
-- =====================================================================

set client_encoding = 'UTF8';
set timezone = 'America/Fortaleza';

begin;

-- ---------------------------------------------------------------------
-- 0. CNPJ com dígito verificador (só existe durante esta sessão)
-- ---------------------------------------------------------------------
create or replace function pg_temp.cnpj_com_dv(p_base text)
returns text
language plpgsql
immutable
as $$
declare
  pesos1 constant int[] := array[5,4,3,2,9,8,7,6,5,4,3,2];
  pesos2 constant int[] := array[6,5,4,3,2,9,8,7,6,5,4,3,2];
  soma int := 0;
  d1 int;
  d2 int;
  i int;
begin
  for i in 1..12 loop
    soma := soma + substr(p_base, i, 1)::int * pesos1[i];
  end loop;
  d1 := 11 - (soma % 11);
  if d1 >= 10 then d1 := 0; end if;

  soma := 0;
  for i in 1..12 loop
    soma := soma + substr(p_base, i, 1)::int * pesos2[i];
  end loop;
  soma := soma + d1 * pesos2[13];
  d2 := 11 - (soma % 11);
  if d2 >= 10 then d2 := 0; end if;

  return p_base || d1::text || d2::text;
end $$;

-- ---------------------------------------------------------------------
-- 1. Limpeza da carga anterior (as filhas caem por ON DELETE CASCADE)
-- ---------------------------------------------------------------------
delete from public.organizations where collector = 'seed-dev-5k';

-- ---------------------------------------------------------------------
-- 2. Perfis de desenvolvimento
--    Sem gente no time, o filtro "responsável" fica com uma opção só e a coluna
--    da lista não diz nada. Estes usuários existem apenas no banco local: não
--    têm senha nem identidade OAuth, então não entram pelo login. O papel vem do
--    gatilho `on_auth_user_created` (domínio komune.app.br -> sdr, RF-ADM-01).
--    Quem faz login de verdade é o usuário criado pela API admin (ver README).
-- ---------------------------------------------------------------------
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  created_at, updated_at, raw_app_meta_data, raw_user_meta_data,
  confirmation_token, recovery_token, email_change_token_new, email_change,
  email_change_token_current, reauthentication_token)
select
  '00000000-0000-0000-0000-000000000000',
  u.id, 'authenticated', 'authenticated', u.email, '', now(),
  now(), now(), '{"provider":"google","providers":["google"]}'::jsonb,
  jsonb_build_object('full_name', u.nome),
  '', '', '', '', '', ''
from (values
  ('d0000000-0000-4000-8000-000000000d01'::uuid, 'heloisa.dev@komune.app.br', 'Heloísa Cavalcanti'),
  ('d0000000-0000-4000-8000-000000000d02'::uuid, 'barbara.dev@komune.app.br',  'Bárbara Fontes'),
  ('d0000000-0000-4000-8000-000000000d03'::uuid, 'matheus.dev@komune.app.br',  'Matheus Rondon'),
  ('d0000000-0000-4000-8000-000000000d04'::uuid, 'luiz.dev@komune.app.br',     'Luiz Bandeira')
) as u(id, email, nome)
where not exists (select 1 from auth.users a where a.email = u.email);

-- ---------------------------------------------------------------------
-- 3. Vocabulário: nomes, bairros, formatos de nome por categoria
-- ---------------------------------------------------------------------

-- Donos possíveis, em ordem estável: a carga distribui as 5.000 organizações
-- entre eles em rodízio, para o filtro "responsável" ter o que filtrar.
create temporary table _dono (pos int primary key, id uuid) on commit drop;
insert into _dono (pos, id)
select (row_number() over (order by p.created_at, p.id) - 1)::int, p.id
  from public.profiles p
 where p.is_active and p.role in ('admin','gestor','sdr','embaixador');

create temporary table _cfg (
  nomes      text[],
  sufixos    text[],
  bairros    text[],
  cidades    int[],
  intencoes  text[]
) on commit drop;

insert into _cfg values (
  -- 61 nomes com cara de Natal (praias, bairros e elementos do litoral potiguar)
  array['Dunas','Potengi','Genipabu','Redinha','Pirangi','Maracajaú','Cajueiro','Ponta Negra',
        'Areia Preta','Barreira','Forte','Farol','Jangada','Maré','Coqueiral','Carnaúba',
        'Brisa','Sol Poente','Vento Leste','Salinas','Tirol','Cidade Alta','Ribeira','Rocas',
        'Alecrim','Lagoa Nova','Capim Macio','Neópolis','Candelária','Pitimbu','Igapó','Pajuçara',
        'Nazaré','Guararapes','Morro Branco','Búzios','Cotovelo','Camurupim','Tabatinga','Muriú',
        'Jacumã','Perobas','Punaú','Zumbi','São Miguel','Santa Rita','Bom Jesus','Aurora',
        'Estrela','Horizonte','Recanto','Mirante','Varanda','Terraço','Palmeira','Oliveira',
        'Bezerra','Seridó','Açu','Mossoró','Cabugi'],
  -- 13 sufixos (3 vazios): 61 x 13 x 57 formatos cobre 5.000 nomes sem repetir
  array['','','',' do Sol',' do Mar',' da Praia',' Natal',' Potiguar',' das Dunas',' Nordeste',
        ' RN',' Premium',' e Cia'],
  -- 36 bairros de Natal (zonas Sul, Leste, Oeste e Norte)
  array['Ponta Negra','Capim Macio','Lagoa Nova','Tirol','Petrópolis','Candelária','Neópolis',
        'Pitimbu','Nova Descoberta','Alecrim','Cidade Alta','Ribeira','Rocas','Santos Reis',
        'Praia do Meio','Areia Preta','Mãe Luiza','Barro Vermelho','Lagoa Seca','Dix-Sept Rosado',
        'Quintas','Bom Pastor','Nordeste','Nossa Senhora de Nazaré','Cidade da Esperança',
        'Felipe Camarão','Guarapes','Planalto','Cidade Nova','Igapó','Potengi','Lagoa Azul',
        'Pajuçara','Redinha','Salinas','Nossa Senhora da Apresentação'],
  -- distribuição de cidades (ids da seed oficial): Natal domina, depois a Grande Natal
  array[1,1,1,1,1,1,1,1,1,1,1,1,2,2,2,3,3,4,5,6,7,8,9],
  -- intenções do Apêndice C que a regra de temperatura lê (PRD §5.6); '' = sem intenção
  array['','','','','interessado','pediu_taxa','me_chama_depois','manda_material','ambiguo',
        'quer_saber_mais','ja_uso_outro','agendamento_aceito','desconfianca','so_emoji']
);

-- Formato do nome por categoria (o `%s` recebe o nome montado) e o tipo de organização.
create temporary table _formato (category_id int, pos int, formato text, kind app.org_kind) on commit drop;
insert into _formato (category_id, pos, formato, kind) values
  (1, 0, 'Buffet %s',                  'fornecedor'),
  (1, 1, '%s Buffet e Eventos',        'fornecedor'),
  (1, 2, 'Casa %s Recepções',          'fornecedor'),
  (2, 0, 'Churrasco do %s',            'fornecedor'),
  (2, 1, 'Espetinho %s',               'fornecedor'),
  (2, 2, 'Food Truck %s',              'fornecedor'),
  (3, 0, 'Bar %s',                     'fornecedor'),
  (3, 1, 'Chopp %s',                   'fornecedor'),
  (3, 2, 'Drinks %s',                  'fornecedor'),
  (4, 0, 'Doces %s',                   'fornecedor'),
  (4, 1, 'Confeitaria %s',             'fornecedor'),
  (4, 2, 'Bolos da %s',                'fornecedor'),
  (5, 0, 'Buffet Infantil %s',         'fornecedor'),
  (5, 1, 'Casa de Festas %s',          'espaco'),
  (5, 2, 'Festa %s Kids',              'fornecedor'),
  (6, 0, 'Som e Luz %s',               'fornecedor'),
  (6, 1, '%s Áudio e Iluminação',      'fornecedor'),
  (6, 2, 'Sonorização %s',             'fornecedor'),
  (7, 0, 'Tendas %s',                  'fornecedor'),
  (7, 1, '%s Estruturas e Palcos',     'fornecedor'),
  (7, 2, 'Palcos %s',                  'fornecedor'),
  (8, 0, 'Locações %s',                'fornecedor'),
  (8, 1, '%s Mobiliário para Eventos', 'fornecedor'),
  (8, 2, 'Louças e Talheres %s',       'fornecedor'),
  (9, 0, '%s Audiovisual',             'fornecedor'),
  (9, 1, 'Geradores %s',               'fornecedor'),
  (9, 2, '%s LED e Painéis',           'fornecedor'),
  (10, 0, 'Estúdio %s',                'fornecedor'),
  (10, 1, '%s Fotografia',             'fornecedor'),
  (10, 2, 'Foto e Vídeo %s',           'fornecedor'),
  (11, 0, 'Banda %s',                  'fornecedor'),
  (11, 1, 'DJ %s',                     'fornecedor'),
  (11, 2, 'Trio %s',                   'fornecedor'),
  (12, 0, 'Decorações %s',             'fornecedor'),
  (12, 1, 'Flores %s',                 'fornecedor'),
  (12, 2, 'Ateliê %s',                 'fornecedor'),
  (13, 0, 'Beleza %s',                 'fornecedor'),
  (13, 1, 'Convites %s',               'fornecedor'),
  (13, 2, 'Celebrante %s',             'fornecedor'),
  (14, 0, 'Espaço %s',                 'espaco'),
  (14, 1, 'Chácara %s',                'espaco'),
  (14, 2, 'Salão %s',                  'espaco'),
  (15, 0, 'Recreação %s',              'fornecedor'),
  (15, 1, 'Turma do %s',               'fornecedor'),
  (15, 2, 'Animação %s',               'fornecedor'),
  (16, 0, 'Brinquedos %s',             'fornecedor'),
  (16, 1, 'Pula-Pula %s',              'fornecedor'),
  (16, 2, 'Infláveis %s',              'fornecedor'),
  (17, 0, 'Assessoria %s',             'cerimonialista'),
  (17, 1, '%s Cerimonial',             'cerimonialista'),
  (17, 2, 'Cerimonial %s',             'cerimonialista'),
  (18, 0, 'Formaturas %s',             'produtor'),
  (18, 1, '%s Formaturas',             'produtor'),
  (18, 2, 'Comissão %s',               'produtor'),
  (19, 0, 'Produtora %s',              'produtor'),
  (19, 1, '%s Eventos Corporativos',   'empresa'),
  (19, 2, 'Agência %s',                'empresa');

-- Distribuição de etapas do funil de captação: 30 fatias na proporção de um funil
-- real (muita prospecção; publicado, nutrição e perdido aparecem pouco).
create temporary table _etapa (pos int primary key, stage_slug text) on commit drop;
insert into _etapa (pos, stage_slug)
select (ord - 1)::int, slug
  from unnest(array[
    'prospectado','prospectado','prospectado','prospectado','prospectado','prospectado',
    'prospectado','prospectado','prospectado','prospectado','prospectado','prospectado',
    'contatado','contatado','contatado','contatado','contatado',
    'respondeu','respondeu','respondeu',
    'em_conversa','em_conversa',
    'reuniao_marcada','reuniao_marcada',
    'apresentacao_realizada','autorizou','cadastro_em_andamento',
    'publicado','nutricao','perdido']) with ordinality as t(slug, ord);

-- ---------------------------------------------------------------------
-- 4. Plano da carga: uma linha por organização, tudo já resolvido.
--    Determinístico: cada dimensão anda com um passo primo diferente sobre o
--    índice da série, então nome, categoria, bairro e etapa não se repetem em
--    blocos (o que faria a lista parecer gerada por máquina).
-- ---------------------------------------------------------------------
create temporary table _plano (
  i                int primary key,
  id               uuid not null,
  category_id      int  not null,
  category_2_id    int,
  kind             app.org_kind not null,
  nome             text not null,
  apelido          text not null,   -- versão sem acento e sem espaço, para @ e site
  telefone         text not null,
  city_id          int  not null,
  bairro           text,
  source_id        int  not null,
  etapa_slug       text not null,
  intencao         text,
  dias_sem_contato int  not null
) on commit drop;

insert into _plano
select
  s.i,
  gen_random_uuid(),
  s.category_id,
  case when s.i % 5 = 0 and ((s.category_id + 4) % 19) + 1 <> s.category_id
       then ((s.category_id + 4) % 19) + 1 end,
  f.kind,
  nome.v,
  left(regexp_replace(lower(extensions.unaccent(nome.v)), '[^a-z0-9]', '', 'g'), 20),
  -- +55 84 9 3xxx xxxx: celular válido (11 dígitos, começando em 9) e único por construção
  '+5584' || '9' || lpad((30000000 + s.i)::text, 8, '0'),
  c.cidades[s.n_cidade + 1],
  case when c.cidades[s.n_cidade + 1] = 1 then c.bairros[s.n_bairro + 1] end,
  s.n_origem + 1,
  e.stage_slug,
  nullif(c.intencoes[s.n_intencao + 1], ''),
  -- 0 a 59 dias sem contato, com metade da base concentrada em até 14 dias
  case when s.i % 2 = 0 then s.n_dias / 4 else s.n_dias end
from (
  -- Módulos primos entre si (61, 13, 19, 3, 23, 36, 30, 14, 11, 59): pelo teorema
  -- chinês do resto a combinação nome x sufixo x categoria x formato só se repetiria
  -- depois de 61*13*19*3 = 45.201 linhas, então os 5.000 nomes são distintos.
  select i,
         (i * 7)  % 61 as n_nome,
         (i * 5)  % 13 as n_sufixo,
         ((i * 13) % 19) + 1 as category_id,
         (i * 17) % 36 as n_bairro,
         (i * 19) % 23 as n_cidade,
         (i * 2)  % 3  as n_formato,
         (i * 29) % 30 as n_etapa,
         (i * 31) % 14 as n_intencao,
         (i * 37) % 11 as n_origem,
         (i * 41) % 59 as n_dias
    from generate_series(1, 5000) i) s
cross join _cfg c
join _formato f on f.category_id = s.category_id and f.pos = s.n_formato
join _etapa   e on e.pos = s.n_etapa
cross join lateral (select format(f.formato, c.nomes[s.n_nome + 1] || c.sufixos[s.n_sufixo + 1]) as v) nome;

-- ---------------------------------------------------------------------
-- 5. As 5.000 organizações
-- ---------------------------------------------------------------------
insert into public.organizations (
  id, kind, name, phone_e164, email, instagram_handle, website, cnpj,
  city_id, neighborhood, address, source_id, source_url, collected_at, collector,
  owner_id, is_natural_person, vip, description)
select
  p.id,
  p.kind,
  p.nome,
  p.telefone,
  case when p.i % 3 = 0 then 'contato' || p.i || '@' || p.apelido || '.com.br' end,
  p.apelido || p.i,
  case when p.i % 5 in (0, 2) then 'https://www.' || p.apelido || p.i || '.com.br' end,
  -- CNPJ com dígito verificador correto em ~1/4 da base; o resto é MEI/autônomo
  case when p.i % 4 = 1 then pg_temp.cnpj_com_dv(lpad((10000000 + p.i)::text, 8, '0') || '0001') end,
  p.city_id,
  p.bairro,
  case when p.bairro is not null then 'Rua ' || p.bairro || ', ' || (100 + (p.i % 900))::text end,
  p.source_id,
  case when p.i % 7 = 0 then 'https://exemplo.local/parceiro/' || p.i end,
  now() - make_interval(days => (p.i % 180)),
  'seed-dev-5k',
  (select d.id from _dono d where d.pos = p.i % greatest((select count(*) from _dono), 1)),
  p.i % 9 = 0 and p.i % 4 <> 1,   -- pessoa física não tem CNPJ
  p.i % 97 = 0,
  case when p.i % 6 = 0
       then 'Atende ' || lower(cat.name) || ' em ' || coalesce(p.bairro, ci.name) || ' e região.' end
from _plano p
join public.categories cat on cat.id = p.category_id
join public.cities ci on ci.id = p.city_id;

-- ---------------------------------------------------------------------
-- 6. Categorias do parceiro (a primária e, em 1/5 da base, uma segunda)
-- ---------------------------------------------------------------------
insert into public.organization_categories (organization_id, category_id, is_primary)
select p.id, p.category_id, true from _plano p;

insert into public.organization_categories (organization_id, category_id, is_primary)
select p.id, p.category_2_id, false from _plano p where p.category_2_id is not null;

-- ---------------------------------------------------------------------
-- 6.1 Negócios no funil de captação (ou de produtor, conforme o tipo)
--     A temperatura e o needs_attention NÃO são escritos aqui: saem dos
--     gatilhos (app.compute_temperature) a partir de etapa x intenção x recência.
-- ---------------------------------------------------------------------
insert into public.deals (
  organization_id, pipeline_id, stage_id, owner_id, source_id, tier,
  entered_stage_at, last_activity_at, last_intent, last_intent_at,
  next_action, next_action_at, lost_reason_id)
select
  p.id,
  pl.id,
  st.id,
  org.owner_id,
  p.source_id,
  case when p.i % 23 = 0 then 'A+' when p.i % 7 = 0 then 'A' when p.i % 3 = 0 then 'B' else 'C' end,
  now() - make_interval(days => (p.dias_sem_contato + (p.i % 12))),
  -- parte dos prospectados nunca teve contato: a coluna "dias sem contato" precisa
  -- mostrar também o caso "nunca falamos com essa pessoa"
  case when p.etapa_slug = 'prospectado' and p.i % 4 = 0 then null
       else now() - make_interval(days => p.dias_sem_contato) end,
  p.intencao,
  case when p.intencao is null then null else now() - make_interval(days => p.dias_sem_contato) end,
  case (p.i % 5)
    when 0 then 'Primeiro contato'
    when 1 then 'Retomar conversa'
    when 2 then 'Enviar material'
    when 3 then 'Confirmar reunião'
    else 'Ligar para o decisor'
  end,
  ((app.next_business_day((now() at time zone 'America/Fortaleza')::date, 1 + (p.i % 9)) + time '09:00')
     at time zone 'America/Fortaleza'),
  case when p.etapa_slug = 'perdido' then ((p.i % 9) + 1) end
from _plano p
join public.organizations org on org.id = p.id
join public.pipelines pl
  on pl.slug = case when p.kind in ('produtor','cerimonialista') then 'produtor' else 'fornecedor' end
join public.stages st
  on st.pipeline_id = pl.id
 -- o funil de produtor usa outros nomes para as mesmas posições
 and st.slug = case
                 when pl.slug <> 'produtor' then p.etapa_slug
                 when p.etapa_slug = 'prospectado'            then 'identificado'
                 when p.etapa_slug = 'em_conversa'            then 'respondeu'
                 when p.etapa_slug = 'reuniao_marcada'        then 'demonstracao_marcada'
                 when p.etapa_slug = 'apresentacao_realizada' then 'demonstracao_realizada'
                 when p.etapa_slug = 'autorizou'              then 'parceria_aceita'
                 when p.etapa_slug = 'cadastro_em_andamento'  then 'evento_piloto_definido'
                 when p.etapa_slug = 'publicado'              then 'evento_criado'
                 else p.etapa_slug
               end;

-- ---------------------------------------------------------------------
-- 6.2 Quem foi publicado entra no funil de ativação
--    É o que traz as temperaturas `cliente` e `cliente_ativo` para a lista.
-- ---------------------------------------------------------------------
insert into public.deals (
  organization_id, pipeline_id, stage_id, owner_id, source_id,
  entered_stage_at, last_activity_at, next_action, next_action_at)
select
  o.id,
  (select id from public.pipelines where slug = 'ativacao'),
  st.id,
  org.owner_id,
  org.source_id,
  now() - make_interval(days => (o.i % 40)),
  now() - make_interval(days => (o.i % 21)),
  case (o.i % 3)
    when 0 then 'Checar primeiro lead'
    when 1 then 'Completar o perfil'
    else 'Confirmar contratação'
  end,
  ((app.next_business_day((now() at time zone 'America/Fortaleza')::date, 1 + (o.i % 5)) + time '09:00')
     at time zone 'America/Fortaleza')
from _plano o
join public.organizations org on org.id = o.id
join public.stages st
  on st.pipeline_id = (select id from public.pipelines where slug = 'ativacao')
 and st.slug = case (o.i % 5)
                 when 0 then 'publicado'
                 when 1 then 'perfil_completo'
                 when 2 then 'primeiro_lead'
                 when 3 then 'lead_respondido'
                 else 'primeira_contratacao'
               end
where o.etapa_slug = 'publicado'
  and o.kind not in ('produtor','cerimonialista');

commit;

-- ---------------------------------------------------------------------
-- 8. Estatísticas do planejador (a busca depende delas para escolher o índice)
-- ---------------------------------------------------------------------
analyze public.organizations;
analyze public.organization_categories;
analyze public.deals;

-- ---------------------------------------------------------------------
-- 9. Conferência
-- ---------------------------------------------------------------------
select 'organizações' as o_que, count(*)::text as quanto from public.organizations where collector = 'seed-dev-5k'
union all
select 'telefones únicos', count(distinct phone_e164)::text from public.organizations where collector = 'seed-dev-5k'
union all
select 'com CNPJ válido', count(*)::text from public.organizations
  where collector = 'seed-dev-5k' and cnpj is not null and app.cnpj_is_valid(cnpj)
union all
select 'negócios', count(*)::text from public.deals d
  join public.organizations o on o.id = d.organization_id where o.collector = 'seed-dev-5k'
union all
select 'temperatura ' || o.temperature::text, count(*)::text
  from public.organizations o where o.collector = 'seed-dev-5k' group by o.temperature
union all
select 'precisam de atenção', count(*)::text from public.deals d
  join public.organizations o on o.id = d.organization_id
 where o.collector = 'seed-dev-5k' and d.needs_attention;
