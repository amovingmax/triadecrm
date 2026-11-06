-- =====================================================================
-- Anúncios do Canal Pro: o limite do plano e o que o validador recusou — só na Imova (04/11/2026)
--
-- Depois da migração 20261104150000, o usuário mandou a especificação da
-- integração (integracao-imova-grupozap.md, 04/11/2026) e pediu: "faça esse
-- passo a passo". Ela trouxe o plano da Imova e o validador oficial do Grupo
-- OLX apontou dois valores que o CRM mandava e o portal não aceita.
--
-- ===========================================================================
-- 1. O LIMITE DO PLANO
-- ===========================================================================
-- O plano da Imova é o Multiportais 10 Padrão: 10 anúncios, 2 com destaque,
-- até 22/01/2027 (a especificação). A integração só publica dentro das vagas
-- contratadas: o que passar fica de fora sem aviso no CRM. Agora o banco conta
-- e recusa antes:
--   * a vaga: anúncios do CRM no ar + os manuais do Canal Pro que estão na lista
--     (o mesmo número que a tela mostra em "No ar");
--   * o destaque: os do CRM no ar com destaque diferente de Padrão + os manuais
--     cujo relatório escreve um destaque (`app.canal_pro_destaque_do_relatorio`).
-- `public.anuncio_publicar` recusa com `plano_cheio` ou `plano_sem_destaque`;
-- `public.anuncio_destaque` recusa com `plano_sem_destaque` só no anúncio no ar
-- (o rascunho escolhe à vontade e é conferido ao ir ao ar). As duas travam a
-- linha de `canal_pro`: duas pessoas não pegam a última vaga juntas.
-- O limite é ajustável pela gestão (`public.canal_pro_ajustar_plano`); vazio
-- quer dizer que o CRM não confere. Importar o relatório e desfazer um "já
-- excluí" NÃO são recusados: eles contam o que existe no Canal Pro, e o que
-- existe não se recusa.
--
-- ===========================================================================
-- 2. O QUE O VALIDADOR RECUSOU (developers.grupozap.com/feeds/xml_validator,
--    a API `integrations-api-re-listings.olx.com.br/v1/sandbox/xml_validation`)
-- ===========================================================================
-- O arquivo do CRM, com os 24 tipos, os 6 destaques, os 5 períodos de aluguel,
-- os 3 modos de endereço e as 40 características, passou inteiro, menos:
--   * PublicationType "TRIPLE": aceitos são STANDARD, PREMIUM, SUPER_PREMIUM,
--     PREMIERE_1, PREMIERE_2 e PREMIERE_3. O "Destaque triplo" sai da lista
--     (quem o tivesse volta a Padrão);
--   * PropertyType "Residential / Loft": a tabela da documentação lista, o
--     validador recusa. O loft vai como apartamento ("Residential / Apartment"),
--     que é onde o portal o põe.
-- O validador confere a estrutura e o vocabulário, não as regras de conteúdo
-- (CEP, 5 fotos, tamanho do título): essas continuam em `app.anuncio_pendencias`.
-- Ele também confirmou que o ContactInfo vai DENTRO de cada Listing.
--
-- ===========================================================================
-- SÓ DA IMOVA, E O WHATSAPP NÃO É TOCADO
-- ===========================================================================
-- No banco da KOMUNE esta migração não cria nada, como a 20261104150000.
--
-- COMO DESFAZER (no banco da Imova):
--   drop function if exists public.canal_pro_ajustar_plano(int, int),
--     app.canal_pro_ocupadas(uuid), app.canal_pro_destaque_do_relatorio(text);
--   alter table public.canal_pro drop column if exists limite_anuncios,
--     drop column if exists limite_destaques;
--   e recriar public.anuncio_publicar, public.anuncio_destaque,
--   public.canal_pro_situacao e app.anuncio_tipo como estão na 20261104150000.
-- =====================================================================

do $limite$
begin
  if (select i.empresa from app.identidade i) = 'komune' then
    raise notice 'Os anúncios do Canal Pro são só da Imova: no banco da KOMUNE nada foi criado.';
    return;
  end if;
  execute $ddl$

