# Benchmark de CRMs — insumos para o PRD do CRM de Captação KOMUNE

**Data:** 03/09/2026 · **Autor:** pesquisa de produto (Claude) · **Escopo:** 29 produtos em 3 grupos (líderes globais, brasileiros/WhatsApp-first, open source)
**Lente de análise:** CRM próprio para captar fornecedores, produtores e cerimonialistas para o marketplace KOMUNE (Natal/RN → outras cidades), com scraper de fontes públicas, robô de WhatsApp em nome de pessoa real (Heloísa), pré-cadastro transparente na plataforma e "IA secretária" que cobra metas. Equipe de 5–8 usuários (núcleo de 6 + estagiários/embaixadores).

> **Como ler:** a seção 0 traz o sumário executivo; as seções 1–3 são o benchmark por grupo (com "telas descritas em texto"); as seções 4–9 são as entregas pedidas: (a) matriz comparativa, (b) funcionalidades obrigatórias priorizadas, (c) padrões de UX a copiar, (d) armadilhas, (e) tabela de preços, (f) fontes. Itens marcados **[verificar]** vêm de conhecimento de produto ou de fontes secundárias e devem ser checados antes de virar requisito contratual.

---

## 0. Sumário executivo (10 conclusões)

1. **Nenhum CRM de prateleira faz o núcleo do que a KOMUNE precisa** — pré-cadastro do fornecedor na plataforma a partir de dados públicos, sincronização de etapa com o status de publicação e "cobrança" de metas por pessoa. Isso confirma a decisão de construir. O que **não** vale construir do zero é a camada de inbox WhatsApp multiagente: usar Chatwoot (open source) + Evolution API/Meta Cloud API integrado ao CRM por webhooks.
2. **O padrão dos líderes é "activity-based selling"** (Pipedrive, Close, Odoo): todo negócio aberto tem obrigatoriamente uma **próxima atividade**; o cartão mostra o status dela com cores (verde/amarelo/vermelho/"!"); negócios sem movimento por X dias "apodrecem" (deal rotting) e ficam vermelhos. É a mecânica mais barata e mais eficaz para o "follow-up" que Rafael descreveu.
3. **Os WhatsApp-first (Kommo, RD Conversas, Agendor Chat, Umbler Talk) colocam a conversa dentro do cartão do negócio**: o cartão do lead é um chat com campos na lateral; o funil tem uma coluna "Leads recebidos" e **automações penduradas em cada etapa** ("Pipeline Digital"): ao entrar na etapa, dispara mensagem/robô/tarefa. Esse é o modelo a copiar para o bot da Heloísa.
4. **Temperatura = estrelas/prioridade + etapa**: RD Station CRM (qualificação 1–5 estrelas), Odoo (0–3 estrelas de prioridade) e HubSpot (lead status + score) tratam "frio/morno/quente" como campo derivado da etapa com override manual. Lead scoring preditivo só faz sentido com histórico; começar com regras de pontos simples.
5. **Modelo de objetos padrão do mercado:** Pessoa ↔ Empresa (N:1 com "papéis"/"association labels" e múltiplos contatos por empresa), Negócio/Oportunidade ligado a empresa + pessoa principal + participantes, Atividade (tipo, vencimento, feito), Nota, Tarefa; Lead como objeto **separado** ("caixa de leads" para triagem antes de virar negócio — Pipedrive, HubSpot, Frappe, Odoo). Para a KOMUNE: Empresa = fornecedor/produtor/cerimonialista com `segmento_comercial`, e a "caixa de leads" = alvos raspados ainda não trabalhados.
6. **Importação de planilha com mapeamento de colunas, criação de campo no ato, criação de múltiplos objetos por linha e desfazer em 48h (Pipedrive)** é a referência. Deduplicação: por e-mail/domínio (HubSpot, Attio), telefone e nome (Pipedrive), com ferramenta "Merge duplicates" que mostra negócios/atividades de cada registro antes de mesclar. Para a KOMUNE a **chave é o telefone em E.164 + Instagram + CNPJ**.
7. **Relatórios mínimos que todos entregam:** funil de conversão etapa-a-etapa, tempo médio por etapa, motivos de perda, desempenho por vendedor (atividades feitas × negócios movidos), origem/fonte, e **metas por pessoa/período** (Pipedrive Goals, RD CRM Metas, Nectar). É exatamente o insumo da "IA secretária".
8. **UX que mais importa para uma equipe pequena:** (i) fila única "meu dia" (Close Inbox: Inbox/Done/Future com snooze), (ii) filtros salvos como "visões" (Close Smart Views, Attio/Twenty views), (iii) busca global ⌘K, (iv) kanban com contagem/soma por coluna e zonas de "ganho/perdido" ao arrastar, (v) mobile em lista (não kanban) para a rota de visitas da tarde, (vi) roteiro de visitas por mapa (Agendor).
9. **Preço de comprar (5–8 usuários, 2026):** de R$ 300/mês (Nectar, Bigin, RD CRM Basic) a R$ 2.500–4.500/mês (HubSpot Pro, Close, Salesforce Pro). Mas o **custo real é o WhatsApp**: RD Conversas Basic R$ 989/mês, Kommo exige 6 meses pré-pagos, Octadesk R$ 2.499 + R$ 130/usuário, Ollow (ex-Moskit) R$ 1.199/mês; mais tarifas Meta por template (Brasil ≈ US$ 0,06 marketing / US$ 0,008 utilidade **[verificar rate card]**). Construir sobre Supabase + Chatwoot + Evolution API custa infra marginal (~R$ 0–300/mês) e tempo de Claude Code/Matheus.
10. **Base open source recomendada:** **Atomic CRM (marmelab)** como esqueleto — MIT, React + react-admin + shadcn/ui **sobre Supabase** (mesmo stack da KOMUNE), com contatos/empresas/negócios kanban/tarefas/notas/tags/importação CSV e captura de e-mail. Inspirar UX em **Twenty** (views, ⌘K) e conversa-no-cartão em **Kommo**; usar **Chatwoot** para inbox; ler **Odoo** para atividades encadeadas, estrelas e scoring; **Monica** para o modelo "relacionamento" (frequência de contato, "como nos conhecemos" = origem).

---

## 1. Grupo 1 — CRMs de vendas líderes

### 1.1 HubSpot (Smart CRM gratuito + Sales Hub)

**Modelo de objetos.** Contatos, Empresas, Negócios, Tickets (+ objetos personalizados no Enterprise) e um objeto **Leads** separado (Sales Hub Pro, "Prospecting workspace"). Um contato tem uma "empresa principal" e pode associar-se a várias; as **association labels** (ex.: "decisor", "financeiro") permitem N contatos por empresa com papel. Atividades (e-mail, ligação, reunião, nota, tarefa, SMS/WhatsApp/LinkedIn) vivem na **linha do tempo** do registro, filtrável por tipo.

**Pipeline.** Múltiplos pipelines de negócio (1 no gratuito), etapas com **probabilidade** (usada no forecast ponderado), **pipeline rules** (Professional+): impedir pular etapas, impedir voltar, travar edição de negócios fechados, **propriedades obrigatórias por etapa** ("conditional stage properties") — ao arrastar o cartão abre um modal exigindo os campos; aprovação de negócios (Enterprise). Regras se aplicam em desktop, mobile, API com usuário e integrações; super-admins e workflows passam por cima.

**Atividades e cadências.** **Sequences**: passos de e-mail automático, **tarefa de e-mail manual, tarefa de ligação, tarefa genérica, tarefas de LinkedIn**, com atrasos até 90 dias úteis, janela de envio e "melhor horário" por histórico de abertura; inscrição pelo registro, em massa ou via workflow; **desinscrição automática quando o contato responde ou agenda reunião**. Historicamente exigia Professional; a página oficial de preços (set/2026) marca Sequences no Starter (limitado) — fontes divergem **[verificar]**. Tarefas com fila ("task queues") e visão "Hoje".

**Scoring, enriquecimento, dedupe, importação.** Ferramenta de scoring com **fit score + engagement score** (até 5 scores no Pro, 10 no Enterprise); preditivo no Enterprise. Enriquecimento nativo (Breeze Intelligence, por créditos). Dedupe por **e-mail** (contatos) e **domínio** (empresas) na importação e via API; ferramenta "Manage duplicates" (IA) e merge manual escolhendo o registro primário e o valor de cada propriedade (limite de 250 merges por registro). Importação CSV/XLSX com mapeamento e criação de propriedade na hora, um arquivo pode criar contatos + empresas + negócios associados.

**WhatsApp.** Canal WhatsApp nativo no inbox (Meta Cloud API) apenas em planos Professional de Marketing/Service **[verificar]**; no Brasil a prática é usar integradores (Zenvia, RD Conversas, etc.).

**Relatórios.** Funil de negócios por etapa (com "etapas puladas"), analytics de vendas (velocidade, conversão por etapa/origem/vendedor), leaderboard de atividades, **Goals** (Pro), forecast.

**UX.** Páginas de índice com **visões salvas em abas**, alternância lista/quadro, filtros avançados, busca global, app mobile completo. Muitos modais e configurações; a curva de "settings" é a maior do grupo.

**Preço.** Free (2 usuários, 1.000 contatos de marketing, 1 pipeline, 3 templates, 3 snippets, 1 link de reunião, 10 dashboards). Starter US$ 15–20/assento; Professional US$ 90–100/assento + **US$ 1.500 de onboarding obrigatório**; Enterprise US$ 150 + US$ 3.500. Assentos "view-only" gratuitos.

> **Tela descrita — quadro de negócios (HubSpot):** barra superior com nome do pipeline (dropdown), botões "Quadro/Lista", filtros salvos como abas ("Meus negócios", "Todos"), botão "Criar negócio". Colunas por etapa com contagem e soma; cartões mostram nome, valor, data de fechamento, empresa, avatar do dono e um ícone de "próxima atividade". Ao soltar um cartão numa etapa com propriedades obrigatórias, abre um painel lateral "Atualize as propriedades para mover para X".

### 1.2 Pipedrive

