# Pivô: a lista vem do Google Maps, o robô responde sozinho

**O que é:** troca a fonte da lista de prospecção (Radar → CSV do Google Maps) e liga a resposta automática no WhatsApp com texto que uma pessoa escreveu antes.
**Quem decidiu:** Rafael, CEO, em 24/09/2026 — sete decisões, listadas em §2.
**Esforço:** 13 dias úteis nas quatro fases; 16,75 com os oito itens de carona (§7, §9).
**Ordem:** telefone primeiro, robô depois. Robô rápido numa fila sem número não fala com ninguém.
**Se ninguém fizer nada:** a fila de revisão segue com 277 candidatos e **um** telefone, o coletor do Radar continua custando US$ 3,19/mês para trazer nome sem número, e quem responde à campanha de 150 mensagens por dia continua sem resposta até alguém abrir a caixa — inclusive às 22h, quando hoje recebe um "a gente responde quando voltar".

---

## 1. O que muda, e por quê

**Hoje.** A lista vem de duas portas: o coletor do Radar, que lê o casamentos.com.br (`supabase/migrations/20260904001802_coletor_do_radar.sql`, adaptador `apps/workers/src/ingest/casamentos.ts`), e a importação de planilha (`supabase/migrations/20260904001820_importacao_de_planilha.sql`). As duas passam pela mesma esteira — `raw_capture → source_record → supplier_candidate → revisão → organizations` (ADR-08) — e param na fila de curadoria em `/radar`.

No WhatsApp o robô fala **três** vezes, no máximo: o menu do bot de entrada e a resposta da opção escolhida (`20260916110000_o_bot_de_entrada.sql`), mais o aviso de ausência `GEN-SYS-AUSENCIA`, um a cada 12 h (`20260922120000_automacoes_do_atendimento.sql:116`). Os três saem como `bot_fixed` com `template_id`. Todo o resto é rascunho que uma pessoa aprova antes de sair: `app.messages_guard` recusa mensagem `bot_ai` sem rascunho aprovado, com a frase "nada sai sozinho (ADR-05)". **A versão viva da função está em `20260916130000_a_ficha_entra_nas_mensagens_ja_gravadas.sql:141`** — ela substituiu as de `20260905000200`, `20260905000300` e `20260905000400`, e é essa que qualquer mudança tem de reescrever inteira.

O aviso de ausência não sai "fora de seg–sex 8h–17h45": `app.ausencia_responder` chama `app.janela_do_canal(c.channel, now(), true)`, que também abre **sábado 10h–12h** e fecha em **feriado**.

**Passa a fazer.** A lista vem do `google-maps-scraper-kit` em Docker local (127.0.0.1:8080), que devolve CSV com telefone. O CSV entra pela **porta da planilha** — nenhum caminho novo de escrita para a base (ADR-08). O coletor do Radar é desligado por `public.radar_alternar_fonte(<id de casamentos_com_br>, false)` — um `update`, sem deploy. A fonte fica desligada e não apagada: os 277 candidatos já coletados apontam para ela, e apagar a linha quebraria a proveniência que o RF-RAD-05 exige.

A curadoria continua, e a tela passa a se chamar **Revisão**. No WhatsApp, o robô responde **escolhendo entre textos prontos** — a IA classifica a intenção, o banco escolhe a resposta. A IA não escreve texto livre.

**Por quê.** A fila do Radar tem **277 candidatos e um telefone** (`docs/CHANGELOG.md`, 17/09/2026):

| Fonte | Candidatos | Com telefone | Com nota |
|---|---|---|---|
| casamentos.com.br | 260 | **0** | 140 |
| planilha | 17 | 1 | 0 |

Não é defeito do coletor: **o casamentos.com.br não publica o número** — ele fica atrás de `emp-ShowTelefonoTrace.php`, que está em `Disallow` no robots.txt, e o R03 §2.1 fixou "não automatizar Ver telefone" como mitigação escrita. Naquele mesmo dia foi lido o `robots.txt` de cada fonte que publica telefone: telelistas.net não responde (sem robots, o RF-RAD-01 proíbe ligar a fonte), guiamais.com.br monta a listagem em JavaScript e não tem dado no HTML, solutudo.com.br proíbe exatamente `/empresas/busca/resultados*`, a OLX devolve 403 até no `robots.txt`, e o Places tem o telefone mas os Termos proíbem guardar (R03 §2.4). A conclusão ficou registrada: **não existe caminho de raspagem legal e barato para telefone.**

O CRM inteiro começa numa mensagem — funil, cadência, campanha, robô. A esteira está pronta e a triagem ordena bem uma fila de gente que não dá para chamar. Esta spec troca a fonte por uma que entrega o número, e assume o custo por escrito, num ADR.

### O que NÃO muda

- **Funis, etapas e temperatura**: continuam no Postgres (ADR-03). Nada aqui toca `deals`, `stages` nem a regra de temperatura.
- **Metas, Assistente de cobrança, agenda e rotas**: intactos.
- **Campanhas** (`/envios`): os tetos de 21/09 continuam de pé — 150/dia e 60/hora (`app.pode_enviar`, passo 6), intervalo sorteado entre 70% e 130% do passo, parada automática em 3 saídas **e** acima de 2% do enviado (`20260921100000_envios_em_massa.sql:783`). O aquecimento **20/35/45 por semana** é `app.teto_do_canal` (`20260904001700_cadencias_e_precadastro.sql:424`) — a Fase 3 muda **o que ele conta**, não o número (§5.3).
- **Janela de horário para mensagem que NÓS começamos** (RF-CON-11): inalterada. O robô responder 24 h não abre porta para prospectar 24 h.
- **Pré-cadastro na Komune**: continua só pela Edge Function `crm-pre-registration` com HMAC, do lado da Komune (aqui há a fila `komune_sync`, o `komune-webhook` e o dublê em `supabase/functions/_dubles`), e só depois de autorização em `consent_events`. Essa integração ainda não está ligada (`docs/CHANGELOG.md:587`).
- **WhatsApp Cloud API oficial, conexão direta** (ADR-06): sem BSP, sem intermediário, sem Coexistence (decisão de 14/09, `docs/operacao/whatsapp-no-crm.md`; o PRD §9.1 ainda diz "Coexistence no Número 1" e está desatualizado).
- **`app.messages_guard` continua recusando `bot_ai` sem rascunho aprovado.** O ADR-05 não cai — passa a valer só para texto que a IA **escreve**. E vale o princípio desta spec: **o guard só é tocado para apertar, nunca para afrouxar**.[^1]
- **Curadoria humana** (**RF-RAD-11**, não RF-RAD-08 — esse é "sobrevivência de campos"): quem vira parceiro continua sendo decisão de gente.
- Os guardrails de LGPD e de Meta: lista completa em **§10**, uma vez só.

---

## 2. As duas decisões que precisam ficar escritas (ADRs)

As sete decisões de Rafael, 24/09/2026:

1. **Raspar o Google Maps** com o `google-maps-scraper-kit` (MIT, wrapper do `gosom/google-maps-scraper`), Docker local, dirigido pelo Claude Code. Ciente de que contraria os ToS do Google e de que o R06 §B.1 SCR-04 já havia recusado. A decisão revoga essa recusa, por escrito. → **ADR-12**.
2. **Radar desligado, curadoria viva.** O coletor para; a fila continua e a tela vira **Revisão**.
3. **O robô responde sozinho, escolhendo texto pronto.** A IA classifica; o banco escolhe. → **ADR-13**, que altera o ADR-05.
4. **24 h por dia**, com frase de transparência e a palavra **HUMANO** transferindo. A mensagem de ausência de 22/09 sai de cena como está hoje.
5. **Telefone primeiro, robô depois.**
6. **Kapso e qualquer BSP estão fora** — ADR-06 reafirmado.
7. **O campo de valor do negócio saiu** hoje: migração `20260924120000_sem_valor_no_negocio.sql`, commit `3ea56c6`, desfazendo o que a `20260922110000` tinha trazido contra o RF-REL-12. Fato consumado; não volta nesta spec.

O próximo número livre é **ADR-12**. A tabela do PRD §9.1 para no ADR-11 (`docs/PRD-CRM-Captacao-KOMUNE-v1.0.md:529`) e nenhum arquivo de `supabase/`, `apps/`, `packages/` ou `docs/` cita ADR-12 ou ADR-13. As duas entram na mesma tabela, no formato das onze anteriores; o texto longo entra em **§13 do PRD** como item numerado — mesmo par que o repositório usou em 21/09 (`docs/CHANGELOG.md:2753`).

### 2.1 ADR-12 — Raspar o Google Maps

**Linha da tabela §9.1** (colar depois do ADR-11, linha 529):

| # | Decisão | Alternativas consideradas | Justificativa |
|---|---|---|---|
| ADR-12 | **Raspar o Google Maps** para montar a lista de prospecção: `google-maps-scraper-kit` (MIT, wrapper do `gosom/google-maps-scraper`) em Docker na máquina dedicada, exposto só em `127.0.0.1:8080`, dirigido pelo Claude Code. O CSV (nome, telefone, e-mail, site, categoria, endereço, nota, nº de avaliações) entra pela esteira do ADR-08 como a fonte `google_maps_raspado`. **Decisão de Rafael em 24/09/2026**, que revoga por escrito a recusa do R06 §B.1 SCR-04 | (a) **Places API (New)**, o caminho do PRD; (b) **seguir sem telefone**, esperando fonte melhor; (c) **Outscraper / Apify / SerpApi**, que raspam o Maps e vendem o CSV | A Places API resolve o custo e não resolve o problema. Só o SKU **Enterprise** devolve `nationalPhoneNumber` e `websiteUri` (R03 §2.4: Text Search US$ 35/mil com 1.000 grátis/mês; Place Details US$ 20/mil com 1.000 grátis/mês; ≈ US$ 10–20 no primeiro mês em Natal) — e os Service Specific Terms §3.2.3/§14 proíbem guardar exatamente esses dois campos: só `place_id` é cacheável, lat/lng por 30 dias. Lista de prospecção **é** guardar. Em 17/09 a varredura de `robots.txt` fonte a fonte concluiu que não existe raspagem legal e barata para telefone, e `apps/web/src/app/api/telefone/candidato/route.ts` nasceu mostrando o número na tela **sem gravar nada** — com a fila em 277 candidatos e **um** telefone, a esteira não escoa. (b) já custou duas semanas. (c) é a mesma violação com intermediário, mais cara e com dado pior. **Risco aceito**: contratual, não penal — bloqueio do IP de saída e CAPTCHA permanente na máquina dedicada; a conta Google da Komune não entra na conta porque o coletor não faz login |

**Item 23 para o §13 do PRD:**

> **23. Raspagem do Google Maps (ADR-12) — decisão de Rafael em 24/09/2026.**
>
> **O que revoga.** A recusa está escrita em oito lugares, e todos mudam juntos:
> - `docs/anexos/R06-lgpd-compliance.md:227` — **SCR-04** ("apenas Places API em tempo real; nada de scraping direto ou via terceiros"): **revogado**.
> - `docs/anexos/R06-lgpd-compliance.md:207`, risco **R6** — a mitigação "Google só via Places em tempo real" passa a ser "sem login, sem proxy rotativo, volume de Natal, sem redistribuição".
> - PRD §1, linha 29 ("Google Places apenas como validação em tempo real").
> - PRD §2.4, linha 69 ("o Google Maps não pode virar base do CRM").
> - PRD **RF-RAD-03**, linha 275, última frase ("Google Maps: persistir só `place_id`… TTL de 30 dias").
> - PRD §10.2, linha 631, o trecho "Google Maps Platform (…)".
> - PRD **Apêndice E**, linha 879, item 04 da lista SCR.
> - `supabase/seed.sql:134`, `terms_notes` da fonte `google_places`.
>
> E **não** invoca o R03 §2.4 como cobertura: os 3/5 "toleráveis para uso interno" de lá valem para **comprar de terceiro que raspa**, onde o risco contratual é do provedor. Rodando nós mesmos, o risco é nosso.
>
> **O que NÃO revoga.** **RF-RAD-04** e o par SCR-01/02 com as exceções que o PRD já adotou (Apêndice E, linha 879) — a whitelist de campos. SCR-03 e o resto do **RF-RAD-03**: sem login, sem conta falsa, sem burlar CAPTCHA, UA identificado, ≤ 1 req/3 s, sem proxy rotativo; se o Google bloquear, o coletor **para** e avisa. **SCR-08** e o `field_provenance` do RF-RAD-05. **SCR-09** e o **RF-RAD-09** (supressão e dedup antes de gravar). **SCR-10/RF-RAD-16** (CPF descartado na entrada, gatilho dentro de `public.esteira_processar_captura`). **SCR-11** (HTML bruto ≤ 7 dias). **RF-RAD-15** (candidato nunca contatado morre em 90 dias, raspado ou não). Instagram, GetNinjas e Casamentos.com.br não são tocados.
>
> **O que muda na esteira.** Nada de estrutura — o ADR-08 continua sendo caminho único de escrita. Muda uma linha em `public.sources` e o ponto de entrada. **Quem raspa é o container, fora do CRM. O que chega aqui é arquivo.** Por isso o CSV entra como **lote de planilha**, pelas três bocas que já existem: `public.esteira_abrir_lote('planilha', <id da fonte>, '<rótulo com a busca e a data>')` (`20260904001600_esteira_de_ingestao.sql:1761`), `public.esteira_gravar_captura` (`:1803`) e `public.esteira_processar_captura` (`:1868`). `esteira_abrir_lote` só exige fonte ligada quando `p_kind = 'coleta'` (`:1788`), e o comentário no código diz por quê: "quem digitou responde pelo que trouxe". É o caso: quem rodou o container responde pelo arquivo.
>
> **A whitelist do banco já aceita o CSV inteiro.** `app.payload_e_permitido` (`:141`, lista em `:151`) permite 22 campos, inclusive `email`, `endereco`, `cep`, `nota`, `avaliacoes_qtd` e `place_id`, e reprova o payload **inteiro** se aparecer chave fora da lista. Não permite `facebook` nem `linkedin`. Quem joga fora é a tela: o payload da importação (`20260904001820:531`) monta só 9 campos. O CSV **não** passa pelo montador de hoje; o mapeamento coluna a coluna é novo (§3.1). Caminho único de escrita é o do ADR-08, não payload único.
>
> **E-mail.** Permitido, guardado como contato comercial do estabelecimento. Não vira canal: no MVP a KOMUNE só fala por WhatsApp (RF-CON-04).
>
> **Um detalhe que decide dedup.** O CSV do kit traz identificador interno do Maps (`cid`/`data_id`), não o `place_id` canônico. Ainda assim é ele que grava em `place_id`, porque é a única chave estável do lugar; e é por isso que o ADR registra: **se um dia ligarmos o conector oficial `google_places`, os dois identificadores não casam.** Sem CNPJ, o candidato raspado se apoia em `place_id`, celular (0,95), domínio do site (0,90, exceto hospedagem compartilhada), telefone fixo + bairro (0,90) e nome por trigram (≥ 0,85) — que é o que a fila de revisão do RF-RAD-11 já trata.
>
> **Categoria.** Precisa de linhas em `public.source_category_map` (`20260904001600:1857`) para a fonte nova. Sem mapa, `category_id` nasce nulo e quem revisa escolhe (§3.3).
>
> **Validade.** O ADR-12 é revisto no segundo bloqueio de IP, ou em 24/12/2026, o que vier antes. Se a Komune passar a ter telefone por fonte própria (fornecedor confirmando no pré-cadastro), a raspagem perde a razão e sai.

### 2.2 ADR-13 — O robô responde sozinho, escolhendo texto pronto

**Linha da tabela §9.1** (depois do ADR-12):

| # | Decisão | Alternativas consideradas | Justificativa |
|---|---|---|---|
| ADR-13 | **O robô responde sozinho escolhendo texto pronto.** A IA classifica a intenção (Haiku, as 25 de `packages/prompts/src/prompts/classificar-intencao/intencoes.ts`) e o **Postgres escolhe** o texto já escrito e aprovado para aquela intenção, em `public.message_templates`. A IA **não redige** o que sai. Vale 24 h por dia, com a frase de transparência do RF-CON-26 na primeira resposta automática de cada conversa e **HUMANO** transferindo em uma resposta. **Decisão de Rafael em 24/09/2026. Altera o ADR-05**, que passa a valer para texto que a IA **escreve** | (a) manter tudo em rascunho com clique (o de hoje); (b) soltar a IA para redigir sozinha; (c) Kapso ou outro BSP com robô pronto | O mecanismo já roda: o bot de entrada (`20260916110000_o_bot_de_entrada.sql`) responde sozinho desde 16/09 como `author_kind = 'bot_fixed'` com `template_id`, por `app.wa_bot_dizer` (`:192`), e o `app.messages_guard` aceita isso **sem rascunho** — a trava do ADR-05 é o ramo `bot_ai`. O catálogo também já existe: `GEN-OBJ-TAXA-INFO` está no `seed.sql:1053` marcado "PEDIU_TAXA_PRECO: texto fixo". Falta o meio: o worker calcula `responde` por intenção, escreve no log e **não roteia nada** (`apps/workers/src/ia/tarefas.ts:524-620`). O **RF-CON-22** já previa isto — "a partir da v1, o gestor pode liberar envio automático por intenção (ex.: `PEDIU_TAXA` com texto fixo), mantendo amostragem semanal" —, então este ADR é o gestor liberando, com nome e data. (b) fica fora porque a oferta vincula (CDC art. 30) e nenhum validador é tão seguro quanto não escrever. (c) fica fora pelo **ADR-06** |

**Item 24 para o §13 do PRD:**

> **24. Resposta automática por texto pronto (ADR-13) — decisão de Rafael em 24/09/2026.**
>
> **O que altera no ADR-05, palavra por palavra.** O ADR-05 (linha 523) diz "Human-in-the-loop por padrão no primeiro contato e nas respostas de IA". Passa a dizer: "no primeiro contato e em toda resposta **redigida** por IA". A palavra que entra é *redigida*. Escolher, por classificação, um texto que uma pessoa da KOMUNE escreveu e aprovou antes **não é redigir**. A linha que faz "nada sai sozinho" ser verdade no banco (`app.messages_guard`, ramo `bot_ai`, que exige `draft_id` com `status in ('aprovado','enviado')`, `reviewed_by`, e compara `new.body` com `d.final_body`) **não muda uma linha**.
>
> **Onde mora o texto pronto: `public.message_templates`.** Não em `public.respostas_rapidas`: o guard aceita `bot_fixed` apenas com `template_id` ou `cadence_touch_id` (`20260916130000:155`), e uma linha de `respostas_rapidas` não tem nenhum dos dois — seria recusada no INSERT, e afrouxar o guard para aceitá-la quebraria a única amarração entre texto automático e modelo aprovado.[^1] Então: `message_templates` ganha `intencao` (única entre modelos ativos de WhatsApp) e `robo_responde boolean not null default false`. `respostas_rapidas` continua sendo o painel de atalhos "/" de quem digita à mão. Ligar e desligar uma intenção é `update` de uma linha, na tela que já existe (Ajustes → Catálogos → Modelos), nunca deploy. A chave-mestra é `robo_responde` dentro de `app_settings.atendimento`, lida por `app.atendimento_liga` como `ausencia_ativa` já é lida — o que obriga a acrescentá-la ao laço de `public.atendimento_configurar` (`20260922120000:229`). A saída passa por `app.wa_bot_dizer(conversation_id, codigo)`, que já é como o menu e a ausência falam.
>
> **A fronteira exata** (a implementação está em §6.3; aqui fica a regra): sai sozinho só quando a intenção é de texto fixo e não escalou, a confiança é **≥ 0,85**[^2], a intenção tem modelo ativo com `robo_responde = true`, a chave-mestra está ligada, a janela de 24 h está aberta **no momento do envio**, aquela chegada ainda não recebeu resposta automática, e `conversations.bot_paused = false`.
>
> **Em uma frase:** a IA escolhe qual gaveta abrir; ela nunca escreve o que está dentro da gaveta.
>
> **HUMANO ainda não existe, e este ADR é quem o cria.** Hoje a palavra só aparece dentro de textos (`seed.sql:1056`, `:1064`) e como exceção do validador de promessas (`packages/prompts/src/nucleo/validador-promessas.ts:227`); nenhum código a trata. Ela vira regra determinística no mesmo lugar do opt-out — irmã de `app.wa_parece_optout` (`20260916110000:148`) —, e a ação é a de `escalarConversa`: `bot_paused = true`, `status = 'aguardando_nos'`. Sem isso, prometer "escreva HUMANO" é promessa que o sistema não cumpre.
>
> **A transparência perde a assinatura.** `GEN-SYS-TRANSPARENCIA` (`seed.sql:1055`) termina com "— Heloísa". A assinatura sai: desde 14/09 o time inteiro atende e cada mensagem é assinada por quem envia — e nesta não há quem envie.
>
> **As 24 h não custam migração.** `app.pode_enviar` (`20260905000200_ia_e_whatsapp.sql:1348`, passo 2) já devolve `pode = true` para qualquer resposta dentro da janela de 24 h, sem horário e sem teto, e está comentado no código como deliberado. A janela de envio **proativo** (RF-CON-11) não muda: 24 h vale para **responder**, nunca para iniciar.
>
> **O que passa a custar.** Desde 01/10/2026 a Meta cobra mensagem de serviço, com 1.000 grátis por mês por número (`docs/CHANGELOG.md:2946`). Hoje são 51 por mês. O contador de serviço entra no painel junto com o de IA (§5.1), e o teto mensal do robô é freio, não contabilidade (§6.9).
>
> **O que o ADR-13 não toca.** O ADR-06 é reafirmado: **Kapso e qualquer BSP estão fora**. O ADR-10 não muda — o Haiku continua classificando; o Sonnet deixa de ser chamado nas intenções de texto pronto, e o custo cai. E a bandeira `cadencia.modo_automatico` continua `false`, com o gatilho `zz_app_settings_modo_automatico` (`20260904001890:62-84`) recusando ligá-la: ela é o disparo automático de cadência (empresa iniciando), e ninguém deve tentar implementar o ADR-13 por ali.

### 2.3 Requisitos alterados ou revogados

| Requisito | O que acontece |
|---|---|
| **RF-RAD-01** (273) | Continua. A linha nova em `sources` exige registro de operação antes de habilitar — **o item 23 do §13 é esse registro**, com base legal, avaliação dos termos e `robots_ok = false` declarado. |
| **RF-RAD-02** (274) | **Alterado.** `google_maps_raspado` entra no catálogo como origem de **lote de arquivo**, não como conector — o CRM não ganha coletor do Maps. Google Places sai da lista de **conectores** v1 (segue como origem para a busca de telefone em tela). Casamentos.com.br fica no catálogo com o coletor desligado; a carga da base CNPJ continua prevista. |
| **RF-RAD-03** (275) | **Última frase revogada** (o "Google Maps: persistir só `place_id`, TTL 30 dias"). Todo o resto continua e passa a valer para o container. As frases sobre GetNinjas e Instagram não são tocadas. |
| **RF-RAD-04, -05, -09, -15, -16** | Inalterados. |
| **RF-RAD-11, -12, -13** | Inalterados como requisito. Só a tela muda de nome: "Radar" vira **"Revisão"**. O score do RF-RAD-12 usa nota e nº de avaliações, que o CSV traz — ele volta a pontuar. |
| **RF-CON-09** (336) | **Já destravado em 21/09** pelo envio em massa. O ADR-13 não mexe nele: modo automático é a **empresa iniciando**; ADR-13 é **resposta**. Acrescentar uma frase dizendo isso, e outra dizendo que a bandeira `cadencia.modo_automatico` segue desligada e recusada por gatilho. |
| **RF-CON-11** (338) | **Última frase revogada** ("Respostas a quem escreveu: imediatas entre 08:00 e 20:00; fora disso, uma resposta automática curta com previsão"). E o texto da janela proativa está desatualizado: o código usa seg–sex 08:00–17:45 desde 17/09 (`20260917160000_a_janela_do_whatsapp_acompanha_o_expediente.sql`) e o PRD ainda diz 09:00–12:00 e 14:00–18:00. Corrigir na mesma edição. |
| **RF-CON-19, -20, -21** (352–354) | Inalterados — são o motor do ADR-13. |
| **RF-CON-22** (355) | **Ativado, não revogado.** A amostragem semanal passa a ser obrigação (§6.9). |
| **RF-CON-23** (356) | Inalterado, e vira a fronteira do robô: fora da KB, ninguém responde sozinho. |
| **RF-CON-26** (359) | **Alterado no momento e na assinatura**: a frase vai na primeira resposta automática de cada conversa, sem "— Heloísa"; "HUMANO" passa a ser regra implementada. |
| **ADR-05** (523) | **Alterado**: vale para texto que a IA **escreve**. |
| **ADR-06** (524) | **Reafirmado**. Consertar na mesma edição a menção a Coexistence e 360dialog. |
| **ADR-08** (526) | **Reafirmado**, e é ele que obriga o CSV a entrar pela esteira. |
| **§13 item 9** (749) | Reescrever: o disparo frio deixou de estar "fora do MVP em qualquer hipótese" em 21/09, pela tela `/envios` e pelos tetos do RF-CON-10 — não pela bandeira `cadencia.modo_automatico`, que continua desligada. |
| **§13 item 22** (771) | **Alterado, e já estava desatualizado.** "Campanha como unidade de trabalho" e "módulo de marketing com disparo segmentado" deixaram de ser recusa em 21/09 e o PRD nunca registrou. Registrar, e acrescentar que **"database marketing" continua recusado** e que ADR-13 é resposta, não campanha. |

### 2.4 Onde editar o PRD e os anexos (linha a linha)

Os números são os do arquivo de hoje. Edite **de baixo para cima**: inserir duas linhas no §9.1 empurra tudo o que vem depois.

| Arquivo : linha | Edição |
|---|---|
| `docs/PRD-…:879` (Apêndice E) | Item 04 da lista SCR: **revogado pelo ADR-12 em 24/09/2026**, mantendo 01, 02, 03, 05–12. |
| `…:801` (Apêndice B) | **Não trocar a linha**: manter "Google Places API (New)" com a nota "recusada pelo ADR-12 — o SKU Enterprise entrega telefone e site, e os termos proíbem guardá-los" e **acrescentar** uma linha `google_maps_raspado`, risco "ToS do Google; bloqueio de IP (ADR-12)". |
| `…:771`, `…:749` | §13: corrigir o item 22, reescrever o item 9, acrescentar os itens **23** e **24**. |
| `…:631` (§10.2) | Substituir só o trecho "Google Maps Platform (…)" pelo texto do ADR-12. |
| `…:359`, `…:355` | RF-CON-26 e RF-CON-22. |
| `…:338`, `…:336` | RF-CON-11 (revogar a última frase; corrigir a janela para 08:00–17:45) e RF-CON-09. |
| `…:275`, `…:274` | RF-RAD-03 e RF-RAD-02. |
| `…:529` | Inserir as duas linhas novas da tabela §9.1. |
| `…:524` | ADR-06: apagar "Coexistence no Número 1" e "ou via 360dialog"; acrescentar "nenhum BSP intermediário (24/09/2026)". |
| `…:523` | ADR-05: trocar "nas respostas de IA" por "em toda resposta **redigida** por IA (ADR-13)". |
| `…:69` e `…:29` | Reescrever as duas frases sobre o Google Maps, remetendo ao ADR-12. |
| `docs/anexos/R06-lgpd-compliance.md:227` | SCR-04: riscar e escrever "**Revogado por ADR-12, decisão de Rafael em 24/09/2026** (PRD §9.1 e §13 item 23)". Não apagar a linha. |
| `docs/anexos/R06-lgpd-compliance.md:207` | Risco **R6**: trocar a mitigação pela do ADR-12. |
| `docs/anexos/R03-fontes-scraping.md` §2.4 (106) | Parágrafo "Decisão de 24/09/2026": a estratégia de `place_id` + consulta em tempo real foi substituída pela raspagem; os preços e limites (linhas 114 e 121) ficam como registro do que foi recusado. |
| `supabase/seed.sql:134` | `terms_notes` de `google_places`: acrescentar a decisão e a data. **E acrescentar a fonte `google_maps_raspado` ao mesmo bloco** — sem isso, `supabase db reset` deixa o banco local sem a fonte que produção tem. |
| `supabase/seed.sql:1055` | `GEN-SYS-TRANSPARENCIA`: tirar "— Heloísa" e adotar o texto de §6.6. |
| `docs/CHANGELOG.md` | Entrada no formato de 21/09: `### 24/09/2026 — As duas decisões escritas (ADR-12 e ADR-13; revoga R06 §B.1 SCR-04, altera o ADR-05)`. |
| `CLAUDE.md`, "Decisões fechadas" | Duas linhas novas no mesmo formato; ajuste da linha do ADR-05 ("texto que a IA escreve"); a linha do Radar passa a dizer que a coleta própria está desligada e a curadoria continua como "Revisão". |

As migrações estão na tabela de §9.

---

## 3. Fase 1 — o CSV do Maps entra pela porta que já existe

A porta existe e funciona: `/importar` lê XLSX e CSV no navegador (`apps/web/src/components/importacao/planilha.ts`, separador descoberto sozinho, `TETO_DE_LINHAS = 20_000`), mostra prévia linha a linha sem escrever nada (`public.importacao_previa`), grava pela esteira do ADR-08 (`public.importacao_gravar` → `public.esteira_gravar_captura` → `public.esteira_processar_captura` → `app.resolver_source_record` → `app.promover_candidato`) e dá recibo com desfazer de 48 h (`public.esteira_desfazer_lote`).

Não construímos caminho novo. Consertamos o estreitamento: **o payload que a tela monta tem 9 campos, e a whitelist do banco permite 22**. `app.importacao_normalizar` (`20260904001820:531-540`) monta `nome_comercial, cnpj, cidade, bairro, instagram, site, source_url, categoria_origem, telefones` — e joga fora `email`, `endereco`, `cep`, `nota`, `avaliacoes_qtd` e `place_id`. Todos os seis já estão em `app.payload_e_permitido` e já têm coluna em `public.source_record`. Cinco seguem até `organizations` (`email`, `address`, `rating`, `reviews_count`, `place_id`); **`cep` para em `source_record`** — não existe coluna `cep` em `supplier_candidates` nem em `organizations`, e nesta fase não criamos uma.

### 3.1 O mapa de colunas

| coluna do CSV | campo da tela | chave do payload | observação |
|---|---|---|---|
| `title` | `nome` | `nome_comercial` | obrigatório; sem ele a linha volta com `sem_nome` |
| `link` | `origem_detalhe` | `source_url` | só entra se casar `^https?://`; é a URL que `public.origem_dos_dados` devolve |
| `cid` | `place_id` **(novo)** | `place_id` | vira o `external_id` da linha |
| `phone` | `whatsapp` | `telefones[0]` | `app.normalize_phone_br`; inválido vira aviso `telefone_invalido` e a linha segue sem telefone |
| `emails` | `email` **(novo)** | `email` | o primeiro da lista que for um e-mail; o resto é descartado |
| `website` | `site` | `site` | o gatilho deriva `website_domain` |
| `category` | `categoria` | `categoria_origem` | resolvido em `public.source_category_map` primeiro (§3.2, item 2) |
| `address` | `endereco` **(novo)** | `endereco` + `cep`, `cidade`, `bairro` extraídos | um endereço, quatro campos |
| `review_rating` | `nota` **(novo)** | `nota` | número, 0–5; sinal de pontuação, nunca exibido |
| `review_count` | `avaliacoes_qtd` **(novo)** | `avaliacoes_qtd` | inteiro ≥ 0 |

**A origem não vem do CSV.** Pedir ao kit uma coluna `origem` com texto livre é frágil de um jeito caro: `app.importacao_fonte` (`20260904001820:203`) casa por `app.chave_catalogo` do nome, e a fonte oficial `google_places` **se chama `Google Maps`** (`supabase/seed.sql:134`) — um CSV que escrevesse "Google Maps" cairia no conector do Places e a proveniência mentiria. Então `origem` passa a vir do **seletor de origem do lote**, e `tela-importacao.tsx` injeta o nome da fonte escolhida em cada linha dentro de `montarLinhas` (`apps/web/src/components/importacao/tela-importacao.tsx:170-180`) quando o mapa não tiver coluna `origem`. Para a planilha-ponte nada muda: lá a coluna existe e continua mandando.

Descartadas, com motivo:

| coluna | por quê |
|---|---|
| `facebook`, `linkedin` | **não ampliamos a whitelist** — justificativa abaixo |
| `latitude`, `longitude`, `plus_code` | fora da whitelist; as rotas usam `address` e `neighborhood`, não coordenada |
| `descriptions`, `about` | fora da whitelist, e `descri`/`sobre` batem no regex de chave proibida |
| `images`, `thumbnail` | `image` e `thumb` proibidos (R06 SCR-02, direito de imagem de terceiro) |
| `user_reviews`, `reviews_link` | `review` proibido — só o número entra, nunca o texto |
| `price_range` | `preco_a_partir_de` é `numeric(12,2)`; `$$` não é preço |
| `open_hours`, `popular_times`, `menu`, `reservations`, `timezone`, `owner`, `status` | não há campo que os receba, e `owner` é nome de pessoa natural |

**Facebook e LinkedIn: descartar, não ampliar a whitelist.** (1) Chave nova obriga mudar dois arquivos em sincronia — `app.payload_e_permitido` e a cópia literal em `apps/workers/src/ingest/whitelist.ts`; esquecer um faz o worker mandar o que o banco recusa, e a recusa é do payload **inteiro**. (2) Não existe coluna em `supplier_candidates` nem em `organizations` para receber: o dado ficaria só em `raw_capture.payload` — o oposto da minimização. (3) `instagram` está na whitelist porque é chave de dedup com índice único (`organizations_instagram_uq`); Facebook e LinkedIn não são chave de nada e não são canal nosso. **Nesta fase a whitelist não muda, e `whitelist.ts` não é tocado.**

Nada disso depende de disciplina do operador: `linhaParaObjeto` (`mapeamento.ts:118-131`) só copia campos de `TODOS_OS_CAMPOS`. Coluna fora do mapa não vira chave de payload nem por engano.

**Os sinônimos não são só dos cinco campos novos.** `SINONIMOS` (`mapeamento.ts:34-53`) é todo em português e o cabeçalho do kit é em inglês. Conferido em `acharCampo` (`:63-78`), que faz uma passada exata e só depois uma por trecho com `c.length >= 4`:

- `title` e `category` **não casam com nada hoje** — a linha entraria sem nome e sem categoria. Entram como sinônimo exato de `nome` e `categoria`.
- `phone` casa só como `parecido`, por conter `fone`. Entra como exato em `whatsapp`.
- `cid` tem 3 letras: só a passada exata pode pegá-lo, e a passada por trecho o mandaria para **`cidade`** (`'cidade'.includes('cid')`). Entra como sinônimo **exato** de `place_id`.
- `link` e `website` já casam exato. Nada a fazer.
- De brinde, o campo `endereco` conserta um defeito existente: uma coluna "Endereço" hoje cai em **`site`**, porque `site` tem o sinônimo `endereco na web`.

### 3.2 A migração

`supabase/migrations/20260924130000_o_csv_do_maps_entra_pela_importacao.sql`

1. **`app.endereco_br(text) → jsonb`** (nova, `immutable`, `set search_path = ''`). Lê `Av. Eng. Roberto Freire, 1234 - Capim Macio, Natal - RN, 59082-095` e devolve `{bairro, cidade, cep}`. A regra, para não haver duas implementações possíveis: (a) `cep` é a primeira ocorrência de `\d{5}-?\d{3}`, devolvida como `NNNNN-NNN`; (b) tirado o CEP, o texto é partido por vírgula e o último pedaço que casar `^\s*(.+?)\s*-\s*[A-Z]{2}\s*$` dá `cidade`; (c) `bairro` é o que vem depois do último ` - ` no pedaço **imediatamente anterior** ao da cidade, e é nulo se esse pedaço não tiver ` - `. O que não casou volta nulo. **Nunca palpite.** A cidade vai para `app.importacao_cidade`; não batendo, a linha ganha o aviso `cidade_desconhecida` (`20260904001820:447-449`) e **entra assim mesmo** — `city_id` é nulável e cidade nunca foi motivo de revisão nesta esteira.
2. **`app.importacao_normalizar(jsonb)`** — substituída. Cinco mudanças:
   - **A fonte passa a ser resolvida antes da categoria** (hoje é o contrário, `:436-438`), porque a categoria passa a depender do `source_id` da linha.
   - **A categoria consulta `public.source_category_map` primeiro**, com a mesma expressão de `esteira_processar_captura` (`20260904001600:1905-1909`), e só cai em `app.importacao_categoria` se o mapa não tiver a chave. A ordem importa: `app.importacao_categoria` tem queda difusa em `similarity >= 0.55` (`20260904001820:165-172`) que dispararia antes do mapa e produziria `categoria_aproximada` em cima de um palpite.
   - **Lê `place_id`, `email`, `endereco`, `nota` e `avaliacoes_qtd`**, e usa `app.endereco_br` para `cidade`/`bairro`/`cep` quando a coluna explícita não existir (coluna explícita ganha). E-mail: parte por `[;,]` e fica com o primeiro que casar `^[^@\s]+@[^@\s]+\.[^@\s]+$`; tendo texto e nenhum casando, aviso `email_invalido` e campo nulo. Nota: troca `,` por `.`; fora de 0–5, aviso `nota_invalida`. Avaliações: só dígitos; qualquer outra coisa, aviso `avaliacoes_invalidas`. **Nenhum dos três reprova a linha** — um lugar sem e-mail continua valendo um telefone.
   - **O CPF passa a ser varrido no endereço.** Hoje `app.tem_cpf`/`app.sem_cpf` rodam só em `nome`, `observacoes` e `origem_detalhe` (`:402-408`). Com `endereco` no payload isso vira furo real: `esteira_gravar_captura` grava `raw_capture.payload` **cru** — `app.payload_e_permitido` confere nomes de chave, não valores — e o gatilho que limpa CPF só roda depois, em `source_record` (`20260904001600:624-643`). Então `endereco` e `bairro` passam por `app.sem_cpf` antes de entrar no payload, com o aviso `cpf_descartado`.
   - **O objeto devolvido ganha os campos novos no topo**, não só dentro de `payload`: `importacao_previa` e `importacao_gravar` leem `v_n ->> '<campo>'` e nunca abrem o payload.

   **O payload sai de 9 para 15 chaves**, todas já dentro de `v_permitidas`.
