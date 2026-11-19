-- =====================================================================
-- A troca da Arbo pelo CRM, segura — só na Imova (19/11/2026)
--
-- Depois da troca, "Pôr no ar" num anúncio do CRM faz o Canal Pro publicá-lo
-- pelo arquivo VRSync do CRM. A revisão de 19/11/2026 achou o que ainda podia
-- dar errado no dia da troca e depois dela. Esta migração conserta a parte do
-- banco; a tela vem no mesmo commit.
--
--   1. AS COORDENADAS. O arquivo da Arbo manda Latitude e Longitude em cada
--      anúncio; o do CRM não mandava. Na troca, o pino do mapa passaria a vir
--      só do endereço (pior nos terrenos de CEP genérico: TE0004, 59164-000;
--      TE0005, 59178-000), e mudar a localização pode gastar uma das 3
--      edições de endereço que o Grupo OLX permite. Agora:
--        * `anuncios.latitude` e `anuncios.longitude` (graus, 7 casas, as duas
--          juntas ou nenhuma, fora o 0,0);
--        * `public.anuncio_importar` grava as do arquivo do sistema atual
--          (arquivo sem coordenada, ou com coordenada que não confere, deixa as
--          que o anúncio tem);
--        * `public.canal_pro_feed` as devolve, e a Edge Function escreve
--          <Latitude> e <Longitude> dentro de <Location>, depois do CEP, como
--          a documentação do VRSync (listing.html#location) e a Arbo;
--        * `anuncios.coordenadas_lidas_em`: quando o importador procurou o pino
--          do anúncio no arquivo. Sem ela e sem coordenada, a lista diz
--          `falta_pino`, e a tela pede "Atualizar do sistema atual" antes de
--          colar a URL (a coluna nasce vazia: sem esse passo, os 7 iriam ao
--          portal sem pino);
--        * depois da troca, o anúncio no ar sem pino ainda ganha o do arquivo
--          (só as coordenadas, nada mais; volta `pino: true`).
--      `public.anuncio_salvar` não as apaga ao salvar, mas as tira quando o
--      endereço muda (CEP, estado, cidade, bairro, rua, número ou
--      complemento): o pino velho apontaria o lugar antigo, e sem ele o portal
--      acha o lugar pelo endereço novo. Não há campo no editor por enquanto.
--
--   2. O SISTEMA ATUAL NÃO SOBRESCREVE O CRM. Depois da troca, o arquivo da
--      Arbo é velho: "Atualizar do sistema atual" punha os dados dele por cima
--      do anúncio no ar no CRM, e o Canal Pro publicaria os dados velhos na
--      leitura seguinte. `app.canal_pro_crm_publica()` diz se o robô do Grupo
--      OLX já leu o arquivo do CRM (`canal_pro_leituras` com `do_grupo_olx`);
--      com ela, `anuncio_importar` não mexe no anúncio no ar (fora o pino que
--      falta) e devolve `pulado: 'no_ar_pelo_crm'`. Rascunho e anúncio novo
--      continuam vindo. Antes da troca, nada muda.
--
--      AVISO DE OPERAÇÃO: o sinal da troca é QUALQUER leitura do arquivo do CRM
--      com "VivaRealBot" no user-agent guardada em `canal_pro_leituras` (90
--      dias). Antes da troca, ninguém abre a URL de produção do arquivo com esse
--      user-agent (um `curl -A VivaRealBot` de teste liga a troca no CRM). E se
--      o Canal Pro voltar para a Arbo, o importador e a rota de fotos ficam
--      travados no anúncio no ar por até 90 dias depois da última leitura do
--      robô. Para destravar (quem administra, no SQL Editor do projeto da
--      Imova, depois de conferir que o Canal Pro lê mesmo a Arbo):
--        update public.canal_pro_leituras set do_grupo_olx = false where do_grupo_olx;
--      As linhas ficam (com o user-agent), só deixam de contar como o robô.
--
--   3. POSTO DE VOLTA NO AR, VOLTA AOS RELATÓRIOS. `public.anuncio_publicar`
--      não limpava `saiu_do_ar_em`, e a carteira dos relatórios
--      (`app.imova_carteira`) só conta anúncio com `saiu_do_ar_em` vazio: o
--      anúncio tirado do ar e reposto sumia dela. Agora pôr no ar limpa a
--      data; o resto da função é igual ao da 20261104180000 (pendências,
--      plano, travas). Quem já está no ar com a data é consertado aqui.
--
--   4. A LISTA DIZ SE A LINHA DO RELATÓRIO É DESTAQUE. O menu do cartão e o
--      editor esmaeciam Destaque em todo rascunho com "2 de 2 em uso", até no
--      TE0001 e no TE0002, que são os 2 destaques do portal. O banco aceita
--      (`app.canal_pro_ocupadas` tira a linha do próprio anúncio, 20261111203000);
--      faltava a tela saber se a linha dele gasta destaque.
--      `anuncios_na_lista.no_canal_pro_com_destaque` diz isso, com a mesma
--      regra do banco (`app.canal_pro_destaque_do_relatorio`). O resto da
--      lista é igual ao da 20261106100000.
--
--   5. A IA NÃO VÊ CÓPIA DO RELATÓRIO COMO NO AR. `app.ia_atendente_imoveis`
--      juntava às linhas do CRM as do relatório sem `anuncio_id`: os 7 da
--      Arbo apareciam duas vezes, e a cópia do relatório (Ativo) dizia
--      "no_ar" de um anúncio que o CRM tem como rascunho ou tirou do ar. E as
--      cópias antigas marcadas como excluídas (BONOR-ESQUINA-HERONIDES,
--      "Terreno - Pipa") seguiam como no ar. Agora a linha do relatório só
--      entra se nenhum anúncio do CRM (não excluído) tem o mesmo código, e se
--      não foi marcada como excluída. O resto é o corpo da 20261109130000;
--      prompts e worker não mudam.
--
-- ===========================================================================
-- SÓ DA IMOVA, E O WHATSAPP NÃO É TOCADO
-- ===========================================================================
-- No banco da KOMUNE esta migração não cria nada (Anúncios é módulo só da
-- Imova): só fica o registro da versão. Nada aqui lê ou escreve conversa,
-- mensagem ou fila de envio.
--
-- COMO DESFAZER (no banco da Imova):
--   reaplicar `public.anuncio_importar` e `public.canal_pro_trazer` como estão na
--   20261105170000 (a segunda não muda aqui), `public.anuncio_publicar` como está
--   na 20261104180000, `public.canal_pro_feed` como está na 20261104150000,
--   `public.anuncios_na_lista` como está na 20261106100000 (com `drop view` antes,
--   porque a coluna nova sai do fim) e `app.ia_atendente_imoveis` como está na
--   20261109130000, `public.anuncio_salvar` como está na 20261116120000; depois
--   drop function if exists app.canal_pro_crm_publica();
--   revoke execute on function app.canal_pro_destaque_do_relatorio(text) from authenticated;
--   alter table public.anuncios drop constraint if exists anuncios_coordenadas_check,
--     drop column if exists latitude, drop column if exists longitude,
--     drop column if exists coordenadas_lidas_em;
--   (o `saiu_do_ar_em` limpo dos que estavam no ar não volta: era o defeito.)
-- =====================================================================

do $troca$
begin
  if (select i.empresa from app.identidade i) = 'komune' then
    raise notice 'Os anúncios são só da Imova: no banco da KOMUNE nada foi criado.';
    return;
  end if;

  -- -------------------------------------------------------------------
  -- 1. As coordenadas
  -- -------------------------------------------------------------------
  -- Sete casas são um centímetro: a Arbo manda até quinze, e o resto é ruído.
  execute $ddl$
alter table public.anuncios
  add column if not exists latitude  numeric(10,7) check (latitude between -90 and 90),
  add column if not exists longitude numeric(10,7) check (longitude between -180 and 180)
  $ddl$;
  execute 'alter table public.anuncios drop constraint if exists anuncios_coordenadas_check';
  -- As duas juntas, ou nenhuma; 0,0 é o valor de quem não tem coordenada.
  execute $ddl$
alter table public.anuncios add constraint anuncios_coordenadas_check
  check ((latitude is null and longitude is null)
         or (latitude is not null and longitude is not null and (latitude, longitude) <> (0, 0)))
  $ddl$;
  execute $ddl$
comment on column public.anuncios.latitude is
  'A latitude do imóvel, em graus (7 casas). Vem do arquivo do sistema atual (Arbo) e vai ao Canal Pro em <Location><Latitude>. Junto com a longitude, ou nenhuma (19/11/2026).'
  $ddl$;
  execute $ddl$
comment on column public.anuncios.longitude is
  'A longitude do imóvel, em graus (7 casas). Vem do arquivo do sistema atual (Arbo) e vai ao Canal Pro em <Location><Longitude>. Junto com a latitude, ou nenhuma (19/11/2026).'
  $ddl$;
  -- Quando o importador do sistema atual procurou o pino deste anúncio no
  -- arquivo (achando ou não). Vazio e sem coordenada: falta trazer o pino, e a
  -- tela pede "Atualizar do sistema atual" antes de colar a URL. Preenchido sem
  -- coordenada: o arquivo não tinha, e a tela não pede de novo à toa.
  execute 'alter table public.anuncios add column if not exists coordenadas_lidas_em timestamptz';
  execute $ddl$
comment on column public.anuncios.coordenadas_lidas_em is
  'Quando o importador do sistema atual procurou as coordenadas deste anúncio no arquivo (achando ou não). Sem ela e sem coordenada, falta trazer o pino do mapa (19/11/2026).'
  $ddl$;

  -- -------------------------------------------------------------------
  -- 2. O CRM já publica?
  -- -------------------------------------------------------------------
  -- A troca está feita quando o robô do Grupo OLX leu o arquivo do CRM nos
  -- últimos 90 dias (o user-agent "VivaRealBot", que `canal_pro_feed` marca).
  -- O prazo vai na conta, e não só na limpeza: as leituras velhas só saem
  -- quando alguém lê o arquivo, e, se o Canal Pro voltar para a Arbo, ninguém
  -- mais lê. Assim o CRM deixa de se ver como quem publica 90 dias depois da
  -- última leitura do robô (o aviso de operação está no alto).
  execute $ddl$
create or replace function app.canal_pro_crm_publica()
returns boolean
language sql
stable
set search_path = ''
as $f$
  select exists (select 1 from public.canal_pro_leituras l
                  where l.do_grupo_olx and l.em > now() - interval '90 days')
$f$
  $ddl$;
  execute $ddl$
comment on function app.canal_pro_crm_publica() is
  'O robô do Grupo OLX leu o arquivo do CRM nos últimos 90 dias (a troca da Arbo pelo CRM está feita)? Desde então quem publica no Canal Pro é o CRM, e o arquivo do sistema atual não muda anúncio no ar, fora o pino que falta (19/11/2026).'
  $ddl$;
  execute 'revoke all on function app.canal_pro_crm_publica() from public, anon, authenticated';

  -- -------------------------------------------------------------------
  -- 3. O importador do sistema atual: as coordenadas, e não mexe no que o
  --    CRM publica
  -- -------------------------------------------------------------------
  -- Igual à da 20261105170000, mais: as coordenadas lidas à parte (um valor
  -- torto não derruba a importação), o pulo do anúncio no ar depois da troca e
  -- as duas linhas das coordenadas no UPDATE.
  execute $ddl$
create or replace function public.anuncio_importar(p_dados jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $f$
declare
  r       public.anuncios;
  a       public.anuncios;
  v_cod   text := btrim(coalesce(p_dados ->> 'codigo', ''));
  v_id    uuid;
  v_novo  boolean := false;
  v_pend  text[];
  v_fotos int;
  v_lat   numeric;
  v_lon   numeric;
  v_coord boolean := false;
  v_pino  boolean := false;
begin
  if not app.admin_ou_gestor() then
    return jsonb_build_object('ok', false, 'motivo', 'sem_permissao');
  end if;
  if not app.codigo_de_anuncio_valido(v_cod) then
    return jsonb_build_object('ok', false, 'motivo', 'codigo_invalido');
  end if;
  -- As coordenadas ficam fora do registro: numeric(10,7) recusaria com erro um
  -- valor grande demais, antes de qualquer conferência.
  r := jsonb_populate_record(null::public.anuncios,
                             coalesce(p_dados, '{}'::jsonb) - 'latitude' - 'longitude');
  if r.tipo is not null and not app.anuncio_tipo_existe(r.tipo) then
    return jsonb_build_object('ok', false, 'motivo', 'tipo_invalido');
  end if;
  if r.proprietario_id is not null and not exists (
       select 1 from public.organizations o where o.id = r.proprietario_id and o.deleted_at is null) then
    return jsonb_build_object('ok', false, 'motivo', 'proprietario_invalido');
  end if;

  -- As duas, em graus, dentro da faixa e fora do 0,0; senão, nenhuma muda.
  if (p_dados ->> 'latitude') ~ '^-?[0-9]{1,3}([.][0-9]+)?$'
     and (p_dados ->> 'longitude') ~ '^-?[0-9]{1,3}([.][0-9]+)?$' then
    v_lat := round((p_dados ->> 'latitude')::numeric, 7);
    v_lon := round((p_dados ->> 'longitude')::numeric, 7);
    v_coord := v_lat between -90 and 90 and v_lon between -180 and 180
               and (v_lat, v_lon) <> (0::numeric, 0::numeric);
  end if;

  select * into a from public.anuncios where codigo = v_cod for update;
  if found then
    -- Excluído não volta pela importação: volta pelo restaurar, de propósito.
    if a.excluido_em is not null then
      return jsonb_build_object('ok', false, 'motivo', 'excluido', 'id', a.id);
    end if;
    -- Depois da troca, quem publica é o CRM: o arquivo do sistema atual é velho
    -- e não muda o anúncio no ar. A única exceção é o pino do mapa que falta:
    -- sem nenhuma das duas coordenadas, ele vem do arquivo, e nada mais muda
    -- (quem pôs no ar e colou a URL sem "Atualizar do sistema atual" antes não
    -- fica sem pino para sempre). O rascunho continua vindo (19/11/2026).
    if a.situacao = 'no_ar' and app.canal_pro_crm_publica() then
      v_pino := v_coord and a.latitude is null and a.longitude is null;
      if v_pino then
        -- O portal vê o pino novo: `updated_at` muda, como em toda mudança dele.
        update public.anuncios
           set latitude = v_lat, longitude = v_lon, coordenadas_lidas_em = now(),
               atualizado_por = auth.uid(), updated_at = now()
         where id = a.id;
      elsif a.coordenadas_lidas_em is null then
        -- Procurou e o arquivo não tinha (ou o anúncio já tem as dele): a tela
        -- não pede de novo.
        update public.anuncios set coordenadas_lidas_em = now() where id = a.id;
      end if;
      select count(*) into v_fotos from public.anuncio_fotos f where f.anuncio_id = a.id;
      return jsonb_build_object('ok', true, 'pulado', 'no_ar_pelo_crm', 'pino', v_pino,
                                'id', a.id, 'codigo', a.codigo, 'novo', false, 'fotos', v_fotos,
                                'pendencias', to_jsonb(app.anuncio_pendencias(a.id)));
    end if;
    v_id := a.id;
  end if;

  begin
    if v_id is null then
      insert into public.anuncios (codigo, situacao, origem, importado_em, criado_por, atualizado_por, tipo)
      values (v_cod, 'rascunho', 'sistema_atual', now(), auth.uid(), auth.uid(),
              coalesce(r.tipo, 'apartamento'))
      returning id into v_id;
      v_novo := true;
    end if;

    update public.anuncios set
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
      -- O pino do mapa do portal (19/11/2026): só com as duas certas.
      latitude         = case when v_coord then v_lat else latitude end,
      longitude        = case when v_coord then v_lon else longitude end,
      coordenadas_lidas_em = now(),
      -- O arquivo do sistema atual não sabe do proprietário: trazer de novo não
      -- desfaz a ligação feita no CRM.
      proprietario_id  = coalesce(r.proprietario_id, proprietario_id),
      -- O destaque do arquivo vale para o rascunho; no ar, ele gasta a cota do
      -- plano e só muda por `anuncio_destaque`, que confere as vagas.
      destaque         = case
                           when situacao = 'no_ar' then destaque
                           when r.destaque in ('padrao', 'destaque', 'super_destaque', 'exclusivo', 'superior')
                             then r.destaque
                           else destaque
                         end,
      importado_em     = now(),
      atualizado_por   = auth.uid(),
      updated_at       = now()
    where id = v_id
    returning * into a;

    v_pend := app.anuncio_pendencias(v_id);
    if a.situacao = 'no_ar' and cardinality(v_pend) > 0 then
      raise exception using errcode = 'P0001', message = 'no_ar_com_pendencias';
    end if;
  exception
    when sqlstate 'P0001' then
      -- O bloco desfaz o que gravou; as pendências ficam para a resposta.
      return jsonb_build_object('ok', false, 'motivo', 'no_ar_com_pendencias', 'id', v_id,
                                'pendencias', to_jsonb(v_pend));
    when unique_violation then
      -- Outra importação criou o mesmo código neste instante.
      return jsonb_build_object('ok', false, 'motivo', 'codigo_em_uso');
    when check_violation then
      -- Um valor fora do que o anúncio aceita (negócio, período, CEP...): o
      -- nome da regra diz qual, sem dado de ninguém.
      return jsonb_build_object('ok', false, 'motivo', 'dados_invalidos', 'detalhe', sqlerrm);
  end;

  select count(*) into v_fotos from public.anuncio_fotos f where f.anuncio_id = v_id;
  return jsonb_build_object('ok', true, 'id', v_id, 'codigo', a.codigo, 'novo', v_novo,
                            'fotos', v_fotos, 'pendencias', to_jsonb(v_pend));
end $f$
  $ddl$;
  execute $ddl$
comment on function public.anuncio_importar(jsonb) is
  'Traz um anúncio do arquivo do sistema atual (Arbo) com o MESMO código: cria o rascunho ou atualiza o que tem o código, com as coordenadas do arquivo (19/11/2026). Excluído não volta; no ar não fica com pendência; depois da troca (o robô do Grupo OLX leu o arquivo do CRM), o anúncio no ar não muda e volta com pulado = no_ar_pelo_crm. Só admin e gestor.'
  $ddl$;
  execute 'revoke all on function public.anuncio_importar(jsonb) from public, anon';
  execute 'grant execute on function public.anuncio_importar(jsonb) to authenticated';

  -- -------------------------------------------------------------------
  -- 4. Pôr no ar limpa a data em que saiu do ar
  -- -------------------------------------------------------------------
  -- Igual à da 20261104180000, mais `saiu_do_ar_em = null` no UPDATE.
  execute $ddl$
create or replace function public.anuncio_publicar(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $f$
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

  -- De volta ao ar, a data em que saiu fica vazia: a carteira dos relatórios
  -- (`app.imova_carteira`) só conta anúncio sem ela (19/11/2026).
  update public.anuncios
     set situacao = 'no_ar', publicado_em = now(), publicado_por = auth.uid(),
         saiu_do_ar_em = null,
         atualizado_por = auth.uid(), updated_at = now()
   where id = p_id;
  return jsonb_build_object('ok', true);
end $f$
  $ddl$;
  execute $ddl$
comment on function public.anuncio_publicar(uuid) is
  'Põe o anúncio no arquivo do Canal Pro (admin e gestor) e limpa a data em que tinha saído do ar (19/11/2026). Recusa com a lista do que falta, ou quando o plano não tem vaga (plano_cheio) ou destaque (plano_sem_destaque). O portal mostra depois da próxima leitura do Grupo OLX.'
  $ddl$;
  execute 'revoke all on function public.anuncio_publicar(uuid) from public, anon';
  execute 'grant execute on function public.anuncio_publicar(uuid) to authenticated';

  -- Quem foi reposto no ar antes desta migração ficou com a data: sai agora.
  update public.anuncios set saiu_do_ar_em = null
   where situacao = 'no_ar' and saiu_do_ar_em is not null;

  -- -------------------------------------------------------------------
  -- 5. O arquivo leva as coordenadas
  -- -------------------------------------------------------------------
  -- Igual à da 20261104150000, mais `latitude` e `longitude` em cada anúncio.
  -- Quem decide se elas saem no XML é a Edge Function (só com o endereço
  -- completo à mostra).
  execute $ddl$
create or replace function public.canal_pro_feed(p_chave text, p_quem text default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $f$
declare
  c         public.canal_pro;
  v_lista   jsonb;
  v_n       int;
begin
  select * into c from public.canal_pro limit 1;
  if c.chave is null or p_chave is null or p_chave <> c.chave then
    return jsonb_build_object('ok', false);
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'codigo', a.codigo, 'titulo', a.titulo, 'descricao', a.descricao,
           'tipo', a.tipo, 'tipo_vrsync', t.vrsync, 'uso', t.uso, 'area', t.area,
           'negocio', a.negocio, 'destaque', a.destaque,
           'preco_venda', a.preco_venda, 'preco_aluguel', a.preco_aluguel,
           'periodo_aluguel', a.periodo_aluguel, 'condominio', a.condominio,
           'iptu', a.iptu, 'iptu_periodo', a.iptu_periodo,
           'area_util', a.area_util, 'area_total', a.area_total,
           'quartos', a.quartos, 'suites', a.suites, 'banheiros', a.banheiros, 'vagas', a.vagas,
           'caracteristicas', to_jsonb(a.caracteristicas),
           'cep', a.cep, 'estado', a.estado, 'cidade', a.cidade, 'bairro', a.bairro,
           'endereco', a.endereco, 'numero', a.numero, 'complemento', a.complemento,
           'mostrar_endereco', a.mostrar_endereco, 'video_youtube', a.video_youtube,
           'latitude', a.latitude, 'longitude', a.longitude,
           'fotos', (select coalesce(jsonb_agg(f.caminho order by f.posicao, f.criada_em), '[]'::jsonb)
                       from public.anuncio_fotos f where f.anuncio_id = a.id)
         ) order by a.codigo), '[]'::jsonb),
         count(*)
    into v_lista, v_n
    from public.anuncios a
    cross join lateral app.anuncio_tipo(a.tipo) t
   where a.situacao = 'no_ar'
     and a.excluido_em is null
     and cardinality(app.anuncio_pendencias(a.id)) = 0;

  insert into public.canal_pro_leituras (user_agent, do_grupo_olx, anuncios)
  values (left(p_quem, 300), coalesce(p_quem, '') ilike '%VivaRealBot%', v_n);
  delete from public.canal_pro_leituras where em < now() - interval '90 days';

  return jsonb_build_object(
    'ok', true,
    'imobiliaria', jsonb_build_object('nome', c.nome, 'email', c.email,
                                      'telefone', c.telefone, 'site', c.site),
    'anuncios', v_lista);
end $f$
  $ddl$;
  execute $ddl$
comment on function public.canal_pro_feed(text, text) is
  'Os anúncios no ar, sem pendência, para a Edge Function canal-pro-feed montar o XML VRSync, com as coordenadas desde 19/11/2026. Sem a chave certa não devolve nada; com ela, anota a leitura (p_quem = user-agent).'
  $ddl$;
  execute 'revoke all on function public.canal_pro_feed(text, text) from public';
  execute 'grant execute on function public.canal_pro_feed(text, text) to anon, authenticated, service_role';

  -- -------------------------------------------------------------------
  -- 6. A lista diz se a linha do relatório gasta destaque
  -- -------------------------------------------------------------------
  -- Igual à da 20261106100000, mais `m.destaque` na linha do relatório e a
  -- coluna nova no fim. A lista roda com o papel de quem lê (security_invoker):
  -- a regra do destaque passa a valer para quem entrou, como as outras ajudantes
  -- da lista (`app.canal_pro_campo`, `app.canal_pro_ativo_no_relatorio`). Ela só
  -- lê o texto que recebe.
  execute 'grant execute on function app.canal_pro_destaque_do_relatorio(text) to authenticated';
  execute $ddl$
create or replace view public.anuncios_na_lista
with (security_invoker = true) as
select a.id, a.codigo, a.situacao, a.titulo, a.tipo, a.negocio,
       a.preco_venda, a.preco_aluguel, a.periodo_aluguel,
       a.area_util, a.area_total, a.quartos, a.bairro, a.cidade, a.destaque,
       a.criado_em, a.updated_at, a.publicado_em, a.saiu_do_ar_em,
       a.excluido_em, a.motivo_exclusao, a.proprietario_id,
       (select count(*) from public.anuncio_fotos f where f.anuncio_id = a.id)::int as fotos,
       (select f.caminho from public.anuncio_fotos f
         where f.anuncio_id = a.id order by f.posicao, f.criada_em limit 1) as capa,
       app.anuncio_pendencias(a.id) as pendencias,
       o.name as proprietario_nome,
       criador.full_name as criado_por_nome,
       (select m.codigo from public.anuncios_no_canal_pro m where m.anuncio_id = a.id) as codigo_no_canal_pro,
       coalesce(pl.leads, 0)::int as leads,
       a.suites, a.banheiros, a.vagas, a.condominio, a.iptu, a.cep, a.estado, a.endereco, a.numero,
       a.mostrar_endereco, a.video_youtube,
       char_length(btrim(coalesce(a.descricao, '')))::int as descricao_tamanho,
       coalesce(cardinality(a.caracteristicas), 0)::int as caracteristicas_qtd,
       a.origem, a.importado_em,
       (select max(l.em) from public.canal_pro_leituras l where l.do_grupo_olx) as ultima_leitura_do_portal,
       rel.situacao as no_canal_pro_situacao,
       rel.visto_em as no_canal_pro_visto_em,
       rel.visualizacoes as no_canal_pro_visualizacoes,
       rel.contatos as no_canal_pro_contatos,
       rel.criado_em as no_canal_pro_criado_em,
       -- Daqui para baixo, o que a 20261106100000 acrescentou.
       s.no_arquivo as no_sistema_atual,
       s.em as sistema_atual_em,
       -- E a 20261119120000: a linha do relatório gasta destaque do plano? E falta
       -- trazer o pino do mapa do arquivo do sistema atual?
       app.canal_pro_destaque_do_relatorio(rel.destaque) as no_canal_pro_com_destaque,
       (a.latitude is null and a.coordenadas_lidas_em is null) as falta_pino
  from public.anuncios a
  left join public.organizations_view o on o.id = a.proprietario_id
  left join public.profiles criador on criador.id = a.criado_por
  left join (select v.anuncio_id, count(*) as leads
               from public.portal_leads_na_lista v
              where v.anuncio_id is not null and v.grupo = 'mensagem' and v.situacao <> 'descartado'
              group by v.anuncio_id) pl on pl.anuncio_id = a.id
  left join public.sistema_atual_no_arquivo s on s.codigo = a.codigo
  left join lateral (
    select m.situacao, m.visto_em, m.destaque,
           app.canal_pro_inteiro(app.canal_pro_campo(m.linha, array['total de visualizacoes', 'visualizacoes']))::int
             as visualizacoes,
           app.canal_pro_inteiro(app.canal_pro_campo(m.linha, array['total de contatos', 'contatos']))::int
             as contatos,
           case when app.canal_pro_campo(m.linha, array['criacao', 'data de criacao']) ~ '^\d{2}-\d{2}-\d{4}$'
                then to_date(app.canal_pro_campo(m.linha, array['criacao', 'data de criacao']), 'DD-MM-YYYY') end
             as criado_em
      from public.anuncios_no_canal_pro m
     -- Só o que ainda está no último relatório: o que saiu dele não está mais no Canal Pro.
     where (m.anuncio_id = a.id or m.codigo = a.codigo) and m.excluido_em is null and m.no_relatorio
     order by (m.anuncio_id = a.id) desc, m.visto_em desc nulls last
     limit 1) rel on true
  $ddl$;
  execute $ddl$
comment on view public.anuncios_na_lista is
  'A lista de Anúncios: fotos, capa, pendências, proprietário, leads que mandaram mensagem, o que o cartão do Canal Pro mostra (cômodos, endereço, insumos da nota, última leitura do Grupo OLX), o que o último relatório do Canal Pro disse do anúncio (situação, visualizações, contatos, data de criação, se gasta destaque) e se ele está no arquivo do sistema atual (e desde quando).'
  $ddl$;
  execute 'revoke all on public.anuncios_na_lista from anon';
  execute 'grant select on public.anuncios_na_lista to authenticated';

  -- -------------------------------------------------------------------
  -- 7. Os imóveis que a IA conhece, sem as cópias do relatório
  -- -------------------------------------------------------------------
  -- Igual à da 20261109130000, mais duas linhas no filtro do relatório.
  execute $ddl$
create or replace function app.ia_atendente_imoveis()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_crm    jsonb := '[]'::jsonb;
  v_manual jsonb := '[]'::jsonb;
  -- Sem a regra do relatório (banco sem a 20261105150000), tudo conta como no ar.
  v_ativo  text := case when to_regprocedure('app.canal_pro_ativo_no_relatorio(text)') is not null
                        then 'app.canal_pro_ativo_no_relatorio(j ->> ''situacao'')'
                        else 'true' end;
begin
  if to_regclass('public.anuncios') is not null then
    begin
      execute $q$
        select coalesce(jsonb_agg(jsonb_build_object(
                 'codigo',          j ->> 'codigo',
                 'situacao',        j ->> 'situacao',
                 'titulo',          nullif(j ->> 'titulo', ''),
                 'tipo',            j ->> 'tipo',
                 'negocio',         j ->> 'negocio',
                 'preco_venda',     (j ->> 'preco_venda')::bigint,
                 'preco_aluguel',   (j ->> 'preco_aluguel')::bigint,
                 'periodo_aluguel', j ->> 'periodo_aluguel',
                 'condominio',      (j ->> 'condominio')::bigint,
                 'iptu',            (j ->> 'iptu')::bigint,
                 'iptu_periodo',    j ->> 'iptu_periodo',
                 'area_util',       (j ->> 'area_util')::int,
                 'area_total',      (j ->> 'area_total')::int,
                 'quartos',         (j ->> 'quartos')::int,
                 'suites',          (j ->> 'suites')::int,
                 'banheiros',       (j ->> 'banheiros')::int,
                 'vagas',           (j ->> 'vagas')::int,
                 'caracteristicas', coalesce(j -> 'caracteristicas', '[]'::jsonb),
                 'bairro',          j ->> 'bairro',
                 'cidade',          j ->> 'cidade',
                 'estado',          j ->> 'estado',
                 'rua',             case when j ->> 'mostrar_endereco' in ('completo', 'rua')
                                         then nullif(j ->> 'endereco', '') end,
                 'numero',          case when j ->> 'mostrar_endereco' = 'completo'
                                         then nullif(j ->> 'numero', '') end,
                 'complemento',     case when j ->> 'mostrar_endereco' = 'completo'
                                         then nullif(j ->> 'complemento', '') end,
                 -- Inteira desde 09/11/2026: medidas, esquina e frente moram aqui.
                 'descricao',       nullif(j ->> 'descricao', ''))
               order by j ->> 'codigo'), '[]'::jsonb)
          from (select to_jsonb(a) as j from public.anuncios a) s
         where (j ->> 'excluido_em') is null
      $q$ into v_crm;
    exception when others then
      raise warning 'ia_atendente_imoveis: não consegui ler public.anuncios: %', sqlerrm;
      v_crm := '[]'::jsonb;
    end;
  end if;

  if to_regclass('public.anuncios_no_canal_pro') is not null then
    begin
      execute format($q$
        select coalesce(jsonb_agg(jsonb_build_object(
                 'codigo',        j ->> 'codigo',
                 'situacao',      case when %s then 'no_ar' else 'pausado' end,
                 'titulo',        nullif(j ->> 'titulo', ''),
                 'tipo',          coalesce(j ->> 'tipo_crm', j ->> 'tipo'),
                 'negocio',       j ->> 'negocio',
                 'preco_venda',   (j ->> 'preco_venda')::bigint,
                 'preco_aluguel', (j ->> 'preco_aluguel')::bigint,
                 'area_util',     (j ->> 'area')::int,
                 'quartos',       (j ->> 'quartos')::int,
                 'bairro',        j ->> 'bairro',
                 'cidade',        j ->> 'cidade',
                 'rua',           nullif(j ->> 'endereco', ''))
               order by j ->> 'codigo'), '[]'::jsonb)
          from (select to_jsonb(m) as j from public.anuncios_no_canal_pro m) s
         where (j ->> 'excluido_em') is null
           and coalesce((j ->> 'no_relatorio')::boolean, true)
           and (j ->> 'anuncio_id') is null
           -- 19/11/2026: a cópia marcada como excluída no Canal Pro não entra, e
           -- a linha de um código que o CRM tem é o próprio anúncio do CRM (que
           -- já está na lista, com a situação do CRM).
           and (j ->> 'marcado_excluido_em') is null
           and not exists (select 1 from public.anuncios a
                            where a.excluido_em is null and a.codigo = j ->> 'codigo')
      $q$, v_ativo) into v_manual;
    exception when others then
      raise warning 'ia_atendente_imoveis: não consegui ler public.anuncios_no_canal_pro: %', sqlerrm;
      v_manual := '[]'::jsonb;
    end;
  end if;

  return v_crm || v_manual;
end $$
  $ddl$;
  execute $ddl$
comment on function app.ia_atendente_imoveis() is
  'Os imóveis que a IA que atende conhece: os da aba Anúncios (menos os excluídos), com a descrição inteira desde 09/11/2026, e os anúncios feitos à mão no Canal Pro que não estão no CRM (nem pelo código, desde 19/11/2026) e não foram marcados como excluídos (os inativos no relatório vão como pausado). Endereço só até onde o anúncio mostra.'
  $ddl$;
  execute 'revoke all on function app.ia_atendente_imoveis() from public, anon, authenticated';

  -- -------------------------------------------------------------------
  -- 8. Salvar com outro endereço tira o pino velho
  -- -------------------------------------------------------------------
  -- Igual à da 20261116120000, linha por linha, mais `v_outro_lugar` e as duas
  -- linhas das coordenadas no UPDATE.
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
  v_outro_lugar boolean := false;
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

  -- O pino do mapa é do endereço (19/11/2026): mudou o CEP, o estado, a cidade,
  -- o bairro, a rua, o número ou o complemento, as coordenadas saem e o portal
  -- acha o lugar pelo endereço novo. Salvar sem mudar o endereço não as toca.
  -- Os valores novos são os mesmos que o UPDATE grava logo abaixo.
  v_outro_lugar := a.id is not null
    and (a.cep, a.estado, a.cidade, a.bairro, a.endereco, a.numero, a.complemento)
        is distinct from
        (nullif(regexp_replace(coalesce(r.cep, ''), '[^0-9]', '', 'g'), ''),
         nullif(upper(btrim(coalesce(r.estado, ''))), ''),
         nullif(btrim(coalesce(r.cidade, '')), ''),
         nullif(btrim(coalesce(r.bairro, '')), ''),
         nullif(btrim(coalesce(r.endereco, '')), ''),
         nullif(btrim(coalesce(r.numero, '')), ''),
         nullif(btrim(coalesce(r.complemento, '')), ''));

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
      largura_terreno     = r.largura_terreno,
      comprimento_terreno = r.comprimento_terreno,
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
      latitude         = case when v_outro_lugar then null else latitude end,
      longitude        = case when v_outro_lugar then null else longitude end,
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
  'Cria (p_id nulo) ou salva o anúncio com o formulário inteiro. Equipe toda em rascunho e fora do ar; no ar, só admin e gestor, e só sem pendência. O código sai da tag do tipo (TE, SA, IM, CO) e do próximo número livre: ao criar e, no rascunho do CRM que nunca foi ao ar, quando o tipo pede outra tag; nos outros, o código fica. Não publica nada: devolve o que falta para ir ao ar. Mudou o endereço, as coordenadas saem (19/11/2026).'
  $ddl$;
  execute 'revoke all on function public.anuncio_salvar(jsonb, uuid) from public, anon';
  execute 'grant execute on function public.anuncio_salvar(jsonb, uuid) to authenticated';
end $troca$;
