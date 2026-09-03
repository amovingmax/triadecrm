# Playbooks de captação e ativação de supply — pesquisa para o PRD do CRM KOMUNE

Data: 03/09/2026. Pesquisa feita com buscas e leitura de ~35 fontes (lista completa na seção 8). Todos os números marcados com (*) vêm de blogs de fornecedores de software de vendas e devem ser tratados como ordem de grandeza, não como verdade; os números sem asterisco vêm de relatos de operadores das plataformas (ex-Uber, ex-Airbnb, DoorDash, Thumbtack) ou de documentação oficial.

Objetivo: extrair como marketplaces captam e ativam o lado da oferta e traduzir isso em (a) pipeline de fornecedor e de produtor/cerimonialista, (b) cadência multicanal, (c) modelo de scoring, (d) padrão de pré-cadastro/"claim your listing", (e) KPIs e rituais — tudo pensado para 7 pessoas, ~2 meses, meta de 100 fornecedores + 30 produtores/cerimonialistas, 3 "portas"/dia/pessoa, bot de WhatsApp + scraper.

---

## 0. Resumo executivo (o que a pesquisa diz e o que a KOMUNE deve copiar)

1. **Todo marketplace relevante começou com venda direta de alta intensidade, não com marketing.** No levantamento de Lenny Rachitsky com 17 marketplaces, venda direta foi a alavanca mais usada para supply inicial (~60% das empresas), seguida de indicação (~33%) e "pegar carona" em redes existentes como Craigslist (~33%). Airbnb, OpenTable, DoorDash, Uber e Etsy fizeram porta a porta, ligação fria e cadastro "na mão". A meta de 3 portas/dia/pessoa está na média de vendas externas (RepMove 2025: média de 5,1 visitas/dia por vendedor de campo; top 10% faz 13,9).
2. **Cadastro assistido é a regra, não a exceção.** Na Uber, a equipe criava a conta e processava documentos do motorista (a maioria não tinha laptop); sessões presenciais de 30–60 min. Airbnb mandou fotógrafos gratuitos (anúncios com fotos profissionais recebiam 2,5× mais reservas; receita semanal dobrou em uma semana em NY). iFood e Rappi abrem com formulário curto e "aguarde contato da equipe". A KOMUNE deve tratar o pré-cadastro como a versão local disso: o fornecedor só precisa **confirmar e completar** (CNPJ/CPF, Pix, e-mail), nunca "criar do zero".
3. **Ativação ≠ cadastro.** Airbnb media "primeira reserva em até 30 dias"; Uber acompanhava coortes de retenção de 28/56/96 dias e viu que quem passava de 3 meses ficava; Thumbtack trata liquidez ("ser combinado com o profissional certo toda vez") como o produto. Para a KOMUNE, ativação = perfil publicado **e** primeiro lead recebido e respondido em ≤ 24 h dentro de 30 dias — coerente com a meta "70% com interação relevante em 30 dias" e com a promessa de 1 lead real para fundadores.
4. **Indicação é a alavanca mais eficiente depois da venda direta.** Na Uber, indicações geraram ~1/3 das primeiras corridas e eram o supply de melhor qualidade; na Airbnb, indicação de anfitrião foi "a alavanca de crescimento mais eficiente para supply de consumidor". Programa de embaixador da Airbnb só paga quando o novo anfitrião **conclui a primeira reserva** (≥ US$ 100 em 90 dias). Regra para a KOMUNE: comissão de embaixador/cerimonialista só após ativação, nunca no cadastro.
5. **Priorizar por lacuna de oferta, não por lista alfabética.** DoorDash usa modelo que ranqueia comerciantes fora da plataforma por "capacidade de preencher a lacuna de demanda em determinada geografia", e o time de vendas recebe previsões diárias. Adzuna raspa concorrentes para achar empresas ausentes e joga no CRM como lead quente. O scoring da KOMUNE deve ter "Supply Gap" como o componente de maior peso.
6. **Massa crítica tem número.** Airbnb calculou que ~300 anúncios, com 100 avaliados, era o "número mágico" por cidade para a demanda mudar de patamar; "mais de 10 avaliações, tudo muda". A meta de 100 fornecedores em 14 categorias com ≥ 5 cada é a versão KOMUNE disso; a segunda meta deve ser "≥ 3 avaliações/fornecedor em 60 dias".
7. **"Claim your listing" funciona quando é transparente, imediato e dá algo em troca.** Google (~64% dos perfis verificados), Yelp, TripAdvisor, Zomato, Doctoralia e The Knot todos exibem perfis criados a partir de dados públicos/comunidade e convidam o dono a assumir ("É seu este negócio?"), com verificação por telefone/e-mail/código e ganho imediato (editar, responder avaliações, selo, leads). A decisão da KOMUNE de **não publicar** antes da autorização é mais conservadora que todas essas plataformas — e isso é uma vantagem de pitch ("a gente já deixou pronto, mas só publica com o seu OK").
8. **Velocidade de resposta é o KPI escondido.** WeddingPro (The Knot/WeddingWire): até 50% das contratações vão para o fornecedor que responde primeiro; responder em 5 min multiplica por 9 a chance de conversão; The Bash promove "melhores fornecedores orçam em ≤ 8 h". A KOMUNE deve medir isso nos dois sentidos: SLA da equipe respondendo o fornecedor (≤ 10 min em horário comercial) e SLA do fornecedor respondendo o lead (≤ 24 h).

---

## 1. Como as plataformas captam e ativam supply (benchmark)

### 1.1 Tabela comparativa

