# 06 — LGPD, privacidade e compliance do CRM de captação KOMUNE

**Natureza deste documento:** mapa de riscos e requisitos de produto para o PRD do CRM. Não é parecer jurídico; os pontos marcados com **[validar com advogado]** devem ser confirmados antes do lançamento.
**Data-base da pesquisa:** 03/09/2026. **Escopo:** (1) scraper de diretórios públicos; (2) prospecção ativa por WhatsApp com robô/IA e áudios; (3) pré-cadastro de fornecedores ("reivindique seu perfil"); (4) voz clonada/pré-gravada de funcionária; (5) acesso interno (equipe, estagiários, embaixadores).

---

## 0. Sumário executivo — as 12 decisões de produto que este documento sustenta

1. **Base legal da prospecção B2B: legítimo interesse (LGPD art. 7º, IX e art. 10), documentado em um teste de balanceamento (LIA) curto**, e não "consentimento" nem "dados públicos = liberados". O art. 7º, §§3º e 4º apenas dispensam o consentimento; **não dispensam** finalidade, transparência, minimização, direito de oposição e segurança (art. 7º, §7º).
2. **Fornecedor autônomo/MEI é pessoa natural.** Nome, celular, Instagram e foto do fotógrafo, DJ ou cerimonialista são dados pessoais. O CRM deve tratar todo registro como potencialmente pessoal e **descartar CPF na ingestão** (o nome empresarial de MEI costuma conter o CPF do titular).
3. **Scraper só de dados factuais** (nome comercial, categoria, cidade/bairro, telefone/WhatsApp comercial, site, @instagram, link de origem). **Nunca copiar fotos, textos descritivos, avaliações/reviews, logos ou preços de listas.** Isso resolve simultaneamente direito autoral (Lei 9.610), direito de imagem (CC art. 20) e o grosso do risco de termos de uso.
4. **Sem login, sem contas falsas, sem burlar bloqueios** (captcha, rate limit, robots.txt). A linha que separa "ler página pública" de "invasão"/quebra de contrato nos casos hiQ, Bright Data e KASPR é exatamente essa.
5. **Google Maps/Places não pode virar base do CRM.** Os termos da Google Maps Platform proíbem "copy and save business names, addresses, or user reviews" e limitam cache a `place_id` (e lat/lng por 30 dias). Usar apenas como enriquecimento em tempo de exibição, ou substituir por CNPJ/RFB + coleta manual.
6. **Primeiro contato no WhatsApp é o ponto de maior risco operacional, não jurídico.** A política da Meta exige opt-in para mensagens iniciadas pela empresa; automação não oficial viola os termos e leva a banimento do número verificado. Arquitetura recomendada: **envio assistido por humano (Heloísa clica "enviar")** no WhatsApp Business App para o primeiro contato + **Cloud API oficial** com opt-in para follow-ups, lembretes e "complete seu cadastro". Robô conversacional só depois que a pessoa responde.
7. **Toda primeira mensagem deve conter: quem somos, por que estamos falando, de onde veio o contato, e como sair** ("responda SAIR"). O opt-out é tratado como oposição (art. 18, §2º) e alimenta uma **lista de supressão** permanente.
8. **Cadência máxima: 1 primeiro contato + 1 follow-up** (72h) para quem não responde; depois só se a pessoa interagir. Janela: seg–sex 8h–19h, sáb 9h–13h, nunca domingo/feriado. Isso replica o padrão do Código de Defesa do Consumidor paulista (Lei 17.832/2023, art. 127) e as boas práticas de qualidade da Meta.
9. **Pré-cadastro invisível ao público.** `published=false` imposto por Row Level Security; sem indexação; sem aparecer em busca do app; sem selo "parceiro"; sem receber leads. O perfil só existe para o fornecedor ver, editar, aceitar os termos e publicar. Não reivindicado em **30 dias (com 1 lembrete)** → dados pré-preenchidos apagados; lead no CRM permanece.
10. **Aceite dos termos com prova** (LGPD art. 8º, §2º — o ônus da prova é do controlador): timestamp, IP, user-agent, versão do termo, hash do texto, checkbox não pré-marcado, cláusula de dados/fotos em destaque (Marco Civil art. 7º, IX).
11. **Voz da Heloísa: preferir áudios reais pré-gravados** (consentimento simples + licença de uso). Voz clonada/sintética exige termo específico e destacado, prazo, revogação, regra pós-desligamento e **aviso de que o áudio é gerado por IA**. O Marco Legal da IA (PL 2338/2023) ainda não é lei (Câmara: "aguardando parecer" em 02/09/2026), mas o produto deve nascer compatível com ele.
12. **Governança mínima desde o dia 1:** encarregado nomeado e publicado (mesmo com a dispensa para pequeno porte), aviso de privacidade específico da prospecção, RBAC + logs no Supabase, contrato/termo com estagiários e embaixadores, plano de incidente (3 dias úteis para comunicar a ANPD), região de dados em São Paulo, e TTLs automáticos de retenção.

---

## 1. Panorama legal em setembro/2026 (o que está em vigor e o que não está)

### 1.1 LGPD e ANPD — estado da fiscalização
- A ANPD aplicou **uma única multa desde a criação**: caso **Telekall Infoservice** (julho/2023), microempresa que vendia listas de contatos de WhatsApp para campanha eleitoral, com base de ~130 milhões de números coletados da internet. Sanções: multa de R$ 7.200 por tratamento sem base legal (art. 7º), advertência por não indicar encarregado (art. 41) e multa de R$ 7.200 por não cooperar com a fiscalização (Regulamento de Fiscalização, art. 5º). **Total: R$ 14.400.** É o precedente diretamente aplicável a "bases de contatos para WhatsApp" — e mostra que porte pequeno não imuniza.
- Balanço de maio/2026 (Agência Lupa): 38 procedimentos instaurados em 2025 e apenas 1 até maio de 2026 (contra a X/Grok); nenhuma nova multa. A ANPD absorveu a implementação do **ECA Digital** (set/2025) e recebeu novos cargos, mas está subdimensionada. **Leitura para o produto:** a probabilidade de sanção da ANPD é baixa; o risco real vem de (a) banimento pela Meta, (b) reclamações no Procon/consumidor.gov e ações no JEC por contato insistente, (c) notificações extrajudiciais de plataformas por scraping e (d) reputação com o próprio público que a Komune quer conquistar.
- **Mapa de Temas Prioritários 2024–2025** da ANPD trazia um eixo específico de **"raspagem de dados e agregadores"** (4 processos abertos em 2023–2024). O **Mapa 2026–2027** (publicado 24/12/2025) prevê 75 ações em quatro eixos: direitos dos titulares, crianças/adolescentes, setor público e **IA/tecnologias emergentes**. Raspagem deixou de ser eixo próprio, mas segue enquadrada em "direitos dos titulares".
- Normas infralegais relevantes (todas em vigor): Resolução CD/ANPD nº 2/2022 (agentes de tratamento de pequeno porte), nº 4/2023 (dosimetria de sanções), nº 15/2024 (comunicação de incidentes — 3 dias úteis), nº 18/2024 (encarregado), nº 19/2024 (transferência internacional).

### 1.2 Bases legais aplicáveis ao CRM
| Operação | Base legal recomendada | Observações |
|---|---|---|
| Coleta de dados de contato profissional em fontes públicas e montagem do lead | **Legítimo interesse** (art. 7º, IX + art. 10) com LIA documentada; art. 7º, §§3º/4º como reforço (dados de acesso público / tornados manifestamente públicos pelo titular) | §3º exige considerar "a finalidade, a boa-fé e o interesse público que justificaram sua disponibilização"; §7º permite nova finalidade se "observados os propósitos legítimos e específicos… e a preservação dos direitos do titular". Um fotógrafo publica o celular no Casamentos.com.br para **receber clientes**, não para ser prospectado por plataformas — a expectativa é parcialmente compatível (é contato comercial), o que sustenta o LI desde que a abordagem seja profissional, única e com opt-out. |
| Primeiro contato por WhatsApp/e-mail/telefone | Legítimo interesse | Guia da ANPD (Ex. 5 e 6) admite marketing direto por LI quando há "mecanismo de descadastramento" e relação com a atividade do controlador. A política da Meta, porém, exige **opt-in** para mensagens iniciadas pela empresa via API (ver §3). |
| Pré-cadastro (rascunho de perfil não publicado, visível só ao fornecedor) | Legítimo interesse (dados factuais) | Não incluir fotos/textos autorais. Não publicar. TTL de 30 dias. |
| Publicação do perfil, uso de fotos, marca, nome e imagem | **Consentimento/contrato** (art. 7º, I e V) + licença de direitos autorais (Lei 9.610, art. 29) + autorização de imagem (CC art. 20) | Aceite expresso, destacado e registrado (LGPD art. 8º, §§1º, 2º e 4º; Marco Civil art. 7º, IX). |
| Follow-ups pós-aceite ("complete seu cadastro") | Execução de contrato/procedimentos preliminares (art. 7º, V) | Ainda assim, com opt-out. |
| Conversas com robô/IA | Mesma base da etapa; LLM externo = **operador** + transferência internacional (art. 33; Res. 19/2024) | Minimizar o que vai para o modelo; DPA com o provedor. |
| Voz da funcionária (gravações e modelo sintético) | **Consentimento específico e destacado** (art. 8º; se tratado como biométrico, art. 11, I) + licença de uso de voz/imagem (CC art. 20) | Ver §5. |
| Lista de supressão (opt-outs) | Cumprimento de obrigação legal/regulatória e legítimo interesse (honrar oposição) | Guardar o mínimo (hash do telefone + data). |

