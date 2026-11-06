-- =====================================================================
-- Procurar a conversa do treino sem tropeçar no acento — só na Imova (06/11/2026)
--
-- O usuário, logo depois de ligar a IA em produção: "Não consegui encontrar essa
-- conversa do treino". A busca da tela (IA que atende → Configuração) olhava só
-- o nome do contato no WhatsApp, com `ilike`: "Jânio" não acha "Janio", e o nome
-- da ficha não entrava.
--
-- O QUE ENTRA: `public.ia_procurar_conversas(termo)`, para admin, gestor e SDR
-- (`app.is_manager()`): procura sem acento e sem maiúscula no nome do contato
-- e no nome da ficha, e pelos dígitos do telefone (4 ou mais). Devolve até 8
-- conversas de WhatsApp, as mais recentes primeiro, com o telefone mascarado
-- para quem escolhe saber qual é qual.
--
-- Na KOMUNE não faz nada: a IA que atende não existe lá.
--
-- COMO DESFAZER: drop function public.ia_procurar_conversas(text);
-- =====================================================================

do $procurar$
begin
  if (select i.empresa from app.identidade i) = 'komune' then
    raise notice 'A IA que atende é só da Imova: no banco da KOMUNE nada foi criado.';
    return;
  end if;

  execute $ddl$
create or replace function public.ia_procurar_conversas(p_termo text)
returns table (id uuid, nome text, telefone text)
language sql
stable
security definer
set search_path = ''
as $$
  with t as (
    select lower(extensions.unaccent(replace(replace(btrim(coalesce(p_termo, '')), '%', ''), '_', ''))) as texto,
           regexp_replace(coalesce(p_termo, ''), '\D', '', 'g') as digitos
  )
  select c.id,
         coalesce(nullif(btrim(o.name), ''), nullif(btrim(c.peer_nome), ''), 'Sem nome') as nome,
         app.mask_phone(c.peer_phone_e164) as telefone
    from t, public.conversations c
    left join public.organizations o on o.id = c.organization_id
   where app.is_manager()
     and c.channel = 'whatsapp'::app.channel
     and char_length(t.texto) >= 2
     and (lower(extensions.unaccent(coalesce(c.peer_nome, ''))) like '%' || t.texto || '%'
          or lower(extensions.unaccent(coalesce(o.name, ''))) like '%' || t.texto || '%'
          or (char_length(t.digitos) >= 4 and c.peer_phone_e164 like '%' || t.digitos || '%'))
   order by c.last_message_at desc nulls last
   limit 8
$$;
comment on function public.ia_procurar_conversas(text) is
  'A busca da conversa do treino na tela da IA que atende (Imova, 06/11/2026): sem acento e sem maiúscula, no nome do contato e no da ficha, ou pelos dígitos do telefone. Telefone volta mascarado.';
revoke all on function public.ia_procurar_conversas(text) from public, anon;
grant execute on function public.ia_procurar_conversas(text) to authenticated;
  $ddl$;
end $procurar$;
