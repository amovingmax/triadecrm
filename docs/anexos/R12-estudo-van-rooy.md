# R12 — Estudo do CRM Van Rooy e adições propostas ao KOMUNE CRM

**Data:** 04/09/2026 · **Pedido:** Matheus ("analisar o CRM do Van Rooy e implementar como adição coisas que eles usam").

**Objeto:** LH Van Rooy Informática (SP, 30+ anos), CRM e Televendas para incorporadoras, telemarketing e indústria; parceiros Microsoft Dynamics e Call Solution.

**Método:** 100 funcionalidades levantadas em 68 fontes, por quatro lentes independentes (produto, segmentos, terceiros, categoria), cruzadas com o PRD e com o código já construído, e submetidas a uma lente crítica que testou cada item contra os guardrails do CLAUDE.md. O site institucional atual tem 12 páginas e pouco detalhe; o material que descreve o produto de verdade veio do site antigo no Internet Archive (2001 e 2013).


## Resumo

Consolidei as duas análises em 20 entradas: 13 adições e 7 recusas. As duas concordam no essencial — o núcleo aproveitável da Van Rooy é tabulação de desfecho + pendência com prazo, e a metade do catálogo dela (discador/CTI, PA, gravação, BackOffice fiscal, SAT de incorporadora, disparo segmentado) não tem objeto de negócio na KOMUNE ou colide com ADR-05, ADR-06 e ADR-09. Ordenei pelo que move a meta de 100 fornecedores publicados até 06/11: primeiro o que impede a base de virar lixo nas duas primeiras semanas (desfecho tabulado, cooldown, higiene na ingestão, aproveitamento por lote), depois o que destrava a operação de campo (troca de dono em massa no D5, alarme dos dois eventos sensíveis a tempo, cartão de objeções), por último o que só paga juros depois (completude SPACE, evento próprio, previsão de funil).

Onde as duas discordaram, e quem venceu: (a) prazo de solução — o cruzamento queria colunas derivadas e view no D3/D9, o crítico queria um número só no relatório; venceu o crítico, porque uma segunda taxonomia de prazo cria dois números que discordam e alimenta o risco 15 (Assistente vira vigilância); (b) validação na captura — o cruzamento deu como já coberto (RF-BAS-05/08, já implementado na migração 000300, com E.164, DV de CNPJ e sete chaves de dedup), o crítico apontou o descarte de CPF na ingestão; venceu o crítico no recorte estreito: conferi a migração 000300 e a constraint de CPF/Pix existe só em `organizations.custom`, e as tabelas do Radar (`raw_capture`, `source_record`) só nascem no D4 — o CPF entra por lá sem barreira; (c) previsão ponderada — o cruzamento queria adotar por conversão histórica, o crítico queria descartar; dividi: descartado o valor × probabilidade digitada (não há valor por negócio; probabilidade digitada é ficção), mantida a conversão histórica como a forma da "previsão de funil" que a §11.4 já promete para a v2; (d) eventos da plataforma na timeline — o crítico disse que não estava escrito, o cruzamento disse que estava; venceu o cruzamento, verifiquei: RF-PRE-13 mapeia os 20 eventos, RF-PRE-16 põe a linha do tempo de onboarding na ficha e RF-FUN-06 já unifica o chat, então não é adição, é entrega; (e) esforço do evento próprio — médio contra baixo; fica baixo, com escopo travado em quatro campos e uma lista de convidados; (f) objeções na tela — o cruzamento punha no D3, o crítico na v1; venceu o crítico, e a razão é minha dedução: o D3 já carrega kanban dos funis 1 e 3, semáforo, próxima ação obrigatória, motivos de perda, timeline, tarefas, Realtime e o formulário de 20 s no mesmo dia; (g) pesquisas — o cruzamento descartava tudo, o crítico queria uma pergunta em D+30; o construtor de questionários morre nos dois, a pergunta única sobrevive pendurada no RF-PRE-15.

Verificado item a item e tratado como já coberto, sem virar adição: visão 360 e histórico completo (RF-BAS-06, RF-FUN-06, RF-FUN-07, RF-BAS-12, RF-PRE-13, RF-PRE-16); pipeline com fases e histórico (RF-FUN-01/08, `deal_stage_history` já no banco); check-in geolocalizado, slots de agenda e território (RF-ROT-05/06, RF-AGE-01/02/03 — nada muda por causa da Van Rooy, e RF-AST-06 continua proibindo rastreamento contínuo); níveis de acesso e supervisão (RF-ADM-01 como RLS testada em pgTAP, mais forte que tela de permissão, com telefone mascarado em RF-BAS-14); parametrização sem código (RF-ADM-02); importação com proveniência e licença (RF-BAS-07/10); campanha ativa com lista de discagem, cuja versão correta é a fila diária das 06:00 (RF-CON-08); script conversacional (RF-CON-23 + Apêndice C + seed).

O que a Van Rooy faz melhor que o nosso desenho atual: ela fecha o vocabulário do resultado. Trinta anos de televendas ensinaram que, se o operador puder digitar o que quiser ao encerrar um contato, o relatório do supervisor morre em três semanas — por isso o desfecho é lista fechada, parametrizável, e todo relatório do sistema deriva dele. O KOMUNE fechou a lista para motivo de perda (`lost_reasons`) e para intenção de mensagem recebida (25 intenções), mas deixou `activities.outcome` como texto livre, com os valores só num comentário da migração 000300 — justamente para ligação, visita e DM, que são a maioria das portas de quem não dispara pelo Número 1. Ela também é melhor em uma coisa cultural: trata a pendência com prazo como objeto de primeira classe do supervisor, com "dentro do prazo / fora do prazo" e tempo médio, enquanto o nosso "follow-ups em dia" (RF-MET-01) ainda não tem fórmula escrita.

Onde o nosso desenho é melhor para o caso da KOMUNE: em quase tudo o que decorre de o problema não ser volume. A Van Rooy otimiza tentativas por hora; a KOMUNE tem 450 alvos, um número com teto de 20 a 60 primeiros contatos por dia e a tese de que o humano converte — então fila diária ordenada por score de lacuna de oferta, temperatura calculada por regra auditável, porta aberta com resultado registrado (máx. 1 por alvo a cada 30 dias) e próxima ação obrigatória valem mais que campanha, lote e TMA/TMO. Somos melhores também na parte que ela não tem: proveniência por campo e whitelist de coleta, autoria tipada na timeline (pessoa / robô fixo / robô com IA / sistema), RLS com 440 testes pgTAP em vez de tela de permissão, validador de promessas e KB fechada, amostragem semanal de qualidade sem gravar ninguém, e um caminho de dado que termina em pré-cadastro dentro da plataforma — coisa que nenhum CRM de prateleira, nem o da Van Rooy, faz.


