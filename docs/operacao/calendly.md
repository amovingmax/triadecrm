# Calendly na Agenda da Imova

Quem abre o link do Calendly da Imova vê os horários livres, escolhe um e marca uma reunião ou uma visita. Segundos depois, o CRM da Imova:

- põe o compromisso na **Agenda** de quem atende (reunião ou visita, com a sala do Meet ou o endereço);
- mostra o aviso **"Novo agendamento pelo Calendly"** no topo da Agenda e do Meu dia, até a pessoa tocar em "Ok, vi";
- manda o **push** para o celular de quem atende (quem tem o app) e, na reunião, o **e-mail** de reunião marcada (só quando o `imova-worker-wa` tiver a `RESEND_API_KEY`, que hoje ele não tem: o texto do e-mail ainda é o da KOMUNE);
- acha a **ficha** do cliente pelo telefone ou pelo e-mail, ou cria uma de Cliente (origem "Calendly"), e anota o agendamento nela;
- leva o negócio para a etapa que pede data (**Visita marcada** em Clientes, **Avaliação marcada** em Captação).

**Duas pessoas nunca ficam no mesmo horário.** Horário ocupado não aparece para o cliente no Calendly, e só volta a aparecer quando o compromisso que estava nele é desmarcado.

Nada vai pelo WhatsApp. Só a Imova tem isso; a KOMUNE não.

---

## Como o horário fica indisponível

| O horário foi ocupado por… | Como o Calendly esconde |
| --- | --- |
| outro cliente, pelo próprio Calendly | O Calendly já faz isso sozinho. |
| a equipe ou a IA, direto no CRM | O CRM grava um bloco **"Ocupado — CRM Imova"** num Google Agenda ligado ao Calendly, e o Calendly não oferece esse horário. Só início e fim vão ao Google: nenhum nome, telefone ou endereço. |

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
- **Banco** `supabase/migrations/20261110180000_calendly_na_agenda.sql`: `calendly_agendamentos`, `calendly_receber`, a régua `app.agenda_ocupada` e as listas do que falta (`calendly_cancelamentos_pendentes`, `agenda_espelho_pendencias`).
- **Worker** `apps/workers/src/agenda` no `imova-worker-wa`: cancela no Calendly (`CALENDLY_TOKEN`) e grava e apaga os blocos no Google (`GOOGLE_AGENDA_CREDENCIAL`).
- **Script** `scripts/calendly-assinar.mjs`: cria a assinatura do webhook no Calendly (não há tela para isso, só a API).

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

O `supabase/config.toml` já diz `verify_jwt = false` para ela. O site da Imova sai como em `publicar-na-vercel.md`, de uma cópia limpa.

### 3. O Google Agenda que o Calendly confere

Com a conta Google que vai ficar ligada ao Calendly:

1. Em **calendar.google.com → Configurações → Adicionar agenda → Criar nova agenda**, crie **"CRM Imova — ocupado"**.
2. No **Google Cloud** (console.cloud.google.com), num projeto da Imova: **APIs e serviços → Biblioteca → Google Calendar API → Ativar**. Depois **IAM e administrador → Contas de serviço → Criar** (ex.: `crm-imova-agenda`, sem papel nenhum) → **Chaves → Adicionar chave → JSON**. Guarde o arquivo baixado fora do repositório.
3. De volta ao Google Agenda, nas configurações de "CRM Imova — ocupado": **Compartilhar com pessoas específicas → o e-mail da conta de serviço** (termina em `iam.gserviceaccount.com`) com **"Fazer alterações nos eventos"**. Na mesma tela, em **Integrar agenda**, copie o **ID da agenda**.

### 4. Ligar o Google ao Calendly

Em calendly.com: **Disponibilidade → Configurações da agenda → Conectar agenda → Google**, com a mesma conta. Em **"Verificar conflitos"**, marque **"CRM Imova — ocupado"** (e a agenda principal, se quiser). O plano grátis aceita uma conta de agenda; se ele não deixar escolher a agenda secundária, use a agenda principal da conta no lugar dela (passos 3 e 5 com o ID da principal, que é o próprio e-mail).

### 5. Dizer ao CRM de quem é a agenda e qual é o Google Agenda

No banco da Imova (SQL Editor do Supabase):

