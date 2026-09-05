# Contrato do pré-cadastro — Triade ↔ Komune

**Versão do contrato:** v0 (contrato mínimo do MVP, PRD §7.6 / RF-PRE-01)
**Status:** lado Triade **implementado e testado**; lado Komune **a implementar (Matheus)**
**Última verificação de ponta a ponta:** 05/09/2026, contra o dublê local
`supabase/functions/_dubles/komune-duble.mjs`

---

## 1. O que este documento resolve

O Triade (CRM de captação) nunca lê nem escreve no banco da plataforma Komune, e
o contrário também não vale (ADR-02). Os dois sistemas se falam por **duas
chamadas HTTP assinadas**, e é só isso:

| # | Direção | Quem chama | Quem implementa | O quê |
|---|---------|-----------|-----------------|-------|
| 1 | Triade → Komune | Edge Function `komune-push` | **Matheus**, na Komune, como `crm-pre-registration` | Cria/atualiza o rascunho do fornecedor |
| 2 | Komune → Triade | Webhook da Komune | **Já implementado** no Triade, como `komune-webhook` | Devolve o status: reivindicou, publicou, primeiro lead… |

Duas superfícies do Triade completam o desenho e **não pedem nada da Komune**:

| Função | Quem usa | Autenticação |
|--------|----------|--------------|
| `claim-link` | O fornecedor, no celular, abrindo o link | O token de reivindicação (32 bytes) |
| `export-lgpd` | O titular (com o token) ou o encarregado (com login) | Token, ou JWT do Triade |

---

## 2. A assinatura — o mesmo esquema nas duas direções

Uma regra só, para não haver duas coisas para errar.

```
base        = "v1:" + <carimbo unix em segundos> + ":" + <corpo cru, byte a byte>
assinatura  = "v1=" + hex( HMAC_SHA256( segredo_compartilhado, base ) )
```

**O corpo é o texto cru.** Nunca reserialize: `JSON.parse` seguido de
`JSON.stringify` reordena chaves e normaliza números, e a assinatura deixa de
bater sem motivo. Assine o que você vai enviar; confira o que você recebeu.

### Cabeçalhos

| Direção | Assinatura | Carimbo | Extra |
|---------|-----------|---------|-------|
| Triade → Komune | `X-Triade-Signature: v1=<64 hex>` | `X-Triade-Timestamp: <segundos>` | `Idempotency-Key: <chave>` |
| Komune → Triade | `X-Komune-Signature: v1=<64 hex>` | `X-Komune-Timestamp: <segundos>` | `X-Komune-Delivery: <id único>` |

### As regras que quem recebe tem de aplicar, nesta ordem

1. Ler o corpo **cru**, com teto de tamanho (o Triade usa 256 KB).
2. Cabeçalho de assinatura ausente ou fora do formato `v1=<64 hex>` → **401**.
3. Carimbo ausente, não inteiro, ou a **mais de 300 s** do relógio local **nos
   dois sentidos** → **401**. Carimbo velho é reenvio gravado; carimbo no futuro
   é relógio esticado. Recuse os dois.
4. HMAC conferido em **tempo constante** (`crypto.timingSafeEqual` no Node,
   ou XOR acumulado — nunca `===` sobre a string) → não bateu, **401**.
5. Só depois disso: `JSON.parse`.

A resposta de recusa é **sempre a mesma frase**, para os quatro motivos. Quem
sonda a porta não deve descobrir se errou o segredo, o carimbo ou o formato. O
detalhe fica no log de quem recebeu.

### Segredos

Dois segredos distintos, um por direção — comprometer um não dá a outra ponta.

| Nome | Quem guarda | Para quê |
|------|-------------|----------|
| `komune_push_secret` | Vault dos dois projetos | O Triade assina; a Komune confere |
| `komune_webhook_secret` | Vault dos dois projetos | A Komune assina; o Triade confere |
| `komune_push_url` | Vault do Triade | Endereço do `crm-pre-registration` |

