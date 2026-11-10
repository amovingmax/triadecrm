-- =====================================================================
-- O código do anúncio com a tag do tipo — só na Imova (10/11/2026)
--
-- O usuário: "Assim que criarmos anúncios é possível já colocar uma TAG no
-- anúncio que seja única? TE0001 para Terrenos, IM0001 para Imóveis, etc. Se já
-- tivermos um terreno com o código TE0001, quando formos criar um novo anúncio
-- ele deve ter um código diferente, que ainda não existe." E, depois: "O código
-- da tag deve ser preenchido automaticamente quando selecionarmos o tipo de
-- anúncio. Caso escolhermos um anúncio de terreno, a tag deve automaticamente
-- ser TE (e um número que ainda não existe)."
--
-- Até aqui o anúncio novo ganhava IMV-0001, IMV-0002... de uma sequência só,
-- qualquer que fosse o tipo. Agora a tag sai do tipo (`app.anuncio_tag_do_tipo`),
-- sem escolha, e o banco dá o próximo número livre dela:
--
--   TE  Terreno (terreno, terreno comercial)
--   SA  Sala (sala comercial, consultório) — a Arbo já usa (SA0012_IMOVA)
--   IM  Imóvel (os residenciais, menos terreno)
--   CO  Comercial (o resto dos comerciais)
--
-- PT (o PT0001_IMOVA, uma casa da Arbo) não é tag do CRM: fica como está, e
-- nenhum código novo começa com PT.
--
-- O próximo número livre (`app.anuncio_proximo_codigo`) é 1 + o maior número
-- já usado com aquela tag em qualquer lugar que o CRM conhece: os anúncios do
-- CRM (inclusive os excluídos), as linhas do relatório do Canal Pro e o último
-- arquivo do sistema atual. Conta também o código com sufixo ("TE0005_IMOVA"
-- ocupa o 5): com TE0001 a TE0005 existindo, o próximo terreno é TE0006. Um
-- número nunca é reaproveitado depois de excluído, porque o Grupo OLX liga o
-- histórico (visualizações, contatos) ao código. Dois salvares ao mesmo tempo
-- não pegam o mesmo número: o salvar que cria trava a conta até o fim.
--
-- Trocar o tipo depois de criado: no rascunho que nasceu no CRM e nunca foi ao
-- ar, o código segue o tipo (casa → terreno: IM0003 vira o próximo TE; casa →
-- apartamento: continua IM0003). Fora disso o código é fixo: publicado, ele é o
-- ListingID do portal; trazido do sistema atual ou do Canal Pro, ele é o que
-- liga o anúncio ao que já está lá. O rascunho antigo do CRM (IMV-…) ganha o
-- código com a tag no próximo salvar.
--
--   * `app.anuncio_tag_valida`, `app.anuncio_tag_do_tipo`,
--     `app.anuncio_tag_do_codigo`: o vocabulário (espelho em `tipos.ts`);
--   * `app.anuncio_proximo_codigo`: a conta, só para funções SECURITY DEFINER;
--   * `public.anuncio_proximos_codigos()`: o próximo código de cada tag, para a
--     tela mostrar ao escolher o tipo (é só uma prévia: quem dá o código é o salvar);
--   * `public.anuncio_salvar` dá o código pela tag do tipo, ao criar e no
--     rascunho do CRM que nunca foi ao ar.
--
-- Fica como estava: o default da coluna (IMV-…) e o `canal_pro_trazer`, que
-- usa a sequência quando o código do relatório não serve ou já está em uso.
--
-- Na KOMUNE não cria nada.
--
-- COMO DESFAZER: reaplicar `public.anuncio_salvar` de 20261104150000 e apagar
-- `public.anuncio_proximos_codigos()` e as quatro funções `app.anuncio_tag_*` /
-- `app.anuncio_proximo_codigo`. Os códigos já dados ficam (são válidos).
-- =====================================================================

do $tag$
begin
  if (select i.empresa from app.identidade i) = 'komune' then
    raise notice 'Os anúncios são só da Imova: no banco da KOMUNE nada foi criado.';
    return;
  end if;

  -- -------------------------------------------------------------------
  -- 1. O vocabulário
  -- -------------------------------------------------------------------
  execute $ddl$
