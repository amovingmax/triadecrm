# 07 — Módulo de Produtividade Comercial do CRM KOMUNE

**Escopo:** metas, agenda, rotas, agente de cobrança ("IA secretária"), registro rápido de atividades e relatórios do ritual semanal.
**Data da pesquisa:** 03/09/2026. Preços e limites citados foram lidos nas páginas oficiais ou em reviews datados de 2026 (ver seção 9 — Fontes). Valores em USD; conversões em R$ são apenas hipóteses de planejamento (câmbio assumido de R$ 5,50/US$).
**Contexto de partida:** `00-brief-contexto.md` — equipe de 7 pessoas, meta de 3 "portas"/dia por pessoa, manhã com vídeo-chamadas (Meet), tarde com rota externa (~4 visitas), tarefas no Asana, Google Calendar disponível, reunião de growth às segundas com relatório automático às 8h, preferência por ferramentas gratuitas/open source e infra própria (Supabase + máquinas locais).

---

## 0. Resumo executivo (o que a pesquisa muda no desenho)

1. **Comprar não compensa; construir é barato.** As ferramentas de referência custam, por usuário/mês: Badger Maps US$ 58–95, Map My Customers US$ 105, SalesRabbit US$ 49–75, Route4Me ~US$ 199–349, Ambition US$ 45–75, SalesScreen ~US$ 25. Para 7 pessoas, só o combo "rota + gamificação" ficaria em US$ 700–1.200/mês. Com Supabase (já contratado), PostGIS, OSRM/VROOM ou o free tier do Google Maps, Google Calendar API, WhatsApp e um LLM barato, o módulo inteiro roda por **menos de US$ 10/mês** de serviços externos (seção 7).
2. **O free tier do Google Maps Platform cobre o caso KOMUNE.** Compute Routes/Route Matrix (Essentials) tem 10.000 chamadas grátis/mês; o Route Optimization API tem 1.000 "shipments" grátis/mês. Sete rotas de 4 visitas por dia útil consomem ~150 matrizes e ~620 shipments/mês — zero custo. OSRM + VROOM (BSD-2) são a alternativa 100% local para a máquina dedicada.
3. **Agenda: usar a Google Calendar API diretamente, não um Calendly.** Criar evento com Meet é um `POST events?conferenceDataVersion=1` com `conferenceSolutionKey.type = "hangoutsMeet"`; conflitos se resolvem com `freeBusy.query`. O open source do Cal.com virou "Cal.diy" (MIT), que a própria Cal.com descreve como "estritamente recomendado para uso pessoal, não produtivo"; Calendly grátis não tem lembretes automáticos nem API. O motor de slots próprio (manhã = vídeo, tarde = visita por zona) é pequeno e é o que o robô de WhatsApp precisa para marcar sozinho.
4. **Lembretes ao fornecedor por WhatsApp custam centavos, mas exigem dois números.** Na API oficial (Cloud API), o Brasil paga por mensagem: utility US$ 0,0068, marketing US$ 0,0625; respostas dentro da janela de 24 h são grátis. Um número não pode ser ao mesmo tempo Cloud API e "número de app" (Evolution/Baileys). Recomendação: número humano (Heloísa) na instância não oficial com regras anti-banimento (20–50 msgs/dia no início, 80–200 depois, atrasos aleatórios de 10–45 s) e número "Komune Agenda" na Cloud API para lembretes/confirmações com template utility. Digests internos do time vão pelo número interno (volume mínimo) ou Telegram como reserva.
5. **Metas com definição rígida de "porta" e antimanipulação.** Pipedrive/HubSpot só oferecem metas semanais/mensais e atividades genéricas; a KOMUNE precisa de contadores diários por pessoa em cinco métricas (portas abertas, conversas, reuniões, cadastros, publicações) com regras de contagem (uma porta por alvo a cada 30 dias, só com resultado registrado). Gamificação: leaderboard balanceado (Lei de Goodhart é o risco citado por toda a literatura), streaks e reconhecimento de "meio de tabela" (padrão Spinify), sem ranking público de quem está por último.
6. **Agente de cobrança = standup assíncrono + feedback de resultado.** O padrão Geekbot/Range (perguntas fixas em horário fixo, lembrete a quem não respondeu, resumo ao gestor) traduzido para WhatsApp em três momentos: 07:30 ("sua lista"), 18:00 ("o que faltou") e segunda 08:00 (relatório da semana). Tom: fatos + pergunta sobre bloqueio, nunca vergonha; escalonamento para Rafael só após 2 dias consecutivos abaixo da meta, com regra pública e distinção entre "não fez" e "não registrou". Asana entra por `GET /tasks?assignee=…&completed_since=now` (funciona sem plano premium) e webhooks.
7. **Registro em 30 segundos é a métrica-mãe do módulo.** Nota de voz pelo próprio WhatsApp → transcrição (faster-whisper local a custo zero, ou Gemini 3.5 Flash-Lite a ~US$ 0,0005/min, ou gpt-4o-mini-transcribe a US$ 0,003/min) → extração estruturada por LLM (Claude Haiku 4.5: US$ 1/US$ 5 por milhão de tokens) → um toque para confirmar. Cartão de visita/Instagram por foto: Claude Vision ou Google Vision OCR (1.000 unidades grátis/mês).
8. **Relatório de segunda 8h = burn-up + densidade por categoria.** Burn-up (linha de escopo 100 fornecedores + linha de concluídos) com projeção por velocidade das últimas 2 semanas; hoje são ~2 publicados e o KR1 (100 perfis completos até 06/11) exige ~2,2 publicações por dia útil — o relatório precisa dizer isso toda semana.

---

## 1. Roteirização de visitas (submódulo Rotas)

### 1.1 O que as ferramentas de field sales fazem (referência)

| Ferramenta | Preço 2026 (por usuário/mês) | O que faz de relevante |
|---|---|---|
| **Badger Maps** | Business US$ 58 (anual) / US$ 69 (mensal); Enterprise US$ 95 / US$ 109 | Otimização de rota até 100–120 paradas, "Lasso" (circula clientes no mapa e gera rota), check-in do rep, sincronização com CRM, leaderboards. Considerada "campeã de otimização de rota" para gestão de carteira, não para porta-a-porta frio. |
| **Map My Customers** | Personal US$ 60 (flat); Team US$ 105/usuário | Otimização de rota, check-ins, registro de atividades e relatórios, agrupamento visual, integração com CRM (bidirecional só no Team), API no Team. |
| **SalesRabbit** | Team US$ 59 (mensal); Pro US$ 49 (anual) / US$ 75 (mensal); Enterprise sob consulta | Feito para porta-a-porta: áreas/territórios, pins, disposição de leads, GPS/check-in, gamificação e leaderboards fortes, contratos digitais no app. |
| **Route4Me** | ~US$ 199 / 299 / 349 por usuário (sem preço público) + app mobile ~US$ 9,99 + add-ons (geofencing, SMS, recorrência) | Logística de frota; excesso de recursos e custo para 7 pessoas. |

**Lições de produto que valem para a KOMUNE:** (a) a rota nasce de um filtro no mapa (zona + categoria + etapa), não de digitação; (b) check-in geolocalizado é o "comprovante" da visita e o gatilho do formulário de resultado; (c) o app é mobile-first e o desktop serve para planejar; (d) leaderboards são parte do módulo de rota nas ferramentas de porta-a-porta.

### 1.2 Motores de cálculo de rota (opções e custos)

| Opção | Custo | Quando usar |
|---|---|---|
| **Google Routes API — Compute Route Matrix (Essentials)** | 10.000 chamadas grátis/mês; depois US$ 5,00/1.000 (cai a US$ 0,38 em volume). Compute Routes idem. Directions/Distance Matrix (legado) 10.000 grátis, US$ 5,00/1.000. | Matriz de tempos entre 1 origem + 4–6 alvos (25–49 elementos) para ordenar a tarde. Trânsito real de Natal. Uso da KOMUNE (~150 matrizes/mês) fica dentro do grátis. |
| **Google Route Optimization API** (SKU Single Vehicle Routing / Fleet Routing) | Cobrado **por shipment**; Fleet Routing: 1.000 grátis/mês, depois US$ 30/1.000 (cai a US$ 2,10). | Só se quiser janelas de horário + várias pessoas otimizadas juntas. 7 pessoas × 4 visitas × 22 dias = ~620 shipments/mês — ainda grátis. Exagero para o MVP. |
| **OSRM** (BSD-2, self-hosted) | R$ 0 (CPU/RAM na máquina dedicada; extrato OSM do RN é pequeno) | Serviços `table` (matriz de duração/distância), `trip` (TSP: força bruta < 10 pontos, heurística ≥ 10), `route`, `nearest`. Perfeito para 4–6 paradas. Sem trânsito em tempo real. |
| **VROOM** (BSD-2) sobre OSRM/Valhalla | R$ 0 | TSP/VRP com janelas de horário, duração de serviço, skills e pausas; resolve em milissegundos; `vroom-express` expõe HTTP; imagem Docker. É o "Route Optimization API" gratuito. |
| **OR-Tools** (Apache 2.0) | R$ 0 | Biblioteca Python: `RoutingModel` + dimensão de tempo + `CumulVar().SetRange()` para janelas. Usar se quiser embutir no worker Python em vez de subir o VROOM. |
| **Geocodificação** | Google Geocoding: 10.000 grátis/mês, US$ 5/1.000. Nominatim (OSM): grátis, máx. 1 req/s, User-Agent obrigatório, cachear resultados, atribuição ODbL; para scripts recorrentes máx. 4 req/min. | Os 300–360 alvos iniciais cabem em qualquer um; guardar lat/long no alvo e nunca re-geocodificar. |
| **Banco** | Supabase + **PostGIS** (extensão nativa): coluna `geography(Point)`, índice GIST, operador `<->` para vizinho mais próximo, `st_distance` em metros, filtro por polígono. | Agrupar alvos por bairro/zona, "alvos a ≤ 2 km da rota de hoje", validação do check-in. |