No Triade, os segredos são lidos do ambiente e, se não houver, do Vault
(`app.segredo`, `EXECUTE` só para `service_role`). **Nenhum segredo está em
arquivo versionado**, e nenhum tem valor padrão: sem segredo, a função recusa a
requisição com **503** em vez de aceitar sem conferir. Para gravar:

```sql
select app.gravar_segredo('komune_push_secret', '<32 bytes em hex>', 'HMAC Triade -> Komune');
```

Rotação: grave o novo valor nos dois Vaults na mesma janela. Não há período de
convivência de duas chaves na v0 — combine uma janela curta de manutenção.

---

## 3. Direção 1 — `crm-pre-registration` (a implementar na Komune)

### Requisição

```
POST https://<projeto-komune>.supabase.co/functions/v1/crm-pre-registration
Content-Type: application/json
Idempotency-Key: <pre_registration_id>:<12 primeiros hex do hash do payload>
X-Triade-Timestamp: 1788577200
X-Triade-Signature: v1=9f2c…
```

### Corpo (contrato mínimo v0) — exemplo real, com valores de exemplo

```json
{
  "versao": "v0",
  "pre_registration_id": "3ca08cf3-a148-40f0-8e6f-6018a3141df7",
  "crm_organization_id": "b79add14-8891-417d-82fe-12ec23e3ff12",
  "origin": "crm_pre_registration",
  "source_label": "Casamentos.com.br",
  "source_url": "https://www.casamentos.com.br/exemplo",
  "publish_status": "draft",
  "published": false,
  "nome": "Cerimonial Exemplo",
  "claim_token_hash": "5c1f…64 hex…",
  "claim_token_expires_at": "2026-09-12T01:09:27.912-03:00",
  "claimed_at": null,
  "perfil": {
    "nome_exibicao": "Cerimonial Exemplo",
    "categorias": ["cerimonial"],
    "cidade": "Natal",
    "bairro": "Tirol",
    "telefone_comercial": "+558432180000",
    "instagram": "@exemplo",
    "site": "https://exemplo.com.br"
  },
  "aceite": {
    "terms_version": "precadastro-2026-09-v1",
    "terms_hash": "1a8d…64 hex…",
    "accepted_at": "2026-09-05T01:13:00-03:00",
    "auth_method": "claim_link",
    "marketing_optin": true,
    "photo_import_authorized": false
  },
  "emitido_em": "2026-09-05T01:13:00-03:00"
}
```

Campos nulos são **omitidos** (`jsonb_strip_nulls`): trate ausência como "não
informado", nunca como "apagar".

#### O que `perfil` pode conter — e só isso

`nome_exibicao`, `categorias`, `subnichos`, `cidade`, `bairro`,
`area_atendimento`, `faixa_preco`, `instagram`, `site`, `telefone_comercial`,
`descricao_neutra`, `anos_de_mercado`, `fotos_publicas_encontradas`.

A lista é um `CHECK` no banco do Triade (`app.prefilled_ok`), não uma convenção.
**Nunca chegará**: CPF, CNPJ de faturamento, Pix, dado bancário, cartão
(ADR-09 e `CHECK` na `komune_outbox`), foto, texto descritivo de terceiro,
avaliação, nota, logo ou preço copiado de outra plataforma (R03/R06).
**Recuse com 422 se chegar** — é a rede de segurança que prova que a rede de
cima está funcionando.

#### O token nunca viaja em claro

Vai só o `claim_token_hash` (sha256 hex). O Triade guarda o hash; a Komune
guarda o hash; o token em claro existe uma única vez, no link que o fornecedor
recebe. Para validar uma reivindicação do lado de lá: `sha256(token) ==
claim_token_hash` **e** `now() < claim_token_expires_at`.

### O que a Komune deve fazer

1. Conferir assinatura e carimbo (seção 2) **antes de qualquer escrita**.
2. Exigir `Idempotency-Key`. Sem ele → **400**.
3. **Se a chave já foi vista**: não criar nada, devolver **200** com o mesmo
   `komune_supplier_id`. Reenviar tem de ser inócuo — o Triade reenvia em toda
   falha de rede.
