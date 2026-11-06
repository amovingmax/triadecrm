-- =====================================================================
-- A IA que atende passa a usar o Claude Haiku 5.5 — só na Imova (06/11/2026)
--
-- Pedido do usuário, no dia em que a IA foi publicada: "Preciso que mude o
-- modelo da IA para o haiku 5.5 para economizarmos mais, e ainda termos um
-- treinamento de qualidade."
--
-- O Haiku 5.5 custa US$ 0,10 / US$ 0,50 por milhão de tokens (entrada /
-- saída), 40 vezes menos que o Opus 5.5 (US$ 4 / US$ 20). O preço já está em
-- `ai_model_prices` desde a 20261104110000 (a leitura do cliente usa o mesmo
-- modelo). O caderno e os imóveis continuam no bloco de sistema com cache, e o
-- prompt é o mesmo (`atendente-imova@v1`): muda só quem responde.
--
-- O QUE MUDA:
--   1. `public.ia_atendente_configurar` aceita 'claude-haiku-5-5' (a tela
--      oferece os três: Haiku, Sonnet e Opus 5.5).
--   2. O modelo de hoje em `ia.atendente` vira o Haiku 5.5. É uma troca única:
--      daqui em diante, quem escolhe é a tela.
--
-- Na KOMUNE não faz nada: a IA que atende não existe lá.
--
-- COMO DESFAZER: reaplicar `public.ia_atendente_configurar` da 20261106170000 e
--   update public.app_settings set value = value || '{"modelo": "claude-opus-5-5"}'
--    where key = 'ia.atendente';
-- =====================================================================

do $haiku$
begin
  if (select i.empresa from app.identidade i) = 'komune' then
    raise notice 'A IA que atende é só da Imova: no banco da KOMUNE nada mudou.';
    return;
  end if;

  execute $ddl$
create or replace function public.ia_atendente_configurar(p_valores jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_atual  jsonb := coalesce((select s.value from public.app_settings s where s.key = 'ia.atendente'), '{}'::jsonb);
  v_novo   jsonb := v_atual;
  v_chave  text;
  v_valor  jsonb;
  v_treino uuid;
begin
  if auth.uid() is null or not app.admin_ou_gestor() then
    return jsonb_build_object('ok', false, 'motivo', 'sem_permissao');
  end if;
  for v_chave, v_valor in select * from jsonb_each(coalesce(p_valores, '{}'::jsonb)) loop
    case v_chave
      when 'ligada' then
        if jsonb_typeof(v_valor) <> 'boolean' then
          return jsonb_build_object('ok', false, 'motivo', 'ligada_nao_e_sim_ou_nao');
        end if;
        if (v_valor)::text::boolean and not coalesce((v_atual ->> 'ligada')::boolean, false) then
          v_novo := v_novo || jsonb_build_object('ligada_em', now());
        end if;
      when 'modo' then
        if v_valor #>> '{}' not in ('treino', 'clientes') then
          return jsonb_build_object('ok', false, 'motivo', 'modo_invalido');
        end if;
      when 'conversa_de_treino' then
        if jsonb_typeof(v_valor) <> 'null' then
          v_treino := app.uuid_seguro(v_valor #>> '{}');
          if v_treino is null or not exists (select 1 from public.conversations c where c.id = v_treino) then
            return jsonb_build_object('ok', false, 'motivo', 'conversa_inexistente');
          end if;
        end if;
      when 'setor_corretores' then
        if jsonb_typeof(v_valor) <> 'null'
           and not exists (select 1 from public.setores s where s.id = (v_valor #>> '{}')::int) then
          return jsonb_build_object('ok', false, 'motivo', 'setor_inexistente');
        end if;
      when 'assinatura' then
        if char_length(coalesce(v_valor #>> '{}', '')) > 40 then
          return jsonb_build_object('ok', false, 'motivo', 'assinatura_longa');
        end if;
      when 'aviso_corretor' then
        if char_length(btrim(coalesce(v_valor #>> '{}', ''))) not between 10 and 400 then
          return jsonb_build_object('ok', false, 'motivo', 'aviso_fora_do_tamanho');
        end if;
      when 'modelo' then
        if v_valor #>> '{}' not in ('claude-haiku-5-5', 'claude-sonnet-5-5', 'claude-opus-5-5') then
          return jsonb_build_object('ok', false, 'motivo', 'modelo_invalido');
        end if;
      when 'esforco' then
        if v_valor #>> '{}' not in ('low', 'medium', 'high') then
          return jsonb_build_object('ok', false, 'motivo', 'esforco_invalido');
        end if;
      when 'espera_seg' then
        if jsonb_typeof(v_valor) <> 'number' or (v_valor)::text::numeric not between 5 and 300 then
          return jsonb_build_object('ok', false, 'motivo', 'espera_fora_do_limite');
        end if;
      when 'teto_por_hora' then
        if jsonb_typeof(v_valor) <> 'number' or (v_valor)::text::numeric not between 1 and 60 then
          return jsonb_build_object('ok', false, 'motivo', 'teto_fora_do_limite');
        end if;
      else
        return jsonb_build_object('ok', false, 'motivo', 'chave_desconhecida', 'chave', v_chave);
    end case;
    v_novo := v_novo || jsonb_build_object(v_chave, v_valor);
  end loop;

  insert into public.app_settings (key, value, description)
  values ('ia.atendente', v_novo,
          'A IA que atende o cliente sozinha (Imova, 06/11/2026). Mudada pela tela (public.ia_atendente_configurar).')
  on conflict (key) do update set value = excluded.value;

  -- A conversa do treino nasce com a IA ligada nela (o time já tinha falado
  -- com o Janio; sem isso, "gente escreveu" a deixaria parada).
  if v_treino is not null then
    perform app.ia_atendente_mudar(v_treino, 'atendendo', 'conversa do treino', auth.uid(), null);
  end if;
  return jsonb_build_object('ok', true, 'config', app.ia_atendente_config());
end $$;
revoke all on function public.ia_atendente_configurar(jsonb) from public, anon;
grant execute on function public.ia_atendente_configurar(jsonb) to authenticated;
  $ddl$;

  update public.app_settings
     set value = value || jsonb_build_object('modelo', 'claude-haiku-5-5'),
         description = replace(description, 'modelo: claude-opus-5-5 ou claude-sonnet-5-5.',
                               'modelo: claude-haiku-5-5 (desde 06/11/2026), claude-sonnet-5-5 ou claude-opus-5-5.')
   where key = 'ia.atendente';
end $haiku$;
