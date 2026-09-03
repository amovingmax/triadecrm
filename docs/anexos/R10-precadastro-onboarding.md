# 10 — Pré-cadastro → cadastro completo → publicação → ativação (onboarding de fornecedores KOMUNE)

Pesquisa de produto para o PRD do CRM de Captação. Data: 03/09/2026. Escopo: como transformar um contato prospectado em fornecedor publicado e ativo (1º lead real em 30 dias), e como o CRM acompanha cada passo. Baseado em benchmarks de marketplaces de serviços (setembro/2026), no brief `00-brief-contexto.md`, no Plano Estratégico de 90 dias e no Contexto Mestre.

Decisões já tomadas que este documento respeita:

- Não existe "anúncio fake". O pré-cadastro nasce **não publicado** e invisível na busca; só vai ao ar depois que o fornecedor reivindica, autoriza e completa.
- Fotos de diretórios (Casamentos.com.br, GetNinjas, Instagram) **nunca** são publicadas sem autorização explícita registrada.
- Publicação exige dados fiscais (CPF/CNPJ) e carteira/Pix ("só publica quando o fornecedor completa dados e carteira").
- Onboarding-alvo: menos de 10 minutos de sessão ativa. Selos: Verificado (documental) e Fundador (cohort).
- Todo Fornecedor Fundador recebe ao menos 1 lead real em 30 dias; CS pergunta "o que foi difícil?".

---

## 0. Resumo executivo

1. O padrão vencedor nos benchmarks é **"pedir pouco para entrar, pedir o resto para publicar, pedir documentos para o selo"**: iFood pede 4 campos no formulário inicial e a documentação depois; GetNinjas entra só com telefone (login sem senha) e categoria; Airbnb divide o wizard em 3 blocos retomáveis e deixa editar depois de publicar; Booking.com separa "perfil completo" de "abrir para reservas"; Peerspace revisa cada anúncio em cerca de 1 hora antes de ir ao ar.
2. O pré-cadastro da KOMUNE é uma aplicação direta do **efeito do progresso dotado** (Nunes & Drèze: cartão com 2 carimbos "de presente" teve 34% de conclusão contra 19% do cartão vazio). O link do WhatsApp deve abrir um perfil que já mostra "40% pronto" — nunca um formulário em branco.
3. O modelo de **"reivindicar perfil"** (Google Business Profile: "É o seu negócio? Eu sou o dono ou administro"; Doctoralia: perfil "verificado" = criou conta e confirmou os dados) resolve a questão ética: o fornecedor confirma, edita ou remove cada dado pré-preenchido, e o registro dessa autorização fica no banco.
4. **Autenticação por OTP no WhatsApp** é viável na stack atual: Supabase Auth suporta `signInWithOtp` com `channel: 'whatsapp'` via Twilio/Twilio Verify (código de 6 dígitos, reenvio a cada 60 s), com fallback para SMS. Custo por autenticação no Brasil: R$ 0,15–0,19; mensagens de utilidade (link, lembrete) R$ 0,04–0,05.
5. Definimos três níveis: **Publicável** (mínimo: identidade fiscal, Pix, 1 serviço com preço "a partir de", 3 fotos próprias, área de atuação, termos aceitos), **Completo** (score 100: 8+ fotos, descrição ≥300 caracteres, 3+ serviços, FAQ, horário de atendimento, redes) e **Verificado** (CNPJ/MEI ativo com CNAE compatível + documento do responsável; A&B: alvará/licença sanitária; infra: ART). Curadoria interna com SLA de 4 horas úteis antes de publicar.
6. Ativação é "chegou uma oportunidade real": o CRM registra 13 eventos de status (`pre_registration_created` → `first_deal`), calcula completude e dispara gatilhos de CS (link não aberto em 24 h, perfil parado 3 dias, sem foto, sem preço, lead sem resposta em 12 h, sem lead em 14 dias).

---

## 1. Benchmarks de onboarding de supply (tabela resumida)

