-- =====================================================================
-- A conversa de teste da IA que atende — só na Imova (10/11/2026)
--
-- Pedido do usuário: "Quero que a IA fale com o Matheu Rondon Teste, mas
-- utilize a conversa apenas para conversar mesmo, não para aprender."
--
-- Até aqui, no modo treino a IA só falava com UMA conversa, a do treino (a do
-- Janio), e ali tudo o que a equipe escreve pode virar regra no caderno ou
-- foto de referência. Escolher a conversa do Matheu como a do treino faria a
-- IA aprender com ela, e tiraria o Janio do treino.
--
-- O QUE ENTRA: a "conversa de teste" (até 5, escolhidas pela gestão na tela).
--   * A IA conversa ali como conversa com um cliente: mesma fala, mesmos
--     anúncios, mesmo caderno, mesmas regras de verdade.
--   * Nada é aprendido ali: a entrada do worker diz `treino: false`, e
--     `ia_atendente_anotar` e `ia_foto_ensinar` continuam aceitando só a
--     conversa do treino (as duas não mudam; quem barra é o banco).
--   * Vale também no modo treino: com o modo treino, a IA atende a conversa
--     do treino e as de teste, e mais nenhuma.
--   * Passar para um corretor, ali, é como no treino: o aviso sai (quem testa
--     vê o que o cliente veria), mas a IA continua, o responsável não muda e
--     não nasce tarefa para corretor por uma conversa de mentira.
--   * A conversa do treino não pode ser de teste; escolher uma conversa de
--     teste como a do treino a tira da lista de teste (lá ela aprende).
--   * Marcar liga a IA na conversa (o que o time escreveu antes não a deixa
--     parada); desmarcar a para ali.
--
-- Funções:
--   app.ia_atendente_config      ganha o padrão `conversas_de_teste: []`;
--   app.ia_conversas_de_teste    (nova) a lista;
--   app.ia_conversa_de_teste     (nova) "esta conversa é de teste?";
--   app.ia_atende                no treino, a do treino OU uma de teste;
--   public.ia_atendente_passar   na de teste, como no treino;
--   public.ia_conversa_estado    diz `teste`;
--   public.ia_atendente_configurar  tira da lista de teste a nova do treino;
--   public.ia_atendente_painel   devolve a lista e o placar `no_teste`;
--   public.ia_conversa_de_teste_marcar (nova) marca e desmarca (admin e gestor).
--
-- Na KOMUNE não faz nada: a IA que atende não existe lá.
--
-- COMO DESFAZER: reaplicar app.ia_atendente_config, public.ia_atendente_painel
--   (20261106170000), public.ia_atendente_configurar (20261106180000),
--   app.ia_atende e public.ia_conversa_estado (20261106190000),
--   public.ia_atendente_passar (20261106193000); drop das três funções novas; e
--   update public.app_settings set value = value - 'conversas_de_teste'
--    where key = 'ia.atendente';
-- =====================================================================

do $teste$
begin
  if (select i.empresa from app.identidade i) = 'komune' then
    raise notice 'A IA que atende é só da Imova: no banco da KOMUNE nada mudou.';
    return;
  end if;

  execute $ddl$

-- ---------------------------------------------------------------------
-- 1. A configuração ganha o padrão da lista
-- ---------------------------------------------------------------------
create or replace function app.ia_atendente_config()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
           'ligada', false,
           'modo', 'treino',
           'conversa_de_treino', null,
           'conversas_de_teste', '[]'::jsonb,
           'assinatura', 'Imova',
           'modelo', 'claude-opus-5-5',
           'esforco', 'low',
           'espera_seg', 15,
           'teto_por_hora', 20,
           'setor_corretores', null,
           'aviso_corretor', 'Certo! Já vou te passar para um dos nossos corretores, que continua o atendimento com você por aqui.',
           'ligada_em', null)
      || coalesce((select s.value from public.app_settings s where s.key = 'ia.atendente'), '{}'::jsonb)