create or replace function app.anuncio_tag_valida(p text)
returns boolean
language sql
immutable
set search_path = ''
as $f$
  select coalesce(p in ('TE', 'SA', 'IM', 'CO'), false)
$f$
  $ddl$;
  execute $ddl$
comment on function app.anuncio_tag_valida(text) is
  'As tags do código do anúncio (decisão do usuário em 10/11/2026): TE terreno, SA sala, IM imóvel residencial, CO comercial. PT (da Arbo) não é tag do CRM.'
  $ddl$;

  execute $ddl$
create or replace function app.anuncio_tag_do_tipo(p_tipo text)
returns text
language sql
immutable
set search_path = ''
as $f$
  select case
           when p_tipo in ('terreno', 'terreno_comercial') then 'TE'
           when p_tipo in ('sala_comercial', 'consultorio') then 'SA'
           when (select t.uso from app.anuncio_tipo(p_tipo) t) = 'Residential' then 'IM'
           else 'CO'
         end
$f$
  $ddl$;
  execute $ddl$
comment on function app.anuncio_tag_do_tipo(text) is
  'A tag que o tipo sugere: terreno e terreno comercial → TE; sala comercial e consultório → SA; os outros residenciais → IM; os outros comerciais → CO. Espelho: tagDoTipo em tipos.ts.'
  $ddl$;

  execute $ddl$
create or replace function app.anuncio_tag_do_codigo(p_codigo text)
returns text
language sql
immutable
set search_path = ''
as $f$
  select substring(p_codigo from '^(TE|SA|IM|CO)[0-9]{4,9}$')
$f$
  $ddl$;
  execute $ddl$
comment on function app.anuncio_tag_do_codigo(text) is
  'A tag de um código que o CRM deu ("TE0006" → TE). Código de fora (com sufixo, como TE0001_IMOVA, ou com texto) → nulo.'
  $ddl$;

  -- -------------------------------------------------------------------
  -- 2. O próximo número livre
  -- -------------------------------------------------------------------
  execute $ddl$
create or replace function app.anuncio_proximo_codigo(p_tag text)
returns text
language plpgsql
stable
set search_path = ''
as $f$
declare
  v_padrao text := '^' || p_tag || '([0-9]{1,9})([^0-9]|$)';
  v_n      bigint;
  v_cod    text;
begin
  if not app.anuncio_tag_valida(p_tag) then
    return null;
  end if;

  select coalesce(max(substring(upper(c.codigo) from v_padrao)::bigint), 0)
    into v_n
    from (select codigo from public.anuncios
          union all
          select codigo from public.anuncios_no_canal_pro
          union all
          select codigo from public.sistema_atual_no_arquivo) c
   where upper(c.codigo) ~ v_padrao;

  -- O maior + 1 já basta; o laço só protege de um código igual escrito de
  -- outro jeito (caixa) que a conta acima não pegaria.
  loop
    v_n := v_n + 1;
    v_cod := p_tag || lpad(v_n::text, greatest(4, char_length(v_n::text)), '0');
    exit when not exists (select 1 from public.anuncios a where upper(a.codigo) = v_cod);
  end loop;
  return v_cod;
end $f$
  $ddl$;
  execute $ddl$
comment on function app.anuncio_proximo_codigo(text) is
  'O próximo código livre da tag: 1 + o maior número já usado com ela nos anúncios do CRM (com os excluídos), no relatório do Canal Pro e no arquivo do sistema atual, com ou sem sufixo (TE0005_IMOVA ocupa o 5). Nunca reaproveita número. Quem chama trava antes (anuncio_salvar).'
  $ddl$;

  -- Ajudantes de leitura: sem PUBLIC nem anon (guarda do pgTAP 09). A conta só
  -- é chamada por funções SECURITY DEFINER.
  execute 'revoke all on function app.anuncio_tag_valida(text) from public, anon';
  execute 'grant execute on function app.anuncio_tag_valida(text) to authenticated, service_role';
  execute 'revoke all on function app.anuncio_tag_do_tipo(text) from public, anon';
  execute 'grant execute on function app.anuncio_tag_do_tipo(text) to authenticated, service_role';
  execute 'revoke all on function app.anuncio_tag_do_codigo(text) from public, anon';
  execute 'grant execute on function app.anuncio_tag_do_codigo(text) to authenticated, service_role';
  execute 'revoke all on function app.anuncio_proximo_codigo(text) from public, anon, authenticated';
  execute 'grant execute on function app.anuncio_proximo_codigo(text) to service_role';

  -- -------------------------------------------------------------------
  -- 3. A prévia da tela
  -- -------------------------------------------------------------------
  execute $ddl$
