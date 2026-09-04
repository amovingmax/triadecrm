# Publicar o Tríade na Vercel

Guia de operação. Escrito para ser seguido do começo ao fim por quem nunca publicou nada,
sem pular passo e sem precisar decidir nada pelo caminho. Ao final você tem o Tríade rodando
num endereço `https://…`, que a Heloísa abre no celular dela, em Natal, sem VPN e sem o seu
computador ligado.

**Quem faz:** Matheus.
**Quanto leva:** cerca de 40 minutos na primeira vez, dos quais uns 10 são de espera.
**O que muda no repositório:** nada. Publicar é configuração de painel, não é código.

---

## 0. O mapa: o que roda onde

O Tríade não é uma coisa só. Depois desta publicação, as peças ficam assim:

| Peça | Onde roda | Este guia liga? |
| --- | --- | --- |
| Aplicação web (`apps/web`, Next.js) | **Vercel** | ✅ sim |
| Banco, login, RLS (`supabase/`) | **Supabase**, projeto `komune-crm` (São Paulo) | ✅ ajustes de painel |
| Workers `ingest`/`wa`/`ai` (`apps/workers`) | Máquina dedicada, em Docker | ❌ não, e não é para rodar na Vercel |
| Edge Functions (webhooks da Meta e da Komune) | Supabase | ❌ não, é outro deploy |

A Vercel recebe **só a aplicação web**. Ela conversa com o Supabase pela internet, como o seu
navegador já faz hoje. Nenhum segredo de worker, da Meta ou da Anthropic entra na Vercel — a
aplicação web não usa nenhum deles (a conferência está na seção 4).

---

## 1. Antes de começar: o que precisa existir

Confira os cinco itens. Se algum faltar, resolva antes — publicar com um deles faltando gera
uma tela de erro que parece problema da Vercel e não é.

1. **Conta no GitHub** com acesso ao repositório `amovingmax/triadecrm`.
2. **Uma conta Google** para criar a conta na Vercel (use a mesma do GitHub, é mais simples).
3. **Acesso ao painel do Supabase**, organização *Convívia*, projeto **`komune-crm`**
   (ref `toqdjcajyrowutunczhr`, região `sa-east-1` / São Paulo).
4. **Acesso ao Google Cloud Console**, no projeto onde está o cliente OAuth do login do Google.
5. **O código no `main` do GitHub**, atualizado. Sem isso a Vercel publica uma versão velha.

---

## 2. Pôr o código no GitHub

A Vercel não lê a sua máquina: ela lê o GitHub. Tudo que estiver só no seu computador não é
publicado.

No terminal, na raiz do repositório:

```bash
cd "/Users/matheusrondon/Documents/Tríade"
git status              # confira o que ainda não subiu
git add -A
git commit -m "chore: preparar publicação na Vercel"
git push origin main
```

Abra `https://github.com/amovingmax/triadecrm` e confirme que o commit aparece lá.

> **Nunca comite o arquivo `.env`.** Ele já está no `.gitignore` e o `git status` não deve
> mostrá-lo. Se aparecer, pare e avise — chave vazada em repositório é rotação de chave, não
> é "apagar o commit".

---

## 3. Criar a conta na Vercel e importar o repositório

1. Abra **https://vercel.com/signup**.
2. Clique em **Continue with GitHub** e autorize.
3. Quando perguntar o tipo de conta, escolha **Hobby** para começar (a conversa sobre plano
   está na seção 10; dá para trocar depois sem republicar).
4. No painel, clique em **Add New… → Project**.
5. Na lista **Import Git Repository**, procure **`triadecrm`** e clique em **Import**.
   - Se o repositório não aparecer: **Adjust GitHub App Permissions** → dê acesso ao
     repositório `amovingmax/triadecrm` → volte.

**Não clique em Deploy ainda.** Falta a parte que quase todo mundo erra: dizer que isto é um
monorepo.

