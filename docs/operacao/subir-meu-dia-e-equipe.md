# Subir a branch `meu-dia-e-equipe` para produção

Guia para quem aplica (Luiz, com o Matheus revisando). Escrito para ser seguido na ordem,
sem pular passo. **Nenhum passo deste guia apaga dado.** O único jeito de perder dado nesta
operação é rodar um comando que não está aqui: ver "Nunca" no fim.

**O que sobe:** Meu dia em abas e hierarquia, Agenda com "Novo compromisso" (para si ou para
quem se acompanha), avisos de compromisso marcado por outra pessoa, cores do resultado,
bloqueio de sábado, domingo e feriado para visita, e o Pulso do dia reorganizado. Detalhe
no `docs/CHANGELOG.md`, entradas de 30/09/2026.

**O que NÃO muda:** WhatsApp (worker, webhook, envio, recebimento, janela, modelos), coleta e
Revisão de parceiros, Edge Functions. Nenhum arquivo em `apps/workers` nem em
`supabase/functions` foi alterado.

**Uma migração só:** `supabase/migrations/20261003090000_marcar_para_a_equipe.sql`.
- Cria: a tabela `public.agenda_avisos` (vazia) e as funções `app.acompanha`,
  `app.pode_marcar_para`, `app.reuniao_gravar` de 9 argumentos,
  `public.reuniao_marcar_na_agenda`, `public.visita_marcar` e `public.agenda_avisos_vistos`.
- Troca o corpo de: `app.reuniao_gravar` de 8 argumentos (a do robô passa a só repassar,
  com o mesmo resultado) e `public.reuniao_remarcar` (mantém o dono da reunião).
- **Não tem** `drop`, `delete`, `update` nem `alter table` de nada que já existe.
- Roda numa transação: se falhar, nada é aplicado.

---

## 0. Antes de tudo: anotar o ponto de volta

1. Na Vercel, em **Deployments**, anote o deploy marcado **Production · Current** NO DIA DA
   SUBIDA, e confira que o commit dele é o topo da `main`. É esse deploy que se promove se
   for preciso voltar. (A `main` anda: em 30/09 o topo passou de `4dfd494` para `8c647e8`,
   "Importar lista vira um passo a passo". Promover um deploy mais velho que o topo desfaz
   também o que outras pessoas subiram.)
2. A `meu-dia-e-equipe` já contém a `main` até `8c647e8`. Se a `main` tiver andado de novo,
   faça `git merge origin/main` na branch, rode `pnpm lint && pnpm typecheck && pnpm test` e
   `supabase test db --local`, e só siga com tudo verde.

## 1. Backup do banco de produção

Antes de aplicar a migração:

1. No painel do Supabase, projeto `komune-crm`, **Database → Backups**: confira que existe um
   backup de hoje. Se o plano permitir, faça um sob demanda.
2. E um backup manual, na máquina de quem aplica:

   ```bash
   supabase db dump --linked -f backup-esquema-AAAA-MM-DD.sql
   supabase db dump --linked --data-only -f backup-dados-AAAA-MM-DD.sql
   ```

   **Esses arquivos têm dados de parceiros e telefones: não vão para o git, nem para
   nenhum chat.** Guarde-os onde o time guarda os backups.

## 2. Conferir o que vai ser aplicado

```bash
supabase migration list --linked
```

A **única** linha pendente (com a coluna remota vazia) tem de ser `20261003090000`. Se
aparecer qualquer outra, **pare**: o banco de produção não está no ponto que este guia supõe.

## 3. Aplicar a migração

```bash
supabase db push --linked
```

Aplicar **antes** do merge é o caminho seguro. O site que está no ar continua funcionando
com a migração aplicada, porque ele não usa o que é novo. A reunião marcada pelo robô sai
igual: o pgTAP `74_a_reuniao` e o `94_marcar_para_a_equipe` provam isso.

Confira de novo com `supabase migration list --linked`: `20261003090000` aparece aplicada.

## 4. Merge do PR

O Matheus revisa e faz o merge na `main`. A Vercel publica em uns 3 minutos.

Aviso sobre o CI: a checagem **"Banco — migrações, db lint e pgTAP"** já falha na `main` desde
29/09, em todos os commits. Ela não é causada por este PR. Localmente, os 88 arquivos pgTAP
(3.295 asserções) passam; o `db lint` acusa erros em funções antigas da `main`
(`app.komune_push_disparar` e funções do PostGIS).

## 5. Conferir em produção

Com uma conta de gestor:

1. **Meu dia** abre, com as abas Para fazer, Feito hoje e Próximos dias, e com o Pulso.
2. **Agenda** → **Novo compromisso**: o campo "Para quem" aparece, e os horários livres
   aparecem para você.
3. **Conversas**: abrem, enviam e recebem como antes.

Não é preciso marcar reunião de verdade para conferir: abrir a folha e ver os horários
basta.

---

## Se algo der errado

Da mais rápida para a mais completa. Na maioria dos casos o passo A resolve.

**A. Site (1 a 2 minutos).** Vercel → Deployments → o deploy anotado no passo 0 → **⋯ →
Promote to Production**. O site volta a ser o de antes. O banco pode ficar como está: a
versão anterior funciona com a migração aplicada.

**B. Código (minutos).** Um PR com `git revert -m 1 <commit do merge>` na `main`, para o
próximo deploy não trazer a versão nova de volta. O histórico fica.

**C. Banco (só se quiserem tirar também a migração).**

```bash
psql "<conexão do banco de produção>" -1 -v ON_ERROR_STOP=1 \
  -f supabase/snippets/2026-09-30_reverter_marcar_para_a_equipe.sql
```

- Devolve as duas funções de reunião ao corpo exato de antes e apaga o que a migração criou.
- Perde só os avisos de "fulano marcou um compromisso na sua agenda". Reuniões e visitas
  marcadas continuam lá.
- Testado no banco local em 30/09/2026, ida e volta:
  1. com a volta aplicada, os 87 arquivos pgTAP da `main` passaram (inclusive o 74, que
     cobre a reunião do robô), e a migração voltou a aparecer como pendente;
  2. com a migração reaplicada, os 88 passaram, e as 111 tabelas voltaram com as mesmas
     contagens.

---

## Nunca

- **`supabase db reset --linked`**: apaga o banco de produção inteiro. `reset` é só para o
  banco local.
- Aplicar a migração pelo editor SQL do painel. A fonte da verdade é
  `supabase/migrations` e o `db push`.
- Colocar backup, `.env` ou chave em commit.