**Modelo de objetos.** **Leads Inbox** (leads separados dos negócios, para triagem), Negócios, Pessoas, Organizações, Atividades, Notas, Produtos, Projetos. Uma Pessoa pertence a uma Organização; um Negócio tem 1 pessoa + 1 organização principais e **participantes** adicionais. Rótulos coloridos (labels) em leads/negócios/pessoas/orgs. Campos personalizados com dois níveis: **"campos importantes"** (destacados, não obrigatórios) e **"campos obrigatórios"** (por pipeline e por etapa; Professional+/Premium). Atenção: campos obrigatórios **não** bloqueiam movimentos feitos por importação, edição em massa, API ou automações.

**Pipeline.** Kanban com colunas por etapa mostrando **contagem e soma**; **probabilidade por etapa**; múltiplos pipelines (seletor no topo); **deal rotting** configurável por pipeline em dias por etapa — o cartão fica vermelho quando parado; ao arrastar aparecem no rodapé as zonas **"Ganho / Perdido / Excluir / Mover para outro pipeline"**. **Motivos de perda**: livre (até 100 por conta) ou lista pré-definida pelo admin; aparecem no detalhe, na lista e nos relatórios Insights.

**Atividades.** Tipos padrão (ligação, reunião, tarefa, prazo, e-mail, almoço) + tipos personalizados; ligar a um negócio herda pessoa/org. **Ícone de status no cartão**: verde = atividade hoje, amarelo/cinza = agendada, vermelho = atrasada, **"!" = nenhuma atividade agendada**. O pipeline **ordena por próxima atividade** por padrão. Ao concluir uma atividade, o produto pede para agendar a próxima ("activity-based selling") **[verificar nome exato do prompt]**. Automations (Growth+): gatilhos por evento (negócio/pessoa/atividade/lead criado, atualizado, etapa mudou) e por data; ações criar/atualizar/excluir entidades, enviar e-mail, webhook, Slack/Teams; executadas de cima para baixo; importações não disparam automações.

**Scoring, enriquecimento, dedupe, importação.** Scoring personalizado e enriquecimento de telefone/e-mail nos planos Premium/Ultimate. **Merge Duplicates** (Ferramentas → Mesclar duplicados) lista pessoas/orgs possivelmente duplicadas exibindo nome, negócios, atividades, data de criação, dono e visibilidade; escolhe-se o registro primário e pré-visualiza. **Importação** (XLS/XLSX/CSV, 50 mil linhas, 50 MB) em 5 passos: tipo de dados → upload com validação → **mapeamento automático por cabeçalho com criação de campo personalizado no ato** → prévia → tratamento de duplicados (mesclar em vez de criar); **uma linha pode criar organização + pessoa + negócio + atividade + nota já ligados**; arquivo de "pulados" com motivo; **reverter importação em 48h** (admin).

**WhatsApp.** O inbox de mensagens (Messenger + WhatsApp via Twilio) **fechou para novos clientes em 28/08/2023**; hoje é via marketplace (TimelinesAI, Rasayel, Cooby, WA Sync) ou extensões de navegador **[verificar disponibilidade no Brasil]**.

**Relatórios.** Insights: desempenho e **conversão etapa-a-etapa**, duração por etapa, progresso, atividades por usuário/tipo, leads, forecast; **Goals** por usuário/equipe/empresa, semanais/mensais/trimestrais, em quantidade ou valor, para negócios adicionados/progredidos/ganhos e atividades.

**UX.** Lista com colunas configuráveis e filtros salvos/compartilhados, edição em massa, kanban, app mobile forte (registro de ligação, atividades do dia). Novos planos 2026: **Lite US$ 14, Growth US$ 39, Premium US$ 59, Ultimate US$ 79**/assento (anual). Add-ons: LeadBooster US$ 32,50, Campaigns US$ 13,33, Smart Docs US$ 32,50, Projects US$ 16, Web Visitors US$ 41.

> **Tela descrita — pipeline (Pipedrive):** topo com seletor de pipeline, filtro "Todos/Meus", botão "+ Negócio". Colunas com título, "R$ soma · N negócios". Cartão: título em negrito, nome da organização, valor, avatar e, à direita, um pequeno círculo colorido (status da próxima atividade). Cartões parados além do limite têm fundo vermelho claro. Ao arrastar um cartão, o rodapé vira uma barra com quatro alvos: "GANHO" (verde), "PERDIDO" (vermelho), "EXCLUIR", "MOVER/CONVERTER".

### 1.3 Salesforce (só o essencial)

Modelo canônico do mercado: **Lead** (não qualificado) → **Conversão** cria Conta + Contato + Oportunidade; **Opportunity Contact Roles** (N contatos por oportunidade com papel); **Path** (barra de etapas no topo do registro com campos-chave e "orientação para sucesso" por etapa); regras de validação por etapa; campanhas com influência; relatórios e dashboards muito flexíveis. **Starter Suite US$ 25**/usuário (leads, contas, contatos, oportunidades, fluxos e roteamento de leads, e-mail marketing simples); **Pro Suite US$ 100** (cotação, forecast, mais automação); Core US$ 195, Advanced US$ 395, Max US$ 550 (anual). Para a KOMUNE, os únicos padrões a levar são **conversão de lead**, **papéis de contato** e **Path**.

### 1.4 Close

**Modelo.** **Lead = empresa/conta**; dentro dele ficam Contatos (vários), Oportunidades (várias) e todas as atividades. Status de lead (ex.: "Potencial", "Qualificado", "Cliente", "Ruim") e status de oportunidade por pipeline. Objetos personalizados e **Custom Activities** (ex.: "Visita presencial" com campos próprios).

**Fila única (Inbox).** "Seu time deve conseguir trabalhar exclusivamente a partir do Inbox": e-mails recebidos, SMS, chamadas perdidas, **tarefas vencidas/hoje**, lembretes de oportunidades, "contatos potenciais" (mensagens de desconhecidos, expiram em 30 dias). Três seções: **Inbox / Done / Future** (snooze); botão **"Next lead"** para percorrer a fila; hover mostra status, valor e **hora local do contato**.

**Smart Views.** Listas dinâmicas salvas com linguagem de consulta (ex.: "leads sem atividade há 7 dias e status = potencial") — a base do trabalho diário e da inscrição em Workflows.

**Workflows (cadências).** Passos de **e-mail, SMS, tarefa de ligação, atualização de lead/oportunidade, tarefa, atividade personalizada**, atrasos de 1 min a 365 dias; inscrição manual, em massa via Smart View ou automática por evento (mudança de status, oportunidade criada, formulário); **para automaticamente quando a meta é atingida** (resposta por e-mail/SMS/ligação, reunião marcada, status mudou); envio "em nome de" outro usuário; janela padrão seg–sex 9h–16h no fuso do contato; datas de blackout; relatório de "meta atingida %" e dias até conversão. Exigem planos Growth/Scale.

**Preço.** Startup ≈ US$ 49 (máx. 3 usuários), Growth/Professional ≈ US$ 99, Scale/Enterprise ≈ US$ 139 por usuário (nomes mudaram em 2025–26 **[verificar]**); discagem, SMS e e-mail inclusos.

> **Tela descrita — Inbox (Close):** coluna esquerda com abas "Inbox (12) · Done · Future"; lista central com linhas "tipo de item · nome do lead · assunto · há X min"; ao clicar, abre o lead à direita com timeline (e-mails, ligações, SMS, notas) e caixa de resposta multi-canal; botões "Done", "Snooze", "Next lead".

### 1.5 Attio

**Modelo.** Objetos flexíveis (People, Companies, Deals, Users, Workspaces + objetos personalizados), atributos tipados e **Lists**: uma lista é um subconjunto de registros de um objeto com **atributos específicos da lista** (etapa, prioridade, dono). Assim **a mesma empresa pode estar em vários "pipelines" com etapas diferentes** sem duplicar o registro. Views por lista (tabela e kanban por qualquer atributo de status), filtros e ordenações salvas por view. Enriquecimento automático a partir do domínio do e-mail (logo, descrição, LinkedIn, tamanho) e "Ask Attio" (IA para buscar/criar registros), ambos por **créditos** (100/mês no Free a 2.500 no Enterprise). Workflows por nós (gatilhos de registro/lista, ações com IA, Slack, e-mail, webhooks), **sequences** e call intelligence só no Pro. Sync de e-mail/calendário em todos os planos. UI rápida, orientada a teclado (⌘K), edição inline.

**Preço.** Free (3 assentos, 50 mil registros), Plus US$ 35/44, Pro US$ 79/99, Enterprise sob consulta. Crítica recorrente: créditos de enriquecimento/IA esgotam rápido; stack completa de outbound sai muito mais caro.

### 1.6 folk

CRM "leve" para relacionamento: contatos (pessoas e empresas) organizados em **Groups** com campos por grupo; **extensão folkX** captura contatos do **LinkedIn, Instagram, X e Gmail** com um clique (útil como referência para um "Salvar na KOMUNE" a partir do Instagram/Casamentos.com.br); pipelines kanban e sequências de e-mail só no Premium; enriquecimento e "Magic Fields" (campos preenchidos por IA) com **créditos compartilhados por workspace** (500/1.000 por mês — "o maior custo escondido"); detecção e mesclagem de duplicados; sincronização de e-mail/calendário e **WhatsApp** (registro de conversas via extensão **[verificar]**); sem app mobile nativo. Standard US$ 24/30, Premium US$ 48/60 por usuário.

### 1.7 Zoho CRM e Bigin

**Zoho CRM.** Lead → conversão em Contato + Conta + Negócio; **Blueprint** (processo obrigatório por transição: campos e ações exigidas antes de mudar de etapa — o padrão mais rígido do mercado, bom como inspiração para "checklist por etapa"); **Scoring Rules** (pontos por valores de campo e engajamento); **Cadences** (sequências multicanal e-mail/ligação/tarefa); Zia (melhor horário para contato, anomalias); vários pipelines; Canvas (desenho da página do registro); WhatsApp Business nativo em planos pagos **[verificar plano]**. Free até 3 usuários; Standard ≈ US$ 14, Professional ≈ US$ 23, Enterprise ≈ US$ 40/usuário (lista global; a página consultada exibia em rúpias).