---

## 4. Configurar o projeto (a parte do monorepo)

Você está na tela **Configure Project**. Ajuste três coisas.

### 4.1 Root Directory — o passo mais importante

Este repositório tem vários projetos dentro (`apps/web`, `apps/workers`, `packages/…`). A
aplicação web fica em `apps/web`. Se você não disser isso, a Vercel olha a raiz, não encontra
o Next.js e o build falha com "No framework detected".

- Ao lado de **Root Directory**, clique em **Edit**.
- Navegue e selecione a pasta **`apps/web`**.
- Confirme (**Continue**).
- Deixe **ligada** a opção **Include files outside of the Root Directory in the Build Step**
  (ela costuma vir ligada sozinha). É ela que permite ao `apps/web` enxergar o
  `pnpm-workspace.yaml`, o `pnpm-lock.yaml` e o pacote `packages/schema`, que a web importa.

Feito isso, o campo **Framework Preset** deve virar **Next.js** sozinho.

### 4.2 Build & Output Settings

Deixe **tudo no automático**. Não marque nenhum "Override". Os padrões corretos são:

| Campo | Valor (automático) |
| --- | --- |
| Framework Preset | Next.js |
| Install Command | `pnpm install` (roda na raiz do monorepo) |
| Build Command | `pnpm run build` (que é `next build` dentro de `apps/web`) |
| Output Directory | `.next` |

O arquivo `apps/web/vercel.json` já fixa a região das funções em **`gru1` (São Paulo)**, do
lado do banco. Sem isso, as páginas seriam renderizadas nos Estados Unidos e cada consulta ao
Supabase daria uma volta ao continente — o CRM fica visivelmente mais lento em campo.

### 4.3 Versão do Node

Em **Settings → General → Node.js Version**, escolha **22.x**. O repositório declara
`"node": ">=22"` e o `.npmrc` tem `engine-strict=true`: com uma versão menor, a instalação
recusa e o build para logo no começo. (Se essa opção só aparecer depois do primeiro deploy,
tudo bem: ajuste e clique em *Redeploy*.)

---

## 5. As variáveis de ambiente

Ainda na tela **Configure Project**, abra **Environment Variables**. São **três**, e nenhuma
delas é segredo — todas viajam para o navegador de propósito (é o que o prefixo `NEXT_PUBLIC_`
significa). Quem protege o dado no Tríade é a RLS do Postgres, não o sigilo destas chaves.

Marque as três para os três ambientes: **Production**, **Preview** e **Development**.

| Nome | Valor | Onde encontrar |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | `https://toqdjcajyrowutunczhr.supabase.co` | Supabase → **Project Settings → Data API → Project URL** |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | a chave **anon / publishable** | Supabase → **Project Settings → API Keys** |
| `NEXT_PUBLIC_APP_URL` | a URL pública do app, **sem barra no final** | você só descobre depois do primeiro deploy — veja o aviso abaixo |

> **Sobre a `NEXT_PUBLIC_APP_URL`:** no primeiro deploy você ainda não sabe qual endereço a
> Vercel vai dar. Coloque um valor provisório (`https://triadecrm.vercel.app`), publique, veja
> a URL real e volte para corrigir. **Corrigir é obrigatório**, porque essa variável é a base
> do `manifest.webmanifest` da PWA: errada, a instalação no celular da Heloísa aponta para o
> lugar errado. Depois de corrigir, é preciso **Redeploy** — variável de ambiente do Next entra
> no pacote na hora do build, não na hora que a página abre.

### O que **não** vai para a Vercel

Confira e não caia na tentação de "já colar tudo de uma vez". Estas **não** entram, porque a
aplicação web não usa nenhuma delas (`grep` no `apps/web/src` não encontra uma sequer):