| Plataforma | O que pede (ordem) | Obrigatório para publicar / operar | Verificação e selos | Anti-abandono e apoio | Tempo / curadoria | Lição para a KOMUNE |
|---|---|---|---|---|---|---|
| **iFood** (restaurantes) | 1) formulário curto: cidade, nome, e-mail, telefone; 2) tipo (restaurante/mercado); 3) plano (Básico 12% / Entrega 23% / Entrega Premium 27%); 4) responsável legal (CPF, RG); 5) loja (CNPJ, razão social, especialidade); 6) dados bancários; 7) revisão; 8) e-mail de acesso; 9) análise; 10) contrato | CNPJ ativo com CNAE alimentício (MEI aceito, conta do responsável), alvará de funcionamento e licença sanitária, contrato social/CCMEI, RG/CNH, conta bancária. Loja só vende após configurar no Portal do Parceiro: nome, logo, horário, cardápio com fotos (recomendação de 30–80 itens) | "Super Restaurante" por desempenho (nota ≥4,7, aceitação 99%+, preparo <25 min) | Portal do Parceiro + app Gestor de Pedidos; equipe entra em contato após o formulário; fontes divergem sobre consultor dedicado | Aprovação em 3–7 dias úteis com documentação completa; oficialmente "sem prazo estipulado, pode levar alguns dias"; repasse semanal | Formulário inicial mínimo; documentação em etapa própria; "loja ativa" só com cardápio fotografado. A KOMUNE deve bater o iFood em velocidade: publicar em horas, não dias |
| **GetNinjas** (serviços) | 1) telefone com DDD (vira login, sem senha); 2) e-mail; 3) 1 categoria principal; 4) grupos de serviço múltiplos; 5) nome, CEP, código SMS de 4 dígitos; 6) CPF ou CNPJ, nascimento, gênero, aceite de termos. Depois: "Editar perfil" com experiência, cursos, anos de mercado, fotos, preços, disponibilidade | Perfil básico já recebe pedidos; contato do cliente liberado com moedas (preço varia por categoria e porte); sem mensalidade, 100% do valor fica com o profissional; 450 mil pedidos/mês | Referência do plano da KOMUNE para o selo Verificado (documental) | Site ou app; dica "compre os pedidos mais novos" | Imediato | Telefone-first e login sem senha; categoria + subgrupos múltiplos; separar "cadastro" (2 min) de "melhorar perfil" (depois) |
| **Thumbtack** (serviços, EUA) | 1) serviços e área de atendimento; 2) perfil: resumo, anos de mercado, fotos (3–6 na 1ª semana), Q&A, links, formas de pagamento, horários; 3) background check gratuito (SSN ou documento, 5–7 dias úteis, gera badge); 4) preferências de alcance (tipos de job, áreas, orçamento semanal); 5) reviews (importa do Google) | Perfil publica sem verificação; paga por lead (valor varia por região, categoria e porte do job) | "Licensed pro" (licença checada em base pública), "Hired on Thumbtack" (review verificada), background check anual; **Top Pro**: responder em 4 h em ≥75% dos casos, nota ≥4,8, ≥5 reviews verificadas em 12 meses; só 4% qualificam. Garantia: US$ 2.500 (serviço) / US$ 100 mil (danos) | Plano de 30 dias por semana (semana 1 perfil, 2 resposta a leads, 3 ajuste de orçamento, 4 templates); app com notificações | 5–7 dias úteis para o background check | Programa "primeiros 30 dias" com metas por semana; selo por verificação em base pública (CNPJ via Receita); resposta em horas como critério de selo |
| **Airbnb** (hospedagem) e **Airbnb Services** (serviços, 2025) | Wizard de 10 passos em 3 blocos ("Conte sobre seu espaço", "Faça se destacar", "Finalize"): tipo, local, capacidade, comodidades, fotos, título, descrição (limite 500 caracteres), preço, regras. Rascunhos ficam salvos ("anúncios que você começou"), pode duplicar anúncio e editar depois de publicar | Services: identidade verificada, background check, licenças/seguros quando aplicável, mínimo 2 anos de experiência, **mínimo 5 fotos** (fotógrafos: 15 do portfólio), mínimo 1 oferta (3 recomendadas); fotos ≥1024×683 px | Superhost (desempenho); curadoria humana antes de listar serviços | **New Listing Promotion**: 20% de desconto nas 3 primeiras reservas em 30 dias — primeiro booking 30% mais rápido; 3 reservas = nota aparece na busca | Sem prazo publicado para hospedagem; Services passam por revisão | Wizard em blocos com salvar/retomar; promo de lançamento desenhada para gerar as 3 primeiras avaliações; curadoria para serviços; mínimo de 5 fotos |
| **Casamentos.com.br** (fornecedores de casamento) | "Área Empresas": conta gratuita (Pack Inicial) e pagos anuais (Pack Design, Pack Casamento Top; sem cancelamento antecipado; 14 dias de desistência). Perfil com fotos, descrição, preços, FAQ, promoções, opiniões | Conta gratuita publica; empresa cede conteúdo à plataforma e responde pelos direitos de imagem; plataforma pode "solicitar a documentação que considerar adequada" | Opiniões só de noivos após a data do casamento, validadas antes de publicar; **Casamentos Awards** (11ª edição, por estado e categoria): "mais recomendadas e melhor avaliadas" em serviço, custo-benefício, **tempo de resposta**, profissionalismo e flexibilidade | Account manager para contas pagas | Não divulgado | Avaliação vinculada a evento real; tempo de resposta como critério de premiação; o "sem mensalidade" da KOMUNE ataca exatamente o plano anual |
| **Zankyou** (casamento) | Submeter perfil → "aguardar pela verificação para fazer parte da comunidade"; galerias de foto/vídeo; serviços; opiniões respondidas via account manager | Perfil gratuito publica após verificação; premium compra destaque | Assume boa-fé sobre regularidade legal | E-mail a cada pedido de orçamento; account manager | Verificação manual, prazo não divulgado | Curadoria leve antes de publicar é padrão do segmento |
| **Peerspace** (espaços) | Preparar 10+ fotos (recomenda 20+), metragem, capacidade, comodidades, dados bancários → conta → anúncio em 6 passos → políticas → verificar conta + depósito direto → revisão → otimizar (preço custom, FAQ, add-ons, Instant Book, calendário) | 10+ fotos, dados bancários e conta verificada antes de ir ao ar; taxa de 20% | Revisão humana de todo anúncio novo | Status em "my listings"; "reenvie se precisar de ajustes" | **Revisão em cerca de 1 hora em horário comercial** | SLA de curadoria explícito; motivos de devolução; reenvio simples |
| **99Freelas / Workana** (freelancers) | Cadastro gratuito; perfil "em minutos": habilidades, experiência, portfólio; Workana avalia foto com rosto, título, resumo, portfólio, idiomas/certificações | 99Freelas: e-mails diários com projetos **só se o perfil estiver completo**; Workana: perfil incompleto é "uma das razões mais comuns de reprovação" | Níveis/planos (Pro R$ 54,90, Premium R$ 89,90); taxa 5–20% (mín. R$ 10) paga pelo cliente | Testes de habilidade | Curadoria de perfil na Workana | Recompensa condicionada à completude (só perfil completo recebe oportunidades) |
| **Booking.com** (extranet) | 1) conta; 2) básico (nome, tipo, endereço, contato); 3) configuração (quartos, comodidades, regras); 4) fotos (até 45); 5) preço e calendário; 6) informação legal/licença; 7) revisão → botão **"Open for bookings"**; 8) verificação da conta de parceiro | Ir ao ar depende da aprovação ("você receberá um e-mail"); status open/closed/snooze; 2FA | Genius, Preferred Partner (desempenho) | Extranet + suporte a parceiros | Prazo não divulgado | "Abrir para reservas" como ação explícita e reversível, separada de "completar perfil"; status de disponibilidade |
| **Mercado Livre** (reputação) | — | Termômetro só aparece após **10 vendas**; antes o vendedor é "novo" | Cores por reclamações (MLB: verde ≤3%, amarelo 3–7%, laranja 7–12%, vermelho >12%); mínimo 3 vendas com reclamação para impactar; janela de 60 dias (≥60 vendas) ou 365 dias; MercadoLíder Silver/Gold/Platinum | — | — | Novo fornecedor não é punido pela ausência de histórico; regra pública e janela móvel (o plano já prevê Prata/Ouro/Super com janela de 90 dias) |
| **Google Business Profile** (claim) | "É o seu negócio?" → "Eu sou dono ou administro" → verificação: instantânea (<60 s), telefone/SMS (5 min, código de 6 dígitos), vídeo (3–5 dias úteis), cartão postal (5–14 dias) | Perfil "completo": 100% dos campos, 10+ fotos, descrição de 750 caracteres, categorias secundárias, serviços, horários, mensagens ativadas, 5+ avaliações | Selo "verificado" no perfil | Cartão "Is this your business?" evita duplicidade | "Perfis com fotos na 1ª semana rankeiam 23% melhor no local pack" | Modelo de claim de perfil pré-existente com verificação por telefone; checklist de "dia 1" |
| **Doctoralia** (perfis pré-criados) | Perfil gratuito; "os perfis dos médicos que criaram uma conta no portal e confirmaram os seus dados estão assinalados como verificados"; edita endereço, telefone, e-mail e responde opiniões | — | Distinção visual verificado / não verificado | — | — | Perfil não reivindicado nunca deve parecer "oficial"; após o claim o fornecedor controla contato e respostas |
| **LinkedIn** (profile strength) | Medidor em 5 níveis (Beginner → All-Star) com 7 critérios (foto, setor/local, cargo atual com descrição, 2 cargos anteriores, formação, 5+ competências, resumo 40+ palavras); some ao chegar em All-Star | — | — | "All-Star: 40x mais oportunidades", "foto: 14x mais visualizações", "5+ competências: 17x mais visualizações" | — | Medidor com próximo passo sugerido e ganho esperado ("perfis com preço recebem 3x mais pedidos") |

Padrões transversais que aparecem em quase todos:

- **Mínimo para entrar é pequeno e móvel-first** (telefone, nome, categoria). O resto vem em etapas com progresso salvo.
- **Fotos são o gargalo universal**: todos definem um mínimo (Airbnb Services 5, Peerspace 10, Thumbtack 3–6 na primeira semana, Google 10+) e dão dicas na própria tela.
- **Publicar ≠ completo ≠ verificado.** Booking separa "abrir para reservas"; Airbnb deixa editar depois; Thumbtack e Google dão selos independentes da publicação.
- **Curadoria humana rápida** (Peerspace ~1 h, Zankyou e Workana revisam) é aceita pelo fornecedor quando o SLA é conhecido e a devolução vem com motivo.
- **Recompensa por completude** (99Freelas só envia oportunidades a perfil completo; Airbnb dá 20% de promo para gerar as 3 primeiras avaliações).
- **Resposta rápida vira selo** (Thumbtack Top Pro 4 h; Casamentos Awards pesa tempo de resposta; iFood aceitação 99%).

---

## 2. Princípios de desenho do fluxo KOMUNE

1. **Progresso dotado, não formulário vazio.** O link abre um perfil que já mostra "Seu perfil está 40% pronto — faltam 4 passos". Pré-preencher tudo que for público e legítimo (nome, categoria, descrição, área, faixa de preço, redes). Referência: Nunes & Drèze (34% vs 19% de conclusão); a recomendação de UX é "use dados existentes como avanço artificial" e reenquadre a tarefa como "incompleta" em vez de "não iniciada".
2. **Telefone é a identidade.** O número do WhatsApp usado pelo CS é o mesmo que autentica (OTP) e recebe os leads. Sem senha, sem e-mail obrigatório na primeira sessão (GetNinjas). E-mail entra como opcional para nota fiscal/recibo.
3. **Reivindicar antes de editar.** Tela "Este perfil é seu?" com confirmação e OTP, registro de termos e autorização de dados. Só depois o fornecedor vê e edita os dados (Google Business Profile, Doctoralia).
4. **Três degraus visíveis: Publicável → Completo → Verificado.** Cada degrau tem uma lista objetiva e um benefício ("publicável: aparece na busca"; "completo: entra no rodízio de destaque Fundador"; "verificado: selo + Komune Protege").
5. **Curadoria com SLA e motivo.** Toda publicação passa por revisão interna (Heloísa/estagiário) com meta de 4 horas úteis (Peerspace faz em 1 h). Devolução sempre com motivo padronizado e deep link para corrigir.
6. **Cadastro assistido como atalho, não exceção.** Se o fornecedor travar, o CS completa por ele (fotos enviadas pelo WhatsApp, preços ditados por áudio) — o fluxo precisa de um modo "CS edita em nome do fornecedor" com log de quem alterou.
7. **Menos de 10 minutos = orçamento por tela.** Ver seção 3.4. Tudo que não cabe no orçamento vai para "depois de publicar".
8. **Transparência LGPD por padrão.** Primeira mensagem identifica quem somos, de onde vieram os dados e como sair; consentimento de marketing é separado do aceite de termos; pré-cadastros não reivindicados são apagados após prazo definido (proposta: 90 dias).

