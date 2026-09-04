# Especificação: catálogo de desfechos de interação

**Onde entra:** D3 (módulos 7.3 e 7.7) · **Origem:** R12, itens "Catálogo de desfechos" e "Janela de recontato" · **Requisitos:** RF-FUN-12 (catálogo) e RF-FUN-13 (janela de recontato), que são os dois que esta spec implementa, e que no estudo R12 ainda não tinham ID próprio; consome e alimenta RF-MET-06, RF-MET-01/04, RF-FUN-03/04, RF-CON-08, RF-REL-02/06 · **Edição pelo gestor:** v1, dentro de RF-ADM-02.

## 1. O problema

`activities.outcome` é `text` livre (migração 20260904000300, linha 474: os valores existem só num comentário), e com 20 a 60 toques por dia isso vira quarenta grafias de "não atendeu" no primeiro mês, o que apaga a distinção entre "não fez" e "não registrou" (RF-AST-06), impede o corte do funil por canal e origem (RF-REL-02) e deixa "porta aberta exige resultado registrado" (RF-MET-01) na dependência de quem digitou. Aqui isso pesa mais que num CRM comum por dois motivos: só a Heloísa dispara pelo Número 1 (risco 18), então a maioria das portas do time sai por ligação, visita e DM, justamente os canais que hoje encerram sem vocabulário nenhum; e as três taxonomias fechadas que já existem não cobrem esses canais (`lost_reasons` só descreve perda, as 25 intenções do Apêndice C só classificam mensagem recebida no WhatsApp, e os chips de RF-MET-06 vivem na UI, não no banco). Sem vocabulário no dado, o relatório de segunda mede digitação, não captação.

## 2. O modelo

**Superfície, não canal puro.** `app.channel` não separa visita de reunião (as duas são `presencial`) e `app.activity_type` não separa WhatsApp de Instagram. O catálogo indexa por *superfície*, derivada do par (canal, tipo) por função determinística: `whatsapp`, `ligacao`, `visita`, `reuniao`, `instagram_dm`. O valor `triagem` nasce reservado no enum para os motivos de descarte da §5.2 (fora do perfil, fora da região, duplicado, sem contato), que entram no mesmo catálogo no D4, quando a caixa de triagem existir; não são semeados agora.

**Colunas.** `slug`, `name` (rótulo do chip, máximo 28 caracteres), `surfaces`, `position`, `is_active`, `cooldown_days`, `can_reactivate`, `next_action_kind` + `next_action_label` + `next_action_offset_days` (nulo = data pela temperatura resultante: D+1 quente, D+3 morno, D+7 frio, RF-MET-06), `target_stage_slug` (nulo = mantém a etapa; é slug e não FK porque a etapa é por funil e o destino se resolve no funil do próprio negócio), `sets_temperature`, `requires_lost_reason`, `counts_as`.

**Obrigatoriedade é regra de tela, não do banco.** O desfecho é obrigatório onde a tela o exige: o formulário de porta aberta (RF-MET-06) não fecha sem chip, e a ficha pede o desfecho ao encerrar visita e reunião. O banco não recusa atividade sem `outcome_id`, por três razões: RF-FUN-12 descreve o catálogo como fonte dos chips e não como constraint; travar a gravação contraria o guardrail escrito do R12 ("não pode travar captura em campo", com orçamento de 20 s no RF-MET-06 e 30 s no RF-BAS-15); e o worker de WhatsApp do D5 grava mensagem humana recebida e enviada sem ter como escolher desfecho no ato. O que o trigger faz é marcar `metadata.outcome_pending` em ligação, visita e reunião sem desfecho, e quem cobra é o Meu dia (critério 3 do RF-MET-04). Se a obrigatoriedade no banco vier a ser desejada, escreve-se antes em RF-FUN-12: a spec não decide regra de produto sozinha.

