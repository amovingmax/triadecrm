-- =====================================================================
-- As aberturas levam o nome de quem envia (RF-CON-01, RF-CON-12; ADR-06;
-- anexo R08 §2) — decisão de 14/09/2026
-- =====================================================================
--
-- Com o número só no CRM, o time inteiro manda pelo mesmo WhatsApp. Os modelos
-- foram escritos quando só a Heloísa mandava: "Aqui é a Heloísa, da Komune",
-- "Abraço, Heloísa (Komune)". Mandados pelo Matheus, apresentariam o Matheus
-- como Heloísa. Decisão do Matheus: o nome vira `{{atendente}}`, que
-- `public.wa_enviar_modelo` preenche SEMPRE com o primeiro nome de quem clicou.
--
-- É o único momento barato para isto: nenhum modelo foi à aprovação da Meta
-- (`meta_template_name` vazio nos 42). Depois de aprovado, cada troca de texto é
-- um modelo novo e mais uma espera.
--
-- MAIS DUAS CORREÇÕES, QUE A META COBRARIA DE QUALQUER JEITO
-- ---------------------------------------------------------------------------
-- · 21 modelos COMEÇAM com `{{nome}}` e 2 TERMINAM numa variável. A Meta recusa
--   variável na borda do texto; a sincronização do worker-wa marcaria os 22
--   como recusados sem nem mandar. Ganham "Oi, " na frente (e o que terminava
--   em `{{hora_tarde}}?` e em `{{data}}.` ganham uma frase depois).
-- · Três falavam no feminino da primeira pessoa ("deixa eu ser objetiva", "não
--   quero ser chata", "vou ser sincera"), que é errado para metade do time.
--   Viraram frases sem gênero.
--
-- As mensagens de SERVIÇO (roteiros de áudio da Heloísa, respostas a objeção,
-- textos de sistema) não mudam: não passam pela Meta, e os áudios são a voz
-- dela. A lista inteira de antes e depois está no CHANGELOG para a Bárbara.
--
-- A seed foi corrigida no mesmo commit, com a mesma lista de trocas: esta
-- migração conserta o banco que já existe, a seed faz o banco novo nascer certo.
-- =====================================================================

-- Trocas ancoradas num trecho exato de cada modelo. Rodar duas vezes não troca
-- nada: a troca só acontece onde o trecho antigo existe e o novo ainda não —
-- sem a segunda condição, "às {{hora_tarde}}?" continuaria casando depois de
-- virar "às {{hora_tarde}}? Me diz qual fica melhor.", e a frase dobraria.
update public.message_templates set body = replace(body, 'Aqui é a Heloísa, da Komune',
       'Aqui é {{atendente}}, da Komune')
 where template_code = 'AEB-ABR-A'
   and position('Aqui é a Heloísa, da Komune' in body) > 0 and position('Aqui é {{atendente}}, da Komune' in body) = 0;
update public.message_templates set body = replace(body, 'tudo bem? Heloísa, da Komune',
       'tudo bem? {{atendente}}, da Komune')
 where template_code = 'AEB-ABR-B'
   and position('tudo bem? Heloísa, da Komune' in body) > 0 and position('tudo bem? {{atendente}}, da Komune' in body) = 0;
update public.message_templates set body = replace(body, 'tudo bem? Heloísa, da Komune',
       'tudo bem? {{atendente}}, da Komune')
 where template_code = 'CER-ABR-A'
   and position('tudo bem? Heloísa, da Komune' in body) > 0 and position('tudo bem? {{atendente}}, da Komune' in body) = 0;
update public.message_templates set body = replace(body, 'tudo bem? Heloísa, da Komune',
       'tudo bem? {{atendente}}, da Komune')
 where template_code = 'CER-ABR-B'
   and position('tudo bem? Heloísa, da Komune' in body) > 0 and position('tudo bem? {{atendente}}, da Komune' in body) = 0;
update public.message_templates set body = replace(body, 'tudo bem? Heloísa, da Komune',
       'tudo bem? {{atendente}}, da Komune')
 where template_code = 'ESP-ABR-A'
   and position('tudo bem? Heloísa, da Komune' in body) > 0 and position('tudo bem? {{atendente}}, da Komune' in body) = 0;
update public.message_templates set body = replace(body, 'tudo bem? Heloísa, da Komune',
       'tudo bem? {{atendente}}, da Komune')
 where template_code = 'ESP-ABR-B'
   and position('tudo bem? Heloísa, da Komune' in body) > 0 and position('tudo bem? {{atendente}}, da Komune' in body) = 0;
update public.message_templates set body = replace(body, 'tudo bem? Heloísa, da Komune',
       'tudo bem? {{atendente}}, da Komune')
 where template_code = 'FOR-ABR-A'
   and position('tudo bem? Heloísa, da Komune' in body) > 0 and position('tudo bem? {{atendente}}, da Komune' in body) = 0;
update public.message_templates set body = replace(body, 'tudo bem? Heloísa, da Komune',
       'tudo bem? {{atendente}}, da Komune')
 where template_code = 'FOR-ABR-B'
   and position('tudo bem? Heloísa, da Komune' in body) > 0 and position('tudo bem? {{atendente}}, da Komune' in body) = 0;
update public.message_templates set body = replace(body, 'tudo bem? Heloísa, da Komune',
       'tudo bem? {{atendente}}, da Komune')
 where template_code = 'INF-ABR-A'
   and position('tudo bem? Heloísa, da Komune' in body) > 0 and position('tudo bem? {{atendente}}, da Komune' in body) = 0;
update public.message_templates set body = replace(body, 'tudo bem? Heloísa, da Komune',
       'tudo bem? {{atendente}}, da Komune')
 where template_code = 'INF-ABR-B'
   and position('tudo bem? Heloísa, da Komune' in body) > 0 and position('tudo bem? {{atendente}}, da Komune' in body) = 0;
update public.message_templates set body = replace(body, 'tudo bem? Heloísa, da Komune',
       'tudo bem? {{atendente}}, da Komune')
 where template_code = 'PRE-ABR-A'
   and position('tudo bem? Heloísa, da Komune' in body) > 0 and position('tudo bem? {{atendente}}, da Komune' in body) = 0;
update public.message_templates set body = replace(body, 'tudo bem? Heloísa, da Komune',
       'tudo bem? {{atendente}}, da Komune')
 where template_code = 'PRE-ABR-B'
   and position('tudo bem? Heloísa, da Komune' in body) > 0 and position('tudo bem? {{atendente}}, da Komune' in body) = 0;
update public.message_templates set body = replace(body, 'Abraço, Heloísa (Komune).',
       'Abraço, {{atendente}} (Komune).')
 where template_code = 'GEN-FUP-D3-V1'
   and position('Abraço, Heloísa (Komune).' in body) > 0 and position('Abraço, {{atendente}} (Komune).' in body) = 0;
update public.message_templates set body = replace(body, 'Aqui é a Heloísa, da Komune',
       'Aqui é {{atendente}}, da Komune')
 where template_code = 'GEN-FUP-LIG-V1'
   and position('Aqui é a Heloísa, da Komune' in body) > 0 and position('Aqui é {{atendente}}, da Komune' in body) = 0;
update public.message_templates set body = replace(body, 'Oi, {{nome}}, Heloísa da Komune.',
       'Oi, {{nome}}, aqui é {{atendente}}, da Komune.')
 where template_code = 'GEN-REA-60-V1'
   and position('Oi, {{nome}}, Heloísa da Komune.' in body) > 0 and position('Oi, {{nome}}, aqui é {{atendente}}, da Komune.' in body) = 0;
update public.message_templates set body = replace(body, '{{nome}}, deixa eu ser objetiva:',
       'Oi, {{nome}}, indo direto ao ponto:')
 where template_code = 'GEN-FUP-D3-V3'
   and position('{{nome}}, deixa eu ser objetiva:' in body) > 0 and position('Oi, {{nome}}, indo direto ao ponto:' in body) = 0;
update public.message_templates set body = replace(body, '{{nome}}, não quero ser chata,',
       'Oi, {{nome}}, não quero incomodar,')
 where template_code = 'GEN-ONB-D14'
   and position('{{nome}}, não quero ser chata,' in body) > 0 and position('Oi, {{nome}}, não quero incomodar,' in body) = 0;
update public.message_templates set body = replace(body, '{{nome}}, vou ser sincera:',
       'Oi, {{nome}}, sem rodeios:')
 where template_code = 'GEN-ONB-D7'
   and position('{{nome}}, vou ser sincera:' in body) > 0 and position('Oi, {{nome}}, sem rodeios:' in body) = 0;
update public.message_templates set body = replace(body, 'ou às {{hora_tarde}}?',
       'ou às {{hora_tarde}}? Me diz qual fica melhor.')
 where template_code = 'GEN-ONB-D1-NAO-ABRIU'
   and position('ou às {{hora_tarde}}?' in body) > 0 and position('ou às {{hora_tarde}}? Me diz qual fica melhor.' in body) = 0;
update public.message_templates set body = replace(body, 'reservado até {{data}}.',
       'reservado até {{data}}. Sucesso nos eventos!')
 where template_code = 'GEN-FUP-D14-V1'
   and position('reservado até {{data}}.' in body) > 0 and position('reservado até {{data}}. Sucesso nos eventos!' in body) = 0;

-- "{{nome}}, ..." no começo do corpo vira "Oi, {{nome}}, ...". Ancorado no
-- começo (`like '{{nome}}, %'`): rodar duas vezes não gera "Oi, Oi, ".
update public.message_templates
   set body = 'Oi, ' || body
 where template_code in ('GEN-AGD-1H-MEET', 'GEN-AGD-1H-VISITA', 'GEN-AGD-NOSHOW-2', 'GEN-FUP-D14-V1', 'GEN-FUP-D14-V2', 'GEN-FUP-D14-V3', 'GEN-FUP-D3-V2', 'GEN-ONB-D3', 'GEN-ONB-FEEDBACK-7D', 'GEN-ONB-FEEDBACK-POS-LEAD', 'GEN-ONB-LEAD-SEM-RESPOSTA', 'GEN-ONB-PARTICIPACAO-VIDEO', 'GEN-ONB-PRIMEIRO-LEAD', 'GEN-ONB-PUBLICADO', 'GEN-ONB-TRAVOU', 'GEN-REA-60-V2', 'GEN-REA-90-V1', 'PRE-LINK-V1')
   and body like '{{nome}}, %';

-- A lista de variáveis acompanha o corpo (a seed calcula igual).
update public.message_templates t
   set variables = coalesce((select jsonb_agg(d.v order by d.v)
                               from (select distinct m[1] as v
                                       from regexp_matches(t.body, '\{\{([a-z0-9_]+)\}\}', 'g') as m) d),
                            '[]'::jsonb)
 where t.channel = 'whatsapp'::app.channel
   and t.category in ('marketing', 'utility');

-- Se algum destes já tivesse nome na Meta, o texto aprovado não é mais este:
-- versão nova, e volta para a fila de aprovação.
update public.message_templates t
   set version = t.version + 1,
       meta_template_name = null,
       meta_status = 'pending',
       meta_status_raw = null,
       meta_rejection_reason = null,
       meta_template_id = null
 where t.meta_template_name is not null
   and t.template_code in (select r.codigo from (values ('AEB-ABR-A'), ('AEB-ABR-B'), ('CER-ABR-A'), ('CER-ABR-B'), ('ESP-ABR-A'), ('ESP-ABR-B'), ('FOR-ABR-A'), ('FOR-ABR-B'), ('GEN-AGD-1H-MEET'), ('GEN-AGD-1H-VISITA'), ('GEN-AGD-NOSHOW-2'), ('GEN-FUP-D14-V1'), ('GEN-FUP-D14-V2'), ('GEN-FUP-D14-V3'), ('GEN-FUP-D3-V1'), ('GEN-FUP-D3-V2'), ('GEN-FUP-D3-V3'), ('GEN-FUP-LIG-V1'), ('GEN-ONB-D1-NAO-ABRIU'), ('GEN-ONB-D14'), ('GEN-ONB-D3'), ('GEN-ONB-D7'), ('GEN-ONB-FEEDBACK-7D'), ('GEN-ONB-FEEDBACK-POS-LEAD'), ('GEN-ONB-LEAD-SEM-RESPOSTA'), ('GEN-ONB-PARTICIPACAO-VIDEO'), ('GEN-ONB-PRIMEIRO-LEAD'), ('GEN-ONB-PUBLICADO'), ('GEN-ONB-TRAVOU'), ('GEN-REA-60-V1'), ('GEN-REA-60-V2'), ('GEN-REA-90-V1'), ('INF-ABR-A'), ('INF-ABR-B'), ('PRE-ABR-A'), ('PRE-ABR-B'), ('PRE-LINK-V1')) r(codigo));

-- Barulho no lugar do silêncio: modelo que vai à Meta não pode citar a Heloísa,
-- nem começar ou terminar em variável.
do $$
declare
  v_heloisa int;
  v_borda   int;
begin
  select count(*) into v_heloisa
    from public.message_templates
   where is_active and channel = 'whatsapp'::app.channel
     and category in ('marketing', 'utility') and body ilike '%heloísa%';
  select count(*) into v_borda
    from public.message_templates
   where is_active and channel = 'whatsapp'::app.channel
     and category in ('marketing', 'utility')
     and (body ~ '^[[:space:][:punct:]]*\{\{' or body ~ '\}\}[[:space:][:punct:]]*$');
  if v_heloisa > 0 or v_borda > 0 then
    raise exception 'modelos da Meta ainda com Heloísa (%) ou variável na borda (%)', v_heloisa, v_borda;
  end if;
end $$;