---

## 3. Fluxo passo a passo: do pré-cadastro à ativação

### 3.1 Visão geral (etapas, sistema e evento emitido)

| # | Etapa | Onde acontece | Quem faz | Evento emitido | Estado do perfil na plataforma |
|---|---|---|---|---|---|
| E0 | Captação do alvo e pré-cadastro | CRM (scraper ou manual) | Comercial / robô | `pre_registration_created` | `draft`, `claimed=false`, invisível |
| E1 | Primeiro contato + pedido de autorização | WhatsApp (Heloísa, áudio), reunião ou visita | Comercial | `contacted`, `authorization_requested`, `authorization_granted/denied` | idem |
| E2 | Envio do link único (magic link) | CRM → WhatsApp (template de utilidade) | CRM automático ou CS | `claim_link_sent` | idem |
| E3 | Abertura do link: "Este perfil é seu?" | Painel web (mobile-first) | Fornecedor | `claim_link_opened` | idem |
| E4 | OTP no WhatsApp/SMS | Supabase Auth | Fornecedor | `claimed` | `claimed=true`, `claimed_at` |
| E5 | Termos + autorização de dados + consentimento de marketing | Painel | Fornecedor | `terms_accepted`, `data_authorization_granted` | `data_authorization=granted` |
| E6 | Revisão dos dados pré-preenchidos (confirmar / editar / remover) | Painel | Fornecedor (ou CS assistido) | `profile_reviewed` | completude ~40–50% |
| E7 | Serviços com preço "a partir de", categorias/subnichos, área de abrangência | Painel | Fornecedor | `profile_50` | completude ≥50% |
| E8 | Fotos próprias (mín. 3) ou autorização de importação | Painel ou WhatsApp → CS | Fornecedor | `photos_added` | |
| E9 | Identidade fiscal (CPF/CNPJ) + Pix/carteira | Painel | Fornecedor | `wallet_ready` | `publishable=true` |
| E10 | "Publicar" → curadoria interna → no ar | Painel + fila de revisão no CRM | Fornecedor + CS | `publish_requested`, `published` (ou `returned`) | `published`, selo Fundador |
| E11 | Documentos do selo Verificado (pode vir depois) | Painel + revisão | Fornecedor + CS | `documents_submitted`, `verified` | `verified` |
| E12 | Completar perfil (score 100) | Painel | Fornecedor | `profile_100` | `complete` |
| E13 | 1º lead real, 1ª resposta, 1ª proposta, 1º negócio | App/painel + CRM | Plataforma + CS | `first_lead`, `first_response`, `first_proposal`, `first_deal` | ativo |

### 3.2 Detalhe de cada etapa (telas e mensagens)

**E0 — Pré-cadastro no CRM.** O scraper ou o comercial cria o registro com: nome fantasia, categoria(s) e subnicho(s), descrição pública (curta), cidade/área, faixa de preço (quando existir no diretório), redes sociais, telefone/WhatsApp de contato, `source_platform` + `source_url` e um `source_snapshot` (JSON com o que foi coletado). **Fotos do diretório não são baixadas para o bucket público**: guarda-se apenas a URL de origem e a contagem ("13 fotos públicas encontradas"). O CRM cria, via API interna, o fornecedor na KOMUNE com `origin=pre_registration`, `publish_status=draft`, sem CPF/CNPJ, sem e-mail, sem Pix, com serviços sugeridos a partir de templates da categoria.

**E1 — Primeiro contato e autorização.** Segue o roteiro já definido (mensagem de texto em nome de Heloísa → áudio quando responde → reunião/visita). No contato, a pergunta literal "vocês autorizam a gente a colocar o material de vocês lá?" gera no CRM um registro de autorização com método (`whatsapp_text`, `whatsapp_audio`, `meeting`, `visit`), data, responsável e, quando por texto, o print/ID da mensagem. Esta é a base legal complementar ao legítimo interesse (transparência + expectativa razoável).

**E2 — Envio do magic link.** Gerado pelo CRM: `https://parceiros.komune.app/c/<token>` (token aleatório de 32+ caracteres, armazenado como hash, expira em 7 dias, pode ser reenviado — o reenvio invalida o anterior). Mensagem sugerida (template de utilidade no WhatsApp, R$ 0,04–0,05 por envio; dentro da janela de 24 h após resposta do fornecedor a mensagem é gratuita):

> Oi, {nome}! Aqui é a Heloísa, da Komune. Já deixei o perfil de {empresa} 40% pronto com o que vocês têm público na internet. Falta você confirmar os dados, colocar suas fotos e preços e publicar — leva uns 10 minutos: {link}
> Se preferir, me manda as fotos e os preços aqui mesmo que eu termino pra você. O link é pessoal e vale por 7 dias.

**E3 — Tela T1 "Este perfil é seu?"** Prévia read-only do card do fornecedor (nome, categoria, cidade, descrição curta, "fotos: nenhuma ainda"), com o aviso "Criamos este rascunho a partir de informações públicas de {fonte}. Ele não está visível para ninguém." Botões: **"Sim, é meu — continuar"** e "Não é meu / não quero aparecer" (abre formulário de recusa que apaga o pré-cadastro em 48 h e registra `authorization_denied` no CRM). Tempo-alvo: 30 s.

**E4 — Tela T2 "Confirme seu WhatsApp".** Número mascarado (o mesmo do CRM); botão "Receber código no WhatsApp" (fallback "por SMS"). Supabase `signInWithOtp({ phone, options: { channel: 'whatsapp' } })` via Twilio Verify (WhatsApp exige WABA e remetente próprio; templates de autenticação criados automaticamente); código de 6 dígitos; reenvio após 60 s; expiração configurável (padrão 1 h). Em caso de falha, o CS pode gerar código manual pelo CRM (com log). Ao validar: `claimed_at`, `claimed_phone`, `auth_user_id` vinculado ao fornecedor. Tempo-alvo: 45 s.

**E5 — Tela T3 "Termos e autorização".** Três caixas separadas (LGPD): (a) aceito os Termos de Uso e o Contrato de Prestação de Serviços — obrigatório; (b) autorizo a Komune a usar as informações públicas do meu negócio no meu perfil e confirmo que tenho direito sobre as fotos que enviar — obrigatório; (c) aceito receber novidades e oportunidades da Komune por WhatsApp — opcional. Registrar versão dos termos, data/hora, IP, user-agent, canal e hash do texto. Tempo-alvo: 30 s.

**E6 — Tela T4 "Revise o que já preenchemos".** Cada campo pré-preenchido aparece com origem discreta ("de: Casamentos.com.br") e três ações: **Confirmar** (padrão), **Editar**, **Remover**. Campos: nome de exibição, categoria principal + subnichos, descrição (limite 600 caracteres, mínimo 120 para publicar), cidade base, redes (Instagram, site), anos de mercado, faixa de preço. Barra de progresso no topo sobe a cada confirmação (efeito de progresso dotado). Ao final: "Tudo confirmado — 55%". Tempo-alvo: 2 min.

