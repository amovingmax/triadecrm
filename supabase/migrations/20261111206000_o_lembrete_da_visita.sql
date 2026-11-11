-- =====================================================================
-- O lembrete da visita na véspera, pelo WhatsApp, com "Confirmo" e
-- "Preciso remarcar" — só na Imova (11/11/2026)
--
-- Pedido do usuário, na revisão dos gargalos do CRM da Imova: "Mandar um
-- lembrete pelo WhatsApp na véspera, com botões 'Confirmo' e 'Preciso
-- remarcar'. Isso reduz o cliente que não aparece." A visita marcada não tinha
-- proteção nenhuma: nenhum aviso ao cliente, e a equipe só descobria o "não
-- vou poder" quando chegava ao imóvel.
--
-- QUAIS VISITAS (`app.lembrete_visitas_do_periodo`)
--   * A visita de hora combinada, a mesma régua da Agenda (`horaCombinada` em
--     `apps/web/src/components/agenda/consultas.ts`): tarefa `visit` aberta
--     (`todo`/`doing`) do Calendly ou marcada no CRM (`origin` 'calendly' ou
--     'manual'). A tarefa "a marcar" (origem 'system', da régua do desfecho)
--     não tem hora combinada com ninguém e fica de fora.
--   * A REUNIÃO PRESENCIAL marcada ou confirmada (`reunioes.formato =
--     'presencial'`, estado 'marcada' ou 'confirmada'). Decisão desta entrega:
--     a IA que atende marca visita como reunião presencial no endereço do
--     imóvel (`public.ia_atendente_marcar_visita`), e o Calendly também; sem
--     este ramo, a visita mais comum da Imova ficaria sem lembrete. A
--     'a_confirmar' fica de fora: é a rampa em que o cliente ainda não sabe o
--     horário. A on-line também: não há onde aparecer.
--   * Cliente com WhatsApp (o da conversa da reunião, senão
--     `app.wa_destino_da_ficha`), não suprimido (`app.wa_motivo_de_recusa`), com
--     a conversa não bloqueada e a ficha não apagada. Visita cancelada (tarefa
--     'cancelled', reunião 'cancelada' ou 'remarcada') não entra.
--
-- QUANDO (`app.lembretes_de_visita_rodar`, pg_cron a cada 5 minutos)
--   * Na hora configurada (padrão 10h, America/Fortaleza) e depois dela, para
--     as visitas cujo DIA DO ENVIO é hoje. O dia do envio é o último dia antes
--     da visita em que o WhatsApp pode mandar mensagem a essa pessoa depois da
--     hora configurada: nunca domingo, nunca feriado, e sábado só se a janela
--     de sábado (`channel_windows`) vale para ela — hoje, na Imova, sábado é
--     "só de quem já respondeu" (`app.ja_respondeu`, a mesma conta de
--     `app.pode_enviar`). Visita na segunda: sábado, se a porteira deixa
--     sábado para essa pessoa; senão, sexta. Visita na terça depois de uma
--     segunda de feriado: o último dia útil antes dela.
--   * A rodada passa de 5 em 5 minutos depois da hora: a visita marcada hoje
--     para amanhã depois da hora do envio recebe o lembrete na passada
--     seguinte, se a janela de horário ainda deixar. Se a janela já fechou, o
--     lembrete daquela visita não sai (amanhã já é o dia dela).
--   * UMA VEZ POR VISITA E HORÁRIO: `visita_lembretes` é única por (tarefa,
--     para quando estava marcada). Remarcou, o horário é outro e sai um
--     lembrete novo. O que não saiu (fora do horário, teto, sem WhatsApp) fica
--     registrado com o motivo e é tentado de novo na rodada seguinte, enquanto
--     hoje for o dia do envio.
--
-- O MODELO: `IMV-VIS-LEMBRETE`, UTILITY, pt_BR, com {{nome}}, {{dia}},
-- {{hora}} e {{local}} e os botões de resposta rápida "Confirmo" e "Preciso
-- remarcar". Entra INATIVO e sem situação na Meta. A sincronização do
-- `imova-worker-wa` (de 30 em 30 min, `apps/workers/src/whatsapp/modelos-meta.ts`)
-- só manda à Meta modelo ativo; por isso Ajustes → WhatsApp tem o botão
-- "Mandar para a Meta aprovar" (`public.lembrete_de_visita_modelo_para_a_meta`),
-- que só o ativa. Ativo e ainda não aprovado, nada sai: o lembrete exige
-- `app.wa_modelo_da_meta(...).aprovado`.
--
-- O ENVIO É O DE SEMPRE: `insert` em `messages`, tipo 'template', autor
-- 'bot_fixed' com `template_id` (o caminho do texto fixo do robô, o mesmo do
-- bom-dia), na fila 'queued'. A `messages_guard` e `app.pode_enviar` conferem
-- tudo de novo: supressão, janela de 24 h, modelo fora dela, horário,
-- domingo, feriado, tetos do número e o teto de fala do robô.
--
-- A RESPOSTA (`app.lembrete_de_visita_resposta`, gatilho
-- `messages_v_lembrete_de_visita` na mensagem que chega)
--   * O toque no botão chega como mensagem comum com o texto do botão
--     (`supabase/functions/wa-webhook/extrair.ts`, tipo 'button' → 'interactive').
--     O texto é casado com os botões do modelo do lembrete mais recente da
--     conversa (7 dias, visita que ainda não passou de 12 h): o 1º é
--     "Confirmo", o 2º é "Preciso remarcar". Digitar a mesma palavra conta igual.
--   * "Confirmo": grava a confirmação. A Agenda e o Meu dia mostram "Cliente
--     confirmou".
--   * "Preciso remarcar": grava, mostra "Pediu para remarcar" e cria para o
--     responsável a tarefa "Remarcar a visita com <cliente>", prazo agora.
--   * A mensagem que chega avisa a equipe como qualquer mensagem nova (nada
--     disso muda).
--   * Uma resposta curta da casa sai na hora, dentro da janela de 24 h que o
--     toque abriu (modelos de serviço `IMV-VIS-CONFIRMADA` e
--     `IMV-VIS-REMARCAR`, pelo `app.wa_bot_dizer`), para o cliente saber que o
--     toque valeu. O gatilho roda antes do aviso de ausência
--     (`messages_x_ausencia`), que não fala por cima.
--   * A IA QUE ATENDE não responde ao toque como se fosse pergunta: quando ela
--     atende a conversa, o toque ganha uma linha 'nao_respondeu' em
--     `ia_respostas` (a mesma de `public.ia_atendente_registrar_silencio`), e
--     `app.ia_atendente_enfileirar` não o põe na fila. A próxima mensagem do
--     cliente ela responde normalmente, vendo o lembrete e o toque no
--     histórico. No "Preciso remarcar" ela também PARA na conversa (estado
--     'parada', com o motivo): quem remarca é o corretor, e a IA marcando uma
--     visita nova deixaria a antiga aberta. A equipe religa pela conversa.
--   * Os títulos dos botões não são opt-out: nem a regra do worker
--     (`apps/workers/src/whatsapp/optout.ts`) nem `app.wa_parece_optout` casam
--     "Confirmo" ou "Preciso remarcar" (pgTAP 156 e `optout.test.ts`). A rodada
--     se recusa a usar um modelo cujo botão pareça pedido de saída.
--
-- OS AJUSTES: `app_settings['lembrete_de_visita']` = {ligado (padrão false),
-- hora ("HH:MM", padrão "10:00"), modelo (padrão "IMV-VIS-LEMBRETE")}, mudada
-- só por `public.lembrete_de_visita_configurar` (admin e gestor), com o
-- painel `public.lembrete_de_visita_painel` para a tela de Ajustes → WhatsApp.
--
-- Nenhum tipo de aviso no celular é criado (`push_fila_tipo_check`,
-- `app.avisos_catalogo` e `app.avisos_push_rodar` não são tocados).
--
-- Na KOMUNE nada muda: o bloco inteiro é só da Imova (num banco sem identidade,
-- CI ou db reset, tudo é criado, para os testes).
--
-- COMO DESFAZER (no banco da Imova):
--   select cron.unschedule('lembretes_de_visita');
--   drop trigger messages_v_lembrete_de_visita on public.messages;
--   drop function app.messages_lembrete_de_visita(), app.lembrete_de_visita_resposta(uuid),
--     app.lembretes_de_visita_rodar(timestamptz), app.lembrete_de_visita_mandar(uuid, uuid, uuid,
--     uuid, uuid, timestamptz, text, integer), app.lembrete_parametros(uuid, text, timestamptz, text),
--     app.lembrete_visitas_do_periodo(date, date), app.lembrete_dia_do_envio(date, boolean, numeric),
--     app.lembrete_dia_de_envio(date, boolean, numeric), app.lembrete_hora(text),
--     app.lembrete_texto_do_botao(text), app.lembrete_na_imova(), app.lembrete_de_visita_config(),
--     public.lembrete_de_visita_painel(), public.lembrete_de_visita_configurar(jsonb),
--     public.lembrete_de_visita_modelo_para_a_meta();
--   drop table public.visita_lembretes;
--   delete from public.app_settings where key = 'lembrete_de_visita';
--   update public.message_templates set is_active = false
--    where template_code in ('IMV-VIS-LEMBRETE', 'IMV-VIS-CONFIRMADA', 'IMV-VIS-REMARCAR');
--   (os modelos ficam: mensagem já enviada aponta para eles)
-- =====================================================================

