-- =====================================================================
-- A porta dos leads — só na Imova (12/11/2026)
--
-- Nenhum lead do Grupo OLX (ZAP, Viva Real, OLX) chegou ao CRM. A Edge Function
-- `grupozap-lead` está no ar, com a chave certa, e os registros mostram que,
-- desde a homologação (10/11, 15:15), o Grupo OLX nunca fez um POST nela. A
-- homologação só cadastra o CRM no Grupo OLX: cada anunciante aponta a entrega
-- no Canal Pro, num campo SEPARADO da integração de anúncios (Integrações →
-- aba Leads → "Receber leads no CRM"). E a única prova de que o Grupo OLX bateu
-- na porta era o log do Supabase, que ninguém da Imova vê. Esta migração:
--
--   1. ANOTA CADA CHAMADA, sem dado pessoal (`public.grupozap_lead_chamadas`):
--      uma linha por dia (de Natal), resultado e "veio com o user-agent do
--      Grupo OLX" (`grupozap-notification-api`), com quantas chamadas, a
--      primeira e a última e o último status HTTP. Os resultados: `recebido`
--      (lead novo gravado), `repetido` (o mesmo lead de novo), `teste` (chave
--      de teste ou o lead de exemplo da documentação, que não gravam),
--      `recusado_credencial` (401) e `erro` (todo o resto: 400, 405, 413, 500,
--      503). Nada de nome, telefone, e-mail, mensagem, corpo, nem o user-agent
--      inteiro: só se ele é o do Grupo OLX.
--   2. O TAMANHO É LIMITADO. A chave da linha é (dia, resultado, do_grupo_olx):
--      um sondador que manda mil 401 soma mil numa linha só (upsert). No máximo
--      10 linhas por dia (5 resultados × 2), e a própria anotação apaga o que
--      passou de 365 dias: o teto é de umas 3.660 linhas, para sempre.
--   3. QUEM GRAVA: só a Edge Function, com a service_role, pela RPC
--      `public.grupozap_lead_anotar_chamada` (definer), como já faz com
--      `grupozap_lead_receber`. A gravação é de melhor esforço: a função anota
--      depois de responder (`EdgeRuntime.waitUntil`), e uma falha aqui não
--      muda nem atrasa a resposta ao Grupo OLX. RLS ligada, sem política e sem
--      grade: ninguém de fora lê a tabela direto.
--   4. O CAMINHO GANHA A ENTREGA DE LEADS. `public.anuncios_caminho_do_lead`
--      (create or replace; tudo o que já devolvia continua igual, inclusive o
--      `sem_permissao` para o SDR) devolve também `entrega`:
--        * `ultima_chamada_real`: a última chamada autenticada que não foi teste
--          (`recebido` ou `repetido`), com o horário e se veio com o user-agent
--          do Grupo OLX;
--        * `ultimo_lead_do_webhook`: quando chegou o último lead gravado pelo
--          webhook. SÓ o webhook: o lead que chega pelo WhatsApp com o texto do
--          portal (chave `whatsapp:…`) não prova que o Canal Pro entrega os
--          leads ao CRM;
--        * `ultimo_teste`: a última chamada de teste (o validador do Grupo OLX);
--        * `recusas_7_dias` e `erros_7_dias`: quantas e a última, separando as
--          que vieram com o user-agent do Grupo OLX das outras. "7 dias" é hoje
--          e os 6 dias antes, no calendário de Natal (a anotação é por dia).
--      Quem decide o passo "Os leads vêm para o CRM" é a tela
--      (`passos-do-caminho.ts`).
--
-- Na KOMUNE não cria nada: Anúncios e leads dos portais são só da Imova. Num
-- banco sem identidade (o do CI), cria tudo, como as outras de Anúncios.
--
-- ===========================================================================
-- O WHATSAPP NÃO É TOCADO
-- ===========================================================================
-- Nada aqui grava em `messages` ou `conversations`, nem cria gatilho. O caminho
-- só lê; a anotação só escreve na tabela nova.
--
-- COMO DESFAZER (no banco da Imova): reaplicar `public.anuncios_caminho_do_lead`
-- como está na 20261111203000;
--   drop function if exists public.grupozap_lead_anotar_chamada(text, int, boolean);
--   drop table if exists public.grupozap_lead_chamadas;
-- A função `grupozap-lead` que anota continua respondendo igual sem a tabela:
-- a anotação falha calada (fica um aviso no log) e a resposta não muda.
-- =====================================================================

