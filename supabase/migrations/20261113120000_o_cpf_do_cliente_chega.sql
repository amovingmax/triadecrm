-- =====================================================================
-- O CPF que o cliente manda chega à conversa (13/11/2026)
--
-- O problema: a constraint `messages_sem_cpf` (ADR-09, migração 0200) recusava
-- QUALQUER mensagem com um CPF válido dentro, inclusive a que o cliente
-- escreve. A mensagem recebida não ficava só sem o texto: o INSERT de
-- `app.wa_registrar_entrada` falhava, a esteira tentava de novo, desistia e a
-- mandava para a `wa_dlq`. A pessoa escrevia o CPF e a conversa nunca mostrava
-- a mensagem. Na KOMUNE foram 24 assim, de 05/10 a 13/11/2026, quase todas de
-- quem precisava resolver o cadastro no aplicativo, que é justamente o caso em
-- que a equipe PRECISA do CPF para achar a conta.
--
-- O que muda:
--
--   1. A CONSTRAINT SÓ VALE PARA O QUE SAI. `messages_sem_cpf` passa a ser
--      `body is null or direction = 'in' or not app.tem_cpf(body)`. O que a
--      equipe (ou a IA, ou um modelo) manda continua sem CPF, como antes. O
--      que o cliente manda deixa de ser recusado.
--
--   2. CADA EMPRESA DECIDE O QUE FAZ COM O CPF RECEBIDO, num gatilho BEFORE
--      (`messages_cpf_da_entrada`, em INSERT e na edição do texto):
--        * KOMUNE: guarda a mensagem como veio. O suporte do aplicativo
--          precisa do número, e a KOMUNE não publica política no CRM
--          (`EMPRESA.privacidade` é null).
--        * Imova (e qualquer outra): a política pública (`/privacidade`) diz
--          que o CRM não guarda CPF. O número é trocado por "[CPF apagado]" e
--          o resto da mensagem chega. Antes, a mensagem inteira sumia.
--      Quem diz a empresa é `public.empresa_do_banco()` (migração
--      20261022090000). Banco sem identidade cai no lado que apaga.
--
--   3. A IA NÃO VÊ O NÚMERO. A pseudonimização (packages/prompts) já trocava o
--      CPF com pontuação por `[[DOCUMENTO_n]]`; passa a trocar também os 11
--      dígitos corridos que fecham no dígito verificador. Assim
--      `ai_runs_sem_cpf` continua valendo sem mudar.
--
-- Grupos do WhatsApp (`wa_grupo_mensagens`) ficam como estão: lá o texto com
-- CPF já chegava sem o corpo, e a mensagem não se perdia.
-- =====================================================================

-- ---------------------------------------------------------------------------
-- 1. A constraint passa a olhar só a mensagem que sai
-- ---------------------------------------------------------------------------
alter table public.messages drop constraint if exists messages_sem_cpf;
alter table public.messages
  add constraint messages_sem_cpf
  check (body is null or direction = 'in'::app.msg_direction or not app.tem_cpf(body));
comment on constraint messages_sem_cpf on public.messages is
  'ADR-09 no que sai: a mensagem que a equipe, a IA ou um modelo mandam não leva CPF. '
  'A recebida não é recusada (13/11/2026); `messages_cpf_da_entrada` decide por empresa.';

-- ---------------------------------------------------------------------------
-- 2. O CPF recebido, por empresa
-- ---------------------------------------------------------------------------
create or replace function app.cpf_trocado(t text, p_marca text default '[CPF apagado]')
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v text := t;
  m text;
begin
  if v is null then
    return null;
  end if;
  for m in select x[1] from regexp_matches(v, '(\d{3}\.?\d{3}\.?\d{3}-?\d{2})', 'g') x loop
    if app.cpf_is_valid(m) then
      v := replace(v, m, p_marca);
    end if;
  end loop;
  return v;
end $$;
comment on function app.cpf_trocado(text, text) is
  'O texto com cada CPF válido trocado por uma marca ("[CPF apagado]"). Diferente de `app.sem_cpf`, '
  'que só apaga: numa conversa, quem lê precisa saber que ali havia um número.';
revoke all on function app.cpf_trocado(text, text) from public, anon;
grant execute on function app.cpf_trocado(text, text) to authenticated, service_role;

create or replace function app.messages_cpf_da_entrada()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.direction is distinct from 'in'::app.msg_direction or new.body is null then
    return new;
  end if;
  if public.empresa_do_banco() is not distinct from 'komune' then
    return new;
  end if;
  if app.tem_cpf(new.body) then
    new.body := app.cpf_trocado(new.body);
  end if;
  return new;
end $$;
comment on function app.messages_cpf_da_entrada() is
  'Mensagem recebida com CPF: na KOMUNE fica como veio (suporte de cadastro); nas outras empresas o '
  'número vira "[CPF apagado]" e o resto chega (13/11/2026).';
revoke all on function app.messages_cpf_da_entrada() from public, anon, authenticated;

drop trigger if exists messages_cpf_da_entrada on public.messages;
create trigger messages_cpf_da_entrada
  before insert or update of body on public.messages
  for each row execute function app.messages_cpf_da_entrada();