**E7 — Tela T5 "Seus serviços e preços" + T7 "Onde você atende".** Lista de serviços sugerida por categoria (ex.: buffet → "Coquetel por pessoa", "Jantar por pessoa", "Coffee break por pessoa"; DJ → "Festa até 4 h", "Hora adicional"; espaço → "Diária", "Meio período"). Para cada serviço: nome, preço **"a partir de R$"** (obrigatório em pelo menos 1), unidade (por evento / por hora / por pessoa / por diária), mínimo (ex.: 50 pessoas), descrição opcional. Área de abrangência: Natal por padrão + seleção de municípios da região metropolitana (Parnamirim, São Gonçalo do Amarante, Extremoz, Macaíba, Nísia Floresta, Ceará-Mirim) + "atendo outras cidades sob consulta" e taxa de deslocamento opcional. Categorias/subnichos múltiplos (um fornecedor de som pode ser "som + iluminação + DJ"). Tempo-alvo: 2–3 min.

**E8 — Tela T6 "Fotos".** Regra exibida: "Use fotos suas. Mínimo 3 para publicar; 8 ou mais deixam o perfil completo. Sem logo sobreposto, sem prints, sem fotos de banco de imagens." Upload múltiplo direto da galeria, capa escolhida, compressão no cliente. Alternativa com um toque: "Prefiro mandar pelo WhatsApp" — envia o número e o CS sobe as fotos (registro `uploaded_by=cs`). Se o diretório de origem tinha fotos, oferecer "Autorizo a Komune a importar as {n} fotos públicas do meu perfil em {fonte} (você confirma que são suas)" — só então o sistema baixa e registra `photo_import_authorized_at`. Tempo-alvo: 1–2 min.

**E9 — Tela T8 "Recebimento".** CPF ou CNPJ (validação de dígitos + consulta pública de situação cadastral e CNAE, ex.: BrasilAPI/ReceitaWS — a validar), nome/razão social preenchido automaticamente, chave Pix (validação de formato), confirmação de que a chave pertence ao titular. Explicação de 1 linha: "Você recebe pela carteira Komune após o serviço; taxa de 8% só quando fecha." Tempo-alvo: 1–2 min.

**E10 — Tela T9 "Checklist de publicação".** Lista com estados: Dados confirmados ✓ · 1 serviço com preço ✓ · 3 fotos ✓ · Área de atendimento ✓ · Recebimento ✓ · Termos ✓. Botão **"Publicar meu perfil"** habilita quando tudo estiver verde. Ao clicar: `publish_requested`; o perfil entra na fila de curadoria do CRM (seção 4.4). Mensagem: "Estamos revisando — em até 4 horas úteis seu perfil vai ao ar. Enquanto isso, que tal adicionar mais fotos?" Após aprovação: tela T10 "Perfil publicado" com link compartilhável (`komune.app/f/{slug}`) e card para Instagram/WhatsApp (tática Airbnb/Craigslist do plano), selo **Fundador** já visível, e CTA "Quer o selo Verificado? Envie seus documentos (2 min)".

Mensagem de publicação (WhatsApp):

> Seu perfil está no ar: {link}. Você é Fornecedor Fundador da Komune. Compartilha esse link no seu Instagram e nos grupos — ele já funciona como sua vitrine. Nos próximos 30 dias eu garanto pelo menos uma oportunidade real pra você. Responde em até 24 h que a gente te dá o selo "Responde rápido".

**E11 — Tela T11 "Selo Verificado".** Upload por tipo de documento com validade (seção 4.3). Revisão interna; ao aprovar, `verified_at`, selo no perfil, elegível ao Komune Protege.

**E12 — Completar até 100.** Depois de publicado, o painel mostra "Perfil 70% — próximos passos: +5 fotos (+10%), FAQ (+5%), horário de atendimento (+5%), 2 serviços adicionais (+10%)". Cada item mostra o benefício ("perfis completos entram no rodízio de destaque").

**E13 — Ativação.** Ver seção 6.

### 3.3 Modo assistido (CS edita em nome do fornecedor)

- No CRM, botão "Editar como {empresa}" abre o painel com sessão de impersonação restrita (somente campos de perfil, nunca Pix/CPF), com log `edited_by_cs`.
- Fotos e preços recebidos por WhatsApp são anexados no CRM e publicados no perfil pelo CS; o fornecedor recebe "Subimos 6 fotos que você mandou — confirma?" (um toque, registra `confirmed_by_supplier`).
- Dados fiscais e Pix o fornecedor sempre digita ele mesmo (ou em visita, no aparelho dele).

### 3.4 Orçamento de tempo (meta < 10 minutos de sessão ativa)

| Tela | Tempo-alvo | Acumulado |
|---|---|---|
| T1 Este perfil é seu? | 0:30 | 0:30 |
| T2 OTP | 0:45 | 1:15 |
| T3 Termos | 0:30 | 1:45 |
| T4 Revisar dados | 2:00 | 3:45 |
| T5+T7 Serviços, preços, área | 2:30 | 6:15 |
| T6 Fotos (3) | 1:30 | 7:45 |
| T8 CPF/CNPJ + Pix | 1:30 | 9:15 |
| T9 Publicar | 0:30 | 9:45 |

Tudo fora disso (mais fotos, FAQ, documentos do selo, horários, redes) é pós-publicação. Medir o tempo real por tela no PostHog e cortar o que estourar.

---

## 4. Definição de completude e regras de publicação

### 4.1 Score de completude (0–100) e os três degraus

| Campo / item | Peso | Publicável (P) | Completo (C) | Verificado (V) |
|---|---|---|---|---|
| Nome de exibição + categoria principal | 5 | obrigatório | | |
| Subnichos (≥1 adicional) | 3 | | obrigatório | |
| Descrição ≥120 caracteres | 5 | obrigatório | | |
| Descrição ≥300 caracteres com "o que está incluso" | 5 | | obrigatório | |
| Cidade base + área de abrangência | 5 | obrigatório | | |
| 1 serviço com preço "a partir de" e unidade | 10 | obrigatório | | |
| 3+ serviços com preço | 8 | | obrigatório | |
| 3 fotos próprias (≥1024 px no lado maior, sem logo/prints) | 12 | obrigatório | | |
| 8+ fotos, capa definida | 8 | | obrigatório | |
| Telefone verificado por OTP (claim) | 5 | obrigatório | | |
| Termos + autorização de dados | 5 | obrigatório | | |
| CPF/CNPJ validado (dígitos + situação ativa) | 8 | obrigatório | | |
| Chave Pix / carteira | 6 | obrigatório | | |
| Horário de atendimento e tempo médio de resposta declarado | 3 | | obrigatório | |
| FAQ (≥3 perguntas) ou políticas (cancelamento, sinal) | 4 | | obrigatório | |
| Redes sociais / site | 2 | | obrigatório | |
| Vídeo curto ou depoimento | 2 | | opcional | |
| Documentos do Verificado aprovados (ver 4.3) | 4 | | | obrigatório |
| **Total** | **100** | soma dos P = 61 | 100 | selo independente |

Regras derivadas:

- **Publicável** = todos os itens P verdes (score ≥ 61 com esses itens específicos). Sem eles o botão "Publicar" fica desabilitado, com a lista do que falta.
- **Completo** = score 100 (documentos do Verificado contam 4 pontos, mas o selo é um estado separado).
- **Verificado** = documentos aprovados e válidos; expira junto com a validade do documento (alvará, por exemplo) e volta a `pending` 30 dias antes de vencer.
- O pré-cadastro típico chega a ~35–45 pontos antes do claim (nome, categoria, descrição, cidade, faixa de preço, subnichos); isso é o "progresso dotado" que a tela T1 mostra.

### 4.2 Regras de qualidade (aplicadas na curadoria e por validação automática)

- **Fotos:** próprias e autorizadas; mínimo 3 para publicar; lado maior ≥1024 px (Airbnb usa 1024×683); sem logo sobreposto, sem texto/preço na imagem, sem prints de tela, sem marca d'água de terceiros, sem imagem de banco; capa horizontal mostrando o serviço em evento real. Detecção automática simples: resolução, proporção, duplicatas (hash) e, quando viável, OCR para texto sobreposto.
- **Descrição:** mínimo 120 caracteres para publicar; não pode conter telefone, e-mail ou @ (contato fica dentro da plataforma — regra a confirmar com Rafael; benchmarks de leads pagos bloqueiam contato externo, mas a KOMUNE pode optar por permitir); sem promessas "melhor da cidade"; sem texto copiado integralmente de outro diretório (o pré-cadastro deve reescrever a descrição pública em tom neutro).
- **Preço:** pelo menos um serviço com "a partir de R$" e unidade; sem "sob consulta" em todos os serviços (pode existir em alguns).
- **Categoria:** principal coerente com serviços e fotos (buffet com fotos de DJ é devolvido).
- **Resposta em 24 h:** compromisso aceito nos termos do Fundador; medido por `first_response_at − lead_created_at`; selo "Responde rápido" para ≥80% em 24 h nos últimos 90 dias (Prata) e ≥90% (Ouro), alinhado ao plano.
- **Disponibilidade:** botão "Pausar perfil" (Booking snooze) em vez de despublicar; perfil pausado não recebe leads mas mantém link.

