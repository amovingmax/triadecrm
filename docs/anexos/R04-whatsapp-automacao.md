# 04 — Automação de WhatsApp para o CRM de Captação da KOMUNE

Pesquisa para o PRD do robô de WhatsApp (prospecção, follow-up, agendamento, cobrança de cadastro e suporte com inbox por responsável). Data-base: setembro de 2026. Câmbio de referência usado nas conversões: **R$ 5,40 / US$ 1** (ajustar na planilha final).

> Legenda de confiança: **[F]** = valor/regra confirmada em fonte listada na seção 11; **[E]** = estimativa própria a partir das fontes; **[V]** = verificar antes de decidir (não encontrei fonte primária ou a fonte é de blog/terceiro).

---

## 0. Sumário executivo (o que recomendar no PRD)

1. **Não colocar o número verificado da KOMUNE em API não oficial (Baileys/Evolution em modo QR).** Em 2026 a Meta intensificou detecção de clientes não oficiais (fingerprint de protocolo + comportamento) e os relatos brasileiros de banimento em ondas — inclusive de números "bem aquecidos" — são consistentes [F: DAS, AraraHQ, Organizabot, Tipefy]. O custo de perder o número principal (histórico, reputação, contatos, semanas de retrabalho) é maior que qualquer economia: um blog brasileiro estima R$ 30 mil por banimento em operação média [F: Cubosuite, estimativa deles].
2. **Via recomendada: WhatsApp Business Platform (Cloud API oficial) em modo *Coexistence*** — o mesmo número fica no **WhatsApp Business App** (celular dedicado, foto e nome "Heloísa · Komune", ligações, áudios gravados ao vivo) **e** na **Cloud API** (robô, CRM, inbox). Mensagens enviadas pelo app são ecoadas para a API (`smb_message_echoes`), então o CRM enxerga tudo [F: 360dialog, YCloud, ChakraHQ]. Brasil é elegível [F: ChakraHQ, YCloud].
3. **Primeiro contato em "modo assistido"**: a Heloísa dispara a primeira mensagem pelo app (texto pronto no CRM, um toque) → sem template, sem custo, 100 % dentro da política, com cara de pessoa. Quando o fornecedor responde, abre-se a janela de 24 h e o robô assume (texto + áudio + agendamento), gratuitamente. Só as re-abordagens fora da janela usam templates pagos (marketing ≈ **R$ 0,34**; utility ≈ **R$ 0,04** por mensagem [F: Meta via EZContact/Blueticks/Whautomate]). **Modo automático** (template como primeiro toque) fica disponível como escala.
4. **Custo total previsto (450 contatos e ~3.000 msgs/mês)**: **≈ R$ 220–530/mês** no modo assistido com Cloud API direta (sem BSP; ≈ R$ 400 no cenário típico com voz clonada e VPS) — ou **≈ R$ 485–850/mês** se usar BSP tipo 360dialog para simplificar o Coexistence. A via não oficial custaria ≈ R$ 155–480/mês (economia de R$ 100–200), mas com risco real de perder o número [E; seção 8].
5. **Stack**: Chatwoot self-hosted (inbox multiagente, atribuição, etiquetas, bot→humano) + serviço "Agente Heloísa" (Node/TypeScript, Claude Sonnet 5/Haiku 4.5, ferramentas: CRM Supabase, Google Calendar/Meet, envio de áudio) + fila/cron para cadências + Evolution API v2.4 (engine Cloud API) **ou** conector próprio no Graph API. Infra: VPS pequena (≈ R$ 44–60/mês) ou máquina dedicada em Natal com Cloudflare Tunnel (R$ 0).
6. **Áudio**: biblioteca de 25–40 áudios gravados pela Heloísa (mais autêntico e sem custo) + clonagem profissional da voz dela (ElevenLabs Creator, US$ 22/mês) apenas para trechos variáveis (nome, categoria, data), com consentimento por escrito e regra de nunca negar automação se perguntado.
7. **Guardrails**: ≤ 20 primeiros contatos/dia na semana 1 subindo até 40–60/dia; janelas 9h–11h30 e 14h–17h30 em dias úteis; intervalos aleatórios; no máximo 3 toques sem resposta em 10 dias; opt-out imediato; sem link no primeiro toque; monitor de bloqueios e do *quality rating*; handoff humano em 8 gatilhos (seção 4 e 5).

---

## 1. Premissas do dimensionamento

| Item | Valor usado |
|---|---|
| Alvos novos por mês | 300–600 (base do plano: 300 fornecedores + 60 produtores até 18/09) |
| Mensagens totais por mês | ~3.000 (≈ 6–7 por contato, somando robô e humano) |
| Primeiros contatos por dia útil | 15–30 |
| Taxa de resposta esperada no 1º toque | 30–45 % [E, típico de B2B local com mensagem pessoal] |
| Mensagens iniciadas pela empresa **fora** de janela (templates) | 30–40 % do total |
| Equipe operando o inbox | Heloísa (voz e suporte), Bárbara, Rafael; Matheus/Luiz na tecnologia |

---

## 2. Panorama 2026 das três vias

### 2.1 WhatsApp Business Platform (Cloud API da Meta) — a via oficial

**Modelo de cobrança (desde 1º/jul/2025): por mensagem entregue, não mais por conversa de 24 h** [F: Meta docs (updates-to-pricing), Blueticks, 8x8, Gallabox].

| Categoria | Preço Brasil (US$) | ≈ R$ | Quando é grátis |
|---|---|---|---|
| Marketing (promoção, prospecção, reengajamento) | **0,0625** | **0,34** | Só dentro das 72 h após clique em anúncio Click-to-WhatsApp |
| Utility (confirmação, lembrete, atualização de conta/cadastro) | **0,0068** | **0,037** | **Grátis quando enviada dentro de uma janela de atendimento aberta** (regra de jul/2025) |
| Authentication (OTP) | 0,0068 | 0,037 | — |
| Service (resposta livre dentro da janela de 24 h aberta pelo usuário) | **0** | **0** | Sempre — sem teto mensal desde nov/2024 |

Fontes: EZContact (mai/2026), Blueticks (mai/2026), Whautomate, api-wa.me (jul/2026: "≈ R$ 0,32 marketing, ≈ R$ 0,035 utility"). Blogs brasileiros de abril/2026 citavam R$ 0,36–0,40 para marketing (câmbio/markup) [F: Maxbot]. Marketing **não tem desconto por volume**; utility/authentication têm tiers a partir de milhões de mensagens (irrelevante para a KOMUNE) [F: Blueticks].

**Cobrança em reais**: a Meta anunciou faturamento em BRL no Brasil a partir de **1º de julho (2026)** com transição até 1º/jul/2027 e possibilidade de boleto; a tabela em R$ ainda não estava publicada nas fontes consultadas [F: Nexe, HelenaCRM]. **[V]** Confirmar tabela em reais no Business Manager antes de fechar o orçamento.

**Regras operacionais que moldam o desenho do robô**