**Abrir navegação no celular (sem SDK):**
- Google Maps URL universal: `https://www.google.com/maps/dir/?api=1&origin=LAT,LNG&destination=LAT,LNG&waypoints=LAT,LNG|LAT,LNG&travelmode=driving&dir_action=navigate` — abre o app no iOS/Android; até **3 waypoints em navegador mobile** (9 em desktop). Para 4 visitas: origem + 3 waypoints + destino = rota completa da tarde em um único link.
- Waze: `https://waze.com/ul?ll=LAT,LNG&navigate=yes&utm_source=komune` — **um destino por vez** (sem paradas), então o botão "Waze" é por parada.

### 1.3 Zoneamento de Natal para rotas

Natal tem **36 bairros em 4 zonas administrativas** (Norte, Sul, Leste, Oeste). Para rota comercial de eventos, usar 6 "zonas de rota" (as 4 oficiais + região metropolitana), guardadas como polígonos no PostGIS e como atributo do alvo:

| Zona de rota | Bairros/municípios (referência) | Perfil de fornecedor típico |
|---|---|---|
| **Sul** | Ponta Negra, Capim Macio, Lagoa Nova, Candelária, Neópolis, Nova Descoberta, Pitimbu | Buffets, decoração, fotografia, espaços, DJs, lojas de festas |
| **Leste** | Tirol, Petrópolis, Lagoa Seca, Barro Vermelho, Alecrim, Cidade Alta, Ribeira, Areia Preta, Praia do Meio, Rocas, Santos Reis, Mãe Luiza | Cerimonialistas, floriculturas, som/luz, salões, Ribeira (casas de eventos/bares) |
| **Norte** | Potengi, Igapó, Lagoa Azul, Pajuçara, Redinha, N. S. da Apresentação, Salinas | Churrasqueiros, salgados/doces, brinquedos infláveis, tendas |
| **Oeste** | Cidade da Esperança, Cidade Nova, Bom Pastor, Dix-Sept Rosado, Felipe Camarão, Guarapes, Nordeste, N. S. de Nazaré, Planalto, Quintas | Mobiliário/locação, gerador, estrutura, transporte |
| **Metropolitana Sul** | Parnamirim (Nova Parnamirim, Emaús, Parque de Exposições, Rota do Sol) | Espaços de evento, sítios, chácaras, buffets de porte |
| **Metropolitana Norte/Oeste** | São Gonçalo do Amarante, Extremoz, Macaíba | Sítios, produtores rurais de eventos, gráficas |

(A lista de bairros por zona deve ser validada contra a tabela oficial da Prefeitura/IBGE ao carregar os polígonos; a atribuição acima é a divisão administrativa conhecida e serve como semente.)

**Regra de "zona do dia":** cada pessoa tem um plano semanal de zonas (ex.: Heloísa — seg Sul, ter Leste, qua Metropolitana Sul, qui Norte, sex livre/remarcações). O robô de agenda só oferece visita presencial em dia cuja zona bate com o bairro do alvo; se não bater, oferece vídeo de manhã ou a próxima data da zona. Isso é o que torna "4 visitas por tarde" viável sem atravessar a cidade.

### 1.4 Requisitos funcionais — Rotas

**Dados e agrupamento**
- O sistema deve armazenar, para cada alvo, `lat/long` (PostGIS), `bairro`, `zona_rota`, `endereco_formatado`, `janela_atendimento` (ex.: seg–sex 14–18h), `tempo_visita_estimado` (padrão 35 min) e `origem_da_coordenada` (geocodificação automática, GPS de check-in anterior ou ajuste manual).
- O sistema deve geocodificar novos alvos em lote uma única vez (fila assíncrona), respeitando o limite do provedor (Nominatim: 1 req/s) e marcando `precisao_geocode` (rua/bairro/cidade); alvos com precisão "cidade" ficam fora do planejador até correção.
- O sistema deve permitir atribuir alvos a uma zona de rota por polígono (automático) e sobrescrever manualmente.
- O sistema deve expor um mapa (web e mobile) com filtros por zona, bairro, categoria, etapa do funil, temperatura, responsável e "sem contato há N dias", com seleção por laço/retângulo ("Lasso") para montar a lista da tarde.

**Planejamento da tarde**
- O sistema deve sugerir, para cada pessoa e dia útil, uma rota de até 4 visitas (configurável 3–6) entre 14:00 e 18:00, priorizando: (1) visitas já agendadas com hora marcada (fixas), (2) alvos quentes da zona do dia sem visita, (3) alvos de categorias com déficit de densidade (seção 6.6), (4) alvos "a caminho" (≤ 1,5 km da rota) para completar a meta de portas.
- O sistema deve calcular a ordem das paradas com matriz de tempos (OSRM `table` ou Google Route Matrix) e resolver o TSP com janelas (VROOM/OR-Tools, ou força bruta para ≤ 6 paradas), partindo do ponto de origem da pessoa (escritório ou casa, configurável) e respeitando `janela_atendimento` de cada alvo.
- O sistema deve exibir, por parada: horário previsto de chegada (ETA), tempo de deslocamento desde a anterior, tempo previsto de visita, telefone/WhatsApp do contato, último contato, próxima ação prevista e "o que dizer" (script curto por categoria).
- O sistema deve alertar quando a rota total (deslocamento + visitas) ultrapassar o bloco da tarde e sugerir cortar a parada de menor prioridade.
- O sistema deve permitir arrastar/reordenar paradas e adicionar uma parada "à mão" pelo nome do alvo, recalculando ETAs.
- O sistema deve gerar, ao confirmar a rota, um bloco no Google Calendar da pessoa ("Rota Zona Sul — 4 visitas") com a lista de paradas na descrição, para que o robô de agenda não marque vídeo nesse período.

**Modo rota (mobile)**
- O sistema deve oferecer um "Modo rota" em tela cheia no celular com a parada atual em destaque e os botões: **Abrir no Google Maps** (link universal `maps/dir` com todas as paradas restantes, até 3 waypoints), **Abrir no Waze** (link `waze.com/ul` para a parada atual), **Ligar**, **WhatsApp** (abre conversa com mensagem "estou chegando em ~10 min" pré-preenchida) e **Cheguei** (check-in).
- O sistema deve fazer check-in por geolocalização ao tocar "Cheguei": registrar `lat/long`, precisão e horário; marcar `check-in válido` se a distância até o alvo for ≤ 200 m; caso contrário, registrar como "check-in remoto" e perguntar se a coordenada do alvo está errada (oferecendo atualizar a coordenada do alvo com a posição atual).
- O sistema deve permitir check-in manual sem GPS (com justificativa em um toque: "GPS sem sinal", "visita foi em outro endereço") para não bloquear o trabalho; o relatório deve mostrar a proporção de check-ins válidos por pessoa.
- O sistema deve abrir automaticamente, após o check-in, o formulário de resultado de visita (seção 5) e, ao concluir, avançar para a próxima parada e recalcular ETAs se houver atraso > 15 min.
- O sistema deve registrar "visita não realizada" com motivo (fechado, decisor ausente, endereço errado, sem tempo) em um toque e reagendar automaticamente para a próxima data da mesma zona.
- O sistema deve funcionar offline para leitura da rota e enfileirar check-ins/resultados para sincronizar quando houver rede (rota em áreas com sinal fraco).
- O sistema deve permitir que a pessoa registre uma visita "fora de rota" (porta batida por oportunidade) a partir da posição atual, sugerindo alvos existentes num raio de 100 m ou criando um alvo novo.

**Privacidade e LGPD**
- O sistema deve coletar localização apenas no momento do check-in/registro (nunca rastreamento contínuo), informar isso na política interna e permitir ao gestor ver apenas os check-ins, não trajetos.

### 1.5 Critérios de aceitação
- Rota sugerida para 7 pessoas gerada em < 5 s por pessoa; ordem das paradas nunca viola janela de atendimento.
- Tempo entre "Cheguei" e resultado salvo ≤ 30 s no teste com usuário (medido no app).
- ≥ 80% das visitas com check-in válido após 2 semanas.

---

## 2. Agenda e reuniões (submódulo Agenda)

### 2.1 Referências e o que a pesquisa mostrou