## Adotar (2)


### Catálogo de desfechos de interação (a "tabulação", parametrizável e multicanal)

- **Esforço:** baixo · **Onde encaixa:** D3 (módulo 7.3 + 7.7): tabela `interaction_outcomes` (slug, canais aplicáveis, próxima ação padrão, muda etapa/temperatura, ativo, ordem) + `activities.outcome_id`, consumida pelo formulário de porta aberta e pela ficha. Edição pelo gestor entra na v1 dentro de RF-ADM-02. Os motivos de descarte da triagem (§5.2) entram no mesmo catálogo.
- **O que é:** Lista fechada e editável pelo gestor com o resultado possível de cada interação, escolhida ao encerrar o contato, valendo para todos os canais (WhatsApp, ligação, visita, reunião, DM do Instagram). Na Van Rooy é a espinha dorsal: todo relatório do sistema sai da tabulação.
- **Por que (não) serve:** É a maior lacuna real do PRD e a única coisa do dossiê que resolve um problema que já temos marcado. Hoje `activities.outcome` é `text` livre — conferi a migração 20260904000300, linha 474: os valores existem só num comentário. Temos lista fechada para motivo de perda (RF-FUN-04, `lost_reasons`) e para intenção de mensagem recebida (Apêndice C, 25 intenções, só WhatsApp), e chips por categoria no formulário de 20 s (RF-MET-06) — três taxonomias que não conversam. Ligação, visita e DM são a maioria das portas do time, porque só a Heloísa dispara pelo Número 1 (risco 18), e são exatamente as que encerram sem vocabulário comum. Sem isso, "porta aberta exige resultado registrado" (RF-MET-01), o corte do funil por canal e origem (RF-REL-02), os motivos e objeções (RF-REL-04) e a distinção "não fez" vs. "não registrou" (RF-AST-06) dependem de quem digitou. Com 20 a 60 toques/dia, texto livre vira 40 grafias de "não atendeu" no primeiro mês. O desfecho também define a data padrão da próxima ação (RF-FUN-03) e a mudança de etapa/temperatura, unificando o que RF-MET-06 já faz por chips.
- **No PRD hoje:** Parcial e fragmentado: RF-MET-06 (chips do template da categoria), RF-FUN-04 + §5.3 (motivos de perda, lista fechada), Apêndice C (intenções da IA). Não existe RF para o desfecho de ligação, visita, reunião ou DM, e a coluna existe sem domínio.
- **Risco:** Inflação de opções: acima de ~8 por canal ninguém tabula dentro do orçamento de 20 s e a estatística piora. E Lei de Goodhart — o desfecho é descritivo; a meta continua sendo porta aberta com resultado registrado (RF-MET-01, RF-MET-09).


### Higiene na esteira de ingestão: detectar e descartar CPF, validar DDD e normalizar @

- **Esforço:** baixo · **Onde encaixa:** D2 (importação e mapeamento de colunas, módulo 7.1) e D4 (esteira do Radar, módulo 7.2): regex de CPF com DV no `raw_capture`, campo descartado com registro em `field_provenance`, nunca persistido.
- **O que é:** O único item que a Van Rooy repete há 25 anos: conferência automática no ato da digitação/importação para minimizar erro operacional e evitar retrabalho a jusante.
- **Por que (não) serve:** O cruzamento deu como já coberto e o crítico venceu num recorte específico que eu confirmei no código: a constraint que recusa CPF/Pix existe em `organizations.custom` (migração 000300, linha 56), mas as tabelas do Radar (`raw_capture` → `source_record` → `supplier_candidate`, ADR-08) só nascem no D4 e não têm essa barreira — e nome empresarial de MEI costuma carregar o CPF do titular. O R06 exige o descarte na ingestão e nenhum RF cobre. O resto (E.164, DV de CNPJ, dedup por sete chaves) já está pronto e não precisa de nada. Some-se DDD plausível para a Grande Natal e @instagram normalizado, que reduzem trabalho da revisora — o gargalo declarado (risco 11, uma revisora para 100 perfis).
- **No PRD hoje:** Parcial: RF-BAS-05 e RF-BAS-08 (normalização e dedup) já implementados na migração 000300; ADR-09 protege `organizations`. O descarte de CPF na ingestão só existe no R06, não virou RF.
- **Risco:** Não pode travar captura em campo — o formulário de porta aberta tem orçamento de 20 s (RF-MET-06) e a criação rápida, 30 s (RF-BAS-15). Avisar, aceitar e marcar para revisão; bloquear só o CPF, que é passivo de LGPD e não erro de digitação.


## Adaptar com salvaguarda (11)


### Janela de recontato como propriedade do desfecho (a metade aproveitável da "renitência")

- **Esforço:** baixo · **Onde encaixa:** D3 (colunas no catálogo do item 1, módulo 7.3) e D7 (filtro na fila e nas cadências, módulo 7.4); edição pelo gestor na v1 via RF-ADM-02.
- **O que é:** No televendas, cada desfecho carrega a regra de retentativa: "não atendeu" volta em 2 h, "sem interesse" sai da campanha por 90 dias. Aqui: `cooldown_dias` e `pode_reativar` como colunas do catálogo do item 1, lidas pela fila.
- **Por que (não) serve:** As janelas de recontato do KOMUNE existem, mas em prosa: reativação D+30/D+60 (RF-CON-15), perdido reabre em 90 dias (§5.3), régua de silêncio D+3 (RF-CON-13/14), opt-out permanente (RF-CON-18). Nada disso é dado que a fila das 06:00 (RF-CON-08) e a ordenação do Meu dia (RF-MET-04) consigam ler. Quem pediu para esperar e é reoferecido na semana seguinte é exatamente o contato que gera denúncia — e denúncia derruba o quality rating do número, que é o ativo mais frágil do projeto (risco 2).
- **No PRD hoje:** Parcial: RF-CON-13/14/15/18 e §5.3 descrevem as janelas em texto; não existem como propriedade configurável.
- **Risco:** Recusar por escrito o motor de retentativa que vem junto no dossiê: "3 tentativas por dia" é norma de discagem de voz e, aplicada ao WhatsApp, estoura a cadência 1+1 e a política de opt-in da Meta. Cooldown é piso de espera, nunca gatilho de reenvio automático.