**Dado de PJ × dado de pessoa natural.** CNPJ, razão social e telefone de uma buffet LTDA não são dados pessoais. Mas: (i) MEI e empresário individual = pessoa natural (o próprio nome empresarial identifica a pessoa e, nos dados abertos da RFB, frequentemente traz o CPF); (ii) o "telefone comercial" do fotógrafo é o celular pessoal dele; (iii) nomes de sócios no quadro societário são dados pessoais. **Regra de produto:** tratar todo registro como pessoal por padrão; marcar `is_natural_person` quando natureza jurídica = MEI/EI/autônomo; nunca armazenar CPF.

### 1.3 O Guia de Legítimo Interesse da ANPD (fev/2024) aplicado ao CRM — LIA resumida
O guia estrutura o teste em fases: **finalidade → necessidade → balanceamento → salvaguardas**, e frisa que "a existência de um possível risco ou impacto negativo sobre os titulares não afasta, por si só, o tratamento", desde que os impactos sejam "minimizados e levados em consideração na adoção de salvaguardas". Preenchimento sugerido (anexar ao ROPA):

| Fase | Pergunta do guia | Resposta Komune (rascunho) |
|---|---|---|
| Finalidade | Interesse legítimo, concreto, específico e compatível com o ordenamento? | Formar a oferta de um marketplace regional de eventos, convidando fornecedores profissionais de Natal/RN a criar perfil. Atividade lícita, concreta (metas de 100 fornecedores em 90 dias) e vinculada ao negócio (art. 10, I: "apoio e promoção de atividades do controlador"). |
| Necessidade | Só os dados estritamente necessários? Há meio menos intrusivo? | Campos mínimos: nome comercial, categoria, cidade/bairro, 1 telefone comercial, site/@instagram, URL de origem, data de coleta. Excluídos: CPF, fotos, avaliações, dados de clientes, preços, textos. Alternativa menos intrusiva testada: e-mail/telefone comercial antes do celular pessoal quando existir. |
| Balanceamento | Expectativa legítima? Impacto? Dados sensíveis/crianças? | Titulares são profissionais que divulgam o contato para captar negócios; o contato é único, profissional, em horário comercial, com identificação clara e opt-out. Sem dados sensíveis ou de menores. Impacto: incômodo pontual. Fatores que o guia manda considerar — "fonte e forma da coleta… se os dados foram… coletados de fontes públicas" — pesam contra a expectativa, compensados pelas salvaguardas. |
| Salvaguardas | Transparência (art. 10, §2º), oposição, segurança, retenção | Aviso na 1ª mensagem + página de privacidade; "SAIR" honrado em minutos; lista de supressão; TTL 6 meses sem resposta; RBAC/logs; encarregado publicado; sem publicação de perfil sem aceite. |
| RIPD? | Alto risco? | Não é obrigatório (sem larga escala, sensíveis ou menores), mas a ANPD "poderá solicitar… relatório de impacto" (art. 10, §3º). Manter um RIPD simplificado de 2 páginas. |

### 1.4 Direitos do titular que o CRM precisa operar
- **Informação/transparência** (arts. 6º, VI; 9º; 10, §2º): quem é o controlador, finalidade, origem do dado, direitos, canal. Na prática, a **própria primeira mensagem é o aviso de coleta indireta** — o caso KASPR (CNIL, 2024) puniu justamente informar tarde e em língua errada.
- **Oposição** (art. 18, §2º) e **eliminação** (art. 18, IV/VI): "SAIR", "não quero", "remove", "para" → supressão imediata + confirmação única.
- **Acesso e origem** (art. 18, I/II e art. 9º): responder "de onde vocês pegaram meu número?" com a **fonte específica** (URL) — KASPR foi multada por responder só "fontes públicas".
- **Prazos** (art. 19): resposta imediata em formato simplificado ou completa em **15 dias**. Para pequeno porte, a Res. 2/2022 dobra prazos — mas o produto deve mirar 48h.
- **Canal**: e-mail do encarregado + link na página de privacidade + o próprio WhatsApp.

### 1.5 Obrigações estruturais
- **ROPA** (art. 37): registro das operações — a Res. 2/2022 permite formato simplificado para pequeno porte. Uma planilha/tabela no próprio Supabase com: operação, finalidade, base legal, categorias de dados e titulares, origem, compartilhamentos (Meta, LLM, Supabase), retenção, medidas de segurança.
- **Pequeno porte** (Res. CD/ANPD 2/2022): startups e ME/EPP têm dispensa de encarregado (mas devem manter canal de comunicação), registro simplificado e prazos em dobro — **salvo se realizarem tratamento de alto risco** (larga escala combinada com dados sensíveis, menores, monitoramento sistemático, tecnologias inovadoras). Um CRM com centenas/poucos milhares de fornecedores locais não é larga escala; o uso de IA generativa e voz sintética pode ser lido como "tecnologia inovadora" **[validar com advogado]**. Recomendação: **nomear encarregado mesmo assim** (custo zero; sinal de boa-fé; a ANPD notificou 20 grandes empresas em dez/2024 exatamente por falta de encarregado/canal).
- **Incidentes** (Res. 15/2024): comunicar ANPD e titulares em **3 dias úteis** quando houver risco/dano relevante; manter registro interno de todo incidente (inclusive os não comunicados) por 5 anos. Planilha exportada para o celular pessoal de um embaixador **é** incidente.
- **Transferência internacional** (art. 33; Res. 19/2024): Supabase (região), Meta/WhatsApp, provedor de LLM e de TTS. Preferir região São Paulo no Supabase; DPA + cláusulas-padrão da ANPD nos demais.
- **Segurança** (arts. 46–47): o guia da ANPD para pequeno porte lista controle de acesso por "menos privilégio (need to know)", MFA, senhas, backups offline, criptografia em trânsito, atualização, antimalware, separação de dispositivos pessoais e NDA com colaboradores. O art. 47 estende o dever de sigilo a "qualquer outra pessoa que intervenha em uma das fases do tratamento… mesmo após o seu término" — base para a cláusula de estagiários/embaixadores.
- **Dosimetria** (Res. 4/2023): multas graduadas por gravidade, porte e faturamento; para microempresas, pisos baixos (Telekall: R$ 7.200 por infração). A multa máxima legal é 2% do faturamento, limitada a R$ 50 milhões por infração (art. 52, II).

---

## 2. Raspagem de dados (scraping): o que a lei brasileira e os termos de uso permitem

### 2.1 Camadas de risco (independentes entre si)
1. **LGPD** — se há dado pessoal (quase sempre há). Resolvido por LI + salvaguardas (§1).
2. **Direito autoral e bases de dados** (Lei 9.610/98): fotografias são obras protegidas (art. 7º, VII; art. 79); compilações/bases de dados que constituam criação intelectual também (art. 7º, XIII; art. 87); reprodução exige "autorização prévia e expressa" (art. 29). **Fatos** (nome, endereço, telefone, categoria) não são protegidos (art. 8º: "informações de uso comum"). Textos descritivos e avaliações são obras (mesmo curtas). Sanções civis: apreensão e indenização (arts. 102–103).
3. **Direito de imagem/nome** (CC arts. 18 e 20; STJ Súmula 403: indenização por uso não autorizado de imagem com fins comerciais independe de prova de prejuízo). Reproduzir a foto do fotógrafo/decoradora no app sem autorização é o cenário clássico.
4. **Marcas** (Lei 9.279/96, arts. 129–130): exibir logo sem autorização, ou sugerir parceria inexistente, é uso indevido; citar o nome para identificar o negócio é uso nominativo aceitável.
5. **Concorrência desleal** (Lei 9.279/96, art. 195) e enriquecimento sem causa — o precedente brasileiro mais citado é **Curriculum × Catho** (33ª Vara Cível de SP): extração automatizada de 436.595 currículos da base concorrente, condenação em 1ª instância noticiada em ~R$ 63 milhões por concorrência desleal, violação de direitos autorais sobre a base e enriquecimento ilícito **[confirmar desfecho recursal]**. Copiar a base inteira de um concorrente (Casamentos.com.br) para reconstruí-la é exatamente esse padrão; coletar contatos factuais para convidar fornecedores, não.
6. **Crime** (CP art. 154-A, Lei 12.737/2012 c/ Lei 14.155/2021): "invadir dispositivo informático… mediante violação indevida de mecanismo de segurança". Ler páginas públicas não é invasão; burlar login, captcha, bloqueios de IP ou usar contas falsas aproxima-se da hipótese e, no mínimo, viola contrato.
7. **Termos de uso (contrato)**: descumprir gera responsabilidade contratual/bloqueio, não crime. Os casos americanos delimitam: **hiQ × LinkedIn** (9º Circuito 2019/2022: CFAA não alcança dados públicos; mas em nov/2022 a corte distrital reconheceu que a hiQ violou o User Agreement ao usar contas falsas; acordo de dez/2022 com injunção permanente, destruição dos dados e US$ 500 mil) e **Meta × Bright Data** (N.D. Cal., 23/01/2024: raspagem **deslogada** de dados públicos não viola os termos da Meta, que só vinculam usuários logados). **X Corp × Bright Data** (2024) seguiu a mesma linha **[verificar estágio atual]**. Tradução prática: **deslogado + público + factual = zona defensável; logado/conta falsa/burla = zona de litígio.**
8. **Autoridades de proteção de dados**: a CNIL multou a **KASPR** em €240 mil (05/12/2024) por coletar contatos do LinkedIn além da expectativa razoável (perfis com visibilidade restrita), reter por 5 anos, informar tarde e não revelar a fonte. A declaração conjunta de 16 autoridades sobre scraping (out/2024; a ANPD não assinou) fixa: dado público continua protegido; scraper precisa de base legal, transparência, minimização e não pode contornar proteções técnicas; plataformas devem oferecer APIs como via controlada.