- **Google Calendar API**: criar evento com Meet = `POST /calendars/{id}/events?conferenceDataVersion=1&sendUpdates=all` com `conferenceData.createRequest = { requestId: <uuid>, conferenceSolutionKey: { type: "hangoutsMeet" } }`; escopo `https://www.googleapis.com/auth/calendar`. Autenticação: se a KOMUNE estiver em Google Workspace, conta de serviço com delegação de domínio permite ao robô criar eventos na agenda de cada pessoa; com contas Gmail pessoais, cada pessoa autoriza uma vez (OAuth) e o refresh token fica guardado.
- **Conflitos**: `POST /freeBusy` com `timeMin`, `timeMax`, `timeZone: "America/Fortaleza"` e `items: [{id: calendarId}]` devolve os blocos ocupados de até 50 agendas por consulta.
- **Mudanças em tempo real**: `events.watch` envia POST para um webhook HTTPS (certificado válido); canais expiram e não renovam sozinhos, e o Google avisa que notificações "não são 100% confiáveis" — por isso o sistema deve combinar webhook com sincronização incremental por `syncToken` (a cada 5 min).
- **Páginas de agendamento**: o Google Calendar tem "agendas de compromissos" nativas (página de reserva, durações, buffer, limite por dia, Meet automático, até 5 lembretes por e-mail, formulário, co-anfitriões, checagem de disponibilidade em várias agendas; alguns recursos exigem Workspace/Google One elegível). Calendly: Free (1 tipo de evento, 1 agenda, sem lembretes automáticos, sem API/webhooks), Standard US$ 10, Teams US$ 16/assento. Cal.com: hospedado Teams US$ 12/usuário (anual), Organizations US$ 28; o repositório open source hoje é o **Cal.diy** (MIT), sem Teams/Workflows/Insights e "estritamente recomendado para uso pessoal, não produtivo". Motion (US$ 19–29/assento) e Reclaim (Lite grátis; Starter US$ 10–12; Business US$ 15–18) auto-agendam tarefas e hábitos na agenda — a ideia de "defender blocos" (prospecção 08–09h, rota 14–18h) é o que vale copiar.

**Conclusão:** a KOMUNE precisa de um **motor de slots próprio** (poucas regras, dois tipos de evento) que o robô de WhatsApp consulta para propor horários; a página pública de agendamento é um subproduto desse motor (ou o link nativo do Google Calendar como atalho).

### 2.2 Requisitos funcionais — Agenda

**Tipos de evento e disponibilidade**
- O sistema deve definir dois tipos de evento por pessoa: **Apresentação online** (30 min = 20 de apresentação + 10 de folga; seg–sex 09:00–12:00; local: Google Meet) e **Visita presencial** (45 min; seg–sex 14:00–18:00; restrita à zona do dia da pessoa). Duração, janelas e limites devem ser configuráveis por pessoa.
- O sistema deve limitar por padrão 4 apresentações por manhã e 4 visitas por tarde por pessoa, com buffer mínimo de 10 min entre apresentações e deslocamento estimado (OSRM/Google) + 10 min entre visitas.
- O sistema deve calcular slots livres combinando: agenda do Google (`freeBusy`), eventos internos do CRM (rota confirmada, folgas, eventos próprios da KOMUNE), "holds" temporários (slot reservado por 10 min enquanto o fornecedor decide) e feriados de Natal/RN.
- O sistema deve permitir bloquear períodos por pessoa ("sem reuniões sexta à tarde", "folga 12/09") a partir do painel ou por mensagem ao agente ("bloqueia minha quinta de manhã").

**Marcação pelo robô de WhatsApp (sem conflito)**
- O sistema deve expor ao robô uma função `sugerir_slots(pessoa, tipo, alvo, a_partir_de, quantidade=3)` que devolve 3 opções em dias diferentes, na ordem: próximo dia útil com vaga, preferindo horários que "encostem" em compromissos já existentes (compactação de agenda) e, para visitas, a zona do alvo.
- O sistema deve, ao fornecedor escolher um horário, verificar de novo a disponibilidade (double-check), criar o evento no Google Calendar da pessoa com Meet (se online) ou endereço do alvo (se visita), e só então confirmar por WhatsApp — se o slot tiver sido tomado, oferecer outras 3 opções automaticamente.
- O sistema deve registrar no evento: nome/empresa/categoria do alvo, telefone, link do perfil no CRM, script de abordagem e link do pré-cadastro; e no CRM: `reuniao_id`, `event_id` do Google, link do Meet, status (`marcada`, `confirmada`, `realizada`, `no-show`, `reagendada`, `cancelada`) e quem marcou (pessoa ou robô).
- O sistema deve permitir marcar reunião em nome de outra pessoa (Heloísa marca visita para Rafael) apenas se a agenda dela permitir.
- O sistema deve garantir que reuniões criadas pelo Meet aceitem convidado externo sem e-mail (fornecedor entra pelo link; anfitrião admite) e enviar o link pelo WhatsApp, não só por e-mail.
- O sistema deve avançar a etapa do funil para "apresentação" (reunião marcada) automaticamente e criar a atividade correspondente para a meta de "reuniões marcadas".

**Lembretes, confirmação, no-show e reagendamento**
- O sistema deve enviar ao fornecedor, por WhatsApp: **24 h antes** — lembrete com pedido de confirmação ("1 = confirmo, 2 = reagendar"); **1 h antes** — lembrete com link do Meet (online) ou "Heloísa chega ~14:00" (visita). Para visita, também avisar a pessoa 20 min antes de sair, considerando o deslocamento calculado.
- O sistema deve tratar respostas: "1" → status `confirmada`; "2" → oferecer 3 novos slots; texto livre → encaminhar ao responsável no inbox com a reunião destacada.
- O sistema deve, se não houver confirmação até 3 h antes, avisar a pessoa ("Buffet Sabor sem confirmar — quer ligar?") e sugerir enviar áudio humano.
- O sistema deve marcar `no-show` quando a pessoa tocar "não compareceu" ou quando, 15 min após o início, ela responder "n" ao ping "O fornecedor entrou?"; ao marcar no-show, enviar ao fornecedor mensagem cordial de reagendamento com 3 slots e registrar o no-show nas métricas (taxa de no-show por origem e por canal de marcação).
- O sistema deve permitir reagendar/cancelar por comando no WhatsApp da pessoa ("remarca Buffet Sabor para quinta 10h") e refletir no Google Calendar em segundos (update do evento).
- O sistema deve cobrar o resultado da reunião 10 min após o horário de término se nada foi registrado ("Como foi com Buffet Sabor? Responda com áudio ou escolha: 1 interessado / 2 pensar / 3 não / 4 não aconteceu").

**Página pública de agendamento**
- O sistema deve oferecer um link curto por pessoa (`komune.app/agenda/heloisa`) com dois botões (Apresentação online / Visita), mostrando apenas os slots do motor próprio; o formulário pede nome, empresa, categoria e WhatsApp (o e-mail é opcional) e cria o alvo no CRM se não existir.
- O sistema deve permitir, como alternativa de baixo custo, o uso do link nativo de "agenda de compromissos" do Google Calendar para apresentações online, importando as reservas via webhook/sync para o CRM.

**Custos**
- Google Calendar API: sem custo. Meet: incluído na conta Google.
- Lembretes na Cloud API do WhatsApp (Brasil, por mensagem entregue): utility US$ 0,0068; marketing US$ 0,0625; respostas dentro da janela de 24 h grátis; templates utility enviados dentro de uma janela de serviço aberta são grátis. Estimativa: 300 reuniões/mês × 2 lembretes = 600 utility ≈ **US$ 4/mês**. Números da Cloud API no Brasil ainda são faturados em USD (moeda local prevista para o fim de 2026).
- Lembretes pela instância não oficial (Evolution/Baileys): R$ 0, com risco de banimento — só usar para o número humano e com as regras da seção 4.

---

## 3. Metas e gamificação (submódulo Metas)

### 3.1 Referências

- **Pipedrive** (Goals): metas por empresa/equipe/usuário em negócios (adicionados/avançados/ganhos), atividades (adicionadas/concluídas) e receita, em ciclos semanais/mensais/trimestrais/anuais (não há meta diária nativa). O AI Sales Assistant prioriza negócios por probabilidade de ganho, sugere "next best actions", alerta quando um negócio passa do tempo típico por etapa e mostra ao gestor quem tem alta taxa de perda por etapa.
- **HubSpot** (Goals): modelos de receita, negócios criados, ligações feitas e reuniões marcadas; atribuição a usuários/equipes; período semanal/mensal/trimestral/anual/custom; notificações por marco (ex.: 50%, 100%); metas de atividade só no Sales Hub Professional/Enterprise; progresso atualizado a cada 8–12 min.
- **Ambition** (US$ 45–75/usuário/mês): scorecards de atividade/objetivo, "Productivity Quadrant", competições, coaching 1:1 orquestrado. **Spinify** (sob consulta, mín. 5 usuários, mês a mês, 60 dias grátis): leaderboards com 20+ modos, barras de progresso diárias/semanais, "Recognition Agent" que destaca vitórias e o progresso de quem está no meio da tabela, "Coaching Agent" que prepara o 1:1 com perguntas, "Predictive Scores" que sinaliza risco antes de a meta falhar. **SalesScreen** (~US$ 25/usuário/mês): competições, badges, TV de celebrações, "Scout AI".
- **Risco documentado:** Lei de Goodhart — leaderboard de métrica única induz volume sem qualidade (ligações em vez de conversas). Antídotos: métricas balanceadas por etapa, reconhecer melhoria (não só o topo) e ranking público apenas de conquistas.

### 3.2 Definições de métricas (contagem — a parte mais importante)

