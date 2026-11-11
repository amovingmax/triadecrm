-- =====================================================================
-- O caminho até o primeiro lead dos portais — só na Imova (11/11/2026)
--
-- Gargalo "Entra pouco lead": a produção da Imova tem 0 leads dos portais. O
-- Canal Pro ainda lê o arquivo da Arbo (o sistema anterior), e não o do CRM; os 7
-- anúncios do CRM estão em rascunho; 2 das 10 vagas do plano estão com anúncios
-- repetidos; e ninguém fez um lead de teste. Colar a URL no Canal Pro, excluir os
-- repetidos lá e fazer o lead de teste são passos do usuário. Esta migração faz o
-- CRM mostrar o que falta e tira uma trava de código do caminho:
--
--   1. O PLANO CHEIO QUE NÃO ERA. `app.canal_pro_ocupadas(p_fora)` contava, do
--      lado do relatório do Canal Pro, a linha do próprio anúncio que o CRM vai
--      assumir. Com o plano cheio pelo sistema anterior (10 de 10), "Pôr no ar"
--      recusava com `plano_cheio` um anúncio que só ocuparia a própria vaga: no
--      portal ele é o MESMO anúncio (mesmo código), e a vaga já é dele. Agora a
--      linha cujo `codigo` ou `anuncio_id` é o de `p_fora` também fica de fora
--      da conta (vale para a vaga e para o destaque). O resto é como na
--      20261105150000.
--   2. O CAMINHO, NUMA CHAMADA. `public.anuncios_caminho_do_lead()` junta o que
--      a lista de passos do alto de Anúncios lê (só admin e gestor; o SDR e quem
--      não é da equipe recebem `sem_permissao`):
--        * arquivo: a última leitura do robô do Grupo OLX (`canal_pro_leituras`
--          com `do_grupo_olx`, que a 20261104150000 marca pelo user-agent
--          "VivaRealBot") e a última leitura de outro programa, para quando o
--          robô se apresentar com outro nome;
--        * plano: o limite e o uso, com a mesma conta que recusa a publicação;
--        * anúncios: quantos estão no ar no CRM e no arquivo; os NO AR COM
--          PENDÊNCIA (o arquivo os pula calado e o portal os tira na leitura
--          seguinte); os rascunhos prontos, com `ocupa_vaga` quando o relatório
--          já os conta (estão no portal pelo sistema anterior, com o mesmo
--          código); e os rascunhos com o que falta;
--        * relatório: quando foi importado e os repetidos (`canal_pro_parece_com`)
--          ativos, que ocupam vaga, com o código de que são cópia;
--        * leads: o último que chegou e quantos já chegaram.
--      Quem decide se cada passo está feito é a tela (`passos-do-caminho.ts`).
--
-- Na KOMUNE não cria nada: Anúncios é módulo só da Imova.
--
-- ===========================================================================
-- O WHATSAPP NÃO É TOCADO
-- ===========================================================================
-- Nada aqui grava em `messages` ou `conversations`, nem cria gatilho. A função
-- nova só lê.
--
-- COMO DESFAZER (no banco da Imova): reaplicar `app.canal_pro_ocupadas` como
-- está na 20261105150000; drop function public.anuncios_caminho_do_lead().
-- =====================================================================

do $caminho$
begin
  if (select i.empresa from app.identidade i) = 'komune' then
    raise notice 'Os anúncios são só da Imova: no banco da KOMUNE nada foi criado.';
    return;
  end if;

  execute $ddl$
