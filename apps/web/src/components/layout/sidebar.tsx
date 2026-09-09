'use client';

import Link from 'next/link';

import { NavLink } from '@/components/layout/nav-link';
import { Logo } from '@/components/logo';
import { type AppRole } from '@/lib/auth/role';
import { type ContagemDasFilas } from '@/lib/filas-do-menu';
import { navegacaoAgrupada } from '@/lib/navegacao';
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
 * navegação, e só dois itens contam: Radar (candidato esperando revisão) e
 * Conversas (rascunho esperando aprovação). Ver a regra inteira em `navegacao.ts`.
 */
export function Sidebar({ papel, filas }: { papel: AppRole; filas: ContagemDasFilas }) {
  const blocos = navegacaoAgrupada(papel);

  return (
    <aside className="sticky top-0 hidden h-dvh w-52 shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground md:flex">
      <div className="flex h-14 shrink-0 items-center border-b border-sidebar-border px-3">
        <Link href="/meu-dia" className="toque" aria-label="Tríade, ir para Meu dia">
          <Logo className="text-[15px]" />
        </Link>
      </div>

      {/* Sem rodapé: carimbo de versão e faixa de localidade não ajudam quem está
          usando o CRM (o fuso aparece onde é operacional, na data da próxima ação). */}
      <nav aria-label="Navegação principal" className="flex flex-1 flex-col px-2 py-2">
        {blocos.map(({ grupo, itens }, indice) => {
          const ultimo = indice === blocos.length - 1;
          return (
            <section
              key={grupo.chave}
              aria-labelledby={`grupo-${grupo.chave}`}
              className={cn(
                'flex flex-col gap-0.5',
                // O último grupo desce para o rodapé e ganha a única linha da
                // coluna. `pt-2` depois da borda para o cabeçalho não encostar nela.
                ultimo
                  ? 'mt-auto border-t border-sidebar-border pt-2'
                  : indice > 0 && 'mt-4',
              )}
            >
              <h2
                id={`grupo-${grupo.chave}`}
                className="px-3 pb-1 text-[11px] font-medium tracking-wide text-sidebar-muted-foreground/80"
              >
                {grupo.titulo}
              </h2>
              {itens.map((item) => (
                <NavLink
                  key={item.href}
                  item={item}
                  variante="lateral"
                  contagem={item.fila ? (filas[item.fila] ?? null) : null}
                />
              ))}
            </section>
          );
        })}
      </nav>
    </aside>
  );
}
