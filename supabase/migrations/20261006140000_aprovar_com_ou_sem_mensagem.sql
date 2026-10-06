-- =====================================================================
-- Aprovar com mensagem, ou só aprovar
--
-- Pivô de 06/10/2026. A Revisão ganha dois botões, e cada um é um caminho:
--
--   revisão → aprovar COM mensagem automática → Conversas → esperar o lead responder
--   revisão → SÓ aprovar → Prospectados → Lotes → montar o lote → ligar
--
-- "A ideia de aprovar em revisão e enviar a mensagem automática vai continuar
-- existindo, com um botão próprio pra isso; o outro botão vai apenas levar os
-- aprovados para a listagem."
--
-- ===========================================================================
-- O QUE MUDA NO BOM-DIA
-- ===========================================================================
-- Até aqui ele saía SOZINHO: com a chave `cumprimento_automatico` ligada, toda
-- ficha nascida do Google Maps entrava na fila, quisesse quem aprovou ou não
-- (`app.organizations_cumprimento`, 20261002210000). Agora entra na fila só
-- quando quem aprovou PEDIU, pelo botão.
--
-- O pedido viaja como um aviso que só existe dentro da transação
-- (`app.cumprimento_pedido`), ligado pelas duas funções novas e lido pelo
-- gatilho. Assim a aprovação e o enfileiramento continuam sendo UMA transação —
-- não existe "aprovou e a mensagem se perdeu no caminho" —, e nenhuma das
-- funções de aprovação existentes precisou ser reescrita.
--
-- Duas consequências, e as duas são de propósito:
--   · sem pedido, ninguém recebe: importação, cadastro rápido e "Virar parceiro"
--     deixam de enfileirar por conta própria;
--   · com pedido, a ORIGEM deixa de ser pergunta. O filtro "veio do Google?"
--     existia para o envio automático não escolher sozinho quem procurar; quando
--     é uma pessoa que escolhe, ficha a ficha, a pergunta já foi respondida.
--
-- O que NÃO muda: a chave `cumprimento_automatico` continua sendo o disjuntor
-- geral (desligada, nada entra na fila, com ou sem botão); o ritmo
-- (`cumprimento_por_hora`), o horário, o teto do dia, a supressão e o "não
-- contatar" continuam decidindo se e quando cada mensagem sai. A fila é a mesma
-- de antes (`envios_em_massa`, o lote contínuo): a tela de Campanhas saiu do
-- menu, a máquina por baixo fica.
--
-- RF-CON-02, RF-CON-11, RF-RAD-11
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1 · O gatilho passa a perguntar "alguém pediu?"
-- ---------------------------------------------------------------------
create or replace function app.organizations_cumprimento()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_lote uuid;
begin
  -- Só quando quem aprovou pediu a mensagem, pelo botão (06/10/2026).
  if coalesce(current_setting('app.cumprimento_pedido', true), '') <> 'sim' then
    return new;
  end if;
  if not app.atendimento_liga('cumprimento_automatico') then
    return new;
  end if;
  if new.deleted_at is not null or new.do_not_contact then
    return new;
  end if;

  v_lote := app.cumprimento_lote();
  if v_lote is null then
    return new;
  end if;

  insert into public.envios_em_massa_itens (envio_id, posicao, organization_id, assinante_id)
  select v_lote,
         coalesce((select max(i.posicao) from public.envios_em_massa_itens i
                    where i.envio_id = v_lote), 0) + 1,
         new.id, null
  on conflict (envio_id, organization_id) do nothing;

  return new;
end $$;
comment on function app.organizations_cumprimento() is
  'A ficha nova entra na fila do cumprimento automático SÓ quando quem aprovou pediu, pelo botão "aprovar e mandar mensagem" da Revisão (06/10/2026): o pedido chega pelo aviso de transação app.cumprimento_pedido, ligado por public.radar_revisar_candidato_com_mensagem e public.radar_revisar_lote_com_mensagem. A chave app_settings.atendimento.cumprimento_automatico continua sendo o disjuntor geral. Antes desta data a ficha do Google Maps entrava sozinha.';

-- Quantas fichas estão na fila do cumprimento. É a diferença deste número,
-- antes e depois de aprovar, que diz à tela quantas mensagens entraram.
create or replace function app.cumprimento_na_fila()
returns int
language sql
stable
security definer
set search_path = ''
as $$
  select count(*)::int
    from public.envios_em_massa_itens i
    join public.envios_em_massa e on e.id = i.envio_id
   where e.continuo