create or replace function public.anuncio_proximos_codigos()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $f$
begin
  if not app.is_manager() then
    return jsonb_build_object('ok', false, 'motivo', 'sem_permissao');
  end if;
  return jsonb_build_object('ok', true, 'codigos', jsonb_build_object(
    'TE', app.anuncio_proximo_codigo('TE'),
    'SA', app.anuncio_proximo_codigo('SA'),
    'IM', app.anuncio_proximo_codigo('IM'),
    'CO', app.anuncio_proximo_codigo('CO')));
end $f$
  $ddl$;
  execute $ddl$
comment on function public.anuncio_proximos_codigos() is
  'O próximo código de cada tag ({TE, SA, IM, CO}), para a tela mostrar antes de salvar. É prévia: se outra pessoa criar antes, o salvar dá o seguinte. Admin, gestor e SDR.'
  $ddl$;
  execute 'revoke all on function public.anuncio_proximos_codigos() from public, anon';
  execute 'grant execute on function public.anuncio_proximos_codigos() to authenticated';

  -- -------------------------------------------------------------------
  -- 4. O salvar dá o código pela tag do tipo
  -- -------------------------------------------------------------------
  -- Igual à de 20261104150000, mais: o anúncio novo nasce com o próximo código
  -- da tag do tipo; o rascunho do CRM que nunca foi ao ar troca de código quando
  -- o tipo pede outra tag; os outros guardam o código.
  execute $ddl$
