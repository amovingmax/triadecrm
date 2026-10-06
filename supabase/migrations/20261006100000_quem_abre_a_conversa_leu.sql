-- =====================================================================
-- Quem abre a conversa, leu
--
-- Pedido de 06/10/2026: "eu to visualizando as mensagens do povo, mas n ta
-- contabilizando que ta sendo visualizada". Na aba Clientes, a conversa aberta
-- e já respondida duas vezes continuava com "2 por ler".
--
-- O contador (`conversations.unread_count`) sobe sozinho a cada mensagem que
-- chega (`app.messages_after_write`) e só descia por um caminho: um UPDATE
-- direto da tela, disparado ao abrir a conversa de um PARCEIRO. Dois furos
-- disso moram no banco, e são os dois que esta migração fecha.
--
-- ===========================================================================
-- 1 · QUEM ATENDE NÃO É SÓ O DONO
-- ===========================================================================
-- A política `conversations_update` deixa escrever o gestor ou quem está
-- atendendo (`assignee_id`). Certo para o resto da linha, errado para "eu li":
-- desde 14/09 o time inteiro atende no mesmo número, e a conversa que chega cai
-- no dono da ficha ou no responsável padrão. O SDR que a abria mandava o UPDATE,
-- a RLS casava zero linhas, o PostgREST devolvia sucesso — e o "por ler" ficava
-- lá, sem erro em lugar nenhum.
--
-- A saída é a mesma de `public.assumir_conversa` e `public.conversa_arquivar`:
-- uma função que muda UMA coluna, para quem já enxerga a conversa.
--
-- ===========================================================================
-- 2 · QUEM RESPONDEU, LEU
-- ===========================================================================
-- Ninguém responde sem ter lido. Enquanto a regra viveu só na tela, bastava a
-- resposta sair por outro caminho (a conversa que o desktop abre sozinho, a
-- ficha, o celular) para o fio ficar "respondido e por ler" ao mesmo tempo.
--
-- Só texto livre, áudio e mídia de GENTE zeram. Ficam de fora, de propósito:
--   · o robô (`bot_fixed`, `bot_ai`, `system`): menu, ausência e introdução
--     saem sem ninguém ter olhado, e o rascunho da IA pode ser aprovado em lote;
--   · o MODELO, mesmo assinado por gente: é como saem a campanha e o bom-dia,
--     disparados para muitas conversas de uma vez por quem não abriu nenhuma.
--
-- RF-CON-04, RF-CON-05
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1 · A ação
-- ---------------------------------------------------------------------
create or replace function public.conversa_marcar_lida(p_conversation_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  c public.conversations%rowtype;
begin
  -- `leitura` e `financeiro` enxergam tudo e não escrevem: quem só observa não
  -- apaga o sinal de quem atende.
  if auth.uid() is null or not app.can_write() then
    return jsonb_build_object('ok', false, 'motivo', 'sem_permissao');
  end if;
  select * into c from public.conversations where id = p_conversation_id;
  if not found then
    return jsonb_build_object('ok', false, 'motivo', 'conversa_inexistente');
  end if;
  -- O MESMO recorte de `conversations_select`: definer é para poder gravar sem
  -- depender da política de update, não para marcar conversa que não se vê.
  if not (app.sees_all()
          or c.assignee_id = auth.uid()
          or (app.role() = 'embaixador'::app.user_role
              and c.organization_id is not null
              and app.org_is_mine(c.organization_id))) then
    return jsonb_build_object('ok', false, 'motivo', 'sem_permissao');
  end if;

  update public.conversations
     set unread_count = 0
   where id = p_conversation_id and unread_count > 0;

  return jsonb_build_object('ok', true);
end $$;
comment on function public.conversa_marcar_lida(uuid) is
  'Zera o "por ler" da conversa (conversations.unread_count), para quem a enxerga e escreve (06/10/2026). Existe porque a política de update só deixa o gestor ou o atendente atual mexer na linha, e com o time inteiro no mesmo número quem abre a conversa quase nunca é um dos dois. O contador é da conversa, não da pessoa: leu um, está lida para todos.';
revoke all on function public.conversa_marcar_lida(uuid) from public, anon;
grant execute on function public.conversa_marcar_lida(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- 2 · A resposta de gente
-- ---------------------------------------------------------------------
-- Gatilho PRÓPRIO, pela mesma razão de `messages_desarquiva`: uma regra só, que
-- se lê, se testa e se remove sem tocar em `app.messages_after_write`.
create or replace function app.messages_quem_responde_leu()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.direction = 'out'::app.msg_direction
     and new.origin = 'crm'
     and new.author_kind = 'human'
     and new.type <> 'template'::app.msg_type then
    update public.conversations
       set unread_count = 0
     where id = new.conversation_id and unread_count > 0;
  end if;
  return null;
end $$;
comment on function app.messages_quem_responde_leu() is
  'Resposta escrita por gente (texto livre, áudio ou mídia) zera o "por ler" da conversa: ninguém responde sem ter lido. Robô não conta, e modelo também não — campanha e bom-dia saem assinados por gente para conversas que ninguém abriu.';
revoke all on function app.messages_quem_responde_leu() from public, anon, authenticated;

drop trigger if exists messages_quem_responde_leu on public.messages;
create trigger messages_quem_responde_leu
  after insert on public.messages
  for each row execute function app.messages_quem_responde_leu();

-- ---------------------------------------------------------------------
-- 3 · O que já foi respondido deixa de estar "por ler"
-- ---------------------------------------------------------------------
-- A regra 2 aplicada ao que já aconteceu: conversa em que uma pessoa escreveu
-- DEPOIS da última mensagem recebida. Sem isto, cada contador velho só sairia
-- com alguém abrindo a conversa, uma a uma. Quem só recebeu e ninguém respondeu
-- continua por ler, que é a verdade.
update public.conversations c
   set unread_count = 0
 where c.unread_count > 0
   and c.last_inbound_at is not null
   and exists (select 1
                 from public.messages m
                where m.conversation_id = c.id
                  and m.direction = 'out'::app.msg_direction
                  and m.origin = 'crm'
                  and m.author_kind = 'human'
                  and m.type <> 'template'::app.msg_type
                  and m.status <> 'failed'::app.msg_status
                  and coalesce(m.sent_at, m.created_at) > c.last_inbound_at);

notify pgrst, 'reload schema';