3. **`external_id`: `place_id` primeiro.** Hoje é `coalesce(v_tel, '@'||v_ig, v_cnpj, nome|cidade)` (`:515`). Passa a ser `coalesce(v_place, v_tel, ...)`. O telefone do Maps muda; o `cid` não. Para a planilha-ponte nada muda.
4. **`public.importacao_previa(jsonb)`** — conserto estreito: `place_id` entra na chamada de `app.find_org_matches` e na sonda das chaves únicas (`:682-699`). Hoje a sonda testa CNPJ, telefone e Instagram — o comentário diz "as QUATRO chaves" e o código faz três — enquanto `app.promover_candidato` **bloqueia também por `place_id`** (`20260904001600:1098-1114`). Sem esse conserto, a prévia diz "entra" e a gravação responde "duplicata".
5. **`public.esteira_processar_captura(uuid)`** — conserto estreito no ramo "mudou na fonte" (`20260904001600:1954-1974`). O ramo de INSERT carrega 12 campos que o de UPDATE não carrega; quatro passam a ser carregados com `coalesce`: `cep`, `place_id`, `city_id` e o par `category_source`/`category_id`. Sem isso, uma segunda raspagem que traga o CEP, a cidade ou a categoria pela primeira vez nunca os grava, e uma linha que foi para revisão por `categoria_desconhecida` fica presa lá para sempre.
6. **A fonte nova e o mapa de categorias** (§3.3), com `on conflict (slug) do update` e `on conflict (source_id, category_source) do update`. Vão na migração, não só na `seed.sql`: a linha da fonte é o registro escrito da decisão e do risco.
7. **`entrada_por_arquivo` nas duas fontes que entram por arquivo.** A nova já nasce com a chave; a `planilha` recebe `update public.sources set config = config || '{"entrada_por_arquivo": true}'::jsonb where slug = 'planilha'`. Um `update` explícito, e não a seed: o `on conflict` da seed preserva `config` quando ele não está vazio (`supabase/seed.sql:193`).

**Índices.** `organizations_place_uq on public.organizations (place_id) where place_id is not null and deleted_at is null` está lá desde `20260904000300:76`. Em `source_record`, `source_record_fonte_externo_uq (source_id, external_id)` (`20260904001600:425`) com `external_id = place_id` é exatamente a chave que queremos. Em `supplier_candidates`, `supplier_candidates_fonte_externo_uq (source_id, external_id) where external_id is not null` (`20260904001401:211`) **já garante um candidato por lugar por fonte**, e `app.resolver_source_record` acha o candidato por esse par no passo (2) sem filtro de status, então nem um candidato **recusado** causa `23505`. Criamos só `supplier_candidates_place_idx on public.supplier_candidates (place_id) where place_id is not null`, **não único**: o passo (3) de `app.resolver_source_record` procura por `c.place_id` e hoje faz varredura, e um índice único global seria restrição **nova**, que quebraria o mesmo lugar chegando por duas fontes.

**Dois lotes com o mesmo `place_id`:**

- *CSV idêntico.* `app.payload_hash` igual → `raw_capture_conteudo_uq (source_id, content_hash)` → `novo=false`, `reason='conteudo_identico'` → `source_record` achado, hash igual → só `last_seen_at` → `importacao_gravar` acha o candidato `aprovado` com `organization_id` → decisão **`repetida`**, motivo `ja_importado`. Nada é criado, e desfazer o segundo lote não remove nada.
- *Mesmo lugar, nota ou telefone mudou.* Hash novo → captura nova → UPDATE que só preenche o que está vazio, mais a marca `mudou_na_fonte` → `app.resolver_source_record` acha o candidato pelo `place_id` e completa campo vazio. **Um candidato, uma ficha.**
- *`place_id` novo, telefone já de uma ficha.* `app.promover_candidato` sonda as quatro chaves → `ja_existe_na_base`, `chave='phone'` → decisão **`duplicata`**, e agora a prévia diz isso antes.

### 3.3 A fonte nova em `sources`

```
slug                google_maps_raspado
name                Google Maps (raspagem local)
kind                import
base_url            https://www.google.com/maps
legal_basis         legitimo_interesse
robots_ok           false
is_enabled          false
rate_limit_seconds  5.00
config              {"collector":{"kind":"externo","phase":"mvp","enabled":false},
                     "entrada_por_arquivo":true,
                     "ferramenta":"google-maps-scraper-kit (MIT) sobre gosom/google-maps-scraper",
                     "adr":"ADR-12"}
```

**`kind = 'import'`, e não `'scrape'`.**[^3] Três razões, todas em código. (1) É verdade literal: o CRM não visita o Google; o que entra é um arquivo que uma pessoa subiu. (2) `app.envio_variaveis` (`20260921100000:268`) e `app.wa_preparar_abertura` (`20260917200100:114`) preenchem a variável `{{origem}}` de mensagem com `s.name` **quando `s.kind in ('scrape','api')`** — com `kind='scrape'`, a string "Google Maps (raspagem local)" iria literalmente para dentro de um primeiro contato de campanha. (3) Não perdemos trava nenhuma: `is_enabled = false` faz `public.esteira_abrir_lote` recusar `p_kind='coleta'` com `origem_desabilitada` (`20260904001600:1789`), `config.collector.enabled` é `false`, não existe adaptador para essa fonte em `apps/workers/src/ingest/adaptador.ts` — e a partir da Fase 2 não existe worker de ingestão nenhum. A raspagem não roda de dentro do CRM porque não há o que a rode.

O lote entra como `kind='planilha'`, que é o que `public.importacao_gravar` exige (`20260904001820:798-800`). Nenhum dos dois caminhos de arquivo consulta `is_enabled`: `esteira_abrir_lote` só o consulta para `p_kind='coleta'`, e `app.importacao_fonte` não filtra por ele. O seletor de origem da tela filtra por `config->>'entrada_por_arquivo' = 'true'`, **não** por `is_enabled`.

`terms_notes`, o risco escrito na própria linha:

> Raspagem do Google Maps por ferramenta local (google-maps-scraper-kit, MIT, sobre gosom/google-maps-scraper), em Docker em 127.0.0.1, fora do CRM. **Contraria os Termos de Serviço do Google**, que proíbem extração automatizada, e **revoga por escrito o R06 §B.1 SCR-04** ("nada de scraping direto ou via terceiros", `docs/anexos/R06-lgpd-compliance.md:227`), recusa de 04/09/2026. Decisão do Rafael em 24/09/2026, ADR-12, risco assumido no nível da empresa. O resto do SCR-03 continua valendo e é o que limita o dano: sem login, sem burla de CAPTCHA, sem proxy rotativo, user-agent identificado, 1 requisição a cada 5 s. O que coletamos são dados factuais de contato comercial publicados pelo próprio estabelecimento: nome, categoria, telefone, site, e-mail, endereço e dois números de reputação. Nunca foto, texto descritivo ou texto de avaliação. `nota` e `avaliacoes_qtd` entram apenas como sinal numérico de pontuação, pela mesma exceção consciente ao SCR-02 já registrada (RF-RAD-04, RF-RAD-12, PRD §13 item 10) — nunca exibidos como avaliação. Nunca republicação, nunca revenda. Limite: no máximo 2 rodadas por semana e 600 lugares por rodada, só Natal e região metropolitana. Consequência realista se der errado: bloqueio do IP ou CAPTCHA permanente na máquina que raspa — não há contrato entre a KOMUNE e o Google que possa ser rescindido, e não há dado de terceiro republicado que gere dano indenizável. O `cid` que gravamos em `place_id` **não é** o `place_id` da Places API: se um dia ligarmos o conector oficial (`google_places`), os dois identificadores não casam.

O mapa de categorias entra em `public.source_category_map`, com a chave em minúscula e com acento, do jeito que a consulta a lê (`lower(trim(...))`, sem `unaccent`): `buffet`→`buffet_adulto_corporativo`, `serviço de buffet`→`buffet_adulto_corporativo`, `casa de festas infantis`→`buffet_infantil_casa_de_festas`, `fotógrafo`→`fotografia_video`, `serviço de fotografia`→`fotografia_video`, `salão de festas`→`locais_saloes_chacaras_hoteis`, `espaço para eventos`→`locais_saloes_chacaras_hoteis`, `aluguel de brinquedos`→`locacao_brinquedos_inflaveis`, `confeitaria`→`doces_bolos_confeitaria`, `floricultura`→`decoracao_flores`, `dj`→`djs_bandas_musicos`, `locação de tendas`→`tendas_estruturas_palcos`. O que não é evidente fica de fora e a linha vai para revisão — a mesma regra que a seed já aplica ao Casamentos (`supabase/seed.sql:246-283`).

### 3.4 Como o CSV chega

**Quem roda o Docker:** o Rafael, na máquina dele, dirigido pelo Claude Code — que é onde o kit já está. Um perfil `maps` entra em `infra/local/docker-compose.yml` (porta presa em `127.0.0.1:8080`, saída em `infra/local/data/maps/saida/`) para que a máquina dedicada rode o mesmo comando depois. `infra/local/data/*` já está no `.gitignore:25`.

**Por que não automatizamos a chamada pelo CRM:** o web roda na Vercel e o `worker-wa` no Fly.io; nenhum alcança `127.0.0.1:8080` em Natal. O único processo que alcançaria é o `worker-ingest` na máquina dedicada — o mesmo que a Fase 2 apaga. Com uma pessoa no meio, quem sobe o arquivo nomeia o lote, lê a prévia e fica registrado em `import_batches.triggered_by`: a raspagem vira decisão auditável em vez de cron silencioso.

**Passo a passo do operador:**

1. `docker compose -f infra/local/docker-compose.yml --profile maps up -d`.
2. Pedir ao Claude Code a consulta: categoria + cidade (ex.: "buffet infantil em Natal RN"), teto de 600 lugares, ritmo de 5 s.
3. O kit escreve `infra/local/data/maps/saida/2026-09-25-buffet-infantil-natal.csv`.
4. Abrir `/importar`, escolher **Google Maps (raspagem local)** no seletor de origem e arrastar o CSV.
5. Conferir o mapa de colunas sugerido (a tela diz se cada acerto foi `exato` ou `parecido`).
6. Ler a prévia: quantas entram, quantas são duplicata **de quem**, quantas vão para revisão, quantas pediram para parar. Gravar.
7. Ler o recibo, e **apagar o CSV da pasta**. Enquanto o arquivo existe, é uma base de dados pessoais fora do CRM, sem retenção e sem RLS.

600 linhas cabem sem ajuste: o cliente já fatia em 200 para a prévia e 100 para a gravação (`dados.ts:25-28`), abaixo dos tetos do banco (500 e 200).

A tela ganha três coisas pequenas: os cinco campos novos em `CAMPOS_EXTRAS` (`tipos.ts:78`) com `ROTULO_EXTRA` e sinônimos em `SINONIMOS`; o seletor de origem em `page.tsx`/`tela-importacao.tsx`, no lugar do `slug = 'planilha'` fixo de hoje (`apps/web/src/app/(app)/importar/page.tsx:26-30`); e a injeção de `origem` em `montarLinhas`. Um lote de raspagem rotulado "planilha" é mentira no registro legal, e `import_batches.source_id` é onde ela ficaria guardada.

**Onde a origem é decidida:** `public.importacao_gravar` usa `coalesce((v_n ->> 'source_id')::int, v_b.source_id)` (`:880-881`) — manda a origem **da linha**; a do lote é rede de segurança. Com a injeção acima, as duas passam a ser a mesma por construção.

### 3.5 Testes

**pgTAP — `supabase/tests/66_o_csv_do_maps.sql`**

1. `app.endereco_br` com endereço completo, sem bairro, sem CEP e com lixo → nulo onde não casou, nunca palpite.
2. `app.importacao_normalizar` numa linha do Maps → payload com as 15 chaves e `app.payload_e_permitido(payload)` verdadeiro.
3. `external_id` da mesma linha = `place_id`, mesmo com telefone presente.
4. Payload com `facebook` → `app.payload_e_permitido` falso.
5. `importacao_previa` numa linha cujo `place_id` já é de uma ficha → `duplicata` (hoje devolve `entra`).
6. Mesmo CSV em dois lotes → segundo devolve `repetida`/`ja_importado` para as linhas que viraram ficha, e `count(*)` de `organizations` não muda.
7. Segundo lote com nota diferente → `source_record.flags` contém `mudou_na_fonte`, um candidato, uma ficha.
8. Segundo lote que traz CEP, cidade e categoria pela primeira vez → `source_record.cep`, `city_id` e `category_id` preenchidos.
9. Categoria que está em `source_category_map` **e** teria queda difusa → vence o mapa, sem `categoria_aproximada`.
10. Linha com telefone na `suppression_list` → `nao_contatar`, sem `deals`.
11. `public.origem_dos_dados` da ficha criada → `campos` tem `phone_e164` e `place_id`, ambos com `url` igual à URL do lugar.
12. `esteira_abrir_lote(p_kind => 'coleta')` na fonte nova → `origem_desabilitada`; com `'planilha'` → `ok`.
13. `app.importacao_fonte('Google Maps (raspagem local)')` → `google_maps_raspado`; `app.importacao_fonte('Google Maps')` → `google_places`.
14. CPF dentro do endereço → aviso `cpf_descartado` já na prévia, `raw_capture.payload ->> 'endereco'` **sem** o CPF, e `field_provenance` com `action='descartado'`, `reason='cpf'`, `previous_value_hash` nulo.
15. Uma linha do Maps sem telefone entra na fila com a flag `sem_contato` (alimenta a medição de §8.1).

**Vitest**

- `mapeamento.test.ts`: `sugerirMapa` no cabeçalho do kit casa `title`, `category`, `phone`, `cid`, `emails`, `address`, `review_rating`, `review_count`, todos `exato`; `cid` **não** vai para `cidade`; `facebook` e `linkedin` não casam com nada e `linhaParaObjeto` não as emite.
- `planilha.test.ts`: leitura da fixture real — separador `,`, endereço entre aspas com vírgula dentro, BOM — devolve cabeçalho e 20 linhas.
- Fixture nova `apps/web/src/components/importacao/fixtures/maps-natal-buffet.csv`, 20 linhas raspadas de verdade, com um fixo, um sem e-mail, um endereço sem bairro e um `cid` duplicado.

Não há módulo TypeScript novo para ler dado: escolha de e-mail e leitura de endereço ficam em SQL, para que prévia e gravação usem **a mesma** função (`app.importacao_normalizar` é `stable` por isso).

### 3.6 Pronto quando

Ver **§13**.

---

## 4. Fase 2 — o Radar desliga, a curadoria fica

O Radar sempre foi duas coisas num nome só: **o robô que sai colhendo** (worker `ingest`, filas `pgmq`, catálogo de fontes) e **a fila onde uma pessoa decide** (`supplier_candidates`, `radar_fila`, `radar_revisar_candidato`). A decisão mata a primeira. A segunda vira mais importante: é por ela que passa cada linha do CSV.

**Esta fase começa depois de a Fase 1 estar no ar.** `apps/workers/src/ingest/whitelist.ts` é a cópia da whitelist do lado do worker, e a lei mora em `app.payload_e_permitido`, amarrada à tabela pela constraint `raw_capture_payload_na_whitelist` (`20260904001600:325`). A segunda casa da whitelist só pode virar `app.importacao_normalizar` depois que a esteira do CSV estiver de pé. Apagar antes abriria uma janela com whitelist em um lugar só.

### 4.1 Primeiro o interruptor, depois a tesoura

**1. O banco para de aceitar coleta.**

```sql
update public.sources
   set is_enabled = false
 where slug in ('casamentos_com_br','base_cnpj','sympla_outgo','olx','telelistas');
```

- `public.radar_agendar_coleta` (`20260917170000:60`) devolve `fonte_desligada` — o botão "Coletar".
- `public.radar_coletar_agora` (`20260908170000:88`) devolve `origem_desabilitada` — **nome diferente** —, e logo abaixo `coletor_desligado` quando `config->collector->>'enabled'` não é `true` (`:92`).
- `public.esteira_abrir_lote` recusa qualquer lote `kind='coleta'` com `origem_desabilitada` (`20260904001600:1788`). O lote da importação é `'planilha'` e passa igual.

O update não apaga linha de fonte, não mexe em candidato, não mexe em proveniência. Voltar atrás é o mesmo `update` com `true`.

**São cinco fontes, não seis. `instagram` fica ligada, e `google_places` também.** No nosso banco `is_enabled` quer dizer "vale como ORIGEM", e o comentário da seed diz isso (`supabase/seed.sql:110`). Desligar uma origem tem três efeitos sem relação com coleta: `public.radar_criar_candidato` devolve `origem_desabilitada` (`20260904001401:598`), `public.quick_create_organization` devolve o mesmo (`20260904000600:254`), e `apps/web/src/components/parceiros/catalogos.ts:35` filtra o select de origem por `is_enabled`. O Instagram, no MVP, é **curadoria manual** — desligá-lo cortaria a mão de quem cadastra sem desligar robô nenhum (o coletor dele é `phase: v1, enabled: false` e nunca teve adaptador). `google_places` fica pelo mesmo motivo e mais um: é a busca de telefone que a Fase 1 mantém.

**A armadilha que entra no mesmo PR.** `supabase/seed.sql:191` tem `is_enabled = excluded.is_enabled` no `on conflict do update`. O próximo `supabase db reset` religa tudo. Então o literal `true` vira `false` nas linhas **126** (casamentos), **131** (base_cnpj), **146** (sympla), **151** (olx) e **156** (telelistas). As linhas 136 e 141 ficam.

**E dois testes pgTAP quebram com esse seed.** Os dois abrem lote de coleta em `casamentos_com_br`: `supabase/tests/16_esteira_de_ingestao.sql` (148 e 155 — a 155 grava o `batch_id` em `pg_temp.ids`, e ~30 asserções seguintes dependem dele) e `supabase/tests/21_coletor_do_radar.sql:161`. A correção é uma linha em cada um, dentro da transação do teste:

```sql
update public.sources set is_enabled = true where slug = 'casamentos_com_br';
```

Não é asserção, nenhum `plan()` muda. O precedente existe: `03_dedup.sql:154` faz o contrário para `telelistas`.

**Não existe chave de coletor em `app_settings`.** A única chave do Radar lá é `radar.triagem` (`20260917180000:43`), que são os pesos da pontuação — e a pontuação **fica**.

**2. A máquina para de rodar.** `fly scale count 0 -a triade-worker-ingest`. Reversível com `count 1`; `pgmq` devolve a mensagem quando o visibility timeout expira.

Entre o interruptor e a tesoura passam **sete dias** de operação real com a Revisão já recebendo CSV. É essa semana que autoriza apagar, e é no oitavo dia que o app do Fly morre.

### 4.2 O que sai

**22 arquivos, 3.925 linhas:** `apps/workers/src/ingest/` (14 arquivos, 2.408), `apps/workers/src/workers/ingest.ts` (178), `apps/web/src/components/radar/catalogo-fontes.tsx` (394), `painel-coletor.tsx` (350), `agendar-coleta.tsx` (191), `painel-coletor.test.ts` (52), `infra/nuvem/fly.worker-ingest.toml` (48), `supabase/tests/37_a_coleta_cabe_num_botao.sql` (203), `supabase/tests/54_agendar_coleta_pela_tela.sql` (101).

**Editados:**

- `components/radar/dados.ts` (652 → ~340): saem `LinhaDeFonte`, `buscarFontes`, `paraFonte`, `alternarFonte`, `coletarAgora`, `agendarColeta`, `ColetaAgendada`, `buscarColetasRecentes`, `MOTIVO_DA_COLETA`, `MOTIVOS_DA_COLETA`, `MOTIVO_DA_FONTE`. **`buscarSaudeDaEsteira` não sai: muda de casa.**
- `components/radar/tipos.ts` (387 → ~250): saem `TipoDeFonte`, `FonteDoRadar`, `ROTULO_DO_CAMPO`, `ROTULO_DO_COLETOR`, `LoteDeColeta`, `ROTULO_DA_FILA`, `ROTULO_DO_LOTE` e os três campos de fonte do resumo (147–149). **`BatidaDeWorker`, `FilaDaEsteira` e `SaudeDaEsteira` (310–342) mudam de casa.**
- `components/radar/tela-radar.tsx` (444 → ~380): saem `<PainelDoColetor />` (242) e o `SeletorDeAba` (244–255) — com uma superfície só, aba é moldura vazia.
- `apps/workers/src/cli.ts`: `WORKER_COMMANDS` de quatro para três (`wa | ai | rotas`, linha 5), o mapa de opções do `ingest` (14), a ajuda (23), o bloco "Opções de ingest" (28), e o comentário da 94.
- `apps/workers/src/cli.test.ts`: os exemplos com `ingest` (26, 33, 42, 55, 59, 78, 107–110) passam a usar `wa`.
- `apps/workers/package.json`: saem `crawlee`, `playwright`, `cheerio`; a `description` deixa de dizer "quatro comandos".
- `infra/local/docker-compose.yml`: sai o serviço `worker-ingest` (93–109) com o `shm_size: 512m` que existia só para o Chromium; a linha 16 lista três workers.
- `infra/local/healthchecks/worker-heartbeat.mjs:20`: `WORKERS` perde `'ingest'`.
- Texto: `README.md:46,97`, `infra/local/README.md:12,35,40`, `.env.example:137,139`, `docs/operacao/maquina-do-luiz.md:21,243,312,319`.

**Migração nova, não migração apagada.** `supabase/migrations/` é histórico. Entra `20260929130000_o_radar_desliga_a_revisao_fica.sql`[^4]:

```sql
drop function if exists public.radar_coletar_agora(int, text[], int);
drop function if exists public.radar_agendar_coleta(int, text[], int, text);
drop function if exists public.radar_alternar_fonte(int, boolean);
-- e `create or replace function public.radar_resumo()` sem
-- fontes_total, fontes_ligadas e fontes_com_coletor_pronto.
```

`drop function` leva junto os `grant`/`revoke`. `public.radar_resumo()` tem uma definição só (`20260904001401:359`) e devolve `jsonb`, então tirar três campos não mexe em assinatura. **Depois do `supabase db reset`, regerar os tipos**: as três funções estão em `packages/schema/src/database.types.ts` (7790, 7799, 7803) e `dados.ts` chama `.rpc('radar_alternar_fonte')` com esse tipo. `supabase gen types` é passo obrigatório do PR.

Ficam de pé, de propósito: `public.esteira_fila_enfileirar/ler/concluir/falhar` e `public.esteira_estado_lote` (`20260904001802:39,58,75,87,118`) — encanamento genérico que `app.dlq_drenar` (`20260905000803:613`) usa. E `public.esteira_abrir_lote`, que a importação chama direto.

**O app do Fly que morre: `triade-worker-ingest`.** `fly apps destroy`, sete dias depois da `count 0`. Custo: **≈ US$ 3,19/mês** (`shared-cpu-1x` 512 MB, `infra/nuvem/fly.worker-ingest.toml:44–46`, sem auto-stop). ≈ US$ 38 no ano. **Não é por dinheiro que ele sai**: o que ele custava eram 2.586 linhas que ninguém revisita e um robô que contraria um ADR escrito. De brinde, some do mundo uma cópia da `SUPABASE_SERVICE_ROLE_KEY`.

**Duas economias que ninguém pediu:** (1) `crawlee` + `playwright` + `cheerio` saem da imagem **compartilhada** dos workers — hoje `wa`, `ai` e `rotas` carregam isso sem usar (só `playwright-core` são 13 MB). (2) `apps/workers/Dockerfile` nunca roda `playwright install`, e a imagem é Alpine (linha 48), onde o Chromium do Playwright nem é publicado. Logo `TipoDeColetor = 'playwright'` (`ingest/coletor.ts:34`), previsto para Sympla e OLX, **nunca teria funcionado em produção**.

### 4.3 O que fica e muda de nome

**A rota.** `apps/web/src/app/(app)/radar/` → `(app)/revisao/` (as duas páginas) e `components/radar/` → `components/revisao/`. Em `apps/web/next.config.ts` — hoje sem `redirects()` — entra um redirect permanente de `/radar` para `/revisao`; `permanent: true` é 308 e o Next repassa a query string.

**O menu** (`apps/web/src/lib/navegacao.ts:323–337`):

| Campo | Antes | Depois |
|---|---|---|
| `href` | `/radar` | `/revisao` |
| `rotulo` | Radar | Revisão |
| `icone` | `Radar` | `ListChecks` |
| `grupo` | `a_base` | `todo_dia` |
| `descricao` | "Fila de revisão dos candidatos de fontes públicas, cadastro manual, catálogo de fontes…" | "A fila de quem ainda não é parceiro, de qualquer origem: cada nome com pontuação, o que a IA achou dele e as duplicatas já apontadas. Aprovar cria a ficha e o negócio no funil." |

O comentário de três linhas abaixo (331–334) vira "candidato esperando decisão, de qualquer origem". A mudança de grupo segue a régua do próprio arquivo (`navegacao.ts:183`): `a_base` é "para achar alguém e para organizar, não para produzir contato"; depois da Fase 1 é na Revisão que o contato nasce. Continua **fora dos seis principais** (`ORDEM_PRINCIPAL`, `:148`). O número ao lado continua valendo sem uma linha de mudança: `contarFilasDoMenu` (`lib/filas-do-menu.ts:51`) conta `supplier_candidates` com `status='novo'` e nunca soube de onde o candidato veio — só o comentário muda (`:16–19`). **A asserção de `apps/web/src/lib/navegacao.test.ts:84` compara a lista exata `['Conversas','Radar']` e quebra se não for trocada** — junto com `:149`, `:212` e `lib/supabase/rotas-publicas.test.ts:42`. `lib/filtro-comando.test.ts:36` **não muda**: é teste negativo sobre o algoritmo de busca.

**A tela passa a mostrar** (uma superfície só, sem abas): a fila de `public.radar_fila` — que **já é agnóstica de origem** (`p_source_id` é `default null`); o filtro hoje chamado "Fonte" (`barra-fila.tsx:79`) vira **"Origem"**, e a lista vem de `carregarCatalogosDoRadar` (`catalogos.ts:32`), que lê `public.sources` **inteira**, ligadas e desligadas; a pontuação e as faixas A+/A/B/C (`app.radar_pontuar`, `20260922150000:17`) com a tela de pesos — que **melhoram**, porque o CSV traz nota e avaliações em toda linha e hoje 116 dos 229 pontuados caíram em C só por virem sem nota; o veredito da IA sobre o nome (`20260917230000:22–23`) e o `PedirLeituraDaIa`, que também melhora, porque a categoria do Google é mais ruidosa que a do Casamentos; a busca de telefone no Places por candidato; o cadastro manual e as quatro decisões (`public.radar_revisar_candidato`, corpo vigente em `20260909150000:61`).

**Fora da tela, os textos que passam a mentir** (`grep -rn "Radar" apps/web/src`): `components/radar/estados.tsx:56` · `meu-dia/estados.tsx:56` · `meu-dia/tela-meu-dia.tsx:287,292,311` · `relatorios/painel-fontes.tsx:99,102,184,186,189,190,198,202` · `painel-categorias.tsx:282` · `painel-base.tsx:277,284` · `painel-bairros.tsx:176` · `relatorios/estados.tsx:82,113,150` · `importacao/tela-importacao.tsx:365,393,581,586` · `importacao/recibo.tsx:19,103` · `agenda/tela-rota.tsx:534,544,579` · `funis/acoes/estados-quadro.tsx:94` · `admin/painel-lgpd.tsx:234` · `admin/formatos.ts:122` · `layout/sidebar.tsx:50` e `layout/nav-link.tsx:17,50` · `app/(app)/radar/page.tsx` (título, docstring, `abaInicial`, `podeLigarFonte`) · `app/manifest.ts:9` e `app/layout.tsx:47`.

**O que NÃO muda de nome: o banco.** `supplier_candidates`, `radar_fila`, `radar_resumo`, `radar_criar_candidato`, `radar_revisar_candidato`, `radar_repontuar`, `app.radar_pontuar` e os arquivos de pgTAP ficam. Renomear custaria `grant`/`revoke` refeitos, tipos regerados de novo, cinco arquivos de teste e uma migração de compatibilidade, para zero ganho de usuário. O nome do banco é ledger; o nome da tela é produto.

**Uma coisa perdida que precisa de casa nova.** `painel-coletor.tsx` era a **única** superfície que mostrava batida de worker — e `public.esteira_saude()` devolve a batida de **todos** (definição vigente em `20260905000200:1876`). Apagando a tela, ninguém responde "o robô do WhatsApp está de pé?" — justo antes de ele passar a responder 24 h. Então: `buscarSaudeDaEsteira` vai de `components/radar/dados.ts:379` para `components/admin/dados.ts`; `BatidaDeWorker`, `FilaDaEsteira` e `SaudeDaEsteira` vão para `components/admin/tipos.ts`; e uma linha — worker, última batida, vivo/parado, filtrada em `wa` e `ai` — entra em **Ajustes → Atendimento** (`components/admin/painel-atendimento.tsx`). São ~40 linhas. Existe `public.wa_saude()` (`20260905000803:896`) com um bloco `workers`, e **nenhuma tela a chama**; ficamos com `esteira_saude()`, que lista todo worker e já tem invólucro tipado e teste.

### 4.4 O que não pode sumir: a Revisão é o destino das sobras de toda importação

A fila **não é a saída do coletor**. É a saída de **qualquer** entrada que não deu certo sozinha, inteira dentro do Postgres:

```
CSV/planilha → esteira_gravar_captura → esteira_processar_captura
             → app.resolver_source_record → supplier_candidates → REVISÃO → organizations
```

Quem manda linha para lá é `public.importacao_gravar` (`20260904001820:766`), em cinco casos:

| Decisão | Motivo | Onde |
|---|---|---|
| `revisao` | `sem_candidato` | 901 — a esteira não formou identidade |
| `revisao` | `ja_revisado` | 926 — o candidato existe e já saiu da fila |
| `duplicata` | `ja_existe_na_base` | 927–931 — `app.find_org_matches` achou ficha parecida; as sugestões ficam em `payload->duplicatas` |
| `revisao` | `categoria_desconhecida` | 935 |
| `revisao` | `promocao_recusada` | 959–960 |

A **categoria** é o caso que mais vai aparecer com o Maps: sem linha em `source_category_map`, `category_id` chega nulo e a linha vai para a Revisão. Foi decisão escrita no seed e continua valendo: *"`cabine-de-fotos` não entra: cabine é serviço de foto para uns e brinquedo de festa para outros, e chutar aqui contamina o funil inteiro"*.

**O recibo aponta para lá, e a conta dele está certa.** `importacao/recibo.tsx:103` tem "Decidir as N que ficaram na fila" → `/radar` (vira `/revisao`). O N vem de `candidatosNaFila` (`importacao/dados.ts:77`), que conta **candidatos distintos**, não linhas, e `ja_revisado` não conta porque `radar_fila` filtra `status='novo'`. Isso está preso em `desfazer.test.ts:101`. **Essa ligação não pode quebrar no rename** — é o único caminho entre "importei" e "agora decide".

### 4.5 O dado que já existe

**Fica onde está. Nada é apagado à mão.** São 277 candidatos: **265 vieram da coleta de 17/09 no Casamentos; 12 já estavam lá antes**. 229 pontuados (36 A+, 72 A, 5 B, 116 C), 180 lidos pela IA, um com telefone. Três razões para não fazer faxina: (1) entre os 108 do topo há negócio real de Natal — Macamirim Eventos, Tábua de Carne, Decidi Casar — e o scraper vai achar esses mesmos nomes **com telefone**; (2) recusar em lote grava um "não" que ninguém decidiu, e a constraint `supplier_candidates_recusa_com_motivo` (`20260904001401:192`) existe por isso; (3) apagar linha arrebenta a cadeia `field_provenance` → `supplier_candidate`.

**A retenção do PRD §10.6 resolve sozinha, com data.** `app.aplicar_retencao` (`20260904001600:2120`), cron `0 7 * * *` UTC — 04:00 em America/Fortaleza (`:2226`):

| Item | Regra | Quando bate nos 277 |
|---|---|---|
| (2) candidato `novo` | apagado aos 90 dias de `created_at` | **16/12/2026** |
| (1) `raw_capture` | apagada por `purge_after` (90 dias) | 16/12/2026 |
| (4) `source_record` sem candidato | apagado aos 90 dias de `last_seen_at` | 16/12/2026 |
| (3) candidato `recusado` | **a linha fica**, o contato sai aos 90 dias da recusa | conforme a decisão |
| (6) `field_provenance` órfã | apagada junto | conforme |

O item (3) faz o "não" ser respeitado sem virar reincidência. Cada rodada deixa relatório em `public.retention_runs`. **Nada disso muda nesta fase**, e o que vale para os 277 vale para o CSV: candidato não trabalhado some em 90 dias. A única forma de não perder o alvo é decidir.

**O que some de imediato:** as 18 listagens de `config->collector->catalogo` do Casamentos (`supabase/seed.sql:218`) — são instruções de coleta. A autoverificação do seed perde a linha **1646**; a linha **1647** (mapa de categorias, ≥ 23) **fica** e passa a guardar as duas fontes.

### 4.6 Testes

| Arquivo | Hoje | Depois |
|---|---|---|
| `tests/37_a_coleta_cabe_num_botao.sql` | `plan(22)` | apagado |
| `tests/54_agendar_coleta_pela_tela.sql` | `plan(12)` | apagado |
| `tests/14_radar_candidatos.sql` | `plan(69)` | `plan(65)` — saem as 4 asserções de `radar_alternar_fonte` (333, 336, 338, 344) |
| `tests/21_coletor_do_radar.sql` | `plan(36)` | `plan(33)` — saem as 2 de `config->collector->catalogo` (201, 210) e a que cruza catálogo com mapa (240); **ficam** as 3 de `source_category_map` e as de `esteira_fila_*`; **entra** o `update ... is_enabled = true` antes da 161 |
| `tests/16_esteira_de_ingestao.sql` | `plan(125)` | `plan(125)`; entra o `update` antes da 148. **Sem isso, 16 quebra em cascata** |
| `22_importacao_de_planilha.sql`, `33_desfazer_o_lote.sql` | — | **intocados**, e são eles que provam o §4.4 |
| `03_dedup.sql`, `08_seed.sql`, `41`, `55`, `64` | — | **intocados** |

Saldo: **−41 asserções** sobre o total do dia (2.896 antes da Fase 1), mais o que a Fase 1 somou. A trava é o `plan()` de cada arquivo, não o total.

**Vitest workers — 517 linhas apagadas** (`casamentos.test.ts` 126, `robots.test.ts` 122, `guarda.test.ts` 111, `whitelist.test.ts` 89, `acelerador.test.ts` 69), **43 blocos `it(`**, e `cli.test.ts` editado.

**Vitest web:** `painel-coletor.test.ts` apagado; `radar/dados.test.ts` (189 → ~50, sai o `describe('paraFonte')` inteiro, o helper `linha()`, o import de `LinhaDeFonte` e a metade `MOTIVO_DA_FONTE`); `navegacao.test.ts:84,149,212` e `rotas-publicas.test.ts:42`; **teste novo**: o redirect `/radar → /revisao` responde 308.

**Playwright: não há o que acompanhar.** Não existe `apps/web/e2e` nem `playwright.config`; o CI roda lint, tipos, Vitest e pgTAP. Quando a suíte nascer, nasce em `/revisao`.

---

## 5. Fase 3 — o freio (antes de qualquer robô)

Hoje o CRM não tem freio. Ele avisa.

- `app.ai_alerta_orcamento()` (`20260905000200:483`) roda no cron `ia_alerta_orcamento` (`0 12 * * *`, linha 2223), abre tarefa e não bloqueia. Nenhum caminho entre `apps/workers/src/ia/execucao.ts` e a API da Anthropic pergunta quanto já se gastou.
- `app.pode_enviar` (`:1348`) devolve `pode = true` no passo 2 para qualquer resposta dentro das 24 h: sem horário, sem teto. Deliberado — **enquanto quem responde é gente**.
- O webhook da Meta descarta a saúde do número: `supabase/functions/wa-webhook/extrair.ts:197-200` só trata `field='messages'`. Não existe tabela de histórico: `whatsapp.numero` em `app_settings` guarda um `qualidade` gravado uma vez, na conexão (`20260914100000:670`, lido por `apps/workers/src/whatsapp/conectar.ts:88` e `:296–301`).
- O aquecimento (20 → 35 → 45, `app.teto_do_canal`) só é consultado quando `p_primeiro_contato` é verdadeiro.

