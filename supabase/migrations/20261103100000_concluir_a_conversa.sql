-- =====================================================================
-- Concluir a conversa — só na Imova, por enquanto (03/11/2026)
--
-- Pedido do usuário, para a Imova: "quero que tenhamos a funcionalidade de
-- colocar uma conversa como 'Concluída' e fazer com que ela saia das
-- conversas, mas não devemos perder o histórico [...] Assim que formos
-- conversar novamente com esse cliente devemos ter o histórico da conversa com
-- ele". E sobre onde vale: "Primeiro quero implementar essa mudança na Imova;
-- ficando bom e sendo aprovado por mim, a gente coloca na Komune também". Só
-- pelo botão: nada conclui sozinho por tempo parado.
--
-- ===========================================================================
-- CONCLUIR É O ARQUIVAR, COM DUAS REGRAS A MAIS
-- ===========================================================================
-- O arquivar de 29/09/2026 (20261002250000) já tirava da lista sem apagar nada
-- e já voltava sozinho quando a pessoa escrevia. Faltava a tela dizer o que ele
-- é (era um ícone de caixa, sem nome) e faltavam estas duas regras:
--
--   1. QUEM VOLTA A CONVERSAR TAMBÉM É O TIME. O arquivar só desarquiva com
--      mensagem do contato (o pgTAP 93 prova: "mensagem NOSSA não desarquiva").
--      Concluída, a conversa volta para a lista também quando uma PESSOA do
--      time escreve (`author_kind = 'human'`): é o "quando formos conversar
--      novamente". Robô, modelo automático e aviso do sistema não trazem de
--      volta, porque não é ninguém voltando a conversar.
--   2. CONCLUÍDA SAI DO MEU DIA. O caso mais comum de concluir é depois do "ok,
--      obrigado" do cliente: a última palavra é dele, e sem esta regra o Meu dia
--      continuaria pedindo "Responder no WhatsApp" para a conversa que a pessoa
--      acabou de encerrar. Se ele escrever de novo, a conversa volta (gatilho) e
--      o item volta junto.
--
-- As mesmas colunas (`arquivada_em`, `arquivada_por`) e a mesma porta
-- (`public.conversa_arquivar`, com o rastro no `audit_log` do gatilho da tabela).
--
-- ===========================================================================
-- NA KOMUNE NADA MUDA
-- ===========================================================================
-- As duas regras perguntam `app.concluir_ligado()`, verdade só no banco cuja
-- identidade é "imova" (`app.identidade`). No banco da KOMUNE, e no CI e no
-- `db reset` local (sem identidade), tudo fica como era — o pgTAP 93 continua
-- passando sem mudar uma linha. Quando a KOMUNE entrar, muda só essa função.
--
-- ===========================================================================
-- O WHATSAPP NÃO É TOCADO
-- ===========================================================================
-- Concluir não manda mensagem, não chama a Meta e não pede nada em `wa_acoes`.
-- A regra 1 mora no gatilho que já existia (`messages_desarquiva`, AFTER INSERT,
-- gatilho próprio e não `messages_after_write`) e só escreve em
-- `conversations`. O ramo novo roda dentro de um bloco de exceção: se a volta
-- para a lista falhar, a mensagem da pessoa sai assim mesmo. O ramo da entrada
-- continua exatamente como era.
--
-- RF-CON-04
--
-- COMO DESFAZER:
--   reaplicar `app.messages_desarquiva` de 20261002250000 e
--   `app.conversas_esperando_gente` de 20261002180000;
--   drop function if exists app.concluir_ligado();
-- =====================================================================

-- ---------------------------------------------------------------------
-- A chave: em que banco concluir vale
-- ---------------------------------------------------------------------
create or replace function app.concluir_ligado()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select i.empresa = 'imova' from app.identidade i), false)
$$;
comment on function app.concluir_ligado() is
  'Concluir a conversa (03/11/2026) vale neste banco? Só na Imova por enquanto (app.identidade): a conversa concluída volta quando alguém do time escreve e sai do Meu dia. Quando a KOMUNE entrar, muda só aqui.';
-- Só os gatilhos e as funções definer a chamam; ninguém de fora precisa.
revoke all on function app.concluir_ligado() from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 1. A volta para a lista, também quando o time escreve
-- ---------------------------------------------------------------------
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
  elsif new.direction = 'out'::app.msg_direction
        and new.author_kind = 'human'
        and app.concluir_ligado() then
    -- Só na Imova (03/11/2026): a pessoa do time voltou a conversar. Nunca
    -- derruba o envio: falhou a volta, a mensagem sai e a conversa fica onde
    -- estava.
    begin
      update public.conversations
         set arquivada_em = null, arquivada_por = null, updated_at = now()
       where id = new.conversation_id and arquivada_em is not null;
    exception when others then
      raise warning 'messages_desarquiva: a conversa % não voltou para a lista (%)',
        new.conversation_id, sqlerrm;
    end;
  end if;
  return null;