```sql
insert into public.app_settings (key, value)
values ('calendly', '{"dono_email": "quem-atende@imovaimobiliaria.com.br",
                      "google_agenda_id": "xxxxxxxx@group.calendar.google.com"}')
on conflict (key) do update set value = excluded.value;
```

`dono_email` é o e-mail, **no CRM**, de quem atende pelo Calendly. É a agenda dessa pessoa que o CRM espelha.

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

---

## Como deixar o Calendly do jeito que o CRM entende

O plano grátis tem **um tipo de evento ativo**. Use um só (ex.: "Agendamento Imova") com estas perguntas:

| No Calendly | O que o CRM faz |
| --- | --- |
| Pergunta de múltipla escolha **"O que você quer marcar?"** com as opções **"Reunião"** e **"Visita a um imóvel"** | Quem escolhe a opção que começa com "Visita" entra como **visita**; o resto, como **reunião** |
| Pergunta **"Telefone (WhatsApp)"**, obrigatória | O telefone liga o agendamento à ficha e à conversa do cliente |
| Local Google Meet ou Zoom | Reunião **on-line**, com o botão "Entrar na sala" |
| Local presencial (endereço) | **Presencial**, com o endereço |
| Idioma do convidado **Português (Brasil)** (⋮ no cartão do evento → "Alterar idioma do convidado"; o idioma da conta não muda a página do cliente) e relógio de 24 h | A página fala português e mostra "14:30" |
| Duração 45 min (a visita do CRM dura 45; a reunião, 40) | O compromisso ocupa a agenda pelo tempo que o Calendly marcou |
| Horário: seg. a sex., 9h30–17h45 (o último começa às 17h00, como na grade do CRM), 10 min depois de cada evento, 3 h de antecedência | As mesmas regras da agenda do CRM |

Num plano pago, um tipo de evento com "Visita" no nome também entra como visita.

---

## O que acontece em cada caso

- **Horário livre:** entra na agenda, com aviso, push, e-mail (reunião) e nota na ficha.
- **Horário ocupado (o caso raro do intervalo):** não entra; nota na ficha, push a quem atende, e o Calendly cancela e pede outro horário ao cliente.
- **O cliente cancelou:** a reunião é cancelada (com o e-mail de cancelamento), a visita sai da agenda, push "Cancelado pelo Calendly" e nota com o motivo.
- **O cliente remarcou:** o horário velho fecha e o novo entra com o selo "Reagendada"; o aviso diz de quando era.
- **A equipe desmarcou pelo CRM:** o Calendly cancela, avisa o cliente e libera o horário. Se a equipe remarcou, o recado ao cliente diz que a Imova vai combinar o novo horário.
- **Cliente que pediu para não ser contatado:** não entra na agenda (a regra da LGPD do CRM). Fica registrado como `suprimido`.
- **O mesmo aviso duas vezes:** o segundo vira "repetido", sem nada duplicado.

---

## Quando der problema

| Sinal | O que fazer |
| --- | --- |
| `estado` diz "NÃO responde" | A função não está publicada: passo 2. |
| `estado` mostra a assinatura `disabled` | O Calendly desligou depois de muitas falhas. Veja o log da função e rode `trocar`. |
| Log da função: `recusa: assinatura_invalida` | A chave da função não é a da assinatura. Rode `trocar`. |
| Log da função: `integracao_nao_configurada` (503) | Falta `CALENDLY_WEBHOOK_SIGNING_KEY`. Rode `remover` e depois `assinar`. |
| Horário marcado no CRM continua livre no Calendly | Veja o log do `imova-worker-wa` ("o Google não gravou o bloco"). Os motivos de sempre: agenda não compartilhada com a conta de serviço (Google 404), `google_agenda_id` ou `dono_email` errados, ou a agenda não marcada em "Verificar conflitos" no Calendly. |
| Cliente recusado continua com o agendamento no Calendly | Log do worker: "o Calendly não cancelou". Token sem `scheduled_events:write` (403) ou vencido (401). O CRM tenta de novo, com espera, até 8 vezes; o erro fica em `calendly_agendamentos.cancelar_erro`. |

Trocar a chave do webhook sem perder agendamento no meio: `node scripts/calendly-assinar.mjs trocar`. Desligar: `node scripts/calendly-assinar.mjs remover` (os agendamentos já recebidos ficam). Os blocos "Ocupado — CRM Imova" que sobrarem no Google Agenda saem pelo próprio Google Agenda.
