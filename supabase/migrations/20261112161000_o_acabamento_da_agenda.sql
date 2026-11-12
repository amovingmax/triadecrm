-- =====================================================================
-- O acabamento da Agenda — só na Imova (11/11/2026)
--
-- Pedido do usuário: "Quero focar na agenda agora para deixar ela
-- completamente integrada e funcional no projeto." Esta é a parte do banco
-- do acabamento (textos, Meu dia, selos e LGPD do Calendly); o resto é tela.
--
-- O que muda:
--
--   1. A AGENDA QUE O LINK OFERECE, PARA A TELA (`public.calendly_agenda_do_link`).
--      O protótipo aprovado dizia, ao cancelar o que a equipe marcou: "o bloco
--      'Ocupado — CRM Imova' sai do Google Agenda: o horário volta a aparecer
--      para o cliente no Calendly". Isso só é verdade na agenda que o Calendly
--      oferece (a de quem atende o Calendly) e com o espelho ligado. A função
--      devolve as duas coisas, `{pessoa_id, espelho_ligado}`, a quem está
--      logado, e a tela só fala do Calendly quando é o caso. Não mexe em
--      `calendly_config`, `calendly_pessoa_da_agenda` nem no espelho: só lê.
--
--   2. LGPD DO `calendly_agendamentos` (respostas livres do cliente, o local, os
--      links de cancelar e remarcar e o motivo do cancelamento, sem prazo até
--      aqui; pendência declarada em 10/11):
--      a. O DOSSIÊ (`app.lgpd_dossie`) ganha `agendamentos_do_calendly`: quando,
--         o quê, o local, as respostas e o cancelamento. Sem os links de
--         cancelar e remarcar (são chaves de quem os tem, não dado do titular),
--         sem as URIs do Calendly e sem os conflitos (são compromissos de
--         outras pessoas). A frase da retenção ganha a do Calendly.
--         COMO A DEFINIÇÃO EM VIGOR É CONSERVADA: em vez de reescrever o dossiê
--         inteiro, a função em vigor passa a se chamar
--         `app.lgpd_dossie_sem_o_calendly`, e `app.lgpd_dossie` vira uma casca
--         que chama essa e acrescenta a parte do Calendly. Assim o que outra
--         migração anterior pôs no dossiê fica como está, seja qual for a forma:
--         é o caso da 20261112160000 (o convite da agenda), que inclui
--         `agenda_convites` e `visita_imoveis` no mesmo dia. A casca tem as
--         mesmas permissões (só `service_role`; quem exporta é
--         `exportar_lgpd`/`exportar_lgpd_por_token`, que não mudam).
--      b. A RETENÇÃO (`app.calendly_aplicar_retencao`, pg_cron '20 7 * * *', 20
--         minutos depois da faxina geral `aplicar_retencao`, '0 7 * * *'; o
--         relógio do pg_cron é o do servidor): o agendamento sai 2 anos depois da
--         data marcada (ou da última mudança, o que vier depois), como a
--         política da Imova (`/privacidade`: 2 anos). O relatório vai para
--         `retention_runs`, como o da faxina geral. A tarefa e a reunião da
--         Agenda não são tocadas: têm a vida delas.
--      c. A EXCLUSÃO A PEDIDO (gatilho em `consent_events`): pedido de
--         eliminação (`erasure_request` ou `erasure_done`) da ficha, ou da pessoa
--         ligada a ela, anonimiza os agendamentos dela, como o PRD manda
--         ("eliminação = anonimização, contagens preservadas"): saem as
--         respostas, o local, a sala, os links de cancelar e remarcar e o motivo
--         do cancelamento; ficam a data, a situação e as URIs (sem elas o CRM não
--         consegue mais cancelar no Calendly o que ainda está de pé).
--
-- O "(marcado pelo Calendly)" do conflito do "Novo compromisso" não pede banco:
-- a tela lê `tasks.origin` dos compromissos do conflito, sob a RLS de quem lê.
-- `visita_marcar` (que a KOMUNE usa) não muda.
--
-- O QUE NÃO MUDA: `calendly_receber`, o espelho, `visita_marcar`,
-- `visita_imoveis`, `agenda_convites`, `push_fila` e os avisos. Nada vai ao
-- WhatsApp nem ao Calendly.
--
-- NA KOMUNE NADA ENTRA: o bloco inteiro é da Imova (o Calendly só existe lá).
--
-- Idempotente: pode ser reaplicada (a troca de nome só acontece uma vez).
--
-- COMO DESFAZER (no banco da Imova):
--   select cron.unschedule('calendly_retencao');
--   drop trigger consent_events_calendly_eliminar on public.consent_events;
--   drop function app.calendly_eliminar_do_titular();
--   drop function app.calendly_aplicar_retencao();
--   drop function public.calendly_agenda_do_link();
--   drop function app.lgpd_dossie(uuid);
--   alter function app.lgpd_dossie_sem_o_calendly(uuid) rename to lgpd_dossie;
-- =====================================================================

