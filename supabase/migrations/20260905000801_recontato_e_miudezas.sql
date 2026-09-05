-- =====================================================================
-- 20260905000801 — A REGRA DE RECONTATO, E SEIS MIUDEZAS DE BANCO
--
-- Laudo da varredura, §3.2 (alta) e §3.12 b · c · d · e · f · j · l.
-- Requisitos: RF-FUN-13 (piso de recontato), RF-CON-08/10/18, PRD §5.6
-- (temperatura, alerta e tarefa de reengajar), R13 §3.1 (lote e reserva).
-- Dia do calendário: D10 (estabilização).
--
-- ---------------------------------------------------------------------
-- §3.2 — DUAS REGRAS PARA A MESMA PERGUNTA, E A DA FILA APAGAVA A ESPERA
-- ---------------------------------------------------------------------
-- "Posso tocar esta organização hoje?" tinha duas respostas diferentes, em
-- duas superfícies que a mesma pessoa usa no mesmo dia:
--
--   · a FILA DE LIGAÇÃO lia `public.v_contact_cooldown`, que olhava só o
--     ÚLTIMO desfecho (`distinct on ... order by occurred_at desc`);
--   · a CADÊNCIA lia `app.pode_tocar`, que fazia o MÁXIMO sobre todo o
--     histórico.
--
-- Medido no banco local com o teste 32 rodando contra o código antigo, com
-- um "agora não" de 30 dias registrado há 14 dias e um "não atendeu" de
-- 1 dia registrado depois:
--
--     coluna da fila:     2026-09-06   (amanhã)
--     coluna da cadência: 2026-09-21   (os 30 dias de pé)
--
-- Vinte e oito dias de piso evaporavam de um lado e não do outro. O defeito
-- falha em silêncio e A FAVOR DE LIGAR DEMAIS, que é o pior lado para errar:
-- incomoda o fornecedor e queima o número.
--
-- A DECISÃO (é uma decisão, e ela está escrita aqui porque os dois
-- comentários antigos defendiam cada um o contrário do outro):
--
--   O piso é o MÁXIMO de (occurred_at + cooldown_days) sobre as atividades
--   com desfecho da organização — a promessa mais longa vence —, com duas
--   exceções nomeadas, e só duas:
--
--   E1 · O ALVO VOLTOU A FALAR. Atividades anteriores à última PORTA ABERTA
--        (`interaction_outcomes.counts_as = 'aberta'`, que é o catálogo
--        dizendo "o alvo falou com a gente") deixam de contar. É a exceção
--        que a fila já aplicava e que a cadência não tinha: quem respondeu
--        depois de pedir 30 dias reabriu o assunto por conta própria, e
--        continuar em silêncio com ele seria perder a conversa.
--
--   E2 · CANAL MORTO. "Número inválido" e "Número errado" (36500 dias,
--        `target_stage_slug` nulo) só contam enquanto forem a ÚLTIMA
--        atividade. O primeiro toque por qualquer outro canal derruba a
--        janela — que é a própria próxima ação desses dois chips ("Buscar
--        outro canal"). É a exceção que a fila já aplicava por acidente (ao
--        ler só a última linha) e que a cadência não tinha: nela, um
--        telefone errado prendia a organização inteira, em todos os canais,
--        por cem anos.
--
--   O que NÃO é exceção, e por quê:
--     · o BLOQUEIO (`blocked_forever`) continua sendo outra pergunta, com a
--       regra que já tinha: quem levou o negócio a uma etapa de perda só sai
--       por reabertura humana registrada, e opt-out não sai nunca
--       (RF-CON-18). O piso pode vencer sem que o bloqueio caia.
--     · a SUPRESSÃO continua sendo a primeira checagem de `app.pode_tocar` e
--       de `app.call_candidates`, antes de qualquer conta de data.
--
-- E a regra passa a ter UMA implementação só: `public.v_contact_cooldown`.
-- `app.pode_tocar` deixa de recalcular por conta própria e LÊ A VIEW. Como
-- ela é `security_invoker`, dentro de uma função `security definer` ela roda
-- com o papel da dona (postgres) e enxerga o histórico inteiro — que é
-- exatamente o que a porteira precisa e o que ela já fazia lendo `activities`
-- direto. Fora da função, na tela, continua filtrada pela carteira (RF-ADM-01).
--
-- De quebra, `app.pode_tocar` passa a consultar também o `blocked_forever` da
-- mesma view: sem isso, a exceção E1 abriria uma fresta real — um opt-out
-- seguido de uma resposta gravada pelo worker deixaria a porteira sem nada a
-- dizer, já que ela só olhava o `can_reactivate` da ÚLTIMA atividade.
--
-- ---------------------------------------------------------------------
-- O que mais entra aqui (§3.12)
-- ---------------------------------------------------------------------
--   b · A tarefa que nasce de uma ligação não atendida dizia "Ligar D+1
--       (última)" já na PRIMEIRA de três tentativas. Passa a dizer em qual
--       tentativa está.
--   c · O "Vale até" da montagem era esticado em silêncio (pede 1 dia, sai
--       com 5, e as organizações ficam reservadas nesse prazo). O prazo
--       continua sendo esticado — a decisão do D2 está de pé e escrita em
--       20260904001500 —, mas a montagem agora DIZ que esticou e diz qual
--       data foi pedida.
--   d · Teto de tentativas estourado era reportado como "fila vazia".
--       Passa a vir com o motivo real e com a hora em que a fila volta.
--   e · Item suprimido no meio da ligação continuava contando em
--       "restantes" por até 30 minutos.
--   f · DDD que não existe no Brasil (23, 39, 56, 78) virava telefone
--       válido em E.164: só o zero era barrado.
--   j · Negócio quente que NUNCA teve contato registrado nunca esfriava nem
--       acendia alerta, porque `last_activity_at` nulo virava 0 dias.
--   l · Ninguém criava a "tarefa de reengajar" que o PRD §5.6 pede quando um
--       morno passa de 7 dias.
--
-- Prova de cada um: supabase/tests/32_recontato_e_miudezas.sql, escrito
-- ANTES desta migração e visto falhando 13 asserções com o código antigo.
-- =====================================================================


