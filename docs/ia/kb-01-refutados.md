# Refutados — Tríade · Contexto 1: inventário do produto

O que foi escrito, pareceu verdade e não era. Este arquivo NÃO vai para a base
de conhecimento. Ele serve para três coisas: não reescrever o mesmo erro no
próximo contexto, saber onde a tela e o código discordam, e ter o registro de
que a checagem aconteceu.

Cada item traz o verbete que caiu e o motivo com a prova.

---

## 1. `os-quatro-numeros-do-topo-do-meu-dia`

**Caiu por:** promessa que a tela não cumpre.

O verbete terminava dizendo que o details "De onde saem estes números" explica os
quatro cartões do topo. Aberto no navegador, o conteúdo inteiro do details é:
"Cadastros iniciados: é uma aproximação…", "Publicados: é uma aproximação…",
"Respostas recebidas: ainda não é medível…". Nenhum dos quatro cartões em
destaque (Portas batidas, Portas abertas, Ligações, Reuniões marcadas) é
explicado ali — a função que monta a lista só inclui métricas não mensuráveis ou
aproximadas, e as quatro em destaque não são nem uma coisa nem outra. Quem
clicasse esperando "de onde sai Portas abertas" não acharia.

O resto do verbete conferia: os cartões, o "sem meta", a frase da meta e o atalho
"Definir em Metas" para gestor e admin. **Vale reescrever sem a última frase.**

## 2. `como-e-a-tela-de-ligar-para-um-contato`

**Caiu por:** nome de botão que não existe na tela.

O verbete dizia que "Não me procure mais" está sempre disponível. Esse rótulo não
está em lugar nenhum da interface. O botão real escreve **"Pediu para não ser
mais procurado"**. "Não me procure mais" aparece só dentro de um comentário de
código, que não é tela.

O resto conferia: "Tentativa X de Y", "Da última vez:", Ligar / Copiar número /
Liguei, o cronômetro, "Foi outro resultado", "Encerrar agora", "Com quem você
falou?" e "Pular este contato". **Vale reescrever com o rótulo certo** — mas veja
a ressalva no fim deste arquivo: essa tela nunca foi vista aberta.

## 3. `onde-fica-registrar-contato`

**Caiu por:** dois erros de caminho.

(a) No cartão de compromisso da Agenda, o botão "Registrar a visita" **não** leva
para a tela de registrar contato — ele abre a folha "Como foi a visita?" ali
mesmo. O único link para a tela, no cartão, é o botão "Registrar contato", e só
quando o compromisso ainda está a marcar. Só na aba Rota é que "Registrar a
visita" leva mesmo para a tela.

(b) "Quando você chega por um desses caminhos, o parceiro já vem escolhido" é
falso em dois dos cinco caminhos citados: os atalhos do Meu dia vazio e do resumo
da noite abrem a tela no passo de escolher o parceiro.

## 4. `onde-vejo-os-relatorios`

**Caiu por:** contradição com outro verbete, e erro para quem decide.

"Relatórios é o último item do menu da esquerda" é falso para admin e gestor: o
menu termina em **Admin** para esses dois papéis. Na sessão SDR que foi
fotografada, Relatórios parece o último só porque Admin está escondido. O verbete
irmão sobre Admin afirmava o contrário; os dois não podiam estar certos ao mesmo
tempo, e este erra justamente para o Rafael e para qualquer gestor.

O resto conferia: as oito abas são Semana, Funil, Categorias, Bairros, Pessoas,
Horários, Fontes e Base, e o recorte fica no endereço.

## 5. `admin-auditoria`

**Caiu por:** corpo truncado.

O texto chegou cortado no meio da frase ("…quando, quem, o que fez, em") e não
havia o que julgar. O pedaço legível confere — a seção "Auditoria" existe na aba
LGPD e as colunas são, na ordem, "Quando", "Quem", "O que fez", "Em qual
registro" e "O que mudou" —, mas verbete incompleto não entra: quem lê para no
meio de uma instrução. **Refazer inteiro.**

