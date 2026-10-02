-- =====================================================================
-- A foto e o vídeo chegam inteiros
--
-- Rafael, 02/10/2026, com a foto de uma conversa em que o balão dizia "Imagem
-- sem arquivo guardado: o CRM não baixou esta mídia da Meta": "coloque pro crm
-- aceitar imagens e videos".
--
-- O balde `mensagens` já aceitava foto, vídeo e PDF desde a migração
-- 20260905000201, e o banco já guardava o `media_id` de toda mídia recebida.
-- Quem não baixava era o worker-wa: ele só buscava na Meta o ÁUDIO, porque o
-- áudio precisava de transcrição. A partir do worker desta mesma data ele baixa
-- também foto, vídeo e documento na chegada.
--
-- Esta migração é a outra metade: RECUPERAR o que chegou antes. A URL de uma
-- mídia da Meta vale minutos, mas o `media_id` continua servindo para pedir uma
-- URL nova enquanto a Meta guarda o arquivo (até 30 dias). Então o worker passa
-- de tempos em tempos por:
--   · `public.wa_midias_sem_arquivo` — mídia RECEBIDA (foto, vídeo, documento,
--     áudio) sem arquivo no balde, dos últimos 30 dias, que ainda não falhou
--     três vezes; da mais nova para a mais velha;
--   · `public.wa_midia_falhou` — anota a tentativa que não deu, para a mesma
--     mídia apagada pela Meta não ocupar a fila para sempre.
--
-- As duas são do worker (service_role) e de mais ninguém: a tela não chama.
-- A tabela das tentativas nasce com RLS, como toda tabela, e só o admin lê.
-- =====================================================================

create table if not exists public.midia_tentativas (
  message_id  uuid primary key references public.messages(id) on delete cascade,
  tentativas  smallint not null default 0 check (tentativas >= 0),
  ultima_em   timestamptz not null default now(),
  motivo      text
);
comment on table public.midia_tentativas is
  'Tentativas do worker-wa de baixar da Meta uma mídia recebida que ficou sem arquivo no balde. Três falhas e ela sai da fila de recuperação (a Meta já não tem o arquivo).';

alter table public.midia_tentativas enable row level security;
drop policy if exists midia_tentativas_select on public.midia_tentativas;
create policy midia_tentativas_select on public.midia_tentativas
  for select to authenticated using ((select app.is_admin()));
revoke all on public.midia_tentativas from anon, authenticated;
grant select on public.midia_tentativas to authenticated;
grant all on public.midia_tentativas to service_role;

-- ---------------------------------------------------------------------
-- O que falta baixar
-- ---------------------------------------------------------------------
-- Índice parcial: a pergunta é feita a cada volta do worker, e as mensagens
-- que respondem a ela são uma fatia mínima da tabela.
create index if not exists messages_midia_sem_arquivo_idx
  on public.messages (created_at desc)
  where direction = 'in'::app.msg_direction and media_id is not null and media_path is null;

create or replace function public.wa_midias_sem_arquivo(p_limite integer default 20)
returns table (message_id uuid, conversation_id uuid, media_id text, tipo text)
language sql
stable
security definer
set search_path = ''
as $$
  select m.id, m.conversation_id, m.media_id, m.type::text
    from public.messages m
   where m.direction = 'in'::app.msg_direction
     and m.type in ('image'::app.msg_type, 'video'::app.msg_type,
                    'document'::app.msg_type, 'audio'::app.msg_type)
     and m.media_id is not null
     and m.media_path is null
     and m.created_at > now() - interval '30 days'
     and not exists (select 1 from public.midia_tentativas t
                      where t.message_id = m.id and t.tentativas >= 3)
   order by m.created_at desc
   limit greatest(1, least(coalesce(p_limite, 20), 100))
$$;
comment on function public.wa_midias_sem_arquivo(integer) is
  'Mídias recebidas (foto, vídeo, documento, áudio) sem arquivo no balde, dos últimos 30 dias e com menos de três tentativas — a fila de recuperação do worker-wa.';
revoke all on function public.wa_midias_sem_arquivo(integer) from public, anon, authenticated;
grant execute on function public.wa_midias_sem_arquivo(integer) to service_role;

-- ---------------------------------------------------------------------
-- A tentativa que não deu
-- ---------------------------------------------------------------------
create or replace function public.wa_midia_falhou(p_message_id uuid, p_motivo text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_n smallint;
begin
  insert into public.midia_tentativas (message_id, tentativas, ultima_em, motivo)
  values (p_message_id, 1, now(), left(p_motivo, 200))
  on conflict (message_id) do update
     set tentativas = least(public.midia_tentativas.tentativas + 1, 100),
         ultima_em  = now(),
         motivo     = left(excluded.motivo, 200)
  returning tentativas into v_n;
  return jsonb_build_object('ok', true, 'tentativas', v_n);
end $$;
comment on function public.wa_midia_falhou(uuid, text) is
  'Anota que o worker-wa tentou baixar a mídia desta mensagem e não conseguiu. Na terceira, ela sai de wa_midias_sem_arquivo.';
revoke all on function public.wa_midia_falhou(uuid, text) from public, anon, authenticated;
grant execute on function public.wa_midia_falhou(uuid, text) to service_role;