| Métrica diária | Definição de contagem | Antimanipulação |
|---|---|---|
| **Porta batida** | Tentativa de contato registrada com um alvo (mensagem entregue, ligação, visita sem decisor) | Máx. 1 por alvo por dia |
| **Porta aberta** (a meta "3/dia") | Conversa real com o decisor ou influenciador: resposta no WhatsApp/DM, ligação atendida com conversa, visita com decisor presente | Máx. 1 por alvo a cada 30 dias; exige resultado registrado (template) |
| **Conversas ativas** | Alvos em etapa "conversa" com troca nas últimas 72 h | — |
| **Reuniões marcadas / realizadas** | Evento criado com o alvo / evento com resultado registrado (≠ no-show) | Reunião só conta como realizada com resultado |
| **Cadastros iniciados** | Fornecedor com pré-cadastro aceito ou cadastro começado no painel | Vinculado ao `fornecedor_id` da plataforma |
| **Publicações** | Perfil publicado na Komune (status vindo do banco da plataforma) | Fonte de verdade = Supabase da Komune, não o CRM |
| **Follow-ups em dia** | % de próximas ações com data ≤ hoje executadas | Indicador de higiene, não de volume |

- O sistema deve permitir metas por pessoa e por período (dia, semana, mês) em cada métrica, com valores padrão do plano (3 portas abertas/dia; sugestão inicial: 9 portas batidas, 2 reuniões marcadas/dia, 5 cadastros/semana, 3 publicações/semana por pessoa) e metas coletivas (100 fornecedores até 06/11; 14 categorias com ≥ 5 até 04/12; 300 alvos até 18/09).
- O sistema deve suportar **meta proporcional** (pessoa com 50% de dedicação comercial tem meta 50%) e **dias neutros** (folga, doença, evento próprio, viagem) que não contam para meta nem quebram streak.
- O sistema deve mostrar progresso em tempo real (barra "hoje", "semana", "mês") e calcular "ritmo" (necessário/dia restante para fechar a semana).

### 3.3 Requisitos funcionais — Painel "Meu dia" e next best action

- O sistema deve abrir, no celular e no desktop, o painel **"Meu dia"** com: metas do dia com barras; agenda de hoje (Meets e rota); a **fila de ações** ordenada; tarefas do Asana vencidas/hoje; e a caixa de mensagens não respondidas do número da empresa atribuídas à pessoa.
- O sistema deve ordenar a fila por regras explícitas (auditáveis), nesta ordem de prioridade: (1) reunião nas próximas 3 h sem confirmação; (2) fornecedor respondeu e está sem resposta há > 2 h (SLA); (3) reunião/visita passada sem resultado registrado; (4) próxima ação vencida (mais antiga primeiro, alvo mais quente primeiro); (5) cadastro iniciado há > 3 dias sem publicar ("perturbar"); (6) alvos da zona/rota de hoje sem contato; (7) novos alvos para completar a meta de portas, priorizando categorias com déficit de densidade × proximidade × horário comercial aberto.
- O sistema deve mostrar em cada item o "porquê" ("vencido há 2 dias", "categoria buffet está 2/5") e ações em um toque (WhatsApp com template, ligar, marcar reunião, registrar resultado, adiar 1 dia).
- O sistema deve oferecer "**Preencher minhas 3 portas**": gera lista de 9 alvos (3× a meta) com script sugerido, respeitando limites de envio do número (seção 4).
- O sistema deve registrar cada ação tomada a partir da fila (para medir quanto da fila é executada — a base do "você tinha 10, fez 1").

### 3.4 Requisitos funcionais — Leaderboard, streaks e reconhecimento

- O sistema deve exibir um leaderboard **semanal** com pontuação composta e pesos configuráveis (ex.: porta aberta 1, reunião realizada 3, cadastro iniciado 5, publicação 10, follow-ups em dia até +3 bônus), nunca de uma métrica isolada.
- O sistema deve mostrar, no leaderboard público do time, apenas os 3 primeiros e a "melhoria da semana" (maior salto percentual sobre a própria média); posições abaixo do 3º aparecem só para a própria pessoa e para Rafael.
- O sistema deve manter **streaks** por pessoa (dias úteis consecutivos com meta diária de portas abertas batida) e **streak do time** (dias em que ≥ 80% do time bateu a meta), com marcos celebrados (3, 5, 10, 20 dias) e um "escudo" semanal que preserva a streak em um dia neutro.
- O sistema deve reconhecer conquistas com badges automáticas (ex.: "Primeira publicação", "Semana verde", "Zona Norte 10 visitas", "0 no-show na semana", "Fechou uma categoria") e postar celebrações no grupo interno do WhatsApp (não a posição dos últimos).
- O sistema deve permitir desafios curtos criados por Rafael ("quem trouxer 3 buffets até sexta") com prazo, critério de contagem e prêmio simbólico.
- O sistema deve registrar as regras de pontuação em uma página visível ao time (transparência é parte do desenho saudável).

---

## 4. Agente de cobrança / "IA secretária" (submódulo Assistente)

### 4.1 Referências

- **Geekbot** (grátis até 10 usuários; Basic US$ 2,50/participante/mês; Slack/Teams): perguntas em horário fixo, lembrete a quem não respondeu, relatório ao canal, analytics de participação, "Geekbot AI" para perguntar sobre o time. **Standuply** (grátis até 3 usuários): respostas por voz/vídeo, integrações Asana em planos superiores. **Range** (grátis até 12; Pro US$ 8/usuário): check-in com "plano de hoje + progresso", puxa atividade automaticamente do Asana/Google Calendar/Drive, humor, objetivos. Boas práticas de standup (Geekbot): três perguntas fixas em ordem, 15 min no máximo, foco em bloqueios, evitar que vire "relatório para o chefe", segurança psicológica.
- **Motion/Reclaim**: o assistente não só cobra, ele **reorganiza** o dia (move tarefas, defende blocos). É a diferença entre um "cobrador" e uma "secretária".
- **Asana API**: sem plano premium, use `GET /tasks?assignee=<gid>&workspace=<gid>&completed_since=now&opt_fields=name,due_on,projects.name,permalink_url` (devolve tarefas incompletas) e filtre `due_on < hoje`; com premium, `GET /workspaces/{gid}/tasks/search?assignee.any=…&completed=false&due_on.before=YYYY-MM-DD&sort_by=due_date`. Mudanças em tempo real via **webhooks** (`POST /webhooks` com filtros `resource_type=task`, `action=changed`, `fields=due_on,completed`; handshake `X-Hook-Secret`; assinatura HMAC `X-Hook-Signature`) ou polling com `GET /events` + sync token. Autenticação por Personal Access Token.
- **WhatsApp**: para mensagens humanas via número de app (Evolution API/Baileys) a literatura de 2026 recomenda: aquecer o número 2–5 dias com uso manual; 20–50 mensagens/dia em número novo, 80–200 em número aquecido; atrasos aleatórios de 10–45 s; personalizar com variáveis; alternar texto/áudio/imagem; evitar links frequentes; distribuir volume entre números; responder mensagens recebidas. Templates oficiais (Cloud API) exigem opt-in prévio.

### 4.2 Princípios de tom ("cobrança saudável")

1. **Fatos, não adjetivos.** "10 planejadas, 1 concluída, 9 pendentes" e nunca "você foi mal".
2. **Comparar a pessoa com a própria meta, em privado.** O time vê conquistas; só a pessoa e Rafael veem o que faltou.
3. **Toda cobrança termina com uma pergunta ou uma oferta.** "O que travou? 1 rota longa / 2 reuniões estouraram / 3 outra prioridade / 4 outro" — e "quero mover para amanhã?".
4. **Distinguir "não fez" de "não registrou".** Antes de contar zero, o agente pergunta se houve atividade não registrada e oferece registrar por áudio.
5. **Regra de escalonamento pública e previsível.** Todo mundo sabe: 2 dias consecutivos abaixo de 50% da meta → Rafael é avisado, e a pessoa é avisada de que Rafael foi avisado.
6. **Horários fixos e silêncio fora deles.** 07:30, 18:00, segunda 08:00; nada em fim de semana nem depois das 19:00 (exceto lembrete de reunião do dia seguinte, que vai só à pessoa).
7. **Celebrar antes de cobrar.** A primeira linha do fim do dia é sempre o que foi feito.
8. **Nome de pessoa real, voz de assistente.** Assina como "Assistente Komune" (apelido a definir pelo time), fala em 1ª pessoa, curto, sem emoji em excesso, sem "!!!".

### 4.3 Requisitos funcionais — Assistente

**Canais e identidade**
- O sistema deve falar com cada pessoa por WhatsApp (1:1) a partir do número interno (instância na máquina dedicada), com Telegram como canal reserva e o painel "Meu dia" como espelho de tudo o que enviou.
- O sistema deve reconhecer comandos curtos em linguagem natural e por número ("1", "feito 3", "adia Sushi Zen pra amanhã", "hoje folga", "bloqueia quinta de manhã", "quem falta?") e responder com confirmação de uma linha.
- O sistema deve registrar todas as mensagens enviadas/recebidas do assistente (auditoria) e o tempo de resposta da pessoa.

**Digest da manhã (07:30, dias úteis)**
- O sistema deve enviar: metas do dia; agenda (Meets com horário e nome; rota da tarde com zona e 4 paradas); fila top-5 de ações; tarefas do Asana vencidas/hoje (com link); mensagens de fornecedores sem resposta; e uma linha de contexto (streak, ritmo da semana).
- O sistema deve permitir responder "ok" (confirma o plano), "troca" (abre o painel) ou ditar ajustes por áudio.