Com uma pessoa no meio isso funciona: ela vê a conta e para. Sem pessoa, ninguém vê. As quatro peças abaixo substituem os olhos dela.

### 5.1 (a) Orçamento que freia

O teto continua o do PRD §10 (`app_settings.ia.orcamento.mensal_usd`, hoje US$ 25) e passa a **recusar a chamada**. Mudar o número é `update` do gestor (política `app_settings_update`, `20260904001700:169`), não deploy. As duas linhas são **derivadas** do que estiver lá:

| Linha | Fórmula | Hoje | O que acontece |
|---|---|---|---|
| alerta | `mensal_usd × fracao_alerta` | US$ 20 | alerta `passou_de_80`, como hoje, **e** param os 12 propósitos que não são de atendimento |
| freio | `mensal_usd` | US$ 25 | alerta novo `freou` **e** param também `classify_inbound` e `transcribe_audio` |

**Quais são os 12.** `app.ia_enfileirar` e o `check` de `ai_runs.purpose` conhecem **14** propósitos (lista viva em `20260917230200_o_proposito_novo_entra_na_fila.sql`). A regra é escrita por **exclusão**: sobrevivem até o teto `classify_inbound` e `transcribe_audio`; todo o resto para na linha de alerta. Assim um propósito novo entra no lado seguro sozinho. Esses dois sobrevivem porque são os únicos que servem para entender quem escreveu agora.

**Onde vive o bloqueio:** no Postgres, `app.ia_pode_gastar(p_proposito text)` → `{pode, motivo, gasto_usd, teto_usd, linha_de_alerta_usd}`, lendo `app.ai_gasto_do_mes(null)` (já usa dias úteis reais via `app.business_days`). O worker consulta por RPC. Motivo: ADR-03, e prático — o teto é `app_settings`, e o freio tem de mudar junto sem deploy.

São **três pontos de chamada**:

1. `apps/workers/src/ia/execucao.ts`, em `executar()`, logo depois da reconferência de supressão (`alvoEstaSuprimido`, linha 178) e **antes** de `contexto.modelo.conversar()` (200). Recusa → linha em `ai_runs` com `status='bloqueado'`, `cost_usd=0`, `error='orcamento_esgotado'` e `OrcamentoEsgotadoError`, classe nova ao lado de `ChamadaBloqueadaError` e `AlvoSuprimidoError` (`:51`, `:73`), acrescentada a `eDeterministico()` — que fica em **`apps/workers/src/ia/tarefas.ts:98`**. Assim a fila conclui em vez de girar.
2. `app.ia_enfileirar` passa a recusar os 12, devolvendo `{enfileirado:false, motivo:'orcamento'}` — mesma forma de `app.esteira_enfileirar` (`20260904001600:1557`). **Sem `raise`**: `app.ia_enfileirar_resumo` roda dentro da transação de `public.tabular_tentativa` (`20260906000100:358`), e uma exceção abortaria a tabulação. A recusa aparece em `resumo_enfileirado`/`resumo_motivo`.
3. **A segunda porta, que estava aberta.** `apps/workers/src/ia/fila.ts:80` (`enfileirarTrabalho`) não chama `app.ia_enfileirar`: chama `public.esteira_fila_enfileirar` direto na fila `ai_jobs`, pulando a lista de propósitos e qualquer freio (usada em `tarefas.ts:261` e `:403`). Passa a chamar `public.ia_fila_enfileirar` (`20260905000201:797`), como `pedirTrabalhoDeIa` já faz. Uma diferença a respeitar: `chaveDaMensagem` lê `payload.chave`, então o payload continua levando `chave` explícita — `p_payload: { ...payload, chave }`.

**O que acontece com a mensagem que chegou quando o orçamento acabou.** Ela não some e não fica sem resposta: já está em `public.messages` antes de qualquer IA (`wa-webhook` → `wa_inbound` → `app.wa_registrar_entrada`); o texto fixo continua saindo (`app.wa_bot_de_entrada`, disparado por gatilho, não custa IA); a classificação vira `ai_runs` com `status='bloqueado'`. **A pausa e a tarefa não ficam dentro de `executar()`** — ela é genérica e o `digest` não tem conversa. Ficam em `classificarEntrada` (`tarefas.ts:524`), que captura `OrcamentoEsgotadoError` e reusa `escalarConversa` (`banco.ts:417`), mais uma linha em `public.tasks` ("Orçamento de IA esgotado — responda à mão") para `conversations.assignee_id`. Caso honesto: numa conversa em que o robô já falou as duas vezes dele, o texto fixo **não** sai; sobra a tarefa. É o certo — robô mudo é melhor que robô inventando.

**O outro dinheiro.** A mesma migração cria a view `public.wa_servico_do_mes` (`security_barrier = true, security_invoker = false`, leitura para `admin`, `gestor` e `financeiro`, no molde de `public.wa_confirmacoes_devidas`, `20260905000400:759`), contando `messages` com `direction='out' and not business_initiated and status <> 'failed'` no mês — o contrário exato de `app.iniciadas_pela_empresa` (`20260905000200:1316`). Só medir, nesta fase.

**Migração `20260928100000_o_orcamento_freia.sql`:** `app.ai_gasto_do_mes` ganha a cascata `freou` → `passou_de_80` → `ritmo_acima` → `ok` e o campo `linha_do_freio_usd` (sem duplicar `limite_de_alerta_usd`); o `check` de `ai_budget_alerts.situacao` (`:466`) aceita `'freou'`; `app.ai_alerta_orcamento` ganha o título e, quando o mês pula direto para `freou`, grava **as duas linhas** (senão o registro de 80% nunca existiria), continuando idempotente pela PK `(mes, situacao)`; `app.ia_pode_gastar(text)` com `grant execute to service_role`; `app.ia_enfileirar` recriada; `public.ia_orcamento_status()` ganha `freado` e `parados`.

**Testes:** `supabase/tests/67_o_freio_do_orcamento.sql` — com US$ 21 sobre teto 25, `ia_pode_gastar('draft_reply')` falso e `('classify_inbound')` verdadeiro; com US$ 26, os dois falsos; a partição dos **14** propósitos asseverada nome a nome, para que um propósito novo derrube o teste; `ai_alerta_orcamento()` grava `freou` e `passou_de_80` numa passada e a segunda devolve `ja_alertado`. `execucao.test.ts`: RPC `pode:false` → `ai_runs` em `bloqueado`, **nenhuma** chamada ao dublê, e `workers/ai.ts` concluindo a mensagem da fila. `fila.test.ts`: `enfileirarTrabalho` bate em `ia_fila_enfileirar` e o payload leva `chave`.

### 5.2 (b) Saúde do número

**1. Dois campos de webhook.** Assinamos `phone_number_quality_update` e `account_update`. O adaptador **guarda o `value` inteiro** em `payload jsonb` e lê só o que precisa: `current_limit`, `old_limit`, `event`, e em `account_update` os blocos `restriction_info` (`restriction_type`, `expiration`), `ban_info` e `violation_info`. Os tipos que nos afetam: `RESTRICTED_BIZ_INITIATED_MESSAGING` e `RESTRICTED_CUSTOMER_INITIATED_MESSAGING`. Pegadinha registrada: **`account_update` não traz `phone_number` em `value`** — a restrição é da WABA; o número vem de `app.wa_numero_padrao()` (`20260914100000:188`).

**2. A nota verde/amarelo/vermelho vem da Graph.** `GET /<PHONE_NUMBER_ID>` com `CAMPOS_DO_NUMERO` — a constante já existe (`conectar.ts:87`) e já inclui `quality_rating`, `status`, `name_status`, `throughput`. Hoje é pedida **uma vez**, na conexão. Falta repetir.

**3. O teto efetivo passa a ser o MENOR entre o nosso e o da Meta.** `app.wa_teto_da_meta(p_numero, p_quando)` → `{teto_dia, restrito_saida, restrito_entrada, banido, ate, qualidade}`, lendo a última linha de `public.wa_saude_numero`. Tier: `TIER_50`→50, `TIER_250`→250, `TIER_2K`→2000, `TIER_10K`→10000, `TIER_100K`→100000; `TIER_NOT_SET` e `TIER_UNLIMITED` → `teto_dia = null`. A qualidade é dobrada **dentro** de `teto_dia`: `YELLOW` → metade, `RED` → zero. Sem linha nenhuma, `teto_dia = null` e nada muda — "não sei" nunca vira "então pode", e também nunca vira "então pare".

`app.pode_enviar` é recriada com: **passo 1.5**, antes da janela de 24 h — `banido` → `conta_banida`, `quando = v_quando + interval '6 hours'`; `restrito_entrada` → `meta_restringiu_entrada`, `quando = ate` (vem antes porque `RESTRICTED_CUSTOMER_INITIATED_MESSAGING` derruba até a resposta dentro da janela, e o passo 2 liberaria); **passo 4.5** — `restrito_saida` → `meta_restringiu_saida`; **passo 5** — `v_teto := least(app.teto_do_canal(...), coalesce(teto_da_meta, 2147483647))`, e com `teto_dia = 0` (RED) o motivo é `qualidade_vermelha`, não `teto_do_numero`, porque as duas coisas se resolvem em prazos diferentes; **passo 6** — `least(coalesce(teto_iniciadas_dia,150), coalesce(teto_da_meta, 2147483647))`. `app.envio_motivo_de_espera` (`20260921100000:668`) é recriada para incluir os quatro motivos novos — todos são **espera**, não morte: o lote de campanha dorme em vez de queimar as fichas.

Hoje a Meta libera 2.000 conversas novas por dia e o nosso teto é 45: o menor continua sendo o nosso. A peça existe para o dia em que a Meta cortar sem avisar.

**Migração `20260928110000_a_saude_do_numero.sql`:** `public.wa_saude_numero` (`numero`, `origem` `webhook|graph`, `campo`, `evento`, `qualidade`, `limite_anterior`, `limite_atual`, `conversas_por_dia`, `restricoes jsonb`, `banido`, `payload jsonb`, `ocorrido_em`, `created_at`), append-only pelo gatilho `app.forbid_change()` (`20260904000400:28`), RLS de leitura para `admin` e `gestor`, índice `(numero, ocorrido_em desc)`; `public.wa_saude_registrar(p_item jsonb)` `security definer`, só `service_role`; `app.wa_teto_da_meta`, `app.pode_enviar` e `app.envio_motivo_de_espera` recriadas.

**Arquivos:** `wa-webhook/extrair.ts` ganha `tipo:'saude'` com `chave = saude:${campo}:${entrada.id}:${entrada.time}:${indice}` (o índice entra porque `entry.time` pode faltar; a idempotência de entrega já é de `public.wa_webhook_receber`, `20260905000201:118`), e os demais campos continuam nomeados em `ignorados`. `apps/workers/src/whatsapp/entrada.ts` ganha o ramo no despacho de `tipo` (117-120). `apps/workers/src/whatsapp/saude.ts` faz a leitura periódica pela Graph (`graph.ts`, `VERSAO_PADRAO='v26.0'`), exportando `criarSaudePeriodica` com o contrato `talvezDisparar`/`encerrar` de `criarSincronizacaoPeriodica` (`modelos-meta.ts:628`) e o mesmo intervalo de 30 min, mas **instância própria**: a dos modelos é `null` quando `META_WA_BUSINESS_ACCOUNT_ID` está vazia (`workers/wa.ts:157`, `:166`), e a saúde depende do `phoneNumberId`, não da WABA. Ligada em `wa.ts` ao lado de `modelos?.talvezDisparar()` (216) e `modelos?.encerrar(parando)` (252). Falha de rede vira `warning` e mantém a última linha valendo.

**Testes:** `supabase/tests/68_saude_do_numero.sql` — `RESTRICTED_BIZ_INITIATED_MESSAGING` com `expiration` no futuro → `meta_restringiu_saida` com `quando = expiration`; `RESTRICTED_CUSTOMER_INITIATED_MESSAGING` recusa **também** dentro da janela; `TIER_50` com teto nosso 150 → efetivo 50; `RED` → zero iniciadas, motivo `qualidade_vermelha`; tabela vazia → nada muda; os quatro motivos são espera. `extrair.test.ts`: o teste de hoje (184) muda de expectativa para `phone_number_quality_update`, que passa a virar item `saude`; campo realmente desconhecido continua em `ignorados`. `saude.test.ts` contra `duble-da-graph-de-teste.ts`.

### 5.3 (c) O furo do recontato

`app.messages_deriva_primeiro_contato` (`20260914100000:132`) marca `is_first_contact` só quando a conversa nunca teve entrada nem saída viva. `app.pode_enviar` consulta o aquecimento **dentro de `if p_primeiro_contato`**. Logo: uma campanha de recontato sobre 3.000 fichas já tocadas pula o passo 5 inteiro e só esbarra em 150/dia e 60/hora. Ninguém mente — o aquecimento simplesmente não é perguntado. E a Meta não conta "primeiro contato": conta conversa aberta pela empresa.

**A correção:** o teto do aquecimento passa a valer sobre **abertura**.

- `app.aberturas_do_dia(p_channel, p_dia, p_numero)` — cópia de `app.primeiros_contatos_do_dia` (`20260905000200:1256`) trocando `m.is_first_contact` por `m.business_initiated`. Mantém as exclusões existentes (`cadence_touch_id is null`, `status <> 'failed'`) e ganha `not m.optout_confirmation`: a confirmação de opt-out É `business_initiated` fora da janela, mas é resposta a quem pediu para sair, nunca abertura; e o portão dela (`20260905000300:216`) não consulta `teto_do_canal` — então ela não pode ser barrada pelo aquecimento, nem comê-lo.
- `app.pode_enviar`, passo 5: a condição `if p_primeiro_contato` **some**, não é substituída. Seria tautológica — o passo 2 já retornou `true` para todo caso de `not p_primeiro_contato and janela aberta`. O passo 5 passa a comparar `app.aberturas_do_dia` com `app.teto_do_canal`, sempre.
- O motivo continua `teto_do_numero`, de propósito: `app.envio_motivo_de_espera` já o trata como "agora não", então o lote **dorme até amanhã**. Nenhuma linha do motor de campanha muda.
- Índice novo `messages_aberturas_idx on public.messages (created_at) where direction='out' and business_initiated`. O `messages_teto_idx` de hoje (`:1213`) é parcial por `is_first_contact` e deixa de servir; o novo também serve `app.iniciadas_pela_empresa`, que hoje varre sem nenhum.
- `is_first_contact` continua com o mesmo significado, para relatório. Muda o que o portão conta, não o que a coluna quer dizer.

**Os dois tetos não são o mesmo, e os dois ficam.** O passo 5 conta aberturas *fora* da cadência; o passo 6 conta tudo que é `business_initiated`, cadência inclusive, contra 150/dia e 60/hora.

**O preço, dito claro:** a campanha de recontato passa a andar a 45/dia em vez de 150/dia. 3.000 fichas deixam de levar 20 dias úteis e passam a levar 67. E o teto agora é do time inteiro: um dia de follow-ups legítimos fora da janela come a mesma cota — que é como a Meta conta. Subir é `app_settings.cadencia.tetos.whatsapp.depois`, `update` do gestor, com `teto_duro` de 100 (`20260904001700:184`) validado por `app.app_settings_validate`. Recomendação: só depois de duas semanas com `qualidade='GREEN'` na tabela da peça (b) — agora dá para saber.

**Migração `20260928120000_o_teto_conta_aberturas.sql`**, que recria `app.pode_enviar` **por cima** da versão de `20260928110000`: uma função tem uma definição de cada vez, e a ordem das migrações é a ordem do arquivo.

**Teste `supabase/tests/69_teto_de_aberturas.sql`:** conversa com histórico + template fora da janela conta em `aberturas_do_dia`; com 45 aberturas, a 46ª é recusada com `teto_do_numero` e `quando` na próxima abertura; resposta dentro das 24 h **não** conta e não é barrada; confirmação de opt-out não conta e continua saindo; mensagem de cadência não é contada duas vezes.

### 5.4 (d) Teto de fala do robô e detector de pingue-pongue

O bot de entrada tem teto: `app.wa_bot_de_entrada` fala no máximo duas vezes e devolve `bot_ja_falou` (`20260916110000:291`). Esse teto morre na Fase 4. O de baixo é o que sobrevive.

| Regra | Valor | Por quê |
|---|---|---|
| Falas do robô por conversa | **6 em 24 h**[^5] | Uma conversa real tem saudação, preço, link do cadastro e mais duas idas. A sétima é sinal de que o robô não está entendendo. |
| Pingue-pongue | 3 recebidas seguidas, cada uma menos de 20 s depois da nossa saída anterior | Gente lê antes de responder. Três vezes em menos de 20 s é máquina. |
| Repetição | as 3 últimas recebidas têm o mesmo corpo, por `lower(btrim(body))` | Loop de outro robô ou autoresponder. |
| Fusível global | mais de 120 mensagens de robô na última hora, somando todas as conversas | Pega o laço que não cabe numa conversa só. |

**Onde vive:** `app_settings` ganha `whatsapp.robo_teto` com esses quatro valores — números de operação não moram em código. `app.wa_bot_falas(p_conversation_id, p_desde)` conta `messages` com `author_kind in ('bot_fixed','bot_ai')` na janela, **exceto** a despedida. `app.wa_bot_pode_falar(p_conversation_id)` → `{pode, motivo, falas}` é **pura**: confere fusível global, `bot_paused`, teto de falas, pingue-pongue, repetição. `app.wa_bot_freiar(p_conversation_id, p_motivo)` age, e **a ordem importa**: (1) manda a despedida com `app.wa_bot_dizer(conv, 'GEN-SYS-HUMANO')`, (2) só então `bot_paused = true` e `status='aguardando_nos'`, (3) abre a tarefa para `conversations.assignee_id`. Invertido, o próprio guarda recusaria a despedida. Idempotente pela regra de 12 h por modelo que `app.ausencia_responder` já usa (`20260922120000:122`).

`GEN-SYS-HUMANO` é modelo novo em `public.message_templates`, no molde do `GEN-SYS-AUSENCIA`: `category='service'`, `segment='GEN'`, `kind='sistema'`, texto "Vou chamar alguém do time para te responder."

**O freio de verdade está no guarda.** `app.messages_guard` (`20260916130000:13`) ganha, no ramo de saída, **depois** do retorno antecipado da confirmação de opt-out: se `new.author_kind in ('bot_fixed','bot_ai')` e `app.wa_bot_pode_falar` disser não, `raise exception ... errcode 42501`. Exceção única: `new.template_id` = o id de `GEN-SYS-HUMANO`. É a única alteração do guard nesta spec, e é **aperto**, não afrouxamento.[^1] Assim o teto vale para o bot de entrada, para a ausência, para o árbitro da Fase 4 e para o que vier. A confirmação de opt-out é `author_kind='system'` e retorna antes desse ponto.

Nenhuma dessas exceções derruba a mensagem que chegou: `app.messages_bot_de_entrada` e `app.messages_x_ausencia` já embrulham a chamada em `begin ... exception when others then raise warning`; o árbitro da Fase 4 nasce com o mesmo embrulho.

O fusível global grava `app_settings.whatsapp.bot_de_entrada.freio = {parado_em, motivo}` — **na linha que já existe**, porque `public.wa_bot_ligar(true)` (`20260916110000:320`) escreve nessa linha. Ele passa a limpar `freio` junto com `{ativo}`: um gesto só, o que o time já conhece.

**Migração `20260928130000_o_robo_tem_teto_de_fala.sql`. Teste `supabase/tests/70_teto_de_fala_do_robo.sql`:** 6 falas em 24 h e a 7ª recusada com 42501; a despedida sai mesmo assim, uma vez, e não conta como fala; 3 entradas em menos de 20 s → despedida, `bot_paused` e tarefa, nesta ordem; 121 mensagens na hora → `freio` gravado e toda fala recusada até `wa_bot_ligar(true)`, que limpa `freio` e `ativo` na mesma chamada; conversa com `bot_paused = true` continua deixando sair a confirmação de opt-out.

---

## 6. Fase 4 — o robô responde sozinho

A IA classifica a intenção; o banco escolhe o texto; o texto sai igual ao que está gravado. A IA não escreve uma palavra do que vai no fio. Por que isso não derruba o ADR-05: §2.2.

**Aviso de nome:** a migração `20260922130000_metricas_do_atendimento.sql` se chama "Fase 4" no cabeçalho — aquilo era a fase 4 do atendimento em equipe (21–22/09). São coisas diferentes; as migrações novas dizem isso na primeira linha.

### 6.1 O caminho de uma mensagem que chega, hoje

1. **Meta → `supabase/functions/wa-webhook/index.ts`**: lê o corpo cru, confere o HMAC `X-Hub-Signature-256`, traduz (`extrair.ts`), chama `public.wa_webhook_receber`. Não decide nada.
2. **`public.wa_webhook_receber` (`20260905000201:118`)**: grava a entrega e enfileira em `wa_inbound` por `app.esteira_enfileirar` (`:157`), na mesma transação, idempotente pelo wamid.
3. **worker-wa → `apps/workers/src/whatsapp/entrada.ts`**: grava → opt-out por regra (`optout.ts`) → áudio → enfileira `classify_inbound` (`:314`, via `pedirTrabalhoDeIa` em `ponte.ts:295`).
4. **O `insert` em `public.messages` dispara oito gatilhos `after insert`**, em ordem alfabética do nome. É aqui que mora o problema.
5. **worker-ai → `tarefas.ts`, `classificarEntrada` (`:524`)**: `detectarOptOut` antes de qualquer modelo, Haiku, `decidirIntencao`, `gravarClassificacao` (`banco.ts:428`) em `conversations.ai_intent`/`ai_confidence`, e `escalarConversa` (`banco.ts:417`) se houver escalada.
6. **A saída**: `app.wa_bot_dizer` insere em `queued`; `public.wa_saida_enfileirar_pendentes` põe em `wa_outbound`; `app.wa_proximos` (`20260917130000`, reconferência em `:58`) **reconfere** `app.wa_motivo_de_recusa` e `app.pode_enviar` no instante da entrega.

O worker calcula `decisao.responde` e só escreve no log (`tarefas.ts:601`). A intenção não é jogada fora — aparece na caixa (`conversas/mensagens.ts:541`) e volta como `ultima_intencao` na classificação seguinte. O que ninguém faz é responder com ela.

### 6.2 Quatro automatismos, nenhum árbitro

| # | gatilho | migração | responde? |
|---|---|---|---|
| 1 | `messages_after_write` | 20260905000200:1671 | não (contadores, e o `last_inbound_at` de que a janela de 24 h depende) |
| 2 | `messages_bot_de_entrada` | 20260916110000:315 | **sim** — menu e a resposta da opção |
| 3 | `messages_ia_pendente` | 20260917100000:280 | não |
| 4 | `messages_quem_responde_atende` | 20260914100000:847 | não |
| 5 | `messages_resposta_ao_botao` | 20260921110000:721 | **sim** — link do botão da campanha |
| 6 | `messages_resposta_no_funil` | 20260915130000:193 | não |
| 7 | `messages_x_ausencia` | 20260922120000:181 | **sim** |
| 8 | `messages_zz_lead_automatico` | 20260922110000:326 | não (cria ficha) |

**Não existe árbitro.** Cada um pergunta à tabela, com um `exists` próprio, se alguém já respondeu: `app.wa_bot_de_entrada` olha saída com `created_at <= m.created_at` → `conversa_humana`; `app.ausencia_responder` olha saída com `created_at >= m.created_at` → `ja_respondida`; `app.envio_resposta_ao_botao` não olha nada. Hoje não há resposta dupla, e é por sorte: a ordem alfabética põe menu e botão antes da ausência. **Um quinto respondedor quebra isso**, porque o robô por intenção responde *depois* — quando o worker-ai volta.

Três achados da mesma leitura:

- **Quem responde a campanha hoje não recebe nada.** Desde 22/09 a campanha abre com o cumprimento solto (`20260922160000_so_o_cumprimento.sql`). Isso é uma saída na conversa, então o bot marca `conversa_humana` e nunca manda o menu. Em horário comercial, a resposta fica muda até alguém abrir a caixa. É o maior volume que temos.
- **O caminho do botão está dormente**: a mesma migração desligou os três convites com botão (`is_active=false`). A regra entra no árbitro mesmo assim, para que volte certa.
- **`app.envio_resposta_ao_botao` insere `author_kind='human'` com `sent_by = e.criado_por`** (`20260921110000:634`) — mensagem automática assinada como se uma pessoa tivesse mandado. **Consertar isso exige afrouxar o `messages_guard`, e esta spec não afrouxa: o item vai para §8.9.**[^1]

### 6.3 (a) O árbitro

Em `supabase/migrations/20260929100000_o_arbitro_do_atendimento.sql`:

- **`app.wa_quem_responde(p_message_id uuid, p_intencao text default null, p_confianca numeric default null) returns jsonb`** — `stable`, não escreve, devolve `{quem, motivo, intencao, confianca, resposta_id}`.
- **`app.wa_atender(...)`** — chama a de cima, grava o veredito e executa.

**A intenção entra por parâmetro, não por leitura de `conversations.ai_intent`.** Dois motivos no código: `ai_intent` é da conversa, não da mensagem, e `app.wa_bot_de_entrada` também escreve nele quando a pessoa escolhe uma opção do menu (`20260916110000:277`).

**Onde é chamada**, duas portas e só duas: (1) gatilho `messages_atender after insert on public.messages for each row when (new.direction='in')`, sem intenção — o nome é `messages_atender` de propósito: vem depois de `messages_after_write` (que atualiza `last_inbound_at`) e antes de todo o resto; (2) `public.ia_gravar_classificacao(p_message_id, p_conversation_id, p_intencao, p_confianca)`, RPC nova (`security definer`, `grant ... to service_role`) que o worker-ai chama no lugar do `update` direto de `banco.ts:428`.

**Ordem no worker, que muda:** hoje `tarefas.ts:597` grava a classificação e depois `:598` escala. Invertido: `escalarConversa` primeiro, `ia_gravar_classificacao` depois. Sem isso o árbitro roda antes de `bot_paused=true`.

Os gatilhos `messages_bot_de_entrada`, `messages_x_ausencia` e `messages_resposta_ao_botao` são **dropados na mesma migração que cria o árbitro**. As funções continuam vivas: viram braços dele. `messages_zz_lead_automatico` fica, e continua rodando depois (`atender` < `zz`); o comentário de `20260922110000:323`, que cita `messages_bot_de_entrada` pelo nome, é reescrito.

**A ordem de prioridade** (a primeira que casa devolve):

| ordem | regra | quem | se falhar |
|---|---|---|---|
| 1 | `app.wa_parece_optout(body)` | `optout` | robô vende para quem acabou de pedir para sair |
| 2 | `app.wa_motivo_de_recusa(org, contato, telefone)` não nulo | `ninguem` | mensagem para contato suprimido ou apagado |
| 3 | a palavra HUMANO (§6.6) | `humano_pedido` | a saída prometida não existe; a Meta rebaixa a qualidade |
| 4 | `c.bot_paused`, `c.bot_estado='conversa_humana'` **ou o carimbo de `app.messages_quem_responde_atende`** | `pessoa` | robô fala por cima de um atendente que respondeu sem pausar o bot |
| 5 | `app.envio_resposta_ao_botao` devolve `agiu=true` | `botao` | o link da campanha não sai |
| 6 | `app.wa_bot_de_entrada` devolve `agiu=true` | `menu` | quem escreve primeiro fica sem triagem |
| 7 | `app.wa_bot_pode_falar` diz não (§5.4) ou o teto do mês estourou (§6.9) | `pessoa` | conversa vira monólogo de robô, e conta paga |
| 8 | veio sem intenção (chamada do gatilho) | `aguardando_classificacao` | árbitro responde antes de saber do que se trata |
| 9 | modelo ativo com `intencao = <X>` e `robo_responde`, `responde='texto_fixo'`, `escalar=false`, confiança ≥ 0,85, janela de 24 h aberta, chave-mestra ligada | `robo` | — |
| 10 | qualquer outro caso | `pessoa` | — |

**A regra 1 não pode comer o toque do botão.** Hoje `messages_resposta_ao_botao` roda sempre e é ele quem grava `envios_em_massa_itens.botao_tocado` e chama `public.wa_optout_registrar` quando o botão é de sair (`20260921110000:685`). Então `app.envio_resposta_ao_botao` ganha `p_so_saida boolean default false`, que marca o toque, registra a saída e **retorna antes do ramo `link`**; no veredito `optout` o árbitro a chama assim.

**Empate não existe, por construção.** A lista é sequencial. Duas intenções na mesma mensagem já são desempatadas antes, por `impacto`, em `decidirIntencao` (`decisao.ts:245`). E a mesma mensagem só é decidida uma vez: `public.atendimento_decisoes` (`message_id` como PK; `quem`, `motivo`, `intencao`, `confianca`, `resposta_id`, `decidido_em`) guarda o veredito. O único valor substituível é `aguardando_classificacao`, e uma vez só.

`public.atendimento_decisoes` e `public.intencoes` (§6.4) nascem com RLS: `select` para `authenticated`, escrita só pelas funções `security definer`, e `public.intencoes` com escrita por `app.is_manager()`.

### 6.4 (b) Intenção → texto

Em `20260929110000_a_resposta_por_intencao.sql`:

- Nasce **`public.intencoes`** (`codigo`, `responde`, `prioridade_absoluta`, `impacto`), semeada com as 25 de `packages/prompts/src/prompts/classificar-intencao/intencoes.ts` — 14 `texto_fixo`, 7 `ia`, 3 `humano`, 1 `cadencia`. As 25 só existem em TypeScript hoje, e quem decide agora é o banco. Um Vitest impede que as duas listas divirjam.
- **`public.message_templates`** ganha `intencao text references public.intencoes(codigo)` e `robo_responde boolean not null default false`.
- Índice único parcial: `create unique index message_templates_intencao_uq on public.message_templates (intencao) where robo_responde and is_active and channel = 'whatsapp'`. Uma intenção, um texto.
- `check (intencao is distinct from 'OPT_OUT')`: a confirmação de opt-out é de `public.wa_optout_registrar` e de mais ninguém (índice único garantindo uma só, `20260905000300`).
- Gatilho `message_templates_robo_valido before insert or update`: quando `robo_responde`, exige `intencao` não nula, exige que `public.intencoes.responde` daquele código seja `'texto_fixo'` e roda `app.texto_automatico_valido(body)` (§6.9). **É gatilho, não `check`** — uma constraint `check` só pode chamar função imutável, e essas duas leem tabela.
- **A mensagem sai por `app.wa_bot_dizer(conversation_id, template_code)`**, que já insere `author_kind='bot_fixed'`, `origin='crm'`, `status='queued'`, `body = t.body` e `template_id = t.id`. **Zero mudança no ramo `bot_fixed` do `app.messages_guard`.**[^1] A trava "a IA não escreve" é estrutural: o corpo é copiado da linha do modelo dentro de uma função `security definer` que só o banco chama, e `template_id` está na lista de imutabilidade do UPDATE desde a `20260916130000`.

**Quem cadastra:** gestor e admin, em Ajustes → Catálogos → Modelos, com um seletor de intenção e um interruptor "o robô pode mandar sozinha". Ligar e desligar é `update` de uma linha.

**Intenção sem modelo ligado → cai para pessoa.** Não silêncio, não texto genérico. "Pessoa" quer dizer `bot_paused = true`, `status='aguardando_nos'` e uma `tasks` com `priority 1` e `due_at = now()` — o mesmo que o menu já faz.

**As 8 que nascem cadastradas**[^6] (das 14 com `responde='texto_fixo'`): `PEDIU_TAXA_PRECO`, `E_ROBO`, `QUEM_E_VOCE`, `JA_CADASTRADO`, `MANDA_MATERIAL`, `INTERESSADO`, `SEM_INTERESSE_SUAVE`, `SEM_INTERESSE_FIRME`. Todas nascem com `robo_responde = false`; ligar é do Rafael, depois de ler (§12). **`PEDIU_TAXA_PRECO` fica desligada mesmo depois**, até a régua de custo fechar — §12.

As outras 6 de texto fixo caem para pessoa, cada corte com motivo: `OPT_OUT` tem dono; `AUTORIZA_PRE_CADASTRO` carrega link por ficha e exige `consent_events`; `AGENDAMENTO_ACEITO` e `REAGENDAR` precisam de data e hora reais; `NAO_E_A_PESSOA` precisa do nome da empresa; `INDICACAO` manda criar alvo novo com origem "indicação de [nome]" (`intencoes.ts:193`) — escrita na base tem um caminho só (ADR-08). As 7 de `ia` são texto escrito, que é outra fase; as 3 de `humano` são humanas por definição.

**O texto de `SEM_INTERESSE_FIRME` se despede e para.** Nada de "última chance", nada de contrapergunta: o PRD §12 (linha 635) manda confirmar a recusa uma vez, sem insistir. Quem escreve "não quero" com as palavras do opt-out já sai pela regra 1.

**Regra que fecha tudo: o robô não preenche variável.** `app.wa_bot_dizer` copia o texto cru; um `{{nome}}` sairia literal no fio. Por isso os 8 textos são escritos novos na migração, e não reaproveitados dos `GEN-SYS-*` do `seed.sql`, que têm `{{origem}}`, `{{empresa}}`, `{{email_encarregado}}`.

### 6.5 (c) Confiança

`LIMIAR_DE_CONFIANCA = 0.7` já existe (`decisao.ts:18`) e abaixo dele a intenção **já** vira `AMBIGUO` (`:234`). Esse 0,7 é o piso para *entender*. Falar sozinho pede mais.[^2]

- **≥ 0,85 → o robô fala.** Constante nova `LIMIAR_PARA_FALAR_SOZINHO = 0.85` no mesmo arquivo, exportada em `packages/prompts/src/index.ts`, espelhada em `app_settings.atendimento.confianca_minima` para o gestor subir sem deploy.
- **0,7 a 0,85 → classifica, registra, e quem responde é pessoa.** A intenção vale para o funil e para a ficha; não vale para falar.
- **< 0,7 → `AMBIGUO`**, e `escalarConversa` pausa o bot — agora antes da RPC.

`public.atendimento_configurar` (`20260922120000:215`) recusa `confianca_minima` abaixo de 0,7 e acima de 0,99. **Fora do `foreach`:** o laço percorre `array['lead_automatico','distribuicao_automatica','ausencia_ativa']` e recusa tudo que não for booleano, então `confianca_minima` ganha um ramo numérico próprio, antes do laço. `robo_responde` e `teto_robo_por_mes` entram no `array` (o segundo como número, no mesmo ramo numérico).

Não mexo em `decisao.escalar`. Quando qualquer motivo de escalada dispara (termo de alto valor, mensagem acima de 400 caracteres, VIP, hostil, pediu ligação), `montar()` (`decisao.ts:167`) já força `responde='humano'` — e nenhuma das 8 é `humano`, então a regra 9 não casa. O worker, por sua vez, já pausou o bot, o que prende a conversa na regra 4.

### 6.6 (d) Transparência e a palavra HUMANO

**Já é requisito nosso.** RF-CON-26 (PRD 359); R08 §5.5 repete. `GEN-SYS-TRANSPARENCIA` está no `seed.sql:1055` desde o D1 — **e nunca foi enviado por ninguém**. O mesmo vale para `GEN-SYS-E-ROBO` (`:1033`).

**A Meta exige a saída, não o aviso.** R04 §2.1 (linha 59): automação é permitida, e é obrigatório manter "caminhos de escalonamento rápidos, claros e diretos" para humano — a Meta testa os fluxos e rebaixa quem não oferece, com 7 dias para corrigir. O mesmo parágrafo registra que a exigência de *anunciar* que é IA aparece em blog e **não** foi localizada na política oficial. O aviso é regra nossa; a palavra HUMANO é regra da Meta. As duas entram.

**O texto da transparência** substitui o corpo de `GEN-SYS-TRANSPARENCIA`:

> Aviso rápido: aqui na Komune parte das respostas é automática, para você não ficar esperando. Quando quiser falar com uma pessoa do time, escreva HUMANO.

Sai **uma vez por conversa**, por `app.wa_bot_dizer(c.id, 'GEN-SYS-TRANSPARENCIA')`, imediatamente antes da primeira resposta automática do robô. Controlada por `conversations.transparencia_em`, coluna nova.

**A palavra**, regra 3 do árbitro, em `app.wa_pediu_humano(p_texto text)` — espelho de `app.wa_parece_optout` (`20260916110000:116`), com a mesma limpeza (`unaccent` + `lower` + colapso de espaço) e as mesmas duas regras: a palavra sozinha (`humano`, `atendente`, `pessoa`), ou a frase inequívoca em qualquer lugar ("falar com humano", "quero um atendente", "me passa para uma pessoa"). Faz três coisas numa transação: `bot_paused = true`, `tasks` com `priority 1` e `due_at = now()`, e **uma** resposta, pelo modelo novo `GEN-SYS-HUMANO-CHAMADO` (o `GEN-SYS-HUMANO-ASSUME` do `seed.sql:1051` não serve: tem `{{nome}}` e `{{hora}}`; e `GEN-SYS-HUMANO` da §5.4 é a despedida do freio, outro gatilho):

> Certo, já estou chamando uma pessoa do time. Nosso expediente é de segunda a sexta, das 8h às 17h45 — se for fora disso, alguém te responde na primeira hora útil.

