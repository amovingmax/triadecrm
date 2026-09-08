-- =====================================================================
-- O LINK DO PRÉ-CADASTRO SAI DO CÓDIGO (RF-PRE-07, RF-PRE-08)
--
-- Decisão de produto de 08/09/2026 (Matheus): o fornecedor captado **não passa
-- por uma página do Tríade**. O link leva direto ao cadastro que a Komune já
-- tem — `/seja-parceiro`, com o wizard de conta, CNPJ e segmentos, construído,
-- testado e em produção. Criar um caminho paralelo aqui seria manter dois
-- fluxos para a mesma coisa, e o segundo nasceria sem uso.
--
-- Três coisas estavam erradas, e as três são a mesma coisa mal resolvida:
--
--   1. `gerar_link_de_reivindicacao` devolvia `https://parceiros.komune.app/c/…`
--      FIXO no corpo da função, e esse domínio nunca existiu.
--   2. A tela ignorava esse `url` e montava `window.location.origin + /c/token`
--      por conta própria. Dois lugares construindo o mesmo endereço, e nenhum
--      deles sabendo o certo.
--   3. Ninguém podia corrigir isso sem uma migração nova.
--
-- Agora o endereço é UMA linha de `app_settings`, com `{token}` onde o token
-- entra. Apontar para outro lugar — do komune-dev para a Komune de produção, no
-- dia em que a captação começar — passa a ser um UPDATE.
--
-- ── POR QUE A CHECAGEM VEM ANTES DE ESCREVER ─────────────────────────
--
-- Gerar um link REVOGA o anterior (`claim_token_version`, `claim_link_revoked`).
-- Se a função descobrisse só no fim que não sabe o endereço, teria queimado o
-- token que já estava no celular do fornecedor para nada — trocando um problema
-- de configuração por um problema com uma pessoa. Então a pergunta entra junto
-- com os outros guardrails, no topo, antes do primeiro `update`.
--
-- ── NASCE DESLIGADO, DE PROPÓSITO ────────────────────────────────────
--
-- `modelo` nasce NULO, e sem ele a função recusa com `endereco_nao_configurado`.
-- Não chuto o domínio: `komune.app.br` aparece no código do admin, mas em que
-- endereço o `/seja-parceiro` é servido é decisão de quem cuida do DNS. Um
-- palpite aqui viraria link quebrado na mão de um fornecedor real, e link
-- quebrado é pior que botão desabilitado — o segundo se explica, o primeiro não.
-- =====================================================================

insert into public.app_settings (key, value, description) values
  ('precadastro.link',
   jsonb_build_object('modelo', null),
   'Endereço para onde o link de reivindicação aponta. Use {token} onde o token entra — ex.: https://komune.app.br/seja-parceiro?pre={token}. NULO = a emissão de link fica recusada com "endereco_nao_configurado", de propósito: melhor botão que não funciona do que link que não abre.')
on conflict (key) do nothing;

create or replace function public.gerar_link_de_reivindicacao(p_organization_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid   uuid := auth.uid();
  v_papel app.user_role := app.role();
  pr      public.pre_registrations%rowtype;
  v_tok   text;
  v_exp   timestamptz := now() + interval '7 days';
  v_modelo text;
begin
  if v_uid is null then
    raise exception 'Usuário não autenticado' using errcode = '42501';
  end if;
  if not app.can_write() or not app.org_is_visible(p_organization_id) then
    return jsonb_build_object('ok', false, 'motivo', 'sem_permissao');
  end if;
  if app.is_suppressed_target(p_organization_id, null) then
    return jsonb_build_object('ok', false, 'motivo', 'contato_suprimido');
  end if;
  -- O guardrail do CLAUDE.md: nada de pré-cadastro na Komune sem autorização
  -- registrada em consent_events. O link É o pré-cadastro chegando na pessoa.
  if not app.tem_autorizacao_vigente(p_organization_id) then
    return jsonb_build_object('ok', false, 'motivo', 'sem_autorizacao');
  end if;

  -- Para onde o link aponta é CONFIGURAÇÃO, não código (era fixo no corpo desta
  -- função, apontando para um domínio que nunca existiu). E a pergunta vem aqui,
  -- ANTES de escrever qualquer coisa, porque gerar um link REVOGA o anterior:
  -- descobrir que não sabemos o endereço depois de queimar o token do fornecedor
  -- seria trocar um problema de configuração por um problema com uma pessoa.
  select nullif(btrim(coalesce(s.value ->> 'modelo', '')), '')
    into v_modelo
    from public.app_settings s
   where s.key = 'precadastro.link';
  if v_modelo is null or position('{token}' in v_modelo) = 0 then
    return jsonb_build_object('ok', false, 'motivo', 'endereco_nao_configurado');
  end if;

  select * into pr from public.pre_registrations where organization_id = p_organization_id;
  if not found then
    return jsonb_build_object('ok', false, 'motivo', 'sem_pre_cadastro');
  end if;
  if pr.purged_at is not null or pr.refused_at is not null then
    return jsonb_build_object('ok', false, 'motivo', 'rascunho_encerrado');
  end if;
  if pr.claimed_at is not null then
    return jsonb_build_object('ok', false, 'motivo', 'ja_reivindicado');
  end if;

  -- 32 bytes de aleatoriedade, guardados só como sha256. Reenvio invalida o
  -- anterior por construção: só existe UM hash por rascunho (RF-PRE-07).
  v_tok := encode(extensions.gen_random_bytes(32), 'hex');

  update public.pre_registrations
     set claim_token_hash       = app.sha256_hex(v_tok),
         claim_token_issued_at  = now(),
         claim_token_expires_at = v_exp,
         claim_token_version    = claim_token_version + 1,
         claim_link_sent_at     = now(),
         claim_link_opened_at   = null,
         status                 = 'link_sent'::app.prereg_status
   where id = pr.id;

  if pr.claim_token_hash is not null then
    insert into public.pre_registration_events
      (pre_registration_id, organization_id, event, payload, actor, actor_id)
    values (pr.id, p_organization_id, 'claim_link_revoked',
            jsonb_build_object('versao_anterior', pr.claim_token_version), 'cs', v_uid);
  end if;

  insert into public.pre_registration_events
    (pre_registration_id, organization_id, event, payload, actor, actor_id)
  values (pr.id, p_organization_id, 'claim_link_sent',
          jsonb_build_object('expira_em', v_exp, 'versao', pr.claim_token_version + 1), 'cs', v_uid);

  -- Gerar o link é revelar um caminho de acesso ao rascunho: auditado como tal.
  insert into public.audit_log (actor_id, actor_role, action, table_name, row_id, new_data)
  values (v_uid, v_papel::text, 'GERAR_CLAIM_LINK', 'pre_registrations', pr.id::text,
          jsonb_build_object('organizacao', p_organization_id, 'expira_em', v_exp));

  return jsonb_build_object('ok', true, 'token', v_tok,
                            'url', replace(v_modelo, '{token}', v_tok),
                            'expira_em', v_exp,
                            'versao', pr.claim_token_version + 1);
end $$;

comment on function public.gerar_link_de_reivindicacao(uuid) is
  'Emite (e revoga a anterior) a versão do link de reivindicação, RF-PRE-07. O endereço vem de app_settings[precadastro.link].modelo, com {token} onde o token entra — nunca do corpo desta função. Sem endereço configurado, recusa com "endereco_nao_configurado" ANTES de revogar o link vigente. Exige autorização em consent_events: o link É o pré-cadastro chegando na pessoa.';

notify pgrst, 'reload schema';
