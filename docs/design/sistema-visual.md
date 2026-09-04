# Sistema visual do KOMUNE CRM

> Repaginado em 04/09/2026 para a direção **Ocean Breeze**. A paleta, a ação em gradiente
> e a tipografia vêm de `docs/design/direcao-visual-ocean-breeze.md`, que é a fonte da
> verdade dessas três coisas; este documento descreve como elas viraram token no código e
> guarda o que a repaginação não mexeu (forma, alvos de toque, movimento, cópia).

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
as únicas cores cromáticas da interface. Todo o resto é base neutra azul-ardósia e a ação,
que é um gradiente sem cromia (branco no escuro, tinta no claro).

O Ocean Breeze define `--primary` verde. No nosso produto verde já significa "cliente
publicado", então o verde do tema foi para a escala térmica e a ação ficou com o gradiente
do template. A tensão e a saída estão explicadas na direção. Um botão verde ou laranja
competiria com a escala e a leitura da lista se perderia. Sem roxo de IA, sem néon, sem
preto ou branco puros, e gradiente em título só no login.

## Tokens (`apps/web/src/app/globals.css`)

Escala térmica, três tokens por temperatura. `cor` é a marca (barra, ponto) e cumpre o
mínimo de 3:1 da WCAG 1.4.11 contra a superfície; `texto` é a variante medida em pelo
menos 4,5:1 sobre fundo, cartão, muted e sobre o próprio chip; `fundo` é o `color-mix` a
12% (14% no morno) do chip e da faixa.

| Temperatura   | Claro (cor / texto)   | Escuro (cor / texto)  |
| ------------- | --------------------- | --------------------- |
| frio          | `#5b7fa6` / `#4a6788` | `#7a96b8` / `#89a2c0` |
| morno         | `#b37a1f` / `#865b17` | `#e0a33e` / `#e0a33e` |
| quente        | `#c4472b` / `#ac3e26` | `#e5644a` / `#e97e68` |
| cliente       | `#1a9a49` / `#147437` | `#34d399` / `#34d399` |
| cliente_ativo | `#047857` / `#047152` | `#10b981` / `#10b981` |

Dois desvios dos alvos da direção, ambos por contraste medido. O `cliente` do claro sai do
`#22c55e` do tema porque esse verde rende só 2,07:1 contra o muted e a barra térmica é
objeto gráfico: descido 10 pontos de luminosidade ele chega a 3,31:1. Com o `cliente` mais
fundo, o `#059669` proposto para `cliente_ativo` ficaria a 5 pontos dele e o par deixaria de
ser legível numa barra de 3px, então `cliente_ativo` passou a `#047857`, que é o outro verde
do próprio Ocean Breeze (o `chart-4` do tema) e repõe os cerca de 12 pontos de degrau que o
modo escuro tem entre as duas. No escuro, morno, cliente e cliente_ativo já passam em 4,5:1
com a cor cheia, então `texto` e `cor` são o mesmo valor: clarear ali seria enfraquecer a cor
sem ganho de leitura.

Rampa azul-ardósia (matiz por volta de 217deg, derivada dos valores literais do Ocean
Breeze). Os nomes da rampa continuam `grafite-NNN` para não quebrar o que já os consome;
só os valores mudaram.

`25 #fdfeff` · `50 #f0f8ff` · `100 #f3f4f6` · `200 #e5e7eb` · `300 #d1d5db` · `400 #94a3b8`
· `450 #7c8ba1` · `500 #686e7c` · `600 #4b5563` · `700 #374151` · `750 #2d3748` ·
`800 #1e293b` · `850 #19212e` · `900 #0f172a` · `950 #0a1020`.

Sete desses degraus são valores literais do tema: `50` é o fundo claro, `100` o muted claro,
`200` a borda clara, `300` a tinta do escuro, `600` a borda do escuro, `700` a tinta do claro,
`750` o secondary do escuro, `800` o cartão do escuro, `850` o muted do escuro e `900` o
fundo do escuro. O `500` é o `#6b7280` do tema descido um ponto de luminosidade, porque no
valor original ele parava em 4,39:1 contra o muted claro e é o token de texto esmaecido.