### 2.2 Matriz por fonte
| Fonte | Natureza do dado | Termos de uso / PI | Risco | O que pode | O que não pode | Alternativa lícita |
|---|---|---|---|---|---|---|
| **Casamentos.com.br** (Wedding Planner, S.L.U., Barcelona — grupo The Knot Worldwide) | Perfis de fornecedores (muitos autônomos) | Proíbe expressamente cópia via "Robot/Crawler"; reivindica PI sobre "textos, desenhos, imagens, bases de dados"; conteúdo do usuário integra a "obra composta" do site; lei espanhola e foro de Barcelona | Contratual: médio (bloqueio de IP/notificação; execução judicial improvável); PI: **alto** se copiar fotos/textos/avaliações; LGPD: baixo-médio com salvaguardas; reputacional: médio (é o concorrente direto) | Consulta **manual ou assistida em baixo volume** de dados factuais: nome, categoria, bairro, telefone/WhatsApp exibido, site/@instagram, URL do perfil | Crawler em massa; copiar fotos, descrições, faixa de preço "por extenso", avaliações e notas; recriar o catálogo | Lista manual pelos estagiários (são ~150 perfis em Natal), cruzada com CNPJ/RFB e Instagram; registrar `source_url` |
| **GetNinjas** (GETNINJAS LTDA, foro SP) | Profissionais autônomos (pessoa natural na maioria) | Cláusula 13.c(ii) proíbe "spiders, robôs, crawlers, ferramentas de captação de dados"; 13.c(i) proíbe "obter, guardar, divulgar, comercializar e/ou utilizar dados pessoais sobre outros Usuários para fins comerciais"; 19.a: PI sobre "bancos de dados" | Contratual: **alto** (lei brasileira, foro SP, cláusula específica contra uso comercial de dados de usuários); LGPD: médio (dados de PN; contato geralmente só liberado após pedido de orçamento) | Nada automatizado. Perfis públicos mostram pouco contato direto | Criar pedidos falsos de orçamento para obter contatos ("turkers" à la hiQ); scraping | Parcerias/indicação; buscar os mesmos profissionais no Instagram/Google; anúncios "seja fornecedor" |
| **Google Maps / Places** | Estabelecimentos (PJ e PN) | Termos da Google Maps Platform 3.2.3(a): "will not… copy and save business names, addresses, or user reviews"; 3.2.3(b) sem cache além dos Service Specific Terms (lat/lng 30 dias; `place_id` cacheável); ToS geral da Google veda acesso automatizado contra robots.txt | Contratual: **alto** para construir base; técnico: bloqueio de chave/conta | Usar Places API em tempo real para **enriquecer/validar** (existe? endereço? telefone?) sem persistir além de `place_id`; consulta manual pontual | Scraping do Maps (incl. via serviços terceirizados como SerpAPI/Apify), exportar reviews/fotos, guardar listas de estabelecimentos | Base **CNPJ/RFB** (dados abertos oficiais) + Places só como verificação; OpenStreetMap (ODbL) para geodados |
| **Instagram** | Perfis de negócios e criadores (muitos PN) | Termos do Instagram: proibido "collecting information in an automated way without our express permission"; fotos são obra do usuário | Contratual: alto se automatizado/logado (Meta processa scrapers); PI/imagem: **alto** se baixar fotos; LGPD: médio | Pesquisa **manual** (handle, bio, telefone comercial exibido, link); **Business Discovery API** (oficial) para contas Business/Creator: username, bio, site, seguidores — com app review | Bots de coleta, download de fotos/vídeos, uso de contas "laranja", DMs em massa | Guardar só `@handle` + link; fotos entram apenas por upload do fornecedor |
| **Base CNPJ (RFB dados abertos)** e revendas (Econodata, Casa dos Dados) | Empresas por CNAE 8230-0 etc.; MEIs (PN) | Dados abertos oficiais (LAI/Decreto de dados abertos); revendas têm licenças próprias (sem redistribuição) | LGPD: baixo-médio; **atenção: razão social de MEI traz CPF** | Filtrar CNAE/município; usar razão social, nome fantasia, telefone/e-mail cadastral, endereço | Guardar CPF; expor dados de sócios; usar e-mail cadastral (do contador) como canal de marketing sem checar | Ingestão com regex que remove CPF; marcar `is_mei`; preferir contato comercial confirmado em outra fonte |
| **Constance Zahn / blogs / listas editoriais** | Nomes de fornecedores + links | Texto editorial protegido | Baixo (só nomes/links) | Nomes, cidade, link | Copiar textos, fotos, curadoria como "ranking" | Manual |
| **Sympla / produtores de formatura (M3TA, Z2, Gideon)** | Organizadores (PJ, alguns PN) | Sympla proíbe scraping | Baixo-médio | Nome do organizador, evento, cidade, canal público | Coleta em massa de participantes/compradores (jamais) | Manual, 60 alvos |
| **Planilha existente / contatos pessoais** | Misto | — | Baixo, mas exige origem registrada | Importar com `source=manual`, responsável e data | Importar listas de terceiros sem origem (caso Telekall) | Campo obrigatório `source` + `collected_by` |

### 2.3 Regras de engenharia do scraper (requisitos)
- Só páginas públicas, sem autenticação; user-agent identificado (`KomuneBot/1.0 (+https://komune.app/bot)`), respeito a `robots.txt`, taxa ≤ 1 req/3s por domínio, sem paralelismo agressivo, sem proxies rotativos, sem burlar captcha. Se a página bloquear, **parar** — não contornar.
- Extrair somente o **esquema de campos permitidos** (whitelist); tudo o mais é descartado antes de gravar. Não persistir HTML bruto (máx. 7 dias em cache de depuração).
- Proveniência obrigatória por registro: `source`, `source_url`, `collected_at`, `collector` (bot/pessoa), `legal_basis='legitimate_interest'`, `lia_version`.
- Filtro de ingestão: remover CPF (regex de 11 dígitos em nome empresarial), e-mails pessoais óbvios quando houver alternativa comercial, qualquer campo de avaliação/comentário, fotos/URLs de imagem.
- **Deduplicação e supressão antes de gravar**: se o hash do telefone estiver na lista de supressão, o lead nasce marcado `do_not_contact`.
- Volume: limitar a lotes pequenos por dia (o próprio objetivo — 300 alvos até 18/09 — não exige mais que isso).
- Registrar a fonte também **para o titular**: a resposta a "de onde pegaram meu número?" deve sair pronta do CRM.

---

## 3. Mensageria: WhatsApp, consumidor e telemarketing

### 3.1 Regras da Meta (o "regulador" mais efetivo do canal)
- **Business Messaging Policy:** "You may only contact people on WhatsApp if: (a) they have given you their mobile phone number; and (b) you have received opt-in permission from the recipient confirming that they wish to receive subsequent messages or calls from you." Também: "Do not confuse, deceive, defraud, mislead, spam, or surprise people with your communications." Automação é permitida na janela de 24h, mas a empresa "must also have available prompt, clear, and direct escalation paths" para humano. Enforcement: "People can block or report businesses and our systems will limit the amount of messages a business can send… if the business' quality tier is low."
- **Opt-in válido** (documentação da Cloud API): deve indicar claramente que a pessoa aceita receber mensagens **da empresa nomeada** no WhatsApp; pode ser colhido por site, SMS, ligação/URA, presencialmente, em papel ou **dentro de uma conversa de WhatsApp**. Ou seja: se o fornecedor responde à Heloísa e diz "pode mandar", isso é opt-in registrável para os follow-ups.
- **Termos do WhatsApp (consumidor e Business):** proibidos "bulk messaging, auto-messaging, auto-dialing", "collect information of or about our users in any impermissible or unauthorized manner", criar contas por meios automatizados e usar software não autorizado que interaja com os serviços. Consequência: "limit, throttle, suspend, or terminate Company's account" — e, uma vez encerrada, a empresa "will not create another WhatsApp business account without our express written permission". Apps não oficiais/modificados: "Your account might also be temporarily or permanently banned."
- **Modelo comercial da API** (Cloud API): cobrança **por mensagem desde 01/07/2025**, por categoria (marketing, utilidade, autenticação, serviço); mensagens dentro da janela de atendimento de 24h são gratuitas; faturamento local no Brasil previsto para o 2º semestre de 2026. Templates de marketing são pausados quando têm baixa leitura, e a Meta aplica limites por usuário à quantidade de mensagens de marketing recebidas (frequency capping) **[verificar parâmetros vigentes na documentação]**.

### 3.2 As três arquiteturas possíveis (decisão de PRD)
| Arquitetura | Como funciona | Conformidade Meta | Risco de banimento do número | Recomendação |
|---|---|---|---|---|
| **A. Cloud API oficial + opt-in prévio** | Templates aprovados; primeiro contato só para quem deu opt-in (site "quero ser fornecedor", formulário no evento demo, ligação, presencial, Instagram DM manual) | Alta | Baixo | Usar para tudo que vem **depois** do primeiro "sim": lembretes, "complete seu cadastro", reuniões, leads |
| **B. WhatsApp Business App em máquina dedicada, envio assistido por humano** | CRM monta a mensagem personalizada; Heloísa/estagiário revisa e **clica enviar**; respostas classificadas pelo CRM; robô só sugere, não dispara | Média (mensagens não solicitadas ainda podem ser denunciadas; sem automação de envio, não viola "auto-messaging") | Médio → baixo com cadência controlada, texto pessoal, sem links encurtados, número aquecido, ≤ 30–50 novos contatos/dia | **Usar para o primeiro contato** (frio) enquanto o opt-in não existe |
| **C. Automação não oficial (whatsapp-web.js, Baileys, Evolution API etc.) disparando em massa** | Robô envia e conversa sozinho pelo número da empresa | Nenhuma (viola "auto-messaging", software não autorizado) | **Alto** — e perde-se o número verificado e o histórico; recriar conta exige permissão da Meta | **Não usar** para o número principal. Se a equipe insistir em testar, usar número descartável, nunca o verificado, e assumir a perda |

