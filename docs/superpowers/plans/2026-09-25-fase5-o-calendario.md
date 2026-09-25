# Fase 5 — O calendário é do CRM, e a IA marca sozinha

Plano de implementação em TDD. Base: ADR-15 (linhas 1088–1110) e seção B (1316–1570) da emenda de 25/09 em `docs/superpowers/specs/2026-09-24-pivo-scraper-e-robo-autonomo-design.md`, mais as duas respostas do Rafael (esta fase vem antes da Fase 4; a IA marca com rampa de uma semana).

**Antes de tudo, em toda sessão:**

```bash
cd /Users/matheusrondon/Documents/Tríade && source scripts/dev-env.sh
```

**Estado verde de partida:** pgTAP 2.988 asserções em 69 arquivos · 804 testes do web em 52 · 337 dos workers em 21 · 276 dos prompts · 105 do schema.

---

## O que o plano anterior errou, e o que eu conferi abrindo arquivo

As nove correções que aquele plano fez à emenda continuam de pé e estão conferidas: `app.esteira_falhar` (não `esteira_falhou`) em `20260905000200:1934`; o CHECK de `marcada_por_id` que trava o `DELETE` de perfil; `dono_id … on delete restrict` de propósito; o gatilho `app.deals_track_stage` (`20260904000300:442`, `after insert or update of stage_id`) que já grava o histórico com `changed_by = auth.uid()`; a classe de operadores qualificada; `app.set_updated_at` que escreve `new.updated_at` e não serve para `atualizada_em`; `SUPABASE_SERVICE_ROLE_KEY` que fica no `.env.example`; e a ausência de runner de e2e.

**Mas ele tem treze defeitos próprios, e cinco derrubam a suíte ou a operação.** Cada um vira passo deste plano.

1. **O teste da corrida trava a suíte.** `dblink` disparado de dentro da transação do pgTAP é deadlock garantido, e um deadlock que o Postgres *não* detecta: a transação de fora já segura (a) o `pg_advisory_xact_lock` de `(dono, dia)` e (b) a linha não comitada no índice de exclusão; a sessão do `dblink` bloqueia num dos dois; a sessão de fora bloqueia na leitura de rede do `dblink`. O detector de deadlock enxerga locks, não sockets. E o retorno esperado está errado de qualquer jeito: **`horario_tomado` (23P01) é inalcançável numa transação só**, porque o passo 2 de `reuniao_gravar` reconfere `app.reuniao_horarios_livres`, que enxerga a própria linha da transação e devolve `horario_indisponivel` antes de o `insert` acontecer. A trava se prova por `throws_ok` no `insert` direto, por `pg_get_constraintdef`, e pela borda `[)`.
2. **O teste do feriado passa pelo motivo errado.** `app.reuniao_horarios_livres(dono, '2026-09-07', '2026-09-07', 50)` devolve 0 porque `greatest(p_de, v_hoje)` empurra o começo para hoje e `least(p_ate, v_ultimo)` puxa o fim para 07/09: o `generate_series` nasce vazio, com feriado ou sem. O teste tem de **inserir o feriado no próprio dia da fixture**, dentro da transação.
3. **A rampa nasce morta depois de 09/10/2026.** `"rampa": {"ate": "2026-10-09"}` é literal, dentro de um `on conflict (key) do nothing`. Todo `pnpm db:reset` a partir de 10/10 cria a rampa já vencida, e a asserção "a rampa nasce ligada" vira bomba-relógio. A data de saída conta-se **do dia em que a migração rodou**.
4. **Marcar pode empurrar o negócio para TRÁS.** A busca pega a primeira etapa com `meeting_at` e move sempre que for diferente da atual. Parceiro já em `apresentacao_realizada` (posição 6), `autorizou` ou `ganho` que marca uma segunda reunião volta para `reuniao_marcada` (posição 5) — e `app.deals_before_write` reescreve `status` de `won` para `open`. Só se move para a **frente**.
5. **A fila é criada depois de quem a usa.** `app.reuniao_gravar` chama `app.esteira_enfileirar('reuniao_avisos', …)`, que **levanta exceção quando a fila não existe no catálogo** (`20260904001600:1533`). A fila nasce na **Tarefa 1**.
6. **A tela não consegue montar como está desenhada.** `consultas.ts` tem `if (linhas.length === 0) return [];` **antes** do `Promise.all`, e `orgIds`/`dealIds` saem só das `tasks`. Reunião "entrando por si" não teria linha em `organizations_view` e cairia no `if (!org) return []`. Pior: `Compromisso.taskId` é obrigatório e carrega peso. Como `app.reuniao_gravar` **sempre** escreve o eco, e cancelar/remarcar cancelam os dois lados juntos, a `reunioes` **enriquece** a `tasks` por `task_id`, no mesmo formato do espelho do Google que ela substitui.
7. **Ninguém nunca escreve `realizada` nem `nao_compareceu`, e o desfecho deixa reunião-zumbi.** `registrar-desfecho` fecha a tarefa e não toca em `reunioes.estado`.
8. **A fila do e-mail transforma "aviso desligado" em dead-letter.** `enviarPeloResend` devolve `{ok:false, transitorio:false}` para três coisas diferentes — `ativo = false`, `para` vazio e `RESEND_API_KEY` ausente. Configuração não é falha.
9. **A política de leitura esconde do dono a própria reunião.** Só `app.org_is_visible(organization_id)` esconderia do `embaixador` a reunião em que ele atende quando a ficha é de outro.
10. **Grants mortos e ramo inalcançável.** `reuniao_confirmar/cancelar/remarcar` não vão para `service_role`: `app.reuniao_pode_mexer` começa com `auth.uid() is not null`.
11. **A conta do "pronto" está errada.** Sair `38_a_agenda_do_google.sql` (`plan(21)`) e `39_o_evento_acompanha_o_reagendamento.sql` (`plan(15)`) tira **36 asserções e 2 arquivos**. O alvo é **2.952 + as novas, em 69 arquivos**.
12. **O `grep` de pronto nunca fica limpo, por outro motivo.** As três migrações que criaram a agenda do Google não se editam: migração é história. Falta `--exclude-dir=migrations`. E `\b` é extensão GNU: o filtro de `SUPABASE_AUTH_GOOGLE` faz-se por `grep -v`.
13. **Playwright ESTÁ instalado.** O que não existe é runner de e2e (`playwright.config`, pasta `e2e`).

