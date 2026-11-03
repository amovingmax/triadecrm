-- =====================================================================
-- A ligação perdida na lista de Conversas (RF-CON-18)
--
-- Pedido de 03/11/2026, antes de abrir a ligação aos clientes da Imova: o cliente que liga
-- e ninguém atende (CRM fechado, ou ninguém clicou em Atender) virava só uma linha cinza
-- dentro da conversa. Agora a conversa sobe para o topo de Conversas, com o selo
-- "Ligação perdida", até alguém ligar de volta ou escrever ao cliente.
--
-- A ordem da lista é montada na TELA, e não em `conversations.last_message_at`: mexer
-- nesse campo faria a IA reler a conversa (a ficha da conversa e a atitude do cliente vão
-- por ele), e uma ligação não traz texto novo para ler. Pelo mesmo motivo nada aqui toca
-- em `messages`, na janela de 24 h ou na fila de envio.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. As perdidas sem retorno
-- ---------------------------------------------------------------------
-- Retorno é uma ligação feita pelo time depois dela (atendida ou não: alguém tentou), uma
-- ligação que completou, ou uma mensagem escrita por alguém do time que não falhou.
-- Mensagem automática não conta: não é ninguém respondendo. Depois de 30 dias a marca
-- sai sozinha, para a lista não carregar perdida antiga.
create or replace function public.wa_ligacoes_perdidas()
returns table (conversation_id uuid, ultima_em timestamptz, quantas int)
language sql
stable
security invoker
set search_path = ''
as $$
  select p.conversation_id, max(p.tocou_em), count(*)::int
    from public.wa_chamadas p
   where p.direcao = 'recebida'
     and p.estado = 'perdida'
     and p.tocou_em > now() - interval '30 days'
     and not exists (
           select 1 from public.wa_chamadas d
            where d.conversation_id = p.conversation_id
              and d.tocou_em > p.tocou_em
              and (d.estado = 'encerrada' or (d.direcao = 'feita' and d.estado <> 'falhou')))
     and not exists (
           select 1 from public.messages m
            where m.conversation_id = p.conversation_id
              and m.direction = 'out'::app.msg_direction
              and m.author_kind = 'human'
              and m.status <> 'failed'::app.msg_status
              and m.created_at > p.tocou_em)
   group by p.conversation_id
$$;
comment on function public.wa_ligacoes_perdidas() is
  'Conversas com ligação pelo WhatsApp perdida e ainda sem retorno do time (30 dias). Lê com a RLS de quem pede.';
revoke all on function public.wa_ligacoes_perdidas() from public, anon;
grant execute on function public.wa_ligacoes_perdidas() to authenticated;

-- ---------------------------------------------------------------------
-- 2. A conversa concluída volta quando o cliente liga
-- ---------------------------------------------------------------------
-- Como a mensagem faz (`messages_desarquiva`): quem liga está procurando a empresa, e a
-- conversa arquivada some da lista de Clientes. Gatilho próprio, de uma regra só, e que
-- nunca derruba o aviso da Meta: a ligação gravada vale mais que a conversa desarquivada.
create or replace function app.wa_chamadas_desarquiva()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.direcao = 'recebida' then
    begin
      update public.conversations
         set arquivada_em = null, arquivada_por = null, updated_at = now()
       where id = new.conversation_id and arquivada_em is not null;
    exception when others then
      raise warning 'wa_chamadas_desarquiva: % (%)', sqlerrm, sqlstate;
    end;
  end if;
  return null;
end $$;
revoke all on function app.wa_chamadas_desarquiva() from public, anon, authenticated;

drop trigger if exists wa_chamadas_desarquiva on public.wa_chamadas;
create trigger wa_chamadas_desarquiva
  after insert on public.wa_chamadas
  for each row execute function app.wa_chamadas_desarquiva();

notify pgrst, 'reload schema';