-- =====================================================================
-- 1. As vagas do plano sem a linha do próprio anúncio
-- =====================================================================
-- Os do CRM no ar e os ATIVOS do relatório que não têm par no ar no CRM, sem
-- contar `p_fora` (o anúncio que vai mudar) nem a linha do relatório que é ele
-- (11/11/2026).
create or replace function app.canal_pro_ocupadas(p_fora uuid default null)
returns table (anuncios int, destaques int)
language sql
stable
set search_path = ''
as $f$
  with fora as (
    select a.id, a.codigo from public.anuncios a where a.id = p_fora
  ),
  manuais as (
    select m.destaque
      from public.anuncios_no_canal_pro m
     where m.no_relatorio and m.excluido_em is null
       and app.canal_pro_ativo_no_relatorio(m.situacao)
       and not exists (select 1 from public.anuncios a
                        where a.situacao = 'no_ar' and a.excluido_em is null
                          and (a.codigo = m.codigo or a.id = m.anuncio_id))
       -- A linha do anúncio que vai mudar é a vaga dele mesmo: no portal é o mesmo
       -- anúncio (mesmo código, ou trazido dela). Contá-la recusava com plano
       -- cheio quem só ocuparia a própria vaga (11/11/2026).
       and not exists (select 1 from fora f
                        where f.codigo = m.codigo or f.id = m.anuncio_id)
  )
  select
    ((select count(*) from public.anuncios a
       where a.situacao = 'no_ar' and a.excluido_em is null and a.id is distinct from p_fora)
     + (select count(*) from manuais))::int,
    ((select count(*) from public.anuncios a
       where a.situacao = 'no_ar' and a.excluido_em is null and a.destaque <> 'padrao'
         and a.id is distinct from p_fora)
     + (select count(*) from manuais m where app.canal_pro_destaque_do_relatorio(m.destaque)))::int
$f$;
comment on function app.canal_pro_ocupadas(uuid) is
  'Vagas e destaques do plano do Canal Pro em uso: anúncios do CRM no ar + os ativos do último relatório sem par no ar no CRM. p_fora (o anúncio que vai mudar) e a linha do relatório que é ele (mesmo código ou trazido dela) ficam de fora da conta (11/11/2026).';
revoke all on function app.canal_pro_ocupadas(uuid) from public, anon, authenticated;

-- =====================================================================
-- 2. O caminho até o primeiro lead, numa chamada
-- =====================================================================
create or replace function public.anuncios_caminho_do_lead()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $f$
declare
  c          public.canal_pro;
  o          record;
  v_robo     jsonb;
  v_outra    jsonb;
  v_anuncios jsonb;
  v_rel      jsonb;
  v_lead     jsonb;
