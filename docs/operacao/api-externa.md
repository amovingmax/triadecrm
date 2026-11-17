# API do CRM Tríade

A API deixa outros sistemas trabalharem com o CRM: um site ou formulário que cria lead, um ERP que lê as fichas, uma automação (Zapier, Make, n8n) que move o negócio no funil, um painel que lê as conversas, um sistema que manda WhatsApp pelo número da empresa e que fica sabendo, na hora, quando chega mensagem.

Ela vale para as duas empresas. **Cada uma tem o seu endereço e as suas chaves**: uma chave da Imova não abre a KOMUNE.

| Empresa | Endereço da API |
| --- | --- |
| Imova | `https://kkqadgxvmzulcamuakzk.supabase.co/functions/v1/api` |
| KOMUNE | `https://toqdjcajyrowutunczhr.supabase.co/functions/v1/api` |

Todas as rotas começam com `/v1`. Exemplo: `GET https://kkqadgxvmzulcamuakzk.supabase.co/functions/v1/api/v1/fichas`.

---

## 1. A chave

**Quem cria:** admin ou gestor, em **Ajustes → Integrações → Nova chave**. A chave aparece **uma vez só**, na hora: copie e guarde no servidor do sistema que vai integrar. O CRM guarda só uma impressão digital dela (SHA-256) e não consegue mostrá-la de novo. Perdeu? Revogue e crie outra.

**Formato:** `trd_imova_` ou `trd_komune_` seguido de 48 letras e números. O começo diz de que empresa ela é.

**Como mandar:** em todo pedido, no cabeçalho

```
Authorization: Bearer trd_imova_3f9a1c...
```

(ou `X-Api-Key: trd_imova_3f9a1c...`, para ferramentas que só aceitam um cabeçalho com nome livre).

**Em nome de quem.** Toda chave age em nome de uma pessoa da gestão (admin ou gestor), escolhida na criação. O que a API faz fica no CRM como feito por essa pessoa: a nota tem o nome dela, a mudança de etapa aparece no histórico como dela, a mensagem de WhatsApp sai assinada com o primeiro nome dela. Se essa pessoa sair da equipe, ficar inativa ou deixar de ser admin ou gestor, **a chave para de funcionar na hora** (erro `dono_sem_acesso`); crie outra em nome de outra pessoa.

**Permissões (escopos).** Marque só o que a integração precisa:

| Escopo | O que deixa fazer |
| --- | --- |
| `fichas:ler` | Consultar fichas, contatos e telefones. |
| `fichas:escrever` | Criar lead, mudar dados da ficha, escrever nota. |
| `funil:ler` | Consultar funis, etapas e negócios. |
| `funil:escrever` | Mudar a etapa de um negócio. |
| `conversas:ler` | Ler conversas e mensagens do WhatsApp. |
| `mensagens:enviar` | Mandar texto (na janela de 24 h) e modelo aprovado pela Meta. Lista os modelos. |
| `webhooks` | Criar e apagar avisos para fora pela própria API. |

**Cuidados.** A chave dá acesso a nomes, telefones e conversas de clientes. Ela fica **só no servidor** de quem integra: nunca em código de página, aplicativo, planilha compartilhada, e-mail ou mensagem. Desconfiou que vazou: **Ajustes → Integrações → Revogar**. A próxima chamada com ela recebe 401.

---

## 2. O jeito de falar com a API

- **JSON em português.** Corpo e resposta em JSON (`Content-Type: application/json`), com nomes de campo em português.
- **Telefone:** mande do jeito que vier (`84 99999-8888`, `(84) 99999-8888`, `+5584999998888`); a resposta é sempre em E.164 (`+5584999998888`).
- **Data e hora:** ISO 8601 com fuso, por exemplo `2026-11-17T09:00:00-03:00`.
- **Resposta de sucesso:** `{"dados": ...}`. Listas trazem também `"proximo"`.
- **Resposta de erro:** `{"erro": {"codigo": "...", "mensagem": "..."}}`. O `codigo` é fixo e serve para programar em cima; a `mensagem` explica o que fazer. Alguns erros trazem mais campos (`campo`, `campos`, `escopo`, `motivo`).
- **`X-Requisicao`:** toda resposta traz esse cabeçalho com um id. Cite-o ao pedir ajuda.