**Porta é teto, não veredito.** `counts_as` diz o máximo que o desfecho pode valer (`aberta`, `batida`, `nenhuma`); a porta aberta só é gravada se o formulário também disser que se falou com decisor ou influenciador (RF-MET-06, campo "com quem falou"). O trigger grava o resultado em `activities.metadata`, de onde as metas leem; o limite de 1 porta aberta por alvo a cada 30 dias continua sendo regra da métrica (RF-MET-01), não do catálogo.

**Semeadura e texto livre.** A seed vai em `supabase/seed.sql`, seção nova depois dos motivos de perda, no mesmo padrão idempotente (`on conflict (slug) do update` em todas as colunas exceto `id`), com as linhas da §3. `activities.body` já é a observação livre, então manter `outcome` seria duas colunas para a mesma coisa e a garantia de que alguém volta a digitar; a migração derruba a coluna. **Não há de-para**, e está escrito de propósito: a seed roda depois das migrações, então no instante em que a migração executa `interaction_outcomes` está vazia e um `update` com join não converteria linha nenhuma; e não há dado de produção antes do D3, porque os cinco valores do comentário antigo nunca chegaram a ser gravados. Bloco de conversão, aqui, só daria falsa segurança.

```sql
-- =====================================================================
-- KOMUNE CRM - v0.1 - D3 - Catálogo de desfechos de interação
-- (RF-FUN-12 e RF-FUN-13, do R12; RF-MET-06, RF-MET-01, RF-FUN-03/04, RF-CON-08, RF-REL-02/06).
-- Arquivo: supabase/migrations/<próximo timestamp livre>_desfechos_de_interacao.sql
-- =====================================================================

-- create type não aceita "if not exists": o bloco captura duplicate_object.
do $$ begin
  create type app.interaction_surface as enum ('whatsapp','ligacao','visita','reuniao','instagram_dm','triagem');
exception when duplicate_object then null; end $$;
do $$ begin
  create type app.door_kind as enum ('aberta','batida','nenhuma');
exception when duplicate_object then null; end $$;

create or replace function app.interaction_surface(p_channel app.channel, p_type app.activity_type)
returns app.interaction_surface language sql immutable set search_path = '' as $$
  select case
    when p_type = 'call' then 'ligacao' when p_type = 'visit' then 'visita' when p_type = 'meeting' then 'reuniao'
    when p_channel = 'instagram' then 'instagram_dm' when p_channel = 'whatsapp' then 'whatsapp'
  end::app.interaction_surface $$;

create table if not exists public.interaction_outcomes (
  id                       serial primary key,
  slug                     text not null unique,
  name                     text not null check (length(trim(name)) between 1 and 28),  -- cabe num chip no celular
  surfaces                 app.interaction_surface[] not null check (cardinality(surfaces) > 0),
  position                 int not null default 0,
  is_active                boolean not null default true,
  cooldown_days            int not null default 0 check (cooldown_days between 0 and 36500),
  can_reactivate           boolean not null default true,
  next_action_kind         app.task_kind,                 -- próxima ação padrão (RF-FUN-03)
  next_action_label        text,
  next_action_offset_days  int check (next_action_offset_days is null or next_action_offset_days >= 0),
  target_stage_slug        text,                          -- null = mantém a etapa atual
  sets_temperature         app.temperature,               -- null = mantém a temperatura calculada
  requires_lost_reason     boolean not null default false,
  counts_as                app.door_kind not null default 'batida',
  created_at               timestamptz not null default now(),
  constraint interaction_outcomes_perda_exige_etapa check (not requires_lost_reason or target_stage_slug is not null)
);
alter table public.interaction_outcomes enable row level security;
comment on table public.interaction_outcomes is 'Lista fechada de resultados de interação por superfície (R12; RF-MET-06). Toda métrica de porta e todo relatório por canal derivam daqui.';
comment on column public.interaction_outcomes.cooldown_days is 'Piso de espera antes de novo toque (R12). É filtro da fila, NUNCA gatilho de reenvio automático.';
comment on column public.interaction_outcomes.can_reactivate is 'false = não volta à fila nem à reativação do RF-CON-15; só por decisão humana registrada.';
comment on column public.interaction_outcomes.counts_as is 'Teto da contagem (RF-MET-01): porta aberta só é gravada se o formulário também disser decisor/influenciador.';
create index if not exists interaction_outcomes_surface_idx on public.interaction_outcomes using gin (surfaces);

-- Auditoria do catálogo (§5: "chip novo é ato de gestor, auditado", RF-ADM-02/RF-ADM-03).
-- cooldown_days, can_reactivate e counts_as governam supressão de contato e contagem de
-- meta: mudar isso não pode acontecer sem linha em audit_log.
drop trigger if exists audit_interaction_outcomes on public.interaction_outcomes;
create trigger audit_interaction_outcomes after insert or update or delete
  on public.interaction_outcomes for each row execute function app.audit();

-- Catálogo: leitura para autenticados, escrita para admin/gestor (mesmo padrão da migração 000500).
drop policy if exists interaction_outcomes_select on public.interaction_outcomes;
drop policy if exists interaction_outcomes_insert on public.interaction_outcomes;
drop policy if exists interaction_outcomes_update on public.interaction_outcomes;
drop policy if exists interaction_outcomes_delete on public.interaction_outcomes;
create policy interaction_outcomes_select on public.interaction_outcomes for select to authenticated using (true);
create policy interaction_outcomes_insert on public.interaction_outcomes for insert to authenticated with check ((select app.is_manager()));
create policy interaction_outcomes_update on public.interaction_outcomes for update to authenticated using ((select app.is_manager())) with check ((select app.is_manager()));
create policy interaction_outcomes_delete on public.interaction_outcomes for delete to authenticated using ((select app.is_manager()));

alter table public.activities add column if not exists outcome_id int references public.interaction_outcomes (id);
comment on column public.activities.outcome_id is 'Desfecho da interação (lista fechada). No WhatsApp descreve a porta; o que foi dito continua em deals.last_intent (Apêndice C).';
create index if not exists activities_outcome_idx on public.activities (outcome_id) where outcome_id is not null;

-- Queda da coluna de texto livre (activities.body já é a observação livre). Sem de-para: a seed
-- do catálogo roda depois das migrações e não há dado de produção antes do D3.
alter table public.activities drop column if exists outcome;

-- Valida a superfície e grava a contagem de porta em metadata (fonte única: o catálogo).
create or replace function app.activities_apply_outcome()
returns trigger language plpgsql set search_path = '' as $$
declare
  o public.interaction_outcomes%rowtype;
  s app.interaction_surface := app.interaction_surface(new.channel, new.type);
  aberta boolean;
begin
  -- Falta de desfecho NÃO é erro de banco (RF-FUN-12 não cria constraint; o R12 proíbe travar a
  -- captura em campo). Marca-se a pendência e o Meu dia cobra (critério 3 do RF-MET-04).
  if new.outcome_id is null then
    if new.type in ('call','visit','meeting') then
      new.metadata := new.metadata || jsonb_build_object('outcome_pending', true);
    end if;
    return new;
  end if;
  new.metadata := new.metadata - 'outcome_pending';
  select * into o from public.interaction_outcomes where id = new.outcome_id and is_active;
  if not found then raise exception 'Desfecho inexistente ou inativo (id %).', new.outcome_id using errcode = '23503'; end if;
  if s is null or not (s = any (o.surfaces)) then
    raise exception 'Desfecho % não vale para a superfície %.', o.slug, coalesce(s::text, 'indefinida') using errcode = '23514';
  end if;
  aberta := o.counts_as = 'aberta' and coalesce(new.metadata ->> 'com_quem', '') in ('decisor','influenciador');
  -- cooldown_until vai como TEXTO NORMALIZADO EM UTC: o jsonb guarda o texto que a função
  -- de saída do timestamptz produz, e esse texto muda com o TimeZone da sessão que gravou.
  new.metadata := new.metadata || jsonb_build_object(
    'outcome_slug', o.slug, 'door_opened', aberta, 'door_knocked', o.counts_as <> 'nenhuma',
    'cooldown_until', to_char((new.occurred_at + make_interval(days => o.cooldown_days))
                                at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'));
  return new;
end $$;
drop trigger if exists activities_apply_outcome on public.activities;
create trigger activities_apply_outcome before insert or update on public.activities
  for each row execute function app.activities_apply_outcome();

-- Janela de recontato por organização, lida pela fila das 06:00 (RF-CON-08) e pelo Meu dia (RF-MET-04).
-- security_invoker = true: a view roda com o papel de quem consulta, então a RLS de activities
-- (app.org_is_visible) filtra as linhas. Sem opção declarada o padrão do Postgres é rodar como
-- dona e devolver a carteira inteira a embaixador e leitura, furando RF-ADM-01. As três views da
-- migração 000500 usam invoker = false porque embutem o filtro de carteira; esta não embute.
-- Duas leituras diferentes do mesmo histórico, e é de propósito:
--   * o PISO DE ESPERA sai da ÚLTIMA atividade com desfecho (com max(cooldown_days), um
--     'wa_agora_nao' de 30 dias continuaria excluindo o alvo depois de ele responder);
--   * o BLOQUEIO é GRUDENTO: sai do último desfecho bloqueante, e não da última linha.
--     Se saísse da última, o worker do WhatsApp gravando 'wa_respondeu' numa mensagem que
--     chega depois do opt-out desfaria o bloqueio sozinho, que é o guardrail que não pode
--     cair. Por isso são duas CTEs, e não um `not u.can_reactivate` na linha final.
--   * E bloqueia só o desfecho que EMPURRA O NEGÓCIO PARA ETAPA DE PERDA, que é a mesma
--     condição que dá sentido à única saída codificada ("sair de etapa de perda"). Sem essa
--     simetria, 'wa_numero_invalido' e 'lig_numero_errado' (can_reactivate = false, sem
--     etapa de destino) prendiam a organização inteira, em todos os canais, para sempre.
create or replace view public.v_contact_cooldown
with (security_barrier = true, security_invoker = true) as
  with com_desfecho as (
    -- activities.organization_id é ANULÁVEL e o worker de WhatsApp do D5 grava a mensagem
    -- só com deal_id e contact_id: sem o coalesce, um 'wa_optout' assim não produziria
    -- linha alguma aqui e o alvo continuaria elegível à fila pelo que esta view diz.
    select coalesce(a.organization_id, d.organization_id) as organization_id,
           a.occurred_at, a.created_at, a.id,
           o.cooldown_days, o.can_reactivate, o.target_stage_slug
      from public.activities a
      join public.interaction_outcomes o on o.id = a.outcome_id
      left join public.deals d on d.id = a.deal_id
     where coalesce(a.organization_id, d.organization_id) is not null
  ),
  ultimo as (
    select distinct on (c.organization_id) c.organization_id, c.occurred_at, c.cooldown_days
      from com_desfecho c
     order by c.organization_id, c.occurred_at desc, c.created_at desc, c.id desc
  ),
  bloqueio as (
    select distinct on (c.organization_id) c.organization_id, c.occurred_at as blocked_since
      from com_desfecho c
     where not c.can_reactivate
       and exists (select 1 from public.stages s where s.slug = c.target_stage_slug and s.is_lost)
     order by c.organization_id, c.occurred_at desc, c.created_at desc, c.id desc
  )
  select u.organization_id,
         u.occurred_at + make_interval(days => u.cooldown_days) as cooldown_until,
         b.organization_id is not null and not exists (
           -- Saída do bloqueio: reabertura humana com motivo, saindo de uma etapa de perda
           -- (§5.3, RF-FUN-08). Opt-out não tem saída (RF-CON-18), daí o is_optout.
           select 1 from public.deal_stage_history h
             join public.deals  d  on d.id  = h.deal_id
             join public.stages sd on sd.id = h.from_stage_id
             join public.stages sp on sp.id = h.to_stage_id
            where d.organization_id = u.organization_id
              and h.changed_at > b.blocked_since
              and h.changed_by is not null
              and h.reason is not null
              and sd.is_lost and not sd.is_optout
              and not sp.is_lost
         ) as blocked_forever
    from ultimo u
    left join bloqueio b on b.organization_id = u.organization_id;
comment on view public.v_contact_cooldown is 'Piso de espera e bloqueio por desfecho (RF-FUN-13). A fila filtra por aqui; nada aqui dispara envio. Só bloqueia desfecho que leva o negócio a etapa de perda, e o bloqueio termina na reabertura registrada, com o cooldown do desfecho ainda valendo depois dela (§5.3).';
```