**Bigin.** CRM "de pipeline" para pequenas equipes: **Team Pipelines** (cada processo/time com etapas próprias, 1 no Free, 3 no Express, 5 no Premier, 15 no 360), Contatos/Empresas/Negócios, atividades, **telefonia embutida**, apps iOS/Android/Watch, **WhatsApp Business (Meta API) a partir do Express**, automações (3/30/50/100). Free (500 registros), Express US$ 7, Premier US$ 12, Bigin 360 US$ 18 (anual; mensal +35%). "Setup em ~30 min"; limita-se quando o time passa de ~20 pessoas.

---

## 2. Grupo 2 — CRMs brasileiros e "WhatsApp-first"

### 2.1 RD Station CRM (+ RD Station Conversas)

**Modelo.** Contatos, Empresas, Negócios (com **qualificação por estrelas 1–5** — o "termômetro" do RD), tarefas com lembretes por e-mail/WhatsApp, produtos, funis múltiplos (Basic+), **campos obrigatórios por etapa** (Basic+), **motivos de perda obrigatórios** configuráveis, automações (Basic/Pro até 50, Advanced 100), Playbook de vendas, **metas por vendedor** (Basic+), Copiloto de IA e relatórios com IA. **WhatsApp nativo ("WhatStation")**: extensão Chrome que abre um painel ao lado do WhatsApp Web mostrando contato/negócio/etapa, permite criar negócio, salvar a conversa como anotação, agendar tarefa, usar mensagens prontas e enviar link de reunião **[verificar detalhes do painel]**. Telefone virtual: add-on R$ 94/mês (≤10 usuários).

**Preço (set/2026).** Free (até 4 usuários, 1 funil, WhatsApp nativo, copiloto); Basic R$ 65,70/usuário (anual) ou R$ 73 (mensal); Pro R$ 117,90 (anual) ou R$ 131 (mensal), **mín. 4 usuários**; Advanced sob consulta.

**RD Station Conversas** (produto separado, API oficial Meta): Basic **R$ 989/mês** (500 clientes únicos/mês, 1 número, usuários ilimitados, agentes de IA), Pro **R$ 2.699/mês** (3.000 clientes, 2+ números, chatbot avançado, **distribuição de leads por regras**, funil), Advanced sob consulta; + **carteira de créditos Meta** (mín. R$ 300/ano) + implantação opcional (ativação R$ 1.999; chatbot R$ 3.799).

### 2.2 Kommo (ex-amoCRM) — a referência "conversa + funil no mesmo lugar"

**Modelo.** Leads (cartões do funil), Contatos, Empresas; **o cartão do lead é um chat**: coluna esquerda com campos, etapa, responsável, tags, tarefas; área central com a linha do tempo unificada (mensagens WhatsApp/Instagram/Messenger/Telegram/e-mail, notas, tarefas, mudanças de etapa); rodapé com o composer que responde no canal de origem, usa **templates** ou aciona o Salesbot. Layout do cartão customizável.

**Funil.** Kanban com coluna **"Leads recebidos"** (conversas ainda não aceitas → aceitar cria o lead na 1ª etapa, recusar descarta); **Pipeline Digital**: em Leads → Automatizar, abaixo de cada coluna há um "+" para pendurar gatilhos **"ao entrar nesta etapa"** (ou ao criar lead, receber e-mail, concluir tarefa), com condições (tag, responsável, campo) e ações: enviar mensagem/e-mail, **rodar Salesbot**, criar tarefa com prazo, mudar etapa, trocar responsável, tags, webhook, formulário, mostrar anúncios (Meta/Google) ao lead naquela etapa.

**Salesbot.** Construtor visual com mapa de navegação; blocos: **Mensagem** (botões de resposta rápida até 13, URL, arquivos), **Lista (WhatsApp)** até 10 opções, **Condição** (conteúdo da mensagem ou campo do contato), **Validação** (igual/contém/telefone/regex), **Pausa** (até receber mensagem, timer, fim do expediente), **Mudar etapa**, **Criar lead**, **Nota**, **Tarefa**, **Tags**, mensagem interna a um colega, **Round Robin** (2–100 opções em rodízio — inclusive para distribuir responsáveis), "Ir para outro passo", "Iniciar outro bot", **Código JS**, widgets (Stripe, IA/ChatGPT). Ações: e-mail por template, webhook, atualizar campos, trocar responsável, concluir tarefa, formulários, Meta Conversions API. **Transferência para humano** = mudar responsável + criar tarefa + parar o bot (bloco de pausa/fim).

**WhatsApp.** Duas vias: **WhatsApp Lite** (conexão por QR code, não oficial, sem custo por mensagem, sujeita a limitações/ban **[verificar disponibilidade atual no Brasil]**) e **WhatsApp Business API** (oficial; qualquer plano; templates aprovados pela Meta; janela de 24h; Meta cobra os templates). Chats aparecem no cartão do lead e no **Chat inbox** (todas as conversas, com notas internas, menções, respostas por texto/áudio/arquivos, templates, resumo de conversa por IA e sugestões de resposta). **Broadcast** (Avançado+): selecionar audiência por tags/etapa/filtros, agendar, acompanhar; máx. 3 botões; só admins.

**Preço BR (parceiro oficial, set/2026).** Base **R$ 66**, Avançado **R$ 110** (Salesbot, broadcast, automações), Pro **R$ 197**, Empresarial sob consulta — por usuário/mês, **contrato mínimo de 6 meses pré-pago** (bônus 6+1 / 12+2). Reclame Aqui 7,1/10 (238 reclamações em abr/2026): retenção de dados pós-cancelamento, bloqueios, quedas de conexão WhatsApp, suporte lento.

> **Tela descrita — cartão do lead (Kommo):** cabeçalho com nome do lead, valor e seletor de etapa (pílulas coloridas). Coluna esquerda (~30%): "Responsável", "Tags", campos personalizados, contato/empresa vinculados, "Tarefas" (com prazo). Centro: feed cronológico onde balões de WhatsApp (verdes) se misturam a eventos cinza ("etapa alterada para Apresentação por Heloísa"). Rodapé: abas "Chat · Nota · Tarefa", campo de texto com ícones de template, anexo, áudio e um seletor de canal (WhatsApp/Instagram).

### 2.3 Agendor

CRM B2B nacional com **Empresas (cadastro por CNPJ puxando dados da Receita)**, Pessoas, Negócios, funis múltiplos (Pro+), **qualificação obrigatória por etapa** (Performance), propostas, automações, telefone inteligente com ChatGPT, **roteiro de visitas** (mapa e rota de clientes — relevante para a rota de 4 visitas/tarde), resumos semanais por e-mail, apps mobile. **WhatsApp em três níveis:** (1) **extensão Chrome gratuita** que exibe no WhatsApp Web a ficha do cliente (empresa, categoria, responsável, negócios e etapa) e salva a conversa/áudios no histórico com um clique; (2) **WhatsApp Sync R$ 49/mês por número** (API oficial Meta em ~5 min, captura automática de tudo — mensagens, áudios, imagens — no histórico, sem migrar número); (3) **Agendor Chat a partir de R$ 93/usuário** (inbox compartilhado, vários atendentes no mesmo número, distribuição automática por atendente/departamento, atalhos, mensagens agendadas, relatórios por atendente/time/canal). **Preço:** Free (3 usuários, 10 mil contatos), Pro **R$ 59**, Performance **R$ 83**, Corporativo R$ 156 (mín. 10) por usuário/mês (−10% anual).

### 2.4 Ploomes, Moskit→Ollow, Nectar, PipeRun, Umbler Talk

- **Ploomes:** CRM B2B "pesado" (propostas/CPQ, workflows por checklist condicional, formulários externos, integrações com ERP). Lite US$ 22/usuário; módulos (Workflow, Propostas, CPQ, Analytics, IA) cobrados à parte. Excesso para a KOMUNE; inspiração: **checklist condicional por etapa**.
- **Moskit → Ollow (rebrand 2026):** virou plataforma "conversa + CRM", cobrada **por conta e volume de conversas**: Light R$ 1.199/mês (500 conversas, 1 API oficial), Campanha R$ 1.499 (2.000), Bold R$ 2.499 (até 3 APIs), anual −17%; WhatsApp Web ilimitado, campos preenchidos por IA, gravação de reunião, e-mails em massa.
- **Nectar CRM:** funis múltiplos B2B/B2C, WhatsApp (API oficial + **extensão própria para WhatsApp Web**), automações, **metas por usuário/time**, campos dependentes/BI/webhooks no Enterprise. Pro **R$ 33,99** (anual) / R$ 39,99 (mensal), Enterprise R$ 59,49 / R$ 69,99 — **mín. 4 usuários**. O mais barato do grupo.
- **PipeRun:** funis de pré-venda/venda/pós-venda, **SLA por etapa**, automações, indicadores; preços sob consulta (G2 lista 3 edições com dados incompletos).
- **Umbler Talk:** inbox WhatsApp-first (API oficial), múltiplos atendentes, **chatbot visual e agentes de IA**, **"Contact Board" (kanban de contatos)** e campos personalizados a partir do plano Impulso, campanhas e agendamento de mensagens, webhooks/API (Impulso+); planos Essencial/Impulso/Escala com **mínimo de 2–3 atendentes**; Capterra registra ~**R$ 198/usuário/mês** (Profissional) e R$ 258 (Enterprise) **[verificar]**; reclamações: instabilidade da conexão Meta, contatos não editáveis.

### 2.5 Inboxes multiagente (pipeline + conversa no mesmo lugar?)