-- =====================================================================
-- 1. O destaque triplo sai; o loft vai como apartamento
-- =====================================================================
update public.anuncios set destaque = 'padrao' where destaque = 'triplo';
alter table public.anuncios drop constraint if exists anuncios_destaque_check;
alter table public.anuncios add constraint anuncios_destaque_check
  check (destaque in ('padrao', 'destaque', 'super_destaque', 'exclusivo', 'superior'));

create or replace function app.anuncio_tipo(p_tipo text)
returns table (vrsync text, uso text, area text, pede_quartos boolean, pede_banheiros boolean)
language sql
immutable
set search_path = ''
as $$
  select t.vrsync, t.uso, t.area, t.pede_quartos, t.pede_banheiros
    from (values
      ('apartamento',        'Residential / Apartment',           'Residential', 'util',  true,  true),
      ('casa',               'Residential / Home',                'Residential', 'util',  true,  true),
      ('casa_condominio',    'Residential / Condo',               'Residential', 'util',  true,  true),
      ('casa_vila',          'Residential / Village House',       'Residential', 'util',  true,  true),
      ('sobrado',            'Residential / Sobrado',             'Residential', 'util',  true,  true),
      ('cobertura',          'Residential / Penthouse',           'Residential', 'util',  true,  true),
      ('flat',               'Residential / Flat',                'Residential', 'util',  true,  true),
      ('kitnet',             'Residential / Kitnet',              'Residential', 'util',  false, true),
      ('studio',             'Residential / Studio',              'Residential', 'util',  false, true),
      -- O validador recusa "Residential / Loft" (04/11/2026).
      ('loft',               'Residential / Apartment',           'Residential', 'util',  true,  true),
      ('terreno',            'Residential / Land Lot',            'Residential', 'total', false, false),
      ('chacara',            'Residential / Farm Ranch',          'Residential', 'total', true,  true),
      ('fazenda_sitio',      'Residential / Agricultural',        'Residential', 'total', true,  true),
      ('sala_comercial',     'Commercial / Office',               'Commercial',  'util',  false, true),
      ('consultorio',        'Commercial / Consultorio',          'Commercial',  'util',  false, true),
      ('loja',               'Commercial / Business',             'Commercial',  'util',  false, false),
      ('imovel_comercial',   'Commercial / Building',             'Commercial',  'util',  false, false),
      ('predio_comercial',   'Commercial / Edificio Comercial',   'Commercial',  'util',  false, false),
      ('predio_residencial', 'Commercial / Edificio Residencial', 'Commercial',  'util',  true,  true),
      ('andar_corporativo',  'Commercial / Corporate Floor',      'Commercial',  'util',  false, false),
      ('galpao',             'Commercial / Industrial',           'Commercial',  'total', false, false),
      ('terreno_comercial',  'Commercial / Land Lot',             'Commercial',  'total', false, false),
      ('garagem',            'Commercial / Garage',               'Commercial',  'util',  false, false),
      ('hotel',              'Commercial / Hotel',                'Commercial',  'util',  false, false)
    ) as t(slug, vrsync, uso, area, pede_quartos, pede_banheiros)
   where t.slug = p_tipo
$$;

-- =====================================================================
-- 2. O plano: as vagas e os destaques
-- =====================================================================
alter table public.canal_pro add column if not exists limite_anuncios int
  check (limite_anuncios between 0 and 10000);
alter table public.canal_pro add column if not exists limite_destaques int
  check (limite_destaques between 0 and 10000);
comment on column public.canal_pro.limite_anuncios is
  'Quantos anúncios o plano do Canal Pro publica (CRM + manuais). Vazio: o CRM não confere.';
comment on column public.canal_pro.limite_destaques is
  'Quantos anúncios com destaque o plano do Canal Pro aceita. Vazio: o CRM não confere.';
-- O plano de hoje (Multiportais 10 Padrão, até 22/01/2027).
update public.canal_pro set limite_anuncios = 10, limite_destaques = 2
 where um and limite_anuncios is null and limite_destaques is null;

-- O relatório escreve o destaque do anúncio manual por extenso. "Destaque
-- padrão" é o PREMIUM (destaque); "Padrão" sozinho é sem destaque.
create or replace function app.canal_pro_destaque_do_relatorio(p_texto text)
returns boolean
language sql
stable
set search_path = ''
as $$
  select case
           when t is null then false
           when t ~ '(sem destaque|nao destacado|standard|simples)' then false
           else t ~ '(destaque|premium|premiere|super|triplo|exclusivo|superior)'
         end
    from (select nullif(lower(extensions.unaccent(btrim(coalesce(p_texto, '')))), '') as t) x