### 4.3 Documentos do selo Verificado (por grupo)

| Grupo | Documentos obrigatórios | Documentos opcionais que sobem o nível | Validação |
|---|---|---|---|
| Todos | CNPJ ativo (ou CCMEI para MEI) com CNAE compatível; documento com foto do responsável (RG/CNH); contrato de prestação aceito na plataforma | Comprovante de endereço comercial; seguro de RC | Consulta pública da situação cadastral e CNAE; conferência visual do documento; nome do responsável bate com QSA |
| Alimentos e bebidas | Alvará ou licença sanitária vigente (Visa Natal) **ou** certificado de curso de manipulação de alimentos (RDC 216/2004) + responsável técnico quando aplicável | Alvará de funcionamento; laudo de água | Validade do documento; município emissor; lembrete de renovação. Em Natal, eventos com 1.000+ pessoas/dia com alimentação exigem alvará sanitário protocolado com 30 dias de antecedência (Visa Natal, RDC 656/ANVISA) — o perfil A&B verificado pode exibir "apto para grandes eventos" quando o documento cobrir |
| Infraestrutura (som, luz, gerador, estrutura, tenda) | CNPJ/MEI + responsável | ART/laudo de estruturas e geradores quando exigido; NR-10/NR-35 da equipe | Conferência visual; validade |
| Locais/espaços | CNPJ + alvará de funcionamento | AVCB/Certificado do Corpo de Bombeiros; capacidade máxima declarada | Validade |
| Prestadores de serviço (foto, vídeo, decoração, cerimonial) | CNPJ/MEI ou CPF + documento | Portfólio com 15+ fotos (referência Airbnb Services para fotógrafos) | Conferência |
| Recreação infantil | CNPJ/MEI + documento | Certificações de brinquedos (NBR) e monitores | Conferência |

Pessoa física sem CNPJ: pode publicar (CPF + Pix) e recebe orientação "abra seu MEI grátis no gov.br" (mesma abordagem do iFood); só ganha Verificado com CNPJ/MEI.

### 4.4 Fluxo de curadoria interna (antes de publicar)

1. `publish_requested` cria um item na fila "Revisão de perfil" do CRM com prioridade por cohort (Fundador primeiro) e tempo de espera.
2. Checklist do revisor (5 itens, 2 minutos): fotos próprias e dentro das regras · descrição legível e sem contato externo · preço coerente com a categoria (faixa de referência por categoria no CRM) · categoria/subnichos corretos · dados fiscais válidos (situação ativa).
3. Resultado: **Aprovar** (→ `published`, selo Fundador, mensagem E10) ou **Devolver** com motivo padronizado (`foto_qualidade`, `foto_terceiros`, `descricao_curta`, `contato_na_descricao`, `preco_ausente`, `preco_incoerente`, `categoria_errada`, `dados_fiscais_invalidos`, `outro`) + observação livre → `returned`; o fornecedor recebe mensagem com deep link direto para a tela a corrigir e o CS ganha tarefa de acompanhar em 24 h.
4. SLA: 4 horas úteis (meta), alerta no CRM a partir de 2 horas; fora do horário, próxima manhã. Métrica: tempo médio de revisão e taxa de devolução por motivo (alimenta melhoria das dicas nas telas).
5. Pós-publicação: revisão amostral semanal de 10% dos perfis publicados e de todos com denúncia.

### 4.5 Selo Fundador

- Atribuído automaticamente a fornecedores com `founder_cohort` (definido no pré-cadastro pelo CRM: por exemplo `natal_2026_onda1`) no momento de `published`.
- Contrapartidas registradas no aceite: perfil completo (score 100) em até 14 dias após publicar, resposta em 24 h, aceite de avaliação pública. Quem não cumpre perde o destaque rotativo, não o selo.
- Benefícios: selo no card, rodízio de destaque (10 por vez), 1º lead garantido em 30 dias, case/vídeo (com autorização). A promoção de taxa 0% deixou de ser central no pitch (reunião de 03/09); se mantida, `founder_fee_waiver_until` controla.

---

## 5. Integração CRM ↔ plataforma: eventos e campos

### 5.1 Arquitetura recomendada

O CRM e a plataforma compartilham o mesmo projeto Supabase (é a razão de construir o CRM próprio: "daqui a pouco eu integro com a gente mesmo"). Proposta: schema `crm` separado, tabela de eventos compartilhada e views de leitura. Nenhum webhook externo é necessário no MVP; quando houver máquina dedicada do robô de WhatsApp, ela lê a mesma tabela de eventos (polling ou Realtime).

- `crm.contacts` — ficha do contato (campos mínimos do Contexto Mestre + os novos abaixo), com `supplier_id` apontando para `public.suppliers` quando existir pré-cadastro.
- `public.supplier_onboarding_events` — log append-only: `id, supplier_id, contact_id, event, payload jsonb, actor (supplier | cs:user_id | system | bot), occurred_at`. Triggers no Postgres inserem eventos quando colunas relevantes mudam (`claimed_at`, `publish_status`, `verified_status`, `completeness_score`), e a plataforma insere `first_lead`, `first_response`, `first_deal` a partir das tabelas de leads/propostas/contratos.
- `crm.v_supplier_activation` — view que consolida por fornecedor: estágio atual, completude, itens faltantes, datas-chave, SLA de resposta, leads entregues. É o que a ficha do contato exibe.
- Estágio do funil do CRM avança automaticamente a partir do evento (mapa em 5.2); o CS pode sobrescrever com motivo.

### 5.2 Catálogo de eventos

| Evento | Quem emite | Quando | Payload mínimo | Efeito no CRM (estágio / temperatura) |
|---|---|---|---|---|
| `pre_registration_created` | CRM | Fornecedor criado em `draft` a partir de dados públicos | source_platform, source_url, fields_prefilled[], photos_found_count | Prospectado / frio |
| `contacted` | CRM/bot | 1ª mensagem enviada | channel, template_id | Contato |
| `replied` | bot | Fornecedor respondeu | sentiment (sim/não/dúvida) | Conversa / morno |
| `authorization_requested` / `authorization_granted` / `authorization_denied` | CS/bot | Pergunta de autorização e resposta | method, evidence_ref | Interessado / quente (granted) ou perdido (denied, motivo "não autorizou") |
| `claim_link_sent` | CRM | Link gerado e enviado | token_id, expires_at, channel | Cadastro iniciado |
| `claim_link_opened` | Plataforma | Link aberto (T1) | user_agent, ip_hash | Cadastro iniciado |
| `claimed` | Plataforma | OTP validado | claimed_phone, auth_user_id | Cadastro iniciado / quente |
| `terms_accepted` | Plataforma | T3 concluída | terms_version, marketing_optin, ip_hash | |
| `data_authorization_granted` | Plataforma | Checkbox de autorização de dados públicos | photo_import_authorized | |
| `profile_reviewed` | Plataforma | T4 concluída | fields_confirmed, fields_edited, fields_removed | Qualidade do scraper (% mantido) |
| `profile_50` | Plataforma (trigger) | completeness_score ≥ 50 | score, missing[] | |
| `photos_added` | Plataforma | Cada lote de fotos | count, uploaded_by | |
| `wallet_ready` | Plataforma | CPF/CNPJ + Pix validados | doc_type, cnpj_status | |
| `publish_requested` | Plataforma | Botão Publicar | score | Perfil completo (mínimo) → fila de curadoria |
| `returned` | CS via CRM | Devolvido na curadoria | reason_code, note | Tarefa de acompanhamento |
| `published` | CS via CRM (aprovação) | Aprovado | reviewer, review_minutes, founder_cohort | Perfil publicado / cliente |
| `profile_100` | Plataforma (trigger) | score = 100 | | Perfil completo |
| `documents_submitted` / `verified` / `verification_rejected` | Plataforma / CS | Selo Verificado | doc_types[], valid_until | Verificado |
| `first_view` | Plataforma | 1ª visualização de perfil por cliente | | Visualização |
| `first_lead` | Plataforma ou CS (lead manual) | 1º pedido de orçamento/contato real | lead_id, lead_source (organic, own_event, research_request, cs_manual) | Lead |
| `first_response` | Plataforma | 1ª resposta do fornecedor a um lead | response_minutes | |
| `first_proposal` | Plataforma | 1ª proposta enviada | | Proposta |
| `first_deal` | Plataforma | 1º contrato/pagamento | gmv | Contratação |
| `paused` / `unpublished` | Plataforma | Fornecedor pausou ou CS despublicou | reason | Risco |
| `feedback_collected` | CS | Pesquisa "o que foi difícil?" | nps, difficulty_text | |