`SUPABASE_SERVICE_ROLE_KEY` · `SUPABASE_DB_PASSWORD` · `SUPABASE_AUTH_GOOGLE_SECRET` ·
`ANTHROPIC_API_KEY` · `META_WA_ACCESS_TOKEN` · `META_WA_APP_SECRET` · `META_WA_VERIFY_TOKEN` ·
`META_WA_PHONE_NUMBER_ID` · `KOMUNE_HMAC_SECRET` · `SENTRY_DSN`

Cada uma dessas mora em um de dois lugares, e em nenhum outro:

- **workers** (máquina dedicada): no `.env` da máquina — modelo em `.env.example` da raiz;
- **Edge Functions**: em Supabase → **Edge Functions → Secrets**.

A `service_role` em especial **ignora a RLS**. Ela na Vercel seria a chave do banco inteiro
guardada num prédio onde ela não tem nada a fazer.

---

## 6. Publicar

Clique em **Deploy**. Leva de 2 a 4 minutos.

Quando terminar, a Vercel mostra a URL, algo como `https://triadecrm.vercel.app`.
**Copie essa URL. Ela é usada em todos os passos seguintes.**

Se você abrir agora, ainda **não** vai conseguir entrar: o login do Google ainda não sabe que
esse endereço existe. É exatamente o que a próxima seção resolve.

---

## 7. Ajustar o Supabase para a URL nova

Este é o ajuste que faz o login funcionar. Sem ele, você clica em "Entrar com Google",
escolhe a conta, e o Google devolve você para `localhost:3000` — que no celular da Heloísa não
existe.

No painel do Supabase, projeto **`komune-crm`**:

1. Menu lateral: **Authentication** → **URL Configuration**.
2. Em **Site URL**, troque `http://localhost:3000` pela sua URL da Vercel:
   `https://triadecrm.vercel.app`
3. Em **Redirect URLs**, clique em **Add URL** e acrescente, uma por vez:
   - `https://triadecrm.vercel.app/**`
   - `http://localhost:3000/**` ← mantenha, é o seu desenvolvimento local
   - `http://127.0.0.1:3000/**` ← mantenha, mesmo motivo
   - `https://triadecrm-*.vercel.app/**` ← opcional: libera as URLs de *preview*, que a Vercel
     cria a cada branch. Sem isso, o login só funciona em produção.
4. **Save**.

> As duas barras (`/**`) são obrigatórias: o app volta do login em `/auth/callback?next=…`, e
> sem o coringa o Supabase recusa esse endereço.

> O arquivo `supabase/config.toml` do repositório **não** manda no projeto remoto — ele
> configura só a stack local (`supabase start`). Estes valores existem apenas no painel.

---

## 8. Conferir o Google Cloud Console

**Provavelmente você não precisa mudar nada aqui**, e vale entender por quê, porque é
contraintuitivo: o Google **nunca** redireciona para a Vercel. O caminho é
`app → Supabase → Google → Supabase → app`. Quem o Google conhece é o Supabase.

Ou seja: **o endereço registrado no Google não muda quando a URL da Vercel muda.**

Ainda assim, confira uma vez:

1. Abra **https://console.cloud.google.com/apis/credentials** e selecione o projeto correto.
2. Em **Credenciais → IDs do cliente OAuth 2.0**, clique no cliente usado pelo Tríade.
3. Em **URIs de redirecionamento autorizados**, precisa existir:
   - `https://toqdjcajyrowutunczhr.supabase.co/auth/v1/callback` ← **produção**
   - `http://127.0.0.1:54321/auth/v1/callback` ← o seu Supabase local
4. **Origens JavaScript autorizadas** pode ficar vazio: o login não é iniciado a partir de uma
   página do Google, então esse campo não é usado neste fluxo.
5. **Salvar.** Mudança no Google pode levar alguns minutos para valer.

Depois, em **APIs e serviços → Tela de permissão OAuth**, verifique o **Status da publicação**:

- Se estiver **Em produção**: tudo certo.
- Se estiver **Em teste**: só os e-mails listados em **Usuários de teste** conseguem entrar.
  Acrescente ali o e-mail da Heloísa e o seu, ou publique o app. Este é o erro que aparece
  como *"O Tríade não concluiu o processo de verificação do Google"* e não tem nada a ver com
  a Vercel.

---

## 9. Preparar o banco de produção

O app publicado aponta para o Supabase **remoto**, não para o seu Docker. E o remoto hoje
está atrás do seu ambiente local. Sem esta seção, o Tríade abre, mas Metas, Relatórios,
Ligações e Radar quebram, e todo mundo entra como "Leitura".

Estado conferido em 04/09/2026, no projeto `komune-crm` remoto:

| Item | Situação |
| --- | --- |
| Migrações até `20260904001200` | ✅ aplicadas |
| Dados reais (100 organizações, 100 negócios, 34 desfechos, 8 e-mails na allowlist) | ✅ carregados |
| Migrações `20260904001300` (ligação), `20260904001400` (metas e relatórios), `20260904001401` (radar) | ❌ **faltando** |
| Login com Google no projeto remoto | ✅ ativado |
| Hook `custom_access_token` | ⚠️ **conferir** (ver 9.2) |
| Tabela `profiles` | vazia — normal: enche no primeiro login de cada pessoa |

### 9.1 Aplicar as migrações que faltam

```bash
cd "/Users/matheusrondon/Documents/Tríade" && source scripts/dev-env.sh
supabase db push            # mostra o que vai aplicar e pede confirmação
```

Confira antes o que vai subir e **rode isto com o Luiz ciente** (ADR-02: aplicar migração no
remoto é operação combinada, não é rotina de desenvolvimento). Depois do `push`, as tabelas
novas nascem **vazias**: `call_scripts` (roteiros de ligação) e `goals` (metas do mês) precisam
das linhas de catálogo, que hoje vivem no `supabase/seed.sql` e não viajam no `db push` —
`seed.sql` só roda em `supabase db reset`, que é **local**. Combine com quem cuida desses
módulos como carregar essas linhas no remoto antes de anunciar as telas para a Heloísa.

### 9.2 Ligar o hook que injeta o papel no login

O papel de cada pessoa (`admin`, `gestor`, `sdr`, …) não é lido de uma tabela pela aplicação:
ele é **carimbado dentro do token** pelo *Custom Access Token Hook*. Se o hook estiver
desligado no remoto, o app não encontra `app_role` no token e assume o padrão mais restrito —
`leitura`. Resultado: todo mundo entra, e quase nada aparece.

No painel do Supabase: **Authentication → Hooks** → **Customize Access Token (JWT) Claims** →
ativar → escolher a função **`public.custom_access_token_hook`** → **Save**.

### 9.3 Conferir quem pode entrar

O login é restrito por gatilho no banco: quem não está em `allowed_users` nem em um domínio de
`allowed_domains` tem a criação da conta **abortada** — e a tela de login diz isso em português.

Hoje o domínio `komune.app.br` está liberado com papel padrão `sdr`. Então:

- **Heloísa**: precisa entrar com o e-mail `@komune.app.br` dela. Entra como `sdr`.
- **Você**: `amovingmax@gmail.com` já está na lista nominal como `admin`.

Depois do primeiro login de cada pessoa, o admin ajusta o papel em `profiles.role`, na tela de
Administração.

---

## 10. Testar (5 minutos, e não pule)

Do seu computador, no navegador anônimo:

1. Abra a URL da Vercel. Deve cair em `/login`.
2. **Entrar com Google**, escolha a conta. Deve voltar em **Meu dia** — não em `localhost`.
3. Abra **Parceiros**: as 100 organizações reais de Natal têm de aparecer.
4. Abra **Funis**: arraste um cartão de etapa. Recarregue: tem de continuar onde você soltou.
5. Abra **Metas** e **Relatórios**. Se der erro de tabela inexistente, falta o passo 9.1.
6. No canto superior direito, confira o **papel** ao lado do seu nome. Se disser "Leitura"
   quando deveria dizer "Admin", falta o passo 9.2.

