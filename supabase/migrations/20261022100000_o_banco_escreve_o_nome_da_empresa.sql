-- ===========================================================================
-- TRÍADE — o banco escreve o nome da empresa dele (22/10/2026; plano multiempresa)
--
-- Os textos que o PRÓPRIO banco escreve para fora — hoje, o arquivo da LGPD que
-- o titular recebe (`app.lgpd_dossie`) — diziam "KOMUNE" e
-- "privacidade@komune.app.br" escritos à mão. No banco da Imova, o controlador
-- dos dados é a Imova Imobiliária, e não há "Plataforma Komune" com quem
-- compartilhar nada: o arquivo não pode dizer o contrário.
--
-- `app.empresa_texto(chave)` devolve o texto da empresa deste banco, lido de
-- `app_settings['empresa']` (o seed da empresa grava). SEM essa linha devolve
-- exatamente o que estava escrito antes — 'KOMUNE', 'privacidade@komune.app.br',
-- 'Plataforma Komune' —, então no banco da KOMUNE, que não tem a linha, o
-- arquivo da LGPD sai idêntico. Chave presente com valor nulo (a `plataforma` da
-- Imova) é nulo de propósito: o item some da lista de compartilhamento.
--
-- `app.lgpd_dossie` é a definição em vigor (pg_get_functiondef), com quatro
-- trocas: controlador, canal do titular, o item da plataforma e o e-mail no
-- texto dos direitos. Comentário e permissões são mantidos pelo `create or replace`.
--
-- Fora daqui, de propósito: as mensagens do login (`handle_new_auth_user`,
-- `custom_access_token_hook`, "KOMUNE CRM") — ficam no caminho de todo login e
-- não chegam à tela —, e os textos dos relatórios sobre a plataforma Komune.
--
-- Idempotente: pode ser reaplicada.
--
-- COMO DESFAZER: reaplicar `app.lgpd_dossie` de 20260904001810_integracao_komune.sql
-- e `drop function if exists app.empresa_texto(text);`.
-- ===========================================================================

create or replace function app.empresa_texto(p_chave text)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v jsonb;
begin
  select s.value into v from public.app_settings s where s.key = 'empresa';
  if v is not null and v ? p_chave then
    return v ->> p_chave;
  end if;
  return case p_chave
           when 'nome'              then 'Komune'
           when 'nome_maiusculo'    then 'KOMUNE'
           when 'controlador'       then 'KOMUNE'
           when 'email_privacidade' then 'privacidade@komune.app.br'
           when 'plataforma'        then 'Plataforma Komune'
         end;
end $$;
comment on function app.empresa_texto(text) is
  'Texto da empresa deste banco (app_settings[''empresa'']); sem a linha, os textos que a KOMUNE já usava.';
revoke all on function app.empresa_texto(text) from public, anon, authenticated;

