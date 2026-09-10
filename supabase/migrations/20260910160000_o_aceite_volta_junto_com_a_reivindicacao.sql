-- ===========================================================================
-- O aceite do fornecedor volta junto com a reivindicação (RF-PRE-02; R06 PRE-06/07)
-- ===========================================================================
--
-- O DEFEITO, e ele estava armado esperando o primeiro fornecedor de verdade.
--
-- `komune_webhook_aplicar` recusa o evento `supplier.published` quando não há
-- aceite provado no CRM:
--
--     if pr.claimed_at is null
--        or not exists (select 1 from public.pre_registration_acceptances a
--                        where a.pre_registration_id = pr.id
--                          and a.terms_accepted and a.data_authorization) then
--       … motivo: 'publicacao_sem_aceite_provado'
--
-- A regra está certa e é o RF-PRE-02: perfil não vira publicado no CRM sem
-- prova de autorização, mesmo quando quem afirma o contrário é a plataforma.
--
-- O que mudou embaixo dela foi o caminho. Até 08/09/2026 o fornecedor aceitava
-- o termo numa página do próprio CRM (`/c/<token>`), e era ela que gravava
-- `pre_registration_acceptances`. Nesse dia veio a decisão de produto de mandar
-- o link direto para `/seja-parceiro`, o cadastro que a Komune já tinha — e a
-- decisão está certa, dois fluxos para a mesma coisa era pior. Só que o
-- registro do aceite foi junto com a página, sem ninguém notar.
--
-- Resultado medido em 10/09: `pre_registration_acceptances` com ZERO linhas, e
-- a guarda acima programada para recusar TODA publicação, para sempre. O
-- primeiro fornecedor a publicar não chegaria a "Publicado" no funil — que é a
-- métrica da meta dos 100.
--
-- ---------------------------------------------------------------------------
-- A CORREÇÃO: O `claimed` JÁ É O MOMENTO DO ACEITE
-- ---------------------------------------------------------------------------
-- Não precisa de evento novo. Quando o fornecedor termina o wizard da Komune,
-- ele marcou a caixa dos termos — é aquele instante, e não outro, que a
-- `supplier.claimed` descreve. O que faltava era a prova viajar junto.
--
-- A partir daqui a Komune inclui um objeto `aceite` no payload do
-- `supplier.claimed`, e este gatilho o transforma numa linha de
-- `pre_registration_acceptances`.
--
-- POR QUE GATILHO, E NÃO MEXER NA `komune_webhook_aplicar`. Ela tem quase 400
-- linhas e termina inserindo em `pre_registration_events` para TODO evento.
-- Pendurar aqui é aditivo: nada do que já funciona é reescrito, e um erro meu
-- não pode derrubar o processamento de webhook inteiro. O gatilho é `after
-- insert`, então ele também vale para o histórico — se um `claimed` chegar por
-- reconciliação noturna em vez de webhook, o aceite entra igual.
--
-- ---------------------------------------------------------------------------
-- O QUE ELE NÃO FAZ, DE PROPÓSITO
-- ---------------------------------------------------------------------------
-- Não inventa aceite. Sem `aceite` no payload, ou com `terms_accepted` falso,
-- ele não grava nada e a guarda de publicação continua recusando — que é o
-- comportamento certo: um fornecedor que não aceitou não vira publicado só
-- porque o CRM preferiria que ele tivesse aceitado.
-- ===========================================================================

create or replace function app.aceite_do_claimed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_aceite jsonb := new.payload -> 'aceite';
begin
  if new.event is distinct from 'claimed' or v_aceite is null then
    return null;
  end if;

  -- Só grava o aceite que É um aceite. As duas colunas que a guarda de
  -- publicação exige têm de vir verdadeiras da origem; o CRM não as deduz.
  if coalesce((v_aceite ->> 'terms_accepted')::boolean, false) is not true
     or coalesce((v_aceite ->> 'data_authorization')::boolean, false) is not true then
    return null;
  end if;

  -- Idempotente pelo par (rascunho, hash do texto). O mesmo aceite pode chegar
  -- duas vezes — retentativa do webhook, reconciliação noturna passando por
  -- cima — e gravar duas linhas transformaria a prova em dúvida sobre qual
  -- delas vale.
  if exists (
    select 1 from public.pre_registration_acceptances a
     where a.pre_registration_id = new.pre_registration_id
       and a.terms_hash is not distinct from nullif(v_aceite ->> 'terms_hash', '')
  ) then
    return null;
  end if;

  insert into public.pre_registration_acceptances (
    pre_registration_id, organization_id,
    terms_version, terms_hash, terms_accepted, data_authorization,
    marketing_optin, photo_import_authorized,
    accepted_at, ip, user_agent, auth_method, who_accepted
  ) values (
    new.pre_registration_id,
    new.organization_id,
    nullif(v_aceite ->> 'terms_version', ''),
    nullif(v_aceite ->> 'terms_hash', ''),
    true,
    true,
    coalesce((v_aceite ->> 'marketing_optin')::boolean, false),
    -- Nenhuma foto é importada pelo CRM (RF-PRE-03: o rascunho nasce sem
    -- imagem). O campo existe no esquema e continua falso até alguém construir
    -- um caminho em que ele possa ser verdadeiro.
    false,
    coalesce(nullif(v_aceite ->> 'accepted_at', '')::timestamptz, new.occurred_at, now()),
    -- `inet` recusa string vazia e recusa lixo. Um IP mal formado não pode
    -- derrubar o registro do aceite inteiro: ele vira nulo e o resto entra.
    (select case when nullif(v_aceite ->> 'ip', '') ~ '^[0-9a-fA-F:.]+$'
                 then (v_aceite ->> 'ip')::inet end),
    nullif(v_aceite ->> 'user_agent', ''),
    coalesce(nullif(v_aceite ->> 'auth_method', ''), 'komune_onboarding'),
    nullif(v_aceite ->> 'who_accepted', '')
  );

  return null;
end $$;

comment on function app.aceite_do_claimed() is
  'Transforma o objeto `aceite` do evento supplier.claimed numa linha de pre_registration_acceptances (R06 PRE-07). Sem aceite no payload não grava nada — a guarda de publicação do RF-PRE-02 continua recusando, que é o certo.';

drop trigger if exists aceite_do_claimed on public.pre_registration_events;
create trigger aceite_do_claimed
  after insert on public.pre_registration_events
  for each row execute function app.aceite_do_claimed();

-- Um índice para a checagem de idempotência acima e para a guarda de
-- publicação, que consulta pelo mesmo par a cada evento `published`.
create index if not exists pre_registration_acceptances_por_rascunho
  on public.pre_registration_acceptances (pre_registration_id, terms_hash);
