-- =====================================================================
-- Todas as fotos do Canal Pro — só na Imova (18/11/2026; escrita em 09/11/2026)
--
-- O usuário: "Lá no Canal Pro todos os anúncios possuem fotos, inclusive os não
-- publicados; dentro do CRM deve ser a mesma coisa." O relatório do Canal Pro
-- não traz as fotos (só quantas são), e o Grupo OLX não dá outro caminho; as
-- fotos vêm pela página do anúncio no Canal Pro, aberta no navegador de quem tem
-- o login. Desde 18/11/2026 é o favorito "Imova: sincronizar", que pede ao
-- Canal Pro a lista de todos os anúncios com todas as fotos de uma vez
-- (`sincronizar-canal-pro.ts`); elas entram pela mesma rota que traz as do
-- sistema atual. Esta migração foi escrita em 09/11 na branch fotos-do-canal-pro
-- e não subiu; volta aqui com data nova. Duas mudanças no banco:
--
--   1. O TETO DE FOTOS sobe de 40 para 60. O 40 era escolha do CRM, não regra do
--      Grupo OLX: o Edifício Simone tem 47 no Canal Pro.
--   2. TROCAR AS FOTOS de um anúncio pelas que acabaram de chegar
--      (`anuncio_fotos_trocar`): a rota sobe as novas (que entram no fim da fila)
--      e depois pede ao banco, numa transação só, para tirar as outras e pôr as
--      novas na ordem em que vieram. Serve para o anúncio que chegou com foto a
--      menos (o SA0012 veio com 7 de 8) e para trocar as do CRM pelas do Canal
--      Pro. Como as novas entram antes de as antigas saírem, o anúncio no ar
--      nunca fica sem foto.
--
-- Na KOMUNE não cria nada.
--
-- COMO DESFAZER: reaplicar `anuncio_foto_adicionar` da 20261104150000; depois
--   drop function public.anuncio_fotos_trocar(uuid, uuid[]);
-- =====================================================================

do $fotos$
begin
  if (select i.empresa from app.identidade i) = 'komune' then
    raise notice 'Os anúncios são só da Imova: no banco da KOMUNE nada foi criado.';
    return;
  end if;

  execute $ddl$
-- =====================================================================
-- 1. Até 60 fotos por anúncio
-- =====================================================================
create or replace function public.anuncio_foto_adicionar(p_anuncio uuid, p_caminho text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $f$
declare
  a     public.anuncios;
  v_id  uuid;
begin
  select * into a from public.anuncios where id = p_anuncio for update;
  if not found then
    return jsonb_build_object('ok', false, 'motivo', 'nao_encontrado');
  end if;
  if not app.anuncio_editavel(a) then
    return jsonb_build_object('ok', false, 'motivo', 'so_gestao_mexe_no_ar');
  end if;
  if p_caminho !~ ('^' || p_anuncio::text || '/[0-9a-f-]{36}\.jpg$') then
    return jsonb_build_object('ok', false, 'motivo', 'caminho_invalido');
  end if;
  if not exists (select 1 from storage.objects o where o.bucket_id = 'anuncios' and o.name = p_caminho) then
    return jsonb_build_object('ok', false, 'motivo', 'arquivo_nao_chegou');
  end if;
  if (select count(*) from public.anuncio_fotos f where f.anuncio_id = p_anuncio) >= 60 then
    return jsonb_build_object('ok', false, 'motivo', 'fotos_demais');
  end if;
  insert into public.anuncio_fotos (anuncio_id, caminho, posicao, criada_por)
  values (p_anuncio, p_caminho,
          coalesce((select max(f.posicao) + 1 from public.anuncio_fotos f where f.anuncio_id = p_anuncio), 0),
          auth.uid())
  on conflict (caminho) do nothing
  returning id into v_id;
  update public.anuncios set updated_at = now(), atualizado_por = auth.uid() where id = p_anuncio;
  return jsonb_build_object('ok', true, 'id', v_id);
end $f$;
comment on function public.anuncio_foto_adicionar(uuid, text) is
  'Registra a foto que já subiu para o balde anuncios, no fim da fila. Mesma regra de quem edita o anúncio; até 60 fotos (era 40 até 18/11/2026).';

-- =====================================================================
-- 2. Trocar as fotos pelas que acabaram de chegar
-- =====================================================================
create or replace function public.anuncio_fotos_trocar(p_anuncio uuid, p_novas uuid[])
returns jsonb
language plpgsql
security definer
set search_path = ''
as $f$
declare
  a           public.anuncios;
  v_novas     uuid[];
  v_removidas text[];
begin
  select * into a from public.anuncios where id = p_anuncio for update;
  if not found then
    return jsonb_build_object('ok', false, 'motivo', 'nao_encontrado');
  end if;
  if not app.anuncio_editavel(a) then
    return jsonb_build_object('ok', false, 'motivo', 'so_gestao_mexe_no_ar');
  end if;
  -- Sem repetidas e na ordem em que vieram.
  select array_agg(x.id order by x.primeira)
    into v_novas
    from (select u.id, min(u.ordem) as primeira
            from unnest(p_novas) with ordinality as u(id, ordem)
           where u.id is not null
           group by u.id) x;
  if coalesce(cardinality(v_novas), 0) = 0 then
    -- Trocar por nada apagaria todas: o anúncio no ar ficaria sem foto.
    return jsonb_build_object('ok', false, 'motivo', 'sem_fotos_novas');
  end if;
  if exists (select 1 from unnest(v_novas) n(id)
              where not exists (select 1 from public.anuncio_fotos f
                                 where f.id = n.id and f.anuncio_id = p_anuncio)) then
    return jsonb_build_object('ok', false, 'motivo', 'foto_de_outro_anuncio');
  end if;

  with sairam as (
    delete from public.anuncio_fotos f
     where f.anuncio_id = p_anuncio and f.id <> all (v_novas)
    returning f.caminho
  )
  select coalesce(array_agg(s.caminho), '{}') into v_removidas from sairam s;

  update public.anuncio_fotos f
     set posicao = n.ordem - 1
    from unnest(v_novas) with ordinality as n(id, ordem)
   where f.id = n.id;

  update public.anuncios set updated_at = now(), atualizado_por = auth.uid() where id = p_anuncio;
  return jsonb_build_object('ok', true, 'fotos', cardinality(v_novas), 'removidas', to_jsonb(v_removidas));
end $f$;
comment on function public.anuncio_fotos_trocar(uuid, uuid[]) is
  'Deixa no anúncio só as fotos de p_novas (que já subiram e foram registradas), na ordem do vetor, e devolve os caminhos das que saíram para a rota apagar do balde. Mesma regra de quem edita o anúncio; recusa vetor vazio e foto de outro anúncio.';
revoke all on function public.anuncio_fotos_trocar(uuid, uuid[]) from public, anon;
grant execute on function public.anuncio_fotos_trocar(uuid, uuid[]) to authenticated;
  $ddl$;
end $fotos$;