$$;
revoke all on function app.cumprimento_na_fila() from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 2 · Aprovar um, com mensagem
-- ---------------------------------------------------------------------
-- Mesmos argumentos que a tela já manda para `public.radar_revisar_candidato`,
-- e o MESMO caminho por dentro: esta função só liga o pedido em volta dele.
create or replace function public.radar_revisar_candidato_com_mensagem(
  p_candidate_id    uuid,
  p_acao            text,
  p_organization_id uuid    default null,
  p_category_id     integer default null,
  p_reason          text    default null,
  p_aprender_agora  boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_res   jsonb;
  v_antes int;
begin
  -- A mensagem é de quem cuida da base. (A aprovação simples ainda aceita
  -- qualquer papel que escreve; a trava dela é outra migração.)
  if auth.uid() is null or not app.is_manager() then
    return jsonb_build_object('ok', false, 'reason', 'sem_permissao');
  end if;
  -- Mensagem só existe ao aprovar. Mesclar, recusar e "não contatar" não mandam nada.
  if p_acao is distinct from 'aprovar' then
    return jsonb_build_object('ok', false, 'reason', 'acao_invalida');
  end if;

  v_antes := app.cumprimento_na_fila();
  perform set_config('app.cumprimento_pedido', 'sim', true);
  v_res := public.radar_revisar_candidato(p_candidate_id, p_acao, p_organization_id,
                                          p_category_id, p_reason, p_aprender_agora);
  perform set_config('app.cumprimento_pedido', '', true);

  return v_res || jsonb_build_object('mensagem', jsonb_build_object(
    'ligada',  app.atendimento_liga('cumprimento_automatico'),
    'na_fila', app.cumprimento_na_fila() - v_antes));
end $$;
comment on function public.radar_revisar_candidato_com_mensagem(uuid, text, uuid, integer, text, boolean) is
  'O botão "aprovar e mandar mensagem" da Revisão (06/10/2026): aprova pelo mesmo caminho de public.radar_revisar_candidato e põe a ficha na fila do cumprimento automático, na mesma transação. Só admin e gestor. Devolve o resultado da aprovação mais mensagem {ligada, na_fila}: ligada = a chave geral do cumprimento está ligada; na_fila = quantas fichas entraram na fila agora (conta também as irmãs aprovadas junto). na_fila = 0 com ligada = true quer dizer que a fila não aceitou: lote pausado, modelo ausente ou ficha marcada como não contatar.';
revoke all on function public.radar_revisar_candidato_com_mensagem(uuid, text, uuid, integer, text, boolean) from public, anon;
grant execute on function public.radar_revisar_candidato_com_mensagem(uuid, text, uuid, integer, text, boolean) to authenticated;

-- ---------------------------------------------------------------------
-- 3 · Aprovar em lote, com mensagem
-- ---------------------------------------------------------------------
create or replace function public.radar_revisar_lote_com_mensagem(
  p_ids         uuid[],
  p_category_id integer default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_res   jsonb;
  v_antes int;
begin
  if auth.uid() is null or not app.is_manager() then
    return jsonb_build_object('ok', false, 'reason', 'sem_permissao');
  end if;

  v_antes := app.cumprimento_na_fila();
  perform set_config('app.cumprimento_pedido', 'sim', true);
  v_res := public.radar_revisar_lote(p_ids, p_category_id);
  perform set_config('app.cumprimento_pedido', '', true);

  return v_res || jsonb_build_object('mensagem', jsonb_build_object(
    'ligada',  app.atendimento_liga('cumprimento_automatico'),
    'na_fila', app.cumprimento_na_fila() - v_antes));
end $$;
comment on function public.radar_revisar_lote_com_mensagem(uuid[], integer) is
  'O botão "aprovar e mandar mensagem" da barra de lote da Revisão (06/10/2026): aprova pelo mesmo caminho de public.radar_revisar_lote e põe as fichas na fila do cumprimento automático, na mesma transação. Só admin e gestor. Devolve o resultado do lote mais mensagem {ligada, na_fila}. As mensagens não saem juntas: saem no ritmo de cumprimento_por_hora, dentro do horário e do teto do dia.';
revoke all on function public.radar_revisar_lote_com_mensagem(uuid[], integer) from public, anon;
grant execute on function public.radar_revisar_lote_com_mensagem(uuid[], integer) to authenticated;

notify pgrst, 'reload schema';
