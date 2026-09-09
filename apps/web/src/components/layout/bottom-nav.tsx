'use client';

import { Ellipsis } from 'lucide-react';
import { usePathname } from 'next/navigation';
import { useState } from 'react';

import { NavLink } from '@/components/layout/nav-link';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';
import { type AppRole } from '@/lib/auth/role';
import { type ContagemDasFilas } from '@/lib/filas-do-menu';
import { barraDoCelular, estaAtivo, GRUPOS, type ItemNavegacao } from '@/lib/navegacao';
import { cn } from '@/lib/utils';

/**
 * Barra inferior do celular (até md): os módulos de uso diário mais "Mais", que abre
 * o resto numa folha. É a navegação de campo, a um polegar de distância (PRD §8):
 * Meu dia, Registrar, Parceiros, Funis e Conversas.
 *
 * Eram quatro até "Registrar" entrar. Ela é a única tela em que o trabalho de campo
 * VIRA dado (temperatura, próxima ação e meta saem de lá), e estava fora da
 * navegação inteira: chegava-se a ela por link de outro módulo ou pelo estado vazio
 * do Meu dia, que só aparece quando não há o que registrar. Uma tela de campo que só
 * se alcança de dentro de outra tela não é de campo.
 *
 * Cinco itens mais "Mais" são seis fatias de `flex-1`. Em 390px isso dá 65px por
 * fatia, ainda acima do alvo de 44px, e os rótulos mais longos ("Parceiros",
 * "Conversas") ficam no limite do `truncate`. Seis fatias é o preço de a tela de
 * registro existir na navegação, e é mais barato que a ausência dela.
 *
 * A ORDEM DAQUI NÃO É A DA LATERAL, e isso é decisão, não descuido. A lateral
 * agrupa por natureza do trabalho; a barra ordena por frequência do polegar, e
 * está escrita em `posicaoNaBarra`. Quando os três grupos entraram, herdar a ordem
 * da lateral teria empurrado Conversas para a terceira fatia e Parceiros para a
 * quarta — trocar de lugar o botão que a mão já sabe achar, sem que ninguém
 * tivesse decidido isso.
 *
 * A folha "Mais" repete os três grupos, e é o único lugar do celular em que cada
 * grupo aparece com a frase que explica o que ele é: no desktop uma coluna de
 * 208px não comporta um parágrafo, e aqui há espaço e há tempo.
 *
 * A base é a da casca (a mesma da lateral do desktop: #e0f2fe no claro, #1e293b no
 * escuro), com desfoque e hairline em cima. Os 64px de altura são deliberados e
 * ficam acima do teto de 56px do cabeçalho: é o mínimo para empilhar ícone de 20px
 * e rótulo de 11px dentro de um alvo de toque de 44px.
 */
export function BottomNav({ papel, filas }: { papel: AppRole; filas: ContagemDasFilas }) {
  const pathname = usePathname();
  const [aberto, setAberto] = useState(false);

  const { fatias: principais, emMais: secundarios } = barraDoCelular(papel);
  const algumSecundarioAtivo = secundarios.some((item) => estaAtivo(pathname, item.href));

  // A folha "Mais" repete os grupos da lateral, e aqui eles ganham a frase de
  // explicação que não cabe numa coluna de 208px. É o único lugar do produto em
  // que alguém para para LER o que é cada parte do CRM — no celular a folha se
  // abre inteira, sem pressa, e é onde uma pessoa nova aterrissa quando procura
  // algo que não está na barra. Grupo sem item secundário não é desenhado.
  const gruposDaFolha = GRUPOS.map((grupo) => ({
    grupo,
    itens: secundarios.filter((item) => item.grupo === grupo.chave),
  })).filter((bloco) => bloco.itens.length > 0);

  const contagemDe = (chave: ItemNavegacao['fila']) => (chave ? (filas[chave] ?? null) : null);

  return (
    <nav
      aria-label="Navegação principal"
      className="superficie-vidro-inferior fixed inset-x-0 bottom-0 z-30 pb-[var(--area-segura-inferior)] md:hidden"
    >
      <div className="flex h-[var(--altura-barra-inferior)] items-stretch">
        {principais.map((item) => (
          <NavLink
            key={item.href}
            item={item}
            variante="inferior"
            contagem={contagemDe(item.fila)}
          />
        ))}

        <Sheet open={aberto} onOpenChange={setAberto}>
          <SheetTrigger
            className={cn(
              'toque relative flex min-w-0 flex-1 flex-col items-center justify-center gap-1 px-1 text-[11px] leading-4 transition-colors',
              algumSecundarioAtivo
                ? 'bg-sidebar-accent font-medium text-sidebar-accent-foreground'
                : 'text-sidebar-muted-foreground',
            )}
            aria-label="Mais áreas do CRM"
          >
            <span
              aria-hidden="true"
              className={cn(
                'absolute inset-x-3 top-0 h-0.5 bg-sidebar-primary',
                algumSecundarioAtivo ? 'opacity-100' : 'opacity-0',
              )}
            />
            <Ellipsis
              className={cn('size-5', algumSecundarioAtivo && 'stroke-[2.25]')}
              aria-hidden="true"
            />
            <span>Mais</span>
          </SheetTrigger>

          {/* Teto de 80svh com rolagem própria: a folha é `h-auto` e cresce com o
              conteúdo. Desde que cada linha passou a trazer a descrição do módulo,
              oito módulos secundários passam de 500px, e num aparelho de 667px de
              altura a folha sairia pelo topo levando junto os últimos itens. `svh`
              e não `vh` porque a barra do navegador do celular entra na conta. */}
          <SheetContent
            side="bottom"
            className="max-h-[80svh] gap-3 overflow-y-auto rounded-t-xl pb-[calc(var(--area-segura-inferior)+0.75rem)]"
          >
            <SheetHeader className="pb-1">
              <SheetTitle>Mais áreas</SheetTitle>
              <SheetDescription>Os módulos que não cabem na barra.</SheetDescription>
            </SheetHeader>
            <div className="flex flex-col gap-4 px-2">
              {gruposDaFolha.map(({ grupo, itens: doGrupo }) => (
                <section key={grupo.chave} aria-labelledby={`folha-${grupo.chave}`}>
                  <div className="px-3 pb-2">
                    <h3 id={`folha-${grupo.chave}`} className="text-sm font-medium">
                      {grupo.titulo}
                    </h3>
                    <p className="text-xs leading-snug text-muted-foreground">
                      {grupo.explicacao}
                    </p>
                  </div>
                  <div className="flex flex-col gap-0.5">
                    {doGrupo.map((item) => (
                      <NavLink
                        key={item.href}
                        item={item}
                        variante="menu"
                        contagem={contagemDe(item.fila)}
                        onNavegar={() => setAberto(false)}
                      />
                    ))}
                  </div>
                </section>
              ))}
            </div>
          </SheetContent>
        </Sheet>
      </div>
    </nav>
  );
}