### Aproveitamento por lote de importação e por origem, com denominador

- **Esforço:** baixo · **Onde encaixa:** D2 (coluna `import_batch_id`/`ingest_job_id` em `organizations`, módulo 7.1) e D9 (corte no relatório de segunda, RF-REL-02/RF-REL-09, módulo 7.8); painel no Metabase na v1.
- **O que é:** O "índice de aproveitamento de cadastros externos": cada mailing ou lote é medido separadamente, para comparar a qualidade das listas e decidir onde investir coleta e revisão.
- **Por que (não) serve:** É a decisão mais cara do Radar e a evidência para recalibrar a meta de 450 alvos nas duas primeiras semanas, como o PRD promete (risco 4). RF-REL-02 já corta o funil por origem, mas falta o denominador (de 100 alvos desta fonte, quantos tinham contato válido, quantos responderam, quantos publicaram) e falta granularidade de execução: a planilha da Bárbara, a planilha-ponte do Dia 0, a lista-semente do R09 e a rodada do crawler de 10/09 caem todas em `source='planilha'` ou `'casamentos'`. O identificador de lote já é praticamente exigido pelo "desfazer em 48 h" do RF-BAS-07 e pelos `ingest_jobs` do Apêndice D — falta materializá-lo como dimensão de relatório.
- **No PRD hoje:** Parcial: RF-BAS-10 (source obrigatório), RF-REL-02 (corte por origem), RF-RAD-13 (resposta e autorização por fonte). Corte por lote e conversão com denominador de alvos aprovados, não existem.
- **Risco:** Baixo. O lote não pode virar chave de dedup nem de retenção — a proveniência campo a campo continua em `field_provenance` e a retenção do §10.6 é por titular, não por lote. Não confundir com o irmão do dossiê, "retorno das mídias" e comissionamento por mídia: não há mídia paga antes de 16/11.


### Troca de responsável em massa (a "distribuição de carteira" do supervisor)

- **Esforço:** baixo · **Onde encaixa:** D5, módulo 7.3: antecipar apenas o recorte "edição em massa de responsável" do RF-FUN-09; o resto do RF-FUN-09 e o RF-FUN-11 seguem na v1.
- **O que é:** Função explícita do supervisor na Van Rooy: repartir o lote entre operadores. Atribuição top-down, não auto-serviço.
- **Por que (não) serve:** O gesto que vai faltar no D5, quando os ≥ 300 candidatos aprovados do D4 caírem na caixa de triagem, é banal: selecionar 50 cartões e trocar o responsável de uma vez. A regra de carteira do PRD (Bárbara: espaços, buffets e cerimoniais VIP; Heloísa: demais) é uma divisão por categoria feita uma vez, não rodízio de call center — o round-robin (RF-FUN-11) pode continuar na v1. Sem isso, a alternativa no D5 é editar cartão a cartão ou rodar SQL na mão, e RF-CON-04 é explícito: conversa sem dono é impossível.
- **No PRD hoje:** Parcial e adiado: RF-FUN-09 [v1] (edição em massa de responsável, tags, tier) e RF-FUN-11 [v1] (round-robin por categoria e carga).
- **Risco:** RLS: embaixador não redistribui carteira, e a operação em massa não pode furar as políticas da migração 000500 nem escrever fora do `audit_log` (RF-ADM-03). Toda troca de dono é evento auditado.


### Alarme no instante do evento, restrito a dois gatilhos

- **Esforço:** baixo · **Onde encaixa:** D8, módulo 7.7 (junto de metas e Assistente): push do PWA ou mensagem curta do Número 2, disparado por pg_cron. Se o D8 apertar, vai para a v1 sem perda.
- **O que é:** "Alarmes e avisos para execução de tarefas": o sistema avisa o responsável quando há algo a fazer, em vez de esperar que ele abra a lista. É o único recurso de notificação proativa nomeado pela Van Rooy.
- **Por que (não) serve:** O SLA do KOMUNE é mais apertado que o ritmo dos digests. RF-CON-04 exige primeira resposta humana em 15 min no horário comercial e RF-AST-02 entrega às 07:30, 12:30 (opcional) e 18:00 — três horários não sustentam 15 minutos. RF-MET-04 já define a ordem certa da fila, mas ela só aparece quando a pessoa abre o Meu dia. O app é PWA por requisito não funcional desde o D1, então o canal existe sem integração nova. Os dois itens que não sobrevivem ao ritmo de digest são justamente os dois primeiros da ordenação do RF-MET-04: "parceiro respondeu e está sem resposta há mais de 2 h" e "reunião nas próximas 3 h sem confirmação".
- **No PRD hoje:** Parcial: RF-AST-02/05 (digests e exceções), RF-MET-04 (ordenação com o "porquê"), RF-AGE-06 (lembretes ao parceiro). O canal push ao time, não.
- **Risco:** Fadiga de notificação e risco 15 (Assistente vira vigilância). Ficar nos dois gatilhos, respeitar silêncio fora da janela e nos fins de semana (RF-AST-02) e permitir desligar por pessoa. Prazo estourado nunca gera aviso ao parceiro, só ao time.


### Cartão de objeções na tela de quem está falando (conteúdo sim, script ramificado não)