end $$;
comment on function app.messages_desarquiva() is
  'A conversa arquivada (concluída, na Imova) volta para a lista quando o contato escreve; na Imova, também quando uma pessoa do time escreve (03/11/2026, app.concluir_ligado). Robô, modelo automático e sistema não trazem de volta.';
revoke all on function app.messages_desarquiva() from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 2. Concluída sai do Meu dia
-- ---------------------------------------------------------------------
-- O corpo é o de 20261002180000, com UMA condição a mais no pré-filtro
-- (`candidatas`). `(select app.concluir_ligado())` é subconsulta escalar de
-- propósito: vira InitPlan, perguntado uma vez por chamada e não por conversa.
-- Na KOMUNE ele é falso e a condição inteira é verdadeira para toda linha.
create or replace function app.conversas_esperando_gente(p_de_quem uuid default null)
returns table (conversation_id uuid, de_quem uuid, organization_id uuid, deal_id uuid,
               desde timestamptz, janela_expira_em timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  -- QUEM O SETOR INDICA, RESOLVIDO UMA VEZ POR SETOR E NÃO POR CONVERSA.
  -- `app.setor_quem_recebe` conta as conversas abertas de cada membro do setor
  -- para achar o menos carregado, e por linha ela é a conta mais cara desta
  -- função: medido em 28/09/2026, com um perfil desativado e 3.000 conversas
  -- esperando, são 386 ms dos 912 ms da chamada inteira. `materialized` porque
  -- sem ele o planejador pode embutir o CTE e trazer a chamada de volta para
  -- dentro do laço.
  with quem_recebe as materialized (
    select s.id as setor_id, app.setor_quem_recebe(s.id) as quem from public.setores s
  ),
  -- O PRÉ-FILTRO BARATO, NUM CTE MATERIALIZADO — e o `materialized` é o ponto.
  -- `where` não é ordem de execução: o planejador ordena os filtros pelo custo
  -- que ELE estima, e estimava `app.wa_motivo_de_recusa` (função definer, custo
  -- padrão) como mais barata que este OR com subplano — 236 ms para devolver
  -- zero linha. Com a cerca, as quatro linhas abaixo varrem a tabela em 0,3 ms.
  --
  -- O recorte é um SUPERCONJUNTO: `p_de_quem` só vale de verdade no WHERE de
  -- fora, depois do coalesce, porque conversa de perfil desativado cai para quem
  -- o setor indica e só então se sabe de quem ela é. Com `p_de_quem` nulo (a
  -- chamada de admin/gestor/sdr, desde 28/09/2026) o OR inteiro some e o CTE
  -- passa a ser a varredura de todas as conversas vivas — é este o custo que o
  -- cabeçalho manda vigiar.
  candidatas as materialized (
    select c.id, c.assignee_id, c.setor_id, c.organization_id, c.contact_id,
           c.peer_phone_e164, c.deal_id,
           c.last_inbound_at, c.last_outbound_at, c.window_expires_at
      from public.conversations c
     where c.last_inbound_at is not null
       and c.status <> 'resolvida'
       and (c.snoozed_until is null or c.snoozed_until <= now())
       -- CONCLUÍDA SAI DAQUI, só na Imova (03/11/2026): quem concluiu disse "não
       -- há o que fazer". Se o contato escrever, o gatilho a traz de volta.
       and (c.arquivada_em is null or not (select app.concluir_ligado()))
       and (p_de_quem is null
            or c.assignee_id = p_de_quem
            or not exists (select 1 from public.profiles p
                            where p.id = c.assignee_id and p.is_active))
  )
  -- UMA LINHA POR FICHA, E AGORA POR FICHA DE VERDADE. Uma organização pode ter
  -- dois fios (dois telefones, ou WhatsApp e Instagram) e os dois devolvem o
  -- MESMO deal_id: sem o distinct on, a tela renderiza duas linhas idênticas com
  -- a mesma chave de React.
  --
  -- MUDOU EM 28/09/2026 (ADR-17): `de_quem` SAIU da chave. Enquanto a função só
  -- era chamada com filtro, deduplicar dentro de cada pessoa dava no mesmo —
  -- `de_quem` era constante. Sem filtro não é: dois fios da mesma ficha
  -- endereçados a pessoas diferentes voltariam a render duas linhas, que é
  -- exatamente o que o distinct on veio impedir. Fica a que espera há mais tempo.
  select distinct on (coalesce(q.organization_id, q.conversation_id))
         q.conversation_id, q.de_quem, q.organization_id, q.deal_id, q.desde, q.janela_expira_em
    from (
      select c.id as conversation_id,
             -- DE QUEM É O ITEM. Nada é escrito: é o assignee_id que a conversa
             -- JÁ tem (o "Atendendo" da tela de Conversas), com o mesmo coalesce
             -- que public.wa_enviar_modelo usa no nascimento. Perfil desativado
             -- cai para quem o setor indica — senão a conversa de quem saiu da
             -- empresa some, que é a 20261002150000 com outro nome.
             coalesce((select p.id from public.profiles p
                        where p.id = c.assignee_id and p.is_active),
                      sa.quem) as de_quem,
             c.organization_id,
             coalesce(c.deal_id, app.wa_negocio_da_ficha(c.organization_id)) as deal_id,
             c.last_inbound_at   as desde,
             c.window_expires_at as janela_expira_em
        from candidatas c
        left join quem_recebe sa on sa.setor_id = c.setor_id
       -- A ÚLTIMA PALAVRA É DO LEAD. As duas primeiras linhas respondem quase
       -- tudo e são baratas; o `not exists` só roda no caso ambíguo.
       --
       -- `<` ESTRITO, e é a trava que impede a pessoa de atropelar o robô: a
       -- introdução demora 8 a 14 s para SAIR, mas a linha dela nasce na mesma
       -- transação da entrada e app.messages_after_write grava last_outbound_at
       -- junto. Em teste os dois carimbos ficam iguais; em produção o carimbo da
       -- Meta é ANTERIOR. Nos dois casos a conversa fica de fora, que é a mesma
       -- leitura do `>=` da regra (2) de app.wa_introduzir.
       where (c.last_outbound_at is null
              or c.last_outbound_at < c.last_inbound_at
              or not exists (
                   select 1 from public.messages x
                    where x.conversation_id = c.id
                      and x.direction = 'out'::app.msg_direction
                      and x.status <> 'failed'::app.msg_status
                      and x.created_at >= c.last_inbound_at
                      -- A AUSÊNCIA NÃO É RESPOSTA: ela avisa que estamos fora do
                      -- horário e não cria tarefa nenhuma. Se contasse, quem
                      -- escreve às 21h40 sumia e ninguém o via de manhã. Os dois
                      -- coalesce com sentinelas DIFERENTES são necessários: sem
                      -- eles, num banco sem o modelo da ausência, texto livre de
                      -- gente (template_id nulo) deixaria de contar.
                      and coalesce(x.template_id, -1) <> coalesce(app.wa_modelo_ausencia(), -2)
                      -- MENSAGEM QUE NÃO SAIU NÃO RESPONDEU NINGUÉM. Com o
                      -- worker parado, contar o queued esconderia o lead PARA
                      -- SEMPRE. Os 15 min cobrem com folga os 8 a 14 s da
                      -- introdução.
                      and (x.status <> 'queued'::app.msg_status
                           or x.created_at > now() - interval '15 minutes')))
         -- SUPRESSÃO PELO TELEFONE, e não só pela ficha. app.is_suppressed_target
         -- devolve false quando organização e contato são nulos, que é exatamente
         -- a conversa de fora da base. Quem vê o número é wa_motivo_de_recusa.
         and app.wa_motivo_de_recusa(c.organization_id, c.contact_id, c.peer_phone_e164) is null
    ) q
   where p_de_quem is null or q.de_quem = p_de_quem
   order by coalesce(q.organization_id, q.conversation_id), q.desde
$$;
comment on function app.conversas_esperando_gente(uuid) is
  'As conversas em que a última palavra é do lead e ninguém falou desde então, com a pessoa a quem cada uma já está endereçada (conversations.assignee_id, ou quem o setor indica quando esse perfil foi desativado). UMA LINHA POR FICHA, e desde 28/09/2026 (ADR-17) a deduplicação é por ficha de verdade: de_quem saiu da chave do distinct on, porque sem p_de_quem dois fios da mesma ficha endereçados a pessoas diferentes voltariam a render duas linhas. É a definição ÚNICA de "respondeu e ninguém assumiu": public.meu_dia a usa — SEM filtro para admin, gestor e sdr, com filtro para o embaixador — e a tela de Conversas faz a mesma pergunta em TypeScript. NÃO pergunta por conversations.status, que não é mantido. A introdução automática não é atropelada porque a mensagem dela nasce junto com a entrada: a comparação é estrita. Não contam como resposta a ausência (GEN-SYS-AUSENCIA) nem a saída presa em queued há mais de 15 min. p_de_quem filtra ANTES das funções caras, porque definer não faz inline. Na Imova (03/11/2026, app.concluir_ligado), a conversa concluída fica de fora.';
-- GRANTS: os mesmos de 20261002180000 (`create or replace` os mantém); repetidos
-- para a migração se ler sozinha.
revoke all on function app.conversas_esperando_gente(uuid) from public, anon, authenticated;
grant execute on function app.conversas_esperando_gente(uuid) to service_role;
