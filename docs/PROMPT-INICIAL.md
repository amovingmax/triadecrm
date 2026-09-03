# Como começar o KOMUNE CRM no Claude Code (VS Code)

## 1. Preparar a pasta (5 minutos)

1. Crie a pasta do repositório no seu computador com o nome `komune-crm` e abra-a no VS Code.
2. Copie para dentro dela, exatamente como estão neste kit: o arquivo `CLAUDE.md` (fica na raiz) e a pasta `docs/` (PRD, imagem da arquitetura, anexos R00–R11 e `CHANGELOG.md`).
3. No terminal do VS Code: `git init` (o Claude Code cria o restante — `.gitignore`, `README`, workspaces, CI).
4. Abra a extensão Claude Code. Ela lê o `CLAUDE.md` da raiz automaticamente em toda conversa; não é preciso rodar `/init` nem anexar o PRD à mão. Quando quiser forçar a leitura de um arquivo específico, cite-o no prompt com `@` (ex.: `@docs/anexos/R05-arquitetura-tecnica.md`).

Antes do D1, tenha em mãos (o Claude Code vai pedir): acesso à organização Supabase para criar o projeto `komune-crm` (região São Paulo), um repositório vazio no GitHub, um cliente OAuth do Google (para o login) e o Supabase CLI instalado (`supabase start` roda o banco local com Docker). A chave da Anthropic só entra no D6 (IA) e a Meta Business (Luiz) a partir do D5.

## 2. Prompt do D1 (cole inteiro na extensão)

```
Hoje é o D1 (sexta, 04/09/2026) do calendário do PRD. Leia CLAUDE.md e, no PRD (docs/PRD-CRM-Captacao-KOMUNE-v1.0.md), as seções 5, 6, 7.1, 7.3, 9, 11.2 e o Apêndice D; leia também docs/anexos/R05-arquitetura-tecnica.md (DDL e filas) e a lista-semente de categorias em docs/anexos/R09-mercado-natal.md.

Antes de escrever código, apresente um plano do D1 em até 15 itens, na ordem de execução, dizendo o que você precisa de mim (projeto Supabase, OAuth do Google, repositório). Espere minha aprovação.

Depois de aprovado, execute:
1. Monorepo com pnpm workspaces na estrutura do CLAUDE.md, com .gitignore, README (como rodar local com `supabase start`) e .env.example.
2. apps/web: Next.js 16 (App Router) + TypeScript + Tailwind + shadcn/ui, layout base com navegação (Meu dia, Parceiros, Funis, Conversas, Radar, Agenda, Metas, Relatórios, Admin), login Google via Supabase Auth e papel do usuário no JWT (RF-ADM-01).
3. supabase/migrations v0.1 com os catálogos e a base de parceiros do Apêndice D: cities, categories, sources, tags, teams, profiles, organizations, organization_categories, organization_tags, contacts, organization_contacts, pipelines, stages, deals, deal_stage_history, activities, tasks, consent_events, suppression_list, audit_log — todas com RLS e políticas por papel, índices únicos parciais de dedup (CNPJ, telefone E.164, @instagram) e a função de temperatura da seção 5.6.
4. supabase/seed.sql: as 4 classes de fornecedor com subcategorias e prioridade, cidades do RN, feriados de 2026, os 3 funis com etapas, SLAs e temperatura, e os modelos de mensagem do Apêndice C.
5. packages/schema com tipos gerados e schemas zod de organização, contato e negócio.
6. Tela de lista de organizações (busca global, filtros por categoria/cidade/etapa/responsável, 5 mil registros em < 1 s) e criação manual rápida em 4 campos com dedup imediata por telefone (RF-BAS-15), funcionando no celular.
7. CI no GitHub Actions: lint, typecheck, Vitest e `supabase db lint`; pgTAP com pelo menos um teste de RLS por papel.
Termine com lint, typecheck e testes passando, faça commits pequenos em pt-BR citando os RFs, e escreva em docs/CHANGELOG.md o que foi entregue e o que ficou para o D2.
```

## 3. Prompt-padrão para os dias seguintes (D2 a D10)

Troque o número do dia e a data; o Claude Code encontra o resto no PRD.