- **Mensagem iniciada pela empresa exige template aprovado** (marketing/utility/authentication). Texto livre, áudio, imagem e documento só dentro da janela de 24 h aberta por uma mensagem do contato [F: 360dialog coexistence doc; política Meta]. Aprovação de template costuma levar minutos a 24 h; a Meta pode recategorizar (utility → marketing) [V].
- **Janela de atendimento**: 24 h a partir da última mensagem do usuário; cada nova mensagem dele renova. Dentro dela, tudo é gratuito, inclusive utility [F].
- **Limites de envio (tiers)**: 250 destinatários únicos/24 h para conta sem verificação; **2.000** (fontes de 2026; antes 1.000) após Meta Business Verification; depois 10 k, 100 k, ilimitado. Sobe automaticamente ao usar ≥ 50 % do limite em 7 dias com qualidade média/alta; avaliação a cada 6 h. Desde out/2025 o limite é do **portfólio** (todos os números do Business Manager compartilham) [F: Chatarmin, AiSensy, Wati]. Para a KOMUNE, 250/dia já sobra — mas a verificação da empresa (CNPJ) é recomendada para nome de exibição e credibilidade.
- **Quality rating** (verde/amarelo/vermelho) por número, baseado em bloqueios, denúncias e feedback. Vermelho impede subir de tier e pode levar à restrição/pausa de templates; a política diz que a Meta "pode limitar ou remover o acesso" com feedback negativo significativo [F: política; Chatarmin]. Há webhook `phone_number_quality_update` para monitorar.
- **Limite de marketing por usuário (ecossistema)**: a Meta limita quantos templates de marketing **uma pessoa** recebe de todas as empresas (dinâmico; erro **131049** quando saturado). Não é penalidade, mas a mensagem não entrega [F: WatEase, Wati, Chatarmin].
- **Opt-in**: "Você só pode contatar pessoas no WhatsApp se (a) elas deram o número e (b) você recebeu permissão de opt-in" — a empresa é "a única responsável por determinar o método de opt-in" em conformidade com a lei [F: WhatsApp Business Messaging Policy]. Na prática a Meta não audita o opt-in a priori; ela mede **bloqueios e denúncias**. Prospecção fria via template é praticada no B2B brasileiro, mas é uma zona cinzenta: cada bloqueio conta contra o número. Por isso a recomendação do **modo assistido** (humano manda o 1º toque pelo app) e, no modo automático, volumes baixos + alta personalização + opt-out.
- **Automação/IA**: permitida; obrigatório manter "caminhos de escalonamento rápidos, claros e diretos" para humano (transferência no chat, telefone, e-mail, formulário) — a Meta testa fluxos automaticamente e rebaixa a qualidade de quem não oferece, com 7 dias para corrigir [F: política; Blip]. Desde **15/jan/2026** os termos proíbem "assistentes de IA de propósito geral" (ChatGPT-like) como produto principal no WhatsApp; bots de negócio (atendimento, vendas, agendamento, qualificação de leads) com LLM continuam permitidos [F: respond.io; TechCrunch 18/10/2025]. Um blog cita "AI-Assisted Business Messaging Guidelines" com exigência de anunciar que é IA e sistema de 3 strikes — **não localizei isso na política oficial** [V: Conferbot]; o que está na política é o escalonamento humano e a proibição de se passar por outra empresa.
- **Nome de exibição**: precisa representar o negócio; no Coexistence o nome vem do app e "não é revisado automaticamente" [F: 360dialog]. Assinar "Heloísa, da Komune" no texto é o caminho seguro.
- **Números bloqueados/denunciados**: bloqueio individual só derruba a métrica; acúmulo → amarelo/vermelho → templates pausados/limite reduzido → restrição da WABA. Há canal de recurso no Business Manager (diferente da via não oficial, onde não há recurso efetivo) [F: Whatsable, ChakraHQ].
- **Áudio como mensagem de voz**: a Cloud API aceita .ogg **somente com codec Opus, mono**, até 16 MB; enviado como voz aparece com foto/ícone de microfone (e transcrição automática para quem ativou); arquivos > 512 KB viram "download" em vez de play [F: Meta audio-messages]. Regra prática: 48 kHz mono, 32–64 kbps, ≤ 90 s.
- **Indicador "digitando"**: a Cloud API passou a suportar *typing indicator* (marcar como lida + typing) [V: verificar endpoint atual]; "gravando áudio" não existe na API oficial.

**BSPs e custo de plataforma no Brasil (2026)**

| Opção | Custo de plataforma | Observações |
|---|---|---|
| **Cloud API direta (Meta)** | **R$ 0** — só as mensagens | Cria-se app na Meta for Developers, WABA no Business Manager, token de sistema. Mais trabalho de setup; melhor custo. Coexistence direto exige que a KOMUNE seja "Tech Provider" com Embedded Signup [F: YCloud] — burocracia extra. |
| 360dialog | ≈ US$ 49–59/mês por número, **sem markup** por mensagem [F: 360dialog blog ago/2026; EZContact] | Suporta Coexistence documentado; Chatwoot tem inbox nativa 360dialog. Boa opção "meio-termo". |
| Twilio | ≈ US$ 0,005/mensagem de markup, sem mensalidade [F: EZContact] | Preço em dólar; sem inbox. |
| Gupshup | markup por mensagem, "preços agressivos" [F: Notifica, Kanal] | Forte na Índia; suporte BR limitado. |
| Wati | ≈ US$ 39–49/mês + ~20 % de markup; usuários extras US$ 24–69 [F: Wati pricing, EZContact] | Plataforma completa (inbox, campanhas), pouco flexível para robô próprio. |
| Zenvia, Take Blip, Positus, Infobip | Planos corporativos; mensalidades típicas de plataformas BR: **R$ 97–997/mês** + mensagens [F: Cubosuite]; Blip/Zenvia/Infobip costumam ter mínimos maiores [V] | Overkill para o estágio da KOMUNE; considerar só se quiser terceirizar tudo. |
| Kommo (CRM + WhatsApp) | por usuário/mês (≈ US$ 15–45) [V] | Substituiria o CRM próprio — contraria a decisão da reunião. |

**Coexistence (App + Cloud API no mesmo número) — novidade 2025, global em 2026**

- Lançado em maio/2025; requer WhatsApp Business App ≥ 2.24.17, conta comercial (não pessoal), Business Portfolio vinculado, app aberto ao menos a cada 13–14 dias; onboarding via Embedded Signup de um Tech Provider/BSP [F: YCloud, ChakraHQ, 360dialog].
- O que sincroniza: mensagens 1:1 nos dois sentidos (eventos `smb_message_echoes`), contatos, histórico de até 6 meses. O que **não** sincroniza/desativa: grupos, listas de transmissão (viram somente leitura), mensagens temporárias, visualização única, localização ao vivo, status; sem selo azul (OBA), sem API de chamadas, sem trocar a foto de perfil pela API após o onboarding [F: 360dialog, YCloud, ChakraHQ].
- Custo: mensagens pelo app continuam gratuitas; pela API seguem a tabela por mensagem; templates continuam obrigatórios para iniciar conversa **pela API** [F: 360dialog].
- Disponibilidade: não está na lista de países bloqueados (UE/UK/Japão/Austrália/etc.); fontes de abril–maio/2026 citam Brasil como suportado [F: ChakraHQ, YCloud].

### 2.2 WhatsApp Business App (celular) — a via "manual assistida"

- Recursos nativos: perfil comercial, catálogo, etiquetas, respostas rápidas, mensagens de saudação/ausência, listas de transmissão (até 256 contatos e **só chega para quem salvou seu número**) [V: FAQ WhatsApp não acessível por robots.txt; regra amplamente documentada], até 4 dispositivos vinculados (mais com Meta Verified) [V].
- **WhatsApp Business AI** (agente nativo gratuito da Meta) chegou ao Brasil no fim de fevereiro/2026: atende clientes 24/7 com base no catálogo; exige app em português e ≥ 1 item de catálogo [F: DAS]. Serve para **suporte reativo**, não para prospecção nem para integrar com o CRM.
- Automação "de fora" do app (Baileys/WhatsApp Web) é o que a Meta persegue — ver 2.3. Automação "de dentro" (Coexistence) é o caminho oficial.
- Uso prático para a KOMUNE: **primeiro toque humano** (mensagem preparada pelo CRM, link `wa.me/55…?text=` ou copiar/colar; 15–30 por dia cabem em 30–45 min), ligações, áudio ao vivo. Rota externa de visitas continua no celular.

### 2.3 APIs não oficiais (WhatsApp Web / Baileys / navegador)