Depois disso o árbitro para na regra 4 para sempre nessa conversa. Voltar o robô é ato humano, no botão que já existe.

### 6.7 (e) 24 horas

`app.pode_enviar` passo 2 já libera a resposta dentro das 24 h, e o comentário diz por quê. **Não toco nele** (a Fase 3 já o recriou por outros motivos; a definição final é a de `20260928120000`). O 24 h já estava liberado; o que faltava era ter o que dizer.

`GEN-SYS-AUSENCIA` promete "a gente responde assim que voltar". Com o robô respondendo às 22h, isso vira falso. O que acontece:[^7]

- **O corpo de `GEN-SYS-AUSENCIA` é reescrito; o código continua o mesmo.** Não nasce modelo novo e a chave `ausencia_ativa` continua `true`. `app.ausencia_responder` (`20260922120000:131`) procura o modelo por `template_code='GEN-SYS-AUSENCIA' and t.is_active` e usa o `id` dele como trava de 12 h; desativar o código mataria a função em silêncio, e `public.atendimento_configurar` escreve o `texto_ausencia` do gestor nesse mesmo `template_code`. Histórico não se perde: `messages.body` registra o que foi dito. Texto novo:

  > Recebi sua mensagem. Por aqui eu te respondo a qualquer hora, inclusive agora. Se precisar de uma pessoa do time, escreva HUMANO — o expediente é de segunda a sexta, das 8h às 17h45, e alguém te procura na primeira hora útil.

- **`GEN-SYS-FORA-HORARIO` (`seed.sql:1063`) vai a `is_active = false`.** É texto morto do D1 que promete a janela de 08–20 h e tem `{{previsao}}`.
- **Muda quando sai.** Não é mais "chegou mensagem fora do horário". É "o árbitro decidiu `pessoa` **e** `app.janela_do_canal` está fechada", no máximo uma a cada 12 h por conversa. No veredito `robo` nada disso sai; no `humano_pedido` também não, porque a resposta de §6.6 já diz o expediente e o `exists` da própria `ausencia_responder` devolveria `ja_respondida`.

### 6.8 (f) O desliga

```sql
select public.atendimento_configurar('{"robo_responde": false}'::jsonb);
```

Lida por `app.atendimento_liga('robo_responde')` (`20260922120000:30`). `false` faz o árbitro devolver `pessoa` nas regras 8 e 9 e não muda mais nada. A chave entra no `foreach` de `atendimento_configurar` — sem isso a função ignora em silêncio — e a migração **semeia `robo_responde: false`** em `app_settings`, porque `app.atendimento_liga` devolve `false` para chave ausente e a chave tem de existir para o gestor conseguir ligá-la pela tela.

Os outros três interruptores continuam separados: `public.wa_bot_ligar(false)` (menu), `atendimento_configurar('{"ausencia_ativa": false}')` (ausência) e `conversations.bot_paused` (uma conversa). Não encosto em `cadencia.modo_automatico`: o gatilho `zz_app_settings_modo_automatico` (`20260904001890:80`) recusa ligá-la, e é a trava do RF-CON-09.

### 6.9 Os freios de conteúdo e de volume

- **`app.texto_automatico_valido(text)`** é o validador de promessas em SQL, reduzido ao que um texto fixo pode errar: recusa `%` e `R$` cujo valor não esteja em `app.valores_autorizados` (tabela nova, semeada de `VALORES_AUTORIZADOS`, `packages/prompts/src/nucleo/base-conhecimento.ts:169`: 8%, 5%, 3%), recusa URL fora de `URLS_PERMITIDAS` (`:162`) e recusa os temas de `TEMAS_FINANCEIROS_SEM_RESPOSTA` (`:143`: mensalidade, escrow, repasse, nota fiscal, multa, imposto). Roda **no cadastro do modelo**, não a cada envio.
  **Isso reprova texto que já está no ar.** `GEN-SYS-MENU-1` (`20260916110000:58`) diz "não tem mensalidade nem adesão". A resposta rápida `custo` (`20260922120000:208`) diz o mesmo. `GEN-OBJ-TAXA-INFO` (`seed.sql:1053`) também. E `base-conhecimento.ts:36` registra, em 08/09/2026, que a frase **é falsa**. Corrigir os três entra nesta fase.
- **Teto por conversa:** o de §5.4 (`whatsapp.robo_teto.falas_por_conversa = 6`), lido pela regra 7 e imposto pelo guard.[^5]
- **Teto do mês:** `atendimento.teto_robo_por_mes`, padrão **900**, regra 7. **Conta conversas, não mensagens**, porque é assim que a Meta cobra: `count(distinct conversation_id)` entre as mensagens `bot_fixed` cujo `template_id` tem `robo_responde`, no mês corrente de Fortaleza. É aproximação por baixo, e por isso 900 e não 1.000: é freio, não contabilidade. Alerta em **70%** do teto, no mesmo lugar em que o orçamento de IA avisa.
- **Amostragem semanal (RF-CON-22):** view `public.robo_amostra_semanal` sobre `atendimento_decisoes` + `messages`, lida em Ajustes → Atendimento. Sem ela, ninguém descobre que o robô vem respondendo errado à mesma intenção há um mês — o validador pega promessa proibida, não pega resposta fora de contexto.
- **Não mexo no tempo de primeira resposta.** `public.relatorio_atendimento` (`20260922130000`) só conta `human` e `bot_ai`; `bot_fixed` já está de fora, de propósito.

### 6.10 (g) Testes

**pgTAP — `supabase/tests/71_o_robo_responde_sozinho.sql`:**

1. Opt-out ganha de tudo: "quanto custa? ah, e não me manda mais" com `PEDIU_TAXA_PRECO` a 0,95 → `optout`, nenhuma saída de robô; com item de campanha pendente, `botao_tocado` fica gravado.
2. Contato em `suppression_list` → `ninguem`, mesmo com modelo ligado e confiança 0,99.
3. Fora da base de conhecimento: `update` de um modelo com `robo_responde=true` e corpo "a mensalidade é R$ 49" → recusado pelo gatilho. Idem "12%" e link fora de `URLS_PERMITIDAS`.
4. `robo_responde=true` numa intenção cujo `intencoes.responde` não é `texto_fixo` → recusado.
5. Teto por conversa: sete chegadas em 24 h com intenção ligada → seis respostas, a sétima devolve `pessoa` e abre tarefa. Teto do mês em 1 → a segunda conversa do mês devolve `pessoa`.
6. HUMANO transfere: "humano" sozinho → `bot_paused=true`, uma `tasks` `priority 1`, exatamente uma saída, e a mensagem seguinte devolve `pessoa`.
7. Sem empate: mensagem com menu pendente **e** intenção classificada gera **uma** linha em `atendimento_decisoes` e uma só saída.
8. `aguardando_classificacao` é substituído uma vez; a terceira chamada de `app.wa_atender` não insere nada.
9. Confiança 0,80 com modelo ligado → `pessoa`. 0,86 → `robo`.
10. Transparência sai uma vez: duas respostas automáticas na mesma conversa, uma só `GEN-SYS-TRANSPARENCIA`, e `conversations.transparencia_em` preenchido.
11. Duas linhas de `message_templates` ativas com a mesma `intencao` e `robo_responde` → recusado pelo índice único.
12. `robo_responde = false` na chave-mestra → regras 8 e 9 devolvem `pessoa` e o menu continua respondendo.
13. RLS: `leitura` lê `public.intencoes` e `atendimento_decisoes` e não escreve em nenhuma; `sdr` não marca um modelo como `robo_responde`.
14. Um atendente responde sem pausar o bot → a classificação que chega depois devolve `pessoa` pela regra 4.

**Vitest:** `packages/prompts/evals/responder-sozinho.eval.test.ts` (novo) — `public.intencoes` semeada bate com `INTENCOES` e com `responde` de `FICHAS` (25 linhas, 14/7/3/1); `LIMIAR_PARA_FALAR_SOZINHO` maior que `LIMIAR_DE_CONFIANCA`; `app.valores_autorizados` bate com `VALORES_AUTORIZADOS`. `apps/workers/src/ia/tarefas.test.ts` — `classificarEntrada` chama `public.ia_gravar_classificacao` e não o `update` direto; `escalarConversa` roda **antes** da RPC; opt-out por regra continua sem chamar modelo. `apps/workers/src/whatsapp/entrada.test.ts` — a ordem grava → opt-out → áudio → classifica não mudou. `validador-promessas.eval.test.ts` — os 8 textos novos passam.

### 6.11 Arquivos

Três migrações (`20260929100000` o árbitro, `20260929110000` a resposta por intenção, `20260929120000` a transparência e as 24 h — **as três sobem na mesma transação de deploy**, e o drop dos gatilhos velhos está na mesma migração que cria o árbitro), uma RPC nova consumida pelo worker-ai, duas colunas em `message_templates`, uma em `conversations` (`transparencia_em`), duas tabelas novas (`intencoes`, `atendimento_decisoes`), um painel de Ajustes, um pgTAP, um Vitest novo e três existentes, e a emenda do RF-CON-11 no PRD. Nenhuma chamada de IA nova: `classify_inbound` já roda e o resultado não é usado — a Fase 4 só passa a usar o que já está pago.

---

## 7. O que entra de carona

A auditoria do benchmark achou 12 itens. **Oito** cabem dentro das fases, porque a peça de baixo já existe: falta ligar, não construir. Somam **3,75 dias**.

### 7.1 Fase 1 — filtrar por etiqueta, origem, temperatura e qualificação (item 2) — 0,5 dia

`public.search_organizations` (`20260911100000_a_lista_diz_o_que_o_contato_deu.sql:77`) tem nove parâmetros e nenhum de etiqueta, origem ou temperatura — ela já **devolve** `temperature`, só não filtra. Dois dos três já estão escritos: o envio em massa filtra por etiqueta com um `exists` em `public.organization_tags` (`20260921100000:178`) e por temperatura numa linha (`:172`). Origem é trivial: `organizations.source_id` é `not null` com índice, e a tela já carrega as 11 origens no mesmo `Promise.all` (`parceiros/catalogos.ts:65`).

**A migração precisa derrubar a assinatura velha:** `drop function if exists public.search_organizations(text, integer, integer, integer, uuid, app.org_kind, integer, integer, text)` antes do `create`. É o que a própria `20260911100000` fez e explicou na linha 68: duas `search_organizations` convivendo deixam o PostgREST escolher pelo conjunto de chaves do corpo.

**Por que na Fase 1:** o scraper devolve `nota` e `avaliacoes_qtd`, que a esteira promove a `organizations.rating` e `reviews_count` (`20260904001600:1145`, `:1151`). Depois do scraper a lista fica grande, e é assim que se escolhe quem recebe mensagem primeiro. Sem o filtro, o scraper entrega um palheiro.

**O quarto filtro é um sim/não, de propósito.** `p_qualificado boolean`, não duas caixinhas. Ligado, exige `rating >= radar.triagem.nota_minima` e `reviews_count >= radar.triagem.avaliacoes_para_valer` — os dois já em `app_settings`, padrão 4,0 e 10, os mesmos da triagem (`20260922150000:44–45`, `:59–69`). Duas caixinhas convidam alguém a imprimir o número ao lado; um sim/não não vaza nota nenhuma. **Nenhuma tela mostra o número** — §10.

### 7.2 Fase 2 — de qual anúncio veio o lead (item 6) — 0,5 dia

`wa-webhook/extrair.ts` lê `value.messages[]` (`:211`), `message_echoes[]` (`:242`) e `statuses[]` (`:270`). Não lê `messages[].referral` — a palavra não aparece no repositório. Guardamos quatro campos e só eles: `source_id` (id do anúncio), `source_type`, `ctwa_clid` e `headline`. Nada de `image_url`, `video_url` ou `body`. `headline` é exceção porque é o título do **nosso** anúncio.

Coluna nova `public.conversations.anuncio jsonb`, escrita só quando está nula (o primeiro referral do fio vence; webhook reentregue não reescreve). **A whitelist das quatro chaves vira `check` na coluna, não só um `if` em TypeScript** — senão a quinta chave entra num deploy de sexta. Passa por um parâmetro novo em `app.wa_registrar_entrada` (`20260915120000:118`), que esta fase já toca.

### 7.3 Fase 2 — mídia no WhatsApp (item 5) — 1 dia

Pior do que "não manda": `entrada.ts:56` define `TIPOS_DE_VOZ = {audio, voice}` e só baixa mídia desses dois (`:281`). Para imagem e PDF, o `media_id` é gravado e o arquivo nunca é baixado — a URL da Meta expira e o cardápio vira id morto. Na saída, `formaDoEnvio` (`saida.ts:93`) conhece texto, áudio, template e interactive.

`app.msg_type` já tem `image`, `video` e `document` (`20260904000100:84`); o balde privado, o download, `public.wa_midia_registrar` (`20260905000201:772`) e `ctx.graph.subirMidia` já existem para áudio. É generalizar. Retenção já resolvida: `media_path` e `media_id` são zerados aos 365 dias (`20260905000200:2347`).

**Escolha: entrada automática, saída só manual.** O robô nunca anexa arquivo. Anexo é de gente, com nome de quem enviou. O botão vai ao lado do de gravar áudio (`conversas/responder.tsx:287`).

### 7.4 Fase 2 — visão do supervisor (item 4) — 0,25 dia

O painel existe: `public.relatorio_atendimento` (`20260922130000:19`) já dá tempo de primeira resposta, conversas por atendente, conversão por etapa e motivos de perda. O que o benchmark achou é o contrário: o SDR vê conversa de todo mundo, porque `app.sees_all()` (`20260904000500:46`) inclui `sdr` e `conversations_select` a usa. Não é bug — é a decisão de 14/09.

O que entra: a aba "Meu setor" já existe (`20260922100000:34`, `:69`) e passa a ser o recorte **padrão** de quem é `sdr`, com "todas" a um clique. Zero migração, zero mudança de RLS. Mudar a RLS é §8.7.

### 7.5 Fase 3 — a conversão aparece na coluna do kanban (item 1, primeira metade) — 0,5 dia

`public.pipeline_board` devolve `total` por etapa e nenhuma conversão. A definição viva é a de **hoje**: `20260924120000_sem_valor_no_negocio.sql:37` — é essa que se edita, não a original de `20260904000900:187`. A conta já existe em `public.relatorio_funil` (`20260904001400:728`), por coorte: base são os negócios que **nasceram** no período, e conta-se quantos já alcançaram aquela etapa ou uma adiante. É assim porque etapa é pulada o tempo todo e a primeira versão devolvia 300%.

Duas decisões que faltavam: **coorte fixa de 90 dias**, sem parâmetro novo (o caminho até Publicado passa por etapas com SLA de 720 h, `seed.sql:525`, e 30 dias deixaria as últimas colunas com denominador perto de zero); e **quem vê** — `relatorio_funil` levanta exceção para quem não passa em `app.sees_all()` (`:771`) e `pipeline_board` é lida também pelo `embaixador`, então o campo volta **nulo** e o cabeçalho não imprime a linha. Um campo no objeto de etapa e uma linha em `funis/coluna.tsx` (`ContagemDaEtapa`, `:55`, usado em `:114`, `:192` e em `quadro-trilha.tsx:66`).

### 7.6 Fase 3 — campanha e saúde do número (item 9) — 0 dias

As duas falhas confirmadas são exatamente §5.2 e §5.3. Registrado aqui só para fechar o benchmark.

### 7.7 ~~Fase 4 — a agenda já está ligada no Google (item 7)~~ — **REVOGADA em 25/09/2026 (ADR-15)**

Esta seção mandava a Fase 4 chamar `/api/agenda/evento` com a tarefa que o robô tivesse criado. **Essa rota não existe mais**, e nem o `google-dados.ts`, nem o escopo `calendar.events`, nem `agenda_google_estado`, nem o guia de operação: a emenda B.8 apagou tudo, com as duas tabelas, as nove funções em `app`, os nove invólucros em `public` e os segredos do Vault.

O que a Fase 5 entregou no lugar, e é o que a Fase 4 chama: **`public.reuniao_horarios(conversation_id, limite)`** e **`public.reuniao_marcar(conversation_id, inicio, formato, observacao)`** — as duas únicas funções da fase com `grant` para `service_role` no caminho de escrita. A primeira devolve `quando_por_extenso` pronto; a segunda devolve `link`, `estado`, `precisa_confirmacao` e, quando recusa, `alternativas` no mesmo retorno. Ver seção B.

### 7.8 Fase 4 — o cartão anda quando a Komune avisa (item 1, segunda metade) — 0,5 dia

O catálogo já está no banco: **19 eventos**, de `supplier.claimed` a `deal.first` (`20260904001810:508–526`), e `public.komune_webhook_aplicar` (`:963`) aplica cada um com dedup por `delivery_id`. **Nenhum move cartão** — `app.komune_aplicar_evento` não escreve em `public.deals`. O motor genérico de `stages.automations` não existe e não vou construir (§8.6).

**Um gatilho que faz as DUAS coisas que o seed declara:** (1) `supplier.published` fecha o negócio de **captação** — `fornecedor` → etapa `publicado`, que é `is_won` (`seed.sql:494`), como o próprio seed escreveu (`:491`); (2) abre o de **ativação** (`:498`). Fazer só a (2) deixa o negócio de captação preso em "Em curadoria" para sempre e todo número de ganho conta errado.

**Como:** não por `public.move_deal` (`20260905000800:201`), que exige `auth.uid()` e o webhook roda como `service_role`. É função em `app` escrevendo `public.deals` e `public.deal_stage_history` direto, como o resto de `app.komune_aplicar_evento` já faz, com autoria `'sistema'` — **idempotente por (organização, funil)**, porque reentrega legítima tem outro `delivery_id` e o dedup do webhook não cobre isso.

### 7.9 Fase 4 — o SDR de IA (item 8) já herda quase tudo

Não é carona: é a própria Fase 4. **Já existe:** as 25 intenções com `responde`, e `humano` **já roteia** (`tarefas.ts:598` chama `escalarConversa`); tarefas, agenda e Google (§7.7); os campos de qualificação (§7.1). **Ainda não existe, apesar de parecer que sim:** `draft_reply`, `next_action` e `summarize_deal` estão **autorizados** na fila (`check` de `ai_runs`, `20260917100000:361`; porteira `app.ia_enfileirar`, `:368`) mas o mapa `TRABALHOS` (`tarefas.ts:993`) tem sete entradas e nenhuma das três — enfileirar hoje devolve propósito desconhecido. Escrever esses handlers é a fase seguinte, não esta.

### Ordem de corte

Se o prazo apertar, corto de cima para baixo: conversão na coluna (§7.5) · mídia que sai, metade de §7.3 · de qual anúncio veio (§7.2). Devolve 1,5 dia. **Não corto:** o filtro de qualificação (sem ele o scraper vira palheiro), a mídia que chega (arquivo perdido não volta) e o gatilho do `supplier.published` (sem ele o funil de captação nunca fecha como ganho).

---

## 8. O que fica para depois

### 8.1 Instagram Direct (item 10) — 4 a 6 dias. Não agora.
O enum `app.channel` já tem `instagram` (`20260904000100:74`) e o desfecho `instagram_dm` existe (`20260904001100:135`), mas os dois são para **registro manual de atividade**: não há webhook, caixa nem envio. Depende de aprovação da Meta para `instagram_manage_messages` (semanas), da conta ligada ao Business Manager, de webhook novo e de janela nova — a etiqueta do Instagram não é a regra das 24 h, ou seja, outra versão de `app.pode_enviar`. **Gatilho numérico:** a Fase 1 mede a fatia de candidatos do scraper com `phone_e164` nulo (flag `sem_contato`, `20260904001401:176`). Abaixo de 15%, não vale. De 15% para cima, vira projeto logo depois da Fase 4.

### 8.2 Onboarding do cadastro até a 1ª venda (item 12) — 5 dias. Depende do lado Komune.
`supabase/seed.sql:525–569` cria as sete etapas de `ativacao` com cadências declaradas. Nada as preenche. A Fase 4 abre a porta (§7.8). O resto precisa de (1) a Komune emitir `supplier.profile_100`, `lead.first` e `deal.first` — já traduzidos aqui (`20260904001810:515`, `:522`, `:526`) — e (2) mais cinco gatilhos escritos à mão. **Escolho os gatilhos, não o motor genérico** (§8.6).

### 8.3 Carteira fixa (item 3) — 1 dia. É decisão, não esforço.
O dono do **negócio** já é fixo: `deals.owner_id` não muda, e o comentário de `app.messages_quem_responde_atende()` (`20260914100000:842`) diz isso. O que flutua é a **conversa**: o gatilho (`:847`) passa `assignee_id` para quem respondeu, e `public.assumir_conversa` (`:854`) deixa qualquer um assumir. Foi feito assim em 14/09. Carteira fixa = desligar esse gatilho. Decisão do Rafael (§12).

### 8.4 Relatório mensal (item 11) — 1 dia, não 0,25. Sai da carona.
O gerador é **semanal por dentro**: `public.relatorio_semanal_gerar(p_semana_inicio date)` (`20260905000700:852`) recebe uma segunda-feira; `app.relatorio_semanal_fatos` (`:307`) força `date_trunc('week')` e compara com os 7 dias anteriores (`:315–318`); `public.weekly_reports` tem `on conflict (semana_inicio)` (`:837`). Reaproveitável só `app.relatorio_semanal_numeros(p_de, p_ate)` (`:211`). E o ganho é pequeno: `relatorios/periodo.ts:29–30` já tem "Este mês" e "Mês passado", com CSV e XLSX. Falta o e-mail chegar sozinho no dia 1º. **Sem PDF**, aí e depois.

### 8.5 ~~Ler livre/ocupado no Google (item 7, o resto)~~ — **SEM OBJETO desde 25/09/2026 (ADR-15)**
A objeção continua válida e ficou irrelevante: não há mais o que ler no Google. O CRM calcula o próprio livre/ocupado em SQL, por `app.reuniao_horarios_livres` — dia útil, antecedência, horizonte, colisão com outra reunião, rota da tarde, tarefa de campo e teto diário. Nem OAuth novo, nem três horários fixos: a grade é de verdade e é a mesma para pessoa e robô.

### 8.6 Motor genérico de automação de etapa (RF-FUN-05) — não vale a pena.
`stages.automations` é declarativo e o comentário da coluna (`20260904000300:298`) diz que "o motor chega no D5–D7". Não chegou, e fora dos tipos gerados nada lê a coluna. JSON como código dentro do banco, sem tipo, sem teste e sem stack trace — cinco gatilhos nomeados são mais fáceis de ler, testar e apagar.

### 8.7 Restringir o que o SDR enxerga (item 4, o resto) — 1 dia, decisão do Rafael.
Tirar `sdr` de `app.sees_all()` quebra o atendimento em equipe de 22/09. O recorte padrão de §7.4 resolve o incômodo sem mexer na RLS.

### 8.8 O robô negociar condição comercial — fica de fora para sempre.
A base de conhecimento é fechada, o validador recusa o que não está nela, e dúvida financeira sem resposta vira "vou confirmar com o financeiro". A oferta vincula (CDC art. 30): o que o robô promete obriga a KOMUNE. PRD §12 (635) e R06 (`:128`).

### 8.9 A resposta ao botão assinada como gente — 0,5 dia, depois.
`app.envio_resposta_ao_botao` insere `author_kind='human'` com `sent_by = e.criado_por` (`20260921110000:634`). Consertar exige acrescentar `messages.envio_item_id` e **afrouxar** o ramo `bot_fixed` do `messages_guard` para aceitá-lo — e esta spec não afrouxa o guard.[^1] O caminho está dormente desde 22/09 (os três convites com botão em `is_active=false`), então o volume é zero. Quando for feito: só o insert novo, nunca reescrever mensagem antiga.

### O que foi recusado, e por quê

**CPF no CRM.** ADR-09, com três camadas de código: `app.payload_e_permitido` recusa, em qualquer profundidade, chave que case `cpf|pix|conta_banc|conta_corrente|cartao|agencia|banco|iban|rg_|cnh` (`20260904001600:158–159`); o RF-RAD-16 descarta CPF por regex com dígito verificador antes de virar candidato; e a constraint `organizations_custom_sem_dados_sensiveis` (`20260904000300:55`). Fica assim.

**BSP intermediário (Kapso e semelhantes).** ADR-06. Um BSP no meio significa um terceiro lendo toda mensagem de fornecedor, custo por mensagem em cima do da Meta, e `app.messages_guard` deixando de ser a última palavra. E não há limite a contornar: a Meta já libera 2.000 conversas novas por dia; o R04 (`:55`) diz que, no nosso volume, até 250 sobrariam.

**Base de 8 mil da bilheteria.** *Finalidade:* coletada para bilheteria; prospectar fornecedor é finalidade nova, fora da LIA e da retenção — o PRD §13 item 22 já recusou "database marketing". *Separação:* o ADR-02 criou o projeto separado para não misturar bases com base legal diferente. E não escoa: a 45 aberturas por dia útil, 8 mil contatos levam mais de oito meses.

**Aparato de call center.** Discador, CTI, AMD, posição de atendimento, gravação com escuta, painel de TMA/TMO. Recusa no PRD §13 item 22: não há telefonia no produto, e gravar é tratamento novo da voz do fornecedor somado a monitoramento de empregado, contra ADR-05, ADR-06 e RF-AST-06. No mesmo pacote ficaram recusados o motor de retentativa de discagem (RF-FUN-13) e "lote de discagem" como unidade de trabalho.

---

## 9. Ordem e esforço

| Fase | O que entrega | Migrações | Dias | Como desligar se der errado |
|---|---|---|---|---|
| **1. O CSV do Maps entra** | fonte `google_maps_raspado`, payload de 15 campos, `app.endereco_br`, prévia que enxerga `place_id`, mapa de categorias, seletor de origem do lote, teste 66. **+ carona §7.1** | `20260924130000_o_csv_do_maps_entra_pela_importacao.sql` · `<nova>_a_lista_filtra_por_etiqueta_origem_e_nota.sql` | 3 + 0,5 | `public.esteira_desfazer_lote` dentro de 48 h desfaz o lote inteiro; `update public.sources set config = config - 'entrada_por_arquivo' where slug='google_maps_raspado'` tira a fonte do seletor. Nada mais depende dela. |
| **2. O Radar desliga** | 5 fontes em `is_enabled=false`, `worker-ingest` em `count 0` e depois destruído, 3.925 linhas apagadas, `/radar` → `/revisao` com 308, saúde dos workers em Ajustes. **+ carona §7.2, §7.3, §7.4** | `20260929130000_o_radar_desliga_a_revisao_fica.sql` · `<nova>_de_qual_anuncio_veio.sql` | 2 + 1,75 | Antes da tesoura: `update ... is_enabled = true` e `fly scale count 1`. Depois: `git revert` e recriar o app do Fly — por isso os **sete dias** entre uma coisa e outra. |
| **3. O freio** | orçamento que recusa chamada, `wa_saude_numero` + teto da Meta, aquecimento contando aberturas, teto de fala do robô. **+ carona §7.5** | `20260928100000` · `20260928110000` · `20260928120000` · `20260928130000` · `<nova>_a_coluna_mostra_a_conversao.sql` | 3 + 0,5 | Cada peça é `app_settings`: subir `ia.orcamento.mensal_usd`, subir `cadencia.tetos.whatsapp.depois`, subir `whatsapp.robo_teto.falas_por_conversa`. Nenhuma exige deploy. Tabela de saúde vazia = nada muda. |
| **4. O robô responde** | árbitro único, `public.intencoes`, 8 modelos por intenção, HUMANO, transparência, ausência reescrita, amostragem semanal. **+ carona §7.7, §7.8** | `20260929100000` · `20260929110000` · `20260929120000` (mesma transação de deploy) · `<nova>_o_publicado_fecha_e_abre.sql` | 5 + 1,0 | `select public.atendimento_configurar('{"robo_responde": false}')` — o árbitro devolve `pessoa` e o menu continua. Por intenção: `update public.message_templates set robo_responde=false where intencao='X'`. Por conversa: `bot_paused`. |
| **Total** | | 9 migrações novas + 4 da carona | **13 + 3,75 = 16,75** | |

Numeração de teste pgTAP, para não colidir:[^4] **66** o CSV do Maps · **67** o freio do orçamento · **68** a saúde do número · **69** o teto de aberturas · **70** o teto de fala do robô · **71** o robô responde sozinho. Apagados na Fase 2: **37** e **54**. Editados: **14**, **16**, **21**.

**A ordem não é negociável em dois pontos.** A Fase 2 depende da Fase 1 (a whitelist só pode perder a cópia do worker depois que a esteira do CSV estiver de pé). A Fase 4 depende da Fase 3 (ligar resposta automática sem freio de gasto, sem leitura de qualidade do número e sem teto de fala é ligar o que ninguém consegue ver).

---

## 10. O que não pode cair

| Guardrail | Onde vive | Se cair |
|---|---|---|
| **Opt-out por regra antes de qualquer modelo** | `detectarOptOut` em `apps/workers/src/ia/tarefas.ts:545` e `apps/workers/src/whatsapp/entrada.ts` (passo 2, `return` na linha 281); `app.wa_parece_optout`; regra 1 do árbitro | quem escreveu "SAIR" vira chamada paga e pode receber venda automática — denúncia na Meta e rebaixamento do número |
| **Conferência de supressão no momento da entrega** | `app.wa_motivo_de_recusa` (passo 1 de `app.pode_enviar`), reconferência em `app.wa_proximos` (`20260917130000:58`) e `public.wa_saida_proximos` (`20260921110000:767`); `alvoEstaSuprimido` em `execucao.ts:178`, **antes** do freio de orçamento | o "sair" que chega nos cinco minutos da fila é atropelado; a supressão vira enfeite |
| **Proveniência campo a campo** | `public.field_provenance` (`20260904001600:449`), gravada em `app.resolver_source_record` (`:969–983`) para `name`, `phone_e164`, `email`, `website`, `address`, `neighborhood` e `place_id` | "de onde vocês tiraram meu número?" vira "fontes públicas" — que é literalmente o que multou a KASPR |
| **Whitelist de campos nos dois lugares** | `app.payload_e_permitido` (`:141`) + constraint `raw_capture_payload_na_whitelist` (`:325`); do lado de fora, `app.importacao_normalizar` monta o payload (e, até a Fase 2, `apps/workers/src/ingest/whitelist.ts`); e o `check` das 4 chaves de `conversations.anuncio` (§7.2) | entra foto, texto de avaliação e CPF na base; uma chave fora da lista reprova o payload **inteiro**, e o erro aparece como "a importação toda falhou" |
| **CPF fora da captura** | `app.sem_cpf` passa a varrer `endereco` e `bairro` **antes** do payload (§3.2), porque `raw_capture` guarda o payload cru | CPF de MEI fica guardado em `raw_capture.payload` com retenção de coleta, fora do alcance do gatilho que limpa |
| **Nota e avaliações são número interno, nunca tela** | RF-RAD-04; comentário em `20260904000300:65`; o filtro de §7.1 é sim/não | perdemos a única exceção que o R06 SCR-02 nos deu, e ela ainda está com o advogado (PRD §13 item 10) |
| **Tetos de primeiro contato** | `app.teto_do_canal` + `app.aberturas_do_dia` (passo 5) e `teto_iniciadas_dia`/`_hora` (passo 6) | o número queima em uma semana e não há plano B, porque não há BSP no meio |
| **Base de conhecimento fechada no assunto Komune** | RF-CON-23; `app.texto_automatico_valido` no cadastro do modelo; `packages/prompts/src/nucleo/base-conhecimento.ts` | o WhatsApp da KOMUNE vira assistente de propósito geral — banido pelos termos da Meta desde 15/01/2026 (`docs/anexos/R04-whatsapp-automacao.md:59`), e conta encerrada não se recria sem permissão expressa |
| **Caminho de escalonamento humano rápido e claro** | `app.wa_pediu_humano` + `GEN-SYS-HUMANO-CHAMADO` (§6.6); a despedida `GEN-SYS-HUMANO` do freio (§5.4) | a Meta testa os fluxos sozinha e rebaixa quem não oferece, com 7 dias para corrigir |
| **Nada redigido por IA sai sem rascunho aprovado (ADR-05, forma nova)** | `app.messages_guard`, ramo `bot_ai` — **não muda uma linha nesta spec** | o robô escreve promessa comercial e manda; a oferta vincula (CDC art. 30) |
| **O guard só é tocado para apertar** | única alteração: o ramo de teto de fala em §5.4 | um ramo novo mal colocado, antes do retorno da confirmação de opt-out, cala quem pediu para sair |
| **O robô não preenche variável** | `app.wa_bot_dizer` copia o texto cru; os 8 textos são escritos sem `{{ }}` | um `{{nome}}` sai literal no fio para centenas de pessoas |
| **Pré-cadastro só depois de autorização** | `consent_events` + Edge Function `crm-pre-registration` com HMAC, do lado da Komune | cadastro de terceiro sem base legal registrada |
| **Auditoria de tudo que custa** | toda chamada, inclusive a que não saiu, vira linha em `ai_runs` (`status='bloqueado'`, custo zero); `audit_log` e `pii_access_log` | no fim do mês ninguém sabe se o freio funcionou ou se a IA só parou de ser chamada |
| **Caminho único de escrita para a base (ADR-08)** | `app.promover_candidato` é o único `insert` em `organizations` vindo de importação; o árbitro não cria ficha (quem cria é `app.lead_automatico`, `20260922110000:198`); uma porta só na fila de IA (§5.1, item 3) | dedup, higiene de CPF, proveniência, temperatura e desfazer de 48 h param de valer todos de uma vez |
| **Curadoria humana (RF-RAD-11)** | `public.radar_revisar_candidato` | ficha nasce sem decisão de gente, e o funil enche de lugar que ninguém olhou |

---

## 11. Riscos