do $lembrete$
begin
  if (select i.empresa from app.identidade i) = 'komune' then
    raise notice 'O lembrete de visita é só da Imova: no banco da KOMUNE nada foi criado.';
    return;
  end if;

  execute $ddl$

-- =====================================================================
-- 1. Os modelos
-- =====================================================================
-- O lembrete, para a Meta aprovar. INATIVO: ninguém o vê nem o usa até alguém
-- pedir a aprovação (Ajustes → WhatsApp), e nada sai antes de a Meta aprovar.
-- O corpo começa e termina com texto e não tem variáveis coladas, que é o que
-- a Meta recusa de certeza (`validarModelo`, modelos-meta.ts).
insert into public.message_templates (template_code, name, channel, category, segment, kind,
                                      language, body, variables, botoes, is_active, version)
values ('IMV-VIS-LEMBRETE', 'Lembrete da visita na véspera', 'whatsapp'::app.channel,
        'utility', 'GEN', 'lembrete', 'pt_BR',
        E'Olá, {{nome}}! Lembrete da sua visita com a Imova: {{dia}}, às {{hora}}.\n'
        || E'Local: {{local}}.\n'
        || 'Você confirma a visita? Se não puder ir, toque em Preciso remarcar e combinamos outro horário.',
        '["dia", "hora", "local", "nome"]'::jsonb,
        '[{"tipo": "resposta", "texto": "Confirmo"}, {"tipo": "resposta", "texto": "Preciso remarcar"}]'::jsonb,
        false, 1)
on conflict (template_code) do nothing;

-- As respostas da casa ao toque. Saem DENTRO da janela de 24 h que o toque
-- acabou de abrir, como texto ('service', sem aprovação da Meta), pelo mesmo
-- `app.wa_bot_dizer` do aviso de ausência.
insert into public.message_templates (template_code, name, channel, category, segment, kind,
                                      language, body, variables, is_active, version)
values ('IMV-VIS-CONFIRMADA', 'Resposta ao "Confirmo" do lembrete da visita', 'whatsapp'::app.channel,
        'service', 'GEN', 'sistema', 'pt_BR',
        'Visita confirmada! Obrigado, e até lá.', '[]'::jsonb, true, 1),
       ('IMV-VIS-REMARCAR', 'Resposta ao "Preciso remarcar" do lembrete da visita', 'whatsapp'::app.channel,
        'service', 'GEN', 'sistema', 'pt_BR',
        'Sem problema! Um corretor da Imova vai falar com você por aqui para combinar outro horário.',
        '[]'::jsonb, true, 1)
on conflict (template_code) do nothing;


-- =====================================================================
-- 2. A tabela
-- =====================================================================
create table if not exists public.visita_lembretes (
  id                  uuid primary key default gen_random_uuid(),
  -- A visita: a tarefa `visit`, ou o eco (`meeting`) da reunião presencial.
  task_id             uuid not null references public.tasks (id) on delete cascade,
  reuniao_id          uuid references public.reunioes (id) on delete set null,
  organization_id     uuid not null references public.organizations (id) on delete cascade,
  conversation_id     uuid references public.conversations (id) on delete set null,
  -- Para quando a visita estava marcada quando o lembrete foi feito. Remarcou,
  -- é outra linha (e outro lembrete).
  marcada_para        timestamptz not null,
  -- enviado: a mensagem entrou na fila de saída · nao_enviado: ainda não saiu,
  -- e o motivo diz por quê (a rodada tenta de novo enquanto hoje for o dia).
  situacao            text not null check (situacao in ('enviado', 'nao_enviado')),
  motivo              text check (char_length(motivo) <= 300),
  template_id         int references public.message_templates (id) on delete set null,
  message_id          uuid unique references public.messages (id) on delete set null,
  enviado_em          timestamptz,
  -- confirmou: tocou em "Confirmo" · remarcar: tocou em "Preciso remarcar".
  resposta            text check (resposta in ('confirmou', 'remarcar')),
  respondido_em       timestamptz,
  resposta_message_id uuid references public.messages (id) on delete set null,
  -- A tarefa "Remarcar a visita com …" criada para o responsável.
  tarefa_remarcar_id  uuid references public.tasks (id) on delete set null,
  criado_em           timestamptz not null default now(),
  atualizado_em       timestamptz not null default now(),
  constraint visita_lembretes_um_por_horario unique (task_id, marcada_para),
  constraint visita_lembretes_enviado_tem_data check (situacao <> 'enviado' or enviado_em is not null),
  constraint visita_lembretes_resposta_tem_data check ((resposta is null) = (respondido_em is null)),
  constraint visita_lembretes_resposta_de_enviado check (resposta is null or situacao = 'enviado')
);
create index if not exists visita_lembretes_conversa_idx
  on public.visita_lembretes (conversation_id, enviado_em desc) where situacao = 'enviado';