| Projeto | Como funciona | Estado 2026 | Custo |
|---|---|---|---|
| **Evolution API v2** (Evolution Foundation) | Servidor Node/TS multi-instância; engines **Baileys** (WhatsApp Web, QR) **e Cloud API oficial** (mesma API para ambos); integrações nativas Chatwoot, Typebot, OpenAI, Dify, n8n, RabbitMQ/Kafka/SQS, S3; requer PostgreSQL + Redis [F: README, releases] | Líder no Brasil. **v2.4.0 (mai/2026) exige ativação de licença** (e-mail do operador; auto-ativação via `EVOLUTION_OPERATOR_EMAIL`); tier *community* gratuito, sem limite de instâncias; Apache 2.0 com cláusulas de marca; envia telemetria agregada [F: docs licensing; issue #2534]. v2.3.7 (dez/2025) melhorou templates da Meta e integrações [F: releases] | Software R$ 0 + VPS |
| **WAHA** (devlike.pro) | HTTP API Docker; engines WEBJS (Chromium), NOWEB (Baileys-like), GOWS (Go/whatsmeow) [F: README] | Core gratuito e open source; **Plus** pago (mídia/voz/vídeo, múltiplas sessões, proxies) via Patreon/Boosty — site cita US$ 5/mês community; Plus ≈ US$ 19/mês [V] | R$ 0 / ≈ R$ 100 |
| **WPPConnect** | Projeto brasileiro, automação de navegador (Puppeteer) — centenas de MB de RAM por sessão [F: WaSphere] | Ativo; comunidade BR | R$ 0 |
| **Venom-bot / whatsapp-web.js** | Navegador headless | Venom em declínio; wwebjs estável, base de muitos "Whaticket" | R$ 0 |
| **Whaticket** (e forks "SaaS") | Sistema de tickets brasileiro sobre wwebjs/Baileys | Legado; muitos forks pagos; mesmo risco de ban | R$ 0–300 |
| **Z-API** | API não oficial hospedada (BR) | ≈ **R$ 99,99/mês** por instância (Ultimate); parceiros R$ 55–90 [F: Wafly] | por instância |
| **uazapi / UazapiGo** | API não oficial hospedada BR, 134 endpoints, botões/PIX/listas | "custo de centavos por instância" em servidores white-label; varejo R$ 29–149/mês [F: ZDG, Cubosuite] | por instância |
| **Chat-API** | wrapper comercial antigo | Praticamente extinto; citado só como risco [F: DAS] | — |

**Funcionalidades que só a via não oficial dá** (e a KOMUNE não precisa): mensagem livre sem template para qualquer número, presença "digitando/gravando" real, leitura de grupos, enquetes, histórico completo [F: Tipefy].

**Envio de áudio na Evolution**: `POST /message/sendWhatsAppAudio/{instance}` com `number`, `audio` (URL pública/base64), `delay`, `encoding: true` (converte com ffmpeg para ogg/opus) → chega como PTT com forma de onda; recomendação 16/48 kHz mono, 64–128 kbps, ≤ 16 MB [F: docs]. Presença: `sendPresence` (`composing`/`recording`) — só no engine Baileys.

**Risco de banimento em 2026 — o que as fontes dizem**

- Desde jan/2026 a Meta "intensificou a detecção de padrões não humanos" via WhatsApp Web: cadência, padrões de digitação, geolocalização de IP e assinaturas de automação; ban permanente ao detectar [F: DAS].
- Detecção em três camadas: fingerprint de protocolo (headers, timing de handshake), análise comportamental (ML), denúncias; **bans em lote/ondas** que pegam "centenas de números" de uma vez, às vezes meses depois [F: AraraHQ].
- Relato de perfis "com 130 mil interações" banidos permanentemente [F: Organizabot]; desconexões frequentes por mudanças de protocolo (Baileys precisa acompanhar) [F: Café Online, Organizabot].
- Não há recurso efetivo; taxa de sucesso de revisão citada em 30–40 % para conta de app [F: Unred].
- Licença: Baileys é MIT mas depende de libsignal (GPLv3) — "armadilha de licenciamento" só para quem distribui binários; self-host não dispara [F: WaSphere].

**Como brasileiros usam na prática (prospecção)** — síntese dos relatos e guias [F: Unred, ProxyAds, ZDG, Cubosuite, Tipefy]:
- Stack típica "ZDG": Evolution + n8n + Chatwoot + Typebot, chips pré-pagos em celulares baratos, um número por "disparador", proxy residencial dedicado (R$ 20–80/mês), servidor R$ 50–300/mês.
- Aquecimento (Unred): dias 1–7: 10–20 msgs/dia em conversa normal; 8–14: 30–50/dia; 15–30: 50–100/dia; > 30 dias: 200–300/dia; **"500 mensagens em 1 h = ban; 500 em 10 h = ok"**; intervalo aleatório 8–25 s; variar texto; sem encurtador; opt-out "PARAR/SAIR"; chip exclusivo; 1.000+/dia só na API oficial.
- Prática comum: "usar números diferentes em cada plataforma — críticas na oficial, personalizadas na não oficial" [F: ProxyAds] — ou seja, quem insiste em não oficial já aceita **número descartável**.
- Consenso dos textos brasileiros de 2026 (mesmo os de vendedores de API não oficial): não oficial serve para teste, uso pessoal, funcionalidades ausentes e campanhas com número descartável; **não** para o número que sustenta o negócio.

### 2.4 Comparativo

| Critério | Cloud API (direta ou BSP) | App + Coexistence | App manual (sem API) | Não oficial (Evolution/Baileys, Z-API…) |
|---|---|---|---|---|
| Legalidade/ToS | ✔ homologado | ✔ homologado | ✔ | ✘ viola termos |
| Risco de perder o número | Baixo (com qualidade) | Baixo | Baixo (uso humano) | **Alto em 2026** |
| Primeiro toque frio | Template pago (R$ 0,34), zona cinzenta de opt-in | Humano pelo app (R$ 0) ou template | Humano (R$ 0) | Livre (R$ 0), mas é o que a Meta caça |
| Áudio de voz | ✔ dentro da janela (ogg/opus) | ✔ (API ou gravado no celular) | ✔ manual | ✔ (`sendWhatsAppAudio`) |
| Presença "digitando" | Parcial (typing indicator) | idem + real pelo celular | real | ✔ composing/recording |
| Inbox multiagente | Chatwoot/BSP | Chatwoot + app | Só o app (4 dispositivos) | Chatwoot via Evolution |
| Ligações | ✘ (Calling API à parte) | ✔ pelo celular | ✔ | ✘ |
| Grupos | ✘ | ✘ (não sincroniza) | ✔ | ✔ |
| Custo plataforma | R$ 0 (direta) / R$ 265–320 (360dialog) | idem | R$ 0 | R$ 0 (self-host) / R$ 60–150 (hospedada) |
| Custo por mensagem | Marketing R$ 0,34 · utility R$ 0,04 · serviço R$ 0 | idem (app grátis) | R$ 0 | R$ 0 |
| Esforço de setup | Médio (verificação, templates, webhooks) | Médio-alto (Embedded Signup) | Baixo | Baixo (QR) |
| Estabilidade | Alta (SLA Meta) | Alta | Alta | Média (quebra a cada mudança de protocolo) |
| LGPD/contratos | DPA da Meta; criptografia ponta a ponta mantida | idem | idem | Dados trafegam por servidor próprio fora do modelo oficial; sem DPA |

---

## 3. Arquitetura recomendada para a KOMUNE (híbrida, oficial)

```
                    ┌───────────────────────────────────────────────────────────┐
                    │  NÚMERO KOMUNE (verificado) em COEXISTENCE                │
                    │  • WhatsApp Business App no celular dedicado (Heloísa)    │
                    │  • Cloud API (WABA) — templates, texto, áudio, webhooks   │
                    └───────────────┬───────────────────────────┬───────────────┘
                                    │ webhooks (msgs, echoes,    │ Graph API / Evolution (engine Cloud)
                                    │ status, quality)           │
        ┌───────────────────────────▼───────────────┐           │
        │ CHATWOOT (self-hosted, Docker)             │◄──────────┘
        │ inbox WhatsApp Cloud · times · atribuição  │
        │ etiquetas = etapa · status pending/open    │
        │ Agent Bot "Heloísa" (webhook)              │
        └───────────────┬───────────────┬────────────┘
                        │ webhook       │ API (mensagens, status, assign, labels)
        ┌───────────────▼───────────────▼────────────┐        ┌──────────────────────────┐
        │ SERVIÇO "AGENTE HELOÍSA" (Node/TS)         │◄──────►│ SUPABASE (CRM próprio)   │
        │ • Orquestrador de estados por contato      │        │ contatos · etapas · tarefas│
        │ • Claude (Sonnet 5 conversa / Haiku 4.5    │        │ consentimento/opt-out     │
        │   classificação) com tools                 │        │ pré-cadastro · status app │
        │ • Fila/cron de cadências (BullMQ/pg-boss)  │        └──────────────────────────┘
        │ • Módulo de áudio (biblioteca + TTS clone) │        ┌──────────────────────────┐
        │ • Guardrails de envio (limites, horário)   │◄──────►│ Google Calendar + Meet   │
        └────────────────────────────────────────────┘        └──────────────────────────┘
                  Infra: VPS (R$ 44–60) OU máquina dedicada em Natal + Cloudflare Tunnel
```

**Decisões e justificativas**

1. **Cloud API oficial com Coexistence** (seção 2.1). Justificativa: (a) o número verificado é ativo estratégico; (b) volume da KOMUNE (≤ 30 primeiros contatos/dia) cabe folgado no tier inicial de 250; (c) custo por mensagem é marginal (≈ R$ 130–380/mês); (d) o celular no bolso da Heloísa mantém a pessoalidade (foto, ligações, áudio ao vivo) e a rota de visitas; (e) o CRM enxerga o que ela manda pelo app (echoes).
   - **Caminho A (mais barato)**: Cloud API direta na Meta (R$ 0 de plataforma). Coexistence direto exige Tech Provider + Embedded Signup — se travar, usar o número **só** na API (perde o app; ligações por outro chip pessoal da Heloísa) ou ir para o caminho B.
   - **Caminho B (mais rápido para Coexistence)**: 360dialog (≈ US$ 49–59/mês, sem markup, coexistence documentado, inbox nativa no Chatwoot).
   - Decidir em 1 dia de spike: tentar A; se a Meta não liberar coexistence no app da KOMUNE em 48 h, fechar B.
2. **Primeiro toque em modo assistido** (humano pelo app) como padrão; **modo automático** por template como opção de escala com limite diário. Motivos: custo zero, sem template a aprovar, sem "zona cinzenta" de opt-in, resposta melhor, e o robô assume dentro da janela gratuita.
3. **Chatwoot** como inbox e camada de handoff: self-hosted é gratuito (Cloud US$ 19–39/agente se preferir SaaS) [F: Chatwoot pricing]; tem inbox nativa WhatsApp Cloud/360dialog, times, atribuição, etiquetas, atributos customizados, automações, relatórios, Agent Bot API com estados `pending → open → resolved` [F: Chatwoot docs]. Resolve "mensagem não pode cair num grupo onde ninguém vê": toda conversa nasce com responsável (round-robin por etiqueta/segmento) e SLA.
4. **Serviço próprio "Agente Heloísa"** (em vez de Typebot/Botpress): a conversa é aberta e contextual (pitch, objeções, agendamento), e a integração com o CRM Supabase é o centro — Claude Code constrói rápido. Typebot/n8n ficam como opcionais (formulários, automações não críticas).
5. **Conector**: usar **Evolution API v2.4 no engine Cloud API** (ganha manager, Chatwoot já integrado, `sendWhatsAppAudio` com conversão) **ou** 200 linhas próprias sobre o Graph API (send template/text/audio, upload de mídia, webhook). Recomendo o Graph API direto (menos peças; Chatwoot já faz a inbox) e manter uma instância Evolution **Baileys apenas em laboratório**, com chip descartável, para testes de UX (nunca para prospecção com o número da KOMUNE).
6. **Infra**: para uptime de webhooks, VPS (Hostinger KVM 2: 2 vCPU/8 GB, ≈ R$ 44/mês [F]; ou KVM 1 R$ 30) hospedando Chatwoot + Postgres + Redis + serviço do agente. Alternativa custo zero: uma das máquinas trazidas dos EUA em Natal com Docker + **Cloudflare Tunnel** (conexão só de saída, sem abrir porta, domínio na Cloudflare) [F: Cloudflare docs] + nobreak. Webhooks da Meta também podem cair numa **Supabase Edge Function** (já contratada) que grava na fila do CRM, tirando a máquina local do caminho de entrada; Chatwoot ainda precisa de URL pública.
7. **Segurança**: token de sistema da Meta com escopo mínimo, verificação de assinatura `X-Hub-Signature-256`, segredos em `.env`/Vault, logs sem conteúdo de mensagem além do necessário, retenção definida (LGPD).

**Fluxo ponta a ponta**

1. Scraper/planilha → `contatos` (origem, categoria, telefone, evidência pública, `consent_basis = legítimo interesse`).
2. Cron diário monta a **fila do dia** (respeitando limites e prioridades por categoria/onda) → CRM mostra à Heloísa a lista com texto pronto + botão `wa.me` (modo assistido) **ou** envia template (modo automático).
3. Resposta do fornecedor → webhook → Chatwoot (conversa `pending`, etiqueta `etapa:contato`) → Agent Bot chama o serviço → Claude classifica intenção e responde (texto curto + áudio contextual) → atualiza etapa/temperatura no Supabase.
4. Interesse → agente propõe 2 horários (manhã Meet / tarde visita por rota) via Calendar `freebusy` → cria evento com Meet e convida → template utility de confirmação e lembrete D-1 (grátis se dentro de janela).
5. Após apresentação → pré-cadastro gerado no painel (não publicado) → link → cadências de "cobrança" até `perfil_completo` (checando status no Supabase a cada envio).
6. Qualquer gatilho de handoff → conversa vira `open`, atribuída ao responsável, notificação; humano responde pelo Chatwoot ou pelo celular (echo mantém tudo no CRM); ao resolver, pode devolver ao bot (`pending`).
7. Suporte: mensagens de clientes já ativos entram na mesma inbox, etiqueta `suporte`, time "Suporte" (Heloísa/Dennis), sem passar pelo agente de prospecção (roteamento por etiqueta/atributo `tipo_contato`).

---

## 4. Guardrails de envio

| Guardrail | Regra recomendada (MVP) | Por quê |
|---|---|---|
| Volume diário de **primeiros contatos** | Semana 1: ≤ 20/dia · Semana 2: ≤ 35 · Semana 3+: 40–60/dia (teto duro 100) | Bem abaixo do tier 250; cria histórico de qualidade; mimetiza aquecimento [F: Unred, Achiya] |
| Volume total iniciado pela empresa (templates) | ≤ 150/dia; ≤ 60/hora | Evita picos que caracterizam disparo em massa (>60/h citado como "zona de perigo") [F: Whatsable] |
| Janelas de envio | Seg–sex 09:00–11:30 e 14:00–17:30; sáb 09:00–12:00 só para follow-up; nunca dom/feriado; nunca antes das 8h ou depois das 19h | Melhor resposta, menos denúncia; fornecedores de eventos trabalham fim de semana — respeitar |
| Intervalo entre envios | Aleatório 45–180 s (modo automático); lotes de ≤ 25 com pausa de 10–15 min | Cadência humana [F: Unred, Achiya] |
| Toques sem resposta | Máx. 3 mensagens iniciadas pela empresa em 10 dias (D0, D+2, D+6); depois pausa de 30 dias; máx. 2 ciclos | Evita saturação e denúncia; respeita limite por usuário da Meta |
| Opt-out | Palavras: "não", "pare", "parar", "sair", "remover", "não tenho interesse" → `opt_out=true`, confirmação curta, bloqueio de novos envios; botão de opt-out em todo template de marketing | Política Meta + LGPD (direito de oposição) |
| Conteúdo do 1º toque | ≤ 300 caracteres; nome do fornecedor + categoria + onde vimos ("vi seu perfil no Casamentos.com.br"); pedir permissão ("posso te explicar em 40 s de áudio?"); **sem link, sem preço, sem emoji em excesso**; assinatura "Heloísa, da Komune" | Personalização reduz bloqueio; links no 1º toque são sinal de spam [F: Unred, Achiya] |
| Variação de texto | 4–6 variantes por etapa, rotação + campos dinâmicos | Mensagens idênticas em massa são sinal [F: Achiya] |
| Monitor de saúde | Diário: taxa de bloqueio/denúncia (webhook `phone_number_quality_update`, status `failed`), taxa de resposta, erro 131049, templates pausados. Bloqueio > 2 % ou resposta < 15 % em 3 dias → **pausa automática** e revisão de copy | Meta age por acúmulo [F: Whatsable, Chatarmin] |
| Templates | Marketing: 1º toque e reengajamento; Utility: confirmação/lembrete de reunião, "cadastro pendente" (relação já existente); nunca usar utility para texto promocional | Recategorização e custo |
| Handoff obrigatório | Ver seção 5 (8 gatilhos) + "falar com humano" sempre disponível; telefone/e-mail no perfil | Política de escalonamento humano [F: Blip, política] |
| Horário de resposta do robô | Dentro da janela, responde em 20–90 s (delay aleatório, typing indicator); fora do horário comercial responde 1 vez e agenda continuação | Naturalidade |
| Número reserva | Segundo número (chip) já verificado no Business Manager, "aquecido" com uso humano leve, para contingência | Continuidade |
| Nunca | Comprar listas; listas de transmissão do app para frios; mensagens em grupo; encurtadores; prometer valores de seguro; usar Baileys no número principal | Risco alto |

**Aquecimento do número oficial** (mesmo na Cloud API vale): 2 semanas de uso humano normal antes de ligar o modo automático; verificar o negócio; foto + descrição + site + e-mail no perfil; responder rápido a todo mundo (taxa de resposta pesa na qualidade).

---

## 5. Desenho do agente de IA

### 5.1 Máquina de estados por contato (espelha o funil do Contexto Mestre)

```
NOVO ──(1º toque)──► CONTATADO ──(sem resposta 24h)──► AGUARDANDO ──F1 D+2──► F2 D+6 ──► PAUSADO_30D ──► (2º ciclo ou PERDIDO:sem_resposta)
   │                     │
   │                     └──(respondeu)──► RESPONDEU ──classificar──┬─► EM_CONVERSA (dúvidas/pitch/áudio)
   │                                                                ├─► AGENDANDO ──► REUNIAO_MARCADA ──► APRESENTADO
   │                                                                ├─► ADIAR (data futura → volta a CONTATADO na data)
   │                                                                ├─► NAO_E_O_CONTATO (pede o contato certo → NOVO com novo número)
   │                                                                ├─► OPT_OUT (fim)
   │                                                                └─► HUMANO (handoff)
APRESENTADO ──(interesse)──► CADASTRO_INICIADO ──cadências D+1/D+3/D+7/D+14──► PERFIL_COMPLETO ──► PUBLICADO ──► CLIENTE
                └──(sem interesse)──► PERDIDO (motivo obrigatório)
Estados transversais: HUMANO (bot pausado; responsável atribuído), OPT_OUT, PERDIDO(motivo), ERRO_NUMERO (sem WhatsApp/inválido)
Temperatura derivada: frio (NOVO/CONTATADO/AGUARDANDO) · morno (RESPONDEU/EM_CONVERSA) · quente (AGENDANDO/REUNIAO/APRESENTADO/CADASTRO) · cliente (PUBLICADO+)
```

### 5.2 Intenções (classificador estruturado — Haiku 4.5, JSON com `intent`, `confidence`, `entities`, `sentiment`)

`interesse_sim` · `interesse_nao` · `pergunta_taxa_preco` · `pergunta_como_funciona` · `pergunta_o_que_e_komune` · `pede_material` · `agendar` · `reagendar` · `cancelar` · `adiar_contato` (com data) · `ja_cadastrado` · `nao_e_o_contato` · `numero_errado` · `autoriza_precadastro` / `nao_autoriza_precadastro` · `duvida_cadastro` (técnica) · `reclamacao` · `opt_out` · `pede_humano_ou_ligacao` · `saudacao_ou_ack` · `audio_recebido` (→ transcrever antes) · `outro`.

Regra: `confidence < 0,6` ou `outro` duas vezes seguidas → humano.

### 5.3 Ferramentas (tool use) do agente

| Ferramenta | Função | Backend |
|---|---|---|
| `get_contact_context(contact_id)` | Nome, empresa, categoria, origem, etapa, últimos 20 turnos, fatos memorizados, consentimento, pré-cadastro | Supabase |
| `classify_intent(text)` | JSON de intenção (5.2) | Haiku 4.5 |
| `send_text(text)` | Mensagem curta (≤ 300 chars; máx. 2 por turno) | Chatwoot API ou Graph API |
| `send_audio(clip_id \| tts_text)` | Escolhe clipe da biblioteca ou gera com voz clonada (seção 6) e envia como voz (ogg/opus) | Graph API / Evolution `sendWhatsAppAudio` |
| `propose_slots(kind: meet\|visita, bairro?)` | 2–3 horários: manhã (Meet) / tarde (visita agrupada por bairro/rota) | Google Calendar `freebusy` |
| `create_meeting(slot, kind, attendee_email?)` | Evento com Meet (`conferenceData.createRequest`, `conferenceDataVersion=1`, `sendUpdates=all`) ou visita com endereço | Google Calendar API [F] |
| `update_stage(stage, reason?)` / `set_temperature` | Move funil; registra motivo de perda | Supabase |
| `remember_fact(key, value)` | Memória por contato (ex.: "sócio decide", "fecha só em novembro") | Supabase (JSONB) |
| `schedule_followup(when, template_or_text)` | Enfileira cadência respeitando guardrails | Fila (pg-boss/BullMQ) |
| `create_precadastro_link()` | Gera/recupera link do painel do fornecedor (não publicado) | API Komune |
| `check_cadastro_status()` | % completo, campos faltantes, publicado? | Supabase Komune |
| `handoff_to_human(reason, urgency, suggested_owner)` | Chatwoot: status `open`, assign, etiqueta `humano`, nota interna com resumo | Chatwoot API |
| `set_opt_out()` | Marca e bloqueia envios | Supabase |
| `transcribe_audio(media_id)` | Áudio recebido → texto | OpenAI GPT-Transcribe (≈ US$ 0,0045/min na página de preços, set/2026) ou Whisper local |

### 5.4 Escalonamento para humano (gatilhos)

1. Pedido explícito de pessoa/ligação/reunião presencial imediata.
2. Negociação de taxa, exclusividade, contrato, seguro/garantia, valores de indenização.
3. Reclamação, tom negativo forte ou menção a órgão/advogado/Procon.
4. Perguntas técnicas do cadastro que exigem acesso ao painel (bugs, Pix, CNPJ).
5. Fornecedor "âncora" (espaços, buffets, cerimonialistas com > N avaliações) — atributo `vip=true` → bot só faz o 1º contato e agenda; conversa passa a humano.
6. Dois turnos consecutivos com `confidence < 0,6` ou intenção `outro`.
7. Mensagem recebida com mídia que o bot não interpreta (documento, vídeo).
8. Qualquer resposta que o validador de saída bloqueou (5.5).

Handoff = resumo em nota interna (quem, o que quer, próximo passo sugerido) + atribuição por regra: categoria → responsável (Bárbara: espaços/buffets/cerimonial; Heloísa: demais; Rafael: VIP) + notificação (Chatwoot push/e-mail; opcional Asana task).

### 5.5 Controle de alucinação e de promessas comerciais

- **Base de conhecimento fechada (KB)** no system prompt (cacheada): o que é a Komune, taxa **8 %** (3 % + 5 % quando há cerimonialista), sem mensalidade, paga só quando fecha, mídia/destaque rotativo (10 por vez), selo Verificado, "pelo menos 1 lead real nos 30 primeiros dias" para fundadores, como funciona o pré-cadastro e a autorização. **Lista explícita de "não pode afirmar"**: valor do seguro (em avaliação), taxa zero (não é mais central — só se Rafael reativar), descontos, exclusividade, número de leads futuros, prazos de pagamento, comparações depreciativas com concorrentes.
- **Saídas estruturadas**: o modelo devolve `{reply, audio_clip?, actions[], needs_human, claims[]}`; cada `claim` precisa mapear para um item da KB (id) — claim sem id → resposta bloqueada e reescrita sem a afirmação, ou handoff.
- **Validador determinístico pós-geração**: regex para `%`, `R$`, "garant", "grátis", "exclusiv", "desconto", "seguro", URLs fora da allowlist → bloqueio/handoff. Limite de 2 mensagens e 300 caracteres por turno; sem emojis em série; sem repetir o mesmo áudio para o mesmo contato.
- **Modelo e temperatura**: Sonnet 5 (conversa) com temperatura baixa; Haiku 4.5 (classificação e follow-ups formulaicos). Prompt caching de KB e persona (leitura a 10 % do preço) [F: preços Anthropic].
- **Persona**: fala como Heloísa (curta, nordestina cordial, sem jargão), mas **nunca nega ser assistida por automação se perguntada** ("uso um assistente que me ajuda a organizar as conversas; se preferir, te ligo agora") — coerente com transparência da KOMUNE, com a política de escalonamento humano e com a tendência regulatória (PL 2338/2023 sobre IA) [V].
- **Memória por contato**: fatos em JSONB + resumo rolling (≤ 800 tokens) regenerado a cada 10 turnos; histórico completo fica no Chatwoot/Supabase; nunca injetar dados de outro contato.
- **Avaliação contínua**: 30 conversas/semana revisadas por humano (amostra), com nota de "prometeu algo?", "soou robô?", "escalou certo?"; conjunto de testes de regressão com 50 diálogos sintéticos antes de cada mudança de prompt.

### 5.6 Frameworks (escolha)

| Opção | Prós | Contras | Veredito |
|---|---|---|---|
| **Claude Agent SDK** (Python/TS) | Loop de agente pronto, tools via MCP in-process, hooks, sessões, subagentes; termos comerciais cobrem uso em produto [F: docs] | Foi desenhado com Claude Code por baixo (ferramentas de arquivo/shell embutidas) — precisa restringir permissões; mais pesado que o necessário para um chatbot | Bom para o "agente secretária/cobrador" interno; para o chat com fornecedores, um loop simples basta |
| **Anthropic Messages API + tool use** (loop próprio) | Controle total, leve, estruturado, cache | Escrever o loop (poucas dezenas de linhas) | **Recomendado para o MVP** |
| **Vercel AI SDK** (`ToolLoopAgent`, Zod, provider Anthropic) | TS idiomático, saídas tipadas, `stopWhen`, `prepareStep` [F] | Mais uma abstração | Boa alternativa em TS |
| **LangGraph** | Grafo de estados com `interrupt()`/`Command(resume)` e checkpointer por `thread_id` — ideal para aprovação humana antes de ações [F] | Curva; Python-first | Considerar se a máquina de estados crescer |
| **OpenAI Agents SDK** | Handoffs entre agentes, guardrails de entrada/saída, tracing [F] | Amarra a OpenAI | Padrão de "triagem → especialista → escalonamento" é reaproveitável mesmo sem o SDK |
| Typebot / Botpress / Rasa | Fluxos visuais; Rasa é NLU clássico | Rígidos para conversa aberta; Botpress cloud pago; Rasa Pro licenciado | Usar Typebot só para formulários (ex.: coleta de dados do pré-cadastro) |
| n8n / Activepieces | Automações auxiliares (relatório 8h de segunda, Asana, e-mail); node `n8n-nodes-evolution-api` existe | Não é o lugar da lógica de conversa | Sim, como cola |

Integração com o CRM: tudo por **webhooks/eventos** (Meta → Chatwoot → agente; agente → Supabase via service key; Supabase → agente via Database Webhooks/Realtime para "cadastro completou", "lead recebido"), com tabela `events` para auditoria e replay.

---

## 6. Módulo de áudio humanizado

**Estratégia em camadas (do mais autêntico ao mais sintético)**

1. **Áudio gravado ao vivo pela Heloísa** (pelo celular, quando disponível) — o Coexistence eco-sincroniza para o CRM. Melhor de todos; zero custo.
2. **Biblioteca pré-gravada** (25–40 clipes, 15–60 s, gravados em ambiente silencioso, celular mesmo): `apresentacao_curta`, `o_que_e_komune`, `como_funciona_taxa_8`, `sem_mensalidade`, `pedido_autorizacao_precadastro`, `convite_reuniao_manha_meet`, `convite_visita_tarde`, `confirmacao_reuniao`, `lembrete_reuniao`, `obrigado_reuniao_link_cadastro`, `cobranca_cadastro_1/2/3`, `objecao_ja_uso_casamentos_com`, `objecao_sem_tempo`, `objecao_taxa_alta`, `despedida_opt_out`, `feriado/fim_de_semana`, variações A/B. Seleção por (intenção × etapa) com regra de não repetição por contato; metadados no Supabase (`clip_id, contexto, duração, versão`). Normalizar com ffmpeg: `ffmpeg -i in.m4a -ac 1 -ar 48000 -c:a libopus -b:a 48k out.ogg`.
3. **TTS com voz clonada** apenas para trechos variáveis ("Oi, Marcos, vi o trabalho do Buffet X…", datas/horários), gerando o clipe inteiro com a voz clonada (não "colar" pedaços — soa artificial). Provedores:

| Provedor | Clonagem | Custo | pt-BR | Observações |
|---|---|---|---|---|
| **ElevenLabs** | Instant (Starter US$ 6/mês, 1–3 min de amostra) e **Professional** (Creator US$ 22/mês, 30 min–3 h de áudio, 24–48 h de processamento) | Creator ≈ 100 min/mês; excedente ≈ US$ 0,17–0,20/min [F: pricing, Dupple, Cognitive Future] | Excelente (Multilingual v2/v3) | Exige gravação de declaração de consentimento pelo dono da voz; qualidade referência para PT |
| Cartesia (Sonic) | Instant (Pro US$ 5) e Professional (Startup US$ 49) | ≈ US$ 0,038/1k chars; latência ~40 ms [F] | 40+ idiomas [F]; validar sotaque BR | Ótima latência (irrelevante para voice note) |
| Fish Audio / Fish Speech (OSS) | Instant com poucos segundos | API ≈ US$ 15/1M chars [V]; self-host grátis (GPU) | Bom | Precisa GPU própria para self-host |
| Google Chirp 3 HD / Instant Custom Voice | Custom Voice instant | US$ 30/1M chars (Chirp 3 HD) · US$ 60/1M (Instant Custom Voice) [F] | Vozes pt-BR nativas (Aoede, Kore, Leda, Puck…) [V] | Sem clone profissional |
| Azure Neural / Custom Neural Voice | Profissional (requer aprovação e processo anti-fraude) | ≈ US$ 15–24/1M chars neural; CNV com taxa de treino/hospedagem [V] | pt-BR muito bom (Francisca, Thalita…) | Burocracia da CNV |
| OpenAI gpt-4o-mini-tts | **Sem clonagem** | ≈ US$ 0,015/min [F: TextToLab] | OK | Só para voz genérica (não é Heloísa) |
| XTTS v2 / Qwen3-TTS / Chatterbox (open source) | Zero-shot clone | GPU própria | Variável | Qualidade PT inferior às comerciais; manutenção |

Custo de referência: 300 áudios/mês × 30 s = 150 min → ElevenLabs Creator (100 min) + ~50 min extras ≈ **US$ 30–32/mês** (≈ R$ 170); biblioteca pré-gravada custa R$ 0.

**Envio como mensagem de voz**: Cloud API → upload de mídia (`/media`, `audio/ogg`) → `messages` `type: audio` (ogg/opus mono, ≤ 512 KB para exibir play) [F: Meta]; Evolution → `sendWhatsAppAudio` com `encoding: true`. Antes do áudio: typing indicator + 3–8 s de espera; nunca dois áudios seguidos; texto de 1 linha acompanhando ("te mandei um áudio de 40 s explicando 👆").

**Consentimento e ética**: termo escrito da Heloísa autorizando o uso da voz clonada, finalidade, revogação e retenção (LGPD: voz é dado pessoal; biometria = sensível se usada para identificar); ElevenLabs exige declaração gravada. Política interna: o robô não afirma "acabei de gravar esse áudio"; se perguntada, a Heloísa/robô admite o uso de assistente. Registrar em cada mensagem `audio_source = live | library | tts`.

**Áudio recebido**: transcrever (OpenAI GPT-Transcribe ≈ US$ 0,0045/min; Live-Transcribe US$ 0,017/min [F: página de preços OpenAI, set/2026]; ou Whisper local na máquina dedicada, R$ 0) → classificar → responder; se o fornecedor manda muitos áudios, o bot pode perguntar "prefere que eu te ligue?" → handoff.

**Nota técnica (Cloud API)**: a documentação atual de mensagens de áudio menciona o envio "como mensagem de voz" para .ogg/Opus mono — verificar no PRD o campo exato do payload (`voice`) na versão do Graph API adotada [V].

---

## 7. Boas práticas de prospecção por WhatsApp no Brasil (checklist de copy e cadência)

- **Identidade real**: foto da Heloísa (ou dela + logo), nome "Heloísa · Komune", descrição, site, endereço em Natal, e-mail. Perfil verificado pela Meta (empresa).
- **Mensagem curta e específica** (≤ 3 linhas): quem sou, de onde conheço o fornecedor (fonte pública, categoria), por que estou falando **com ele** (ex.: "estamos abrindo a categoria de fotografia em Natal com 10 fornecedores fundadores"), pergunta fechada de permissão.
- **Pedir permissão antes do pitch e do áudio** ("posso te mandar um áudio de 40 s?"). Áudio só depois do "sim" — é o momento "tá quente" da reunião.
- **Sem link, sem PDF, sem preço no 1º toque**; preço (8 %) só quando perguntado ou na apresentação.
- **Horário**: 9h–11h30 e 14h–17h30 em dias úteis (fornecedores de eventos: evitar sexta à tarde e sábado, quando estão em evento); responder rápido nas janelas.
- **Cadência** D0 → D+2 (texto leve, outra variante) → D+6 (áudio curto ou "posso encerrar por aqui?") → pausa 30 dias → 2º ciclo com novo gancho (ex.: "abrimos a demanda X") → perdido.
- **Opt-out explícito e fácil** ("se não fizer sentido, é só me dizer que não te procuro mais").
- **Personalização por origem**: Casamentos.com.br (mencionar avaliações), GetNinjas (pedidos que ele atende), Instagram (um post concreto), Econodata (só o CNAE — mensagem mais institucional).
- **Prova social local** ("já estão com a gente: …" quando houver ≥ 5 por categoria) e evento demo de sábado como CTA.
- **Volume por número** e **número aquecido** (seção 4); um número principal + um reserva; nunca "chipeira".
- **Registrar tudo no CRM**: fonte, data/hora do 1º contato, resposta, motivo de perda, opt-out (evidência para LGPD e para o quality rating).

---

## 8. Custos comparados (450 contatos e ~3.000 msgs/mês; R$ 5,40/US$)

Mix assumido para 3.000 mensagens: 450 primeiros toques; ~350 follow-ups fora de janela (marketing); ~300 utility (confirmação/lembrete/cadastro pendente) fora de janela; restante (~1.900) dentro de janelas (grátis na via oficial).

| Item | A) Cloud API direta, modo assistido | B) Cloud API direta, modo automático | C) 360dialog + Coexistence, assistido | D) Não oficial (Evolution/Baileys self-host) | E) Não oficial hospedada (Z-API/uazapi) |
|---|---|---|---|---|---|
| Plataforma/BSP | R$ 0 | R$ 0 | ≈ R$ 265–320 | R$ 0 | R$ 60–150 |
| Mensagens Meta | 350 × 0,34 + 300 × 0,037 ≈ **R$ 130** | + 450 × 0,34 ≈ **R$ 285** | ≈ R$ 130 | R$ 0 | R$ 0 |
| Chatwoot (self-host) | R$ 0 | R$ 0 | R$ 0 | R$ 0 | R$ 0 |
| Evolution/conector | R$ 0 | R$ 0 | R$ 0 | R$ 0 | incluso |
| LLM Claude (3.000 turnos; Sonnet 5 + Haiku 4.5, cache) | ≈ US$ 15–30 → **R$ 80–160** | idem | idem | idem | idem |
| STT áudios recebidos (~300 min) | ≈ R$ 10 | idem | idem | idem | idem |
| TTS voz clonada (opcional) | R$ 0 (biblioteca) a R$ 170 (ElevenLabs) | idem | idem | idem | idem |
| Infra | VPS R$ 44–60 **ou** máquina local + Cloudflare Tunnel R$ 0 (+ energia) | idem | idem | VPS R$ 44–60 + proxy dedicado R$ 20–80 [F: ProxyAds] | VPS pequena R$ 30 |
| Google Calendar/Meet | R$ 0 (Workspace já existente) | idem | idem | idem | idem |
| **Total mensal** | **≈ R$ 220–530** | **≈ R$ 375–690** | **≈ R$ 485–850** | **≈ R$ 155–480** | **≈ R$ 180–520** |
| Risco não precificado | Baixo | Baixo-médio (bloqueios no 1º toque) | Baixo | **Perda do número principal** (custo de remediação estimado em R$ 30 mil por um blog do setor [F: Cubosuite]); indisponibilidade a cada quebra de protocolo; sem DPA | idem + dependência de terceiro |
| Custo por contato trabalhado | ≈ R$ 0,50–1,20 | ≈ R$ 0,85–1,55 | ≈ R$ 1,10–1,90 | ≈ R$ 0,35–1,05 | ≈ R$ 0,40–1,15 |