| Plataforma | Como junta conversa e funil | Distribuição / transferência | Bot → humano | Preço 2026 (referência) |
|---|---|---|---|---|
| **Chatwoot** (open source, MIT) | Não tem funil de negócios; usa **status da conversa** (aberta/pendente/adiada/resolvida), **labels** e **atributos personalizados** de contato/conversa; integra com CRMs por webhook/API (e nativamente com Evolution API/Typebot/n8n) | Times/inboxes, **auto-atribuição round-robin**, atribuição manual, prioridade, SLA (Business) | Captain AI (assistente/copiloto/memórias) e bots externos via API de "agent bot"; humano assume mudando o assignee | Self-host R$ 0; cloud Hacker grátis (2 agentes), Startups US$ 19/agente, Business US$ 39 (automation rules, custom attributes, SLA) |
| **Blip (Take)** | Builder de bots + **Blip Desk** (atendimento humano por filas/skills) + Growth (campanhas); CRM externo | Filas, regras por skill, transbordo | Handoff por regra/intenção | Free (2 agentes); Plus (≤30 agentes, 2.000 conversas/mês, extra R$ 1,40/conversa, agente extra R$ 150); Super (≤50, 5.000, R$ 1,25); base sob consulta |
| **Zenvia Customer Cloud** | Módulos atendimento + **vendas (funil kanban)** + campanhas na mesma suíte | Por equipe/departamento | Chatbot no-code → transferência | Starter R$ 0 (1 usuário, 100 "interactionz"), Specialist **R$ 600/mês** (10 usuários, 500), Expert R$ 1.800 (30), + pacotes de canal (WhatsApp de R$ 100/182 msgs a R$ 1.000/2.041 msgs); exige CNPJ |
| **Huggy** | Atendimento omnichannel com flows; kanban leve | Por departamento | Flows → humano | A partir de **R$ 239/mês** (tarifa fixa; plano free) |
| **Octadesk** | Atendimento + helpdesk + campanhas; sem CRM de vendas robusto | Regras, filas, SLA | Woz Agent (IA) e copiloto inclusos | One **R$ 2.499/mês + R$ 130/usuário** (3.000 DAUs — só conta quando o cliente responde), Flow R$ 4.399 + R$ 120/usuário |

**Leitura:** as plataformas de atendimento resolvem **quem responde e quando** (fila, dono, SLA), mas não resolvem **em que ponto da negociação o fornecedor está**. Os CRMs WhatsApp-first (Kommo, Agendor Chat, Ollow, Umbler) resolvem os dois, ao custo de prender o time à ferramenta. Para a KOMUNE, o desenho vencedor é: **Chatwoot como inbox (dono, transferência, SLA, notas internas) + CRM próprio como dono da etapa/próxima ação**, ligados por webhooks nos dois sentidos (mensagem recebida → evento no CRM; mudança de etapa → template/bot no inbox).

---

## 3. Grupo 3 — CRMs open source (base ou inspiração)

| Projeto | Licença · stack | Modelo de objetos | Pontos fortes para a KOMUNE | Limitações | Uso sugerido |
|---|---|---|---|---|---|
| **Twenty** (53,7k ★) | AGPL-3.0 **[verificar]** · NestJS + React + PostgreSQL + Redis, BullMQ | People, Companies, Opportunities, Tasks, Notes + **objetos e campos personalizados ilimitados**, relações | Views tabela/kanban agrupadas por qualquer campo de seleção, filtros/ordenações salvas, ⌘K, edição inline, **workflows** (gatilhos de registro/manual/cron/webhook; ações de registro, e-mail, HTTP, código, agente de IA, formulário), agentes de IA, sync e-mail/calendário, REST + GraphQL, webhooks, permissões por campo, CLI de apps. Cloud Pro US$ 9, Organization US$ 19; self-host grátis (Docker Compose) | Stack pesada e própria (não roda "dentro" do Supabase da KOMUNE); sem WhatsApp nativo; personalizar UI exige entrar no monorepo | **Inspiração de UX** e de modelo de views/workflows; alternativa se decidirem adotar um CRM completo e integrar por API |
| **Frappe CRM** | AGPL-3.0 · Frappe Framework (Python) + Vue | **Lead → conversão cria Organização + Contato + Deal**; notas, chamadas, comentários, tarefas | Kanban/lista com views salvas e fixadas, campos/status personalizados, **regras de atribuição e SLA**, templates de e-mail, **WhatsApp (Meta Cloud API via app frappe_whatsapp, aba WhatsApp no deal)**, Twilio/Exotel, scripts Python para automação, PWA mobile; Frappe Cloud desde US$ 5/mês por instância (usuários ilimitados) | Ecossistema Python/Frappe (curva própria), UI opinativa, relatórios simples | Referência para **lead→deal**, **atribuição/SLA** e WhatsApp com templates; base viável se o time aceitar Python |
| **EspoCRM** | AGPL-3.0 · PHP | Leads → converter em Account/Contact/Opportunity; Cases; Activities (calls/meetings/tasks); **Stream** (feed de mudanças) | **Entity Manager** (entidades/campos/relações sem código), **Dynamic Logic** (mostrar/exigir/travar campos conforme valores — ótimo para "campo obrigatório por etapa"), checagem de duplicados ao criar, importação com mapeamento e "atualizar por campo", e-mail em massa, VoIP, API REST; Workflows/BPM/Relatórios no **Advanced Pack (pago, licença por instalação)** | UI datada (Backbone/jQuery), mobile só responsivo | Inspiração para **Dynamic Logic** e Entity Manager |
| **Krayin** (23,7k ★) | MIT · Laravel + Vue | Leads (kanban por pipeline), Persons, Organizations, Products, Quotes, Activities, e-mails | Atributos personalizados, workflows por evento, papéis; **extensão WhatsApp** (paga) e VoIP; variante multi-tenant SaaS | Maturidade mediana, PHP 8.3 + MySQL, comunidade menor que Twenty | Só inspiração; stack distante |
| **SuiteCRM 8** | GPL/AGPL · PHP (Symfony) + Angular | Accounts, Contacts, Leads, Opportunities, Cases, Campaigns, Calls/Meetings/Tasks, Reports, Workflow (AOW), Studio | Completo, maduro, API REST, SuiteCRM Hosted | UI e modelo antigos, pesado de operar e customizar | Não recomendado |
| **Odoo CRM** | LGPL-3 (Community) · Python + OWL | Leads (opcional) → Oportunidades; Contatos (pessoa/empresa com hierarquia); Atividades; Equipes de vendas com pipelines próprios | Kanban por etapa com **estrelas de prioridade (0–3 = temperatura)**, **ícone-relógio** (verde planejado / amarelo hoje / vermelho atrasado), **"Marcar feito e agendar próxima"**, tipos de atividade que **encadeiam** a próxima (sugerir/disparar), **motivos de perda** com análise, **scoring preditivo** (probabilidade por histórico ganho/perdido × etapa, origem, país/UF, e-mail/telefone, tags), "leads similares" + mesclar, enriquecimento por domínio (créditos IAP), relatórios pivot por etapa/origem/vendedor/UTM, **app WhatsApp oficial (Meta Cloud API, 17+; Enterprise)**, app mobile. **One App Free: CRM sozinho grátis com usuários ilimitados** (Odoo Online); Standard ≈ US$ 25–31/usuário (todos os apps) | Personalizar exige o ecossistema Odoo; WhatsApp só no pago; "one app" acaba puxando outros apps | **Inspiração nº 1 para atividades encadeadas, estrelas, scoring e relatórios**; opção "comprar barato" se desistirem de construir |
| **Monica** | AGPL-3.0 · Laravel + Vue (v5 beta) | **Pessoas** com relações entre si (parceiro, filho, sócio…), "como nos conhecemos", eventos de vida, atividades, notas, presentes, tarefas, **lembretes recorrentes e "manter contato a cada X semanas"**, tags, vCard, API | Modelo **relacionamento-primeiro**: cada pessoa tem frequência de contato desejada e um histórico humano — encaixa na lógica "cerimonialista é sócio" e no follow-up pós-cadastro | Não é CRM de vendas (sem funil/negócio) | Copiar **"stay in touch"** (frequência mínima de contato por segmento) e o campo "origem/como conhecemos" |
| **Atomic CRM** (marmelab, 1,2k ★) | MIT · React + react-admin + shadcn/ui + **Supabase** (Postgres, Auth, Edge Functions, Storage) | Contacts, Companies, **Deals (kanban por etapa configurável)**, Tasks (lembretes), Notes (contato/negócio, com status), Tags, Sales (usuários/papéis) | **Mesmo stack da KOMUNE**; importação CSV com mapeamento; **captura de e-mail por CC (Edge Function cria nota)**; histórico de atividades; dashboard; OAuth (Google/Azure/Keycloak/Auth0); tema/etapas/categorias configuráveis em arquivo; Playwright e2e; demo pública | Um pipeline só; sem WhatsApp, sem cadências, sem relatórios avançados, sem campos obrigatórios por etapa; react-admin impõe estrutura | **Base recomendada** para o esqueleto (ou referência de esquema/telas se preferirem começar do zero em Next.js + Supabase) |

> **Tela descrita — Atomic CRM (demo):** barra superior com "Dashboard · Contacts · Companies · Deals" e avatar. Dashboard em 3 colunas: "Upcoming tasks" (lista com checkbox e data), "Latest notes" (cartões com avatar do autor e trecho), gráfico de negócios por etapa. Página "Deals" em kanban: colunas "Opportunity · Proposal sent · In negotiation · Won · Lost"; cartão com logo da empresa, título, valor. Página de contato: cabeçalho com foto/nome/empresa/tags coloridas, timeline de notas com campo "Add a note" e status (quente/morno/frio), painel lateral com tarefas.

---

## 4. (a) Matriz comparativa de funcionalidades

Legenda: ● nativo/forte · ◐ parcial, add-on ou só em plano superior · ○ ausente · ? não verificado. "Preço" = por usuário/mês, plano mais indicado para 5–8 usuários (câmbio de referência **R$ 5,40/US$** — ajustar).