Papéis: claro tem fundo `50`, cartão `25`, tinta `700`, borda `200`, campo `450`, esmaecido
`500`, ação `900`. Escuro tem fundo `900`, cartão `800`, muted `850`, secondary `750`, tinta
`300`, borda `600`, campo `450`, esmaecido `400`, ação `25`. `--destructive` reaproveita a
brasa: é o mesmo alarme, e evita uma sexta cor.

**Dois níveis de borda.** `--border` é o valor cheio do tema (`#e5e7eb` claro, `#4b5563`
escuro) e serve para campo, contorno de cartão e divisória de seção. Para linha de tabela e
borda de cabeçalho existe `--hairline`, translúcido (branco a 8% no escuro, preto a 8% no
claro), exposto ao Tailwind como `border-hairline`. Borda cheia numa tabela densa vira grade
e cansa. `--input` continua sendo o degrau `450` nos dois modos, que é o único que garante os
3:1 do limite visível do controle contra fundo e cartão.

**Ação em gradiente.** `--acao-gradiente` e `--acao-texto` trocam de valor por modo e o
utilitário `acao-gradiente` é a variante `default` do `Button` do shadcn; as outras variantes
não mudaram. No escuro é o gradiente branco do template com texto quase preto (pior pixel,
a parada de 60% sobre o cartão: 8,04:1). No claro é o inverso em tinta com texto quase
branco (mesmo pior pixel: 4,70:1). Interação: `scale` 1.02 no hover, 0.98 no toque, 150ms,
na propriedade `scale` e não em `transform`, para compor com o `translate-y-px` que o botão
já aplica.

Nenhuma cor de TEXTO recebe `/NN` nem `opacity-NN`. No claro, `--muted-foreground`
(degrau `500`) já é o último que passa em 4,5:1 contra o muted `#f3f4f6`. Terceiro nível de
hierarquia se faz por tamanho (`text-xs`, `0.8em`) ou peso, nunca por uma cor mais clara. Se
um dia for mesmo preciso um degrau intermediário, ele tem de ser um valor novo, medido em
pelo menos 4,5:1 contra `#f0f8ff`, `#f3f4f6` e `#fdfeff`, e não o apelido de um degrau que já
existe. Opacidade em ícone decorativo (`aria-hidden`) continua liberada: ali não há texto
para ler.

**Casca (lateral e barra inferior).** A navegação é a única superfície fora da rampa
grafite: `--sidebar` é `#e0f2fe` no claro (o `secondary` do Ocean Breeze) e `#1e293b` no
escuro (o `card` do tema). É o que separa navegação de conteúdo sem borda cheia, sem sombra
e sem cor cromática. Sobre esse azul o esmaecido do conteúdo (degrau `500`) cairia para
4,45:1, então a casca tem o seu: `--sidebar-muted-foreground`, `#55606e` no claro (5,57:1 na
lateral, 5,05:1 no realce de passagem, 5,63:1 na barra inferior) e o degrau `400` no escuro
(5,71:1 e 5,04:1). O item ativo é `--sidebar-accent`, tinta a 8% sobre a própria base
(1,20:1 contra ela): um fundo que se nota sem virar bloco, somado ao peso e à marca de 2px
em `--sidebar-primary` (tinta cheia). `--sidebar-border` é o `--hairline`, o mesmo do
cabeçalho, para a régua do topo atravessar a tela inteira.

## Acabamento (utilitários prontos)

Os itens de acabamento da direção viraram utilitário em `globals.css`, para as telas
consumirem sem reescrever valor. O login consome `pilula`, `titulo-gradiente`,
`brilho-radial` e `sombra-base`; a casca consome `superficie-vidro` (cabeçalho),
`superficie-vidro-inferior` (barra do celular) e `pilula` (chip de estado, dica de tecla):

