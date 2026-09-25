-- =====================================================================
-- pgTAP — A saúde do número na Meta (migração 20260925160000)
--
-- O que este arquivo tem de provar, e por quê:
--   1. O HISTÓRICO É HISTÓRICO. `public.wa_saude_numero` é append-only. Quando
--      a Meta restringe e depois solta, a pergunta que importa é "desde
--      quando" e "quantas vezes" — e as duas se perdem num `update`.
--   2. A ÚLTIMA LINHA QUE SOUBE DE CADA COISA. Qualidade, tier e restrição
--      chegam por campos diferentes, em momentos diferentes. Ler "a última
--      linha" faria um `business_capability_update` apagar a restrição que
--      chegou dez minutos antes.
--   3. A NOTA DOBRA DENTRO DO TETO. YELLOW → metade, RED → zero.
--   4. RESTRIÇÃO VENCIDA CAI SOZINHA. `expiration` é unix em segundos, e uma
--      restrição de ontem que ninguém apagou não pode calar o número de hoje.
--   5. SEM HISTÓRICO, NADA MUDA. `teto_dia` nulo: "não sei" não vira nem
--      permissão nem proibição.
--   6. O TETO EFETIVO É O MENOR ENTRE O NOSSO E O DELA. E a restrição de
--      ENTRADA derruba até a resposta dentro da janela de 24 h — que é por
--      isso que ela é perguntada ANTES do passo 2, e não depois.
--   7. OS QUATRO MOTIVOS NOVOS SÃO ESPERA. O lote de campanha dorme; nada do
--      que a Meta decide sobre a NOSSA conta é motivo para descartar ficha.
--
-- O INSTANTE É FIXO, e todo o arquivo o usa: `app.wa_teto_da_meta` lê o
-- histórico ATÉ um instante, e `app.pode_enviar` precisa de uma quarta-feira
-- em horário comercial (RF-CON-11). Misturar `now()` com a quarta de setembro
-- faria as linhas de saúde nascerem DEPOIS da pergunta, e o teto sairia vazio
-- sem ninguém entender por quê. O molde da quarta é o do arquivo 24.
--
-- Roda em transação e desfaz tudo.
-- =====================================================================
begin;
select plan(23);

-- ---------- utilitários ----------
-- O número é fixo e impossível na operação: o `rollback` desfaz tudo, mas
-- misturar com o número de verdade tornaria a leitura ambígua.
create function pg_temp.num() returns text language sql immutable as $$
  select '+5584900000068'::text
$$;
create function pg_temp.agora() returns timestamptz language sql immutable as $$
  select (timestamp '2026-09-16 10:00') at time zone 'America/Fortaleza'
$$;
create function pg_temp.anotar(p jsonb) returns bigint
  language sql security definer set search_path = '' as $$
  select public.wa_saude_registrar(p)
$$;
-- Atalho: uma linha de saúde ocorrida `p_min` minutos ANTES do instante fixo.
create function pg_temp.saude(p_min int, p jsonb) returns bigint language sql as $$
  select pg_temp.anotar(p || jsonb_build_object('numero', pg_temp.num(),
           'ocorrido_em', (pg_temp.agora() - make_interval(mins => p_min))::text))
$$;
create function pg_temp.unix(p interval) returns bigint language sql as $$
  select extract(epoch from (pg_temp.agora() + p))::bigint
$$;

-- =====================================================================
-- 1. A TABELA É HISTÓRICO
-- =====================================================================
select has_table('public', 'wa_saude_numero', 'o que a Meta diz sobre o número tem onde morar');

select isnt(pg_temp.saude(180, jsonb_build_object(
    'origem', 'graph', 'campo', 'phone_number', 'qualidade', 'GREEN')), null,
  'a leitura da Graph grava a nota');

select throws_ok(
  format($$update public.wa_saude_numero set qualidade = 'RED' where numero = %L$$, pg_temp.num()),
  '42501', NULL,
  'e ninguém reescreve o histórico: append-only, como os eventos de consentimento');
select throws_ok(
  format($$delete from public.wa_saude_numero where numero = %L$$, pg_temp.num()),
  '42501', NULL,
  'nem apaga');

-- =====================================================================
-- 2. O TETO DA META
-- =====================================================================
select is(app.wa_teto_da_meta('+5584900000999', pg_temp.agora()) ->> 'teto_dia', NULL,
  'número sem histórico nenhum: teto nulo — "não sei" não vira "então pare"');

select pg_temp.saude(120, jsonb_build_object(
  'origem', 'webhook', 'campo', 'business_capability_update', 'limite_atual', 'TIER_2K'));
select is((app.wa_teto_da_meta(pg_temp.num(), pg_temp.agora()) ->> 'teto_dia')::int, 2000,
  'TIER_2K vira 2.000 conversas por dia');

select pg_temp.saude(60, jsonb_build_object(
  'origem', 'graph', 'campo', 'phone_number', 'qualidade', 'YELLOW'));
