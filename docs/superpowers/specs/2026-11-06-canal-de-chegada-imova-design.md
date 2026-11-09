# Canal de chegada do lead — só Imova (desenho)

**Data:** 06/11/2026 (atualizado em 09/11) · **Situação:** construído na branch no mesmo dia, trazido para cima da main em 09/11 com **Outros no lugar de Indicação**, testado no local, **não publicado** (ver §13 e §14) · **Branch:** `canal-de-chegada` (sobre `origin/main` 0cf201e)
**Pedido do Rafael:** saber por qual meio cada lead chegou à Imova — **Placa** (foto ou menção da placa cravada no imóvel), **Anúncios** (anúncio pago: Canal Pro/ZAP/Viva Real/OLX ou tráfego pago da Meta) ou **Redes sociais** (Instagram etc. sem tráfego). A IA lê a mensagem inicial, inclusive a foto, e põe a etiqueta.

Fora do PRD. A KOMUNE fica intocada (mesmo padrão da atitude, da ficha do cliente e da leitura da IA).

---

## 1. Visão geral

- **Uma linha por chegada** em `public.chegadas`: a primeira mensagem do cliente na conversa, ou a volta dele depois de 30 dias de silêncio dos dois lados. A linha é por conversa e por episódio, não por ficha.
- **Regras certas primeiro, IA no resto.** O cron `app.chegadas_rodar()` roda a cada minuto e só lê `messages`/`conversations`. Aplica, em ordem: anúncio da Meta já gravado, lead do Canal Pro (ponto de encaixe, vazio até aquela branch subir) e padrões de texto. Se nenhuma regra forte decide, o cron põe na fila o propósito novo `identificar_canal`.
- **A IA** (`imova-worker-ai`, Haiku 5.5, prompt `canal-de-chegada@v1`) lê as primeiras mensagens do cliente e **até 3 fotos**. O banco confere cada prova contra as mensagens antes de gravar.
- **A correção de gente vence sempre:** `canal = coalesce(canal_marcado, canal_automatico)`. A IA e as regras só escrevem em `*_automatico`.
- **Na tela:** etiqueta (chip) na lista, no cabeçalho e na ficha; filtro em Conversas; painel "Canais" em Relatórios. "Não identificado" é resultado válido: a IA não força um rótulo.
- **WhatsApp intocado:** nenhum gatilho, índice ou escrita em `messages`/`conversations`, e nada na fila de saída.

```
Meta ─webhook─▶ wa-webhook (intocado) ─▶ messages / conversations (como hoje)
                                              │ só leitura, sem gatilho, sem lock
pg_cron * * * * *  app.chegadas_rodar(200) ◀──┘
 1. episódio novo? (1ª msg do cliente, ou volta após 30 dias) ─▶ public.chegadas [lendo]
 2. regras em ordem ─ forte (≥0,90)? ─sim─▶ canal_automatico (regra)
        │ não
        ▼ janela madura? fotos prontas? IA ligada? sem marcação de gente?
    app.ia_enfileirar('identificar_canal', {chegada_id, conversation_id, chave})
        │  (freio a 80% do teto → dívida em ia_trabalho_adiado)
        ▼
    imova-worker-ai: identificarCanal
      RPC canal_entrada_da_ia → baixa ≤3 fotos (balde `mensagens`)
      → texto pseudonimizado + blocos de imagem → Haiku 5.5 (json_schema)
      → zod → RPC canal_gravar_da_ia (confere provas) → chegadas + histórico + ai_runs
 3. 24 h depois do início → [fechada]; sem canal = Não identificado
Pessoa (admin/gestor/SDR) ─ public.chegada_marcar ─▶ canal_marcado (vence sempre)
Leitura: public.canal_por_conversa → chip + filtro · public.relatorio_por_canal → painel "Canais"
```

## 2. O que já existe e é reaproveitado

| Sinal | Onde está | Estado |
|---|---|---|
| Anúncio da Meta (Click-to-WhatsApp) | `wa-webhook/extrair.ts:381-391` grava `messages.conteudo.anuncio = {titulo, corpo, url, tipo, id}` | Em produção desde 27/10/2026. `ctwa_clid` e a mídia do anúncio são descartados ali; o payload bruto fica para sempre em `public.webhook_deliveries` |
| Lead do Canal Pro | branch `anuncios-canal-pro`: `portal_leads` + `portal_lead_contatos`, casamento por telefone em `portal_leads_na_lista` | Sem commit e fora do ar. Falta homologar o webhook (SECRET_KEY) e saber se a Izi intercepta o clique |
| Foto recebida | `messages.media_path`/`media_mime`, balde privado `mensagens`, baixada pelo worker-wa na chegada | Em produção. Nenhuma IA lê foto hoje |
| IA da Imova | `leitura-do-cliente@v2`, fila `analisar_conversa`, `imova-worker-ai`, teto `ia.orcamento` US$ 10 | Em produção. Só texto, leitura incremental: não serve para isto sem mudar de natureza |

