-- =====================================================================
-- A repetição do teto de fala só conta em poucos minutos — só na Imova (09/11/2026)
--
-- O usuário, em 09/11: "Já iniciei a conversa com a IA para treinar ela, porém
-- ela não está me respondendo." O que aconteceu na conversa do treino:
--
--   06/11 17:34  Janio: "Olá"   → a IA respondeu
--   06/11 17:59  Janio: "Olá"   → a IA respondeu
--   07/11 09:06  Janio: "Olá"   → FREIO: "Vou chamar alguém do time para te
--                                  responder." e o robô pausado na conversa
--   09/11 12:21  Janio: "Oi"    → a IA não atende (robô pausado)
--
-- A regra (e) do teto de fala (RF-CON-20, migração 20260925180000) olha as três
-- últimas mensagens recebidas e, se são iguais, conclui que do outro lado há um
-- robô de resposta automática. Ela não olha o relógio: três "Olá" em dois dias,
-- de gente cumprimentando, valeram como laço de robô.
--
-- O QUE MUDA (só na Imova): as mensagens iguais só contam se chegaram dentro de
-- `repeticoes_minutos` (10) contados da última. Resposta automática repete em
-- segundos, a cada mensagem nossa; gente que diz "Olá" de manhã e de tarde não é
-- laço. As outras regras (fusível global, pingue-pongue de 8 s, robô pausado,
-- teto de falas) não mudam.
--
-- A conversa do Janio continua pausada até alguém tocar em "IA parada" no topo
-- dela (`public.ia_conversa_ligar`, que tira a pausa desde a 20261106190000);
-- a fila da IA então responde o "Oi" que ficou sem resposta. Esta migração não
-- religa nada sozinha: quem decide é a equipe.
--
-- Na KOMUNE não faz nada: o teto de fala dela continua exatamente como está.
--
-- COMO DESFAZER: reaplicar `app.wa_bot_pode_falar` da 20260925180000 e
--   update public.app_settings set value = value - 'repeticoes_minutos'
--    where key = 'whatsapp.robo_teto';
-- =====================================================================

do $repeticao$
begin
  if (select i.empresa from app.identidade i) = 'komune' then
    raise notice 'Só na Imova: o teto de fala da KOMUNE não mudou.';
    return;
  end if;

  execute $ddl$
create or replace function app.wa_bot_pode_falar(p_conversation_id uuid,
                                                 p_quando timestamptz default now())
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  c        public.conversations%rowtype;
  v_cfg    jsonb := app.wa_robo_teto();
  v_quando timestamptz := coalesce(p_quando, now());
  v_desde  timestamptz;
  v_falas  int;
  v_fus    int;
  v_seg    int;
  v_rapidas int;
  v_iguais int;
  v_contadas int;
  v_espaco interval;
  v_n      int := coalesce((v_cfg ->> 'repeticoes_iguais')::int, 3);
  v_janela interval := make_interval(mins => coalesce((v_cfg ->> 'repeticoes_minutos')::int, 10));
