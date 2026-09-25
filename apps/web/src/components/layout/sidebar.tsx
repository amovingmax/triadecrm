'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ChevronDown } from 'lucide-react';

import { NavLink } from '@/components/layout/nav-link';
import { Logo } from '@/components/logo';
import { type AppRole } from '@/lib/auth/role';
import { type ContagemDasFilas } from '@/lib/filas-do-menu';
import { navegacaoDaLateral } from '@/lib/navegacao';
import { cn } from '@/lib/utils';

/**
 * Lateral do desktop (md+): estreita e de pouco peso, porque a tela pertence à
 * lista. Ícone mais rótulo, altura de linha de 32px, sem cartão e sem sombra. No
 * celular a navegação vive na barra inferior.
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
  const pathname = usePathname();
  // "Mais" nasce aberto quando a tela atual mora nele: um item aceso escondido
  // num menu fechado é a pessoa sem saber onde está.
  const estouNoMais = mais.some((i) => pathname === i.href || pathname.startsWith(`${i.href}/`));
  const [maisAberto, setMaisAberto] = useState(estouNoMais);

  return (
    <aside className="sticky top-0 hidden h-dvh w-52 shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground md:flex">
      <div className="flex h-14 shrink-0 items-center border-b border-sidebar-border px-3">
        <Link href="/meu-dia" className="toque" aria-label="Tríade, ir para Meu dia">
          <Logo className="text-[15px]" />
        </Link>
      </div>

      <nav aria-label="Navegação principal" className="flex flex-1 flex-col gap-0.5 overflow-y-auto px-2 py-2">
        {principais.map((item) => (
          <NavLink
            key={item.href}
            item={item}
            variante="lateral"
            contagem={item.fila ? (filas[item.fila] ?? null) : null}
          />
        ))}

        {mais.length > 0 ? (
          <div className="mt-3 border-t border-sidebar-border pt-2">
            <button
              type="button"
              aria-expanded={maisAberto || estouNoMais}
              onClick={() => setMaisAberto((v) => !v)}
              className="toque flex w-full items-center justify-between rounded-md px-3 py-1.5 text-[13px] text-sidebar-muted-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-foreground"
            >
              Mais
              <ChevronDown
                aria-hidden="true"
                className={cn('size-4 transition-transform', (maisAberto || estouNoMais) && 'rotate-180')}
              />
            </button>
            {maisAberto || estouNoMais ? (
              <div className="mt-0.5 flex flex-col gap-0.5">
                {mais.map((item) => (
                  <NavLink
                    key={item.href}
                    item={item}
                    variante="lateral"
                    contagem={item.fila ? (filas[item.fila] ?? null) : null}
                  />
                ))}
              </div>
            ) : null}
          </div>
        ) : null}
      </nav>
    </aside>
  );
}