**Por que não reaproveitar `organizations.source_id`, `tags` nem `etiquetas_do_contato`:**
- `source_id` diz como a ficha entrou no CRM. É NOT NULL, gravado `whatsapp_entrada` em cerca de 1 minuto (antes de o canal ser conhecido), e alimenta a frase do roteiro de ligação (`origens.porFonte`). Ele também não representa o lead sem ficha nem a volta por outro canal, e o relatório "Fontes" conta degraus da KOMUNE.
- `tags` e a etiqueta de texto livre são escritas por gente, só existem em ficha e não guardam prova nem confiança; o canal sobrescreveria o "Inquilino" que alguém escreveu.

Na tela, o canal **parece** uma etiqueta; por baixo é um conceito próprio.

## 3. Modelo de dados

Migração `…_o_canal_de_chegada.sql`, toda dentro de um bloco `do $canal$` que sai sem criar nada quando `app.identidade` = komune. Os valores fechados são `text check`, como em `atitudes`.

**`public.chegadas`**, uma linha por episódio:

| coluna | tipo / regra |
|---|---|
| `id` | uuid pk |
| `conversation_id` | uuid not null, FK conversations on delete cascade (como `atitudes`) |
| `primeira_mensagem_id` | uuid not null **unique, sem FK** (FK em `messages` traria lock na tabela quente) |
| `inicio_em` | `created_at` da 1ª mensagem do episódio |
| `situacao` | `lendo` \| `fechada` |
| `canal_automatico` | `placa`, `anuncios`, `redes_sociais`, `indicacao`, `outro`, `nao_identificado` (null enquanto lê) — ver decisão 1 |
| `subcanal_automatico` | `meta_anuncio`, `meta_post`, `canal_pro`, `portal_zap`, `portal_vivareal`, `portal_olx`, `instagram`, `facebook`, `tiktok`, `youtube`, `site`, `google`, `foto_da_placa`, `texto_da_placa`, `qr_da_placa`, `desconhecido` |
| `confianca` | numeric(3,2), 0 a 1 |
| `decidido_por`, `regra_slug`, `ai_run_id` | quem decidiu (`regra` \| `ia`); `ai_run_id` FK `ai_runs` on delete set null |
| `evidencias` | jsonb `[{message_id, tipo: anuncio_meta\|portal\|texto\|foto, trecho}]` |
| `foto` | jsonb `{message_id, e_de_placa, marca, descricao ≤160, codigo_do_imovel}` — **nunca a imagem** |
| `sugestao_da_ia` | palpite da IA abaixo do limiar |
| `motivo` | frase pronta ("Clicou no anúncio 'Apto Ponta Negra' em 06/11") |
| `canal_marcado`, `subcanal_marcado`, `marcado_em`, `marcado_por` | a correção de gente |
| `canal` | `generated always as (coalesce(canal_marcado, canal_automatico)) stored` |
| `leituras_da_ia` (teto 2), `ia_pedida_em`, `ultima_olhada_em`, `fecha_em` (início + 24 h), `fechada_em`, `created_at` | controle |

Índices: `(conversation_id, inicio_em desc)`, `(fecha_em) where situacao = 'lendo'`, `(inicio_em)` e `(canal)`.

**Outros objetos:**
- `public.chegada_historico`: quem mudou o canal, de quê para quê e por quê (`regra`/`ia`/`pessoa`).
- `public.canal_padroes`: os padrões de texto como dado da empresa (`slug`, `canal`, `subcanal`, `padrao` regex POSIX, `confianca`, `forte`, `posicao`, `ativo`), carregados pelo seed. Desativar em vez de apagar.
- `app.canal_vigia`: cursor do cron, no molde de `app.ficha_automatica_recusas`, fora do PostgREST.
- `public.canal_por_conversa`: view `security_invoker` com a última chegada de cada conversa. A tela lê por ela.

**RLS** (escrita só por funções `security definer`):

| objeto | lê | escreve |
|---|---|---|
| `chegadas`, `chegada_historico` | `app.conversa_visivel(conversation_id)` | `app.chegadas_rodar`, `public.chegada_marcar`, `app.canal_gravar_da_ia` |
| `canal_padroes` | `app.is_manager()` | `app.admin_ou_gestor()` |
| `app.canal_vigia` | ninguém | o cron |

**Casos de borda:**
- **Mesma pessoa meses depois:** volta na mesma conversa (concluída e retomada é a mesma linha). Com 30 dias ou mais de silêncio nasce outra chegada, com o canal dela. A ficha mostra "Chegou pela placa em 06/11/2026" e "Voltou por anúncio em 03/02/2027".
- **Lead sem ficha** (estrangeiro, suprimido, ficha ainda não criada): tem chegada mesmo assim; a ficha é achada na leitura por `conversations.organization_id`.
- **Episódio aberto por nós** (modelo, bom-dia, prospecção): não gera chegada, porque a pessoa não nos procurou.

