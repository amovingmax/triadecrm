-- =====================================================================
-- A introdução: o robô abre a conversa, e só abre
-- =====================================================================
-- POR QUE AGORA. Rafael recusou o desenho da IA conversando em 28/09/2026:
-- "Achei as respostas muito ruins. Os contatos iniciais eu achei bom, mas o
-- desenvolver e a tag com conteúdo por IA, eu não quero que isso aconteça."
-- O que sobrevive é o começo. A campanha manda o cumprimento ("Bom dia!") e,
-- se o lead responder QUALQUER coisa, uma segunda mensagem — a introdução —
-- sai sozinha, dentro da janela de 24 h, em texto fixo e SEM NOME. Dali em
-- diante quem fala é gente, sempre (ADR-16, emenda de 28/09/2026).
--
-- O BURACO QUE ISTO TAPA. Desde 22/09 a campanha abre com o cumprimento solto
-- (20260922160000). Isso é uma saída na conversa, então `app.wa_bot_de_entrada`
-- marca `bot_estado = 'conversa_humana'` (20260916110000) e nunca manda o menu.
-- Quem responde "Bom dia!" hoje fica MUDO até alguém abrir a caixa — e é o
-- nosso maior volume.
--
-- SEM NOME É ESTRUTURAL, NÃO É DISCIPLINA. A introdução sai por
-- `app.wa_bot_dizer` (20260916110000), que insere `bot_fixed` com `template_id`
-- copiando o corpo cru. `app.messages_nome_do_atendente` (20260921110000) pula
-- exatamente essas duas condições, então nenhum "*Fulano:*" entra na frente. E
-- corpo cru quer dizer: NENHUMA VARIÁVEL. Um `{{nome}}` sairia literal no fio.
--
-- O QUE MUDA NA PORTEIRA: NADA, e o `app.messages_guard` NÃO É TOCADO aqui.
-- `app.pode_enviar` passo 2 (20260925170000) devolve `pode=true` para resposta
-- dentro da janela de 24 h. MAS os passos 1 e 1.5 vêm ANTES do 2 e continuam
-- valendo: contato suprimido, `conta_banida` e `meta_restringiu_entrada`
-- recusam a introdução como recusam qualquer coisa. Quando isso acontece o
-- guarda levanta exceção, o bloco `exception` do gatilho desfaz a subtransação
-- inteira (inclusive o carimbo de `introducao_em`), e a introdução é tentada de
-- novo na próxima entrada do lead. É o comportamento certo, e está escrito
-- porque não é óbvio.
--
-- O ÚNICO FREIO NOVO que a alcança é o teto de fala do robô (20260925180000),
-- e numa conversa em que o robô nunca falou isso é 1 de 6.
--
-- DENTRO DO HORÁRIO, E SÓ. Decisão consciente: `app.ausencia_responder`
-- (20260922120000) se cala diante de QUALQUER saída com
-- `created_at >= m.created_at`. Se a introdução saísse fora do horário, ela não
-- conviveria com a ausência — ela a CANCELARIA, e o lead que escreve 22h40 de
-- domingo receberia "posso te explicar em dois minutos?" sem ninguém para
-- responder. Enquanto o Rafael não decidir o contrário, a introdução respeita
-- `app.janela_do_canal` e fora dele quem fala é a ausência.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. O modelo
-- ---------------------------------------------------------------------
-- TRÊS DECISÕES DE TEXTO, e nenhuma é estilo:
--   (1) NÃO diz "sem mensalidade". `packages/prompts/src/nucleo/base-conhecimento.ts`
--       registra em 08/09/2026 que a frase é FALSA (existe taxa mensal do
--       escrow, em revisão). O texto abaixo é o fato `taxa` da base, palavra
--       por palavra.
--   (2) "8%" e "komune.app.br" estão em VALORES_AUTORIZADOS e URLS_PERMITIDAS.
--   (3) A ORIGEM É GENÉRICA porque o corpo é copiado CRU: nomear a fonte por
--       ficha exigiria variável. Quem perguntar "onde pegou meu número?" recebe
--       GEN-SYS-QUEM-SOMOS, que tem {{origem}}, {{source_url}}, a base legal e
--       o e-mail do encarregado, e que é mandada POR GENTE (R06 C.3).
insert into public.message_templates (template_code, name, channel, category, segment, kind,
                                      language, body, variables, is_active, version)