- **Esforço:** baixo · **Onde encaixa:** v1, módulo 7.4 (RF-CON-05), exibido na ficha (7.3) e no modo rota (7.5). Se sobrar folga no D10, subir a versão estática lendo o seed antes do treinamento de 30 min.
- **O que é:** Roteiro exibido na tela de quem atende, com respostas prontas para as objeções mais comuns (preço, momento, "já tenho", "não sou eu quem decide"), ramificando conforme a resposta.
- **Por que (não) serve:** Adotar o conteúdo e recusar o formato. O KOMUNE tem script farto, mas quase todo do lado do robô: KB fechada (RF-CON-23), validador de promessas (RF-CON-24), 25 intenções e 8 objeções no Apêndice C, templates por segmento no seed, script curto no evento do Calendar (RF-AGE-05) e "o que dizer" no modo rota (RF-ROT-05). Quem faz a ligação D+5 de Tier A/B (RF-CON-13), a visita e a reunião é humano, e as objeções ("8% é muito", "já uso o Casamentos", "não preciso de mais clientes") vivem no PRD e no R08, não no CRM. Entram 2 estagiários e 3 embaixadores, e o RF-ADM-06 promete treinar em 30 min — o custo de rampa é real. Reaproveita `message_templates` (segmento × kind), sem tabela nova; o ciclo se fecha com RF-REL-04, que já extrai as objeções mais citadas das notas.
- **No PRD hoje:** Parcial e invertido: o conteúdo existe (RF-CON-23, Apêndice C, R08, seed) e as respostas prontas estão em RF-CON-05 [v1]; a superfície para o humano e a realimentação por RF-REL-04, não.
- **Risco:** Roteiro ramificado lido literalmente contradiz o princípio 2.5.4 e a pergunta "soou robô?" da amostragem semanal (RF-CON-28). Toda resposta sugerida passa pela FAQ aprovada por Dennis (§13.6) e pelo validador (RF-CON-24), senão a promessa fora da base entra por outra porta, sem log. E nada disso vira áudio: áudio é sempre voz real da Heloísa.


### Registro de checagem de cadastros de bloqueio de telemarketing (e regra de DDD na expansão)

- **Esforço:** baixo · **Onde encaixa:** v1, módulo 7.9, dentro de RF-ADM-04 e da atividade G4 (LIA, aviso de privacidade e termos com o advogado): campo `telemarketing_block_checked_at` + item de checklist. Na v2, regra de DDD bloqueado por cidade junto do multi-cidade.
- **O que é:** Antes de a lista ir para a rua, cruzá-la com os cadastros de bloqueio — "Não Me Perturbe" (Anatel), "Não Me Ligue" (Procon) —, cujo descumprimento é sancionado; na expansão, a Lei paulista 17.832/2023, que alcança expressamente mensagens de aplicativos associadas à linha.
- **Por que (não) serve:** Fecha uma pendência que o próprio PRD deixou aberta: §13, pergunta 15 ("existe cadastro estadual/municipal de bloqueio de telemarketing no RN que alcance mensagens de aplicativo?"). A `suppression_list` do RF-ADM-04 é interna — só quem já pediu para sair. RF-CON-13 prevê ligação D+5 com 2 tentativas para Tiers A e B, e é o telefone que esses cadastros alcançam. E o multi-cidade está no modelo de dados desde o início (princípio 2.5.9) e chega na v2: a regra tem de nascer com ele, senão o primeiro contato frio em DDD 11–19 sai sem checagem. Custo quase zero: um campo, um item no checklist antes de habilitar o canal telefônico e um parágrafo na LIA.
- **No PRD hoje:** Não existe. RF-ADM-04 cobre só a supressão interna. Consta como pergunta em aberto na §13 (item 15).
- **Risco:** Não prometer automação: esses cadastros não expõem consulta pública em massa, e a cobertura deles para telefone comercial B2B é discutível. É decisão de Dennis com o advogado; o CRM só registra que a checagem foi feita, por quem e quando. Não confundir com a validação de existência de WhatsApp (RF-RAD-07), que continua pendente de aprovação (§13.10).


### Barra de completude de qualificação: o SPACE mostrando o que ainda não se sabe

- **Esforço:** baixo · **Onde encaixa:** v1, módulos 7.3 (ficha) e 7.7 (ordenação do Meu dia): view `qualification_completeness` sobre os campos SPACE, alimentando o resumo por IA (RF-FUN-07). Sem campo novo de entrada.
- **O que é:** O "database marketing" da Van Rooy, na parte defensável: a captação de informação durante o atendimento serve para acumular deliberadamente um perfil do prospect, e não só para registrar a conversa.
- **Por que (não) serve:** O KOMUNE já faz exatamente isso do outro lado do balcão — completude 0–100 com itens faltantes e "próximo passo" no perfil do fornecedor (RF-PRE-09, RF-PRE-16). Falta o espelho no alvo. Hoje o SPACE define os campos (§5.3, RF-FUN-04), `organizations.custom` guarda e a IA preenche a partir da conversa, mas nada mostra o buraco. Com uma barra, a fila do RF-MET-04 pode ordenar por "quente sem decisor identificado" e a porta aberta vira coleta dirigida em vez de conversa solta. Em 450 alvos, saber quem decide vale mais que volume de toques.
- **No PRD hoje:** Parcial: SPACE existe como checklist (§5.3, RF-FUN-04) e RF-PRE-09 é o mesmo mecanismo aplicado ao perfil na plataforma. A completude do lado do alvo, não.
- **Risco:** Não pode virar formulário bloqueante — RF-FUN-04 é explícito que o SPACE não trava o agendamento feito pelo robô. E coletar só o que a LIA cobre e a whitelist do Radar permite (RF-PRE-03): nada de dado de cliente do fornecedor. Barra bonita não é justificativa para guardar mais um campo.


### Um número de prazo no relatório: % de próximas ações no prazo e mediana de atraso

- **Esforço:** baixo · **Onde encaixa:** v1, módulo 7.8: definição de cálculo dentro de RF-REL-06, exposta no relatório de segunda (RF-REL-09) e no Metabase. Nenhuma tabela nova.
- **O que é:** Toda pendência nasce com relógio; o painel classifica em solucionado dentro/fora do prazo e mostra o tempo médio de solução. É a única coisa do site da Van Rooy que usa a palavra dashboard.
- **Por que (não) serve:** O conceito já existe no PRD com outro nome e em forma melhor (SLA por etapa com cartão apodrecendo em RF-FUN-02/03; tempo por etapa em RF-REL-04; SLA de primeira resposta em RF-CON-04). O acréscimo defensável é estreito: RF-MET-01 define "follow-ups em dia" e RF-REL-06 lista a métrica, mas nenhum dos dois define o cálculo — e `tasks` já tem `due_at` e `completed_at`, então é uma view. Aqui o cruzamento queria colunas derivadas e painel próprio já no D3/D9; venceu o crítico, porque duas taxonomias de prazo produzem dois números que discordam.
- **No PRD hoje:** Sim, sem fórmula: RF-MET-01 ("follow-ups em dia"), RF-REL-06 (produtividade por pessoa), RF-FUN-02/03 e RF-CON-04.
- **Risco:** Diferença de natureza que precisa ficar escrita: o prazo da Van Rooy é de chamado, com um cliente esperando; o nosso é de iniciativa comercial, sem ninguém do outro lado. É SLA interno, nunca contratual, nunca ranking público entre pessoas (RF-MET-09, RF-AST-06, risco 15).