### 5.3 Campos novos na KOMUNE (tabela `suppliers` ou equivalente)

| Campo | Tipo | Descrição |
|---|---|---|
| `origin` | enum `pre_registration` \| `self_signup` \| `assisted` \| `referral` \| `import` | Como o fornecedor entrou |
| `source_platform` | text | `casamentos`, `getninjas`, `instagram`, `google`, `econodata`, `manual` |
| `source_url` | text | URL pública de origem (uma por fonte; se várias, tabela `supplier_sources`) |
| `source_snapshot` | jsonb | O que foi coletado (para auditoria e para mostrar "de: {fonte}") |
| `pre_registered_by` / `pre_registered_at` | uuid / timestamptz | Quem/quando criou o pré-cadastro |
| `claim_token_hash` / `claim_token_expires_at` | text / timestamptz | Magic link (nunca guardar o token em claro) |
| `claimed_at` / `claimed_phone` / `claim_channel` | timestamptz / text / enum | Reivindicação e canal do OTP (`whatsapp` \| `sms` \| `cs_manual`) |
| `terms_version` / `terms_accepted_at` / `terms_evidence` | text / timestamptz / jsonb | Aceite com IP hash, user-agent |
| `data_authorization` | enum `none` \| `pending` \| `granted` \| `denied` | Autorização de uso dos dados públicos |
| `data_authorization_method` / `data_authorization_at` / `data_authorization_evidence` | enum / timestamptz / text | `whatsapp_text`, `whatsapp_audio`, `meeting`, `visit`, `checkbox`; referência da mensagem/print |
| `photo_import_authorized_at` | timestamptz | Autorização específica para importar fotos do diretório |
| `marketing_optin_at` | timestamptz | Consentimento de marketing separado (LGPD) |
| `completeness_score` / `completeness_breakdown` | int / jsonb | Score e itens faltantes (recalculado por trigger) |
| `publish_status` | enum `draft` \| `pending_review` \| `returned` \| `published` \| `paused` \| `unpublished` | Estado de publicação |
| `published_at` / `review_reason_code` / `review_note` / `reviewed_by` | | Curadoria |
| `verified_status` / `verified_at` / `verified_until` | enum `none` \| `pending` \| `verified` \| `rejected` \| `expired` | Selo Verificado |
| `founder_cohort` / `founder_badge_since` / `founder_fee_waiver_until` | text / timestamptz | Selo Fundador |
| `categories[]` / `subniches[]` | text[] | Múltiplas categorias e subnichos |
| `service_area` | jsonb | `{ base_city, cities[], radius_km, travel_fee }` |
| `response_sla_24h_pct_90d` / `avg_first_response_minutes` | numeric | Calculado pela plataforma |
| `first_lead_at` / `first_response_at` / `first_deal_at` | timestamptz | Marcos de ativação |
| `guaranteed_lead_due_at` | timestamptz | `published_at + 30 dias`; alimenta o gatilho de CS |
| `deleted_reason` / `delete_after` | text / timestamptz | Pré-cadastro não reivindicado: apagar após 90 dias (LGPD, minimização) |

Tabelas auxiliares: `supplier_documents` (tipo, arquivo, validade, status, revisor), `supplier_services` (nome, preço_a_partir_de, unidade, mínimo), `supplier_photos` (origem: `own_upload` \| `cs_upload` \| `imported_authorized`, uploaded_by, confirmed_by_supplier_at), `crm.authorizations` (evidências).

### 5.4 O que o CS vê na ficha do contato (CRM)

- Cabeçalho: nome, categoria(s), cidade, temperatura, responsável, estágio atual e há quantos dias está nele.
- **Linha do tempo de onboarding**: os eventos da seção 5.2 com data/hora (pré-cadastro → contato → autorização → link enviado → aberto → reivindicado → termos → 50% → publicado → verificado → 1º lead → 1ª resposta → 1º negócio).
- **Barra de completude** com os itens faltantes e o "próximo passo" sugerido para a mensagem (ex.: "faltam 2 fotos e Pix").
- **Ações de um clique**: reenviar link · copiar link · enviar lembrete (template) · editar como fornecedor · registrar autorização · registrar lead manual · aprovar/devolver revisão · registrar feedback "o que foi difícil?" · marcar perdido com motivo.
- **Leads**: lista de leads entregues (origem, data, tempo de resposta, resultado) e contador "lead garantido: entregue em X dias / vence em Y dias".
- **Documentos**: status e validade; alertas de vencimento.
- **Última mensagem / próxima ação / SLA**: última interação de qualquer canal (inbox WhatsApp integrado), próxima ação com data, e a idade da tarefa.

---

## 6. Ativação: 1º lead garantido, gatilhos de CS e métricas

### 6.1 Operacionalizar "1 lead real em 30 dias"

Definição de lead real: pedido de orçamento ou mensagem de um organizador com evento identificado (data, cidade, tipo, tamanho estimado) que exige resposta do fornecedor. Não conta "olá" sem contexto nem lead criado por funcionário sem evento por trás.

Fontes, em ordem de prioridade:

1. **Eventos próprios e eventos-teste** (LDM, LCC, Natal Experience, tênis, churrasco, formaturas de novembro, Founders Night de 19/11): o produtor do evento abre pedidos de orçamento reais dentro da plataforma para as categorias necessárias; cada pedido vai para 3–5 fornecedores fundadores da categoria (rodízio para cobrir todos). `lead_source=own_event`.
2. **Research Requests / Supply Gap**: buscas sem resultado ou pedidos do concierge viram lead qualificado ao fornecedor recém-publicado da categoria ("27 clientes procuraram transfer executivo"). `lead_source=research_request`.
3. **Demanda orgânica** do app/site (push segmentado "chegou {categoria} em Natal" para quem consentiu marketing). `lead_source=organic`.
4. **Lead manual do CS** como última alternativa (D+21 sem lead): Heloísa conecta um organizador real da rede (empresa, comunidade, cerimonialista parceiro) e registra no CRM com evento e contato. `lead_source=cs_manual`. Nunca lead fictício — o objetivo é o "aha" verdadeiro.

O CRM registra `first_lead` com origem e inicia o cronômetro de resposta. Após o desfecho (proposta enviada, fechou/não fechou), o CS liga e registra `feedback_collected` com as perguntas fixas do Contexto Mestre: "o que foi difícil? onde você travou? o que esperava encontrar? o que faltou?" + nota 0–10.

### 6.2 Gatilhos de CS (regras → ação)

