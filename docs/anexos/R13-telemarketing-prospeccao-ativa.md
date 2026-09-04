# R13 — Prospecção ativa por ligação (módulo de telemarketing)

**Origem:** PRD "Módulo Telemarketing | CRM 13", enviado pelo Matheus em 04/09/2026, tratado aqui
como **fonte de ideias**, não como especificação a cumprir. Este anexo é a adaptação à realidade do
Tríade: quem opera, qual base, quais decisões já estão fechadas.

**Decisões que o Matheus deu junto com o PRD, e que mandam sobre tudo abaixo:**
1. O primeiro contato passa a ser **por ligação**, não por WhatsApp.
2. Quem liga é **o Matheus e a Heloísa** — duas pessoas, não uma equipe de telemarketing.
3. O CRM se chama **Tríade**. Komune é a empresa dona dele e o marketplace para onde o
   fornecedor é levado.

---

## 1. O que muda na estratégia, e por que muda para melhor

O Tríade nasceu WhatsApp-primeiro (ADR-05, ADR-06): o robô redige, a Heloísa aprova, a conversa
acontece por mensagem. Passar a ligação para a frente muda a ordem do roteiro do produto — e
destrava um problema real de calendário.

**Ligação não depende da Meta.** A verificação do CNPJ, a aprovação dos três modelos e o
aquecimento do número somam de duas a três semanas em que ninguém consegue mandar a primeira
mensagem. Ligar não espera nada disso. Dos 100 leads reais que já estão na base, **66 têm
telefone**. A operação pode começar amanhã.

O WhatsApp não sai de cena: ele deixa de ser a porta de entrada e vira **apoio da ligação** —
confirmar reunião, mandar o link do cadastro, retomar quem não atendeu. É exatamente o uso que o
R04 já apontava como o mais seguro para a saúde do número, e o que menos gasta modelo aprovado.

---

## 2. O que já existe no Tríade e serve sem mudar uma linha

Boa parte do miolo daquele PRD já está construída. O que segue não é plano, é o que está no banco
hoje.

### 2.1 O catálogo de desfechos é o "aperta botão" do fluxograma

`interaction_outcomes` tem 34 desfechos por superfície, **8 deles de ligação**, e cada um já carrega
as três consequências que o PRD pede (para onde vai o lead, qual a regra de recontato, qual a
próxima ação):

| Botão | Espera | Etapa destino | Temperatura | Próxima ação |
|---|---|---|---|---|
| Não atendeu | 1 dia | — | — | Ligar D+1 (última) |
| Caixa postal | 1 dia | — | — | Ligar D+1 |
| Número errado | nunca mais | — | — | Buscar outro canal |
| Atendeu, retorna depois | 2 dias | — | morno | Ligar na data combinada |
| Interessado | 0 | Em conversa | quente | Marcar apresentação |
| Agora não | 30 dias | Nutrição | frio | Reativar com gancho |
| Sem interesse | 90 dias | Perdido | — | — |
| Reunião marcada | 0 | Reunião marcada | quente | Reunião na data |

