# Sistema visual do KOMUNE CRM

## Leitura do brief

Interface de produto densa (tabela mais formulário) para um time de 7 pessoas que trabalha
no celular, na rua, entre visitas, em Natal/RN. Não é landing page: o padrão é produto
(TanStack Table, densidade alta, nada de cartão decorativo). O login é a única superfície
de vitrine.

## Diais

| Superfície | Variância | Movimento | Densidade |
| ---------- | --------- | --------- | --------- |
| Aplicativo | 4         | 5         | 7         |
| Login      | 7         | 7         | 3         |

## Por que a cor só significa temperatura

O banco já calcula a temperatura de cada negócio (PRD §5.6) a partir da etapa, da última
intenção e dos dias sem contato. Essa escala é o sistema visual: as cinco cores térmicas são
as únicas cores cromáticas da interface. Todo o resto é tinta neutra de grafite frio, e a
ação (botão primário, anel de foco) é tinta quase preta no claro, quase branca no escuro.
Um botão laranja competiria com "quente" e a leitura da lista se perderia. Sem roxo de IA,
sem gradiente em título, sem néon, sem preto ou branco puros.

## Tokens (`apps/web/src/app/globals.css`)

Escala térmica. `cor` é a marca (barra, ponto), `texto` é a variante que passa em 4.5:1
sobre o fundo, `fundo` é `color-mix` a 12 ou 14% para chip e faixa.

| Temperatura   | Claro (cor / texto)   | Escuro (cor / texto)  |
| ------------- | --------------------- | --------------------- |
| frio          | `#3b6fa8` / `#2f5c8c` | `#5e96d1` / `#7fb0e0` |
| morno         | `#bd822b` / `#8a5a12` | `#e0a94f` / `#e8bc72` |
| quente        | `#c4472b` / `#b03d22` | `#e06a4c` / `#ee8567` |
| cliente       | `#2f7d5b` / `#26654a` | `#4ca37c` / `#6fbe99` |
| cliente_ativo | `#1f5c43` / `#1f5c43` | `#3c8467` / `#62a98a` |

O âmbar do plano era `#c98a2e`; escurecido 6% porque a barra térmica é objeto gráfico e
precisa de 3:1 contra o fundo (WCAG 1.4.11). O original parava em 2,74:1.

Grafite frio (matiz ~222deg, o zinc do Tailwind é morto demais ao lado do azul-mar):
`25 #fcfcfd` · `50 #f6f7f9` · `100 #eceef2` · `200 #dfe2e9` · `300 #c6cbd5` · `400 #99a0ad`
· `450 #868d9a` · `500 #666d7a` · `600 #545c69` · `700 #3c434e` · `800 #282d36` ·
`850 #2f353f` · `900 #1b1f26` · `950 #12151a`.

Papéis: claro tem fundo `50`, cartão `25`, tinta `950`, borda `200`, campo `450`, ação `900`.
Escuro inverte: fundo `950`, cartão `900`, tinta `100`, borda `850`, campo `500`, ação `100`.
`--destructive` reaproveita a brasa: é o mesmo alarme, e evita uma sexta cor.

Nenhuma cor de TEXTO recebe `/NN` nem `opacity-NN`. No claro, `--muted-foreground`
(grafite `500`) já é o último degrau que passa em 4,5:1 contra o fundo `50`: `450` dá 3,11:1
e `400` dá 2,45:1. Terceiro nível de hierarquia se faz por tamanho (`text-xs`, `0.8em`) ou
peso, nunca por uma cor mais clara. Se um dia for mesmo preciso um degrau intermediário, ele
tem de ser um valor novo, medido em pelo menos 4,5:1 contra `#f6f7f9` e contra `#fcfcfd`, e
não o apelido de um degrau que já existe. Opacidade em ícone decorativo (`aria-hidden`)
continua liberada: ali não há texto para ler.

## Tipografia

Geist Sans na interface, Geist Mono obrigatório em todo número (dias, contadores, telefone,
CNPJ, contagens). Entram por `next/font` no `layout.tsx`; use a classe `numerico`, que já
aplica mono mais `tabular-nums` para as colunas alinharem na vertical. Ênfase vem do peso da
mesma família, nunca de outra família.

## Forma

Um raio só: 8px em tudo que se toca (botão, campo, chip), 12px em tudo que contém (cartão,
folha, diálogo). A escala `sm..4xl` do shadcn foi achatada nesses dois valores. A barra
térmica não tem raio, e a seta do tooltip também não (é um losango girado, o raio ali não é
percebido). O avatar do menu do usuário segue os 8px dos interativos: círculo era o único
raio fora do sistema. A única exceção é o ponto de status do avatar (`AvatarBadge`), com 8px
de lado, onde o círculo é a forma do sinal, não o raio de um contêiner.

## Alvos de toque

44px mínimo em tudo que se toca no celular (`h-11`, `min-h-11`), voltando a `h-8`/`h-9` no
`md`. Cabeçalho e bloco da marca têm 56px (`h-14`); o item da lateral, 32px. A barra inferior
do celular tem 64px por decisão deliberada, acima do teto de 56px do cabeçalho: é o mínimo
para empilhar ícone de 20px e rótulo de 11px dentro de um alvo de 44px. Comprimir para 56px
sobreporia o rótulo ao ícone ou exigiria tirar o rótulo, o que piora a navegação de campo.
Não "conserte" para 56px.

## Movimento

Cada animação precisa de uma frase que a justifique, e só animamos `transform` e `opacity`.
Permitidos: entrada escalonada das linhas (máx. 24, 15ms de intervalo, desliga após a
primeira renderização); skeleton com a forma da tabela, parado (a forma já é o sinal); folha de cadastro com mola
(stiffness 260, damping 30); `scale(0.98)` no toque; pulso lento de 2,4s na ESPESSURA da barra
térmica (`scaleX`, nunca opacidade: abaixar o alfa apagaria justamente a linha que precisa
ser vista) só quando `deals.needs_attention`; opacidade mais 2px na troca de rota; sequência de entrada no
login, uma vez só. Proibidos: laço infinito decorativo, parallax, marquee, cursor
customizado, ouvinte de scroll, animação de width, height, top ou left. Tudo passa por
`useMovimento()` (`src/components/movimento/usar-movimento.ts`), e o `globals.css` tem uma
rede de segurança em `prefers-reduced-motion`.

## Cópia

Voz de ferramenta. O rótulo do botão é o mesmo do aviso de sucesso. Estado vazio convida à
ação. Sem emoji e sem travessão em texto visível: use hífen, vírgula, ponto ou parênteses.