4. Upsert em `suppliers` por `crm_organization_id`, com
   `origin = 'crm_pre_registration'`, `publish_status = 'draft'`,
   `published = false`, `source_url`, `claim_token_hash`,
   `claim_token_expires_at`.
5. Registrar em `supplier_onboarding_events` (append-only) o que aconteceu.
6. **Nunca publicar o perfil por causa desta chamada.** Publicação exige aceite
   provado, e o Triade recusa o webhook de publicação se não tiver a prova.

### Respostas esperadas

| Status | Significado | O que o Triade faz |
|--------|-------------|--------------------|
| `200` | Criado ou já existia | Marca `enviado`, guarda `komune_supplier_id` |
| `401` | Assinatura/carimbo | Conta tentativa, tenta de novo com backoff, cai na dead-letter |
| `400` / `422` | Contrato quebrado | Idem — e o erro fica legível em `komune_outbox.last_error` |
| `429` / `5xx` | Sobrecarga/erro | Idem, com backoff de 30 s dobrando até 1 h |

Corpo do `200`:

```json
{ "komune_supplier_id": "uuid", "publish_status": "draft", "published": false, "criado": true }
```

O Triade lê `komune_supplier_id` (aceita também `supplier_id`) e cola nos dois
lados: `pre_registrations.komune_supplier_id` e
`organizations.komune_supplier_id`. Um `200` sem JSON é aceito — o efeito
aconteceu; só não haverá id para colar.

### Retentativa e desistência (lado Triade)

Backoff exponencial de 30 s dobrando, teto de 1 h; **6 tentativas** e a mensagem
vai para a fila `komune_dlq`, com a linha do `komune_outbox` em `falhou`. Não há
reenvio automático depois disso: é leitura humana.

---

## 4. Direção 2 — `komune-webhook` (já implementado no Triade)

```
POST https://<projeto-triade>.supabase.co/functions/v1/komune-webhook
Content-Type: application/json
X-Komune-Delivery: <id único por aviso; repetir o id = repetir a entrega>
X-Komune-Timestamp: 1788577200
X-Komune-Signature: v1=<hex do HMAC com komune_webhook_secret>
```

```json
{
  "event": "supplier.claimed",
  "occurred_at": "2026-09-05T03:10:00Z",
  "pre_registration_id": "3ca08cf3-…",
  "crm_organization_id": "b79add14-…",
  "komune_supplier_id": "f7ae8a35-…",
  "dados": { }
}
```

- **`event` é obrigatório.** `delivery_id` também (cabeçalho, ou campo
  `delivery_id` no corpo como reserva).
- Para achar o rascunho basta **um** dos três: `pre_registration_id`,
  `crm_organization_id` ou `komune_supplier_id`.
- `dados` é livre e vira a carga do evento na linha do tempo. **Não mande PII
  que o CRM não precise**, e nunca dado bancário.

### Vocabulário (19 eventos)

| `event` | Vira, na linha do tempo | Muda estado? |
|---------|-------------------------|--------------|
| `supplier.claimed` | `claimed` | marca reivindicado, mata o token |
| `supplier.published` | `published` | publica — **só com aceite provado** |
| `supplier.unpublished` | `unpublished` | despublica |
| `supplier.publish_requested` | `publish_requested` | status |
| `supplier.returned` | `returned` | status |
| `supplier.completeness` | `profile_reviewed` | grava `completeness_score` e `breakdown` de `dados` |
| `supplier.profile_50` | `profile_50` | — |
| `supplier.profile_100` | `profile_100` | — |
| `supplier.photos_added` | `photos_added` | — |
| `supplier.wallet_ready` | `wallet_ready` | — |
| `supplier.documents` | `documents_submitted` | — |
| `supplier.verified` | `verified` | — |
| `supplier.verification_rejected` | `verification_rejected` | — |
| `supplier.paused` | `paused` | — |
| `lead.first` | `first_lead` | — |
| `lead.first_view` | `first_view` | — |
| `response.first` | `first_response` | — |
| `proposal.first` | `first_proposal` | — |
| `deal.first` | `first_deal` | — |

