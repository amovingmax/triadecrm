'use client';

import Link from 'next/link';

import { NavLink } from '@/components/layout/nav-link';
import { MarcaTriade } from '@/components/logo';
import { type AppRole } from '@/lib/auth/role';
import { type ContagemDasFilas } from '@/lib/filas-do-menu';
import { navegacaoDaLateral } from '@/lib/navegacao';

/**
 * O TRILHO do desktop (md+): 72px, só ícones. No celular a navegação continua na
 * barra inferior, com rótulo, porque lá o dedo não tem `title`.
 *
 * ---------------------------------------------------------------------------
 * POR QUE O RÓTULO SAIU, E O QUE FICOU NO LUGAR DELE (29/09/2026)
 * ---------------------------------------------------------------------------
 * O Tríade Design System pede um trilho de 72px. Adotá-lo ao pé da letra
 * desfaria o que esta lateral resolveu em 08/09: doze itens em fila indiana não
 * diziam nada sobre si mesmos, e foram o agrupamento e o rótulo que consertaram.
 *
 * O que ficou, e é o que impede a volta daquele problema:
 *   1. O NOME continua existindo, no `title` e no rótulo acessível de cada
 *      ícone (`nav-link.tsx`, variante "trilho").
 *   2. OS GRUPOS continuam existindo, agora como um fio de 24px entre eles. A
 *      distância que antes era um cabeçalho de 11px virou espaço em branco, que
 *      é o que um trilho tem para dizer "isto é outra coisa".
 *   3. "Mais" deixou de ser um menu que abre: num trilho de 72px um acordeão é
 *      uma gaveta dentro de uma gaveta. Os itens dele vão para o PÉ do trilho,
 *      depois do fio — a mesma ideia do `mt-auto` de antes, com menos cliques.
 *
 * O contador é o único ponto de cor do trilho, e é a menta: sem rótulo, o número
 * é o que diz onde há trabalho parado sem que ninguém precise ler.
 *
 * ---------------------------------------------------------------------------
 * OS TRÊS GRUPOS, E O REALCE QUE NÃO GASTA COR
 * ---------------------------------------------------------------------------
 * Doze itens em fila indiana não dizem nada sobre si mesmos: é a queixa do
 * Rafael, "muitas abas e pouco direcionamento". Agrupados e nomeados, os mesmos
 * doze itens leem-se como três coisas — o que se faz todo dia, o que já está no
 * CRM, e o que se ajusta uma vez por semana. O critério está em `lib/navegacao.ts`.
 *
 * O realce é estrutural, e isso não é modéstia: **a única cromia do produto é a
 * escala térmica** (frio, morno, quente). Pintar o menu roubaria o único
 * significado que a cor tem aqui, e é o mesmo motivo pelo qual as abas e a barra
 * térmica também não gastam matiz. Sobram três instrumentos, e são suficientes:
 *
 * 1. **Cabeçalho de grupo** em 11px, tinta esmaecida da casca e `tracking-wide` —
 *    o mesmo tratamento de um rótulo de seção, não de um título.
 * 2. **`mt-auto` no último grupo.** "Controle" é empurrado para o pé da lateral,
 *    longe do olho e, num monitor grande, longe da mão. Distância diz "isto não é
 *    do seu dia" sem pedir legenda nenhuma.
 * 3. **A única hairline da lateral** fecha o grupo de cima e abre o de baixo. Uma
 *    linha só na coluna inteira: se houvesse três, nenhuma significaria nada.
 *
 * O primeiro grupo não leva hairline nem espaço extra acima — ele já está colado
 * na régua do bloco da marca, que atravessa a tela.
 *
 * ---------------------------------------------------------------------------
 * O NÚMERO É A METADE QUE DIRECIONA
 * ---------------------------------------------------------------------------
 * Agrupar diz para que serve cada tela. O número diz em qual delas tem trabalho
 * parado AGORA — que é a pergunta que a pessoa faz de manhã. A contagem chega
 * pronta do servidor (`lib/filas-do-menu.ts`), então nada pisca aqui durante a
 * navegação, e só dois itens contam: Revisão (candidato esperando decisão) e
 * Conversas (rascunho esperando aprovação). Ver a regra inteira em `navegacao.ts`.
 */
export function Sidebar({ papel, filas }: { papel: AppRole; filas: ContagemDasFilas }) {
  const { principais, mais } = navegacaoDaLateral(papel);
  return (
    <aside className="sticky top-0 hidden h-dvh w-[72px] shrink-0 flex-col items-center gap-1.5 border-r border-sidebar-border bg-sidebar py-4 text-sidebar-foreground md:flex">
      {/* A marca num quadrado de canto macio, e não numa pílula: ela é a única
          coisa do trilho que não navega entre módulos. */}
      <Link
        href="/meu-dia"
        aria-label="Tríade, ir para Meu dia"
        title="Tríade"
        className="mb-2.5 flex size-10 shrink-0 items-center justify-center"
      >
        {/* A própria marca já é a chapa de canto macio (`rect rx=112` com
            `fill-primary`), então ela NÃO ganha um segundo fundo em volta: no
            desenho novo o `--primary` é a tinta, e a marca vira o quadrado preto
            que o sistema pede, sem nenhuma moldura extra. */}
        <MarcaTriade className="size-10" />
      </Link>

      <nav
        aria-label="Navegação principal"
        className="flex flex-1 flex-col items-center gap-1.5 overflow-y-auto"
      >
        {principais.map((item) => (
          <NavLink
            key={item.href}
            item={item}
            variante="trilho"
            contagem={item.fila ? (filas[item.fila] ?? null) : null}
          />
        ))}

        {mais.length > 0 ? (
          <>
            {/* O fio que era o cabeçalho do grupo. Uma linha só no trilho
                inteiro: se houvesse três, nenhuma significaria nada. */}
            <span aria-hidden="true" className="my-2 h-px w-8 shrink-0 bg-sidebar-border" />
            {mais.map((item) => (
              <NavLink
                key={item.href}
                item={item}
                variante="trilho"
                contagem={item.fila ? (filas[item.fila] ?? null) : null}
              />
            ))}
          </>
        ) : null}
      </nav>
    </aside>
  );
}
