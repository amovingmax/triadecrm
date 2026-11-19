-- =====================================================================
-- Ligar e desligar a coleta de mercado pela tela, com o login do dono
-- (só Imova, 19/11/2026)
--
-- A chave da coleta (`app_settings['mercado']`, `{"ligado": false}`) nasceu na
-- 20261119160000 e, até aqui, só mudava por SQL. Esta migração dá a porta da
-- tela (Ajustes → Inteligência de mercado): `public.mercado_coleta_ligar`.
--
--   * Só admin e gestor (`app.admin_ou_gestor()`); os outros recebem 42501.
--   * Só na Imova: em qualquer outro banco (a KOMUNE, ou um banco ainda sem
--     identidade) devolve `{"ok": false, "motivo": "so_imova"}` e não grava
--     nada. Na KOMUNE a chave já é lida como desligada de qualquer jeito
--     (`app.mercado_config()`); a recusa é para a tela não fingir que ligou.
--   * Motivo obrigatório, com 5 caracteres ou mais (o mesmo piso de
--     `public.mercado_fonte_liberar`): `motivo_obrigatorio`.
--   * Grava `ligado` na chave, junto com quem mudou, quando e o motivo
--     (`mudou_por`, `mudou_em`, `motivo`), para a tela dizer "Ligada por X em
--     DD/MM". As outras chaves do valor ficam como estão.
--   * O antes e o depois vão para o `audit_log` (tabela `app_settings`, linha
--     `mercado`), como em `mercado_fonte_liberar`. O gatilho `audit_app_settings`
--     continua gravando a linha inteira, como em toda mudança de `app_settings`;
--     a linha desta função é a que tem o motivo.
--   * Pedir o que já está valendo (ligar o que já está ligado) não grava nada e
--     devolve `{"ok": true, "mudou": false}`: duas pessoas com a tela aberta não
--     apagam o motivo uma da outra.
--
-- Ligar não coleta nada na hora: o pg_cron de segunda e quinta às 6h
-- (`mercado_coleta_seg_qui`) só enfileira com a chave ligada, e só as fontes que
-- podem ser coletadas (liberadas, não PROIBIDAS, sem reconferência). Desligar
-- para na hora: o worker não abre coleta e o banco recusa gravar com a chave
-- desligada; o que já foi gravado fica.
--
-- COMO DESFAZER (em qualquer banco):
--   drop function if exists public.mercado_coleta_ligar(boolean, text);
--   -- e, se a coleta tiver sido ligada pela tela, desligar à mão:
--   update public.app_settings set value = value || '{"ligado": false}'::jsonb
--    where key = 'mercado';
-- =====================================================================

create or replace function public.mercado_coleta_ligar(p_ligar boolean, p_motivo text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ligar  boolean := coalesce(p_ligar, false);
  v_motivo text := left(btrim(coalesce(p_motivo, '')), 1000);
  v_antes  jsonb;
  v_depois jsonb;
  v_estava boolean;
begin
  if not app.admin_ou_gestor() then
    raise exception 'Só admin e gestor ligam ou desligam a coleta de mercado.' using errcode = '42501';
  end if;
  -- `is distinct from`: banco sem identidade também recusa (a coleta é só da Imova).
  if public.empresa_do_banco() is distinct from 'imova' then
    return jsonb_build_object('ok', false, 'motivo', 'so_imova');
  end if;
  if char_length(v_motivo) < 5 then
    return jsonb_build_object('ok', false, 'motivo', 'motivo_obrigatorio');
  end if;

  -- A chave nasce na 20261119160000; se alguém a apagou, volta aqui.
  insert into public.app_settings (key, value, description)
  values ('mercado', '{"ligado": false}'::jsonb,
          'Inteligência de mercado (só Imova, 18/11/2026). ligado: o worker grava e a IA lê as vantagens aprovadas. O teto da renovação automática fica na régua com versão (mercado_regras), não aqui. Na KOMUNE fica sempre desligada.')
  on conflict (key) do nothing;

  select s.value into v_antes from public.app_settings s where s.key = 'mercado' for update;
  if v_antes is null or jsonb_typeof(v_antes) <> 'object' then
    v_antes := '{}'::jsonb;
  end if;
  -- Só o texto "true" liga (a mesma régua de `app.mercado_ligado()`).
  v_estava := coalesce(v_antes ->> 'ligado', 'false') = 'true';

  if v_estava = v_ligar then
    return jsonb_build_object('ok', true, 'mudou', false, 'ligado', v_ligar,
                              'ligado_de_fato', app.mercado_ligado());
  end if;

  v_depois := v_antes || jsonb_build_object('ligado', v_ligar, 'mudou_por', auth.uid(),
                                            'mudou_em', now(), 'motivo', v_motivo);
  update public.app_settings set value = v_depois where key = 'mercado';

  -- Decisão do dono fica no audit_log (CLAUDE.md), com o antes e o depois.
  insert into public.audit_log (actor_id, actor_role, action, table_name, row_id, old_data, new_data)
  values (auth.uid(), app.role()::text, 'UPDATE', 'app_settings', 'mercado',
          jsonb_build_object('ligado', v_estava, 'mudou_por', v_antes -> 'mudou_por',
                             'mudou_em', v_antes -> 'mudou_em', 'motivo', v_antes -> 'motivo'),
          jsonb_build_object('ligado', v_ligar, 'mudou_por', auth.uid(), 'motivo', v_motivo));

  return jsonb_build_object('ok', true, 'mudou', true, 'ligado', v_ligar,
                            'ligado_de_fato', app.mercado_ligado());
end $$;
comment on function public.mercado_coleta_ligar(boolean, text) is
  'Admin e gestor ligam ou desligam a coleta de mercado (app_settings mercado.ligado), com motivo de 5 caracteres ou mais; o antes e o depois vão para o audit_log. Só na Imova: em outro banco devolve ok false, so_imova, sem gravar.';
revoke all on function public.mercado_coleta_ligar(boolean, text) from public, anon;
grant execute on function public.mercado_coleta_ligar(boolean, text) to authenticated;