| Plataforma | Como capta supply | Onboarding/ativação | Ativação medida como | O que copiar |
|---|---|---|---|---|
| **Uber** (relato de Scott Gorlick, 1º funcionário de expansão) | Listas de telefone de empresas de limusine (Yelp, Google, visita); ligação fria com pitch "monetize o carro parado, sem custo inicial"; ~75% de aceite entre contatados; depois indicação (US$ 25 → US$ 500–1.000 por indicado) | Equipe criava a conta e processava documentos; sessões presenciais de 30–60 min; OCR reduziu 30 min → 5 min; garantia de US$ 20–40/h nos primeiros 60–90 dias de uma cidade; SMS > e-mail para engajar motorista | Corridas/semana, coortes de retenção 28/56/96 dias; "quem fica 3 meses, fica"; boa retenção anual = 25–30% | Ligação fria com pitch de renda; cadastro feito pela equipe; garantia de demanda inicial; SMS/WhatsApp como canal de ativação; playbook de lançamento com 180 passos |
| **Airbnb** | Craigslist (supply e demanda); fundadores visitando anfitriões em NY; venda direta local por bairro/tipo; indicação de anfitrião (a alavanca mais eficiente); eventos (DNC, festivais) | Fotografia profissional gratuita (24 imóveis → receita 2×/semana; 2,5× mais reservas; 2.000 fotógrafos/35 mil anúncios em 2012); estimativa de ganhos foi a proposta de valor "uma ordem de grandeza mais eficaz" | "Primeira reserva no primeiro mês"; massa crítica: 300 anúncios/100 avaliados por cidade; > 10 avaliações muda tudo | Pré-cadastro com fotos e "quanto você pode ganhar"; programa de fotos; segmentar supply por tipo; embaixador pago só após 1ª reserva |
| **DoorDash** | "Pounding the pavement", vendas internas e externas porta a porta; executivos entregando pedidos; modelo de ML que ranqueia comerciantes fora da plataforma por lacuna de demanda/geografia e alimenta o time de vendas com previsões diárias | Onboarding de cardápio feito pela plataforma; hoje ferramentas de IA para cadastrar cardápio; ciclo "transacional, fechando em dias" (vaga de Territory AE) | Vendas do comerciante vs previsto (decil) | "Supply gap" como prioridade de prospecção; ciclo curto; roteiro por território |
| **iFood** | Time comercial regionalizado (Executivo de Contas Estratégicas, "Hunter" de prospecção e ativação, vendas externas); cadastro online curto (cidade, nome, e-mail, telefone) e "aguarde contato da equipe para ativação" | Análise sem prazo fixo ("pode levar alguns dias"); Portal do Parceiro, Gestor de Pedidos, treinamentos; planos Básico 12% + R$ 110 e Entrega 23% + R$ 150/mês (Saipos, 2025) | Primeiros pedidos; embarque | Cadastro curto + contato humano; regionalização (hunter × farmer); comparar 8% sem mensalidade vs planos iFood/Casamentos no pitch |
| **Rappi** | Formulário inbound + e-mail; avaliação do restaurante; contrato e login por e-mail | Cardápio cadastrado pelo próprio restaurante ("fotos reais"); taxa inicial R$ 40 | Loja "pronta para receber pedidos" | Contra-exemplo: onboarding sem assistência gera fila e abandono |
| **99** | Cadastro no app + "Casa 99" (atendimento presencial exclusivo para motoristas) | Documentos (CNH EAR), veículo; suporte presencial | Primeira corrida | Ponto físico/"plantão" de ativação: a KOMUNE pode usar o evento demo e os escritórios como "Casa Komune" |
| **GetNinjas** | Cadastro self-service, > 500 tipos de serviço, 450 mil pedidos/mês; verificação de documentos | Profissional recebe lista de pedidos grátis; paga moedas para desbloquear contato; "um serviço já paga as moedas" | Primeiro pedido desbloqueado | Mostrar pedidos reais logo após o cadastro (a KOMUNE tem Research Requests/Supply Gap para isso); a base do GetNinjas é fonte de alvo |
| **Thumbtack** (Marco Zappacosta) | "Valor independente da rede": ferramenta grátis para o profissional criar perfil e republicar no Craigslist com 1 clique; achou os pros onde já procuravam clientes | Relação direta com cada profissional; foco em liquidez (match certo toda vez) | Match + contratação | Dar valor antes da demanda: perfil bonito, link/cartão digital, agenda — o "modo single-player" da KOMUNE |
| **Booking.com** | Account/Market Managers por região captam e gerenciam propriedades (vagas em várias cidades) | Onboarding guiado pelo AM; extranet | Primeira reserva; disponibilidade | Dono de carteira por segmento (não por ordem de chegada) |
| **The Knot / WeddingWire (WeddingPro)** | Listagens gratuitas que não são removidas "a menos que a empresa feche" (para o casal ver "a gama completa de fornecedores"); storefront pago por posição; e-mail automático ao fornecedor a cada avaliação | Storefront + dashboard; produto novo de resposta a leads | Resposta a leads: 50% das contratações vão para quem responde primeiro; ≤ 24 h; 5 min = 9× | Listagem-base pública (o que a KOMUNE decidiu NÃO fazer sem autorização) + notificação a cada evento relevante; SLA de resposta a lead |
| **Casamentos.com.br** | Cadastro gratuito da empresa + 4 pacotes premium por posição (Top Gold desde a 1ª posição, Silver 13ª, Premium 22ª, Start) | Telefone dos noivos só no premium; suporte e "Campus" | Pedidos de orçamento | O argumento "sem mensalidade, paga só quando fecha" ataca exatamente a dor do modelo por posição |
| **Zola** | Listagem gratuita com upgrades pagos; conecta ao Google Business Profile do fornecedor; código de verificação por e-mail; regras de resposta a consultas | Perfil grátis otimizado gera leads | Resposta a inquiries | Importar/confirmar dados via Google Business Profile do fornecedor (menos digitação) |
| **The Bash** | Cadastro de fornecedor com assinatura; pedidos vão direto ao fornecedor | "Melhores fornecedores orçam em ≤ 8 h" | Orçamento enviado | SLA de orçamento como selo |
| **Peerspace** | Marketplace de espaços; supply captada por venda direta e rede de anfitriões (pouca documentação pública) | — | Primeira reserva | Espaços = categoria "âncora": priorizar os 43 espaços do Casamentos.com |
| **Google / Yelp / TripAdvisor / Zomato / Doctoralia** | Perfis criados por indexação, comunidade ou dados públicos; "É seu este negócio? Reivindicar" | Verificação por telefone/SMS/e-mail/cartão-postal/vídeo (Google 5–14 dias por carta, instantâneo por telefone); Zomato "entra em contato para ajudar"; Doctoralia modera e confirma por e-mail | Perfil verificado; resposta a avaliações | Ver seção 5 |

### 1.2 O que é comum (padrões)

- **Estágios**: todas convergem para *alvo → contato → conversa/qualificação → apresentação/demonstração → aceite → cadastro (assistido) → publicado/online → primeira transação → recorrência*. O que muda é onde entra o humano.
- **SLA**: os operadores citam mais "ciclo curto" (DoorDash: "fechar em dias"; Uber: sessão de 60 min e sai ativo) do que SLAs formais. Onde há fila sem assistência (iFood/Rappi "aguarde contato", "pode levar alguns dias"), há abandono. Regra prática: cada etapa deve ter um "próximo passo em ≤ 48 h" ou o lead esfria.
- **Ativação**: sempre a primeira transação (corrida, reserva, pedido, match), com janela de 30 dias, e não o cadastro.
- **Churn de supply**: Uber considerava boa uma retenção anual de 25–30% de motoristas, com queda forte nos primeiros 3 meses; a regra "quem passa de 3 meses fica" indica que o esforço de "manutenção" (o "perturbar" do Rafael) deve se concentrar em D+7 a D+90.
- **Prioridade vem da demanda**: DoorDash (modelo de lacuna), Airbnb (times locais escolhiam tipo de supply e bairro), Adzuna (scrape de concorrentes vira lead quente).
- **Subsídio/garantia inicial**: Uber garantia renda por hora nos primeiros 60–90 dias; Zillow subsidiava leads "para mostrar a qualidade da conexão". O "1 lead real em 30 dias" da KOMUNE é o equivalente e deve ser tratado como produto (fila de leads dos eventos próprios distribuída pelo CRM).
- **Referral pago por ativação**: Airbnb Ambassador (US$ 100 em reservas em 90 dias; pagamento ~14 dias após check-out), Uber (bônus por indicado ativo).

---

## 2. Proposta de pipeline no CRM

### 2.1 Princípios de desenho

1. Uma etapa só existe se tiver **critério de entrada verificável**, **dono**, **SLA** e **próxima ação automática**. Etapas sem isso viram "limbo".
2. **Temperatura é derivada, não escolhida**: o CRM calcula frio/morno/quente/cliente a partir da etapa + recência do último contato (ver 2.4). Ninguém edita temperatura à mão.
3. **Dois funis, um contato**: fornecedor e produtor/cerimonialista têm etapas diferentes, mas a mesma pessoa pode estar nos dois (uma cerimonialista é produtora e embaixadora).
4. **Estado de saída sempre com motivo** (perdido/pausado/nutrição), porque "motivo da perda" é o dado que alimenta o pitch da semana seguinte.
5. **O bot avança etapas de 0→3; humano avança de 3 em diante.** Classificação automática: respondeu (sim/não), interesse (sim/não/depois), pediu para parar (opt-out imediato).

### 2.2 Pipeline de fornecedor (13 etapas + 3 estados de saída)