Do celular, na rede móvel (não no Wi-Fi do escritório): repita 1, 2 e 3.

---

## 11. A PWA continua funcionando? E como a Heloísa instala?

**Continua, e melhora.** A instalação no celular exige `https://`, que a Vercel dá de graça e
o `localhost` nunca teve. O `manifest.webmanifest`, os ícones e a tela em pé já estão no
código e são servidos normalmente.

Uma ressalva honesta: **o Tríade ainda não tem *service worker***. Na prática isso quer dizer:

- ✅ instala, abre em tela cheia, com ícone próprio, sem barra de navegador;
- ❌ **não funciona sem internet**. Em ponto cego de sinal, a tela não carrega. Para uso na
  rua em Natal isso importa, e é a próxima coisa a construir na PWA — não é algo que a
  publicação resolva.

### Instruções para mandar para a Heloísa

**iPhone (Safari — precisa ser o Safari, não o Chrome):**
1. Abrir o link do Tríade no Safari.
2. Tocar no botão **Compartilhar** (o quadrado com a seta para cima, embaixo).
3. Rolar e tocar em **Adicionar à Tela de Início**.
4. Confirmar o nome (**Tríade**) e tocar em **Adicionar**.
5. O ícone fica na tela do celular e abre em tela cheia, como qualquer aplicativo.

**Android (Chrome):**
1. Abrir o link do Tríade no Chrome.
2. Tocar nos **três pontinhos** no canto superior direito.
3. Tocar em **Adicionar à tela inicial** (em alguns aparelhos aparece como **Instalar app**).
4. Confirmar.

Em qualquer um dos dois, no primeiro uso ela vai precisar **entrar com Google** uma vez. Depois
a sessão fica salva no aparelho e ela não digita mais nada.

---

## 12. Quanto custa

**O que é grátis, e é grátis de verdade:**

- Vercel, plano **Hobby**: publicações ilimitadas, HTTPS, e um limite de tráfego (na casa de
  100 GB/mês) que duas pessoas usando um CRM não chegam perto de encostar.
- Ligar um domínio próprio na Vercel não custa nada (comprar o domínio, sim, mas isso é com o
  registrador, à parte).
- Supabase, plano **Free**: 500 MB de banco. Os dados de hoje ocupam uma fração disso.

**Onde começa a custar — dois pontos, e nenhum é sobre volume:**

1. **O plano Hobby da Vercel é para projeto pessoal, sem fins comerciais.** O Tríade é
   ferramenta interna de uma empresa. Tecnicamente funciona no Hobby; pelos termos de uso, o
   plano certo é o **Pro, cerca de US$ 20 por mês por membro da equipe**. Comece no Hobby para
   validar e leve a decisão ao Rafael antes de virar rotina de trabalho — a Vercel derruba
   projeto comercial em Hobby quando percebe, e derruba sem aviso confortável.
2. **O projeto Free do Supabase PAUSA depois de 7 dias sem atividade.** Um CRM usado em rajadas
   pode ficar uma semana parado; quando isso acontece, o Tríade abre e não carrega nada até
   alguém entrar no painel e clicar em *Restore*. Sair disso é o **Pro do Supabase, US$ 25 por
   mês**, que também traz backup diário — que para a base de captação é o argumento mais forte
   dos dois.

Nada mais neste guia gera cobrança. Não ative Vercel Analytics, Speed Insights nem Blob: o
Tríade não usa nenhum deles.

---

## 13. Deu erro? Comece por aqui

