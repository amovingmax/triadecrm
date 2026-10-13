-- =====================================================================
-- Quem não atendeu a ligação recebe um aviso no WhatsApp
--
-- Pedido de 13/10/2026: "caso a pessoa não atenda a chamada seja enviado uma
-- mensagem ao whatsapp dela, informando que houve uma tentativa de ligação. A
-- mensagem não pode ter um tom de cobrança, deve ser algo mais amigavel e
-- informativo". Decisões do mesmo dia, de quem pediu:
--   * sai SOZINHO, com opção de cancelar: a tabulação "Não atendeu", "Caixa
--     postal" ou "Ocupado" põe o aviso na fila, e o recibo da ligação mostra
--     "Não avisar";
--   * o custo foi aceito: fora da janela de 24 h é modelo pago da Meta, e o
--     aviso conta no teto diário de conversas abertas;
--   * no máximo UM aviso a cada 72 h para a mesma pessoa, que é a cortesia que
--     o lote já aplica (`app.envio_um`: mensagem nossa sem resposta nas últimas
--     72 h → não manda de novo).
--
-- ===========================================================================
-- NÃO NASCE MÁQUINA NOVA, e o caminho do WhatsApp fica como está
-- ===========================================================================
-- O aviso é um item do lote sem crachá (`assinatura = 'komune'`) de
-- 20261002200000, o mesmo do "Bom dia!" automático. É por ele que já valem,
-- sem uma linha nova: supressão e opt-out, horário do WhatsApp (seg–sex
-- 8h–17h45), domingo e feriado, tetos do dia e da hora, a cortesia de 72 h, a
-- parada automática quando 3+ pessoas pedem para sair e o "modelo não aprovado
-- pela Meta" que para o lote. Nenhum destes muda: saida.ts, graph.ts,
-- entrada.ts, wa-webhook, app.pode_enviar, app.messages_guard, app.wa_proximos,
-- app.envio_um, app.envios_em_massa_rodar, app.wa_komune_abrir.
--
-- O lote do aviso NÃO é `continuo`: o contínuo é um só no sistema inteiro
-- (`envios_em_massa_um_continuo`) e várias funções do cumprimento o acham por
-- essa marca. O aviso tem um lote por dia, marcado em `finalidade`, reaberto
-- quando esvazia e chega outra ligação perdida. Ligação perdida depois das
-- 17h45 espera na fila e sai na manhã seguinte; aviso que esperou mais de 3
-- dias (feriado prolongado, teto estourado) é cancelado em vez de sair velho.
--
-- ===========================================================================
-- A MENSAGEM
-- ===========================================================================
-- A Meta recusa modelo que começa com variável, então são TRÊS modelos, um por
-- período, e `app.modelo_da_hora` troca pelo do período na hora do ENVIO — a
-- ligação das 17h50 é avisada às 8h com "Bom dia". Sem variável nenhuma: o lote
-- da casa não tem quem preencha `{{atendente}}` (`wa_komune_abrir` recusa). O
-- "Aqui é da Komune" está porque a ligação vem de um número (o fixo 84) e o
-- WhatsApp de outro: sem ele, a pessoa não sabe quem tentou falar.
--
-- O worker-wa submete os três à Meta sozinho (`public.wa_modelos_para_meta`).
-- ATÉ A META APROVAR OS TRÊS, NENHUM AVISO ENTRA NA FILA: o recibo diz
-- "aguardando a Meta", e o lote não é parado por um modelo pendente.
--
-- A chave geral é app_settings['voz.aviso_nao_atendeu'].ativo.
--
-- COMO DESFAZER:
--   update public.app_settings set value = value || '{"ativo": false}' where key = 'voz.aviso_nao_atendeu';
--   (desliga sem apagar nada; os itens já na fila podem ser cancelados em Envios)
--
-- RF-CON-02, RF-CON-10, RF-CON-11, RF-CON-18, RF-FUN-12 · ADR-06, ADR-11
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Os três modelos
-- ---------------------------------------------------------------------
insert into public.message_templates
  (template_code, name, channel, category, segment, kind, meta_template_name,
   meta_status, language, body, is_active)