create index if not exists visita_lembretes_org_idx on public.visita_lembretes (organization_id);

comment on table public.visita_lembretes is
  'O lembrete da visita na véspera pelo WhatsApp, só da Imova (11/11/2026): uma linha por visita e horário (tarefa + marcada_para), o que saiu ou por que não saiu, e a resposta do cliente aos botões "Confirmo" e "Preciso remarcar". Escrita só pelas funções app.lembrete*; quem vê a tarefa vê o lembrete.';

alter table public.visita_lembretes enable row level security;
drop policy if exists visita_lembretes_select on public.visita_lembretes;
-- Quem vê a tarefa (a RLS de `tasks` vale dentro do `exists`) vê o lembrete:
-- é o selo do cartão da Agenda e do Meu dia.
create policy visita_lembretes_select on public.visita_lembretes
  for select to authenticated
  using (exists (select 1 from public.tasks t where t.id = visita_lembretes.task_id));
revoke all on public.visita_lembretes from anon, authenticated;
grant select on public.visita_lembretes to authenticated;

drop trigger if exists audit_visita_lembretes on public.visita_lembretes;
create trigger audit_visita_lembretes after insert or update or delete on public.visita_lembretes
  for each row execute function app.audit();


-- =====================================================================
-- 3. Os ajustes
-- =====================================================================
insert into public.app_settings (key, value, description) values
  ('lembrete_de_visita',
   '{"ligado": false, "hora": "10:00", "modelo": "IMV-VIS-LEMBRETE"}'::jsonb,
   'O lembrete da visita na véspera pelo WhatsApp, só da Imova (11/11/2026). ligado: a rodada manda (desligado até a Meta aprovar o modelo). hora: a partir de quando sai, no horário de Natal ("HH:MM"). modelo: o código do modelo aprovado, com {{nome}}, {{dia}}, {{hora}} e {{local}} e os botões "Confirmo" e "Preciso remarcar". Mudada pela tela (public.lembrete_de_visita_configurar).')
on conflict (key) do nothing;

create or replace function app.lembrete_de_visita_config()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object('ligado', false, 'hora', '10:00', 'modelo', 'IMV-VIS-LEMBRETE')
         || coalesce((select s.value from public.app_settings s
                       where s.key = 'lembrete_de_visita' and jsonb_typeof(s.value) = 'object'),
                     '{}'::jsonb)
$$;
comment on function app.lembrete_de_visita_config() is
  'A configuração do lembrete de visita (app_settings lembrete_de_visita) sobre os padrões: desligado, 10:00, IMV-VIS-LEMBRETE.';
revoke all on function app.lembrete_de_visita_config() from public, anon, authenticated;

-- A segunda trava da KOMUNE, além de o bloco não rodar lá: a rodada e a
-- leitura do botão não fazem nada num banco de identidade "komune".
create or replace function app.lembrete_na_imova()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select i.empresa from app.identidade i limit 1), '') <> 'komune'
$$;
revoke all on function app.lembrete_na_imova() from public, anon, authenticated;

-- "10:00" → 10.0; "09:30" → 9.5. Nulo quando não é hora.
create or replace function app.lembrete_hora(p_hora text)
returns numeric
language sql
immutable
set search_path = ''
as $$
  select case when coalesce(p_hora, '') ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
              then split_part(p_hora, ':', 1)::numeric + split_part(p_hora, ':', 2)::numeric / 60
         end
$$;
revoke all on function app.lembrete_hora(text) from public, anon, authenticated;

-- O texto de um botão do jeito que se compara: sem acento, sem pontuação,
-- minúsculo, espaços simples. "Preciso remarcar!" = "preciso remarcar".
create or replace function app.lembrete_texto_do_botao(p_texto text)
returns text
language sql
stable
set search_path = ''
as $$
  select nullif(btrim(regexp_replace(
           regexp_replace(extensions.unaccent(lower(coalesce(p_texto, ''))), '[^a-z0-9\s]', ' ', 'g'),
           '\s+', ' ', 'g')), '')
$$;
revoke all on function app.lembrete_texto_do_botao(text) from public, anon, authenticated;


-- =====================================================================
-- 4. O dia do envio
-- =====================================================================
-- Um dia em que o WhatsApp pode mandar o lembrete a essa pessoa a partir da
-- hora configurada: nunca domingo nem feriado, e só em dia com faixa de
-- horário que vale para ela (`requires_reply`: a faixa de sábado da Imova é só
-- de quem já respondeu) e que ainda esteja aberta depois da hora configurada.
-- É a mesma tabela que `app.janela_do_canal` lê, que é o que a porteira usa.
create or replace function app.lembrete_dia_de_envio(p_dia date, p_respondeu boolean, p_hora numeric)
returns boolean
language sql
stable
set search_path = ''
as $$
  select extract(dow from p_dia)::int <> 0
     and not exists (select 1 from public.holidays h where h.date = p_dia)
     and exists (select 1 from public.channel_windows w
                  where w.channel = 'whatsapp'::app.channel
                    and w.dow = extract(dow from p_dia)::int
                    and (coalesce(p_respondeu, false) or not w.requires_reply)
                    and w.ate > coalesce(p_hora, 0))
$$;
comment on function app.lembrete_dia_de_envio(date, boolean, numeric) is
  'O lembrete de visita pode sair neste dia para essa pessoa? Nunca domingo nem feriado; só com faixa do WhatsApp (channel_windows) que vale para ela (requires_reply = só de quem já respondeu) e que fecha depois da hora configurada.';
revoke all on function app.lembrete_dia_de_envio(date, boolean, numeric) from public, anon, authenticated;