Requisitos adicionais do canal: (i) número de prospecção **separado** do número de suporte; (ii) inbox único com responsável por conversa (pedido da reunião) — que também é a "escalation path" exigida pela Meta; (iii) painel de qualidade: taxa de bloqueio/denúncia, respostas "SAIR", alerta se > 2% de bloqueios no dia → pausar campanhas; (iv) opt-in registrado como evento (`optin_channel`, `optin_text`, `timestamp`).

### 3.3 Direito do consumidor e telemarketing — o que se aplica a um contato B2B
- **CDC**: o fornecedor prospectado é, em regra, empresário, não consumidor — mas tribunais aplicam o CDC a pequenos negócios vulneráveis (finalismo mitigado) e o próprio contrato Komune–fornecedor pode ser lido como relação de consumo **[validar com advogado]**. Regras a embutir de qualquer forma: publicidade identificada como tal (art. 36); vedação de publicidade enganosa (art. 37); informação clara (art. 6º, III); vedação de práticas abusivas como prevalecer-se da fraqueza ou ignorância (art. 39, IV) e de fornecer serviço sem solicitação (art. 39, III); **a oferta vincula** (art. 30) — o que o robô prometer (taxa, prazo, "lead garantido") obriga a Komune.
- **Não existe lei federal antispam** para mensagens comerciais; há normas setoriais e estaduais: (a) **Anatel** exige o prefixo **0303** para chamadas de telemarketing ativo (Ato nº 10.413/2021) — só chamadas de voz, não mensagens; (b) o cadastro **"Não Me Perturbe"** cobre apenas teles e instituições financeiras (consignado); (c) **São Paulo**: o Código Estadual de Defesa do Consumidor (Lei 17.832/2023, que revogou a Lei 13.226/2008) mantém o cadastro de bloqueio do Procon-SP e o estende expressamente a "chamadas no telefone por meio de aplicativos", SMS e "mensagens de aplicativos associados à linha" (art. 127); empresa que contatar número cadastrado após 30 dias está sujeita a sanção do Procon-SP; janelas de horário para cobrança seg–sex 8h–20h, sáb 8h–14h, nunca feriados (art. 51) servem de referência. (d) **Rio Grande do Norte/Natal**: não localizamos cadastro estadual equivalente em vigor **[validar com advogado local]** — logo, em Natal a régua é a do LI + Meta + boa-fé; ao expandir para SP, o CRM deve **consultar o cadastro do Procon-SP** (ou simplesmente não fazer contato frio em DDDs 11–19 sem opt-in).
- **Responsabilidade civil**: contatos insistentes após "não" geram ações no JEC por dano moral (valores típicos R$ 2–10 mil) e reclamações no consumidor.gov.br; a contravenção de "perturbação da tranquilidade" (LCP art. 65) é raramente aplicada, mas existe. A régua "1 + 1 e para" elimina o risco.
- **ANPD e marketing direto**: o Guia de LI admite marketing por LI com descadastramento fácil e informação prévia. A Telekall foi punida por **vender** listas sem base legal — comprar listas de terceiros sem origem documentada é a conduta a evitar.

### 3.4 Boas práticas de opt-out, cadência e horário (requisitos)
- Palavras de saída reconhecidas: SAIR, PARAR, PARE, REMOVER, NÃO QUERO, NÃO TENHO INTERESSE, DESCADASTRAR e variações (classificador + lista); tratar bloqueio e denúncia como opt-out.
- Confirmação única de saída ("Pronto, removido. Não vamos mais escrever. Se mudar de ideia: komune.app/fornecedor") e **nenhuma** mensagem depois — nem "última chance".
- Lista de supressão: `sha256(telefone E.164)`, data, canal, motivo; consultada antes de qualquer envio e na ingestão do scraper.
- Cadência: D0 primeiro contato; D+3 follow-up único se silêncio; encerrar. Reabrir só se o fornecedor interagir, houver novo evento relevante (ex.: lead real da categoria) ou após 6 meses com nova LIA.
- Horários: seg–sex 8h–19h, sáb 9h–13h; sem domingos/feriados (nacionais, estaduais RN e municipais Natal). Fila do CRM não dispara fora da janela.
- Sem áudio no primeiro contato (surpresa + dado de voz não solicitado); áudio só depois da resposta ("tá quente"), e sempre acompanhado de texto resumido (acessibilidade e prova).
- Identificação: nome real da atendente + "Komune" + link do site; sem encurtadores; sem "URGENTE".
- Registro: cada envio guarda `template_id`, texto final, autor humano, timestamp, resposta e classificação.

---

## 4. Pré-cadastro / "reivindique seu perfil"

### 4.1 Requisitos para ser lícito e transparente
1. **Invisível ao público até o aceite**: `published=false`, `claimed=false`; RLS impede leitura por qualquer usuário que não seja admin ou o próprio fornecedor autenticado; sem sitemap/indexação; sem aparecer em buscas, contadores ("+120 fornecedores") ou vitrines; sem selo "Verificado/Parceiro"; **não recebe leads** nem aparece em pedidos de orçamento. Nada disso é negociável: publicar sem autorização = uso comercial de nome/imagem (CC art. 20; Súmula 403 STJ), potencial publicidade enganosa (CDC art. 37) e "anúncio fake" já descartado pela equipe.
2. **Conteúdo pré-preenchido = só o factual** (nome comercial, categoria/subcategoria, cidade/bairro, telefone comercial, site/@instagram). Campos em branco com placeholder "adicione suas fotos", "descreva seu serviço". Fotos e textos entram **apenas por upload do fornecedor**, com a licença do §4.3.
3. **Aviso claro antes do link**: a mensagem explica que "preparamos um rascunho com os dados públicos do seu perfil; ninguém vê até você aprovar; expira em 30 dias" — e o próprio link abre uma página com o mesmo aviso e o aviso de privacidade.
4. **Aceite expresso e destacado dos termos**: checkbox não pré-marcado; cláusula de dados pessoais, fotos e marca em destaque (LGPD art. 8º, §1º; Marco Civil art. 7º, IX); versão do termo exibida; link para PDF.
5. **Prova do consentimento** (LGPD art. 8º, §2º: "cabe ao controlador o ônus da prova"): gravar `accepted_at`, `ip`, `user_agent`, `terms_version`, `terms_hash`, `auth_method` (link mágico/OTP no mesmo WhatsApp/e-mail), `who_accepted` (nome + cargo declarado, quando PJ). Guardar pelo prazo do §D.
6. **Autenticação de quem reivindica**: OTP enviado ao telefone que originou o pré-cadastro ou e-mail do domínio/instagram confirmado; impedir que terceiros "reivindiquem" o perfil de outro (fraude e sequestro de identidade comercial). Disputas de titularidade → verificação manual (CNPJ + selfie com documento não é necessário; basta prova de controle do canal).
7. **Expiração e exclusão**: não reivindicado em 30 dias (lembrete em D+7 e D+20 apenas se houve opt-in) → apagar os dados pré-preenchidos do perfil na plataforma; manter só o lead no CRM sob a retenção do §D. Se o titular pedir exclusão antes, apagar em até 48h e confirmar.
8. **Direito de correção e "não quero perfil"**: botão "não sou/quero ser removido" na própria página do pré-cadastro, sem login.
9. **Sem uso do pré-cadastro para pressão**: mensagens do tipo "seu perfil já está no ar" são proibidas (não está); o follow-up "você ainda não completou" só após aceite.

### 4.2 Exemplos de mercado
- **Google Business Profile**: perfis não reivindicados existem publicamente com o convite "Proprietário deste estabelecimento?/Claim this business"; verificação por telefone/vídeo/correio; só depois o dono "controla como as informações aparecem". Diferença crucial: a Google se apoia em ser um índice de informação pública com escala e em dados de PJ; a Komune é um marketplace comercial regional com fornecedores pessoas naturais — por isso **não** replicar a visibilidade pública pré-reivindicação.
- **Yelp, TripAdvisor, Doctoralia** seguem o padrão "perfil criado de fontes públicas + reivindicar" — e colecionam litígios (remoção de perfil, avaliações, imagem). Doctoralia no Brasil já foi alvo de ações de profissionais que não queriam perfil **[verificar decisões recentes]**. O modelo Komune ("rascunho privado + aceite") é deliberadamente mais conservador que todos esses.
- **LinkedIn/Meta × scrapers** (KASPR, Bright Data) mostram que o que dá problema não é o pré-cadastro em si, mas coleta além da expectativa, retenção longa e falta de aviso.

### 4.3 O que o termo do fornecedor precisa cobrir (ver texto-modelo em C.5)
Licença de uso de nome comercial, marca, fotos, vídeos e textos (não exclusiva, gratuita, pelo prazo do cadastro + tempo de cache razoável); declaração de que **detém os direitos** sobre as fotos (fotógrafo contratado, cessão) e as autorizações de imagem de pessoas retratadas (noivos, convidados, crianças — atenção redobrada); dados pessoais do titular e de funcionários; uso em materiais de divulgação da Komune (banner rotativo, redes) **somente com opção separada**; revogação e efeitos; remoção em X dias após encerramento.