| Produto | Pessoa×Empresa (N contatos, papéis) | Caixa de leads separada | Múltiplos funis | Campos obrig. por etapa | Rotting / tempo parado | Motivos de perda | Próxima ação c/ semáforo | Cadências multicanal | Scoring / temperatura | Enriquecimento | Dedupe + importação c/ mapeamento | WhatsApp (BR) | Inbox multiagente + bot | Funil por etapa/origem/vendedor | Metas por pessoa | Mobile | Open source | Preço ref. |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| HubSpot Sales Hub | ● labels | ● (Pro) | ● | ● Pro (pipeline rules) | ◐ (via propriedades/alertas) | ● | ◐ tarefas | ● Sequences (Pro; Starter limitado) | ● fit+engajamento (Pro) | ● créditos | ● e-mail/domínio + Manage duplicates | ◐ Pro/integradores | ◐ | ● | ● Pro | ● | ○ | US$ 15–20 Starter / US$ 90–100 Pro + US$ 1.500 |
| Pipedrive | ● participantes | ● Leads Inbox | ● | ● Premium (por pipeline/etapa) | ● por etapa (dias) | ● pré-definidos | ● ícone 4 estados | ◐ Automations/Campaigns | ◐ Premium | ◐ Premium/Ultimate | ● 5 passos, multi-objeto, revert 48h, Merge tool | ◐ marketplace | ○ | ● Insights | ● Goals | ● | ○ | US$ 14 Lite / **US$ 39 Growth** / US$ 59 Premium |
| Salesforce Starter/Pro | ● contact roles | ● conversão | ● | ● validação/Path | ◐ | ● | ◐ | ◐ Pro | ◐ Einstein (caro) | ◐ | ● | ◐ parceiros | ○ | ● | ● | ● | ○ | US$ 25 / US$ 100 |
| Close | ● (Lead = conta) | ◐ status de lead | ● | ◐ | ◐ Smart Views | ● | ● Inbox único | ● e-mail+SMS+ligação, para na resposta | ◐ | ◐ | ● | ○ (SMS/voz EUA) | ◐ | ● | ◐ | ● | ○ | ≈ US$ 99 Growth |
| Attio | ● objetos flexíveis | ◐ listas | ● **Lists** (mesmo registro em N pipelines) | ◐ workflows | ◐ | ◐ | ◐ tarefas | ● Pro | ◐ | ● por domínio (créditos) | ● e-mail/domínio | ○ | ○ | ● Pro | ◐ | ◐ | ○ | US$ 35 Plus / US$ 79 Pro |
| folk | ● grupos | ◐ | ◐ Premium | ○ | ○ | ○ | ◐ lembretes | ◐ e-mail (Premium) | ○ | ● créditos compartilhados | ● merge sugerido | ◐ extensão | ○ | ◐ | ○ | ○ | ○ | US$ 24 / US$ 48 |
| Zoho CRM | ● | ● conversão | ● | ● Blueprint | ◐ | ● | ◐ | ● Cadences | ● Scoring rules | ● (Standard+) | ● | ● pago | ◐ SalesIQ | ● | ● | ● | ○ | ≈ US$ 14 / 23 / 40 |
| Bigin | ◐ | ○ | ● Team Pipelines | ◐ | ○ | ◐ | ◐ | ◐ | ○ | ○ | ● | ● Express+ (Meta API) | ○ | ◐ | ◐ | ● forte | ○ | US$ 7 / 12 / 18 |
| RD Station CRM | ● | ◐ | ● Basic+ | ● Basic+ | ◐ tarefas atrasadas | ● obrigatório | ● lembretes WhatsApp/e-mail | ◐ automações | ● estrelas 1–5 | ○ | ◐ | ● WhatStation (extensão) + RD Conversas (API) | ● via Conversas (R$ 989+) | ● | ● Basic+ | ● | ○ | R$ 65,70 Basic / R$ 117,90 Pro (mín. 4) |
| Kommo | ● | ● "Leads recebidos" | ● | ◐ | ◐ | ◐ | ● tarefas no cartão | ● Salesbot + Pipeline Digital | ◐ | ○ | ◐ | ● Lite (QR) + API oficial | ● Chat inbox + Salesbot + broadcast + round robin | ● | ◐ | ● | ○ | R$ 66 / **R$ 110 Avançado** / R$ 197; 6 meses pré-pagos |
| Agendor | ● CNPJ→Receita | ○ | ● Pro+ | ● Performance ("qualificação obrigatória") | ◐ | ● | ● tarefas + resumo semanal | ◐ automações Performance | ◐ | ● CNPJ | ● | ● extensão grátis / Sync R$ 49 / Chat R$ 93 | ● Agendor Chat | ● | ● | ● + **roteiro de visitas** | ○ | R$ 59 Pro / R$ 83 Performance |
| Ploomes | ● | ◐ | ● | ● checklist condicional | ◐ | ● | ◐ | ◐ | ◐ | ○ | ● | ◐ parceiros | ○ | ● | ● módulo | ◐ | ○ | US$ 22 Lite + módulos |
| Ollow (ex-Moskit) | ● | ● conversas | ● | ◐ | ◐ | ● | ◐ | ◐ campanhas | ◐ IA | ◐ IA | ◐ | ● API oficial + Web | ● | ◐ | ? | ? | ○ | R$ 1.199–2.499/mês por conta |
| Nectar | ● | ◐ | ● | ◐ dependentes (Ent.) | ◐ | ● | ◐ | ◐ | ◐ | ○ | ◐ | ● API + extensão | ◐ | ● BI (Ent.) | ● | ● | ○ | **R$ 33,99** Pro / R$ 59,49 (mín. 4) |
| PipeRun | ● | ● pré-venda | ● | ◐ | ● SLA por etapa | ● | ◐ | ◐ | ◐ | ○ | ◐ | ◐ integrações | ○ | ● | ● | ● | ○ | sob consulta |
| Umbler Talk | ◐ contatos | ◐ | ◐ Contact Board | ○ | ○ | ○ | ◐ | ◐ campanhas | ○ | ○ | ○ | ● API oficial | ● bot visual + agentes IA | ◐ | ○ | ● | ○ | ≈ R$ 198/atendente (mín. 2–3) |
| Chatwoot | ◐ contato + atributos | ○ | ○ (labels/status) | ○ | ◐ SLA | ○ | ◐ snooze | ◐ campanhas | ○ | ○ | ◐ | ● Cloud API (embedded signup) + Evolution | ● round robin, times, notas internas, Captain | ◐ relatórios de atendimento | ○ | ● | ● MIT | R$ 0 self-host / US$ 19 agente |
| Blip · Zenvia · Huggy · Octadesk | ◐ | ◐ | ◐ (Zenvia tem funil) | ○ | ◐ SLA | ○ | ◐ | ● campanhas ativas | ○ | ○ | ◐ | ● API oficial | ● filas, skills, bots | ◐ | ○ | ● | ○ | ver §8 |
| Twenty | ● objetos custom | ◐ | ● views/kanban por campo | ◐ workflows | ◐ | ◐ | ◐ tarefas | ◐ workflows + IA | ○ | ○ | ● CSV + campos únicos | ○ | ○ | ◐ | ○ | ◐ | ● | R$ 0 / US$ 9 |
| Frappe CRM | ● lead→org+contato | ● Lead | ● | ◐ scripts | ◐ SLA | ◐ status | ◐ | ◐ | ○ | ○ | ● | ● Meta Cloud API | ◐ atribuição | ◐ | ○ | ● PWA | ● | R$ 0 / US$ 5 inst. |
| EspoCRM | ● | ● conversão | ◐ | ● Dynamic Logic | ◐ | ◐ | ◐ | ◐ Advanced Pack | ◐ | ○ | ● checagem ao criar | ○ | ○ | ◐ Advanced Pack | ◐ | ◐ | ● | R$ 0 + pack pago |
| Krayin | ● | ● | ● | ◐ | ○ | ◐ | ◐ | ◐ | ○ | ○ | ◐ | ◐ extensão paga | ○ | ◐ | ○ | ◐ | ● | R$ 0 |
| Odoo CRM | ● | ● Leads | ● por equipe | ◐ (Studio/validações) | ● barras/relógio | ● c/ análise | ● **encadeada** | ◐ marketing automation (pago) | ● **preditivo** + estrelas | ● IAP créditos | ● similares + merge | ● app oficial (Enterprise) | ◐ Livechat | ● pivot | ● | ● | ● LGPL | **R$ 0 (One App)** / ≈ US$ 25–31 |
| Monica | ● relações entre pessoas | ○ | ○ | ○ | ● "stay in touch" | ○ | ● lembretes recorrentes | ○ | ○ | ○ | ◐ vCard | ○ | ○ | ○ | ○ | ◐ | ● | R$ 0 |
| Atomic CRM | ● | ○ | ○ (1 pipeline) | ○ | ○ | ◐ etapa "Lost" | ◐ tarefas | ○ | ◐ status de nota | ○ | ● CSV | ○ | ○ | ◐ | ○ | ◐ responsivo | ● MIT | R$ 0 + Supabase |

---

## 5. (b) Funcionalidades obrigatórias para um CRM de captação de parceiros de marketplace (priorizadas)

**P0 = MVP da rodada de 15 dias (captação começa amanhã). P1 = dias 15–45. P2 = dias 45–90+.**

### P0 — sem isso o funil não funciona