## 3. Lista fechada inicial (34 desfechos, no máximo 8 por superfície)

No WhatsApp o desfecho descreve **a porta** (enviou, entregou, respondeu, parou); **o que foi dito** continua sendo a intenção do Apêndice C, gravada em `deals.last_intent`. As duas taxonomias não se sobrepõem e nunca são pedidas na mesma tela. O toque de saída nasce com `wa_sem_resposta` no ato do eco (ou do "Marquei como enviado", RF-CON-08b) e é a resposta recebida que grava `wa_respondeu` na atividade de entrada, pelo worker. Os desfechos de visita saem dos templates do R07 §5; os de WhatsApp e ligação, dos chips de RF-MET-06. "Cooldown" em dias; 36500 = permanente.

| Superfície | Chip | slug | Porta | Cooldown | Reativa | Próxima ação padrão | Etapa -> temperatura |
|---|---|---|---|---|---|---|---|
| WhatsApp | Enviado, sem resposta | `wa_sem_resposta` | batida | 3 | sim | follow-up D+3 (régua RF-CON-13) | mantém |
| WhatsApp | Respondeu | `wa_respondeu` | aberta | 0 | sim | responder em 15 min | respondeu -> morno |
| WhatsApp | Não é a pessoa | `wa_nao_e_a_pessoa` | batida | 0 | sim | achar o decisor | mantém |
| WhatsApp | Agora não | `wa_agora_nao` | aberta | 30 | sim | reativar com gancho D+30 | nutricao -> frio |
| WhatsApp | Não, definitivo | `wa_nao_firme` | aberta | 90 | não | nenhuma | perdido (motivo obrigatório) |
| WhatsApp | Número inválido | `wa_numero_invalido` | nenhuma | 36500 | não | buscar outro canal | mantém |
| WhatsApp | Pediu para parar | `wa_optout` | nenhuma | 36500 | não | nenhuma | optout -> frio |
| Ligação | Não atendeu | `lig_nao_atendeu` | batida | 1 | sim | ligar D+1 (2ª e última, RF-CON-13) | mantém |
| Ligação | Caixa postal | `lig_caixa_postal` | batida | 1 | sim | ligar D+1 | mantém |
| Ligação | Número errado | `lig_numero_errado` | nenhuma | 36500 | não | buscar outro canal | mantém |
| Ligação | Atendeu, retorna depois | `lig_atendeu_retorna` | aberta | 2 | sim | ligar na data combinada | mantém -> morno |
| Ligação | Interessado | `lig_interessado` | aberta | 0 | sim | marcar apresentação | em_conversa -> quente |
| Ligação | Agora não | `lig_agora_nao` | aberta | 30 | sim | reativar com gancho D+30 | nutricao -> frio |
| Ligação | Sem interesse | `lig_sem_interesse` | aberta | 90 | não | nenhuma | perdido (motivo obrigatório) |
| Ligação | Reunião marcada | `lig_reuniao_marcada` | aberta | 0 | sim | reunião na data | reuniao_marcada -> quente |
| Visita | Não estava / fechado | `vis_nao_estava` | batida | 7 | sim | visitar D+7 (próxima passagem da zona) | mantém |
| Visita | Falei com funcionário | `vis_funcionario` | batida | 2 | sim | ligar para o decisor D+2 | mantém |
| Visita | Decisor interessado | `vis_decisor_interessado` | aberta | 0 | sim | marcar apresentação ou enviar link | em_conversa -> quente |
| Visita | Decisor, agora não | `vis_decisor_agora_nao` | aberta | 30 | sim | reativar com gancho D+30 | nutricao -> frio |
| Visita | Decisor recusou | `vis_decisor_recusou` | aberta | 90 | não | nenhuma | perdido (motivo obrigatório) |
| Visita | Cadastro iniciado na hora | `vis_cadastro_iniciado` | aberta | 3 | sim | retomar o cadastro D+3 | cadastro_em_andamento -> quente |
| Visita | Sem perfil (fora do ICP) | `vis_sem_perfil` | batida | 36500 | não | nenhuma | perdido (motivo obrigatório) |
| Reunião | Realizada, interessado | `reu_interessado` | aberta | 0 | sim | pedir autorização no mesmo dia | apresentacao_realizada -> quente |
| Reunião | Realizada, autorizou | `reu_autorizou` | aberta | 0 | sim | enviar link de reivindicação | autorizou -> quente |
| Reunião | Realizada, com objeção | `reu_objecao` | aberta | 1 | sim | follow-up D+1 | apresentacao_realizada -> quente |
| Reunião | Realizada, não | `reu_nao` | aberta | 90 | não | nenhuma | perdido (motivo obrigatório) |
| Reunião | No-show | `reu_no_show` | batida | 1 | sim | reagendar em 24 h (máximo 2) | mantém |
| Reunião | Reagendada | `reu_reagendada` | batida | 0 | sim | reunião na nova data | reuniao_marcada -> quente |
| DM | DM enviada, sem resposta | `dm_sem_resposta` | batida | 5 | sim | ligar ou visitar D+5 | mantém |
| DM | Respondeu na DM | `dm_respondeu` | aberta | 0 | sim | responder em 15 min | respondeu -> morno |
| DM | Pediu contato no WhatsApp | `dm_pediu_whatsapp` | aberta | 0 | sim | mensagem no WhatsApp no mesmo dia | respondeu -> morno |
| DM | Não é a pessoa | `dm_nao_e_a_pessoa` | batida | 0 | sim | achar o decisor | mantém |
| DM | Perfil inativo, não fornece | `dm_perfil_inativo` | nenhuma | 36500 | não | nenhuma | perdido (motivo obrigatório) |
| DM | Pediu para parar | `dm_optout` | nenhuma | 36500 | não | nenhuma | optout -> frio |