begin
  select * into c from public.conversations where id = p_conversation_id;
  if not found then
    return jsonb_build_object('pode', false, 'motivo', 'conversa_inexistente');
  end if;

  -- (a) O FUSÍVEL GLOBAL, primeiro. Ele é o único que fala do sistema inteiro,
  --     e um laço que já pegou fogo não deve ser avaliado conversa a conversa.
  v_fus := coalesce((v_cfg ->> 'fusivel_por_hora')::int, 120);
  select count(*)::int into v_seg
    from public.messages m
   where m.direction = 'out'::app.msg_direction
     and m.author_kind in ('bot_fixed', 'bot_ai')
     and m.status <> 'failed'::app.msg_status
     and coalesce(m.sent_at, m.created_at) > v_quando - interval '1 hour';
  if v_seg >= v_fus then
    return jsonb_build_object('pode', false, 'motivo', 'fusivel_global',
                              'falas', v_seg, 'teto', v_fus);
  end if;

  -- (b) O robô já foi mandado calar nesta conversa.
  if c.bot_paused then
    return jsonb_build_object('pode', false, 'motivo', 'bot_pausado');
  end if;

  -- (c) O teto de falas na janela.
  v_desde := v_quando - make_interval(hours => coalesce((v_cfg ->> 'janela_horas')::int, 24));
  v_falas := app.wa_bot_falas(p_conversation_id, v_desde);
  if v_falas >= coalesce((v_cfg ->> 'falas_por_conversa')::int, 6) then
    return jsonb_build_object('pode', false, 'motivo', 'teto_de_falas',
                              'falas', v_falas,
                              'teto', coalesce((v_cfg ->> 'falas_por_conversa')::int, 6));
  end if;

  -- (d) Pingue-pongue: N recebidas seguidas, cada uma logo depois da nossa
  --     saída anterior. Gente lê antes de responder.
  select count(*)::int into v_rapidas
    from (
      select m.created_at,
             (select max(coalesce(o.sent_at, o.created_at))
                from public.messages o
               where o.conversation_id = p_conversation_id
                 and o.direction = 'out'::app.msg_direction
                 and o.status <> 'failed'::app.msg_status
                 and coalesce(o.sent_at, o.created_at) < m.created_at) as nossa
        from public.messages m
       where m.conversation_id = p_conversation_id
         and m.direction = 'in'::app.msg_direction
         and m.created_at <= v_quando
       order by m.created_at desc
       limit coalesce((v_cfg ->> 'pingue_pongue_seguidas')::int, 3)) u
   where u.nossa is not null
     and u.created_at - u.nossa
         < make_interval(secs => coalesce((v_cfg ->> 'pingue_pongue_segundos')::int, 20));
  if v_rapidas >= coalesce((v_cfg ->> 'pingue_pongue_seguidas')::int, 3) then
    return jsonb_build_object('pode', false, 'motivo', 'pingue_pongue', 'seguidas', v_rapidas);
  end if;

  -- (e) Repetição: as N últimas recebidas com o mesmo corpo, TODAS dentro de
  --     `repeticoes_minutos` contados da última. Autoresponder repete em
  --     segundos; gente que cumprimenta de manhã e de tarde não é laço
  --     (Imova, 09/11/2026).
  select count(distinct lower(btrim(coalesce(u.body, ''))))::int,
         count(*)::int,
         max(u.created_at) - min(u.created_at)
    into v_iguais, v_contadas, v_espaco
    from (select m.body, m.created_at
            from public.messages m
           where m.conversation_id = p_conversation_id
             and m.direction = 'in'::app.msg_direction
             and m.created_at <= v_quando
             and coalesce(btrim(m.body), '') <> ''
           order by m.created_at desc
           limit v_n) u;
  if v_iguais = 1 and v_contadas >= v_n and v_espaco <= v_janela then
    return jsonb_build_object('pode', false, 'motivo', 'repeticao');
  end if;

  return jsonb_build_object('pode', true, 'motivo', null, 'falas', v_falas);
end $$;
comment on function app.wa_bot_pode_falar(uuid, timestamptz) is
  'Diz se o robô ainda pode falar nesta conversa: fusível global da última hora, bot pausado, teto de falas na janela, pingue-pongue e repetição. PURA — não muda nada. Quem age é app.wa_bot_freiar. Na Imova, desde 09/11/2026, a repetição só conta com as mensagens iguais dentro de repeticoes_minutos.';
revoke all on function app.wa_bot_pode_falar(uuid, timestamptz) from public, anon;
grant execute on function app.wa_bot_pode_falar(uuid, timestamptz) to authenticated, service_role;
  $ddl$;

  update public.app_settings
     set value = value || '{"repeticoes_minutos": 10}'::jsonb,
         description = description || ' Na Imova, repeticoes_minutos = 10 desde 09/11/2026: as mensagens iguais só contam como resposta automática se chegaram dentro de 10 minutos.'
   where key = 'whatsapp.robo_teto';
end $repeticao$;