### Listas e paginação

As listas vêm da mais recente para a mais antiga. `limite` vai de 1 a 200 (padrão 50). Quando há mais, a resposta traz `"proximo": "<cursor>"`; mande `cursor=<cursor>` para a página seguinte. Quando `proximo` vem `null`, acabou.

Para **sincronizar** (trazer só o que mudou), guarde a hora da última sincronização e mande `atualizada_desde` (fichas e conversas) ou `atualizado_desde` (negócios), paginando até `proximo` vir `null`.

### Repetir sem duplicar

- **`Idempotency-Key`:** em qualquer `POST`, mande um cabeçalho `Idempotency-Key` único por pedido (um UUID, o id do formulário). Se a rede cair e você repetir o mesmo pedido com a mesma chave em até 24 h, o CRM devolve a mesma resposta e não faz nada de novo (a resposta vem com `"repetido_pela_idempotencia": true`). A mesma chave num pedido diferente é recusada (`idempotencia_reusada`).
- **`id_externo`** (só em `POST /v1/leads`): o id do lead no seu sistema. O mesmo `id_externo` mandado de novo pela mesma chave devolve a mesma ficha, sem nota repetida, a qualquer tempo.

### Limite

Cada chave faz até **120 chamadas por minuto**. Passou disso: `429`, com `Retry-After` (segundos) no cabeçalho e `espera_s` no erro.

### Códigos de status

| Status | Quando |
| --- | --- |
| 200 | Deu certo. |
| 201 | Criou (lead novo, nota, webhook). |
| 202 | A mensagem entrou na fila de envio do WhatsApp (sai em segundos). |
| 400 | O pedido está mal formado (JSON inválido, parâmetro com formato errado). |
| 401 | Chave ausente, que não existe ou revogada. |
| 403 | A chave não tem a permissão da rota (`sem_escopo`), ou a pessoa da chave não tem mais acesso. |
| 404 | A rota ou o registro não existe. |
| 405 | Método que a rota não aceita. |
| 409 | O registro mudou enquanto o pedido chegava (leia de novo e repita), ou já existe outro com o mesmo dado. |
| 413 | Corpo acima de 256 KB. |
| 422 | O CRM recusou pelas regras dele (campo obrigatório, telefone inválido, opt-out, janela de 24 h fechada...). |
| 429 | Passou do limite por minuto. |
| 500 / 503 | Erro do CRM, ou o CRM fora do ar. Tente de novo em instantes. |

---

## 3. As rotas

| Método e rota | Escopo | O que faz |
| --- | --- | --- |
| `GET /v1` | qualquer | Empresa, chave e em nome de quem ela age. Bom para testar. |
| `POST /v1/leads` | `fichas:escrever` | Lead: acha a ficha pelo telefone ou e-mail, ou cria. |
| `GET /v1/fichas` | `fichas:ler` | Lista e busca fichas. |
| `GET /v1/fichas/{id}` | `fichas:ler` | Uma ficha, com contatos, negócios e conversas. |
| `PATCH /v1/fichas/{id}` | `fichas:escrever` | Muda dados da ficha. |
| `POST /v1/fichas/{id}/notas` | `fichas:escrever` | Escreve uma nota na ficha. |
| `POST /v1/fichas/{id}/modelo` | `mensagens:enviar` | Manda um modelo do WhatsApp para a ficha (abre conversa). |
| `GET /v1/funis` | `funil:ler` | Funis, etapas e motivos de perda. |
| `GET /v1/negocios` | `funil:ler` | Lista negócios. |
| `GET /v1/negocios/{id}` | `funil:ler` | Um negócio. |
| `POST /v1/negocios/{id}/mover` | `funil:escrever` | Muda a etapa. |
| `GET /v1/conversas` | `conversas:ler` | Lista conversas do WhatsApp. |
| `GET /v1/conversas/{id}` | `conversas:ler` | Uma conversa. |
| `GET /v1/conversas/{id}/mensagens` | `conversas:ler` | Mensagens de uma conversa. |
| `POST /v1/conversas/{id}/mensagens` | `mensagens:enviar` | Manda texto na conversa. |
| `POST /v1/conversas/{id}/modelo` | `mensagens:enviar` | Manda modelo na conversa. |
| `GET /v1/modelos` | `mensagens:enviar` | Modelos do WhatsApp que podem sair. |
| `GET /v1/webhooks` | `webhooks` | Lista os avisos para fora. |
| `POST /v1/webhooks` | `webhooks` | Cria um aviso para fora. |
| `DELETE /v1/webhooks/{id}` | `webhooks` | Apaga um aviso que esta chave criou. |
| `POST /v1/webhooks/{id}/teste` | `webhooks` | Manda um aviso de teste. |

