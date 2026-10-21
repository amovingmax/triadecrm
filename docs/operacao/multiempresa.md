# Duas empresas no mesmo CRM (KOMUNE e Imova Imobiliária)

O Tríade serve duas empresas com o **mesmo código** e **uma instalação por empresa**: banco, logins, arquivos, WhatsApp e endereço próprios (modelo silo). Trocar de empresa é abrir o endereço da outra, pelo seletor no topo do CRM.

| | KOMUNE | Imova Imobiliária |
|---|---|---|
| Projeto Supabase | `komune-crm` (`toqdjcajyrowutunczhr`) | `imova-crm` (`kkqadgxvmzulcamuakzk`) |
| Projeto Vercel | `triade-crm` | `imova-crm` (`prj_I50Imfx69Ugc6DoqqPGvEcfCt5eb`) |
| Endereço | `triade-crm-tawny.vercel.app` (o `ir.komune.app.br` só serve os links `/r/`); `komune-crm.vercel.app` previsto | `imova-crm.vercel.app` (depois, talvez `crm.imovaimobiliaria.com.br`) |
| `NEXT_PUBLIC_EMPRESA` | (vazia = komune) | `imova` |
| Dados iniciais | já existiam | `supabase/empresas/imova/seed.sql` |

## O que muda de uma empresa para a outra, e onde

- **Texto de tela, rótulos e módulos:** `packages/schema/src/empresas.ts`. Para a KOMUNE, os textos de sempre (um teste guarda isso). O site lê a empresa em `apps/web/src/lib/empresa.ts`.
- **Dados** (funis, categorias, motivos de perda, roteiro de ligação, modelos, configurações): o banco de cada uma, pelo seed da empresa.
- **Textos que o próprio banco escreve** (arquivo da LGPD): `app.empresa_texto`, lido de `app_settings['empresa']`.
- **Regra para migrações novas:** a migração roda nos dois bancos. Dado de empresa entra pelo seed da empresa, nunca pela migração.

## Quem vê o botão de trocar de empresa

Só quem o admin marcou em **Ajustes → Pessoas → Também acessa**. A marcação fica em `public.acesso_a_outras_empresas`, no banco de cada empresa, e é feita por admin.
- **Para alguém trabalhar nas duas empresas:**
  1. pôr o e-mail na lista de permitidos de cada uma;
  2. depois do primeiro login dela em cada empresa, marcar a outra empresa nas duas.
- **A marcação só mostra o botão.** Quem entra continua sendo decidido pela lista de permitidos de cada empresa.
- **Nenhum banco consulta o outro.**

## As travas contra o projeto errado

1. **Cada banco sabe de quem é.** `app.identidade` guarda uma linha, gravada uma vez e imutável. Todo seed e script de empresa começa por `app.exigir_empresa('<empresa>')`.
2. **O site confere, ao abrir.** Banco de outra empresa = "O CRM não abriu, por segurança" (`lib/conferir-empresa.ts`).
3. **Banco de produção só se mexe por `scripts/publicar-banco.mjs`.** Ele:
   - pega o projeto em `supabase/empresas.json` e passa à CLI como `--linked --project-ref`, que vale por cima do `supabase link` do terminal. Entra com o login da CLI, sem senha de banco;
   - confere a identidade antes de qualquer coisa;
   - pede para digitar o nome da empresa;
   - só leva uma migração à KOMUNE depois de ela estar na Imova;
   - roda o seed tudo ou nada.
4. **Só a conta `amovingmax` publica.**

## Montar a Imova em produção (etapa 3)

**O banco, feito em 21/10/2026** (detalhe no CHANGELOG):
1. Backup do `komune-crm` (`supabase db dump` de estrutura, dados e papéis, mais a contagem de linhas de toda tabela), fora do git.
2. `node scripts/publicar-banco.mjs imova migrar`: a estrutura inteira, num banco vazio. Num projeto novo, o comando primeiro roda `supabase/empresas/projeto-novo.sql`, que iguala o padrão de permissões ao da KOMUNE (projeto criado com "expor tabelas novas" desligado nasce sem `EXECUTE` padrão nas funções).
3. `node scripts/publicar-banco.mjs imova semear`: identidade, funis, catálogos, roteiro e acessos. A autoverificação no fim aborta se faltar algo.
4. `node scripts/publicar-banco.mjs komune migrar`: as migrações `20261022090000` e `20261022100000`, depois de estarem na Imova.
5. `node scripts/publicar-banco.mjs komune identidade`: grava "komune" no banco da KOMUNE (uma vez).
6. Contagem de linhas de novo e comparação com a de antes.

**O login da Imova, no painel do `imova-crm`:**
- **Authentication → Hooks:** ligar o *Custom Access Token* com `public.custom_access_token_hook`.
- **Authentication → Providers → Google:** o mesmo cliente do Google da KOMUNE serve, acrescentando `https://kkqadgxvmzulcamuakzk.supabase.co/auth/v1/callback` nas URLs de retorno dele (Google Cloud).
- **URL Configuration:** `site_url` e as URLs de redirecionamento da Imova.

**Chaves:** projeto novo só tem as chaves no formato novo (`sb_publishable_…`, `sb_secret_…`). O site usa a *publishable* como `NEXT_PUBLIC_SUPABASE_ANON_KEY` e a *secret* como `SUPABASE_SERVICE_ROLE_KEY`. Conferir no ensaio que tudo funciona com elas antes de liberar.

**O site da Imova, feito em 21/10/2026:**
1. **Projeto `imova-crm` na Vercel**, criado pela CLI e igual ao `triade-crm`: pasta `apps/web`, Node 24.x, sem Git (publica só pela CLI, de uma cópia limpa da `main`), região `gru1` pelo `apps/web/vercel.json`.
2. **Variáveis de produção:**
   - `NEXT_PUBLIC_EMPRESA=imova`
   - `NEXT_PUBLIC_SUPABASE_URL` e as duas chaves do `imova-crm`
   - `NEXT_PUBLIC_APP_URL`
   - `NEXT_PUBLIC_EMPRESAS_LINKS=komune=https://triade-crm-tawny.vercel.app;imova=https://imova-crm.vercel.app`
   - As chaves são as do formato novo (`sb_publishable_`, `sb_secret_`, esta como *Sensitive*), só em Production. O `imova-crm` também tem as legadas, que não são usadas.
   - Sem `GOOGLE_MAPS_API_KEY`: a da KOMUNE cobraria na conta da KOMUNE.
3. **Na KOMUNE:** a mesma `NEXT_PUBLIC_EMPRESAS_LINKS`, para o seletor aparecer, e publicar de novo.
4. **Conferir:**
   - o login entra só com os e-mails permitidos;
   - nada da KOMUNE aparece;
   - `comparar-versoes.mjs` dá a KOMUNE igual à linha de base.

**Fica para depois, cada um com o seu passo:** WhatsApp da Imova (portfólio na Meta, worker próprio, modelos e textos da Imova), Twilio, IA.

## Ensaio local

- **Banco da Imova:** um segundo Supabase local (`~/triadecrm-imova-local`, portas 563xx, `project_id = imova-crm-local`). Ele nasce vazio e recebe `publicar-banco imova migrar --local` e `semear --local`.
- **Site da Imova:** um build com `NEXT_PUBLIC_EMPRESA=imova` e o Supabase em `http://127.0.0.1:56321`, servido em `127.0.0.1` (a KOMUNE fica em `localhost`, para os logins não se misturarem no navegador).
