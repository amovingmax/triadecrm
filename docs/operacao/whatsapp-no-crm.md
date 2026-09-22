# WhatsApp dentro do CRM — ligar o número da KOMUNE

Decisão de 14/09/2026: o número da KOMUNE fica **só no CRM**, conectado direto na
WhatsApp Cloud API da Meta. A mensagem começa, sai e volta dentro do Tríade, pela tela
**Conversas** e pelo botão **Mandar WhatsApp** da ficha. O botão que abria o WhatsApp Web
deixa de aparecer assim que o número estiver conectado.

São quatro partes. A primeira e a terceira só uma pessoa com acesso ao Facebook da empresa
consegue fazer; a segunda e a quarta são comandos.

| Parte | O que é | Quem |
| --- | --- | --- |
| 1 | Criar o app na Meta, pôr o número e gerar a chave | quem administra o Meta Business da KOMUNE |
| 2 | Publicar o receptor de mensagens no Supabase | terminal (Claude ou Matheus) |
| 3 | Apontar o webhook do app para o receptor | painel da Meta, 2 minutos |
| 4 | Ligar o motor no Fly.io e conectar o número | terminal (Claude ou Matheus) |

---

## Antes de começar: o número

- **Se o número já tem WhatsApp instalado** (no celular ou no WhatsApp Business, mesmo que
  só conectado ao WhatsApp Web), a conta precisa ser **apagada** no aplicativo antes. A Meta
  não aceita na Cloud API um número que ainda está no app, e as conversas antigas do celular
  não vêm para o CRM. Na ordem:
  1. Exporte o que importa: na conversa, *⋮ → Mais → Exportar conversa*.
  2. *Configurações → Conta → Apagar minha conta*.
  3. Deixe o chip no celular: o código de verificação chega por SMS ou ligação.
- O número precisa **receber SMS ou ligação** para o código de verificação.
- Pode ser fixo ou celular, desde que receba o código.

## Parte 1 — Meta (≈ 30 minutos, mais a espera de aprovação)

1. **Portfólio empresarial.** Em <https://business.facebook.com>, confira que existe o
   portfólio da KOMUNE e que você é administrador.
2. **Criar o app.** Em <https://developers.facebook.com/apps> → *Criar app* → caso de uso
   **"Conectar-se com clientes pelo WhatsApp"** (ou tipo *Empresa*) → vincule ao portfólio
   da KOMUNE. Nome sugerido: `Tríade CRM`.
3. **Adicionar o número.** No app, *WhatsApp → Configuração da API* → *Adicionar número de
   telefone*. Preencha o nome de exibição (**Komune**, ou o que a empresa for usar — a Meta
   revisa esse nome), a categoria e o número. Confirme com o código que chegar.
3b. **Publicar o app.** *Configurações do app → Básico*: preencha **URL da Política de
   Privacidade** com `https://komune.app.br/privacidade`, escolha uma categoria e salve.
   Depois mude o **Modo do app** de *Desenvolvimento* para *Ao vivo* (ou menu *Publicar*).
   **Sem isso a Meta aceita o envio e não entrega a mensagem, sem erro nenhum**, e parte
   dos webhooks não chega.
4. **Forma de pagamento.** Em <https://business.facebook.com> → *Faturamento e pagamentos*
   → *Formas de pagamento* → *Adicionar* (cartão de crédito ou débito de banco; pré-pago e
   virtual não passam) → na aba *Contas do WhatsApp Business*, ligue o cartão à conta. Sem isso a Meta não entrega a primeira mensagem de uma conversa
   (é cobrada por mensagem: em torno de R$ 0,35 a de prospecção; responder quem escreveu nas
   últimas 24 h é grátis).
5. **Verificação da empresa (recomendado).** *Configurações do negócio → Central de
   segurança → Verificação*, com o CNPJ. Não bloqueia o começo, mas sem ela o limite é de
   250 pessoas novas por dia e o nome de exibição demora mais.
6. **A chave que não expira.** *Configurações do negócio → Usuários → Usuários do sistema*
   → *Adicionar* (nome `triade-crm`, função **Administrador**) → *Atribuir ativos*: o app
   (controle total) e a conta do WhatsApp (controle total) → *Gerar token* → escolha o app,
   validade **Nunca**, permissões `whatsapp_business_messaging` e
   `whatsapp_business_management`. Copie o token na hora: ele não aparece de novo.
7. **Anote cinco valores e invente um PIN:**

   | Valor | Onde está |
   | --- | --- |
   | `META_APP_ID` | *Configurações do app → Básico → ID do app* |
   | `META_WA_APP_SECRET` | *Configurações do app → Básico → Chave secreta do app* (clicar em *Mostrar*) |
   | `META_WA_BUSINESS_ACCOUNT_ID` | *WhatsApp → Configuração da API → ID da conta do WhatsApp Business* |
   | `META_WA_PHONE_NUMBER_ID` | *WhatsApp → Configuração da API → ID do número de telefone* (do número real, não do de teste) |
   | `META_WA_ACCESS_TOKEN` | o token do passo 6 |
   | `META_WA_PIN` | seis dígitos inventados por você; vira a verificação em duas etapas do número |