do $acabamento$
begin
  if (select i.empresa from app.identidade i) = 'komune' then
    raise notice 'O acabamento da Agenda é só da Imova: no banco da KOMUNE nada foi criado.';
    return;
  end if;
  if to_regclass('public.calendly_agendamentos') is null then
    raise notice 'Este banco não tem o Calendly (20261110180000): nada a fazer.';
    return;
  end if;

  -- A definição do dossiê em vigor (com o que as migrações anteriores puseram
  -- nela) passa a ser a base da casca. Uma vez só: reaplicada, a migração só
  -- reescreve a casca.
  if to_regprocedure('app.lgpd_dossie_sem_o_calendly(uuid)') is null then
    execute 'alter function app.lgpd_dossie(uuid) rename to lgpd_dossie_sem_o_calendly';
  end if;

  execute $ddl$

-- ---------------------------------------------------------------------
-- 1. A agenda que o link do Calendly oferece
-- ---------------------------------------------------------------------
create or replace function public.calendly_agenda_do_link()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'Usuário não autenticado' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'pessoa_id', app.calendly_pessoa_da_agenda(),
    'espelho_ligado', nullif(btrim(coalesce(app.calendly_config() ->> 'google_agenda_id', '')), '')
                      is not null);
end $$;
comment on function public.calendly_agenda_do_link() is
  'De quem é a agenda que o link do Calendly oferece (a que o CRM espelha no Google) e se o espelho está ligado (google_agenda_id preenchido). Para a Agenda dizer, ao cancelar o que a equipe marcou, que o horário volta a ficar livre no Calendly só quando é verdade. Só leitura; quem está logado.';