### Evento próprio como entidade, com lista de convidados

- **Esforço:** baixo · **Onde encaixa:** v1, módulos 7.4 e 7.3: `events` (data, tipo, categorias-alvo, dono) + `event_invites` ligadas a `organizations` e `activities`.
- **O que é:** Do módulo Marketing da Van Rooy, a única peça que sobrevive: "controle de eventos, divulgação e gerenciamento" — planejar o evento, convidar a base e acompanhar quem foi, confirmou e apareceu.
- **Por que (não) serve:** Cobre um buraco concreto. Eventos próprios aparecem quatro vezes no PRD como texto e nenhuma como registro: gancho obrigatório de reativação (RF-CON-15 exige `gancho` preenchido e nomeia "evento próprio"), primeira fonte do lead garantido (RF-PRE-14), evento demo de sábado (§5.5) e evento-piloto do produtor; a Founders Night de 19/11 está no roadmap. Sem tabela, "convidei para o evento" é nota solta e a reativação perde o gancho auditável que a própria regra exige. Com quatro campos, o convite vira atividade rastreável, o comparecimento vira porta aberta (RF-MET-01) e o ciclo "quem convidei / quem veio / quem publicou" fecha.
- **No PRD hoje:** Não existe como entidade — o Apêndice D não tem tabela de evento. Citado em RF-CON-15, RF-PRE-14 e §5.5.
- **Risco:** Escopo: gerir eventos é o negócio do cliente da KOMUNE e o não-objetivo "ERP de eventos" (§3.3, risco 13). Quatro campos e uma lista de convidados; nada de agenda de produção, fornecedores do evento ou financeiro.


### Uma pergunta de satisfação em D+30 pós-publicação

- **Esforço:** baixo · **Onde encaixa:** v1, módulo 7.6: pendurada como mais um gatilho do RF-PRE-15, com o resultado no relatório de segunda (7.8).
- **O que é:** Da Van Rooy: pesquisa de satisfação aplicada pelo próprio CRM, cujo resultado volta como relatório do supervisor. Aqui, uma pergunta só, não um construtor de questionários.
- **Por que (não) serve:** O construtor morre nas duas análises: a pesquisa de qualificação já existe e se chama SPACE, e um editor de formulários é infraestrutura para um problema que não temos. Sobra um recorte fino: o risco 3 (fornecedor publica e não recebe oportunidade) é alta probabilidade e alto impacto, e a ligação de feedback do RF-PRE-14 é disparada pelo desfecho de um lead — quem publicou e não recebeu nada fica sem sinal direto. RF-PRE-15 já tem o gatilho de "sem lead em 14/21/30 dias" e "sem interação 14 dias"; falta a pergunta que transforma o gatilho em dado de churn de supply antes de ele acontecer.
- **No PRD hoje:** Quase todo: SPACE (§5.3, RF-FUN-04) para qualificação, RF-PRE-14 (ligação de feedback com nota 0–10), RF-PRE-15 (gatilhos de CS), RF-AST-03 e RF-CON-28 para o time. A pergunta ao publicado sem lead, não.
- **Risco:** Cada pergunta é mensagem proativa e consome teto do número ou template pago. Só para fornecedor já publicado (relação existente, template de utilidade) ou dentro de janela aberta. Pesquisa a alvo frio é toque extra fora da cadência 1+1 — proibir por regra, não por disciplina.


### Previsão de funil por conversão histórica de etapa (e não por probabilidade digitada)

- **Esforço:** medio · **Onde encaixa:** v2, módulo 7.8: view sobre `deal_stage_history`, sem campo novo de entrada.
- **O que é:** O pipeline da Van Rooy chama-se ciclo: cada um tem posição, fase, valor e probabilidade em %, e o relatório plota valor × probabilidade.
- **Por que (não) serve:** Discordância resolvida pela metade. Não há valor por negócio para ponderar (a receita é 8% de uma transação futura) e probabilidade digitada pelo vendedor é o campo mais fantasioso de qualquer CRM — nisso venceu o crítico, e essa parte é recusa expressa. Mas a §11.4 já promete "previsão de funil" para a v2, e a forma certa de entregá-la é a conversão histórica medida em `deal_stage_history`, que já existe: "37 negócios em Em conversa × 22% de conversão histórica = 8 publicações" complementa o burn-up do RF-REL-05, que hoje só extrapola pela velocidade das duas últimas semanas. O peso equivalente ao valor monetário, aqui, é a categoria em déficit (RF-REL-03), não R$.
- **No PRD hoje:** Sim, sem forma definida: §6 e §11.4 listam "previsão de funil e alertas por etapa" na v2; RF-REL-05 projeta por velocidade; RF-FUN-08 e RF-REL-04 dão a matéria-prima.
- **Risco:** Amostra pequena: mostrar faixa e n, nunca número seco, ou o time decide verba em cima de 6 negócios. E duas previsões que discordam é pior que uma — a projeção do RF-REL-05 continua sendo a oficial do burn-up. Recusa expressa junto: "Duplicidade" como motivo de fechamento, como faz a Van Rooy; duplicata é higiene da caixa de triagem (§5.2) e envenena o relatório de motivos (RF-REL-04).


## Descartar (e por quê) (7)


### Trocar o eixo do produto para "contato + pendência" no lugar de "negócio com próxima ação"