values
  ('GEN-LIG-PERDIDA-MANHA', 'Tentamos ligar — manhã', 'whatsapp', 'marketing', 'GEN',
   'followup', 'gen_lig_perdida_manha_v1', 'pending', 'pt_BR',
   'Bom dia, tudo bem? Aqui é da Komune. Tentamos entrar em contato com você por telefone. Assim que possível, podemos retornar o contato?',
   true),
  ('GEN-LIG-PERDIDA-TARDE', 'Tentamos ligar — tarde', 'whatsapp', 'marketing', 'GEN',
   'followup', 'gen_lig_perdida_tarde_v1', 'pending', 'pt_BR',
   'Boa tarde, tudo bem? Aqui é da Komune. Tentamos entrar em contato com você por telefone. Assim que possível, podemos retornar o contato?',
   true),
  ('GEN-LIG-PERDIDA-NOITE', 'Tentamos ligar — noite', 'whatsapp', 'marketing', 'GEN',
   'followup', 'gen_lig_perdida_noite_v1', 'pending', 'pt_BR',
   'Boa noite, tudo bem? Aqui é da Komune. Tentamos entrar em contato com você por telefone. Assim que possível, podemos retornar o contato?',
   true)
on conflict (template_code) do nothing;

-- ---------------------------------------------------------------------
-- 2. O modelo do período vale para as duas famílias
-- ---------------------------------------------------------------------
-- Recriada a partir de 20260922160000. Antes só trocava GEN-ABR-OLA-*; agora
-- troca qualquer família MANHA/TARDE/NOITE pelo irmão do período, e para o
-- cumprimento devolve exatamente o mesmo que antes.
create or replace function app.modelo_da_hora(p_modelo_id int, p_quando timestamptz default now())
returns int
language sql
stable
set search_path = ''
as $$
  select coalesce(
    (select g.id
       from public.message_templates t
       join public.message_templates g
         on g.template_code = regexp_replace(t.template_code, '-(MANHA|TARDE|NOITE)$', '')
                              || case app.saudacao_do_momento(p_quando)
                                   when 'Bom dia'   then '-MANHA'
                                   when 'Boa tarde' then '-TARDE'
                                   else '-NOITE'
                                 end
      where t.id = p_modelo_id
        and t.template_code in ('GEN-ABR-OLA-MANHA', 'GEN-ABR-OLA-TARDE', 'GEN-ABR-OLA-NOITE',
                                'GEN-LIG-PERDIDA-MANHA', 'GEN-LIG-PERDIDA-TARDE',
                                'GEN-LIG-PERDIDA-NOITE')),
    p_modelo_id)
$$;
revoke all on function app.modelo_da_hora(int, timestamptz) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 3. O lote sabe para que existe, e o item sabe de que ligação veio
-- ---------------------------------------------------------------------
alter table public.envios_em_massa
  add column if not exists finalidade text;
alter table public.envios_em_massa drop constraint if exists envios_em_massa_finalidade_check;
alter table public.envios_em_massa
  add constraint envios_em_massa_finalidade_check
  check (finalidade is null or finalidade in ('ligacao_nao_atendida'));
comment on column public.envios_em_massa.finalidade is
  'Para que o lote existe quando não foi uma pessoa que o montou. ligacao_nao_atendida = o aviso de "tentamos te ligar", um lote por dia (13/10/2026). Nulo nos lotes montados em Envios e no cumprimento contínuo.';

alter table public.envios_em_massa_itens
  add column if not exists call_attempt_id uuid references public.call_attempts (id) on delete set null;
comment on column public.envios_em_massa_itens.call_attempt_id is
  'A tentativa de ligação que pôs este item na fila (aviso de ligação não atendida). É por ela que o recibo da ligação mostra e cancela o aviso.';
create index if not exists envios_em_massa_itens_tentativa
  on public.envios_em_massa_itens (call_attempt_id) where call_attempt_id is not null;