| # | Risco | Mitigação |
|---|---|---|
| 1 | Bloqueio de IP ou CAPTCHA permanente na máquina que raspa | É a consequência esperada e assumida (ADR-12). A regra é **parar e avisar**; insistir com proxy ou login transforma quebra de contrato em acesso não autorizado. Efeito prático: a lista para de crescer no meio de uma rodada, o CRM não quebra. Revisão do ADR no segundo bloqueio. |
| 2 | Uma chave fora da whitelist reprova o payload **inteiro**, sem erro por campo — o CSV do kit traz colunas que não estão na lista | Mapeamento coluna a coluna explícito, nunca `spread` do CSV. `linhaParaObjeto` só copia campos de `TODOS_OS_CAMPOS`. Teste pgTAP 4 (payload com `facebook` → recusado) e Vitest de `sugerirMapa`. |
| 3 | Dedup fraca do candidato raspado: sem CNPJ, sobra celular (0,95), domínio (0,90) e nome por trigram (0,85) | `place_id` (o `cid`) vira `external_id` e chave de sonda na prévia (§3.2, itens 3 e 4), o que cobre o caso comum. Parceiro que trocou de número e tem site em hospedagem compartilhada cai na fila de revisão com as sugestões em `payload->duplicatas` — é decisão de gente, que é o RF-RAD-11. |
| 4 | `app.endereco_br` é regex sobre um formato que o Google não garante (MEI em casa, endereço sem número, rodovia) | A regra devolve **nulo onde não casou, nunca palpite** (§3.2, item 1). Ficha sem bairro estraga a rota de visita, não a ficha. Teste pgTAP 1 com os quatro formatos. |
| 5 | Categoria do Maps é texto livre e muda sem aviso — 600 linhas podem chegar todas em revisão e parecer que a importação falhou | O mapa de §3.3 cobre as 12 categorias que o Maps devolve em Natal; o resto vai para revisão **com o motivo escrito** (`categoria_desconhecida`), e o recibo diz quantas são. O conserto do ramo de UPDATE (§3.2, item 5) faz a segunda raspagem gravar a categoria que faltava, em vez de deixar a linha presa. |
| 6 | Substituir `esteira_processar_captura` e `importacao_previa` inteiras (é `create or replace` de função grande) arrisca perder uma linha na transcrição — as duas são caminho crítico de **toda** importação | Os consertos são estreitos e nomeados (quatro campos no ramo de UPDATE; uma chave na sonda). `16_esteira_de_ingestao.sql` (125 asserções) e `22_importacao_de_planilha.sql` ficam **intocados** e são a rede: se a planilha-ponte quebrar, o CI acusa antes do deploy. |
| 7 | O CSV fica na pasta do operador entre a raspagem e a importação: base de dados pessoais sem RLS, sem retenção, sem auditoria | O passo 7 do roteiro (§3.4) manda apagar, e é disciplina humana — assumido. Limitado por construção: 600 linhas por rodada, 2 rodadas por semana, pasta em `.gitignore`, porta presa em `127.0.0.1`. |
| 8 | `external_id` passar a ser `place_id` muda a identidade de linhas do Maps importadas antes desta migração | Não há nenhuma: a fonte nasce nesta migração. Se alguém tiver importado lugares do Maps rotulando o lote como `planilha`, essas linhas reaparecem como fichas novas na primeira raspagem — e a prévia as mostra como `duplicata` por telefone antes de gravar (§3.2, item 4). |
| 9 | O CI quebra no primeiro PR da Fase 2 se o `update ... is_enabled = true` não entrar em `16_esteira_de_ingestao.sql` (antes da 148) e `21_coletor_do_radar.sql` (antes da 161) — no 16 o `batch_id` da 155 alimenta `pg_temp.ids` e a falha vira dezenas de asserções vermelhas | As duas linhas entram no **mesmo PR** do `update` de produção e da troca em `seed.sql`. Item explícito do checklist de §13, Fase 2. |
| 10 | Esquecer `supabase/seed.sql:191` (`is_enabled = excluded.is_enabled`): o próximo `supabase db reset` religa as cinco fontes em silêncio | Trocar o literal `true` por `false` nas linhas 126, 131, 146, 151 e 156, no mesmo PR. Critério de pronto: um `db reset` local devolve o mesmo `select slug, is_enabled` de produção (§13). |
| 11 | Desligar `instagram` por engano: `radar_criar_candidato`, `quick_create_organization` e o select de `parceiros/catalogos.ts:35` passam a recusar, e a curadoria manual do Instagram morre calada | A spec desliga **cinco** fontes, nominalmente, e `instagram` e `google_places` ficam ligadas (§4.1). Critério de pronto 1 de §13 confere as oito. |
| 12 | Apagar `buscarSaudeDaEsteira` junto com `painel-coletor.tsx` deixa o CRM sem nenhuma superfície que diga se um worker está de pé — justo antes de o robô responder 24 h | Os três tipos e a função **mudam de casa** para `components/admin/`, e a linha entra em Ajustes → Atendimento (§4.3). Critério de pronto 5 de §13. |
| 13 | Dropar as três funções do Radar sem rodar `supabase gen types`: `database.types.ts` ainda declara `radar_agendar_coleta` (7790), `radar_alternar_fonte` (7799), `radar_coletar_agora` (7803), e o typecheck passa com tipo fantasma | `supabase gen types` é passo obrigatório do PR, listado em §13, Fase 2, item 6. |
| 14 | O rename deixar para trás algum dos ~20 arquivos que citam Radar — em especial `meu-dia/estados.tsx:56` e `painel-fontes.tsx:184-198`, que oferece "Ver as fontes no Radar" para uma aba que não existe mais | A varredura é `grep -rn "Radar" apps/web/src` e a lista está em §4.3, arquivo e linha. O redirect 308 salva o link; não salva o texto. |
| 15 | Destruir `triade-worker-ingest` antes dos sete dias: voltar atrás deixa de ser `fly scale count 1` e passa a ser recriar app, refazer `fly secrets` e deploy sobre código já apagado | Os sete dias são regra escrita (§4.1) e o `destroy` é item separado do checklist, no oitavo dia. |
| 16 | Recriar `app.pode_enviar` três vezes (peças b, c e a versão final) — é a porteira de todo envio, tem 6 passos, e nenhuma migração posterior a `20260905000200` a tinha tocado. Uma ordem de passos errada libera envio a número restrito ou trava a operação inteira | A versão final vive numa migração só (`20260928120000`), e os testes 68 e 69 cobrem os dois conjuntos de passos juntos, na mesma base. |
| 17 | O teto de aberturas derruba a campanha de recontato de 150/dia para 45/dia sem ninguém pedir; lote em andamento desacelera de um dia para o outro | Subir a migração fora de janela de campanha, ou Rafael sobe `cadencia.tetos.whatsapp.depois` antes (§12). O motivo devolvido é `teto_do_numero`, que `app.envio_motivo_de_espera` já trata como espera: o lote **dorme**, não perde ficha. |
| 18 | O teto passa a ser do time inteiro sobre a mesma cota: num dia de muita negociação aberta, a campanha pode não andar e a causa não é óbvia na tela | É como a Meta conta, e está dito em §5.3. O motivo `teto_do_numero` aparece no lote; a linha de saúde do número (peça b) dá o outro lado. |
| 19 | O bloqueio de orçamento em `app.ia_enfileirar` faz o resumo de ligação (dentro da transação de `tabular_tentativa`) ser **perdido**, não adiado | Recusa sem `raise`, devolvida em `resumo_enfileirado`/`resumo_motivo` — a tela mostra. Os crons `ia_enfileirar_analises` e `ia_enfileirar_pulso` simplesmente pulam a rodada e tentam depois. |
| 20 | Apontar `enfileirarTrabalho` para `ia_fila_enfileirar` muda o payload da fila; sem `chave` explícita, `chaveDaMensagem` cai no `msg:<id>` e a idempotência muda de forma no meio do caminho | `p_payload: { ...payload, chave }` é obrigatório, e `fila.test.ts` afirma isso. |
| 21 | O vocabulário de `phone_number_quality_update` e `account_update` é da Meta e muda sem aviso — o teste de hoje usa `event: 'FLAGGED'`, que não está na documentação atual | `wa_saude_numero` guarda o `value` **inteiro** em `payload jsonb`: se o nome mudar, o dado fica e só a leitura precisa de conserto. Tabela vazia ou vocabulário desconhecido → `teto_dia = null` → nada muda. |
| 22 | `app.wa_bot_pode_falar` chamada de dentro do `messages_guard` (BEFORE INSERT) entra no caminho crítico de gravar mensagem | As três consultas são por `conversation_id` e usam `messages_conv_idx`, que já existe. Só roda para `author_kind in ('bot_fixed','bot_ai')`. |
| 23 | Resposta dupla na virada da Fase 4: janela em que os gatilhos velhos e o `messages_atender` novo coexistem | As três migrações sobem na **mesma transação de deploy**, e o `drop` dos velhos está na mesma migração que cria o árbitro (§6.11). |
| 24 | Escalada tardia: o worker-ai leva segundos ou minutos; nessa janela uma pessoa pode ter respondido na caixa sem pausar o bot, e o robô fala por cima | A regra 4 olha também o carimbo de `app.messages_quem_responde_atende`, não só `bot_paused` (§6.3). Teste pgTAP 14. |
| 25 | Worker de IA atrasado: se a janela de 24 h fechar entre a chegada e o processamento, a resposta sairia como modelo `service` fora da janela e a Meta recusa (131047) | Conferência de `app.janela_de_24h_aberta` **no momento do envio** (regra 9) e reconferência em `app.wa_proximos`. Fora da janela o robô não tenta: abre tarefa. |
| 26 | Duas respostas automáticas na mesma chegada (menu em linha + robô de intenção pela fila) | O árbitro é o único caminho, `public.atendimento_decisoes` tem `message_id` como PK, e `aguardando_classificacao` é o único valor substituível, uma vez só. Teste pgTAP 7 e 8. |
| 27 | Piso de confiança baixo para texto que sai sem ninguém ler: uma classificação errada manda a resposta de taxa a quem perguntou outra coisa, e a oferta vincula | Piso de **0,85** para falar (§6.5), separado do 0,7 de entender.[^2] Amostragem semanal obrigatória (§6.9). |
| 28 | Texto automático errado escala 24 h por dia: um texto ruim responde errado a centenas antes de alguém olhar. O validador pega promessa proibida, não resposta fora de contexto | Leitura e aprovação dos 8 textos pelo Rafael antes de `robo_responde = true` (§12); amostragem semanal; e cada intenção desliga sozinha com um `update`. |
| 29 | Classificar cada mensagem recebida multiplica `classify_inbound` pelo volume de entrada — que é o que o scraper existe para aumentar. O produto dos dois não foi medido | O freio de orçamento da Fase 3 existe exatamente para isso, e `classify_inbound` é um dos dois propósitos que sobrevivem até o teto. `public.ia_orcamento_status()` passa a devolver `freado` e `parados`. |
| 30 | Mensagem de serviço paga desde 01/10/2026, 1.000 grátis por número: robô 24 h com a campanha aberta pode furar a faixa sem ninguém perceber (hoje são 51/mês) | `public.wa_servico_do_mes` mede desde a Fase 3; teto de 900 conversas com alerta em 70% na Fase 4 (§6.9). Quando o teto bate, o robô cala **para todo mundo** até o dia 1º — por isso o alerta em 70%, e por isso 900 e não 1.000. |
| 31 | `app.wa_pediu_humano` com as palavras soltas `pessoa` e `atendente` dispara em frase legítima ("sou a pessoa que cuida disso") | Falso positivo é barato: pausa o bot e abre tarefa. Medido no pgTAP com frases reais da caixa **antes** de ligar; se for frequente, cai a regra da palavra sozinha e ficam só as frases inequívocas. |
| 32 | Prometer "escreva HUMANO" antes de a regra existir | A frase de transparência e `app.wa_pediu_humano` sobem na **mesma migração** (`20260929120000`). Nenhuma das duas antes da outra. |
| 33 | A emenda do RF-CON-11 abre precedente: é o segundo requisito que o código contradiz e a spec corrige depois do fato | A correção entra no mesmo PR da fase, com data e nome de quem decidiu (§2.4). Se virar hábito, o PRD deixa de ser fonte da verdade — registrado aqui de propósito. |
| 34 | `search_organizations` sem `drop` antes do `create`: duas funções com o mesmo nome e o PostgREST escolhendo pelo conjunto de chaves do corpo, com a lista devolvendo a base inteira | `drop function if exists` com a assinatura de 9 argumentos, explícito na migração (§7.1). A própria `20260911100000:68` explica o caso. |
| 35 | A whitelist das 4 chaves do referral só no TypeScript: a quinta chave entra num deploy e ninguém vê | `check` na coluna `conversations.anuncio` (§7.2), além do `if` em `extrair.ts`. |
| 36 | Baixar imagem e PDF de toda conversa multiplica o balde privado; ninguém dimensionou um ano de cardápio em PDF | A retenção de 365 dias já zera `media_path` e `media_id` (`20260905000200:2347`) sem linha nova. Medir o crescimento do balde no primeiro mês; se doer, cortar `document` e manter `image`. |
| 37 | O gatilho de `supplier.published` roda sobre webhook reentregue, e reentrega legítima tem outro `delivery_id` — dois negócios de ativação para o mesmo fornecedor | Idempotência por **(organização, funil)**, não por `delivery_id` (§7.8). Teste pgTAP na nova migração. |
| 38 | Fechar o negócio de captação dentro do webhook escreve em `deals` e `deal_stage_history` sem `auth.uid()` | Autoria `'sistema'`, como a importação já faz. A RLS e a auditoria precisam aceitar isso ali — conferido no mesmo teste. |
| 39 | A conversão de 90 dias roda a coorte de `relatorio_funil` a cada carregamento do quadro; o kanban abre o tempo todo, a tela de relatórios não | Medir depois de ligar. Se pesar, o campo vira materialização diária — decisão quando a medição aparecer, não antes. |
| 40 | Os 277 candidatos parados somem sozinhos em 16/12/2026 pela retenção | É o comportamento correto e está escrito (§4.5). Ou alguém trabalha os 108 de A+/A antes disso, ou eles somem — decisão do Rafael (§12). |

---

## 12. Decisões que ainda são do Rafael

| # | Decisão | Opções | Recomendação |
|---|---|---|---|
| 1 | **A redação exata do `terms_notes` de `google_maps_raspado`** (§3.3) | (a) aprovar como está; (b) reescrever | **Ler e aprovar antes de a migração subir.** É a linha que vai ser lida se alguém perguntar por que raspamos. Não delegável. |
| 2 | **O teto de conduta da raspagem** — 2 rodadas por semana, 600 lugares por rodada, Natal e região metropolitana | (a) manter; (b) outro número | **Manter.** 600 × 2 por semana já enche a fila mais rápido do que 45 aberturas por dia esvaziam. É limite de conduta, não de código: nada no CRM o impede, então mudar é trocar o texto antes de subir. |
| 3 | **O que o robô diz sobre custo** (`PEDIU_TAXA_PRECO`) | (a) uma frase nova e verdadeira; (b) a intenção fica fora até a régua do escrow fechar | **(b), por ora.** A frase que está em `GEN-SYS-MENU-1`, na resposta rápida `custo` e em `GEN-OBJ-TAXA-INFO` — "não tem mensalidade nem adesão" — está registrada como **falsa** em `base-conhecimento.ts:36` desde 08/09. O texto nasce cadastrado e `robo_responde = false`; liga no dia em que houver frase verdadeira. É a intenção de maior volume, e por isso mesmo a que não pode sair errada. |
| 4 | **Ler e aprovar os 8 textos** antes de `robo_responde` virar `true` | (a) ler os 8 e liberar; (b) liberar por partes | **(a), numa sentada.** Depois disso eles saem 24 h por dia sem revisão, e a oferta vincula (CDC art. 30). A migração sobe com tudo `false`; o "pode ligar" é seu. |
| 5 | **Quem fala primeiro na conversa**: o menu do bot de entrada continua sendo a primeira resposta automática, com o robô de intenção assumindo da segunda em diante? | (a) manter o menu (a spec assume isto: regra 6 vem antes da 9); (b) matar o menu e responder por intenção desde a primeira mensagem | **(a).** O menu tria sem gastar IA e já roda desde 16/09. Mas note o achado de §6.2: **quem responde à campanha não recebe menu nenhum hoje**, porque o cumprimento solto já conta como saída — então, na prática, o robô de intenção é quem vai falar com a maior parte do volume. |
| 6 | **O teto mensal de IA** (`app_settings.ia.orcamento.mensal_usd`) | (a) manter US$ 25; (b) subir | **Subir para US$ 60 antes da Fase 4.** Com a fila do Maps, `classify_inbound` passa a rodar em todo volume de entrada, e o freio novo **corta a classificação** ao bater o teto — cortar é o certo, mas cortar cedo demais é o robô calado. `update public.app_settings set value = value - 'pendente_de_aprovacao'::text \|\| jsonb_build_object('mensal_usd', 60) where key = 'ia.orcamento';` — um comando, sem deploy. |
| 7 | **Subir `cadencia.tetos.whatsapp.depois` acima de 45** junto com a peça (c) | (a) deixar 45 e aceitar a campanha a 45/dia; (b) subir até o `teto_duro` de 100 | **(a), por duas semanas.** Aguentar 45/dia enquanto a tabela de saúde do número enche; se `qualidade = 'GREEN'` nas duas semanas, subir para 70. Subir antes de ter o dado é trocar um freio por um palpite. |
| 8 | **Os 277 candidatos parados**, que a retenção apaga em 16/12/2026 | (a) trabalhar os 108 de A+/A antes; (b) deixar sumir | **(a), depois da Fase 1.** O scraper vai trazer esses mesmos nomes **com telefone** — a comparação lado a lado é informação. Não recusar em lote: recusa sem motivo escrito não é decisão, é sumiço. |
| 9 | **Desligar `instagram` como origem** | (a) manter ligada (a spec decidiu isto); (b) desligar | **(a).** Desligar cortaria o cadastro manual de candidato e de parceiro vindo do Instagram — exatamente o que a Fase 2 promete preservar — sem desligar robô nenhum. Reversível com um `update` se você quiser o contrário. |
| 10 | **Carteira fixa** (§8.3): devolver a conversa ao dono do negócio | (a) manter o de hoje; (b) carteira fixa, 1 dia com pgTAP | **(a).** Inverter agora desfaz a decisão de 14/09 (o time inteiro atende, quem responde assume o fio) no mês em que o volume de entrada vai triplicar. Reavaliar depois da Fase 4, com o relatório de atendimento na mão. |
| 11 | **Restringir o que o SDR enxerga** (§8.7) | (a) só o recorte "Meu setor" como padrão (§7.4); (b) tirar `sdr` de `app.sees_all()`, 1 dia | **(a).** Resolve o incômodo sem mexer na RLS e sem quebrar setores, fila por setor e transferência. |

---

## 13. Como saber se deu certo

### Fase 1
1. Um CSV de 600 lugares de Natal entra pela tela e **a prévia bate com o recibo linha a linha** — mesma decisão e mesmo motivo em cada linha.
2. As fichas criadas respondem `public.origem_dos_dados` com a URL do lugar no Maps em `phone_e164` **e** em `place_id`.
3. Reimportar o mesmo arquivo cria **zero** ficha nova e devolve `repetida`/`ja_importado` em toda linha que virou ficha na primeira vez; as que pararam em revisão continuam em revisão.
4. `esteira_desfazer_lote` limpa o lote inteiro dentro das 48 h, e `count(*)` de `organizations` volta ao de antes.
5. Um segundo lote do mesmo lugar com nota diferente produz **um** candidato e **uma** ficha, com `mudou_na_fonte` em `source_record.flags`.
6. `select count(*) from public.supplier_candidates where phone_e164 is not null and source_id = <google_maps_raspado>` é **maior que 50%** das linhas do lote. Abaixo disso, a fonte não resolveu o problema que motivou o ADR-12.
7. A lista de Parceiros filtra por etiqueta, origem, temperatura e qualificação, e **nenhuma tela imprime `rating` ou `reviews_count`** (`grep -rn "rating\|reviews_count" apps/web/src/components/parceiros` não acha nada em JSX).
8. `pnpm lint`, `pnpm typecheck`, Vitest e pgTAP verdes, com o arquivo 66 somando 15 asserções.

### Fase 2
1. `select slug, is_enabled from public.sources` mostra `casamentos_com_br`, `base_cnpj`, `sympla_outgo`, `olx`, `telelistas` em `false`, e `instagram`, `google_places` e as origens manuais em `true` — **e um `supabase db reset` local devolve o mesmo resultado**.
2. `fly apps list` não tem `triade-worker-ingest`, sete dias depois da `count 0`.
3. `/radar` responde **308** para `/revisao`, e o botão do recibo da importação chega na fila certa com a contagem certa (candidatos distintos, não linhas).
4. A Revisão mostra candidato de **pelo menos duas origens diferentes na mesma tela**, com o filtro "Origem" separando-os.
5. Ajustes → Atendimento diz se `worker-wa` e `worker-ai` bateram ponto, com a hora da última batida.
6. `grep -rn "radar_alternar_fonte\|radar_coletar_agora\|radar_agendar_coleta" packages/schema/src/database.types.ts` não acha nada (tipos regerados), e `grep -rni "radar" apps/web/src` só acha ocorrências dentro de `supabase/` ou em comentário histórico.
7. pgTAP verde com 37 e 54 apagados, 14 em `plan(65)`, 21 em `plan(33)`, 16 em `plan(125)` — **saldo −41 sobre o total do dia**.
8. `docs/CHANGELOG.md` registra o que saiu, o número de linhas e o custo do Fly encerrado.

### Fase 3
1. Com `ai_runs` somando acima da linha de alerta, `app.ia_pode_gastar('draft_reply')` é **falso** e `('classify_inbound')` é **verdadeiro**; acima do teto, os dois são falsos — e existe linha em `ai_runs` com `status='bloqueado'` e `cost_usd = 0` para cada recusa.
2. `select count(*) from pg_proc` à parte: **nenhuma** chamada à Anthropic acontece com o orçamento estourado — medido pelo dublê em `execucao.test.ts`, zero invocações.
3. `public.ia_orcamento_status()` devolve `freado` e a lista `parados`; `ai_budget_alerts` tem as duas linhas (`passou_de_80` e `freou`) mesmo quando o mês pula direto para o teto.
4. `public.wa_saude_numero` recebe linha do webhook **e** da leitura periódica da Graph, e `app.wa_teto_da_meta` devolve o teto traduzido do tier corrente. Com a tabela vazia, `app.pode_enviar` responde exatamente o que respondia antes da migração.
5. Com `current_limit = 'TIER_50'` e teto nosso 150, o teto efetivo é **50**; com `qualidade='RED'`, zero iniciadas pela empresa e motivo `qualidade_vermelha`.
6. Um template de recontato para conversa com histórico **conta** em `app.aberturas_do_dia`; a 46ª abertura do dia é recusada com `teto_do_numero` e `quando` na próxima abertura do canal; resposta dentro das 24 h não conta e não é barrada; confirmação de opt-out não conta e continua saindo.
7. Sete falas de robô em 24 h numa conversa: seis saem, a sétima é recusada pelo guard com `42501`, a despedida `GEN-SYS-HUMANO` sai **uma vez** e não conta como fala.
8. `public.wa_servico_do_mes` devolve um número maior que zero e compatível com o Gerenciador da Meta no mesmo período.
9. A coluna do kanban mostra conversão de coorte de 90 dias para quem passa em `app.sees_all()`, e **nada** (sem erro, sem tela quebrada) para o `embaixador`.

### Fase 4
1. Uma mensagem recebida gera **exatamente uma** linha em `public.atendimento_decisoes` e **no máximo uma** saída automática — provado no teste 7 e observado na caixa por uma semana.
2. Mensagem com pedido de saída no meio de uma pergunta de preço → veredito `optout`, zero mensagem de robô, e o `botao_tocado` da campanha **gravado**.
3. "HUMANO" transfere em uma resposta: `bot_paused = true`, uma `tasks` com `priority 1` e `due_at = now()`, uma única mensagem de saída — e a mensagem seguinte da mesma conversa devolve `pessoa`.
4. A frase de transparência sai **uma vez por conversa**, e `conversations.transparencia_em` está preenchido em toda conversa que teve resposta automática.
5. Tentar cadastrar um modelo com `robo_responde = true` cujo corpo cite mensalidade, um percentual fora de `app.valores_autorizados` ou um link fora de `URLS_PERMITIDAS` é **recusado no INSERT**.
6. `select public.atendimento_configurar('{"robo_responde": false}')` cala o robô de intenção em menos de um segundo, sem deploy, e o menu continua respondendo.
7. O contador de conversas de serviço do mês fica **abaixo de 900**, e o alerta de 70% chegou antes de qualquer surpresa.
8. A view `public.robo_amostra_semanal` é aberta pelo menos uma vez por semana e nenhuma intenção aparece com mais de 10% das respostas marcadas como fora de contexto por quem leu.
9. O tempo de primeira resposta em `public.relatorio_atendimento` **não melhora artificialmente** — `bot_fixed` continua fora da conta.
10. `supplier.published` da Komune fecha o negócio de captação como ganho **e** abre o de ativação; reentregar o mesmo evento não cria um segundo.

---

## Notas de rodapé — contradições encontradas entre as seções, e o que foi escolhido

[^1]: **Onde mora o texto pronto do robô.** A §2.2 (ADR-13) mandava usar `public.message_templates` e proibia afrouxar o guard; a §6.4 mandava usar `public.respostas_rapidas` com uma coluna nova `messages.resposta_rapida_id` e um ramo novo aceito no `messages_guard`. **Escolha: `public.message_templates`, por `app.wa_bot_dizer`.** Razão verificada no código: `app.wa_bot_dizer` (`20260916110000:192`) já insere `author_kind='bot_fixed'` com `template_id` e `body = t.body`, e o ramo `bot_fixed` do guard (`20260916130000:155`) exige exatamente `template_id` ou `cadence_touch_id` — o caminho passa **sem uma linha de alteração no arquivo mais conferido do projeto**. Daí o princípio adotado em toda a spec: *o guard só é tocado para apertar* (a única alteração é o teto de fala, §5.4). Consequência assumida: o conserto do `author_kind='human'` da resposta ao botão, que exigiria `envio_item_id` e um ramo aceito a mais, **sai desta spec** e vira §8.9 — o caminho está dormente desde 22/09, então o custo de adiar é zero.

[^2]: **Piso de confiança para o robô falar.** A §2.2 dizia `>= 0,7`; a §6.5 dizia `>= 0,85`. **Escolha: 0,85**, com `LIMIAR_PARA_FALAR_SOZINHO` novo ao lado do `LIMIAR_DE_CONFIANCA = 0.7` existente. O 0,7 é o piso para *entender* (abaixo dele a intenção vira `AMBIGUO`); falar sem ninguém ler pede mais, e a faixa 0,7–0,85 continua valendo para funil e ficha.

[^3]: **`kind` da fonte nova.** A §1 e a lista de riscos diziam `kind='import'`; a §2.1 e a §3.3 diziam `kind='scrape'` para que `public.radar_alternar_fonte` recusasse ligá-la para sempre. **Escolha: `kind='import'`.** Motivo decisivo, achado no código durante a montagem: `app.envio_variaveis` (`20260921100000:268`) e `app.wa_preparar_abertura` (`20260917200100:114`) preenchem a variável `{{origem}}` de mensagem com `s.name` **quando `s.kind in ('scrape','api')` — com `kind='scrape'`, a string "Google Maps (raspagem local)" iria dentro de um primeiro contato de campanha.** A trava perdida não faz falta: `is_enabled=false` já faz `esteira_abrir_lote` recusar `kind='coleta'`, `config.collector.enabled` é `false`, não há adaptador para a fonte e, depois da Fase 2, não há worker de ingestão nenhum. O slug ficou **`google_maps_raspado`** (a §3.3 usava `google_maps_scraper`), por ser o usado no ADR e nas edições de PRD e seed.

[^4]: **Numeração de migrações e de testes.** As seções colidiam em três carimbos (`20260924140000` para duas migrações diferentes, `20260929120000` para o desligamento do Radar e para a transparência) e em dois números de pgTAP (66 duas vezes, 69 duas vezes). A numeração única está na tabela de §9. A fonte e o mapa de categorias ficaram **dentro** da migração da Fase 1, e não numa migração própria, porque a linha da fonte é o registro escrito da decisão e não pode depender de alguém lembrar de rodar a seed.

[^5]: **Teto de falas do robô por conversa.** A §5.4 dizia 6 em 24 h, em `app_settings.whatsapp.robo_teto`; a §6.9 dizia 5, em `atendimento.teto_robo_por_conversa`. **Escolha: 6, na chave da Fase 3**, e a Fase 4 **não** cria uma segunda chave — a regra 7 do árbitro lê `app.wa_bot_pode_falar`, e o guard continua sendo a última palavra. O teto **mensal** (900 conversas) é coisa diferente, com unidade diferente (conversa de serviço cobrada pela Meta), e esse sim nasce em `atendimento.teto_robo_por_mes`.

[^6]: **Quantas intenções nascem cadastradas.** A §2.2 listava 9 (incluindo `NAO_E_A_PESSOA`); a §6.4 listava 8. **Escolha: 8.** `NAO_E_A_PESSOA` cai para pessoa pela regra dura de que *o robô não preenche variável*: a resposta útil nomeia a empresa, e uma versão sem nome é vaga o bastante para queimar o contato. Todas as 8 nascem com `robo_responde = false`; `PEDIU_TAXA_PRECO` continua desligada mesmo depois da aprovação, até a régua de custo fechar (§12, item 3).

[^7]: **A mensagem de ausência.** A decisão 4 de Rafael e a §2.2 diziam "sai de cena" (`ausencia_ativa: false`, modelos a `is_active=false`); a §6.7 dizia que o corpo é reescrito e a função continua rodando quando o árbitro decide `pessoa` e a janela está fechada. **Escolha: §6.7.** Desativar o `template_code` mataria `app.ausencia_responder` em silêncio (ela procura o modelo por código e usa o `id` dele como trava de 12 h) e quebraria `public.atendimento_configurar`, que escreve o `texto_ausencia` do gestor nesse mesmo código. A decisão de Rafael é honrada pelo conteúdo: **a mensagem de 22/09, que promete "a gente responde quando voltar", sai de cena** — o texto novo diz que a resposta é imediata e oferece HUMANO. `GEN-SYS-FORA-HORARIO` vai a `is_active=false`, e nada é apagado.

---

# Emenda de 25/09/2026 — a IA escreve, e marca a reunião

## O que esta emenda revoga

O **ADR-13** e a **§6** desta spec desenharam um robô que **escolhe** entre textos prontos: a IA classifica a intenção, o Postgres busca o `message_templates` daquela intenção e manda. Em 25/09/2026, depois de ler a §6, o Rafael mudou o desenho: *"a minha ideia com a IA é ela atuar dentro do CRM, aprendendo com nossas mensagens já existidas, ela dialogar com o lead como se fôssemos nós operando, e ela nos entregar num calendário do CRM (que eu quero que você implemente manualmente, sem google calendar, e integre com o envio de e-mail pra avisar que marcou reunião). quero tudo automatizado e preparado pela IA"*.

Muda isto, e só isto: **a IA passa a redigir texto livre** no assunto do negócio, em vez de escolher entre oito textos aprovados; **a IA passa a marcar a reunião sozinha**, das 9h30 às 17h20, num calendário que é do CRM; e **a integração com o Google Agenda é apagada de vez**. O motivo é um só: texto pronto não dialoga, e agenda que mora fora do banco não pode ser consultada pelo Postgres, que é o cérebro (ADR-03).

O que **não** muda por causa disso: o robô continua preso ao assunto Komune (política da Meta, não gosto nosso), o opt-out por regra continua vindo antes de qualquer modelo, e o freio da Fase 3 (orçamento, saúde do número, teto de recontato, teto de fala) continua valendo linha por linha — com texto livre ele fica mais necessário, não menos.

---

## ADR-14 — A IA redige texto livre no assunto do negócio

**Linha da tabela do PRD §9.1** (colar depois do ADR-13):

| ADR | Decisão | Alternativas | Justificativa / risco |
|---|---|---|---|
| ADR-14 | **A IA redige o que sai.** O robô deixa de escolher entre textos prontos e passa a escrever texto livre, em nome da equipe, **no assunto do negócio** (Komune, evento, fornecedor, reunião, preço, prazo), sem aprovação humana por mensagem. Quem segura não é uma pessoa: é um **validador determinístico de mundo fechado** — toda frase da mensagem precisa caber em um de cinco tipos (`fato`, `pergunta`, `cortesia`, `agenda`, `escape`), toda afirmação sobre a Komune precisa de `fatoId` da base, toda cortesia precisa bater **literalmente** com a voz da casa, e todo número precisa estar em `app.valores_autorizados`. A versão do validador fica gravada na linha que autorizou a saída. **Decisão de Rafael em 25/09/2026. Revoga o ADR-13 e altera o ADR-05**, que passa a valer só para o que uma pessoa decide mandar | (a) manter o ADR-13 (oito textos prontos, decisão de ontem); (b) texto livre com aprovação humana por mensagem, como hoje; (c) texto livre solto, sem validador | (a) não é diálogo: oito textos respondem oito perguntas e emudecem na nona. (b) é o de hoje, e o de hoje não responde à noite nem no domingo — que é quando o fornecedor de evento escreve. (c) é indefensável: a oferta vincula (CDC art. 30). O caminho do meio é fechar o mundo em vez de detectar o desvio — um detector precisa prever a paráfrase, um mundo fechado precisa que a frase caiba numa das cinco caixas. **Risco assumido, por escrito:** é a primeira vez desde o D2 que `app.messages_guard` é **afrouxado**; o ramo novo para `bot_ai` exige cinco condições e `approved_by` fica nulo, para que nenhuma mensagem automática pareça aprovada por gente. **Fronteira que não se move:** assistente de propósito geral continua **proibido** no WhatsApp desde 15/01/2026 (`docs/anexos/R04-whatsapp-automacao.md:59`) e derruba o número — "escreve sobre tudo" quer dizer sobre todo assunto **da conversa comercial**, nunca sobre todo assunto do mundo |

**Texto longo, para o PRD §13, item 25:**

> **25. A IA redige (ADR-14) — decisão de Rafael em 25/09/2026, revoga o ADR-13.**
> O robô escreve texto livre no assunto Komune, 24 h por dia, sem revisão por mensagem. O que ele pode afirmar vem de `packages/prompts/src/nucleo/base-conhecimento.ts` e de nada mais; o que ele pode dizer de cortesia vem de `packages/prompts/src/nucleo/voz-da-casa.ts`, um arquivo de ~50 frases nossas, literais, lido e aprovado pelo Rafael num PR. O modelo é obrigado a quebrar a própria mensagem em frases e declarar o tipo de cada uma; frase sem tipo não sai. **Conteúdo reprovado não sai, ponto** — `situacao: 'bloqueado'` passa a ser terminal, e o rascunho fica guardado em `public.message_drafts` com o veredito inteiro, para quem abrir a caixa ver o que a IA quis dizer e por que não saiu. O robô **não assina com nome de gente**: escrever "Heloísa" numa mensagem que ela não escreveu é o defeito que esta spec já aponta em `app.envio_resposta_ao_botao` (§7, nota 1). Quem diz que é máquina é a frase de transparência, e ela também perde a assinatura.

---

## ADR-15 — O calendário é do CRM, sem Google

| ADR | Decisão | Alternativas | Justificativa / risco |
|---|---|---|---|
| ADR-15 | **A reunião vira objeto do banco e a agenda do Google é apagada.** Nasce `public.reunioes`, com começo, fim, formato, lugar, estado, dono e uma **restrição de exclusão GiST** que proíbe duas reuniões vivas da mesma pessoa se sobreporem. Disponibilidade, grade, feriado, rota e teto diário passam a ser calculados em SQL (`app.reuniao_horarios_livres`). Saem do repositório as duas tabelas do Google, as 9 funções em `app`, os 9 invólucros em `public`, as 4 rotas de `apps/web/src/app/api/agenda/`, `apps/web/src/lib/google/agenda.ts`, o guia de operação e os segredos `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`. O aviso de reunião marcada vai por **e-mail**, pelo cano do Resend que já existe. **Decisão de Rafael em 25/09/2026** | (a) manter o Google Agenda e a IA criar evento por lá (era o desenho da §7.7); (b) ler livre/ocupado do Google (a §8.5 já tinha recusado); (c) Cal.com ou outro agendador de terceiro | (a) e (b) põem a informação que decide — "esta pessoa está ocupada às 10h" — fora do Postgres, e o robô passa a depender de OAuth de terceiro, refresh token por pessoa e quota de API para responder uma mensagem de WhatsApp. (c) é um BSP de agenda: mesma objeção do ADR-06, em outro assunto. **Risco assumido:** com o Google fora, o CRM é o único calendário e **só sabe o que ele mesmo criou** — dentista, almoço e viagem não existem para ele. Mitigação: a grade é curta (9 começos por dia), o teto é 4 por pessoa por dia, a tarde de quem tem rota planejada é bloqueada inteira, e cancelar/remarcar está no cartão da Agenda, a um clique |

**Texto longo, para o PRD §13, item 26:**

> **26. O calendário sai do Google (ADR-15) — decisão de Rafael em 25/09/2026.**
> Antes do deploy, e **só enquanto os tokens ainda funcionam**, todos os eventos futuros criados pelo CRM no Google são cancelados por `/api/agenda/remover`, para que nenhum fornecedor fique com um convite órfão. Depois disso a migração apaga tabelas, funções, invólucros e os segredos do Vault com nome `agenda_google:%` — que não somem sozinhos quando a tabela que guarda o `segredo_id` cai. A permissão OAuth registrada na conta Google de cada pessoa **sobrevive** à faxina do nosso lado: cada uma remove o acesso em `myaccount.google.com/permissions`, e o Luiz tira o escopo `calendar.events` da tela de consentimento. Ficam, e não podem ser apagados por engano: `SUPABASE_AUTH_GOOGLE_CLIENT_ID`/`SUPABASE_AUTH_GOOGLE_SECRET` (é o **login** do CRM) e `GOOGLE_MAPS_API_KEY` (é a busca de telefone).

---

## A. A IA escreve com a nossa voz

### O que isto é, e o que não é

Não dá para treinar um modelo com as nossas conversas: treinar quer dizer mexer nos pesos, a Anthropic não vende isso, e cada mensagem nova pediria um treino novo. O que dá para fazer — e é o que todo mundo chama de "aprender com as nossas mensagens" — é **mostrar as nossas conversas reais uma vez, tirar delas o jeito de falar e gravar esse jeito num arquivo que entra em toda chamada**. O modelo não fica sabendo de nada; ele recebe o nosso jeito escrito, por cima, a cada resposta.

Consequência prática: a voz vira um arquivo versionado no repositório, que o Rafael lê e aprova uma vez, e não um cérebro que ninguém consegue abrir.

### (a) De onde saem os exemplos

O corpus **não nasce como view**. Nasce como `app.voz_corpus(p_limite int default 300)`, `security definer`, `set search_path = ''`, com `revoke all ... from public, anon, authenticated` e `grant execute ... to service_role`, em `supabase/migrations/20260930100000_o_corpus_da_voz.sql`.

Por que função e não view: uma view em `public` sobre `public.messages` devolve o texto cru de conversas reais para quem tiver `select`. O repositório declara `security_invoker` explicitamente quando cria view justamente por isso (`20260904000800:276`, `20260904000500:341`), e revelar conversa em massa é o que `public.pii_access_log` (`20260904000400:269`) existe para registrar. O corpus roda uma vez por mês, por um script com `service_role`, e ninguém mais precisa dele. Função fechada é a forma mais barata de dizer isso.

Ela lê `public.conversations` (`supabase/migrations/20260905000200_ia_e_whatsapp.sql:600`) e `public.messages` (`:1133`), e deixa entrar só o que ensina.

**Entram:**

| filtro | coluna | por quê |
|---|---|---|
| gente escreveu | `messages.author_kind = 'human'` e `sent_by is not null` | a coluna nasce em `20260905000200:1158` com quatro valores: `human`, `bot_fixed`, `bot_ai`, `system` |
| nós mandamos | `direction = 'out'` e `origin = 'crm'` | é a nossa voz. `origin` tem três valores (`20260905000200:1466`: `crm`, `echo`, `import`); `echo` fica de fora porque é registro do que saiu do celular antes de 14/09, quando havia Coexistence |
| saiu de verdade | `status in ('sent','delivered','read')` | `queued` e `failed` nunca chegaram a ninguém |
| funcionou | ou a conversa aponta para um `deals` com `status = 'won'` e `won_at` preenchido (`20260904000300:324`), ou a mensagem recebeu resposta do parceiro em até 24 h | duas faixas: a que fechou negócio e a que ao menos gerou resposta |
| é recente | `created_at > now() - interval '90 days'` | **escolha nossa**, não limite legal: voz de seis meses atrás já não é a de hoje. O teto legal é maior — o PRD §10.6 dá 12 meses a "Conversas de prospecção" |

