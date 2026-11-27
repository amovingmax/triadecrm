-- =====================================================================
-- A IA que atende lê as vantagens de mercado aprovadas — só na Imova
-- (19/11/2026, etapa 6 da inteligência de mercado)
--
-- Decisões do dono (entrevista de 18/11/2026): "o sistema calcula, a IA
-- interpreta"; a IA só recebe comparações aprovadas pela gestão (número, fonte
-- e data) e escolhe uma por mensagem, no momento certo; sem vantagem
-- verdadeira para o momento, segue a conversa normal. É a única etapa que
-- muda o que o cliente lê; por isso entra com uma PORTEIRA.
--
-- O QUE ENTRA:
--   * `app.mercado_ia_clientes()`: a chave nova `app_settings['mercado'] ->
--     'ia_clientes'` (padrão false: a chave ausente é desligada; só o texto
--     "true" liga, a mesma régua de `app.mercado_ligado()`). Fora da Imova,
--     sempre false.
--   * `app.ia_vantagens_de_mercado(conversa)`: o que a IA que atende recebe do
--     mercado NESTA conversa. É `app.mercado_vantagens_para_ia()` (só
--     aprovadas, válidas, com a ficha igual, sem marca que bloqueia, sem prova,
--     sem link e sem nome de fonte de anúncio; por código de imóvel), mais o
--     `aviso` de cada vantagem (o "diga junto" que a 20261119164000 guarda e
--     a leitura de lá não devolve), com o mesmo filtro de nome de fonte. A
--     PORTEIRA: com `ia_clientes` desligada, só a conversa do treino e as
--     conversas de teste (`app.ia_conversa_de_treino()`,
--     `app.ia_conversa_de_teste()`, as duas da equipe) recebem; com ela
--     ligada, todas. Fora da Imova, ou com qualquer erro na leitura, `{}`
--     (a IA segue como antes, nunca fica sem responder por causa do mercado).
--   * `public.ia_entrada_do_atendente` ganha a chave `vantagens_de_mercado`,
--     depois do e-mail. O worker com o prompt v6 ignora a chave; o v7 monta o
--     bloco VANTAGENS DE MERCADO com ela e, com `{}`, é a v6 palavra por
--     palavra. Banco sem a IA que atende (a KOMUNE em produção): pula.
--   * `public.mercado_ia_clientes_ligar(p_ligar, p_motivo)`: a porta da tela,
--     no padrão de `public.mercado_coleta_ligar` (admin e gestor; motivo de 5
--     caracteres ou mais; grava `ia_clientes`, `ia_clientes_mudou_por`,
--     `ia_clientes_mudou_em` e `ia_clientes_motivo` sem mexer nas outras
--     chaves, inclusive a da coleta; o antes e o depois no audit_log; pedir o
--     que já vale não grava; fora da Imova, `so_imova` sem gravar).
--
-- Nenhum dado muda: a chave nasce desligada por ausência.
--
-- COMO DESFAZER (em qualquer banco; nesta ordem, porque a entrada chama a função):
--   do $d$ declare v text; begin
--     if to_regprocedure('public.ia_entrada_do_atendente(uuid)') is not null then
--       v := pg_get_functiondef('public.ia_entrada_do_atendente(uuid)'::regprocedure);
--       v := regexp_replace(v, E',\\s*-- As vantagens de mercado \\(20261127151000\\)[^\\n]*\\n(\\s*--[^\\n]*\\n)*\\s*''vantagens_de_mercado'', app\\.ia_vantagens_de_mercado\\(c\\.id\\)\\);', ');');
--       if position('ia_vantagens_de_mercado' in v) = 0 then execute v; end if;
--     end if;
--   end $d$;
--   drop function if exists public.mercado_ia_clientes_ligar(boolean, text),
--     app.ia_vantagens_de_mercado(uuid), app.mercado_ia_clientes();
--   update public.app_settings
--      set value = value - 'ia_clientes' - 'ia_clientes_mudou_por' - 'ia_clientes_mudou_em' - 'ia_clientes_motivo'
--    where key = 'mercado';
--   (O worker com o prompt v7 e sem a chave na entrada volta a ser a v6.)
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. A chave: a IA usa as vantagens com clientes?
-- ---------------------------------------------------------------------
create or replace function app.mercado_ia_clientes()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.empresa_do_banco() is not distinct from 'imova'
     and coalesce(app.mercado_config() ->> 'ia_clientes', 'false') = 'true'
