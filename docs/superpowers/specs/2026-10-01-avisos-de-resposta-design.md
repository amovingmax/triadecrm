# Avisos de resposta: o desenho

**O problema.** O número da KOMUNE vive só na Cloud API e não toca celular nenhum. Quando um parceiro ou cliente escreve, o CRM só avisava quem estava com a tela de Conversas aberta e visível. Quem estava no funil, no Meu dia ou em outra aba descobria a mensagem quando lembrava de olhar, ou pelo e-mail por lote.

**O que muda.** A casca do CRM passa a saber, em qualquer tela, que alguém escreveu. Ela faz três coisas com isso: um número ao lado de Conversas, que é de cada pessoa; um cartão "Nova mensagem" no canto de cima da tela; e, com o CRM fora de vista, a notificação do navegador. O aviso nasce ligado e cada pessoa pode silenciar. Na tela de Conversas, quem não é parceiro passa a aparecer também em "Todas".

**O que não muda.** Nada em `supabase/` nem em `apps/workers/`. Sem migração. A entrega só lê o banco.

Pedido e decisões: Janio, 01/10/2026. RF-CON-04 (resposta não pode cair onde ninguém vê) e RF-AST-08 (alarme no instante do evento, desligável por pessoa).

---

## 1. De quem é o aviso

| Situação da conversa | Quem é avisado |
|---|---|
| **Parceiro**, e alguém do time já escreveu ou gravou áudio nela | Só quem atende (`conversations.assignee_id`) |
| **Parceiro**, e ninguém escreveu ainda | Admin, gestor e SDR; o embaixador só se a conversa aponta para ele |
| **Parceiro**, e quem atende foi desativado | Conta como "ninguém escreveu" |
| **Cliente** (quem não é ficha, a aba "Clientes") | Admin, gestor e SDR, sempre, tenha alguém respondido ou não; o embaixador só se a conversa aponta para ele |
| Papel leitura ou financeiro | Nunca: não respondem conversa |

**O cliente é de todos os operadores** (Janio, 02/10/2026, depois de ver em produção): "a mensagem chegou somente para quem está assumindo a conversa, e isto é o certo [...] agora quero a mesma situação para a aba de 'clientes' (que são as pessoas que usam o app), sendo que essa aba deve ter a notificação exibida para todos os operadores". O parceiro tem alguém conduzindo a captação; o cliente é atendimento, e responde quem estiver na frente do CRM. Cada operador deixa de ver a conversa do cliente como nova quando ele mesmo a abre: a resposta de um colega não a tira do número dos outros.

"Alguém escreveu" é uma mensagem de saída com `origin = 'crm'`, `author_kind` em `human` ou `bot_ai`, `type` diferente de `template` e `status` diferente de `failed`. É o mesmo critério do gatilho `app.messages_quem_responde_atende`, menos os modelos: o cumprimento de abertura e o de campanha abrem a conversa, não a atendem. Por isso a resposta a uma campanha avisa todos que atendem, e não só quem disparou.

O recorte de "todos que atendem" é o de `public.meu_dia` desde o ADR-17: a fila de quem respondeu é de quem abrir.

A regra está em `apps/web/src/components/avisos/regra.ts`, em funções puras. É regra de tela, não de segurança: a RLS de `conversations` e `messages` continua decidindo o que cada pessoa enxerga, e nada aqui alarga isso.

## 2. O número ao lado de Conversas

Conta as conversas com mensagem nova para esta pessoa que ela ainda não abriu. Cai conversa a conversa: abriu uma, sai de 5 para 4.

A primeira versão zerava tudo ao entrar na tela de Conversas. Janio, 02/10/2026: "ele não deve desaparecer todo de uma vez assim que eu abro a aba de conversas, ele deve ir verificando uma por uma".

