-- Desfaz `20261003120000_a_sala_deixa_de_ser_obrigatoria.sql`.
--
-- Rodar numa transação (`psql -1 -v ON_ERROR_STOP=1 -f ...`). Devolve a função
-- ao corpo exato de `20261003090000_marcar_para_a_equipe.sql` e a restrição ao
-- que era. As reuniões on-line marcadas sem sala nesse meio-tempo ficam com o
-- link "https://sala.invalid/sem-sala" para a restrição antiga aceitar a linha:
-- nenhuma reunião é apagada.

update public.reunioes set link = 'https://sala.invalid/sem-sala', atualizada_em = now()
 where formato = 'online' and link is null;

alter table public.reunioes drop constraint if exists reunioes_lugar_chk;
alter table public.reunioes add constraint reunioes_lugar_chk check (
  (formato = 'online'     and link  is not null) or
  (formato = 'presencial' and local is not null));

create or replace function app.reuniao_gravar(
  p_conversation_id uuid, p_deal_id uuid, p_inicio timestamptz,
  p_formato text, p_local text, p_observacao text,
  p_por text, p_por_id uuid, p_dono uuid)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  c        jsonb := app.reuniao_config();
  v_dur    int   := coalesce((c ->> 'duracao_min')::int, 40);
  v_conv   public.conversations%rowtype;
  v_deal   public.deals%rowtype;
  v_org    uuid;  v_dono uuid;  v_contato uuid;  v_nome text;
  v_fim    timestamptz := p_inicio + make_interval(mins => v_dur);
  v_dia    date;  v_sala text;  v_estado text;
  v_id     uuid;  v_task uuid;  v_etapa int;  v_pos int;  v_titulo text;