**Mais duas, menores:** `.env.example:51-52` diz que a `SUPABASE_SERVICE_ROLE_KEY` existe "para ler o refresh token guardado no Vault" — o comentário é reescrito junto. E a asserção `ok(… is null or true, …)` do teste 75 é verdadeira por construção e sai.

**E um detalhe do gatilho:** `reuniao_marcada.required_fields` tem **duas** specs — `meeting_at` (`timestamptz`) e `meeting_format` (`enum`). `app.deals_before_write` só cobra `consent_kind` e `timestamptz`. Por isso `next_action_at = p_inicio` no mesmo comando **basta**.

---

## Tarefa 1 — A tabela, a fila, a trava, e a borda provada

Migração `supabase/migrations/20260930110000_a_reuniao_vira_objeto.sql`. Nasce vazia e cresce até a Tarefa 6. Teste `supabase/tests/74_a_reuniao.sql`.

1.1 Conferir o nome da classe de operadores (`gist_uuid_ops | extensions`).
1.2 O cabeçalho da migração explicando POR QUÊ, e `create extension if not exists btree_gist with schema extensions`.
1.3 Teste primeiro: a tabela não existe (`has_table`).
1.4 A tabela `public.reunioes`, com `durante` gerado, `reunioes_intervalo_chk`, `reunioes_lugar_chk`, `reunioes_robo_chk` (corrigido para sobreviver ao `on delete set null`) e `reunioes_sem_colisao exclude using gist (dono_id extensions.gist_uuid_ops with =, durante with &&) where (estado in ('a_confirmar','marcada','confirmada'))`. Índices por dono, org, conversa, task e "sem aviso".
1.5 RLS ligada, política única de leitura (`org_is_visible` **ou** `dono_id = auth.uid()`), grants (sem insert/update/delete para `authenticated`), gatilho `reunioes_audit`.
1.6 A fila `reuniao_avisos` + `reuniao_avisos_dlq` em `public.ingest_queues` **e** o `pgmq.create` das duas — antes de quem as usa.