A tabela vive em `public.komune_event_map`: acrescentar evento é um `INSERT`, não
um deploy.

### Respostas do Triade

| Status | Quando | O que a Komune faz |
|--------|--------|--------------------|
| `200 {"aplicado":true}` | Aplicado | Nada |
| `200 {"duplicado":true}` | `delivery_id` repetido | Nada — é a idempotência funcionando |
| `200 {"aplicado":false,"motivo":"evento_desconhecido"}` | Evento fora do dicionário | Registrado e ignorado; **não reenviar** |
| `200 {"aplicado":false,"motivo":"pre_cadastro_nao_encontrado"}` | Aviso órfão | Idem |
| `200 {"aplicado":false,"motivo":"publicacao_sem_aceite_provado"}` | Ver abaixo | **Não reenviar**; investigar |
| `400` | Corpo inválido, sem `event`, sem entrega | Corrigir; reenviar não adianta |
| `401` | Assinatura/carimbo | Conferir segredo e relógio |
| `503` | Segredo não configurado no Triade | Avisar o time do Triade |
| `500` | Erro ao aplicar | **Reenviar a mesma `delivery_id`** — a idempotência cobre |

> **`publicacao_sem_aceite_provado` não é um bug: é a regra.** O Triade só aceita
> `published = true` quando existe, no banco dele, uma linha em
> `pre_registration_acceptances` com termo aceito e autorização de dados. Se a
> Komune publicar um perfil sem esse aceite ter passado pelo `claim-link`, o
> Triade recusa e grava um evento `returned`. A regra do CRM vale **mesmo contra
> a afirmação da plataforma** (RF-PRE-02, LGPD art. 8º §2º).

---

## 5. Quando cada push acontece

O Triade enfileira sozinho em **dois momentos**, e só neles:

1. **Link emitido** (`gerar_link_de_reivindicacao`) — a Komune precisa do
   `claim_token_hash` para validar a reivindicação do lado dela. Emitir link já
   exige **autorização registrada em `consent_events`**.
2. **Reivindicado** (`aceitar_reivindicacao`) — o titular aceitou os termos com
   prova completa.

Antes de qualquer envio, o Postgres confere: autorização vigente, alvo não
suprimido, rascunho não encerrado. E há uma **chave geral**:

```sql
-- nasce desligada; enquanto estiver assim, a fila enche e NADA sai
update public.app_settings
   set value = value || '{"push_ativo": true}'::jsonb
 where key = 'integracao.komune';
```

`pg_cron` acorda a `komune-push` a cada 5 minutos (`app.komune_push_disparar`),
e não faz nada se a chave estiver desligada, se os segredos não estiverem no
Vault ou se a fila estiver vazia.

---

## 6. As duas superfícies do fornecedor (referência, nada a fazer na Komune)

### `claim-link`

```
GET  /functions/v1/claim-link?token=<64 hex>            → mostra o rascunho (T1)
POST /functions/v1/claim-link  { "acao":"aceitar",  … } → aceite com prova (T3)
POST /functions/v1/claim-link  { "acao":"recusar", "motivo":"nao_e_meu"|"nao_quero" }
```

IP e user-agent são lidos da conexão, **nunca do corpo** — prova que o titular
digita não é prova. O aceite grava versão e hash do termo, IP, user-agent,
método e quem aceitou (LGPD art. 8º §2º). A recusa suprime o contato, agenda o
apagamento do rascunho em 48 h e registra oposição (art. 18 §2º).

### `export-lgpd`

```
GET /functions/v1/export-lgpd?token=<64 hex>                         → o titular, sem login
GET /functions/v1/export-lgpd?organizacao=<uuid>&motivo=<texto>      → interno, com JWT
```

Devolve o dossiê do art. 18 (I/II) **com a proveniência campo a campo e a URL
exata da coleta** — a resposta que faltou no caso KASPR. SDR e embaixador não
exportam; toda exportação interna fica em `pii_access_log` e abre um
`access_request` em `consent_events`.

---

## 7. Como testar sem a Komune existir