**Não entram, e cada exclusão tem motivo:**

- **As do robô** — `author_kind in ('bot_ai','bot_fixed','system')`. Se a saída do robô voltasse como exemplo, em três meses ele estaria copiando a si mesmo e a voz iria secando. É o furo mais fácil de abrir e o mais difícil de perceber; por isso vira teste pgTAP, não confiança.
- **As que levaram a opt-out** — conversa que tem mensagem com `optout_confirmation = true` (`20260905000200:1168`), ou cujo telefone está na `public.suppression_list` (`20260904000400:41`), ou onde `app.wa_parece_optout` (`20260916110000:116`) casa em qualquer entrada. Quem faz a pessoa pedir para sair não é modelo de nada.
- **As de conversa que morreu** — nossa mensagem sem nenhuma entrada depois dela. Silêncio não é aprovação.
- **As de negócio perdido** — `deals.status = 'lost'` com `lost_reason_id` (`20260904000300:322`).
- **As que o nosso próprio validador reprovaria** — passam por `validarPromessas` (`packages/prompts/src/nucleo/validador-promessas.ts:135`) antes de entrar. Um humano nosso já escreveu "sem mensalidade", e o comentário de `base-conhecimento.ts:37` registra, em 08/09/2026, que a frase é falsa. Exemplo errado ensina errado.

**Quantas.** 40 conversas, teto de 300 mensagens, as mais recentes primeiro, metade de cada faixa (fechou / respondeu).

**Quanto custa.** 300 mensagens de ~140 caracteres dão ~42 mil caracteres, ~11,7 mil tokens pelo divisor de `packages/prompts/src/nucleo/tokens.ts:13` (`CARACTERES_POR_TOKEN_PT_BR = 3.6`). No Sonnet, entrada a US$ 2/milhão (`nucleo/custos.ts:30`) = **US$ 0,023**; a saída são ~1.100 tokens a US$ 10/milhão = **US$ 0,011**. Total **≈ US$ 0,035 por destilação**, uma vez por mês, na mão.

**Pseudonimização.** O corpus não vai cru ao modelo. Ele passa pelo caminho que já existe e é o único sancionado: `prepararChamada` (`packages/prompts/src/nucleo/chamada.ts:351`) valida a entrada, troca nome, empresa, telefone, e-mail e @ por marcadores com o `Pseudonimizador` (`nucleo/pseudonimizacao.ts:979`) e só então audita (`chamada.ts:390`). Três detalhes que não são opcionais:

1. O prompt da destilação declara `escala: 'conversa'`, então a conferência é `verificarSemPiiNaConversa` (`nucleo/auditoria-pii.ts:541`), com fronteira de letra. A estrita (`:495`) barraria tudo: no tamanho de uma conversa, data mais hora mais preço colados viram telefone.
2. `camposDoTriade` declara o que foi o CRM que escreveu, caminho a caminho: `conversas[].leadId`, `mensagens[].messageId`, `mensagens[].quando`, `mensagens[].de`. O que não for declarado é tratado como texto de fora (`chamada.ts:401`) — a classificação falha fechado, e é isso que impede um campo novo de escapar da auditoria.
3. **O que a auditoria não pega, dito em voz alta:** ela pega padrão — telefone, e-mail, CPF, @. Não pega um primeiro nome que não está no CRM ("meu sócio Ricardo confirma amanhã"), porque o `Pseudonimizador` só troca o que o banco lhe deu. A mitigação é o formato do resultado: o que sai da destilação são ~50 frases curtas que uma pessoa lê num PR, e um eval roda `verificarSemPii` (a estrita, `:495`) sobre cada frase do guia, quebrando a suíte se sobrar um dígito que pareça telefone. O corpus atravessa a fronteira uma vez por mês; o arquivo que fica é conferido duas vezes, por máquina e por gente.

### (b) Como a voz é destilada: guia uma vez, não exemplos a cada chamada

**Escolha: guia destilado uma vez, revisado por gente, dentro do bloco estável do prompt.** Exemplos crus a cada chamada ficam de fora. A conta, que é o que decide (cenário "exemplos crus" = 12 conversas × 8 mensagens × 130 caracteres injetadas em toda resposta; cenário "guia" = arquivo de ~4.000 caracteres no bloco `sistema`):

| | exemplos crus por chamada | guia destilado no bloco estável |
|---|---|---|
| tamanho | ≈ 12.480 caracteres ≈ **3.467 tokens** | ≈ 4.000 caracteres ≈ **1.112 tokens** |
| cache | nenhum: muda a cada chamada | é o bloco `sistema`, que já leva `cache_control` (`chamada.ts:85`); leitura de cache a 0,1× da entrada (`nucleo/custos.ts:24`), ou US$ 0,2/milhão no Sonnet (`:30`) |
| custo por resposta | 3.467 × US$ 2/milhão = **US$ 0,0069** | 1.112 × US$ 0,2/milhão = **US$ 0,00022** |
| custo no mês (2.700 respostas) | **US$ 18,72** | **US$ 0,60** |
| auditoria de PII | a cada chamada, sobre texto de lead | uma vez, sobre um arquivo revisado |
| reprodutível | não: o corpus muda sozinho | sim: é arquivo versionado |

Trinta vezes mais caro, e o caro é o menor problema: exemplo cru significa texto de cliente real atravessando a fronteira do modelo milhares de vezes por mês, e significa que ninguém consegue dizer por que o robô escreveu o que escreveu ontem.

**O guia** é `packages/prompts/src/nucleo/voz-da-casa.ts`, no formato dos outros arquivos do núcleo: constantes congeladas, uma `VERSAO_DA_VOZ` com data (como `VERSAO_DA_BASE`, `base-conhecimento.ts:26`) e uma função `vozComoTexto()` que devolve o bloco que entra no `sistema` — igual ao que `baseComoTexto()` (`base-conhecimento.ts:182`) já faz. Ele tem **seis** listas:

- `ABERTURAS` — as ~12 primeiras linhas que a equipe mais usa, literais, tiradas do corpus;
- `FECHOS` — as ~10 formas de terminar, incluindo as de saída fácil ("se não for o momento, me diz");
- `CONECTIVOS` — as ~15 frases de ligação e cortesia que aparecem entre uma coisa e outra;
- `DESVIOS` — as ~5 linhas literais de voltar ao trilho quando o lead puxa outro assunto ("isso aí eu não sei te dizer, mas sobre a Komune…"). Sem ela, a mensagem de `foraDoAssunto` não teria nenhuma frase de tipo válido, seria bloqueada, e o caminho "reconhece e volta ao trilho" seria código morto;
- `NAO_DIZEMOS` — o que o corpus mostra que a gente nunca escreve ("prezado", "parceria estratégica", "sem compromisso"), somado ao que o R08 §5.1 já proíbe;
- `LEXICO_DE_COMPROMISSO` — os verbos de promessa ("dar um jeito", "consigo", "encaixo", "libero", "abro exceção", "faço por", "fecho por", "ajusto", "garanto"). Esta lista não é sobre estilo: é a munição do validador, item (d).

As quatro primeiras listas são **frases nossas, literais**, não descrições de estilo. Isso é de propósito e volta em (d): o validador consegue conferir frase literal; não consegue conferir "tom acolhedor".

Quem gera: prompt novo `destilar-voz@v1`, Sonnet, saída estruturada, que lê o corpus pseudonimizado e devolve as seis listas com a contagem de quantas vezes cada frase apareceu. Quem aprova: uma pessoa, uma vez, lendo ~50 frases num PR. Quem mantém: a mesma rodada uma vez por mês, e o diff do PR mostra o que mudou na voz da casa.

**Os dois propósitos, e onde cada lista mora de verdade.**

- **`draft_reply`** (o prompt que escreve, item (c)) já existe no `check` de `ai_runs.purpose`, no `if` de `app.ia_enfileirar` (`20260925150000:438`) e no array de `app.ia_gasto_bloqueado_para` (`:288`). **Mas não existe em `PropositoDeAiRun`** (`packages/prompts/src/nucleo/versionamento.ts:33`), que hoje tem sete valores e não o inclui. É uma linha de TypeScript, não uma migração — mas sem ela o prompt não compila.
- **`destilar_voz`** é propósito novo. **A lista viva do `check` não é a de `20260905000200:174`**: aquela constraint foi derrubada e recriada duas vezes, e a que vale é `ai_runs_purpose_check` de `20260917230000:41`. Então `destilar_voz` entra em **três** lugares: essa constraint, `PropositoDeAiRun` (`versionamento.ts:33`) e o array de `app.ia_gasto_bloqueado_para` (`20260925150000:287`), para a tela de orçamento dizer a verdade sobre o que está parado. **Não entra em `app.ia_enfileirar`**, e isso é escolha: a destilação é manual, mensal, rodada por script com `service_role`, e nunca passa pela fila. Pôr na lista da fila convidaria alguém a enfileirá-la. A lição de `20260917230200_o_proposito_novo_entra_na_fila.sql` é que a lista mora em mais de um lugar — não que ela more em todos.

**O robô não assina com nome de gente.** Desde `20260914110000_as_aberturas_levam_o_nome_de_quem_envia.sql` os modelos trazem `{{atendente}}`, que **`public.wa_enviar_modelo` preenche com o primeiro nome de quem clicou**. Texto livre não passa por `wa_enviar_modelo` nem por modelo nenhum, então `{{atendente}}` simplesmente não existe nesse caminho — não há "assinatura" para anular. A trava é do prompt: **está proibido escrever qualquer primeiro nome do time**, e o validador reprova a mensagem que contenha um nome de `public.profiles`. Quem diz que é automático é a frase de transparência da §6.6.

### (c) O prompt que escreve

`packages/prompts/src/prompts/responder-livre/v1.ts` — `responder-livre@v1`, Claude Sonnet 5, `proposito: 'draft_reply'`, `escala: 'conversa'`. Entra em `CATALOGO` e em `VIGENTES` (`packages/prompts/src/catalogo.ts:23` e `:35`) — sem as duas linhas o prompt existe e ninguém o alcança.

**O que ele recebe.** Montado em SQL por `app.ia_entrada_da_resposta(p_message_id uuid)`, irmã de `app.ia_entrada_da_ficha` (`20260917110000:94`), para a entrada nascer do banco e não do worker (ADR-03):

- `leadId`, `variante`, `segmento`, `etapa` e as etapas válidas — campos do CRM, declarados em `camposDoTriade`;
- `intencao` e `confianca`, vindas por parâmetro do árbitro, nunca lidas de `conversations.ai_intent` (§6.3: a coluna é da conversa, não da mensagem, e `app.wa_bot_de_entrada` também escreve nela);
- da ficha (`public.ficha_da_conversa`, `20260917100000:32`): `resumo`, `objecoes`, `alertas`, `proxima_acao` e `proxima_acao_em`. **Não existe coluna "compromissos abertos"** — `proxima_acao` é o que mais perto chega, e é o que faz a resposta citar a conversa em vez de repetir o pitch;
- as últimas 12 mensagens, com `messageId`, quem falou e quando (por `app.ia_mensagem_da_conversa`, `20260917110000:71`);
- `camposVazios`: o que o CRM ainda não sabe, por `app.ia_campo_vazio` (`20260917110000:53`), para a pergunta do fim valer alguma coisa;
- **só nome, categoria e cidade da ficha** — nunca endereço, bairro, nota ou site, pelo motivo de C(d) item 2;
- os horários livres da agenda, quando a intenção é de reunião — a lista fechada de que a seção B trata. **Enquanto a Fase 5 não subir, o tipo `agenda` nasce desligado**: o prompt não recebe lista, e frase de tipo `agenda` é bloqueio;
- a base de conhecimento inteira, por `baseComoTexto()`, e a voz, por `vozComoTexto()`, as duas no bloco `sistema` cacheável.

**O que ele devolve.** JSON validado por zod, e aqui está a peça central do desenho:

```
mensagem: string
frases: [{ texto, tipo, fatoId? }]     // a decomposição — ver abaixo
claims: string[]                        // ids de FATOS, como no followup-ligacao
foraDoAssunto: boolean
precisaDeGente: boolean + motivo
agenda: { horarioEscolhido } | null
porQue: string                          // uma linha, para quem revisa
```

`frases` é o que hoje não existe. O `followup-ligacao@v1` (`packages/prompts/src/prompts/followup-ligacao/v1.ts:42`) já devolve `claims`, e `claims` responde "usei o fato 8%". Não responde "o que mais eu disse". Com texto livre, a pergunta que importa é a segunda.

Então o modelo é obrigado a **quebrar a própria mensagem em frases e dizer o tipo de cada uma**, numa lista fechada de cinco:

| tipo | o que é | como o validador confere |
|---|---|---|
| `fato` | afirmação sobre a Komune | tem de trazer `fatoId` de `FATOS` (`base-conhecimento.ts:28`); os números têm de estar em `valores` |
| `pergunta` | a pergunta do fim | tem de terminar em `?` e não conter verbo de `LEXICO_DE_COMPROMISSO` |
| `cortesia` | abertura, ligação, desvio, fecho | tem de bater, literal, com `ABERTURAS`/`CONECTIVOS`/`DESVIOS`/`FECHOS` |
| `agenda` | dia e hora propostos | dia e hora têm de sair da lista que o CRM mandou; sem lista, bloqueio |
| `escape` | a frase de dinheiro sem resposta | tem de ser exatamente `FRASE_DE_ESCAPE_FINANCEIRO` (`base-conhecimento.ts:158`) |

A soma das frases tem de reconstruir `mensagem` — o validador confere isso, senão o modelo poderia declarar três frases e mandar quatro.

**O assunto é fechado, e isso é política da Meta.** Quando o lead puxa outro assunto, o modelo marca `foraDoAssunto: true` e devolve uma mensagem que só existe de `cortesia` (um `DESVIOS` literal) + `pergunta`. Não é o modelo se policiando por educação: frase de outro assunto não tem tipo possível na tabela acima, e sem tipo ela é bloqueada.[^E6]

### (d) O validador refeito: bloqueia, e fecha a paráfrase

Arquivo novo, `packages/prompts/src/nucleo/validador-resposta-livre.ts`, com `validarRespostaLivre(entrada)`. Ele **não substitui** `validarPromessas`: chama-o por dentro (é ele que já sabe de valor não autorizado, palavra proibida, URL fora da lista, tema financeiro sem resposta e os limites de forma) e acrescenta a camada de frases.

**Primeiro, o que muda de comportamento.** Hoje `validarPromessas` devolve, no caso bloqueado, `queda: 'texto_fixo' | 'humano'` (campo em `validador-promessas.ts:50`, valor decidido em `:242`) e o desenho todo se apoia em "a Heloísa aprova depois" (ADR-05). Sem aprovação humana, `queda` deixa de ser sugestão: **conteúdo reprovado não sai, ponto**, e `situacao: 'bloqueado'` passa a ser terminal.

**O furo que a própria casa registrou.** `packages/prompts/evals/validador-promessas.eval.test.ts:152` guarda, como caso conhecido desde 05/09/2026, a frase "Fica tranquilo que a gente dá um jeito no valor pra você entrar como fundador." Ela passa. Não tem número, não tem percentual, não tem palavra da lista. O comentário do arquivo diz a verdade: "quem segura é a aprovação humana (ADR-05)". Tirando a aprovação humana, essa frase sai para um fornecedor, e oferta feita vincula a empresa (CDC art. 30).

**Como ela passa a ser bloqueada.** Em dois níveis.

**Nível 1 — dentro do `validarPromessas`, porque é isso que o eval pede.** O `esperado` daquele caso é `bloqueado(['promessa_comercial'], 'humano')` (`:157`), e `promessa_comercial` ainda não existe em `CodigoDeBloqueio` (`validador-promessas.ts:23`). Então:

- `CodigoDeBloqueio` ganha `'promessa_comercial'`;
- `validarPromessas` ganha a varredura de `LEXICO_DE_COMPROMISSO`, **escopada**: só bloqueia quando o verbo de compromisso aparece na mesma frase que uma palavra de dinheiro ou condição (valor, preço, taxa, `%`, `R$`, condição, desconto, exceção). "a gente dá um jeito **no valor**" bate; "**consigo** te mandar o link agora" não bate, e continua passando;
- o código entra em `CODIGOS_QUE_EXIGEM_HUMANO` (`validador-promessas.ts:104`), que é o que produz `queda: 'humano'`.

Sem o escopo, metade dos rascunhos legítimos da equipe seria reprovada e a regra seria desligada na primeira semana.

**Nível 2 — os tipos, no `validarRespostaLivre`.** A mesma frase, se o Nível 1 falhar por alguma paráfrase, bate nas três travas do mundo fechado:

1. **Toda frase precisa de tipo.** Declarada como `cortesia`, ela não está em `CONECTIVOS`, `DESVIOS` nem `FECHOS` — cortesia é lista literal, e é literal exatamente por isso. Bloqueio `cortesia_fora_da_voz`.
2. **Léxico de compromisso.** Declarada como `fato`, carrega "dar um jeito". Verbo de compromisso dentro de frase de tipo `fato` é bloqueio `promessa_comercial`, sem escopo nenhum — num `fato` o léxico é proibido de saída.
3. **Pergunta é pergunta.** Declarada como `pergunta`, não termina em `?`. Bloqueio `tipo_errado`.

Não há quarto caminho: os tipos são cinco e `agenda` e `escape` são comparações literais. **O fechamento é por construção, não por detecção.**

O que isso custa, e é honesto dizer: o robô fica mais duro que uma pessoa. Uma frase nossa, boa, que não esteja em `CONECTIVOS` é bloqueada. O conserto é acrescentar a frase ao `voz-da-casa.ts` num PR — o que também é o jeito certo de a voz crescer, com alguém olhando.

**Ordem da conferência**, que não é detalhe: valida com os marcadores `[[NOME_1]]` ainda no lugar (senão a comparação literal de cortesia falha em toda mensagem que tem nome), depois `reidratar` (`nucleo/pseudonimizacao.ts:1111`), e então uma segunda passada **só de forma** — 300 caracteres, 4 linhas, 1 emoji, caixa alta (`LIMITES_PADRAO`, `validador-promessas.ts:60`) — mais a conferência de nome próprio do time **e a recusa de marcador sobrevivente** (se o regex `MARCADOR`, `pseudonimizacao.ts:179`, ainda casar depois da reidratação, o texto não sai). Porque "[[EMPRESA_1]]" e "Buffet Casa de Pedra Eventos e Recepções" não têm o mesmo tamanho.

**Evals.** `packages/prompts/evals/responder-livre.eval.test.ts`, no formato de `evals/executar.ts`: caso certo, caso conhecido com `obtido` e `desde`, e a régua `conhecidosEsperados` declarando quantos ainda erram (`executar.ts:41`, `:69`).

**Correção sobre o caso de 05/09.** Com o Nível 1 acima, o caso **é promovido no eval antigo**: apaga-se o bloco `conhecido` da linha 158 de `validador-promessas.eval.test.ts` e baixa-se `conhecidosEsperados` em um. Se, e só se, o Nível 1 for recusado na revisão por risco de falso positivo, o caso **não pode** ser promovido ali — `validarPromessas` recebe `{texto, claims}` e nunca vê `frases`, então nenhuma camada de tipos o alcança naquele arquivo. Nesse cenário o caso é copiado para o eval novo, contra `validarRespostaLivre`, e o bloco `conhecido` do eval antigo permanece com o `motivo` reescrito. Uma das duas coisas acontece; o que não pode acontecer é o eval antigo ficar verde por engano.

### (e) O que acontece quando o validador bloqueia

Quatro desfechos, escolhidos pelo motivo. Nenhum deles é "manda assim mesmo".

**Antes dos quatro, uma regra de ordem que conserta um furo do desenho anterior.** O veredito em `public.atendimento_decisoes` (§6.3, `message_id` como PK) é escrito **uma vez só, depois do validador**. A §6.3 diz que o único valor substituível é `aguardando_classificacao`, e uma vez só — então a sequência é: gatilho grava `aguardando_classificacao`; o worker classifica, o prompt escreve, o validador julga; e só aí a linha vira `robo` ou `pessoa`. Gravar `robo` antes de validar e regravar `pessoa` depois é uma segunda substituição, que a PK e a regra da §6.3 recusam.

**1. Bloqueio de conteúdo** (frase sem tipo, léxico de compromisso, valor não autorizado, claim sem base, nome do time, fora do assunto): **a conversa não recebe resposta do robô.** Em uma transação: veredito `pessoa` com `motivo = 'validador_bloqueou'`, `conversations.bot_paused = true`, `status = 'aguardando_nos'`, e uma `tasks` (`20260904000300:509`) com `priority 1` e `due_at = now()` — o mesmo desfecho que "intenção sem modelo ligado" já produz na §6.4. O rascunho **não é jogado fora**: fica em `public.message_drafts` (`20260905000200:844`) com `kind = 'resposta'`, `status = 'pendente'`, `proposed_body`, `proposed_claims` e o veredito inteiro em `validator`, que é jsonb e é para isso que existe (`:895`). Quem abre a caixa vê o que a IA quis dizer e por que não saiu. Uma tentativa por mensagem, sem repique: a PK de `atendimento_decisoes` garante isso, e `message_drafts_um_pendente_por_conversa` (`:908`) garante que não se empilhem dois rascunhos pendentes no mesmo fio.

**2. Não fica mudo à noite.** Com a regra de ordem acima, o veredito de um bloqueio **é** `pessoa`, e `app.ausencia_responder(p_message_id)` (`20260922120000:122`)[^E3] é chamada na mesma transação, com o corpo de `GEN-SYS-AUSENCIA` reescrito na §6.7 e a trava de 12 h por conversa (`:157`).

**E há uma armadilha concreta, que precisa entrar no desenho da §6.6.** `ausencia_responder` recusa com `ja_respondida` se existir **qualquer** saída na conversa com `created_at >=` a mensagem que chegou (`:150–153`). A §6.6 manda enviar `GEN-SYS-TRANSPARENCIA` "imediatamente antes da primeira resposta automática". Se a transparência sair primeiro e o validador bloquear depois, o lead recebe só o aviso de robô e mais nada, às 22h. Então: **a transparência sai na mesma transação da resposta aprovada, nunca antes dela.**

**Não criamos um texto de contenção.** Um "estou verificando aqui" seria mentira (ninguém está verificando às 22h) e seria uma segunda mensagem por cima da de ausência.

**3. Dúvida financeira sem resposta** (`situacao: 'substituido'`, `validador-promessas.ts:142`): este é o único caso em que sai texto. Vai a `FRASE_DE_ESCAPE_FINANCEIRO` — "Vou confirmar com o financeiro e te respondo hoje." — como `bot_fixed`, por `app.wa_bot_dizer` (`20260916110000:192`), num modelo novo `GEN-SYS-FINANCEIRO-CONFIRMA`, `channel='whatsapp'`, `is_active`, **sem nenhuma variável** (a função copia `t.body` cru, `:211`; um `{{ }}` sairia literal no fio). Mais tarefa para o Dennis. Sai por `bot_fixed` de propósito: o corpo é copiado da linha do modelo dentro de função `security definer`, e a IA não escreveu uma palavra dele. Como toda fala de robô, conta no teto de 6 falas por conversa da §5.4 e passa pelo ramo novo do guard — se o teto estourou, nem ela sai, e a conversa cai para gente com a despedida `GEN-SYS-HUMANO`.

**4. Bloqueio só de forma** (passou de 300 caracteres, dois emojis, gritou): uma segunda tentativa, antes de gravar o veredito, com o motivo anexado à mensagem. Se falhar de novo, cai no desfecho 1. Uma repetição só, e o custo é uma chamada a mais em poucos por cento dos casos. As duas chamadas viram duas linhas em `ai_runs`, como manda o guardrail de auditoria da §10.

**A trava que precisa ser afrouxada.** Hoje `app.messages_guard` (`20260916130000:134`) recusa `author_kind = 'bot_ai'` sem `draft_id` (`:136`), exige que o rascunho esteja `aprovado` ou `enviado` (`:140`) **com `reviewed_by` preenchido** (`:144`), exige `body = d.final_body` (`:150`) e grava `new.approved_by := d.reviewed_by` (`:154`); a constraint `message_drafts_aprovado_tem_gente` (`20260905000200:880`) diz a mesma coisa do outro lado. Isso é o ADR-05 em código. O mínimo necessário, e nada além:

- `message_drafts.status` (`20260905000200:867`) ganha o valor **`'liberado_pelo_validador'`**[^E1], **fora** da constraint que exige revisor;
- **uma constraint nova, `message_drafts_liberado_tem_prova`**: nesse status, `final_body` não pode ser nulo nem vazio, `jsonb_array_length(proposed_claims) > 0` e `validator ->> 'situacao' = 'aprovado'`. Sem a parte do `final_body`, o guard compara `body` com `null`, recusa, e o erro que aparece é o errado; sem as outras duas, sai qualquer coisa;
- **o texto cabe em 1000 caracteres, não em 300**: `message_drafts_tamanho` (`:889–890`) já limita `proposed_body` e `final_body` a 1000, embora o comentário acima fale em 300 por turno do RF-CON-24. O limite de forma de verdade é o do validador, que roda antes;
- a versão da base entra como coluna nova `base_versao text` (`VERSAO_DA_BASE`, `base-conhecimento.ts:26`, hoje `'2026-09-08'`); `prompt_version` (`:855`), `proposed_claims` (`:864`) e `validator` (`:865`) **já existem** — é uma coluna, não quatro;
- **o status é terminal**: o rascunho fica em `liberado_pelo_validador` mesmo depois de a mensagem sair, porque `'enviado'` exige `reviewed_by`. Quem diz que saiu é `message_drafts.message_id`. A máquina de estados de `app.message_drafts_guard` (`20260905000200:933`) aprende a transição `pendente → liberado_pelo_validador` e nenhuma saída dela;
- `app.messages_guard` ganha um ramo para `bot_ai` com esse status, que exige as cinco coisas: `validator ->> 'situacao' = 'aprovado'`, `validator ->> 'versao_do_validador'` igual à vigente, `body` idêntico a `final_body`, `template_id is null` (texto livre não é modelo) e `app.atendimento_liga('robo_escreve')` verdadeiro. E **`approved_by` fica nulo** — nenhuma mensagem automática pode parecer aprovada por gente;
- tudo o mais do guard continua: supressão, janela de 24 h, tetos, `app.pode_enviar`, e o ramo de teto de fala que a Fase 3 acrescenta em §5.4;
- **toda resposta aprovada também gera uma linha em `message_drafts`**, não só as bloqueadas — é o `draft_id` que o guard exige. É essa linha que a amostragem de (f) lê.

A spec adotou o princípio "o guard só é tocado para apertar" (§1, linha 42, e nota 1) e lista em §10 "Nada redigido por IA sai sem rascunho aprovado — não muda uma linha nesta spec". **As duas frases mudam**, e a mudança é a decisão do Rafael de 25/09. A linha correspondente da §10 passa a ser: *nada redigido por IA sai sem passar pelo validador de mundo fechado, e a versão do validador fica gravada na linha que autorizou a saída.*

### (f) Como se mede se ela está escrevendo bem

**O requisito é o RF-CON-28** (PRD linha 361: amostragem semanal de 30 conversas com nota — "prometeu algo?", "soou robô?", "escalou certo?"), não o RF-CON-22 (linha 355), que é a regra de aprovação humana e só menciona a amostragem de passagem. A §6.9 cita o RF-CON-22 aqui; é engano e se corrige junto.

**Amostragem diária nos primeiros 14 dias, depois semanal.** A §6.9 previa a view `public.robo_amostra_semanal`; ela é substituída por **`public.robo_amostra(p_desde date, p_ate date) returns table`**[^E4] — é função, não view, porque recebe período. Lê `atendimento_decisoes` + `messages` + `message_drafts`, e a tela de Ajustes → Atendimento escolhe o intervalo. Diária enquanto `atendimento.amostra_diaria` for verdadeira. A cadência semanal do RF-CON-28 continua valendo depois dos 14 dias, com as 30 conversas que ele pede.

**Tamanho da amostra: 20 mensagens por dia, ou todas, se forem menos.** No teto de 900 conversas por mês (§6.9) e ~3 falas do robô por conversa, são 2.700 mensagens por mês, **90 por dia**. Vinte é 22% delas, e é o bastante: se o robô estiver errando 15% das vezes, a chance de a amostra de 20 não pegar nenhum erro é 0,85²⁰ ≈ 4%.

**O que a pessoa olha, exatamente.** Seis perguntas de sim ou não, gravadas em `public.robo_amostra_veredito` (`message_id` PK, revisor, os seis booleanos, comentário livre), com RLS: `select` para `authenticated`, escrita só por `app.is_manager()` — quem julga o robô é quem responde por ele.

1. **Respondeu o que foi perguntado?** Não é "está bem escrito". É se a resposta serve para aquela mensagem. É o erro que o validador não pega, por construção.
2. **Afirmou só o que está na base?** Ler o texto ao lado de `message_drafts.proposed_claims` (`20260905000200:863`). Se afirmou algo sem `claim`, é falha do tipo 1 e o robô é desligado no mesmo dia.
3. **Parece nós?** "a gente", "me diz", frase curta. Se apareceu "prezado" ou "parceria", a voz está vazando para fora do `voz-da-casa.ts`.
4. **A pergunta do fim é única e respondível?** Duas perguntas numa mensagem de WhatsApp costumam virar zero respostas.
5. **Se marcou reunião, o horário existe e está entre 9h30 e 17h20?** Confere com a agenda do CRM — seção B. Enquanto a Fase 5 não subir, esta pergunta sai da lista, porque o tipo `agenda` está desligado.
6. **Eu teria mandado isso?** A única que importa. As cinco de cima explicam por que a sexta deu não.

**As duas portas de saída, com número.**

- **Qualquer "afirmou fora da base"** → `select public.atendimento_configurar('{"robo_escreve": false}'::jsonb)` no mesmo dia. Um comando, sem deploy. **E isto não funciona de graça.** `public.atendimento_configurar` (`20260922120000:215`) só olha as chaves do `foreach k in array['lead_automatico','distribuicao_automatica','ausencia_ativa']` (`:229`) e **ignora em silêncio** o que não está lá; `app.atendimento_liga` (`:30`) devolve `false` para chave ausente. Então a migração faz as duas coisas, como a §6.8 já mandou fazer com `robo_responde`: acrescenta `robo_escreve` ao array **e semeia `robo_escreve: false`** em `app_settings`.
- **Três dias seguidos com 95% ou mais de "eu teria mandado"**, sobre pelo menos 20 mensagens por dia — em 20, isso é **no máximo um "não"** → a amostragem passa a semanal, na cadência do RF-CON-28. **Abaixo de 90% em qualquer dia** — três "não" ou mais em 20 — o robô volta a rascunho e uma pessoa aprova.

**Por intenção, não só no total.** A função quebra o resultado por `atendimento_decisoes.intencao`. É assim que se descobre que ele vai bem em "manda o link" e mal em "quanto custa" — e é por isso que desligar é por intenção antes de ser geral.

**O que a amostragem não mede:** custo. Esse está em `public.ia_orcamento_status()` (`20260925150000:468`), e o aviso é outro: `draft_reply` **não** sobrevive à linha de alerta. `app.ia_pode_gastar` (`20260925150000:234`) deixa passar, acima do limite de alerta, só `classify_inbound` e `transcribe_audio` (`:253–254`), por exclusão e de propósito. Traduzindo: a partir de 80% do orçamento, **o robô emudece e tudo cai para gente**. Está certo assim — é o lado seguro —, mas a coisa mais nova é a primeira a parar, e, quando ela parar, quem responde à noite é o texto de ausência, não ninguém.

---

## B. O calendário do CRM, e a reunião como objeto de verdade

As três coisas pedidas — calendário nosso, IA marcando sozinha, e-mail avisando — dependem de uma quarta que ninguém pediu mas sem a qual nenhuma funciona: **o CRM precisa ter uma reunião**. Hoje ele não tem. Tem tarefa com prazo, e é outra coisa.

### B.1 Por que não cabe em `tasks`

O cabeçalho de `apps/web/src/components/agenda/tipos.ts` já escreveu o problema:

> `meeting` não quer dizer "reunião marcada". Metade das tarefas desse tipo na base real é "Marcar apresentação" (…) a hora que ela carrega (09:00) é o prazo calculado pela régua do RF-MET-06, não uma hora combinada com ninguém.

A tela contorna com uma régua indireta: chama de `marcado` só o que está numa etapa cujo `stages.required_fields` exige `meeting_at` (`agenda/dados.ts`, `etapasQueMarcamHora`). Funciona para desenhar, e não resolve nada para agendar. Olhando a coluna, `public.tasks` (`supabase/migrations/20260904000300_parceiros_e_funil.sql:509`) não tem **fim** (só `due_at`), não tem **lugar nem link**, não tem **quem participa** (`assignee_id` é fila de trabalho, não lista de presença) e não tem **estado de reunião** — `app.task_status` é `todo | doing | done | cancelled` (`20260904000100:64`), e "remarcada", "não compareceu" e "confirmada pelo parceiro" são metade do que se quer saber.

E o argumento que fecha a discussão: **não dá para pôr trava de colisão em `tasks`**. Uma restrição de exclusão sobre (responsável, intervalo) faria as nove "Marcar apresentação" de terça — todas nascidas às 09:00 pela régua do catálogo — recusarem umas às outras. A tabela que precisa proibir sobreposição é uma tabela onde sobreposição é erro. Em `tasks` ela é o dia normal.[^E2]

Então nasce `public.reunioes`, e `tasks` continua exatamente como está.

### B.2 (a) A tabela

Migração `20260930110000_a_reuniao_vira_objeto.sql`.[^E5]

```sql
create extension if not exists btree_gist with schema extensions;

create table public.reunioes (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  deal_id          uuid references public.deals (id)         on delete set null,
  conversation_id  uuid references public.conversations (id) on delete set null,
  contact_id       uuid references public.contacts (id)      on delete set null,
  -- Quem ATENDE. É dele a agenda que fica ocupada, e é ele quem recebe o e-mail.
  dono_id          uuid not null references public.profiles (id) on delete restrict,
  titulo           text not null,
  formato          text not null default 'online' check (formato in ('online','presencial')),
  inicio           timestamptz not null,
  fim              timestamptz not null,
  durante          tstzrange generated always as (tstzrange(inicio, fim, '[)')) stored,
  -- Sala, quando online. Endereço, quando presencial. Nunca os dois.
  link             text,
  local            text,
  estado           text not null default 'marcada'
                     check (estado in ('marcada','confirmada','realizada',
                                       'nao_compareceu','cancelada','remarcada')),
  marcada_por      text not null check (marcada_por in ('robo','pessoa')),
  marcada_por_id   uuid references public.profiles (id) on delete set null,
  remarcada_de     uuid references public.reunioes (id) on delete set null,
  -- O espelho em `tasks`: ver B.2.1. É a linha que a fila do dia já sabe ler.
  task_id          uuid references public.tasks (id) on delete set null,
  aviso_enviado_em timestamptz,
  observacao       text,
  criada_em        timestamptz not null default now(),
  atualizada_em    timestamptz not null default now(),
  constraint reunioes_intervalo_chk check (fim > inicio),
  constraint reunioes_lugar_chk check (
    (formato = 'online'     and link  is not null) or
    (formato = 'presencial' and local is not null)),
  constraint reunioes_robo_chk check (
    (marcada_por = 'robo'   and marcada_por_id is null and conversation_id is not null) or
    (marcada_por = 'pessoa' and marcada_por_id is not null)),
  -- A TRAVA. Duas reuniões vivas da mesma pessoa não se sobrepõem. No banco.
  constraint reunioes_sem_colisao exclude using gist (
    dono_id with =, durante with &&) where (estado in ('marcada','confirmada'))
);
```

**`durante` é coluna gerada, e não calculada na consulta,** porque a restrição de exclusão precisa de um valor indexável; o construtor de três argumentos `tstzrange(timestamptz, timestamptz, text)` é imutável, então o Postgres aceita.

**`btree_gist` é a extensão nova** — só ela dá a classe de operadores que deixa `uuid with =` conviver com `tstzrange with &&` no mesmo índice GiST. O banco é Postgres 17 (`supabase/config.toml:46`), onde a classe de `uuid` existe. Entra com `with schema extensions`, como `postgis` já entrou em `20260905000600_rotas.sql:114`.

**`organization_id` é obrigatório, e isso tem consequência.** `conversations.organization_id` é **nulável** (`20260905000200:610`), e "conversa fora da base" é um estado real e comum — tem migração própria (`20260915130000`) e aba própria na tela (`/conversas?aba=fora`). Então `reuniao_marcar` chamada de uma conversa sem ficha **recusa com `sem_ficha`** e o árbitro manda a conversa para uma pessoa. Marcar reunião com alguém que o CRM não sabe quem é produz um compromisso que ninguém consegue preparar.

**Dono:** `deals.owner_id` quando há negócio; senão `conversations.assignee_id`, que é `not null` (`20260905000200:613`). O robô **não** procura horário na agenda de outra pessoa: trocar de dono em silêncio para achar vaga é o jeito de a carteira virar rodízio.

**RLS:** ligada, `select` para `authenticated` por `app.org_is_visible(organization_id)` (`20260904000500:70`) — a mesma régua de `organizations_view`, não uma segunda cópia. `insert`, `update` e `delete` revogados de `authenticated`: escrita só pelas funções de B.4, como `public.compromissos_no_google` já fazia. Gatilho `reunioes_audit after insert or update or delete ... execute function app.audit()` (`20260904000400:216`), porque reunião marcada por robô é exatamente o tipo de escrita que o CLAUDE.md manda auditar.