-- O último dia de envio ANTES do dia da visita, olhando até 7 dias para trás.
-- Visita na segunda: sábado, se sábado vale para essa pessoa; senão, sexta.
create or replace function app.lembrete_dia_do_envio(p_visita date, p_respondeu boolean, p_hora numeric)
returns date
language sql
stable
set search_path = ''
as $$
  select max(g.d::date)
    from generate_series((p_visita - 7)::timestamp, (p_visita - 1)::timestamp, interval '1 day') as g(d)
   where app.lembrete_dia_de_envio(g.d::date, p_respondeu, p_hora)
$$;
comment on function app.lembrete_dia_do_envio(date, boolean, numeric) is
  'O dia em que sai o lembrete de uma visita: o último dia de envio (app.lembrete_dia_de_envio) antes do dia da visita, até 7 dias antes. Nulo quando não há nenhum.';
revoke all on function app.lembrete_dia_do_envio(date, boolean, numeric) from public, anon, authenticated;


-- =====================================================================
-- 5. Quais visitas
-- =====================================================================
-- As visitas de hora combinada dos dias [p_de, p_ate], com o lugar que o
-- cartão da Agenda mostra: o endereço da reunião presencial; na visita do
-- Calendly, o que o cliente escreveu (menos o "Local a combinar"); senão o
-- endereço da ficha.
create or replace function app.lembrete_visitas_do_periodo(p_de date, p_ate date)
returns table (task_id uuid, reuniao_id uuid, organization_id uuid, contact_id uuid,
               deal_id uuid, conversation_id uuid, responsavel_id uuid,
               marcada_para timestamptz, local text)
language sql
stable
security definer
set search_path = ''
as $$
  -- (a) A tarefa de visita com hora combinada: do Calendly ou marcada no CRM.
  select t.id, null::uuid, t.organization_id, t.contact_id, t.deal_id, null::uuid,
         t.assignee_id, t.due_at,
         coalesce(
           (select nullif(btrim(c.local), '')
              from public.calendly_agendamentos c
             where c.task_id = t.id
               and c.local is not null
               and c.local !~* '^\s*local a combinar'
             order by c.recebido_em desc
             limit 1),
           nullif(btrim(o.address), ''))
    from public.tasks t
    join public.organizations o on o.id = t.organization_id and o.deleted_at is null
   where t.kind = 'visit'::app.task_kind
     and t.status in ('todo'::app.task_status, 'doing'::app.task_status)
     and t.origin in ('manual', 'calendly')
     and t.due_at >= (p_de::timestamp at time zone 'America/Fortaleza')
     and t.due_at <  ((p_ate + 1)::timestamp at time zone 'America/Fortaleza')
     and not exists (select 1 from public.reunioes r where r.task_id = t.id)
  union all
  -- (b) A reunião presencial marcada ou confirmada (a visita que a IA e o
  --     Calendly marcam), pelo eco dela em `tasks`.
  select t.id, r.id, r.organization_id, coalesce(r.contact_id, t.contact_id),
         coalesce(r.deal_id, t.deal_id), r.conversation_id, r.dono_id, r.inicio,
         nullif(btrim(r.local), '')
    from public.reunioes r
    join public.tasks t on t.id = r.task_id
    join public.organizations o on o.id = r.organization_id and o.deleted_at is null
   where r.formato = 'presencial'
     and r.estado in ('marcada', 'confirmada')
     and t.status in ('todo'::app.task_status, 'doing'::app.task_status)
     and r.inicio >= (p_de::timestamp at time zone 'America/Fortaleza')
     and r.inicio <  ((p_ate + 1)::timestamp at time zone 'America/Fortaleza')
$$;
comment on function app.lembrete_visitas_do_periodo(date, date) is
  'As visitas que podem receber lembrete entre p_de e p_ate (dias de Natal): tarefa visit aberta com hora combinada (origem calendly ou manual, a régua da Agenda) e reunião presencial marcada ou confirmada (a visita da IA e do Calendly). Cancelada, remarcada, feita, a confirmar e on-line ficam de fora.';
revoke all on function app.lembrete_visitas_do_periodo(date, date) from public, anon, authenticated;