Escalando para 600 contatos e 4.500 msgs: A ≈ R$ 300–690; B ≈ R$ 500–900; D ≈ R$ 190–600. A diferença entre oficial direta (A) e não oficial (D) fica em **R$ 100–200/mês** — menor que uma hora de retrabalho da equipe por semana.

Detalhe do LLM: por turno ≈ 3 k tokens cacheados (persona + KB) + 1 k tokens novos + 250 de saída. Sonnet 5 (US$ 2 / 10 por MTok; cache read a 10 %): 3.000 × (3 k × 0,2 + 1 k × 2 + 0,25 k × 10)/1M ≈ US$ 15 [F: preços Anthropic set/2026]. Haiku 4.5 (US$ 1 / 5) para classificação ≈ US$ 2–3.

---

## 9. Riscos, jurídico e mitigação

| Risco | Mitigação |
|---|---|
| Bloqueios/denúncias derrubam o quality rating | Modo assistido no 1º toque; volumes da seção 4; monitor com pausa automática; copy testada em 50 contatos antes de escalar |
| Template de marketing reprovado/recategorizado | Ter 3 variantes aprovadas por etapa; utility só para relação existente; revisar categorias mensalmente |
| Coexistence indisponível/instável para a conta | Plano B: número na Cloud API pura + chip pessoal para ligações; Plano C: BSP |
| Limite por usuário (131049) em fornecedores muito abordados por outras marcas | Retentar em 48 h; no modo assistido não se aplica (app) |
| Alucinação/promessa comercial | KB fechada, claims mapeados, validador, amostragem semanal (5.5) |
| Uso da voz clonada sem consentimento/abuso | Termo assinado; provedor com verificação; flag `audio_source`; política de não negar automação |
| LGPD — dados de contato obtidos em fontes públicas (scraping) | Base legal: legítimo interesse (art. 7º, IX) com teste de balanceamento documentado (finalidade B2B legítima, dados públicos de contato profissional, expectativa razoável, minimização — só nome/empresa/categoria/telefone/evidência), transparência no 1º contato (quem somos, de onde veio o contato, como sair), **direito de oposição imediato**, retenção definida (ex.: 12 meses sem interação → anonimizar), registro de origem. Não publicar perfil sem autorização (decisão já tomada). Guia da ANPD sobre legítimo interesse [V: não consegui abrir a página; consultar gov.br/anpd] |
| Termos das fontes (Casamentos.com.br, GetNinjas, Instagram) proíbem scraping | Risco civil/contratual separado do WhatsApp; usar dados mínimos e priorizar fontes abertas (Google, CNPJ/Econodata) — ver pesquisa 02 |
| Dependência de uma pessoa (Heloísa) | Biblioteca de áudios + persona documentada; segunda voz (Bárbara) para suporte |
| Máquina local cai (energia/internet) | VPS para webhooks + Chatwoot; máquina local só para jobs; ou Supabase Edge Function como receptor |