CREATE OR REPLACE FUNCTION app.lgpd_dossie(p_organization_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  o public.organizations%rowtype;
begin
  select * into o from public.organizations where id = p_organization_id;
  if not found then
    return jsonb_build_object('ok', false, 'motivo', 'organizacao_inexistente');
  end if;

  return jsonb_build_object(
    'ok', true,
    'gerado_em', now(),
    'controlador', jsonb_build_object(
      'nome', app.empresa_texto('controlador'),
      'produto', 'Triade — CRM de captação',
      'canal_do_titular', app.empresa_texto('email_privacidade'),
      'base_legal', 'Legítimo interesse (LGPD art. 7º, IX) sobre dados profissionais públicos (art. 7º, §§3º e 4º)'),
    'organizacao', jsonb_build_object(
      'id', o.id, 'nome', o.name, 'tipo', o.kind, 'razao_social', o.legal_name,
      'cnpj', o.cnpj, 'telefone', o.phone_e164, 'email', o.email,
      'instagram', o.instagram_handle, 'site', o.website,
      'bairro', o.neighborhood, 'endereco', o.address,
      'coletado_em', o.collected_at, 'coletado_por', o.collector,
      'link_de_origem', o.source_url,
      'nao_contatar', o.do_not_contact, 'temperatura', o.temperature,
      'criado_em', o.created_at, 'anonimizado_em', o.anonymized_at),
    'fonte_da_coleta', (select jsonb_build_object('id', s.id, 'nome', s.name)
                          from public.sources s where s.id = o.source_id),
    -- A proveniência é o coração do direito de acesso: cada campo, com a URL
    -- exata de onde veio, quando, por qual ferramenta e sob qual base legal.
    'proveniencia', coalesce((
      select jsonb_agg(jsonb_build_object(
               'campo', fp.field, 'acao', fp.action, 'link_de_origem', fp.source_url,
               'fonte', (select s2.name from public.sources s2 where s2.id = fp.source_id),
               'coletado_em', fp.collected_at, 'coletor', fp.collector,
               'ferramenta', fp.tool, 'base_legal', fp.legal_basis, 'versao_lia', fp.lia_version)
               order by fp.collected_at, fp.id)
        from public.field_provenance fp
       where fp.record_type = 'organization' and fp.record_id = o.id), '[]'::jsonb),
    'contatos', coalesce((
      select jsonb_agg(jsonb_build_object('nome', c.full_name, 'cargo', c.role_title,
                                          'telefone', c.phone_e164, 'email', c.email,
                                          'nao_contatar', c.do_not_contact)
               order by c.created_at)
        from public.contacts c
        join public.organization_contacts oc on oc.contact_id = c.id
       where oc.organization_id = o.id), '[]'::jsonb),
    'consentimentos', coalesce((
      select jsonb_agg(jsonb_build_object('tipo', ce.kind, 'canal', ce.channel,
                                          'quando', ce.occurred_at, 'evidencia', ce.evidence_text)
               order by ce.occurred_at)
        from public.consent_events ce where ce.organization_id = o.id), '[]'::jsonb),
    'interacoes', coalesce((
      select jsonb_agg(jsonb_build_object('tipo', a.type, 'quando', a.occurred_at,
                                          'canal', a.channel, 'resumo', a.body)
               order by a.occurred_at)
        from public.activities a where a.organization_id = o.id), '[]'::jsonb),
    'pre_cadastro', (
      select jsonb_build_object('status', pr.status, 'publicado', pr.published,
                                'rascunho', pr.prefilled, 'origem', pr.source_label,
                                'link_de_origem', pr.source_url,
                                'criado_em', pr.created_at, 'expira_em', pr.expires_at,
                                'reivindicado_em', pr.claimed_at, 'apagado_em', pr.purged_at)
        from public.pre_registrations pr where pr.organization_id = o.id),
    'compartilhado_com', jsonb_build_array(
      jsonb_build_object('quem', 'Meta (WhatsApp Business Cloud API)',
                         'o_que', 'Número de telefone e conteúdo das mensagens trocadas',
                         'quando', 'Somente se houve conversa por WhatsApp'),
      jsonb_build_object('quem', 'Supabase (nuvem, região São Paulo)',
                         'o_que', 'Hospedagem do banco de dados', 'quando', 'Sempre'),
      jsonb_build_object('quem', 'Anthropic (Claude)',
                         'o_que', 'Texto das mensagens pseudonimizado, para classificação e rascunho',
                         'quando', 'Somente se houve conversa'))
      || case when app.empresa_texto('plataforma') is null then '[]'::jsonb
              else jsonb_build_array(
                     jsonb_build_object('quem', app.empresa_texto('plataforma'),
                                        'o_que', 'Perfil pré-preenchido do marketplace',
                                        'quando', 'Somente após autorização registrada')) end,
    'retencao', 'Lead sem resposta é anonimizado em 6 meses. Rascunho não reivindicado é apagado em 30 dias. Registros de acesso ficam 12 meses (Marco Civil art. 15).',
    'direitos', 'Você pode pedir correção, eliminação, oposição e portabilidade a qualquer momento, respondendo SAIR no WhatsApp ou escrevendo para ' || app.empresa_texto('email_privacidade') || '.');
end $function$

;