-- ---------------------------------------------------------------------
-- 4. A chave geral, ligada
-- ---------------------------------------------------------------------
-- Nasce ligada porque foi pedida assim; quem segura o primeiro envio é a
-- aprovação da Meta (seção 6). `por_hora` é o ritmo do lote: 60 é um por
-- minuto, o passo do relógio — o aviso perde o sentido se sai horas depois.
insert into public.app_settings (key, value, description)
values ('voz.aviso_nao_atendeu', '{"ativo": true, "por_hora": 60}'::jsonb,
        'Aviso no WhatsApp para quem não atendeu a ligação ("Bom dia, tudo bem? Aqui é da Komune. Tentamos entrar em contato..."). ativo: liga e desliga; por_hora: ritmo do lote (1 a 60).')
on conflict (key) do nothing;

create or replace function app.aviso_ligacao_ativo()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select (s.value ->> 'ativo')::boolean
                     from public.app_settings s where s.key = 'voz.aviso_nao_atendeu'), false)
$$;
revoke all on function app.aviso_ligacao_ativo() from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 5. Os resultados que pedem aviso
-- ---------------------------------------------------------------------
-- "Chamada muda" e "queda de linha" ficam de fora: alguém atendeu, e avisar
-- "tentamos falar com você" a quem ouviu o telefone tocar e atendeu soaria
-- estranho. "Número inválido" não tem para quem avisar.
create or replace function app.aviso_ligacao_pede(p_resultado app.call_result)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_resultado in ('nao_atendeu'::app.call_result, 'caixa_postal'::app.call_result,
                         'ocupado'::app.call_result)