$$;
comment on function app.ia_atendente_config() is
  'A configuração da IA que atende (app_settings ia.atendente) sobre os valores padrão. conversas_de_teste (10/11/2026): conversas em que a IA conversa como com um cliente, sem aprender.';
revoke all on function app.ia_atendente_config() from public, anon;
grant execute on function app.ia_atendente_config() to authenticated, service_role;

-- ---------------------------------------------------------------------
-- 2. A lista e a pergunta "esta conversa é de teste?"
-- ---------------------------------------------------------------------
create or replace function app.ia_conversas_de_teste()
returns uuid[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(distinct app.uuid_seguro(x.v)) filter (where app.uuid_seguro(x.v) is not null),
                  '{}'::uuid[])
    from (select app.ia_atendente_config() -> 'conversas_de_teste' as lista) l
    cross join lateral jsonb_array_elements_text(
      case when jsonb_typeof(l.lista) = 'array' then l.lista else '[]'::jsonb end) as x(v)
$$;
comment on function app.ia_conversas_de_teste() is
  'As conversas de teste da IA que atende (Imova, 10/11/2026): a IA conversa ali como com um cliente, sem aprender nada.';
revoke all on function app.ia_conversas_de_teste() from public, anon;
grant execute on function app.ia_conversas_de_teste() to authenticated, service_role;