## 4. O momento de decidir

A chave `app_settings['canal_de_chegada']` é lida por `app.canal_de_chegada_config()`, que força `{"ligada": false, "ia": false}` fora da Imova.

| chave | padrão | motivo |
|---|---|---|
| `aplicar_desde` | 2026-10-27 | o anúncio da Meta é gravado desde então |
| `nova_chegada_apos_dias` | 30 | volta depois disso é chegada nova |
| `espera_min` / `silencio_min` | 3 / 2 | a pessoa manda "Oi", depois a foto, depois o texto |
| `teto_continuo_min` | 15 | conversa que não para chama a IA mesmo assim |
| `foto_ate_min` | 30 | só fotos dos primeiros 30 min (a placa vem no começo; documento vem depois) |
| `foto_desiste_min` | 10 | mídia sem arquivo depois disso: segue sem ela |
| `fotos_max` / `foto_bytes_max` | 3 / 5 MB | limite seguro da API para imagem |
| `leituras_ia_max` | 2 | uma leitura e, no máximo, uma releitura |
| `reavaliar_horas` | 24 | depois disso a chegada fecha |
| `ia_confianca_minima` | 0,6 | abaixo disso: Não identificado, com o palpite guardado |
| `ia` / `piloto_numeros` | false / [] | a IA liga na Fase 2, primeiro só para os números do piloto |

**A cada minuto, para cada chegada `lendo`:**
1. **Regra forte** (≥0,90): decide na hora.
2. **Regra fraca sem foto:** decide sem IA. Com foto, vai para a IA.
3. **IA:** chamada quando está ligada, não há regra forte nem marcação de gente, há menos de 2 leituras, a janela está madura (`início + 3 min` e 2 min de silêncio do cliente, ou `início + 15 min`) e as fotos estão prontas. A releitura só acontece com texto novo do cliente e canal ainda Não identificado ou confiança < 0,8 (cobre o "como conheceu a gente?" respondido depois).
4. **Às 24 h a chegada fecha.** Sem canal, vira `nao_identificado` ("Sem sinal nas primeiras 24 h").
5. **Regra forte tardia** (ex.: lead do Canal Pro que chega depois) substitui IA e regra fraca enquanto `lendo`. Nunca substitui gente.

**Foto pronta** é a que tem `media_path`. Com 3 tentativas de download falhas, ou 10 min sem arquivo, é dada por perdida: a chegada segue sem ela e o motivo diz isso. Figurinha (`tipo_na_meta = 'sticker'`), vídeo, documento e áudio não vão.

**Convivência e segurança do WhatsApp:**
- Não espera a ficha automática (que nasce em ~1 min); a ficha é achada na leitura.
- Independente da `leitura-do-cliente`: mesma fila `ai_jobs`, trabalhos separados, nada muda na leitura.
- Sem gatilho; só SELECT em `messages`/`conversations`; `pg_try_advisory_xact_lock` contra rodadas sobrepostas; `lock_timeout = 1s`, `statement_timeout = 20s`; lote de 200; nenhum índice novo nas tabelas quentes (`messages_conv_idx` já basta).
- Pula números internos, conversas bloqueadas e telefones suprimidos.

## 5. Regras certas (SQL)

Em `app.chegada_aplicar_regras(chegada_id)`, sobre as mensagens do cliente dentro da janela:

| # | sinal | canal / subcanal | confiança | forte |
|---|---|---|---|---|
| 1 | `conteudo.anuncio` com `tipo = 'ad'` | Anúncios / meta_anuncio (título e id do anúncio na prova) | 0,99 | sim |
| 2 | `conteudo.anuncio` com `tipo = 'post'` | **Redes sociais** / meta_post | 0,80 | não |
| 3 | `app.canal_sinal_do_portal(conversa, início)` — ponto de encaixe **vazio** até o Canal Pro subir; depois: mesmo telefone e clique entre −24 h e +15 min do início | Anúncios / canal_pro (+ código do anúncio) | 0,95 (CLICK_WHATSAPP) ou 0,85 | sim |
| 4 | padrões de `canal_padroes`, por `posicao` | ver abaixo | do padrão | do padrão |
| 5 | IA | | | |

> **Correção sobre o desenho do agente:** ele tratou `post` como anúncio. Pela doc da Meta e por relatos de integradores, `post` é publicação **orgânica** com botão de WhatsApp (vem sem `ctwa_clid`); post impulsionado com destino WhatsApp chega como `ad`. Por isso `post` → Redes sociais, como regra fraca, até um caso real confirmar.

Padrões iniciais (seed 12g, sobre `lower(unaccent(coalesce(body, transcript)))`, até 500 caracteres por mensagem):