$$;
comment on function app.canal_pro_destaque_do_relatorio(text) is
  'O destaque de um anúncio manual, como o relatório do Canal Pro escreve, gasta vaga de destaque do plano?';
revoke all on function app.canal_pro_destaque_do_relatorio(text) from public, anon, authenticated;

-- O que ocupa o plano agora, sem contar `p_fora` (o anúncio que vai mudar).
create or replace function app.canal_pro_ocupadas(p_fora uuid default null)
returns table (anuncios int, destaques int)
language sql
stable
set search_path = ''
as $$
  select
    ((select count(*) from public.anuncios a
       where a.situacao = 'no_ar' and a.excluido_em is null and a.id is distinct from p_fora)
     + (select count(*) from public.anuncios_no_canal_pro m
         where m.no_relatorio and m.excluido_em is null))::int,
    ((select count(*) from public.anuncios a
       where a.situacao = 'no_ar' and a.excluido_em is null and a.destaque <> 'padrao'
         and a.id is distinct from p_fora)
     + (select count(*) from public.anuncios_no_canal_pro m
         where m.no_relatorio and m.excluido_em is null
           and app.canal_pro_destaque_do_relatorio(m.destaque)))::int
$$;
comment on function app.canal_pro_ocupadas(uuid) is
  'Vagas e destaques do plano do Canal Pro em uso: anúncios do CRM no ar + os manuais na lista. p_fora fica de fora da conta.';
revoke all on function app.canal_pro_ocupadas(uuid) from public, anon, authenticated;

create or replace function public.anuncio_publicar(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  a      public.anuncios;
  c      public.canal_pro;
  o      record;
  v_pend text[];
begin
  if not app.admin_ou_gestor() then
    return jsonb_build_object('ok', false, 'motivo', 'sem_permissao');
  end if;
  select * into a from public.anuncios where id = p_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'motivo', 'nao_encontrado');
  end if;
  if a.excluido_em is not null then
    return jsonb_build_object('ok', false, 'motivo', 'excluido');
  end if;
  v_pend := app.anuncio_pendencias(p_id);
  if cardinality(v_pend) > 0 then
    return jsonb_build_object('ok', false, 'motivo', 'pendencias', 'pendencias', to_jsonb(v_pend));
  end if;
  if a.situacao = 'no_ar' then
    return jsonb_build_object('ok', true, 'ja_estava', true);
  end if;

  -- Uma publicação de cada vez: duas pessoas não pegam a última vaga juntas.
  select * into c from public.canal_pro where um for update;
  select * into o from app.canal_pro_ocupadas(p_id);
  if c.limite_anuncios is not null and o.anuncios >= c.limite_anuncios then
    return jsonb_build_object('ok', false, 'motivo', 'plano_cheio',
                              'limite', c.limite_anuncios, 'em_uso', o.anuncios);
  end if;
  if a.destaque <> 'padrao' and c.limite_destaques is not null and o.destaques >= c.limite_destaques then
    return jsonb_build_object('ok', false, 'motivo', 'plano_sem_destaque',
                              'limite', c.limite_destaques, 'em_uso', o.destaques);
  end if;

  update public.anuncios
     set situacao = 'no_ar', publicado_em = now(), publicado_por = auth.uid(),
         atualizado_por = auth.uid(), updated_at = now()
   where id = p_id;
  return jsonb_build_object('ok', true);
end $$;
comment on function public.anuncio_publicar(uuid) is
  'Põe o anúncio no arquivo do Canal Pro (admin e gestor). Recusa com a lista do que falta, ou quando o plano não tem vaga (plano_cheio) ou destaque (plano_sem_destaque). O portal mostra depois da próxima leitura do Grupo OLX.';