1. **Modelo de dados com Empresa/Parceiro como centro, N pessoas por empresa e "segmento comercial".** Todos os líderes separam Pessoa de Empresa e permitem N contatos com papel (HubSpot association labels, Salesforce contact roles, Pipedrive participantes). A KOMUNE precisa de `parceiro` (fornecedor | produtor | cerimonialista | organizador) + `categoria` (buffet, fotografia…) + `cidade/UF` + `origem` (Casamentos.com.br, GetNinjas, Constance Zahn, Econodata, Instagram, indicação, planilha) + `responsável`, e `pessoa` com telefone E.164, WhatsApp, Instagram, papel (dono, comercial, sócio). Multi-cidade desde o dia 1.
2. **Caixa de alvos (leads) separada do funil de negociação.** Pipedrive Leads Inbox, HubSpot Leads, Frappe/Odoo Leads e a coluna "Leads recebidos" do Kommo mostram que alvo raspado ≠ negociação. Os 300 alvos do scraper entram numa **fila de triagem** (aprovar/descartar/mesclar) e só viram "oportunidade de captação" quando alguém assume — evita poluir o kanban.
3. **Dois funis (fornecedor; produtor/cerimonialista) com etapas configuráveis, contagem por coluna, arrastar-e-soltar e zonas "ganho/perdido".** Pipedrive, HubSpot, Kommo, Bigin ("Team Pipelines") e Odoo (por equipe). Etapas do Contexto Mestre: prospectado → contato → conversa → apresentação → interessado → cadastro iniciado → perfil completo → publicado (+ pós-venda: visualização, lead, proposta, contratação, recorrência como **segundo funil "ativação"**, não como cauda do primeiro).
4. **Motivo de perda obrigatório com lista fixa** (Pipedrive pré-definidos, RD obrigatório, Odoo com análise). Lista inicial: sem interesse, já usa concorrente, não responde, fora da região, categoria não atendida, preço/taxa, "voltar depois" (com data).
5. **Próxima ação obrigatória + semáforo + rotting.** Regra: negócio aberto sem atividade futura = "!" vermelho (Pipedrive); atrasada = vermelho; hoje = amarelo/verde (Odoo). Rotting por etapa (ex.: "contato" 3 dias, "conversa" 5, "cadastro iniciado" 7) pinta o cartão. Ao concluir uma atividade, **pedir a próxima** (Pipedrive/Odoo "marcar feito e agendar próxima"). É o mecanismo que operacionaliza "primeira fase contactei; teve resposta; teve interesse".
6. **Temperatura como campo derivado + override manual.** Frio/morno/quente/cliente calculados da etapa (Contexto Mestre) com **estrelas** para override (RD 1–5, Odoo 0–3). Exibir no cartão e filtrar por ela.
7. **Conversa WhatsApp dentro do cartão e cartão dentro da conversa.** Kommo (cartão = chat), Agendor (ficha ao lado do WhatsApp Web, conversa e áudios salvos automaticamente), RD WhatStation. Implementação: inbox (Chatwoot) com painel lateral mostrando parceiro/etapa/próxima ação e botões "mudar etapa / criar tarefa / registrar reunião"; no CRM, aba "Conversa" com o histórico sincronizado e composer que envia pelo número da empresa.
8. **Responsável obrigatório em toda conversa e negócio + transferência.** Brief: mensagens não podem "cair num grupo onde ninguém vê". Chatwoot: atribuição automática round-robin, times, prioridade, SLA de primeira resposta; Kommo/Agendor Chat: distribuição por atendente/departamento. Bot → humano = trocar responsável, criar tarefa e pausar o robô (Salesbot).
9. **Automações por etapa ("Pipeline Digital") e classificação de resposta.** Kommo pendura gatilhos em cada coluna; HubSpot/Pipedrive disparam por mudança de etapa. Para a KOMUNE: entrar em "contato" → envia template 1 em nome da Heloísa; sem resposta em 48h → follow-up 2; respondeu → classificar (sim/não, interesse) e mover para "conversa"/"perdido: sem interesse"; interesse → enviar **áudio** + propor horários; reunião marcada → "apresentação" + evento na agenda; cadastro iniciado sem conclusão em 3 dias → lembrete "vai lá cadastra".
10. **Cadências multi-toque com parada automática ao responder.** HubSpot Sequences (desinscreve ao responder/agendar), Close Workflows (metas: resposta, reunião, status), Zoho Cadences. Cadência padrão: WhatsApp texto → áudio → 2º follow-up → tentativa de ligação → visita presencial (tarefa) → pausa 30 dias; toques manuais viram tarefas no "meu dia".
11. **Importação de planilha com mapeamento e deduplicação.** Pipedrive (mapeamento automático por cabeçalho, criar campo no ato, multi-objeto por linha, arquivo de erros, **reverter em 48h**), HubSpot (atualizar existentes por e-mail/ID). Dedupe por **telefone normalizado E.164 → CNPJ → @instagram → nome+cidade (fuzzy)**, com tela "Mesclar duplicados" mostrando negócios/atividades de cada lado (Pipedrive/HubSpot). O scraper usa a mesma rotina (upsert) e grava `origem` + `url_fonte` + `coletado_em`.
12. **"Meu dia" (fila única) por pessoa.** Close Inbox (Inbox/Done/Future, snooze, "next lead"), Pipedrive atividades do dia, Odoo systray. Conteúdo: tarefas vencidas/hoje, conversas sem resposta atribuídas a mim, reuniões de hoje, cadastros parados. É a tela que a "IA secretária" lê para cobrar ("você tinha 10, fez 1").
13. **Metas individuais e painel de atividade.** Pipedrive Goals (por usuário/período, quantidade ou valor: negócios adicionados/progredidos/ganhos, atividades), RD/Nectar metas por vendedor. Metas do plano: 3 portas/dia/pessoa, contatos/dia, reuniões/semana, cadastros publicados/semana, 14 categorias com ≥5 fornecedores.
14. **Relatórios mínimos:** funil etapa-a-etapa (conversão e tempo médio por etapa), por **origem** (qual fonte raspada converte), por **responsável**, motivos de perda, atividades por pessoa/dia, cobertura por categoria×cidade (Supply Gap). HubSpot/Pipedrive Insights/Odoo pivot. Semanal automático de segunda 8h (brief).
15. **Integração com a plataforma KOMUNE ("pré-cadastro").** Nenhum benchmark tem; é o diferencial. Botão "Criar pré-cadastro" gera fornecedor não publicado com serviços a partir dos dados públicos + registro de **autorização** (quem, quando, por qual mensagem); status de publicação e leads recebidos voltam ao CRM e movem a etapa automaticamente (perfil completo → publicado → 1º lead).
16. **Visões: lista/tabela com filtros salvos, kanban, busca global.** Attio/Twenty/Close/HubSpot. Filtros iniciais: "meus sem próxima ação", "quentes sem reunião", "cadastro iniciado > 3 dias", "por categoria/cidade/origem".

### P1 — eleva a produtividade

17. **Campos obrigatórios por etapa / checklist de qualificação** (Pipedrive required fields, HubSpot conditional stage properties, Agendor qualificação obrigatória, Zoho Blueprint, EspoCRM Dynamic Logic): ex. para entrar em "interessado" exigir categoria, faixa de preço, decisor e data da reunião; para "cadastro iniciado" exigir autorização registrada.
18. **Roteiro de visitas** (Agendor): mapa dos alvos por bairro, rota do dia com ~4 visitas, check-in no mobile.
19. **Lead scoring por regras** (Zoho scoring rules, HubSpot fit+engajamento; Odoo preditivo depois): +pontos por categoria prioritária, avaliações no Casamentos.com.br, Instagram ativo, respondeu, aceitou reunião; −pontos por sem resposta em 2 cadências. Score alimenta a ordem da fila.
20. **Enriquecimento barato:** CNPJ → Receita/BrasilAPI (Agendor faz), Instagram (seguidores, bio, link), Google Maps (nota, endereço), site. Sem créditos pagos (armadilha Attio/folk).
21. **Distribuição round-robin de novos alvos/conversas** por responsável e categoria (Kommo Round Robin, Chatwoot auto-assign, RD Conversas regras).
22. **Templates e áudios pré-gravados** por etapa e por segmento, com variáveis (nome, categoria, cidade) e **registro de opt-out**; "mensagens salvas" com atalho "/" (Chatwoot canned responses).
23. **"Manter contato a cada X"** por segmento (Monica stay-in-touch): cerimonialistas/embaixadores com frequência mínima e lembrete automático.
24. **LGPD e auditoria:** base legal por registro (dado público/legítimo interesse; consentimento após autorização), opt-out em 1 clique, retenção/anonimização de descartados, log de quem viu/alterou (Kommo foi criticada por reter dados pós-cancelamento).

### P2 — depois do marco 60/90

25. Sequências por e-mail e Instagram DM (folk/HubSpot), previsão/forecast, objetos personalizados, Metabase sobre as tabelas do CRM, cobrança automática da "IA secretária" por WhatsApp interno, Supply Gap → geração automática de alvos, rollout multi-cidade, agente de IA que resume conversa e sugere resposta (Kommo, Chatwoot Captain, RD copiloto).

---

## 6. (c) Padrões de UX a copiar (com a fonte)

1. **Cartão do kanban com 5 informações e 1 semáforo** (Pipedrive): nome do parceiro, categoria, cidade, responsável (avatar), temperatura (estrelas) e o círculo de status da próxima ação. Fundo vermelho quando "apodreceu".
2. **Contagem por coluna e zonas de soltar** (Pipedrive/HubSpot): "N parceiros" no cabeçalho; ao arrastar, rodapé com "GANHO (publicado) · PERDIDO (motivo) · MOVER PARA OUTRO FUNIL".
3. **Cartão = conversa** (Kommo): campos à esquerda, timeline unificada ao centro (balões WhatsApp + eventos de etapa + notas + tarefas), composer com canal/template/áudio/nota no rodapé.
4. **Ficha do parceiro ao lado do chat** (Agendor extensão / RD WhatStation / Chatwoot sidebar): quem é, etapa, próxima ação, conversas anteriores, botões "criar tarefa", "mudar etapa", "agendar reunião".
5. **Coluna "Recebidos"** (Kommo) para conversas/alvos ainda sem dono: aceitar → cria/associa; recusar → descarta com motivo.
6. **Automação pendurada na etapa** (Kommo Pipeline Digital): na tela de configurar o funil, cada coluna tem um "+" com "quando entrar aqui: enviar mensagem / rodar robô / criar tarefa / esperar N dias e…". Fácil para Bárbara/Heloísa ajustarem sem dev.
7. **Construtor de robô por blocos** (Salesbot): mensagem com botões, pergunta que salva em campo, condição, pausa, mudar etapa, tarefa, transferir para humano, rodízio. Para a KOMUNE, 1 fluxo inicial e o "classificador de resposta" (sim/não/interesse) por IA em vez de menu numérico.
8. **Fila única com Inbox/Feito/Futuro e snooze** (Close): trabalhar de cima para baixo, "próximo lead", hora local (irrelevante em Natal; troque por "melhor horário conhecido").
9. **Smart Views / filtros salvos como abas** (Close, HubSpot, Attio, Twenty): "Meus sem próxima ação", "Quentes sem reunião", "Cadastro parado".
10. **Marcar feito → agendar próxima** (Pipedrive/Odoo): modal com tipo, data sugerida (regra por etapa) e texto; "sem próxima" exige justificar (perdido/pausado).
11. **Estrelas de prioridade no cartão e no filtro** (RD/Odoo) como temperatura visual.
12. **Importação em 5 passos com mapeamento e prévia** (Pipedrive): auto-mapear por cabeçalho, criar campo, prévia com contagem de novos/atualizados/duplicados, arquivo de erros, "desfazer importação".
13. **Tela de mesclar duplicados** (Pipedrive/HubSpot): lado a lado com negócios, atividades, criado em, dono; escolher primário e, por campo, qual valor fica.
14. **Registro por CNPJ** (Agendor): digitar CNPJ preenche razão social, endereço, CNAE (usar BrasilAPI).
15. **Roteiro de visitas no mapa** (Agendor): "clientes próximos", ordenar rota, check-in.
16. **Resumo semanal automático** (Agendor/plano): segunda 8h, por pessoa: feitas × planejadas, movimentos de etapa, perdidos por motivo.
17. **⌘K / busca global com ações** (Attio/Twenty/HubSpot): buscar parceiro por nome/telefone/instagram e executar "criar tarefa", "mudar etapa".
18. **Mobile em lista, não em kanban** (Bigin/Pipedrive mobile): "meu dia" + ficha + registrar visita/áudio; kanban só no desktop.
19. **Visão por qualquer campo** (Twenty/Attio): agrupar por categoria, cidade, origem, responsável, temperatura — a mesma tabela vira "mapa de cobertura por categoria".
20. **Linha do tempo humana** (Monica): "como conhecemos" = origem/url da fonte; "última vez que falamos"; "manter contato a cada 30 dias".

