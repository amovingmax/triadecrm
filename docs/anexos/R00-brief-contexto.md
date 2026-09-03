# Brief de contexto — CRM de Captação KOMUNE

Consolidação de tudo que foi dito sobre o CRM nas conversas: transcrição da reunião (03/09/2026), plano estratégico de 90 dias (02/09/2026), Contexto Mestre da KOMUNE (síntese) e memória de conversas anteriores.

## 1. Quem é a KOMUNE e onde está

- App/marketplace de eventos em Natal/RN ("onde conexões viram encontros"). Stack: React Native/Expo + Supabase; painel web de parceiros (fornecedor/produtor) separado do app; site do cliente final. Três logins hoje (site, painel, app); login unificado no roadmap.
- Números: ~15 mil contas (via ingressos gratuitos), ~400 instalações; Android ainda bloqueado no Play Console. Hoje há apenas ~2 fornecedores publicados.
- Empresa: KOMUNE LTDA (holding DMJMG). Rafael investe ~R$15 mil/mês; vê taxa baixa como investimento. Ambição declarada: "unicórnio"; posicionar-se como ERP de eventos (módulos: financeiro, contratação, cliente).
- Equipe: Rafael (CEO), Bárbara (marketing e comercial), Heloísa (comercial operacional / suporte — a "voz" do primeiro contato), Dennis (adm/financeiro), Luiz (TI — foco em tecnologia e gestão), Matheus (programador — Rafael quer que ele foque no CRM e em abrir novos clientes), "Cláudio" (= Claude, sistema/dev: cria o CRM).

## 2. Decisão da reunião: construir CRM próprio

- Já existe uma planilha Excel com contatos e um CRM pago (usado como disparador) que não atende. Frase-chave: "é mais fácil a gente fazer o nosso porque daqui a pouco eu integro com a gente mesmo"; "hoje em dia a velocidade é amiga"; "o que a gente não vai usar nem 100% do que ele tem".
- Rodada de 15 dias a partir de amanhã com foco total em captar fornecedores; marketing fica em segundo plano. "Foco total de todo mundo vai ser só captar."
- Rafael pediu que a pauta desta transcrição foque em duas coisas: o CRM e alinhamento (pitch/apresentação).

## 3. O que o CRM precisa fazer (falas literais e implícitas)

### 3.1 Captação de alvos (topo do funil)
- Fontes: manual (contatos pessoais: floriculturas, churrasqueiro, sushi, som…), planilha Excel existente, e **fontes externas via scraper**: Casamentos.com.br (42 cerimonialistas, 43 espaços, 55 fotógrafos, 13 buffets em Natal), GetNinjas ("pode ser nossa base", "fazer um scrape do GetNinjas"), Constance Zahn (66 fornecedores), Econodata/base CNPJ (1.257 empresas CNAE 8230 em Natal), Google, Instagram; produtores de formatura (M3TA, Z2, Gideon), Sympla.
- Scraper deve copiar "foto, nome, tipo, todas as informações" (perfil, categoria, faixa de preço, avaliações, contatos) — mas com a decisão ética/legal: **não criar "anúncio fake"**; fazer **pré-cadastro** com os dados públicos e enviar por WhatsApp para o fornecedor finalizar e autorizar. No primeiro contato: "vocês autorizam a gente a botar esse seu material lá?".
- Natal/RN primeiro; depois outros estados (multi-cidade desde o modelo de dados).
- Rafael já fez scraping com Claude Code sem custo ("funciona… é bizarro").

### 3.2 Robô de WhatsApp (conversa e manutenção)
- Número dedicado da empresa (telefone já verificado), rodando em máquina dedicada (Rafael traz 3 computadores dos EUA; 1 para o agente de WhatsApp + agente de acompanhamento).
- Fluxo desejado: abrir lista → disparar primeiro contato ("Oi, tudo bom? Somos do Komune, meu nome é Heloísa, queria marcar uma reunião para apresentar a ferramenta…") → quando a pessoa responde ("tá quente"), **mandar áudio** com voz humana de mulher (Heloísa), "quebra a barreira de tecnologia" → marcar reunião (vídeo/Meet de manhã; visita presencial à tarde em rota de ~4 clientes) → follow-up → depois do cadastro, "perturbar" para completar ("a gente viu que você ainda não cadastrou seu produto… vai lá cadastra").
- Bot deve classificar respostas: respondeu sim/não, interesse sim/não, e evoluir a etapa automaticamente.
- Suporte: mensagens do número da empresa não podem "cair num grupo onde ninguém vê"; precisa de inbox com responsável.

### 3.3 Pipeline / etapas (falas)
- "CRM é o follow-up: primeira fase contactei; teve resposta sim ou não; teve interesse ou não; organizar isso."
- Funil do Contexto Mestre (fornecedor): prospectado → contato → conversa → apresentação → interessado → cadastro iniciado → perfil completo → perfil publicado → visualização → lead → proposta → contratação → recorrência.
- Funil produtor: identificado → contato → demonstração → evento escolhido → evento criado → participantes convidados → ativados → evento realizado → novo evento.
- Temperatura: frio (só prospectado) / morno (respondeu, conversa) / quente (interessado, reunião) / cliente (cadastrado, publicado).
- Campos mínimos do CRM (Contexto Mestre): nome, empresa, categoria, cidade, contato, origem, etapa, responsável, último contato, próxima ação, status, motivo da perda.