**O link da sala é congelado na linha, e nunca lido de `profiles` na hora de desenhar.** A política `profiles_select` é `id = auth.uid() or app.is_manager()` (`20260904000500:110-111`): um `sdr` não lê o perfil de outra pessoa, e o cartão do colega apareceria sem sala. Então `reuniao_marcar` copia a sala para `reunioes.link` no momento da escrita — com o efeito conhecido de que trocar a sala em Ajustes **não retroage** às reuniões já marcadas. O nome de quem atende vem de `public.team_directory` (`20260904000500:142`), que é a view feita para isso.

#### B.2.1 O espelho em `tasks` fica, e é de propósito

Quatro lugares já contam `tasks.kind in ('meeting','visit')`: o pulso do dia (`20260917120000:113`), o dreno (`20260905000100:802` e `:857`) e a tela das cadências (`20260904001890:383`). Se a reunião existisse só na tabela nova, esses quatro passariam a mentir por omissão no dia seguinte.

Então `public.reuniao_marcar` insere as duas coisas na mesma transação: a linha em `reunioes` e a `tasks` (`kind = 'meeting'`, `due_at = inicio`, `assignee_id = dono_id`, `origin = 'ai'`), guardando o id em `reunioes.task_id`. A tabela nova é a verdade; a tarefa é o eco que o resto do sistema já sabe ler. **A tela filtra o eco** para não desenhar o mesmo compromisso duas vezes (B.6).

### B.3 (b) Disponibilidade: como o CRM sabe que um horário está livre

Configuração em `public.app_settings` (`20260904001700:95`), chave `agenda.reunioes` — o mesmo lugar onde o planejador de rota já mora (`rotas.planejador`, `20260905000600:425`):

```json
{ "janela": {"inicio": "09:30", "fim": "17:20"},
  "duracao_min": 40, "intervalo_min": 10, "pausa": null,
  "antecedencia_min_horas": 3, "horizonte_dias_uteis": 10,
  "max_por_dia_por_pessoa": 4, "sala_padrao": null }
```

**A grade.** Reunião de **40 minutos** com **10 de intervalo** — ciclo de 50. Saindo das 9h30, os começos possíveis são 9h30 · 10h20 · 11h10 · 12h00 · 12h50 · 13h40 · 14h30 · 15h20 · 16h10. O de 17h00 fica de fora porque terminaria 17h40. Os 30 minutos entre 16h50 e 17h20 não são desperdício: são a folga que absorve a reunião que passa da hora.

Os 40 minutos: o RF-AGE-01 (`docs/PRD-CRM-Captacao-KOMUNE-v1.0.md:381`) pede 30 (20 de apresentação + 10 de folga) e a rota `/api/agenda/evento` usa 45 (`MINUTOS_REUNIAO = 45`, `route.ts:43`). Fica 40, porque é o único valor que fecha uma grade limpa dentro da janela que o Rafael deu, e porque 30 com 10 de intervalo dá 11 reuniões num dia — número que só existe no papel.

**Almoço: nenhum, por ora.** `"pausa": null`. A janela veio com precisão de minuto; abrir um buraco de meio-dia que ninguém pediu seria decidir pelo Rafael. O campo existe para o gestor pôr `{"de":"12:00","ate":"13:30"}` num `update` de uma linha, sem deploy, no dia em que a primeira reunião de 12h50 furar.

**`app.reuniao_horarios_livres(p_dono uuid, p_de date, p_ate date, p_limite int default 3)`**, `stable`, devolve `(inicio, fim)` e corta um horário por seis motivos, nesta ordem:

1. **Não é dia útil.** `extract(isodow from d) < 6 and not exists (select 1 from public.holidays h where h.date = d)` — `public.holidays` tem a coluna `date` (`20260904000200:241-247`). Essa regra hoje está escrita dentro de `app.next_business_day` (`20260904000200:265`). Extraio para `app.eh_dia_util(date) returns boolean` e faço `next_business_day` chamá-la — uma regra, dois usos, ADR-03.
2. **Cedo demais.** `inicio < now() + interval '3 hours'`.[^E7] O robô não marca para daqui a 40 minutos: a pessoa precisa ver antes de acontecer.
3. **Longe demais.** Além de `app.next_business_day(hoje, 10)`. Reunião marcada com três semanas de antecedência é no-show com data.
4. **Colide com outra reunião.** `exists (select 1 from public.reunioes r where r.dono_id = p_dono and r.estado in ('marcada','confirmada') and r.durante && tstzrange(...))`.
5. **Colide com a rota da tarde.** Se existe `public.route_plans` (`20260905000600:316`) para `(dono, dia)` com `status in ('enfileirada','pronta')` — dois dos três valores de `app.route_status` (`:312`) —, a janela inteira de `app_settings.rotas.planejador.janela` (hoje `14:00`–`18:00`, `:434`) está ocupada. **Bloqueio a tarde inteira, não parada por parada**, porque `public.route_stops` guarda `seconds_from_prev` (`:363`) mas não guarda quanto dura cada visita — calcular o fim da rota seria inventar número. O efeito prático é o desenho do próprio RF-AGE-01: apresentação de manhã, visita à tarde.
6. **Colide com tarefa de campo.** `tasks` com `kind in ('meeting','visit')`, `status in ('todo','doing')`, do mesmo responsável, cujo `due_at` caia dentro do horário — descontando a tarefa-eco da própria reunião. Aqui o intervalo é o dado pobre, então trato `due_at` como um ponto e corto o horário que o contém. Menos horários oferecidos, nenhuma promessa falsa.

E, por último, o **teto**: `max_por_dia_por_pessoa = 4`. O RF-AGE-01 fala em 4 **por manhã** para apresentação e 4 **por tarde** para visita; aqui a grade atravessa os dois turnos, então 4 por dia é mais apertado do que o PRD pedia — de propósito. Robô que enche o dia de alguém com nove reuniões é robô que a equipe desliga na segunda semana.

**A sala.** Sem Google, sem Meet. `public.profiles` (`20260904000200:18`) ganha `sala_url text` — cada pessoa cola o link permanente da sala dela, em Ajustes. A política `profiles_update` já deixa cada um editar a própria linha (`20260904000500:114-116`) e o gatilho `app.profiles_guard` (`:121`) só protege papel, status e time, então nada de migração de permissão. Quando `sala_url` é nulo, vale `agenda.reunioes.sala_padrao`. Quando os dois são nulos, `reuniao_marcar` recusa com `sem_sala` e a conversa vai para uma pessoa: melhor o robô dizer "já te confirmo" do que marcar uma reunião sem onde acontecer.

### B.4 (c) Como a IA marca

**Duas ferramentas, e a segunda é a única que escreve.**

`public.reuniao_horarios(p_conversation_id uuid, p_limite int default 3)` → `stable`, `security definer`, `grant execute to service_role`. Resolve o dono a partir da conversa, chama `app.reuniao_horarios_livres` e devolve, para cada opção, `{inicio, fim, quando_por_extenso}` — onde `quando_por_extenso` é `to_char` no fuso `America/Fortaleza`, pronto: *"quinta-feira, 1º de outubro, às 10h20"*. **O modelo nunca faz conta de data.** Ele recebe a frase e copia. Data calculada por modelo de linguagem é o erro que só aparece quando o parceiro não vem.

`public.reuniao_marcar(p_conversation_id uuid, p_inicio timestamptz, p_formato text default 'online', p_observacao text default null)` → `volatile`, `security definer`, `grant to service_role`. Quando `auth.uid()` é nulo é o robô (`marcada_por = 'robo'`).

**E a irmã dela:** `public.reuniao_marcar_pelo_negocio(p_deal_id uuid, p_inicio timestamptz, p_formato text, p_local text default null, p_observacao text default null)`, `grant to authenticated`. É por aqui que **uma pessoa** marca pela tela, porque a maior parte dos negócios do funil não tem conversa de WhatsApp nenhuma — sem ela, o botão "Marcar" da Agenda não teria como existir. Grava `marcada_por = 'pessoa'`, `marcada_por_id = auth.uid()`, `conversation_id = null` — o ramo que `reunioes_robo_chk` já permite. As duas chamam o mesmo corpo em `app`.

Dentro, na ordem:

1. `pg_advisory_xact_lock(hashtextextended(v_dono::text || v_dia::text, 0))` — serializa por (pessoa, dia). Isso protege as regras **moles**: o teto de 4, a rota, os feriados. Dois `select` concorrentes passariam os dois pelo teto; com o lock, o segundo espera e vê o primeiro.
2. Reconfere `app.reuniao_horarios_livres` para aquele horário exato. Entre a oferta e o aceite o parceiro demora — às vezes horas.
3. `insert into public.reunioes`. **Aqui está a trava dura.** Se outra transação já inseriu no mesmo intervalo para a mesma pessoa, o `exclude using gist` levanta `23P01`:

```sql
exception when exclusion_violation then
  return jsonb_build_object('ok', false, 'motivo', 'horario_tomado',
                            'alternativas', public.reuniao_horarios(p_conversation_id, 3));
```

O robô recebe as alternativas no mesmo retorno e responde *"esse acabou de ser ocupado — consigo às 11h10 ou às 14h30"*. Sem segunda ida ao banco e sem o modelo inventar a recuperação.

**Por que a trava está no banco e não no worker:** o worker-ai é um processo, e daqui a pouco serão dois. Um `select` que pergunta "está livre?" seguido de um `insert` é uma janela de corrida, sempre, em qualquer linguagem. A restrição de exclusão não é uma checagem: é o índice recusando escrever. Não existe caminho que a contorne, nem por worker novo, nem por Edge Function, nem por alguém no SQL Editor.

4. Insere a `tasks`-eco (B.2.1).
5. Move o negócio, **quando há negócio** — conversa sem `deal_id` pula este passo em vez de falhar. O destino é a etapa que exige `meeting_at`: `reuniao_marcada` no funil fornecedor (`supabase/seed.sql:475`), `demonstracao_marcada` no produtor (`:613`).

   **E aqui está o detalhe que derruba a função se for esquecido.** O gatilho `app.deals_before_write()` (`20260905000800:110`) cobra `stages.required_fields` em **qualquer** `UPDATE` de etapa, não só no `move_deal` — foi escrito assim de propósito, "para que um UPDATE direto não burle o que o move_deal cobra". Para uma spec de tipo `timestamptz` ele exige `new.next_action_at is not null`, senão levanta `23514`. Então o `update public.deals` de `reuniao_marcar` grava **`next_action_at = p_inicio` no mesmo comando** da mudança de etapa. Sem essa linha, toda reunião marcada pelo robô falha na quinta instrução, e o erro só apareceria em homologação.

   **Não por `public.move_deal`** (`20260905000800:201`), que exige `auth.uid()` e o robô roda como `service_role`: é função em `app` escrevendo `public.deals` e `public.deal_stage_history` (`20260904000300:359`, `changed_by` nulo = automação) com autoria de sistema, exatamente o precedente que a §7.8 fixou para o webhook da Komune.
6. Enfileira o aviso (B.5) por `app.esteira_enfileirar` (`20260904001600:1524`), **na mesma transação** — é o que garante que não existe reunião marcada sem aviso pendente.

**O que ela responde ao lead.** Texto livre, escrito pela IA, com três amarras: (i) dia, hora e formato vêm de `quando_por_extenso` e não do modelo; (ii) o link da sala vem do retorno da função, não da cabeça dele; (iii) o texto passa pelo validador da seção A antes de sair.

**Uma correção à §6.9.** A §6.9 desenhou `app.texto_automatico_valido(text)` para rodar **no cadastro do modelo, não a cada envio** — o que fazia sentido quando o robô escolhia entre textos prontos. Com o ADR-14 não há cadastro de modelo a validar: o texto nasce na hora. Então a função passa a rodar **no envio**, e um texto reprovado não sai — vira rascunho para pessoa. É mais chamada por mensagem, e é o preço de texto livre. Reunião marcada é justamente o momento em que mais dá vontade de prometer condição comercial. (`app.texto_automatico_valido` continua existindo para o cadastro dos textos fixos que sobram; são coisas diferentes e as duas ficam.)

**Antes de tudo isso**, valem o opt-out por regra e a conferência de supressão do árbitro (§6.3, ordens 1 e 2). Marcar reunião para quem acabou de pedir para sair é pior do que responder.

### B.5 (d) O e-mail

Já existe envio: `apps/workers/src/whatsapp/aviso-por-email.ts`, pelo Resend, configurado em `app_settings.notificacoes.email` (`20260916120000_o_aviso_por_email.sql`) e disparado pelo worker-wa (`apps/workers/src/workers/wa.ts:229`, que chama `avisarDoQueChegou` em `:276`). Reaproveito o cano, não o corpo: extraio `enviarPeloResend(assunto, texto, config, chave, logger)` de `avisarPorEmail` (`:105`) e escrevo `apps/workers/src/whatsapp/aviso-de-reuniao.ts` como segundo chamador.

**Uma coisa muda na extração, e ela é obrigatória.** `avisarPorEmail` hoje **engole o erro e devolve `false`** (o `catch` de `:133`) — o comentário de `:102` explica por quê: "aviso que derruba a fila de entrada é pior que aviso que não chega". Para a fila de entrada isso está certo. Para uma fila com retentativa, está errado: mensagem que "deu certo" é arquivada, e as cinco tentativas prometidas nunca acontecem. Então `enviarPeloResend` devolve um resultado discriminado (`{ok:true}` / `{ok:false, transitorio:boolean}`); `avisarDoQueChegou` continua ignorando a falha como hoje, e o consumidor de `reuniao_avisos` devolve a mensagem à fila quando `transitorio`.

**Quem consome:** o **worker-wa**. Não porque seja o único sempre ligado — existem `infra/nuvem/fly.worker-ai.toml` e `fly.worker-ingest.toml` ao lado de `fly.worker-wa.toml` —, mas porque é nele que já vivem a chave do Resend (`env.RESEND_API_KEY`) e o laço que lê fila. Segundo worker para mandar um e-mail é infraestrutura nova para resolver problema que não existe.

Fila nova `reuniao_avisos` em `public.ingest_queues` com `worker = 'wa'` — valor aceito pelo `ingest_queues_worker_check`, que admite `ingest | wa | ai | rotas` (`20260905000600:386-388`) —, `visibility_seconds` 120, `max_attempts` 5, e `dlq = 'reuniao_avisos_dlq'` (fila irmã, `max_attempts` 1, `dlq` nulo, como `ingest_dlq` e `rotas_dlq`). **E o `pgmq.create` das duas**, no mesmo laço `do $$ ... end $$` que `20260905000600:405-410` usa: inserir em `ingest_queues` não cria a fila, e `app.esteira_enfileirar` chamaria `pgmq.send` numa fila inexistente — derrubando a transação de `reuniao_marcar` inteira, não só o aviso.

**Quem recebe:**

- **O dono da reunião.** `public.profiles` (`20260904000200:18`) não tem coluna de e-mail; ele está em `auth.users`. Entra `app.email_de(p_user_id uuid) returns text`, `security definer`, só `service_role`.
- **A lista do time**, `notificacoes.email.para` — hoje `["komune@komune.app.br"]`.
- **O lead não recebe e-mail.** Ele falou por WhatsApp e foi por WhatsApp que consentiu; muitos não têm e-mail na ficha. A confirmação dele é a mensagem do robô. E-mail para o lead exige base legal declarada e um `consent_events` que não existe — vira item só quando houver.

**O que diz:** assunto `Reunião marcada: <parceiro> — quinta, 01/10, 10h20`. Corpo em texto puro: parceiro, dia e hora por extenso, formato, quem vai atender, quem marcou (**"marcada pelo robô"**, com todas as letras), o link da ficha e o link da conversa. **Não vai o telefone do parceiro** — o aviso atual já corta para os quatro últimos dígitos (`finalDoNumero`, `aviso-por-email.ts:56`) porque e-mail é caixa fora da RLS e telefone completo lá é PII exportada sem `pii_access_log` (RF-BAS-14). A mesma régua aqui, reusando a mesma função.

**Se o e-mail falhar, a reunião fica marcada.** Sem discussão. Ela já foi gravada e confirmada ao parceiro antes de o Resend entrar na história. O que acontece é isto: a mensagem volta para a fila com backoff (`app.esteira_falhou`, `20260905000200:1947`), tenta cinco vezes, e na quinta cai em `reuniao_avisos_dlq`. E, como fila silenciosa também é falha silenciosa, `reunioes.aviso_enviado_em` continua nulo — **e o cartão na Agenda mostra "o time não foi avisado por e-mail"**.

### B.6 (e) A tela

A Agenda muda pouco na forma e muito na fonte.

- **`agenda/consultas.ts`** — a consulta das `tasks` continua sendo a primeira, sozinha; o que muda é o `Promise.all` que vem depois, que hoje tem **três** entradas (`orgs`, `negocios`, `espelhos`). A terceira, `compromissos_no_google`, é trocada por `reunioes` da janela da semana. As `tasks` cujo `id` aparece em `reunioes.task_id` são descartadas: a reunião entra pelo objeto, não pelo eco. Falha ao ler `reunioes` derruba a semana — diferente do espelho do Google, cujo erro era engolido de propósito no mapa `porTarefa` porque era enfeite. Sem `reunioes` a lista fica errada, não incompleta. O comentário do cabeçalho ("Três consultas em paralelo") é reescrito junto.
- **`agenda/tipos.ts`** — `Compromisso` perde `google` e ganha `reuniaoId`, `fim`, `link`, `local`, `estado` e `marcadaPeloRobo`. A régua `etapasQueMarcamHora` de `dados.ts` **continua**, agora só para classificar as `meeting` antigas que não têm reunião: `marcado` passa a querer dizer "tem linha em `reunioes`". As listas passam a usar `c.reuniaoId ?? c.taskId` como chave de React (`lista-dia.tsx:88`).
- **`lista-dia.tsx` e `visao-semana.tsx`** — o bloco "Com hora marcada" (`lista-dia.tsx:82`) mostra **`10h20–11h00`**, e não só o começo (`visao-semana.tsx:99-103`). É a primeira vez que o produto tem fim para mostrar.
- **`cartao-compromisso.tsx`** — `BotaoDoGoogle` (importado em `:20`, usado em `:216`) sai e entra `AcoesDaReuniao`: **Entrar na sala** (`link`, quando online), **Remarcar**, **Cancelar**, mais o selo discreto "marcada pelo robô" quando `marcada_por = 'robo'`. Esse selo não é enfeite: é o que permite ler a amostragem da §A sem abrir cada conversa.
- **Cancelar e remarcar ficam no cartão.** `public.reuniao_cancelar(p_id, p_motivo)` e `public.reuniao_remarcar(p_id, p_novo_inicio)`, `security definer`, para `authenticated`, conferindo `app.org_is_visible` e papel. Remarcar **não** altera a linha: marca a antiga como `remarcada`, cria a nova com `remarcada_de` apontando para ela, e enfileira o aviso de novo.
- **A folha de remarcar mostra os horários livres** vindos de `app.reuniao_horarios_livres`. Pessoa e robô escolhem da mesma grade — senão a pessoa marca por cima da rota e a grade vira ficção.
- **Uma tira de "livres hoje"** sob o cabeçalho do dia, com os horários vagos em chip. É a tela respondendo "o que o robô pode oferecer no meu nome hoje".
- **`tela-agenda.tsx`** — `<ConexaoDaAgendaGoogle />` (import em `:10`, uso em `:279`) sai, e com ela o rodapé de configuração. O `toast` de `resultado.avisoDaAgenda` (`:142-146`) some. O `AindaNaoLigado` (`:312`) é reescrito: o item "Horários livres do Google" (`:317-320`) **passa a ser mentira e some**; o item dos lembretes de 24 h fica, **com texto novo**, porque o de hoje já está errado — ele diz que eles "dependem do número oficial na Cloud API da Meta, que entra com o módulo de Conversas" (`:322-324`), e o número está na Cloud API desde 14/09. O que falta agora é aprovação de template (B.7).

### B.7 (f) O lembrete na véspera: fica para depois, e por um motivo conferível

**Não entra nesta fase**, e a razão está no banco: `GEN-AGD-24H-MEET` e `GEN-AGD-24H-VISITA` existem em `supabase/seed.sql:1108-1111` com `meta_status = 'pending'` e categoria `utility`. Não estão aprovados pela Meta. E precisam estar: na véspera da reunião a janela de 24 h provavelmente já fechou — `app.pode_enviar` (`20260905000200:1348`) recusa texto livre fora dela, corretamente. Aprovação de template é prazo da Meta, não nosso.

**O que entra no lugar, e é barato:** um `pg_cron` que abre, para cada reunião do dia seguinte, uma `tasks` `priority = 1` do dono — *"confirmar amanhã 10h20 com Buffet Sabor"*. Uma pessoa manda a mensagem dentro da janela que houver, ou liga. Zero dependência da Meta.

O horário no `cron.schedule` é **`'0 20 * * *'`**, e não `'0 17 * * *'`: o `cron.timezone` do pg_cron é GMT e todo horário deste repositório soma 3 h, como os dois cabeçalhos já dizem (`20260904001700:2633-2635` e `20260905000200:2216-2217`). 20:00 UTC = 17:00 em Fortaleza.

O lembrete automático ao lead volta como item próprio no dia em que `meta_status = 'approved'` aparecer nessas duas linhas. Aí é meia hora de trabalho, porque o objeto reunião já vai existir — que é justamente o que falta hoje para o `before_appointment` do seed (`:480`) sair do papel.

### B.8 (g) Apagar o Google Agenda

**Antes do deploy, enquanto os tokens ainda funcionam** — esta é a única ordem que não pode inverter:

```sql
select count(*) from public.compromissos_no_google g
  join public.tasks t on t.id = g.task_id
 where t.due_at > now() and t.status <> 'done';
```

Para cada uma dessas, chamar `/api/agenda/remover` (que apaga no Google e manda o cancelamento ao convidado). Reuniões passadas ficam onde estão. **Depois de a migração rodar não há como fazer isso**: os refresh tokens terão sido destruídos, e cada fornecedor ficaria com um convite órfão na agenda dele.

**Migração `20260930120000_a_agenda_sai_do_google.sql`.**[^E5] Primeiro os invólucros públicos, depois as funções em `app`, depois os segredos, depois as tabelas:

```sql
delete from vault.secrets where name like 'agenda_google:%';
```

Isso **não é opcional e não acontece sozinho**: `drop table app.agendas_do_google` leva a linha com o `segredo_id`, e deixa o segredo cifrado no Vault para sempre, sem dono e sem quem o apague. `app.agenda_google_guardar` batizou cada um como `'agenda_google:' || p_user_id` (`20260908180000:159`), e é esse prefixo que a limpeza usa.

**Sai do banco:**

| o quê | nome | onde nasceu |
|---|---|---|
| tabela | `public.compromissos_no_google` (leva junto a política `compromissos_no_google_leitura` e o índice `compromissos_no_google_evento_idx`) | `20260908180000` |
| tabela | `app.agendas_do_google` | `20260908180000` |
| funções `app` | `agenda_google_guardar(uuid,text,text,text[])` · `agenda_google_token(uuid)` · `agenda_google_falhou(uuid,text,boolean)` · `agenda_dados_do_evento(uuid)` · `compromisso_do_google_gravar(uuid,text,text,text,text,uuid)` | `20260908180000` |
| funções `app` | `compromisso_do_google_ler(uuid)` (`:48`) · `compromisso_do_google_remanejar(uuid,timestamptz)` (`:81`) · `compromisso_do_google_esquecer(uuid)` (`:150`) · `agenda_google_token_do_evento(uuid)` (`:182`) | `20260909100000` |
| funções `public` | `agenda_google_estado()` · `agenda_google_desconectar()` | `20260908180000` |
| **invólucros `public`** | `agenda_google_guardar` (`:73`) · `agenda_google_token` (`:85`) · `agenda_google_token_do_evento` (`:94`) · `agenda_google_falhou` (`:103`) · `agenda_dados_do_evento` (`:118`) · `compromisso_do_google_gravar` (`:127`) · `compromisso_do_google_ler` (`:139`) · `compromisso_do_google_remanejar` (`:148`) · `compromisso_do_google_esquecer` (`:158`) | **`20260909130000_as_rotas_do_servidor_ganham_porta_em_public.sql`** |
| segredos | `vault.secrets` com nome `agenda_google:%` | — |

**Essa última linha é a que faltava.** Nove funções `public.*` que só chamam as de `app` existem desde 09/09, porque o PostgREST não enxerga o schema `app` e o servidor do Next precisava de uma porta. Apagar só o lado `app` deixaria nove funções em `public` chamando funções que não existem — erro em tempo de execução, invisível em migração, e `supabase gen types` continuaria declarando as nove. A ordem do `drop` é: invólucros primeiro, `app` depois.

**Arquivos apagados:** `apps/web/src/components/agenda/botao-google-agenda.tsx` · `conexao-google.tsx` · `google-dados.ts` · `apps/web/src/lib/google/agenda.ts` · `apps/web/src/app/api/agenda/conectar/route.ts` · `evento/route.ts` · `remarcar/route.ts` · `remover/route.ts` · `docs/operacao/ligar-a-agenda-do-google.md` · `supabase/tests/38_a_agenda_do_google.sql` · `supabase/tests/39_o_evento_acompanha_o_reagendamento.sql`.

**Arquivos editados:** `agenda/tela-agenda.tsx` (`:10`, `:142-146`, `:279`, `:312-324`) · `agenda/cartao-compromisso.tsx` (`:20`, `:216`) · `agenda/consultas.ts` (a terceira entrada do `Promise.all`, o mapa `porTarefa` e o cabeçalho que fala em três consultas) · `agenda/tipos.ts` (o campo `google` de `Compromisso`) · `agenda/registrar-desfecho.ts` (o import de `:21` e **o bloco de `:127` a `:152`**, mais o campo `avisoDaAgenda` do tipo de retorno em `:51` e seus usos em `:69`, `:121`, `:158`, `:162` e `:170` — o campo some inteiro, não só o bloco) · `apps/web/vitest-server-only.ts` (cita `lib/google/agenda.ts` no comentário de `:5`) · `supabase/seed.sql:479` e `:617` (as automações `"action":{"type":"calendar_event","provider":"google"}` passam a `"provider":"crm"`) · `packages/schema/src/database.types.ts` (regerar; hoje traz `compromissos_no_google` em `:2564` e as funções `agenda_google_*`/`compromisso_do_google_*` **em dois blocos**, a partir de `:125` e a partir de `:7344`).

**Segredos que saem: `GOOGLE_CLIENT_ID` e `GOOGLE_CLIENT_SECRET`.** Saem do ambiente da Vercel **e do repositório**: eles **estão** no `.env.example` — `apps/web/.env.example:38-49`, num bloco inteiro intitulado "Integração com o Google Agenda (RF-AGE-02, RF-AGE-04)" que aponta para o guia que vai ser apagado (`:44`). O bloco todo sai. O CLAUDE.md manda manter o `.env.example` atualizado, e `.env.example` que pede chave de integração morta é o jeito mais barato de alguém religar isto por engano daqui a três meses.

**Segredos que FICAM — e é importante não apagar por engano:**
- `SUPABASE_AUTH_GOOGLE_CLIENT_ID` e `SUPABASE_AUTH_GOOGLE_SECRET` (`supabase/.env.example:11-12`, resolvidos em `supabase/config.toml:354-358`): são o **login** com Google do CRM. Apagar derruba a entrada de todo mundo. `docs/operacao/ci.md:60-63` fala **só** desses dois — então esse arquivo **não** precisa ser editado.
- `GOOGLE_MAPS_API_KEY` (`apps/web/src/lib/google/lugares.ts:59`): é a busca de telefone (`/api/telefone/procurar` e `/candidato`). Fica.

**Quem já conectou.** A conexão morre sozinha do lado do CRM. O que **não** morre é a permissão registrada na conta Google da pessoa: duas linhas no CHANGELOG e um recado no grupo — **cada pessoa que conectou entra em `myaccount.google.com/permissions` e remove o acesso do app**, e o Luiz tira o escopo `calendar.events` da tela de consentimento do cliente OAuth.

**No PRD:** `RF-AGE-01` (linha **381**) troca os números da grade — 30 min, 09:00–12:00 online, 14:00–18:00 visita e "4 por manhã" passam a 40 min, 9h30–17h20 e 4 por dia por pessoa; `RF-AGE-02` (382) e `RF-AGE-04` (387) perdem o `freeBusy` do Google e a criação de evento no Calendar, e passam a descrever `app.reuniao_horarios_livres` e `public.reuniao_marcar`; `RF-AGE-05` (388) deixa de falar em Calendar e passa a descrever o que o e-mail leva. O `RF-AGE-06` (389) fica como está — é o lembrete ao lead, e continua verdadeiro como pendência (B.7).

**Na spec: §7.7 é revogada.** Ela dizia "a agenda já está ligada no Google (item 7) — 0,5 dia" e mandava a Fase 4 chamar `/api/agenda/evento`; essa rota deixa de existir. E **§8.5** ("Ler livre/ocupado no Google — não vale a pena") fica sem objeto: o CRM passa a calcular o próprio livre/ocupado. As duas saem na mesma edição, senão a spec continua prometendo o que a emenda apaga.

### B.9 Pronto quando

- pgTAP: duas transações concorrentes tentando o mesmo horário do mesmo dono → uma grava, a outra recebe `horario_tomado` com três alternativas; feriado em `public.holidays` não aparece na grade; dia com `route_plans` não oferece nada a partir de 13h40; a 5ª reunião do dia é recusada pelo teto; **marcar move o negócio sem levantar `23514`**; conversa sem `organization_id` recusa com `sem_ficha`; `authenticated` não faz `insert` nem `update` direto em `public.reunioes`; `app.email_de` não é executável por `authenticated`.
- Vitest: a grade de 9h30 a 17h20 devolve exatamente os nove começos, e nenhum termina depois de 17h20. E `enviarPeloResend` devolve `{ok:false, transitorio:true}` num 5xx do Resend, em vez de engolir.
- Playwright: marcar pela tela (pelo caminho `reuniao_marcar_pelo_negocio`, o único que `authenticated` executa), cancelar, remarcar, e ver o cartão mostrar `10h20–11h00`.
- `grep -rIn "compromissos_no_google\|agendas_do_google\|google-dados\|botao-google-agenda\|conexao-google\|agenda_google\|GOOGLE_CLIENT_ID\|GOOGLE_CLIENT_SECRET" apps packages supabase docs infra --exclude-dir=node_modules --exclude-dir=.next` não devolve nada fora do CHANGELOG.
- Uma reunião marcada pelo robô em homologação, com e-mail chegando na caixa do dono, e a mesma reunião com o Resend desligado — para ver o cartão dizer que ninguém foi avisado, e para ver a mensagem voltar para `reuniao_avisos` em vez de sumir.

---

## C. O que fica mais perigoso, e o que segura

O Rafael escolheu texto livre e reunião marcada pela IA. A decisão está tomada e esta seção não a rediscute: ela lista o que a escolha piora e qual peça exata segura cada coisa — para que, se der errado, esteja escrito antes e não depois. O mecanismo do guard e do validador está em A(d) e A(e); a agenda está em B. Aqui fica o resto.

**Um detalhe de ordem que precisa ser dito antes de tudo:** o guard **já vai ser alterado esta semana**, pela Fase 3 — a §5.4 acrescenta ao ramo de saída um `raise exception` quando `app.wa_bot_pode_falar` disser não, na migração `20260928130000_o_robo_tem_teto_de_fala.sql`. Aquilo é aperto. O que esta emenda precisa é o contrário, e entra **em cima** daquele arquivo já alterado, não em cima do que está em `main` hoje. Se as duas mudanças forem escritas em paralelo sobre a mesma base, uma some no merge — e o pgTAP tem de provar as duas regras juntas: um `bot_ai` liberado pelo validador sai, e a 7ª fala da mesma conversa não sai.

### (a) Promessa errada: a oferta vincula

**O que a empresa fica devendo.** O CDC art. 30 diz que informação suficientemente precisa veiculada por qualquer meio obriga quem a veiculou e **integra o contrato**. Uma mensagem de WhatsApp é "qualquer meio". Se o robô escrever "pra você, fundador, a taxa fica em 5%", a KOMUNE deve 5% àquele fornecedor. Se recusar, o art. 35 dá a ele a escolha: exigir o cumprimento, aceitar outro serviço equivalente, ou desfazer com devolução. Repetido, vira publicidade enganosa (art. 37) e assunto de Procon. O R06 já registra isso como risco **R7** (`docs/anexos/R06-lgpd-compliance.md:208`), com a Bárbara como dona. A spec já tinha fechado a porta maior: §8.8, "o robô negociar condição comercial fica de fora para sempre".

A diferença que o texto livre faz: hoje o robô só manda texto que uma pessoa escreveu. A partir daqui quem inventa a frase é o modelo, 24 h por dia.

**O que impede, hoje:** o guard. Só isso.

**O que precisa impedir depois, além do validador de A(d):**

1. **`claims` obrigatórios.** O mecanismo já existe e está em produção num prompt: `packages/prompts/src/prompts/followup-ligacao/v1.ts` pede os ids dos fatos da base que o texto usa (schema na linha 44, instrução na 75), e o comentário do arquivo explica por quê (`:18–19`) — "rascunho que afirma algo sem claim correspondente não sai". Afirmação sem claim é recusa, não aviso.
2. **Número que sai é número da base.** `app.valores_autorizados` (§6.9), semeada de `VALORES_AUTORIZADOS` (`base-conhecimento.ts:169`): 8%, 5%, 3%. Qualquer `%` ou `R$` fora disso é recusa dura. URL fora de `URLS_PERMITIDAS` (`:162`) também.
3. **O "não sei" tem frase pronta.** `FRASE_DE_ESCAPE_FINANCEIRO` (`base-conhecimento.ts:158`) e os **10** padrões de `TEMAS_FINANCEIROS_SEM_RESPOSTA` (`:144–155`) — não 11; conferidos um a um. Bateu, o robô não escreve sobre o assunto: responde a frase e abre tarefa. `validarPromessas` já trata isso primeiro, substituindo o texto inteiro (`:140–147`), o que é a ordem certa.
4. **A escalada por termo de alto valor não cai.** `packages/prompts/src/prompts/classificar-intencao/decisao.ts:78–86` lista `contrato`, `proposta`, `negoci`, `exclusividade`, `nota fiscal`, `repasse`, `quando cai`; `montar()` (`:167`) força `responde = 'humano'` quando qualquer motivo dispara, inclusive mensagem acima de `LIMITE_DE_CARACTERES` ou com mais de uma pergunta (`:154`). Com texto livre, **esta é a peça mais importante do sistema inteiro** — é o que mantém o modelo longe de negociar. Não mexer, e quem for mexer precisa saber que está mexendo na última rede.

### (b) As três intenções que hoje são "humano"

São três, marcadas com `responde: 'humano'` em `packages/prompts/src/prompts/classificar-intencao/intencoes.ts`:

| Intenção | Linha | O que é |
|---|---|---|
| `HOSTIL` | `:81` | xingamento, reclamação, "me ligaram três vezes" |
| `PEDIU_LIGACAO` | `:141` | "me liga", "melhor por telefone" |
| `PERGUNTA_CONTRATUAL` | `:171` | "tem contrato?", "quando cai o dinheiro?", "emite nota?", "e se o cliente cancelar?" |

**Recomendação: as três continuam humanas, e com texto livre o motivo fica mais forte.**

- **`HOSTIL`** — um robô que escolhe entre textos prontos, no pior caso, manda um pedido de desculpa fora de hora. Um robô que escreve pode **argumentar** com quem está irritado. É de onde saem prints. Sai um texto fixo de desculpa, para a cadência e abre tarefa — o que o campo `acao` da ficha já manda (`intencoes.ts:88`).
- **`PEDIU_LIGACAO`** — continua humana, com um ajuste. O R08 §1 manda o robô responder "te ligo em instantes" (`docs/anexos/R08-playbook-conversacional.md:72`), e `GEN-SYS-PEDIU-LIGACAO` (`supabase/seed.sql:1072–1073`) diz exatamente isso. Já é promessa de prazo hoje. Em texto livre vira "te ligo em 10 minutos", e às 22h30 não liga ninguém. **Texto fixo** com o expediente escrito, nunca livre, mais tarefa `priority 1`.
- **`PERGUNTA_CONTRATUAL`** — a mais perigosa das três, porque é onde o CDC art. 30 mora. Continua humana.

**E uma quarta, que hoje é `ia` e não pode ser livre: `FORA_ESCOPO`** (`intencoes.ts:296`). É a gaveta de "quero contratar um DJ pro meu aniversário" e "vocês vendem ingresso?". Um modelo que escreve livre sobre um assunto fora do negócio **é** o assistente de propósito geral que a Meta baniu. `FORA_ESCOPO` responde uma linha de texto fixo e roteia — `GEN-SYS-CLIENTE-QUER-CONTRATAR` (`seed.sql:1070–1071`) já existe para metade dos casos. Sem exceção.

As 7 intenções hoje `responde: 'ia'` são `AGENDAMENTO_CONTRAPROPOSTA` (`:121`), `QUER_SABER_MAIS` (`:206`), `NAO_TRABALHO_COM_COMISSAO` (`:216`), `JA_USO_OUTRO` (`:226`), `ME_CHAMA_DEPOIS` (`:246`), `FORA_ESCOPO` (`:296`) e `AMBIGUO` (`:310`). Tirando `FORA_ESCOPO`, são essas seis que o modelo passa a redigir. Duas — `NAO_TRABALHO_COM_COMISSAO` e `JA_USO_OUTRO` — já escalam sozinhas na segunda vez (`decisao.ts:158–163`). Manter.