| Sintoma | Causa quase certa | O que fazer |
| --- | --- | --- |
| Build falha com *No Next.js version detected* ou *No framework detected* | Root Directory não foi apontado para `apps/web` | Seção 4.1 |
| Build falha em `pnpm install` falando de `workspace:` ou de `catalog:` | *Include files outside of the Root Directory* está desligado | Seção 4.1 |
| Build falha citando `engine` / versão do Node | Node menor que 22 (o `.npmrc` tem `engine-strict=true`) | Seção 4.3 |
| Build falha citando a versão do **pnpm** | A Vercel usa o `packageManager` do `package.json` (`pnpm@11.25.0`) e pode ainda não suportá-lo | Em **Settings → Environment Variables**, crie `ENABLE_EXPERIMENTAL_COREPACK=1` e refaça o deploy |
| Build falha em *Deploying to multiple regions is restricted* | O plano não deixa escolher região | Apague a linha `"regions"` de `apps/web/vercel.json`, comite e publique (o app fica mais lento, mas funciona) |
| Página abre com *Variável de ambiente NEXT_PUBLIC_SUPABASE_URL não definida* | Faltou cadastrar a variável, ou ela foi cadastrada só em *Preview* | Seção 5 e **Redeploy** |
| Login volta para `localhost:3000` | Site URL / Redirect URLs do Supabase | Seção 7 |
| Login dá *redirect_uri_mismatch* | Falta o callback do Supabase no Google | Seção 8, item 3 |
| Login diz *"não concluiu a verificação do Google"* | Tela de permissão OAuth ainda em **Teste** | Seção 8, último bloco |
| Entra, mas aparece "Leitura" e quase nada carrega | Hook `custom_access_token` desligado no remoto | Seção 9.2 |
| Entra, mas a tela diz que o e-mail não está autorizado | Fora de `allowed_users` / `allowed_domains` | Seção 9.3 |
| Metas, Relatórios, Ligações ou Radar dão erro de tabela | Migrações `…1300`/`…1400`/`…1401` não aplicadas no remoto | Seção 9.1 |
| Mudei uma variável e nada mudou | Variável `NEXT_PUBLIC_*` entra no build | **Deployments → … → Redeploy** |

Onde ler o erro de verdade: **Vercel → Deployments →** clique no deploy **→ Building** (erro de
build) ou **→ Runtime Logs** (erro que só acontece quando alguém abre a página).

---

## 14. O que este deploy NÃO liga — e é honesto dizer

Publicar na Vercel entrega **a interface e o banco**. Continuam desligados, e cada tela do
Tríade já diz isso em português para quem a abre:

- **O coletor do Radar.** As telas do Radar existem e a esteira de curadoria no banco existe;
  quem varre as fontes públicas é um worker que roda na máquina dedicada, em Docker, e não na
  Vercel. Publicar não faz aparecer candidato novo.
- **O WhatsApp oficial.** Depende do número aprovado na Cloud API da Meta e das Edge Functions
  de webhook, que são deploy do Supabase (`supabase functions deploy`), não da Vercel.
- **As filas e o cron** (`pgmq`, `pg_cron`) e os workers `ingest | wa | ai`: máquina dedicada.

O que fica **de pé e útil** no dia 1 é o núcleo real: base de parceiros com as 100 organizações
de Natal, funis com arrastar e soltar, ficha do parceiro, registro de contato, ligação, e as
telas de metas e relatórios assim que a seção 9.1 estiver feita.

---

## 15. Depois: como publicar uma mudança

Não existe "botão de publicar". A partir de agora:

```bash
git push origin main
```

e a Vercel publica sozinha, em uns 3 minutos. Cada `push` numa **branch** vira uma URL de
*preview* separada, útil para o Rafael ou a Heloísa olharem antes de virar produção — desde
que você tenha acrescentado o coringa de preview no passo 7.3.

Se um deploy sair ruim: **Deployments →** escolha o anterior **→ ⋯ → Promote to Production**.
Volta em segundos, sem `git revert`.
