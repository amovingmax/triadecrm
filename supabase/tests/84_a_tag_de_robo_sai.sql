-- =====================================================================
-- pgTAP — A frase de transparência sai de uso (migração 20261002100000)
--
-- O que este arquivo tem de provar, e por quê:
--   1. A FRASE SAI DE USO, e não é apagada. Rafael, 28/09/2026: ele não quer
--      aviso de que é robô. A regra era NOSSA (RF-CON-26), não da Meta —
--      `docs/anexos/R04-whatsapp-automacao.md` registra que a Meta exige o
--      caminho de escalonamento para humano, e que a exigência de ANUNCIAR IA
--      "não localizei isso na política oficial".
--   2. A SAÍDA PARA HUMANO FICA. `GEN-SYS-E-ROBO` (a resposta honesta a quem
--      pergunta, escolhida por gente) e `GEN-SYS-HUMANO` (a despedida do freio)
--      continuam ativos. O robô deixa de ANUNCIAR automação; ele não passa a
--      NEGÁ-LA.
--   3. NENHUMA FUNÇÃO DO BANCO NOMEIA O MODELO — e nunca nomeou. Esta é a
--      asserção que morde: `not exists (messages join GEN-SYS-TRANSPARENCIA)`
--      seria vacuamente verdadeira num banco local recém-resetado e não diria
--      uma palavra sobre produção. Se alguém escrever amanhã um caminho que
--      envie a frase, este teste fica vermelho no mesmo `pnpm db:test`.
--
-- Roda em transação e desfaz tudo.
-- =====================================================================
begin;
select plan(4);

select ok(not (select is_active from public.message_templates
                where template_code = 'GEN-SYS-TRANSPARENCIA'),
  'a frase de transparência sai de uso (ADR-16, 28/09/2026)');

select ok((select is_active from public.message_templates where template_code = 'GEN-SYS-E-ROBO'),
  'a resposta honesta a "é robô?" FICA: ela só sai quando alguém pergunta, escolhida por gente');

select ok((select is_active from public.message_templates where template_code = 'GEN-SYS-HUMANO'),
  'a despedida para humano FICA: a saída é exigência da Meta, o aviso era nosso');

select is((select count(*)::int from pg_proc p
            join pg_namespace n on n.oid = p.pronamespace
           where n.nspname in ('app', 'public')
             and p.prokind = 'f'
             and pg_get_functiondef(p.oid) like '%GEN-SYS-TRANSPARENCIA%'), 0,
  'nenhuma função do banco envia a frase de transparência — e nunca enviou');

select * from finish();
rollback;