**Check-in de meio-dia (12:30, opcional por pessoa)**
- O sistema deve enviar um resumo curto da manhã (portas até agora, reuniões realizadas) e a rota da tarde com botão "abrir modo rota"; sem cobrança.

**Digest de fim de dia (18:00)**
- O sistema deve enviar: o que foi feito (contadores vs. meta, com destaque), o que faltou (itens da fila não executados, próximas ações vencidas, tarefas Asana), pergunta única sobre bloqueio (opções numeradas) e oferta de reprogramar pendências para amanhã 08:00 ("1 = sim, 2 = escolho depois").
- O sistema deve, se não houver nenhum registro no dia, perguntar primeiro "Não vi registros hoje — teve atividade que não entrou? Manda um áudio que eu registro" antes de contar zero.
- O sistema deve fechar o dia às 20:00 (congelar contadores) e permitir correções até 09:00 do dia seguinte.

**Feedback semanal individual (sexta 18:00 ou domingo 19:00, configurável)**
- O sistema deve enviar a cada pessoa: semana vs. meta em cada métrica; 3 destaques (ex.: melhor dia, conversão de reunião, categoria aberta); 1 ponto de melhoria com evidência (ex.: "38% dos follow-ups saíram com atraso; 60% deles viraram perda"); 1 sugestão concreta para a próxima semana; e a pergunta "o que você precisa de mim ou do Rafael?".
- O sistema deve gerar o texto com LLM a partir de um resumo estruturado (números + eventos), com regras de estilo fixas (seção 4.2) e revisão de segurança (nunca comparar com colegas nominalmente).

**Escalonamento para Rafael**
- O sistema deve calcular, por pessoa e dia útil, `cumprimento = portas_abertas / meta_ajustada` e `registro = houve_qualquer_registro`.
- Nível 1 (1 dia < 50% ou sem registro): só a pessoa recebe, com pergunta de bloqueio.
- Nível 2 (**2 dias consecutivos** < 50% da meta, ou 2 dias sem registro): o sistema deve enviar a Rafael um alerta com contexto (agenda dos 2 dias, motivo informado, tendência) e uma ação sugerida (ex.: "conversa de 10 min", "ajustar meta", "tirar tarefa X"); a pessoa recebe aviso transparente.
- Nível 3 (semana < 60% ou 4 dias no nível 2 em 2 semanas): o sistema deve propor um 1:1 de 20 min na agenda de ambos (usando o motor de slots) e preparar a pauta (padrão "Coaching Agent": 3 perguntas e os dados).
- O sistema deve permitir a Rafael responder ao alerta com decisões que o sistema aplica: "meta 2 essa semana", "ok, folga", "marca 1:1 quinta 15h", "ignora".
- O sistema deve **nunca** escalar em dias neutros, no primeiro dia de uma pessoa nova, nem enquanto a pessoa estiver em evento próprio da KOMUNE (marcado na agenda).

**Resumo do time para Rafael (07:30 e 18:30)**
- O sistema deve enviar a Rafael um painel em texto: semáforo por pessoa (verde ≥ 100%, amarelo 50–99%, vermelho < 50%, cinza = neutro), totais do dia/semana, reuniões de hoje no time, alertas de escalonamento, burn-up (X/100, ritmo, previsão) e 1 supply gap do dia.

**Integração com Asana**
- O sistema deve ler, para cada pessoa, tarefas incompletas com `due_on` ≤ hoje (endpoint `GET /tasks` com `completed_since=now`, ou busca premium) a cada 30 min e via webhook para mudanças de `due_on`/`completed`.
- O sistema deve permitir concluir/adiar tarefas do Asana pelo WhatsApp ("feito 2", "adia 3 pra sexta") chamando `PUT /tasks/{gid}` e postar um comentário na tarefa ("concluída via Assistente Komune").
- O sistema deve criar tarefas no Asana a partir de resultados de visita quando a próxima ação for não comercial (ex.: "Dennis: enviar contrato"), no projeto correto, com responsável e prazo.

**Relatório de segunda-feira 08:00**
- O sistema deve gerar e enviar às 08:00 de segunda o relatório da semana (seção 6) em três formatos: resumo em texto no WhatsApp (grupo de growth), arquivo HTML/PDF anexado e planilha XLSX com os dados brutos (preferência de Rafael por arquivos), além do link do painel no Metabase.
- O sistema deve incluir no relatório a pauta sugerida da reunião de growth (as perguntas fixas do ritual respondidas com números) e 3 experimentos candidatos para a semana, com dono sugerido.

**Infraestrutura**
- O sistema deve agendar os envios com **Supabase Cron** (pg_cron: expressão cron, execução via HTTP em Edge Function ou worker local; ≤ 8 jobs simultâneos, ≤ 10 min cada) ou cron do worker Node na máquina dedicada; fuso `America/Fortaleza`.
- O sistema deve gerar textos com LLM (Claude Haiku 4.5 para digests; Sonnet 5 para o relatório semanal) a partir de um JSON de fatos, e guardar prompt + fatos + texto para auditoria; usar Batch API/prompt caching quando possível (50% e 90% de desconto respectivamente).

---

## 5. Registro rápido de atividades (submódulo Captura)

### 5.1 Referências e custos de IA

| Recurso | Opção | Custo (set/2026) |
|---|---|---|
| Transcrição de áudio | **faster-whisper** (MIT, CTranslate2; até 4× mais rápido que openai/whisper, roda em CPU; modelos large-v3/turbo/distil; multilíngue incl. pt-BR) na máquina dedicada | R$ 0 |
| | **Gemini 3.5 Flash-Lite** (áudio US$ 0,30/1M tokens; 25 tokens por segundo de áudio ⇒ ~US$ 0,00045/min; saída US$ 2,50/1M; há free tier) | ~US$ 0,30/mês para 600 min |
| | **OpenAI** gpt-4o-mini-transcribe ~US$ 0,003/min; gpt-4o-transcribe ~US$ 0,006/min; gpt-transcribe US$ 0,0045/min; tempo real US$ 0,017/min (whisper-1 não aparece mais na tabela) | US$ 1,8–3,6/mês para 600 min |
| Extração estruturada / textos | **Claude Haiku 4.5** US$ 1 entrada / US$ 5 saída por 1M tokens; **Sonnet 5** US$ 2 / US$ 10; Batch −50%; cache de prompt: leitura a 0,1× | < US$ 5/mês |
| OCR de cartão / print de Instagram | **Claude Vision** (imagem → JSON) ou **Google Cloud Vision** TEXT_DETECTION (1.000 unidades grátis/mês; US$ 1,50/1.000 depois) | ~R$ 0 |

### 5.2 Requisitos funcionais — Captura

**Formulário "porta aberta" (≤ 20 s)**
- O sistema deve abrir o formulário com campos pré-preenchidos sempre que possível: alvo (busca com autocompletar por nome/telefone/Instagram, ou "novo"), canal (WhatsApp / visita / ligação / Instagram / indicação — chips), com quem falou (decisor / funcionário / ninguém — chips), resultado (chips do template da categoria), próxima ação (chip: enviar material / marcar reunião / ligar / visitar / perturbar cadastro / perder) com data padrão inteligente (D+1 para quente, D+3 morno, D+7 frio), bairro/zona (do GPS ou do alvo), observação (texto ou áudio).
- O sistema deve permitir salvar com 3 toques (alvo → resultado → próxima ação) e concluir o restante depois; o registro incompleto aparece na fila como "completar".
- O sistema deve mudar a etapa/temperatura automaticamente pelo resultado (regras: "interessado" → quente + etapa interessado; "pediu material" → morno; "não é o decisor" → mantém etapa e cria ação de encontrar o decisor; "sem interesse" → motivo de perda obrigatório).
- O sistema deve contabilizar a métrica correta (porta batida/aberta, conversa, reunião) no mesmo instante e mostrar a barra da meta atualizada ("2/3 — falta 1").

**Templates de resultado de visita** (chips; o texto vira nota padronizada)
1. "Não estava / fechado" → reagendar na próxima data da zona.
2. "Falei com funcionário — deixei material" → ação: contatar decisor (nome/telefone capturados).
3. "Falei com decisor — interessado" → ação: enviar link do pré-cadastro / marcar cadastro assistido.
4. "Falei com decisor — não agora" (motivo: sem tempo / já usa Casamentos.com / quer ver casos / taxa) → ação em 15–30 dias.
5. "Cadastro iniciado na hora" → vincula `fornecedor_id`; ação: "perturbar" em 3 dias.
6. "Sem perfil" (fora do ICP) → arquivar com motivo.
- O sistema deve permitir personalizar os templates por categoria (buffet pergunta capacidade; espaço pergunta lotação/valor de locação; fotógrafo pergunta faixa de preço) com no máximo 2 campos extras.

**Nota por voz**
- O sistema deve aceitar áudio pelo app (botão segurar-para-gravar) e pelo WhatsApp do assistente (áudio encaminhado), transcrever em pt-BR e extrair para JSON: `alvo` (resolvido por nome fuzzy contra a lista da rota/agenda do dia), `com_quem`, `resultado`, `interesse`, `objecoes`, `dados_capturados` (telefone, e-mail, Instagram, nome do decisor), `proxima_acao`, `data`.
- O sistema deve mostrar a ficha extraída para confirmação em um toque, destacando campos incertos; guardar o áudio original e a transcrição no histórico do alvo.
- O sistema deve rodar a transcrição localmente (faster-whisper na máquina dedicada) por padrão e cair para API (Gemini/OpenAI) se a fila local passar de 60 s de espera.
- O sistema deve reconhecer frases de comando dentro do áudio ("marca reunião quinta de manhã", "manda o material") e transformá-las em ações da fila.