8. **Cole os seis no `.env` da raiz do repositório** (o arquivo não vai para o GitHub):

   ```dotenv
   META_APP_ID=
   META_WA_APP_SECRET=
   META_WA_BUSINESS_ACCOUNT_ID=
   META_WA_PHONE_NUMBER_ID=
   META_WA_ACCESS_TOKEN=
   META_WA_PIN=
   ```

   Nunca mande esses valores por WhatsApp, e-mail ou chat.

## Parte 2 — o receptor no Supabase

Recebe o que a Meta manda (mensagem recebida, entregue, lida) e põe na fila do banco.

```bash
source scripts/dev-env.sh && set -a && source .env && set +a

# O token de verificação é nosso: gere uma vez e guarde no .env.
grep -q '^META_WA_VERIFY_TOKEN=.\+' .env || echo "META_WA_VERIFY_TOKEN=$(openssl rand -hex 24)" >> .env
set -a && source .env && set +a

supabase secrets set --project-ref "$SUPABASE_PROJECT_REF" \
  META_WA_APP_SECRET="$META_WA_APP_SECRET" \
  META_WA_VERIFY_TOKEN="$META_WA_VERIFY_TOKEN"

supabase functions deploy wa-webhook --project-ref "$SUPABASE_PROJECT_REF" --no-verify-jwt
```

Conferência: `curl "$SUPABASE_URL/functions/v1/wa-webhook?hub.mode=subscribe&hub.verify_token=$META_WA_VERIFY_TOKEN&hub.challenge=ok"`
responde `ok`.

## Parte 3 — apontar o webhook (painel da Meta)

A Meta só deixa assinar as mensagens do WhatsApp pelo painel do app.

1. <https://developers.facebook.com/apps> → o app `Tríade CRM` → *WhatsApp → Configuração*.
2. Em **Webhook**, *Editar*:
   - URL de retorno: `https://toqdjcajyrowutunczhr.supabase.co/functions/v1/wa-webhook`
   - Token de verificação: o valor de `META_WA_VERIFY_TOKEN` do `.env` (gerado na Parte 2)
   - *Verificar e salvar*. Se der erro, a Parte 2 não terminou.
3. Em **Campos do webhook**, *Gerenciar* → assinar **`messages`**.

## Parte 4 — o motor no Fly.io e a conexão do número

O motor manda o que foi clicado no CRM e processa o que chegou. Roda num servidor pequeno
na região de São Paulo (≈ US$ 3/mês), sempre ligado.

**Uma vez só:** crie a conta em <https://fly.io> (pede cartão) e entre pelo terminal:

```bash
export PATH="$HOME/.fly/bin:$PATH"
fly auth login          # abre o navegador
fly apps create triade-worker-wa
```

**Segredos e publicação:**

```bash
source scripts/dev-env.sh && set -a && source .env && set +a
export PATH="$HOME/.fly/bin:$PATH"

fly secrets set --app triade-worker-wa --stage \
  SUPABASE_URL="$SUPABASE_URL" \
  SUPABASE_SERVICE_ROLE_KEY="$SUPABASE_SERVICE_ROLE_KEY" \
  META_WA_ACCESS_TOKEN="$META_WA_ACCESS_TOKEN" \
  META_WA_PHONE_NUMBER_ID="$META_WA_PHONE_NUMBER_ID" \
  META_WA_BUSINESS_ACCOUNT_ID="$META_WA_BUSINESS_ACCOUNT_ID"

fly deploy . --config infra/nuvem/fly.worker-wa.toml --dockerfile apps/workers/Dockerfile
```

**Conectar o número** (daqui do Mac, uma vez; repetir não estraga nada):

```bash
source scripts/dev-env.sh && set -a && source .env && set +a
pnpm --filter @komune/workers build
node apps/workers/dist/index.js wa --conectar
```

Ele confere o número na Meta, registra na Cloud API com o PIN, liga a conta do WhatsApp ao
app (e confere o webhook da Parte 3), grava o número no CRM e manda os modelos de mensagem
para aprovação. Cada passo imprime ✓ ou ✗ com o que fazer.

Os 42 modelos vão para a aprovação da Meta. Se algum voltar recusado, o motivo fica em
`message_templates.meta_rejection_reason` e aparece no resumo do comando.

## Depois de ligado

- **O time todo atende pelo mesmo número.** Qualquer pessoa que escreve no CRM responde
  qualquer conversa. Toda mensagem de texto sai com o primeiro nome de quem escreveu em
  negrito na primeira linha (`*Matheus:*`); os modelos se apresentam com o nome de quem
  clicou ("Aqui é Matheus, da Komune"). Quem responde passa a atender a conversa, e o botão
  **Assumir conversa** serve para pegar antes de responder. O nome vem do perfil do Google
  de cada pessoa. Para desligar a assinatura:
  `update app_settings set value = jsonb_set(value, '{assinar_com_nome}', 'false') where key = 'whatsapp.envio';`