Regra de inflação: acima de 8 por superfície ninguém tabula dentro do orçamento de 20 s (RF-MET-06). Chip novo pelo gestor exige aposentar outro, sempre por `is_active = false` e nunca por `delete`, porque atividades antigas apontam para ele.

**Duas linhas mudaram depois da revisão do D3, e estão PENDENTES DE DECISÃO HUMANA (Rafael/Bárbara, PRD §13 item 20):** `wa_numero_invalido` e `lig_numero_errado` passaram de cooldown 0 para 36500. Motivo: os dois têm `can_reactivate = false` e não têm etapa de destino, então, pela regra de bloqueio da §2 (só bloqueia quem vai para etapa de perda), eles deixaram de prender a organização para sempre. Com cooldown 0 o número morto voltaria à fila das 06:00 na manhã seguinte, gastando vaga do teto do RF-CON-10 e repetindo envio a um número que a Cloud API já recusou (risco 2, quality rating). A janela permanente segura o alvo e cai sozinha no primeiro toque por outro canal (DM, visita, ligação no número novo), que é literalmente a próxima ação do próprio chip, e vale também para organização que ainda não tem negócio (lead do Radar), cuja única saída antes passava por `public.deals`.

## 4. Como isso alimenta o resto

- **Fila diária, RF-CON-08.** A montagem das 06:00 exclui as organizações com `v_contact_cooldown.cooldown_until > now()` ou `blocked_forever`, antes de ordenar por tier, categoria em déficit e zona do dia. O cooldown é filtro de entrada na fila, e a fila continua revisada item a item por gente. `blocked_forever` nasce só de desfecho que leva o negócio a etapa de perda, e não é sentença: ele cai sozinho quando alguém registra a reabertura (mudança de etapa saindo da perda, com motivo e autor humano, RF-FUN-08), e aí o cooldown de 90 dias do desfecho ainda segura o alvo pelo prazo que a §5.3 pede. A exceção é o opt-out, que nunca reabre (RF-CON-18). Número inválido e número errado não bloqueiam: eles seguram o alvo pela janela permanente, que cai no primeiro toque por outro canal, sem depender de mudança de etapa nenhuma — e é assim que a organização sem negócio também tem saída.
- **Meu dia, RF-MET-04.** O critério 3 ("reunião ou visita passada sem resultado") vira consulta exata: atividade `visit`/`meeting` com `occurred_at` no passado e `outcome_id` nulo, que é a mesma linha que o trigger marcou com `metadata.outcome_pending`. Essa é a cobrança do desfecho, e por isso o banco não precisa recusar a gravação. O critério 4 usa `next_action_kind` e `next_action_offset_days` como data padrão da próxima ação criada pelo desfecho (RF-FUN-03), e o "porquê" do cartão passa a citar o nome do chip.
- **Temperatura, PRD §5.6 (lacuna consciente do D3).** `sets_temperature` nasce como DADO: nada no banco o aplica. E o gatilho `zz_deals_apply_temperature` (migração 000400, BEFORE em `deals`) recalcula `new.temperature` em toda escrita, então worker ou RPC que tente gravar `deals.temperature` a partir do desfecho vai ver o valor descartado em silêncio. Enquanto isso não for decidido com o Rafael (sexto parâmetro em `app.compute_temperature`, ou não), a temperatura do desfecho só pode chegar ao negócio por `target_stage_slug` ou por `temperature_override`, nunca por escrita direta em `deals.temperature`. O mesmo vale para `next_action_*`, que hoje é dado lido pela UI.
- **Porta batida e porta aberta, RF-MET-01.** Contagem lida de `metadata->>'door_knocked'` e `metadata->>'door_opened'`, escritos pelo trigger a partir de `counts_as` e do interlocutor. Some a divergência entre o que a tela mostra e o que a métrica conta, porque as duas leem a mesma linha.
- **Relatórios, RF-REL-02 e RF-REL-06.** `interaction_outcomes` vira dimensão: funil por canal do primeiro contato com o desfecho nomeado, eficiência de canal pela razão entre `aberta` e `batida`, e motivo de perda cruzado com o desfecho que o produziu. Perda continua exigindo `lost_reason_id` (RF-FUN-04): o desfecho diz como a porta fechou, o motivo diz por quê, e nos seis desfechos marcados "perdido (motivo obrigatório)" na tabela da §3 os dois são obrigatórios juntos (os dois de opt-out vão para a etapa `optout`, que por definição do banco é perda sem motivo da lista fechada).