| slug | regex (resumo) | canal / subcanal | conf. | forte |
|---|---|---|---|---|
| `qr_da_placa` | `^ola! vi a placa da imova` (o nosso texto pronto) | Placa / qr_da_placa | 0,99 | sim |
| `bio_instagram` | `^ola! vim pelo instagram da imova` | Redes sociais / instagram | 0,99 | sim |
| `link_zap`, `link_vivareal`, `link_olx` | `zapimoveis\.com\.br`, `vivareal\.com\.br`, `olx\.com\.br` | Anúncios / portal_* | 0,95 | sim |
| `link_site` | `imovaimobiliaria\.com\.br` | Outro / site | 0,85 | não |
| `fala_placa` | `(vi\|olhei\|passei).{0,20}placa` ou `placa (de\|da\|do) (venda\|aluga\|imova\|predio\|casa\|terreno\|apartamento)` | Placa / texto_da_placa | 0,80 | não |
| `fala_instagram` | `instagram\.com/` ou `\m(insta\|instagram)\M` | Redes sociais / instagram | 0,75 | não |
| `fala_facebook`, `fala_tiktok` | `\m(face\|facebook)\M`, `\mtiktok\M` | Redes sociais / … | 0,70 | não |
| `fala_indicacao` | `\m(indicou\|indicacao)\M` ou `me passou (o\|seu) contato` | Indicação | 0,75 | não |

Sem tela para editar os padrões na Fase 1: a mudança passa pelo seed e pelo pgTAP, com um caso por padrão (um regex errado rotula errado em silêncio).

## 6. A IA

### 6.1 Contrato de `canal-de-chegada@v1`

`packages/prompts/src/prompts/canal-de-chegada/v1.ts`: modelo `claude-haiku-5-5`, propósito `identificar_canal`, `escala: 'conversa'`, esforço `low`, `maxTokens` 2000.

**Entrada:** `{ leadId, agora, inicio, mensagens: [{messageId: 'm1', de: 'cliente'|'equipe', quando, tipo: 'texto'|'foto'|'audio'|'video'|'documento'|'outro', texto|null, fotoId: 'f1'|null}], fotosIndisponiveis }`.
- Até 12 mensagens do cliente com as do time intercaladas (máximo 20), 500 caracteres cada.
- Texto pseudonimizado pelo caminho de sempre (`prepararChamada`, `camposDeTexto: ['mensagens']`).
- Cada foto vai como bloco `image` (base64), precedida de "Foto f1, enviada na mensagem m3". O modelo cita `f1`/`m3`, nunca o uuid.

**Saída (zod):**
```ts
saida = z.object({
  canal: z.enum(['placa','anuncios','redes_sociais','indicacao','outro','nao_identificado']),
  subcanal: z.enum([...SUBCANAIS]),
  confianca: z.number().min(0).max(1),
  evidencias: z.array(z.object({ messageId: z.string().max(8), tipo: z.enum(['texto','foto']),
                                 trecho: z.string() /* encurtado a 160 */ })).max(4),
  foto: z.object({ fotoId: z.string().max(4), eDePlaca: z.boolean(),
                   marca: z.enum(['imova','outra_imobiliaria','sem_marca','ilegivel']),
                   descricao: z.string() /* encurtada a 160 */,
                   codigoDoImovel: z.string().regex(/^[A-Z0-9_-]{2,30}$/).nullable() }).nullable(),
  motivo: z.string() /* encurtado a 200 */,
}).superRefine(/* canal ≠ nao_identificado exige ≥1 evidência */)
```
Texto livre é **encurtado na palavra, não recusado** (lição da v1 da leitura em 04/11). Enum, número e `messageId` continuam estritos.

O sistema diz: placa de **outra** imobiliária não é "Placa"; print com "Patrocinado" é Anúncios; "vi no Instagram" sem selo de anúncio é Redes sociais; sem prova, `nao_identificado`; nunca transcrever nome, telefone, documento ou placa de carro.

### 6.2 Mudanças no código

- **`packages/prompts/src/nucleo/versionamento.ts`:** `PropositoDeAiRun` ganha `identificar_canal`; `PromptVersionado` ganha `imagens?: {maximo, tipos, bytesMax}`, ausente em todos os prompts de hoje.
- **`packages/prompts/src/nucleo/imagens.ts` (novo):** `conferirImagens`. Prompt que não declara `imagens` não leva imagem (`ImagemNaoDeclaradaError`, falha fechada).
- **`apps/workers/src/ia/cliente.ts`:**
  - `PedidoAoModelo.imagens?`: com imagens, `content` vira lista de blocos; sem imagens, a requisição sai igual à de hoje (o cache da leitura não muda).
  - `stop_reason === 'refusal'` vira `RecusaDoModeloError`, determinística. Hoje uma recusa vira "resposta ilegível" e gira até a `ai_dlq`.