---

## 10. Próximos passos sugeridos para o PRD

1. **Spike de 1–2 dias**: Business Manager + verificação da KOMUNE; tentar Coexistence do número atual (caminho A); em paralelo criar 3 templates (1º toque, follow-up, lembrete utility) e medir tempo de aprovação.
2. **MVP (semana 1)**: Chatwoot em Docker (VPS) + inbox Cloud API; serviço do agente com 6 ferramentas (contexto, classificar, texto, áudio-biblioteca, etapa, handoff); fila de primeiros toques em modo assistido; painel no CRM com "lista do dia".
3. **Semana 2**: agendamento (Calendar/Meet + rota de visitas), cadências de follow-up e cobrança de cadastro, métricas (resposta, reunião, cadastro), modo automático com teto de 20/dia.
4. **Semana 3**: voz clonada (se a biblioteca não bastar), agente secretária interno (Agent SDK) rodando na mesma máquina, relatório de segunda 8h via n8n.
5. **Métricas de saúde a acompanhar desde o dia 1**: taxa de bloqueio, quality rating, taxa de resposta em 24 h, reuniões/100 contatos, cadastros completos/reunião, % de conversas com handoff, custo por fornecedor publicado.

---

## 11. Fontes (URLs consultadas em set/2026)

**Preços e regras da plataforma oficial**
- Meta — Pricing updates (jul/2025): https://developers.facebook.com/docs/whatsapp/pricing/updates-to-pricing/
- Meta — Pricing (exige login): https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing
- Meta — Audio messages (formatos, ogg/opus, 16 MB, 512 KB): https://developers.facebook.com/documentation/business-messaging/whatsapp/messages/audio-messages
- WhatsApp Business Messaging Policy (opt-in, escalonamento humano, impersonação): https://business.whatsapp.com/policy
- Blueticks — WhatsApp Business API Pricing 2026 (Brasil US$ 0,0625 / 0,0068; janelas grátis; histórico de mudanças): https://blueticks.co/blog/whatsapp-business-api-pricing-2026
- EZContact — comparação Meta/Twilio/360dialog/WATI (mai/2026): https://ezcontact.ai/en/blog/whatsapp-api-pricing-comparison-meta-twilio-360dialog-ezcontact/
- Whautomate — Pricing Brazil 2026: https://whautomate.com/whatsapp-business-api-pricing-brazil
- Ominiflow — Brazil rates: https://ominiflow.com/whatsapp-api-pricing/brazil
- api-wa.me — preços Meta no Brasil em R$ (jul/2026): https://api-wa.me/blog/quanto-custa-api-whatsapp-precos-meta
- Maxbot — Quanto custa a API oficial 2026 (abr/2026): https://www.maxbot.com.br/blog/quanto-custa-a-api-oficial-do-whatsapp-2026
- Nexe — WhatsApp API em reais no Brasil: https://nexe.com.br/whatsapp-api-em-reais-brasil/
- HelenaCRM — Meta anuncia cobrança em reais: https://www.helenacrm.com/post/meta-anuncia-cobranca-em-reais-no-brasil
- Gallabox — Pricing changes 1 July 2025: https://gallabox.com/whatsapp-business-pricing-July-2025-update
- 8x8 — WhatsApp pricing changes: https://cpaas.8x8.com/en/blog/whatsapp-pricing-changes-2024/
- YCloud — pricing update: https://www.ycloud.com/blog/whatsapp-api-pricing-update
- MEF — Business models 2023–2025: https://mobileecosystemforum.com/2026/02/26/whatsapp-business-platform-business-models-2023-2025-updates/

