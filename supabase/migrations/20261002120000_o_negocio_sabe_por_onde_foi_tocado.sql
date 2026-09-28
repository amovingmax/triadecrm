-- =====================================================================
-- O canal do último toque, no negócio
-- =====================================================================
-- Rafael confirmou em 28/09/2026: FILTRO de canal no funil que já existe, e NÃO
-- um funil separado para ligação. O motivo é do R13 §3.1 e está no ADR-16: o
-- fornecedor que ignorou o WhatsApp e atendeu o telefone é UM lead, não dois.
-- Com dois funis ele apareceria em dois lugares, com duas etapas que discordam,
-- e ninguém saberia qual vale.
--
-- ONDE O CANAL JÁ MORA: `activities.channel`. O que falta é o funil poder
-- perguntar sem varrer a timeline de cada cartão. A coluna é DERIVADA e a
-- mantém quem já mantém `last_activity_at` — o mesmo gatilho, no mesmo toque,
-- pelo mesmo motivo (recência).
--
-- LIMITE ESCRITO: isto é o canal do ÚLTIMO TOQUE, não "por onde o lead entrou".
-- `app.wa_resposta_no_funil` grava uma atividade de WhatsApp na primeira
-- resposta (20260915130000), então um fornecedor tocado por telefone que
-- responde no WhatsApp migra para `whatsapp`. Se o Rafael quiser origem, é outra
-- coluna e outra rodada.
--
-- A COLUNA E O BACKFILL ESTÃO NA 20261002110000, e não aqui: `app.deal_cards` é
-- recriada lá e lê `last_channel`, e migração que lê antes de criar não sobe.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. O índice do filtro
-- ---------------------------------------------------------------------
-- Parcial em `status = 'open'` porque o quadro só mostra negócio aberto, e
-- (pipeline_id, last_channel) na ordem em que a consulta filtra.
create index if not exists deals_last_channel_idx on public.deals (pipeline_id, last_channel)
  where status = 'open'::app.deal_status;

-- ---------------------------------------------------------------------
-- 2. Quem mantém a coluna
-- ---------------------------------------------------------------------
-- Recriada a partir da definição viva (20260904000300), com uma linha nova.
-- Assinatura idêntica, então `create or replace` substitui de verdade e o
-- gatilho `activities_touch_deal` não precisa ser recriado.
create or replace function app.activities_touch_deal()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.deal_id is not null and new.type <> 'system' then
    update public.deals d
       set last_activity_at = greatest(coalesce(d.last_activity_at, new.occurred_at), new.occurred_at),
           -- NOVO (28/09/2026, ADR-16): o canal do toque mais recente. As
           -- expressões do SET leem a linha ANTIGA, então `d.last_activity_at`
           -- aqui é o valor de antes — é assim que um toque retroativo (uma DM
           -- importada de dez dias atrás) não rouba o carimbo de quem é mais
           -- recente. `coalesce` porque atividade de nota e de mudança de etapa
           -- chegam sem canal, e um toque sem canal não apaga o canal do toque
           -- anterior.
           last_channel = case when new.occurred_at >= coalesce(d.last_activity_at, new.occurred_at)
                               then coalesce(new.channel, d.last_channel)
                               else d.last_channel end
     where d.id = new.deal_id;
  end if;
  return new;
end $$;
comment on function app.activities_touch_deal() is
  'Mantém deals.last_activity_at e deals.last_channel a cada atividade que não é de sistema. O canal é atributo do TOQUE (R13 §3.1): a ligação não cria um segundo lead, ela troca o canal do mesmo negócio.';