-- =====================================================================
-- 1. §3.12f — A NUMERAÇÃO DA ANATEL, E NÃO SÓ "NÃO COMEÇA COM ZERO"
-- =====================================================================
-- `app.normalize_phone_br` validava o DDD por exclusão ("nenhuma das duas
-- casas é zero"). Com isso 23, 39, 56 e 78 — que não existem no Brasil —
-- viravam E.164 válido, entravam na dedup, no hash da `suppression_list` e no
-- `tel:` da tela de ligação. Um telefone que não existe não é um telefone.
--
-- SINCRONIA COM O TYPESCRIPT — e por que copiar, aqui, é a escolha certa.
-- A lista já existe DUAS vezes no repositório, e as duas cópias são
-- deliberadas e documentadas: `packages/prompts/src/nucleo/telefone-br.ts`
-- (a regra do que é telefone, usada pela pseudonimização) e
-- `packages/prompts/src/nucleo/auditoria-pii.ts` (a segunda camada, que não
-- pode importar da primeira — se importasse, o guardrail de LGPD teria uma
-- camada só disfarçada de duas; está escrito lá, na linha 80). Esta é a
-- terceira, e ela não tinha como ser importada de nenhuma das outras: quem
-- normaliza telefone aqui é o Postgres, e ele não lê TypeScript.
--
-- O que mantém as três iguais, hoje, é revisão humana mais UMA asserção, do
-- lado do banco: `supabase/tests/32_recontato_e_miudezas.sql` fixa os 67
-- códigos, um por um. Mudou a Anatel, mudam os três arquivos no mesmo PR, e o
-- pgTAP fica vermelho até que este aqui esteja igual ao que foi decidido.
-- PENDÊNCIA REGISTRADA (não é minha área de arquivo): falta a asserção gêmea
-- do lado TypeScript — uma linha em `packages/prompts` afirmando que
-- `telefone-br.ts` e `auditoria-pii.ts` têm os mesmos 67 códigos. Sem ela, as
-- duas listas de lá continuam sincronizadas só por leitura.
create or replace function app.ddd_br_valido(p text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p ~ '^[1-9][1-9]$'
     and p::int = any (array[
       11,12,13,14,15,16,17,18,19,
       21,22,24,27,28,
       31,32,33,34,35,37,38,
       41,42,43,44,45,46,47,48,49,
       51,53,54,55,
       61,62,63,64,65,66,67,68,69,
       71,73,74,75,77,79,
       81,82,83,84,85,86,87,88,89,
       91,92,93,94,95,96,97,98,99])
$$;
comment on function app.ddd_br_valido(text) is
  'True quando os dois dígitos são um DDD em uso no Brasil (67 códigos, numeração da Anatel). Gêmea da constante DDDS de packages/prompts/src/nucleo/telefone-br.ts: as duas listas são mantidas iguais por uma asserção de contagem em cada lado.';
revoke all on function app.ddd_br_valido(text) from public, anon;
grant execute on function app.ddd_br_valido(text) to authenticated, service_role;

-- Mesma função de sempre (RF-BAS-05), com a validação final trocando
-- "nenhuma casa é zero" por "é um DDD que existe".
create or replace function app.normalize_phone_br(p text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  d text := regexp_replace(coalesce(p, ''), '\D', '', 'g');
begin
  if d = '' then
    return null;
  end if;

  -- DDI 55 (+55 84 ..., 0055 84 ...). Só quando sobra um número completo com DDD,
  -- para não confundir com o DDD 55 (RS) de um número já sem DDI.
  if left(d, 4) = '0055' and length(d) >= 14 then
    d := substr(d, 5);
  elsif left(d, 2) = '55' and length(d) >= 12 then
    d := substr(d, 3);
  end if;

  -- 0 de operadora / discagem nacional (0 84 99999 9999, 021 84 ...).
  if left(d, 1) = '0' and length(d) in (11, 12) then
    d := substr(d, 2);
  elsif left(d, 1) = '0' and length(d) in (13, 14) then   -- 0 + código de operadora (2 díg.) + DDD + número
    d := substr(d, 4);
  end if;

  -- Sem DDD: número local de Natal/Grande Natal (DDD 84).
  if length(d) in (8, 9) then
    d := '84' || d;
  end if;

  -- Celular antigo de 8 dígitos (6xxx-xxxx a 9xxx-xxxx) recebe o nono dígito.
  if length(d) = 10 and substr(d, 3, 1) between '6' and '9' then
    d := substr(d, 1, 2) || '9' || substr(d, 3);
  end if;

  -- Validação final: DDD da Anatel, celular 11 dígitos começando em 9, fixo 10
  -- dígitos começando em 2–5.
  if length(d) not in (10, 11) then
    return null;
  end if;
  if not app.ddd_br_valido(substr(d, 1, 2)) then
    return null;
  end if;
  if length(d) = 11 and substr(d, 3, 1) <> '9' then
    return null;
  end if;
  if length(d) = 10 and substr(d, 3, 1) not between '2' and '5' then
    return null;
  end if;

  return '+55' || d;
end $$;
comment on function app.normalize_phone_br(text) is
  'Telefone BR em qualquer formato -> E.164 (+55DDDNÚMERO); DDD 84 padrão; insere o 9 em celular antigo; NULL se inválido (RF-BAS-05). O DDD é validado contra a numeração da Anatel (app.ddd_br_valido), não só contra o zero.';


-- =====================================================================
-- 2. §3.2 — UMA REGRA SÓ DE PISO DE RECONTATO
-- =====================================================================
-- A view continua sendo a fonte: é ela que a fila de ligação lê
-- (`app.call_candidates`), é ela que a ficha lê (`public.registrar_contato`,
-- campo `cooldown_ate`), é ela que a prévia da montagem lê no cliente
-- (`apps/web/src/components/ligacao/consultas.ts`) — e agora é ela que a
-- cadência lê (`app.pode_tocar`). Uma implementação, quatro leitores.
--
-- `security_invoker = true` e `security_barrier = true` continuam onde
-- estavam, e pelo mesmo motivo: sem invoker, embaixador e leitura passariam a
-- enxergar a carteira alheia (RF-ADM-01).
create or replace view public.v_contact_cooldown
with (security_barrier = true, security_invoker = true) as
  with com_desfecho as not materialized (
    -- Toques com desfecho, já resolvidos para a organização.
    -- activities.organization_id é ANULÁVEL e o worker de WhatsApp do D5 grava a
    -- mensagem só com deal_id e contact_id. Sem o coalesce, um 'wa_optout' gravado
    -- assim não produziria linha alguma nesta view e o alvo continuaria elegível à
    -- fila das 06:00 pelo que ela diz (o guardrail forte do opt-out continua em
    -- consent_events e suppression_list, migração 000400, mas a view que a fila
    -- consulta não pode ficar em silêncio sobre ele).
    -- `not materialized`: com a CTE materializada, o filtro por organização de
    -- quem consulta a view (a porteira pergunta por UMA organização) não desce
    -- até activities, e cada pergunta varria o histórico inteiro.
    select coalesce(a.organization_id, d.organization_id) as organization_id,
           a.occurred_at,
           a.created_at,
           a.id,
           o.cooldown_days,
           o.can_reactivate,
           o.target_stage_slug,
           o.counts_as
      from public.activities a
      join public.interaction_outcomes o on o.id = a.outcome_id
      left join public.deals d on d.id = a.deal_id
     where coalesce(a.organization_id, d.organization_id) is not null
  ),
  marcado as (
    -- Os dois instantes que definem as exceções, por organização:
    --   reaberto_em = a última PORTA ABERTA (o alvo falou);
    --   ultimo_em   = a última atividade com desfecho, de qualquer tipo.
    select c.*,
           max(c.occurred_at) filter (where c.counts_as = 'aberta'::app.door_kind)
             over (partition by c.organization_id) as reaberto_em,
           max(c.occurred_at) over (partition by c.organization_id) as ultimo_em
      from com_desfecho c
  ),
  piso as (
    -- A REGRA (RF-FUN-13), uma só: o MÁXIMO das promessas que ainda contam.
    --   E1: o que é anterior à última porta aberta não conta mais.
    --   E2: canal morto (36500 dias sem etapa de destino) só conta enquanto
    --       for a última atividade — o toque por outro canal derruba a janela.
    select m.organization_id,
           max(m.occurred_at + make_interval(days => m.cooldown_days)) as cooldown_until
      from marcado m
     where m.occurred_at >= coalesce(m.reaberto_em, '-infinity'::timestamptz)
       and not (m.cooldown_days >= 36500
                and m.target_stage_slug is null
                and m.occurred_at < m.ultimo_em)
     group by m.organization_id
  ),
  bloqueio as (
    -- Bloqueio: ao contrário do piso de espera, NÃO se lê da última atividade.
    -- can_reactivate = false é grudento — o alvo pediu para parar ou disse "não"
    -- em definitivo, e só sai disso por decisão humana registrada (RF-CON-15,
    -- RF-CON-18). Se lêssemos a última linha, o worker do WhatsApp gravando
    -- 'wa_respondeu' numa mensagem que chega depois do opt-out desfaria o
    -- bloqueio sozinho, que é exatamente o guardrail que não pode cair.
    -- Guarda-se a data do último desfecho bloqueante para comparar com a reabertura.
    --
    -- Só bloqueia quem EMPURRA O NEGÓCIO PARA UMA ETAPA DE PERDA, que é exatamente a
    -- condição que dá sentido à única saída codificada abaixo ("sair de etapa de
    -- perda"). Sem essa simetria, 'wa_numero_invalido' e 'lig_numero_errado'
    -- (can_reactivate = false e target_stage_slug nulo) prendiam a organização
    -- inteira, em todos os canais, para sempre — e a própria próxima ação desses
    -- dois chips é "Buscar outro canal". O que segura o número morto é o
    -- cooldown_days de 36500 desses dois desfechos na seed, janela que cai sozinha
    -- assim que alguém registra qualquer outro toque (o tal outro canal), inclusive
    -- em organização que ainda não tem negócio (exceção E2 do piso, acima).
    select distinct on (c.organization_id)
           c.organization_id,
           c.occurred_at as blocked_since
      from com_desfecho c
     where not c.can_reactivate
       and exists (select 1 from public.stages s
                    where s.slug = c.target_stage_slug and s.is_lost)
     order by c.organization_id, c.occurred_at desc, c.created_at desc, c.id desc
  )
  select p.organization_id,
         p.cooldown_until,
         b.organization_id is not null and not exists (
           -- Saída do bloqueio: reabertura humana com motivo, saindo de uma etapa
           -- de perda (PRD §5.3, RF-FUN-08). Opt-out não tem saída (RF-CON-18),
           -- daí o `not sd.is_optout`. Vencido o bloqueio, o cooldown do desfecho
           -- (90 dias no "não" firme) ainda segura o alvo pelo prazo da §5.3.
           select 1
             from public.deal_stage_history h
             join public.deals  d  on d.id  = h.deal_id
             join public.stages sd on sd.id = h.from_stage_id
             join public.stages sp on sp.id = h.to_stage_id
            where d.organization_id = p.organization_id
              and h.changed_at > b.blocked_since
              and h.changed_by is not null
              and h.reason is not null
              and sd.is_lost and not sd.is_optout
              and not sp.is_lost
         ) as blocked_forever
    from piso p
    left join bloqueio b on b.organization_id = p.organization_id;
alter view public.v_contact_cooldown owner to postgres;
comment on view public.v_contact_cooldown is
  'A ÚNICA regra de piso de recontato e bloqueio por desfecho, por organização (RF-FUN-13). Lida pela fila de ligação (app.call_candidates), pela ficha (public.registrar_contato), pela prévia da montagem e pela porteira das cadências (app.pode_tocar) — nenhuma delas recalcula. Piso = máximo de (occurred_at + cooldown_days), com duas exceções: o que antecede a última porta aberta não conta (o alvo voltou a falar), e o canal morto de 36500 dias só conta enquanto for a última atividade (o toque por outro canal derruba a janela). Bloqueio só nasce de desfecho que leva o negócio a etapa de perda, e termina na reabertura registrada. Nada aqui dispara envio.';

grant select on public.v_contact_cooldown to authenticated, service_role;
revoke all on public.v_contact_cooldown from anon;


-- ---------- a porteira das cadências passa a LER a regra ----------
-- Único trecho alterado: os passos 2 e 3. O resto (supressão, janela do canal,
-- domingo e feriado, teto do canal) está intacto e na mesma ordem.
create or replace function app.pode_tocar(p_org uuid,
                                          p_contact uuid,
                                          p_channel app.channel,
                                          p_quando timestamptz default now())
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_quando    timestamptz := coalesce(p_quando, now());
  v_cooldown  timestamptz;
  v_bloqueado boolean := false;
  v_ultima    timestamptz;
  v_reativa   boolean;
  v_reaberto  boolean;
  v_respondeu boolean;
  v_janela    jsonb;
  v_dia       date;
  v_teto      int;
  v_usados    int;
  v_prox      date;
begin
  -- 1 · Supressão. Não adia, não reagenda: ENCERRA. É o guardrail do CLAUDE.md
  --     e vale em qualquer canal e em qualquer modo.
  if app.is_suppressed_target(p_org, p_contact) then
    return jsonb_build_object('pode', false, 'quando', null, 'motivo', 'suprimido');
  end if;

  -- 2 · Piso de recontato (RF-FUN-13). É FILTRO DE ENTRADA — quando vencer, o
  --     alvo volta a ser elegível; ele nunca dispara nada por conta própria.
  --     A regra NÃO é recalculada aqui: é lida de public.v_contact_cooldown,
  --     a mesma linha que a fila de ligação lê. Era exatamente esta duplicação
  --     que dava duas respostas diferentes para a mesma pergunta (laudo §3.2).
  select c.cooldown_until, coalesce(c.blocked_forever, false)
    into v_cooldown, v_bloqueado
    from public.v_contact_cooldown c
   where c.organization_id = p_org;
  if v_cooldown is not null and v_quando < v_cooldown then
    return jsonb_build_object('pode', false, 'quando', v_cooldown, 'motivo', 'cooldown');
  end if;

  -- 3 · Alvo bloqueado, ou último desfecho não reativável → ENCERRA. Só volta
  --     por decisão humana registrada com motivo.
  --     São DUAS leituras, e as duas precisam existir:
  --       · `blocked_forever` (o mesmo que a fila usa) pega o opt-out cuja
  --         espera já venceu — inclusive quando uma resposta posterior do alvo
  --         venceu a espera pela exceção E1;
  --       · o `can_reactivate` da última atividade pega o número morto, que de
  --         propósito NÃO bloqueia a organização na view (a próxima ação dele é
  --         buscar outro canal) mas também não pode virar cadência automática.
  if v_bloqueado then
    return jsonb_build_object('pode', false, 'quando', null, 'motivo', 'nao_reativavel');
  end if;
  select o.can_reactivate, a.occurred_at
    into v_reativa, v_ultima
    from public.activities a
    join public.interaction_outcomes o on o.id = a.outcome_id
    left join public.deals d on d.id = a.deal_id
   where coalesce(a.organization_id, d.organization_id) = p_org
   order by a.occurred_at desc, a.created_at desc, a.id desc
   limit 1;
  if v_reativa is not null and not v_reativa then
    v_reaberto := exists (
      select 1
        from public.deal_stage_history h
        join public.deals  dd on dd.id = h.deal_id
        join public.stages sd on sd.id = h.from_stage_id
        join public.stages sp on sp.id = h.to_stage_id
       where dd.organization_id = p_org
         and h.changed_at > v_ultima
         and h.changed_by is not null
         and h.reason is not null
         and sd.is_lost and not sd.is_optout and not sp.is_lost);
    if not v_reaberto then
      return jsonb_build_object('pode', false, 'quando', null, 'motivo', 'nao_reativavel');
    end if;
  end if;

  -- 4 · Janela do canal, em America/Fortaleza, empurrando para a PRÓXIMA
  --     abertura (nunca antecipando). 5 · Domingo e feriado já saem daqui,
  --     porque `app.call_window` e `app.janela_do_canal` os bloqueiam e devolvem
  --     `abre_em` pela próxima abertura.
  v_respondeu := app.ja_respondeu(p_org);
  v_janela := app.janela_do_canal(p_channel, v_quando, v_respondeu);
  if not coalesce((v_janela ->> 'aberta')::boolean, false) then
    return jsonb_build_object('pode', false,
                              'quando', (v_janela ->> 'abre_em')::timestamptz,
                              'motivo', 'janela_' || coalesce(v_janela ->> 'motivo', 'fechada'));
  end if;

  -- 6 · Teto do canal no dia (RF-CON-10). O excedente ATRASA, nunca duplica.
  v_dia    := (v_quando at time zone 'America/Fortaleza')::date;
  v_teto   := app.teto_do_canal(p_channel, v_dia);
  v_usados := app.toques_do_dia(p_channel, v_dia);
  if v_usados >= v_teto then
    v_prox := app.next_business_day(v_dia, 1);
    return jsonb_build_object(
      'pode', false,
      'quando', coalesce(
        case when p_channel = 'phone'::app.channel
             then app.proxima_abertura(v_dia)
             else app.proxima_abertura_do_canal(v_dia, p_channel, v_respondeu) end,
        (v_prox + time '09:00') at time zone 'America/Fortaleza'),
      'motivo', 'teto_do_canal');
  end if;

  -- 7 · A condição do passo e os tiers NÃO cabem aqui: esta função não conhece
  --     passo. Quem os avalia — e marca o toque como `pulado` — é
  --     `app.abrir_proximo_toque`, logo antes de chamar esta porteira.
  return jsonb_build_object('pode', true, 'quando', v_quando, 'motivo', null);
end $$;
comment on function app.pode_tocar(uuid, uuid, app.channel, timestamptz) is
  'A porteira das cadências. Devolve {pode, quando, motivo}. Ordem: supressão (encerra) → piso de recontato lido de public.v_contact_cooldown (adia) → bloqueio ou desfecho não reativável (encerra) → janela do canal (adia) → feriado/domingo (adia) → teto do canal (adia). O piso NÃO é recalculado aqui: é a mesma linha que a fila de ligação lê, e essa é a correção do laudo §3.2. Motivo "suprimido" e "nao_reativavel" vêm com quando = null: quem chama tem de ENCERRAR a matrícula, não reagendar.';
revoke all on function app.pode_tocar(uuid, uuid, app.channel, timestamptz) from public, anon;
grant execute on function app.pode_tocar(uuid, uuid, app.channel, timestamptz) to authenticated, service_role;


-- =====================================================================
-- 3. §3.12j — QUEM NUNCA FOI TOCADO ESFRIA PELA DATA DE CRIAÇÃO
-- =====================================================================
-- `app.compute_temperature` recebe o instante do último contato e, quando ele
-- é NULO, contava ZERO DIAS. Consequência: um negócio quente que nunca teve
-- contato registrado ficava quente para sempre — nem esfriava aos 14 dias, nem
-- acendia o alerta vermelho aos 5. É o oposto do que a §5.6 quer: um alvo
-- parado é o caso que mais precisa de alerta.
--
-- A regra pura NÃO muda (e por isso o teste 05 continua valendo palavra por
-- palavra): o que muda é a ENTRADA. Quem chama passa o instante de referência
-- — o último contato quando existe, a criação do negócio quando não existe.
-- É a leitura honesta de "está parado há quanto tempo?", e não inventa
-- atividade nenhuma: um negócio criado hoje tem zero dia de parado.
--
-- MEDIDO ANTES DE APLICAR, nos 100 leads reais deste banco: os 100 têm
-- `last_activity_at` nulo, os 100 estão em etapa fria e os 100 foram criados
-- em 05/09/2026. Nenhum muda de temperatura com esta correção — o ramo frio
-- não olha recência. Quem muda é o quente e o morno parados, que hoje não
-- existem na base e vão existir na primeira semana de operação.
comment on function app.compute_temperature(app.temperature, text, timestamptz, smallint, app.deal_status) is
  'Regra de temperatura do PRD §5.6 (etapa × intenção × recência × override × status). O terceiro argumento é o INSTANTE DE REFERÊNCIA da recência: quem chama passa o último contato, ou a criação do negócio quando não houve contato nenhum (nulo aqui continua valendo zero dia, e é por isso que a decisão é de quem chama).';

create or replace function app.deals_apply_temperature()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_stage_temp app.temperature;
  v_override   smallint;
  r record;
begin
  select s.temperature into v_stage_temp from public.stages s where s.id = new.stage_id;
  select o.temperature_override into v_override from public.organizations o where o.id = new.organization_id;
  -- coalesce(last_activity_at, created_at): sem contato registrado, a recência é
  -- contada desde que o negócio existe (laudo §3.12j).
  select * into r from app.compute_temperature(v_stage_temp, new.last_intent,
                                               coalesce(new.last_activity_at, new.created_at),
                                               v_override, new.status);
  new.temperature := r.temperature;
  new.needs_attention := r.needs_attention;
  return new;
end $$;


-- =====================================================================
-- 4. §3.12l — A TAREFA DE REENGAJAR QUE O PRD §5.6 PEDE
-- =====================================================================
-- PRD §5.6, linha do Morno: "> 7 dias sem contato → alerta E TAREFA DE
-- REENGAJAR". Confirmado o achado do laudo: só o alerta existia
-- (`needs_attention`), a tarefa não era criada em lugar nenhum — nem aqui, nem
-- em `move_deal`, nem nas cadências. Uma bandeira num cartão não é trabalho na
-- lista de ninguém.
--
-- Onde nasce: no mesmo recálculo diário que acende a bandeira, porque é ele
-- que sabe o dia em que o negócio cruzou os 7 dias. Uma tarefa por negócio,
-- não uma por dia: enquanto a de ontem estiver aberta, hoje não cria outra.
--
-- Guardrails, na ordem em que valem:
--   · contato suprimido não ganha tarefa NENHUMA (do_not_contact ou
--     suppression_list, organização ou contato) — o CLAUDE.md diz "nenhum
--     envio, tarefa, cadência ou fila toca contato suprimido";
--   · organização apagada (LGPD) fica de fora;
--   · a tarefa é TRABALHO DE GENTE: nasce como `todo` com dono, e nada é
--     enviado por causa dela (ADR-05).
--
-- O quente com mais de 5 dias continua só com o alerta vermelho: a §5.6 pede
-- tarefa para o morno, e inventar uma para o quente seria produto novo.
create or replace function app.recompute_temperatures()
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  n int;
begin
  with calc as (
    select d.id,
           (app.compute_temperature(s.temperature, d.last_intent,
                                    coalesce(d.last_activity_at, d.created_at),
                                    o.temperature_override, d.status)).*
      from public.deals d
      join public.stages s on s.id = d.stage_id
      join public.organizations o on o.id = d.organization_id
     where d.status = 'open'
  )
  update public.deals d
     set temperature = c.temperature,
         needs_attention = c.needs_attention
    from calc c
   where d.id = c.id
     and (d.temperature is distinct from c.temperature or d.needs_attention is distinct from c.needs_attention);
  get diagnostics n = row_count;

  -- A tarefa de reengajar (PRD §5.6).
  insert into public.tasks (title, kind, due_at, assignee_id, organization_id,
                            deal_id, contact_id, origin, priority)
  select left('Reengajar: ' || o.name || ' está morno há '
              || floor(extract(epoch from (now() - coalesce(d.last_activity_at, d.created_at))) / 86400)::int
              || ' dias sem contato', 200),
         'follow_up'::app.task_kind,
         now(),
         -- Dono: o do negócio; sem ele, o da ficha. Tarefa sem dono só aparece
         -- para gestor e admin, e aí é ele quem a distribui.
         coalesce(d.owner_id, o.owner_id),
         d.organization_id,
         d.id,
         d.primary_contact_id,
         'system',
         2
    from public.deals d
    join public.organizations o on o.id = d.organization_id
   where d.status = 'open'
     and d.temperature = 'morno'::app.temperature
     and d.needs_attention
     and o.deleted_at is null
     and not app.is_suppressed_target(d.organization_id, d.primary_contact_id)
     and not exists (select 1 from public.tasks t
                      where t.deal_id = d.id
                        and t.origin = 'system'
                        and t.title like 'Reengajar%'
                        and t.status in ('todo'::app.task_status, 'doing'::app.task_status));

  return n;
end $$;
comment on function app.recompute_temperatures() is
  'Recalcula temperatura/alerta de todos os negócios abertos (a recência conta desde o último contato, ou desde a criação quando não houve contato) e cria a tarefa de reengajar do PRD §5.6 para o morno com alerta — uma por negócio, nunca para contato suprimido. Devolve quantos negócios mudaram de temperatura ou de alerta.';
revoke execute on function app.recompute_temperatures() from public, anon, authenticated;
grant execute on function app.recompute_temperatures() to service_role;


-- =====================================================================
-- 5. §3.12e — "RESTANTES" NÃO CONTA QUEM FOI SUPRIMIDO
-- =====================================================================
-- O número que a tela de chamada mostra no topo ("faltam 12") contava todo item
-- em `fila` ou `em_andamento`, sem perguntar se o alvo continua contatável.
-- Quem pediu opt-out no meio do lote continuava no número até alguém puxar o
-- próximo e a fila devolvê-lo — até 30 minutos depois, no pior caso. O número
-- de trabalho da Heloísa passa a ser o número de gente que ela realmente pode
-- ligar.
create or replace function app.itens_restantes_do_lote(p_batch uuid)
returns int
language sql
stable
security definer
set search_path = ''
as $$
  select count(*)::int
    from public.call_batch_items x
    join public.organizations o on o.id = x.organization_id
   where x.batch_id = p_batch
     and x.status in ('fila'::app.call_item_status, 'em_andamento'::app.call_item_status)
     and o.deleted_at is null
     and not app.is_suppressed_target(x.organization_id, x.contact_id)
$$;
comment on function app.itens_restantes_do_lote(uuid) is
  'Quantos contatos do lote ainda podem receber ligação: fila + em andamento, menos os suprimidos e as organizações apagadas (laudo §3.12e). SECURITY DEFINER porque a supressão mora em app.suppression_list, que sdr não lê.';
revoke all on function app.itens_restantes_do_lote(uuid) from public, anon;
grant execute on function app.itens_restantes_do_lote(uuid) to authenticated, service_role;


-- =====================================================================
-- 6. §3.12d — POR QUE A FILA NÃO ENTREGOU NINGUÉM
-- =====================================================================
-- "Fila vazia" era a resposta para três situações diferentes, e duas delas têm
-- ação: esperar (o intervalo entre tentativas ainda corre) e montar outro lote
-- (o teto de tentativas estourou). A terceira, essa sim, é fila vazia.
--
-- O `motivo` continua sendo `fila_vazia`, e isso é de propósito: o contrato
-- que a tela valida (`apps/web/src/components/ligacao/chamada-rpc.ts`, enum
-- do zod) não aceita um motivo novo, e uma tela que quebra a validação é pior
-- do que uma tela que informa pouco. O que era `detalhe: null` passa a nomear
-- a situação, e vêm junto os números e a hora em que a fila volta.
create or replace function app.motivo_da_fila_vazia(p_batch uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  b            public.call_batches%rowtype;
  v_no_teto    int := 0;
  v_esperando  int := 0;
  v_volta_em   timestamptz;
begin
  select * into b from public.call_batches where id = p_batch;
  select count(*) filter (where x.attempts >= b.max_attempts),
         count(*) filter (where x.attempts <  b.max_attempts),
         min(case when x.attempts < b.max_attempts then
                    greatest(coalesce(x.scheduled_at, now()),
                             coalesce(x.last_attempt_at
                                      + make_interval(hours => b.min_hours_between_attempts), now()))
             end)
    into v_no_teto, v_esperando, v_volta_em
    from public.call_batch_items x
   where x.batch_id = p_batch
     and x.status = 'fila'::app.call_item_status;

  return jsonb_build_object(
    'ok', false,
    'motivo', 'fila_vazia',
    -- A espera vem antes do teto porque é a única das três que se resolve
    -- sozinha: quem espera volta, quem estourou o teto não volta neste lote.
    'detalhe', case when coalesce(v_esperando, 0) > 0 then 'aguardando_intervalo'
                    when coalesce(v_no_teto, 0)   > 0 then 'tentativas_esgotadas'
               end,
    'itens_esperando', coalesce(v_esperando, 0),
    'itens_no_teto',   coalesce(v_no_teto, 0),
    'volta_em',        v_volta_em);
end $$;
comment on function app.motivo_da_fila_vazia(uuid) is
  'Diz POR QUE a fila do lote não entregou ninguém: aguardando_intervalo (com a hora da volta), tentativas_esgotadas, ou nenhum dos dois (fila vazia de verdade). O motivo devolvido continua sendo fila_vazia para não quebrar o contrato que a tela valida (laudo §3.12d).';
revoke all on function app.motivo_da_fila_vazia(uuid) from public, anon;
grant execute on function app.motivo_da_fila_vazia(uuid) to authenticated, service_role;


-- ---------- a fila, com o motivo nomeado e o "restantes" honesto ----------
create or replace function public.proximo_da_fila(p_lote_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid     uuid := auth.uid();
  v_role    app.user_role;
  v_hoje    date := (now() at time zone 'America/Fortaleza')::date;
  b         public.call_batches%rowtype;
  i         public.call_batch_items%rowtype;
  v_janela  jsonb;
  v_org     public.organizations%rowtype;
  v_contato public.contacts%rowtype;
  v_restam  int;
  v_voltas  int := 0;
  v_achou   boolean := false;
begin
  if v_uid is null then
    raise exception 'Usuário não autenticado' using errcode = '42501';
  end if;
  v_role := app.role();
  if not app.can_write() then
    return jsonb_build_object('ok', false, 'motivo', 'sem_permissao', 'detalhe', null);
  end if;

  select * into b from public.call_batches where id = p_lote_id;
  if not found or not (app.is_manager() or b.owner_id = v_uid) then
    return jsonb_build_object('ok', false, 'motivo', 'lote_de_outro_dono', 'detalhe', null);
  end if;
  if b.status <> 'ativo'::app.call_batch_status then
    return jsonb_build_object('ok', false, 'motivo', 'lote_encerrado', 'detalhe', b.status::text);
  end if;
  if v_hoje < b.starts_on or v_hoje > b.ends_on then
    return jsonb_build_object('ok', false, 'motivo', 'fora_do_periodo',
                              'detalhe', b.starts_on::text || '..' || b.ends_on::text);
  end if;

  -- ----- a janela, antes de tudo (R13 §6) -----
  v_janela := app.call_window(now());
  if not (v_janela ->> 'aberta')::boolean then
    return jsonb_build_object('ok', false, 'motivo', 'fora_da_janela',
                              'detalhe', v_janela ->> 'motivo',
                              'abre_em', v_janela -> 'abre_em');
  end if;

  -- Reserva vencida do PRÓPRIO lote volta para a fila antes da escolha: quem
  -- abandonou uma ligação há 40 minutos não pode ser o motivo de a fila parecer vazia.
  update public.call_batch_items x
     set status = 'fila'::app.call_item_status, reserved_until = null, reserved_by = null
   where x.batch_id = b.id
     and x.status = 'em_andamento'::app.call_item_status
     and x.reserved_until < now();

  -- ----- o próximo -----
  -- Uma regra só se sobrepõe à posição congelada, e ela vem do cliente e não do
  -- sistema: item reagendado e vencido vai para o topo, pelo horário combinado.
  -- "Me liga terça às 10h" é a única promessa que a fila tem de cumprir.
  loop
    v_voltas := v_voltas + 1;
    exit when v_voltas > 50;

    select * into i
      from public.call_batch_items x
     where x.batch_id = b.id
       and x.status = 'fila'::app.call_item_status
       and (x.scheduled_at is null or x.scheduled_at <= now())
       and x.attempts < b.max_attempts
       and (x.last_attempt_at is null
            or x.last_attempt_at <= now() - make_interval(hours => b.min_hours_between_attempts))
     order by (x.scheduled_at is not null) desc, x.scheduled_at nulls last, x.position
     limit 1
       for update skip locked;

    if not found then
      -- §3.12d: nomear o que aconteceu. "Fila vazia" era a resposta para três
      -- situações diferentes, e duas delas têm ação.
      return app.motivo_da_fila_vazia(b.id);
    end if;

    -- ----- guardrail: alguém pode ter pedido opt-out DEPOIS de o lote ser montado -----
    select * into v_org from public.organizations where id = i.organization_id;
    if v_org.deleted_at is not null
       or app.is_suppressed_target(i.organization_id, i.contact_id) then
      update public.call_batch_items x
         set status = 'devolvido'::app.call_item_status,
             reserved_until = null, reserved_by = null,
             note = coalesce(x.note, 'contato suprimido depois da montagem')
       where x.id = i.id;
      continue;
    end if;

    v_achou := true;
    exit;
  end loop;

  if not v_achou then
    return app.motivo_da_fila_vazia(b.id);
  end if;

  -- ----- a reserva de trabalho -----
  update public.call_batch_items x
     set status = 'em_andamento'::app.call_item_status,
         reserved_until = now() + interval '30 minutes',
         reserved_by = v_uid
   where x.id = i.id
  returning * into i;

  if i.contact_id is not null then
    select * into v_contato from public.contacts where id = i.contact_id;
  end if;

  -- §3.12e: o número de trabalho não conta quem já não pode ser ligado.
  v_restam := app.itens_restantes_do_lote(b.id);

  -- Revelar o telefone é ato registrado (RF-BAS-14, RF-ADM-03), aqui como no reveal_phone.
  insert into public.pii_access_log (actor_id, actor_role, action, entity_type, entity_id, scope)
  values (v_uid, v_role::text, 'reveal_phone', 'organization', i.organization_id,
          jsonb_build_object('origem', 'proximo_da_fila', 'lote_id', b.id, 'item_id', i.id));

  return jsonb_build_object(
    'ok', true,
    'item', jsonb_build_object(
      'id',                i.id,
      'lote_id',           b.id,
      'organization_id',   i.organization_id,
      'nome',              v_org.name,
      'kind',              v_org.kind,
      'categoria',         (select c.name from public.organization_categories oc
                              join public.categories c on c.id = oc.category_id
                             where oc.organization_id = v_org.id
                             order by oc.is_primary desc limit 1),
      'bairro',            v_org.neighborhood,
      'cidade',            (select c.name from public.cities c where c.id = v_org.city_id),
      'telefone',          i.phone_e164,
      'contato_id',        i.contact_id,
      'contato_nome',      coalesce(v_contato.first_name, v_contato.full_name),
      'origem_slug',       (select s.slug from public.sources s where s.id = v_org.source_id),
      'origem_url',        v_org.source_url,
      'deal_id',           i.deal_id,
      'etapa_id',          i.stage_id,
      'etapa',             (select s.name from public.stages s where s.id = i.stage_id),
      'temperatura',       v_org.temperature,
      'status',            i.status,
      'posicao',           i.position,
      'tentativas',        i.attempts,
      'agendado_para',     i.scheduled_at,
      'ultima_tentativa_em', i.last_attempt_at,
      'reservado_ate',     i.reserved_until,
      'observacao',        i.note),
    'roteiro', jsonb_build_object(
      'id',     b.script_id,
      'versao', b.script_version,
      'arvore', (select s.arvore from public.call_scripts s where s.id = b.script_id)),
    'variante', case when v_org.kind in ('produtor'::app.org_kind, 'cerimonialista'::app.org_kind)
                     then 'produtor' else 'fornecedor' end,
    'restantes', v_restam,
    'fecha_em', v_janela -> 'fecha_em');
end $$;
comment on function public.proximo_da_fila(uuid) is
  'Entrega o próximo contato do lote com trava (for update skip locked), revela o telefone com registro em pii_access_log (RF-BAS-14) e recusa com motivo nomeado: fora_da_janela (domingo, feriado, antes/depois do horário — R13 §6), lote_encerrado, fora_do_periodo, lote_de_outro_dono, fila_vazia. Quando a fila não entrega ninguém, o `detalhe` diz por quê — aguardando_intervalo (com `volta_em`) ou tentativas_esgotadas (laudo §3.12d). "restantes" não conta contato suprimido (§3.12e). Contato que virou suprimido depois da montagem sai do lote em vez de ser entregue (RF-CON-18).';
revoke all on function public.proximo_da_fila(uuid) from public, anon;
grant execute on function public.proximo_da_fila(uuid) to authenticated, service_role;


-- =====================================================================
-- 7. §3.12b — A TAREFA SABE EM QUAL TENTATIVA ESTÁ
-- =====================================================================
-- O catálogo chama a próxima ação de "Ligar D+1 (última)" (seed.sql, chip
-- `lig_nao_atendeu`), e o texto está certo para a régua 1+1 do RF-CON-13, que
-- é a da ficha: uma ligação e um retorno. Dentro de um LOTE, porém, o padrão é
-- `max_attempts = 3`, e a tarefa chamava de última a primeira das três.
--
-- O conserto é do lado que SABE a tentativa: a tabulação da chamada, que tem o
-- item e o lote em mãos. O rótulo do catálogo continua intacto para a ficha; no
-- lote, a parte entre parênteses (se houver) é trocada pela contagem real.
create or replace function app.titulo_da_tentativa(p_task uuid, p_label text,
                                                   p_feitas int, p_max int)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_base text := regexp_replace(coalesce(nullif(trim(p_label), ''), 'Ligar de novo'),
                                '\s*\([^()]*\)\s*$', '');
begin
  if p_task is null then
    return;
  end if;
  update public.tasks t
     set title = left(v_base ||
           case when p_feitas >= p_max
                  then ' (tentativas do lote esgotadas)'
                when p_feitas + 1 >= p_max
                  then ' (tentativa ' || (p_feitas + 1) || ' de ' || p_max || ', a última)'
                else ' (tentativa ' || (p_feitas + 1) || ' de ' || p_max || ')'
           end, 200)
   where t.id = p_task;
end $$;
comment on function app.titulo_da_tentativa(uuid, text, int, int) is
  'Reescreve o título da tarefa de "ligar de novo" com a tentativa real do lote (laudo §3.12b). SECURITY DEFINER porque a tabulação é invoker e a tarefa pode ter nascido no negócio de outra pessoa.';
revoke all on function app.titulo_da_tentativa(uuid, text, int, int) from public, anon;
grant execute on function app.titulo_da_tentativa(uuid, text, int, int) to authenticated, service_role;


create or replace function public.tabular_chamada(
  p_client_key            uuid,
  p_chamada_id            uuid,
  p_item_id               uuid,
  p_resultado             app.call_result,
  p_com_quem              text        default 'nao_informado',
  p_outcome_id            int         default null,
  p_caminho_script        text[]      default '{}',
  p_duracao_seg           int         default 0,
  p_observacao            text        default null,
  p_capturas              jsonb       default '{}'::jsonb,
  p_agendar_para          timestamptz default null,
  p_lost_reason_id        int         default null,
  p_reuniao_em            timestamptz default null,
  p_reuniao_formato       text        default null,
  p_pediu_para_nao_ligar  boolean     default false)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_uid       uuid := auth.uid();
  a           public.call_attempts%rowtype;
  b           public.call_batches%rowtype;
  o           public.interaction_outcomes%rowtype;
  -- O item é lido COLUNA A COLUNA, e não com %rowtype, porque esta função é
  -- SECURITY INVOKER e `call_batch_items.phone_e164` não é legível por sdr
  -- (RF-BAS-14, seção 9). `select *` aqui seria "permission denied for column",
  -- e contorná-lo com definer daria a esta função mais poder do que quem a chama.
  v_item_org  uuid;
  v_item_ct   uuid;
  v_item_deal uuid;
  v_item_st   app.call_item_status;
  v_item_tent int;
  v_slug      text;
  v_reg       jsonb;
  v_motivo    text;
  v_supr      boolean;
  v_volta     boolean := false;
  v_status    app.call_item_status;
  v_agenda    timestamptz;
  v_restam    int;
  v_activity  uuid;
  v_task      uuid;
  v_optout    boolean := coalesce(p_pediu_para_nao_ligar, false);
  v_opt       jsonb;
begin
  if v_uid is null then
    raise exception 'Usuário não autenticado' using errcode = '42501';
  end if;
  if not app.can_write() then
    return jsonb_build_object('tabulado', false, 'motivo', 'sem_permissao', 'detalhe', null);
  end if;

  -- As três recusas abaixo são anteriores a saber QUEM é o alvo: sem organização
  -- não há opt-out a registrar, e inventar um alvo seria pior do que não registrar.
  select * into a from public.call_attempts where id = p_chamada_id;
  if not found then
    return jsonb_build_object('tabulado', false, 'motivo', 'chamada_ja_encerrada',
                              'detalhe', 'chamada_inexistente');
  end if;
  if a.item_id <> p_item_id then
    return jsonb_build_object('tabulado', false, 'motivo', 'item_de_outro_dono',
                              'detalhe', 'chamada_de_outro_item');
  end if;

  select x.organization_id, x.contact_id, x.deal_id, x.status, x.attempts
    into v_item_org, v_item_ct, v_item_deal, v_item_st, v_item_tent
    from public.call_batch_items x where x.id = a.item_id;
  select * into b from public.call_batches b2 where b2.id = a.batch_id;
  if not (app.is_manager() or b.owner_id = v_uid) then
    return jsonb_build_object('tabulado', false, 'motivo', 'item_de_outro_dono', 'detalhe', null);
  end if;

  -- ----- daqui para baixo, nenhuma recusa engole o pedido de opt-out (D6) -----
  if b.status = 'encerrado'::app.call_batch_status then
    return app.recusa_de_tabulacao('lote_encerrado', null,
                                   v_optout, v_item_org, v_item_ct, p_observacao);
  end if;

  -- ----- idempotência: a fila offline reenvia -----
  if a.encerrada_em is not null then
    if a.client_key is not null and a.client_key = p_client_key then
      if v_optout then
        v_opt := app.registrar_optout_de_contato(v_item_org, v_item_ct, p_observacao,
                                                 'phone'::app.channel);
      end if;
      v_restam := app.itens_restantes_do_lote(b.id);
      return jsonb_build_object(
        'tabulado', true, 'repetido', true,
        'attempt_id', a.id, 'activity_id', a.activity_id,
        'item_status', v_item_st, 'volta_para_fila', v_item_st = 'fila'::app.call_item_status,
        'tentativas', v_item_tent,
        'proxima_acao_em', null, 'proxima_acao_titulo', null,
        'restantes', v_restam,
        'optout_registrado', coalesce((v_opt ->> 'registrado')::boolean, false));
    end if;
    return app.recusa_de_tabulacao('chamada_ja_encerrada', null,
                                   v_optout, v_item_org, v_item_ct, p_observacao);
  end if;

  -- ----- os dois eixos (R13 §3.3): sem atendimento não existe resultado comercial -----
  if p_resultado = 'atendida_humano'::app.call_result then
    if p_outcome_id is null then
      return app.recusa_de_tabulacao('eixos_incoerentes', 'atendeu_sem_desfecho',
                                     v_optout, v_item_org, v_item_ct, p_observacao);
    end if;
    select * into o from public.interaction_outcomes
     where id = p_outcome_id and is_active
       and 'ligacao'::app.interaction_surface = any (surfaces);
    if not found then
      return app.recusa_de_tabulacao('desfecho_invalido', null,
                                     v_optout, v_item_org, v_item_ct, p_observacao);
    end if;
    if not o.requires_answer then
      return app.recusa_de_tabulacao('eixos_incoerentes', o.slug,
                                     v_optout, v_item_org, v_item_ct, p_observacao);
    end if;
  else
    if p_outcome_id is not null then
      return app.recusa_de_tabulacao('eixos_incoerentes', 'sem_atendimento_com_desfecho',
                                     v_optout, v_item_org, v_item_ct, p_observacao);
    end if;
    v_slug := app.outcome_for_call_result(p_resultado);
    select * into o from public.interaction_outcomes where slug = v_slug and is_active;
    if not found then
      return app.recusa_de_tabulacao('desfecho_invalido', v_slug,
                                     v_optout, v_item_org, v_item_ct, p_observacao);
    end if;
  end if;

  -- ----- a consequência sai de registrar_contato, não daqui -----
  v_reg := public.registrar_contato(
             p_client_key             => p_client_key,
             p_organization_id        => v_item_org,
             p_outcome_id             => o.id,
             p_com_quem               => p_com_quem,
             p_deal_id                => v_item_deal,
             p_occurred_at            => now(),
             p_body                   => p_observacao,
             p_duration_min           => nullif(round(coalesce(p_duracao_seg, 0) / 60.0)::int, 0),
             p_lost_reason_id         => p_lost_reason_id,
             p_meeting_at             => p_reuniao_em,
             p_meeting_format         => p_reuniao_formato,
             p_next_action_at         => p_agendar_para);

  if not (v_reg ->> 'registrado')::boolean then
    v_motivo := case v_reg ->> 'motivo'
                  when 'motivo_de_perda_obrigatorio' then 'motivo_de_perda_obrigatorio'
                  when 'reuniao_sem_data'            then 'reuniao_sem_data'
                  when 'sem_permissao'               then 'sem_permissao'
                  else 'desfecho_invalido'
                end;
    -- ESTA é a linha do defeito D6: a recusa mais comum da tabulação — "Sem
    -- interesse" sem motivo de perda, que é o próprio caminho do nó fim_optout —
    -- devolvia o não e descartava o pedido de opt-out junto.
    return app.recusa_de_tabulacao(v_motivo, v_reg ->> 'motivo',
                                   v_optout, v_item_org, v_item_ct, p_observacao);
  end if;
  v_activity := nullif(v_reg ->> 'activity_id', '')::uuid;
  v_task     := nullif(v_reg ->> 'task_id', '')::uuid;
  v_supr     := coalesce((v_reg ->> 'contato_suprimido')::boolean, false);

  -- ----- "não me ligue mais" (RF-CON-18) -----
  -- Depois do desfecho, e não no lugar dele: a atividade é a prova de que o pedido
  -- existiu, e app.consent_apply é quem marca do_not_contact, semeia a
  -- suppression_list, cancela as tarefas abertas e leva o negócio para a etapa de
  -- opt-out — que é a última palavra sobre a etapa, e por isso vem por último.
  if v_optout then
    v_opt  := app.registrar_optout_de_contato(v_item_org, v_item_ct, p_observacao,
                                              'phone'::app.channel);
    v_supr := v_supr or coalesce((v_opt ->> 'registrado')::boolean, false);
  end if;

  -- ----- fecha a tentativa -----
  update public.call_attempts x
     set encerrada_em   = now(),
         atendida_em    = case when p_resultado = 'atendida_humano'::app.call_result
                               then coalesce(x.atendida_em, now()) else x.atendida_em end,
         duracao_seg    = greatest(coalesce(p_duracao_seg, 0), 0),
         resultado      = p_resultado,
         outcome_id     = case when p_resultado = 'atendida_humano'::app.call_result then o.id end,
         activity_id    = v_activity,
         caminho_script = coalesce(p_caminho_script, '{}'),
         capturas       = coalesce(p_capturas, '{}'::jsonb),
         client_key     = p_client_key
   where x.id = a.id
  returning * into a;

  -- ----- o item volta para a fila? -----
  -- Quem decide é o CATÁLOGO, não a tela: desfecho cuja próxima ação é ligar de
  -- novo (`next_action_kind = 'call'`) e que não bloqueia o alvo (`can_reactivate`)
  -- pede outra tentativa. É o que cobre "não atendeu", "caixa postal" e "atendeu,
  -- retorna depois"; "número errado" (outra ação), "interessado", "agora não",
  -- "sem interesse" e "reunião marcada" encerram o item.
  v_volta := o.can_reactivate
             and o.next_action_kind = 'call'::app.task_kind
             and v_item_tent < b.max_attempts
             and not v_supr
             and b.ends_on >= (now() at time zone 'America/Fortaleza')::date;

  if v_volta then
    v_agenda := coalesce(p_agendar_para,
                         now() + make_interval(hours => b.min_hours_between_attempts));
    v_status := 'fila'::app.call_item_status;
  else
    v_agenda := null;
    v_status := case when v_supr then 'devolvido'::app.call_item_status
                     else 'concluido'::app.call_item_status end;
  end if;

  update public.call_batch_items x
     set status         = v_status,
         scheduled_at   = v_agenda,
         reserved_until = null,
         reserved_by    = null,
         note           = coalesce(nullif(trim(coalesce(p_observacao, '')), ''), x.note)
   where x.id = a.item_id
  returning x.status, x.attempts into v_item_st, v_item_tent;

  -- §3.12b: a tarefa de ligar de novo diz em qual tentativa do lote está.
  -- `v_item_tent` já é o número de tentativas FEITAS (a chamada de agora conta).
  if o.next_action_kind = 'call'::app.task_kind then
    perform app.titulo_da_tentativa(v_task, o.next_action_label, v_item_tent, b.max_attempts);
  end if;

  -- §3.12e: "restantes" não conta quem foi suprimido no meio do lote.
  v_restam := app.itens_restantes_do_lote(b.id);

  return jsonb_build_object(
    'tabulado',            true,
    'repetido',            coalesce((v_reg ->> 'repetido')::boolean, false),
    'attempt_id',          a.id,
    'activity_id',         v_activity,
    'item_status',         v_item_st,
    'volta_para_fila',     v_volta,
    'tentativas',          v_item_tent,
    'proxima_acao_em',     v_reg -> 'proxima_acao_em',
    'proxima_acao_titulo', v_reg -> 'proxima_acao_titulo',
    'restantes',           v_restam,
    'outcome_slug',        o.slug,
    'contato_suprimido',   v_supr,
    'optout_registrado',   coalesce((v_opt ->> 'registrado')::boolean, false),
    'registro',            v_reg);
end $$;
comment on function public.tabular_chamada(uuid, uuid, uuid, app.call_result, text, int, text[], int,
                                           text, jsonb, timestamptz, int, timestamptz, text, boolean) is
  'Fecha a tentativa de ligação com os dois eixos do R13 §3.3 e delega TODA a consequência comercial a public.registrar_contato (etapa, temperatura, próxima ação, cooldown, guardrail de supressão). Devolve o item à fila quando o desfecho do catálogo pede nova tentativa, e escreve na tarefa em QUAL tentativa do lote ela está (§3.12b). "restantes" não conta contato suprimido (§3.12e). Idempotente pela chave do cliente. O pedido de "não me ligue mais" (p_pediu_para_nao_ligar) é registrado em QUALQUER desfecho e TAMBÉM em toda recusa posterior à autorização (D6, RF-CON-18): recusa nunca descarta opt-out. Recusa prevista volta como {tabulado:false, motivo, optout_registrado}.';
revoke all on function public.tabular_chamada(uuid, uuid, uuid, app.call_result, text, int, text[], int,
                                              text, jsonb, timestamptz, int, timestamptz, text, boolean)
  from public, anon;
grant execute on function public.tabular_chamada(uuid, uuid, uuid, app.call_result, text, int, text[], int,
                                                 text, jsonb, timestamptz, int, timestamptz, text, boolean)
  to authenticated, service_role;


-- =====================================================================
-- 8. §3.12c — O PRAZO ESTICADO PARA DE SER SILENCIOSO
-- =====================================================================
-- A decisão do D2 (20260904001500) continua de pé, e ela está certa: o número
-- que a pessoa escolhe é "quantas tentativas", e o prazo é consequência dele.
-- Encurtar o prazo seria voltar a prometer três tentativas e entregar uma.
--
-- O que estava errado era o SILÊNCIO: quem pede "vale só hoje" e recebe um lote
-- de cinco dias, com 25 organizações reservadas nesse prazo, não fica sabendo.
-- A montagem passa a devolver `termina_em_pedido` e `prazo_esticado`.
--
-- PENDÊNCIA CONHECIDA, e é de tela: `apps/web/src/components/ligacao/` ainda
-- não mostra esses dois campos no recibo da montagem (o zod de lá ignora campo
-- extra, então nada quebra — a informação só não aparece ainda). Uma linha do
-- tipo "Você pediu até 05/09; como o lote tem 3 tentativas, ele vale até
-- 10/09 e reserva N contatos até lá" resolve. Registrado no CHANGELOG.
create or replace function public.montar_lote(
  p_nome                   text,
  p_pipeline_id            int,
  p_temperatura_origem     app.temperature,
  p_roteiro_id             uuid,
  p_categoria_ids          int[]        default '{}',
  p_ordem                  app.call_order default 'prioridade',
  p_tamanho                int          default 25,
  p_max_tentativas         int          default 3,
  p_horas_entre_tentativas int          default 20,
  p_meta_ligacoes          int          default null,
  p_inicia_em              date         default null,
  p_termina_em             date         default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid       uuid := auth.uid();
  v_hoje      date := (now() at time zone 'America/Fortaleza')::date;
  v_ordem     app.call_order := coalesce(p_ordem, 'prioridade'::app.call_order);
  v_script    public.call_scripts%rowtype;
  v_lote      uuid;
  v_seed      int  := (floor(random() * 1000000000))::int;
  v_entraram  int  := 0;
  v_elegiveis int  := 0;
  v_excluidos jsonb := '{}'::jsonb;
  v_conflito  int  := 0;
  v_tent      int  := coalesce(p_max_tentativas, 3);
  v_inicio    date;
  v_pedido    date;
  v_fim       date;
begin
  if v_uid is null then
    raise exception 'Usuário não autenticado' using errcode = '42501';
  end if;
  if not app.can_write() then
    return jsonb_build_object('montado', false, 'motivo', 'sem_permissao', 'detalhe', null);
  end if;
  if coalesce(p_tamanho, 0) not between 1 and 60 then
    return jsonb_build_object('montado', false, 'motivo', 'tamanho_invalido', 'detalhe', p_tamanho::text);
  end if;
  if not exists (select 1 from public.pipelines p where p.id = p_pipeline_id) then
    return jsonb_build_object('montado', false, 'motivo', 'funil_invalido', 'detalhe', null);
  end if;

  select * into v_script from public.call_scripts s where s.id = p_roteiro_id and s.is_published;
  if not found then
    return jsonb_build_object('montado', false, 'motivo', 'roteiro_invalido', 'detalhe', null);
  end if;

  -- ----- D2: o prazo é PISO, não sugestão -----
  -- `greatest` e não `coalesce`: quem quiser um lote mais LONGO continua mandando a
  -- data e ela vale; quem mandar uma data mais curta do que as tentativas que pediu
  -- recebe o prazo que as tentativas exigem. Encurtar aqui seria voltar a prometer
  -- três tentativas e entregar uma. Quem quer lote de um dia pede uma tentativa.
  -- §3.12c: e o que foi pedido volta no recibo, ao lado do que valeu.
  v_inicio := coalesce(p_inicia_em, v_hoje);
  v_pedido := coalesce(p_termina_em, v_inicio);
  v_fim    := greatest(v_pedido, app.prazo_do_lote(v_inicio, v_tent));

  -- ----- D7: contar ANTES de criar -----
  select coalesce(jsonb_object_agg(t.motivo, t.n), '{}'::jsonb) into v_excluidos
    from (select c.motivo, count(*)::int as n
            from app.call_candidates(p_pipeline_id, p_temperatura_origem,
                                     p_categoria_ids, v_ordem, v_seed) c
           where c.motivo is not null
           group by c.motivo) t;

  select count(*)::int into v_elegiveis
    from app.call_candidates(p_pipeline_id, p_temperatura_origem,
                             p_categoria_ids, v_ordem, v_seed) c
   where c.motivo is null;

  if v_elegiveis = 0 then
    return jsonb_build_object('montado', false, 'motivo', 'sem_candidatos',
                              'detalhe', null, 'pedidos', p_tamanho,
                              'entraram', 0, 'excluidos', v_excluidos);
  end if;

  insert into public.call_batches
    (nome, owner_id, status, pipeline_id, temperature_origin, script_id, script_version,
     order_mode, seed, max_attempts, min_hours_between_attempts, target_calls, starts_on, ends_on)
  values
    (left(trim(p_nome), 60), v_uid, 'ativo', p_pipeline_id, p_temperatura_origem,
     v_script.id, v_script.versao, v_ordem, v_seed,
     v_tent, coalesce(p_horas_entre_tentativas, 20), p_meta_ligacoes,
     v_inicio, v_fim)
  returning id into v_lote;

  -- ----- a reserva -----
  -- `on conflict do nothing` sem alvo: quem já está reservado (por organização OU
  -- por linha telefônica) simplesmente não entra. Não existe "roubar" item de outro
  -- lote; existe encerrar o lote, o que devolve todos os pendentes.
  -- `distinct on (phone_e164)` porque duas organizações do MESMO lote podem carregar
  -- o mesmo número, e aí o conflito seria contra uma linha que este comando acabou
  -- de inserir.
  with escolhidos as (
    select distinct on (c.phone_e164) c.*
      from app.call_candidates(p_pipeline_id, p_temperatura_origem,
                               p_categoria_ids, v_ordem, v_seed) c
     where c.motivo is null
     order by c.phone_e164, c.ordem
  ), ordenados as (
    select e.*, row_number() over (order by e.ordem) as pos
      from escolhidos e
     order by e.ordem
     limit p_tamanho
  )
  insert into public.call_batch_items
    (batch_id, organization_id, contact_id, phone_e164, deal_id, stage_id, position)
  select v_lote, x.organization_id, x.contact_id, x.phone_e164, x.deal_id, x.stage_id, x.pos
    from ordenados x
  on conflict do nothing;
  get diagnostics v_entraram = row_count;

  -- ----- D7: desfazer o lote que nasceu vazio -----
  if v_entraram = 0 then
    delete from public.call_batches where id = v_lote;
    return jsonb_build_object('montado', false, 'motivo', 'sem_candidatos',
                              'detalhe', 'reservado_em_outro_lote', 'pedidos', p_tamanho,
                              'entraram', 0,
                              'excluidos', v_excluidos || jsonb_build_object(
                                'reservado_em_outro_lote',
                                coalesce((v_excluidos ->> 'reservado_em_outro_lote')::int, 0)
                                + least(p_tamanho, v_elegiveis)));
  end if;

  -- A diferença entre o que era elegível na contagem e o que entrou de fato é
  -- corrida de reserva: outra pessoa montou lote entre a contagem e o insert.
  v_conflito := least(p_tamanho, v_elegiveis) - v_entraram;
  if v_conflito > 0 then
    v_excluidos := v_excluidos || jsonb_build_object(
      'reservado_em_outro_lote',
      coalesce((v_excluidos ->> 'reservado_em_outro_lote')::int, 0) + v_conflito);
  end if;

  return jsonb_build_object(
    'montado',         true,
    'lote_id',         v_lote,
    'pedidos',         p_tamanho,
    'entraram',        v_entraram,
    'excluidos',       v_excluidos,
    'roteiro_id',      v_script.id,
    'roteiro_versao',  v_script.versao,
    -- D2: a tela precisa poder DIZER até quando o lote tenta, porque foi o recibo
    -- que prometeu "volta para a fila deste lote na próxima janela".
    'max_tentativas',  v_tent,
    'inicia_em',       v_inicio,
    'termina_em',      v_fim,
    -- §3.12c: e precisa poder dizer que o prazo foi esticado, e a partir do quê.
    -- Só é "esticado" quando havia um pedido explícito para esticar: montagem sem
    -- data de fim não pediu nada, e anunciar um estico aí seria ruído.
    'termina_em_pedido', v_pedido,
    'prazo_esticado',    p_termina_em is not null and v_fim > v_pedido);
end $$;
comment on function public.montar_lote(text, int, app.temperature, uuid, int[], app.call_order,
                                       int, int, int, int, date, date) is
  'Monta um lote de ligação e RESERVA os contatos na criação (R13 §3.1). Conta os candidatos ANTES de criar o lote e desfaz o lote que nasceu vazio numa corrida de reserva (D7). O prazo (ends_on) tem como PISO o número de dias abertos que as tentativas pedidas exigem (D2), e quando o piso estica a data pedida o recibo diz isso em prazo_esticado + termina_em_pedido (§3.12c). Devolve quantos entraram e quantos ficaram de fora por motivo (nao_contatar, suprimido, sem_telefone, sem_negocio_aberto, temperatura_diferente, em_janela_de_recontato, reservado_em_outro_lote) e as datas do período. Contato suprimido nunca entra (RF-CON-18).';
revoke all on function public.montar_lote(text, int, app.temperature, uuid, int[], app.call_order,
                                          int, int, int, int, date, date) from public, anon;
grant execute on function public.montar_lote(text, int, app.temperature, uuid, int[], app.call_order,
                                             int, int, int, int, date, date) to authenticated, service_role;
