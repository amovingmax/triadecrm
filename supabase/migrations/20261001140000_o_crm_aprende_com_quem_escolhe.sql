-- =====================================================================
-- O CRM aprende com quem escolhe na fila — com cinco freios
--
-- POR QUÊ (desenho de 25/09/2026, §2(d), item 9 da tabela de esforço;
-- plano em docs/superpowers/plans/2026-09-25-aprendizado-e-ia.md):
--
-- Quando alguém escolhe a categoria de um nome na fila, o CRM sabe três coisas:
-- a fonte, o texto que a fonte usou (`source_record.category_source`) e a
-- categoria escolhida. É uma linha de `public.source_category_map` pronta — e
-- hoje ela é jogada fora. Na importação seguinte, o mesmo rótulo do Google
-- volta a parar na fila.
--
-- A REGRA QUE DEFINE ONDE ISTO MORA: só se aprende onde uma PESSOA ESCOLHEU.
-- `app.promover_candidato` também é chamada por `public.importacao_gravar`,
-- onde a categoria veio do próprio mapa — ali não há nada que aprender, e
-- aprender seria reescrever a regra com ela mesma. Um gatilho de tabela não
-- sabe a diferença; por isso o ponto é dentro de
-- `public.radar_revisar_candidato`, no caminho `aprovar`, DEPOIS de
-- `app.promover_candidato` voltar ok.
--
-- E NADA ESCREVE DIRETO NO MAPA: propõe. Erro humano num clique não pode virar
-- regra permanente que cria ficha errada para sempre. Cinco freios:
--
--   1. NUNCA NO PRIMEIRO CLIQUE. Vira regra com `vezes >= 3`, ou `vezes >= 2`
--      vindo de DUAS PESSOAS DIFERENTES.
--   2. DISCORDÂNCIA CONGELA. Proposta concorrente viva para a mesma chave:
--      nada promove, e um humano desempata. É o "revisão humana quando empatar"
--      do RF-RAD-06.
--   3. VALE SÓ PARA FRENTE. A regra nova não reescreve ficha já criada — e não
--      reescreve porque ela simplesmente não toca em `organizations`.
--   4. UM DESFAZER. `public.source_category_esquecer` apaga a regra aprendida e
--      diz quantas fichas ela criou.
--   5. `audit_log` EM TODA PROMOÇÃO.
--
-- O ATALHO, que é o que resolve a fila de hoje:
-- `public.radar_aprender_agora` — "valer para os outros N que também vieram
-- como 'Buffet infantil'". Consentimento explícito vale mais que contagem,
-- então ele PULA o contador e escreve a regra na hora. Desmarcado por padrão na
-- tela.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. A proposta, que não é a regra
-- ---------------------------------------------------------------------
create table if not exists public.source_category_proposta (
  source_id       int  not null references public.sources (id) on delete cascade,
  category_source text not null,
  category_id     int  not null references public.categories (id) on delete cascade,
  vezes           int  not null default 0,
  -- Quem já escolheu assim. É array e não contador porque o freio 1 precisa
  -- distinguir "duas pessoas concordaram" de "a mesma pessoa clicou duas vezes".
  quem            uuid[] not null default '{}',
  primeira_em     timestamptz not null default now(),
  ultima_em       timestamptz not null default now(),
  virou_regra_em  timestamptz,
  primary key (source_id, category_source, category_id)
);
comment on table public.source_category_proposta is
  'Proposta de regra para o de-para de categoria da fonte (RF-RAD-06), acumulada a cada escolha humana na fila. Vira regra em public.source_category_map com 3 escolhas, ou 2 de pessoas diferentes; proposta concorrente viva congela as duas. Não escreve ficha nenhuma: vale só para frente.';

-- A chave da proposta é gravada normalizada, pelo mesmo motivo do CHECK do mapa
-- (20261001090000): um til não pode criar uma segunda proposta para a mesma
-- coisa, porque aí nenhuma das duas chega ao limiar.
alter table public.source_category_proposta
  drop constraint if exists source_category_proposta_chave_normalizada;