create or replace function public.anuncio_destaque(p_id uuid, p_destaque text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  a public.anuncios;
  c public.canal_pro;
  o record;
begin
  if not app.admin_ou_gestor() then
    return jsonb_build_object('ok', false, 'motivo', 'sem_permissao');
  end if;
  if p_destaque is null or p_destaque not in ('padrao', 'destaque', 'super_destaque', 'exclusivo', 'superior') then
    return jsonb_build_object('ok', false, 'motivo', 'destaque_invalido');
  end if;
  select * into a from public.anuncios where id = p_id and excluido_em is null for update;
  if not found then
    return jsonb_build_object('ok', false, 'motivo', 'nao_encontrado');
  end if;
  if a.destaque = p_destaque then
    return jsonb_build_object('ok', true);
  end if;

  -- No ar, o destaque gasta a cota na hora; no rascunho, é conferido ao ir ao ar.
  if a.situacao = 'no_ar' and p_destaque <> 'padrao' then
    select * into c from public.canal_pro where um for update;
    select * into o from app.canal_pro_ocupadas(p_id);
    if c.limite_destaques is not null and o.destaques >= c.limite_destaques then
      return jsonb_build_object('ok', false, 'motivo', 'plano_sem_destaque',
                                'limite', c.limite_destaques, 'em_uso', o.destaques);
    end if;
  end if;

  update public.anuncios
     set destaque = p_destaque, atualizado_por = auth.uid(), updated_at = now()
   where id = p_id;
  return jsonb_build_object('ok', true);
end $$;
comment on function public.anuncio_destaque(uuid, text) is
  'Escolhe o destaque (PublicationType) do anúncio. Admin e gestor. No ar, recusa quando os destaques do plano do Canal Pro estão em uso (plano_sem_destaque).';

create or replace function public.canal_pro_situacao()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  c public.canal_pro;
  l public.canal_pro_leituras;
  o record;
begin
  if not app.is_manager() then
    return jsonb_build_object('ok', false, 'motivo', 'sem_permissao');
  end if;
  select * into c from public.canal_pro limit 1;
  select * into l from public.canal_pro_leituras where do_grupo_olx order by em desc limit 1;
  select * into o from app.canal_pro_ocupadas();
  return jsonb_build_object(
    'ok', true,
    -- A chave é credencial: só para quem cola a URL no Canal Pro.
    'chave', case when app.admin_ou_gestor() then c.chave end,
    'nome', c.nome, 'email', c.email, 'telefone', c.telefone, 'site', c.site,
    'ultima_leitura', case when l.id is null then null
                           else jsonb_build_object('em', l.em, 'anuncios', l.anuncios) end,
    'leituras_7_dias', (select count(*) from public.canal_pro_leituras x
                         where x.do_grupo_olx and x.em > now() - interval '7 days'),
    'importado_em', c.importado_em,
    'importados', c.importados,
    'plano', jsonb_build_object(
      'anuncios', c.limite_anuncios, 'destaques', c.limite_destaques,
      'anuncios_em_uso', o.anuncios, 'destaques_em_uso', o.destaques));
end $$;
comment on function public.canal_pro_situacao() is
  'O painel do Canal Pro: contato da imobiliária, a última leitura do Grupo OLX, o plano (limite e uso) e, para admin e gestor, a chave da URL do arquivo.';

create or replace function public.canal_pro_ajustar_plano(p_anuncios int, p_destaques int)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not app.admin_ou_gestor() then
    return jsonb_build_object('ok', false, 'motivo', 'sem_permissao');
  end if;
  if p_anuncios not between 0 and 10000 or p_destaques not between 0 and 10000
     or p_destaques > p_anuncios then
    return jsonb_build_object('ok', false, 'motivo', 'plano_invalido');
  end if;
  update public.canal_pro
     set limite_anuncios = p_anuncios, limite_destaques = p_destaques,
         atualizado_em = now(), atualizado_por = auth.uid()
   -- A linha é uma só, mas o `safeupdate` das chamadas pela API recusa UPDATE sem WHERE.
   where um;
  insert into public.audit_log (actor_id, actor_role, action, table_name, row_id, old_data, new_data)
  values (auth.uid(), app.role()::text, 'UPDATE', 'canal_pro', 'plano', null,
          jsonb_build_object('limite_anuncios', p_anuncios, 'limite_destaques', p_destaques));
  return jsonb_build_object('ok', true);
end $$;
comment on function public.canal_pro_ajustar_plano(int, int) is
  'Grava quantos anúncios e destaques o plano do Canal Pro tem (vazio: o CRM não confere). Admin e gestor.';
revoke all on function public.canal_pro_ajustar_plano(int, int) from public, anon;
grant execute on function public.canal_pro_ajustar_plano(int, int) to authenticated;

  $ddl$;
end $limite$;