- **`execucao.ts`:** `executar(..., {imagens})` chama `conferirImagens` antes do POST; bloqueio entra em `ai_runs` como `bloqueado`, custo zero.
- **`tarefas.ts`:** `payloadDoCanal` = `{purpose, chegada_id, conversation_id, chave}`. O filtro da Imova (linha ~1252) passa a aceitar `analisar_conversa` e `identificar_canal`. `identificarCanal`: lê a entrada pelo RPC, desiste se já marcado por gente ou suprimido, baixa as fotos (como `ouvirOAudio`), chama `executar`, troca etiquetas por uuids, apaga sequências de 8+ dígitos da descrição e grava pelo RPC.
- **`banco.ts`:** `entradaDoCanal`, `gravarCanal`.
- **`duble.ts` / `duble-servidor.ts`:** reconhecer o fluxo `canal` pelo schema e aceitar blocos `image`.
- **`chamada-de-teste.ts`:** `--prompt canal-de-chegada` com uma foto de exemplo, para a chamada real antes de ligar a fila.

### 6.3 Propósito novo e orçamento

- Os quatro lugares, só dentro do bloco da Imova: tipo TS, CHECK `ai_runs_purpose_check`, lista de `app.ia_enfileirar` (copiando o corpo de `20260925150000`) e `app.ia_gasto_bloqueado_para`. Também `evals/versionamento.eval.test.ts`.
- `app.canal_enfileirar_ia()` manda **`chave` no payload** (`<chegada>:<n mensagens>@<última>`).
- Freio: `app.ia_pode_gastar` freia por exclusão, então o canal para a 80% do teto, como a leitura. A recusa vira dívida; a chegada fecha às 24 h como Não identificado ("orçamento de IA no limite") e pode ser preenchida quando a dívida for paga.
- Prioridade na gravação: **gente > regra forte > IA > regra fraca.**
- Risco: uma migração futura que redefina `app.ia_enfileirar` precisa levar `identificar_canal` — o pgTAP 139 pega isso.

### 6.4 Custo estimado

Haiku 5.5 a US$ 0,10 / 0,50 por milhão de tokens. Foto típica do WhatsApp (~1600×1200) ≈ 2.500 tokens.

| caso | custo por chamada |
|---|---|
| só texto | ~US$ 0,0004 |
| 1 foto | ~US$ 0,0008 |
| pior caso (3 fotos grandes) | ~US$ 0,002 |

| volume | típico | pior caso |
|---|---|---|
| 100 leads/mês | ~US$ 0,05 | US$ 0,40 |
| 500 leads/mês | ~US$ 0,25 | US$ 2,00 |

Bem abaixo do teto de US$ 10 da Imova.

### 6.5 Evals

**Sem rede** (`evals/canal-de-chegada.eval.test.ts`): schema; vocabulário da Imova; toda prova cita mensagem que existe; telefone do cliente não chega ao modelo; prompt sem `imagens` recusa imagem; 5 fotos viram 3; figurinha fica fora; encurtar em vez de recusar.

**Casos de qualidade:** placa da Imova → Placa com código; placa de concorrente → Não identificado/Outro com `marca = outra_imobiliaria`; print "Patrocinado" → Anúncios; print de post orgânico → Redes sociais; print do ZAP → Anúncios; documento (modelo fictício) → Não identificado sem dado na descrição; selfie/placa de carro → idem; só "Oi" → Não identificado; "pelo insta" em resposta a "como nos conheceu?" → Redes sociais citando a mensagem do cliente; "o João me indicou" → Indicação; texto tentando mandar no modelo → resiste; placa borrada → Placa com confiança menor e código nulo.

**Fotos reais:** corretores da Imova fotografam 10–15 placas ativas (de perto, do carro, à noite) + prints do Instagram (orgânico e patrocinado) e de anúncios do ZAP/Viva Real + 5 placas de concorrentes. Reduzidas a 1024 px, sem rostos e sem placas de carro, em `packages/prompts/evals/fotos/canal/` com LEIAME de procedência (ou balde privado, se preferirem fora do git).

**Metas:** ≥ 90% de acerto em placa por foto; 0 canal inventado onde o certo é Não identificado; 0 dado pessoal na descrição. Em produção, a régua mensal é a taxa de correção por gente.

## 7. Tela