$$;
comment on function app.mercado_ia_clientes() is
  'A IA que atende usa as vantagens de mercado com todos os clientes (app_settings mercado.ia_clientes)? Desligada (o padrão), só a conversa do treino e as de teste recebem. Fora da Imova, sempre false.';
revoke all on function app.mercado_ia_clientes() from public, anon;
grant execute on function app.mercado_ia_clientes() to authenticated, service_role;

-- ---------------------------------------------------------------------
-- 2. O que a IA recebe do mercado nesta conversa
-- ---------------------------------------------------------------------
-- plpgsql de propósito: o corpo cita public.mercado_argumentos e as funções da
-- IA que atende, que só existem na Imova; a função nasce em qualquer banco e,
-- fora da Imova, devolve {} antes de chegar a elas.
create or replace function app.ia_vantagens_de_mercado(p_conversation_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_tudo   jsonb;
  v_saida  jsonb := '{}'::jsonb;
  v_lista  jsonb;
  v_aviso  text;
  k        record;
  d        record;
begin
  if p_conversation_id is null or public.empresa_do_banco() is distinct from 'imova' then
    return '{}'::jsonb;
  end if;
  if to_regclass('public.mercado_argumentos') is null
     or to_regprocedure('app.ia_conversa_de_treino()') is null then
    return '{}'::jsonb;
  end if;

  begin
    -- A porteira: até a gestão ligar `ia_clientes`, só as conversas da equipe.
    if not (app.mercado_ia_clientes()
            or p_conversation_id is not distinct from app.ia_conversa_de_treino()
            or app.ia_conversa_de_teste(p_conversation_id)) then
      return '{}'::jsonb;
    end if;

    v_tudo := app.mercado_vantagens_para_ia();
    if v_tudo is null or jsonb_typeof(v_tudo) <> 'object' then
      return '{}'::jsonb;
    end if;

    for k in select e.key, e.value from jsonb_each(v_tudo) e order by e.key loop
      continue when jsonb_typeof(k.value) <> 'object'
                 or jsonb_typeof(k.value -> 'diferenciais') is distinct from 'array';
      v_lista := '[]'::jsonb;
      for d in select x.item from jsonb_array_elements(k.value -> 'diferenciais') with ordinality as x(item, ord)
                order by x.ord loop
        v_aviso := null;
        select nullif(btrim(a.aviso), '') into v_aviso
          from public.mercado_argumentos a
         where a.imovel_codigo = k.key and a.chave = d.item ->> 'id'
         limit 1;
        -- O aviso que nomeia uma fonte de anúncio não vai; e a vantagem não vai
        -- sem o que tem de ir junto com ela.
        continue when v_aviso is not null and app.mercado_nomeia_fonte(v_aviso);
        v_lista := v_lista || jsonb_build_array(
          d.item || case when v_aviso is null then '{}'::jsonb
                         else jsonb_build_object('aviso', left(v_aviso, 500)) end);
      end loop;
      if jsonb_array_length(v_lista) > 0 then
        v_saida := v_saida || jsonb_build_object(k.key, k.value || jsonb_build_object('diferenciais', v_lista));
      end if;
    end loop;
    return v_saida;
  exception when others then
    -- O mercado nunca deixa a IA sem responder: na dúvida, ela segue sem vantagens.
    raise warning 'app.ia_vantagens_de_mercado: não deu para ler as vantagens (%): a IA segue sem elas', sqlerrm;
    return '{}'::jsonb;
  end;
end $$;
comment on function app.ia_vantagens_de_mercado(uuid) is
  'As vantagens de mercado que a IA que atende recebe nesta conversa (app.mercado_vantagens_para_ia, com o aviso de cada uma): com mercado.ia_clientes desligada, só a conversa do treino e as de teste; ligada, todas. Fora da Imova ou com erro, {}.';
revoke all on function app.ia_vantagens_de_mercado(uuid) from public, anon, authenticated;
grant execute on function app.ia_vantagens_de_mercado(uuid) to service_role;

-- ---------------------------------------------------------------------
-- 3. A porta da tela: ligar e desligar as vantagens com os clientes
-- ---------------------------------------------------------------------
create or replace function public.mercado_ia_clientes_ligar(p_ligar boolean, p_motivo text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ligar  boolean := coalesce(p_ligar, false);
  v_motivo text := left(btrim(coalesce(p_motivo, '')), 1000);
  v_antes  jsonb;
  v_depois jsonb;
  v_estava boolean;
begin
  if not app.admin_ou_gestor() then
    raise exception 'Só admin e gestor ligam ou desligam as vantagens de mercado na IA.' using errcode = '42501';
  end if;
  -- `is distinct from`: banco sem identidade também recusa (a IA que atende é só da Imova).
  if public.empresa_do_banco() is distinct from 'imova' then
    return jsonb_build_object('ok', false, 'motivo', 'so_imova');
  end if;
  if char_length(v_motivo) < 5 then
    return jsonb_build_object('ok', false, 'motivo', 'motivo_obrigatorio');
  end if;

  -- A chave nasce na 20261119160000; se alguém a apagou, volta aqui (desligada).
  insert into public.app_settings (key, value, description)
  values ('mercado', '{"ligado": false}'::jsonb,
          'Inteligência de mercado (só Imova, 18/11/2026). ligado: o worker grava e a IA lê as vantagens aprovadas. O teto da renovação automática fica na régua com versão (mercado_regras), não aqui. Na KOMUNE fica sempre desligada.')
  on conflict (key) do nothing;

  select s.value into v_antes from public.app_settings s where s.key = 'mercado' for update;
  if v_antes is null or jsonb_typeof(v_antes) <> 'object' then
    v_antes := '{}'::jsonb;
  end if;
  v_estava := coalesce(v_antes ->> 'ia_clientes', 'false') = 'true';

  if v_estava = v_ligar then
    return jsonb_build_object('ok', true, 'mudou', false, 'ia_clientes', v_ligar,
                              'ia_clientes_de_fato', app.mercado_ia_clientes(),
                              'coleta_ligada', app.mercado_ligado());
  end if;

  -- Só as chaves desta porta: `ligado`, `mudou_por`, `mudou_em` e `motivo` são da coleta.
  v_depois := v_antes || jsonb_build_object('ia_clientes', v_ligar, 'ia_clientes_mudou_por', auth.uid(),
                                            'ia_clientes_mudou_em', now(), 'ia_clientes_motivo', v_motivo);
  update public.app_settings set value = v_depois where key = 'mercado';

  insert into public.audit_log (actor_id, actor_role, action, table_name, row_id, old_data, new_data)
  values (auth.uid(), app.role()::text, 'UPDATE', 'app_settings', 'mercado',
          jsonb_build_object('ia_clientes', v_estava, 'ia_clientes_mudou_por', v_antes -> 'ia_clientes_mudou_por',
                             'ia_clientes_mudou_em', v_antes -> 'ia_clientes_mudou_em',
                             'ia_clientes_motivo', v_antes -> 'ia_clientes_motivo'),
          jsonb_build_object('ia_clientes', v_ligar, 'ia_clientes_mudou_por', auth.uid(),
                             'ia_clientes_motivo', v_motivo));

  return jsonb_build_object('ok', true, 'mudou', true, 'ia_clientes', v_ligar,
                            'ia_clientes_de_fato', app.mercado_ia_clientes(),
                            'coleta_ligada', app.mercado_ligado());
end $$;
comment on function public.mercado_ia_clientes_ligar(boolean, text) is
  'Admin e gestor ligam ou desligam as vantagens de mercado na IA com todos os clientes (app_settings mercado.ia_clientes), com motivo de 5 caracteres ou mais; o antes e o depois vão para o audit_log. Desligada, só a conversa do treino e as de teste recebem. Só na Imova: em outro banco devolve ok false, so_imova, sem gravar.';
revoke all on function public.mercado_ia_clientes_ligar(boolean, text) from public, anon;
grant execute on function public.mercado_ia_clientes_ligar(boolean, text) to authenticated;

-- ---------------------------------------------------------------------
-- 4. A entrada do worker ganha `vantagens_de_mercado`, depois do e-mail
-- ---------------------------------------------------------------------
do $migr$
declare
  v_def    text;
  v_ancora text := $a$'email', app.ia_email_do_cliente(c.id));$a$;
  v_vezes  int;
begin
  -- Banco sem a IA que atende (a KOMUNE em produção: a 20261106170000 não
  -- cria nada lá): não há entrada do worker para ganhar a chave.
  if to_regprocedure('public.ia_entrada_do_atendente(uuid)') is null then
    raise notice 'Sem public.ia_entrada_do_atendente neste banco (a IA que atende é só da Imova): nada a trocar.';
    return;
  end if;
  v_def := pg_get_functiondef('public.ia_entrada_do_atendente(uuid)'::regprocedure);
  if position('app.ia_vantagens_de_mercado' in v_def) > 0 then
    return;
  end if;
  v_vezes := (length(v_def) - length(replace(v_def, v_ancora, ''))) / length(v_ancora);
  if v_vezes = 0 then
    -- Banco sem o e-mail (20261118150000): depois dos convites da agenda.
    v_ancora := $a$'convites_da_agenda', app.ia_convites_da_agenda(c.id));$a$;
    v_vezes := (length(v_def) - length(replace(v_def, v_ancora, ''))) / length(v_ancora);
  end if;
  if v_vezes = 0 then
    -- Banco sem os convites da agenda (20261112160000): depois das mensagens.
    v_ancora := $a$'mensagens', v_msgs);$a$;
    v_vezes := (length(v_def) - length(replace(v_def, v_ancora, ''))) / length(v_ancora);
  end if;
  if v_vezes <> 1 then
    raise exception 'public.ia_entrada_do_atendente não termina no e-mail, nos convites da agenda nem nas mensagens exatamente uma vez (achei %): nada foi trocado.', v_vezes;
  end if;
  execute replace(v_def, v_ancora,
    replace(v_ancora, ');', ',') || $a$
    -- As vantagens de mercado (20261127151000): as aprovadas e válidas, por
    -- código de imóvel; até a gestão ligar mercado.ia_clientes, só nas
    -- conversas do treino e de teste. Sem vantagem, {}.
    'vantagens_de_mercado', app.ia_vantagens_de_mercado(c.id));$a$);
end $migr$;

do $migr$
begin
  if to_regprocedure('public.ia_entrada_do_atendente(uuid)') is not null then
    comment on function public.ia_entrada_do_atendente(uuid) is
  'Porta do worker de IA: o que a IA que atende lê de uma conversa (Imova): as 40 mensagens mais recentes, o cliente (ficha, etapa, perfil, visitas, canal de chegada), os horários livres de visita, se é a conversa do treino, convites_da_agenda (11/11/2026), email (17/11/2026: na_ficha, ofertas, ofertas_em; nunca o endereço) e vantagens_de_mercado (19/11/2026: as aprovadas, por código de imóvel; até mercado.ia_clientes ligar, só no treino e nas conversas de teste).';
  end if;
end $migr$;

notify pgrst, 'reload schema';