-- =====================================================================
-- 6. O que vai nas variáveis
-- =====================================================================
-- {{nome}}: o primeiro nome do cliente · {{dia}}: "quinta-feira, 12/11" (a
-- data sempre: "amanhã" mentiria no lembrete de sábado para segunda) ·
-- {{hora}}: "15h" ou "15h30" · {{local}}: o endereço, ou "a combinar com o
-- corretor". Nenhum fica vazio: a Meta recusa parâmetro vazio.
create or replace function app.lembrete_parametros(p_org uuid, p_nome text,
                                                   p_quando timestamptz, p_local text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with l as (select p_quando at time zone 'America/Fortaleza' as q),
  n as (
    select coalesce(
             nullif(split_part(app.modelo_parametro_limpo(p_nome), ' ', 1), ''),
             (select nullif(split_part(app.modelo_parametro_limpo(o.name), ' ', 1), '')
                from public.organizations o where o.id = p_org),
             'tudo bem') as nome
  )
  select jsonb_build_object(
           'nome', left(case when n.nome = lower(n.nome) or n.nome = upper(n.nome)
                             then initcap(n.nome) else n.nome end, 60),
           'dia', (array['segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira',
                         'sexta-feira', 'sábado', 'domingo'])[extract(isodow from l.q)::int]
                  || ', ' || to_char(l.q, 'DD/MM'),
           'hora', extract(hour from l.q)::int::text || 'h'
                   || case when extract(minute from l.q)::int = 0 then '' else to_char(l.q, 'MI') end,
           'local', left(coalesce(app.modelo_parametro_limpo(p_local), 'a combinar com o corretor'), 200))
    from l, n
$$;
comment on function app.lembrete_parametros(uuid, text, timestamptz, text) is
  'As variáveis do lembrete de visita: {{nome}} (primeiro nome), {{dia}} ("quinta-feira, 12/11"), {{hora}} ("15h", "15h30") e {{local}} (o endereço ou "a combinar com o corretor"). Nenhuma vazia.';
revoke all on function app.lembrete_parametros(uuid, text, timestamptz, text) from public, anon, authenticated;


-- =====================================================================
-- 7. Mandar um lembrete
-- =====================================================================
-- Devolve 'enviado', 'ja_enviado' ou 'nao_enviado' (com a linha gravada e o
-- motivo). Supressão, horário e tetos são da porteira: a recusa dela vira o
-- motivo, e a rodada seguinte tenta de novo enquanto hoje for o dia do envio.
create or replace function app.lembrete_de_visita_mandar(
  p_task_id uuid, p_reuniao_id uuid, p_org uuid, p_contato uuid, p_conversa uuid,
  p_marcada_para timestamptz, p_local text, p_template_id int)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  t        public.message_templates%rowtype;
  c        public.conversations%rowtype;
  v_numero text := app.wa_numero_padrao();
  v_tel    text;
  v_ct     uuid := p_contato;
  v_nome   text;
  v_conv   uuid;
  v_motivo text;
  v_params jsonb;
  v_msg    uuid;
  v_id     uuid;
begin
  if exists (select 1 from public.visita_lembretes l
              where l.task_id = p_task_id and l.marcada_para = p_marcada_para
                and l.situacao = 'enviado') then
    return 'ja_enviado';
  end if;
  select * into t from public.message_templates where id = p_template_id;

  -- O destino: a conversa da reunião (a IA marcou nela); senão o WhatsApp da ficha.
  if p_conversa is not null then
    select * into c from public.conversations where id = p_conversa;
    if found and c.channel = 'whatsapp'::app.channel then
      v_conv := c.id;
      v_tel  := c.peer_phone_e164;
      v_ct   := coalesce(c.contact_id, p_contato);
      v_nome := c.peer_nome;
    end if;
  end if;
  if v_conv is null then
    select d.telefone, coalesce(d.contact_id, p_contato), d.primeiro_nome
      into v_tel, v_ct, v_nome
      from app.wa_destino_da_ficha(p_org) d;
    if v_numero is not null and v_tel is not null then
      select * into c from public.conversations x
       where x.channel = 'whatsapp'::app.channel
         and x.business_number = v_numero and x.peer_phone_e164 = v_tel;
      v_conv := c.id;
    end if;
  end if;
  -- O nome: o da pessoa da ficha, senão o perfil do WhatsApp (e, na falta dos
  -- dois, `app.lembrete_parametros` usa o nome da ficha).
  v_nome := coalesce((select coalesce(nullif(btrim(ct.first_name), ''),
                                      nullif(split_part(btrim(ct.full_name), ' ', 1), ''))
                        from public.contacts ct where ct.id = v_ct),
                     v_nome);

  if v_numero is null then
    v_motivo := 'whatsapp_nao_configurado';
  elsif v_tel is null then
    v_motivo := 'sem_whatsapp';
  else
    v_motivo := app.wa_motivo_de_recusa(p_org, v_ct, v_tel);
  end if;
  if v_motivo is null and v_conv is not null and c.bloqueada_em is not null then
    v_motivo := 'conversa_bloqueada';
  end if;

  if v_motivo is null then
    v_params := app.lembrete_parametros(p_org, v_nome, p_marcada_para, p_local);
    begin
      if v_conv is null then
        -- `assignee_id` nulo de propósito: quem escolhe é `conversations_before_write`
        -- (o dono da ficha ou o responsável padrão), como no bom-dia.
        insert into public.conversations (channel, business_number, peer_phone_e164,
                                          organization_id, contact_id, assignee_id, status)
        values ('whatsapp'::app.channel, v_numero, v_tel, p_org, v_ct, null, 'aguardando_parceiro')
        returning id into v_conv;
      end if;
      -- A porteira (`messages_guard` + `app.pode_enviar`) confere tudo de novo e
      -- recusa com exceção, que desfaz junto a conversa criada aqui em cima.
      insert into public.messages (conversation_id, direction, type, status, body,
                                   template_id, template_params, author_kind, origin)
      values (v_conv, 'out'::app.msg_direction, 'template'::app.msg_type, 'queued'::app.msg_status,
              app.modelo_renderizar(t.body, v_params), t.id, v_params, 'bot_fixed', 'crm')
      returning id into v_msg;

      insert into public.visita_lembretes (task_id, reuniao_id, organization_id, conversation_id,
                                           marcada_para, situacao, template_id, message_id, enviado_em)
      values (p_task_id, p_reuniao_id, p_org, v_conv, p_marcada_para, 'enviado', t.id, v_msg, now())
      on conflict on constraint visita_lembretes_um_por_horario do update
        set situacao = 'enviado', motivo = null, conversation_id = excluded.conversation_id,
            reuniao_id = excluded.reuniao_id, template_id = excluded.template_id,
            message_id = excluded.message_id, enviado_em = excluded.enviado_em,
            atualizado_em = now()
        where public.visita_lembretes.situacao <> 'enviado'
      returning id into v_id;
      if v_id is null then
        -- Outra rodada mandou no meio: esta mensagem não sai.
        raise exception 'lembrete_ja_enviado' using errcode = 'P0001';
      end if;
      return 'enviado';
    exception when others then
      if sqlerrm = 'lembrete_ja_enviado' then
        return 'ja_enviado';
      end if;
      v_motivo := coalesce(substring(sqlerrm from '^Envio recusado: ([a-z0-9_]+) \('),
                           left(sqlerrm, 250));
      v_conv := case when c.id is not null then c.id end;
    end;
  end if;

  -- Não saiu: fica o motivo. A linha só é regravada quando o motivo muda, para
  -- a rodada de 5 em 5 minutos não encher a auditoria com a mesma recusa.
  insert into public.visita_lembretes (task_id, reuniao_id, organization_id, conversation_id,
                                       marcada_para, situacao, motivo, template_id)
  values (p_task_id, p_reuniao_id, p_org, v_conv, p_marcada_para, 'nao_enviado',
          left(v_motivo, 300), t.id)
  on conflict on constraint visita_lembretes_um_por_horario do update
    set motivo = excluded.motivo, conversation_id = coalesce(excluded.conversation_id,
                                                             public.visita_lembretes.conversation_id),
        atualizado_em = now()
    where public.visita_lembretes.situacao <> 'enviado'
      and public.visita_lembretes.motivo is distinct from excluded.motivo;
  return 'nao_enviado';
end $$;
comment on function app.lembrete_de_visita_mandar(uuid, uuid, uuid, uuid, uuid, timestamptz, text, integer) is
  'Manda o lembrete de UMA visita: acha o WhatsApp do cliente (a conversa da reunião, ou o da ficha), confere supressão e bloqueio, preenche as variáveis e põe o modelo na fila como bot_fixed, pela porteira de sempre. O que não sai fica em visita_lembretes com o motivo.';
revoke all on function app.lembrete_de_visita_mandar(uuid, uuid, uuid, uuid, uuid, timestamptz, text, integer)
  from public, anon, authenticated;


-- =====================================================================
-- 8. A rodada (pg_cron, a cada 5 minutos)
-- =====================================================================
-- `p_agora` decide o dia e a hora (os testes passam outro instante); a
-- porteira é sempre a do instante real, como na `messages_guard`.
create or replace function app.lembretes_de_visita_rodar(p_agora timestamptz default now())
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_cfg     jsonb := app.lembrete_de_visita_config();
  v_local   timestamp := coalesce(p_agora, now()) at time zone 'America/Fortaleza';
  v_hoje    date := (coalesce(p_agora, now()) at time zone 'America/Fortaleza')::date;
  v_agora_h numeric := extract(hour from (coalesce(p_agora, now()) at time zone 'America/Fortaleza'))
                       + extract(minute from (coalesce(p_agora, now()) at time zone 'America/Fortaleza')) / 60.0;
  v_hora    numeric := app.lembrete_hora(app.lembrete_de_visita_config() ->> 'hora');
  t         public.message_templates%rowtype;
  v_falta   text;
  x         record;
  v_r       text;
  v_env     int := 0;
  v_nao     int := 0;
begin
  if not app.lembrete_na_imova() then
    return jsonb_build_object('rodou', false, 'motivo', 'so_na_imova');
  end if;
  if not coalesce((v_cfg ->> 'ligado')::boolean, false) then
    return jsonb_build_object('rodou', false, 'motivo', 'desligado');
  end if;
  if v_hora is null then
    return jsonb_build_object('rodou', false, 'motivo', 'hora_invalida');
  end if;
  if v_agora_h < v_hora then
    return jsonb_build_object('rodou', false, 'motivo', 'antes_da_hora');
  end if;
  -- Nunca domingo nem feriado, para ninguém.
  if extract(dow from v_local)::int = 0
     or exists (select 1 from public.holidays h where h.date = v_hoje) then
    return jsonb_build_object('rodou', false, 'motivo', 'domingo_ou_feriado');
  end if;

  select * into t from public.message_templates m
   where m.template_code = v_cfg ->> 'modelo' and m.is_active and m.channel = 'whatsapp'::app.channel;
  if not found then
    return jsonb_build_object('rodou', false, 'motivo', 'modelo_desligado_ou_inexistente');
  end if;
  if not coalesce((app.wa_modelo_da_meta(t.id) ->> 'aprovado')::boolean, false) then
    return jsonb_build_object('rodou', false, 'motivo', 'modelo_nao_aprovado_na_meta');
  end if;
  -- Variável que o lembrete não sabe preencher sairia com a chave crua.
  select u.v into v_falta from unnest(app.modelo_variaveis(t.body)) as u(v)
   where u.v not in ('nome', 'dia', 'hora', 'local') limit 1;
  if v_falta is not null then
    return jsonb_build_object('rodou', false, 'motivo', 'variavel_que_o_lembrete_nao_preenche',
                              'variavel', v_falta);
  end if;
  -- Botão com cara de "sair" viraria opt-out definitivo de quem só quis responder.
  if exists (select 1 from jsonb_array_elements(t.botoes) b
              where app.wa_parece_optout(b ->> 'texto')) then
    return jsonb_build_object('rodou', false, 'motivo', 'botao_parece_pedido_de_saida');
  end if;

  -- Uma rodada por vez: duas juntas não mandam o mesmo lembrete duas vezes (a
  -- chave única segura de qualquer jeito; isto evita a mensagem desfeita).
  if not pg_try_advisory_xact_lock(hashtextextended('lembretes_de_visita_rodar', 0)) then
    return jsonb_build_object('rodou', false, 'motivo', 'outra_rodada');
  end if;

  for x in
    select v.*
      from app.lembrete_visitas_do_periodo(v_hoje + 1, v_hoje + 8) v
     where not exists (select 1 from public.visita_lembretes l
                        where l.task_id = v.task_id and l.marcada_para = v.marcada_para
                          and l.situacao = 'enviado')
     order by v.marcada_para, v.task_id
  loop
    if app.lembrete_dia_do_envio((x.marcada_para at time zone 'America/Fortaleza')::date,
                                 app.ja_respondeu(x.organization_id), v_hora)
       is distinct from v_hoje then
      continue;
    end if;
    v_r := app.lembrete_de_visita_mandar(x.task_id, x.reuniao_id, x.organization_id, x.contact_id,
                                         x.conversation_id, x.marcada_para, x.local, t.id);
    if v_r = 'enviado' then
      v_env := v_env + 1;
    elsif v_r = 'nao_enviado' then
      v_nao := v_nao + 1;
    end if;
  end loop;

  return jsonb_build_object('rodou', true, 'dia', v_hoje, 'enviados', v_env, 'nao_enviados', v_nao);
end $$;
comment on function app.lembretes_de_visita_rodar(timestamptz) is
  'A rodada do lembrete de visita (pg_cron lembretes_de_visita, a cada 5 min): ligado, depois da hora, fora de domingo e feriado e com o modelo aprovado pela Meta, manda o lembrete de cada visita cujo dia do envio é hoje (app.lembrete_dia_do_envio), uma vez por visita e horário.';
revoke all on function app.lembretes_de_visita_rodar(timestamptz) from public, anon, authenticated;


-- =====================================================================
-- 9. A resposta aos botões
-- =====================================================================
create or replace function app.lembrete_de_visita_resposta(p_message_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  m          public.messages%rowtype;
  l          public.visita_lembretes%rowtype;
  v_texto    text;
  v_botoes   jsonb;
  v_resp     text;
  v_antes    text;
  v_dono     uuid;
  v_deal     uuid;
  v_contato  uuid;
  v_cliente  text;
  v_task     uuid;
  v_ia       boolean := false;
  v_codigo   text;
begin
  if not app.lembrete_na_imova() then
    return jsonb_build_object('agiu', false, 'motivo', 'so_na_imova');
  end if;
  select * into m from public.messages where id = p_message_id;
  if not found or m.direction <> 'in'::app.msg_direction then
    return jsonb_build_object('agiu', false, 'motivo', 'nao_e_entrada');
  end if;
  v_texto := app.lembrete_texto_do_botao(m.body);
  if v_texto is null or length(v_texto) > 30 then
    return jsonb_build_object('agiu', false, 'motivo', 'nao_e_botao');
  end if;

  -- O lembrete desta conversa, de até 7 dias, de visita que não passou de
  -- 12 h: primeiro o da visita que continua de pé naquele horário (a remarcada
  -- deixa o lembrete velho para trás), depois o mais recente.
  select x.* into l from public.visita_lembretes x
    left join public.tasks t on t.id = x.task_id
   where x.conversation_id = m.conversation_id
     and x.situacao = 'enviado'
     and x.enviado_em <= m.created_at
     and x.enviado_em > m.created_at - interval '7 days'
     and x.marcada_para > m.created_at - interval '12 hours'
   order by (t.due_at = x.marcada_para
             and t.status in ('todo'::app.task_status, 'doing'::app.task_status)) desc nulls last,
            x.enviado_em desc, x.marcada_para desc, x.id
   limit 1
   for update of x;
  if not found then
    return jsonb_build_object('agiu', false, 'motivo', 'sem_lembrete_recente');
  end if;

  -- O 1º botão do modelo confirma; o 2º pede para remarcar.
  select coalesce(t.botoes, '[]'::jsonb) into v_botoes
    from public.message_templates t where t.id = l.template_id;
  v_resp := case
              when v_texto = app.lembrete_texto_do_botao(coalesce(v_botoes -> 0 ->> 'texto', 'Confirmo'))
                then 'confirmou'
              when v_texto = app.lembrete_texto_do_botao(coalesce(v_botoes -> 1 ->> 'texto', 'Preciso remarcar'))
                then 'remarcar'
            end;
  if v_resp is null then
    return jsonb_build_object('agiu', false, 'motivo', 'texto_nao_e_botao_do_lembrete');
  end if;

  v_antes := l.resposta;
  update public.visita_lembretes
     set resposta = v_resp, respondido_em = m.created_at, resposta_message_id = m.id,
         atualizado_em = now()
   where id = l.id;

  -- "Preciso remarcar": a tarefa do responsável, uma vez por lembrete.
  if v_resp = 'remarcar' and l.tarefa_remarcar_id is null then
    select t.assignee_id, t.deal_id, t.contact_id into v_dono, v_deal, v_contato
      from public.tasks t where t.id = l.task_id;
    v_dono := coalesce(v_dono,
                       (select r.dono_id from public.reunioes r where r.id = l.reuniao_id),
                       (select c.assignee_id from public.conversations c where c.id = m.conversation_id));
    select o.name into v_cliente from public.organizations o where o.id = l.organization_id;
    insert into public.tasks (title, kind, status, priority, due_at, assignee_id,
                              organization_id, deal_id, contact_id, origin)
    values (left('Remarcar a visita com ' || coalesce(nullif(btrim(v_cliente), ''), 'o cliente'), 200),
            'message'::app.task_kind, 'todo'::app.task_status, 1, now(), v_dono,
            l.organization_id, v_deal, coalesce(v_contato, m.contact_id), 'system')
    returning id into v_task;
    update public.visita_lembretes set tarefa_remarcar_id = v_task where id = l.id;
  end if;

  -- A IA que atende: o toque não é pergunta. Fica o silêncio registrado (a
  -- fila dela pula a mensagem) e, no "Preciso remarcar", ela para na conversa.
  if to_regprocedure('app.ia_atende(uuid)') is not null
     and to_regprocedure('public.ia_atendente_registrar_silencio(uuid, uuid, text, jsonb, bigint, text)') is not null then
    execute 'select app.ia_atende($1)' into v_ia using m.conversation_id;
    if coalesce(v_ia, false) then
      execute 'select public.ia_atendente_registrar_silencio($1, $2, $3, $4)'
        using m.conversation_id, m.id, 'resposta ao lembrete da visita',
              jsonb_build_object('lembrete_id', l.id, 'resposta', v_resp);
      if v_resp = 'remarcar'
         and to_regprocedure('app.ia_atendente_mudar(uuid, text, text, uuid, uuid)') is not null then
        execute 'select app.ia_atendente_mudar($1, $2, $3, $4, $5)'
          using m.conversation_id, 'parada',
                'O cliente pediu para remarcar a visita (lembrete da véspera): um corretor combina o novo horário.',
                null::uuid, null::uuid;
      end if;
    end if;
  end if;

  -- A resposta da casa, uma vez por resposta e nunca por cima de outra
  -- resposta automática desta mesma chegada (o menu do robô, que roda antes).
  -- O próprio lembrete não conta: ele é a pergunta.
  if v_antes is distinct from v_resp then
    v_codigo := case v_resp when 'confirmou' then 'IMV-VIS-CONFIRMADA' else 'IMV-VIS-REMARCAR' end;
    if not exists (select 1 from public.messages x
                    where x.conversation_id = m.conversation_id
                      and x.direction = 'out'::app.msg_direction
                      and x.author_kind in ('bot_fixed', 'bot_ai')
                      and x.template_id is distinct from l.template_id
                      and x.id is distinct from l.message_id
                      and x.created_at >= m.created_at) then
      begin
        perform app.wa_bot_dizer(m.conversation_id, v_codigo);
      exception when others then
        raise warning 'lembrete_de_visita_resposta: a resposta da casa não saiu (%): %',
          m.conversation_id, sqlerrm;
      end;
    end if;
  end if;

  return jsonb_build_object('agiu', true, 'resposta', v_resp, 'lembrete_id', l.id,
                            'tarefa_id', coalesce(v_task, l.tarefa_remarcar_id), 'ia_atendia', v_ia);
end $$;
comment on function app.lembrete_de_visita_resposta(uuid) is
  'O cliente tocou num botão do lembrete de visita: "Confirmo" (1º botão) grava a confirmação; "Preciso remarcar" (2º) grava e cria a tarefa "Remarcar a visita com …" para o responsável, prazo agora. Responde uma linha da casa e, onde a IA atende, registra o silêncio dela (e a para no "Preciso remarcar").';
revoke all on function app.lembrete_de_visita_resposta(uuid) from public, anon, authenticated;

create or replace function app.messages_lembrete_de_visita()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  begin
    perform app.lembrete_de_visita_resposta(new.id);
  exception when others then
    -- A mensagem que chegou vale mais que a leitura do botão.
    raise warning 'lembrete_de_visita_resposta(%): %', new.id, sqlerrm;
  end;
  return null;
end $$;
revoke all on function app.messages_lembrete_de_visita() from public, anon, authenticated;

-- O nome ordena: depois de `messages_after_write` (a janela de 24 h já conta a
-- chegada) e antes de `messages_x_ausencia` (o "estamos fora do horário" não
-- fala por cima da resposta ao toque).
drop trigger if exists messages_v_lembrete_de_visita on public.messages;
create trigger messages_v_lembrete_de_visita
  after insert on public.messages
  for each row
  when (new.direction = 'in'::app.msg_direction
        and char_length(coalesce(new.body, '')) between 3 and 40)
  execute function app.messages_lembrete_de_visita();


-- =====================================================================
-- 10. A tela: Ajustes → WhatsApp → Lembrete de visita
-- =====================================================================
create or replace function public.lembrete_de_visita_painel()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_cfg jsonb := app.lembrete_de_visita_config();
  t     public.message_templates%rowtype;
begin
  if auth.uid() is null or not app.admin_ou_gestor() then
    return jsonb_build_object('ok', false, 'motivo', 'sem_permissao');
  end if;
  select * into t from public.message_templates m where m.template_code = v_cfg ->> 'modelo';
  return jsonb_build_object(
    'ok', true,
    'ligado', coalesce((v_cfg ->> 'ligado')::boolean, false),
    'hora', v_cfg ->> 'hora',
    'modelo', case when t.id is null then null else jsonb_build_object(
                'codigo', t.template_code,
                'ativo', t.is_active,
                'situacao', coalesce(t.meta_status, 'nao_enviado'),
                'aprovado', coalesce((app.wa_modelo_da_meta(t.id) ->> 'aprovado')::boolean, false),
                'motivo_da_recusa', t.meta_rejection_reason,
                'corpo', t.body,
                'botoes', t.botoes) end,
    'ultimos_30_dias', (
      select jsonb_build_object(
               'enviados',     count(*) filter (where l.situacao = 'enviado'),
               'confirmaram',  count(*) filter (where l.resposta = 'confirmou'),
               'remarcar',     count(*) filter (where l.resposta = 'remarcar'),
               'sem_resposta', count(*) filter (where l.situacao = 'enviado' and l.resposta is null),
               'nao_sairam',   count(*) filter (where l.situacao = 'nao_enviado' and l.marcada_para < now()))
        from public.visita_lembretes l
       where l.criado_em > now() - interval '30 days'),
    'nao_sairam', coalesce((
      select jsonb_agg(jsonb_build_object('cliente', x.cliente, 'marcada_para', x.marcada_para,
                                          'motivo', x.motivo) order by x.marcada_para desc)
        from (select o.name as cliente, l.marcada_para, l.motivo
                from public.visita_lembretes l
                join public.organizations o on o.id = l.organization_id
               where l.situacao = 'nao_enviado'
                 and l.criado_em > now() - interval '30 days'
               order by l.marcada_para desc
               limit 5) x), '[]'::jsonb));
end $$;
comment on function public.lembrete_de_visita_painel() is
  'Ajustes → WhatsApp → Lembrete de visita (admin e gestor): ligado, hora, o modelo e a situação dele na Meta, os números dos últimos 30 dias e os últimos que não saíram, com o motivo.';
revoke all on function public.lembrete_de_visita_painel() from public, anon;
grant execute on function public.lembrete_de_visita_painel() to authenticated;

create or replace function public.lembrete_de_visita_configurar(p jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_novo  jsonb := app.lembrete_de_visita_config();
  v_chave text;
begin
  if auth.uid() is null or not app.admin_ou_gestor() then
    return jsonb_build_object('ok', false, 'motivo', 'sem_permissao');
  end if;
  if p is null or jsonb_typeof(p) <> 'object' or p = '{}'::jsonb then
    return jsonb_build_object('ok', false, 'motivo', 'pedido_invalido');
  end if;
  for v_chave in select jsonb_object_keys(p) loop
    if v_chave not in ('ligado', 'hora', 'modelo') then
      return jsonb_build_object('ok', false, 'motivo', 'chave_desconhecida', 'chave', v_chave);
    end if;
  end loop;
  if p ? 'ligado' then
    if jsonb_typeof(p -> 'ligado') <> 'boolean' then
      return jsonb_build_object('ok', false, 'motivo', 'ligado_invalido');
    end if;
    v_novo := v_novo || jsonb_build_object('ligado', (p ->> 'ligado')::boolean);
  end if;
  if p ? 'hora' then
    -- Das 7h às 17h: fora disso a janela do WhatsApp (seg–sex 8h–17h45 na Imova)
    -- não deixaria sair, e o lembrete ficaria sem dia.
    if app.lembrete_hora(p ->> 'hora') is null
       or app.lembrete_hora(p ->> 'hora') not between 7 and 17 then
      return jsonb_build_object('ok', false, 'motivo', 'hora_invalida');
    end if;
    v_novo := v_novo || jsonb_build_object('hora', p ->> 'hora');
  end if;
  if p ? 'modelo' then
    if not exists (select 1 from public.message_templates t
                    where t.template_code = p ->> 'modelo' and t.channel = 'whatsapp'::app.channel) then
      return jsonb_build_object('ok', false, 'motivo', 'modelo_inexistente');
    end if;
    if exists (select 1 from public.message_templates t, jsonb_array_elements(t.botoes) b
                where t.template_code = p ->> 'modelo' and app.wa_parece_optout(b ->> 'texto')) then
      return jsonb_build_object('ok', false, 'motivo', 'botao_parece_pedido_de_saida');
    end if;
    v_novo := v_novo || jsonb_build_object('modelo', p ->> 'modelo');
  end if;

  insert into public.app_settings (key, value, description)
  values ('lembrete_de_visita', v_novo, 'O lembrete da visita na véspera pelo WhatsApp, só da Imova.')
  on conflict (key) do update set value = excluded.value;
  return jsonb_build_object('ok', true) || v_novo;
end $$;
comment on function public.lembrete_de_visita_configurar(jsonb) is
  'Muda o lembrete de visita (admin e gestor): ligado (boolean), hora ("HH:MM", das 07:00 às 17:00) e modelo (código existente, sem botão com cara de pedido de saída). Chave desconhecida é recusada, para ninguém clicar achando que mudou.';
revoke all on function public.lembrete_de_visita_configurar(jsonb) from public, anon;
grant execute on function public.lembrete_de_visita_configurar(jsonb) to authenticated;

-- O modelo entra inativo, e a sincronização com a Meta só manda modelo ativo.
-- Ativar não manda lembrete nenhum: a rodada exige a aprovação da Meta.
create or replace function public.lembrete_de_visita_modelo_para_a_meta()
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_codigo text := app.lembrete_de_visita_config() ->> 'modelo';
  v_id     int;
begin
  if auth.uid() is null or not app.admin_ou_gestor() then
    return jsonb_build_object('ok', false, 'motivo', 'sem_permissao');
  end if;
  update public.message_templates
     set is_active = true, updated_at = now()
   where template_code = v_codigo and channel = 'whatsapp'::app.channel and not is_active
  returning id into v_id;
  if v_id is null and not exists (select 1 from public.message_templates t
                                   where t.template_code = v_codigo) then
    return jsonb_build_object('ok', false, 'motivo', 'modelo_inexistente');
  end if;
  return jsonb_build_object('ok', true, 'codigo', v_codigo, 'ativado_agora', v_id is not null);
end $$;
comment on function public.lembrete_de_visita_modelo_para_a_meta() is
  'Ativa o modelo do lembrete de visita para a sincronização do imova-worker-wa mandá-lo à Meta (de 30 em 30 min). Não manda lembrete: a rodada só usa modelo aprovado.';
revoke all on function public.lembrete_de_visita_modelo_para_a_meta() from public, anon;
grant execute on function public.lembrete_de_visita_modelo_para_a_meta() to authenticated;

  $ddl$;

  -- A rodada de 5 em 5 minutos, só no banco da Imova. Ela mesma não faz nada
  -- desligada, antes da hora, em domingo, em feriado ou sem modelo aprovado.
  if exists (select 1 from pg_namespace where nspname = 'cron') then
    perform cron.schedule('lembretes_de_visita', '*/5 * * * *',
                          $cron$select app.lembretes_de_visita_rodar()$cron$);
  end if;
end $lembrete$;