### `GET /v1` — testar a chave

```bash
curl https://kkqadgxvmzulcamuakzk.supabase.co/functions/v1/api/v1 \
  -H "Authorization: Bearer $CHAVE"
```

```json
{
  "dados": {
    "empresa": "imova",
    "versao": "v1",
    "chave": { "id": "6a2a…", "nome": "Site", "prefixo": "trd_imova_3f9a1c",
               "escopos": ["fichas:escrever", "fichas:ler"], "limite_por_minuto": 120 },
    "em_nome_de": { "id": "decd…", "nome": "Rafael Abreu", "papel": "admin" }
  }
}
```

### `POST /v1/leads` — o lead que chega

O caminho de um formulário de site, de uma campanha, de outro CRM.

```bash
curl -X POST https://kkqadgxvmzulcamuakzk.supabase.co/functions/v1/api/v1/leads \
  -H "Authorization: Bearer $CHAVE" -H "Content-Type: application/json" \
  -d '{
    "nome": "Maria Souza",
    "telefone": "(84) 99999-8888",
    "email": "maria@exemplo.com",
    "origem": "Site, formulário de contato",
    "mensagem": "Quero visitar o apartamento de Ponta Negra.",
    "id_externo": "form-2026-000123",
    "campos_extras": { "utm_source": "google", "utm_campaign": "ponta-negra" }
  }'
```

| Campo | Obrigatório | O que é |
| --- | --- | --- |
| `nome` | sim | Até 120 letras. |
| `telefone` | um dos dois | Do Brasil, com DDD. |
| `email` | um dos dois | |
| `tipo` | não | `fornecedor`, `produtor`, `cerimonialista`, `espaco`, `empresa` ou `outro`. Sem ele: **Cliente** (`produtor`) na Imova e `fornecedor` na KOMUNE. Na Imova, `produtor` é Cliente (funil Clientes) e `fornecedor` é proprietário (funil Captação de imóveis). |
| `categoria` | não | O slug de uma categoria ativa (Ajustes → Catálogos → Categorias). Na Imova, o Cliente sem categoria entra como `comprador`. |
| `origem` | não | Texto livre de onde veio (até 120 letras). Vai na nota da ficha. |
| `mensagem` | não | O que a pessoa escreveu (até 2.000 letras). Vai na nota da ficha. |
| `id_externo` | não | O id no seu sistema: o mesmo id de novo devolve a mesma ficha. |
| `responsavel` | não | O e-mail de login de alguém da equipe, que vira responsável pela ficha e pelo negócio. Sem ele, o lead fica sem dono. |
| `campos_extras` | não | Objeto JSON livre, até 8 KB, guardado na ficha e devolvido em `campos_extras`. Não pode ter CPF. |

O que o CRM faz:

1. **Acha a ficha que já existe**: pelo telefone (da ficha ou de um contato dela) e, sem telefone, pelo e-mail. Achou: completa o telefone ou o e-mail que faltava, mescla os `campos_extras`, escreve a nota e responde **200** com `"situacao": "ligada"`.
2. **Não achou: cria** a ficha (origem "API (integração)") e o negócio na etapa de entrada do funil (Prospectado ou Identificado), com a próxima ação "Responder o lead da API" para agora, escreve a nota e responde **201** com `"situacao": "criada"`.
3. **Telefone que pediu para não ser contatado (opt-out):** nada entra, e a resposta é **422** `contato_suprimido`. Se a pessoa pediu contato de novo, a equipe reativa no CRM.