### 3.4 Segmentação e categorias
- Fornecedores em 5 grupos: alimentos & bebidas (30), infraestrutura (30), prestadores de serviço (20), locais (10), recreação infantil (10). Categorias prioritárias: espaços, buffet, fotografia, vídeo, decoração, som, iluminação, atrações, DJs, bandas, cerimonial, transporte, mobiliário, equipamentos; e as listas da onda 1/onda 2 do plano.
- Produtor (operacional) ≠ Cerimonialista (experiência pessoal: casamento, formatura, 15 anos) ≠ Organizador/anfitrião (não profissional). No sistema Komune não existe variável "cerimonialista" (absorvido pelo perfil produtor com subcategoria) — no CRM deve existir como segmento comercial.
- Meta: 100 fornecedores + 30 produtores/cerimonialistas antes do marketing; 14 categorias com ≥5 fornecedores; 70% dos fornecedores com interação relevante em 30 dias; 3 portas/dia/pessoa; 300 alvos fornecedores + 60 produtores no CRM (C1, até 18/09).

### 3.5 Pitch e argumento comercial
- Taxa: 8% sobre o fornecedor (a taxa era 10%); com cerimonialista: Komune 3% + 5% para o cerimonialista ("cerimonialista é sócio"); Pix absorvido; cartão repassado ao cliente. Fornecedor Fundador: 0% da parte Komune por 90 dias (decisão anterior; na reunião de hoje Rafael disse que a promoção de taxa zero deixa de ser central — "esquece a promoção… vai dizer o custo que a gente cobra, 8%").
- Vantagens a vender: sem mensalidade (vs. Casamentos.com.br), paga só quando fecha, marketing/mídia da Komune divulga o fornecedor, banner/destaque para os primeiros (rotativo, 10 por vez), selo Verificado, seguro/garantia ("até R$ 100 mil" em avaliação, limite realista R$ 5–10 mil), demanda qualificada.
- Apresentação: online (Meet) mostrando app no Simulator (pode mostrar versão local) + painel do fornecedor; presencial com celular + notebook. Rafael quer o pitch organizado amanhã; evento demo no sábado.
- Todo fornecedor fundador recebe ao menos 1 lead real nos primeiros 30 dias (eventos próprios: LDM, LCC, Natal Experience, tênis, churrasco, formaturas).

### 3.6 Produtividade da equipe / agente de cobrança
- Rotina: manhã = vídeo-chamadas; tarde = rota externa visitando ~4 clientes.
- Metas individuais e "IA secretária" que cobra: "Rafael, você tinha 10 coisas para fazer, fez 1" — feedback do resultado por pessoa. Rafael quer que Cláudio/Luiz ajudem a construir; pode rodar na mesma máquina do bot de WhatsApp.
- Reunião semanal de growth (segunda) com relatório automático às 8h; revisões de marco dias 30/60/90.

### 3.7 Integração com a plataforma Komune
- Pré-cadastro: criar o fornecedor "não publicado" (sem CPF/CNPJ/Pix, sem e-mail) com serviços cadastrados a partir dos dados públicos; só publica quando o fornecedor completa dados e carteira. Rafael: "pode criar o da pessoa e já mandar meio que pronto pra ela só acabar".
- Pode exigir campos novos no banco da Komune para "origem = pré-cadastro" (Matheus: "dá pra fazer campos novos específicos").
- Ligação futura com a plataforma: Supply Gap / Research Requests (demanda não atendida vira alvo de prospecção), leads recebidos por fornecedor, status de publicação, Viva Positivo (financeiro), Asana (tarefas hoje).
- Analytics já planejados: PostHog (app) + Metabase sobre Supabase (admin).

### 3.8 Ideias discutidas e descartadas/ajustadas
- "Anúncio fake" (espelhar fornecedores do Casamentos.com sem avisar) → descartado por questão ética; substituído por pré-cadastro transparente e autorização no primeiro contato.
- Lead capturado via anúncio espelhado → só se o fornecedor autorizar.
- Promoção taxa zero deixa de ser o centro do pitch.
- 4 estagiários → 2 estagiários + 3 embaixadores comissionados (Lei do Estágio).

## 4. Restrições e preferências

- Velocidade: MVP em dias, não meses; Claude Code constrói; Matheus dá suporte; Luiz cuida de TI/gestão.
- Custo: preferir ferramentas gratuitas/open source e infra própria (máquinas locais) + Supabase já contratado.
- Pessoalidade: mensagens em nome de pessoa real (Heloísa), áudio humano, sem cara de robô; presencial quando o fornecedor for "burocrata".
- Transparência com fornecedores (avisar, pedir autorização).
- Rafael prefere receber entregáveis como arquivos (Word/Excel/HTML), não como página hospedada; trabalha em pt-BR.