create or replace function app.ia_conversa_de_teste(p_conversation_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_conversation_id is not null and p_conversation_id = any(app.ia_conversas_de_teste())
$$;
revoke all on function app.ia_conversa_de_teste(uuid) from public, anon;
grant execute on function app.ia_conversa_de_teste(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- 3. A IA atende esta conversa agora? No treino: a do treino ou uma de teste.
-- ---------------------------------------------------------------------
create or replace function app.ia_atende(p_conversation_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_cfg   jsonb := app.ia_atendente_config();
  c       public.conversations%rowtype;
  a       public.ia_atendimento%rowtype;
  v_desde timestamptz;
begin
  if not coalesce((v_cfg ->> 'ligada')::boolean, false) then
    return false;
  end if;
  select * into c from public.conversations where id = p_conversation_id;
  if not found or c.channel <> 'whatsapp'::app.channel or c.bloqueada_em is not null then
    return false;
  end if;
  -- O robô pausado (freio do RF-CON-20 ou opt-out): a porteira recusaria.
  if c.bot_paused then
    return false;
  end if;
  select * into a from public.ia_atendimento where conversation_id = p_conversation_id;
  if a.estado = 'parada' then
    return false;
  end if;
  if c.id is distinct from app.ia_conversa_de_treino()
     and not app.ia_conversa_de_teste(c.id)
     and coalesce(v_cfg ->> 'modo', 'treino') <> 'clientes' then
    return false;
  end if;
  v_desde := coalesce(a.mudou_em, '-infinity'::timestamptz);
  if exists (select 1 from public.messages m
              where m.conversation_id = p_conversation_id
                and m.direction = 'out'::app.msg_direction
                and m.author_kind = 'human'
                and m.created_at > v_desde) then
    return false;
  end if;
  return true;
end $$;
comment on function app.ia_atende(uuid) is
  'A IA que atende (Imova) responde nesta conversa agora? Chave ligada, WhatsApp, não bloqueada, robô não pausado, não parada, do treino, de teste (10/11/2026) ou modo clientes, e sem mensagem de gente do time desde que a IA começou ali.';
revoke all on function app.ia_atende(uuid) from public, anon;
grant execute on function app.ia_atende(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- 4. Passar para um corretor: na conversa de teste, como no treino
-- ---------------------------------------------------------------------
create or replace function public.ia_atendente_passar(
  p_conversation_id uuid, p_em_resposta_a uuid, p_texto text, p_motivo text,
  p_ai_run_id bigint default null, p_prompt_version text default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_texto  text := coalesce(nullif(btrim(coalesce(p_texto, '')), ''),
                            app.ia_atendente_config() ->> 'aviso_corretor');
  v_disse  jsonb;
  v_para   uuid;
  v_treino boolean := p_conversation_id is not distinct from app.ia_conversa_de_treino();
  v_teste  boolean := app.ia_conversa_de_teste(p_conversation_id);
begin
  v_disse := app.ia_atendente_dizer(p_conversation_id, p_em_resposta_a, v_texto, 'passou_para_pessoa',
                                    jsonb_build_object('motivo', left(coalesce(p_motivo, ''), 300)),
                                    p_ai_run_id, p_prompt_version);
  -- Chegou mensagem nova: a próxima rodada decide de novo (pode ser outra coisa).
  if v_disse ->> 'motivo' in ('chegou_mensagem_nova', 'ja_respondida', 'conversa_nao_existe') then
    return v_disse;
  end if;
  -- No treino e no teste, passar é simulação: o aviso sai, e a IA continua ali.
  if v_treino or v_teste then
    return v_disse || jsonb_build_object('passada_para', null, 'treino', v_treino, 'teste', v_teste);
  end if;
  -- Disse ou não (porteira, teto), a conversa vai para gente.
  if app.ia_atende(p_conversation_id) or coalesce((v_disse ->> 'ok')::boolean, false) then
    v_para := app.ia_atendente_entregar(p_conversation_id, p_motivo);
  end if;
  return v_disse || jsonb_build_object('passada_para', v_para);
end $$;
comment on function public.ia_atendente_passar(uuid, uuid, text, text, bigint, text) is
  'Porta do worker de IA: a IA avisa o cliente que vai passar (texto dela ou o aviso padrão) e entrega a conversa a uma pessoa, com tarefa para agora. Na conversa do treino (desde 06/11/2026) e nas de teste (desde 10/11/2026) o aviso sai e a IA continua atendendo, sem trocar o responsável nem abrir tarefa.';
revoke all on function public.ia_atendente_passar(uuid, uuid, text, text, bigint, text) from public, anon, authenticated;
grant execute on function public.ia_atendente_passar(uuid, uuid, text, text, bigint, text) to service_role;

-- ---------------------------------------------------------------------
-- 5. O estado na conversa diz se ela é de teste
-- ---------------------------------------------------------------------
create or replace function public.ia_conversa_estado(p_conversation_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_cfg    jsonb := app.ia_atendente_config();
  a        public.ia_atendimento%rowtype;
  v_pausou boolean;
begin
  if auth.uid() is null or not app.is_manager() then
    return jsonb_build_object('existe', false);
  end if;
  select * into a from public.ia_atendimento where conversation_id = p_conversation_id;
  v_pausou := coalesce((select c.bot_paused from public.conversations c where c.id = p_conversation_id), false)
              and a.estado is distinct from 'parada';
  return jsonb_build_object(
    'existe', true,
    'ligada', coalesce((v_cfg ->> 'ligada')::boolean, false),
    'modo', v_cfg ->> 'modo',
    'treino', p_conversation_id is not distinct from app.ia_conversa_de_treino(),
    'teste', app.ia_conversa_de_teste(p_conversation_id),
    'atende', app.ia_atende(p_conversation_id),
    'estado', case when v_pausou then 'parada' else a.estado end,
    'motivo', case when v_pausou
                   then 'O freio do WhatsApp pausou o robô nesta conversa (respostas rápidas ou repetidas demais, ou o cliente pediu para sair). Ligar a IA de novo tira a pausa.'
                   else a.motivo end,
    'mudou_em', a.mudou_em,
    'mudou_por', app.primeiro_nome(a.mudou_por),
    'passada_para', app.primeiro_nome(a.passada_para));
end $$;
revoke all on function public.ia_conversa_estado(uuid) from public, anon;
grant execute on function public.ia_conversa_estado(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- 6. Marcar e desmarcar uma conversa de teste (admin e gestor)
-- ---------------------------------------------------------------------
create or replace function public.ia_conversa_de_teste_marcar(p_conversation_id uuid, p_teste boolean)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_atual jsonb;
  v_lista uuid[];
  v_era   boolean;
begin
  if auth.uid() is null or not app.admin_ou_gestor() then
    return jsonb_build_object('ok', false, 'motivo', 'sem_permissao');
  end if;
  if p_conversation_id is null or not exists (
       select 1 from public.conversations c
        where c.id = p_conversation_id and c.channel = 'whatsapp'::app.channel) then
    return jsonb_build_object('ok', false, 'motivo', 'conversa_inexistente');
  end if;

  -- Uma pessoa por vez mexe na configuração.
  select s.value into v_atual from public.app_settings s where s.key = 'ia.atendente' for update;
  v_atual := coalesce(v_atual, '{}'::jsonb);
  v_lista := app.ia_conversas_de_teste();
  v_era := p_conversation_id = any(v_lista);

  if coalesce(p_teste, false) then
    if p_conversation_id is not distinct from app.ia_conversa_de_treino() then
      return jsonb_build_object('ok', false, 'motivo', 'e_a_conversa_do_treino');
    end if;
    if not v_era then
      if cardinality(v_lista) >= 5 then
        return jsonb_build_object('ok', false, 'motivo', 'muitas_conversas_de_teste');
      end if;
      v_lista := v_lista || p_conversation_id;
    end if;
  else
    v_lista := array_remove(v_lista, p_conversation_id);
  end if;

  insert into public.app_settings (key, value, description)
  values ('ia.atendente', v_atual || jsonb_build_object('conversas_de_teste', to_jsonb(v_lista::text[])),
          'A IA que atende o cliente sozinha (Imova, 06/11/2026). Mudada pela tela (public.ia_atendente_configurar e public.ia_conversa_de_teste_marcar).')
  on conflict (key) do update set value = excluded.value;

  -- Marcar liga a IA ali (o que o time escreveu antes não a deixa parada);
  -- desmarcar a para ali (sem isso, no modo clientes ela continuaria).
  if coalesce(p_teste, false) and not v_era then
    perform app.ia_atendente_mudar(p_conversation_id, 'atendendo', 'conversa de teste (a IA conversa, sem aprender)',
                                   auth.uid(), null);
  elsif not coalesce(p_teste, false) and v_era then
    perform app.ia_atendente_mudar(p_conversation_id, 'parada', 'deixou de ser conversa de teste',
                                   auth.uid(), null);
  end if;

  return jsonb_build_object('ok', true,
                            'conversas_de_teste', to_jsonb(app.ia_conversas_de_teste()::text[]),
                            'atende', app.ia_atende(p_conversation_id));
end $$;
comment on function public.ia_conversa_de_teste_marcar(uuid, boolean) is
  'A tela da IA que atende (Imova, 10/11/2026): põe ou tira uma conversa da lista de teste (até 5). Ali a IA conversa como com um cliente, também no modo treino, e não aprende nada. Marcar liga a IA na conversa; desmarcar a para. A conversa do treino não pode ser de teste. Só admin e gestor.';
revoke all on function public.ia_conversa_de_teste_marcar(uuid, boolean) from public, anon;
grant execute on function public.ia_conversa_de_teste_marcar(uuid, boolean) to authenticated;

-- ---------------------------------------------------------------------
-- 7. Configurar: a conversa escolhida para o treino sai da lista de teste
-- ---------------------------------------------------------------------
create or replace function public.ia_atendente_configurar(p_valores jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_atual  jsonb := coalesce((select s.value from public.app_settings s where s.key = 'ia.atendente'), '{}'::jsonb);
  v_novo   jsonb := v_atual;
  v_chave  text;
  v_valor  jsonb;
  v_treino uuid;
begin
  if auth.uid() is null or not app.admin_ou_gestor() then
    return jsonb_build_object('ok', false, 'motivo', 'sem_permissao');
  end if;
  for v_chave, v_valor in select * from jsonb_each(coalesce(p_valores, '{}'::jsonb)) loop
    case v_chave
      when 'ligada' then
        if jsonb_typeof(v_valor) <> 'boolean' then
          return jsonb_build_object('ok', false, 'motivo', 'ligada_nao_e_sim_ou_nao');
        end if;
        if (v_valor)::text::boolean and not coalesce((v_atual ->> 'ligada')::boolean, false) then
          v_novo := v_novo || jsonb_build_object('ligada_em', now());
        end if;
      when 'modo' then
        if v_valor #>> '{}' not in ('treino', 'clientes') then
          return jsonb_build_object('ok', false, 'motivo', 'modo_invalido');
        end if;
      when 'conversa_de_treino' then
        if jsonb_typeof(v_valor) <> 'null' then
          v_treino := app.uuid_seguro(v_valor #>> '{}');
          if v_treino is null or not exists (select 1 from public.conversations c where c.id = v_treino) then
            return jsonb_build_object('ok', false, 'motivo', 'conversa_inexistente');
          end if;
        end if;
      when 'setor_corretores' then
        if jsonb_typeof(v_valor) <> 'null'
           and not exists (select 1 from public.setores s where s.id = (v_valor #>> '{}')::int) then
          return jsonb_build_object('ok', false, 'motivo', 'setor_inexistente');
        end if;
      when 'assinatura' then
        if char_length(coalesce(v_valor #>> '{}', '')) > 40 then
          return jsonb_build_object('ok', false, 'motivo', 'assinatura_longa');
        end if;
      when 'aviso_corretor' then
        if char_length(btrim(coalesce(v_valor #>> '{}', ''))) not between 10 and 400 then
          return jsonb_build_object('ok', false, 'motivo', 'aviso_fora_do_tamanho');
        end if;
      when 'modelo' then
        if v_valor #>> '{}' not in ('claude-haiku-5-5', 'claude-sonnet-5-5', 'claude-opus-5-5') then
          return jsonb_build_object('ok', false, 'motivo', 'modelo_invalido');
        end if;
      when 'esforco' then
        if v_valor #>> '{}' not in ('low', 'medium', 'high') then
          return jsonb_build_object('ok', false, 'motivo', 'esforco_invalido');
        end if;
      when 'espera_seg' then
        if jsonb_typeof(v_valor) <> 'number' or (v_valor)::text::numeric not between 5 and 300 then
          return jsonb_build_object('ok', false, 'motivo', 'espera_fora_do_limite');
        end if;
      when 'teto_por_hora' then
        if jsonb_typeof(v_valor) <> 'number' or (v_valor)::text::numeric not between 1 and 60 then
          return jsonb_build_object('ok', false, 'motivo', 'teto_fora_do_limite');
        end if;
      else
        -- conversas_de_teste também cai aqui: muda só por public.ia_conversa_de_teste_marcar.
        return jsonb_build_object('ok', false, 'motivo', 'chave_desconhecida', 'chave', v_chave);
    end case;
    v_novo := v_novo || jsonb_build_object(v_chave, v_valor);
  end loop;

  -- A nova conversa do treino sai da lista de teste: ali ela passa a aprender.
  if v_treino is not null and app.ia_conversa_de_teste(v_treino) then
    v_novo := v_novo || jsonb_build_object(
      'conversas_de_teste', to_jsonb(array_remove(app.ia_conversas_de_teste(), v_treino)::text[]));
  end if;

  insert into public.app_settings (key, value, description)
  values ('ia.atendente', v_novo,
          'A IA que atende o cliente sozinha (Imova, 06/11/2026). Mudada pela tela (public.ia_atendente_configurar e public.ia_conversa_de_teste_marcar).')
  on conflict (key) do update set value = excluded.value;

  -- A conversa do treino nasce com a IA ligada nela (o time já tinha falado
  -- com o Janio; sem isso, "gente escreveu" a deixaria parada).
  if v_treino is not null then
    perform app.ia_atendente_mudar(v_treino, 'atendendo', 'conversa do treino', auth.uid(), null);
  end if;
  return jsonb_build_object('ok', true, 'config', app.ia_atendente_config());
end $$;
revoke all on function public.ia_atendente_configurar(jsonb) from public, anon;
grant execute on function public.ia_atendente_configurar(jsonb) to authenticated;

-- ---------------------------------------------------------------------
-- 8. O painel mostra as conversas de teste
-- ---------------------------------------------------------------------
create or replace function public.ia_atendente_painel(p_dias int default 7)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_desde  timestamptz := now() - make_interval(days => greatest(least(coalesce(p_dias, 7), 90), 1));
  v_treino uuid := app.ia_conversa_de_treino();
  v_testes uuid[] := app.ia_conversas_de_teste();
begin
  if auth.uid() is null or not app.is_manager() then
    return jsonb_build_object('existe', false);
  end if;
  return jsonb_build_object(
    'existe', true,
    'config', app.ia_atendente_config(),
    'pode_configurar', app.admin_ou_gestor(),
    'conversa_de_treino', (
      select jsonb_build_object('id', c.id, 'organization_id', c.organization_id,
               'nome', coalesce(o.name, c.peer_nome, c.peer_phone_e164))
        from public.conversations c left join public.organizations o on o.id = c.organization_id
       where c.id = v_treino),
    'conversas_de_teste', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'id', c.id, 'organization_id', c.organization_id,
               'nome', coalesce(nullif(btrim(o.name), ''), nullif(btrim(c.peer_nome), ''), 'Sem nome'),
               'telefone', app.mask_phone(c.peer_phone_e164),
               'atende', app.ia_atende(c.id))
             order by coalesce(nullif(btrim(o.name), ''), nullif(btrim(c.peer_nome), ''), 'Sem nome')), '[]'::jsonb)
        from public.conversations c left join public.organizations o on o.id = c.organization_id
       where c.id = any(v_testes)),
    'placar', (
      select jsonb_build_object(
               'respostas',   count(*) filter (where r.message_id is not null),
               'boas',        count(*) filter (where r.avaliacao = 'boa'),
               'corrigidas',  count(*) filter (where r.avaliacao = 'corrigir'),
               'sem_avaliacao', count(*) filter (where r.message_id is not null and r.avaliacao is null),
               'passadas',    count(*) filter (where r.acao = 'passou_para_pessoa' and r.message_id is not null),
               'visitas',     count(*) filter (where r.acao = 'marcou_visita' and r.message_id is not null),
               'silencios',   count(*) filter (where r.acao = 'nao_respondeu'),
               'conversas',   count(distinct r.conversation_id) filter (where r.message_id is not null),
               'no_treino',   count(*) filter (where r.message_id is not null and r.conversation_id = v_treino),
               'no_teste',    count(*) filter (where r.message_id is not null and r.conversation_id = any(v_testes)))
        from public.ia_respostas r where r.criada_em >= v_desde),
    'custo_usd', (select coalesce(round(sum(a.cost_usd)::numeric, 4), 0)
                    from public.ai_runs a
                   where a.purpose = 'draft_reply' and a.prompt_version like 'atendente-imova@%'
                     and a.created_at >= v_desde),
    'caderno', (select jsonb_build_object('ativas', count(*) filter (where k.ativo),
                                          'do_treino', count(*) filter (where k.ativo and k.origem = 'treino'),
                                          'correcoes', count(*) filter (where k.ativo and k.origem = 'correcao'))
                  from public.ia_caderno k),
    'imoveis', jsonb_array_length(app.ia_atendente_imoveis()));
end $$;
revoke all on function public.ia_atendente_painel(int) from public, anon;
grant execute on function public.ia_atendente_painel(int) to authenticated;
  $ddl$;

  update public.app_settings
     set value = jsonb_build_object('conversas_de_teste', '[]'::jsonb) || value,
         description = description || ' conversas_de_teste (10/11/2026): até 5 conversas em que a IA conversa como com um cliente, também no modo treino, sem aprender nada (public.ia_conversa_de_teste_marcar).'
   where key = 'ia.atendente'
     and not (value ? 'conversas_de_teste');
end $teste$;