| Utilitário | O que faz | Onde vale |
| ---------- | --------- | --------- |
| `superficie-vidro` | base a 80% com `backdrop-blur-md` e hairline embaixo | cabeçalho fixo |
| `superficie-vidro-inferior` | base da CASCA a 85% com desfoque e hairline em cima | barra inferior do celular |
| `pilula` | `rounded-full`, borda fina, cartão a 50%, `backdrop-blur-sm` | eyebrow do login, chip de estado, `Badge variant="pilula"` |
| `titulo-gradiente` | texto em gradiente da tinta para 60% dela, já com `tracking` de -0.05em | só o título do login |
| `brilho-radial` | gradiente radial em CSS, sem imagem externa e sem cromia | fundo de herói |
| `sombra-base`, `sombra-base-forte` | sombra tingida pela base, nunca preta pura | cartão, folha, diálogo |
| `corpo-tabela` | tracking de -0.011em para tabela feita com div | grade sem `<table>` |

## Tipografia

Poppins na interface e no display (400, 500 e 600), IBM Plex Mono obrigatório em todo número
(400 e 500): dias, contadores, telefone, CNPJ, contagens. As duas entram por `next/font/google`
no `layout.tsx`, que publica `--font-poppins` e `--font-ibm-plex-mono`; nada de `@import` de
fonte dentro do CSS. Use a classe `numerico`, que já aplica mono mais `tabular-nums` para as
colunas alinharem na vertical. Ênfase vem do peso da mesma família, nunca de outra família.

Poppins é geométrica e larga: numa tabela densa ela empurra a linha e come coluna. O
`globals.css` compensa com `letter-spacing: -0.011em` em `table` (regra base, vale para o
`Table` do shadcn sem tocar no componente) e oferece `corpo-tabela` para grade feita com div.
O título do login fica com tracking de -0.05em, que já vem dentro de `titulo-gradiente`.

## Forma

Um raio só: 8px em tudo que se toca (botão, campo, chip), 12px em tudo que contém (cartão,
folha, diálogo). A escala `sm..4xl` do shadcn foi achatada nesses dois valores. A barra
térmica não tem raio, e a seta do tooltip também não (é um losango girado, o raio ali não é
percebido). O avatar do menu do usuário segue os 8px dos interativos: círculo era o único
raio fora do sistema. A única exceção é o ponto de status do avatar (`AvatarBadge`), com 8px
de lado, onde o círculo é a forma do sinal, não o raio de um contêiner.

## Alvos de toque

44px mínimo em tudo que se toca no celular (`h-11`, `min-h-11`, `size-11`), voltando a
`h-8`/`h-9`/`size-7` no `md`. Vale também para o que é pequeno por natureza: o botão da
paleta de comandos (que no celular é só a lupa), o alternador de tema, o gatilho do usuário,
o item de menu suspenso, o item da paleta e o "x" da folha. Cabeçalho e bloco da marca têm
56px (`h-14`); o item da lateral, 32px, porque a lateral só existe no `md`. A barra inferior
do celular tem 64px por decisão deliberada, acima do teto de 56px do cabeçalho: é o mínimo
para empilhar ícone de 20px e rótulo de 11px dentro de um alvo de 44px. Comprimir para 56px
sobreporia o rótulo ao ícone ou exigiria tirar o rótulo, o que piora a navegação de campo.
Não "conserte" para 56px.

## Modo padrão

Escuro, como o template (`defaultTheme="dark"` no next-themes). O claro é cidadão de
primeira classe e fica a um toque no alternador do cabeçalho, porque a Heloísa usa o celular
na rua e sob o sol de Natal a tela clara é mais legível; "Do aparelho" continua na lista para
quem quiser seguir o sistema. O next-themes escreve a classe no `<html>` por script, antes da
hidratação, então a primeira renderização não pisca; até montar, o alternador mostra a lua (o
padrão) e fica desabilitado, para o ícone não trocar no meio do caminho. O `themeColor` do
`layout.tsx` nasce no fundo escuro e o `ProvedorTema` atualiza a meta quando o tema resolvido
muda: `prefers-color-scheme` diria o que o aparelho quer, não o que a pessoa escolheu no CRM.

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