**Captura por foto (cartão, fachada, Instagram)**
- O sistema deve extrair de uma foto de cartão/fachada/print: nome, empresa, telefone(s), e-mail, @instagram, site, endereço, categoria provável; criar ou mesclar o alvo (deduplicação por telefone normalizado E.164 e por @instagram) e pedir confirmação.
- O sistema deve, para @instagram, gerar o link do perfil e agendar enriquecimento (bio, seguidores, foto) na fila do scraper (com os limites éticos do brief: só dados públicos, pré-cadastro transparente).
- O sistema deve guardar a imagem como anexo do alvo e registrar a origem = "captura em campo".

**Inbox e atribuição**
- O sistema deve garantir que toda mensagem recebida no número da empresa tenha um responsável (por alvo → responsável do alvo; sem alvo → rodízio/Heloísa) e SLA de 2 h em horário comercial, alimentando a fila "Meu dia".

### 5.3 Critérios de aceitação
- Mediana de tempo "abrir formulário → salvo" ≤ 20 s (porta) e ≤ 30 s (visita com áudio) em teste com 3 pessoas.
- ≥ 90% das fichas extraídas de áudio confirmadas sem edição de `resultado` e `proxima_acao`.

---

## 6. Relatórios para o ritual semanal (submódulo Relatórios)

### 6.1 Princípios
- Toda métrica tem definição em SQL (view no Supabase) e dono; o texto do relatório é gerado a partir das views, nunca à mão.
- Histórico de etapas em tabela de eventos (`alvo_id`, `de_etapa`, `para_etapa`, `em`, `por`) — sem isso não existe "tempo médio por etapa".
- O relatório compara sempre três coisas: semana atual, semana anterior e meta (ou ritmo necessário).

### 6.2 Requisitos funcionais — Relatórios

**Funil**
- O sistema deve mostrar o funil de fornecedores por etapa (prospectado → contato → conversa → apresentação → interessado → cadastro iniciado → perfil completo → publicado → visualização → lead → proposta → contratação → recorrência) com contagem atual, entradas na semana, conversão etapa-a-etapa e conversão acumulada desde "contato"; idem para o funil de produtores/cerimonialistas.
- O sistema deve permitir cortes por **origem** (Casamentos.com.br, GetNinjas, Constance Zahn, CNPJ/Econodata, Instagram, indicação, manual, supply gap), **responsável**, **categoria**, **zona** e **canal do primeiro contato** (WhatsApp, visita, ligação, Instagram), com tabela e barras.

**Densidade por categoria (KR3)**
- O sistema deve mostrar, para cada uma das 14 categorias prioritárias (e os 5 grupos do plano), publicados vs. meta (≥ 5), interessados e em cadastro (pipeline "quase lá"), alvos disponíveis não contatados e uma etiqueta: "fechada", "no ritmo", "em risco", "sem alvos" — o que gera a lista de prospecção da semana.

**Tempo médio por etapa e gargalos**
- O sistema deve calcular a mediana e o p75 de dias em cada etapa (usando a tabela de eventos), destacar a etapa com maior acúmulo (contagem × tempo) e listar os 10 alvos "parados" há mais tempo em etapa quente.

**Motivos de perda**
- O sistema deve consolidar perdas na semana e acumuladas por motivo (sem interesse / concorrente (Casamentos.com etc.) / taxa 8% / não é o decisor / sem tempo agora / não respondeu após 5 tentativas / fora do perfil / fechou-inativo), por categoria e por responsável, com as objeções mais citadas nas notas (extração por LLM).

**Burn-up da meta de 100 fornecedores (KR1)**
- O sistema deve exibir um gráfico burn-up com: linha de escopo (100 perfis completos até 06/11; segunda linha de 130 = +30 produtores), linha acumulada de perfis completos/publicados, velocidade semanal, **projeção de data** (velocidade média das últimas 2 semanas → data prevista) e **ritmo necessário** (restante ÷ dias úteis até 06/11). O burn-up é preferível ao burndown porque deixa visível quando o escopo muda (ex.: meta revisada nas revisões de marco 06/10, 03/11, 04/12).
- O sistema deve mostrar o mesmo burn-up para "300 alvos até 18/09" e "14 categorias com ≥ 5 até 04/12".

**Atividade e produtividade**
- O sistema deve reportar por pessoa: portas batidas/abertas, conversas, reuniões marcadas/realizadas/no-show, visitas (com % de check-in válido), cadastros, publicações, follow-ups em dia, % da fila executada, streak; e por time: totais, meta, semáforo.
- O sistema deve reportar eficiência de canal: taxa de resposta ao primeiro contato por canal e por hora do dia; taxa de comparecimento de reuniões marcadas pelo robô vs. por pessoa; conversão de visita presencial vs. vídeo.

**Supply gap**
- O sistema deve cruzar a demanda não atendida da plataforma (buscas sem resultado/Research Requests por categoria, data e faixa de preço) com a densidade do CRM e listar as categorias em falta com alvos disponíveis, virando itens de prospecção atribuídos.

**Entrega**
- O sistema deve gerar, às 08:00 de segunda, o relatório em HTML (para leitura), PDF (para arquivo), XLSX (dados) e um resumo de 15 linhas no WhatsApp do grupo de growth, além de manter os painéis vivos no Metabase sobre o Supabase.
- O sistema deve incluir a pauta do ritual com as perguntas fixas respondidas por número: quantos fornecedores/produtores/eventos/usuários/leads entraram; o que procuraram e não acharam; onde abandonaram (etapa com maior perda); qual campanha/canal ativou; qual produtor trouxe mais gente; qual categoria falta; e 3 experimentos sugeridos com dono.

### 6.3 Sanidade da meta (exemplo que o relatório deve produzir toda semana)
Hoje (03/09) há ~2 fornecedores publicados; faltam ~98 até 06/11 (≈ 45 dias úteis) ⇒ **2,2 publicações/dia útil**. Com 7 pessoas × 3 portas abertas/dia = 21 portas/dia ⇒ ~945 portas até lá ⇒ conversão necessária porta→publicado ≈ 10%. Se a conversão observada nas 2 primeiras semanas for 5%, o relatório deve dizer explicitamente "no ritmo atual chegamos a 100 em 12/12; para 06/11 é preciso 4 portas/dia ou subir a conversão para 10% via cadastro assistido".

---

## 7. Fluxos de exemplo

### 7.1 Dia típico da Heloísa (comercial operacional)

- **07:30** — WhatsApp do Assistente: "Bom dia, Heloísa. Hoje: 2 apresentações (09:30 Buffet Sabor; 11:00 Foto Lente Viva), rota Zona Sul 14:00–17:30 (4 paradas). Fila: 3 fornecedores responderam ontem à noite, 2 follow-ups vencidos, 1 tarefa do Asana atrasada (kit comercial — revisar prints). Meta: 3 portas (ontem 2/3). Responda ok ou troca."
- **08:00–09:15 (bloco de prospecção)** — abre "Meu dia": responde os 3 fornecedores (o robô já classificou "interesse sim" e sugeriu resposta); dispara primeiro contato para 9 alvos de buffet/decoração da Zona Sul ("Preencher minhas 3 portas"), com envio espaçado automático; 1 responde em 20 min → 1ª porta aberta; registra em 3 toques.
- **09:20** — o Assistente confirmou com Buffet Sabor às 08:30 (resposta "1"); envia lembrete 1 h antes com link do Meet. **09:30–09:50** apresentação (app no simulador + painel). **09:52** registra pelo template "apresentação feita — interessado — enviar pré-cadastro" (25 s); o sistema envia o link do pré-cadastro por WhatsApp em nome de Heloísa e cria "perturbar cadastro" para D+3.
- **11:00** — Foto Lente Viva não entra. **11:12** o Assistente pergunta "entrou?"; Heloísa responde "n" → status no-show; o robô manda ao fotógrafo uma mensagem cordial com 3 novos horários; ele escolhe quinta 10:00 → evento recriado, etapa mantida, métrica de no-show registrada. Heloísa usa a meia hora livre para 2 ligações da fila (2ª porta aberta).
- **12:30** — check-in de meio-dia: "Manhã: 2/3 portas, 1 apresentação, 1 reagendada. Rota da tarde pronta: Capim Macio 14:00 (Buffet Dona Célia) → Lagoa Nova 14:50 (Decor & Cia) → Ponta Negra 15:45 (Espaço Mar Azul) → Ponta Negra 16:40 (DJ Marcos). Abrir modo rota."
- **13:40** — "Modo rota": toca "Abrir no Google Maps" (rota inteira, 3 waypoints). Chega 14:05, toca "Cheguei" (check-in válido, 60 m). Fala com a dona; grava áudio de 40 s no app: "falei com a Célia, ela é a dona, gostou da ideia de pagar só quando fechar, quer ver o app, ficou de mandar fotos do cardápio, marca reunião online semana que vem de manhã e o Instagram dela é doncelia buffet". A ficha aparece pronta: decisor, interessado, próxima ação "marcar apresentação" — Heloísa confirma; o robô propõe 3 slots à Célia por WhatsApp ainda à tarde (3ª porta aberta — meta batida, streak 1).
- **14:50** — Decor & Cia: decisor ausente; template "falei com funcionário — deixei material"; foto do cartão → nome e telefone do sócio capturados, ação "contatar decisor" para amanhã.
- **15:45** — Espaço Mar Azul: gerente presente, "não agora — já anuncia no Casamentos.com"; motivo registrado; ação em 30 dias com o argumento "sem mensalidade".
- **16:40** — DJ Marcos: cadastro iniciado na hora pelo celular dele (cadastro assistido), `fornecedor_id` vinculado.
- **18:00** — fim do dia: "Feito: 3/3 portas (streak 1), 2 apresentações (1 no-show reagendada), 4 visitas (3 com decisor, 4 check-ins válidos), 1 cadastro iniciado, 1 apresentação marcada. Faltou: follow-up Sushi Zen e a tarefa do Asana 'revisar prints'. Quer mover as duas para amanhã 08:00? 1 = sim, 2 = escolho depois." Heloísa responde "1".
- **Sexta 18:00** — feedback semanal individual (seção 8.3).