| # | Etapa (nome no CRM) | Critério de entrada | Critério de saída (→ próxima) | SLA / gatilho de alerta | Automação sugerida | Temp. |
|---|---|---|---|---|---|---|
| 0 | **Alvo identificado** | Registro criado por scraper/planilha/manual com nome + categoria + cidade + ≥ 1 canal de contato | Score calculado e tier atribuído; dedupe feito | Enriquecer em ≤ 24 h | Scraper preenche foto, fotos de trabalhos, rating, nº avaliações, faixa de preço, links; dedupe por telefone/Instagram/CNPJ; cálculo de score (seção 4) | Frio |
| 1 | **Pré-cadastro criado** | Fornecedor "não publicado" criado no Supabase com origem = pré-cadastro, serviços rascunho, sem CPF/CNPJ/Pix/e-mail | Link de prévia (magic link) gerado | ≤ 24 h após tier A/B | Job noturno cria/atualiza rascunhos para tiers A e B; gera link de prévia com token e expiração | Frio |
| 2 | **Contato iniciado** | 1º toque enviado (WhatsApp) com data/hora e responsável (Heloísa) | Qualquer resposta OU 5 toques sem resposta | Toques em D0, D1, D3, D5, D7 (seção 3) | Bot dispara na janela ter–qui 9–11 h; registra "visualizou" (dois tiques azuis) como sinal fraco; 5 toques sem resposta → "Nutrição (sem resposta)" | Frio |
| 3 | **Respondeu** | Mensagem recebida do fornecedor | Classificação: interesse sim/depois/não/opt-out | Humano responde em ≤ 10 min (horário comercial) / bot acusa recebimento em ≤ 1 min | Bot classifica intenção (LLM) e manda **áudio da Heloísa** quando interesse ≥ morno; abre tarefa para humano; mensagem cai na inbox com responsável (nunca em grupo) | Morno |
| 4 | **Conversa / qualificação** | Humano assumiu e trocou ≥ 2 mensagens | Qualificado (checklist SPACE — seção 3.5) e apresentação proposta com 2 horários | ≤ 24 h para propor horário | Template com 2 slots (manhã Meet / tarde visita); registro dos campos de qualificação | Morno |
| 5 | **Apresentação agendada** | Data/hora confirmadas; modalidade (Meet/visita) | Apresentação realizada ou no-show | Confirmação D-1 e 2 h antes; no-show → reagendar em ≤ 24 h (máx. 2 tentativas) | Evento no Google Calendar; lembretes automáticos; no-show 2× → volta para etapa 4 com nota | Quente |
| 6 | **Apresentação realizada** | Registro do resultado (interessado / objeção / não) | Autorização obtida OU objeção registrada | Follow-up no mesmo dia com resumo + link da prévia | Template pós-reunião; tarefa D+1 e D+3; objeções alimentam base de argumentos | Quente |
| 7 | **Autorizou (aceite)** | Fornecedor disse "sim" ao uso do material e aos termos (registrar texto/áudio da autorização e data) | Dados mínimos recebidos | ≤ 72 h para completar | Bot envia checklist do que falta (CNPJ/CPF, Pix, e-mail, confirmar preços); lembrete a cada 48 h; humano pode coletar na visita | Quente |
| 8 | **Cadastro em andamento** | ≥ 1 dado obrigatório recebido | Perfil completo (checklist 100%) | Alerta se parado > 5 dias | "Perturbar" com áudio; visita para "terminar junto" (cadastro assistido); Matheus/Heloísa preenchem no painel pela pessoa | Quente |
| 9 | **Perfil publicado** | Publicação feita no app + painel; selo Fundador/Verificado | Primeiro lead entregue | Publicar em ≤ 24 h após completo | Mensagem de boas-vindas com kit de divulgação (banner, story, link), agenda de destaque rotativo | Cliente |
| 10 | **Ativado (1º lead)** | Recebeu ≥ 1 lead real (evento próprio ou orgânico) **e** respondeu em ≤ 24 h | Proposta enviada | Lead garantido em ≤ 30 dias após publicação; se não respondeu em 24 h → alerta ao responsável | Fila de leads dos eventos KOMUNE distribuída por categoria/tier; monitor de tempo de resposta | Cliente ativo |
| 11 | **Primeira contratação** | Contrato/pagamento via KOMUNE | — | Pedir avaliação D+2 após o evento | Solicitação automática de avaliação; case para pitch | Cliente ativo |
| 12 | **Recorrente** | ≥ 2 contratações ou ≥ 3 leads respondidos em 60 dias | — | Revisão mensal | Convite para embaixador; upgrade de destaque | Cliente fiel |
| — | **Nutrição (sem resposta / depois)** | 5 toques sem resposta OU "agora não" | Novo gatilho (evento, categoria em déficit, vaga de fundador) | Reengajar em D+30 e D+60 | Cadência leve (1 toque/mês) | Frio |
| — | **Perdido** | "Não" explícito com motivo | Só reabre com mudança de contexto | Motivo obrigatório (lista fechada) | Relatório semanal de motivos | — |
| — | **Opt-out / Não contatar** | Pediu para não receber mensagens | Nunca reabre automaticamente | Imediato | Bloqueio de disparos; retenção mínima do registro (LGPD) | — |

Motivos de perda (lista fechada, inspirada nas objeções típicas de marketplaces de serviços): já usa Casamentos.com/Instagram e não vê ganho; não quer pagar comissão; não confia na plataforma nova/sem clientes; agenda cheia (não precisa de demanda); não tem CNPJ/Pix/não quer formalizar; fora de Natal; categoria fora do escopo; não respondeu (não é "perdido", é nutrição).

### 2.3 Pipeline de produtor / cerimonialista (11 etapas)

Produtor (operacional, faz eventos próprios) e cerimonialista (casamento/formatura/15 anos, indica fornecedores, recebe 5%) compartilham o funil, com um ramo específico para a cerimonialista como **canal de indicação**.

| # | Etapa | Critério de entrada | Critério de saída | SLA | Automação | Temp. |
|---|---|---|---|---|---|---|
| 0 | **Identificado** | Nome, tipo (produtor/cerimonialista), evidência de atividade (evento recente no Sympla/Instagram, portfólio) | Score e tier | 24 h | Scraper Sympla/Instagram/Casamentos.com (42 cerimonialistas) | Frio |
| 1 | **Contato iniciado** | 1º toque personalizado citando evento/trabalho recente | Resposta ou 4 toques | D0, D2, D5, D9 | Bot, com mais espaçamento (perfil consultivo) | Frio |
| 2 | **Respondeu** | Mensagem recebida | Classificação | ≤ 10 min humano | Áudio da Heloísa/Bárbara | Morno |
| 3 | **Demonstração agendada** | Data e formato (Meet manhã / café ou visita à tarde / evento demo de sábado) | Realizada | Confirmações D-1/2 h | Calendar | Quente |
| 4 | **Demonstração realizada** | Mostrou app + painel do produtor; registrou dor principal (venda de ingressos, gestão de fornecedores, financeiro) | Modelo de parceria aceito | Follow-up mesmo dia | Template + proposta (comissão 3% + 5%) | Quente |
| 5 | **Parceria aceita** | Aceitou termos (produtor: taxa; cerimonialista: modelo 3% + 5% e papel de indicação) | Conta criada | ≤ 72 h | Criação assistida da conta de produtor | Quente |
| 6 | **Evento-piloto escolhido** | Definiu qual evento real será o primeiro (data, público, fornecedores necessários) | Evento criado | Escolher em ≤ 7 dias após aceite | Checklist de evento; cruzar fornecedores necessários com Supply Gap → gera alvos de prospecção | Quente |
| 7 | **Evento criado no app** | Evento publicado (mesmo que privado) | Convites enviados | ≤ 5 dias | Assistência de Matheus/Heloísa | Cliente |
| 8 | **Fornecedores/participantes convidados** | ≥ 1 fornecedor indicado (cerimonialista) ou ≥ 1 lote de convites (produtor) | Ativação | Cerimonialista: 1º fornecedor indicado cadastrado em ≤ 14 dias | Link de indicação rastreável (atribuição 1:1) | Cliente |
| 9 | **Ativado** | Produtor: ≥ 1 contratação ou ≥ 1 venda/inscrição via KOMUNE; cerimonialista: ≥ 1 fornecedor indicado publicado + ≥ 1 contratação vinculada | Evento realizado | 30 dias após criação do evento | Comissão de indicação liberada só aqui (regra Airbnb) | Cliente ativo |
| 10 | **Evento realizado → novo evento** | Evento aconteceu; avaliação coletada | 2º evento criado em ≤ 60 dias | Pós-evento D+2 | Relatório do evento; pedir próximo | Recorrente |

Ramo cerimonialista (rodando em paralelo a partir da etapa 5): **carteira mapeada** (lista dos fornecedores que ela usa, com quem já tem relação) → cada fornecedor entra no funil de fornecedor como **Tier A+ (indicação)**, com o 1º toque assinado "a [cerimonialista] indicou você". Métrica: fornecedores indicados por cerimonialista (meta: 5–10) e % deles publicados em 30 dias.

### 2.4 Regra de temperatura (calculada)