**Limites, qualidade, opt-in, IA e spam**
- Chatarmin — Messaging limits 2026 (tiers, portfólio, 131049, 2 marketing/usuário/dia): https://chatarmin.com/en/blog/whats-app-messaging-limits
- AiSensy — Messaging tiers 2026: https://m.aisensy.com/blog/whatsapp-message-limits-guide/
- Wati — API rate limits (80 msg/s; tiers; pausa de marketing nos EUA): https://www.wati.io/en/blog/whatsapp-api-rate-limits/
- WatEase — Per-user marketing limits (131049): https://watease.com/glossary/per-user-marketing-limits
- Whatsable — Spam policy 2026 (bloqueio > 2 %, > 60 msg/h): https://whatsable.app/blog/whatsapp-spam-policy-explained-for-businesses-in-2026
- Blip — Human Escalation Policy: https://help.blip.ai/hc/en-us/articles/4474389735191-Human-Escalation-Policy-in-WhatsApp-Business
- tyntec — enforcement da escalação humana: https://www.tyntec.com/helpcenter/docs/faqs/whatsapp-business/your-whatsapp-account/how-will-whatsapp-enforce-human-their-escalation-policy/
- respond.io — Not all chatbots are banned (15/jan/2026): https://respond.io/blog/whatsapp-general-purpose-chatbots-ban
- TechCrunch — WhatsApp bars general-purpose chatbots (18/10/2025): https://techcrunch.com/2025/10/18/whatssapp-changes-its-terms-to-bar-general-purpose-chatbots-from-its-platform
- Conferbot — "Chatbot rules 2026" (não confirmado na política oficial): https://www.conferbot.com/blog/whatsapp-chatbot-rules-2026
- ChakraHQ — conta restrita/banida: https://chakrahq.com/article/whatsapp-business-account-restricted-fix
- Achiya — 12 fixes contra ban 2026: https://achiya-automation.com/en/blog/whatsapp-spam-detection-2026/