-- ---------------------------------------------------------------------
-- 2a. O dossiê da LGPD com os agendamentos do Calendly
-- ---------------------------------------------------------------------
create or replace function app.lgpd_dossie(p_organization_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v jsonb := app.lgpd_dossie_sem_o_calendly(p_organization_id);
begin
  if not coalesce((v ->> 'ok')::boolean, false) then
    return v;
  end if;
  return v || jsonb_build_object(
    -- O que o titular contou ao marcar, e o que aconteceu com o agendamento. Sem
    -- os links de cancelar e remarcar, sem as URIs do Calendly e sem os
    -- conflitos (compromissos de outras pessoas).
    'agendamentos_do_calendly', coalesce((
      select jsonb_agg(jsonb_build_object(
               'recebido_em', a.recebido_em,
               'situacao', a.situacao,
               'tipo', a.natureza,
               'evento', a.tipo_de_evento,
               'inicio', a.inicio,
               'fim', a.fim,
               'formato', a.formato,
               'local', a.local,
               'respostas', a.respostas,
               'remarcado', a.remarcado_de is not null,
               'motivo_da_recusa', to_jsonb(a) ->> 'motivo_recusa',
               'cancelado_em', a.cancelado_em,
               'cancelado_por', a.cancelado_por,
               'motivo_do_cancelamento', a.motivo_cancelamento)
               order by a.recebido_em, a.id)
        from public.calendly_agendamentos a
       where a.organization_id = p_organization_id), '[]'::jsonb),
    'retencao', concat_ws(' ', v ->> 'retencao',
      'Os agendamentos feitos pelo Calendly ficam 2 anos depois da data marcada.'));
end $$;
comment on function app.lgpd_dossie(uuid) is
  'Dossiê do art. 18 (I/II) e art. 9º: a definição de antes (app.lgpd_dossie_sem_o_calendly, com tudo o que as migrações anteriores puseram nela) mais os agendamentos do Calendly (20261112161000, só na Imova). Interna: quem chama é exportar_lgpd ou exportar_lgpd_por_token.';
comment on function app.lgpd_dossie_sem_o_calendly(uuid) is
  'O dossiê da LGPD como era antes de 20261112161000. Chamado só pela casca app.lgpd_dossie, que acrescenta os agendamentos do Calendly.';

-- ---------------------------------------------------------------------
-- 2b. A retenção: 2 anos depois da data marcada
-- ---------------------------------------------------------------------
create or replace function app.calendly_aplicar_retencao()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  n int;
  v jsonb;
begin
  delete from public.calendly_agendamentos a
   where greatest(coalesce(a.inicio, a.recebido_em), a.recebido_em, a.atualizado_em)
         < now() - interval '2 years';
  get diagnostics n = row_count;
  v := jsonb_build_object('calendly_agendamentos', n);
  insert into public.retention_runs (report) values (v);
  return v;
end $$;
comment on function app.calendly_aplicar_retencao() is
  'A faxina do Calendly (pg_cron calendly_retencao, todo dia, 20 min depois da faxina geral): apaga o agendamento 2 anos depois da data marcada ou da última mudança, como a política da Imova. A tarefa e a reunião da Agenda ficam. Relatório em retention_runs.';

-- ---------------------------------------------------------------------
-- 2c. A exclusão a pedido do titular
-- ---------------------------------------------------------------------
create or replace function app.calendly_eliminar_do_titular()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.calendly_agendamentos a
     set respostas = '[]'::jsonb, local = null, link = null,
         link_cancelar = null, link_remarcar = null, motivo_cancelamento = null,
         atualizado_em = now()
   where (a.organization_id = new.organization_id
          or (new.contact_id is not null and a.organization_id in
                (select oc.organization_id from public.organization_contacts oc
                  where oc.contact_id = new.contact_id)))
     and (a.respostas <> '[]'::jsonb or a.local is not null or a.link is not null
          or a.link_cancelar is not null or a.link_remarcar is not null
          or a.motivo_cancelamento is not null);
  return new;
end $$;
comment on function app.calendly_eliminar_do_titular() is
  'Pedido de eliminação (erasure_request/erasure_done) da ficha, ou da pessoa ligada a ela: anonimiza os agendamentos do Calendly (respostas, local, sala, links e motivo saem; data, situação e URIs ficam, para o CRM ainda conseguir cancelar no Calendly).';

drop trigger if exists consent_events_calendly_eliminar on public.consent_events;
create trigger consent_events_calendly_eliminar
  after insert on public.consent_events
  for each row
  when (new.kind in ('erasure_request'::app.consent_kind, 'erasure_done'::app.consent_kind))
  execute function app.calendly_eliminar_do_titular();

-- ---------------------------------------------------------------------
-- 3. Quem chama o quê
-- ---------------------------------------------------------------------
revoke all on function public.calendly_agenda_do_link() from public, anon;
grant execute on function public.calendly_agenda_do_link() to authenticated, service_role;
revoke all on function app.lgpd_dossie(uuid) from public, anon, authenticated;
grant execute on function app.lgpd_dossie(uuid) to service_role;
revoke all on function app.lgpd_dossie_sem_o_calendly(uuid) from public, anon, authenticated;
revoke all on function app.calendly_aplicar_retencao() from public, anon, authenticated;
grant execute on function app.calendly_aplicar_retencao() to service_role;
revoke all on function app.calendly_eliminar_do_titular() from public, anon, authenticated;

  $ddl$;

  -- A faxina do Calendly, todo dia, 20 minutos depois da geral ('0 7 * * *').
  if exists (select 1 from pg_namespace where nspname = 'cron') then
    perform cron.schedule('calendly_retencao', '20 7 * * *',
                          $cron$select app.calendly_aplicar_retencao()$cron$);
  end if;
end $acabamento$;

notify pgrst, 'reload schema';