values ('GEN-SYS-INTRO', 'Introdução automática (2ª mensagem)', 'whatsapp', 'service', 'GEN',
        'sistema', 'pt_BR',
'Oi! Aqui é da Komune, o aplicativo de eventos de Natal: quem vai dar uma festa monta o evento e contrata os fornecedores da cidade num lugar só.
Encontrei o contato do seu negócio numa busca pública de fornecedores de eventos aqui de Natal, e queria te convidar para a nossa rede de fornecedores fundadores — sem adesão, sem fidelidade e sem multa: a Komune fica com 8% só do evento que você fechar pela plataforma.
Posso te explicar em dois minutos como funciona?
Se não for o momento, é só responder SAIR que a gente não te procura mais. Como usamos seus dados: komune.app.br/privacidade',
        '[]'::jsonb, true, 1)
on conflict (template_code) do nothing;

-- ---------------------------------------------------------------------
-- 2. A chave que desliga sem deploy
-- ---------------------------------------------------------------------
-- Lida por `app.atendimento_liga('introducao_ativa')` (20260922120000), que
-- devolve `false` para chave ausente — por isso a chave TEM de existir, senão o
-- gestor não consegue ligá-la pela tela. `app.app_settings_validate` só
-- constrange `cadencia.tetos` e `ia.orcamento`, então a chave nova entra livre.
update public.app_settings
   set value = value || case when value ? 'introducao_ativa' then '{}'::jsonb
                             else '{"introducao_ativa": true}'::jsonb end
 where key = 'atendimento';

-- ---------------------------------------------------------------------
-- 3. As duas leituras
-- ---------------------------------------------------------------------
-- Os cumprimentos, sem filtro de `is_active` de propósito: um cumprimento
-- desativado amanhã tem de continuar sendo RECONHECIDO na conversa que ele
-- abriu ontem. Reconhecer não é enviar.
create or replace function app.wa_modelos_de_cumprimento()
returns int[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(t.id), '{}'::int[])
    from public.message_templates t
   where t.channel = 'whatsapp'::app.channel
     and t.template_code in ('GEN-ABR-OLA-MANHA', 'GEN-ABR-OLA-TARDE', 'GEN-ABR-OLA-NOITE')
$$;
comment on function app.wa_modelos_de_cumprimento() is
  'Os ids dos três cumprimentos da campanha (GEN-ABR-OLA-*). Sem filtro de is_active: reconhecer um cumprimento antigo na conversa que ele abriu não é enviá-lo de novo.';
revoke all on function app.wa_modelos_de_cumprimento() from public, anon;
grant execute on function app.wa_modelos_de_cumprimento() to authenticated, service_role;

-- No molde de `app.wa_modelo_humano` (20260925180000).
create or replace function app.wa_modelo_introducao()
returns int
language sql
stable
security definer
set search_path = ''
as $$
  select t.id from public.message_templates t
   where t.template_code = 'GEN-SYS-INTRO' and t.is_active
     and t.channel = 'whatsapp'::app.channel
$$;
comment on function app.wa_modelo_introducao() is
  'O id do modelo da introdução automática (ADR-16), ou null quando o gestor a desativa pelo catálogo.';
revoke all on function app.wa_modelo_introducao() from public, anon;
grant execute on function app.wa_modelo_introducao() to authenticated, service_role;

-- ---------------------------------------------------------------------
-- 4. A trava de uma por conversa
-- ---------------------------------------------------------------------
alter table public.conversations add column if not exists introducao_em timestamptz;
comment on column public.conversations.introducao_em is
  'Quando a introdução automática saiu nesta conversa (ADR-16). Uma por conversa, para sempre: o `where introducao_em is null` do update é a tranca que serializa duas entradas no mesmo instante.';