alter table public.source_category_proposta
  add constraint source_category_proposta_chave_normalizada
  check (category_source = app.chave_catalogo(category_source));

alter table public.source_category_proposta enable row level security;
drop policy if exists source_category_proposta_select on public.source_category_proposta;
drop policy if exists source_category_proposta_delete on public.source_category_proposta;
-- Leitura para quem escreve na base (é a tela de admin e o "valer para os
-- outros"); escrita só pelas funções `security definer` deste arquivo.
create policy source_category_proposta_select on public.source_category_proposta
  for select to authenticated using ((select app.can_write()));
create policy source_category_proposta_delete on public.source_category_proposta
  for delete to authenticated using ((select app.is_manager()));
grant select on public.source_category_proposta to authenticated;
grant delete on public.source_category_proposta to authenticated;


-- ---------------------------------------------------------------------
-- 2. O mapa ganha proveniência
-- ---------------------------------------------------------------------
-- Sem isto o desfazer do freio 4 não tem o que oferecer: apagar uma regra
-- SEMEADA (a que veio da migração e da seed) é outra coisa, e a tela precisa
-- saber qual é qual.
alter table public.source_category_map
  add column if not exists origem text not null default 'semeado',
  add column if not exists aprendido_por uuid references auth.users (id) on delete set null,
  add column if not exists aprendido_em  timestamptz;
alter table public.source_category_map
  drop constraint if exists source_category_map_origem_check;
alter table public.source_category_map
  add constraint source_category_map_origem_check
  check (origem in ('semeado', 'aprendido'));
comment on column public.source_category_map.origem is
  'semeado = veio da migração/seed; aprendido = uma pessoa escolheu na fila (ou na tela de resolver da importação) e a regra foi promovida. Só o aprendido pode ser esquecido pela tela.';


-- ---------------------------------------------------------------------
-- 3. A proposta acumula, e às vezes vira regra
-- ---------------------------------------------------------------------
create or replace function app.propor_categoria_da_fonte(
  p_source_id   int,
  p_texto       text,
  p_category_id int,
  p_quem        uuid,
  p_agora       boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_chave text := app.chave_catalogo(p_texto);
  v_p     public.source_category_proposta;
  v_briga int;
  v_virou boolean := false;
  v_antes int;
begin
  if v_chave is null or p_source_id is null or p_category_id is null or p_quem is null then
    return jsonb_build_object('ok', false, 'reason', 'dados_incompletos');
  end if;

  -- Já é regra, e é a MESMA: não há o que aprender. (Regra diferente é o caso
  -- de correção, e aí a proposta acumula normalmente até desempatar.)
  if exists (select 1 from public.source_category_map m
              where m.source_id = p_source_id and m.category_source = v_chave
                and m.category_id = p_category_id) then
    return jsonb_build_object('ok', true, 'ja_era_regra', true);
  end if;

  insert into public.source_category_proposta
    (source_id, category_source, category_id, vezes, quem)
  values (p_source_id, v_chave, p_category_id, 1, array[p_quem])
      on conflict (source_id, category_source, category_id) do update
      set vezes    = public.source_category_proposta.vezes + 1,
          quem     = (select coalesce(array_agg(distinct q), '{}')
                        from unnest(public.source_category_proposta.quem || p_quem) q),
          ultima_em = now()
  returning * into v_p;

  -- FREIO 2 — discordância congela. Outra proposta VIVA (ainda não promovida)
  -- para a mesma chave, apontando para outra categoria: ninguém promove, e um
  -- humano desempata na tela. É o "revisão humana quando empatar" do RF-RAD-06.
  select count(*) into v_briga
    from public.source_category_proposta p
   where p.source_id = p_source_id and p.category_source = v_chave
     and p.category_id <> p_category_id
     and p.virou_regra_em is null;

  if v_briga > 0 then
    return jsonb_build_object('ok', true, 'virou_regra', false, 'reason', 'discordancia',
                              'vezes', v_p.vezes, 'concorrentes', v_briga);
  end if;

  -- FREIO 1 — nunca no primeiro clique. Três escolhas, ou duas de pessoas
  -- diferentes. `p_agora` é o consentimento explícito da caixinha "valer para
  -- os outros N", que vale mais que contagem.
  v_virou := p_agora
             or v_p.vezes >= 3
             or (v_p.vezes >= 2 and cardinality(v_p.quem) >= 2);

  if not v_virou then
    return jsonb_build_object('ok', true, 'virou_regra', false,
                              'vezes', v_p.vezes, 'pessoas', cardinality(v_p.quem));
  end if;

  select m.category_id into v_antes
    from public.source_category_map m
   where m.source_id = p_source_id and m.category_source = v_chave;

  insert into public.source_category_map
    (source_id, category_source, category_id, origem, aprendido_por, aprendido_em)
  values (p_source_id, v_chave, p_category_id, 'aprendido', p_quem, now())
      on conflict (source_id, category_source) do update
      set category_id   = excluded.category_id,
          origem        = 'aprendido',
          aprendido_por = excluded.aprendido_por,
          aprendido_em  = excluded.aprendido_em;

  update public.source_category_proposta
     set virou_regra_em = now()
   where source_id = p_source_id and category_source = v_chave
     and category_id = p_category_id;

  -- FREIO 5 — auditoria em toda promoção.
  insert into public.audit_log (actor_id, actor_role, action, table_name, row_id, old_data, new_data)
  values (p_quem, app.role()::text, 'APRENDER_CATEGORIA', 'source_category_map',
          p_source_id || '|' || v_chave,
          case when v_antes is not null then jsonb_build_object('category_id', v_antes) end,
          jsonb_build_object('source_id', p_source_id, 'category_source', v_chave,
                             'category_id', p_category_id, 'vezes', v_p.vezes,
                             'pessoas', cardinality(v_p.quem), 'na_hora', p_agora));

  return jsonb_build_object('ok', true, 'virou_regra', true, 'vezes', v_p.vezes,
                            'pessoas', cardinality(v_p.quem));
end $$;
comment on function app.propor_categoria_da_fonte(int, text, int, uuid, boolean) is
  'Acumula a escolha humana como PROPOSTA de regra do de-para (RF-RAD-06) e promove quando os freios deixam: 3 escolhas, ou 2 de pessoas diferentes, ou consentimento explícito. Proposta concorrente viva congela tudo. Não toca em organizations: a regra vale só para frente.';
revoke all on function app.propor_categoria_da_fonte(int, text, int, uuid, boolean) from public, anon, authenticated;


-- ---------------------------------------------------------------------
-- 4. O texto que a fonte usou, para um candidato
-- ---------------------------------------------------------------------
-- A junção `(source_id, external_id)` é a MESMA pela qual o candidato é
-- encontrado em `app.resolver_source_record`. Escrita uma vez, usada em três
-- lugares: aqui, no "valer para os outros" e na fila.
create or replace function app.categoria_na_fonte_do_candidato(p_candidate_id uuid)
returns text
language sql
stable
set search_path = ''
as $$
  select sr.category_source
    from public.supplier_candidates c
    join public.source_record sr
      on sr.source_id = c.source_id and sr.external_id = c.external_id
   where c.id = p_candidate_id
     and nullif(trim(coalesce(sr.category_source, '')), '') is not null
   order by sr.last_seen_at desc
   limit 1
$$;
comment on function app.categoria_na_fonte_do_candidato(uuid) is
  'O texto que a FONTE usou para a categoria deste candidato, do source_record mais recente. category_source mora em source_record, e não em supplier_candidates — esta é a junção (source_id, external_id) escrita uma vez só.';
revoke all on function app.categoria_na_fonte_do_candidato(uuid) from public, anon;
grant execute on function app.categoria_na_fonte_do_candidato(uuid) to authenticated, service_role;


-- ---------------------------------------------------------------------
-- 5. Quantos outros vieram com o mesmo rótulo
-- ---------------------------------------------------------------------
-- É o número da caixinha: "valer para os outros 5". Ele vem de um `count` real,
-- e não de uma estimativa — prometer 5 e mexer em 9 seria pior que não oferecer.
create or replace function public.radar_irmas_pelo_rotulo(p_candidate_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_c     public.supplier_candidates;
  v_texto text;
  v_n     int;
begin
  if not app.can_write() then
    raise exception 'Papel % não trabalha a fila do Radar', app.role() using errcode = '42501';
  end if;
  select * into v_c from public.supplier_candidates where id = p_candidate_id;
  if v_c.id is null then
    return jsonb_build_object('ok', false, 'reason', 'candidato_inexistente');
  end if;

  v_texto := app.categoria_na_fonte_do_candidato(p_candidate_id);
  if v_texto is null then
    return jsonb_build_object('ok', true, 'categoria_na_fonte', null, 'outros', 0);
  end if;

  select count(*)::int into v_n
    from public.supplier_candidates o
   where o.id <> p_candidate_id
     and o.source_id = v_c.source_id
     and o.status = 'novo'
     and o.category_id is null
     and app.chave_catalogo(app.categoria_na_fonte_do_candidato(o.id))
         = app.chave_catalogo(v_texto);

  return jsonb_build_object('ok', true, 'categoria_na_fonte', v_texto, 'outros', v_n);
end $$;
comment on function public.radar_irmas_pelo_rotulo(uuid) is
  'Quantos OUTROS candidatos novos e sem categoria vieram da mesma fonte com o mesmo rótulo de categoria. É o número da caixinha "valer para os outros N", e vem de um count real: prometer 5 e mexer em 9 seria pior que não oferecer.';
revoke all on function public.radar_irmas_pelo_rotulo(uuid) from public, anon;
grant execute on function public.radar_irmas_pelo_rotulo(uuid) to authenticated;


-- ---------------------------------------------------------------------
-- 6. Esquecer uma regra aprendida
-- ---------------------------------------------------------------------
create or replace function public.source_category_esquecer(
  p_source_id int,
  p_texto     text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid   uuid := auth.uid();
  v_chave text := app.chave_catalogo(p_texto);
  v_m     public.source_category_map;
begin
  if v_uid is null or not app.is_manager() then
    raise exception 'Papel % não esquece regra de categoria', app.role() using errcode = '42501';
  end if;

  select * into v_m from public.source_category_map
   where source_id = p_source_id and category_source = v_chave;
  if v_m.source_id is null then
    return jsonb_build_object('ok', false, 'reason', 'regra_inexistente');
  end if;
  -- Regra SEMEADA é decisão de produto, e sai por migração. Deixar a tela
  -- apagá-la faria a próxima `db reset` trazê-la de volta sem aviso.
  if v_m.origem <> 'aprendido' then
    return jsonb_build_object('ok', false, 'reason', 'regra_semeada');
  end if;

  delete from public.source_category_map
   where source_id = p_source_id and category_source = v_chave;
  -- A proposta também sai: senão a próxima escolha reergueria a regra na hora,
  -- com o contador já cheio.
  delete from public.source_category_proposta
   where source_id = p_source_id and category_source = v_chave;

  insert into public.audit_log (actor_id, actor_role, action, table_name, row_id, old_data)
  values (v_uid, app.role()::text, 'ESQUECER_CATEGORIA', 'source_category_map',
          p_source_id || '|' || v_chave, to_jsonb(v_m));

  return jsonb_build_object('ok', true, 'esquecida', v_chave);
end $$;
comment on function public.source_category_esquecer(int, text) is
  'Apaga uma regra APRENDIDA do de-para e a proposta que a sustentava (freio 4 do desenho de 25/09/2026). Regra semeada não sai por aqui: ela é decisão de produto e sai por migração. Fichas já criadas não são tocadas — a regra vale só para frente, e desfazê-la também.';
revoke all on function public.source_category_esquecer(int, text) from public, anon;
grant execute on function public.source_category_esquecer(int, text) to authenticated;


-- ---------------------------------------------------------------------
-- 7. Onde a escolha humana vira proposta
-- ---------------------------------------------------------------------
create or replace function public.radar_revisar_candidato(
  p_candidate_id   uuid,
  p_acao           text,
  p_organization_id uuid default null,
  p_category_id    int  default null,
  p_reason         text default null,
  -- MUDOU em 25/09/2026: a caixinha "valer para os outros N que também vieram
  -- como 'Buffet infantil'". Desmarcada por padrão, e o padrão é este `false`:
  -- consentimento explícito vale mais que contagem, mas só quando é explícito.
  p_aprender_agora boolean default false,
  -- Esta escolha conta para o aprendizado?
  --
  -- `public.radar_revisar_lote` passa `false`, e a razão é o freio 1: aprovar
  -- 30 nomes em lote é UMA decisão humana, não trinta. Deixar cada volta do
  -- laço propor encheria o contador de uma vez e promoveria a regra no mesmo
  -- clique — exatamente o que o freio existe para impedir. Quem ensina a partir
  -- de um grupo é a caixinha `p_aprender_agora`, onde a pessoa VÊ o rótulo e a
  -- categoria lado a lado.
  p_propor boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid    uuid := auth.uid();
  v_c      public.supplier_candidates;
  v_res    jsonb;
  v_org    uuid;
  v_evento uuid;
  v_motivo text;
  -- O que a FONTE chamou isto, lido ANTES de promover: promover apaga o
  -- candidato da fila do ponto de vista da consulta, e o texto é o que se
  -- aprende.
  v_rotulo text;
  v_irmas  int := 0;
  v_apre   jsonb;
begin
  if v_uid is null or not app.can_write() then
    raise exception 'Papel % não revisa a fila do Radar', app.role() using errcode = '42501';
  end if;

  select * into v_c from public.supplier_candidates where id = p_candidate_id;
  if v_c.id is null then
    return jsonb_build_object('ok', false, 'reason', 'candidato_inexistente');
  end if;
  if v_c.status <> 'novo' then
    return jsonb_build_object('ok', false, 'reason', 'ja_revisado', 'status', v_c.status);
  end if;

  -- ---------------- recusar / não contatar ----------------
  if p_acao in ('recusar', 'nao_contatar') then
    v_res := app.recusar_candidato(p_candidate_id, p_reason, p_acao = 'nao_contatar');

    -- A supressão vem DEPOIS e só se a recusa passou: `app.recusar_candidato`
    -- exige motivo escrito, e suprimir um telefone por um clique que a própria
    -- função recusou seria bloquear alguém sem decisão registrada.
    if p_acao = 'nao_contatar' and coalesce((v_res ->> 'ok')::boolean, false) then
      v_motivo := concat_ws(' — ', 'Radar: não contatar',
                            nullif(trim(coalesce(p_reason, '')), ''));

      -- A ficha já existe? Então o pedido é prova e tem de virar `consent_event`:
      -- é o que move o negócio para a etapa de opt-out e marca a ficha e as
      -- pessoas dela. Suprimir por fora deixaria o cartão em "Em conversa", na
      -- fila do dia de alguém que não pode mais escrever.
      select o.id into v_org
        from public.organizations o
       where o.deleted_at is null
         and ((v_c.phone_e164       is not null and o.phone_e164       = v_c.phone_e164)
           or (v_c.instagram_handle is not null and o.instagram_handle = v_c.instagram_handle)
           or (v_c.cnpj             is not null and o.cnpj             = v_c.cnpj))
       limit 1;

      if v_org is not null then
        insert into public.consent_events
          (kind, organization_id, channel, evidence_text, occurred_at, recorded_by)
        values
          ('contact_optout'::app.consent_kind, v_org, 'whatsapp'::app.channel,
           v_motivo, now(), v_uid)
        returning id into v_evento;
      end if;

      -- Sempre: o número e o @ que o candidato mostrou. Sem ficha, o hash é o
      -- mínimo que cumpre o pedido e o máximo que a minimização permite; com
      -- ficha, ele cobre o contato do candidato quando a ficha foi encontrada
      -- pelo @ ou pelo CNPJ e tem outro telefone.
      perform app.suppress('phone', v_c.phone_e164, v_motivo,
                           'whatsapp'::app.channel, v_evento);
      perform app.suppress('instagram', v_c.instagram_handle, v_motivo,
                           'instagram'::app.channel, v_evento);
    end if;

    return v_res;
  end if;

  if p_acao not in ('aprovar', 'mesclar') then
    return jsonb_build_object('ok', false, 'reason', 'acao_invalida');
  end if;

  -- Um candidato marcado "não contatar" (supressão, RF-RAD-09) não vira alvo.
  if v_c.do_not_contact then
    return jsonb_build_object('ok', false, 'reason', 'candidato_nao_contatar');
  end if;

  -- ---------------- mesclar com ficha existente ----------------
  if p_acao = 'mesclar' then
    if p_organization_id is null then
      return jsonb_build_object('ok', false, 'reason', 'organizacao_obrigatoria');
    end if;
    if not exists (select 1 from public.organizations o
                    where o.id = p_organization_id and o.deleted_at is null) then
      return jsonb_build_object('ok', false, 'reason', 'organizacao_inexistente');
    end if;
    -- Regra de carteira: só quem pode editar a ficha pode receber dado nela.
    if not app.org_is_editable(p_organization_id) then
      return jsonb_build_object('ok', false, 'reason', 'organizacao_fora_da_carteira');
    end if;
    return app.mesclar_candidato(p_candidate_id, p_organization_id, p_category_id,
                                 p_reason, v_c.import_batch_id);
  end if;

  -- ---------------- aprovar ----------------
  v_rotulo := app.categoria_na_fonte_do_candidato(p_candidate_id);

  v_res := app.promover_candidato(p_candidate_id, null, v_uid, null, null,
                                  p_category_id, v_c.import_batch_id);

  -- A ficha suspeita existe, mas pode ser de carteira alheia: o id só sai daqui
  -- para quem já poderia abri-la. Quem não pode continua sabendo que existe.
  if coalesce((v_res ->> 'ok')::boolean, false) = false
     and v_res ->> 'reason' = 'ja_existe_na_base' then
    v_org := (v_res ->> 'organization_id')::uuid;
    return jsonb_build_object('ok', false, 'reason', 'ja_existe_na_base',
                              'organization_id',
                              case when app.org_is_visible(v_org) then v_org end);
  end if;

  if coalesce((v_res ->> 'ok')::boolean, false) and nullif(trim(coalesce(p_reason, '')), '') is not null then
    update public.supplier_candidates set review_reason = trim(p_reason) where id = p_candidate_id;
  end if;

  -- ---------------- o que se aprende com esta escolha ----------------
  -- SÓ AQUI, e não num gatilho de tabela: `app.promover_candidato` também é
  -- chamada por `public.importacao_gravar`, onde a categoria veio do próprio
  -- mapa. Ali não há nada que aprender — seria reescrever a regra com ela
  -- mesma. Aprende-se onde uma PESSOA escolheu.
  --
  -- E só quando a categoria veio no clique (`p_category_id`): aprovar um
  -- candidato que JÁ tinha categoria não é uma escolha sobre o rótulo da fonte.
  if coalesce((v_res ->> 'ok')::boolean, false)
     and coalesce(p_propor, true)
     and p_category_id is not null and v_rotulo is not null then
    v_apre := app.propor_categoria_da_fonte(v_c.source_id, v_rotulo, p_category_id,
                                            v_uid, coalesce(p_aprender_agora, false));

    -- "Valer para os outros N": aplica a categoria aos que estão na fila com o
    -- MESMO rótulo, pelo mesmo caminho do cartão. Nada de escrita nova.
    if coalesce(p_aprender_agora, false) then
      select count(*)::int into v_irmas
        from public.supplier_candidates o
       where o.id <> p_candidate_id
         and o.source_id = v_c.source_id
         and o.status = 'novo'
         and o.category_id is null
         and app.chave_catalogo(app.categoria_na_fonte_do_candidato(o.id))
             = app.chave_catalogo(v_rotulo);

      if v_irmas > 0 then
        v_res := v_res || jsonb_build_object(
          'irmas', public.radar_revisar_lote(
                     (select array_agg(o.id)
                        from public.supplier_candidates o
                       where o.id <> p_candidate_id
                         and o.source_id = v_c.source_id
                         and o.status = 'novo'
                         and o.category_id is null
                         and app.chave_catalogo(app.categoria_na_fonte_do_candidato(o.id))
                             = app.chave_catalogo(v_rotulo)
                       limit 200),
                     p_category_id));
      end if;
    end if;

    v_res := v_res || jsonb_build_object('aprendizado', v_apre);
  end if;

  return v_res;
end $$;

comment on function public.radar_revisar_candidato(uuid,text,uuid,int,text,boolean,boolean) is
  'Decisão da fila do Radar (RF-RAD-11). Despachante fino sobre app.recusar_candidato, app.mesclar_candidato e app.promover_candidato — as mesmas funções que o worker chama (ADR-08, caminho único de escrita). As checagens de papel e de carteira ficam aqui, porque dependem do JWT. Desde 09/09/2026, "não contatar" também suprime de verdade (RF-RAD-09). Desde 25/09/2026, aprovar com categoria escolhida à mão PROPÕE a regra do de-para (RF-RAD-06) — e, com p_aprender_agora, grava a regra na hora e aplica aos outros que vieram com o mesmo rótulo.';

-- A assinatura de CINCO argumentos sai: ela e a nova seriam ambíguas para o
-- PostgREST, que resolve por nome de argumento, e a chamada antiga continua
-- valendo pelos defaults dos dois novos.
drop function if exists public.radar_revisar_candidato(uuid,text,uuid,int,text);

revoke all on function public.radar_revisar_candidato(uuid,text,uuid,int,text,boolean,boolean) from public, anon;
grant execute on function public.radar_revisar_candidato(uuid,text,uuid,int,text,boolean,boolean) to authenticated;


-- ---------------------------------------------------------------------
-- 8. O lote não conta como N decisões humanas
-- ---------------------------------------------------------------------
create or replace function public.radar_revisar_lote(
  p_ids         uuid[],
  p_category_id int default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid    uuid := auth.uid();
  v_id     uuid;
  v_res    jsonb;
  v_ok     int  := 0;
  v_falhou int  := 0;
  v_itens  jsonb := '[]'::jsonb;
  v_vistos uuid[] := '{}'::uuid[];
begin
  -- A checagem também está em `radar_revisar_candidato`, e é de propósito:
  -- recusar cedo evita abrir 200 subtransações para reprovar 200 vezes.
  if v_uid is null or not app.can_write() then
    raise exception 'Papel % não revisa a fila do Radar', app.role() using errcode = '42501';
  end if;
  if p_ids is null or cardinality(p_ids) = 0 then
    return jsonb_build_object('ok', false, 'reason', 'lote_vazio');
  end if;
  -- Teto de 200: acima disso a chamada deixa de caber no clique de uma pessoa,
  -- e um lote que estoura no meio é pior que dois lotes que terminam.
  if cardinality(p_ids) > 200 then
    return jsonb_build_object('ok', false, 'reason', 'lote_grande_demais');
  end if;
  if p_category_id is not null
     and not exists (select 1 from public.categories c
                      where c.id = p_category_id and c.is_active) then
    return jsonb_build_object('ok', false, 'reason', 'categoria_inexistente');
  end if;

  foreach v_id in array p_ids loop
    -- O mesmo id duas vezes na seleção não é dois trabalhos: a segunda volta
    -- responderia 'ja_revisado' e inflaria a conta de falhas com um erro que
    -- não existe.
    if v_id = any (v_vistos) then
      continue;
    end if;
    v_vistos := v_vistos || v_id;

    begin
      -- `p_propor => false`: aprovar 30 nomes em lote é UMA decisão humana,
      -- não trinta. Sem isso o contador do aprendizado encheria de uma vez e a
      -- regra seria promovida no mesmo clique — o oposto do freio 1.
      v_res := public.radar_revisar_candidato(v_id, 'aprovar', null, p_category_id,
                                              null, false, false);
    exception when others then
      -- A subtransação desfaz SÓ este candidato. O `sqlerrm` vai para o
      -- relatório: sem ele, "3 não passaram" não diz o que fazer a seguir.
      v_res := jsonb_build_object('ok', false, 'reason', 'erro', 'detalhe', sqlerrm);
    end;

    if coalesce((v_res ->> 'ok')::boolean, false) then
      v_ok := v_ok + 1;
    else
      v_falhou := v_falhou + 1;
    end if;

    v_itens := v_itens || jsonb_build_array(jsonb_build_object(
      'candidate_id', v_id,
      'ok',           coalesce((v_res ->> 'ok')::boolean, false),
      'reason',       v_res ->> 'reason',
      'nome',         (select c.name from public.supplier_candidates c where c.id = v_id),
      'organization_id', v_res ->> 'organization_id'));
  end loop;

  return jsonb_build_object('ok', true, 'aprovados', v_ok, 'recusados', v_falhou,
                            'itens', v_itens);
end $$;
comment on function public.radar_revisar_lote(uuid[], int) is
  'Aprova em lote os candidatos que não têm decisão dentro (RF-RAD-11). Laço sobre public.radar_revisar_candidato — o MESMO caminho do cartão, com o can_write(), a recusa de do_not_contact e a máscara de carteira alheia —, com subtransação por candidato e teto de 200. NÃO alimenta o aprendizado do de-para: um lote é uma decisão humana, não N. Mesclar, "não contatar" e "recusar" continuam um a um, com motivo escrito. Devolve a conta e o motivo de cada um que não passou.';
revoke all on function public.radar_revisar_lote(uuid[], int) from public, anon;
grant execute on function public.radar_revisar_lote(uuid[], int) to authenticated;


-- ---------------------------------------------------------------------
-- 9. A tela do freio 4: o que o CRM aprendeu, e quanto isso rendeu
-- ---------------------------------------------------------------------
-- Um desfazer que não mostra o estrago não é um desfazer: é um botão. Por isso
-- a lista traz QUANTAS FICHAS cada regra criou — é o número que decide entre
-- "apaga isso" e "deixa, está certo".
--
-- A conta é de fichas nascidas DEPOIS de a regra existir, e por construção: o
-- freio 3 diz que a regra vale só para frente, então contar o que veio antes
-- seria cobrar dela o que ela não fez.
create or replace function public.source_category_regras(p_source_id int default null)
returns table (
  source_id       int,
  fonte           text,
  category_source text,
  category_id     int,
  categoria       text,
  origem          text,
  aprendido_por   uuid,
  quem            text,
  aprendido_em    timestamptz,
  vezes           int,
  fichas          int
)
language sql
stable
security definer
set search_path = ''
as $$
  select m.source_id,
         s.name,
         m.category_source,
         m.category_id,
         c.name,
         m.origem,
         m.aprendido_por,
         p.full_name,
         m.aprendido_em,
         coalesce(pr.vezes, 0),
         (select count(distinct o.id)::int
            from public.supplier_candidates sc
            join public.source_record sr on sr.candidate_id = sc.id
            join public.organizations o on o.id = sc.organization_id and o.deleted_at is null
           where sc.source_id = m.source_id
             and app.chave_catalogo(sr.category_source) = m.category_source
             and sc.category_id = m.category_id
             and (m.aprendido_em is null or o.created_at >= m.aprendido_em))
    from public.source_category_map m
    join public.sources s on s.id = m.source_id
    join public.categories c on c.id = m.category_id
    left join public.profiles p on p.id = m.aprendido_por
    left join public.source_category_proposta pr
           on pr.source_id = m.source_id
          and pr.category_source = m.category_source
          and pr.category_id = m.category_id
   where app.can_write()
     and (p_source_id is null or m.source_id = p_source_id)
   order by (m.origem = 'aprendido') desc, m.aprendido_em desc nulls last,
            s.name, m.category_source
$$;
comment on function public.source_category_regras(int) is
  'O de-para de categoria da fonte, com proveniência: o que foi semeado, o que foi aprendido, por quem, quando, com quantas escolhas atrás e QUANTAS FICHAS cada regra criou depois de existir. Um desfazer que não mostra o estrago é um botão, não um desfazer.';
revoke all on function public.source_category_regras(int) from public, anon;
grant execute on function public.source_category_regras(int) to authenticated;