```
Hoje é o D{N} ({dia da semana}, {data}). Leia CLAUDE.md, docs/CHANGELOG.md, a linha do D{N} na tabela do PRD §11.2, os requisitos do módulo do dia (PRD §7.{x}) e o anexo indicado abaixo. Apresente o plano do dia em até 15 itens e espere minha aprovação. Depois execute, com testes do que foi tocado, commits pequenos em pt-BR citando os RFs, e atualize docs/CHANGELOG.md ao final. Se algo do dia não couber, corte escopo e me diga o que ficou de fora.
```

Referências por dia (para colar no lugar de "anexo indicado abaixo"):

| Dia | Data | Entrega (PRD §11.2) | Seções do PRD | Anexo |
|---|---|---|---|---|
| D2 | ter 08/09 | Importação de planilha com mapeamento, dedup e commit; importar planilha-ponte, planilha atual e lista-semente | 7.1 (RF-BAS-07 a 11) | R09 (lista-semente), R05 §4 |
| D3 | qua 09/09 | Kanban dos funis 1 e 3, ficha com semáforo, próxima ação obrigatória, motivos de perda, timeline, tarefas, Realtime; formulário de porta aberta em 20 s | 5, 7.3 (RF-FUN), 7.7 (RF-MET-01) | R07, R02 |
| D4 | qui 10/09 | worker-ingest: Casamentos.com.br (Natal) + carga da base CNPJ + fila de revisão + score v0; heartbeat e Sentry | 7.2 (RF-RAD), Apêndices A e B | R03 |
| D5 | sex 11/09 | Edge Function wa-webhook, worker-wa, inbox com responsável, fila diária de primeiros contatos em modo assistido, opt-out por regra, texto/áudio na janela, resumo 07:30/18:00 — fim do MVP-núcleo | 7.4 (RF-CON), 10.3 | R04, R08 |
| D6 | seg 14/09 | Classificação de intenção (Haiku 4.5) → etapa/temperatura sugeridas + rascunho (Sonnet 5) com aprovação em 1 clique; pedido de autorização como 2ª mensagem; KB versionada; validador; ai_runs | 7.4, Apêndice C | R08, R04 |
| D7 | ter 15/09 | Régua de silêncio D+3 (pelo app), tarefas de morno parado; reuniões com Meet e visitas com endereço; lista da tarde com link Google Maps; lembretes 24 h / 1 h | 7.4 (cadências), 7.5 (RF-AGE, RF-ROT) | R07, R04 |
| D8 | qua 16/09 | Metas diárias por pessoa, painel "Meu dia", fechamento do dia no resumo das 18:00; verificação do gatilho ADR-07 (inbox estável?) | 7.7 (RF-MET, RF-AST) | R07 |
| D9 | qui 17/09 | Pré-cadastro v0 (contrato mínimo com a Edge Function crm-pre-registration feita pelo Matheus; contingência: prévia estática), link de reivindicação + código por e-mail, webhook de status; relatório de segunda (texto + XLSX); Metabase básico | 7.6 (RF-PRE), 7.8 (RF-REL), 9.5 | R10 |
| D10 | sex 18/09 | Estabilização, testes em campo com a equipe, treinamento de 30 min, checklist de "pronto" da §6 — fim do MVP-estendido | 6, 8 | R11 (revisão) |

## 4. Dicas de uso da extensão

- Trabalhe em conversas curtas: uma por dia do calendário (ou uma por módulo grande), começando sempre pelo prompt-padrão; o `CLAUDE.md` e o `CHANGELOG.md` carregam o contexto entre elas.
- Peça o plano antes do código e aprove item a item; é mais barato corrigir a rota no plano do que no PR.
- Quando o Claude Code propuser mudar uma decisão fechada (stack, WhatsApp não oficial, escrever direto no banco da Komune, modo automático), a resposta é "não; siga o PRD" — a menos que você queira mesmo reabrir a decisão, e nesse caso atualize o PRD e o `CLAUDE.md` primeiro.
- Matheus revisa os PRs; o lado Komune (Edge Function `crm-pre-registration`, campos e webhook — PRD §9.5 e anexo R10) é trabalho dele no repositório do app, não neste.