| Temperatura | Condição | Regra de esfriamento |
|---|---|---|
| **Frio** | Etapas 0–2 (fornecedor) / 0–1 (produtor), ou em nutrição | — |
| **Morno** | Etapas 3–4 e último contato ≤ 7 dias | > 7 dias sem contato → volta a Frio (nutrição), com tarefa de reengajar |
| **Quente** | Etapas 5–8 e último contato ≤ 5 dias | > 5 dias sem contato → alerta vermelho ao responsável; > 14 dias → Morno |
| **Cliente** | Etapa 9 (publicado) | Sem lead respondido em 30 dias → "Cliente em risco" |
| **Cliente ativo/fiel** | Etapas 10–12 | Sem interação em 60 dias → "Churn de supply" |

### 2.5 Matemática do funil (para dimensionar a lista de alvos)

Premissas conservadoras para prospecção local, personalizada, com pré-cadastro e cadastro assistido (os benchmarks genéricos de outbound B2B ficam muito abaixo disso: taxa de resposta multicanal 12–18%*, e-mail 4%*, ligação→reunião 3,6%*; mas a Uber teve ~75% de aceite em ligação fria para donos de frota, e o "Industry Champions" da Venyu chegou perto de 100% — o contexto local e o pitch de renda mudam tudo):

| Passagem | Taxa assumida | Racional |
|---|---|---|
| Contatado → respondeu | 55–65% | WhatsApp local, nome real, referência à fonte pública; leitura > 90% no WhatsApp (*) |
| Respondeu → apresentação realizada | 50–60% | inclui no-show de ~20% (benchmark Meetime*) |
| Apresentação → autorizou | 70–80% | pitch "já está pronto, sem mensalidade, 8% só quando fecha, lead garantido" |
| Autorizou → publicado | 80–90% | cadastro assistido; a perda é quem não tem CNPJ/Pix |
| **Contatado → publicado** | **≈ 20–30%** | |

Consequência: para 100 publicados são necessários **~350–500 fornecedores contatados**. A meta C1 de 300 alvos no CRM deve subir para **≥ 450 alvos qualificados (tiers A+B)** até o fim de setembro, e as taxas reais devem ser medidas nas duas primeiras semanas para recalibrar. Capacidade: bot inicia 30–50 novos contatos/dia (limite prudente por número, seção 3.6); 7 pessoas × 3 portas/dia (conversa humana, apresentação ou visita) = 21 portas/dia ≈ 400 em 4 semanas. A conta fecha se o bot fizer os toques 1–2 e as pessoas entrarem apenas a partir da resposta.

Para produtores/cerimonialistas (funil consultivo): 60 alvos → ~40 respondem → ~25 demonstrações → ~15–18 parcerias → **~12–15 ativados em 60 dias**; para chegar a 30 é preciso ~120 alvos ou apoiar-se em indicação cruzada (cada cerimonialista traz outras).

---

## 3. Cadência multicanal recomendada

### 3.1 O que os dados dizem

- Cadências B2B modernas: 8–12 toques em 14–21 dias, multicanal, com resposta 2–3× maior que e-mail sozinho (Revenue.io*); para SMB/alta intenção, 6–10 toques em 10–14 dias, "ligação é a espinha dorsal", pausar após 5 toques sem engajamento e reengajar em 60–90 dias (Apollo*). Modelo brasileiro "8×8" (8 toques em 8 dias úteis alternando WhatsApp, e-mail, ligação, case) para PME (SocialHub*).
- WhatsApp no Brasil: leitura > 95% em ~1 min vs e-mail 18–26% (*); resposta a mensagens personalizadas 40–60% vs 3–5% em cold e-mail (eesier*, otimista); 87% dos brasileiros preferem WhatsApp para falar com empresas (*). Cadência WhatsApp típica: 1º follow-up em 3–5 dias úteis, 2º em 5–7, 3º em 7–10; 3 sem resposta → 60–90 dias (*). Volume seguro: 20–50 mensagens frias/dia por número (*).
- Ligação (300 mil ligações, SaaSholic/Meetime): 64% conectam; 29% das conectadas são "significativas"; fixo 69% vs celular 61%; depois das 18 h cai 12,5%; fixo conecta melhor 9–12 h e 14–17 h, celular conecta melhor 12–14 h; ligações > 5 min são 79% significativas. Benchmark de SDR no Brasil: ~30 atividades/dia (top 5%: 96); conversão outbound lead→oportunidade 17%; no-show problemático acima de 20%; responder inbound em < 10 min.
- Horário WhatsApp B2B: ter–qui, 9–11 h (melhor) e 14–16 h; evitar segunda de manhã e sexta à tarde (*). Para o setor de eventos, a agenda é invertida em parte: quinta a domingo são dias de evento; segunda e terça de manhã são os dias "de escritório" de buffet, DJ, fotógrafo e cerimonialista — testar seg 14–17 h e ter/qua 9–11 h como janelas principais.
- Personalização explica 25–30% da variância de resposta; um único follow-up aumenta respostas em ~66%; ~42% das respostas vêm de follow-ups (*). Instagram DM bem feito: 8–15% de resposta (*), útil como canal secundário para quem não tem WhatsApp público.
- Primeiro contato: 3–5 linhas, uma só pergunta, sem pedir reunião no primeiro toque (*). Contra-argumento: a KOMUNE tem algo concreto para mostrar (a prévia do perfil) — usar isso como "pergunta única": "posso te mandar a prévia do seu perfil?".

### 3.2 Cadência para fornecedor Tier A (com visita) e Tier B (sem visita, salvo resposta)

| Dia | Canal | Quem | Conteúdo / objetivo | Tier B |
|---|---|---|---|---|
| **D0** (ter–qui, 9–11 h) | WhatsApp texto | Bot (nome Heloísa) | Apresentação em 3–4 linhas: quem é, de onde veio o contato ("vi seu trabalho no Casamentos.com / Instagram"), o que a KOMUNE é em 1 frase, pergunta única: "posso te mandar a prévia de como ficaria seu perfil?" Sem link no primeiro toque. | igual |
| **D0 + resposta** | WhatsApp áudio | Bot com áudio gravado da Heloísa (30–40 s) + humano assume | Quebra a barreira "é robô?"; propõe 2 horários (Meet manhã / visita tarde) | igual |
| **D1** (14–16 h) | WhatsApp texto curto | Bot | Se visualizou e não respondeu: prova social local ("já estão com a gente X buffets/Y espaços de Natal") + link da prévia com token | igual |
| **D3** | Ligação (celular: 12–14 h ou 14–17 h) | Humano (dono da carteira) | 2 tentativas no dia; se não atende, WhatsApp "tentei te ligar" | só se visualizou 2× |
| **D5** | Instagram DM ou comentário | Humano/estagiário | "Te mandei mensagem no WhatsApp; seu trabalho em [evento] ficou incrível" — canal alternativo | igual |
| **D7** | Visita presencial (rota da tarde, 4 por pessoa) | Humano | Levar celular com app + prévia impressa/QR; "vim terminar seu cadastro" | ligação em vez de visita |
| **D10** | WhatsApp | Bot | Mensagem de fechamento com pergunta fechada: "faz sentido agora, mais pra frente, ou não faz sentido? (responda 1, 2 ou 3)" | igual |
| **D14** | E-mail (se houver) | Bot | Apresentação em PDF + prévia + agenda de eventos; move para Nutrição | igual |
| **D30 / D60** | WhatsApp | Bot | Reengajamento com gatilho novo: evento com demanda na categoria dele, "sobraram 3 vagas de fundador em [categoria]", lead real disponível | igual |

Total: 8 toques em 14 dias + 2 de reengajamento; humanos entram só no D3/D7 (Tier A) ou após resposta. Regras: nunca 2 toques no mesmo dia sem resposta; nenhum toque em sábado/domingo (dia de evento); nenhum toque depois das 18 h; opt-out em qualquer mensagem encerra tudo.

### 3.3 Cadência "lead quente" (depois que respondeu com interesse)

