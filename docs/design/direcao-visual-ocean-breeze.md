# Direção visual: Ocean Breeze + acabamento do template SaaS

Pedido do Matheus em 04/09/2026: o tema [Ocean Breeze](https://21st.dev/@serafimcloud/themes/ocean-breeze)
(serafimcloud, 21st.dev) mais o **estilo** do template SaaS que ele enviou (fonte, fundo, acabamento),
não a estrutura nem as funcionalidades daquela página. Este documento fixa a síntese e substitui a
paleta anterior descrita em `sistema-visual.md`, mantendo dele o elemento-assinatura (a escala térmica).

## A tensão que a síntese resolve

O Ocean Breeze define `--primary` **verde** (`#22c55e` claro, `#34d399` escuro). No nosso produto, verde
já significa "cliente publicado" na escala térmica. Botão verde e linha verde na mesma tela apagam a
leitura de relance que o CRM inteiro foi desenhado para dar.

O template resolve isso sozinho: o botão principal dele é um **gradiente branco** sobre fundo escuro,
não uma cor cromática. Adotando o botão do template, o verde fica livre e vai para onde ele significa
alguma coisa: `cliente`. O acento do tema encontra o lugar certo em vez de competir.

## Tokens

### Base, do Ocean Breeze
| Token | Escuro (padrão) | Claro |
|---|---|---|
| `--background` | `#0f172a` | `#f0f8ff` |
| `--card` | `#1e293b` | `#ffffff` |
| `--foreground` | `#d1d5db` | `#374151` |
| `--muted` | `#19212e` | `#f3f4f6` |
| `--muted-foreground` | `#6b7280` | `#6b7280` |
| `--border` | `#4b5563` | `#e5e7eb` |
| `--destructive` | `#ef4444` | `#ef4444` |
| `--radius` | `0.5rem` (8px) | igual |

Regra de borda: o token acima é o valor cheio, usado em campos e divisórias fortes. Para as linhas da
tabela e a borda do cabeçalho, usar a versão translúcida no espírito do template (`border-white/8` no
escuro, `border-black/8` no claro). Borda cheia numa tabela densa vira grade e cansa.

Fundo puro preto (`#000`) está fora: `#0f172a` é o próprio escuro do Ocean Breeze e preserva profundidade.

### Ação, do template (substitui o `--primary` verde do tema)
- Escuro: `linear-gradient(to bottom, #ffffff, rgba(255,255,255,.95), rgba(255,255,255,.60))`, texto quase preto.
- Claro: o inverso, gradiente de tinta com texto claro.
- Interação: `hover:scale-[1.02]`, `active:scale-[0.98]`, transição de 150 ms.

### Escala térmica, reafinada para o fundo `#0f172a`
Os valores antigos foram calculados para um grafite neutro e perdiam contraste sobre o azul-ardósia.

| Temperatura | Escuro | Claro | Observação |
|---|---|---|---|
| `frio` | `#7A96B8` | `#5B7FA6` | aço frio, distinto do fundo sem gritar |
| `morno` | `#E0A33E` | `#B37A1F` | âmbar |
| `quente` | `#E5644A` | `#C4472B` | brasa |
| `cliente` | `#34D399` | `#22C55E` | o verde do próprio Ocean Breeze |
| `cliente_ativo` | `#10B981` | `#059669` | verde mais fundo |

Continuam sendo as **únicas** cores cromáticas da interface. Todo o resto é base neutra ou a ação em
gradiente. Nada de roxo, nada de gradiente colorido, nada de glow neon.

### Tipografia
- **Poppins** (do template) para interface e display, via `next/font/google`. Nunca com `@import` dentro
  de `<style>` como no código original: no Next isso atrasa a primeira renderização e causa pulo de layout.
- **IBM Plex Mono** (do Ocean Breeze) para todo número: dias sem contato, contadores, telefone, CNPJ,
  contagens, com `tabular-nums`. É onde a densidade realmente pesa.
- Título do login com `tracking-[-0.05em]` e peso 500, como no template.
- Poppins é geométrica e larga. Na tabela, compensar com `tracking-tight` nas células de texto; os
  números já estão em mono, que é onde a largura importa.

## Acabamento adotado do template

1. **Cabeçalho fixo translúcido**: `backdrop-blur-md` sobre a base a 80% de opacidade, com hairline
   inferior de baixa opacidade.
2. **Pílula de eyebrow**: `rounded-full`, borda fina, fundo do cartão a 50%, `backdrop-blur-sm`. Vale na
   entrada do login e como chip de estado.
3. **Texto com gradiente** no título: branco para branco a 60%. **Só no login.** Espalhar isso pelo app
   vira clichê e prejudica a leitura.
4. **Botão em gradiente** como ação principal (acima).
5. **Brilho atrás do herói**: gradiente radial em CSS, não a imagem do CDN do 21st.
6. **Elevação**: `rounded-lg` com sombra tingida pela base, nunca sombra preta pura.
7. **Entrada em fade** de 600 ms na primeira renderização, uma vez só, respeitando `prefers-reduced-motion`.

## O que fica de fora do código do template

- `@import` de fonte dentro do componente: usar `next/font`.
- Ícones desenhados à mão em SVG: já temos biblioteca instalada.
- `Button` inline: já existe o do shadcn, com os nossos tokens.
- `min-h-screen`: usar `min-h-[100dvh]`, senão a barra de endereço do iOS quebra o layout.
- Imagens do CDN do 21st e a captura de tela falsa de dashboard.
- Conteúdo em inglês e a estrutura de landing (menu, "Sign in / Sign Up", hero de marketing): o CRM é
  interno e fica atrás de login.

## Modo padrão

Escuro por padrão, como o template. O claro continua sendo cidadão de primeira classe, com a mesma
paleta do Ocean Breeze, por um motivo prático: a Heloísa usa o celular na rua, e sob o sol de Natal a
tela clara é mais legível. O alternador fica no cabeçalho.

## Onde o acabamento de landing tem lugar de verdade

Duas telas do roteiro são vitrine e merecem esse tratamento por inteiro:
1. **Login** (D1, agora), a única superfície de vitrine do CRM.
2. **Página de reivindicação do fornecedor** (`parceiros.komune.app/c/<token>`, RF-PRE-07/08, D9): é o que
   o dono do buffet abre depois da mensagem da Heloísa e onde ele decide entrar ou não. Essa página
   precisa converter, e é ali que herói, prova e um botão só valem o investimento.