do $porta$
begin
  if (select i.empresa from app.identidade i) = 'komune' then
    raise notice 'Os leads dos portais são só da Imova: no banco da KOMUNE nada foi criado.';
    return;
  end if;

  execute $ddl$
-- =====================================================================
-- 1. As chamadas à função `grupozap-lead`, por dia e resultado
-- =====================================================================
create table if not exists public.grupozap_lead_chamadas (
  -- O dia em Natal (America/Fortaleza).
  dia            date not null,
  resultado      text not null
                   check (resultado in ('recebido', 'repetido', 'teste', 'recusado_credencial', 'erro')),
  -- Veio com o user-agent do Grupo OLX (`grupozap-notification-api`)? Qualquer
  -- um pode se apresentar assim; serve para separar o Grupo OLX de quem sonda.
  do_grupo_olx   boolean not null,
  chamadas       int not null default 1 check (chamadas > 0),
  primeira_em    timestamptz not null default now(),
  ultima_em      timestamptz not null default now(),
  -- O status HTTP da última chamada da linha (no `erro`, diz qual foi).
  ultimo_status  smallint not null check (ultimo_status between 100 and 599),
  primary key (dia, resultado, do_grupo_olx)
);
alter table public.grupozap_lead_chamadas enable row level security;
-- Sem política e sem grade: só as duas funções definer abaixo leem e escrevem.
revoke all on public.grupozap_lead_chamadas from public, anon, authenticated, service_role;
comment on table public.grupozap_lead_chamadas is
  'As chamadas à Edge Function grupozap-lead (12/11/2026), só na Imova: uma linha por dia de Natal, resultado (recebido, repetido, teste, recusado_credencial, erro) e user-agent do Grupo OLX ou não, com contador, primeira e última vez e o último status. Sem dado pessoal. Escrita só por public.grupozap_lead_anotar_chamada; leitura só por public.anuncios_caminho_do_lead. Guarda 365 dias.';

