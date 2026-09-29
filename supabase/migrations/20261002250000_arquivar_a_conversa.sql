-- =====================================================================
-- Arquivar a conversa
--
-- Rafael, 29/09/2026: "crie a funcionalidade de apagar o chat". Perguntei o que
-- "apagar" devia fazer, entre sumir da lista (com volta) e apagar do banco (sem
-- volta), e ele escolheu **arquivar**.
--
-- ===========================================================================
-- POR QUE ARQUIVAR, E NÃO APAGAR
-- ===========================================================================
-- Apagar no CRM não apaga no WhatsApp do fornecedor: ele continua com a
-- conversa inteira no celular. Quem apagasse aqui criaria uma assimetria em que
-- a pessoa do outro lado lembra do que foi combinado e o CRM não — e quem
-- atendesse na semana seguinte responderia por cima de um contexto invisível.
-- Fora isso, `audit_log` e a retenção do PRD §10.6 (`app.aplicar_retencao`)
-- valem para mensagem enviada, e a retenção já apaga o corpo aos 12 meses.
--
-- Arquivar resolve o que ele precisa — tirar da frente o lixo de teste, o
-- número errado, o fio encerrado — sem destruir o que foi dito.
--
-- ===========================================================================
-- A CONVERSA VOLTA SOZINHA
-- ===========================================================================
-- Mensagem nova do parceiro DESARQUIVA. Sem isto, arquivar viraria uma armadilha
-- silenciosa: alguém arruma a lista numa terça, o fornecedor responde na quinta,
-- e a resposta não aparece para ninguém — que é o oposto do que este CRM existe
-- para fazer. Arquivar diz "não tenho o que fazer aqui AGORA", não "não me
-- importa mais esta pessoa".
--
-- Quem arquiva não é só admin: qualquer pessoa que escreve. Arquivar não
-- destrói nada e é desfeito com um clique — pedir admin para isso faria a lista
-- suja permanecer suja.
--
-- RF-CON-04, RF-ADM-03
-- =====================================================================

alter table public.conversations
  add column if not exists arquivada_em  timestamptz,
  add column if not exists arquivada_por uuid references public.profiles (id) on delete set null;

comment on column public.conversations.arquivada_em is
  'Quando alguém tirou esta conversa da lista (29/09/2026). Não apaga nada: o fio inteiro continua, e mensagem nova do parceiro zera esta coluna.';
comment on column public.conversations.arquivada_por is
  'Quem arquivou. Fica para quem abrir a conversa saber a quem perguntar.';

-- A lista pede "as não arquivadas, mais recentes primeiro" o tempo todo.
create index if not exists conversations_nao_arquivadas
  on public.conversations (last_message_at desc nulls last)
  where arquivada_em is null;

-- ---------------------------------------------------------------------
-- A ação
-- ---------------------------------------------------------------------
create or replace function public.conversa_arquivar(p_conversation_id uuid,
                                                    p_arquivar boolean default true)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  c public.conversations%rowtype;
begin
  if auth.uid() is null or not app.can_write() then
    return jsonb_build_object('ok', false, 'motivo', 'sem_permissao');
  end if;
  select * into c from public.conversations where id = p_conversation_id;
  if not found then
    return jsonb_build_object('ok', false, 'motivo', 'conversa_inexistente');
  end if;
  -- O MESMO recorte de `conversations_select`: definer é para poder gravar sem
  -- depender da política de update (que hoje é do dono ou de gestor), não para
  -- deixar alguém arquivar conversa que não enxerga.
  if not (app.sees_all()
          or c.assignee_id = auth.uid()
          or (app.role() = 'embaixador'::app.user_role
              and c.organization_id is not null
              and app.org_is_mine(c.organization_id))) then
    return jsonb_build_object('ok', false, 'motivo', 'sem_permissao');
  end if;

  update public.conversations
     set arquivada_em  = case when p_arquivar then now() else null end,
         arquivada_por = case when p_arquivar then auth.uid() else null end,
         updated_at    = now()
   where id = p_conversation_id;

  return jsonb_build_object('ok', true, 'arquivada', p_arquivar);
end $$;
comment on function public.conversa_arquivar(uuid, boolean) is
  'Tira a conversa da lista, ou traz de volta (29/09/2026). Não apaga nada — o fio inteiro continua e mensagem nova do parceiro desarquiva sozinha. Qualquer pessoa que escreve pode, sobre conversa que ela enxerga; o rastro fica no audit_log do gatilho da tabela.';
revoke all on function public.conversa_arquivar(uuid, boolean) from public, anon;
grant execute on function public.conversa_arquivar(uuid, boolean) to authenticated;

-- ---------------------------------------------------------------------
-- A volta sozinha
-- ---------------------------------------------------------------------
-- Gatilho PRÓPRIO, e não uma linha dentro de `app.messages_after_write`: aquela
-- função é a mais quente do banco e já faz seis coisas. Um gatilho de uma regra
-- só é lido, testado e removido sem tocar nas outras cinco.
create or replace function app.messages_desarquiva()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.direction = 'in'::app.msg_direction then
    update public.conversations
       set arquivada_em = null, arquivada_por = null, updated_at = now()
     where id = new.conversation_id and arquivada_em is not null;
  end if;
  return null;
end $$;
revoke all on function app.messages_desarquiva() from public, anon, authenticated;

drop trigger if exists messages_desarquiva on public.messages;
create trigger messages_desarquiva
  after insert on public.messages
  for each row execute function app.messages_desarquiva();