begin
  if p_formato not in ('online','presencial') then
    return jsonb_build_object('ok', false, 'motivo', 'formato_invalido');
  end if;

  if p_conversation_id is not null then
    select * into v_conv from public.conversations where id = p_conversation_id;
    if v_conv.id is null then
      return jsonb_build_object('ok', false, 'motivo', 'conversa_nao_existe'); end if;
    -- `conversations.organization_id` é NULÁVEL e "conversa fora da base" é
    -- estado real e comum (tem migração própria e aba própria na tela).
    if v_conv.organization_id is null then
      return jsonb_build_object('ok', false, 'motivo', 'sem_ficha'); end if;
    v_org := v_conv.organization_id;  v_contato := v_conv.contact_id;
    if v_conv.deal_id is not null then
      select * into v_deal from public.deals where id = v_conv.deal_id; end if;
  elsif p_deal_id is not null then
    select * into v_deal from public.deals where id = p_deal_id;
    if v_deal.id is null then
      return jsonb_build_object('ok', false, 'motivo', 'negocio_nao_existe'); end if;
    v_org := v_deal.organization_id;
  else
    return jsonb_build_object('ok', false, 'motivo', 'sem_alvo');
  end if;

  -- Guardrail antes de tudo: marcar reunião para quem acabou de pedir para
  -- sair é pior do que responder.
  --
  -- E o árbitro é `app.is_suppressed_target`, o MESMO que `app.pode_tocar` usa
  -- na ordem 1 — não um `organizations.do_not_contact` escrito de novo aqui.
  -- Ler só aquela coluna deixava de fora os outros dois caminhos do opt-out: o
  -- contato que pediu para sair (`contacts.do_not_contact`) e o telefone que
  -- caiu na `suppression_list` pela regra de palavras. Nesses dois a reunião
  -- não chegava a existir — o gatilho `app.tasks_guard_suppressed` derrubava a
  -- transação na `tasks`-eco —, mas derrubava LEVANTANDO EXCEÇÃO: o robô
  -- recebia um 500 do PostgREST em vez de `motivo = 'suprimido'`, e a tela
  -- dizia "não deu para falar com o servidor" a quem pediu para sair. Uma
  -- regra, um lugar (ADR-03), e a recusa na língua que quem chama entende.
  if app.is_suppressed_target(v_org, v_contato) then
    return jsonb_build_object('ok', false, 'motivo', 'suprimido');
  end if;

  -- `p_dono` quando QUEM MARCA escolheu a agenda (a tela: a própria pessoa, ou
  -- alguém que ela acompanha — quem confere é `public.reuniao_marcar_na_agenda`).
  -- Sem ele, como sempre: `deals.owner_id` quando há negócio; senão
  -- `conversations.assignee_id`, que é NOT NULL. O robô chega aqui SEMPRE sem
  -- `p_dono` (pela versão de 8 argumentos): ele NÃO procura horário na agenda de
  -- outra pessoa — trocar de dono em silêncio para achar vaga é o jeito de a
  -- carteira virar rodízio.
  v_dono := coalesce(p_dono, v_deal.owner_id, v_conv.assignee_id);
  if v_dono is null then return jsonb_build_object('ok', false, 'motivo', 'sem_dono'); end if;

  if p_formato = 'online' then
    select p.sala_url into v_sala from public.profiles p where p.id = v_dono;
    v_sala := coalesce(nullif(btrim(coalesce(v_sala, '')), ''),
                       nullif(btrim(coalesce(c ->> 'sala_padrao', '')), ''));
    if v_sala is null then return jsonb_build_object('ok', false, 'motivo', 'sem_sala'); end if;
  elsif nullif(btrim(coalesce(p_local, '')), '') is null then
    return jsonb_build_object('ok', false, 'motivo', 'sem_lugar');
  end if;

  -- Serializa por (pessoa, dia). Isto protege as regras MOLES — o teto de 4,
  -- a rota, os feriados: dois `select` concorrentes passariam os dois pelo
  -- teto. Com o lock, o segundo espera e vê o primeiro.
  v_dia := (p_inicio at time zone 'America/Fortaleza')::date;
  perform pg_advisory_xact_lock(hashtextextended(v_dono::text || v_dia::text, 0));

  -- Entre a oferta e o aceite o parceiro demora — às vezes horas.
  if not exists (select 1 from app.reuniao_horarios_livres(v_dono, v_dia, v_dia, 50) h
                  where h.inicio = p_inicio) then
    return jsonb_build_object('ok', false, 'motivo', 'horario_indisponivel',
             'alternativas', app.reuniao_opcoes(v_dono, 3));
  end if;

  v_estado := case when p_por = 'robo' and app.reuniao_rampa_ativa()
                   then 'a_confirmar' else 'marcada' end;
  select o.name into v_nome from public.organizations o where o.id = v_org;
  v_titulo := 'Reunião com ' || coalesce(v_nome, 'parceiro');

  -- A TRAVA DURA. 23P01 = exclusion_violation. Ela é o último recurso: o
  -- caminho normal já foi barrado acima. Quem chega aqui é outra transação
  -- que comitou entre o advisory lock e o insert — cenário de dois workers.
  begin
    insert into public.reunioes (organization_id, deal_id, conversation_id, contact_id,
                                 dono_id, titulo, formato, inicio, fim, link, local,
                                 estado, marcada_por, marcada_por_id, observacao)
    values (v_org, v_deal.id, p_conversation_id, v_contato, v_dono, v_titulo, p_formato,
            p_inicio, v_fim,
            case when p_formato = 'online'     then v_sala end,
            case when p_formato = 'presencial' then btrim(p_local) end,
            v_estado, p_por, p_por_id, nullif(btrim(coalesce(p_observacao, '')), ''))
    returning id into v_id;
  exception when exclusion_violation then
    -- As alternativas vêm no MESMO retorno: o robô responde "esse acabou de
    -- ser ocupado — consigo às 11h10 ou às 14h30", sem segunda ida ao banco e
    -- sem o modelo inventar a recuperação.
    return jsonb_build_object('ok', false, 'motivo', 'horario_tomado',
             'alternativas', app.reuniao_opcoes(v_dono, 3));
  end;

  insert into public.tasks (title, kind, status, priority, due_at, assignee_id,
                            organization_id, deal_id, contact_id, origin)
  values (v_titulo, 'meeting'::app.task_kind, 'todo'::app.task_status, 2, p_inicio,
          v_dono, v_org, v_deal.id, v_contato,
          case when p_por = 'robo' then 'ai' else 'manual' end)
  returning id into v_task;
  update public.reunioes set task_id = v_task, atualizada_em = now() where id = v_id;

  -- Conversa sem negócio PULA este passo, em vez de falhar.
  if v_deal.id is not null then
    select st0.position into v_pos from public.stages st0 where st0.id = v_deal.stage_id;
    select st.id into v_etapa from public.stages st
     where st.pipeline_id = v_deal.pipeline_id
       and st.position > coalesce(v_pos, -1)
       and exists (select 1 from jsonb_array_elements(coalesce(st.required_fields,'[]'::jsonb)) e
                    where e.value ->> 'field' = 'meeting_at')
     order by st.position limit 1;
    if v_etapa is not null then
      update public.deals
         set stage_id = v_etapa, next_action_at = p_inicio,
             stage_change_reason = 'Reunião marcada'
       where id = v_deal.id;
    else
      -- Já está na etapa de reunião, ou além dela. A etapa não muda; a
      -- próxima ação, sim — é esta reunião.
      update public.deals set next_action_at = p_inicio where id = v_deal.id;
    end if;
  end if;

  -- O aviso, NA MESMA TRANSAÇÃO: é o que garante que não existe reunião
  -- marcada sem aviso pendente. A fila nasceu na seção B deste arquivo,
  -- antes desta função, porque `app.esteira_enfileirar` levanta exceção em
  -- fila que não está no catálogo — e a exceção derrubaria a transação
  -- inteira de quem marcou.
  perform app.esteira_enfileirar('reuniao_avisos',
            jsonb_build_object('reuniao_id', v_id, 'motivo', 'marcada',
                               'chave', 'reuniao:' || v_id::text || ':marcada'),
            'reuniao:' || v_id::text || ':marcada');

  return jsonb_build_object(
    'ok', true, 'reuniao_id', v_id, 'inicio', p_inicio, 'fim', v_fim,
    'estado', v_estado, 'precisa_confirmacao', v_estado = 'a_confirmar',
    'formato', p_formato,
    'link',  case when p_formato = 'online'     then v_sala end,
    'local', case when p_formato = 'presencial' then btrim(p_local) end,
    'quando_por_extenso', app.reuniao_por_extenso(p_inicio));
end $$;
revoke all on function app.reuniao_gravar(uuid,uuid,timestamptz,text,text,text,text,uuid,uuid)
  from public, anon, authenticated;
grant execute on function app.reuniao_gravar(uuid,uuid,timestamptz,text,text,text,text,uuid,uuid)
  to service_role;

delete from supabase_migrations.schema_migrations where version = '20261003120000';
