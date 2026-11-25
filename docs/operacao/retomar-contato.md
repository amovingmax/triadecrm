# A IA retoma o contato com quem parou de responder (Imova)

Construída em 11/11/2026 (branch `ia-retomar-contato`) e trazida para a main em 25/11/2026
(branch `ia-retomada`, migração `20261125150000`, texto `retomar-conversa@v2`): a IA que atende
manda **uma** mensagem ao cliente que parou de responder, cerca de 20 h depois da última mensagem
dele, ainda dentro das 24 h grátis do WhatsApp. Nasce **desligada**. Só existe na Imova; na KOMUNE
a migração não cria nada.

## As decisões do dono (valem sobre o resto deste guia)

- **Uma retomada só** (16/11 e 24/11): o padrão de dias é `[1]`, o texto da IA. Os dias 3 e 7
  (modelos pagos da Meta) continuam possíveis pela tela, mas não vêm ligados.
- **Com um gancho do imóvel** (24/11): um ponto forte tirado do anúncio (título, descrição e
  características, que o worker manda sem preço, sem código e sem telefone) ou da conversa.
- **Sem pergunta** (25/11): termina no gancho, com uma frase de disponibilidade. Exemplo aprovado:
  *"Oi, Ana! O terreno em Tabatinga que você viu continua disponível, e a escritura já está
  pronta. Qualquer dúvida, é só me chamar."*
- **As regras do caderno:** sem emoji, sem código do anúncio, sem "corretor", sem gíria, sem as
  frases de dedução, até 300 caracteres. A rede de segurança do worker (`motivoParaNaoMandarV2`)
  barra o texto que fugir disso, e a etapa fica pulada com o motivo.
- **Não retoma** quando não sabe de qual imóvel falavam, quando o imóvel saiu do ar, ou quando a
  conversa parou numa pergunta do cliente (é da equipe responder).

## Como funciona

**O silêncio** é a última vez que o cliente escreveu, quando depois disso só a Imova falou e a
IA que atende respondeu o cliente (a mensagem automática da casa não basta: conversa que a IA não
respondeu não é retomada). Os dias contam a partir da resposta da IA. Cada
silêncio tem as suas etapas; o cliente escrever qualquer coisa encerra aquele silêncio. Quando
ele parar de novo, começa outro, do zero.

| Etapa | O que sai | Por quê |
| --- | --- | --- |
| **Dia 1** | Um texto curto **escrito pela IA** (`retomar-conversa@v1`, Claude Haiku 5.5), entre **20 e 23 h** depois da última mensagem do cliente | Ainda está dentro da janela de 24 h do WhatsApp: texto livre pode sair. A IA retoma o imóvel de que falavam, sem pressão, com uma pergunta. |
| **Dias 3 e 7** | Um **modelo aprovado pela Meta**, com o primeiro nome e o imóvel | Fora da janela de 24 h, a Meta só aceita modelo aprovado. |

No dia 1 a IA pode decidir **não retomar** (o cliente disse que já comprou, que não quer mais, que
volta a falar mês que vem). Aí as etapas seguintes daquele silêncio também não saem.