```json
{
  "dados": {
    "situacao": "criada",
    "repetido": false,
    "negocio_id": "69be…",
    "ficha": { "id": "ce60…", "nome": "Maria Souza", "telefone": "+5584999998888", "...": "..." }
  }
}
```

A ficha que nasce pela API não manda mensagem sozinha: ela aparece em Prospectados, e quem atende decide o primeiro contato (ou a integração manda um modelo, abaixo).

### `GET /v1/fichas` — listar e buscar

Parâmetros: `busca` (pedaço do nome), `telefone`, `email`, `tipo`, `atualizada_desde`, `limite`, `cursor`.

```bash
curl "https://…/functions/v1/api/v1/fichas?telefone=84999998888" -H "Authorization: Bearer $CHAVE"
```

Cada ficha:

```json
{
  "id": "ce607d4a-…", "nome": "Maria Souza", "tipo": "produtor", "pessoa_fisica": true,
  "telefone": "+5584999998888", "email": "maria@exemplo.com", "instagram": null, "site": null,
  "cidade": "Natal", "uf": "RN", "bairro": "Ponta Negra", "endereco": null,
  "categoria": { "slug": "comprador", "nome": "Comprador" },
  "origem": { "slug": "api", "nome": "API (integração)" },
  "responsavel": { "id": "…", "nome": "Sol" },
  "temperatura": "morno", "nao_contatar": false,
  "campos_extras": { "utm_source": "google" },
  "negocios": [ { "…": "a mesma forma de GET /v1/negocios/{id}" } ],
  "criada_em": "2026-11-17T15:03:42-03:00", "atualizada_em": "2026-11-17T15:10:58-03:00"
}
```

`GET /v1/fichas/{id}` traz também `contatos` (nome, telefone, e-mail, cargo, principal) e `conversas` (os ids). Ficha excluída no CRM some da API (404).

### `PATCH /v1/fichas/{id}` — mudar dados

Campos aceitos: `nome`, `email`, `instagram`, `site`, `bairro`, `endereco`, `responsavel` (e-mail de login, ou `null` para tirar) e `campos_extras` (mesclado; um campo mandado como `null` é apagado). Campo que a rota não conhece é recusado com o nome dele (`campo_desconhecido`).

**O telefone não muda pela API**: ele é a chave que liga a ficha às conversas do WhatsApp; troque na tela do CRM.

### `POST /v1/fichas/{id}/notas` — nota na ficha

```json
{ "texto": "Pagou o sinal pelo boleto 12345." }
```

A nota aparece na linha do tempo da ficha, em nome da pessoa da chave. Bom para registrar o que acontece no seu sistema (pagamento, contrato assinado, visita no site).

### `GET /v1/funis` — funis e etapas

Devolve `funis` (cada um com as `etapas` ativas: `id`, `slug`, `nome`, `entrada`, `ganho`, `perdido`, `campos_obrigatorios`) e `motivos_de_perda`. Use os `slug` ou os `id` daqui para mover e filtrar. Etapa aposentada no CRM não aparece.

### `GET /v1/negocios` — listar

Parâmetros: `funil` (slug ou id), `etapa` (slug ou id), `situacao` (`aberto`, `ganho`, `perdido`, `pausado`, `nutricao`), `ficha` (id), `atualizado_desde`, `limite`, `cursor`.

```json
{
  "id": "69be…",
  "ficha": { "id": "ce60…", "nome": "Maria Souza" },
  "funil": { "id": 2, "slug": "produtor", "nome": "Clientes" },
  "etapa": { "id": 9, "slug": "contatado", "nome": "Contatado", "ganho": false, "perdido": false },
  "situacao": "aberto", "temperatura": "morno",
  "responsavel": { "id": "…", "nome": "Sol" },
  "proxima_acao": { "texto": "Ligar", "em": "2026-11-18T09:00:00-03:00" },
  "motivo_da_perda": null,
  "entrou_na_etapa_em": "…", "ultima_atividade_em": "…", "ganho_em": null, "perdido_em": null,
  "criado_em": "…", "atualizado_em": "…"
}
```

### `POST /v1/negocios/{id}/mover` — mudar de etapa