select is((app.wa_teto_da_meta(pg_temp.num(), pg_temp.agora()) ->> 'teto_dia')::int, 1000,
  'nota amarela vale metade do tier: a Meta não avisa duas vezes');
select is(app.wa_teto_da_meta(pg_temp.num(), pg_temp.agora()) ->> 'tier', 'TIER_2K',
  'e o tier continua lá: a linha da nota não apagou a linha do tier');

select pg_temp.saude(30, jsonb_build_object(
  'origem', 'webhook', 'campo', 'phone_number_quality_update',
  'evento', 'FLAGGED', 'qualidade', 'RED'));
select is((app.wa_teto_da_meta(pg_temp.num(), pg_temp.agora()) ->> 'teto_dia')::int, 0,
  'nota vermelha zera o teto: não é meio envio, é envio nenhum');

-- =====================================================================
-- 3. RESTRIÇÃO E BANIMENTO
-- =====================================================================
select pg_temp.saude(20, jsonb_build_object(
  'origem', 'webhook', 'campo', 'account_update', 'evento', 'ACCOUNT_RESTRICTION',
  'restricoes', jsonb_build_array(jsonb_build_object(
      'restriction_type', 'RESTRICTED_BIZ_INITIATED_MESSAGING',
      'expiration', pg_temp.unix(interval '2 days')))));
select is((app.wa_teto_da_meta(pg_temp.num(), pg_temp.agora()) ->> 'restrito_saida')::boolean, true,
  'RESTRICTED_BIZ_INITIATED_MESSAGING fecha a saída');
select ok((app.wa_teto_da_meta(pg_temp.num(), pg_temp.agora()) ->> 'ate')::timestamptz > pg_temp.agora(),
  'e diz até quando: a restrição tem prazo, e o prazo é da Meta');
select is((app.wa_teto_da_meta(pg_temp.num(), pg_temp.agora()) ->> 'restrito_entrada')::boolean, false,
  'a restrição de SAÍDA não fecha a entrada: são duas coisas, e a Meta as separa');

-- Uma restrição já vencida, e mais nenhuma: cai sozinha.
select pg_temp.saude(15, jsonb_build_object(
  'origem', 'webhook', 'campo', 'account_update', 'evento', 'ACCOUNT_RESTRICTION',
  'restricoes', jsonb_build_array(jsonb_build_object(
      'restriction_type', 'RESTRICTED_BIZ_INITIATED_MESSAGING',
      'expiration', pg_temp.unix(-interval '1 day')))));
select is((app.wa_teto_da_meta(pg_temp.num(), pg_temp.agora()) ->> 'restrito_saida')::boolean, false,
  'restrição vencida cai sozinha: ninguém precisa lembrar de apagá-la');

-- As outras sete restrições são guardadas e não viram teto.
select pg_temp.saude(12, jsonb_build_object(
  'origem', 'webhook', 'campo', 'account_update', 'evento', 'ACCOUNT_RESTRICTION',
  'restricoes', jsonb_build_array(jsonb_build_object(
      'restriction_type', 'RESTRICTED_ADD_PHONE_NUMBER_ACTION'))));
select is((app.wa_teto_da_meta(pg_temp.num(), pg_temp.agora()) ->> 'restrito_saida')::boolean, false,
  'restrição de outro assunto fica guardada e não vira teto: ela não fala de mensagem');

select pg_temp.saude(10, jsonb_build_object(
  'origem', 'webhook', 'campo', 'account_update', 'evento', 'DISABLED_UPDATE', 'banido', true));
select is((app.wa_teto_da_meta(pg_temp.num(), pg_temp.agora()) ->> 'banido')::boolean, true,
  'banimento é banimento, e ele chega por account_update');

-- =====================================================================
-- 4. O NÚMERO QUE A META NÃO MANDA
-- =====================================================================
-- `account_update` NÃO traz `phone_number` em `value`: a restrição é da WABA.
-- O registrador cai no número padrão em vez de gravar uma linha órfã.
select is((select s.numero from public.wa_saude_numero s
            where s.id = pg_temp.anotar(jsonb_build_object(
                    'origem', 'webhook', 'campo', 'account_update', 'evento', 'ACCOUNT_VIOLATION'))),
          app.wa_numero_padrao(),
  'sem número no payload, a linha nasce com o número padrão: account_update é da WABA, e a WABA é a nossa');

-- =====================================================================
-- 5. A PORTEIRA CONHECE A META
-- =====================================================================
-- Duas conversas no NOSSO número de teste: uma sem janela de 24 h (é nela que
-- os tetos valem) e uma com `last_inbound_at` recente (é nela que se prova que
-- a restrição de ENTRADA derruba até a resposta). O molde é o do arquivo 24.
create function pg_temp.contratar(p_nome text, p_papel text) returns uuid
language plpgsql as $$
declare
  v_id    uuid  := gen_random_uuid();
  v_email text  := 'pgtap68.' || replace(lower(extensions.unaccent(p_nome)), ' ', '.')
                   || '@teste.invalid';