| Momento | Ação | SLA |
|---|---|---|
| Resposta chegou | Bot acusa em ≤ 1 min (mensagem curta + áudio); humano responde de verdade | ≤ 10 min em horário comercial; fora dele, primeira coisa na manhã seguinte (a cada 30 min de atraso a conversão despenca — regra dos 5 min do WeddingPro/SocialHub*) |
| Proposta de reunião | 2 opções concretas (ex.: "amanhã 10 h no Meet ou quinta 15 h eu passo aí") | mesmo dia |
| Confirmações | D-1 (texto) e 2 h antes (texto curto) | automático |
| Pós-apresentação | Resumo + link da prévia + checklist de 3 itens (CNPJ/CPF, Pix, e-mail) | mesmo dia |
| D+1 | "Conseguiu ver? Posso preencher por você se me mandar X" | bot |
| D+3 | Áudio da Heloísa | bot |
| D+5 | Ligação ou visita para "terminar junto" | humano |
| Publicado | Parabéns + kit de divulgação + "seu primeiro lead chega em até 30 dias" | ≤ 24 h |

### 3.4 Cadência de ativação (pós-publicação, D+0 a D+90)

| Dia | Ação |
|---|---|
| D+0 | Boas-vindas, selo Fundador, kit de divulgação (banner, story pronto com foto dele) — pedir que compartilhe |
| D+2 | Micro-treino: "responda leads em até 24 h; quem responde primeiro leva até 50% das contratações" |
| D+7 | Primeiro lead real (evento próprio ou Research Request) distribuído; monitor de resposta |
| D+14 | Se ainda sem lead respondido: ligação; oferecer destaque rotativo |
| D+30 | Relatório: visualizações, leads, tempo de resposta; pedir 1ª avaliação de cliente antigo (importável com consentimento) |
| D+60 / D+90 | Revisão; convite a embaixador se ativo; alerta de churn se sem interação em 60 dias |

### 3.5 Qualificação: "SPACE" (BANT/CHAMP adaptado a fornecedor)

BANT (orçamento, autoridade, necessidade, prazo) serve para deals transacionais com um decisor (< US$ 25k); CHAMP reordena por dor primeiro (desafios, autoridade, dinheiro, prioridade) e é mais adequado a conversa consultiva (*). Para fornecedor de eventos, "orçamento" não existe (ele não paga nada até fechar), então o checklist deve ser:

| Letra | Pergunta que o CRM obriga a preencher | Exemplo de critério de saída da etapa 4 |
|---|---|---|
| **S — Serviço/Supply gap** | Categoria e subcategoria, faixa de preço, capacidade (eventos/mês), atende Natal/Grande Natal? | Categoria em déficit ou prioritária |
| **P — Presença/prova** | Avaliações, fotos, tempo de mercado, onde já anuncia (Casamentos.com, GetNinjas, Instagram) | ≥ 1 fonte de prova social |
| **A — Autoridade e formalização** | Fala com o dono? Tem CNPJ/MEI? Tem Pix empresarial? Quem cadastra? | Decisor identificado; formalização possível em ≤ 7 dias |
| **C — Canal e dor** | Como consegue clientes hoje? Paga mensalidade a alguém? Perde lead por demora? Agenda ociosa em quais meses? | Dor clara (custo de mídia, sazonalidade, demanda fraca) |
| **E — Engajamento/expectativa** | Aceita responder leads em 24 h? Aceita a taxa de 8%? Quer o selo Fundador? Disponibilidade para reunião | "Sim" nos 3 primeiros |

### 3.6 Salvaguardas do bot de WhatsApp (o que a política do WhatsApp implica)

- O WhatsApp restringe contas por bloqueios/denúncias, mensagens não solicitadas em massa, automação não oficial e scripts que coletam dados; a política oficial exige opt-in para mensagens iniciadas pela empresa (templates de marketing), e o limite inicial de uma conta na plataforma oficial é de 250 conversas iniciadas/24 h (unverified), subindo para 1k/10k/100k conforme uso ≥ 50% do limite em 7 dias e qualidade verde. Com API não oficial (número comum em máquina dedicada), o risco de banimento depende de taxa de bloqueio, volume e "cara de spam".
- Recomendação: (1) volume de **30–50 primeiros contatos/dia por número**, com um segundo número aquecido como reserva; (2) primeira mensagem **sem link e sem imagem**, personalizada (nome, categoria, fonte); (3) enviar em horário comercial, espaçado (1 a cada 2–4 min); (4) opt-out em qualquer palavra ("não", "pare", "remover") → bloqueio imediato de disparos; (5) humano assume toda conversa respondida; (6) medir "taxa de bloqueio" (contatos que bloquearam/contatados) e parar se > 2%; (7) base legal LGPD: legítimo interesse para contato comercial B2B com dado de empresa publicado para fins comerciais — registrar a fonte de cada dado, não guardar CPF antes da autorização, atender pedido de exclusão.

---

## 4. Modelo de scoring e priorização de supply

### 4.1 Sinais que as plataformas usam

- DoorDash: tipo de negócio, local vs rede, geolocalização, tipo de cozinha, avaliações, horário; intenção do consumidor; "preenche a lacuna de demanda em determinada geografia?"; saída é um ranking por mercado + "mercado endereçável" por cidade.
- Airbnb: 300 anúncios/100 avaliados por cidade como alvo; > 10 avaliações como limiar de confiança; fotos profissionais como multiplicador de 2,5×.
- Google Business Profile: perfis no top 3 têm > 250 fotos (Localo, 2 M de perfis); Doctoralia: perfil com foto recebe ~30% mais visitas.
- Adzuna: ausência no concorrente = lead quente. Antler: começar por supply exclusivo/diferenciado; priorizar pela demanda observada no site.

### 4.2 Score KOMUNE (0–100) para fornecedor

| Bloco | Peso | Sinal | Pontos |
|---|---|---|---|
| **Supply Gap (lacuna)** | 35 | Categoria com < 5 fornecedores publicados (meta 14 × 5) | 25 |
| | | Categoria com 5–9 | 12 |
| | | Categoria ≥ 10 | 3 |
| | | Demanda registrada no app (Research Requests / buscas sem resultado / evento próprio precisando) | +10 |
| **Qualidade/prova social** | 30 | Rating ≥ 4,7 com ≥ 10 avaliações (Google/Casamentos/GetNinjas) | 12 |
| | | Rating 4,3–4,7 ou 5–9 avaliações | 7 |
| | | < 5 avaliações ou sem avaliação | 2 |
| | | ≥ 10 fotos de trabalhos disponíveis publicamente | 6 |
| | | Presente em ≥ 2 diretórios (Casamentos.com, GetNinjas, Constance Zahn, Google, Sympla) | 6 |
| | | Instagram ativo (post ≤ 30 dias) e ≥ 1.000 seguidores | 6 |
| **Alcançabilidade** | 15 | WhatsApp identificado (celular) | 8 |
| | | Instagram com DM aberta / e-mail / telefone fixo | 3 |
| | | Contato quente (indicação de cerimonialista, contato pessoal da equipe, cliente de evento KOMUNE) | +4 (e sobe automaticamente para A+) |
| **Fit / prontidão** | 20 | Sede/atuação em Natal ou Grande Natal | 6 |
| | | CNPJ/MEI identificado (Econodata/CNAE 8230 ou site) | 5 |
| | | Já vende por marketplace/app (paga Casamentos.com premium, usa GetNinjas, iFood) — "alfabetizado em marketplace" e com dor de mensalidade | 5 |
| | | Faixa de preço compatível com o público KOMUNE (não ultra-luxo, não informal sem nota) | 4 |
| **Penalidades** | — | Rating < 4,0 com ≥ 10 avaliações; reclamações graves; fora do estado; categoria fora do escopo | −20 a excluir |

Tiers: **A ≥ 70** (cadência completa com ligação e visita; dono humano desde o D0), **B 45–69** (bot + ligação; visita só se responder), **C < 45** (bot em cadência curta de 3 toques; nutrição). **A+** = qualquer indicação/relacionamento (entra no topo da fila e recebe o toque assinado por quem indicou).

Recalcular o score diariamente: o bloco Supply Gap muda conforme categorias vão sendo preenchidas — quando "buffet" chegar a 5 publicados, os buffets restantes caem de tier e a equipe migra para "iluminação" ou "transporte". Isso implementa o que a DoorDash faz com previsões diárias.

### 4.3 Score para produtor/cerimonialista