Passa pelas **mesmas regras do quadro de Funis**: campos obrigatórios da etapa, próxima ação futura nas etapas de trabalho, motivo para perder, histórico e auditoria.

Os slugs das etapas mudam de funil para funil e de empresa para empresa: pegue os certos em `GET /v1/funis`. No exemplo, a etapa pede data e formato da reunião.

```json
{
  "etapa": "reuniao_marcada",
  "motivo": "Agendou pelo site",
  "campos": { "meeting_at": "2026-11-20T10:00:00-03:00", "meeting_format": "visita" },
  "proxima_acao": { "texto": "Confirmar a visita", "em": "2026-11-19T17:00:00-03:00", "tipo": "call" }
}
```

| Campo | O que é |
| --- | --- |
| `etapa` | Slug ou id da etapa, no funil do negócio. Obrigatório. |
| `motivo` | Por que mudou (vai para o histórico). |
| `campos` | O que a etapa pede (`campos_obrigatorios` em `GET /v1/funis`). Faltou algo: `422 campos_obrigatorios`, com a lista em `campos`. |
| `motivo_da_perda` | Slug ou id (de `motivos_de_perda`), para levar a uma etapa de perda. |
| `proxima_acao` | `{texto, em, tipo}`; `tipo` é `call`, `visit`, `meeting`, `message`, `follow_up` (padrão) ou `other`. |

Mover para a etapa em que o negócio já está responde 200 com `"mudou": false`.

### Conversas e mensagens

`GET /v1/conversas` (parâmetros `ficha`, `telefone`, `atualizada_desde`, `limite`, `cursor`) devolve:

```json
{
  "id": "64fe…", "canal": "whatsapp", "telefone": "+5584999998888", "nome_no_whatsapp": "Maria",
  "ficha": { "id": "ce60…", "nome": "Maria Souza" }, "negocio_id": "69be…",
  "responsavel": { "id": "…", "nome": "Sol" }, "situacao": "aguardando_nos", "por_ler": 2,
  "janela_aberta": true, "janela_aberta_ate": "2026-11-18T15:10:00-03:00",
  "arquivada": false, "bloqueada": false,
  "ultima_mensagem_em": "…", "ultima_recebida_em": "…", "ultima_enviada_em": "…",
  "criada_em": "…", "atualizada_em": "…"
}
```

`GET /v1/conversas/{id}/mensagens` (parâmetros `desde`, `limite`, `cursor`), da mais nova para a mais velha:

```json
{
  "id": "…", "conversa_id": "…", "ficha_id": "…",
  "direcao": "recebida", "tipo": "text", "texto": "Pode ser amanhã?", "transcricao": null,
  "apagada": false, "situacao": "recebida",
  "autor": { "tipo": "contato" },
  "modelo": null, "midia": null, "responde_a": null, "erro": null,
  "criada_em": "…", "enviada_em": null, "entregue_em": null, "lida_em": null
}
```

- `direcao`: `recebida` ou `enviada`. `situacao`: `na_fila`, `enviada`, `entregue`, `lida`, `falhou` ou `recebida`.
- `autor.tipo`: `contato`, `pessoa` (com `id` e `nome`), `ia`, `robo` ou `sistema`.
- `midia`: quando a mensagem tem foto, áudio, vídeo ou documento, vem o tipo e o nome do arquivo; **o arquivo em si ainda não sai pela API**.

### `POST /v1/conversas/{id}/mensagens` — mandar texto

```json
{ "texto": "Oi, Maria! Já te mando as fotos.", "responde_a": null }
```

Até 4.096 letras. `responde_a` é o id de uma mensagem da mesma conversa, para sair citada. Resposta **202**: a mensagem está na fila e sai em segundos, assinada com o primeiro nome da pessoa da chave (como na tela). Para saber se saiu, leia a conversa de novo ou assine o aviso `mensagem.enviada` / `mensagem.falhou`.

A mensagem passa pelas **mesmas travas da tela**, e a recusa vem como `422 envio_recusado`, com o `motivo`:

| `motivo` | O que quer dizer |
| --- | --- |
| `sem_janela_e_sem_template` | Faz mais de 24 h que a pessoa escreveu: o WhatsApp só deixa sair modelo aprovado. Use `…/modelo`. |
| `contato_suprimido` | A pessoa pediu para não receber mensagens. |
| `janela_*` | Fora do horário de envio configurado no CRM. |
| `teto_*` | O limite de envios do dia foi atingido. |
| `conversa_bloqueada` | O contato está bloqueado no CRM. |

Texto com CPF não sai (`cpf_nao_sai`).

### Modelos do WhatsApp

`GET /v1/modelos` lista os modelos registrados na Meta: `id`, `codigo`, `nome`, `categoria`, `aprovado_na_meta`, `texto` (com `{{variaveis}}`), `variaveis` (o que você precisa preencher) e `botoes`. `atendente` e `saudacao` o CRM preenche sozinho.

- `POST /v1/conversas/{id}/modelo` — numa conversa que já existe.
- `POST /v1/fichas/{id}/modelo` — para uma ficha, mesmo sem conversa (é o primeiro contato).

```json
{ "modelo": "GEN-FUP-LIVRE", "parametros": { "nome": "Maria", "mensagem": "Separei três opções para você." } }
```

`modelo` aceita o `codigo` ou o `id`. Resposta **202** com `conversa_id` e a `mensagem`. Valem as travas de sempre: opt-out, horário, tetos do dia e modelo aprovado pela Meta.

---

## 4. Avisos para fora (webhooks)

Em vez de perguntar ao CRM de tempos em tempos, o seu sistema pode **receber um POST** quando algo acontece.

| Evento | Quando | `dados` |
| --- | --- | --- |
| `ficha.criada` | Uma ficha nova entra no CRM, por qualquer caminho (tela, WhatsApp, portais, Calendly, planilha, API). | `ficha` (completa) |
| `negocio.etapa_mudou` | Um negócio muda de etapa, por qualquer caminho. | `negocio`, `de`, `para`, `motivo`, `por`, `mudou_em` |
| `mensagem.recebida` | Chega mensagem de WhatsApp. | `mensagem`, `conversa`, `ficha` (ou `null`) |
| `mensagem.enviada` | Uma mensagem do CRM sai para o WhatsApp (da equipe, da IA, do robô ou da API). | `mensagem`, `conversa` |
| `mensagem.falhou` | Uma mensagem do CRM não consegue sair. | `mensagem` (com `erro`), `conversa` |
| `teste` | O botão "Testar" (ou `POST /v1/webhooks/{id}/teste`). | `mensagem` |

**Como criar:** em **Ajustes → Integrações → Novo webhook** (admin ou gestor), ou pela API com o escopo `webhooks`:

```bash
curl -X POST https://…/functions/v1/api/v1/webhooks \
  -H "Authorization: Bearer $CHAVE" -H "Content-Type: application/json" \
  -d '{"url": "https://meu-sistema.com.br/crm/avisos", "eventos": ["ficha.criada", "mensagem.recebida"]}'
```

A resposta traz o **segredo** (`whsec_…`) **uma vez só**: guarde, ele serve para conferir a assinatura. O endereço precisa ser `https://` público (rede interna é recusada). Até 20 webhooks por empresa. Pela API, cada chave apaga só os webhooks que ela criou; os criados na tela se apagam na tela.

### O que chega

```
POST https://meu-sistema.com.br/crm/avisos
Content-Type: application/json
User-Agent: Triade-Avisos/1
X-Triade-Evento: ficha.criada
X-Triade-Entrega: 0d6c…            (o id desta entrega)
X-Triade-Assinatura: t=1763402400,v1=5f2c…
```

```json
{
  "id": "b1e4…",
  "evento": "ficha.criada",
  "empresa": "imova",
  "criado_em": "2026-11-17T15:11:46.123-03:00",
  "dados": { "ficha": { "id": "ce60…", "nome": "Maria Souza", "...": "..." } }
}
```

### Conferir a assinatura (sempre)

`v1` é o HMAC-SHA256, em hexadecimal, de `"<t>.<corpo cru>"` com o segredo do webhook. Confira com o **corpo cru**, exatamente como chegou (antes de transformar em objeto), e recuse carimbo com mais de 5 minutos.

Node.js:

```js
import { createHmac, timingSafeEqual } from 'node:crypto';

function avisoValido(corpoCru, cabecalho, segredo, toleranciaS = 300) {
  const partes = Object.fromEntries(cabecalho.split(',').map((p) => p.split('=')));
  const t = Number(partes.t);
  if (!Number.isFinite(t) || Math.abs(Date.now() / 1000 - t) > toleranciaS) return false;
  const esperado = createHmac('sha256', segredo).update(`${t}.${corpoCru}`).digest('hex');
  const recebido = Buffer.from(partes.v1 ?? '', 'hex');
  return recebido.length === 32 && timingSafeEqual(recebido, Buffer.from(esperado, 'hex'));
}
```

Python:

```python
import hmac, hashlib, time

def aviso_valido(corpo_cru: bytes, cabecalho: str, segredo: str, tolerancia_s: int = 300) -> bool:
    partes = dict(p.split("=", 1) for p in cabecalho.split(","))
    t = int(partes.get("t", "0"))
    if abs(time.time() - t) > tolerancia_s:
        return False
    esperado = hmac.new(segredo.encode(), f"{t}.".encode() + corpo_cru, hashlib.sha256).hexdigest()
    return hmac.compare_digest(esperado, partes.get("v1", ""))
```

### Responder, repetir, pausar

- **Responda 2xx em até 10 segundos.** Faça o trabalho pesado depois de responder.
- **Qualquer outra resposta, ou nenhuma, conta como falha**, e o CRM tenta de novo: 1 min, 5 min, 15 min, 1 h, 3 h, 6 h e 12 h depois (8 tentativas, até 3 dias). Depois disso a entrega fica como "falhou" em Ajustes.
- **Pode chegar repetido e fora de ordem.** Use o `id` do envelope para ignorar o repetido e o `criado_em` para ordenar.
- **Responder `410`** diz "não quero mais": o webhook é pausado na hora.
- **25 falhas seguidas sem nenhuma entrega em 24 h** pausam o webhook. A tela mostra o porquê; ao reativar, o que ficou pendente dos últimos 3 dias sai.

---

## 5. O que a API ainda não faz

- entregar o arquivo de mídia das mensagens (foto, áudio, documento): ela diz que tem e o nome do arquivo;
- trocar o telefone de uma ficha, excluir ficha, juntar fichas duplicadas;
- criar tarefa, visita ou reunião na Agenda;
- avisar a equipe no celular quando um lead chega pela API (ele aparece em Prospectados e no aviso `ficha.criada`);
- anúncios e imóveis da Imova.

Pedidos para uma próxima versão: falar com quem administra o CRM.

---

## 6. Para a equipe técnica

- **Onde está:** banco `supabase/migrations/20261117200000_a_api_externa.sql` (tabelas em `app.api_*`, a porta `public.api_atender`, as telas `public.api_*`, os gatilhos de aviso e a entrega por `pg_cron` + `pg_net`); a função `supabase/functions/api` (só a porta); testes `supabase/tests/180_a_api_externa.sql` (pgTAP) e `supabase/functions/api/atender.test.ts` (Deno).
- **Em nome de:** `public.api_atender` põe o `request.jwt.claims` da pessoa da chave na transação (`app.api_agir_como`) e chama as funções de sempre (`move_deal`, `wa_enviar_modelo`, o insert em `messages` que passa pelo `messages_guard`). Nenhuma regra de negócio foi copiada.
- **Avisos:** gatilhos adiados para o fim da transação (`deferrable initially deferred`) gravam uma linha em `app.api_avisos` por webhook inscrito; um gatilho de aviso nunca derruba o que o disparou. `app.api_avisos_rodar` (pg_cron, a cada 15 s) assina com o segredo do Vault, manda pelo `pg_net` e confere a resposta na rodada seguinte.
- **CORS:** a função não põe cabeçalho de CORS, mas o gateway do Supabase põe `Access-Control-Allow-Origin: *` e responde sozinho o pré-voo do navegador. A proteção contra chave em página é a regra de uso e o botão de revogar.
- **Publicar:** a migração (pelo caminho de `docs/operacao/multiempresa.md`, nas duas empresas) e `supabase functions deploy api --project-ref <ref>` em cada projeto. O site leva a tela de Ajustes → Integrações.