---

## 7. (d) Armadilhas a evitar

1. **WhatsApp não oficial no número principal.** Kommo Lite/Evolution (Baileys) funcionam, mas Umbler/Kommo/Reclame Aqui registram quedas e bloqueios; a Meta pode banir números com disparo em massa. Mitigar: **número dedicado** (já verificado), aquecimento gradual, limites diários por número, mensagens personalizadas e humanas, opt-out imediato, sem links encurtados; e planejar migração para a **Cloud API oficial** (templates aprovados; custo por template Brasil ≈ US$ 0,06 marketing / US$ 0,008 utilidade **[verificar]**; respostas dentro da janela de 24h são gratuitas).
2. **Robô com cara de robô.** Rafael quer pessoalidade (Heloísa, áudio). Evitar menus "digite 1", respostas instantâneas às 3h da manhã, mensagens idênticas em massa. Copiar Close: janela de envio em horário comercial e intervalo aleatório; handoff rápido ao humano quando houver interesse.
3. **Funil com etapas demais ou misturando estado com ação.** O funil de 13 etapas do Contexto Mestre deve ser dividido em 2 (captação e ativação); "visualização/lead/proposta" são eventos da plataforma, não etapas manuais.
4. **Negócio aberto sem próxima ação.** É a causa nº 1 de funil morto; Pipedrive resolveu com o "!" e a ordenação por próxima atividade. Tornar regra de sistema, não boa prática.
5. **Dedupe fraca.** Scraper + planilha + contato manual = triplicatas do mesmo buffet. Chave por telefone E.164 e upsert desde o dia 1; sem isso os relatórios por origem ficam errados.
6. **Origem não registrada.** Sem `origem` obrigatória não dá para saber se Casamentos.com.br converte melhor que GetNinjas — e o plano quer decidir onde raspar mais.
7. **Mensagens sem dono.** Toda conversa precisa de assignee e SLA de primeira resposta (Chatwoot); grupo de WhatsApp não é inbox.
8. **Construir o inbox do zero.** Recepção de mídia, áudio, status de entrega, janela de 24h, múltiplos atendentes, notas internas — Chatwoot já faz e integra com Evolution API; gaste o tempo no funil e no pré-cadastro.
9. **Custos e limites escondidos ao comprar:** onboarding obrigatório (HubSpot US$ 1.500), mínimos de usuários (RD Pro 4, Nectar 4, Umbler 2–3), pré-pagamento de 6 meses (Kommo), créditos de IA/enriquecimento (Attio, folk), cobrança por conversa (Ollow, Blip, Octadesk) e retenção de dados pós-cancelamento (Kommo). Ao construir, o equivalente é **dependência de uma API não oficial** e **ausência de backups** — resolver com Cloud API oficial e backups do Supabase.
10. **Over-engineering:** objetos personalizados, editor de workflows genérico, permissões por linha, multi-tenant. Para 6–11 usuários, configuração em arquivo (Atomic CRM) e 5–6 automações fixas bastam no MVP.
11. **Misturar tabelas do CRM com as da plataforma.** Manter um schema `crm` no Supabase com FK para `fornecedor`/`produtor`; o pré-cadastro cria o registro na plataforma com `origem = pre_cadastro` e `publicado = false` (campos novos, como Matheus sugeriu).
12. **LGPD e ética.** Dados públicos raspados exigem finalidade, transparência e opt-out; nunca publicar perfil sem autorização (decisão da reunião). Registrar a autorização (mensagem/print/data) no cartão.
13. **Métricas de vaidade.** Contar "disparos" em vez de "interação relevante" (respondeu/reunião/cadastro) — o plano define 70% com interação relevante em 30 dias.
14. **Kanban no celular.** A rota da tarde precisa de lista + mapa + registrar visita em 3 toques.
15. **Relatórios antes dos dados.** Fazer os 4 relatórios de P0 dentro do app e deixar Metabase para o dia 45+.

---

## 8. (e) Tabela de preços 2026 (5–8 usuários) — "construir vs. comprar"

Câmbio de referência **R$ 5,40/US$** (ajustar na data). Valores por mês, plano anual quando houver; "mín." = mínimo de usuários. Fontes na §10.

| Produto / plano | Preço unitário | 5 usuários | 8 usuários | Observações |
|---|---|---|---|---|
| **HubSpot** Sales Hub Starter | US$ 15–20/assento | R$ 405–540 | R$ 648–864 | Free: 2 usuários, 1 pipeline, 3 templates. Sequences no Starter limitado **[verificar]** |
| HubSpot Sales Hub Professional | US$ 90–100/assento | R$ 2.430–2.700 | R$ 3.888–4.320 | + **US$ 1.500 (R$ 8.100) onboarding** obrigatório; lead scoring, pipeline rules, forecast |
| **Pipedrive** Growth (novo 2026) | US$ 39 | R$ 1.053 | R$ 1.685 | Lite US$ 14 (R$ 378–605) sem automações; Premium US$ 59 (R$ 1.593–2.549) para campos obrigatórios/scoring |
| **Salesforce** Starter Suite | US$ 25 | R$ 675 | R$ 1.080 | Pro Suite US$ 100 (R$ 2.700–4.320) |
| **Close** Growth (ex-Professional) | ≈ US$ 99 | R$ 2.673 | R$ 4.277 | Startup US$ 49 só até 3 usuários; ligações/SMS EUA inclusos (pouco úteis no BR) |
| **Attio** Plus / Pro | US$ 35 / US$ 79 | R$ 945 / 2.133 | R$ 1.512 / 3.413 | Free até 3 assentos; créditos de IA/enriquecimento limitados |
| **folk** Standard / Premium | US$ 24 / US$ 48 | R$ 648 / 1.296 | R$ 1.037 / 2.074 | Pipelines e sequências só no Premium; créditos compartilhados |
| **Zoho CRM** Standard / Professional | ≈ US$ 14 / 23 | R$ 378 / 621 | R$ 605 / 994 | Free até 3 usuários |
| **Bigin** Express / Premier | US$ 7 / 12 | R$ 189 / 324 | R$ 302 / 518 | WhatsApp Meta API desde o Express; 3–5 pipelines |
| **Odoo** One App Free (só CRM) | R$ 0 | R$ 0 | R$ 0 | Usuários ilimitados no Odoo Online; app WhatsApp exige Standard (≈ US$ 25–31 → R$ 672–1.344) |
| **RD Station CRM** Basic / Pro | R$ 65,70 / R$ 117,90 | R$ 329 / 590 | R$ 526 / 943 | Free até 4 usuários (1 funil); Pro mín. 4; mensal R$ 73 / R$ 131 |
| RD Station Conversas Basic | R$ 989/mês (conta) | R$ 989 | R$ 989 | 500 clientes únicos/mês, 1 número, usuários ilimitados; + créditos Meta (mín. R$ 300/ano); Pro R$ 2.699 |
| **Kommo** Base / Avançado / Pro | R$ 66 / 110 / 197 | R$ 330 / 550 / 985 | R$ 528 / 880 / 1.576 | **6 meses pré-pagos**; Salesbot e broadcast só do Avançado para cima; + tarifas Meta se usar API oficial |
| **Agendor** Pro / Performance | R$ 59 / R$ 83 | R$ 295 / 415 | R$ 472 / 664 | Free até 3 usuários; WhatsApp Sync + R$ 49/número; Agendor Chat + R$ 93/usuário (R$ 465–744) |
| **Nectar** Pro / Enterprise | R$ 33,99 / R$ 59,49 | R$ 170 / 297 | R$ 272 / 476 | Mín. 4 usuários; mensal R$ 39,99 / 69,99 |
| **Ploomes** Lite | US$ 22 | R$ 594 | R$ 950 | + módulos (workflow, propostas, analytics) sob consulta |
| **Ollow** (ex-Moskit) Light / Campanha | R$ 1.199 / 1.499 (conta) | R$ 1.199 | R$ 1.199 | 500 / 2.000 conversas por mês; anual −17% |
| **PipeRun** | sob consulta | — | — | G2 lista 3 edições sem dados confiáveis |
| **Umbler Talk** | ≈ R$ 198/atendente | R$ 990 | R$ 1.584 | Mín. 2–3 atendentes; **[verificar]** |
| **Chatwoot** cloud Startups / self-host | US$ 19/agente / R$ 0 | R$ 513 / 0 | R$ 821 / 0 | Business US$ 39 para automation rules/atributos; self-host tem tudo |
| **Zenvia** Specialist | R$ 600 (10 usuários, 500 interactionz) | R$ 600 + canal | R$ 600 + canal | Pacote WhatsApp R$ 100 (≈182 msgs) a R$ 1.000 (≈2.041 msgs) |
| **Blip** Plus | sob consulta | — | — | ≤30 agentes, 2.000 conversas; extra R$ 1,40/conversa, agente R$ 150 |
| **Huggy** | a partir de R$ 239 (conta) | R$ 239+ | R$ 239+ | plano free existe |
| **Octadesk** One | R$ 2.499 + R$ 130/usuário | R$ 3.149 | R$ 3.539 | 3.000 DAUs (cobra quando o cliente responde) |
| **Twenty** cloud Pro / self-host | US$ 9 / R$ 0 | R$ 243 / 0 | R$ 389 / 0 | Organization US$ 19 (SSO, permissões por linha) |
| **Frappe CRM** Frappe Cloud | US$ 5+/instância | R$ 27+ | R$ 27+ | usuários ilimitados; realista US$ 25/instância (R$ 135) |
| **EspoCRM / Krayin / SuiteCRM** self-host | R$ 0 | R$ 0 | R$ 0 | EspoCRM Advanced Pack pago (licença por instalação) |
| **Atomic CRM** (Supabase já contratado) | R$ 0 | R$ 0 | R$ 0 | Supabase Pro ≈ US$ 25/projeto se ainda não tiver |
| **Meta WhatsApp Cloud API** (custo variável) | ≈ US$ 0,0625 marketing · US$ 0,008 utilidade · US$ 0,0315 autenticação por mensagem (Brasil) **[verificar rate card]** | ex.: 300 alvos × 3 templates marketing ≈ R$ 306 | 900 alvos × 3 ≈ R$ 918 | Mensagens dentro da janela de 24h após resposta do cliente são gratuitas |