begin
  -- A URL com a chave, o plano e os repetidos são da gestão: o SDR não vê o caminho.
  if not app.admin_ou_gestor() then
    return jsonb_build_object('ok', false, 'motivo', 'sem_permissao');
  end if;

  select * into c from public.canal_pro limit 1;
  select * into o from app.canal_pro_ocupadas();

  -- a. O Grupo OLX lê o arquivo do CRM? O robô se apresenta como "VivaRealBot"
  --    (`canal_pro_feed` marca `do_grupo_olx` pelo user-agent). A última leitura
  --    de outro programa vai junto: se o robô vier com outro nome, é ali que aparece.
  select jsonb_build_object('em', l.em, 'anuncios', l.anuncios) into v_robo
    from public.canal_pro_leituras l
   where l.do_grupo_olx
   order by l.em desc
   limit 1;
  select jsonb_build_object('em', l.em,
                            'quem', left(coalesce(nullif(btrim(l.user_agent), ''), 'sem nome'), 80))
    into v_outra
    from public.canal_pro_leituras l
   where not l.do_grupo_olx
   order by l.em desc
   limit 1;

  -- b. Os anúncios do CRM, com as pendências calculadas uma vez. O arquivo leva
  --    só o que está no ar e sem pendência (`canal_pro_feed`): no ar com
  --    pendência é pulado calado. `ocupa_vaga`: o último relatório tem a linha
  --    dele ativa (mesmo código, ou trazido dela), e a vaga já é dele.
  with a as (
    select x.id, x.codigo, x.titulo, x.situacao,
           coalesce(app.anuncio_pendencias(x.id), '{}'::text[]) as pend,
           exists (select 1 from public.anuncios_no_canal_pro m
                    where (m.codigo = x.codigo or m.anuncio_id = x.id)
                      and m.no_relatorio and m.excluido_em is null
                      and app.canal_pro_ativo_no_relatorio(m.situacao)) as ocupa_vaga
      from public.anuncios x
     where x.excluido_em is null
  )
  select jsonb_build_object(
           'no_ar', count(*) filter (where a.situacao = 'no_ar'),
           'no_arquivo', count(*) filter (where a.situacao = 'no_ar' and cardinality(a.pend) = 0),
           'fora_do_arquivo', coalesce(jsonb_agg(
               jsonb_build_object('id', a.id, 'codigo', a.codigo, 'titulo', a.titulo,
                                  'pendencias', to_jsonb(a.pend))
               order by a.codigo)
             filter (where a.situacao = 'no_ar' and cardinality(a.pend) > 0), '[]'::jsonb),
           'prontos', coalesce(jsonb_agg(
               jsonb_build_object('id', a.id, 'codigo', a.codigo, 'titulo', a.titulo,
                                  'ocupa_vaga', a.ocupa_vaga)
               order by a.ocupa_vaga desc, a.codigo)
             filter (where a.situacao = 'rascunho' and cardinality(a.pend) = 0), '[]'::jsonb),
           'com_pendencia', coalesce(jsonb_agg(
               jsonb_build_object('id', a.id, 'codigo', a.codigo, 'titulo', a.titulo,
                                  'pendencias', to_jsonb(a.pend))
               order by a.codigo)
             filter (where a.situacao = 'rascunho' and cardinality(a.pend) > 0), '[]'::jsonb))
    into v_anuncios
    from a;

  -- c. Os repetidos do último relatório: a linha que parece o mesmo imóvel de um
  --    anúncio do CRM, com outro código (a mesma conta da lista e da importação).
  --    Fica de fora a linha que já é um anúncio do CRM (mesmo código ou trazida).
  with r as (
    select m.id, m.codigo, m.titulo, m.situacao, m.marcado_excluido_em,
           app.canal_pro_ativo_no_relatorio(m.situacao) as ativo,
           (select a.codigo from public.anuncios a where a.id = public.canal_pro_parece_com(m)) as copia_de
      from public.anuncios_no_canal_pro m
     where m.no_relatorio and m.excluido_em is null
       and not exists (select 1 from public.anuncios a
                        where a.excluido_em is null
                          and (a.codigo = m.codigo or a.id = m.anuncio_id))
  )
  select jsonb_build_object(
           'importado_em', c.importado_em,
           'repetidos_ativos', coalesce(jsonb_agg(
               jsonb_build_object('id', r.id, 'codigo', r.codigo, 'titulo', r.titulo,
                                  'situacao', r.situacao, 'copia_de', r.copia_de,
                                  'marcado_excluido_em', r.marcado_excluido_em)
               order by r.codigo)
             filter (where r.ativo and r.copia_de is not null), '[]'::jsonb),
           'repetidos_inativos', count(*) filter (where not r.ativo and r.copia_de is not null))
    into v_rel
    from r;

  -- d. O último lead que chegou, de qualquer tipo: prova que o Grupo OLX manda
  --    os leads da Imova para o CRM.
  select jsonb_build_object('id', l.id, 'em', l.recebido_em, 'tipos', to_jsonb(l.tipos),
                            'anuncio', coalesce(a.codigo, m.codigo, l.client_listing_id))
    into v_lead
    from public.portal_leads l
    left join public.anuncios a on a.id = l.anuncio_id
    left join public.anuncios_no_canal_pro m on m.id = l.anuncio_no_canal_pro_id
   order by l.recebido_em desc
   limit 1;

  return jsonb_build_object(
    'ok', true,
    'agora', now(),
    'arquivo', jsonb_build_object(
      'leitura_do_robo', v_robo,
      'leituras_do_robo_7_dias', (select count(*) from public.canal_pro_leituras x
                                   where x.do_grupo_olx and x.em > now() - interval '7 days'),
      'outra_leitura', v_outra),
    'plano', jsonb_build_object(
      'anuncios', c.limite_anuncios, 'destaques', c.limite_destaques,
      'anuncios_em_uso', o.anuncios, 'destaques_em_uso', o.destaques),
    'anuncios', v_anuncios,
    'relatorio', v_rel,
    'leads', jsonb_build_object(
      'ultimo', v_lead,
      'total', (select count(*) from public.portal_leads)));
end $f$;
comment on function public.anuncios_caminho_do_lead() is
  'O caminho até o primeiro lead dos portais, numa chamada (11/11/2026): a última leitura do robô do Grupo OLX (e a de outro programa), o plano, os anúncios no ar, fora do arquivo, prontos e com pendência, os repetidos ativos do último relatório e o último lead. Só admin e gestor; os outros recebem sem_permissao.';
revoke all on function public.anuncios_caminho_do_lead() from public, anon;
grant execute on function public.anuncios_caminho_do_lead() to authenticated;
  $ddl$;
end $caminho$;
