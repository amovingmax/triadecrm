-- =====================================================================
-- As chaves da voz em Ajustes
--
-- Pedido de 13/10/2026: ligar e desligar a telefonia pelo navegador e o aviso
-- de ligação não atendida sem escrever SQL. Até aqui as duas chaves só mudavam
-- por `update` em `app_settings` (pendência de 06/10 e de 13/10 no CHANGELOG).
--
-- O QUE ESTA MIGRAÇÃO NÃO MUDA: quem pode ligar. Ligar é de todo mundo que
-- trabalha no CRM — admin, gestor e SDR (`app.can_write()`), no lote e na
-- ficha. As chaves daqui decidem POR ONDE a ligação sai (navegador ou
-- aparelho) e se o aviso no WhatsApp acompanha; nenhuma delas tira a ligação
-- de ninguém. Com a telefonia desligada, o "Ligar do aparelho" continua.
--
-- Mexer nas chaves é da gestão (admin e gestor), como o resto de Ajustes.
--
-- RF-ADM-02, RF-CON-18
-- =====================================================================

create or replace function public.voz_configurar(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tel  jsonb;
  v_avi  jsonb;
begin
  if auth.uid() is null or not app.is_manager() then
    return jsonb_build_object('ok', false, 'motivo', 'sem_permissao');
  end if;
  if p ? 'telefonia_ativa' and jsonb_typeof(p -> 'telefonia_ativa') <> 'boolean' then
    return jsonb_build_object('ok', false, 'motivo', 'valor_invalido', 'campo', 'telefonia_ativa');
  end if;
  if p ? 'aviso_ativo' and jsonb_typeof(p -> 'aviso_ativo') <> 'boolean' then
    return jsonb_build_object('ok', false, 'motivo', 'valor_invalido', 'campo', 'aviso_ativo');
  end if;

  -- `insert ... on conflict`, e não `update`: num banco em que a linha ainda não
  -- existe, a chave ligada na tela tem de ficar ligada, e não sumir em silêncio.
  if p ? 'telefonia_ativa' then
    insert into public.app_settings (key, value, description, updated_by)
    values ('voz.telefonia', jsonb_build_object('ativa', p -> 'telefonia_ativa'),
            'Ligação pelo navegador (Twilio). Liga e desliga em Ajustes → Ligações.', auth.uid())
    on conflict (key) do update
      set value = public.app_settings.value || excluded.value, updated_by = auth.uid();
  end if;
  if p ? 'aviso_ativo' then
    insert into public.app_settings (key, value, description, updated_by)
    values ('voz.aviso_nao_atendeu', jsonb_build_object('ativo', p -> 'aviso_ativo'),
            'Aviso no WhatsApp para quem não atendeu a ligação. Liga e desliga em Ajustes → Ligações.',
            auth.uid())
    on conflict (key) do update
      set value = public.app_settings.value || excluded.value, updated_by = auth.uid();
  end if;

  select s.value into v_tel from public.app_settings s where s.key = 'voz.telefonia';
  select s.value into v_avi from public.app_settings s where s.key = 'voz.aviso_nao_atendeu';
  return jsonb_build_object(
    'ok', true,
    'telefonia_ativa', coalesce((v_tel ->> 'ativa')::boolean, false),
    'aviso_ativo',     coalesce((v_avi ->> 'ativo')::boolean, false));
end $$;

comment on function public.voz_configurar(jsonb) is
  'Ajustes → Ligações: liga e desliga a ligação pelo navegador (voz.telefonia.ativa) e o aviso no WhatsApp para quem não atendeu (voz.aviso_nao_atendeu.ativo). Só admin e gestor. Não muda quem pode ligar: isso continua sendo de admin, gestor e SDR.';
revoke all on function public.voz_configurar(jsonb) from public, anon;
grant execute on function public.voz_configurar(jsonb) to authenticated;

notify pgrst, 'reload schema';