| Sinal | Pontos |
|---|---|
| Eventos realizados nos últimos 12 meses (Sympla/Instagram): ≥ 6 → 25; 3–5 → 15; 1–2 → 8 | até 25 |
| Público médio por evento / nº de casamentos-ano (cerimonialista): alto → 15 | até 15 |
| Tipo: formatura, corporativo, festival, casamento (segmentos-alvo) | até 15 |
| Carteira de fornecedores visível (marca fornecedores nos posts, tem "parceiros") — potencial de indicação | até 20 |
| Alcançabilidade (WhatsApp/DM/indicação) | até 15 |
| Dor declarada (vende ingresso por link genérico, cobra por Pix manual, reclama de comissão da Sympla) | até 10 |

Tier A produtor ≥ 65: demonstração presencial e evento-piloto acompanhado; Tier B: Meet; Tier C: convite para o evento demo de sábado e nutrição.

### 4.4 Ordem de ataque sugerida (2 meses)

1. **Semanas 1–2**: 43 espaços + 13 buffets + 55 fotógrafos do Casamentos.com (categorias âncora, dados ricos) e 42 cerimonialistas (canal de indicação); contatos pessoais da equipe (A+).
2. **Semanas 3–4**: categorias em déficit reveladas pelos eventos-piloto e Research Requests (som, iluminação, transporte, mobiliário, recreação infantil); base GetNinjas e Constance Zahn.
3. **Semanas 5–8**: long tail via Econodata (CNAE 8230) e Instagram, atacada quase só pelo bot, enquanto os humanos concentram em ativação e reengajamento.

---

## 5. Padrão "claim your listing" / pré-cadastro: como fazem e o que a KOMUNE deve copiar

### 5.1 Como cada plataforma faz

| Plataforma | Como o perfil nasce | Como avisa / convida | Como verifica | O que o dono ganha ao assumir | Observação |
|---|---|---|---|---|---|
| **Google Business Profile** | Indexação automática, contribuições de usuários (check-ins), terceiros (ex-funcionários, agências) | Texto "É seu este negócio? / Reivindicar este negócio" no Search e Maps | Cartão-postal (5–14 dias úteis), telefone/SMS (instantâneo), e-mail (instantâneo), vídeo (1–5 dias) | Editar dados, responder avaliações, fotos, posts, estatísticas | ~64% dos negócios verificaram; em serviços automotivos/reparos cai a ~45% — ou seja, mesmo o Google não passa de 2/3 sem esforço ativo |
| **Yelp** | Comunidade e compilação de dados da própria Yelp | Botão "Claim this business" na página | Telefone/SMS/e-mail; conta Yelp for Business | Responder avaliações, fotos, mensagens, elegível a anúncios; grátis | Pages existem antes do dono; quem assume passa a ser abordado pelo comercial de anúncios |
| **TripAdvisor** | Viajantes e a própria plataforma adicionam estabelecimentos | "Claim your listing" no Owners Center | Telefone (PIN), documento/foto de identidade; instantâneo a alguns dias úteis | Management Center: dados, fotos, responder avaliações, analytics | Existe até PDF de "bulk claiming" para redes |
| **Zomato** | Base própria de restaurantes | "Claim this restaurant" → nome, telefone, ID; "Zomato entrará em contato para ajudar" | Contato humano + verificação antes de ir ao ar | Gestão do cardápio, pedidos | Mistura self-service com contato humano — o modelo mais próximo do da KOMUNE |
| **Doctoralia** | Dados públicos e perfis criados por pacientes para avaliar ("crie um perfil para ele") | Botão "Editar ou gerenciar perfil" / "Corrigir dados" | Formulário + e-mail; moderação aprova e confirma por e-mail | Perfil verificado, foto (+30% visitas), agenda, responder opiniões; 33 M acessos/mês como argumento | Perfil não verificado é exibido publicamente com marcação; profissional não pode simplesmente apagar |
| **The Knot / WeddingWire** | Listagens gratuitas criadas para que casais avaliem; "não removemos listagens gratuitas a menos que a empresa tenha fechado" | E-mail automático a cada avaliação recebida (o gancho de reivindicação) | Conta WeddingPro | Storefront, responder avaliações, upgrade pago por posição | O e-mail "você recebeu uma avaliação" é o convite mais eficaz — a KOMUNE pode replicar com "você recebeu um pedido de orçamento" (só após autorização) |
| **Zola** | Cadastro do fornecedor; permite conectar Google Business Profile | Código de verificação por e-mail | E-mail | Perfil grátis com upgrades; leads com regra de resposta | "Importe do Google" reduz digitação |
| **Casamentos.com.br** | Cadastro gratuito pelo fornecedor (comunidade também pede "adicionar fornecedor") | — | — | Perfil grátis; premium por posição (Top Gold 1ª posição, Silver 13ª, Premium 22ª) | Modelo de assinatura por posição é a dor que a KOMUNE ataca |

### 5.2 Aprendizados transferíveis

1. **Transparência explícita sobre a origem.** Todas exibem uma marcação ("não reivindicado", "perfil não verificado", "informações fornecidas por usuários"). A KOMUNE vai além (não publica), mas deve manter o rótulo interno **"Pré-cadastro — dados públicos de [fonte], aguardando autorização"** e dizer isso na primeira mensagem: "montamos uma prévia com o que está público no seu [Instagram/Casamentos.com]; nada é publicado sem seu OK".
2. **A prévia é o produto de conversão.** Airbnb converteu com fotos e estimativa de ganhos; Doctoralia com "perfil com foto tem +30% visitas"; Google com "É seu?". A KOMUNE deve gerar um **link de prévia (magic link com token)** que abre o perfil como ficaria no app, com as fotos dele, categoria, faixa de preço e um bloco "quanto você pode faturar" (ex.: nº de eventos previstos na categoria nos próximos 60 dias) — e com botão "Sim, é meu — quero publicar" e "Não sou eu / remover".
3. **Verificação leve e no canal em que a pessoa já está.** Google/Yelp/TripAdvisor usam telefone/SMS instantâneo; cartão-postal é o que mais atrasa. Para a KOMUNE: a **autorização é o próprio WhatsApp** (texto ou áudio "autorizo", com data/hora e número — guardar como evidência) + código de 6 dígitos enviado pelo mesmo número para confirmar posse antes de publicar. Nunca pedir e-mail/senha no primeiro passo (login unificado ainda não existe; a equipe cria a conta).
4. **Ganho imediato ao assumir.** Yelp/TripAdvisor liberam responder avaliações; Doctoralia dá o selo verificado; The Knot mostra a avaliação recebida. A KOMUNE deve ter 3 ganhos visíveis no instante da autorização: selo **Fundador/Verificado**, entrada na rotação de destaque (10 por vez) e a promessa de 1 lead real em 30 dias.
5. **Moderação antes de publicar.** Doctoralia e Zomato revisam; a KOMUNE também: checklist obrigatório (fotos com direito de uso confirmado pelo próprio fornecedor, preços conferidos, CNPJ/CPF, Pix, e-mail) — publica em ≤ 24 h após completo.
6. **Caminho de saída sempre disponível.** The Knot é criticada por não remover; Doctoralia por manter perfis não verificados. Como a KOMUNE não publica sem autorização, o custo é zero: "não quero" → registro vai para Opt-out e os dados raspados são descartados (retenção mínima). Isso deve estar na mensagem.
7. **Metrificar a reivindicação como funil próprio**: prévia enviada → prévia aberta → clicou "é meu" → autorizou → completou → publicado. O Google fica em ~64% de verificação com convite passivo; a KOMUNE, com convite ativo + assistência, deve mirar **≥ 75% de autorização entre quem abriu a prévia**.
8. **Importar em vez de digitar.** Zola conecta o Google Business Profile; a KOMUNE pode importar do Instagram/Google (fotos, descrição, horário) e pedir só o que não é público (CNPJ/CPF, Pix, e-mail, preços internos).
9. **Não usar dados de pessoa física sem base legal.** Para autônomos (fotógrafo MEI, DJ), tratar nome/foto/telefone como dado pessoal: origem registrada, finalidade (convite comercial), prazo de retenção (ex.: 90 dias sem resposta → apagar), e nunca publicar antes da autorização. Para empresas (buffet, espaço), o dado é de pessoa jurídica, mas o telefone do dono continua pessoal.