---

## 5. IA e voz

### 5.1 Voz da Heloísa (funcionária)
- **Natureza jurídica**: a voz integra a personalidade (CC art. 20 — "transmissão da palavra… utilização da imagem" para fins comerciais exige autorização; art. 11 — direitos intransmissíveis e irrenunciáveis, o que torna "cessão" definitiva inválida: o instrumento correto é **licença/autorização** com escopo e prazo). Gravações de voz são dados pessoais; características vocais usadas para identificar alguém são **dado biométrico** e, na LGPD, biométrico é sensível sem qualificador de finalidade (art. 5º, II). Um modelo de clonagem é derivado dessas características — tratamento conservador: **consentimento específico e destacado** (art. 11, I) **[validar com advogado]**.
- **Relação de trabalho**: consentimento de empregado é frágil (desequilíbrio de poder). A jurisprudência trabalhista reconhece indenização por uso de imagem do empregado em campanhas sem autorização específica. Mitigações: termo aditivo ao contrato, específico, com finalidades listadas, prazo, contrapartida (mesmo simbólica) ou registro de gratuidade, direito de revogar sem retaliação, regra de **pós-desligamento** (uso cessa em até 30 dias; áudios já enviados não precisam ser apagados, mas não se geram novos), nada de uso em outros produtos sem novo aceite.
- **Áudio real pré-gravado × voz sintética**: áudios gravados pela própria Heloísa (banco de 20–30 mensagens curtas, escolhidas pelo CRM conforme a etapa) resolvem 90% do objetivo ("quebrar a barreira de tecnologia") com risco mínimo — são a voz dela de fato. Voz clonada (TTS) acrescenta: consentimento sensível, risco de deepfake se o modelo vazar (guardar o modelo em cofre, acesso restrito, nunca em provedor sem contrato), e dever de **transparência** de que o áudio é sintético.
- **Transparência sobre automação**: a política da Meta exige caminho de escalonamento humano; o CDC exige informação clara e publicidade identificável; o Guia de LI da ANPD condiciona o LI à boa-fé e à expectativa do titular; e o **PL 2338/2023** (aprovado no Senado em 10/12/2024, remetido à Câmara em 17/03/2025, Comissão Especial constituída em 29/04/2025, audiências em maio/2025; em **02/09/2026 constava "Aguardando Parecer"**, com PLs apensados — **não é lei**) prevê, no texto do Senado, direito à informação prévia de que se interage com IA, identificação de conteúdo sintético e sanções semelhantes às da LGPD **[acompanhar]**. Sinais convergentes: TSE (Res. 23.732/2024) proíbe deepfakes e exige rotular conteúdo sintético em campanhas; Lei 15.123/2025 agrava pena para violência psicológica com uso de IA. Conclusão de produto: **quem conversa com o robô deve poder saber que há automação e alcançar um humano em uma resposta**, sem que isso precise virar "cara de robô".
- **Regra recomendada (equilíbrio com "pessoalidade")**: (1) primeiro contato escrito e enviado por humano, assinado por Heloísa → sem disclosure necessário; (2) quando o robô assume respostas, o rodapé/uma frase natural informa: "parte das respostas aqui é automática — se preferir falar comigo, escreva HUMANO"; (3) áudio real: nada a declarar; (4) áudio sintético: "áudio gerado com a voz da Heloísa por IA" no texto que acompanha; (5) o robô nunca afirma ser humano se perguntado.
- **Guardrails do robô**: base de respostas aprovadas (taxa 8%, 3%+5% com cerimonialista, Pix absorvido, sem mensalidade); proibido inventar garantias/seguro ("até R$ 100 mil" está em avaliação — não prometer); qualquer pergunta sobre preço fora do script, contrato, exclusividade ou reclamação → humano; log integral; revisão semanal de 20 conversas; sem coleta de dados sensíveis; sem persuasão agressiva ("última chance").
- **"IA secretária" interna (cobrança de metas)**: monitorar tarefas da equipe é LI do empregador, mas o Guia da ANPD (Ex. 7) rejeita rastreamento que "contraria a sua legítima expectativa, mesmo que… previamente informada". Limitar a métricas de tarefas/CRM; sem geolocalização contínua, leitura de mensagens pessoais ou ranking público humilhante; informar a equipe por escrito.

### 5.2 LLM/TTS como operadores
Contrato (DPA) com o provedor; sem retenção para treinamento (opção zero-retention quando existir); enviar ao modelo apenas o necessário (nome comercial, etapa, últimas mensagens), nunca telefone/CPF/e-mail se evitável (pseudonimizar `lead_id`); registrar no ROPA; transferência internacional via cláusulas-padrão (Res. 19/2024).

---

## 6. Governança e acesso interno

- **Encarregado (DPO)**: nomear (Luiz ou Dennis) e publicar nome/e-mail no site e no aviso de privacidade (Res. 18/2024), ainda que a Res. 2/2022 dispense — a ANPD fiscaliza exatamente a existência do canal. Função: receber pedidos de titulares, manter ROPA/LIA, coordenar incidentes.
- **Documentos mínimos**: (1) Aviso de privacidade específico da prospecção (página pública curta, link na 1ª mensagem); (2) Política de privacidade da plataforma atualizada com "origem: pré-cadastro"; (3) Termo do fornecedor com cláusula de dados/fotos; (4) Termo de licença de voz (Heloísa); (5) Termo de confidencialidade e uso de dados para estagiários e embaixadores; (6) ROPA + LIA + RIPD simplificado; (7) Plano de resposta a incidentes (1 página); (8) Política de retenção (§D) implementada em jobs.
- **Acesso por papel (RBAC) no Supabase** — perfis: `admin` (Rafael/Luiz), `sales_lead` (Bárbara), `sdr` (Heloísa/estagiários: veem só sua carteira e cidade), `ambassador` (só leads que indicou e status; sem telefone completo, sem exportação), `bot` (service role restrito por RLS), `finance` (sem dados de prospecção). Regras: MFA obrigatório; sem exportação CSV para `sdr`/`ambassador`; máscara de telefone na listagem (exibe ao abrir o card, com log); bloqueio de copiar em massa (paginação + rate limit na API); sessão em máquina dedicada com disco criptografado; celulares pessoais só via app com login e sem cache.
- **Logs**: quem viu/editou/exportou/enviou o quê e quando (retenção 12 meses; Marco Civil art. 15 exige 6 meses para registros de acesso a aplicações). Alertas de acesso anômalo (ex.: > 200 cards abertos/dia).
- **Onboarding/offboarding**: treinamento de 30 min (o que pode/não pode coletar, como responder "SAIR", incidente = avisar em 1h); revogação de acesso no mesmo dia da saída; embaixadores comissionados assinam termo e só recebem link de indicação, não a base.
- **Fornecedores/operadores externos** (Supabase, Meta, LLM, TTS, Econodata): DPA assinado, região de dados, subprocessadores, prazo de exclusão; lista no ROPA.
- **Métricas de compliance no dashboard semanal (segunda, 8h)**: opt-outs, bloqueios/denúncias, pedidos de titulares e SLA, pré-cadastros expirados/apagados, leads sem `source`, incidentes.

---

## A. Mapa de riscos

Escala: Probabilidade (B/M/A) × Impacto (B/M/A). "Mitigação embutida" = requisito de produto, não promessa de processo.

| # | Risco | Prob. | Impacto | Mitigação embutida no produto | Dono |
|---|---|---|---|---|---|
| R1 | Banimento do número verificado por automação não oficial/spam (Meta) | A (se arquitetura C) / M (B) | A | Arquitetura A+B; envio assistido no frio; API oficial com opt-in no follow-up; cadência 1+1; painel de bloqueios com pausa automática; número de prospecção ≠ suporte | Luiz |
| R2 | Reclamação de fornecedor à ANPD/Procon/consumidor.gov por contato indesejado ou "de onde pegaram meu número" | M | M | 1ª mensagem com identificação, origem, finalidade e SAIR; resposta de origem automática (`source_url`); encarregado publicado; SLA 48h | Encarregado |
| R3 | Ação por dano moral (JEC) por insistência | B–M | B–M | Supressão imediata; bloqueio técnico de novo envio a `do_not_contact`; janela de horário | Bárbara |
| R4 | Uso de fotos/textos/logos sem autorização (Lei 9.610; CC 20; Súmula 403) | M (se scraper copiar mídia) | A | Whitelist de campos no scraper; fotos só por upload do fornecedor com licença; sem exibição de logos pré-aceite | Matheus |
| R5 | Perfil pré-cadastrado visível ao público ("anúncio fake") | B | A | `published=false` + RLS + testes automatizados que falham se perfil não reivindicado for acessível; sem indexação; sem leads | Matheus |
| R6 | Violação de termos de uso das fontes (Casamentos, GetNinjas, Google, Instagram) → bloqueio de IP/conta, notificação, ação por concorrência desleal | A (ocorrer) | M | Sem login/contas falsas; baixo volume; dados factuais; sem redistribuição; Google só via Places em tempo real; Instagram via API oficial/manual; registro de `source` | Luiz |
| R7 | Robô promete condição errada (oferta vincula, CDC art. 30) ou inventa garantia | M | M | Respostas aprovadas; assuntos sensíveis → humano; logs; revisão semanal | Bárbara |
| R8 | Voz clonada sem consentimento válido / uso após desligamento / vazamento do modelo | B–M | A | Termo específico com prazo e revogação; preferir áudios reais; modelo em cofre; job que desativa TTS na saída da funcionária | Rafael/Dennis |
| R9 | Pessoa acredita conversar com humano quando é robô (boa-fé, CDC, PL 2338) | A | M | Frase de transparência quando o robô assume; "HUMANO" sempre funciona; robô nunca nega ser automação | Bárbara |
| R10 | Vazamento por estagiário/embaixador (planilha, print, celular pessoal) → incidente art. 48 | M | M–A | RBAC, sem exportação, máscara de telefone, logs, termo assinado, offboarding no dia | Luiz |
| R11 | Transferência internacional sem base (Supabase fora do BR, LLM, Meta) | A (se ignorado) | B–M | Região São Paulo; DPAs; cláusulas-padrão; pseudonimização ao LLM | Luiz |
| R12 | Coleta de dados indevidos (CPF de MEI, avaliações com dados de clientes, fotos com pessoas) | M | M | Filtros de ingestão; campos proibidos; auditoria mensal de amostra | Matheus |
| R13 | Retenção indefinida de prospects (padrão KASPR) | A (se ignorado) | M | TTLs automáticos (§D); relatório de expurgo | Matheus |
| R14 | "IA secretária" vira vigilância de funcionários além da expectativa | M | B–M | Só métricas de tarefas; comunicação escrita; sem geolocalização/mensagens pessoais | Rafael |
| R15 | Expansão para SP sem consultar cadastro do Procon-SP (Lei 17.832/2023, art. 127) | M (na expansão) | M | Regra por DDD: sem contato frio em SP sem opt-in ou consulta ao cadastro | Bárbara |
| R16 | Compra/importação de listas de terceiros sem origem (padrão Telekall) | B | M | `source` obrigatório; importação exige contrato/licença anexada | Encarregado |