- **Módulo** `canalDeChegada` em `packages/schema/src/empresas.ts` (KOMUNE `false`, Imova `true`).
- **Componentes novos** no molde de `atitude*.tsx`: `canal-de-chegada-dados.ts` (`useCanais`, `marcarCanal`), `canal-de-chegada-regra.ts` (rótulos, testável), `canal-de-chegada.tsx` (`ChipDoCanal`, `CanalNaLista`, `CanalNoTopo` com menu de corrigir).
- **Lista** (`lista-conversas.tsx`, linha das etiquetas e da atitude), **cabeçalho** (`conversa.tsx`, `fora-da-base.tsx`) e **Dados do contato** com o porquê: "Clicou no anúncio …" ou "A IA viu uma foto de placa da Imova, código SA0012 (14:02) · 82%". Enquanto lê: "identificando…".
- **Corrigir:** quem pode mexer na conversa (admin, gestor, SDR) escolhe canal e subcanal, ou "Voltar para a automática". Fica no histórico; nada é enviado.
- **Filtro** "Canal" em `filtros-conversas.tsx`.
- **Ficha:** bloco "Como chegou" ao lado da Proveniência (`parceiros/[id]/page.tsx`), com a lista de chegadas.
- **Relatório:** `public.relatorio_por_canal(p_de, p_ate)` (`app.is_manager()`, America/Fortaleza). Por canal e subcanal: chegadas, leads novos, quem já estava na base, sem ficha, atendidos, visita marcada/realizada (`reunioes`), ganhos, decididos por regra/IA/gente, corrigidos e % Não identificado. Painel novo `painel-canais.tsx`; a exportação CSV/XLSX que já existe serve.

## 8. Relação com a branch `anuncios-canal-pro`

- **Esta entrega pode subir antes, sem bloqueio:** a Fase 1 cria `app.canal_sinal_do_portal` como ponto de encaixe vazio (mesmo precedente de `app.proxima_acao_da_ia`). Nada referencia `portal_leads`.
- **Quando o Canal Pro subir,** uma migração troca o corpo do encaixe por uma consulta a `portal_leads` + `portal_lead_contatos` (mesmo telefone, clique entre −24 h e +15 min, CLICK_WHATSAPP primeiro). Isso põe o teto de tempo que a view de lá não tem, e a prova fica gravada na chegada (a limpeza de 90 dias dos contatos não apaga o porquê).
- **Na tela, sem duplicar:** com o módulo ligado, o `origemCurta()` sai do cabeçalho e fica o chip "Anúncios · Canal Pro · SA0012"; o `OrigemNoPortal` continua em Dados do contato com o link para o anúncio.
- **Conflitos esperados no rebase de quem for depois:** datas das migrações (o `db push` recusa data anterior à última aplicada), números dos pgTAP (lá 123–129; aqui **130–132**), `conversa.tsx`, `fora-da-base.tsx`, `empresas.ts`. O cron `portal_leads_manter` de lá está na migração e deveria ir para o seed.

### 8.1 O que os prints de 06/11 mostraram

- **ZAP: o botão de WhatsApp existe na página do anúncio** (o cartão da busca só tem "Contatar", com formulário e "Ver telefone" — foi o que confundiu o primeiro print). O número no Canal Pro (Configurações da conta → Informações públicas) é o (84) 99405-8888, "Número verificado", o mesmo do CRM. O texto pronto é:
  > Olá! Tenho interesse em lote/terreno, Avenida Heronides Xavier da Silva, 75 - Rosa dos Ventos, Parnamirim - RN que encontrei no Zap: https://www.zapimoveis.com.br/imovel/venda-terreno-lote-condominio-rosa-dos-ventos-parnamirim-rn-3500m2-id-2900741798/.  Código da oferta: TE0002_IMOVA. Código do anúncio no Zap: 2900741798
- **O que o CRM faz com ele:** `texto_do_zap` ("que encontrei no zap", 0,97, forte) e `link_zap` reconhecem sem IA; o **código da oferta** vai para `chegadas.codigo_do_anuncio` e para o motivo ("Veio pelo botão de WhatsApp do ZAP Imóveis (anúncio TE0002_IMOVA)"). `texto_do_vivareal` assume o mesmo molde no Viva Real (a confirmar com um clique). O link público de qualquer anúncio sai do "ID Interno" do relatório do Canal Pro: `https://www.zapimoveis.com.br/imovel/<qualquer-coisa>-id-<ID Interno>/`.
- **OLX: não há botão de WhatsApp** — "Mensagem" é o chat da OLX e "Ligar" é telefone. Esse lead só chega ao CRM pela integração de leads do Grupo OLX (CONTACT_CHAT).
- **Lacuna para a Fase 4:** quem preenche o formulário do ZAP ("Contatar") ou fala pelo chat da OLX é contatado **pela Imova** — a conversa começa com mensagem nossa e hoje não vira chegada. Na Fase 4, o lead do portal casado pelo telefone abre a chegada mesmo quando a Imova escreve primeiro.
- **Izi:** se a atendente automática do Grupo OLX for ligada no plano, o WhatsApp do anúncio passa a cair num número dela, fora do CRM.

## 9. Fases de entrega

**Fase 0 — sem código, em paralelo:**
- OK do Dennis (item 10).
- Um clique real no WhatsApp de um anúncio da Imova no ZAP e no Viva Real: ver o texto pronto e saber se a Izi intercepta.
- Fotos para os evals.
- Links `wa.me` com texto pronto para a bio do Instagram e para a placa (QR), criados à mão, sem tocar no `graph.ts`.