- Aparece no trilho do desktop, na folha "Mais" e na barra inferior do celular. A barra do celular recebia a contagem e não a desenhava.
- Muda sozinho: sobe quando chega mensagem e cai quando a pessoa abre a conversa ou quando um colega a responde.
- **A marca "Nova" na lista.** Cada conversa que conta no número leva, na lista de Conversas e na aba "Clientes", uma faixa e um selo "Nova" em menta. Os dois saem quando a pessoa abre a conversa. Número e marcas andam juntos: cinco marcadas, número 5.
- **Abrir é escolher.** Conta o clique na lista, o botão Responder do cartão e o link direto. A conversa que o desktop abre sozinho, por ser a primeira da lista, continua marcada: é a mesma régua com que a tela zera o "por ler".
- **Mensagem nova numa conversa já aberta volta a contar**, a menos que a pessoa esteja com ela aberta e à vista.
- **Não é o "por ler".** O número branco da linha conta mensagens e é do time inteiro (`conversations.unread_count`). A marca "Nova" é de cada pessoa e fica só no navegador dela.
- **Deixa de contar rascunhos da IA.** Eles continuam na aba "Aprovar" da tela. Somar os dois misturaria "chegou mensagem" com "tem rascunho", e o número não zeraria ao abrir.

O que foi aberto fica guardado no navegador, por pessoa: para cada conversa, a chegada que estava lá quando ela foi aberta. Um piso (a chegada abaixo da qual nada conta) só anda sobre o que já foi aberto, para a leitura e o registro não crescerem sem fim. Os dois são sempre carimbos do banco (`last_inbound_at`), nunca o relógio do aparelho. Um computador adiantado marcaria "aberta" no futuro e calaria as mensagens seguintes.

## 3. O cartão "Nova mensagem"

A primeira versão usava o aviso flutuante padrão do CRM, uma linha pequena no topo, igual à de "Conversa arquivada". Janio: "deve aparecer um pop-up mais profissional e que seja muito claro que tem uma nova mensagem".

O cartão fica no canto de cima, à direita no desktop e de ponta a ponta no celular. Ele diz, nesta ordem:

1. **Que é mensagem nova, e de quem**: faixa em menta na borda e o selo "Mensagem de parceiro" ou "Mensagem de cliente", com a hora.
2. **Quem é**: o nome em destaque, com as iniciais, e uma linha de contexto logo abaixo.
3. **O quê**: o começo do texto, em até duas linhas. Sem texto, diz o que chegou ("Mensagem de áudio", "Imagem", "Documento").
4. **O que fazer**: o botão Responder, que abre a conversa.

**Parceiro ou cliente** (Janio, 02/10/2026: "poderíamos fazer uma identidade visual nas notificações para clientes e parceiros?"). O cartão diz quem escreveu por três sinais, sem cor nova: a menta continua sendo o único acento e a cromia do produto continua térmica.

| Sinal | Parceiro | Cliente |
|---|---|---|
| Selo | "Mensagem de parceiro" | "Mensagem de cliente" |
| Avatar | Quadrado de canto macio, com uma loja no ombro | Redondo, com uma pessoa no ombro |
| Linha sob o nome | Categoria e etapa do funil ("Buffet adulto/corporativo · Autorizou") | "Cliente do app · final 0002" |

A etapa é a do negócio em foco, escolhido pela mesma função da lista de Conversas (`escolherNegocio`), para o cartão e a lista nunca discordarem. A categoria se corta se for longa; a etapa fica sempre inteira. Do cliente aparece só o fim do número, e nem isso quando ele não tem nome no perfil (o nome do cartão já é "Número terminado em 0002"). O selo manteve a palavra "mensagem": o cartão nasceu para deixar claro que chegou mensagem.

Isso pede uma leitura a mais, só quando um cartão vai aparecer: os negócios das fichas avisadas, com o nome da etapa. Continua sendo só leitura.

Como ele se comporta:

| Situação | O que acontece |
|---|---|
| CRM à vista, em qualquer tela | O cartão entra e some sozinho em 12 s |
| Mouse em cima ou foco do teclado | O relógio para |
| CRM em aba escondida, ou janela sem foco | Notificação do navegador, e o cartão espera a pessoa voltar para começar a contar |
| Na tela de Conversas, com aquela conversa aberta | Sem cartão: a mensagem já entrou na conversa |
| Na tela de Conversas, com outra conversa aberta | Cartão; Responder troca de conversa sem recarregar |
| Várias conversas de uma vez | Três cartões no desktop, um no celular; o resto vira "Mais N conversas com mensagem nova" |

