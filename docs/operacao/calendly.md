# Calendly na Agenda da Imova

Quem abre o link do Calendly da Imova vê os horários livres, escolhe um e marca uma reunião ou uma visita. Segundos depois, o CRM da Imova:

- põe o compromisso na **Agenda** de quem atende (reunião ou visita, com a sala do Meet ou o endereço; na visita, o endereço que o cliente escreveu ou o do anúncio cujo código ele deu);
- mostra o aviso **"Novo agendamento pelo Calendly"** no topo da Agenda e do Meu dia, até a pessoa tocar em "Ok, vi";
- manda o **push** para o celular de quem atende (quem tem o app) e, na reunião, o **e-mail** de reunião marcada (só quando o `imova-worker-wa` tiver a `RESEND_API_KEY`, que hoje ele não tem: o texto do e-mail ainda é o da KOMUNE);
- acha a **ficha** do cliente pelo telefone ou pelo e-mail, ou cria uma de Cliente (origem "Calendly"), põe quem atende como **responsável** (da ficha e do negócio, quando ainda não têm um) e anota o agendamento nela;
- leva o negócio para a etapa que pede data (**Visita marcada** em Clientes, **Avaliação marcada** em Captação).

**Duas pessoas nunca ficam no mesmo horário.** Horário ocupado não aparece para o cliente no Calendly, e só volta a aparecer quando o compromisso que estava nele é desmarcado.

**Nada em sábado, domingo ou feriado.** O Calendly só sabe "seg. a sex." e não conhece os feriados de Natal (20/11, 21/11, 25/12…). O agendamento que cai num desses dias não entra na agenda: o CRM pede ao Calendly que cancele, anota na ficha ("O Calendly marcou num feriado (20/11); o CRM pediu o cancelamento") e avisa quem atende por push.