| Gatilho (condição) | Prazo | Ação | Canal / dono |
|---|---|---|---|
| `claim_link_sent` sem `claim_link_opened` | 24 h | Lembrete curto com o link (template de utilidade) | Bot |
| idem | 72 h | Áudio da Heloísa ("vi que não deu tempo, quer que eu termine por você?") | CS |
| idem | 7 dias (token expira) | Ligação ou visita; regenerar link | CS / rota da tarde |
| `claim_link_opened` sem `claimed` | 1 h | "Deu problema com o código? Posso mandar por SMS" | Bot |
| `claimed` e completude < 61 sem atividade | 3 dias | "Seu perfil está 55% — faltam fotos e Pix. Link direto: {deep link}" | Bot |
| Sem foto própria após `claimed` | 2 dias | "Manda 3 fotos aqui que eu subo pra você" | CS |
| Sem preço em nenhum serviço | 2 dias | "Me diz o 'a partir de' do seu serviço principal" (CS preenche) | CS |
| `publish_requested` sem decisão | 2 h úteis (alerta), 4 h (SLA) | Alerta ao revisor; escalonar para Heloísa | CRM interno |
| `returned` sem correção | 24 h | Mensagem com o motivo em linguagem simples + oferta de ajuda | CS |
| `published` sem `profile_100` | 7 e 14 dias | "Complete para entrar no destaque: faltam X" | Bot |
| `published` sem `verified` | 14 dias | Campanha "selo Verificado em 2 minutos" + lista de documentos por grupo | Bot + CS |
| `published` sem `first_lead` | 14 dias | CS gera lead por evento próprio/Research Request; registra origem | CS |
| idem | 21 dias | Lead manual da rede; alerta ao gestor | Heloísa |
| idem | 30 dias (`guaranteed_lead_due_at`) | Escalonamento a Rafael/Bárbara; motivo registrado | Gestão |
| Lead sem `first_response` | 12 h | "Chegou um pedido de {tipo} para {data} — responde por aqui" | Bot |
| idem | 24 h | Ligação; registrar motivo | CS |
| idem | 48 h | Lead redistribuído a outro fornecedor; contador de SLA do fornecedor cai | Plataforma + CS |
| `first_lead` com desfecho registrado | até 3 dias | Ligação "o que foi difícil?" + NPS | CS |
| Documento do Verificado a vencer | 30 dias antes | Lembrete de renovação | Bot |
| Sem interação (login, resposta, edição) | 14 dias | Ligação + lead manual (atividade C11 do plano) | CS |
| Pré-cadastro sem contato ou sem autorização | 90 dias | Exclusão automática do rascunho e dos dados pessoais; mantém apenas CNPJ/razão social para não recriar | Sistema |

### 6.3 Métricas de onboarding e ativação

| Métrica | Definição | Meta inicial (dia 30 / 60 / 90) | Fonte |
|---|---|---|---|
| Taxa de autorização | `authorization_granted` / contatos que responderam | ≥60% | CRM |
| Taxa de claim | `claimed` / `claim_link_sent` | ≥50% em 7 dias | CRM + plataforma |
| Tempo até claim | mediana `claimed_at − claim_link_sent` | ≤24 h | idem |
| Tempo de sessão até publicar | soma do tempo ativo nas telas T1–T9 | mediana ≤10 min | PostHog |
| Tempo até publicar (calendário) | mediana `published_at − claim_link_sent` | ≤48 h | plataforma |
| % publicados em 7 dias | publicados / reivindicados | ≥70% | plataforma |
| Completude média dos publicados | média de `completeness_score` | ≥80 em D+14 | plataforma |
| Taxa de devolução na curadoria | `returned` / `publish_requested` | <20%, caindo | CRM |
| Tempo de revisão | mediana `published_at − publish_requested_at` | ≤4 h úteis | CRM |
| Fidelidade do pré-cadastro | campos confirmados / campos pré-preenchidos | ≥80% (mede a qualidade do scraper) | plataforma |
| Autorização de importação de fotos | `photo_import_authorized` / fornecedores com fotos públicas | informativo | plataforma |
| Fornecedores publicados e completos | contagem | 40 / 100 / 130 (plano) | painel admin |
| Verificados | contagem | 10 / 50 / 80 (plano) | painel admin |
| Tempo até 1º lead | mediana `first_lead_at − published_at` | ≤14 dias; 100% dos Fundadores em ≤30 dias | plataforma + CRM |
| Resposta em 24 h | leads respondidos em ≤24 h / leads | ≥80% → 90% | plataforma |
| % com interação relevante em 30 dias | fornecedores com lead respondido, proposta ou visualização+edição em 30 dias | 50% / 70% / 70% (plano) | painel + CRM |
| Tempo até 1º negócio | mediana `first_deal_at − published_at` | ≤45 dias | plataforma |
| Drop-off por tela | abandono em T1…T9 | identificar a pior tela toda semana | PostHog |
| Feedback coletado | `feedback_collected` / `first_lead` | ≥80% | CRM |

Relatório automático de segunda-feira (8 h) inclui: funil da semana (pré-cadastros → contatados → autorizados → reivindicados → publicados → com lead), pior tela, motivos de devolução, fornecedores com lead garantido a vencer.

---

## 7. Cerimonialista e produtor: onboarding específico

No sistema não existe "cerimonialista" como entidade: é perfil **produtor** com subcategoria (cerimonial, formatura, produtor operacional). No CRM é segmento comercial próprio.

### 7.1 Fluxo

1. **Pré-cadastro do produtor** a partir de Sympla, Instagram, Casamentos.com.br (42 cerimonialistas) e produtoras de formatura (M3TA, Z2, Gideon): nome, tipo, eventos passados identificados (nome, data, público estimado), redes. `origin=pre_registration`, `partner_type=producer`, `subcategory=cerimonial`.
2. **Contato e demonstração** (café/Meet): mostrar o painel com o evento dele já esboçado ("Formatura Direito UFRN — dez/2026") e o simulador de split: "R$ 40 mil em contratações pelo app = R$ 2 mil para você, com extrato".
3. **Claim + termos** iguais ao fornecedor (OTP, termos, autorização), mais o **contrato de comissão** de 5% via split (aceite registrado; regra: cerimonialista = organizador do evento; co-organizador paga).
4. **Wizard "Crie seu primeiro evento"** (5 telas, <5 min): nome e tipo · data e local · público estimado e formato (convites, ingressos, rateio) · categorias de fornecedores necessárias (gera Research Requests internas) · publicar/rascunho.
5. **"Traga seus fornecedores"**: o produtor indica os fornecedores que já usa (nome + WhatsApp); o CRM cria pré-cadastros com `origin=referral`, `referred_by=producer_id` e dispara o fluxo do fornecedor com mensagem "o {cerimonialista} indicou vocês". Loop de indicação natural do segmento.
6. **Ativação do produtor**: evento criado com ≥20 confirmados **ou** ≥1 fornecedor contratado pelo app. Segundo evento = retenção (KR4: 30 com evento, 8 com segundo evento).

### 7.2 Produtor fundador (evento já programado)

- **Cadastro assistido**: o CS cria o evento junto com o produtor (migra a planilha de fornecedores e custos para o painel), define os pedidos de orçamento para as categorias em aberto e os direciona a fornecedores fundadores (gera os leads garantidos).
- Selo **"Cerimonialista Verificado"** (CNPJ/MEI + documento + ≥1 evento realizado na plataforma) com indicação prioritária para organizadores sem cerimonial.
- Ferramenta grátis (convites, lista, rateio, financeiro do evento) como argumento central; a comissão transparente substitui o BV informal (~10%).
- Eventos em CRM: funil produtor (identificado → contato → demonstração → evento escolhido → evento criado → participantes convidados → ativados → funcionalidades usadas → evento realizado → novo evento) com eventos `producer_claimed`, `event_created`, `first_supplier_hired`, `event_completed`, `second_event_created`.

---

## 8. Riscos, decisões em aberto e alternativas testáveis