**Nenhum modelo sai sem a IA ter lido a conversa.** Se o texto do dia 1 não saiu (fora do horário,
worker parado, dado pessoal, orçamento, recusa, texto fora das regras, ou os dias não incluem o 1),
antes do primeiro modelo a IA lê a conversa só para decidir: segue, ou encerra o silêncio (o
"Obrigado, já aluguei" de terça à noite não ganha "ainda tem interesse?" na segunda). Se essa
leitura não sai, por qualquer motivo, o modelo daquele dia não sai ("a IA não leu a conversa antes
do modelo" no placar).

**A retomada para quando:**
- o cliente responde (qualquer coisa, até uma reação);
- há opt-out, supressão, ficha apagada ou a conversa foi bloqueada;
- a conversa foi concluída;
- a atitude do cliente é "sem interesse" ou "não contatar";
- o negócio da ficha foi ganho ou perdido depois da última mensagem do cliente;
- a equipe parou a IA na conversa, a conversa foi passada a uma pessoa ou alguém do time escreveu
  nela (é a mesma regra da IA que atende, `app.ia_atende`);
- há visita marcada para depois da última mensagem do cliente: reunião da Agenda, tarefa de visita
  ou Calendly, na ficha da conversa ou numa ficha com o mesmo telefone;
- a IA decidiu não retomar;
- acabaram as etapas.

**Só sai** no horário de envio do CRM (o mesmo de todo envio automático, RF-CON-11), nunca em
domingo ou feriado, e com pelo menos 48 h desde a última retomada enviada
(`intervalo_min_horas`, de 24 a 240). Etapa que não cabe no horário antes de vencer é pulada, e o motivo fica
registrado. **Só onde a IA atende:** no modo treino, só a conversa do treino e as de teste.
**Só silêncios que começaram depois de ligar a retomada:** ligar não dispara mensagem para quem
já estava parado. **Mudar os dias não repete:** a próxima etapa é sempre o primeiro dia da lista
maior que o maior que já saiu (ou foi pulado) naquele silêncio.

Toda mensagem passa pela porteira do WhatsApp (`messages_guard`): o texto do dia 1 sai com a prova
em `ia_respostas` (ação `retomou`, avaliável com Boa / Corrigir na tela); o modelo sai como
qualquer modelo do robô. Cada etapa fica em `ia_retomadas` (enviada, pulada e por quê).

## Ligar

Na tela **IA que atende → Configuração → Retomar quem parou de responder** (admin e gestor):

1. Escolher o modelo do dia 3 e o do dia 7 (só aparecem os modelos de WhatsApp de marketing ou
   utilidade que existem no CRM; a lista diz se a Meta já aprovou).
2. Conferir os dias (padrão `1, 3, 7`; até cinco, de 1 a 30; o dia 1 é sempre o texto da IA, e
   os outros, modelo).
3. **Ligar a retomada.** A IA que atende também precisa estar ligada.

Sem modelo aprovado, o dia 1 continua saindo; os dias 3 e 7 ficam como "não saíram" no placar,
com o motivo ("modelo ainda não aprovado pela Meta" ou "sem modelo escolhido").

## Os modelos para a Meta (proposta)

**Categoria: MARKETING.** Retomar uma conversa parada para reaquecer o interesse e oferecer visita
é promoção, não aviso de uma transação em andamento, que é o que a Meta aceita como UTILITY. Se
for mandado como utilidade, a Meta reclassifica ou recusa. Consequências: o preço por mensagem é
o de marketing, a Meta pode segurar mensagens de marketing para quem já recebeu muitas (erro
131049, que aparece na conversa), e o WhatsApp pode oferecer ao cliente parar de receber
promoções da empresa. Por isso
os dois textos terminam com o "responda SAIR", que o CRM já entende como opt-out.

| No CRM (`template_code`) | Nome na Meta | Idioma | Texto |
| --- | --- | --- | --- |
| `IMV-RETOMAR-3D` | `imv_retomar_3d_v1` | pt_BR | Oi, {{nome}}! Aqui é da Imova. Passando para saber se você ainda tem interesse no imóvel {{imovel}}. Se quiser, te mando mais detalhes ou a gente combina uma visita. Se preferir não receber mais mensagens, é só responder SAIR. |
| `IMV-RETOMAR-7D` | `imv_retomar_7d_v1` | pt_BR | Oi, {{nome}}! Aqui é da Imova de novo. Se ainda estiver procurando imóvel, me conta o que você precisa que eu separo opções parecidas com o imóvel {{imovel}}. Se preferir não receber mais mensagens, é só responder SAIR. |

**As variáveis**, que o CRM preenche sozinho (`app.ia_retomada_agir`):

| Variável | O que entra | Exemplo para a Meta | Quando não sabe |
| --- | --- | --- | --- |
| `{{nome}}` | o primeiro nome do cliente (da ficha, do contato ou do perfil do WhatsApp, só se for um nome de letras) | Mariana | "tudo bem" → "Oi, tudo bem! Aqui é da Imova." |
| `{{imovel}}` | o imóvel de que falavam, se ainda está no ar: "de Ponta Negra (código AP0012)" | de Ponta Negra (código AP0012) | "que você estava vendo" → "no imóvel que você estava vendo" (também quando dois imóveis empatam) |
| `{{saudacao}}` | Bom dia / Boa tarde / Boa noite, pelo relógio de Natal | Bom dia | sempre sabe |

Modelo com outra variável não sai (o placar diz "modelo com variável que a retomada não preenche").
O imóvel vem do interesse que o conselheiro de vendas leu, da visita que a IA marcou ou do último
código de anúncio citado na conversa; imóvel pausado, rascunho ou excluído não é citado.

### Cadastrar

**Pelo CRM (o caminho de sempre dos modelos).** Pôr as duas linhas no banco da Imova; o
`imova-worker-wa` as manda para aprovação da Meta sozinho (ele confere a cada 30 minutos; para
agora, `node apps/workers/dist/index.js wa --sincronizar-modelos`) e grava a resposta em
`meta_status`. O nome na Meta é o código em minúsculas mais a versão (`imv_retomar_3d_v1`).

```sql
insert into public.message_templates (template_code, name, channel, category, kind, body)
values
  ('IMV-RETOMAR-3D', 'Retomar o contato: 3 dias sem resposta', 'whatsapp', 'marketing', 'followup',
   'Oi, {{nome}}! Aqui é da Imova. Passando para saber se você ainda tem interesse no imóvel {{imovel}}. Se quiser, te mando mais detalhes ou a gente combina uma visita. Se preferir não receber mais mensagens, é só responder SAIR.'),
  ('IMV-RETOMAR-7D', 'Retomar o contato: 7 dias sem resposta', 'whatsapp', 'marketing', 'followup',
   'Oi, {{nome}}! Aqui é da Imova de novo. Se ainda estiver procurando imóvel, me conta o que você precisa que eu separo opções parecidas com o imóvel {{imovel}}. Se preferir não receber mais mensagens, é só responder SAIR.')
on conflict (template_code) do nothing;
```

Pela regra das duas empresas (`docs/operacao/multiempresa.md`), dado da Imova entra pelo seed dela
(`supabase/empresas/imova/seed.sql`). As linhas não foram postas lá de propósito: assim que o seed
rodar em produção, o worker manda os modelos para a Meta, e isso é decisão de quem cuida da conta.

**Ou à mão, no WhatsApp Manager.** Criar com o mesmo nome, idioma, categoria e texto, com os
exemplos da tabela. Depois, pôr as linhas acima no CRM: a sincronização acha o modelo que a Meta
já tem pelo nome e só registra a situação.

A Meta aprova em minutos a um dia. Recusado, o motivo fica em
`message_templates.meta_rejection_reason`.

## Conferir

- **Placar** (IA que atende, embaixo do placar da IA): retomadas que saíram (texto da IA e
  modelo), quantos clientes responderam depois (reação não conta, e quem pediu para sair aparece à
  parte), as que não saíram e o motivo mais comum, e o custo do texto do dia 1. As retomadas não
  entram no placar da IA que atende, no relatório da IA, na juíza nem no relatório que vende, e o
  "Corrigir" de uma retomada não vai para o caderno.
- **Na conversa:** o selo "Retomada amanhã, 08:00" ao lado do selo da IA, com o detalhe ao passar
  o mouse. Some quando não há retomada a caminho, inclusive quando a próxima é um modelo que não
  está escolhido e aprovado.
- **No banco:**

```sql
select r.criada_em, r.etapa, r.dias, r.tipo, r.situacao, r.motivo, r.template_code
  from public.ia_retomadas r order by r.criada_em desc limit 50;
select l.criada_em, l.dias, l.situacao, l.motivo        -- as leituras antes do modelo
  from public.ia_retomada_leituras l order by l.criada_em desc limit 50;
select app.ia_retomada_plano('<conversation_id>');   -- o plano de uma conversa
```

## Custos

- **Dia 1 (texto da IA), ou a leitura antes do primeiro modelo:** uma chamada ao Haiku 5.5 por
  silêncio, abaixo de US$ 0,001 (o `ai_runs` grava como `draft_reply`, `retomar-conversa@v1`; o
  placar mostra separado).
- **Dias 3 e 7:** a tarifa de mensagem de marketing da Meta, por mensagem entregue (no PRD, cerca
  de R$ 0,34 em 2026), mais o teto diário de conversas iniciadas pela empresa, que a retomada
  divide com os outros envios.

## Desligar

Na mesma tela, **Desligar a retomada**. Ou:

```sql
update public.app_settings set value = value || '{"ligada": false}' where key = 'ia.retomada';
```

O que já estava na fila de saída continua sendo da porteira; as próximas etapas não saem.
