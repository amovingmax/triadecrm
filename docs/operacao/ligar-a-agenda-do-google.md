# Ligar a agenda do Google — o que falta fora do código

O CRM já sabe criar evento, gerar link do Meet, convidar o fornecedor e ligar os
lembretes de 24 h e 1 h. **Nada disso funciona até três chaves serem viradas fora
do repositório**, e nenhuma delas é programação. Esta página é o passo a passo.

Enquanto não forem viradas, o botão "Pôr na agenda" aparece e responde
*"A integração com o Google ainda não foi configurada no servidor"* ou
*"A API do Google Agenda ainda não está habilitada"*. Ninguém fica no escuro.

---

## 1. Habilitar a API do Google Agenda (Luiz)

No **Google Cloud Console**, no MESMO projeto onde já existe o cliente OAuth do
login do Tríade:

1. **APIs e serviços → Biblioteca**
2. Procure **Google Calendar API**
3. **Ativar**

Se o CRM tentar criar um evento sem isso, o Google responde 403 com
`accessNotConfigured`, e a tela mostra *"Peça ao Luiz para habilitar"*.

## 2. Declarar o escopo na tela de consentimento (Luiz)

Ainda no Google Cloud Console:

1. **APIs e serviços → Tela de permissão OAuth → Escopos**
2. Adicionar: `https://www.googleapis.com/auth/calendar.events`
3. Salvar

Esse escopo é o mínimo que serve: cria e altera eventos, **não** lê a agenda
inteira da pessoa. Pedir `calendar` (leitura completa) daria ao CRM acesso a
compromissos particulares que ele não precisa ver.

> A tela de consentimento passa a mostrar "Ver e editar eventos da sua agenda"
> quando alguém conectar. É esperado, e é o que dá para explicar à equipe.

## 3. Pôr as credenciais na Vercel (Luiz ou Matheus)

O servidor precisa do par do OAuth para trocar o consentimento de longa duração
por um acesso de uma hora, a cada evento criado. São os **mesmos valores** já
usados no login do Supabase — em **Google Cloud Console → Credenciais → o cliente
OAuth do Tríade**.

Em **Vercel → projeto triade-crm → Settings → Environment Variables**, ambiente
**Production**, tipo **Sensitive** (não `Config`: estas não são `NEXT_PUBLIC_`):

| Nome | Valor |
| --- | --- |
| `GOOGLE_CLIENT_ID` | o Client ID do cliente OAuth |
| `GOOGLE_CLIENT_SECRET` | o Client secret do mesmo cliente |
| `SUPABASE_SERVICE_ROLE_KEY` | a service_role do projeto `komune-crm` |

Depois de salvar, **refazer o deploy** — variável nova só entra em build novo.

> A `SUPABASE_SERVICE_ROLE_KEY` ignora a RLS. Ela existe aqui por um motivo só:
> ler o refresh token guardado no Vault, que é justamente o que a pessoa logada
> não pode alcançar. Nenhuma outra parte do CRM a usa.

---

## Como saber que funcionou

1. Entre no CRM e vá em **Agenda**
2. No pé da tela: **"Google Agenda não conectado" → Conectar**
3. O Google abre. **Escolha a mesma conta com que você entrou no CRM** — outra
   conta troca a sua sessão. Confirme a permissão de agenda.
4. Volta para a Agenda com *"Agenda conectada"* e o e-mail da conta
5. Num compromisso com hora marcada, **"Pôr na agenda"**
6. Confira no Google: o evento está lá, com Meet, com o convite enviado e com os
   dois lembretes

## Se der errado, o que cada recado quer dizer

| O que a tela diz | Quem resolve |
| --- | --- |
| "A integração ainda não foi configurada no servidor" | Passo 3 acima |
| "A API do Google Agenda ainda não está habilitada" | Passo 1 acima |
| "A conta conectada não concedeu permissão para a agenda" | A pessoa: desconectar e conectar de novo, marcando a permissão |
| "O Google não aceita mais o acesso desta conta" | A pessoa: reconectar (acesso revogado, senha trocada, ou token velho) |
| "O Google não devolveu a permissão de longa duração" | A pessoa: conectar de novo. Acontece quando a conta já tinha autorizado antes e o Google pula a tela de consentimento |

---

## Duas coisas que quem usa precisa saber

**O convite só sai se o parceiro tiver e-mail na ficha.** Sem e-mail, o evento é
criado só na agenda de quem clicou, e o aviso diz isso — o link do Meet vai por
WhatsApp ou pela ligação, como já acontece hoje. Hoje, das 100 fichas em
produção, quase nenhuma tem e-mail.

**Visita não vira Meet.** Numa visita presencial o evento vai com bairro e cidade
no lugar do local, sem sala e sem convite: quem vai é uma pessoa, de carro.

---

## O que ainda NÃO existe

**Sugerir horário livre.** A tela não consulta a sua agenda para dizer "terça às
15h está vago". Marcar a hora continua sendo decisão de quem está na ligação, e
o CRM só registra e espelha. Isso é a segunda metade do RF-AGE-02 e ficou de
fora desta entrega de propósito: exige o escopo de LEITURA da agenda, que é
bem mais invasivo, e ninguém pediu.