- **Esforço:** alto · **Onde encaixa:** nenhum
- **O que é:** A dedução central do dossiê: a Van Rooy não vende pipeline, vende operação de contato; a unidade não é o negócio, é o contato com resultado codificado e a pendência com prazo, e campanha, carteira, produtividade e SLA derivam dessas duas entidades.
- **Por que (não) serve:** Não serve, e é a recusa mais importante da lista porque é a mais sedutora. O PRD escolheu o outro eixo de propósito e com justificativa nos benchmarks (§2.4, R01): um negócio por organização por funil, etapa com critério de entrada verificável, dono e SLA, próxima ação obrigatória como regra de sistema (RF-FUN-01/03, princípio 2.5.5). O motivo é a meta: não perseguimos volume de contato, perseguimos 100 fornecedores publicados até 06/11 e 70% deles com lead respondido, e a ativação do funil 2 é estado do parceiro alimentado por eventos da plataforma (RF-PRE-13), não sequência de contatos. Aceitar o eixo deles a dez dias do MVP obrigaria a refazer kanban, temperatura, metas e relatórios. Tudo o que a tese tem de bom já está nos itens 1 e 2 desta lista, sem tocar no eixo.
- **No PRD hoje:** §5.1, §2.4, RF-FUN-01/03 e RF-MET-01 definem o eixo oposto, e o CLAUDE.md manda parar e perguntar antes de mudar decisão fechada.
- **Risco:** Riscos 13 e 20 (escopo e prazo). Se alguém quiser testar a tese, o teste barato é medir depois de duas semanas quantos negócios abertos ficam sem próxima ação (meta 0%, §3.2): se o número for alto, o problema é de disciplina, não de modelo de dados.


### Campanha ativa e lote de discagem como unidade organizadora do trabalho

- **Esforço:** medio · **Onde encaixa:** nenhum
- **O que é:** Monta-se a campanha selecionando público por critério na base ou importando um mailing externo; vira um lote distribuído entre os operadores, com resultado medido por lote.
- **Por que (não) serve:** O mecanismo de trabalho em massa não tem para onde escoar. O número tem teto de 20 primeiros contatos na semana 1, 35 na 2 e 40 a 60 depois (RF-CON-10), e o primeiro contato é assistido, disparado pela Heloísa com no máximo dois aparelhos vinculados (risco 18) — um lote de 300 nomes é uma fila de duas semanas. A versão certa já existe e é melhor: a fila diária das 06:00, ordenada por tier, categoria em déficit e zona do dia, com revisão item a item (RF-CON-08), que respeita o teto por construção. E "importar mailing externo" é, na nossa realidade, comprar lista — a conduta punida na primeira multa da ANPD (Telekall) e que o R06 manda evitar; as nossas listas nascem do Radar pela esteira `raw_capture → source_record → supplier_candidate` (ADR-08), com proveniência por campo. Note-se que a métrica boa desse bloco, o aproveitamento por lote, foi salva no item 4 sem trazer o lote como unidade de trabalho.
- **No PRD hoje:** RF-CON-08 (fila diária) e §5.2 (caixa de triagem) resolvem o problema real; campanha/lote como unidade não existe e não deve existir.
- **Risco:** Adotar campanha e lote reintroduz o disparo em massa pela porta dos fundos e reabre o modo automático (RF-CON-09), que está fora do MVP atrás de feature flag desligada e depende de parecer sobre a política de opt-in da Meta (§13.9).


### Aparato de call center: discador/CTI/preditivo/AMD, PA, gravação e escuta, painel ao vivo de TMA/TMO

- **Esforço:** alto · **Onde encaixa:** nenhum
- **O que é:** Discagem automática vendida como módulo CTI à parte, AMD descartando caixa postal, PA como unidade de dimensionamento, gravação de todas as chamadas com escuta, sussurro e intervenção do supervisor, e painel em tempo real com quem está em ligação, em pausa e ocioso.
- **Por que (não) serve:** Nenhuma parte fecha conta aqui. Não há telefonia no produto: a ligação é tarefa humana da cadência (RF-CON-13, D+5, duas tentativas, só Tiers A e B), o que dá uma ou duas dezenas por dia no time inteiro — discador se paga a partir de centenas por operador. Telemarketing ativo por voz ainda exige o prefixo 0303, que destruiria a taxa de atendimento de um contato que queremos que soe pessoal. Gravar e escutar é tratamento novo de dado pessoal (a voz do fornecedor) sem base legal preparada, somado a monitoramento de empregado: colide com o guardrail de aviso aos dois lados, com RF-AST-06 e com o risco 15, e exigiria termo com a equipe e retenção própria de áudio — muito custo jurídico para ~2 ligações por pessoa por dia. TMA e TMO medem ocupação de fila; a nossa unidade é porta aberta com resultado registrado, limitada de propósito a 1 por alvo a cada 30 dias justamente para impedir a lógica de volume. O loop de qualidade que a gravação existiria para criar já existe sem gravar ninguém: amostragem semanal de 30 conversas com nota (RF-CON-28) e feedback de sexta (RF-AST-03). Achado que reforça a recusa: a própria Van Rooy vende o CTI como módulo pago à parte e não menciona gravação, escuta nem PA em nenhuma página — o núcleo de valor dela são os itens 1 e 10 desta lista.
- **No PRD hoje:** Não existe e é incompatível com ADR-05, ADR-06 e RF-CON-08/10. A necessidade legítima está coberta por RF-CON-28 e RF-REL-06.
- **Risco:** Anatel (0303), LGPD (voz e monitoramento de empregado), risco 15 e risco 13. Qualquer automação de disparo sobre a Cloud API leva a queda de quality rating e banimento do número "Heloísa · Komune".


### Database marketing: acumular perfil do prospect para campanhas futuras

- **Esforço:** alto · **Onde encaixa:** nenhum
- **O que é:** Conceito central do produto deles: a informação captada no atendimento alimenta uma base de conhecimento do cliente/prospect que depois vira insumo de campanhas direcionadas e segmentação por porte e hábito de compra.
- **Por que (não) serve:** Não serve, e é o descarte mais importante do ponto de vista legal. A nossa coleta tem uma finalidade só — falar com o fornecedor sobre entrar na Komune — e é essa finalidade específica que sustenta o legítimo interesse documentado na LIA (R06). Acumular perfil "para campanhas futuras" é finalidade nova, não coberta, e bate de frente com três coisas já decididas: a whitelist de dados factuais do Radar (RF-PRE-03), a retenção do §10.6 (contatado sem resposta anonimizado em 6 meses; nunca contatado apagado em 90 dias) e o princípio 2.5.10. No plano prático, em 450 alvos o valor marginal de um perfil rico é zero: quem define a ordem de ataque é o score de lacuna de oferta recalculado todo dia (Apêndice A, §5.7). Atenção para não confundir com o item 9 desta lista: completude do SPACE é coleta dirigida à conversa em curso, dentro da whitelist e da retenção — o oposto de acúmulo especulativo.
- **No PRD hoje:** Não existe, e é deliberado: §10.6 e RF-PRE-03 desenham o oposto.
- **Risco:** Passivo em cada pedido de titular (RF-ADM-04) e contaminação da resposta pronta "de onde pegaram meu número?", que precisa apontar um `source_url` específico. Acumular ou negociar base sem base legal documentada é exatamente a conduta da primeira multa aplicada pela ANPD.