### 7.2 Dia típico do Rafael (CEO)

- **07:30** — resumo do time: "Ontem: 17/21 portas (verde: Heloísa 3, Bárbara 3, Matheus 3, Luiz 3; amarelo: Rafael 2; vermelho: Dennis 1 — 2º dia consecutivo, motivo informado: fechamento financeiro). Hoje no time: 6 apresentações, 5 rotas (Sul, Leste, Parnamirim). Burn-up: 9/100 publicados; ritmo 2 sem: 3/semana; previsão no ritmo atual: 01/04/2027; necessário 2,2/dia útil. Supply gap: 'gerador' sem nenhum alvo. Escalonamento: Dennis (nível 2) — sugestão: meta 1/dia nesta semana ou tirar o fechamento da manhã. Responda: 1 ajustar meta / 2 marcar 10 min / 3 ignorar."
- Rafael responde "1" → o sistema ajusta a meta de Dennis para a semana e avisa Dennis com transparência.
- **07:35** — o digest pessoal do Rafael: suas 3 portas (contatos de alto nível: 2 cerimonialistas e 1 produtora de formatura), 1 Meet às 10:00 com um produtor, 1 tarefa Asana (aprovar kit), sem rota (Rafael faz visitas só terça/quinta).
- **10:00–10:30** — Meet com produtor; registra por áudio no WhatsApp do Assistente enquanto caminha.
- **Durante o dia** — recebe apenas exceções: "Buffet Sabor confirmou reunião com Heloísa para quinta", "Bárbara fechou a categoria 'doces' (5/5)" (celebração no grupo), "Foto Lente Viva no-show reagendado".
- **18:30** — resumo do time do dia + itens para amanhã.
- **Segunda 08:00** — recebe o relatório da semana (HTML + PDF + XLSX + resumo no grupo) com a pauta do ritual e 3 experimentos sugeridos (ex.: "testar áudio humano no 1º contato vs. texto", "visitas em Parnamirim às quartas", "script 'sem mensalidade' para quem já anuncia no Casamentos.com"); às 09:00 a reunião de growth usa a pauta e termina com donos dos experimentos, que viram tarefas no Asana criadas pelo sistema.

---

## 8. Mensagens-modelo do Assistente

### 8.1 Manhã (07:30)
```
Bom dia, Heloísa. Seu dia:

Agenda
• 09:30 Apresentação — Buffet Sabor (confirmada) · link do Meet vai 1h antes
• 11:00 Apresentação — Foto Lente Viva (sem confirmação; peço agora)
• 14:00–17:30 Rota Zona Sul — 4 paradas (Capim Macio, Lagoa Nova, Ponta Negra ×2)

Sua fila (top 5)
1. Responder Doces da Ana — respondeu ontem 21:40
2. Responder Espaço Verde — pediu tabela de taxas
3. Follow-up Sushi Zen — vencido há 2 dias
4. Asana: revisar prints do kit — venceu ontem
5. Perturbar cadastro: DJ Marcos (iniciou há 3 dias)

Meta de hoje: 3 portas abertas (ontem 2/3 · semana 9/12 · ritmo ok)

Responda "ok" para confirmar ou "troca" para ajustar. Áudio também vale.
```

### 8.2 Fim do dia (18:00)
```
Fechando o dia, Heloísa.

Feito
• 3/3 portas abertas — meta batida, streak 1
• 2 apresentações (1 no-show reagendada para quinta 10:00)
• 4 visitas, 3 com decisor, 4 check-ins válidos
• 1 cadastro iniciado (DJ Marcos), 1 apresentação marcada (Buffet Dona Célia)

Faltou (2 de 7 itens da fila)
• Follow-up Sushi Zen
• Asana: revisar prints do kit

Quer que eu mova os dois para amanhã 08:00?
1 = sim · 2 = escolho depois · ou me diga o que travou
```

Variante quando não há registro:
```
Oi, Dennis. Não vi nenhum registro seu hoje — teve atividade que não entrou no sistema?
Manda um áudio com o que aconteceu que eu registro. Se hoje foi dia de outra prioridade, responda "hoje neutro" e o motivo.
```

### 8.3 Feedback semanal individual (sexta 18:00)
```
Sua semana, Heloísa (31/08–04/09)

Números vs. meta
• Portas abertas: 14/15 (93%) · melhor dia: quarta (5)
• Apresentações: 8 marcadas, 6 realizadas, 2 no-show (25% — média do time 18%)
• Visitas: 16, 13 com decisor · check-in válido 94%
• Cadastros iniciados: 5/5 · Publicações: 2/3
• Follow-ups em dia: 71%

Destaques
1. Abriu a categoria "decoração": 3 interessados em uma semana
2. Sua conversão apresentação → cadastro (50%) é a maior do time
3. 100% das visitas com resultado registrado em menos de 1 min

Um ponto para olhar
• 4 dos 14 follow-ups saíram com atraso, e 2 desses viraram "não respondeu". Sugestão: fazer a fila de follow-ups às 08:00, antes dos novos contatos.

Para semana que vem
• Publicar os 3 cadastros iniciados (Dona Célia, DJ Marcos, Doces da Ana) — cada um vale 10 pontos no placar.

Precisa de algo de mim ou do Rafael? Responda aqui.
```

### 8.4 Escalonamento para Rafael (nível 2)
```
Rafael, alerta de acompanhamento — Dennis

• Ontem: 1/3 portas · hoje: 0/3 (2 dias consecutivos abaixo de 50%)
• Motivo informado: "fechamento financeiro do mês" (ontem) · hoje sem resposta
• Agenda dos 2 dias: 3 reuniões internas de manhã, sem rota
• Tendência: semana passada 12/15 (80%) — a queda é pontual

Como combinado com o time, avisei o Dennis que você recebeu este alerta.

Sugestões
1. Ajustar a meta dele para 1/dia até sexta
2. Marcar 10 min amanhã 09:00 (vocês dois estão livres)
3. Ignorar esta semana (fechamento)

Responda 1, 2 ou 3, ou me diga o que fazer.
```

Aviso simultâneo à pessoa:
```
Dennis, como combinamos no time: 2 dias abaixo da meta e eu aviso o Rafael. Acabei de enviar a ele o contexto (fechamento financeiro). Se quiser adiantar alguma coisa, responda aqui que eu repasso.
```

### 8.5 Segunda-feira 08:00 (resumo no grupo de growth)
```
Relatório da semana 31/08–04/09 (arquivos HTML/PDF/XLSX em anexo · painel: <link Metabase>)

Meta 100 fornecedores: 11/100 (+4 na semana) · ritmo 2 sem: 3,5/semana · previsão no ritmo atual: 27/02/2027 · necessário até 06/11: 2,1/dia útil
Funil (semana): 63 contatos → 41 conversas → 22 apresentações → 14 interessados → 9 cadastros iniciados → 4 publicados
Time: 92/105 portas abertas (88%) · 41 apresentações realizadas · no-show 18% · 58 visitas (check-in válido 91%)
Densidade (14 categorias ≥5): fechadas 1 (doces) · no ritmo 4 · em risco 6 · sem alvos 3 (gerador, painel de LED, transporte)
Maior gargalo: "cadastro iniciado → perfil completo" — mediana 6 dias, 11 parados
Perdas (semana): 9 — 4 "já anuncia no Casamentos.com", 2 "taxa", 2 "não respondeu", 1 "fora do perfil"
Supply gap (app): 7 buscas sem resultado — "gerador" (4), "trio elétrico" (2), "brinquedos infláveis" (1)

Pauta sugerida (09:00): 1) por que cadastros travam no perfil completo? 2) script para quem já está no Casamentos.com; 3) alvos para gerador/LED/transporte.
Experimentos candidatos: A) cadastro assistido ao vivo na visita (dono: Heloísa) · B) áudio humano no 1º contato vs. texto (Bárbara) · C) quartas em Parnamirim (Matheus)
```

### 8.6 Lembretes ao fornecedor (template utility, número "Komune Agenda")
- 24 h antes: `Olá, {{nome}}! Amanhã às {{hora}} a {{pessoa}} da Komune apresenta a plataforma para {{empresa}} ({{formato}}). Confirma? Responda 1 para confirmar ou 2 para escolher outro horário.`
- 1 h antes (online): `{{nome}}, sua apresentação com a {{pessoa}} começa às {{hora}}. Link: {{meet}}. Qualquer imprevisto, responda aqui.`
- 1 h antes (visita): `{{nome}}, a {{pessoa}} chega em {{empresa}} por volta das {{hora}}. Se precisar mudar, responda aqui.`
- No-show: `{{nome}}, não conseguimos nos falar hoje — acontece! Tenho estes horários: {{slot1}}, {{slot2}}, {{slot3}}. Qual fica melhor?`