create or replace function public.anuncio_salvar(p_dados jsonb, p_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $f$
declare
  r       public.anuncios;
  a       public.anuncios;
  v_id    uuid := p_id;
  v_pend  text[];
  v_tag   text;
  v_cod   text;
begin
  if not app.is_manager() then
    return jsonb_build_object('ok', false, 'motivo', 'sem_permissao');
  end if;
  r := jsonb_populate_record(null::public.anuncios, coalesce(p_dados, '{}'::jsonb));

  if r.proprietario_id is not null and not exists (
       select 1 from public.organizations o where o.id = r.proprietario_id and o.deleted_at is null) then
    return jsonb_build_object('ok', false, 'motivo', 'proprietario_invalido');
  end if;

  if v_id is not null then
    select * into a from public.anuncios where id = v_id for update;
    if not found then
      return jsonb_build_object('ok', false, 'motivo', 'nao_encontrado');
    end if;
    if a.excluido_em is not null then
      return jsonb_build_object('ok', false, 'motivo', 'excluido');
    end if;
    if not app.anuncio_editavel(a) then
      return jsonb_build_object('ok', false, 'motivo', 'so_gestao_mexe_no_ar');
    end if;
    -- No rascunho do CRM que nunca foi ao ar, o código segue o tipo: troca só
    -- quando o tipo pede outra tag (ou quando ainda é um IMV-… antigo).
    if a.origem = 'crm' and a.situacao = 'rascunho' and a.publicado_em is null then
      v_tag := app.anuncio_tag_do_tipo(coalesce(r.tipo, a.tipo));
      if v_tag is not distinct from app.anuncio_tag_do_codigo(a.codigo) then
        v_tag := null;
      end if;
    end if;
  else
    v_tag := app.anuncio_tag_do_tipo(coalesce(r.tipo, 'apartamento'));
  end if;

  -- Um código de cada vez: dois salvares ao mesmo tempo não pegam o mesmo
  -- número (a trava vai até o fim da transação).
  if v_tag is not null then
    perform pg_advisory_xact_lock(hashtext('public.anuncios.codigo'));
    v_cod := app.anuncio_proximo_codigo(v_tag);
  end if;

  begin
    if v_id is null then
      insert into public.anuncios (codigo, criado_por, atualizado_por, tipo)
      values (v_cod, auth.uid(), auth.uid(), coalesce(r.tipo, 'apartamento'))
      returning id into v_id;
    end if;

    update public.anuncios set
      codigo           = coalesce(v_cod, codigo),
      titulo           = btrim(coalesce(r.titulo, '')),
      descricao        = btrim(coalesce(r.descricao, '')),
      tipo             = coalesce(r.tipo, tipo),
      negocio          = coalesce(r.negocio, negocio),
      preco_venda      = case when coalesce(r.negocio, negocio) = 'aluguel' then null else r.preco_venda end,
      preco_aluguel    = case when coalesce(r.negocio, negocio) = 'venda' then null else r.preco_aluguel end,
      periodo_aluguel  = coalesce(r.periodo_aluguel, 'mensal'),
      condominio       = r.condominio,
      iptu             = r.iptu,
      iptu_periodo     = coalesce(r.iptu_periodo, 'anual'),
      area_util        = r.area_util,
      area_total       = r.area_total,
      quartos          = r.quartos,
      suites           = r.suites,
      banheiros        = r.banheiros,
      vagas            = r.vagas,
      caracteristicas  = coalesce((select array_agg(distinct btrim(c) order by btrim(c))
                                     from unnest(r.caracteristicas) c
                                    where nullif(btrim(c), '') is not null), '{}'),
      cep              = nullif(regexp_replace(coalesce(r.cep, ''), '[^0-9]', '', 'g'), ''),
      estado           = nullif(upper(btrim(coalesce(r.estado, ''))), ''),
      cidade           = nullif(btrim(coalesce(r.cidade, '')), ''),
      bairro           = nullif(btrim(coalesce(r.bairro, '')), ''),
      endereco         = nullif(btrim(coalesce(r.endereco, '')), ''),
      numero           = nullif(btrim(coalesce(r.numero, '')), ''),
      complemento      = nullif(btrim(coalesce(r.complemento, '')), ''),
      mostrar_endereco = coalesce(r.mostrar_endereco, 'rua'),
      video_youtube    = nullif(btrim(coalesce(r.video_youtube, '')), ''),
      proprietario_id  = r.proprietario_id,
      atualizado_por   = auth.uid(),
      updated_at       = now()
    where id = v_id
    returning * into a;

    v_pend := app.anuncio_pendencias(v_id);
    if a.situacao = 'no_ar' and cardinality(v_pend) > 0 then
      raise exception using errcode = 'P0001', message = 'no_ar_com_pendencias';
    end if;
  exception when sqlstate 'P0001' then
    -- O bloco desfaz o que gravou; as pendências ficam para a resposta.
    return jsonb_build_object('ok', false, 'motivo', 'no_ar_com_pendencias', 'pendencias', to_jsonb(v_pend));
  end;

  return jsonb_build_object('ok', true, 'id', v_id, 'codigo', a.codigo,
                            'situacao', a.situacao, 'pendencias', to_jsonb(v_pend));
end $f$
  $ddl$;
  execute $ddl$
comment on function public.anuncio_salvar(jsonb, uuid) is
  'Cria (p_id nulo) ou salva o anúncio com o formulário inteiro. Equipe toda em rascunho e fora do ar; no ar, só admin e gestor, e só sem pendência. O código sai da tag do tipo (TE, SA, IM, CO) e do próximo número livre: ao criar e, no rascunho do CRM que nunca foi ao ar, quando o tipo pede outra tag; nos outros, o código fica. Não publica nada: devolve o que falta para ir ao ar.'
  $ddl$;
  execute 'revoke all on function public.anuncio_salvar(jsonb, uuid) from public, anon';
  execute 'grant execute on function public.anuncio_salvar(jsonb, uuid) to authenticated';

  execute $ddl$
comment on column public.anuncios.codigo is
  'O ListingID do VRSync, único. O anúncio criado no CRM ganha a tag do tipo e o próximo número livre (TE0006, IM0001; desde 10/11/2026, antes IMV-0001); o trazido de fora mantém o código de lá. Publicado, nunca muda: código novo é anúncio novo no portal.'
  $ddl$;
end $tag$;