---

## B. Checklist de requisitos legais por módulo

### B.1 Scraper / ingestão (SCR)
- [ ] SCR-01 Whitelist de campos: nome comercial, categoria, cidade/bairro, telefone comercial, site, @instagram, `source_url`. Todo o resto descartado.
- [ ] SCR-02 Proibido persistir: fotos/URLs de imagem, textos descritivos, avaliações, notas, preços de terceiros, CPF, e-mails pessoais quando houver comercial, dados de clientes dos fornecedores.
- [ ] SCR-03 Sem autenticação, sem contas, sem burla de captcha/bloqueio/robots.txt; UA identificado; ≤ 1 req/3s; sem proxies rotativos.
- [ ] SCR-04 Google Maps: apenas Places API em tempo real; persistir só `place_id`; nada de scraping direto ou via terceiros.
- [ ] SCR-05 Instagram: apenas manual ou Business Discovery API; guardar só handle + link.
- [ ] SCR-06 GetNinjas: sem coleta automatizada e sem pedidos falsos de orçamento.
- [ ] SCR-07 Casamentos.com.br: coleta manual/assistida em baixo volume de dados factuais; nunca mídia/textos/avaliações.
- [ ] SCR-08 Proveniência obrigatória: `source`, `source_url`, `collected_at`, `collector`, `legal_basis`, `lia_version`.
- [ ] SCR-09 Consulta à lista de supressão e deduplicação antes de gravar.
- [ ] SCR-10 Flag `is_natural_person` (MEI/EI/autônomo); regex remove CPF.
- [ ] SCR-11 HTML bruto não persistido (cache ≤ 7 dias).
- [ ] SCR-12 LIA e ROPA da operação "prospecção" versionados no repositório.

### B.2 WhatsApp / mensageria (WA)
- [ ] WA-01 Primeiro contato frio só por envio assistido por humano (arquitetura B); nenhum disparo automático para número sem opt-in.
- [ ] WA-02 Cloud API oficial para mensagens iniciadas pela empresa após opt-in; templates aprovados; categoria correta.
- [ ] WA-03 Template do 1º contato contém: nome da atendente, "Komune", finalidade, origem do contato, link do aviso de privacidade, "responda SAIR".
- [ ] WA-04 Classificador de opt-out (palavras + bloqueio/denúncia) → supressão em < 5 min + confirmação única; bloqueio técnico de reenvio.
- [ ] WA-05 Cadência 1 + 1 (D0, D+3); reabertura só por interação ou após 6 meses com nova LIA.
- [ ] WA-06 Janela de envio seg–sex 8h–19h, sáb 9h–13h; calendário de feriados RN/Natal; fila respeita fuso.
- [ ] WA-07 Registro de opt-in (`optin_channel`, texto, timestamp) e de cada envio (template, texto final, autor, resposta, classificação).
- [ ] WA-08 Inbox com responsável por conversa; "HUMANO" transfere em ≤ 1 resposta; escalonamento visível.
- [ ] WA-09 Painel de qualidade: bloqueios/denúncias/SAIR por dia; pausa automática em > 2% bloqueios.
- [ ] WA-10 Resposta pronta a "de onde pegaram meu número?" com a fonte específica.
- [ ] WA-11 Número de prospecção separado do de suporte; nenhum uso de biblioteca não oficial no número verificado.
- [ ] WA-12 Regra por DDD para SP (cadastro Procon-SP) e outros estados com cadastro ao expandir.
- [ ] WA-13 Sem áudio no primeiro contato; áudio sempre com texto-resumo.

### B.3 Pré-cadastro / claim (PRE)
- [ ] PRE-01 `published=false` e `claimed=false` por padrão; RLS: leitura só admin e próprio titular; teste automatizado de não exposição.
- [ ] PRE-02 Sem indexação, busca, contadores, vitrines, selos ou leads para perfis não reivindicados.
- [ ] PRE-03 Pré-preenchimento restrito a dados factuais; fotos/textos só por upload do fornecedor.
- [ ] PRE-04 Aviso de pré-cadastro na mensagem e na página de destino; link do aviso de privacidade.
- [ ] PRE-05 Autenticação do reivindicante por OTP no canal de origem; fluxo de disputa de titularidade.
- [ ] PRE-06 Aceite expresso: checkbox não pré-marcado; cláusulas de dados/fotos/marca em destaque; versão e hash do termo exibidos.
- [ ] PRE-07 Registro de aceite: `accepted_at`, `ip`, `user_agent`, `terms_version`, `terms_hash`, `auth_method`, `who_accepted`.
- [ ] PRE-08 Expiração em 30 dias → job apaga dados pré-preenchidos; lembretes só com opt-in.
- [ ] PRE-09 Botão "não quero perfil / remover" sem login; exclusão em ≤ 48h com confirmação.
- [ ] PRE-10 Opção separada (não obrigatória) para uso em divulgação da Komune (banner/redes).
- [ ] PRE-11 Fornecedor declara titularidade de direitos sobre fotos e autorizações de imagem de pessoas retratadas; alerta específico para fotos com crianças.
- [ ] PRE-12 Correção/edição de todos os campos pré-preenchidos antes de publicar.

### B.4 IA / voz (IA)
- [ ] IA-01 Termo de licença de voz/imagem da Heloísa assinado antes de gravar; versão para áudio real e adendo para voz sintética (consentimento destacado).
- [ ] IA-02 Banco de áudios reais como padrão; TTS só com aviso "áudio gerado por IA com a voz de…".
- [ ] IA-03 Modelo de voz armazenado em cofre com acesso nomeado; job de desativação na saída da funcionária; cláusula pós-desligamento.
- [ ] IA-04 Frase de transparência quando o robô assume a conversa; robô nunca nega ser automação; "HUMANO" funciona sempre.
- [ ] IA-05 Base de respostas aprovadas (taxa, condições); temas sensíveis (preço fora do script, contrato, reclamação, garantia) → humano.
- [ ] IA-06 Pseudonimização do que vai ao LLM; DPA/zero-retention; sem dados sensíveis.
- [ ] IA-07 Logs integrais e revisão semanal de amostra; registro de prompts/versões.
- [ ] IA-08 "IA secretária" restrita a métricas de tarefas; comunicação escrita à equipe.

### B.5 Acesso interno e governança (ACC/GOV)
- [ ] ACC-01 RBAC com perfis admin/sales_lead/sdr/ambassador/bot/finance; RLS por carteira e cidade.
- [ ] ACC-02 MFA obrigatório; sem exportação para sdr/ambassador; máscara de telefone com log de revelação; rate limit anti-cópia.
- [ ] ACC-03 Logs de acesso/edição/exportação/envio por 12 meses; alertas de anomalia.
- [ ] ACC-04 Termo de confidencialidade e uso de dados assinado por estagiários, embaixadores e prestadores antes do acesso; revogação no dia da saída.
- [ ] ACC-05 Máquina dedicada com disco criptografado; celulares só com app autenticado.
- [ ] GOV-01 Encarregado nomeado e publicado; canal de titulares; SLA 48h/15 dias.
- [ ] GOV-02 Aviso de privacidade da prospecção publicado; política da plataforma atualizada ("origem: pré-cadastro").
- [ ] GOV-03 ROPA + LIA + RIPD simplificado versionados; revisão trimestral.
- [ ] GOV-04 Plano de incidentes (detecção → avaliação → ANPD/titulares em 3 dias úteis → registro 5 anos).
- [ ] GOV-05 Supabase em região São Paulo; DPAs com Meta, LLM, TTS, Econodata; lista de subprocessadores.
- [ ] GOV-06 Jobs de retenção (§D) com relatório mensal de expurgo.
- [ ] GOV-07 Métricas de compliance no relatório semanal de growth.

---

## C. Textos-modelo (pt-BR)