| Tema | Risco / dúvida | Recomendação |
|---|---|---|
| LGPD do pré-cadastro | Dados de PJ (CNPJ, razão social, telefone comercial) são tratáveis por legítimo interesse; dados de pessoa física (MEI, nome do sócio, celular pessoal) exigem LIA, transparência na 1ª mensagem, opt-out imediato e minimização. WhatsApp pessoal "minerado" é zona cinzenta | Documentar o LIA (finalidade, necessidade, balanceamento, salvaguardas) com registro de origem; 1ª mensagem sempre identifica empresa, origem do dado e como sair; excluir pré-cadastro não reivindicado em 90 dias; nunca publicar dado pessoal antes do claim |
| Fotos de diretórios | Direitos autorais e de imagem de terceiros (fotógrafo, noivos) | Importar só com autorização explícita e declaração de titularidade; preferir fotos enviadas pelo fornecedor; registrar `imported_authorized` |
| Descrição copiada | Texto do Casamentos.com.br é conteúdo cedido àquela plataforma | Reescrever em tom neutro no pré-cadastro (LLM) e pedir confirmação/edição na T4 |
| Publicar exige Pix | Aumenta atrito na sessão inicial (etapa de ~1,5 min e pedido de dado sensível cedo) | Manter a decisão (Rafael), mas medir o drop-off na T8; se >25%, testar variante "publicar como vitrine; Pix obrigatório ao enviar a 1ª proposta" (padrão Thumbtack/GetNinjas) |
| Canal do WhatsApp | Robô em número não oficial pode ser banido; API oficial custa por mensagem (utilidade R$ 0,04–0,05; autenticação R$ 0,15–0,19; marketing R$ 0,31–0,38) e exige templates aprovados | OTP e link por API oficial (Twilio Verify / WABA); conversa humana e áudio pelo número de atendimento; respostas dentro da janela de 24 h são gratuitas |
| Curadoria vira gargalo | 100 perfis em 6 semanas com 1 revisora | Checklist de 2 min, validações automáticas (resolução, duplicata, CNPJ) e estagiário como revisor de 1º nível; SLA monitorado |
| Lead garantido sem demanda | Categorias sem evento próprio (recreação infantil, transporte) | Planejar eventos-teste por categoria; usar Research Requests; em último caso lead manual da rede — nunca fictício |
| Fornecedor sem CNPJ | Pessoa física quer publicar | Permitir com CPF + Pix; orientar MEI; sem selo Verificado até regularizar |
| Contato externo na descrição | Fornecedor quer colocar telefone/Instagram | Decidir política: bloquear (protege a taxa) ou permitir (reduz atrito). Recomendação: bloquear na descrição, permitir link de Instagram em campo próprio |

---

## 9. Fontes (URLs consultadas em 03/09/2026)

Benchmarks de onboarding e supply

- iFood — cadastro, documentos e planos: https://saipos.com/integracoes/ifood/ifood-cadastro · https://www.serasa.com.br/renda-extra/abrir-loja-no-ifood/ · https://granuz.com.br/blogs/receitas-e-dicas/como-cadastrar-restaurante-ifood-passo-a-passo · https://blog-parceiros.ifood.com.br/ifood-cadastro/ (bloqueado no acesso, referência)
- GetNinjas — cadastro do profissional: https://blog.getninjas.com.br/cadastro-no-getninjas-tudo-sobre-como-se-tornar-um-profissional/ · como funciona e moedas: https://blog.getninjas.com.br/como-funciona-o-getninjas-para-profissionais/ · https://blog.getninjas.com.br/como-funcionam-as-moedas-do-getninjas/
- Thumbtack — primeiros 30 dias: https://community.thumbtack.com/discussion/2151/5-mins-read-what-top-earning-pros-do-differently-in-their-first-30-days · segurança, badges e garantia: https://www.thumbtack.com/safety/ · onboarding e Top Pro: https://www.getjobber.com/academy/thumbtack-for-contractors/ · https://www.thumbtack.com/pro-basics
- Airbnb — retomar/duplicar anúncio e 10 passos: https://www.airbnb.com/resources/hosting-homes/a/how-to-finish-listing-your-space-461 · passos do anúncio: https://www.guesty.com/blog/step-by-step-guide-how-to-list-on-airbnb/ · https://www.uplisting.io/blog/how-to-set-up-your-airbnb-listing · requisitos de fotos: https://completehospitalitymanagement.com/airbnb-photo-requirements/ · New Listing Promotion (20% nas 3 primeiras reservas, 30% mais rápido): https://www.rentalscaleup.com/why-and-how-should-hosts-use-airbnbs-new-listing-promotion/ · Airbnb Services e Experiences — padrões e requisitos (5 fotos, 2 anos, verificação): https://www.airbnb.com/help/article/1451
- Casamentos.com.br — condições legais (Área Empresas, conteúdo, opiniões, Premium): https://www.casamentos.com.br/condicoes-legais-br.php · Casamentos Awards 2026: https://www.casamentos.com.br/casamentos-awards · Wedding Awards (PT): https://www.casamentos.pt/wedding-awards · acesso empresas: https://www.casamentos.com.br/emp-Acceso.php
- Zankyou — FAQ para profissionais: https://www.zankyou.pt/faq/faq-para-profissionais/ · condições para fornecedores: https://www.zankyou.pt/porque-zankyou/condicoes-fornecedores/
- Peerspace — passos para ser host (revisão em ~1 h, 10+ fotos, 20%): https://support.peerspace.com/hc/en-us/articles/115005406746-What-are-the-steps-to-becoming-a-Peerspace-host-
- 99Freelas — como funciona: https://www.99freelas.com.br/como-funciona · Workana — aprovação de perfil: https://dovallemarketing.com.br/como-ser-aprovado-no-workana-guia-completo-para-freelancers/
- Booking.com — criar anúncio (7 passos, "Open for bookings"): https://www.hosthub.com/guides/how-to-create-a-listing-on-booking-com/ · extranet e status: https://hospitable.com/booking-extranet
- Mercado Livre — reputação de vendedores (API/critérios): https://developers.mercadolivre.com.br/pt_br/reputacao-de-vendedores · ativar termômetro (10 vendas): https://ecommercenapratica.com/blog/ativar-o-termometro-no-mercado-livre/
- Walmart Marketplace — primeiros 30 dias: https://marketplace.walmart.com/first-30-days-on-walmart-marketplace/
- Shipturtle — simplificar onboarding de sellers (métricas: activation rate, time to first listing): https://www.shipturtle.com/blog/how-to-simplify-seller-onboarding-for-your-multi-vendor-marketplace

Claim de perfil, magic link e OTP

- Google Business Profile — criar/reivindicar e verificar (2026): https://gatilab.com/create-google-business-profile/
- Doctoralia — perfis verificados e FAQ: https://www.doctoralia.com.br/faq · perfil gratuito: https://pro.doctoralia.com.br/recursos/perfil-gratuito
- Supabase — Phone login / OTP (WhatsApp via Twilio): https://supabase.com/docs/guides/auth/phone-login · https://supabase.com/docs/reference/javascript/auth-signinwithotp
- Twilio Verify — canal WhatsApp: https://www.twilio.com/docs/verify/whatsapp
- WhatsApp Business API — preços no Brasil 2026 (utilidade, autenticação, marketing, janela de 24 h): https://www.messagecentral.com/blog/whatsapp-business-api-pricing-brazil

Completude, psicologia de progresso e qualidade

- Efeito do progresso dotado (Nunes & Drèze, 34% vs 19%): https://medium.com/usabilitygeek/design-perfect-ux-tasks-the-endowed-progress-effect-7461ca20076c
- LinkedIn profile strength (níveis, 7 critérios, 40x): https://meet-lea.com/en/blog/how-to-check-linkedin-profile-strength

Regulatório (Natal/RN e LGPD)

- Prefeitura de Natal — alvará sanitário para eventos com 1.000+ pessoas/dia e manipulação de alimentos (Visa Natal, 30 dias, RDC 656): https://diariodorn.com.br/prefeitura-de-natal-passa-a-exigir-alvara-sanitario-para-autorizar-eventos-com-mamil-pessoas-por-dia-e-manipulacao-de-alimentos/
- ANPD — Guia orientativo sobre legítimo interesse: https://www.gov.br/anpd/pt-br/assuntos/noticias/anpd-lanca-guia-orientativo-sobre-legitimo-interesse · síntese: https://www.dataprivacybr.org/guia-do-legitimo-interesse-orientacoes-da-anpd/
- LGPD na prospecção B2B (dados públicos, opt-out, registro de origem): https://leadcnpj.com.br/blog/lgpd-na-prospeccao-b2b/

Documentos internos

- `/home/claude/research/00-brief-contexto.md` (brief do CRM, 03/09/2026)
- Projeto "Komune - Marketing": `planejamento/plano-estrategico-90-dias-komune.md` (P5 selos, P6 onboarding <10 min, P8 OTP, S3 CS dos Fundadores, seção 7 Confiança e selos, seção 10 métricas) e `contexto/contexto-mestre-komune-sintese.md` (funis, CRM mínimo, Research Requests, momento "aha").