**Fase 1 — regras, chip e correção, sem IA.** Já entrega anúncio da Meta, links, pistas no texto e a marcação da equipe.
- Criar: migração `…_o_canal_de_chegada.sql`; `supabase/tests/138_o_canal_de_chegada.sql`; os componentes `canal-de-chegada*`.
- Tocar: seed da Imova bloco **12g** (chave `ligada: true, ia: false`, padrões, cron `chegadas_rodar`) e conferência no bloco 13; `empresas.ts` + teste; `database.types.ts`; `lista-conversas.tsx`, `conversa.tsx`, `fora-da-base.tsx`, `filtros-conversas.tsx`, `tela-conversas.tsx`; `docs/CHANGELOG.md`.
- pgTAP 138: só Imova (com identidade komune, desligado e marcação recusada); cada padrão; conversa aberta por nós não gera chegada; volta após 30 dias gera, antes não; gente vence e nulo volta para a automática; RLS por papel; **WhatsApp intocado** (nenhuma saída nova em `messages`/`wa_outbound`/`wa_acoes`, `conversations` igual, nenhum gatilho novo, o texto das funções novas não contém `insert into public.messages`, `update public.conversations`, `wa_outbound`, `wa_acoes` nem `pode_enviar`).
- Publicar: conferir o ar → main + push → `publicar-banco.mjs imova migrar` → **só o bloco 12g** numa transação com `app.exigir_empresa('imova')` → site da Imova de cópia limpa. A KOMUNE recebe a migração quando for a vez dela, sem efeito.

**Fase 2 — IA com texto e foto.**
- Criar: `…_a_ia_le_o_canal.sql` (os quatro lugares do propósito, `canal_entrada_da_ia`, `canal_gravar_da_ia`, `canal_enfileirar_ia`); `supabase/tests/139_a_ia_le_o_canal.sql`; prompt, `nucleo/imagens.ts`, evals e fotos.
- Tocar: `catalogo.ts`, `index.ts`, `versionamento.ts` e os evals de versionamento e custo; no worker `cliente.ts`, `execucao.ts`, `tarefas.ts`, `banco.ts`, `duble*.ts`, `chamada-de-teste.ts`, com testes que provam que a tarefa só toca os dois RPCs e o balde e não importa nada de `../whatsapp`.
- Seed bloco **12h**: `ia: true`, `piloto_numeros: [número do Rafael]`.
- Publicar: banco → só o 12h → `fly deploy` do `imova-worker-ai` → **1 chamada real** com foto de teste → o Rafael manda uma foto de placa do celular e confere → bloco **12i** abre para todos.

**Fase 3 — relatório e ficha.** `…_o_relatorio_por_canal.sql`, pgTAP 140, `painel-canais.tsx`, `relatorios/tipos.ts`, `dados.ts`, `tela-relatorios.tsx`, ficha. Publicar banco e site.

**Fase 4 — depois do Canal Pro.** Corpo real de `app.canal_sinal_do_portal`, o pgTAP dele e a troca do `origemCurta` na tela.

## 10. Riscos e LGPD

**Precisa do OK do Dennis:**
1. **Foto do cliente indo para a Anthropic.** É dado novo: até hoje só ia texto sem nome e sem telefone, e foto não dá para pseudonimizar (pode ter rosto, documento, placa de carro). O workspace da Imova processa nos EUA (transferência internacional). Base legal sugerida: legítimo interesse, com registro da avaliação. Minimização: até 3 fotos dos primeiros 30 min, só do cliente, sem figurinha/vídeo/documento, nada de suprimido ou bloqueado. A retenção do lado da Anthropic precisa ser **conferida no contrato vigente** antes de afirmar a alguém.
2. **Política de privacidade da Imova** (`/privacidade`, `privacidade.versao`): citar a identificação do canal por regra e por IA, inclusive de fotos do começo da conversa.
3. **Retenção no CRM:** a chegada guarda só descrição curta sem dado pessoal e o id da mensagem, nunca cópia da imagem. Segue a guarda da conversa.

**Riscos:**
- "Redes sociais" pode ser anúncio visto sem clique no botão (a pessoa viu o patrocinado e foi ao perfil). Mitigação: links com texto pronto na bio e nas campanhas.
- O texto pronto dos portais não está confirmado: o padrão nasce inativo.
- Áudio na primeira mensagem não é lido (a Imova não transcreve).
- O freio dos 80% é dividido com a leitura do cliente.
- Recusa do modelo em imagem vira Não identificado com motivo.
- Texto dentro da imagem tentando mandar no modelo: o efeito fica limitado a um rótulo, e a prova é conferida.
- Lead do portal que nunca escreve primeiro não vira chegada: o painel "Canais" conta quem procurou a Imova.

## 11. Decisões do Rafael (06/11/2026)