**Cenários de compra típicos (6 usuários, 12 meses):**
- *Barato sem WhatsApp multiagente:* Nectar Pro ou RD CRM Basic + extensão → **≈ R$ 2.400–4.700/ano**, mas sem bot, sem inbox compartilhado e sem pré-cadastro.
- *WhatsApp-first completo:* Kommo Avançado 6 × R$ 110 × 12 = **R$ 7.920/ano pré-pago** (+ Meta) ou RD CRM Pro (R$ 707/mês) + RD Conversas Basic (R$ 989) ≈ **R$ 20.352/ano**.
- *Enterprise leve:* HubSpot Sales Pro 6 assentos ≈ R$ 32.400/ano + R$ 8.100 onboarding ≈ **R$ 40.500 no 1º ano**.

**Cenário construir (proposta):** Supabase (já pago) + Atomic CRM/base própria (R$ 0) + Chatwoot self-host + Evolution API na máquina dedicada (R$ 0 de licença; energia/VPS opcional R$ 50–150/mês) + Meta Cloud API quando migrar (≈ R$ 300–1.000/mês em templates para 300–900 alvos) + tempo de Claude Code/Matheus. **Infra recorrente ≈ R$ 0–1.200/mês**, e o resultado inclui o que ninguém vende: pré-cadastro, sincronização com a publicação, IA secretária e propriedade dos dados. O ponto de equilíbrio contra Kommo Avançado é ~1 semana de trabalho de dev; contra RD CRM+Conversas, ~2–3 semanas.

---

## 9. Síntese para o PRD — modelo de dados e telas mínimas (derivados do benchmark)

**Objetos (schema `crm` no Supabase):** `parceiro` (tipo: fornecedor|produtor|cerimonialista|organizador; categoria; subcategoria; cidade/UF; origem; url_fonte; instagram; site; cnpj; nota_publica; faixa_preco; temperatura_override; score; responsavel_id; fornecedor_id/produtor_id da plataforma; autorizacao_em/autorizacao_prova; opt_out) · `pessoa` (parceiro_id; nome; papel; telefone_e164; whatsapp_ok; email; instagram) · `oportunidade` (parceiro_id; funil; etapa; entrou_na_etapa_em; probabilidade; motivo_perda; pausado_ate; valor_estimado) · `atividade` (tipo: whatsapp|audio|ligacao|reuniao_online|visita|tarefa; vence_em; feito_em; resultado; oportunidade_id; pessoa_id) · `nota` · `conversa` (chatwoot_conversation_id; canal; assignee; status; ultima_msg_em) · `mensagem` (espelho ou referência) · `cadencia` e `cadencia_inscricao` · `meta` (usuario; periodo; tipo; alvo; realizado) · `importacao` (arquivo; mapeamento; criados/atualizados/pulados; revertida) · `evento_plataforma` (perfil_completo, publicado, lead_recebido…).

**Telas P0:** (1) Alvos (triagem em lista com aceitar/descartar/mesclar); (2) Funil kanban por segmento; (3) Ficha do parceiro (cabeçalho + timeline unificada + painel lateral com pessoas, próxima ação, temperatura, autorização, botão "Criar pré-cadastro"); (4) Meu dia; (5) Inbox (Chatwoot com painel KOMUNE); (6) Importar planilha; (7) Metas e relatórios (funil, origem, responsável, motivos, cobertura categoria×cidade); (8) Configurar funil (etapas, rotting, automações por etapa, motivos de perda, templates/áudios).

---

## 10. (f) Fontes consultadas (set/2026)

**Líderes globais**
- HubSpot — preços Sales Hub: https://www.hubspot.com/pricing/sales · Free CRM: https://www.hubspot.com/pricing/crm · análise Docket: https://www.docket.io/resources/research/hubspot-sales-hub-pricing · pipeline rules: https://knowledge.hubspot.com/object-settings/set-up-pipeline-rules · sequences: https://knowledge.hubspot.com/sequences/create-and-edit-sequences · merge/duplicados: https://knowledge.hubspot.com/records/merge-records
- Pipedrive — preços 2026: https://www.pipedrive.com/en/pricing · análise MarketBetter (planos antigos): https://marketbetter.ai/blog/pipedrive-pricing-breakdown-2026/ · lost reasons: https://support.pipedrive.com/en/article/lost-reasons · required fields: https://support.pipedrive.com/en/article/required-fields · important fields: https://support.pipedrive.com/en/article/important-fields · activities: https://support.pipedrive.com/en/article/activities · pipeline view: https://support.pipedrive.com/en/article/pipeline-view · importação: https://support.pipedrive.com/en/article/importing-data-into-pipedrive-with-spreadsheets · merge duplicates: https://support.pipedrive.com/en/article/merge-duplicates · automations: https://support.pipedrive.com/en/article/workflow-automation · messaging inbox: https://support.pipedrive.com/en/article/messaging-inbox
- Salesforce — https://www.salesforce.com/sales/pricing/
- Close — preços: https://www.layer3labs.io/guides/close-crm-pricing · workflows: https://help.close.com/docs/workflows · inbox: https://help.close.com/docs/inbox
- Attio — preços: https://attio.com/pricing · análise: https://marketbetter.ai/blog/attio-crm-pricing-breakdown-2026/
- folk — https://lightfield.app/blog/folk-crm-pricing
- Zoho CRM — https://www.zoho.com/crm/zohocrm-pricing.html · Bigin — https://www.bigin.com/pricing.html · https://saasrat.com/products/bigin-by-zoho-crm

**Brasil / WhatsApp-first**
- RD Station CRM — https://www.rdstation.com/planos/crm/ · RD Station Conversas — https://www.rdstation.com/planos/conversas/
- Kommo — preços BR (parceiro): https://www.calculadorakommo.com.br/blog/o-que-e-kommo-crm-guia-completo · análise/reputação: https://botaihub.com.br/ferramentas/kommo/ · Salesbot: https://support.kommo.com/docs/salesbot-overview.md · Digital Pipeline: https://support.kommo.com/docs/set-up-digital-pipeline-triggers.md · WhatsApp Business: https://support.kommo.com/docs/whatsapp-business-overview.md · Chat inbox: https://support.kommo.com/docs/chat-inbox-overview.md · Broadcasting: https://support.kommo.com/docs/broadcasting-overview.md · Round Robin: https://support.kommo.com/docs/round-robin-in-salesbot-overview.md · guia OxBrand: https://www.oxbrand.com.br/blog/kommo-crm-guia-completo
- Agendor — planos: https://www.agendor.com.br/planos-precos · WhatsApp: https://www.agendor.com.br/produtos/crm-com-whatsapp · comparativo CRMs WhatsApp: https://www.agendor.com.br/blog/crm-para-whatsapp/
- Ploomes — https://www.ploomes.com/en/pricing
- Ollow (ex-Moskit) — https://www.ollow.com.br/planos
- Nectar — https://nectarcrm.com.br/pricing/
- PipeRun — https://www.g2.com/products/piperun-crm-de-vendas/pricing
- Umbler Talk — planos: https://help.umbler.com/hc/pt-br/articles/31195635035533-Principais-diferen%C3%A7as-entre-planos-Talk · Capterra: https://www.capterra.com/p/10012853/Umbler-Talk/ · SocialHub (preços simulados, não usados): https://www.socialhub.pro/blog/umbler-talk-preco-plano-comparativo-socialhub/
- Chatwoot — preços: https://www.chatwoot.com/pricing · WhatsApp Cloud: https://www.chatwoot.com/docs/product/channels/whatsapp/whatsapp-cloud
- Blip — https://www.blip.ai/precos/ · Zenvia — https://www.zenvia.com/precos/ · Huggy — https://www.getapp.com/customer-management-software/a/huggy/ · Octadesk — https://www.octadesk.com/precos
- Meta WhatsApp Business Platform (preços por mensagem) — https://developers.facebook.com/docs/whatsapp/pricing
- Evolution API — https://github.com/EvolutionAPI/evolution-api

**Open source**
- Twenty — https://github.com/twentyhq/twenty · https://twenty.com/pricing
- Frappe CRM — https://frappe.io/crm · https://docs.frappe.io/crm
- EspoCRM — https://www.espocrm.com/features/
- Krayin — https://github.com/krayin/laravel-crm
- SuiteCRM — https://suitecrm.com/
- Odoo CRM — https://www.odoo.com/app/crm · preços: https://www.odoo.com/pricing-plan · atividades: https://www.odoo.com/documentation/18.0/applications/essentials/activities.html · lead scoring: https://www.odoo.com/documentation/19.0/applications/sales/crm/track_leads/lead_scoring.html
- Monica — https://github.com/monicahq/monica
- Atomic CRM — https://github.com/marmelab/atomic-crm · demo: https://marmelab.com/atomic-crm-demo

**Observações de método.** 12 buscas web + ~65 leituras de páginas (oficiais e análises 2026) entre 03/09/2026. Páginas de Kommo (br/pricing), Huggy (planos), RD ajuda (WhatStation), Odoo (scoring detalhado) e Twenty (docs de workflows) retornaram 404 ou índice; nesses pontos usei fontes secundárias ou conhecimento de produto, marcados com **[verificar]**. A cota de buscas da sessão esgotou-se após 12 consultas (limite compartilhado); as leituras diretas não foram afetadas.
