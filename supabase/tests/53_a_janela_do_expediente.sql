-- =====================================================================
-- pgTAP — A janela do WhatsApp é o expediente (migração 20260917160000)
--
-- Em 17/09/2026, às 13h55, a equipe não conseguia iniciar conversa com NENHUM
-- parceiro: a tela dizia "abre às 14h" e ninguém entendia o motivo. Era a faixa
-- de almoço, herdada do R08. O Rafael decidiu: 8h às 17h45, sem parada.
--
-- Este arquivo existe porque horário é o tipo de regra que volta sozinha — num
-- `db reset` mal ordenado, numa migração futura que reinsira a semente antiga —
-- e volta em silêncio, aparecendo só como "não consigo falar com ninguém".
--
-- Roda em transação e desfaz tudo.
-- =====================================================================
begin;
select plan(10);

-- Quarta-feira, 16/09/2026 (dia útil, não é feriado na tabela `holidays`).
create function pg_temp.quarta(p_hora text) returns timestamptz language sql immutable as $$
  select (('2026-09-16 ' || p_hora)::timestamp) at time zone 'America/Fortaleza'
$$;
create function pg_temp.aberta(p_quando timestamptz, p_respondeu boolean default false) returns boolean language sql stable as $$
  select coalesce((app.janela_do_canal('whatsapp'::app.channel, p_quando, p_respondeu) ->> 'aberta')::boolean, false)
$$;
create function pg_temp.motivo(p_quando timestamptz, p_respondeu boolean default false) returns text language sql stable as $$
  select app.janela_do_canal('whatsapp'::app.channel, p_quando, p_respondeu) ->> 'motivo'
$$;

-- ---------- 1. o almoço, que era a trava ----------
select ok(pg_temp.aberta(pg_temp.quarta('12:30')),
  'MEIO-DIA E MEIA ESTÁ ABERTO — era esta faixa que recusava todo primeiro contato');
select ok(pg_temp.aberta(pg_temp.quarta('13:55')),
  'e 13h55 também, que foi a hora exata em que a equipe travou');

-- ---------- 2. as bordas do expediente ----------
select ok(pg_temp.aberta(pg_temp.quarta('08:00')), 'abre às 8h em ponto');
select ok(pg_temp.aberta(pg_temp.quarta('17:44')), 'e continua aberto às 17h44');
select ok(not pg_temp.aberta(pg_temp.quarta('07:59')), 'às 7h59 ainda não abriu');
select is(pg_temp.motivo(pg_temp.quarta('07:59')), 'antes_da_abertura',
  'e o motivo é "antes_da_abertura", que a tela traduz com a hora de abrir');
select ok(not pg_temp.aberta(pg_temp.quarta('17:46')), 'às 17h46 já fechou');
select is(pg_temp.motivo(pg_temp.quarta('17:46')), 'depois_do_fechamento',
  'com o motivo do fim do expediente');

-- ---------- 3. o que a decisão NÃO mudou ----------
-- Domingo é compromisso escrito (RF-CON-11, R06 §3.4), não preferência de
-- horário: mudar o expediente não podia derrubá-lo junto.
select is(pg_temp.motivo(('2026-09-20 10:00'::timestamp) at time zone 'America/Fortaleza'), 'domingo',
  'DOMINGO CONTINUA FECHADO — é compromisso da operação, não gosto de horário');
-- Sábado segue só para quem já respondeu: abrir primeiro contato no sábado é
-- outra decisão, e ninguém a tomou.
select ok(not pg_temp.aberta(('2026-09-19 11:00'::timestamp) at time zone 'America/Fortaleza', false),
  'sábado continua fechado para quem ainda não respondeu');

rollback;