begin
  insert into public.allowed_users (email, role, note)
  values (v_email, p_papel::app.user_role, 'Fixture do pgTAP 68 — desfeita no rollback');
  insert into auth.users (id, email, raw_user_meta_data)
  values (v_id, v_email, jsonb_build_object('full_name', p_nome));
  return v_id;
end $$;
create temp table equipe68(papel text primary key, id uuid not null);
insert into equipe68(papel, id) values ('sdr', pg_temp.contratar('Belmiro Pgtap', 'sdr'));

insert into public.conversations (id, business_number, peer_phone_e164, assignee_id)
values ('c0000000-0000-4000-8000-0000000c6801', pg_temp.num(), '+5584911110681',
        (select id from equipe68 where papel = 'sdr')),
       ('c0000000-0000-4000-8000-0000000c6802', pg_temp.num(), '+5584911110682',
        (select id from equipe68 where papel = 'sdr'));
update public.conversations set last_inbound_at = pg_temp.agora() - interval '1 hour'
 where id = 'c0000000-0000-4000-8000-0000000c6802';

-- Neste ponto do arquivo o histórico já tem, entre outras coisas: nota RED,
-- tier TIER_2K, nenhuma restrição de mensagem vigente e BANIDO. O banimento
-- vem primeiro, antes de qualquer outra pergunta.
select is(app.pode_enviar('c0000000-0000-4000-8000-0000000c6801', true, true, pg_temp.agora())
            ->> 'motivo', 'conta_banida',
  'conta banida para tudo, e antes de qualquer outra pergunta');
select ok((app.pode_enviar('c0000000-0000-4000-8000-0000000c6801', true, true, pg_temp.agora())
            ->> 'quando')::timestamptz > pg_temp.agora(),
  'e é ESPERA, não morte: o lote dorme seis horas em vez de queimar a ficha');
select is(app.pode_enviar('c0000000-0000-4000-8000-0000000c6802', false, false, pg_temp.agora())
            ->> 'motivo', 'conta_banida',
  'nem responder dentro da janela de 24 h: a conta banida não manda nada');

-- Uma linha nova de conta, sem banimento e com restrição de ENTRADA.
select pg_temp.saude(2, jsonb_build_object(
  'origem', 'webhook', 'campo', 'account_update', 'evento', 'ACCOUNT_RESTRICTION', 'banido', false,
  'restricoes', jsonb_build_array(jsonb_build_object(
      'restriction_type', 'RESTRICTED_CUSTOMER_INITIATED_MESSAGING',
      'expiration', pg_temp.unix(interval '1 day')))));
select is(app.pode_enviar('c0000000-0000-4000-8000-0000000c6802', false, false, pg_temp.agora())
            ->> 'motivo', 'meta_restringiu_entrada',
  'RESTRICTED_CUSTOMER_INITIATED_MESSAGING derruba ATÉ a resposta dentro da janela — e é por isso que ela é perguntada antes do passo 2');

-- E o teto: com a nota ainda vermelha, o menor entre o nosso e o dela é ZERO.
select pg_temp.saude(1, jsonb_build_object(
  'origem', 'webhook', 'campo', 'account_update', 'evento', 'ACCOUNT_RESTRICTION',
  'banido', false, 'restricoes', '[]'::jsonb));
select is(app.pode_enviar('c0000000-0000-4000-8000-0000000c6801', true, true, pg_temp.agora())
            ->> 'motivo', 'qualidade_vermelha',
  'nota vermelha tem motivo PRÓPRIO: teto cheio espera a próxima abertura, nota vermelha espera o número melhorar');

select ok(app.envio_motivo_de_espera('qualidade_vermelha')
          and app.envio_motivo_de_espera('conta_banida')
          and app.envio_motivo_de_espera('meta_restringiu_entrada')
          and app.envio_motivo_de_espera('meta_restringiu_saida'),
  'os quatro motivos novos são ESPERA: nada do que a Meta decide sobre a NOSSA conta descarta um fornecedor');

-- Nota de volta ao verde, e o teto da Meta volta a ser 2.000 — maior que o
-- nosso, que continua mandando. É o estado de hoje, e a peça existe para o dia
-- em que deixar de ser.
select pg_temp.saude(0, jsonb_build_object(
  'origem', 'graph', 'campo', 'phone_number', 'qualidade', 'GREEN'));
select ok((app.wa_teto_da_meta(pg_temp.num(), pg_temp.agora()) ->> 'teto_dia')::int
          > app.teto_do_canal('whatsapp'::app.channel, date '2026-09-16'),
  'com a nota verde, o teto da Meta é MAIOR que o nosso: quem manda continua sendo o aquecimento');

select * from finish();
rollback;