**Coexistence**
- 360dialog — Coexistence (client docs): https://docs.360dialog.com/docs/resources/phone-numbers/coexistence
- 360dialog — Partner onboarding coexistence: https://docs.360dialog.com/partner/onboarding/whatsapp-coexistence
- YCloud — What is WhatsApp Business App Coexistence: https://www.ycloud.com/blog/whatsapp-business-app-coexistence-meta-update
- ChakraHQ — App + API on one number (2026): https://chakrahq.com/article/whatsapp-business-app-api-coexistence-2026/
- ChakraHQ — Coexistence worldwide availability: https://chakrahq.com/article/whatsapp-coexistence-business-app-register-cloud-api/

**BSPs**
- 360dialog blog (preços): https://360dialog.com/blog/br/category/precos-api-whatsapp/
- Kanal — 12 BSPs compared: https://getkanal.com/blog/whatsapp-business-api-providers-compared
- Notifica — Melhores BSPs Brasil 2026: https://blog.usenotifica.com.br/blog/08-top-whatsapp-bsps-brazil
- Wati pricing: https://www.wati.io/pricing/
- SocialHub — BSPs homologados Brasil 2026: https://www.socialhub.pro/blog/bsp-whatsapp-brasil-empresas-homologadas-meta-2026/
- Cubosuite — custo real e TCO oficial vs não oficial: https://blog.cubosuite.com.br/quanto-custa-a-api-do-whatsapp-oficial-vs-nao-oficial-custo-real-e-tco/