### C.1 Primeira mensagem (texto, enviada por humano)
> Oi, [Nome]! Tudo bem? Aqui é a Heloísa, da Komune — um app de eventos de Natal que conecta quem organiza festas a fornecedores daqui.
> Encontrei o contato de [Nome comercial] no [Casamentos.com.br / Instagram / Google] e queria te convidar para conhecer a plataforma: sem mensalidade, você só paga uma taxa quando fecha um evento.
> Posso te mostrar em 15 minutos por vídeo, ou passar aí em [bairro] esta semana?
> Se não quiser receber mais mensagens nossas, é só responder SAIR. Como usamos seus dados: komune.app/privacidade-prospeccao

### C.2 Follow-up único (D+3)
> Oi, [Nome], só passando para deixar o convite em aberto. Se fizer sentido, me diga o melhor horário para uma conversa rápida; se não, sem problema — respondendo SAIR eu não te escrevo mais. Abraço, Heloísa (Komune).

### C.3 Resposta a "quem te deu meu número?" / pedido de origem
> Justo perguntar! Seu contato estava público em [fonte específica + link]. A Komune usa dados de contato profissional públicos só para convidar fornecedores da região, com base no legítimo interesse previsto na LGPD (art. 7º, IX), e não repassa a ninguém. Você pode pedir a exclusão a qualquer momento (basta responder SAIR) ou falar com nossa encarregada de dados: privacidade@komune.app.

### C.4 Aviso de pré-cadastro (WhatsApp + página do link)
> [Nome], para facilitar, preparei um rascunho do perfil de [Nome comercial] na Komune com informações públicas (nome, categoria, bairro e contato). **Ninguém vê esse rascunho além de você** — ele só entra no ar se você revisar, adicionar suas fotos e aceitar os termos. Se você não quiser, ele é apagado automaticamente em 30 dias (ou na hora, se pedir). Link para revisar: [link]. Dúvidas sobre dados: komune.app/privacidade

Página de destino (cabeçalho): "Rascunho privado — não publicado. Criado em [data] a partir de dados públicos ([fonte]). Expira em [data]. [Revisar e publicar] [Não quero perfil — remover agora]".

### C.5 Cláusula de autorização de uso de dados, fotos e marca (Termo do Fornecedor — em destaque)
> **Dados, imagens e marca.** Ao publicar seu perfil, você autoriza a KOMUNE LTDA (CNPJ […]) a exibir, no app e no site da Komune, o nome comercial, marca, fotos, vídeos e textos que você enviar, bem como os dados de contato que escolher tornar visíveis, pelo tempo em que o perfil estiver ativo. Essa licença é não exclusiva, gratuita e pode ser revogada a qualquer momento pela exclusão do conteúdo ou do perfil; após a revogação, retiraremos o conteúdo em até 10 dias (cópias em cache podem persistir por prazo técnico razoável).
> Você declara que é titular dos direitos sobre as fotos, vídeos e textos enviados (ou tem licença do fotógrafo/autor) e que obteve autorização das pessoas retratadas — em especial, dos responsáveis por crianças e adolescentes. Você é responsável por conteúdo enviado sem essas autorizações.
> ☐ (opcional) Autorizo o uso do meu nome comercial, marca e fotos em materiais de divulgação da Komune (banners, redes sociais), podendo revogar a qualquer momento.
> Tratamos seus dados pessoais (e os de seus colaboradores informados no cadastro) para operar o marketplace, conforme a Política de Privacidade [link]. Dados obtidos de fontes públicas no pré-cadastro foram apresentados apenas a você e ficam sob seu controle.
> Encarregado(a) de dados: [nome] — privacidade@komune.app.

### C.6 Resposta a pedido de exclusão/oposição
> Pronto, [Nome]: removemos seus dados de contato da nossa base de prospecção e cancelamos qualquer mensagem futura. Guardamos apenas um registro mínimo (identificador do número + data) para garantir que não voltemos a te procurar, como a LGPD exige que respeitemos sua oposição. Se houver um rascunho de perfil, ele também foi apagado. Se precisar de comprovante ou tiver outra solicitação, fale com nossa encarregada de dados: privacidade@komune.app. Obrigada pelo retorno.

### C.7 Frase de transparência quando o robô assume
> (Parte das respostas aqui é automática para agilizar; se preferir falar direto comigo, é só escrever HUMANO.) — Heloísa

Para áudio sintético: "Áudio gerado por IA com a voz da Heloísa, autorizado por ela."

### C.8 Termo de licença de uso de voz e imagem (funcionária) — pontos essenciais
Finalidades listadas (mensagens de prospecção e atendimento da Komune por WhatsApp; materiais internos); modalidades (gravações reais; **adendo separado** para modelo sintético, com consentimento específico e destacado para tratamento de dados biométricos); prazo (vigência do contrato de trabalho + 30 dias para uso de novos áudios); revogação a qualquer tempo, sem retaliação, com efeitos prospectivos; contrapartida (valor mensal ou registro expresso de gratuidade); vedação de uso em outros produtos, terceiros ou conteúdo que não reflita falas aprovadas por ela; custódia do modelo (cofre, acesso nomeado, exclusão na revogação); direito de ouvir/aprovar o banco de áudios e o script do TTS.

### C.9 Cláusula para estagiários, embaixadores e prestadores
> Você terá acesso a dados pessoais de fornecedores e produtores exclusivamente para as tarefas designadas no CRM da Komune. É proibido copiar, exportar, fotografar, compartilhar ou usar esses dados para qualquer outra finalidade, inclusive contato particular, durante e após o vínculo (LGPD art. 47). Todo acesso é registrado. Incidentes (perda de dispositivo, envio indevido, acesso não autorizado) devem ser comunicados à Komune em até 1 hora. O descumprimento gera responsabilidade civil e desligamento imediato.

### C.10 Aviso de privacidade da prospecção (página pública, versão curta)
Quem somos (KOMUNE LTDA, CNPJ, endereço); o que coletamos (nome comercial, categoria, cidade, contato profissional, link de origem); de onde (fontes públicas nomeadas + indicações); para quê (convidar fornecedores/produtores para a plataforma e agendar apresentação); base legal (legítimo interesse — art. 7º, IX; dados públicos — art. 7º, §§3º/4º); com quem compartilhamos (Meta/WhatsApp, provedor de nuvem, provedor de IA — sem venda de dados); por quanto tempo (§D); seus direitos e como exercer (SAIR, e-mail do encarregado, prazo de resposta); automação (parte das mensagens é assistida por sistema; sempre há um humano disponível); data/versão.

---

## D. Política de retenção (a implementar como jobs automáticos)

| Categoria | Gatilho | Prazo | Ação | Fundamento |
|---|---|---|---|---|
| Lead coletado, nunca contatado | Ingestão | 90 dias | Excluir ou recoletar | Necessidade/minimização (art. 6º, III); guia LI |
| Lead contatado sem resposta | Último contato | 6 meses | Anonimizar (manter só categoria/cidade para métricas) | Evitar retenção indefinida (caso KASPR) |
| Lead com "não" explícito / opt-out | Pedido | Imediato | Apagar dados; manter hash do telefone + data na supressão (indefinido) | Art. 18, §2º; honrar oposição |
| Lead em conversa/interessado | Última interação | 12 meses de inatividade | Anonimizar | Necessidade |
| Pré-cadastro não reivindicado | Criação | 30 dias | Apagar dados pré-preenchidos do perfil (lead segue regra própria) | Transparência/expectativa; §4 |
| Registro de aceite dos termos | Encerramento do perfil | 5 anos após | Excluir | Ônus da prova (art. 8º, §2º); prazos prescricionais (CDC art. 27; CC art. 206) **[validar]** |
| Fornecedor ativo (perfil publicado) | Vigência | Enquanto ativo + 5 anos para dados contratuais/fiscais | Excluir o restante em 30 dias após encerramento | Contrato/obrigação legal |
| Conversas de WhatsApp (prospecção) | Última mensagem | 12 meses (resumo estruturado depois) | Apagar texto/áudio integral | Necessidade; art. 15 Marco Civil (6 meses para logs de acesso) |
| Logs de acesso/auditoria do CRM | Evento | 12 meses | Excluir | Segurança (art. 46); Marco Civil art. 15 |
| Registros de incidentes | Encerramento do incidente | 5 anos | Excluir | Res. CD/ANPD 15/2024 |
| HTML/raw do scraper | Coleta | 7 dias | Excluir | Minimização |
| Áudios reais da funcionária | Revogação/desligamento + 30 dias | — | Parar uso; manter enviados no histórico das conversas até a regra de conversas | Licença de uso |
| Modelo de voz sintética | Revogação/desligamento | Imediato | Destruir | Consentimento; art. 16 |
| Dados enviados ao LLM/TTS | Cada chamada | Zero-retention ou ≤ 30 dias no provedor | Contrato | Res. 19/2024; operador |
| ROPA/LIA/RIPD | Alteração da operação | Vigente + 5 anos das versões | Arquivar | Responsabilização (art. 6º, X) |

---

## E. Perguntas abertas para validação jurídica
1. Cadastro estadual/municipal de bloqueio de telemarketing em RN/Natal: existe e cobre apps?
2. Classificação do modelo de voz sintética como dado biométrico sensível (art. 5º, II) e forma do consentimento.
3. Aplicação do CDC à relação Komune–fornecedor (finalismo mitigado) e efeitos sobre o robô (art. 30).
4. Enquadramento de "tecnologia inovadora" (IA/voz) na Res. 2/2022 — mantém-se a condição de pequeno porte?
5. Exposição contratual perante Wedding Planner S.L.U. (lei espanhola/foro Barcelona) para coleta manual de dados factuais.
6. Desfecho recursal de Curriculum × Catho e existência de precedentes recentes do TJSP/TJRN sobre scraping.
7. Estado atual do PL 2338/2023 e de projetos apensados sobre rotulagem de conteúdo sintético e uso de voz.

