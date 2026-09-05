-- ===========================================================================
-- 20260904001802 — O pré-cadastro nascendo da ficha (RF-PRE-03, RF-PRE-05)
-- ===========================================================================
-- A 20260904001700 entregou o rascunho, o link, a página pública e a retenção.
-- Faltou o começo: QUEM monta o `prefilled`. Hoje `criar_pre_cadastro` recebe o
-- jsonb pronto de quem chama, o que joga duas responsabilidades para a tela:
--
--   1. compor a whitelist do RF-PRE-03 no navegador — que é onde ela mais
--      facilmente sai do lugar quando alguém acrescenta um campo à ficha;
--   2. LER O TELEFONE para escrevê-lo no rascunho. E o telefone que a ficha
--      tem em mãos é o de `organizations_view`, ou seja, MASCARADO para `sdr` e
--      `embaixador` (RF-BAS-14). O rascunho nasceria com "+55 84 9****-**12",
--      ou — pior — a tela precisaria revelar o número (e gravar em
--      `pii_access_log`) só para montar um rascunho.
--
-- Este arquivo move a composição para o Postgres, que é onde ela pertence
-- (ADR-03), e resolve o telefone pelo caminho mais curto: ELE NÃO ENTRA.
-- Ver a nota em `app.prefill_da_organizacao`.
--
-- Nada aqui redefine função de outro arquivo. São duas funções novas.
-- Idempotente: `create or replace` nas duas.
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- A. O prefill factual, montado no banco
-- ---------------------------------------------------------------------------
-- Só o factual do RF-PRE-03, e só o que a coleta pode olhar (CLAUDE.md, R03):
-- nome, categoria, cidade, bairro, site e @instagram. Nunca foto, texto de
-- terceiro, avaliação, faixa de preço copiada ou descrição — `description` fica
-- de fora de propósito, mesmo estando na whitelist do `app.prefilled_ok`: o que
-- está na ficha veio de fonte pública e é texto de outra pessoa.
--
-- TELEFONE. `telefone_comercial` está na whitelist e mesmo assim não entra.
-- Três motivos, na ordem em que pesam:
--   (a) `pre_registrations.prefilled` é lido por `pre_cadastro_do_parceiro`
--       com `org_is_visible`, sem máscara e sem `pii_access_log`. Copiar o
--       número para lá abriria um segundo caminho de leitura do telefone que
--       escapa do RF-BAS-14;
--   (b) o rascunho é a PRÉVIA DO PERFIL na Komune, e a página de reivindicação
--       (que é pública, só protegida pelo token) mostra `prefilled` inteiro.
--       Telefone ali é dado a mais numa superfície sem login;
--   (c) não serve para nada: quem abre o link é o dono do número.
-- Se algum dia o perfil precisar do telefone comercial, ele é digitado pelo
-- fornecedor no cadastro da Komune, que é onde o consentimento já existe.
create or replace function app.prefill_da_organizacao(p_organization_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_strip_nulls(jsonb_build_object(
           'nome_exibicao', nullif(trim(o.name), ''),
           'categorias',    (select jsonb_agg(c.name order by oc.is_primary desc, c.name)
                               from public.organization_categories oc
                               join public.categories c on c.id = oc.category_id
                              where oc.organization_id = o.id),
           'cidade',        (select ci.name from public.cities ci where ci.id = o.city_id),
           'bairro',        nullif(trim(coalesce(o.neighborhood, '')), ''),
           'instagram',     nullif(trim(coalesce(o.instagram_handle, '')), ''),
           'site',          nullif(trim(coalesce(o.website, '')), '')))
    from public.organizations o
   where o.id = p_organization_id and o.deleted_at is null
$$;
comment on function app.prefill_da_organizacao(uuid) is
  'Monta o `prefilled` do rascunho a partir da ficha: só o factual do RF-PRE-03 e só o que a coleta pode olhar (R03). Sem foto, sem descrição, sem avaliação e SEM TELEFONE — ver o cabeçalho da migração 20260904001802.';

revoke all on function app.prefill_da_organizacao(uuid) from public, anon, authenticated;
grant execute on function app.prefill_da_organizacao(uuid) to service_role;


-- ---------------------------------------------------------------------------
-- B. Criar o rascunho a partir da ficha
-- ---------------------------------------------------------------------------
-- Um envelope fino em volta de `public.criar_pre_cadastro`: monta o prefill, a
-- proveniência (nome da fonte e link de origem, exigidos pelo PRE-04 e pelo
-- RF-BAS-10) e a contagem de fotos, que é ZERO por definição — a coleta não
-- copia foto, e a página de reivindicação diz isso ao fornecedor com todas as
-- letras. Toda a validação (permissão, supressão, whitelist, evento no log)
-- continua acontecendo lá dentro, uma vez só.
create or replace function public.criar_pre_cadastro_da_ficha(p_organization_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_prefill jsonb;
  v_fonte   text;
  v_url     text;
begin
  if auth.uid() is null then
    raise exception 'Usuário não autenticado' using errcode = '42501';
  end if;
  if not app.can_write() or not app.org_is_visible(p_organization_id) then
    return jsonb_build_object('ok', false, 'motivo', 'sem_permissao');
  end if;

  select app.prefill_da_organizacao(o.id), s.name, o.source_url
    into v_prefill, v_fonte, v_url
    from public.organizations o
    left join public.sources s on s.id = o.source_id
   where o.id = p_organization_id and o.deleted_at is null;

  if v_prefill is null then
    return jsonb_build_object('ok', false, 'motivo', 'organizacao_inexistente');
  end if;
  -- Rascunho sem nome não é prévia de perfil nenhum.
  if not (v_prefill ? 'nome_exibicao') then
    return jsonb_build_object('ok', false, 'motivo', 'ficha_sem_nome');
  end if;

  return public.criar_pre_cadastro(p_organization_id, v_prefill, v_fonte, v_url, 0);
end $$;
comment on function public.criar_pre_cadastro_da_ficha(uuid) is
  'Cria (ou atualiza) o rascunho da ficha aberta, RF-PRE-05. O `prefilled` é montado no banco por app.prefill_da_organizacao — a tela não escolhe campo e não lê telefone. `photos_found_count` é 0 porque a coleta não copia foto (R03).';

revoke all on function public.criar_pre_cadastro_da_ficha(uuid) from public, anon;
grant execute on function public.criar_pre_cadastro_da_ficha(uuid) to authenticated;