O dublê implementa o `crm-pre-registration` **com as mesmas conferências** deste
contrato, e sabe mandar webhook assinado de volta.

```bash
# 1. os segredos, só no ambiente e no Vault — nunca em arquivo versionado
export KOMUNE_PUSH_SECRET=$(openssl rand -hex 32)
export KOMUNE_WEBHOOK_SECRET=$(openssl rand -hex 32)
psql "$DATABASE_URL" -c "select app.gravar_segredo('komune_push_secret','$KOMUNE_PUSH_SECRET','');" \
                     -c "select app.gravar_segredo('komune_webhook_secret','$KOMUNE_WEBHOOK_SECRET','');" \
                     -c "select app.gravar_segredo('komune_push_url','http://host.docker.internal:8787/crm-pre-registration','');"

# 2. sobe o dublê e as funções
node supabase/functions/_dubles/komune-duble.mjs servir 8787 &
supabase functions serve &

# 3. liga a chave geral e roda o push
psql "$DATABASE_URL" -c "update public.app_settings set value = value || '{\"push_ativo\":true}'::jsonb where key='integracao.komune';"
curl -X POST http://127.0.0.1:54321/functions/v1/komune-push -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY"
curl http://127.0.0.1:8787/_recebidos    # o que a "Komune" recebeu e o veredito dela

# 4. webhook de volta: válido, sem assinatura, e com carimbo velho
node supabase/functions/_dubles/komune-duble.mjs webhook \
  http://127.0.0.1:54321/functions/v1/komune-webhook '{"event":"supplier.claimed","pre_registration_id":"…"}'
SEM_ASSINATURA=1 node supabase/functions/_dubles/komune-duble.mjs webhook … # 401
CARIMBO=$(( $(date +%s) - 3600 )) node supabase/functions/_dubles/komune-duble.mjs webhook … # 401
```

Testes automáticos:

```bash
# a borda (HMAC, carimbo, tempo constante) — 16 casos, sem rede e sem banco
docker run --rm -v "$PWD/supabase/functions":/w -w /w --entrypoint deno \
  denoland/deno:alpine-2.1.4 test _compartilhado/assinatura.test.ts

# o contrato de dados (superfície, porteira, idempotência, LGPD) — 68 casos
supabase test db --local supabase/tests/19_integracao_komune.sql
```

---

## 8. Checklist para o lado Komune (Matheus)

- [ ] Colunas em `suppliers`: `origin`, `source_url`, `crm_organization_id`,
      `claim_token_hash`, `claim_token_expires_at`, `publish_status`.
- [ ] Tabela `supplier_onboarding_events` (append-only).
- [ ] Índice único em `crm_organization_id` (o upsert depende dele).
- [ ] Tabela de idempotência: `idempotency_key` único, guardando o
      `komune_supplier_id` devolvido.
- [ ] Edge Function `crm-pre-registration` com as cinco conferências da seção 2,
      nesta ordem, e recusa de campo proibido com **422**.
- [ ] `komune_push_secret` e `komune_webhook_secret` no Vault do projeto da
      Komune, com os mesmos valores do Vault do Triade.
- [ ] Webhook da Komune apontando para `komune-webhook` do Triade, assinando com
      `komune_webhook_secret` e mandando `X-Komune-Delivery` único por aviso,
      com reenvio em caso de `500`.
- [ ] Validação da reivindicação do lado de lá por
      `sha256(token) == claim_token_hash` e `now() < claim_token_expires_at`.
- [ ] Endpoint de reconciliação `GET /crm-sync?since=` (somente leitura) — fica
      para a v1; não é bloqueante do MVP.

## 9. O que fica para a v1

Modelo completo de campos do Apêndice D do PRD (`source_platform`,
`source_snapshot`, `terms_version/accepted_at/evidence`, `data_authorization`,
`completeness_score/breakdown`, `verified_status`, `founder_cohort`,
`first_lead_at`…), `supplier_documents`, `supplier_services`,
`supplier_photos`, reconciliação noturna e convivência de duas chaves HMAC
durante a rotação.