## 6. `o-que-o-cartao-do-funil-mostra`

**Caiu por:** rótulo que só existe para o leitor de tela, e "letra" que não é letra.

O verbete dizia que o cartão mostra o estado da próxima ação como "Sem próxima
ação, Hoje, **Agendada** ou Atrasada". "Agendada" nunca é escrita no cartão: ela
só alimenta o texto invisível do leitor de tela. O que o olho lê é "Sem próxima
ação", "Hoje, 09:00", "Amanhã, 14:00", "Em 2d", "Venceu ontem" e "Atrasada 4d".
Na foto do funil, o cartão da Abracadabra Festas mostra "Em 2d · Primeiro
contato".

Erro adicional: "prioridade comercial aparece como uma letra" — os valores
aceitos são A+, A, B e C, e A+ não é uma letra.

## 7. `funis-no-celular`

**Caiu por:** o único nome citado é exatamente o que não aparece no formato descrito.

Fotografado em 390x844: o botão dentro de cada cartão diz **"Mover de etapa"**,
não "Mover". São dois botões diferentes no código — o do celular escreve "Mover
de etapa", o do computador escreve "Mover". O resto do verbete estava certo
(trilha horizontal com contagem, a etapa ativa entrando em cena sozinha, cartões
em largura cheia). **Vale reescrever com o rótulo certo.**

## 8. `admin-nao-contatar`

**Caiu por:** mandar a pessoa procurar um controle que não está lá.

Última frase: "Quem liga essa marca é a ficha do parceiro, não esta tela." A
ficha só **exibe** a marca "Não contatar" — não há nenhum controle nela para
ligá-la. Quem liga a marca é: soltar o cartão na etapa de opt-out no funil, o
desfecho "Pediu para parar" ao registrar um contato, ou a importação de
supressão.

O resto do verbete conferia (seção "Parceiros marcados 'não contatar'", colunas
Parceiro / Onde fica com bairro e cidade, e o vazio "Nenhum parceiro marcado").

## 9. `admin-exportar-parceiro`

**Caiu por:** corpo truncado.

Chegou cortado em "Procure pelo n". O pouco verificável estava certo (a pílula se
chama "Exportar parceiro" e o campo é "Procurar o parceiro pelo nome"), mas o
miolo — o que o arquivo traz, a caixa "Incluir o telefone no arquivo", o botão
"Gerar o arquivo" e o aviso de que esta ainda não é a exportação oficial — não
pôde ser cotejado com nada. **Refazer inteiro.**

## 10. `para-onde-leva-cada-linha-do-meu-dia`

**Caiu por:** prometer uma tela que não existe hoje.

Os destinos conferem. O que quebra é a frase final: "a ficha do parceiro, que tem
telefone, negócio e **histórico** numa tela só". Aberta a ficha em foto de página
inteira: ela tem cabeçalho, dados, "Negócios" e "Pré-cadastro na Komune", e no pé
dois cartões de espera — "Linha do tempo · chega no D3" e "Conversa · chega no
D5". Não há histórico nenhum na ficha hoje. A frase foi copiada de um comentário
de código sem conferir a tela.

## 11. `o-que-tem-na-ficha-do-parceiro`

**Caiu por:** um botão que não volta para onde diz que volta, e uma omissão.

O inventário está certo. O que quebra é: "O botão Parceiros, no alto, volta para
a lista de onde você veio." Ele é um link cru para a lista inteira. Como a lista
guarda filtro e página no endereço, quem filtrou "Cerimonialistas, página 2" e
abriu uma ficha volta para a lista inteira na página 1 — e quem chegou pelas
Conversas ou pelo Meu dia não volta para "onde veio" coisa nenhuma.

Além disso, o verbete termina a ficha no pré-cadastro e omite os dois cartões do
pé ("Linha do tempo · chega no D3" e "Conversa · chega no D5").

## 12. `cartao-voltou-para-a-coluna-de-antes`

**Caiu por:** a causa apresentada como "a mais comum" não pode acontecer.

