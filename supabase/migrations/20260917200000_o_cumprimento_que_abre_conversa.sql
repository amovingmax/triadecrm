-- =====================================================================
-- Um cumprimento curto para abrir conversa, sem um campo para preencher
--
-- =====================================================================
-- O QUE O RAFAEL PEDIU, E POR QUE A TELA ESTAVA ERRADA
-- =====================================================================
-- "Quero mensagens soltas, começar apenas com boa tarde, bom dia — pra prender
-- a atenção — e depois que eu souber que estou falando com o responsável, aí sim
-- mando o que quero."
--
-- A tela oferecia a moldura `GEN-ABR-LIVRE`, que é isto:
--
--   "Oi, {{nome}}! Aqui é {{atendente}}, da Komune, o aplicativo de eventos de
--    Natal. {{mensagem}} Se não for o momento, é só responder SAIR que eu não
--    escrevo mais. Como usamos seus dados: komune.app.br/privacidade"
--
-- Três problemas de uma vez: pede o NOME de alguém que a base não conhece, exige
-- um discurso inteiro antes de a pessoa dizer se é a responsável, e enterra o
-- "boa tarde" no meio de um parágrafo de 240 caracteres.
--
-- =====================================================================
-- O QUE A META OBRIGA, E O QUE SOMOS NÓS
-- =====================================================================
-- A Meta obriga uma coisa só: fora da janela de 24 h, o texto tem de vir de um
-- modelo APROVADO. Ela não exige tamanho, nem SAIR, nem link de privacidade.
--
-- O resto é regra nossa (R06 §2, RF-CON-12): a primeira mensagem de prospecção
-- se identifica e oferece saída. Este modelo mantém a identificação — "aqui é
-- Matheus, da Komune" — e NÃO carrega o SAIR nem o link. Essa parte é decisão
-- do Dennis (LGPD), e está registrada como pendência no CHANGELOG. O modelo
-- nasce e vai à Meta; usá-lo ou não é escolha de quem opera.
--
-- =====================================================================
-- DUAS TRAVAS QUE O CORPO TEVE DE RESPEITAR
-- =====================================================================
-- 1. **A Meta recusa modelo que COMEÇA com variável.** O texto natural seria
--    "{{saudacao}}! Aqui é...", e ele nunca seria aprovado. Por isso o "Oi!"
--    fixo na frente: ele não é enfeite, é o que torna o modelo submissível.
--    (Quem pegou isso foi o teste 43, antes de a Meta pegar.)
-- 2. **O SAIR e o link de privacidade continuam** porque são regra NOSSA
--    (RF-CON-12, R06 §2), com um teste guardando — e mexer nela é decisão do
--    Dennis, não minha nem de quem opera. O que dá para fazer sem essa decisão é
--    o que está feito: encurtar de 240 para 190 caracteres, tirar o nome do
--    parceiro da frente e não pedir campo nenhum.
--
-- =====================================================================
-- ZERO CAMPO PARA PREENCHER — É ISSO QUE O FAZ DIFERENTE
-- =====================================================================
-- As duas variáveis são preenchidas pelo servidor:
--   · `{{atendente}}` já era o primeiro nome de quem clica (ninguém digita, ou
--     seria alguém se apresentando como outra pessoa do time);
--   · `{{saudacao}}` passa a vir do RELÓGIO de Natal — "Bom dia" até 11h59,
--     "Boa tarde" até 17h59, "Boa noite" depois. Um campo para escolher entre
--     três palavras que o relógio já sabe é trabalho que o CRM inventa.
-- =====================================================================

insert into public.message_templates
  (template_code, name, channel, category, segment, kind, variant, meta_template_name,
   meta_status, language, body, is_active)
values
  ('GEN-ABR-CUMPRIMENTO',
   'Cumprimento curto (abre conversa)',
   'whatsapp', 'marketing', null, 'abertura', 'A', 'gen_abr_cumprimento_v1',
   'pending', 'pt_BR',
   'Oi! {{saudacao}}, aqui é {{atendente}}, da Komune — o aplicativo de eventos de Natal. Falo com a pessoa responsável? Se preferir não receber, responda SAIR. Privacidade: komune.app.br/privacidade',
   true)
on conflict (template_code) do nothing;


-- ---------------------------------------------------------------------------
-- A saudação pelo relógio de Natal
-- ---------------------------------------------------------------------------
create or replace function app.saudacao_do_momento(p_quando timestamptz default now())
returns text
language sql
stable
set search_path = ''
as $$
  select case
           when extract(hour from p_quando at time zone 'America/Fortaleza') < 12 then 'Bom dia'
           when extract(hour from p_quando at time zone 'America/Fortaleza') < 18 then 'Boa tarde'
           else 'Boa noite'
         end
$$;

comment on function app.saudacao_do_momento(timestamptz) is
  'Bom dia / Boa tarde / Boa noite pelo relógio de America/Fortaleza. Preenche {{saudacao}} nos modelos: escolher entre três palavras que o relógio já sabe é trabalho que o CRM não deve inventar.';

revoke all on function app.saudacao_do_momento(timestamptz) from public, anon, authenticated;