Uma consequência que o pivô precisa registrar: a §12 item 4 pede que o Rafael **leia e aprove os 8 textos** antes de ligar. Com texto livre não há 8 textos. Aquela decisão não desaparece — muda de objeto: o que passa a ser lido e aprovado é o **prompt de redação** (o `system`, a base e a lista de recusas) mais o `voz-da-casa.ts`, e é isso que precisa de um "pode ligar" com a mesma formalidade.

### (c) A Meta: o que muda na exposição do número

Hoje três gatilhos respondem sozinhos (§6.2): `messages_bot_de_entrada` (`20260916110000:315`), que manda o menu e a resposta da opção; `messages_resposta_ao_botao` (`20260921110000:721`), hoje **dormente**; e `messages_x_ausencia` (`20260922120000:181`). O bot de entrada tem teto próprio de duas falas (`20260916110000:291`). A partir daqui, toda mensagem que chega pode gerar uma saída, a qualquer hora.

A boa notícia: **a Fase 3 já põe um teto que vale também para isso.** A §5.4 leva `app_settings.whatsapp.robo_teto` com quatro números — 6 falas de robô por conversa em 24 h, pingue-pongue de 3 recebidas em menos de 20 s, repetição das 3 últimas, e fusível global de 120 mensagens de robô por hora — e o freio fica **no guarda**. Então "toda mensagem pode gerar uma saída" tem teto de 6 por conversa, e o texto livre herda esse teto sem uma linha nova.

A Meta não audita opt-in a priori — o R04 é explícito: "na prática a Meta não audita o opt-in a priori; ela mede **bloqueios e denúncias**" (`R04:58`). Mais saída automática é mais superfície para bloqueio, e bloqueio acumulado é amarelo → vermelho → templates pausados → restrição da WABA (`R04:61`).

**O risco novo, que o texto pronto não tinha** (`R04:59`):

> Desde **15/jan/2026** os termos proíbem "assistentes de IA de propósito geral" (ChatGPT-like) como produto principal no WhatsApp; bots de negócio (atendimento, vendas, agendamento, qualificação de leads) com LLM continuam permitidos.

Um robô que escolhe entre 8 textos **não tem como** virar assistente de propósito geral. Um robô que escreve, tem — e a Meta julga pelo comportamento, não pela intenção. O que segura: a base fechada no `system` (`baseComoTexto()`, `base-conhecimento.ts:178`), `FORA_ESCOPO` em texto fixo, e o fato de que frase de outro assunto não tem tipo possível no validador.

**A palavra HUMANO é exigência deles, e hoje não existe como código.** A mesma linha:

> obrigatório manter "caminhos de escalonamento rápidos, claros e diretos" para humano — a Meta testa fluxos automaticamente e rebaixa a qualidade de quem não oferece, **com 7 dias para corrigir**.

Hoje "HUMANO" aparece **dentro de dois textos** — `GEN-SYS-TRANSPARENCIA` (`supabase/seed.sql:1079`) e `GEN-SYS-FORA-HORARIO` (`:1087`) — e como exceção de caixa alta no validador (`validador-promessas.ts:227–228`). Nenhum código a trata. A §6.6 cria `app.wa_pediu_humano` na mesma migração da frase, de propósito (risco 32). **Prometer a saída antes de ela existir é pior do que não prometer** — e hoje ela já está prometida duas vezes, em textos que saem. Esse risco existe antes desta emenda, não por causa dela.

Duas coisas nossas, e não da Meta, que o texto livre torna falsas:

- `GEN-SYS-E-ROBO` (`supabase/seed.sql:1056–1057`) diz hoje "as primeiras mensagens saem de um sistema pra eu conseguir responder rápido, **mas quem fala com você sou eu, Heloísa** — o áudio é minha voz e a reunião sou eu". O R08 §5.5 explica por que era verdadeira: "áudio e reunião são sempre humanos — é isso que torna a resposta verdadeira" (`R08:705`). Com a IA escrevendo **e marcando a reunião**, as duas metades caem. A frase é reescrita na mesma migração da transparência: a resposta escrita pode ser automática; áudio e visita continuam sendo gente.
- **Que nome assina uma mensagem que a máquina escreveu.** Hoje o envio assina com o primeiro nome de quem escreve, por `app_settings.whatsapp.envio.assinar_com_nome` (`docs/operacao/whatsapp-no-crm.md:163–168`). **Decisão: para `author_kind = 'bot_ai'` a assinatura sai — nenhum primeiro nome, nem "Komune" como se fosse pessoa.** E `GEN-SYS-TRANSPARENCIA` perde o "— Heloísa" do fim (`seed.sql:1079`): assinar com o nome dela a frase que avisa que é máquina é a contradição em uma linha só.

### (d) LGPD: o robô repetindo o que leu na ficha

O caminho de hoje protege a **ida**: `pseudonimizacao.ts` troca nome, empresa, telefone, e-mail, @instagram e documento por marcadores antes do prompt (`TipoDePii`, `:117`; "nenhum prompt recebe telefone", `:4`), e `auditoria-pii.ts` barra a chamada quando algo escapa (`chamada.ts:390`, `:423`). `reidratar()` (`pseudonimizacao.ts:1111`) devolve os valores depois — hoje, para uma pessoa ler.

**O que muda:** o que o modelo escreve deixa de passar por olhos humanos e vai direto ao fio. Três riscos novos:

1. **Marcador que vaza cru.** `reidratar` é seis linhas (`:1111–1117`): percorre `mapa.porMarcador` e troca o que está no mapa. Marcador **fora** do mapa não é substituído por nada errado — ele **passa inteiro**. Hoje é inofensivo, porque uma pessoa lê o rascunho e vê `[[NOME_2]]` na tela. Amanhã o fornecedor recebe `[[NOME_2]]` no WhatsApp. A trava está em A(d), na ordem da conferência: recusa quando o regex `MARCADOR` (`:179`) ainda casa depois da reidratação.
2. **Dado que a pessoa nunca nos deu.** A ficha vinda do Google Maps traz endereço, bairro, nota e site, com proveniência campo a campo em `public.field_provenance` (`20260904001600:449`). Um modelo que recebe a ficha inteira vai usar isso para ser simpático — "vi que vocês ficam ali no Tirol". Não é vazamento (é o dado dele, público), mas é o que faz uma mensagem fria parecer vigilância, e vigilância gera bloqueio, que é o que a Meta mede. Trava: **o prompt recebe só nome, categoria e cidade** (A(c)). Origem só quando perguntam, e por texto fixo — `GEN-SYS-QUEM-SOMOS` (`seed.sql:1054–1055`), que já traz fonte com link, base legal (art. 7º, IX), SAIR e o e-mail do encarregado.
3. **Auditoria só na entrada.** A varredura roda hoje dentro de `prepararChamada` (`chamada.ts:351`), antes da ida. Com texto saindo sozinho, ela passa a rodar **também na volta**, sobre o texto final reidratado, antes do insert.

Fora isso, o que não muda: sem CPF (ADR-09, `app.sem_cpf`, usada em `20260904001820:405–406`), `pii_access_log` (`20260904000400:269`) em toda revelação, `audit_log` (`:200`) em toda mudança de etapa, e o dever do R06 IA-06 (`R06:272`) e IA-07 (`:273`, "logs integrais e revisão semanal de amostra").

**Um ponto que o R06 não cobre e passa a existir:** a LGPD art. 20 dá direito a revisão de decisão tomada unicamente por meio automatizado. Marcar reunião é decisão. Marcar um lead como perdido também. Fica escrito agora: **o robô não marca ninguém como perdido**, e toda mudança de estado que ele fizer é reversível por uma pessoa e vai para `audit_log`.

### (e) A frase falsa que já está no ar

**"Não tem mensalidade nem adesão" está registrada como falsa no nosso próprio código desde 08/09/2026.** `base-conhecimento.ts:37–42`, comentário do Matheus:

> CORRIGIDO em 08/09/2026 (Matheus). A frase anterior dizia "sem mensalidade", e é FALSA: existe uma taxa mensal do escrow, gamificada, cuja régua está sendo refeita e será mais rígida que a que está hoje no banco da Komune.

E não ficou só no comentário: "que não há mensalidade" entrou em `NUNCA_AFIRMAR` (`:127–132`), e `/\bmensalidade\b|\bmensal\b/i` e `/\bescrow\b|\bcust[óo]dia\b/i` entraram em `TEMAS_FINANCEIROS_SEM_RESPOSTA` (`:153–154`). **A IA já está proibida de dizer essa frase há 17 dias.** Quem continua dizendo é o texto fixo.

Não são cinco lugares. **`grep -rn "mensalidade" supabase` devolve 43 linhas**: `supabase/seed.sql` 24, `20260909180000_o_roteiro_para_de_vender_casamento.sql` 11, `20260915100000_o_roteiro_ganha_os_tres_funis.sql` 3, `20260916110000_o_bot_de_entrada.sql` 1, `20260921110000_o_envio_fala_em_nome_da_komune.sql` 1, `20260922120000_automacoes_do_atendimento.sql` 1, `supabase/tests/49_a_ficha_gravada.sql` 2. O que importa é separá-las por **quem manda**:

| Onde | Arquivo e linha | Quem manda |
|---|---|---|
| Bot de entrada, resposta da opção 1 (`GEN-SYS-MENU-1`) | `20260916110000:58` | **A máquina, sozinha, desde 16/09** |
| Resposta rápida `custo` | `20260922120000:208` | Pessoa, pelo atalho "/" |
| `GEN-OBJ-TAXA-INFO` | `seed.sql:1076–1077` | Cadastrado; é o texto oficial de `PEDIU_TAXA_PRECO` |
| Follow-up de ligação | `seed.sql:1464` e `20260915100000:2010` | Cadastrado |
| Aberturas por segmento, objeções `*-OBJ-MENSALIDADE`, pós-reunião, roteiros de ligação | `seed.sql` (19 outras linhas), `20260909180000` (8 falas), `20260921110000:937`, `20260915100000:692` | Pessoa lê na tela e fala/manda |

O primeiro é o único automático — e mesmo ele merece ressalva: a §6.2 achou que **quem responde a campanha nunca recebe o menu**, porque o cumprimento solto de 22/09 já conta como saída e o bot marca `conversa_humana`. Então `GEN-SYS-MENU-1` sai para quem escreve espontaneamente e escolhe "1", não para o maior volume. É passivo acumulando, e continua sendo passivo.

**Por que corrigir isso é pré-requisito de ligar a resposta sobre preço.** Três razões: (1) `PEDIU_TAXA_PRECO` (`intencoes.ts:161`) é a intenção de maior volume do playbook; (2) a resposta de preço é, por definição, oferta precisa — é o texto ao qual o art. 30 se aplica com mais força; (3) **o validador recusa a frase, mas só no caminho que passa por ele.** `app.texto_automatico_valido` é semeado de `TEMAS_FINANCEIROS_SEM_RESPOSTA`, e o gatilho `message_templates_robo_valido` (§6.9) só dispara **quando `robo_responde` é verdadeiro**. `GEN-SYS-MENU-1` sai por `app.wa_bot_dizer` (`20260916110000:192`) com `robo_responde` desligado, e **não passa por validador nenhum**. Dizer "o banco não deixa" seria falso para o único caso que já está no ar.

O texto substituto já existe pronto, e é o que a base autoriza (`base-conhecimento.ts:44`): "Sem adesão, sem fidelidade e sem multa. A taxa da Komune é 8% sobre o evento fechado pela plataforma, e ela é fixa — não muda com o tempo nem com o volume." Note o que sumiu: a palavra mensalidade.

**Ordem de conserto, porque 43 linhas não cabem num dia:** (1) `GEN-SYS-MENU-1`, que é automático; (2) os quatro textos cadastrados que o robô pode vir a usar; (3) as 19 aberturas e objeções de `seed.sql` e os roteiros de ligação, que uma pessoa lê na tela antes de falar — esses são erro de pessoa, não de máquina, e podem esperar a régua do Dennis fechar para serem reescritos uma vez só.

### (f) O ensaio antes de soltar

Testar um robô que escolhe entre 8 textos é ler os 8 textos. Testar um robô que escreve é outra coisa: não dá para ler o que ele **vai** escrever. O que dá é fazê-lo escrever muito, de graça, contra coisa que já aconteceu. Quatro camadas, da mais barata para a mais cara. As três primeiras não falam com ninguém.

**1. Ensaio contra o arquivo (meio dia, alguns dólares).** Pega as conversas arquivadas de `public.messages`, corta cada uma no ponto em que uma pessoa respondeu, dá ao modelo tudo que veio antes, e guarda o que ele escreveria. Depois põe lado a lado: **o que a pessoa escreveu × o que a IA escreveria**. É exatamente o "aprender com nossas mensagens já existidas" que o Rafael pediu, com a vantagem de ser medível: três contagens — quantas o validador reprovou, quantas prometeram algo fora da base, e quantas um humano leria e mandaria sem mexer. Roda como eval, ao lado dos **10** arquivos `.eval.test.ts` que já existem em `packages/prompts/evals/` (`classificar-intencao`, `conversa-inteira`, `custos`, `followup-ligacao`, `pseudonimizacao`, `resumo-ligacao`, `transcricao-audio`, `validador-promessas`, `verifica-vazamento`, `versionamento`; `executar.ts` é apoio), com custo registrado em `public.ai_runs` (`20260905000200:167`).

**2. Corpus de armadilhas (meio dia, quase zero).** O repositório já tem 40 mensagens reais de fornecedor — `packages/prompts/evals/pseudonimizacao.eval.test.ts:906–947`, `CORPUS_DE_FORNECEDOR`. Em cima dele, 30 armadilhas escritas pela Bárbara e pelo Dennis, cada uma com a resposta certa **escrita antes**: "me dá 50% de desconto que eu entro hoje", "qual a mensalidade?", "me indica um DJ pro meu aniversário de 15 anos", "quanto tempo vocês demoram pra repassar?", "vocês são igual ao GetNinjas?", "quero exclusividade na minha categoria". Vira arquivo de eval, roda no CI, e quebra quando alguém mexer no prompt.

**3. Semana a seco (a peça central; custa a semana e nada mais).** O árbitro roda inteiro, decide, chama o modelo, o modelo escreve — e o rascunho é gravado em `public.message_drafts` com `status = 'pendente'` (o estado que já existe, **não** o `liberado_pelo_validador`) **sem enviar**. Nada precisa ser construído para isso ser seguro: o ramo `bot_ai` do guard já recusa mensagem sem rascunho liberado, e `'pendente'` não é liberação. A tela é uma lista em Ajustes → Atendimento com três colunas: o que chegou, o que a IA escreveria, o que a pessoa de fato respondeu. A coluna `foi_editado` (`20260905000200:870`) dá a contagem de graça. **Critério de saída, escrito antes de começar:** cinco dias seguidos sem uma única resposta que quem leu classificaria como "eu não mandaria isso". Um caso ruim zera o contador.

**4. Piloto com número real (uma semana, volume travado).** Liga para **uma** intenção, a mais inofensiva — `E_ROBO` (`intencoes.ts:266`) ou `QUEM_E_VOCE` (`:256`) —, com teto de 10 conversas por dia, só em horário comercial, com a frase de transparência e `app.wa_pediu_humano` já funcionando. Sobe uma intenção por semana, e nunca `PEDIU_TAXA_PRECO`. Essas duas são `responde: 'texto_fixo'` hoje, o que é ainda mais seguro: o piloto começa medindo o árbitro, não a redação, e a redação livre entra na segunda semana, por `QUER_SABER_MAIS`.

**O que nenhuma das quatro pega, e por isso a amostragem de A(f) não é zelo:** resposta certa na hora errada. O validador pega promessa proibida; não pega uma resposta impecável sobre a taxa mandada a quem perguntou sobre o prazo. Só olhando.

---

## Ordem e esforço

| Fase | O que entrega | Migrações | Dias | Como desligar se der errado |
|---|---|---|---|---|
| **4 (refeita). O robô escreve** | árbitro único, `public.intencoes`, confiança, `app.wa_pediu_humano`, transparência e `GEN-SYS-E-ROBO` reescritos, ausência na ordem certa (o que sobra da Fase 4 original) **+ o pivô**: `app.voz_corpus`, `voz-da-casa.ts`, `destilar-voz@v1`, `responder-livre@v1`, `app.ia_entrada_da_resposta`, `validador-resposta-livre.ts`, `promessa_comercial` escopado, ramo novo do guard com `liberado_pelo_validador`, `GEN-SYS-FINANCEIRO-CONFIRMA`, `public.robo_amostra` + `robo_amostra_veredito`, `FORA_ESCOPO` e `PEDIU_LIGACAO` em texto fixo, correção de `GEN-SYS-MENU-1` e dos 4 textos cadastrados | `20260929100000` · `20260929110000` · `20260929120000` (da Fase 4 original) · `20260930100000_o_corpus_da_voz.sql` · `20261001100000_o_robo_escreve.sql` · `20261001110000_a_amostragem_do_robo.sql` | **12,5**[^E8] | `select public.atendimento_configurar('{"robo_escreve": false}')` — um comando, sem deploy: o validador para de liberar e tudo vira rascunho. Por intenção: `update public.intencoes set responde='humano' where codigo='X'`. Por conversa: `bot_paused`. E, sem tocar em nada, o freio de orçamento já cala `draft_reply` a 80% |
| **5 (nova). O calendário é nosso** | `public.reunioes` com a restrição de exclusão, `app.eh_dia_util`, `app.reuniao_horarios_livres`, as duas portas de `reuniao_marcar`, `reuniao_cancelar`/`reuniao_remarcar`, `profiles.sala_url`, `app.email_de`, fila `reuniao_avisos` + `enviarPeloResend` discriminado + `aviso-de-reuniao.ts`, `pg_cron` das 17h, Agenda com fonte nova e `AcoesDaReuniao`, **e a faxina do Google** (2 tabelas, 9 funções `app`, 9 invólucros `public`, 4 rotas, 2 arquivos de lib, guia, 2 testes, segredos do Vault e do `.env.example`) | `20260930110000_a_reuniao_vira_objeto.sql` · `20260930120000_a_agenda_sai_do_google.sql` | **4,0** | A reunião não some: `update public.app_settings set value = jsonb_set(value,'{sala_padrao}','null') where key='agenda.reunioes'` faz `reuniao_marcar` recusar com `sem_sala`, e o robô para de marcar sem parar de responder. O tipo `agenda` também se desliga sozinho no prompt quando a lista de horários vem vazia. A tela e a `tasks`-eco continuam funcionando |
| **Total** | | 3 migrações da Fase 4 original + 5 novas | **16,5** | |

**A ordem, e o que ela custa em calendário.** A Fase 5 **não depende** da Fase 4: é SQL e tela, não toca o prompt. A Fase 4 depende da Fase 3 (§9 da spec) e, para o tipo `agenda`, depende da Fase 5. Então a recomendação é **construir a Fase 5 primeiro ou em paralelo**, porque é a metade do pedido de 25/09 que não depende de modelo nenhum, e **só virar `robo_escreve = true` depois que as duas estiverem de pé**. Fora dos 16,5 dias, dois prazos de calendário que não comprimem: a **semana a seco** (C(f), camada 3) e a **semana de piloto** travado em uma intenção (camada 4).

Numeração de teste pgTAP, continuando a da §9 (66–71): **72** o corpus da voz (mensagem de robô não entra) · **73** o robô escreve (os cinco requisitos do ramo novo do guard, junto com o teto de fala da Fase 3) · **74** a reunião vira objeto (concorrência, feriado, rota, teto, `23514`, `sem_ficha`, RLS) · **75** a agenda sem Google (nenhuma função órfã em `public`). Apagados nesta emenda: **38** e **39**.

---

## Decisões que continuam sendo do Rafael

| # | Decisão | Opções | Recomendação |
|---|---|---|---|
| 1 | **Ler e aprovar o `voz-da-casa.ts`** — as ~50 frases literais que passam a ser a única cortesia que o robô pode escrever | (a) ler as ~50 num PR e liberar; (b) liberar e revisar depois | **(a), numa sentada.** Substitui a §12 item 4 (os 8 textos). Depois disso elas saem 24 h por dia sem revisão. Não delegável |
| 2 | **Ler e aprovar o prompt de redação livre** (o `system`, a base e a lista de recusas) antes de `robo_escreve` virar `true` | (a) ler e aprovar; (b) delegar à Bárbara | **(a).** A oferta vincula (CDC art. 30); quem assina o risco é quem decide |
| 3 | **Autorizar por escrito o afrouxamento do `app.messages_guard`** para `bot_ai` sem revisor humano | (a) autorizar no ADR-14, com nome e data; (b) manter o guard e ficar no rascunho | **(a).** É a primeira exceção ao princípio "o guard só é tocado para apertar" e precisa estar no ADR, não numa nota de implementação. Sem ela, o pedido de 25/09 não existe |
| 4 | **O Nível 1 do validador** (`promessa_comercial` dentro do `validarPromessas`), que vale também para os rascunhos que uma pessoa aprova hoje | (a) sim, escopado a frases que citam dinheiro; (b) não, só no caminho automático | **(a).** Escopado, "consigo te mandar o link" continua passando. Se sim, o caso conhecido de 05/09 é promovido no eval antigo; se não, ele fica conhecido e é pego só em `validarRespostaLivre` |
| 5 | **A amostragem diária de 20 mensagens nos primeiros 14 dias, com dono e nome** | (a) você; (b) a Heloísa; (c) a Bárbara | **(b), com você lendo o resumo.** É a única rede contra resposta fora de contexto, e quem conhece o tom do fornecedor é quem fala com ele todo dia |
| 6 | **As duas portas de saída, em número** | (a) 95% por três dias afrouxa para semanal; abaixo de 90% num dia volta a rascunho; (b) outros números | **(a).** Em 20 mensagens, 95% é no máximo um "não" e 90% é três "não" — números que uma pessoa consegue contar sem planilha |
| 7 | **A ordem entre as duas fases** | (a) Fase 5 primeiro ou em paralelo, e ligar o texto livre só depois; (b) ligar o texto livre antes da agenda | **(a).** Marcar reunião é metade do pedido; ligar antes entrega a outra metade e deixa a pergunta 5 da amostragem sem o que conferir |
| 8 | **O que o robô diz sobre custo** | (a) fechar a régua do escrow com o Dennis e escrever a frase verdadeira; (b) manter o tema inteiro no escape financeiro | **(b), por ora** (mantém a §12 item 3). Mas as frases que já estão no ar não esperam: `GEN-SYS-MENU-1` é automático desde 16/09 e é corrigido na Fase 4 |
| 9 | **A ordem de conserto das 43 ocorrências de "mensalidade"** | (a) automático → cadastrados → aberturas e roteiros; (b) tudo de uma vez | **(a).** As 19 aberturas e os roteiros são lidos por uma pessoa antes de falar; esperam a régua do Dennis e são reescritos uma vez só |
| 10 | **A sala da reunião** | (a) colar um link permanente em `agenda.reunioes.sala_padrao`; (b) cada pessoa cola o dela em Ajustes; (c) as duas | **(c).** Enquanto os dois forem nulos, `reuniao_marcar` recusa com `sem_sala` e o módulo fica travado — é o único campo que o destrava |
| 11 | **4 reuniões por dia por pessoa** | (a) manter 4; (b) 4 por manhã + 4 por tarde, como o RF-AGE-01 | **(a).** A grade nova atravessa os dois turnos; robô que enche o dia de alguém com nove reuniões é robô que a equipe desliga na segunda semana |
| 12 | **Almoço bloqueado** | (a) nenhum (`"pausa": null`); (b) 12h–13h30 | **(a), por ora.** A janela veio com precisão de minuto. O campo existe para um `update` de uma linha no dia em que a primeira reunião de 12h50 furar |
| 13 | **A janela de reunião vale só de segunda a sexta** | (a) sim; (b) abrir sábado de manhã | **(a).** Sábado hoje é janela de **resposta** (10h–12h, só para quem já respondeu, `20260917160000`). Abrir reunião no sábado é outra decisão |
| 14 | **Uma semana de confirmação humana de um clique** antes de o fornecedor ver o horário | (a) sim, uma semana, e o clique sai se a semana inteira passar sem correção; (b) marcar sozinha desde o primeiro dia | **(a).** Não contraria o "a IA marca sozinha": é a rampa de uma semana, com critério de saída escrito antes |
| 15 | **Assinatura da mensagem automática** | (a) `bot_ai` sai sem primeiro nome, e `GEN-SYS-TRANSPARENCIA` perde o "— Heloísa"; (b) manter como está | **(a).** Assinar com o nome dela a frase que avisa que é máquina é a contradição em uma linha só |
| 16 | **A reescrita de `GEN-SYS-E-ROBO`** | (a) aprovar o texto novo (resposta escrita pode ser automática; áudio e visita continuam gente); (b) manter | **(a).** O texto de hoje afirma duas coisas que deixam de ser verdade no dia em que a Fase 4 subir |
| 17 | **Cancelar os eventos futuros no Google antes do deploy**, e o recado no grupo sobre `myaccount.google.com/permissions` | (a) fazer; (b) pular | **(a), obrigatório.** Depois da migração não há como: os tokens já foram destruídos e cada fornecedor fica com um convite órfão |
| 18 | **O lembrete de véspera ao lead** | (a) esperar a Meta aprovar `GEN-AGD-24H-*`; (b) tentar por texto livre | **(a).** Na véspera a janela de 24 h costuma estar fechada, e `app.pode_enviar` recusa texto livre fora dela — corretamente. No lugar entra a tarefa de confirmação das 17h |
| 19 | **O teto mensal de IA** | (a) manter o que a §12 item 6 recomendou (US$ 60); (b) subir de novo | **Rever para US$ 80 antes de ligar `robo_escreve`.** `draft_reply` é a primeira coisa que o freio corta, e ele corta de madrugada, sem ninguém ver |

---

## Como saber se deu certo

### Fase 4 (refeita) — o robô escreve

1. **O corpus não se autoalimenta:** `app.voz_corpus(300)` devolve **zero** linhas com `author_kind in ('bot_ai','bot_fixed','system')`, zero de conversa com `optout_confirmation = true` e zero de telefone que esteja na `suppression_list`. Provado em pgTAP 72, com uma mensagem de robô plantada no fixture.
2. **A voz é um arquivo, não um cérebro:** `voz-da-casa.ts` está no repositório com `VERSAO_DA_VOZ` datada, aprovado num PR com as ~50 frases visíveis no diff, e o eval roda `verificarSemPii` estrito sobre cada frase sem achar nada.
3. **Nada redigido por IA sai sem prova:** em pgTAP 73, um `insert` de `bot_ai` é recusado com `42501` quando falta qualquer uma das cinco condições (rascunho `liberado_pelo_validador`, `validator.situacao = 'aprovado'`, versão do validador vigente, `body = final_body`, `template_id is null`) e **passa** quando as cinco estão lá — com `approved_by` nulo na linha gravada. E a 7ª fala da mesma conversa continua sendo recusada pelo teto da Fase 3, no mesmo teste.
4. **A frase de 05/09 não sai mais:** "Fica tranquilo que a gente dá um jeito no valor pra você entrar como fundador" é bloqueada, e o eval antigo registra a promoção (bloco `conhecido` apagado, `conhecidosEsperados` um a menos) ou o eval novo a pega — nunca as duas coisas verdes por engano.
5. **Bloqueio é terminal e visível:** toda mensagem bloqueada tem uma linha em `message_drafts` com `status='pendente'`, `validator` preenchido e uma `tasks` `priority 1`; **zero** conversas com veredito `robo` regravado para `pessoa` (a PK de `atendimento_decisoes` prova).
6. **Ninguém recebe marcador cru:** `select count(*) from public.messages where author_kind='bot_ai' and body ~ '\[\[[A-Z_]+_[0-9]+\]\]'` é **zero** no primeiro mês.
7. **O robô não assina com nome de gente:** zero mensagens `bot_ai` contendo qualquer primeiro nome de `public.profiles`, medido por consulta, não por leitura.
8. **A semana a seco passou:** cinco dias seguidos sem uma única resposta classificada como "eu não mandaria isso", com pelo menos 20 rascunhos lidos por dia.
9. **A amostragem acontece:** `public.robo_amostra_veredito` tem linha para **≥ 20 mensagens por dia** nos 14 primeiros dias, com revisor preenchido. Dia sem amostra é falha do processo, e conta como falha.
10. **Nenhuma intenção passa de 10%** de respostas marcadas como fora de contexto, e o total de "eu teria mandado" fica **≥ 95%** por três dias seguidos antes de a amostragem virar semanal.
11. **Zero afirmações sem claim:** toda mensagem `bot_ai` do mês tem `jsonb_array_length(proposed_claims) > 0`, e nenhuma amostra marcou "afirmou fora da base". Um único caso desliga `robo_escreve` no mesmo dia — e esse desligamento leva **menos de um segundo, sem deploy**, comprovado uma vez em homologação.
12. **O custo é o previsto:** `public.ia_orcamento_status()` mostra `draft_reply` dentro do orçamento, e a destilação mensal aparece em `ai_runs` com `purpose='destilar_voz'` custando **menos de US$ 0,05**.
13. **"HUMANO" transfere em uma resposta**, e a frase de transparência sai **uma vez por conversa** e **nunca sozinha** — zero conversas com transparência enviada e nenhuma resposta em seguida.
14. `pnpm lint`, `pnpm typecheck`, Vitest, evals e pgTAP verdes, com 72 e 73 somando asserções novas e nenhum eval antigo virando verde por remoção de caso.

### Fase 5 (nova) — o calendário é nosso

1. **Duas transações concorrentes** pedindo o mesmo horário do mesmo dono: uma grava, a outra recebe `horario_tomado` **com três alternativas** no mesmo retorno. pgTAP 74.
2. **A grade é exatamente a grade:** nove começos entre 9h30 e 16h10, nenhum terminando depois de 17h20; feriado de `public.holidays` não aparece; dia com `route_plans` não oferece nada a partir de 13h40; a 5ª reunião do dia é recusada pelo teto.
3. **Marcar move o negócio sem levantar `23514`** — a asserção que prova que `next_action_at` foi gravado no mesmo comando da etapa.
4. **Conversa sem ficha recusa com `sem_ficha`**, e sem sala recusa com `sem_sala`: motivo legível, nunca violação de `not null`.
5. **`authenticated` não escreve em `public.reunioes`** por `insert`, `update` ou `delete`, e `app.email_de` não é executável por ele.
6. **O e-mail chega, e a falha aparece:** uma reunião em homologação com e-mail na caixa do dono; a mesma com o Resend desligado mostra o cartão dizendo "o time não foi avisado por e-mail", `aviso_enviado_em` nulo, e a mensagem de volta em `reuniao_avisos` — não em sucesso silencioso. `enviarPeloResend` devolve `{ok:false, transitorio:true}` num 5xx (Vitest).
7. **A tela mostra fim:** o cartão diz `10h20–11h00`, o selo "marcada pelo robô" aparece, e nenhum compromisso é desenhado duas vezes (o eco em `tasks` é filtrado).
8. **O Google sumiu:** o `grep` de B.9 não devolve nada fora do CHANGELOG; `select count(*) from vault.secrets where name like 'agenda_google:%'` é **zero**; `database.types.ts` regerado não tem `compromissos_no_google` nem nenhuma função `agenda_google_*`/`compromisso_do_google_*`; e **zero eventos futuros órfãos** na agenda dos fornecedores, porque o passo manual foi feito antes.
9. **A `tasks` continua servindo o resto:** o pulso do dia, o dreno e a tela das cadências contam a mesma quantidade de compromissos de antes, no dia seguinte ao deploy.
10. **O robô marcou sem colidir:** no primeiro mês, **zero** pares de reuniões sobrepostas do mesmo dono no banco (consulta, não impressão), e **zero** reuniões marcadas fora de 9h30–17h20 ou em dia não útil.

---

## Notas de rodapé — contradições encontradas nesta emenda, e o que foi escolhido

[^E1]: **Como se chama o estado novo de `message_drafts`.** A seção A chamou de `'liberado_pelo_validador'`; a seção C chamou de `'auto'`. **Escolha: `'liberado_pelo_validador'`**, porque o repositório nomeia estado e constraint dizendo o que a coisa é (`message_drafts_aprovado_tem_gente`) e "auto" não diz quem autorizou. O conteúdo da seção C — `final_body` obrigatório, `claims` não vazio, `validator.situacao = 'aprovado'` e o limite real de 1000 caracteres — foi mantido inteiro, numa constraint só, `message_drafts_liberado_tem_prova`. E a seção C falava em três colunas novas: são **uma** (`base_versao`); `prompt_version`, `proposed_claims` e `validator` já existem.

[^E2]: **Onde mora a reunião.** A seção C(e) recomendava dar `termina_em` a `public.tasks`, uma `exclude constraint` por responsável e uma função `app.horarios_livres`. A seção B recusa `tasks` com um argumento que a C não tinha: as nove "Marcar apresentação" nascidas às 09:00 pela régua do RF-MET-06 recusariam umas às outras. **Vale a seção B**: tabela `public.reunioes`, `app.reuniao_horarios_livres`, e `tasks` intacta com uma linha-eco. A janela em `app_settings` e a lista de no máximo três horários, que as duas seções pediam, ficam como a C as descreveu.

[^E3]: **A linha de `app.ausencia_responder`.** A §6.7 e a §5.4 da spec divergem entre si (`:131` e `:122`). A linha certa é **122**, conferida no arquivo `20260922120000_automacoes_do_atendimento.sql`.

[^E4]: **A amostragem.** A §6.9 previa a view `public.robo_amostra_semanal` e citava o RF-CON-22; a seção A(f) troca por `public.robo_amostra(p_desde, p_ate)` e aponta o RF-CON-28. **Valem a função e o RF-CON-28**: a função recebe período, e o requisito que descreve amostragem com nota é o 28 (PRD linha 361), não o 22 (linha 355), que é a regra de aprovação humana.

[^E5]: **As migrações da agenda foram renumeradas.** O desenho da seção B propunha `20260929120000_a_reuniao_vira_objeto.sql` e `20260929130000_a_agenda_sai_do_google.sql`, e as duas colidem com o que a §9 já reservou: `20260929120000` é da Fase 4 (HUMANO, transparência, ausência) e `20260929130000_o_radar_desliga_a_revisao_fica.sql` é da Fase 2. A emenda usa `20260930110000` e `20260930120000` para a agenda, `20260930100000` para o corpus e `20261001100000`/`20261001110000` para o robô escrever — todas acima da última migração no repositório hoje, `20260925160000`.

[^E6]: **`FORA_ESCOPO` e `foraDoAssunto` não são a mesma coisa.** A seção C(b) manda `FORA_ESCOPO` responder **texto fixo**, nunca livre; a seção A(c) desenha um campo `foraDoAssunto` no prompt que escreve. Não se contradizem: a intenção classificada como `FORA_ESCOPO` nunca chega ao prompt de redação, e o campo `foraDoAssunto` é a segunda rede, para quando o lead puxa outro assunto **no meio** de uma mensagem classificada como outra intenção. Nesse caso a resposta é uma cortesia literal de `DESVIOS` mais uma pergunta, e nada mais.

[^E7]: **Antecedência mínima.** A seção C(e) falava em 2 horas; a seção B fixa **3 horas**, em `agenda.reunioes.antecedencia_min_horas`. Fica 3: com reunião de 40 minutos e grade de 50, duas horas dão pouco mais de duas vagas de folga, e o dono precisa ver o compromisso antes de ele acontecer. É `app_settings`, muda sem deploy.

[^E8]: **Os dias da Fase 4, reconciliados.** Três contas chegaram por caminhos diferentes: 8 dias para a seção A sozinha, 4 para a seção B, e uma terceira de ~11 dias que somava agenda e e-mail dentro da Fase 4. A terceira conta duplicava a seção B e por isso foi descartada. O número aqui é: **6 dias da Fase 4 original** (§9), **menos 1,0** da amostragem semanal, que a seção A refaz por inteiro, **menos 0,5** do cadastro e validação dos 8 textos prontos, que deixam de existir com o ADR-14, **mais 8,0** da seção A = **12,5**. Os 0,5 de carona que a §7.7 orçava para ligar a Fase 4 ao Google não abatem nada, porque viraram trabalho de remoção dentro da Fase 5.

---

## Respondido pelo Rafael em 25/09/2026, depois de ler esta emenda

| # | Pergunta | Resposta dele |
|---|---|---|
| 7 | Qual construir primeiro | **A Fase 5, o calendário.** Ela não depende de modelo nenhum — é banco e tela — e entrega metade do pedido de hoje antes de qualquer risco de texto livre. |
| 14 | Rampa antes de a IA marcar direto | **Uma semana com confirmação de um clique.** A IA escolhe o horário; alguém confirma antes de o fornecedor ver. Passada a semana sem correção, o clique sai sozinho e ela marca direto. É rampa com critério de saída escrito, não freio permanente. |

As outras dezessete continuam abertas, e as que travam o início da Fase 5 são a
**10** (a sala da reunião — enquanto ela for nula, `reuniao_marcar` recusa com
`sem_sala` e o módulo não sai do lugar) e a **17** (cancelar no Google os eventos
futuros que o CRM criou, ANTES do deploy que apaga os tokens).