Isso cobre o ticket 11 do backlog deles ("tabulações parametrizáveis com consequências
automáticas"), que é o item mais caro daquela lista.

### 2.2 O resto que já está de pé

| Ticket do PRD deles | No Tríade hoje |
|---|---|
| 3 — blacklist com verificação em camadas | `suppression_list` + `organizations.do_not_contact`, com o guardrail valendo no banco: contato suprimido não gera tarefa, não muda etapa, não esquenta |
| 10 — tela única do operador, sem avançar sem tabular | `/registrar`: 2 toques, o toque no desfecho é o commit, sem botão salvar |
| 15 — bloqueio fora da janela | tabela `holidays` (32 feriados) e a regra de janela do RF-CON-11 |
| 16 — fontes com base legal | `sources` já tem `legal_basis`, `robots_ok`, `terms_notes` |
| 24–26 — cadastro no app como desfecho confirmado | Edge Function `crm-pre-registration` + webhook de status + reconciliação noturna (ADR-02) |
| 2 — importador com E.164 e dedup | esteira `raw_capture → source_record → supplier_candidate` (ADR-08), 7 chaves de dedup |
| 12 — agendamento com lembrete | `tasks` + a agenda do D7 |

---

## 3. O que entra de novo — o recorte para duas pessoas

### 3.1 Lote de ligação

Hoje quem liga escolhe para quem ligar. O princípio do PRD é o contrário, e é o que faz a diferença:
**o operador não escolhe o próximo contato e não decide o que fazer depois da ligação.**

Um lote é um recorte fechado de trabalho:

- nome, dono, período
- **origem única de temperatura** (não mistura base quente com coleta fria — a regra dura do PRD,
  e ela é boa: misturar torna a conversão do lote um número sem significado)
- roteiro vinculado (versionado)
- janela de horário, máximo de tentativas por telefone, intervalo mínimo entre elas
- ordenação da fila

**Reserva:** um contato só pode estar ativo em um lote por vez, e a reserva acontece quando o lote
é criado, não quando se disca. Com duas pessoas ligando isso deixa de ser detalhe: sem reserva, o
Matheus e a Heloísa ligam para o mesmo buffet no mesmo dia.

### 3.2 Roteiro em árvore

A melhor ideia daquele documento. O roteiro não é texto na lateral da tela: cada resposta possível
do cliente é um botão, e a tela vira sozinha para a fala seguinte. Quem liga nunca precisa saber "o
que falar agora".

E o sistema grava por onde a conversa passou (`caminho_script`). Depois de duas semanas isso
responde a pergunta que nenhum palpite responde: **em qual frase as pessoas desligam.**

### 3.3 Dois eixos de tabulação

O nosso catálogo hoje mistura resultado técnico com resultado comercial na mesma lista. O PRD
separa, e está certo:

- **Eixo técnico**, preenchido pelo sistema: atendida por humano, caixa postal, não atendeu,
  ocupado, número inválido, chamada muda, queda de linha.
- **Eixo comercial**, escolhido por quem ligou, e que **só existe se alguém atendeu**.

A mudança no nosso banco é pequena: os desfechos `lig_nao_atendeu`, `lig_caixa_postal` e
`lig_numero_errado` deixam de ser escolha da pessoa e passam a ser resultado da chamada. Os outros
cinco continuam como estão.

### 3.4 Telefonia

É a única peça que não temos nada, e a que decide o custo.

**Recomendação: discador em nuvem com API (caminho A do PRD), atrás de uma interface nossa.** Com
duas pessoas ligando, construir motor de discagem próprio é queimar mês de desenvolvimento para
replicar algo que se aluga por posição. O valor do Tríade não está em discar.

A interface (`ProvedorTelefonia`: `iniciar_chamada`, `encerrar`, `pausar`, `ao_evento`) existe para
que trocar de fornecedor — ou migrar para Asterisk próprio quando passar de ~15 posições — seja
reescrever um adaptador, não o módulo.

**Modo de discagem: progressivo.** Um número por pessoa livre. Preditivo está fora: o próprio PRD
diz que abaixo de 8–10 posições o algoritmo gera chamada abandonada, que a Anatel trata como
abusiva.

**Ponto de arquitetura que precisa entrar no desenho desde já:** pelo menos um dos fornecedores
brasileiros (3C Plus) **não manda webhook** — os eventos chegam por WebSocket. Isso exige um
processo escutando socket, não um endpoint REST passivo. No nosso desenho isso é mais um comando do
`apps/workers` (`worker-tel`), consumindo para `pgmq` como os outros.

---

## 4. O que eu descartei, e por quê

Metade daquele PRD é aparato para **gerenciar uma equipe de telemarketing**. Vocês são duas pessoas,
e uma delas é o desenvolvedor.

| Descartado agora | Motivo |
|---|---|
| Curadoria de lote com aprovação do supervisor, perfis de curadoria, envelope de critérios | Não existe supervisor. O Matheus e a Heloísa montam o próprio lote e pronto |
| Ficha individual do operador em três blocos + matriz "cura bem × executa bem" | Ferramenta de avaliação de equipe. Com duas pessoas, a conversa resolve |
| Escuta e sussurro (monitoria em tempo real) | Idem |
| Discagem preditiva e power | O próprio PRD desaconselha abaixo de 6–10 posições |
| Multi-tenant | Só se o Tríade virar produto vendido, e isso não está decidido |
| Estados de pausa por NR-17 | A NR-17 rege operação de telemarketing com jornada dedicada; não é o caso de duas pessoas que fazem outras coisas |

**Mas guardo a costura para depois:** `chamada` e `tabulação` já nascem com quem fez, quem montou o
lote e qual versão de roteiro. São três colunas hoje inúteis que, no dia em que existir uma terceira
pessoa, transformam medição em algo possível sem migração.

---

## 5. Roteiro: a adaptação que o PRD deles não podia fazer

O roteiro do PRD original bifurca em pessoa física e jurídica, e a variante PF fala de dividir a
conta com os amigos. **Isso é o lado da demanda do marketplace.** O Tríade trabalha o lado da
oferta: fornecedores, produtores e cerimonialistas.

Nossa bifurcação é outra, e sai direto dos dois funis que já existem:

**Variante fornecedor** (buffet, DJ, decoração, tenda, brinquedo — 50 da base)
Ângulo: *aparecer para quem já está procurando.* O dono do buffet não quer um app a mais; ele quer
telefone tocando. O gancho é demanda, não tecnologia.

**Variante produtor e cerimonialista** (50 da base)
Ângulo: *montar o evento inteiro num lugar só.* Quem organiza eventos sofre com fornecedor que some,
orçamento por WhatsApp e contrato solto. O gancho é controle.

O tipo vem de `organizations.kind`, que já está preenchido. O sistema escolhe a variante, não quem
liga.

**Regra de copy que vale para as duas:** o gancho cabe em 15 segundos e **termina em pergunta**.
Quem pergunta conduz a ligação.

**Aviso de origem no primeiro nó**, como o PRD manda ("encontrei seu contato em..."). Além de ser
exigência de transparência da LGPD, derruba a desconfiança logo no começo — e no nosso caso é
verdade fácil de falar, porque a base veio de diretório público e do próprio mercado de Natal.

---

## 6. Conformidade: o que o código precisa impedir

Cada item vira regra, não parágrafo.

- **Janela de horário com bloqueio efetivo.** Fora da janela o botão de discar não funciona. Padrão
  conservador: seg–sex 9h–20h, sáb 10h–13h, domingo e feriado bloqueados. Já temos a tabela de
  feriados e o fuso `America/Fortaleza`.
- **Chamada abandonada.** Se não houver alguém livre para atender, **desligar antes** de a pessoa
  atender, nunca depois. A Anatel trata como abusiva a chamada que cai em até 3 segundos.
- **Opt-out vale para os dois canais.** "Não me ligue mais" e "pare de mandar mensagem" caem na
  mesma `suppression_list`. Não existe bloqueio por canal. Isso já está implementado e testado.
- **Gravação:** aviso no primeiro nó do roteiro e prazo de retenção definido (PRD §10.6).
- **Base legal.** Prospecção fria se apoia em legítimo interesse, que não é carta branca: exige LIA
  documentado por tipo de fonte. O R06 já trata disso e o `sources.legal_basis` já guarda o campo —
  falta o documento, e ele é do Dennis.
- **0303:** deixou de ser obrigatório em agosto de 2025. Não usar. Vale perguntar a todo fornecedor
  sobre **Origem Verificada**, que mostra o nome na tela de quem recebe e muda a taxa de atendimento
  de verdade.

---

## 7. Ordem de construção

**Antes de codar: 100 ligações no papel.** É a Fase 0 do PRD deles e é o conselho mais barato do
documento. O Matheus e a Heloísa ligam com o roteiro impresso e uma planilha, para descobrir onde a
conversa morre e quais objeções aparecem de verdade. Codificar um roteiro errado é o desperdício
mais caro deste módulo — e os 66 leads com telefone já estão lá.

Depois, em ordem:

1. **Lote e fila** — recorte, reserva do contato, ordenação, janela de horário com bloqueio.
2. **Dois eixos de tabulação** — separar resultado técnico do comercial no catálogo que já existe.
3. **Roteiro em árvore** — motor, registro do caminho, JSON no começo (editor visual não é MVP).
4. **Telefonia** — interface, primeiro adaptador com escuta de socket, discagem por clique.
5. **Softphone no navegador** — WebRTC dentro da tela, sem instalar nada.
6. **Encerrar-e-próxima** — o ciclo automático que é o ganho de produtividade real.
7. **Relatório por origem, horário e versão de roteiro** — é o que reorganiza a escala depois de
   duas semanas.

O WhatsApp entra por cima disso como passo de cadência (o "canal é atributo do toque, não do lote"
do PRD deles), e não como módulo paralelo — o que combina com o que o nosso PRD já previa para o D7.

---

## 8. O que ainda depende de decisão humana

1. **Fornecedor de telefonia.** Precisa cotar. As perguntas que separam proposta boa de ruim estão
   na §13 do PRD original — em especial: a API cobre tudo que a tela cobre? os eventos vêm por
   webhook ou socket? qual a taxa de acerto do AMD e como comprovam? dá para embutir o WebRTC na
   nossa tela?
2. **Meta por pessoa** — ligações por dia, reuniões por semana, cadastros por semana. Vira parâmetro
   do lote, então precisa existir antes do primeiro lote.
3. **A reunião cai na agenda de quem?** Matheus, Heloísa, ou os dois?
4. **LIA por tipo de fonte** (Dennis), antes de escalar a coleta fria.
