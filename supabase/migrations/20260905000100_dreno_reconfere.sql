-- =====================================================================
-- TRIADE — v0.1 — D9 — O DRENO RECONFERE
-- (RF-PRE-01, RF-CON-18, RF-ADM-03; PRD §7.6 e §10.6; ADR-03, ADR-04,
--  ADR-05, ADR-11; anexo R06.)
--
-- POR QUE ESTE ARQUIVO EXISTE
-- ---------------------------------------------------------------------
-- A conferência adversarial encontrou, no banco de verdade, um buraco com
-- linha do tempo e nome próprio:
--
--   01:21:57  Alfa Cerimonial e Assessoria autoriza o uso dos dados
--             (consent_events · data_use_authorized)
--   01:21:57  komune_outbox c132132c "link_emitido" entra PENDENTE
--   01:23:24  komune_outbox 9b00fd02 "link_emitido" entra PENDENTE
--   01:23:33  a mesma empresa clica "Não é meu / não quero aparecer" na
--             página pública /c/<token>
--             → consent_events · erasure_request · do_not_contact = true
--             → pre_registrations.status = rejected, refused_at preenchido
--
-- A recusa cancelou a cadência, cancelou a tarefa e encerrou o pré-cadastro.
-- Não cancelou o OUTBOX. Os dois pedidos continuaram pendentes na fila
-- `komune_sync`, e com eles um terceiro, de uma ficha já apagada. Nada saiu
-- até hoje por um motivo só: `integracao.komune.push_ativo` é false. No dia
-- em que a chave for ligada, `app.komune_push_disparar` (job 14 do cron, de
-- 5 em 5 minutos) acorda a Edge Function, ela chama a fila, e os três
-- payloads sobem para a plataforma Komune — dados de quem já disse não.
--
-- A causa não é um esquecimento pontual: `app.komune_proximos` era um DRENO
-- que confiava na decisão tomada na ENFILEIRADA. `app.komune_enfileirar`
-- checa autorização e supressão; o dreno não recheca nada, e a Edge Function
-- está escrita assumindo que o Postgres já filtrou ("a função é braço, não
-- cabeça", ADR-03). Entre a entrada e a saída existe tempo, e no tempo o
-- mundo muda: é justamente ali que mora o direito de mudar de ideia.
--
-- O MOLDE JÁ ESTAVA NO PROJETO. `public.proximo_da_fila` (módulo de ligação,
-- migração 001300) faz exatamente o certo, com o comentário no lugar:
--     -- guardrail: alguém pode ter pedido opt-out DEPOIS de o lote ser montado
--     if v_org.deleted_at is not null
--        or app.is_suppressed_target(i.organization_id, i.contact_id) then
--       update public.call_batch_items ... status = 'devolvido'
-- Este arquivo leva a mesma regra para a fila de saída da Komune, e varre o
-- resto do banco atrás do mesmo padrão.
--
-- O QUE ENTREGA
--   A. `app.komune_motivo_de_recusa(outbox_id)` — a pergunta única "este
--      pedido ainda pode sair?", com o motivo por escrito.
--   B. `app.komune_descartar(outbox_id, msg_id, motivo)` — descarta o pedido
--      (status 'descartado', motivo na própria linha), ARQUIVA a mensagem
--      pgmq para não ficar rodando para sempre e registra na linha do tempo
--      do pré-cadastro. Idempotente.
--   C. `app.komune_proximos` passa a RECONFERIR item a item antes de
--      entregar. Nada suprimido, apagado, recusado ou sem autorização
--      vigente atravessa o dreno.
--   D. A LIMPEZA DA DÍVIDA: os pedidos que já estão pendentes para quem
--      recusou saem da fila aqui, na migração, pelo mesmo critério.
--   E. A VARREDURA. O mesmo erro em `app.promover_candidato` e
--      `app.mesclar_candidato` (a supressão era lida do carimbo da coleta,
--      não do estado de agora) e em `public.meu_dia` (recheca só
--      `do_not_contact` da organização, não a lista de supressão nem a
--      pessoa). Consertados aqui.
--   F. `public.komune_fila_status` passa a contar os descartados: recusa
--      silenciosa é a mesma doença por outro nome.
--
-- Idempotente: pode ser reaplicada sem erro e sem perder dados.
-- =====================================================================


-- ---------------------------------------------------------------------
-- A. A PERGUNTA ÚNICA: este pedido ainda pode sair?
-- ---------------------------------------------------------------------
-- Uma função só, para que dreno e limpeza usem literalmente o mesmo
-- critério — duas cópias da mesma regra é como se cria a terceira.
-- Devolve null quando o pedido é legítimo; o motivo, por escrito, quando
-- não é.
--
-- A ordem do `case` decide apenas qual motivo é REGISTRADO quando mais de
-- um se aplica. A supressão vem primeiro de propósito: é o guardrail
-- textual do CLAUDE.md ("nenhum envio a contato suprimido, em nenhum
-- modo") e é o que a pessoa quis dizer quando disse não.
--
-- Os quatro critérios são exatamente os quatro que `app.komune_enfileirar`
-- aplica na ENTRADA — inclusive `tem_autorizacao_vigente`, e por um motivo
-- concreto: `data_use_revoked` NÃO liga `do_not_contact` (veja
-- `app.consent_apply`). Quem revoga a autorização sem pedir opt-out
-- continua contatável pelo CRM e não pode mais ter dado subindo para a
-- plataforma. Sem esta linha, revogar a autorização não pararia o push.
create or replace function app.komune_motivo_de_recusa(p_outbox_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case
           when app.is_suppressed_target(ob.organization_id, pr.contact_id)
             then 'contato_suprimido'
           when o.id is null or o.deleted_at is not null
             then 'organizacao_apagada'
           when pr.refused_at is not null
             then 'pre_cadastro_recusado'
           when pr.purged_at is not null
             then 'pre_cadastro_apagado'
           when not app.tem_autorizacao_vigente(ob.organization_id)
             then 'sem_autorizacao'
         end
    from public.komune_outbox ob
    left join public.pre_registrations pr on pr.id = ob.pre_registration_id
    left join public.organizations     o  on o.id  = ob.organization_id
   where ob.id = p_outbox_id
$$;
comment on function app.komune_motivo_de_recusa(uuid) is
  'Por que este pedido da fila de saída NÃO pode mais subir para a Komune: contato_suprimido, organizacao_apagada, pre_cadastro_recusado, pre_cadastro_apagado, sem_autorizacao. null = ainda é legítimo. Mesmos critérios da enfileirada, relidos no instante da entrega.';


-- ---------------------------------------------------------------------
-- B. O DESCARTE — na linha, na fila e na linha do tempo
-- ---------------------------------------------------------------------
-- Três efeitos, e os três importam:
--   1. `komune_outbox.status = 'descartado'` com o motivo na PRÓPRIA linha
--      (o valor já existia no check da tabela; faltava alguém usá-lo);
--   2. a mensagem `pgmq` é ARQUIVADA — sem isso ela voltaria a cada leitura,
--      para sempre, gastando lote e escondendo trabalho legítimo atrás dela;
--   3. `pre_registration_events` ganha um 'returned', porque recusa que
--      ninguém vê é indistinguível de bug.
--
-- Idempotente por construção: o `update` só pega quem ainda está 'pendente',
-- e o evento de linha do tempo só nasce se o `update` pegou. Chamar de novo
-- é inócuo, e `pgmq.archive` de mensagem já arquivada devolve false sem
-- reclamar.
create or replace function app.komune_descartar(p_outbox_id uuid,
                                                p_msg_id   bigint,
                                                p_motivo   text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  ob public.komune_outbox%rowtype;
begin
  update public.komune_outbox
     set status     = 'descartado',
         last_error = 'recusado na entrega: ' || coalesce(p_motivo, 'motivo_desconhecido'),
         updated_at = now()
   where id = p_outbox_id
     and status = 'pendente'
  returning * into ob;

  -- A mensagem sai da fila mesmo quando a linha já estava descartada: o que
  -- não pode acontecer é o payload continuar circulando.
  if p_msg_id is not null then
    begin
      perform pgmq.archive('komune_sync', p_msg_id);
    exception when others then
      null;  -- mensagem inexistente ou já arquivada não é motivo de parar nada
    end;
  end if;

  if ob.id is null then
    return false;
  end if;

  insert into public.pre_registration_events
    (pre_registration_id, organization_id, event, payload, actor)
  values (ob.pre_registration_id, ob.organization_id, 'returned',
          jsonb_build_object('origem', 'komune_outbox',
                             'acao', 'descartado_na_entrega',
                             'motivo', p_motivo,
                             'outbox_id', ob.id,
                             'enfileirado_em', ob.first_seen_at),
          'system');
  return true;
end $$;
comment on function app.komune_descartar(uuid, bigint, text) is
  'Tira um pedido da fila de saída da Komune sem enviá-lo: marca descartado com o motivo na própria linha, arquiva a mensagem pgmq e registra returned na linha do tempo do pré-cadastro. Idempotente.';


-- ---------------------------------------------------------------------
-- C. O DRENO RECONFERE
-- ---------------------------------------------------------------------
-- Mesma forma de `public.proximo_da_fila`: checar na entrada nunca basta,
-- porque o mundo muda entre a entrada e a saída. Aqui a diferença é que o
-- item recusado não volta para a fila — ele MORRE, porque o pedido de push
-- de quem disse não não tem segunda chance nenhuma.
create or replace function app.komune_proximos(p_qty int default 10)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cfg       jsonb;
  v_ativo     boolean;
  v_lote      int;
  v_out       jsonb := '[]'::jsonb;
  v_recusados jsonb := '[]'::jsonb;
  v_motivo    text;
  m           record;
  ob          public.komune_outbox%rowtype;
begin
  select s.value into v_cfg from public.app_settings s where s.key = 'integracao.komune';
  v_ativo := coalesce((v_cfg ->> 'push_ativo')::boolean, false);
  v_lote  := least(greatest(coalesce(p_qty, coalesce((v_cfg ->> 'lote')::int, 10)), 1), 50);

  if not v_ativo then
    return jsonb_build_object('ativo', false, 'itens', '[]'::jsonb,
                              'recusados', '[]'::jsonb,
                              'motivo', 'integracao.komune.push_ativo esta desligado');
  end if;

  -- 120 s de visibilidade: cabe um POST lento e o registro do resultado.
  for m in select * from pgmq.read('komune_sync', 120, v_lote) loop
    select * into ob from public.komune_outbox
     where id = (m.message ->> 'outbox_id')::uuid;
    if not found or ob.status <> 'pendente' then
      perform pgmq.archive('komune_sync', m.msg_id);
      continue;
    end if;

    -- ----- guardrail: alguém pode ter dito não DEPOIS de o pedido entrar -----
    -- (o mesmo de public.proximo_da_fila, na porta de saída da integração)
    v_motivo := app.komune_motivo_de_recusa(ob.id);
    if v_motivo is not null then
      perform app.komune_descartar(ob.id, m.msg_id, v_motivo);
      v_recusados := v_recusados || jsonb_build_object('outbox_id', ob.id, 'motivo', v_motivo);
      continue;
    end if;

    v_out := v_out || jsonb_build_object(
      'msg_id',          m.msg_id,
      'outbox_id',       ob.id,
      'idempotency_key', ob.idempotency_key,
      'tentativas',      ob.attempts,
      'payload',         ob.payload);
  end loop;

  return jsonb_build_object('ativo', true, 'itens', v_out, 'recusados', v_recusados);
end $$;
comment on function app.komune_proximos(int) is
  'Lote de pedidos de push para a Edge Function komune-push. Devolve ativo=false, e nenhum item, enquanto a chave geral estiver desligada. RECONFERE cada item no instante da entrega (supressão, ficha apagada, pré-cadastro recusado ou apagado, autorização revogada): o que não pode mais sair vira descartado e sai da fila, e o motivo fica na linha. Checar na enfileirada nunca bastou.';

revoke all on function app.komune_motivo_de_recusa(uuid)          from public, anon, authenticated;
revoke all on function app.komune_descartar(uuid, bigint, text)   from public, anon, authenticated;
grant execute on function app.komune_motivo_de_recusa(uuid)        to service_role;
grant execute on function app.komune_descartar(uuid, bigint, text) to service_role;


-- ---------------------------------------------------------------------
-- D. A LIMPEZA DA DÍVIDA — o que já está lá sai agora
-- ---------------------------------------------------------------------
-- Consertar o dreno e deixar os payloads antigos na fila seria trocar uma
-- bomba com pavio aceso por uma bomba com pavio mais curto: o dreno novo
-- os pegaria, mas só no dia em que a chave fosse ligada, e até lá a fila
-- estaria mentindo sobre o que tem dentro. Saem aqui, pelo mesmo critério.
--
-- No banco de desenvolvimento em que o achado foi colhido, isto remove os
-- três pedidos de:
--   c132132c · link_emitido · Alfa Cerimonial e Assessoria (do_not_contact)
--   9b00fd02 · link_emitido · Alfa Cerimonial e Assessoria (do_not_contact)
--   bf485717 · link_emitido · TESTE EDGE FUNCTIONS — descartada (ficha apagada)
do $$
declare
  r      record;
  v_mot  text;
  n      int := 0;
begin
  for r in
    select ob.id, ob.msg_id
      from public.komune_outbox ob
     where ob.status = 'pendente'
     order by ob.first_seen_at
  loop
    v_mot := app.komune_motivo_de_recusa(r.id);
    if v_mot is not null then
      perform app.komune_descartar(r.id, r.msg_id, v_mot);
      n := n + 1;
      raise notice 'komune_outbox %: descartado na limpeza (%)', r.id, v_mot;
    end if;
  end loop;
  raise notice 'komune_outbox: % pedido(s) descartado(s) na limpeza', n;
end $$;


-- ---------------------------------------------------------------------
-- E. A RECUSA APARECE — status da fila conta os descartados
-- ---------------------------------------------------------------------
-- `komune_fila_status` contava pendentes, enviados e falhados. Um pedido
-- descartado sumia da soma: a fila dizia "está tudo enviado" enquanto
-- alguém tinha sido, corretamente, barrado. Quem opera precisa ver a
-- recusa para saber que ela funcionou.
create or replace function public.komune_fila_status()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not app.is_manager() then
    raise exception 'Sem permissão para ver a fila de integração' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'push_ativo', coalesce((select (s.value ->> 'push_ativo')::boolean
                              from public.app_settings s where s.key = 'integracao.komune'), false),
    'pendentes',   (select count(*) from public.komune_outbox where status = 'pendente'),
    'enviados',    (select count(*) from public.komune_outbox where status = 'enviado'),
    'falhados',    (select count(*) from public.komune_outbox where status = 'falhou'),
    'descartados', (select count(*) from public.komune_outbox where status = 'descartado'),
    'ultimo_descarte', (select jsonb_build_object('quando', o.updated_at,
                                                  'motivo', o.last_error,
                                                  'organizacao', o.organization_id)
                          from public.komune_outbox o
                         where o.status = 'descartado'
                         order by o.updated_at desc limit 1),
    'ultimo_erro', (select jsonb_build_object('quando', o.updated_at, 'erro', o.last_error,
                                              'tentativas', o.attempts, 'http', o.http_status)
                      from public.komune_outbox o
                     where o.last_error is not null and o.status <> 'descartado'
                     order by o.updated_at desc limit 1),
    'ultima_entrega_recebida', (select jsonb_build_object('quando', d.received_at,
                                                          'evento', d.event,
                                                          'resultado', d.result)
                                  from public.webhook_deliveries d
                                 where d.source = 'komune'
                                 order by d.received_at desc limit 1));
end $$;
comment on function public.komune_fila_status() is
  'Painel da integração para gestor e admin: chave geral, pendentes, enviados, falhados, DESCARTADOS (recusados na entrega por supressão, recusa ou ficha apagada), último descarte, último erro e última entrega recebida.';
revoke all on function public.komune_fila_status() from public, anon;
grant execute on function public.komune_fila_status() to authenticated, service_role;


-- =====================================================================
-- F. A VARREDURA — o mesmo erro em outro lugar
-- ---------------------------------------------------------------------
-- A lição não é sobre a Komune: é sobre QUALQUER lugar que decide na
-- ENTRADA e entrega DEPOIS. Varri as oito funções do `cron.job` e as
-- funções que entregam trabalho. O resultado, por escrito:
--
--   RECONFEREM (nada a fazer)
--     · public.proximo_da_fila (001300)   — o molde: `deleted_at` +
--       `is_suppressed_target` no instante da entrega; o item vira
--       'devolvido' com a nota "contato suprimido depois da montagem".
--     · public.iniciar_chamada (001300)   — recheca de novo antes de
--       revelar o telefone, mesmo tendo acabado de vir de proximo_da_fila.
--     · app.cadencias_agendar (cron 6) → app.abrir_proximo_toque —
--       chama `app.pode_tocar` no momento de criar o toque, e encerra a
--       matrícula quando o motivo é 'suprimido' ou 'nao_reativavel'.
--     · app.precadastros_lembrete (cron 8) — o `is_suppressed_target`
--       está no mesmo laço que cria a tarefa: decisão e efeito no mesmo
--       instante, sem intervalo onde o mundo possa mudar.
--     · public.registrar_contato (001200) — recalcula o guardrail antes
--       de qualquer consequência, nas DUAS organizações do par
--       (organização e negócio).
--
--   NÃO PRECISAM RECONFERIR (e por quê)
--     · app.recompute_temperatures (cron 1) — só recalcula um enum de
--       leitura; não entrega ninguém a ninguém.
--     · app.expirar_reservas (cron 2) — solta reserva vencida e devolve
--       item para a fila. Quem entrega depois é proximo_da_fila, que
--       recheca. O efeito desta função é sempre no sentido seguro.
--     · app.aplicar_retencao (cron 3) — só apaga e anonimiza.
--     · app.cadencias_encerrar_silencio (cron 7) — só encerra matrícula.
--     · app.precadastros_expirar (cron 9) — só apaga rascunho.
--     · app.komune_falha / app.komune_sucesso — escrituração do que já
--       aconteceu; o envio ou já saiu ou já falhou.
--     · A esteira de ingestão (ingest_jobs, ingest_pages, ingest_records)
--       é fila de ENTRADA: nada dela alcança um fornecedor. O ponto em
--       que ela vira contato é a curadoria — e é lá que o buraco estava,
--       logo abaixo.
--
--   TINHAM O MESMO BURACO (consertadas aqui)
--     · app.promover_candidato e app.mesclar_candidato — liam
--       `supplier_candidates.do_not_contact`, que é o carimbo do dia da
--       COLETA. Candidato coletado na segunda, opt-out na quarta,
--       curadoria na sexta: o carimbo diz "pode" e a lista de supressão
--       diz "não". Passavam a promover uma ficha nova, com telefone
--       suprimido e do_not_contact = false — `app.organizations_normalize`
--       não consulta a lista de supressão. Agora releem a lista viva e
--       atualizam o carimbo.
--     · public.meu_dia — a fila do dia recheca (bom), mas só
--       `o.do_not_contact` (insuficiente): não via o contato que pediu
--       para sair numa ficha cujo dono não pediu, nem a ficha irmã com o
--       MESMO telefone da lista de supressão. Passa a usar
--       `app.is_suppressed_target`, que é a pergunta inteira.
--
--   DE PROPÓSITO FORA
--     · O item 'desfecho_pendente' do meu_dia (interação registrada sem
--       resultado) continua aparecendo para alvo suprimido. Não é
--       contato: é tabular o que JÁ aconteceu. Tirá-lo da fila impediria
--       a Heloísa de registrar justamente o "ela pediu para sair" que
--       gerou a supressão. Cortar aqui esconderia a prova do opt-out.
-- =====================================================================


-- ---------------------------------------------------------------------
-- F.1 A curadoria do Radar relê a lista de supressão de agora
-- ---------------------------------------------------------------------
create or replace function app.promover_candidato(
  p_candidate_id   uuid,
  p_stage_id       int  default null,
  p_owner_id       uuid default null,
  p_next_action    text default null,
  p_next_action_at timestamptz default null,
  p_category_id    int  default null,
  p_batch_id       uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_c        public.supplier_candidates;
  v_cat      int;
  v_grupo    text;
  v_slug     text;
  v_kind     app.org_kind;
  v_pipeline int;
  v_stage    int := p_stage_id;
  v_org      uuid;
  v_deal     uuid;
  v_tier     text;
  v_fonte    record;
  v_owner    uuid := coalesce(p_owner_id, auth.uid());
  v_quem     text;
  v_sug      jsonb;
  v_motivo   text;
begin
  select * into v_c from public.supplier_candidates where id = p_candidate_id for update;
  if v_c.id is null then
    return jsonb_build_object('ok', false, 'reason', 'candidato_inexistente');
  end if;

  -- Idempotência: promover duas vezes devolve a MESMA organização. É o que
  -- separa "o worker reprocessou a captura" de "a base ganhou uma ficha dupla".
  if v_c.status = 'aprovado' and v_c.organization_id is not null then
    return jsonb_build_object('ok', true, 'status', 'aprovado', 'ja_estava', true,
                              'organization_id', v_c.organization_id,
                              'deal_id', (select d.id from public.deals d
                                           where d.organization_id = v_c.organization_id
                                           order by d.created_at limit 1));
  end if;
  if v_c.status <> 'novo' then
    return jsonb_build_object('ok', false, 'reason', 'ja_revisado', 'status', v_c.status);
  end if;
  -- Suprimido não vira alvo, em nenhum modo (RF-RAD-09, guardrail do CLAUDE.md).
  --
  -- `v_c.do_not_contact` é o CARIMBO DA COLETA: verdadeiro para quem já estava
  -- na lista de supressão no instante em que o candidato foi gravado
  -- (app.supplier_candidates_normalize). Entre a coleta e esta curadoria pode
  -- ter passado uma semana, e nela alguém pode ter respondido "SAIR" — e aí o
  -- carimbo continua falso enquanto a lista de hoje já diz não. É o mesmo
  -- buraco do dreno da Komune, na porta da curadoria: decidido na entrada,
  -- entregue depois. A lista que vale é a de agora.
  if v_c.do_not_contact
     or app.is_suppressed(v_c.phone_e164, v_c.cnpj, v_c.instagram_handle) then
    -- E o carimbo passa a contar a verdade, para a fila do Radar mostrar o
    -- motivo em vez de oferecer o mesmo alvo de novo amanhã.
    if not v_c.do_not_contact then
      update public.supplier_candidates set do_not_contact = true where id = v_c.id;
    end if;
    return jsonb_build_object('ok', false, 'reason', 'candidato_nao_contatar');
  end if;

  v_cat := coalesce(p_category_id, v_c.category_id);
  if v_cat is null then
    return jsonb_build_object('ok', false, 'reason', 'categoria_obrigatoria');
  end if;
  select c.group, c.slug into v_grupo, v_slug
    from public.categories c where c.id = v_cat and c.is_active;
  if v_grupo is null then
    return jsonb_build_object('ok', false, 'reason', 'categoria_invalida');
  end if;
  v_kind := case
              when v_slug = 'cerimonialistas_assessorias' then 'cerimonialista'
              when v_grupo = 'producao' then 'produtor'
              when v_grupo = 'locais'   then 'espaco'
              else 'fornecedor'
            end::app.org_kind;

  -- Bloqueio: exatamente as quatro chaves que são índice único parcial.
  select o.id,
         case when v_c.cnpj is not null and o.cnpj = v_c.cnpj then 'cnpj'
              when v_c.place_id is not null and o.place_id = v_c.place_id then 'place_id'
              when v_c.instagram_handle is not null and o.instagram_handle = v_c.instagram_handle then 'instagram'
              else 'phone' end
    into v_org, v_motivo
    from public.organizations o
   where o.deleted_at is null
     and ((v_c.cnpj is not null and o.cnpj = v_c.cnpj)
       or (v_c.phone_e164 is not null and o.phone_e164 = v_c.phone_e164)
       or (v_c.instagram_handle is not null and o.instagram_handle = v_c.instagram_handle)
       or (v_c.place_id is not null and o.place_id = v_c.place_id))
   limit 1;
  if v_org is not null then
    return jsonb_build_object('ok', false, 'reason', 'ja_existe_na_base',
                              'organization_id', v_org, 'chave', v_motivo);
  end if;

  -- Explicação (as sete chaves do RF-BAS-08), para quem revisa e para o log.
  select coalesce(jsonb_agg(jsonb_build_object('organization_id', m.organization_id,
                                               'confidence', m.confidence, 'reason', m.reason)
                            order by m.confidence desc), '[]'::jsonb)
    into v_sug
    from app.find_org_matches(jsonb_build_object(
           'name', v_c.name, 'cnpj', v_c.cnpj, 'phone_e164', v_c.phone_e164,
           'instagram_handle', v_c.instagram_handle, 'website', v_c.website_domain,
           'place_id', v_c.place_id, 'city_id', v_c.city_id,
           'neighborhood', v_c.neighborhood, 'category_id', v_cat)) m;

  select p.id into v_pipeline from public.pipelines p
   where p.slug = case when v_kind in ('produtor','cerimonialista') then 'produtor' else 'fornecedor' end;
  if v_stage is null then
    select st.id into v_stage from public.stages st
     where st.pipeline_id = v_pipeline and not st.is_lost and not st.is_won
     order by st.position limit 1;
  end if;
  if v_stage is null then
    raise exception 'Funil sem etapas cadastradas: aplique a seed (pipelines/stages)' using errcode = 'P0001';
  end if;

  select s.id, s.kind, s.slug into v_fonte from public.sources s where s.id = v_c.source_id;
  v_tier := coalesce(v_c.tier, case when v_fonte.kind = 'referral' then 'A+' end);
  select pr.full_name into v_quem from public.profiles pr where pr.id = v_owner;

  insert into public.organizations
    (kind, name, legal_name, cnpj, phone_e164, email, instagram_handle, website,
     place_id, city_id, neighborhood, address, rating, reviews_count,
     source_id, source_url, collected_at, collector, owner_id, is_natural_person,
     import_batch_id)
  values
    (v_kind, v_c.name, v_c.legal_name, v_c.cnpj, v_c.phone_e164, v_c.email,
     v_c.instagram_handle, v_c.website, v_c.place_id, v_c.city_id, v_c.neighborhood,
     v_c.address, v_c.rating, v_c.reviews_count,
     v_c.source_id, v_c.source_url, v_c.collected_at,
     coalesce(v_c.collector, 'radar'), v_owner, v_c.is_natural_person,
     coalesce(p_batch_id, v_c.import_batch_id))
  returning id into v_org;

  insert into public.organization_categories (organization_id, category_id, is_primary)
  values (v_org, v_cat, true)
  on conflict do nothing;

  insert into public.deals
    (organization_id, pipeline_id, stage_id, owner_id, source_id, tier,
     next_action, next_action_at, import_batch_id)
  values
    (v_org, v_pipeline, v_stage, v_owner, v_c.source_id, v_tier,
     coalesce(nullif(trim(coalesce(p_next_action, '')), ''), 'Primeiro contato'),
     coalesce(p_next_action_at,
              ((app.next_business_day((now() at time zone 'America/Fortaleza')::date) + time '09:00')
               at time zone 'America/Fortaleza')),
     coalesce(p_batch_id, v_c.import_batch_id))
  returning id into v_deal;

  insert into public.activities (type, organization_id, deal_id, user_id, author_kind, body, metadata)
  values ('system', v_org, v_deal, v_owner, 'system',
          'Aprovado na fila do Radar por ' || coalesce(v_quem, 'revisor'),
          jsonb_build_object('origin', 'radar_approve', 'candidate_id', v_c.id,
                             'source_slug', v_fonte.slug, 'batch_id', coalesce(p_batch_id, v_c.import_batch_id)));

  update public.supplier_candidates
     set status = 'aprovado', organization_id = v_org, category_id = v_cat, kind = v_kind,
         reviewed_by = coalesce(auth.uid(), v_owner), reviewed_at = now(),
         import_batch_id = coalesce(import_batch_id, p_batch_id)
   where id = p_candidate_id;

  -- A proveniência acompanha a ficha: sem isto, o titular pergunta "de onde
  -- veio o meu número?" e a resposta morre no candidato, que a retenção apaga.
  insert into public.field_provenance
    (record_type, record_id, field, source_id, source_url, batch_id, collected_at,
     collector, tool, action, reason, legal_basis, lia_version)
  select 'organization', v_org, fp.field, fp.source_id, fp.source_url, fp.batch_id,
         fp.collected_at, fp.collector, fp.tool, fp.action, fp.reason, fp.legal_basis, fp.lia_version
    from public.field_provenance fp
   where fp.record_type = 'supplier_candidate' and fp.record_id = v_c.id;

  return jsonb_build_object('ok', true, 'status', 'aprovado',
                            'organization_id', v_org, 'deal_id', v_deal,
                            'sugestoes', v_sug);
end $$;
comment on function app.promover_candidato(uuid,int,uuid,text,timestamptz,int,uuid) is
  'Caminho único de promoção candidato → organização + negócio. Dedup do RF-BAS-08 refeita DENTRO da transação. Idempotente. Reconfere a lista de supressão NO INSTANTE DA CURADORIA, não no carimbo da coleta: quem pediu para sair depois de ser coletado não vira ficha.';


create or replace function app.mesclar_candidato(
  p_candidate_id    uuid,
  p_organization_id uuid,
  p_category_id     int  default null,
  p_reason          text default null,
  p_batch_id        uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_c   public.supplier_candidates;
  v_o   public.organizations;
  v_cat int;
  v_uid uuid := auth.uid();
begin
  select * into v_c from public.supplier_candidates where id = p_candidate_id for update;
  if v_c.id is null then
    return jsonb_build_object('ok', false, 'reason', 'candidato_inexistente');
  end if;
  if v_c.status = 'mesclado' and v_c.organization_id = p_organization_id then
    return jsonb_build_object('ok', true, 'status', 'mesclado', 'ja_estava', true,
                              'organization_id', p_organization_id);
  end if;
  if v_c.status <> 'novo' then
    return jsonb_build_object('ok', false, 'reason', 'ja_revisado', 'status', v_c.status);
  end if;
  -- Mesma reconferência de app.promover_candidato: o carimbo da coleta pode
  -- estar velho, a lista de supressão de agora é que vale.
  if v_c.do_not_contact
     or app.is_suppressed(v_c.phone_e164, v_c.cnpj, v_c.instagram_handle) then
    if not v_c.do_not_contact then
      update public.supplier_candidates set do_not_contact = true where id = v_c.id;
    end if;
    return jsonb_build_object('ok', false, 'reason', 'candidato_nao_contatar');
  end if;

  select * into v_o from public.organizations
   where id = p_organization_id and deleted_at is null;
  if v_o.id is null then
    return jsonb_build_object('ok', false, 'reason', 'organizacao_inexistente');
  end if;

  update public.organizations o
     set legal_name       = coalesce(o.legal_name, v_c.legal_name),
         cnpj             = coalesce(o.cnpj, v_c.cnpj),
         phone_e164       = coalesce(o.phone_e164, v_c.phone_e164),
         email            = coalesce(o.email, v_c.email),
         instagram_handle = coalesce(o.instagram_handle, v_c.instagram_handle),
         website          = coalesce(o.website, v_c.website),
         place_id         = coalesce(o.place_id, v_c.place_id),
         city_id          = coalesce(o.city_id, v_c.city_id),
         neighborhood     = coalesce(o.neighborhood, v_c.neighborhood),
         address          = coalesce(o.address, v_c.address),
         source_url       = coalesce(o.source_url, v_c.source_url)
   where o.id = p_organization_id;

  -- Um registro por campo que a fonte trouxe: 'gravado' quando entrou (a ficha
  -- estava vazia), 'preservado' quando não entrou porque já havia valor — e aí
  -- só o HASH do que foi recusado, nunca o valor.
  perform app.registrar_proveniencia(
            'organization', p_organization_id, f.campo,
            case when f.antes is null then 'gravado' else 'preservado' end,
            v_c.source_id, v_c.source_url, coalesce(p_batch_id, v_c.import_batch_id),
            v_c.collector, 'mesclagem do Radar',
            case when f.antes is null then null else f.valor end,
            case when f.antes is null then null else 'campo_ja_preenchido' end,
            v_c.collected_at)
    from (values ('legal_name', v_c.legal_name, v_o.legal_name),
                 ('cnpj', v_c.cnpj, v_o.cnpj),
                 ('phone_e164', v_c.phone_e164, v_o.phone_e164),
                 ('email', v_c.email::text, v_o.email::text),
                 ('instagram_handle', v_c.instagram_handle, v_o.instagram_handle),
                 ('website', v_c.website, v_o.website),
                 ('place_id', v_c.place_id, v_o.place_id),
                 ('neighborhood', v_c.neighborhood, v_o.neighborhood),
                 ('address', v_c.address, v_o.address)) as f(campo, valor, antes)
   where f.valor is not null;

  v_cat := coalesce(p_category_id, v_c.category_id);
  if v_cat is not null then
    insert into public.organization_categories (organization_id, category_id, is_primary)
    values (p_organization_id, v_cat, false)
    on conflict do nothing;
  end if;

  insert into public.activities (type, organization_id, user_id, author_kind, body, metadata)
  values ('system', p_organization_id, v_uid, 'system',
          'Candidato do Radar mesclado nesta ficha: ' || v_c.name,
          jsonb_build_object('origin', 'radar_merge', 'candidate_id', v_c.id,
                             'source_id', v_c.source_id));

  update public.supplier_candidates
     set status = 'mesclado', organization_id = p_organization_id,
         review_reason = nullif(trim(coalesce(p_reason, '')), ''),
         reviewed_by = v_uid, reviewed_at = now(),
         import_batch_id = coalesce(import_batch_id, p_batch_id)
   where id = p_candidate_id;

  return jsonb_build_object('ok', true, 'status', 'mesclado',
                            'organization_id', p_organization_id);
end $$;
comment on function app.mesclar_candidato(uuid,uuid,int,text,uuid) is
  'Mescla o candidato numa ficha existente COMPLETANDO campo vazio, nunca sobrescrevendo (RF-RAD-08). O que a fonte trouxe e não entrou fica em field_provenance como "preservado". Reconfere a lista de supressão no instante da mesclagem.';


-- ---------------------------------------------------------------------
-- F.2 A fila do dia pergunta a coisa inteira
-- ---------------------------------------------------------------------
create or replace function public.meu_dia(
  p_user_id uuid default null,
  p_limite  int  default 60)
returns table (
  prioridade      int,
  tipo            text,
  motivo          text,
  titulo          text,
  quando          timestamptz,
  atraso_horas    numeric,
  task_id         uuid,
  activity_id     uuid,
  deal_id         uuid,
  organization_id uuid,
  organizacao     text,
  bairro          text,
  categoria       text,
  temperatura     app.temperature,
  funil           text,
  etapa           text)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid    uuid := auth.uid();
  v_alvo   uuid;
  v_hoje   date := (now() at time zone 'America/Fortaleza')::date;
  v_limite int  := least(greatest(coalesce(p_limite, 60), 1), 300);
begin
  if v_uid is null then
    raise exception 'Usuário não autenticado' using errcode = '42501';
  end if;
  v_alvo := coalesce(p_user_id, v_uid);
  if v_alvo <> v_uid and not app.is_manager() then
    raise exception 'Só gestor ou admin lê a fila de outra pessoa' using errcode = '42501';
  end if;

  return query
  with tarefas as (
    select t.id, t.title, t.kind, t.due_at, t.deal_id, t.organization_id,
           o.name         as organizacao,
           o.neighborhood as bairro,
           cat.name       as categoria,
           d.temperature  as temperatura,
           pl.name        as funil,
           st.name        as etapa
      from public.tasks t
      left join public.organizations o on o.id = t.organization_id
      left join public.deals     d  on d.id  = t.deal_id
      left join public.stages    st on st.id = d.stage_id
      left join public.pipelines pl on pl.id = d.pipeline_id
      left join public.organization_categories pc on pc.organization_id = o.id and pc.is_primary
      left join public.categories cat on cat.id = pc.category_id
     where t.assignee_id = v_alvo
       and t.status in ('todo'::app.task_status, 'doing'::app.task_status)
       and (o.id is null or o.deleted_at is null)
       -- Reconferência na ENTREGA (a mesma de public.proximo_da_fila): a tarefa
       -- nasceu com app.tasks_guard_suppressed dizendo que podia, e nasce dias
       -- antes de ser trabalhada. `o.do_not_contact` sozinho não via nem a
       -- pessoa (contato que pediu para sair numa ficha cujo dono não pediu)
       -- nem a lista de supressão (a ficha irmã com o MESMO telefone, que
       -- continua com do_not_contact = false). `app.is_suppressed_target` vê.
       and not app.is_suppressed_target(t.organization_id, t.contact_id)
  ),
  negocios as (
    select c.deal_id, c.organization_id, c.organization_name, c.next_action_at,
           (c.card ->> 'temperature')::app.temperature as temperatura,
           coalesce((c.card ->> 'is_rotting')::boolean, false) as parado,
           coalesce((c.card ->> 'days_in_stage')::int, 0)      as dias_na_etapa,
           c.card ->> 'neighborhood'      as bairro,
           c.card ->> 'primary_category'  as categoria,
           c.card ->> 'next_action'       as proxima_acao,
           (c.card ->> 'days_since_contact')::int as dias_sem_contato,
           pl.name       as funil,
           st.name       as etapa,
           st.sla_hours
      from app.deal_cards c
      join public.deals         d  on d.id  = c.deal_id
      join public.organizations o  on o.id  = c.organization_id
      join public.stages        st on st.id = c.stage_id
      join public.pipelines     pl on pl.id = c.pipeline_id
     where c.owner_id = v_alvo
       and c.org_deleted_at is null
       and d.status = 'open'::app.deal_status
       and not app.is_suppressed_target(o.id, d.primary_contact_id)
       and not st.is_terminal
       -- Negócio com tarefa aberta JÁ está na fila como tarefa: a próxima ação do
       -- negócio e a tarefa são o mesmo compromisso (o registrar_contato cria as
       -- duas juntas). Repetir a empresa em duas linhas transforma a fila do dia
       -- numa lista de coisas que parecem duas e são uma.
       and not exists (select 1 from public.tasks t2
                        where t2.deal_id = c.deal_id
                          and t2.status in ('todo'::app.task_status, 'doing'::app.task_status))
  ),
  itens as (
    -- 1 · reunião ou visita nas próximas 3 h
    select 1, 'reuniao_proxima'::text,
           'Reunião ou visita em menos de 3 h'::text,
           t.title, t.due_at, null::numeric,
           t.id, null::uuid, t.deal_id, t.organization_id,
           t.organizacao, t.bairro, t.categoria, t.temperatura, t.funil, t.etapa
      from tarefas t
     where t.kind in ('meeting'::app.task_kind, 'visit'::app.task_kind)
       and t.due_at is not null
       and t.due_at >= now() and t.due_at < now() + interval '3 hours'

    union all
    -- 2 · interação registrada sem resultado (o gatilho do catálogo marcou)
    select 2, 'desfecho_pendente',
           'Registrada sem resultado: falta dizer o que aconteceu',
           coalesce(o.name, 'Interação sem alvo'),
           a.occurred_at,
           round(extract(epoch from (now() - a.occurred_at)) / 3600.0, 1),
           null::uuid, a.id, a.deal_id, coalesce(a.organization_id, d.organization_id),
           o.name, o.neighborhood, cat.name, d.temperature, pl.name, st.name
      from public.activities a
      left join public.deals         d  on d.id  = a.deal_id
      left join public.organizations o  on o.id  = coalesce(a.organization_id, d.organization_id)
      left join public.stages        st on st.id = d.stage_id
      left join public.pipelines     pl on pl.id = d.pipeline_id
      left join public.organization_categories pc on pc.organization_id = o.id and pc.is_primary
      left join public.categories cat on cat.id = pc.category_id
     where a.user_id = v_alvo
       and coalesce((a.metadata ->> 'outcome_pending')::boolean, false)
       and a.occurred_at < now()
       and a.occurred_at > now() - interval '30 days'
       and (o.id is null or o.deleted_at is null)

    union all
    -- 3 / 5 / 9 · tarefas por prazo
    select case
             when t.due_at is null then 9
             when t.due_at < now() then 3
             when (t.due_at at time zone 'America/Fortaleza')::date = v_hoje then 5
             else 9
           end,
           case
             when t.due_at is null then 'tarefa_sem_data'
             when t.due_at < now() then 'tarefa_atrasada'
             when (t.due_at at time zone 'America/Fortaleza')::date = v_hoje then 'tarefa_hoje'
             else 'tarefa_futura'
           end,
           case
             when t.due_at is null then 'Tarefa sem prazo'
             when t.due_at < now() - interval '2 days' then 'Tarefa vencida há '
                  || (v_hoje - (t.due_at at time zone 'America/Fortaleza')::date) || ' dia(s)'
             when t.due_at < now() then 'Tarefa vencida há '
                  || round(extract(epoch from (now() - t.due_at)) / 3600.0) || ' h'
             when (t.due_at at time zone 'America/Fortaleza')::date = v_hoje then 'Tarefa para hoje'
             else 'Tarefa agendada'
           end,
           t.title, t.due_at,
           case when t.due_at < now()
                then round(extract(epoch from (now() - t.due_at)) / 3600.0, 1) end,
           t.id, null::uuid, t.deal_id, t.organization_id,
           t.organizacao, t.bairro, t.categoria, t.temperatura, t.funil, t.etapa
      from tarefas t
     where not (t.kind in ('meeting'::app.task_kind, 'visit'::app.task_kind)
                and t.due_at is not null
                and t.due_at >= now() and t.due_at < now() + interval '3 hours')

    union all
    -- 4 / 6 / 7 / 8 · o negócio entra uma vez só, pelo motivo mais urgente
    select case
             when n.next_action_at is not null
              and (n.next_action_at at time zone 'America/Fortaleza')::date < v_hoje then 4
             when n.next_action_at is not null
              and (n.next_action_at at time zone 'America/Fortaleza')::date = v_hoje then 6
             when n.next_action_at is null then 7
             else 8
           end,
           case
             when n.next_action_at is not null
              and (n.next_action_at at time zone 'America/Fortaleza')::date < v_hoje then 'proxima_acao_atrasada'
             when n.next_action_at is not null
              and (n.next_action_at at time zone 'America/Fortaleza')::date = v_hoje then 'proxima_acao_hoje'
             when n.next_action_at is null then 'sem_proxima_acao'
             else 'negocio_parado'
           end,
           case
             when n.next_action_at is not null
              and (n.next_action_at at time zone 'America/Fortaleza')::date < v_hoje
               then 'Próxima ação vencida há '
                    || (v_hoje - (n.next_action_at at time zone 'America/Fortaleza')::date) || ' dia(s)'
             when n.next_action_at is not null
              and (n.next_action_at at time zone 'America/Fortaleza')::date = v_hoje
               then 'Próxima ação para hoje'
             when n.next_action_at is null
               then 'Negócio aberto sem próxima ação, na etapa ' || n.etapa
             when n.dias_sem_contato is null
               then 'Sem nenhum contato registrado, há ' || n.dias_na_etapa
                    || ' dia(s) na etapa ' || n.etapa
                    || ' (SLA ' || coalesce(n.sla_hours::text, '—') || ' h)'
             else 'Sem contato há ' || n.dias_sem_contato || ' dia(s) na etapa ' || n.etapa
                  || ' (SLA ' || coalesce(n.sla_hours::text, '—') || ' h)'
           end,
           coalesce(n.proxima_acao, n.organization_name),
           n.next_action_at,
           case when n.next_action_at is not null and n.next_action_at < now()
                then round(extract(epoch from (now() - n.next_action_at)) / 3600.0, 1) end,
           null::uuid, null::uuid, n.deal_id, n.organization_id,
           n.organization_name, n.bairro, n.categoria, n.temperatura, n.funil, n.etapa
      from negocios n
     where (n.next_action_at is not null
            and (n.next_action_at at time zone 'America/Fortaleza')::date <= v_hoje)
        or n.next_action_at is null
        or n.parado
  )
  select i.*
    from itens i (prioridade, tipo, motivo, titulo, quando, atraso_horas, task_id, activity_id,
                  deal_id, organization_id, organizacao, bairro, categoria, temperatura, funil, etapa)
   order by i.prioridade,
            case i.temperatura
              when 'quente'::app.temperature        then 4
              when 'cliente_ativo'::app.temperature then 3
              when 'cliente'::app.temperature       then 3
              when 'morno'::app.temperature         then 2
              else 1
            end desc,
            i.quando nulls last,
            i.organizacao
   limit v_limite;
end $$;
comment on function public.meu_dia(uuid, int) is
  'Fila do dia de uma pessoa (RF-MET-03/04), já ordenada por urgência: reunião em menos de 3 h, interação sem resultado, tarefa vencida, próxima ação vencida, tarefa e próxima ação de hoje, negócio sem próxima ação, negócio parado além do SLA e tarefa futura. Cada negócio entra uma vez só. Alvo suprimido NA HORA DA LEITURA fica de fora (app.is_suppressed_target: organização, pessoa e lista de supressão) — exceto o item "registrada sem resultado", que é tabular o que já aconteceu e não contato novo. Definer: a pessoa lê a própria fila; gestor e admin leem a de qualquer um.';
revoke all on function public.meu_dia(uuid, int) from public, anon;
grant execute on function public.meu_dia(uuid, int) to authenticated, service_role;