**A notificação do navegador não leva o texto da mensagem.** Ela aparece por cima de qualquer coisa, inclusive de uma tela compartilhada numa reunião. Diz "Nova mensagem de Buffet Aurora" e leva à conversa. A prévia do texto fica no cartão de dentro do CRM, que só quem está logado vê. O telefone inteiro nunca aparece em nenhum dos dois (RF-BAS-14): vai o nome da ficha, o do perfil do WhatsApp ou "Número terminado em 8801".

A primeira leitura depois de abrir o CRM só estabelece a linha de base: recarregar a página não anuncia de novo o que já esperava.

**Silenciar** fica no menu do usuário. Silenciado, somem o cartão e a notificação; o número continua contando.

**Permissão do navegador.** O navegador só mostra notificação depois de a pessoa aceitar a pergunta dele, e só faz a pergunta em resposta a um clique. Um cartão da mesma pilha oferece esse clique uma vez. Dispensado, não volta; dá para ligar depois pelo menu do usuário.

## 4. Clientes em Conversas → Todas

A lista da aba "Conversas" era só de parceiros. Quem escrevia sem ser ficha ficava apenas na aba "Clientes" (01/10/2026, pedido do Rafael). Janio, no mesmo dia: "essa mensagem deve chegar para a aba de conversas em 'todos'".

- **Os clientes entram na mesma lista**, na mesma ordem dos parceiros: por ler primeiro, depois o mais recente. A linha traz o nome do WhatsApp, o fim do número, a janela de 24 h e a palavra "cliente".
- **"Minhas" e "Meu setor" valem para eles**, pelo responsável e pelo setor da conversa. A busca acha pelo nome do WhatsApp e pelo fim do número.
- **A conversa abre ao lado**, com a mesma caixa de resposta da aba "Clientes". O endereço guarda qual cliente está aberto (`?cliente=<id da conversa>`).
- **A aba "Clientes" continua existindo**, como o recorte só deles.
- **A conversa aberta do cliente passa a se atualizar sozinha.** O eco da tela não invalidava a consulta das mensagens de quem não é ficha: a mensagem chegava e a conversa aberta não se mexia até recarregar.

O aviso de "X respondeu" que a própria tela de Conversas dava saiu: quem avisa é a casca, com o cartão, e só a quem atende.

## 5. Como a casca fica sabendo

Um canal de Realtime na casca escuta `INSERT` em `public.messages`, que já está na publicação (migração `20260917150000`, pgTAP 52). O evento só acorda: quem decide é uma leitura em `conversations`, com no máximo uma mensagem de saída embutida por conversa (índice `messages_conv_idx`). A mesma leitura roda a cada 90 s como reserva, inclusive com a aba escondida.

Com a aba escondida a leitura parte na hora, sem `setTimeout`: o navegador atrasa relógio de aba em segundo plano. Com a aba à vista, a rajada vira uma leitura só.

A tela de Conversas conta duas coisas à casca: qual conversa está aberta, e como abrir outra sem navegar (o estado dela mora no cliente).

## 6. Onde fica cada coisa

Novo, em `apps/web/src/components/avisos/`:

| Arquivo | O que tem |
|---|---|
| `regra.ts`, `regra.test.ts` | A regra, o texto, a prévia, o destino e o marco. Puro, com Vitest. |
| `dados.ts` | As leituras (conversas, última chegada, última mensagem, ficha com categoria e etapa, pessoas ativas). Nenhuma escrita. |
| `preferencias.ts` | Silenciado, piso, conversas abertas e convite dispensado, em `localStorage`, com chave por pessoa. |
| `marca-de-nova.tsx` | A faixa e o selo "Nova" das linhas da lista. |
| `aviso-do-navegador.ts` | Casca fina da Notification API. |
| `provedor-avisos.tsx` | O canal, a sondagem, os cartões e a decisão de avisar. |
| `pilha-de-avisos.tsx` | Os cartões "Nova mensagem" e o convite de permissão. |
| `convite-de-avisos.tsx` | O que dizer depois que o navegador respondeu ao pedido. |