## 5. O que NÃO fazer

- **Nada de motor de retentativa por número de tentativas.** "3 tentativas por dia" é norma de discagem de voz; aplicada ao WhatsApp estoura a cadência 1+1 do RF-CON-13 e a política de opt-in da Meta, e derruba o quality rating do Número 1 (risco 2). `cooldown_days` é piso de espera lido por um filtro, nunca gatilho de reenvio: nenhuma função pode enfileirar mensagem quando o cooldown expira.
- **Nada de desfecho digitado.** Sem campo "outro, descreva", sem criar desfecho na tela do formulário, sem coluna de texto paralela. Observação livre é `activities.body`; chip novo é ato de gestor, auditado (RF-ADM-02, RF-ADM-03). E nada de "duplicidade" como desfecho: duplicata é higiene da caixa de triagem (§5.2) e envenenaria o relatório de motivos (RF-REL-04).
- **O desfecho é descritivo, não é meta.** A meta segue sendo porta aberta com resultado registrado, máximo 1 por alvo a cada 30 dias (RF-MET-01, RF-MET-09). Nada de ranking público por volume de tabulação.

## 6. Testes pgTAP a escrever (`supabase/tests/10_desfechos.sql`)

1. Tabela existe com RLS habilitada; `sdr` lê e não escreve; `gestor` e `admin` escrevem (padrão do 01_rls_por_papel).
2. `app.interaction_surface` devolve `visita` para (`presencial`,`visit`), `reuniao` para (`presencial`,`meeting`), `ligacao` para `call`, `instagram_dm` para (`instagram`,`message`) e nulo para `email` e `note`.
3. Desfecho fora da superfície é recusado (`vis_decisor_interessado` numa atividade `call` levanta exceção). Atividade `call`, `visit` ou `meeting` sem `outcome_id` **é aceita** e nasce com `metadata.outcome_pending = true` (o banco não trava a captura, RF-MET-06 e RF-BAS-15); `message` humana, `message` de robô e `note` passam sem desfecho e sem a marca; gravar o desfecho depois apaga a marca.
4. `counts_as = 'aberta'` com `metadata.com_quem = 'funcionario'` grava `door_opened = false` e `door_knocked = true`; com `decisor`, grava `door_opened = true`; `counts_as = 'nenhuma'` grava `door_knocked = false` (número inválido não conta porta batida).
5. `cooldown_until` em `metadata` é `occurred_at + cooldown_days`, e `v_contact_cooldown` devolve a janela da **última** atividade com desfecho, não o maior valor do histórico: `wa_agora_nao` (30 dias) seguido de `wa_respondeu` (0) devolve janela vencida.
6. `blocked_forever` fica verdadeiro depois de um desfecho com `can_reactivate = false` **que leva o negócio a etapa de perda**, e não volta a falso por um desfecho reativável posterior; volta a falso depois de uma reabertura registrada (mudança de etapa saindo de uma etapa de perda, com `reason` e `changed_by` preenchidos, RF-FUN-08 e §5.3). Saindo de uma etapa de opt-out não reabre (RF-CON-18). `wa_numero_invalido` e `lig_numero_errado` NÃO bloqueiam (nem com negócio, nem em organização sem negócio): ficam em janela permanente, que vence no primeiro desfecho posterior em outra superfície, sem mudança de etapa. Asserção sobre o catálogo, para um chip futuro do gestor não recriar a armadilha: todo desfecho que bloqueia declara `target_stage_slug` de etapa de perda, e todo desfecho não reativável que não bloqueia tem `cooldown_days = 36500`.
6b. Desfecho gravado sem `organization_id` (o worker do D5 grava mensagem só com `deal_id`) entra na view pela organização do negócio: um `wa_optout` assim bloqueia igual.
6c. `metadata.cooldown_until` é gravado em UTC, no formato ISO 8601 com `Z`, independente do TimeZone da sessão que escreveu.
6d. Criar, alterar e apagar chip do catálogo deixam linha em `audit_log` com o papel de quem alterou (RF-ADM-02, RF-ADM-03).
7. Desfecho com `requires_lost_reason` só é aceito em negócio que tenha `lost_reason_id` (regra em `app.deals_before_write`, testada junto com RF-FUN-04).
8. Desfecho inativo é recusado em atividade nova e continua legível nas atividades antigas que o referenciam.
9. Seed: todo `slug` da §3 existe, nenhuma superfície passa de 8 ativos, todo `name` cabe em 28 caracteres, todo `target_stage_slug` corresponde a uma etapa do funil `fornecedor`, e reaplicar a seed não duplica linha nem muda `id` (padrão do 08_seed).
10. `v_contact_cooldown` respeita a carteira: `embaixador` e `leitura` só enxergam as organizações que a RLS de `activities` já lhes mostra (`app.org_is_visible`), e `gestor` enxerga a base. Contraprova: tirando `security_invoker = true` da view, o `embaixador` passa a ler linha alheia (RF-ADM-01).