---

## 9. Opções de ferramentas/APIs com custos (resumo para decisão)

| Necessidade | Recomendado (MVP) | Custo/mês estimado | Alternativa paga |
|---|---|---|---|
| Geodados/zonas | Supabase + PostGIS | R$ 0 (já contratado) | — |
| Geocodificação | Google Geocoding (10k grátis) ou Nominatim (1 req/s, cache) | R$ 0 | — |
| Matriz de tempos / ordem das paradas | OSRM `table` + `trip` (ou VROOM) na máquina dedicada; ou Google Route Matrix (10k grátis) | R$ 0 | Google Route Optimization (1k shipments grátis; US$ 30/1k) |
| Navegação | Links universais Google Maps (≤ 3 waypoints mobile) e Waze (1 destino) | R$ 0 | — |
| Agenda + Meet | Google Calendar API (`events.insert` c/ Meet, `freeBusy`, `watch` + `syncToken`) | R$ 0 | Calendly Standard US$ 10/assento; Cal.com Teams US$ 12/usuário |
| Lembretes ao fornecedor | WhatsApp Cloud API (utility US$ 0,0068/msg BR) em número dedicado | ~US$ 4 (600 msgs) | BSPs com markup 10–30% |
| Conversa humana (Heloísa) | Instância não oficial (Evolution/Baileys) com limites anti-ban | R$ 0 (+ risco) | Cloud API marketing US$ 0,0625/msg |
| Digests internos | Mesma instância interna (≤ 30 msgs/dia) + Telegram reserva | R$ 0 | Geekbot (grátis ≤ 10 no Slack) |
| Transcrição de voz | faster-whisper local | R$ 0 | Gemini 3.5 Flash-Lite ~US$ 0,3; gpt-4o-mini-transcribe ~US$ 1,8 (600 min) |
| Extração/textos | Claude Haiku 4.5 (digests), Sonnet 5 (semanal) | < US$ 5 | — |
| OCR de cartão | Claude Vision ou Google Vision (1k grátis) | ~R$ 0 | — |
| Tarefas | Asana API (PAT; `GET /tasks` + webhooks) | R$ 0 | Search API exige workspace premium |
| Agendador | Supabase Cron (pg_cron) / cron no worker | R$ 0 | — |
| Painéis | Metabase sobre Supabase (já planejado) | R$ 0 | — |
| **Total externo** | | **≈ US$ 10/mês (≈ R$ 55)** | SaaS equivalente para 7 pessoas: US$ 700–1.200/mês (Badger/SalesRabbit + Ambition/Spinify + Calendly/Geekbot) |

**Arquitetura sugerida:** Supabase (Postgres + PostGIS + pg_cron + Edge Functions + Auth) como núcleo; um worker Node/Python na máquina dedicada (WhatsApp Evolution, faster-whisper, OSRM/VROOM em Docker, jobs de digest); CRM web mobile-first (PWA com geolocalização, câmera e "adicionar à tela inicial") — ou tela Expo reaproveitando o stack do app; Metabase para painéis.

**Ordem de construção (rodada de 15 dias):**
1. Dias 1–5: metas + contadores, formulário "porta aberta", digest 07:30/18:00 por WhatsApp, relatório de segunda 08:00 (versão texto + XLSX).
2. Dias 6–10: Google Calendar (evento + Meet + freeBusy), robô marcando slots, lembretes 24 h/1 h, rota simples (ordem por OSRM + links Maps/Waze).
3. Dias 11–15: check-in GPS, áudio → ficha, OCR de cartão, fila NBA, leaderboard/streaks, escalonamento, burn-up e densidade no relatório HTML/PDF.

---

## 10. Fontes

**Roteirização e mapas**
- Badger Maps — review e preços 2026: https://www.fieldsalestools.com/tools/badger-maps
- Map My Customers — preços (Capterra): https://www.capterra.com/p/145636/Map-My-Customers/pricing/
- SalesRabbit — review e preços 2026: https://www.fieldsalestools.com/tools/salesrabbit
- Route4Me — preços 2026: https://www.upperinc.com/blog/route4me-pricing/
- Google Maps Platform — tabela de preços (Routes, Route Matrix, Directions, Route Optimization, Geocoding, Places): https://developers.google.com/maps/billing-and-pricing/pricing
- Google Route Optimization API — uso e cobrança por shipment: https://developers.google.com/maps/documentation/route-optimization/usage-and-billing
- Google Maps URLs (dir/navigate/waypoints): https://developers.google.com/maps/documentation/urls/get-started
- Waze deep links: https://developers.google.com/waze/deeplinks
- OSRM HTTP API (route, table, trip, nearest): https://project-osrm.org/docs/v5.24.0/api/
- VROOM (VRP com janelas, BSD-2): https://github.com/VROOM-Project/vroom
- OR-Tools — VRP com janelas de tempo: https://developers.google.com/optimization/routing/vrptw
- Nominatim — política de uso: https://operations.osmfoundation.org/policies/nominatim/
- Supabase — PostGIS: https://supabase.com/docs/guides/database/extensions/postgis
- Supabase — Cron (pg_cron): https://supabase.com/docs/guides/cron
- Bairros de Natal (36 bairros, 4 zonas): https://pt.wikipedia.org/wiki/Lista_de_bairros_de_Natal

**Agenda e reuniões**
- Google Calendar API — criar evento com Meet (conferenceData/hangoutsMeet): https://dev.to/himanshusinghtomar/automating-google-meet-creation-14mo
- Google Calendar API — freeBusy.query: https://developers.google.com/workspace/calendar/api/v3/reference/freebusy/query
- Google Calendar API — push notifications (events.watch): https://developers.google.com/workspace/calendar/api/guides/push
- Google Calendar — agendas de compromissos (booking pages): https://support.google.com/calendar/answer/10729749
- Cal.com/Cal.diy — repositório (MIT, aviso de uso não produtivo): https://github.com/calcom/cal.com
- Cal.com self-host 2026 (preços hospedados Teams/Organizations): https://ossalt.com/guides/self-host-cal-com-calendly-2026
- Cal.com self-hosting — requisitos: https://ossalt.com/guides/self-hosting-guide-calcom-2026
- Calendly — preços: https://calendly.com/pricing
- Motion — preços: https://www.usemotion.com/pricing
- Reclaim.ai — preços: https://reclaim.ai/pricing

**WhatsApp**
- WhatsApp Business Platform — modelo de preços (por mensagem, janela de serviço, entry points): https://whatsappbusiness.com/products/platform-pricing/
- Preços 2026 por categoria e tarifas do Brasil: https://blueticks.co/blog/whatsapp-business-api-pricing-2026
- Preços 2026 (EngageLab, tarifas BR em USD): https://www.engagelab.com/blog/whatsapp-business-api-pricing
- Preços Brasil (Whautomate, verificado jul/2026): https://whautomate.com/whatsapp-business-api-pricing-brazil
- Preços Brasil em BRL aproximado (Message Central, mai/2026): https://www.messagecentral.com/blog/whatsapp-business-api-pricing-brazil
- Evolution API sem banimento — limites práticos: https://wasenderapi.com/blog/how-to-use-evolution-api-without-getting-banned-on-whatsapp-2026-guide

**Metas e gamificação**
- Pipedrive — AI Sales Assistant (next best action): https://www.pipedrive.com/en/newsroom/pipedrive-unveiled-ai-powered-sales-assistant-to-significantly-boost-sales-performance
- HubSpot — criar metas: https://knowledge.hubspot.com/reports/create-goals
- Ambition/Spinify/SalesScreen — preços e Lei de Goodhart: https://kendo.ai/blogs/best-sales-gamification-software-tools
- Spinify — mecânicas (Recognition/Coaching Agent, progress bars): https://spinify.com/salesscreen-alternative/

**Standup bots e accountability**
- Geekbot — preços: https://geekbot.com/pricing/
- Geekbot — boas práticas de standup: https://geekbot.com/blog/daily-standup-meeting/
- Standuply — preços: https://standuply.com/pricing
- Range — preços: https://www.range.co/pricing

**Asana**
- Asana — Search tasks (premium): https://developers.asana.com/reference/searchtasksforworkspace
- Asana — Webhooks guide: https://developers.asana.com/docs/webhooks-guide

**IA (voz, OCR, LLM)**
- OpenAI — preços de transcrição: https://developers.openai.com/api/docs/pricing
- Gemini API — preços (áudio, Flash-Lite): https://ai.google.dev/gemini-api/docs/pricing
- faster-whisper: https://github.com/SYSTRAN/faster-whisper
- Claude — preços (Haiku 4.5, Sonnet 5, Batch, cache): https://platform.claude.com/docs/en/about-claude/pricing
- Google Cloud Vision — preços OCR: https://cloud.google.com/vision/pricing

**Relatórios**
- Burn-up vs. burndown (Atlassian): https://www.atlassian.com/agile/tutorials/burndown-charts
- Plano estratégico 90 dias KOMUNE (KRs, ritual, ondas de prospecção): documento do Projeto `planejamento/plano-estrategico-90-dias-komune.md`