### Módulo Marketing com disparo segmentado multicanal (e-mail, SMS, WhatsApp, mala direta)

- **Esforço:** alto · **Onde encaixa:** nenhum
- **O que é:** Segmentar a base e disparar comunicação direcionada por e-mail, SMS, WhatsApp e correspondência, com relatório de resultado por campanha.
- **Por que (não) serve:** A lógica "do segmento sai a fila de trabalho" já é o que fazemos — a fila diária das 06:00 (RF-CON-08), montada por tier, categoria em déficit e zona, com revisão humana item a item, e a segmentação salva em visões (RF-BAS-13, RF-RAD-12). Transformar isso em campanha de disparo é trocar 450 conversas personalizadas por 450 mensagens iguais: o oposto da tese do produto e o caminho mais curto para bloqueios acima de 2% e pausa automática do número (RF-CON-10, O8). "Campanhas de marketing em massa" é não-objetivo declarado (§3.3), e disparar WhatsApp segmentado é literalmente o modo automático (RF-CON-09), congelado atrás de feature flag e condicionado a parecer (§13.9). SMS para número raspado é pior que WhatsApp: sem janela de 24 h, sem opt-in registrável, sem saída nativa. Mala direta exige endereço postal, que a whitelist do Radar nem coleta.
- **No PRD hoje:** Segmentação: RF-BAS-13, RF-RAD-12. Disparo: RF-CON-09, deliberadamente desligado e fora do MVP; a alternativa desenhada é a reativação com gancho obrigatório (RF-CON-15).
- **Risco:** Política de opt-in da Meta para contato sem interação prévia, queda do quality rating e banimento (risco 2), violação do ADR-05, e dano de reputação junto ao próprio público que a KOMUNE quer conquistar (§2.3). Envio em massa sem gancho ainda enfraquece o legítimo interesse que sustenta toda a prospecção.


### BackOffice/ERP, pedido lançado na ligação, TEF e análise de crédito por birô

- **Esforço:** alto · **Onde encaixa:** nenhum
- **O que é:** ERP acoplado ao CRM — faturamento, NF-e, boleto e retorno bancário, contas a pagar e receber, estoque, expedição, comissão, fluxo de caixa — mais pedido lançado durante a ligação com validação de CPF e cartão, integração TEF e etapa de liberação financeira com consulta a birô de crédito.
- **Por que (não) serve:** Duplamente fora. Ser ERP de eventos é não-objetivo explícito (§3.3) e o ADR-09 com o RF-PRE-04 proíbem CPF, CNPJ de faturamento, Pix e dados bancários dentro do CRM — esses dados nascem na plataforma e o CRM só recebe o evento `wallet_ready`. A KOMUNE não vende produto dentro da ligação: recruta fornecedor para um marketplace onde o dinheiro corre na plataforma, com 8% cobrados só quando fecha, então não há risco de crédito a mitigar; consultar birô sobre alguém que nem é cliente e cujo MEI é pessoa natural é tratamento invasivo e desproporcional, que não passa no teste de balanceamento da LIA. O único fragmento aproveitável do bloco — validação de integridade no ato da captura — já existe em versão mais forte (RF-BAS-05/08, migração 000300) e o que faltava virou o item 3 desta lista.
- **No PRD hoje:** §3.3, ADR-09 e RF-PRE-04 decidiram o contrário por escrito; a migração 000300 já tem constraint recusando chaves de CPF, Pix, conta e cartão em `organizations.custom`.
- **Risco:** Escopo (riscos 13 e 20, a dez dias do MVP) e criação exatamente do passivo de dados que o produto foi desenhado para não ter. Reabrir isso quebra decisão fechada — o CLAUDE.md manda parar e perguntar antes de mexer num ADR.


### SAT: chamado com patologia, prazo de garantia, procedência e custo por fornecedor

- **Esforço:** alto · **Onde encaixa:** nenhum
- **O que é:** O ciclo da incorporadora: cliente alega defeito, o sistema classifica a patologia, confere o prazo de garantia, julga procedência e, sendo procedente, registra fornecedor responsável, insumos, custos e prazo acordado, com vistoria, SMS ao cliente e painel de dentro/fora do prazo.
- **Por que (não) serve:** O vocabulário não transfere: o "fornecedor" da Van Rooy é o prestador que conserta o defeito; o nosso é o alvo que se quer recrutar. Não há obra, garantia, defeito procedente nem insumo a custear. As três peças com paralelo real já têm equivalente melhor: abertura de chamado por dois canais é o roteamento de suporte a parceiros publicados, com SLA de 1 h em dia de evento (RF-CON-07); o portal de autoatendimento é o link de reivindicação com as telas T1–T8 (RF-PRE-07/08); o SMS em pontos do fluxo é a cadência de onboarding por WhatsApp (RF-CON-16) e os gatilhos de CS (RF-PRE-15); e o painel de dentro/fora do prazo virou o item 10 desta lista. Sobra o motor de julgamento de patologia, que é específico de incorporadora — e boa parte do encanto desse bloco no dossiê vem de ser a única página da Van Rooy que usa a palavra dashboard, o que não é argumento.
- **No PRD hoje:** RF-CON-07, RF-PRE-07/08, RF-PRE-10 (curadoria com motivos padronizados) e RF-PRE-15 cobrem as necessidades reais; o resto não existe e não deve.
- **Risco:** Escopo, e um "portal de abertura de chamado" concorreria com o painel de parceiros da Komune, que §3.3 diz explicitamente que o CRM não substitui. Junto vai o construtor de pesquisas do mesmo pacote: com cinco perguntas fixas que não mudam (SPACE) e ~100 publicados até 06/11, é infraestrutura para um problema inexistente — o recorte que sobrevive é o item 12.


## Fontes lidas