- **Modelos.** Desde 22/09/2026, fora da janela de 24 h a conversa só abre com o cumprimento:
  “Bom dia!”, “Boa tarde!” ou “Boa noite!”, escolhido pelo relógio de Natal — na conversa e
  nas campanhas. Quando a pessoa responde, o resto vai em texto livre. A exceção é o recibo
  da ligação, que ainda manda o resumo, a confirmação da reunião ou o “tentei te ligar”. Os
  outros modelos estão fora de uso (não apagados). A Meta aprova em minutos a um dia; o
  motor confere a cada 30 minutos. Para ver agora:
  `node apps/workers/dist/index.js wa --sincronizar-modelos`.
- **O limite do dia recomeça.** Número novo começa com 20 primeiros contatos por dia na
  primeira semana, 35 na segunda e 45 depois (`cadencia.tetos`). O CRM zera essa contagem
  no dia em que o número é conectado.
- **Horário.** Mensagem nova só sai de segunda a sexta, 9h–12h e 14h–18h (sábado só para
  quem já respondeu), nunca em feriado. Fora disso a caixa diz quando abre.
- **Logs do motor:** `fly logs --app triade-worker-wa`.
- **O motor caiu?** A tela Conversas mostra "envio parado". Nada se perde: o que chegou fica
  na fila e sai quando ele voltar (`fly machine restart --app triade-worker-wa`).

## Quando algo não funciona

| Sintoma | Causa provável |
| --- | --- |
| `--conectar` diz token inválido (190) | token copiado pela metade, ou gerado sem as duas permissões do passo 6 |
| `--conectar` falha ao registrar (PIN) | o número ainda está no app do WhatsApp (apague a conta) ou o PIN foi mudado no WhatsApp Manager |
| "Verificar e salvar" do webhook falha | a Parte 2 não foi feita, ou o `META_WA_VERIFY_TOKEN` do `.env` não é o mesmo que está no Supabase |
| Mensagem sai mas a resposta do parceiro não aparece | o campo `messages` não foi assinado na Parte 3 |
| Mensagem fica "na fila" para sempre | motor parado (`fly status --app triade-worker-wa`) ou fora do horário de envio |
| Mensagem falha com 131026 | o número do parceiro não tem WhatsApp |
| Mensagem falha com 131049 | a Meta segurou por excesso de mensagens de marketing para essa pessoa; tente outro dia |
| Todos os modelos recusados | ler o motivo em `message_templates.meta_rejection_reason` e ajustar o texto no `seed.sql`/migração, subindo a versão |


## O MCP da Meta (WhatsApp Business Tools) — 17/09/2026

A Meta lançou em 15/09/2026 um servidor MCP oficial que liga um agente de IA
(Claude, Cursor, Codex) direto à plataforma do WhatsApp Business:

```
https://mcp.facebook.com/whatsapp_business_tools
```

**Como ligar**, no diretório do repositório:

```bash
claude mcp add --transport http whatsapp_business_tools https://mcp.facebook.com/whatsapp_business_tools
```

Depois, `/mcp` dentro do Claude Code para entrar. Ele pede login com a conta de
desenvolvedor da Meta (OAuth) e três permissões: `business_management`,
`whatsapp_business_management` e `whatsapp_business_messaging`. A autenticação é
**de pessoa, não de aplicativo**: ação que muda o estado da conta exige alguém
logado, e isso é de propósito.

**A liberação é gradual (testado em 17/09).** A conta do Rafael ainda recebe
"Not yet available for your account — WhatsApp Business Tools MCP is being
gradually rolled out" na tela de OAuth. Não é configuração errada: é fila de
liberação da Meta. A configuração fica pronta no `.mcp.json`; é só tentar `/mcp`
de novo daqui a alguns dias.

**O que ele resolve, e que hoje é trabalho manual no painel:** listar, criar,
editar e apagar modelos (`whatsapp_biz_list_templates`, `create_template`,
`update_template`, `delete_template`), configurar e assinar webhook, verificar o
negócio, ver status de termos e de pagamento, emitir token de usuário de sistema.
Na prática: submeter um modelo novo e acompanhar a aprovação sem sair da conversa.

**O que ele NÃO substitui.** O envio de produção continua sendo do `worker-wa`
pela Cloud API, com a fila `wa_outbound`, os tetos de primeiro contato, a
supressão, a janela de horário e a janela de 24 h (ADR-06). A própria Meta
posiciona o MCP como beta, para desenvolvimento e teste — não para operação.

**Cuidado com `whatsapp_biz_send_message`.** Ele existe no MCP e passa por fora
de tudo o que o CRM garante: opt-out, teto diário, janela de horário, assinatura
de quem enviou e registro em `messages`. Não use para falar com parceiro de
verdade — uma mensagem que sai por fora não existe para o CRM, e o parceiro que
pediu SAIR pode receber assim mesmo.

**Onde fica a configuração.** Em `.mcp.json`, na raiz. O arquivo não guarda
segredo (a autenticação é OAuth, por pessoa), então versioná-lo só decide se o
resto do time herda o servidor ao abrir o repositório.