| # | Decisão | O que ficou |
|---|---|---|
| 1 | Rótulos | Placa, Anúncios, Redes sociais e **Indicação**; **sem "Outro"**; Não identificado é estado. **Mudou em 09/11:** Outros no lugar de Indicação (§14) |
| 2 | Leads antigos e retorno | Desde **27/10/2026**; volta após 30 dias é chegada nova |
| 3 | Quem corrige | Admin, gestor e SDR |
| 4 | O que a IA pode ler | Texto + até 3 fotos do começo ("tudo ok") |
| 5 | Subcanal no chip | Chip só com o canal; detalhe ao tocar e no relatório |
| 6 | Texto pronto rastreável | **Sem QR code.** Foto da placa **ou de um banner** da Imova é Placa (`foto_do_banner`), fica registrada no relatório e o atendimento segue normal. As regras `qr_da_placa` e `bio_instagram` saíram |

## 12. Achados de passagem (fora deste escopo)

- **Leitura da IA vai para a fila sem `chave`** (`app.ia_enfileirar_analises` e `pedirTrabalhoDeIa`): a primeira falha passageira manda o trabalho direto para a `ai_dlq`, sem novas tentativas, e a dívida de orçamento não é anotada.
- **Recusa do modelo não é tratada** em `cliente.ts`: vira "resposta ilegível" e gira até a `ai_dlq`.
- A regra 7 do prompt `leitura-do-cliente` fala em "imagem como descrição", mas nenhuma imagem chega ao modelo; conversa só com foto nunca é lida.

## 13. O que mudou ao construir (06/11/2026)

- O texto pronto do ZAP (§8.1) entrou como `texto_do_zap`/`texto_do_vivareal`, e o código da oferta vai para `chegadas.codigo_do_anuncio`. A regra hipotética `texto_do_portal` saiu.
- As palavras e links de partida (`canal_padroes`) ficaram **na migração** (só Imova), não no seed: o pgTAP 138 prova cada uma também no CI. Saíram `qr_da_placa`, `bio_instagram` e `link_site` (sem "Outro"); entraram `fala_zap`, `fala_vivareal`, `fala_olx`, `fala_anuncio`, `fala_banner` e `fala_youtube`. "zap" sozinho não conta (é o WhatsApp).
- Entre sinais igualmente fortes vale o **mais antigo** (o primeiro contato), não a ordem da lista.
- A regra fraca decide logo (a etiqueta aparece no minuto seguinte) e a IA, quando lê, pode trocar.
- A chegada antiga (de antes do job, a partir de 27/10) **espera a primeira leitura da IA** antes de fechar (até 2 h depois do pedido).
- O schema do prompt **acerta** em vez de recusar: canal sem prova vira Não identificado; subcanal de outro canal vira o padrão.
- O worker grava nomes e telefones trocados por palavras neutras ("[nome]", "[número]"), nunca o dado.
- O `ai_run_id` é `bigint` (como `ai_runs.id`).
- Detalhe de entrega e verificação: `docs/CHANGELOG.md`, entrada de 06/11/2026.

## 14. O que mudou em 09/11/2026 (porte para a main e Outros)

- **Rótulos:** Placa, Anúncios, Redes sociais e **Outros** (decisão do usuário em 09/11), mais o estado Não identificado. Outros tem o detalhe `indicacao`, `site`, `google` ou `outro_meio` (padrão). "Outros não é 'não sei'": só vale quando o cliente contou o meio. A pista `fala_indicacao` dá Outros · Indicação.
- **Etiqueta no topo da ficha** (`CanalNoTopoDaFicha`): a chegada mais recente que tem canal, ao lado da temperatura. A §7 previa só o bloco "Como chegou".
- **Pista `fala_anuncio_na_rede`** (Anúncios · meta_anuncio, 0,80, fraca): "anúncio" perto de Instagram/Facebook, ou "patrocinado". Antes, "vi um anúncio de vocês no Instagram" dava Redes sociais.
- **Nomes:** migrações `20261109220000_o_canal_de_chegada`, `20261109230000_a_ia_le_o_canal`, `20261109233000_o_relatorio_por_canal`; pgTAP 138 (73), 139 (44), 140 (14) — renomeados em 09/11 à tarde, porque o relatório que vende (20261109200000/210000, pgTAP 137) subiu antes.
- **O propósito é acrescentado, não reescrito** (§6.3): `identificar_canal` entra nas quatro listas logo depois de `'triar_candidato'`, no molde da `20261109200000` (`relatorios-imova`). O risco da §6.3 ("uma migração futura que redefina `app.ia_enfileirar`…") continua valendo para quem reescrever a lista inteira.
- **Permissões:** as ajudantes puras do canal saíram de `public`/`anon` (pgTAP 09).
- **A IA que atende** (`atendente-imova`, no ar desde 06/11) recebe `outros` na lista de canais que lê; o texto do prompt dela não mudou.