-- =====================================================================
-- 2. Anotar: o que a Edge Function chama, depois de responder
-- =====================================================================
create or replace function public.grupozap_lead_anotar_chamada(
  p_resultado text, p_status int, p_do_grupo_olx boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $f$
declare
  v_dia date := (now() at time zone 'America/Fortaleza')::date;
begin
  if p_resultado is null
     or p_resultado not in ('recebido', 'repetido', 'teste', 'recusado_credencial', 'erro') then
    return jsonb_build_object('ok', false, 'motivo', 'resultado_invalido');
  end if;
  if p_status is null or p_status not between 100 and 599 then
    return jsonb_build_object('ok', false, 'motivo', 'status_invalido');
  end if;

  -- Uma linha por dia, resultado e user-agent: mil chamadas somam mil numa só.
  -- O contador para no teto do int em vez de estourar.
  insert into public.grupozap_lead_chamadas as t (dia, resultado, do_grupo_olx, ultimo_status)
  values (v_dia, p_resultado, coalesce(p_do_grupo_olx, false), p_status)
  on conflict (dia, resultado, do_grupo_olx) do update
     set chamadas      = least(t.chamadas, 2147483646) + 1,
         ultima_em     = greatest(t.ultima_em, excluded.ultima_em),
         ultimo_status = excluded.ultimo_status;

  -- O que passou de 365 dias sai (com WHERE: o safeupdate da API recusa sem).
  delete from public.grupozap_lead_chamadas x where x.dia < v_dia - 365;

  return jsonb_build_object('ok', true);
end $f$;
comment on function public.grupozap_lead_anotar_chamada(text, int, boolean) is
  'Anota uma chamada à Edge Function grupozap-lead (12/11/2026): +1 na linha do dia de Natal, do resultado e do user-agent (Grupo OLX ou não), com o último status. Sem dado pessoal. Só a service_role (a Edge Function, depois de responder). Apaga o que passou de 365 dias.';
revoke all on function public.grupozap_lead_anotar_chamada(text, int, boolean)
  from public, anon, authenticated;
grant execute on function public.grupozap_lead_anotar_chamada(text, int, boolean) to service_role;

-- =====================================================================
-- 3. O caminho até o primeiro lead, agora com a entrega de leads
-- =====================================================================
-- Igual à 20261111203000 nas partes a até c; a parte d passa a contar pela
-- lista de leads (a mesma regra do par e sem os escondidos), e a parte e é
-- nova. Esta função só
-- lê (o pgTAP 153 confere o texto): nenhum comentário aqui dentro usa as
-- palavras de escrita do SQL.
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
  v_leads    bigint;
  v_entrega  jsonb;
  v_hoje     date := (now() at time zone 'America/Fortaleza')::date;
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

  -- d. O último lead que chegou, de qualquer tipo, e quantos são. Contados pela
  --    própria lista de leads (`portal_leads_na_lista`, 20261113130000): sem o
  --    lead do WhatsApp que saiu da lista e com o par (WhatsApp e clique do
  --    Grupo OLX da mesma pessoa) uma vez só. Assim o "Ver o lead" abre um lead
  --    que a lista mostra. Quem chama é admin ou gestor, que a lista mostra tudo.
  select jsonb_build_object('id', v.id, 'em', v.recebido_em, 'tipos', to_jsonb(v.tipos),
                            'anuncio', coalesce(v.anuncio_codigo, v.client_listing_id)),
         count(*) over ()
    into v_lead, v_leads
    from public.portal_leads_na_lista v
   order by v.recebido_em desc
   limit 1;

  -- e. A entrega de leads (12/11/2026): o Grupo OLX bate na porta do CRM? O que
  --    a função `grupozap-lead` anotou em `grupozap_lead_chamadas` e o último
  --    lead que o webhook gravou. Só o webhook: o lead que chega pelo WhatsApp
  --    com o texto do portal (chave `whatsapp:…`) não prova que o Canal Pro
  --    entrega os leads ao CRM. "7 dias" é hoje e os 6 dias antes, em Natal.
  with sete as (
    select x.resultado, x.do_grupo_olx, sum(x.chamadas)::int as quantas, max(x.ultima_em) as ultima_em
      from public.grupozap_lead_chamadas x
     where x.dia > v_hoje - 7 and x.resultado in ('recusado_credencial', 'erro')
     group by x.resultado, x.do_grupo_olx
  )
  select jsonb_build_object(
           'ultima_chamada_real',
             (select jsonb_build_object('em', x.ultima_em, 'resultado', x.resultado,
                                        'do_grupo_olx', x.do_grupo_olx)
                from public.grupozap_lead_chamadas x
               where x.resultado in ('recebido', 'repetido')
               order by x.ultima_em desc
               limit 1),
           'ultimo_lead_do_webhook',
             (select max(l.recebido_em) from public.portal_leads l
               where l.origem = 'grupo_olx' and l.origin_lead_id not like 'whatsapp:%'),
           'ultimo_teste', (select max(x.ultima_em) from public.grupozap_lead_chamadas x
                             where x.resultado = 'teste'),
           'recusas_7_dias', jsonb_build_object(
             'do_grupo_olx', (select jsonb_build_object('quantas', coalesce(sum(s.quantas), 0),
                                                        'ultima_em', max(s.ultima_em))
                                from sete s
                               where s.resultado = 'recusado_credencial' and s.do_grupo_olx),
             'outras', (select jsonb_build_object('quantas', coalesce(sum(s.quantas), 0),
                                                  'ultima_em', max(s.ultima_em))
                          from sete s
                         where s.resultado = 'recusado_credencial' and not s.do_grupo_olx)),
           'erros_7_dias', jsonb_build_object(
             'do_grupo_olx', (select jsonb_build_object('quantas', coalesce(sum(s.quantas), 0),
                                                        'ultima_em', max(s.ultima_em))
                                from sete s
                               where s.resultado = 'erro' and s.do_grupo_olx),
             'outros', (select jsonb_build_object('quantas', coalesce(sum(s.quantas), 0),
                                                  'ultima_em', max(s.ultima_em))
                          from sete s
                         where s.resultado = 'erro' and not s.do_grupo_olx)))
    into v_entrega;

  return jsonb_build_object(
    'ok', true,
    'agora', now(),
    'entrega', v_entrega,
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
      'total', coalesce(v_leads, 0)));
end $f$;
comment on function public.anuncios_caminho_do_lead() is
  'O caminho até o primeiro lead dos portais, numa chamada (11/11/2026): a entrega de leads (12/11/2026: a última chamada real do Grupo OLX à função grupozap-lead, o último lead do webhook, as recusas e os erros dos últimos 7 dias), a última leitura do robô do Grupo OLX (e a de outro programa), o plano, os anúncios no ar, fora do arquivo, prontos e com pendência, os repetidos ativos do último relatório e o último lead. Só admin e gestor; os outros recebem sem_permissao.';
revoke all on function public.anuncios_caminho_do_lead() from public, anon;
grant execute on function public.anuncios_caminho_do_lead() to authenticated;
  $ddl$;
end $porta$;
