-- =====================================================================
-- No treino, a IA não para ao passar para um corretor — só na Imova (06/11/2026)
--
-- O que o ensaio com o Haiku 5.5 mostrou: na conversa do treino, o Janio faz
-- o papel de cliente. Quando ele pede desconto ou corretor, a IA avisa que vai
-- passar e PARA naquela conversa, como deve parar com um cliente de verdade. No
-- treino isso trava a semana: a instrução seguinte ("IA, anota: ...") não é
-- lida, e alguém precisa religar a IA a cada simulação. Também troca o
-- responsável da conversa e abre uma tarefa "A IA passou o cliente para você"
-- por uma conversa que é de mentira.
--
-- O QUE MUDA: na conversa do treino, `public.ia_atendente_passar` manda o aviso
-- (o Janio vê exatamente o que o cliente veria) e registra a passagem em
-- `ia_respostas`, mas a IA continua atendendo, o responsável não muda e não
-- nasce tarefa. Com cliente de verdade, nada muda.
--
-- Na KOMUNE não faz nada: a IA que atende não existe lá.
--
-- COMO DESFAZER: reaplicar `public.ia_atendente_passar` da 20261106170000.
-- =====================================================================

do $treino$
begin
  if (select i.empresa from app.identidade i) = 'komune' then
    raise notice 'A IA que atende é só da Imova: no banco da KOMUNE nada mudou.';
    return;
  end if;

  execute $ddl$
create or replace function public.ia_atendente_passar(
  p_conversation_id uuid, p_em_resposta_a uuid, p_texto text, p_motivo text,
  p_ai_run_id bigint default null, p_prompt_version text default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_texto text := coalesce(nullif(btrim(coalesce(p_texto, '')), ''),
                           app.ia_atendente_config() ->> 'aviso_corretor');
  v_disse jsonb;
  v_para  uuid;
begin
  v_disse := app.ia_atendente_dizer(p_conversation_id, p_em_resposta_a, v_texto, 'passou_para_pessoa',
                                    jsonb_build_object('motivo', left(coalesce(p_motivo, ''), 300)),
                                    p_ai_run_id, p_prompt_version);
  -- Chegou mensagem nova: a próxima rodada decide de novo (pode ser outra coisa).
  if v_disse ->> 'motivo' in ('chegou_mensagem_nova', 'ja_respondida', 'conversa_nao_existe') then
    return v_disse;
  end if;
  -- No treino, passar é simulação: o aviso sai, e a IA continua ali.
  if p_conversation_id is not distinct from app.ia_conversa_de_treino() then
    return v_disse || jsonb_build_object('passada_para', null, 'treino', true);
  end if;
  -- Disse ou não (porteira, teto), a conversa vai para gente.
  if app.ia_atende(p_conversation_id) or coalesce((v_disse ->> 'ok')::boolean, false) then
    v_para := app.ia_atendente_entregar(p_conversation_id, p_motivo);
  end if;
  return v_disse || jsonb_build_object('passada_para', v_para);
end $$;
comment on function public.ia_atendente_passar(uuid, uuid, text, text, bigint, text) is
  'Porta do worker de IA: a IA avisa o cliente que vai passar (texto dela ou o aviso padrão) e entrega a conversa a uma pessoa, com tarefa para agora. Na conversa do treino (desde 06/11/2026) o aviso sai e a IA continua atendendo, sem trocar o responsável nem abrir tarefa.';
revoke all on function public.ia_atendente_passar(uuid, uuid, text, text, bigint, text) from public, anon, authenticated;
grant execute on function public.ia_atendente_passar(uuid, uuid, text, text, bigint, text) to service_role;
  $ddl$;
end $treino$;