---

## Tarefa 2 — A grade: dia útil, configuração, sala, horários livres

2.1/2.2 `app.eh_dia_util(date)` extraída de `app.next_business_day`, que passa a chamá-la.
2.3/2.4 `app_settings.agenda.reunioes` (janela 09:30–17:20, 40 min, 10 de intervalo, pausa nula, 3 h de antecedência, horizonte de 10 dias úteis, teto de 4 por dia por pessoa, sala padrão nula, rampa com data de saída contada do dia da migração) e `profiles.sala_url`.
2.5 Teste: nove começos, nenhum fim depois das 17h20, feriado inserido no dia da fixture, rota planejada bloqueando a tarde, teto de 4.
2.6 `app.reuniao_config`, `app.reuniao_horarios_livres` (seis motivos de corte, na ordem de quem pergunta "por que não me ofereceram as 14h?"), `app.reuniao_por_extenso` (o modelo nunca faz conta de data), `app.reuniao_opcoes`.
2.7 Teste do formato por extenso.

---

## Tarefa 3 — A rampa, e o corpo de `app.reuniao_gravar`

3.1/3.2 `app.reuniao_rampa_ativa()` e `app.reuniao_rampa_adiar()` — correção numa reunião do robô empurra a data; depois do fim, não ressuscita.
3.3/3.4 `app.reuniao_gravar(...)`: valida formato, resolve alvo (conversa ou negócio), recusa `sem_ficha`, confere supressão, resolve dono, congela a sala, trava por `pg_advisory_xact_lock(dono, dia)`, reconfere a grade, insere com `exception when exclusion_violation` devolvendo `horario_tomado` + alternativas, escreve o eco em `tasks`, move o negócio **só para a frente** com `next_action_at = p_inicio` no mesmo comando, e enfileira o aviso na mesma transação.

---

## Tarefa 4 — As portas, e a trava provada como ela é

4.1 Teste da trava (`pg_get_constraintdef`, `throws_ok` 23P01, `lives_ok` da borda `[)`) e do caminho de produto (`horario_indisponivel` com três alternativas).
4.2 `public.reuniao_horarios`, `public.reuniao_marcar` (robô), `public.reuniao_marcar_pelo_negocio` (pessoa), `public.reuniao_livres` (a tira da tela e a folha de remarcar).
4.3 Teste de grants: `authenticated` não executa a porta do robô; `service_role` não executa as portas de gente.
4.4 Commit: `A reunião vira objeto do banco, com trava de colisão`.

---

## Tarefa 5 — Confirmar, cancelar, remarcar, e dar desfecho

5.1 Teste.
5.2 `app.reuniao_pode_mexer`, `public.reuniao_confirmar`, `public.reuniao_cancelar`, `public.reuniao_remarcar` (a antiga sai do caminho antes de a nova entrar), `public.reuniao_desfecho` (`realizada` / `nao_compareceu` — sem ele a reunião fica zumbi segurando o horário e contando no teto).
5.3 Commit: `Confirmar, cancelar, remarcar e fechar ficam no cartão`.

---

## Tarefa 6 — O e-mail do dono, e o lembrete da véspera

6.1 Teste.
6.2 `app.email_de(uuid)` (só `service_role`) e `public.reuniao_avisos_proximos(int)` / `public.reuniao_aviso_enviado(uuid)`, no molde de `public.rota_proximas`, sem telefone do parceiro.
6.3 `app.reuniao_lembretes_da_vespera()` + `cron.schedule('reuniao_lembrete_vespera', '0 20 * * *', …)` (20:00 UTC = 17:00 em Fortaleza).
6.4 Verde e commit.

---

## Tarefa 7 — O e-mail pelo Resend, e o worker que o manda

