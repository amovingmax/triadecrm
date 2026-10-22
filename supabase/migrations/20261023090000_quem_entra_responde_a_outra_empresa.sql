-- =====================================================================
-- O botão de trocar de empresa aparece sozinho (decisão do usuário, 22/10/2026)
--
-- "Se a conta tiver acesso aos dois ambientes, o switch account deve sempre
-- aparecer e fazer a troca para o outro ambiente." Até aqui o botão dependia de
-- o admin marcar "Também acessa" em CADA empresa (20261022110000); marcada só
-- de um lado, a pessoa ia e não conseguia voltar.
--
-- Agora o servidor de uma empresa pergunta ao servidor da outra "este e-mail
-- entra aí?" (`/api/empresas/acesso`, pedido assinado com um segredo que só os
-- dois sites têm). Quem responde é esta função, no banco de quem é perguntado.
-- Nenhum site toca no banco do outro: cada um consulta só o seu.
--
-- A regra é a do próprio login, para o botão nunca prometer uma porta fechada:
--   - quem já entrou alguma vez (tem conta em auth.users) entra se o perfil
--     existe e está ativo, que é o que `custom_access_token_hook` confere;
--     fora da lista de permitidos continua entrando, como no login;
--   - quem nunca entrou entra se o e-mail está na lista de permitidos ou é de
--     um domínio permitido e aberto, que é o que `handle_new_auth_user` confere.
--
-- Só `service_role` executa: a rota confere a assinatura antes e chama com a
-- chave de serviço. Ninguém logado pergunta por e-mail alheio.
--
-- `acesso_a_outras_empresas` e `minhas_outras_empresas()` ficam, sem uso pelo
-- site: tirar tabela é o segundo tempo, depois de esta versão estar no ar nas
-- duas empresas.
--
-- Só acrescenta: função nova, nada existente muda.
-- =====================================================================

create or replace function public.email_entra_no_crm(p_email text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  -- Comparação por lower(), como no gatilho: com search_path vazio o = do citext não é resolvido.
  v_email text := lower(trim(coalesce(p_email, '')));
begin
  if v_email = '' or position('@' in v_email) = 0 then
    return false;
  end if;

  if exists (select 1 from auth.users u where lower(u.email) = v_email) then
    return exists (
      select 1
        from auth.users u
        join public.profiles p on p.id = u.id
       where lower(u.email) = v_email
         and p.is_active
    );
  end if;

  return exists (select 1 from public.allowed_users au where lower(au.email::text) = v_email)
      or exists (select 1 from public.allowed_domains ad
                  where ad.is_active
                    and lower(ad.domain::text) = split_part(v_email, '@', 2));
end $$;
comment on function public.email_entra_no_crm(text) is
  'Este e-mail consegue entrar no CRM desta empresa? Mesma regra do login (gatilho de auth.users e hook do token). Responde à outra empresa, pela rota /api/empresas/acesso, para o botão de trocar aparecer sozinho.';
revoke all on function public.email_entra_no_crm(text) from public, anon, authenticated;
grant execute on function public.email_entra_no_crm(text) to service_role;