---

## F. Fontes (URLs consultadas em 03/09/2026)

**LGPD, ANPD e regulamentos**
- LGPD (Lei 13.709/2018), texto compilado: https://www.planalto.gov.br/ccivil_03/_ato2015-2018/2018/lei/l13709.htm
- ANPD — Guia Orientativo: Hipóteses legais de tratamento — Legítimo Interesse (fev/2024): https://www.gov.br/anpd/pt-br/centrais-de-conteudo/materiais-educativos-e-publicacoes/guia_legitimo_interesse.pdf/@@display-file/file
- ANPD — notícia de lançamento do guia: https://www.gov.br/anpd/pt-br/assuntos/noticias/anpd-lanca-guia-orientativo-sobre-legitimo-interesse
- Data Privacy Brasil — síntese do guia: https://www.dataprivacybr.org/guia-do-legitimo-interesse-orientacoes-da-anpd/
- ANPD — primeira multa (Telekall Infoservice): https://www.gov.br/anpd/pt-br/assuntos/noticias/anpd-aplica-a-primeira-multa-por-descumprimento-a-lgpd
- Campos Thomaz — caso Telekall: https://camposthomaz.com/conhecimento-ct/caso-telekall-infoservice-saiba-mais-sobre-a-primeira-aplicacao-de-sancao-pela-anpd/
- Conjur — Helio Moraes sobre a multa por venda de base de dados: https://www.conjur.com.br/2023-jul-18/helio-moraes-multa-anpd-vendas-base-dados/
- Confidata — Mapa de sanções da ANPD até 2026: https://confidata.com.br/blog/mapa-sancoes-anpd-todos-casos-2026
- Confidata — Fiscalização temática 2025–2026 e Mapa 2026–2027: https://confidata.com.br/blog/fiscalizacao-tematica-anpd-2025-2026
- Agência Lupa (28/05/2026) — ANPD abriu só um processo em 2026: https://www.agencialupa.org/noticias/2026/05/28/responsavel-por-fiscalizar-redes-anpd-abriu-so-um-processo-em-2026/
- DPOnet — ANPD 2026 e fiscalização de encarregados: https://dponet.com.br/blog/anpd-2026-fiscalizacao-lgpd-empresas-sancoes/
- Grant Thornton — Raspagem de dados como prioridade da ANPD: https://www.grantthornton.com.br/insights/artigos-e-publicacoes/raspagem-de-dados-entenda-a-nova-prioridade-da-anpd-e-seus-efeitos/
- ANPD — Guia de Segurança da Informação para agentes de pequeno porte: https://www.gov.br/anpd/pt-br/documentos-e-publicacoes/guia-vf.pdf
- Resolução CD/ANPD nº 2/2022 (pequeno porte): https://www.in.gov.br/en/web/dou/-/resolucao-cd/anpd-n-2-de-27-de-janeiro-de-2022-376562019
- Resolução CD/ANPD nº 15/2024 (incidentes): https://www.in.gov.br/en/web/dou/-/resolucao-cd/anpd-n-15-de-24-de-abril-de-2024-556243024
- Resoluções CD/ANPD nº 4/2023 (dosimetria), nº 18/2024 (encarregado) e nº 19/2024 (transferência internacional): https://www.gov.br/anpd/pt-br/documentos-e-publicacoes (índice; textos no DOU) — não acessadas diretamente nesta pesquisa.

**Scraping, PI e precedentes**
- Casamentos.com.br — Condições Legais: https://www.casamentos.com.br/condicoes-legais-br.php
- GetNinjas — Termos de Uso: https://www.getninjas.com.br/termos-de-uso
- Google Maps Platform Terms (3.2.3 No Scraping/No Caching): https://cloud.google.com/maps-platform/terms
- Google Maps Platform Service Specific Terms (cache de Places/Geocoding): https://cloud.google.com/maps-platform/terms/maps-service-terms
- Instagram — Termos de Uso: https://help.instagram.com/581066165581870 (texto não carregou via fetch; cláusula citada de conhecimento prévio)
- Instagram Business Discovery API: https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/ig-user/business_discovery
- Lei 9.610/1998 (direitos autorais): https://www.planalto.gov.br/ccivil_03/leis/l9610.htm
- Código Civil (arts. 11, 12, 18, 20, 21): https://www.planalto.gov.br/ccivil_03/leis/2002/l10406compilada.htm
- Marco Civil da Internet (Lei 12.965/2014): https://www.planalto.gov.br/ccivil_03/_ato2011-2014/2014/lei/l12965.htm
- Migalhas — scraping nos tribunais brasileiros e americanos (caso Curriculum × Catho): https://www.migalhas.com.br/depeso/152061/tecnologia-da-nova-era--tribunais-brasileiros-e-americanos---scraping--a-superficie-das-fronteiras-legais-do-uso-da-internet
- Migalhas — Os desafios jurídicos do web scraping: https://www.migalhas.com.br/coluna/dados-publicos/378258/os-desafios-juridicos-do-web-scraping
- Souto Correa — Raspagem de dados sob a LGPD e o RGPD: https://www.soutocorrea.com.br/artigos/voce-e-um-robo-a-raspagem-de-dados-sob-a-otica-da-lgpd-e-do-rgpd/
- Farella — Meta v. Bright Data: https://www.fbm.com/publications/major-decision-affects-law-of-scraping-and-online-data-collection-meta-platforms-v-bright-data/
- Eric Goldman blog — Bright Data v. Meta: https://blog.ericgoldman.org/archives/2024/01/game-on-bright-data-scores-major-victory-in-web-scraping-dispute-with-meta-guest-blog-post.htm
- Lection — hiQ v. LinkedIn explicado (acordo de 2022): https://www.lection.app/blogs/hiq-labs-vs-linkedin-case-explained
- CNIL — KASPR multada em €240.000: https://www.cnil.fr/en/data-scraping-kaspr-fined-eu240000
- EDPB — nota sobre a decisão KASPR: https://www.edpb.europa.eu/news/news/2025/data-scraping-french-supervisory-authority-fined-kaspr-eu240-000_en
- CNIL — prospecção comercial B2B por meio eletrônico: https://www.cnil.fr/fr/la-prospection-commerciale-par-courrier-electronique
- Declaração conjunta de autoridades sobre data scraping (out/2024): https://www.priv.gc.ca/en/opc-news/speeches-and-statements/2024/js-dc_20241028/
- Receita Federal — dados abertos CNPJ: https://dadosabertos.rfb.gov.br/CNPJ/ (não acessível via fetch nesta sessão)

**Mensageria e consumidor**
- WhatsApp Business Messaging Policy: https://whatsappbusiness.com/policy/ (redirecionado de https://business.whatsapp.com/policy)
- WhatsApp Business Terms of Service: https://www.whatsapp.com/legal/business-terms/
- WhatsApp Terms of Service (uso aceitável): https://www.whatsapp.com/legal/terms-of-service
- Meta — obtenção de opt-in (Cloud API): https://developers.facebook.com/docs/whatsapp/overview/getting-opt-in
- Meta — preços da WhatsApp Business Platform (por mensagem desde 01/07/2025): https://developers.facebook.com/docs/whatsapp/pricing
- Meta — templates de mensagem / limites de marketing: https://developers.facebook.com/docs/whatsapp/cloud-api/guides/send-message-templates (não carregou — 429)
- WhatsApp — apps não oficiais e banimento: https://faq.whatsapp.com/1217634902127718
- Código de Defesa do Consumidor (Lei 8.078/1990): https://www.planalto.gov.br/ccivil_03/leis/l8078compilado.htm
- Lei estadual SP 17.832/2023 (Código Estadual de Defesa do Consumidor; art. 127 — cadastro de bloqueio, inclui apps): https://www.al.sp.gov.br/repositorio/legislacao/lei/2023/lei-17832-01.11.2023.html
- Lei estadual SP 13.226/2008 (revogada pela 17.832/2023): https://www.al.sp.gov.br/repositorio/legislacao/lei/2008/lei-13226-07.10.2008.html
- Não Me Perturbe (Anatel/teles e financeiras): https://www.naomeperturbe.com.br/
- Anatel — prefixo 0303 (Ato nº 10.413/2021): https://www.gov.br/anatel/pt-br (página específica não acessível nesta sessão)

**IA e voz**
- Senado — PL 2338/2023, tramitação (aprovado 10/12/2024; remetido à Câmara 17/03/2025): https://www25.senado.leg.br/web/atividade/materias/-/materia/157233
- Câmara — Dados Abertos, situação do PL 2338/2023 em 02/09/2026 ("Aguardando Parecer"): https://dadosabertos.camara.leg.br/api/v2/proposicoes/2487262 e https://dadosabertos.camara.leg.br/api/v2/proposicoes/2487262/tramitacoes
- Câmara — inteiro teor do PL 2338/2023: https://www.camara.leg.br/proposicoesWeb/prop_mostrarintegra?codteor=2868197 (não carregou — 429)

**Exemplos de mercado**
- Google — Reivindicar Perfil da Empresa: https://support.google.com/business/answer/2911778
- SocialHub — LGPD e WhatsApp marketing 2026 (visão de mercado): https://www.socialhub.pro/blog/lgpd-whatsapp-marketing-2026-compliance/

*Fontes citadas de conhecimento prévio e não reacessadas nesta sessão (verificar antes de citar externamente): STJ Súmula 403; Lei 9.279/96 arts. 129–130 e 195; CP art. 154-A; LCP art. 65; Res. TSE 23.732/2024; Lei 15.123/2025; Ato Anatel 10.413/2021; jurisprudência do TST sobre imagem do empregado.*