O aviso existe e fica até você fechá-lo ou até o próximo movimento. Mas quando a
etapa de destino exige alguma coisa (próxima ação obrigatória, campos
obrigatórios, ou é a etapa de opt-out), o arraste é **interceptado antes** e a
folha de mover abre: o cartão não chega a sair da coluna e nenhum aviso é
emitido. Faltas de preenchimento aparecem em vermelho **dentro da folha**, nunca
no aviso do quadro. Ou seja: "arrastei e voltou sozinho" não acontece por esse
motivo.

---

## Ressalvas de método — o que os verbetes sobreviventes não tiveram

Isto não é refutação: é o limite do que foi possível ver. Um verbete escrito só
com leitura de código pode estar certo e ainda assim descrever uma tela que
ninguém abriu.

**Escritos a partir do código, sem a tela:**

- A tela de chamada (`/ligar/[id]`): não há lote montado na base local e não se
  montou um para não criar dado no produto.
- A tela de Ligar com lotes de pé: o cartão do lote, a barra de progresso, os
  contadores e os botões "Abrir e ligar" / "Encerrar" nunca foram vistos.
- O passo 2 (canal e resultado) e o recibo da tela de registrar contato.
- O estado "Fora do horário de ligação".
- A folha "Mover" do funil aberta: motivo de perda, evidência da autorização e o
  bloco de próxima ação vieram só do código.
- Os passos 2 e 3 da importação (mapa das colunas e prévia).
- A aba "Fontes" do Radar: as 11 fontes foram lidas, não vistas desenhadas.
- A fila do Radar com candidato de verdade: está vazia, então nunca se viu um
  cartão de candidato, nem os botões Aprovar / Recusar / Não contatar, nem o
  bloco de fichas parecidas.
- A régua de etapas do funil de Ativação, e o funil "Produtor e cerimonialista".
- A rota da tarde com paradas calculadas: nenhuma visita tem coordenada boa o
  bastante hoje.
- Os cartões de meta com barra preenchida no Meu dia: as quatro métricas estão em
  "sem meta".
- Uma conversa com mensagem de verdade: a base não tem nenhuma. A linha do tempo
  com mensagem recebida/enviada, o relógio da janela de 24 h e a caixa de
  resposta não foram vistos funcionando.
- A aba "Aprovar" com rascunho dentro: está vazia.
- O botão "Definir meta" e a folha que define a meta: a sessão era SDR.
- Em Relatórios, só a aba "Semana" foi aberta.
- Do Resumo do dia, só a aba das 07:30.
- Dos cinco cartões de régua em Cadências, só "Primeiro contato por voz".
- Os estados vazios e de erro de Parceiros e de Funis: a base tem 100 parceiros e
  50 negócios, então não foi possível provocá-los.

**Nunca visto em tamanho de celular.** Todas as fotos são de tela larga. A barra
de baixo, o menu "Mais", os botões redondos com "+" e a trilha de etapas do funil
no celular vieram só do código. Vários verbetes sobreviventes afirmam coisas
sobre o celular.

**Nunca visto por outro papel.** Todas as fotos foram feitas como Heloísa
Cavalcanti (SDR). O que muda para admin, gestor, leitura ou financeiro não foi
confirmado na tela.

**Procurado e não achado:**

- Link para a tela de registrar contato a partir da ficha do parceiro ou do
  funil: não existe nenhum.
- Um jeito de mandar o robô coletar (agendar uma coleta) dentro do Tríade: só há
  o painel que mostra o estado do coletor.

---

## Perda de material neste contexto

O contexto escreveu **98** verbetes: 79 sobreviveram e 19 foram refutados. Só
**46 sobreviventes** e **12 refutações** chegaram até a etapa de gravação — os
outros 33 sobreviventes e 7 refutações não foram repassados e não estão em
nenhum dos dois arquivos. Não dá para saber de quais telas eram. É provável que
parte dos buracos listados no relatório (Cadências, Metas, Relatórios, Admin,
ficha do parceiro) esteja justamente nesses 33.