- https://www.vanrooy.com.br/
- https://www.vanrooy.com.br/crm-van-rooy
- https://www.vanrooy.com.br/televendas-van-rooy
- https://www.vanrooy.com.br/sat-affinity
- https://www.vanrooy.com.br/televendas
- https://www.vanrooy.com.br/incorporadoras
- https://www.vanrooy.com.br/industria
- https://www.vanrooy.com.br/empresa
- https://www.vanrooy.com.br/clientes
- https://www.vanrooy.com.br/contato
- https://www.vanrooy.com.br/sitemap.xml
- https://www.vanrooy.com.br/pages-sitemap.xml
- https://www.vanrooy.com.br/robots.txt
- https://web.archive.org/web/20131115051338/http://www.vanrooy.com.br/wp/home/call-solution-crm-e-telemarketing/
- https://web.archive.org/web/20131115051359/http://www.vanrooy.com.br/wp/home/dynamics-crm/
- https://web.archive.org/web/20131115051430/http://www.vanrooy.com.br/wp/produtos/sistemas-sob-medida/
- https://web.archive.org/web/20131114034943/http://www.vanrooy.com.br/wp/clientes-3
- https://web.archive.org/web/20131115072415/http://www.vanrooy.com.br/wp/catalogo-van-rooy/
- https://web.archive.org/web/20021217053801/http://www.vanrooy.com.br/produto/vanrooy_callsolution.shtml
- https://web.archive.org/web/20021216234415/http://www.vanrooy.com.br/produto/vanrooy_produto.shtml
- https://web.archive.org/web/20010421024039/http://www.vanrooy.com.br/sistemas/mkt_total.htm
- https://web.archive.org/web/20010421024028/http://www.vanrooy.com.br/sistemas/vendas.htm
- https://web.archive.org/web/20010414195552/http://www.vanrooy.com.br/soft.htm
- https://www.linkedin.com/company/van-rooy-informatica
- http://web.archive.org/web/20021217053801id_/http://www.vanrooy.com.br/produto/vanrooy_callsolution.shtml
- http://web.archive.org/web/20010421024039id_/http://www.vanrooy.com.br/sistemas/mkt_total.htm
- http://web.archive.org/web/20010421024028id_/http://www.vanrooy.com.br/sistemas/vendas.htm
- http://web.archive.org/web/20010421023533id_/http://www.vanrooy.com.br/sistemas/especif.htm
- http://web.archive.org/web/20131115051338id_/http://www.vanrooy.com.br/wp/home/call-solution-crm-e-telemarketing/
- https://web.archive.org/web/20131115051359id_/http://www.vanrooy.com.br/wp/home/dynamics-crm/
- https://web.archive.org/web/20131115051430id_/http://www.vanrooy.com.br/wp/produtos/sistemas-sob-medida/
- https://web.archive.org/web/20131114034943id_/http://www.vanrooy.com.br/wp/clientes-3
- https://web.archive.org/web/20131115072415id_/http://www.vanrooy.com.br/wp/catalogo-van-rooy/
- https://web.archive.org/web/20190125085735id_/http://www.vanrooy.com.br/wp/wp-content/uploads/2012/07/Grafico-Ciclo-Call-Soluton.jpg
- https://web.archive.org/cdx/search/cdx?url=vanrooy.com.br&matchType=domain
- https://www.infojobs.com.br/empresa-lh-van-rooy-informatica-ltda-me__339846.aspx
- http://web.archive.org/cdx/search/cdx?url=vanrooy.com.br*&output=text&fl=original,timestamp,statuscode&collapse=urlkey&limit=300
- http://web.archive.org/web/20021217053801/http://www.vanrooy.com.br/produto/vanrooy_callsolution.shtml
- http://web.archive.org/web/20010421024039/http://www.vanrooy.com.br/sistemas/mkt_total.htm
- http://web.archive.org/web/20010421024028/http://www.vanrooy.com.br/sistemas/vendas.htm
- http://web.archive.org/web/20010421023533/http://www.vanrooy.com.br/sistemas/especif.htm
- http://web.archive.org/web/20131115051338/http://www.vanrooy.com.br/wp/home/call-solution-crm-e-telemarketing/
- http://web.archive.org/web/20131115051359/http://www.vanrooy.com.br/wp/home/dynamics-crm/
- http://web.archive.org/web/20131115051430/http://www.vanrooy.com.br/wp/produtos/sistemas-sob-medida/
- http://web.archive.org/web/20131114034943/http://www.vanrooy.com.br/wp/clientes-3
- http://web.archive.org/web/20131115025908/http://www.vanrooy.com.br/wp/parceiros-2/
- http://web.archive.org/web/20131115072415/http://www.vanrooy.com.br/wp/catalogo-van-rooy/
- https://www.crunchbase.com/organization/van-rooy
- https://www.zoominfo.com/c/van-rooy-com-e-informtica-ltda-crm/474306874
- https://www.quemfornece.com/fornecedor/van-rooy-comercio-e-informatica
- https://www.reclameaqui.com.br/empresa/van-rooy-comercio-e-informatica-ltda/sobre/
- https://cnpja.com/office/04855296000183
- https://3cplusnow.com/funcionalidades-de-um-software-para-call-center/
- https://3cplusnow.com/higienizacao-do-mailing-por-que-ela-e-tao-importante-nas-operacoes/
- https://3cplusnow.com/avaliacao-de-funcionarios-indicadores-de-performance/
- https://www.televendasecobranca.com.br/discador-e-discagem/discador-progressivo-power-de-chamadas-o-que-voce-deve-saber-sobre-96607/
- https://www.callix.com.br/melhores-praticas/o-que-e-renitencia-entenda-como-funciona-no-call-center/
- https://www.callix.com.br/atendimento/monitoria-de-qualidade-em-call-center-entenda-como-fazer/
- https://www.procon.sp.gov.br/bloqueio-de-telemarketing-2/
- https://proxis.com.br/pa-ura-tla-conheca-o-glossario-das-siglas-de-atendimento/
- https://www.eox.com.br/vendas/indicadores-de-call-center/amp/
- https://www.agendor.com.br/blog/script-de-abordagem-vendas-por-telefone/
- https://www.nvoip.com.br/blog/script-de-vendas-por-telefone/
- https://www.goto.com/pt/connect/contact-center/features/call-monitoring
- https://docs.tactium.com.br/cat-faq/discador/
- https://twsolutions.com.br/tabulacao-de-atendimento/
- https://docs.smartspace.com.br/docs/guia-do-administrador/contact-center/callback-agendado/
- https://exame.com/brasil/anatel-deixa-de-exigir-uso-do-prefixo-0303-em-ligacoes-de-telemarketing/