**O link pessoal (o convite da Agenda).** Na conversa do WhatsApp, a IA que atende ou uma pessoa da equipe (botão "Enviar link da agenda" em Conversas) manda ao cliente o link do Calendly já preenchido com o nome, o tipo ("Visita a um imóvel" ou "Reunião"), o telefone e, na visita, o código e o endereço do imóvel. Quando o cliente marca por esse link, o CRM sabe de que conversa ele veio: a visita entra na ficha certa, com o tipo e o imóvel do convite. [Como funciona](#o-link-pessoal-o-convite-da-agenda).

**Toda visita tem imóvel.** O código e o endereço do anúncio, ou, na avaliação do imóvel de um proprietário, o endereço escrito. A visita que chega sem imóvel aparece na Agenda como **"Falta o imóvel"**, e quem atende ganha a tarefa **"Confirmar o imóvel da visita com <cliente>"**.

O Calendly em si não manda nada pelo WhatsApp: o que vai pelo WhatsApp é o link, que a IA ou a equipe manda na conversa. Só a Imova tem isso; a KOMUNE não.

---

## Estado em 11/11/2026

**Feito (10/11/2026):** banco, função `calendly-webhook`, site e `imova-worker-wa` com as duas chaves (Calendly e Google); agenda "CRM Imova - ocupado" criada na conta Google Workspace; projeto `crm-imova-agenda` no Google Cloud com a Calendar API e a conta de serviço; Calendly ligado ao Google ("Verificar conflitos" com a agenda nova e a principal); evento "Agendamento Imova" de 45 min, fuso de Brasília, relógio de 24 h, seg. a sex.; assinatura do webhook ativa; primeiro agendamento real recebido (reunião on-line de 11/11, na agenda do Rafael).

**Pronto no código, à espera de publicar (banco `20261111204000` e site; a função e o worker não mudam):**
- feriado, sábado e domingo recusados, com cancelamento no Calendly e o recado "não atende neste dia";
- **"Quem atende o que chega pelo Calendly"**: campo no pé da **Agenda**, só para admin. A pessoa escolhida vale **antes** do anfitrião (a conta do Calendly é do Rafael, então sem escolha tudo cai na agenda dele). É também a agenda que o espelho copia no Google;
- a ficha e o negócio que nascem do Calendly ficam com quem atende como responsável;
- o endereço da visita pela pergunta "Endereço ou código do imóvel" (com o código de um anúncio, vale o endereço do anúncio);
- o aviso **"Não consegui cancelar no Calendly o agendamento de…"** no topo da Agenda, para o dono do agendamento e os admins, quando o cancelamento esgota as tentativas.

**Pronto no código, à espera de publicar (banco `20261111211000` e site; o acabamento):** os textos da Agenda, do Meu dia e das Metas no vocabulário da imobiliária; o selo "Reagendada" também na visita que o cliente remarcou; os diálogos de cancelar e remarcar dizendo o que acontece no Calendly; o conflito do "Novo compromisso" com "(marcado pelo Calendly)"; sem as frases do e-mail que não sai; e a LGPD do agendamento (dossiê, 2 anos e exclusão a pedido). Ver [O que a tela diz e o que a LGPD guarda](#o-que-a-tela-diz-e-o-que-a-lgpd-guarda).

**Pronto no código, à espera de publicar (11/11/2026, o convite da Agenda):** banco `20261111210000_o_convite_da_agenda.sql` e a função `calendly-webhook` (passa o `utm_content` do convidado ao banco). O site (botão "Enviar link da agenda", "Falta o imóvel", o campo do link) e a IA (`atendente-imova@v3`) vêm de outras entregas do mesmo dia.

**Falta (configuração, do lado de quem tem as contas):**
- compartilhar "CRM Imova - ocupado" com a conta de serviço ("Fazer alterações nos eventos") e gravar `google_agenda_id` (passo 5). **Sem isso o espelho fica desligado:** o que a equipe marca no CRM continua livre no Calendly, e só a rede de segurança (recusar e cancelar) segura;
- trocar o token do Calendly (foi colado no chat) no `.env.imova` e no `imova-worker-wa`, e conferir com `calendly-assinar.mjs estado`;
- escolher quem atende, na Agenda (admin);
- no Calendly: as três perguntas **nesta ordem** e o idioma em português ([abaixo](#as-perguntas-a-criar-no-calendly)), e conferir o horário 9h30–17h45, os 10 min depois de cada evento e as 3 h de antecedência (o registro de 10/11 não cita esses três);
- o e-mail de reunião marcada na Imova (`RESEND_API_KEY` no `imova-worker-wa` e um texto sem a KOMUNE).

**Próximo passo (fora desta entrega):** rodízio entre corretores. Ele pede que o espelho no Google bloqueie só o horário em que **todos** estão ocupados, e não o de uma pessoa só.

---

## Como o horário fica indisponível

| O horário foi ocupado por… | Como o Calendly esconde |
| --- | --- |
| outro cliente, pelo próprio Calendly | O Calendly já faz isso sozinho. |
| a equipe, direto no CRM (a IA que atende não marca mais: desde 11/11/2026 ela manda o link, [abaixo](#a-ia-que-atende-manda-o-link)) | O CRM grava um bloco **"Ocupado — CRM Imova"** num Google Agenda ligado ao Calendly, e o Calendly não oferece esse horário. Só início e fim vão ao Google: nenhum nome, telefone ou endereço. |
| um feriado da Imova (Ajustes → Catálogos → Feriados, `public.holidays`) | O CRM grava um bloco **"Ocupado — feriado"** de dia inteiro no mesmo Google Agenda, para cada feriado dos próximos 12 meses. O Calendly só sabe "seg. a sex." e, sem isso, oferecia 20/11 e 21/11. Feriado apagado ou trocado de data tira o bloco. |

E para liberar:

| Quem desmarca | O que acontece |
| --- | --- |
| O cliente, pelo Calendly | O CRM tira da agenda, avisa e anota na ficha. |
| A equipe, pelo CRM, um compromisso que veio do Calendly | O CRM cancela no Calendly, que avisa o cliente por e-mail e libera o horário. |
| A equipe, pelo CRM, um compromisso marcado no CRM | O bloco "Ocupado" sai do Google e o horário volta a aparecer no Calendly. |

**A rede de segurança.** Entre o CRM marcar e o Calendly reler o Google passam alguns segundos. Se nesse intervalo um cliente pegar o mesmo horário, o CRM **não põe na agenda**: anota a tentativa na ficha, avisa quem atende por push e **cancela o agendamento novo no Calendly**, que manda ao cliente: *"Este horário acabou de ser ocupado na agenda da Imova Imobiliária. Por favor, escolha outro horário pelo mesmo link."*

**O que conta como ocupado:** reunião marcada, visita aberta e reunião com hora combinada. A tarefa "a marcar" (apresentação ainda sem data) não ocupa horário.

---

## Como funciona por dentro

```
cliente ─ link ─► Calendly ── webhook assinado ──► Edge Function calendly-webhook ──► calendly_receber
                    ▲   ▲                                                         (ficha, agenda, aviso)
                    │   └──── cancela (API) ─────────┐
                    │                                 │
      lê "Ocupado"  │                          imova-worker-wa  (a cada 15 s)
                    │                                 │
              Google Agenda ◄── grava/apaga (API) ────┘
```

- **Edge Function** `supabase/functions/calendly-webhook`: confere a assinatura do Calendly (`CALENDLY_WEBHOOK_SIGNING_KEY`) e resume o aviso.
- **Banco** `supabase/migrations/20261110180000_calendly_na_agenda.sql`: `calendly_agendamentos`, `calendly_receber`, a régua `app.agenda_ocupada` e as listas do que falta (`calendly_cancelamentos_pendentes`, `agenda_espelho_pendencias`). E `20261111204000_o_calendly_respeita_feriado_e_dono.sql`: o dia útil (`app.eh_dia_util`), quem atende (`app.calendly_pessoa_escolhida`, usada por `app.calendly_dono` e `app.calendly_pessoa_da_agenda`), o responsável da ficha, o endereço da visita pela resposta ou pelo anúncio (`app.calendly_local_da_visita`) e as funções das duas partes da tela (`calendly_quem_atende`, `calendly_quem_atende_gravar`, `calendly_cancelamentos_que_falharam`, `calendly_cancelamento_resolvido`).
- **Banco do convite** `supabase/migrations/20261111210000_o_convite_da_agenda.sql`: o convite (`agenda_convites`), o imóvel de cada visita (`visita_imoveis`), o link (`app.agenda_link_montar`, `app.url_codificar`), as portas da tela (`agenda_link_previa`, `agenda_enviar_link`, `visita_marcar_com_imovel`, `visita_definir_imovel`, `calendly_link_configurar`), a da IA (`ia_atendente_enviar_link`) e o `calendly_receber` que usa o convite.
- **Banco do espelho** `supabase/migrations/20261111205000_o_espelho_no_google.sql`: os feriados na lista do worker (`app.agenda_espelho_desejado`) e o estado do espelho para a tela (`public.agenda_espelho_estado`, só admin e gestor).
- **Site** `apps/web/src/components/agenda`: `quem-atende-o-calendly.tsx` (o campo do admin), `falhas-do-calendly.tsx` (o aviso do cancelamento que falhou), `calendly.ts` (as frases) e `cartao-do-espelho.tsx` (o cartão "Espelho no Google", só para o admin: diz em uma frase se o espelho está desligado, com erro, parado ou ligado).
- **Worker** `apps/workers/src/agenda` no `imova-worker-wa`: cancela no Calendly (`CALENDLY_TOKEN`) e grava e apaga os blocos no Google (`GOOGLE_AGENDA_CREDENCIAL`; no plano B, também `GOOGLE_AGENDA_SUB`).
- **Script** `scripts/calendly-assinar.mjs`: cria a assinatura do webhook no Calendly (não há tela para isso, só a API).
- **Script** `scripts/google-agenda-conferir.mjs`: confere, do seu computador, se a conta de serviço consegue gravar na agenda, e diz o que falta.

Os webhooks do Calendly funcionam no **plano grátis** desde 06/11/2026.

---

## Ligar (uma vez)

A ordem importa: o Calendly desliga uma assinatura que só recebe erro.

### 1. Publicar o banco da Imova

```bash
node scripts/publicar-banco.mjs imova migrar
```

A KOMUNE não precisa de nada agora. A parte comum da migração (o aviso da agenda com `origem` e `detalhe`, a origem "calendly" em reunião e tarefa, e a grade de horários livres contando a duração da visita) vai junto quando o banco da KOMUNE for publicado de novo. Até lá, a tela funciona igual lá: sem as colunas novas, ela lê o aviso do jeito antigo.

### 2. Publicar a função e o site

```bash
supabase functions deploy calendly-webhook --project-ref kkqadgxvmzulcamuakzk
```

O `supabase/config.toml` já diz `verify_jwt = false` para ela. **Publique de novo junto com o banco `20261111210000`** (o convite): a versão nova passa ao banco o `tracking.utm_content` do convidado. A ordem não quebra nada: a função velha com o banco novo só não manda o token (o agendamento entra como sem convite), e a função nova com o banco velho manda um campo que o banco ignora. O site da Imova sai como em `publicar-na-vercel.md`, de uma cópia limpa.

### 3. O Google Agenda que o Calendly confere

Com a conta Google que vai ficar ligada ao Calendly:

1. Em **calendar.google.com → Configurações → Adicionar agenda → Criar nova agenda**, crie **"CRM Imova — ocupado"**.
2. No **Google Cloud** (console.cloud.google.com), num projeto da Imova: **APIs e serviços → Biblioteca → Google Calendar API → Ativar**. Depois **IAM e administrador → Contas de serviço → Criar** (ex.: `crm-imova-agenda`, sem papel nenhum) → **Chaves → Adicionar chave → JSON**. Guarde o arquivo baixado fora do repositório.
3. De volta ao Google Agenda, nas configurações de "CRM Imova — ocupado": **Compartilhar com pessoas específicas → o e-mail da conta de serviço** (termina em `iam.gserviceaccount.com`) com **"Fazer alterações nos eventos"**. Na mesma tela, em **Integrar agenda**, copie o **ID da agenda**. Confira o **fuso** da agenda: (GMT-03:00) Fortaleza ou Brasília (o feriado de dia inteiro vale no fuso da agenda).

#### 3b. Plano B: delegação em todo o domínio

Se o compartilhamento não pegar (em 10/11/2026 ele não tinha propagado; o script de conferência diz "a agenda não foi compartilhada com a conta de serviço"), a conta de serviço pode agir **em nome de um usuário do Google Workspace da Imova**, só no escopo de eventos:

1. No Google Cloud, em **IAM e administrador → Contas de serviço → crm-imova-agenda → Detalhes**, copie o **ID exclusivo** (o *client ID*, só números; o script de conferência também mostra).
2. No **Admin do Google** (admin.google.com), com uma conta de administrador do Workspace: **Segurança → Controles de API → Delegação em todo o domínio → Adicionar novo**, com esse **client ID** e o escopo **`https://www.googleapis.com/auth/calendar.events`** (só ele). Em algumas contas o caminho é Segurança → Controle de acesso e de dados → Controles de API → Gerenciar a delegação em todo o domínio. Pode levar alguns minutos para valer.
3. Escolha o usuário em nome de quem o CRM grava: o dono da agenda "CRM Imova — ocupado" (ou alguém com "Fazer alterações nos eventos" nela). Rode a conferência com `--sub <e-mail dele>` e, dando certo, ponha `GOOGLE_AGENDA_SUB=<e-mail dele>` no `imova-worker-wa`.

Sem `GOOGLE_AGENDA_SUB`, o worker continua como antes: a conta de serviço grava em nome próprio, na agenda compartilhada com ela.

### 4. Ligar o Google ao Calendly

Em calendly.com: **Disponibilidade → Configurações da agenda → Conectar agenda → Google**, com a mesma conta. Em **"Verificar conflitos"**, marque **"CRM Imova — ocupado"** (e a agenda principal, se quiser). O plano grátis aceita uma conta de agenda; se ele não deixar escolher a agenda secundária, use a agenda principal da conta no lugar dela (passos 3 e 5 com o ID da principal, que é o próprio e-mail).

### 5. Dizer ao CRM qual é o Google Agenda e quem atende

O Google Agenda, no banco da Imova (SQL Editor do Supabase), sem apagar o resto da configuração:

```sql
insert into public.app_settings (key, value)
values ('calendly', '{"google_agenda_id": "xxxxxxxx@group.calendar.google.com"}')
on conflict (key) do update set value = public.app_settings.value || excluded.value;
```

Quem atende, pela tela: **Agenda → "Quem atende o que chega pelo Calendly"** (no pé da página, só para admin). A lista tem as pessoas ativas da equipe (admin, gestor e SDR). Por baixo, grava `dono_email` em `app_settings['calendly']`.

- A pessoa escolhida vale **antes** do e-mail do anfitrião que vem no agendamento. Sem escolha, vale o anfitrião (a pessoa do CRM com o e-mail da conta do Calendly, hoje o Rafael) e, se ele não estiver no CRM, o admin mais antigo.
- O agendamento entra na agenda dessa pessoa, e a ficha e o negócio novos ficam com ela como responsável.
- É a agenda dessa pessoa que o CRM espelha no Google.

O link que vai para o cliente, também pela tela: **Agenda → "Link do Calendly"**, ao lado de "Quem atende" (só admin, 11/11/2026). Mostra o link atual (`app_settings['calendly'].link`) e grava por `public.calendly_link_configurar`, que só aceita `https://calendly.com/...` e não mexe em `dono_email` nem em `google_agenda_id`. O campo mostra a ordem das perguntas que o preenchimento do link espera (ver [as perguntas](#as-perguntas-a-criar-no-calendly)): 1. "O que você quer marcar?" (Visita a um imóvel / Reunião), 2. "Telefone (WhatsApp)", 3. "Endereço ou código do imóvel". É esse link que o botão **"Enviar link da agenda"** de Conversas e a IA mandam ao cliente; sem ele, os dois recusam com "o link do Calendly ainda não foi cadastrado".

### 6. O token do Calendly

Em calendly.com, com a conta da Imova: **Integrações → API e webhooks → Personal access tokens → Gerar token**, com `users:read`, `webhooks:read`, `webhooks:write` e `scheduled_events:write`. Ponha no `.env.imova` (fora do git):

```
CALENDLY_TOKEN=eyJ...
```

### 7. As chaves do worker e o worker novo

O `imova-worker-wa` precisa do token do Calendly (para cancelar) e da chave do Google (para o espelho). Num arquivo temporário, fora do repositório:

```
CALENDLY_TOKEN=eyJ...
GOOGLE_AGENDA_CREDENCIAL=<o JSON da conta de serviço em base64: base64 -i chave.json>
```

```bash
fly secrets import --app imova-worker-wa < segredos-calendly.env && rm segredos-calendly.env
```

Depois publique o worker com o código novo, como de costume. No log dele aparece *"agenda do Calendly ligada neste worker"*.

### 8. Criar a assinatura do webhook

```bash
node scripts/calendly-assinar.mjs estado    # confere a conta e se a função está no ar
node scripts/calendly-assinar.mjs assinar
```

### 9. Testar

1. Marque um horário pelo link do Calendly numa janela anônima: em segundos ele aparece na Agenda de quem atende.
2. Marque uma visita direto no CRM, na agenda dessa pessoa: em até um minuto o bloco "Ocupado — CRM Imova" aparece no Google Agenda e o horário some do Calendly.
3. Desmarque essa visita no CRM: o bloco sai e o horário volta.
4. Os feriados: em até um minuto depois de ligar, o Google Agenda mostra "Ocupado — feriado" em 20/11 e 21/11 (dia inteiro), e o link do Calendly não oferece esses dias.
5. O link pessoal: numa conversa de teste (com mensagem do cliente nas últimas 24 h), toque em **"Enviar link da agenda"** → Visita → um anúncio. Abra o link no celular do cliente de teste: o nome, "Visita a um imóvel", o telefone e o imóvel já vêm preenchidos. Marque com **outro e-mail**: a visita entra na ficha da conversa, com o código e o endereço do anúncio, e a nota diz "Pelo link que … mandou na conversa". Se a opção ou o telefone não vierem marcados, veja [as perguntas](#as-perguntas-a-criar-no-calendly).

---

## Ligar o espelho no Google (o que falta, em 11/11/2026)

O código do espelho está pronto, mas **desligado**: sem ele, o que a equipe marca no CRM continua livre no Calendly, o cliente escolhe o horário, recebe "confirmado" e, segundos depois, "cancelado" (a rede de segurança). O cartão **"Espelho no Google"** no topo da Agenda (só o admin vê) diz em que pé está:

| O cartão diz | O que fazer |
| --- | --- |
| "Espelho no Google desligado: falta o id da agenda" | Os passos abaixo, do 1 ao 6. |
| "Com erro desde 10/11 15h: a agenda recusou (403). Rode a conferência" | O passo 2: o script diz o motivo e o que mudar. |
| "Espelho parado: o worker não passa desde …" | O id está gravado, mas o `imova-worker-wa` não passa: falta `GOOGLE_AGENDA_CREDENCIAL` (ou ela é inválida), ou o worker caiu. Veja `fly logs --app imova-worker-wa`. |
| "Ligado: 12 horários copiados e 3 feriados, o último às 14h10" | Nada. |

Antes, o banco da Imova precisa da migração `20261111205000_o_espelho_no_google.sql` (`node scripts/publicar-banco.mjs imova migrar`), e o site, do cartão. Depois, na ordem:

1. **Conferir o compartilhamento** da agenda "CRM Imova — ocupado" com `crm-imova-agenda@crm-imova-agenda.iam.gserviceaccount.com`, com **"Fazer alterações nos eventos"** (passo 3.3). Se não pegar, ligue a **delegação em todo o domínio** (passo 3b).
2. **Rodar a conferência** no Terminal, na pasta do CRM, com o arquivo da chave que o Google Cloud baixou (o script nunca mostra o conteúdo dele):

   ```bash
   node scripts/google-agenda-conferir.mjs ~/Downloads/crm-imova-agenda-XXXX.json
   # plano B, em nome de um usuário do Workspace:
   node scripts/google-agenda-conferir.mjs ~/Downloads/crm-imova-agenda-XXXX.json --sub voce@imovaimobiliaria.com.br
   ```

   Ele confere, nesta ordem: a credencial é lida; o token sai; a agenda abre e a conta pode mudar eventos; dá para gravar (cria um evento de teste em 04/01, daqui a dez anos, às 3h, e apaga). No primeiro que falhar, ele para e diz o que fazer ("a agenda não foi compartilhada com a conta de serviço", "a conta tem só leitura: falta 'Fazer alterações nos eventos'", "a delegação em todo o domínio não está ligada para este escopo", "a API do Google Agenda não está ativada"…). Sem o arquivo, ele lê `GOOGLE_AGENDA_CREDENCIAL` do ambiente. Rode de novo até dar "Tudo certo".
3. **Gravar o `google_agenda_id`** no banco da Imova (SQL Editor do Supabase do projeto da Imova). Este SQL junta o id ao que já existe em `app_settings['calendly']` (o `dono_email` fica):

   ```sql
   insert into public.app_settings (key, value)
   values ('calendly', '{"google_agenda_id":"c_f19a6b93d8540370fd77d78a27ee3ee0c4c6d5453aa7107ab30cce60aace2e85@group.calendar.google.com"}')
   on conflict (key) do update
     set value = public.app_settings.value || excluded.value, updated_at = now();
   ```

4. **Só no plano B:** pôr o usuário no worker (o valor não é segredo, mas fica com os outros):

   ```bash
   fly secrets set --app imova-worker-wa GOOGLE_AGENDA_SUB=voce@imovaimobiliaria.com.br
   ```

5. **Publicar o worker** (da raiz, de uma cópia limpa do commit): `fly deploy . --config infra/nuvem/fly.imova-worker-wa.toml --dockerfile apps/workers/Dockerfile`. No log da partida aparece "agenda do Calendly ligada neste worker" com `credencialDoGoogleLida: true`; na primeira passada, **"espelho no Google ligado"**. Se aparecer **"espelho desligado: falta google_agenda_id em app_settings[calendly]"**, o passo 3 não entrou (o log diz isso uma vez, e de novo só quando muda).
6. **Fazer o teste 9.2** (visita marcada no CRM some do Calendly em até um minuto), o 9.3 e o 9.4 (os feriados).

---

## Como deixar o Calendly do jeito que o CRM entende

O plano grátis tem **um tipo de evento ativo**. Use um só (ex.: "Agendamento Imova").

### As perguntas a criar no Calendly

No cartão do evento: **Editar → Perguntas para o convidado → Adicionar nova pergunta**. Crie as três **nesta ordem, logo depois de Nome e E-mail, e nenhuma outra antes delas**:

| # | Pergunta (o texto exato) | Tipo no Calendly | Obrigatória | Opções (o texto exato, nesta ordem) |
| --- | --- | --- | --- | --- |
| 1 | **O que você quer marcar?** | **Lista suspensa** (ou "Uma opção", ver abaixo) | sim | **Reunião** · **Visita a um imóvel** |
| 2 | **Telefone (WhatsApp)** | **Número de telefone** | sim | — |
| 3 | **Endereço ou código do imóvel** | **Uma linha** | não | — |

E o **idioma do convidado em Português (Brasil)**: ⋮ no cartão do evento → "Alterar idioma do convidado" (o idioma da conta não muda a página do cliente).

**Por que a ordem importa.** O link pessoal preenche as respostas pela **posição** da pergunta, e não pelo texto dela: o Calendly chama a primeira pergunta personalizada de `a1`, a segunda de `a2`, a terceira de `a3` (help.calendly.com, "How to pre-fill invitee information": "The order of your questions in Calendly determines which field maps to each label"). O CRM manda `a1` = o tipo, `a2` = o telefone, `a3` = o imóvel (`app_settings['calendly'].perguntas` = `{"tipo": "a1", "telefone": "a2", "imovel": "a3"}`). Se alguém puser uma pergunta antes delas, ou trocar a ordem, o telefone cai no campo do imóvel. Para mudar a ordem no Calendly, mude também `perguntas` (SQL Editor, `update public.app_settings set value = value || '{"perguntas": {...}}' where key = 'calendly'`).

**Por que o texto das opções importa.** O tipo vai no link com o texto exato da opção (`opcoes` = `{"visita": "Visita a um imóvel", "reuniao": "Reunião"}`), e é por ele que o Calendly marca a opção. A ajuda do Calendly diz que a **lista suspensa** se preenche pelo texto da opção; para **"Uma opção" (botões)** ela mostra o número da opção (`a1=2`). Por isso a recomendação é a lista suspensa. Se preferir os botões e o link não marcar a opção sozinho, troque `opcoes` para os números: `{"visita": "2", "reuniao": "1"}` (a ordem das opções acima). De todo jeito, no link pessoal o tipo que vale é o do convite: se a opção não vier marcada, o cliente escolhe, e o CRM entra com o tipo certo.

**O telefone.** Vai no link como `+5584…` (codificado `%2B5584…`). A ajuda do Calendly mostra só números (`a1=1234567890`); confira, no primeiro teste, se o campo "Número de telefone" fica com o Brasil e o número. Se não ficar, o cliente digita: é obrigatório.

| No Calendly | O que o CRM faz |
| --- | --- |
| **"O que você quer marcar?"** | Sem convite: quem escolhe a opção que começa com "Visita" entra como **visita**; o resto, como **reunião**. Com convite, vale o tipo do convite |
| **"Telefone (WhatsApp)"**, obrigatória | Sem convite, o telefone liga o agendamento à ficha e à conversa do cliente (sem ele, a ficha é procurada só pelo e-mail). Com convite, completa a ficha que não tinha telefone |
| **"Endereço ou código do imóvel"**, opcional | No link pessoal, vem preenchida com "IM0003 · Rua X, 10, Ponta Negra, Natal". Sem convite, na visita: com o código de um anúncio da Imova (IM0003, SA0012, TE…, CO…, com ou sem os zeros), o imóvel é o **anúncio**; com um endereço escrito, é o endereço. Qualquer pergunta com "endereço", "imóvel" ou "código" no texto serve |
| Local Google Meet ou Zoom | Reunião **on-line**, com o botão "Entrar na sala" |
| Local presencial (endereço) | **Presencial**, com o endereço (na visita, o imóvel vale por cima dele) |
| Relógio de 24 h | A página mostra "14:30" |
| Duração 45 min (a visita do CRM dura 45; a reunião, 40) | O compromisso ocupa a agenda pelo tempo que o Calendly marcou |
| Horário: seg. a sex., 9h30–17h45 (o último começa às 17h00, como na grade do CRM), 10 min depois de cada evento, 3 h de antecedência | As mesmas regras da agenda do CRM. Feriado o Calendly não conhece: o CRM recusa e cancela. Para o cliente nem ver o feriado, bloqueie a data em **Disponibilidade → Datas específicas** |

Num plano pago, um tipo de evento com "Visita" no nome também entra como visita.

---

## O link pessoal (o convite da Agenda)

**Quem manda:** a IA que atende, quando o cliente quer marcar (`ia_atendente_enviar_link`), ou uma pessoa da equipe, pelo botão **"Enviar link da agenda"** em Conversas (`agenda_link_previa` mostra o texto, `agenda_enviar_link` manda). A pessoa pode escrever o começo da mensagem; o CRM acrescenta sempre a linha do imóvel (na visita) e o link. A IA nunca escreve o link: se o modelo escrever um, ele sai do texto.

**A mensagem**, por exemplo:

```
Para marcar a visita, é só escolher o melhor dia e horário pelo link abaixo. Seus dados já vão preenchidos.

Imóvel: IM0003 · Rua X, 10, Ponta Negra, Natal
https://calendly.com/contato-imovaimobiliaria/30min?name=Maria%20Souza&a1=Visita%20a%20um%20im%C3%B3vel&a2=%2B5584999991234&a3=IM0003%20%C2%B7%20Rua%20X…&utm_source=crm&utm_medium=whatsapp&utm_campaign=ia&utm_content=k3p9x2m7q1za
```

**As regras do envio:**
- A visita precisa de imóvel: um anúncio da Imova no ar, em rascunho ou pausado (excluído, não). Fora do ar, o envio passa com o aviso "o anúncio não está no ar". Anúncio sem endereço não serve.
- O link é texto livre: só sai dentro da janela de 24 h desde a última mensagem do cliente, e pela porteira de sempre (contato suprimido, conversa bloqueada, horário). A pessoa precisa poder escrever na conversa.
- O link usa `app_settings['calendly'].link` (hoje `https://calendly.com/contato-imovaimobiliaria/30min`), trocado pelo admin no campo do link do Calendly na Agenda. Num plano pago, com um evento por tipo, `link_visita` e `link_reuniao` valem no lugar dele.

**O token.** Cada envio cria um convite (`agenda_convites`) com um token de 12 letras e números, que vai no link como `utm_content`. O Calendly guarda os UTM do convidado e devolve no aviso (`tracking.utm_content`), e a função `calendly-webhook` passa o token ao banco. Com ele:
- a **ficha** é a da conversa em que o link foi mandado, sem depender de casar e-mail ou telefone (o cliente pode escrever outro e-mail);
- o **tipo** é o do convite, mesmo que o cliente mude a resposta;
- na visita, o **imóvel** é o do convite (`visita_imoveis`, origem "convite");
- a reunião fica ligada à conversa (o lembrete da véspera vai para ela).

**Quanto vale:** uma vez, por 30 dias. Usado por outra pessoa, vencido ou com o token errado, o agendamento entra como hoje (sem convite). O mesmo cliente **remarcando** continua com ele. Quando o Calendly **cancela** (o cliente, a equipe pelo CRM, ou o CRM pedindo pelo feriado ou horário ocupado), o convite volta a valer, e o mesmo link serve de novo. Feriado e horário ocupado continuam recusando como antes.

**O que a IA vê:** a entrada dela traz `convites_da_agenda`, os 5 links mais novos da conversa (tipo, código do imóvel, quando, e se o cliente já agendou), para não mandar o mesmo link de novo. A resposta dela fica em `ia_respostas` com a ação `enviou_link`, e o convite com `pela_ia` (é o que conta "as visitas da IA").

**A visita marcada pela Agenda** (Novo compromisso) também tem imóvel: `visita_marcar_com_imovel` exige o anúncio ou o endereço escrito. O botão "Definir imóvel" (`visita_definir_imovel`) corrige o imóvel de qualquer visita.

**LGPD:** o link do convite leva o nome e o telefone do cliente. O dossiê do titular mostra os convites e os imóveis das visitas dele; 90 dias depois de o convite vencer, o link fica só com a base (sem nome, telefone, imóvel nem token); a ficha anonimizada perde os convites; o endereço escrito à mão (o imóvel sem anúncio) sai 12 meses depois da visita.

---

## O que acontece em cada caso

- **Horário livre:** entra na agenda, com aviso, push, e-mail (reunião) e nota na ficha.
- **Horário ocupado (o caso raro do intervalo):** não entra; nota na ficha, push a quem atende, e o Calendly cancela e pede outro horário ao cliente.
- **Sábado, domingo ou feriado:** não entra; nota na ficha e push a quem atende ("O Calendly marcou num feriado (20/11); o CRM pediu o cancelamento"), e o Calendly cancela com o recado *"Este dia é feriado e a Imova Imobiliária não atende. Por favor, escolha outro dia pelo mesmo link."* (no fim de semana: *"A Imova Imobiliária não atende aos sábados e domingos…"*).
- **Visita pelo link pessoal (com convite):** a ficha é a da conversa, mesmo que o cliente escreva outro e-mail; o tipo e o imóvel são os do convite, e a ficha ganha o telefone e o e-mail que não tinha. A nota diz "Pelo link que <nome> mandou na conversa" (ou "a IA").
- **Visita sem convite, com a resposta "Endereço ou código do imóvel":** com o código de um anúncio, o imóvel é o do anúncio; com um endereço escrito, é o endereço.
- **Visita sem imóvel** (sem convite, e sem código nem endereço na resposta; o local do evento, como o escritório ou o Google Meet, não conta como imóvel): a Agenda mostra **"Falta o imóvel"** com o botão "Definir imóvel", e quem atende ganha a tarefa **"Confirmar o imóvel da visita com <cliente>"** (uma só por cliente, enquanto estiver aberta; ela se fecha sozinha quando a última visita do cliente ganha o imóvel). O lembrete da véspera usa o imóvel definido.
- **O cliente cancelou:** a reunião é cancelada (com o e-mail de cancelamento), a visita sai da agenda, push "Cancelado pelo Calendly" e nota com o motivo.
- **O cliente remarcou:** o horário velho fecha e o novo entra com o selo "Reagendada" (na reunião e, desde o acabamento de 11/11, também na visita); o aviso diz de quando era. A visita nova continua com o convite e com o imóvel da velha.
- **A equipe desmarcou pelo CRM:** o Calendly cancela, avisa o cliente e libera o horário. Se a equipe remarcou, o recado ao cliente diz que a Imova vai combinar o novo horário.
- **Cliente que pediu para não ser contatado:** não entra na agenda (a regra da LGPD do CRM). Fica registrado como `suprimido`.
- **O mesmo aviso duas vezes:** o segundo vira "repetido", sem nada duplicado.

---

## O que a tela diz e o que a LGPD guarda

O acabamento de 11/11/2026 (`20261111211000` e site):

- **Cancelar o que a equipe marcou** diz, no diálogo, *"O bloco 'Ocupado' sai do Google Agenda, e o horário volta a ficar livre para o cliente no Calendly"* só quando é verdade: o compromisso está na agenda de quem atende o Calendly e o espelho está ligado (`public.calendly_agenda_do_link`). Noutra agenda, ou com o espelho desligado, o diálogo não fala do Calendly. A apresentação "a marcar" diz que não segurava horário.
- **Remarcar uma reunião que o cliente marcou pelo Calendly** avisa antes, na folha: o CRM cancela o agendamento lá, e o Calendly manda ao cliente *"A Imova Imobiliária remarcou este compromisso e vai combinar o novo horário com você."* Quem remarca manda o horário novo pelo WhatsApp.
- **O conflito do "Novo compromisso"** diz "(marcado pelo Calendly)" ao lado do que o cliente marcou pelo link.
- **E-mail:** enquanto a Imova não tiver o Resend, a Agenda não diz "O time é avisado por e-mail" nem acusa "O time não foi avisado por e-mail". Para ligar, além da `RESEND_API_KEY` e do texto sem a KOMUNE, trocar `emailDeReuniao` para `true` na Imova em `packages/schema/src/empresas.ts` e publicar o site.
- **LGPD do `calendly_agendamentos`:** o dossiê (`exportar_lgpd`) traz os agendamentos do titular (quando, o quê, o local, as respostas e o cancelamento; sem os links de cancelar e remarcar, sem as URIs e sem os compromissos de outras pessoas). O agendamento sai **2 anos** depois da data marcada (ou da última mudança), pelo pg_cron `calendly_retencao`, com relatório em `retention_runs`. O pedido de eliminação (`erasure_request`/`erasure_done`) da ficha, ou da pessoa ligada a ela, apaga as respostas, o local, a sala, os links e o motivo; ficam a data, a situação e as URIs, para o CRM ainda conseguir cancelar no Calendly o que está de pé.

---

## Quando der problema

| Sinal | O que fazer |
| --- | --- |
| `estado` diz "NÃO responde" | A função não está publicada: passo 2. |
| `estado` mostra a assinatura `disabled` | O Calendly desligou depois de muitas falhas. Veja o log da função e rode `trocar`. |
| Log da função: `recusa: assinatura_invalida` | A chave da função não é a da assinatura. Rode `trocar`. |
| Log da função: `integracao_nao_configurada` (503) | Falta `CALENDLY_WEBHOOK_SIGNING_KEY`. Rode `remover` e depois `assinar`. |
| Horário marcado no CRM continua livre no Calendly | Olhe o cartão "Espelho no Google" na Agenda e rode `node scripts/google-agenda-conferir.mjs <chave.json>`. No log do `imova-worker-wa`: "espelho desligado: falta google_agenda_id…" (passo 3 de "Ligar o espelho"), "o Google não gravou o bloco" (agenda não compartilhada com a conta de serviço, Google 404, ou só leitura, Google 403). Também: `dono_email` errado (a agenda espelhada é de outra pessoa) ou a agenda não marcada em "Verificar conflitos" no Calendly. |
| O Calendly ainda oferece um feriado | O feriado está em Ajustes → Catálogos → Feriados (`public.holidays`)? O cartão diz quantos feriados foram copiados. No Google Agenda, o bloco "Ocupado — feriado" do dia tem de estar como **Ocupado** (o CRM grava assim); se a agenda estiver num fuso que não é o de Natal, o dia inteiro cai deslocado. |
| Cliente recusado continua com o agendamento no Calendly | Log do worker: "o Calendly não cancelou". Token sem `scheduled_events:write` (403) ou vencido (401). O CRM tenta de novo, com espera, até 8 vezes; o erro fica em `calendly_agendamentos.cancelar_erro`. |
| Aviso **"Não consegui cancelar no Calendly o agendamento de…"** no topo da Agenda | O CRM esgotou as tentativas (ou o Calendly recusou de vez). Aparece para o dono do agendamento e os admins. Cancele em **calendly.com → Eventos agendados** (o botão "Abrir o Calendly" leva lá), avise o cliente e toque em **"Já cancelei e avisei"**. Cancelado lá, o aviso também sai sozinho. Se for o token, troque-o (passo 6). |
| Tudo cai na agenda do Rafael | Ninguém foi escolhido em "Quem atende o que chega pelo Calendly" (Agenda, admin), ou o e-mail gravado não é de ninguém ativo (o campo avisa). |

Trocar a chave do webhook sem perder agendamento no meio: `node scripts/calendly-assinar.mjs trocar`. Desligar: `node scripts/calendly-assinar.mjs remover` (os agendamentos já recebidos ficam). Os blocos "Ocupado — CRM Imova" que sobrarem no Google Agenda saem pelo próprio Google Agenda.

---

## A IA que atende manda o link

Desde `atendente-imova@v3` (11/11/2026, "a visita pelo link"), a IA que atende **não marca visita sozinha**. Quando o cliente quer visitar um imóvel ou conversar com um corretor, ela escreve uma ou duas frases e o CRM põe embaixo a linha do imóvel (código e endereço, na visita) e o link pessoal do Calendly (`public.ia_atendente_enviar_link`). Quem escolhe o horário é o cliente.

| O cliente… | A IA |
| --- | --- |
| quer visitar um imóvel da lista que está no ar | manda o link da **visita**, com o código do imóvel |
| quer visitar e não disse qual imóvel | pergunta qual (o bairro ou onde viu o anúncio), sem link |
| fala de um imóvel que não está na lista | pergunta onde viu o anúncio; se ainda não der para saber, passa para o corretor |
| quer visitar um imóvel em rascunho ou pausado, ou mais de um imóvel | passa para o corretor, que confirma e combina |
| é o proprietário e quer anunciar, vender, alugar ou avaliar | manda o link da **reunião** |
| pede para marcar uma conversa com um corretor | manda o link da **reunião** |
| pede corretor agora, ligação, quer negociar, remarcar ou cancelar | passa para o corretor |
| propõe dia e hora ("amanhã às 10h") | manda o link e diz que lá ele vê se o horário está livre; nunca confirma |
| já recebeu o mesmo link há menos de 24 h e não agendou | não manda de novo; manda só se ele pedir ou mudar de imóvel |
| já agendou a visita a esse imóvel | não manda outro link |

Quando o banco recusa o link: "visita sem imóvel" ou "imóvel desconhecido" viram uma pergunta curta ao cliente sobre qual é o imóvel; "sem link configurado" e as outras recusas passam a conversa para o corretor, com o motivo. A IA nunca escreve endereço de site: se o modelo escrever, o worker tira antes de mandar.

**Conferir com o modelo de verdade** (11 cenários, com conversas e imóveis de mentira; nada sai para cliente nenhum): na pasta do CRM, com `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` e `ANTHROPIC_API_KEY` no ambiente (o banco local serve; as chamadas ficam em `ai_runs` dele),

```bash
pnpm -C apps/workers dev ai --ensaio=atendente-imova
```

O comando imprime cada cenário com ✓ ou ✗, a resposta do modelo, o que errou e o custo, e sai com 1 se algum errou. Os mesmos cenários rodam sem rede no `pnpm -C packages/prompts test`.