### 5.3 Fluxo de pré-cadastro proposto (ponta a ponta)

1. Scraper → registro no CRM (fonte, URL, data, campos) → dedupe → score.
2. Job cria fornecedor "rascunho" no Supabase (origem = pré-cadastro; publicado = false; fonte_dados; consent = null) com serviços e fotos em bucket privado.
3. Bot envia D0 (sem link). Se responde → áudio + link de prévia; se não, D1 traz o link.
4. Página de prévia (token, expira em 30 dias): perfil como no app + "quanto você pode faturar" + botões [É meu, quero publicar] [Corrigir dados] [Não sou eu / remover].
5. Clique em "É meu" → CRM move para etapa 7 (Autorizou) e registra consentimento (IP, hora, número) → bot pede código de confirmação e os 3 dados faltantes → humano finaliza no painel se necessário.
6. Publicação → selo → kit → fila de leads → ativação.
7. Sem resposta em 5 toques → prévia expira → dados pessoais purgados em 90 dias; empresa fica em nutrição só com nome/categoria/telefone comercial.

---

## 6. Programas de fundador, embaixador e indicação

- **Founding supplier**: programas reais usam (a) benefício temporário (0% por 90 dias — Sigmamarkt; 3 meses grátis — Azura), (b) **selo permanente** "nunca mais concedido após o lançamento", (c) vagas limitadas (100; "10 de 10 vagas, restam 8") e (d) suporte prioritário nas primeiras transações. Como a taxa zero deixou de ser central no pitch da KOMUNE, o valor do programa deve migrar para **escassez + status + demanda garantida**: "vagas de fundador por categoria" (ex.: 5 buffets, 5 espaços), selo permanente, destaque rotativo, 1 lead real em 30 dias, voz no roadmap (grupo de WhatsApp dos fundadores). A escassez por categoria também alinha com a meta de 14 × 5.
- **Embaixadores (2 estagiários + 3 comissionados)**: copiar a regra da Airbnb — comissão só quando o indicado é **ativado** (publicado + primeiro lead respondido, ou primeira contratação), com atribuição por link/código único e janela (90 dias). Uber pagou pouco no início (US$ 25) e subiu com competição; começar com valor simbólico + bônus por marco (5 ativados) evita pagar por cadastro fantasma.
- **Cerimonialista como sócia (5%)**: é o programa de indicação mais forte disponível; tratar como "Superhost Ambassador": dashboard próprio com seus indicados e o progresso até o primeiro lead; meta de 5–10 fornecedores indicados; a comissão de 5% sobre contratações intermediadas já é o incentivo.
- **Demanda → supply**: Airbnb converteu hóspedes 5 estrelas em anfitriões por e-mail automático ("melhor conteúdo de conversão"). Equivalente KOMUNE: quem contratou/participou de um evento pela plataforma recebe "você também é fornecedor? Indique um".
- **Encontros presenciais**: Airbnb e Lyft usavam meetups e "aulas com bagels"; Antler cita orçamento de US$ 200–300 para 15–20 pessoas. O evento demo de sábado deve virar ritual quinzenal de ativação: fornecedores fundadores apresentam, novos veem o app funcionando com clientes reais.
- **Como medir ativação (não cadastro)**: tempo até primeiro lead (mediana; meta ≤ 14 dias), % de publicados com ≥ 1 lead respondido em 30 dias (meta 70%), % que respondeu em ≤ 24 h, % com ≥ 3 avaliações em 60 dias, % com 2ª interação em 60 dias, churn de supply (sem interação em 60 dias).

---

## 7. KPIs, dashboard e rituais

### 7.1 KPIs de pipeline (por pessoa, por canal, por categoria, por fonte)

| Grupo | KPI | Meta inicial / alarme |
|---|---|---|
| Volume | Alvos qualificados (A+B) no CRM | ≥ 450 fornecedores, ≥ 100 produtores até 30/09 |
| | Novos contatos iniciados/dia | 30–50 (bot) |
| | "Portas"/dia/pessoa (conversas humanas + apresentações + visitas) | 3 (alarme < 2 por 3 dias) |
| Conversão | Taxa de resposta (respondeu/contatado) por canal e por toque | ≥ 55%; alarme < 40% → rever mensagem/lista |
| | Resposta → apresentação | ≥ 50% |
| | Show rate de apresentações | ≥ 80% (alarme no-show > 20%) |
| | Apresentação → autorização | ≥ 70% |
| | Autorização → publicado | ≥ 80% em ≤ 7 dias |
| | Contatado → publicado (global) | 20–30% |
| Velocidade | Tempo de 1ª resposta humana a fornecedor | ≤ 10 min (horário comercial) |
| | Tempo por etapa (mediana) e leads "parados" acima do SLA | 0 leads quentes > 5 dias sem contato |
| | Ciclo contato → publicado | ≤ 14 dias (Tier A) |
| Cobertura | Categorias com ≥ 5 publicados | 14 em 60 dias; gráfico de barras por categoria vs meta |
| | Supply Gap aberto (pedidos/buscas sem fornecedor) | tendência de queda |
| Ativação | Publicados com ≥ 1 lead respondido em 30 dias | 70% |
| | Mediana de dias até 1º lead | ≤ 14 |
| | Fornecedores que respondem lead em ≤ 24 h | ≥ 80% |
| | Primeiras contratações; avaliações por fornecedor | ≥ 3 avaliações/fornecedor em 60 dias |
| Retenção | Churn de supply (sem interação em 60 dias) | < 15% |
| Qualidade | % perfis completos (fotos ≥ 10, preço, descrição) | 100% dos publicados |
| Indicação | Indicados por cerimonialista/embaixador; % ativados | 5–10 por cerimonialista; ≥ 50% ativados |
| Custo | SAC (custo de aquisição por fornecedor ativado: horas × custo + incentivos) | acompanhar; separado do CAC |
| Saúde do canal | Taxa de bloqueio no WhatsApp; entregas falhas; opt-outs | bloqueio < 2%; opt-out < 5% |
| Perdas | Motivos de perda (top 5) | alimenta pitch semanal |

### 7.2 Dashboard (Metabase sobre Supabase) — 4 telas

1. **Funil da semana** (fornecedor / produtor): barras por etapa, conversão entre etapas, comparativo com semana anterior; filtro por responsável, tier, fonte, categoria.
2. **Cobertura por categoria**: 14 barras (publicados vs meta 5), com "próximos 3 alvos" de cada categoria em déficit — a lista que o DoorDash entrega ao vendedor diariamente.
3. **Ativação**: coorte semanal de publicados × dias até 1º lead; % com lead respondido em 30 dias; ranking de tempo de resposta.
4. **Operação diária (relatório automático 8 h, segunda a sexta)**: portas ontem por pessoa vs meta ("Rafael, 10 tarefas, fez 1"), leads quentes vencidos por responsável, reuniões de hoje com confirmações, respostas do bot aguardando humano, saúde do número de WhatsApp.

### 7.3 Rituais

- **Diário (8 h, automático, 5 min de leitura)**: relatório da tela 4 no WhatsApp da equipe; a "IA secretária" cobra pendências individuais.
- **Diário (17 h 30, 10 min)**: registro obrigatório de visitas/reuniões do dia no CRM (o que não está no CRM não aconteceu).
- **Semanal — reunião de growth (segunda, 45 min, formato Balfour/Ellis)**: 5 min métricas (dashboard já lido antes); 20 min aprendizados (o que funcionou/não funcionou por toque, canal, categoria, motivo de perda), com quem apresenta vindo com o dado; 10 min triagem de ideias/experimentos para a semana (mensagem nova, horário, incentivo) com dono e hipótese; 10 min decisões (categorias-alvo da semana, redistribuição de carteira). Regras: sem brainstorming livre, sem debate de prioridade (isso é feito antes por Rafael/Bárbara), foco em impacto e aprendizado.
- **Quinzenal**: evento demo/encontro de fundadores (ativação e prova social).
- **Marcos 30/60/90 dias**: revisão de metas, taxas reais do funil (recalibrar seção 2.5), decisão sobre próximas cidades.