$$;
revoke all on function app.aviso_ligacao_pede(app.call_result) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 6. Pode avisar? (null = pode; senão, o motivo)
-- ---------------------------------------------------------------------
-- A porteira de sempre confere tudo de novo na hora do envio; o que está aqui é
-- o que dá para saber AGORA, para o recibo dizer a verdade ("vai sair" ou "não
-- vai, e por quê") em vez de prometer um aviso que o lote vai pular.
create or replace function app.aviso_ligacao_motivo(p_attempt_id uuid)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  a       public.call_attempts%rowtype;
  o       public.organizations%rowtype;
  v_tel   text;
  v_ct    uuid;
  v_conv  uuid;
  v_cod   text;
begin
  if not app.aviso_ligacao_ativo() then
    return 'desligado';
  end if;
  select * into a from public.call_attempts where id = p_attempt_id;
  if not found then
    return 'tentativa_inexistente';
  end if;
  if a.resultado is null or not app.aviso_ligacao_pede(a.resultado) then
    return 'resultado_sem_aviso';
  end if;
  -- Tabulação atrasada de uma ligação de ontem não manda "tentamos te ligar".
  if a.iniciada_em < now() - interval '12 hours' then
    return 'ligacao_antiga';
  end if;
  if app.wa_numero_padrao() is null then
    return 'whatsapp_nao_configurado';
  end if;

  select * into o from public.organizations where id = a.organization_id and deleted_at is null;
  if not found then
    return 'ficha_inexistente';
  end if;
  select d.telefone, d.contact_id into v_tel, v_ct from app.wa_destino_da_ficha(o.id) d;
  if v_tel is null then
    return 'sem_whatsapp';
  end if;
  if o.do_not_contact
     or app.wa_motivo_de_recusa(o.id, coalesce(a.contact_id, v_ct), v_tel) is not null then
    return 'nao_contatar';
  end if;

  foreach v_cod in array array['GEN-LIG-PERDIDA-MANHA', 'GEN-LIG-PERDIDA-TARDE', 'GEN-LIG-PERDIDA-NOITE'] loop
    if not coalesce((app.wa_modelo_da_meta(
                       (select t.id from public.message_templates t
                         where t.template_code = v_cod and t.is_active)) ->> 'aprovado')::boolean,
                    false) then
      return 'modelo_aguardando_meta';
    end if;
  end loop;

  -- A cortesia de 72 h, a MESMA conta de `app.envio_um`, que continua sendo
  -- quem decide no envio. Repetida aqui só para o recibo não prometer.
  select c.id into v_conv from public.conversations c
   where c.channel = 'whatsapp'::app.channel and c.business_number = app.wa_numero_padrao()
     and c.peer_phone_e164 = v_tel;
  if v_conv is not null and exists (
       select 1 from public.messages m join public.conversations c on c.id = m.conversation_id
        where m.conversation_id = v_conv and m.direction = 'out'::app.msg_direction
          and m.status <> 'failed'::app.msg_status
          and coalesce(m.sent_at, m.created_at) > now() - interval '72 hours'
          and (c.last_inbound_at is null or coalesce(m.sent_at, m.created_at) > c.last_inbound_at)) then
    return 'mensagem_recente_sem_resposta';
  end if;

  if exists (select 1 from public.envios_em_massa_itens i
               join public.envios_em_massa e on e.id = i.envio_id
              where e.finalidade = 'ligacao_nao_atendida'
                and i.organization_id = o.id and i.status = 'pendente') then
    return 'ja_na_fila';
  end if;
  return null;
end $$;
comment on function app.aviso_ligacao_motivo(uuid) is
  'Por que esta ligação NÃO gera aviso no WhatsApp (null = gera): desligado, resultado_sem_aviso, ligacao_antiga, whatsapp_nao_configurado, ficha_inexistente, sem_whatsapp, nao_contatar, modelo_aguardando_meta, mensagem_recente_sem_resposta, ja_na_fila. A porteira (messages_guard/envio_um) confere de novo no envio.';
revoke all on function app.aviso_ligacao_motivo(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 7. O lote do dia
-- ---------------------------------------------------------------------
create or replace function app.aviso_ligacao_lote()
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id     uuid;
  v_status text;
  v_modelo int;
  v_hora   int;
  v_hoje   date := (now() at time zone 'America/Fortaleza')::date;
begin
  -- Dois avisos ao mesmo tempo não criam dois lotes do dia.
  perform pg_advisory_xact_lock(hashtext('aviso_ligacao_lote'));

  -- Pausado ou parado (inclusive pela parada automática de opt-out) é decisão
  -- de gente: não se cria outro por cima, nem amanhã. Retoma-se em Envios.
  if exists (select 1 from public.envios_em_massa
              where finalidade = 'ligacao_nao_atendida' and status in ('pausado', 'parado')) then
    return null;
  end if;

  select id, status into v_id, v_status from public.envios_em_massa
   where finalidade = 'ligacao_nao_atendida'
     and status in ('agendado', 'enviando', 'concluido')
     and (criado_em at time zone 'America/Fortaleza')::date = v_hoje
   order by criado_em desc limit 1;
  if v_id is not null then
    if v_status = 'concluido' then
      update public.envios_em_massa
         set status = 'agendado', concluido_em = null, proximo_em = now(), atualizado_em = now()
       where id = v_id;
    end if;
    return v_id;
  end if;

  select id into v_modelo from public.message_templates
   where template_code = 'GEN-LIG-PERDIDA-MANHA' and is_active;
  if v_modelo is null then
    return null;
  end if;
  select greatest(1, least(60, coalesce((s.value ->> 'por_hora')::int, 60)))
    into v_hora from public.app_settings s where s.key = 'voz.aviso_nao_atendeu';

  insert into public.envios_em_massa
    (nome, tipo, modelo_id, assinatura, por_hora, continuo, finalidade, criado_por, status)
  values (format('Aviso de ligação não atendida — %s', to_char(v_hoje, 'DD/MM')),
          'modelo', v_modelo, 'komune', coalesce(v_hora, 60), false, 'ligacao_nao_atendida',
          null, 'agendado')
  returning id into v_id;
  return v_id;
end $$;
comment on function app.aviso_ligacao_lote() is
  'O lote do aviso de ligação não atendida de hoje: devolve o vivo, reabre o de hoje que esvaziou, ou cria. Devolve null quando algum lote de aviso está pausado ou parado (decisão de gente não se atropela).';
revoke all on function app.aviso_ligacao_lote() from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 8. Pôr na fila
-- ---------------------------------------------------------------------
create or replace function app.aviso_ligacao_enfileirar(p_attempt_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  a        public.call_attempts%rowtype;
  v_motivo text;
  v_lote   uuid;
  v_item   bigint;
begin
  if exists (select 1 from public.envios_em_massa_itens where call_attempt_id = p_attempt_id) then
    return jsonb_build_object('ok', true, 'na_fila', true);
  end if;
  v_motivo := app.aviso_ligacao_motivo(p_attempt_id);
  if v_motivo is not null then
    return jsonb_build_object('ok', false, 'motivo', v_motivo);
  end if;
  v_lote := app.aviso_ligacao_lote();
  if v_lote is null then
    return jsonb_build_object('ok', false, 'motivo', 'aviso_pausado');
  end if;

  select * into a from public.call_attempts where id = p_attempt_id;
  insert into public.envios_em_massa_itens
    (envio_id, posicao, organization_id, assinante_id, call_attempt_id)
  select v_lote,
         coalesce((select max(i.posicao) from public.envios_em_massa_itens i
                    where i.envio_id = v_lote), 0) + 1,
         a.organization_id, null, a.id
  on conflict (envio_id, organization_id) do nothing
  returning id into v_item;
  if v_item is null then
    -- Já está no lote de hoje (avisado ou pulado): um aviso por dia, no máximo.
    return jsonb_build_object('ok', false, 'motivo', 'ja_avisado_hoje');
  end if;
  return jsonb_build_object('ok', true, 'na_fila', true, 'item_id', v_item);
end $$;
comment on function app.aviso_ligacao_enfileirar(uuid) is
  'Põe o aviso de ligação não atendida desta tentativa no lote do dia. Idempotente por tentativa. Devolve {ok, motivo}.';
revoke all on function app.aviso_ligacao_enfileirar(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 9. O gatilho: tabulou "não atendeu", o aviso entra na fila
-- ---------------------------------------------------------------------
-- Nunca derruba a tabulação: o registro da ligação vale mais que o aviso.
create or replace function app.call_attempts_aviso()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  begin
    perform app.aviso_ligacao_enfileirar(new.id);
  exception when others then
    raise warning 'aviso_ligacao_enfileirar(%): %', new.id, sqlerrm;
  end;
  return new;
end $$;
comment on function app.call_attempts_aviso() is
  'Tabulação com "não atendeu", "caixa postal" ou "ocupado" → aviso no WhatsApp na fila (13/10/2026). Erro aqui vira aviso no log, nunca desfaz a tabulação.';
revoke all on function app.call_attempts_aviso() from public, anon, authenticated;

drop trigger if exists call_attempts_aviso on public.call_attempts;
create trigger call_attempts_aviso
  after update of resultado on public.call_attempts
  for each row
  when (old.resultado is null and new.resultado is not null
        and new.resultado in ('nao_atendeu', 'caixa_postal', 'ocupado'))
  execute function app.call_attempts_aviso();

-- ---------------------------------------------------------------------
-- 10. O recibo pergunta e cancela
-- ---------------------------------------------------------------------
create or replace function public.aviso_ligacao_situacao(p_attempt_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid  uuid := auth.uid();
  v_dono uuid;
  i      public.envios_em_massa_itens%rowtype;
begin
  if v_uid is null then
    raise exception 'Usuário não autenticado' using errcode = '42501';
  end if;
  select user_id into v_dono from public.call_attempts where id = p_attempt_id;
  if v_dono is null then
    return jsonb_build_object('ok', false, 'motivo', 'tentativa_inexistente');
  end if;
  if v_dono <> v_uid and not app.is_manager() then
    return jsonb_build_object('ok', false, 'motivo', 'sem_permissao');
  end if;

  select * into i from public.envios_em_massa_itens
   where call_attempt_id = p_attempt_id order by id desc limit 1;
  if found then
    return jsonb_build_object('ok', true, 'situacao', i.status, 'motivo', i.motivo);
  end if;
  return jsonb_build_object('ok', true, 'situacao', 'sem_aviso',
                            'motivo', app.aviso_ligacao_motivo(p_attempt_id));
end $$;
comment on function public.aviso_ligacao_situacao(uuid) is
  'O que aconteceu com o aviso no WhatsApp desta ligação: pendente (na fila), enviada, pulada, cancelada, ou sem_aviso com o motivo. Quem ligou e a gestão.';
revoke all on function public.aviso_ligacao_situacao(uuid) from public, anon;
grant execute on function public.aviso_ligacao_situacao(uuid) to authenticated;

create or replace function public.aviso_ligacao_cancelar(p_attempt_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid  uuid := auth.uid();
  v_dono uuid;
  v_n    int;
begin
  if v_uid is null then
    raise exception 'Usuário não autenticado' using errcode = '42501';
  end if;
  select user_id into v_dono from public.call_attempts where id = p_attempt_id;
  if v_dono is null then
    return jsonb_build_object('ok', false, 'motivo', 'tentativa_inexistente');
  end if;
  if v_dono <> v_uid and not app.is_manager() then
    return jsonb_build_object('ok', false, 'motivo', 'sem_permissao');
  end if;

  -- Só o que ainda não saiu. A mensagem que já foi não volta.
  update public.envios_em_massa_itens
     set status = 'cancelada', motivo = 'cancelado_por_quem_ligou', processado_em = now()
   where call_attempt_id = p_attempt_id and status = 'pendente';
  get diagnostics v_n = row_count;
  if v_n = 0 then
    return jsonb_build_object('ok', false, 'motivo', 'nada_na_fila');
  end if;

  insert into public.audit_log (actor_id, actor_role, action, table_name, row_id, new_data)
  values (v_uid, app.role()::text, 'CANCELAR_AVISO_LIGACAO', 'envios_em_massa_itens',
          p_attempt_id::text, jsonb_build_object('call_attempt_id', p_attempt_id));
  return jsonb_build_object('ok', true);
end $$;
comment on function public.aviso_ligacao_cancelar(uuid) is
  'O "Não avisar" do recibo da ligação: tira da fila o aviso no WhatsApp desta tentativa, se ainda não saiu. Quem ligou e a gestão.';
revoke all on function public.aviso_ligacao_cancelar(uuid) from public, anon;
grant execute on function public.aviso_ligacao_cancelar(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- 11. Aviso velho não sai
-- ---------------------------------------------------------------------
-- "Tentamos entrar em contato" uma semana depois é ruído. O que esperou mais de
-- três dias (teto estourado, feriado prolongado) é cancelado antes da janela
-- abrir. Três dias cobrem a ligação de sexta às 17h50, que sai na segunda às 8h.
create or replace function app.aviso_ligacao_vencer()
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_n int;
begin
  update public.envios_em_massa_itens i
     set status = 'cancelada', motivo = 'aviso_vencido', processado_em = now()
    from public.envios_em_massa e
   where e.id = i.envio_id and e.finalidade = 'ligacao_nao_atendida'
     and i.status = 'pendente' and e.criado_em < now() - interval '3 days';
  get diagnostics v_n = row_count;
  return v_n;
end $$;
comment on function app.aviso_ligacao_vencer() is
  'Cancela o aviso de ligação não atendida que esperou mais de 3 dias na fila. pg_cron, todo dia antes da janela do WhatsApp abrir.';
revoke all on function app.aviso_ligacao_vencer() from public, anon, authenticated;

-- 07:50 em Natal (UTC−3), antes das 8h em que a janela abre.
do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'cron') then
    perform cron.schedule('aviso_ligacao_vencer', '50 10 * * *',
                          $cron$select app.aviso_ligacao_vencer()$cron$);
  end if;
end $$;