Alterado na casca: `layout/app-shell.tsx`, `sidebar.tsx`, `bottom-nav.tsx`, `nav-link.tsx`, `user-menu.tsx`, `lib/navegacao.ts`, `lib/filas-do-menu.ts`, `app/(app)/layout.tsx` e uma animação em `app/globals.css`.

Alterado em Conversas: `tela-conversas.tsx`, `lista-conversas.tsx`, `fora-da-base.tsx` (a marca "Nova"), `montagem.ts` (`filtrarClientes`, `juntarNaLista`), `tipos.ts` (`?cliente=`), `eco-do-banco.ts` (uma invalidação a mais), `formatos.ts` (uma exportação) e `app/(app)/conversas/page.tsx`.

## 7. O que não interfere

- Não envia mensagem, modelo, confirmação de leitura nem "digitando" à Meta.
- Não escreve em `messages`, `conversations` nem na fila `wa_outbound`. Não zera o "por ler".
- Não toca `wa-webhook`, worker-wa, `pode_enviar`, `messages_guard`, bot de entrada, ausência, opt-out nem a janela de 24 h.
- A caixa de resposta do cliente na aba "Conversas" é o mesmo componente da aba "Clientes"; o caminho de envio é o que já existia.
- Se o aviso falhar, a mensagem chega e aparece na lista como antes.

Efeito colateral, só no Supabase: cada aba do CRM aberta passa a manter uma conexão de Realtime (antes, só a tela de Conversas conectava), mais uma leitura pequena a cada 90 s.

## 8. Limites conhecidos

- **Celular.** Chrome no Android e Safari no iPhone só mostram notificação do sistema a partir de um service worker. Lá valem o número na barra e o cartão.
- **CRM fechado.** Sem aviso, por escolha: exigiria push, com um disparo no instante em que a mensagem é gravada, que é o caminho de entrada do WhatsApp. Continua valendo o e-mail do worker-wa.
- **"Aberta" é por navegador.** Abrir uma conversa no computador não tira a marca dela no celular. Levar isso para o banco pede migração.
- **O número não cai sozinho.** Conversa que ninguém respondeu e que a pessoa nunca abre continua contando, até sair das 50 mais recentes.
- **Teto de 50.** Quem ficou muito tempo sem abrir Conversas vê no máximo 50.
- **Opt-out.** A mensagem de quem pede para sair também avisa: a regra não consulta a supressão.
- **O "por ler" do cliente não zera ao abrir a conversa.** Já era assim na aba "Clientes": a tela só zera o de parceiro, e só para quem atende ou é gestor. Com o cliente em "Todas", o número fica mais à vista. Corrigir é uma escrita em `conversations`, fora desta entrega.
- **A aba "Responderam" continua só com parceiros.**

## 9. Decisão humana

O Janio pediu a subida em 02/10/2026, ciente dos pontos abaixo. Nenhum deles tem o aval do Rafael registrado.

1. **Rafael adiou a notificação de navegador em 28/09/2026** (ADR-17, CHANGELOG). Esta entrega reverte esse adiamento.
2. **RF-AST-08 restringe o alarme a dois gatilhos** (resposta sem retorno há mais de 2 h e reunião em 3 h) e diz que nenhum terceiro entra sem decisão do Rafael. Este aviso é imediato, a cada mensagem. É uma mudança em relação ao PRD.
3. **A aba "Clientes" nasceu em 01/10/2026, a pedido do Rafael, como lugar separado.** Mostrar os clientes também em "Todas" muda o que ele vai encontrar na lista.
4. **Resposta a campanha em massa avisa todos que atendem.** Confirmar que é o desejado.
5. **Cota de Realtime do plano do Supabase.** Conferir no painel no dia do deploy e uma semana depois.