7.1–7.2 `enviarPeloResend` extraída, com resultado discriminado: `desligado` (configuração, não falha), `sem_chave`, `recusado` com `transitorio` para 5xx/429/rede. `avisarPorEmail` vira casca.
7.3–7.4 `aviso-de-reuniao.ts`: `assuntoDaReuniao`, `corpoDaReuniao` (diz "marcada pelo robô" com todas as letras, sem telefone), `destinatarios` (dedup sem diferenciar caixa), `avisarDaReuniao`.
7.5–7.6 O laço no worker-wa: passo 1c depois de `avisarDoQueChegou`; `desligado` conclui, `transitorio` falha e volta à fila, `recusado`/`sem_chave` falham com o motivo escrito.
7.7 Verde e commit.

---

## Tarefa 8 — A tela da Agenda com a fonte nova

8.1–8.2 `tipos.ts`: `Compromisso` perde `google` e ganha `reuniaoId`, `fim`, `link`, `local`, `estado`, `marcadaPeloRobo`, `avisoEnviadoEm`; `chaveDoCompromisso`, `naturezaDoCompromisso`, `faixaDeHoras`; `recortesDoCompromisso` deixa de oferecer "Reagendada" quando há reunião — a porta de remarcar passa a ser uma só.
8.3 `consultas.ts`: a terceira entrada do `Promise.all` troca `compromissos_no_google` por `reunioes`, **enriquecendo** por `task_id`; falha aqui derruba a semana; `fecharReuniao`.
8.4 `cartao-compromisso.tsx`: `AcoesDaReuniao` (entrar na sala, remarcar, cancelar, confirmar o horário na rampa), selo "marcada pelo robô", aviso de e-mail não enviado.
8.5 `lista-dia.tsx` / `visao-semana.tsx` / `tela-agenda.tsx`: faixa `10h20–11h00`, chaves por `chaveDoCompromisso`, tira de "livres hoje", saída da conexão do Google, `AindaNaoLigado` reescrito.
8.6 `registrar-desfecho.ts`: o campo de aviso muda de dono (`avisoDaReuniao`), e o desfecho fecha a reunião.
8.7 Verde e commit.

---

## Tarefa 9 — A faxina do Google, na ordem segura

9.0 O passo que **não é meu**: o Rafael cancela os eventos futuros no Google antes do deploy, enquanto os tokens ainda funcionam. Escrever o comando e o aviso, não executar.
9.1 Teste `supabase/tests/75_a_agenda_sem_google.sql`.
9.2 Migração `20260930120000_a_agenda_sai_do_google.sql`: invólucros públicos → funções em `app` → `delete from vault.secrets where name like 'agenda_google:%'` → tabelas → automações do seed.
9.3 Os arquivos que saem (`git rm`).
9.4 Os arquivos editados, e o que **não** pode sair junto (`SUPABASE_AUTH_GOOGLE_*`, `GOOGLE_MAPS_API_KEY`, as três migrações históricas).
9.5 Verde e commit.

---

## Tarefa 10 — Tipos, CHANGELOG e os critérios de pronto

10.1 `pnpm db:types`.
10.2 CHANGELOG, com as pendências escritas como pendência.
10.3 Os critérios de pronto, com o comando que prova cada um (69 arquivos, 2.952 + as novas; `grep` com `--exclude-dir=migrations` e filtro por `grep -v SUPABASE_AUTH_GOOGLE`).
10.4 Roteiro de homologação manual, no lugar do e2e — incluindo a corrida de verdade em duas sessões `psql`.
10.5 Commit final.

---

## O que esta fase entrega para a Fase 4, e mais nada

`public.reuniao_horarios(conversation_id, limite)` e `public.reuniao_marcar(conversation_id, inicio, formato, observacao)` — as duas únicas funções desta fase com `grant` para `service_role` no caminho de escrita. A primeira devolve `quando_por_extenso` pronto: **o modelo nunca faz conta de data**. A segunda devolve `link`, `estado`, `precisa_confirmacao` e, quando recusa, `alternativas` no mesmo retorno. Confirmar, cancelar, remarcar e dar desfecho são de gente nesta fase, de propósito, e os grants dizem isso.

Nada de prompt de redação livre, validador de mundo fechado ou voz da casa: isso é Fase 4 e não se faz aqui.

**Nada desta fase vai a produção:** sem `supabase db push`, sem `vercel`, sem `git push`, sem uma chamada ao Google ou ao Resend com credencial real.