### 7.4 Campos mínimos do CRM (além dos já listados no Contexto Mestre)

`tier`, `score` (+ componentes), `fonte_url`, `data_coleta`, `consentimento` (texto/áudio, data, canal), `preview_token`, `preview_aberto_em`, `toques[]` (canal, data, resultado, quem), `visualizou_ultimo_toque`, `motivo_perda`, `indicado_por`, `data_publicacao`, `primeiro_lead_em`, `primeiro_lead_respondido_em`, `ultima_interacao_plataforma`, `bloqueou_whatsapp`, `opt_out`.

---

## 8. Fontes

Playbooks de plataformas
- Uber (Scott Gorlick, 1º funcionário de expansão): https://www.growthpair.com/playbooks/how-uber-turned-phone-lists-into-a-multi-billion-dollar-driver-network e https://www.deciphr.ai/podcast/scott-gorlick-how-uber-acquired-1m-drivers--the-ubers-expansion-playbook--e1196
- Uber Greenlight Hubs / indicações: https://www.ridester.com/uber-greenlight-hub/ ; https://uber.com/us/en/drive/basics/how-referrals-work ; https://viral-loops.com/blog/uber-referral-program-case-study/
- Airbnb fotografia profissional: https://strategybreakdowns.com/p/airbnb-photography
- Airbnb "28 ways to grow supply" (Lenny Rachitsky): https://andrewchen.com/grow-marketplace-supply/
- Lenny Rachitsky, "How to Kickstart and Scale a Marketplace — Part 3: Growing Initial Supply": https://www.lennysnewsletter.com/p/how-to-kickstart-and-scale-a-marketplace-911
- Airbnb Ambassador Program: https://www.airbnb.com/help/article/2700
- Antler, "How to grow marketplace supply fast": https://www.antler.co/blog/how-to-grow-marketplace-supply-fast
- The Marketplace Guide, padrão "Supply Acquisition": https://themarketplaceguide.com/patterns/supply-acquisition/
- DoorDash, modelo de seleção de comerciantes: https://careersatdoordash.com/blog/building-merchant-selection/
- DoorDash Territory Account Executive (vaga): https://www.themuse.com/jobs/doordash/territory-account-executive-dc-metro
- Thumbtack (NFX, Marco Zappacosta): https://www.nfx.com/post/billion-dollar-marketplace-thumbtack
- iFood cadastro e planos (Saipos): https://saipos.com/integracoes/ifood/ifood-cadastro ; vagas comerciais iFood: https://job-boards.greenhouse.io/ifoodcarreiras/jobs/8002046002 ; https://startup.jobs/executivo-vendas-ext-iii-comercial-mercado-ifood-5575645
- Rappi Aliado, cadastro: https://www.motoristasdeaplicativos.com.br/rappi-aliado-como-cadastrar-restaurante/
- 99 motorista / Casa 99: https://99app.com/motorista/como-se-tornar-motorista/
- GetNinjas para profissionais: https://blog.getninjas.com.br/como-funciona-o-getninjas-para-profissionais/
- Booking.com Account Manager (vagas): https://www.themuse.com/jobs/bookingcom/account-manager-santiago-2fe387
- The Knot Pro, listagens gratuitas não removidas: https://vendorsupport.theknotpro.com/hc/en-us/articles/5738906813716-I-have-a-free-listing-on-The-Knot-Why-can-t-I-remove-my-business-from-your-site
- The Knot, adicionar fornecedor para avaliar: https://helpcenter.theknot.com/hc/en-us/articles/360042639351-I-can-t-find-a-vendor-to-leave-a-review-How-do-I-add-a-business-to-The-Knot
- The Knot reviews (ReviewTrackers): https://www.reviewtrackers.com/blog/theknot-reviews/
- WeddingPro, resposta a leads (50% para quem responde primeiro; 5 min = 9×): https://pros.weddingpro.com/blog/sales/respond-to-wedding-leads-the-knot-weddingwire/
- Zola para fornecedores: https://www.zola.com/faq/category/360000310271-Zola-for-Vendors-and-Wedding-Professionals ; comparação Zola × The Knot: https://bodabliss.com/zola-vs-the-knot-vendor-comparison/
- Casamentos.com.br serviços premium: https://www.casamentos.com.br/emp-AccesoPremium.php
- The Bash FAQ: https://www.thebash.com/help
- Peerspace (contexto): https://en.wikipedia.org/wiki/Peerspace

"Claim your listing"
- Google Business Profile, perfis não reivindicados e verificação: https://reviewoverhaul.com/blog/unclaimed-google-business-profile/ ; estatísticas de fotos (Localo): https://bloggingwizard.com/google-business-profile-statistics/
- Yelp, reivindicar página: https://localiq.com/blog/how-to-claim-a-business-on-yelp/ ; https://www.yelp-support.com/Claiming_your_Business_Page?l=en_US
- TripAdvisor, reivindicar: https://www.localfalcon.com/blog/how-to-claim-a-tripadvisor-listing-everything-local-businesses-need-to-know ; https://www.tripadvisor.com/TripAdvisorInsights/claimyourbusiness
- Zomato, reivindicar restaurante: https://www.synup.com/en/how-to/claim-add-zomato-listing
- Doctoralia, perfil gratuito / perfis pré-existentes: https://pro.doctoralia.com.br/blog/especialistas/esteja-mais-visivel-para-pacientes-com-um-perfil-gratuito-na-doctoralia ; FAQ: https://www.doctoralia.com.br/faq

Cadência, canais e qualificação
- Apollo, cadência multicanal ideal: https://www.apollo.io/insights/whats-the-ideal-cadence-for-a-multi-channel-outbound-sequence
- Revenue.io, 12 métricas de cadência: https://www.revenue.io/blog/sales-cadence-12-metrics-every-outbound-team-should-track
- Winning Sales, follow-up WhatsApp + telefone no Brasil: https://winningsales.com.br/blog/follow-up/
- eesier, prospecção B2B por WhatsApp (horários, cadência, LGPD, bloqueio): https://eesier.com.br/prospeccao-b2b-pelo-whatsapp
- SocialHub, Estado do CRM e WhatsApp no Brasil 2026 (modelo 8×8): https://www.socialhub.pro/relatorio-crm-whatsapp-brasil-2026/
- SaaSholic/Meetime, 300 mil ligações (horários e taxas de conexão): https://blog.saasholic.com/p/o-que-validamos-com-ligacoes-de-vendas
- Benchmark de pré-venda no Brasil (Meetime via AI Hub): https://botaihub.com.br/vendas/benchmark-pre-venda-brasil-meetime-custo-por-reuniao/
- Cold DM benchmarks (Instagram/LinkedIn/X): https://xautodm.com/blog/cold-dm-benchmarks-reply-rates-that-are-actually-good-2026
- RepMove, benchmarks de vendas externas (visitas/dia): https://repmove.app/sales-efficiency-benchmarks-statistics/
- BANT × CHAMP × MEDDIC: https://www.coffee.ai/articles/bant-champ-meddic-b2b-sales
- WhatsApp: limites de mensagens e qualidade (Meta): https://developers.facebook.com/docs/whatsapp/messaging-limits/ ; tiers e regras (Chatarmin): https://chatarmin.com/en/blog/whats-app-messaging-limits ; motivos de bloqueio (Omnichat): https://blog.omnichat.ai/whatsapp-business-account-block/

Programas de fundador, liquidez, KPIs e rituais
- Sigmamarkt Founding Seller Program: https://sigmamarkt.com/en/sellers ; Azura Founding Partner Program: https://azurabooking.com/partnership/
- Point Nine, "WTF is marketplace liquidity": https://medium.com/point-nine-news/wtf-is-marketplace-liquidity-f2caca3802c0
- The Marketplace Guide, KPI stack: https://themarketplaceguide.com/articles/the-kpi-stack-every-marketplace-founder-needs-before-scaling-what-to-measure-why-it-matters-and-what-its-actually-telling-you/
- Brian Balfour, reunião semanal de growth: https://brianbalfour.com/essays/growth-meeting ; Growth Method, agenda: https://growthmethod.com/growth-team-meeting/