**APIs não oficiais, bans e prática brasileira**
- Evolution API (repo, Evolution Foundation): https://github.com/evolution-foundation/evolution-api
- Evolution API — releases (2.3.7, 2.4.0-rc): https://github.com/evolution-foundation/evolution-api/releases
- Evolution — Licensing & Activation: https://docs.evolutionfoundation.com.br/en/licensing
- Evolution — issue #2534 (ativação obrigatória): https://github.com/evolution-foundation/evolution-api/issues/2534
- Evolution — Send Audio (docs): https://mintlify.wiki/EvolutionAPI/evolution-api/api/messages/send-audio
- Evolution — Chatwoot integration: https://doc.evolution-api.com/v2/en/integrations/chatwoot
- Evolution — Typebot integration: https://doc.evolution-api.com/v2/en/integrations/typebot
- WAHA: https://waha.devlike.pro/ e https://github.com/devlikeapro/waha
- WaSphere — Open source WhatsApp API landscape 2026: https://wasphere.com/blog/open-source-whatsapp-api-landscape-2026/
- Indie Hackers — Evolution API alternatives 2026: https://www.indiehackers.com/post/best-10-evolution-api-alternatives-in-2026-tested-9fc702d744
- DAS — WhatsApp Business AI no Brasil + bloqueios 2026: https://blog.dastecnologia.com/whatsapp-business-ai-brasil-bloqueios-meta-2026.html
- AraraHQ — riscos reais de banimento: https://ararahq.com/blog/api-whatsapp-oficial-vs-nao-oficial-riscos
- Organizabot — Evolution API: riscos (mar/2026): https://blog.organizabot.com/2026/03/evolution-api.html
- Tipefy — API oficial vs Evolution vs Baileys: https://blog.tipefy.com/api-oficial-do-whatsapp-vs-evolution-api-e-baileys-o-que-muda-na-pratica-para-sua-empresa
- ProxyAds — oficial vs não oficial 2026: https://proxyads.com/blog/whatsapp-api-oficial-vs-nao-oficial/
- Café Online — Evolution desconectando 2026: https://agenciacafeonline.com.br/blog/evolution-api-whatsapp-caindo-2026-o-que-esta-acontecendo/
- Unred — Como evitar banimento 2026 (aquecimento): https://unred.com.br/blog/como-evitar-banimento-whatsapp
- Zap Trend — WhatsApp bloqueado e migração: https://zaptrend.com.br/blog/whatsapp-bloqueado-api-oficial/
- Wafly — Quanto custa API de WhatsApp (Z-API etc.): https://wafly.com.br/comparativos/quanto-custa-api-whatsapp/
- Cubosuite — Z-API guia 2026: https://blog.cubosuite.com.br/z-api-guia-completo/
- Comunidade ZDG — uazapi: https://comunidade.zdg.com.br/geral/api-uazapi/
- Zapster — Z-API vs Zapster: https://zapsterapi.com/blog/z-api-whatsapp-vs-zapster-precos-e-diferencas-2026

**Inbox, orquestração e agentes**
- Chatwoot — Agent Bots: https://www.chatwoot.com/docs/product/others/agent-bots
- Chatwoot — Pricing: https://www.chatwoot.com/pricing
- Cubosuite — Chatwoot + Evolution: atritos reais: https://blog.cubosuite.com.br/evolution-api-chatwoot-integracao/
- n8n-nodes-evolution-api: https://www.npmjs.com/package/n8n-nodes-evolution-api
- Stack Evolution+n8n+Chatwoot+Typebot (exemplo): https://github.com/Or4cu1o/Evolution-API_N8N_Chatwoot_Typebot
- Claude Agent SDK overview: https://code.claude.com/docs/en/agent-sdk/overview
- Anthropic — Pricing (Opus 5 / Sonnet 5 / Haiku 4.5; cache; batch): https://platform.claude.com/docs/en/about-claude/pricing
- LangGraph — Interrupts (human-in-the-loop): https://docs.langchain.com/oss/python/langgraph/interrupts
- OpenAI Agents SDK — Handoffs: https://openai.github.io/openai-agents-python/handoffs/
- Vercel AI SDK — Agents: https://ai-sdk.dev/docs/agents/overview
- Google Calendar API — Create events (Meet, attendees, sendUpdates): https://developers.google.com/workspace/calendar/api/guides/create-events

**Áudio / TTS**
- ElevenLabs pricing: https://elevenlabs.io/pricing
- ElevenLabs voice cloning (consentimento, IVC vs PVC): https://cognitivefuture.ai/elevenlabs-voice-cloning/
- Dupple — ElevenLabs pricing 2026: https://dupple.com/pricing/elevenlabs
- Cartesia pricing: https://cartesia.ai/pricing
- Google Cloud TTS pricing (Chirp 3 HD US$ 30/1M; Instant Custom Voice US$ 60/1M): https://cloud.google.com/text-to-speech/pricing
- Azure Speech pricing: https://azure.microsoft.com/en-us/pricing/details/cognitive-services/speech-services/
- OpenAI pricing: https://openai.com/api/pricing/ e TextToLab (OpenAI TTS por minuto): https://texttolab.com/blog/openai-tts-pricing
- FutureAGI — Best TTS APIs 2026: https://futureagi.com/blog/best-text-to-speech-providers-2026/
- Tomoda Hinata — TTS comparison 2026 (custos, clonagem, self-host): https://tomodahinata.com/en/blog/qwen-tts-vs-elevenlabs-openai-google-azure-tts-comparison

**Infra**
- Cloudflare Tunnel: https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/
- Hostinger VPS Brasil (KVM 1–8): https://www.hostinger.com/br/servidor-vps
