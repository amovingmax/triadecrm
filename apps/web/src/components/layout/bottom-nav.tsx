'use client';

import { Ellipsis, Search, XIcon } from 'lucide-react';
import { usePathname } from 'next/navigation';
import { useRef, useState } from 'react';

import { useLeadsNovos } from '@/components/anuncios/leads/vigia-de-leads';
import { useAvisos } from '@/components/avisos/provedor-avisos';
import { NavLink } from '@/components/layout/nav-link';
import { abrirPaletaDeComandos, preCarregarPaleta } from '@/components/layout/paleta-comandos';
import { Button } from '@/components/ui/button';
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';
import { type AppRole } from '@/lib/auth/role';
import { type ContagemDasFilas } from '@/lib/filas-do-menu';
import { barraDoCelular, contagemDoItem, estaAtivo, GRUPOS } from '@/lib/navegacao';
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
 * fatia, ainda acima do alvo de 44px. Nenhuma fatia fica mais estreita que o próprio
 * rótulo, que aparece inteiro: a regra está em `nav-link.tsx`.
 *
 * A ORDEM DAQUI NÃO É A DA LATERAL, e isso é decisão, não descuido. A lateral
 * agrupa por natureza do trabalho; a barra ordena por frequência do polegar, e
 * está escrita em `posicaoNaBarra`. Quando os três grupos entraram, herdar a ordem
 * da lateral teria empurrado Conversas para a terceira fatia e Parceiros para a
 * quarta — trocar de lugar o botão que a mão já sabe achar, sem que ninguém
 * tivesse decidido isso.
 *
 * A base é a da casca (a mesma da lateral do desktop: #e0f2fe no claro, #1e293b no
 * escuro), com desfoque e hairline em cima. Os 64px de altura são deliberados e
 * ficam acima do teto de 56px do cabeçalho: é o mínimo para empilhar ícone de 20px
 * e rótulo de 11px dentro de um alvo de toque de 44px.
 *
 * ---------------------------------------------------------------------------
 * A FOLHA "MAIS" É UMA GRADE DE ATALHOS, NÃO UM ÍNDICE (16/11/2026)
 * ---------------------------------------------------------------------------
 * O dono abriu o "Mais" no iPhone e pediu "algo mais organizado". De 09/09 a
 * 16/11/2026 a folha era uma lista em que cada módulo trazia a descrição inteira
 * sob o rótulo, cortada em duas linhas com reticências, e cada grupo um parágrafo
 * de explicação. Na Imova eram oito módulos e era preciso rolar para chegar em
 * "Ajustes": parecia um documento, não um menu. Quem abre o "Mais" já sabe para
 * onde vai — quer o atalho, não a leitura.
 *
 * O desenho de agora, de cima para baixo:
 *
 *   1. O PUXADOR e o título. O puxador não é enfeite: arrastar a faixa de cima
 *      para baixo fecha a folha (`usePuxarParaFechar`), que é o que o polegar de
 *      quem usa iPhone tenta fazer primeiro. O X continua ali, com rótulo, para
 *      quem não arrasta e para o teclado.
 *   2. "BUSCAR NO CRM", que é a paleta de comandos do cabeçalho — a mesma, não uma
 *      cópia (`abrirPaletaDeComandos`). É lá que mora a descrição de cada módulo
 *      que saiu daqui: quem procura "planilha" ou "rota" acha pela frase, e lê o
 *      que vai encontrar antes de tocar.
 *   3. OS TRÊS GRUPOS da lateral, com o título e um apoio de três ou quatro
 *      palavras numa linha (`GrupoDeNavegacao.apoio`), e cada grupo uma GRADE de
 *      ladrilhos: ícone num quadrado de canto macio e o rótulo inteiro embaixo
 *      (`nav-link.tsx`, variante "menu"). Grupo sem módulo aqui não é desenhado.
 *
 * O REALCE NÃO GASTA COR, como em toda a casca: o módulo em que a pessoa está
 * ganha a menta cheia no quadrado (a mesma pílula da barra, na forma do ladrilho) e
 * rótulo em negrito; o resto é a superfície esmaecida. O número continua sendo
 * trabalho parado esperando, agora como selo no ombro do quadrado, e entra no nome
 * do link para o leitor de tela.
 *
 * TRÊS OU QUATRO COLUNAS, pelo tamanho do maior grupo. Todos os grupos dividem a
 * mesma grade, para os ícones se alinharem de um grupo para o outro. Na Imova o
 * Controle tem quatro módulos (Metas, Relatórios, IA que atende, Ajustes) e a folha
 * vai a quatro colunas: os oito cabem em três linhas, sem rolar, num celular de
 * 375×667. Na KOMUNE (sem Anúncios e sem IA que atende) os grupos têm três, e três
 * colunas deixam cada linha cheia em vez de um buraco no fim. Em 360px a coluna de
 * quatro tem 79px: "IA que atende" (75px na Figtree da Imova) cabe numa linha.
 *
 * A folha continua com teto (85svh) e rola POR DENTRO, só na parte dos grupos: se
 * um dia o "Mais" crescer, o título, o X e a busca ficam à vista.
 */
export function BottomNav({ papel, filas }: { papel: AppRole; filas: ContagemDasFilas }) {
  const pathname = usePathname();
  const [aberto, setAberto] = useState(false);
  // Fechar a folha para abrir a paleta: a folha não devolve o foco ao "Mais" ao
  // sair, senão tiraria o foco do campo da paleta, que abriu por cima dela.
  const indoParaPaleta = useRef(false);
  const { folha, puxador } = usePuxarParaFechar(() => setAberto(false));

  const { fatias: principais, emMais: secundarios } = barraDoCelular(papel);
  const algumSecundarioAtivo = secundarios.some((item) => estaAtivo(pathname, item.href));

  const gruposDaFolha = GRUPOS.map((grupo) => ({
    grupo,
    itens: secundarios.filter((item) => item.grupo === grupo.chave),
  })).filter((bloco) => bloco.itens.length > 0);
  const quatroColunas = gruposDaFolha.some((bloco) => bloco.itens.length >= 4);

  const { respostasNovas } = useAvisos();
  const { novos: leadsNovos } = useLeadsNovos();

  function buscar() {
    indoParaPaleta.current = true;
    setAberto(false);
    abrirPaletaDeComandos();
  }

  return (
    // Some enquanto há uma conversa aberta em tela cheia (`data-area-visivel`, em
    // Conversas e Grupos): no primeiro teste num iPhone, com o teclado aberto, ela
    // apareceu embaixo da conversa (04/11/2026).
    <nav
      aria-label="Navegação principal"
      className="superficie-vidro-inferior fixed inset-x-0 bottom-0 z-30 pb-[var(--area-segura-inferior)] md:hidden [body:has([data-area-visivel])_&]:hidden"
    >
      <div className="flex h-[var(--altura-barra-inferior)] items-stretch">
        {principais.map((item) => (
          <NavLink
            key={item.href}
            item={item}
            variante="inferior"
            contagem={contagemDoItem(item, filas, respostasNovas, leadsNovos)}
          />
        ))}

        {/* Sem nada para guardar, não há "Mais": quem liga tem duas telas, e um
            botão que abre uma folha vazia é uma porta para lugar nenhum. */}
        {secundarios.length === 0 ? null : (
          <Sheet open={aberto} onOpenChange={setAberto}>
            <SheetTrigger
              className={cn(
                'toque relative flex min-w-max flex-1 flex-col items-center justify-center gap-1 text-[clamp(10px,3.25vw,11px)] leading-4 transition-colors',
                algumSecundarioAtivo
                  ? 'font-medium text-foreground'
                  : 'text-sidebar-muted-foreground',
              )}
              aria-label="Mais áreas do CRM"
            >
              {/* A mesma pílula menta dos outros itens (ver `nav-link.tsx`). */}
              <span
                aria-hidden="true"
                className={cn(
                  'flex h-7 w-12 items-center justify-center rounded-full transition-colors',
                  algumSecundarioAtivo && 'bg-menta text-menta-tinta',
                )}
              >
                <Ellipsis className={cn('size-5', algumSecundarioAtivo && 'stroke-[2.25]')} />
              </span>
              <span>Mais</span>
            </SheetTrigger>

            {/* Teto de 85svh e a rolagem só na parte dos grupos (`min-h-0` +
                `overflow-y-auto` no filho de baixo da coluna flex). `svh` e não
                `vh` porque a barra do navegador do celular entra na conta.

                O FOCO AO ABRIR vai para a própria folha, e não para o primeiro
                botão dela. O Radix foca o primeiro alvo da folha ao abrir, e no
                toque isso desenhava o anel de foco grosso em volta dele, como se
                alguém tivesse navegado até ali pelo teclado. A folha é focável
                (`tabIndex=-1` do Radix) e sem contorno: o leitor de tela entra
                nela pelo título, e o Tab segue para a busca, os ladrilhos e o X,
                com o anel de sempre. */}
            <SheetContent
              ref={folha}
              side="bottom"
              showCloseButton={false}
              onOpenAutoFocus={(evento) => {
                evento.preventDefault();
                folha.current?.focus({ preventScroll: true });
              }}
              onCloseAutoFocus={(evento) => {
                if (!indoParaPaleta.current) return;
                indoParaPaleta.current = false;
                evento.preventDefault();
              }}
              className="max-h-[85svh] gap-0 rounded-t-2xl outline-none"
            >
              {/* A faixa que se arrasta: puxador e título. `touch-none` para o
                  arrasto não virar rolagem nem o "puxar para recarregar" da página. */}
              <div {...puxador} className="shrink-0 touch-none select-none">
                <div aria-hidden="true" className="flex justify-center pt-2 pb-1">
                  <span className="h-1 w-9 rounded-full bg-muted-foreground/30" />
                </div>
                <div className="flex items-center justify-between pr-2 pl-5">
                  <SheetTitle className="text-base font-semibold">Mais áreas</SheetTitle>
                  <SheetClose asChild>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      className="toque size-11 text-muted-foreground hover:text-foreground"
                    >
                      <XIcon className="size-5" aria-hidden="true" />
                      <span className="sr-only">Fechar</span>
                    </Button>
                  </SheetClose>
                </div>
                <SheetDescription className="sr-only">
                  Os módulos que não cabem na barra, por grupo, e a busca do CRM.
                </SheetDescription>
              </div>

              <div className="shrink-0 px-4 pt-1 pb-4">
                <Button
                  variant="outline"
                  onClick={buscar}
                  onPointerDown={preCarregarPaleta}
                  className="toque h-11 w-full justify-start gap-2.5 px-3.5 font-normal text-muted-foreground hover:text-foreground"
                >
                  <Search className="size-4" aria-hidden="true" />
                  Buscar no CRM
                </Button>
              </div>

              <div className="flex min-h-0 flex-col gap-5 overflow-y-auto overscroll-contain px-4 pb-[calc(var(--area-segura-inferior)+1.25rem)]">
                {gruposDaFolha.map(({ grupo, itens: doGrupo }) => (
                  <section key={grupo.chave} aria-labelledby={`folha-${grupo.chave}`}>
                    {/* Título e apoio numa linha só. O apoio corta antes de quebrar:
                        é complemento, e uma segunda linha devolveria o parágrafo. */}
                    <h3
                      id={`folha-${grupo.chave}`}
                      className="flex items-baseline gap-1.5 px-1 pb-2 text-[13px] leading-5 font-semibold"
                    >
                      <span className="shrink-0">{grupo.titulo}</span>
                      <span className="truncate text-xs font-normal text-muted-foreground">
                        · {grupo.apoio}
                      </span>
                    </h3>
                    <div
                      className={cn(
                        'grid gap-x-1 gap-y-3',
                        quatroColunas ? 'grid-cols-4' : 'grid-cols-3',
                      )}
                    >
                      {doGrupo.map((item) => (
                        <NavLink
                          key={item.href}
                          item={item}
                          variante="menu"
                          contagem={contagemDoItem(item, filas, respostasNovas, leadsNovos)}
                          onNavegar={() => setAberto(false)}
                        />
                      ))}
                    </div>
                  </section>
                ))}
              </div>
            </SheetContent>
          </Sheet>
        )}
      </div>
    </nav>
  );
}

/**
 * ARRASTAR PARA BAIXO FECHA A FOLHA. O Radix não arrasta; isto é o mínimo que dá ao
 * puxador o comportamento que ele promete. A folha acompanha o dedo enquanto ele
 * desce (só para baixo: para cima ela não sai do lugar) e, ao soltar, fecha se o
 * arrasto passou de 96px ou foi um piparote (mais de 24px a mais de 0,5 px/ms);
 * senão volta para o lugar. O arrasto mexe no `transform` direto no elemento, sem
 * estado do React, para não redesenhar a folha a cada quadro.
 *
 * Ao fechar pelo arrasto, a animação de saída parte de onde o dedo largou e desce
 * até sumir (`--tw-exit-translate-y: 100%`), em vez de pular de volta para a saída
 * curta de sempre.
 */
function usePuxarParaFechar(aoFechar: () => void) {
  const folha = useRef<HTMLDivElement>(null);
  const inicio = useRef<{ y: number; quando: number; id: number } | null>(null);

  function voltar() {
    const el = folha.current;
    inicio.current = null;
    if (!el) return;
    el.style.transition = '';
    el.style.transform = '';
  }

  const puxador = {
    onPointerDown(evento: React.PointerEvent<HTMLDivElement>) {
      if (evento.pointerType === 'mouse' && evento.button !== 0) return;
      // O X é botão: tocar nele fecha pelo clique, não começa arrasto.
      if ((evento.target as HTMLElement).closest('button, a')) return;
      inicio.current = { y: evento.clientY, quando: evento.timeStamp, id: evento.pointerId };
      evento.currentTarget.setPointerCapture(evento.pointerId);
      if (folha.current) folha.current.style.transition = 'none';
    },
    onPointerMove(evento: React.PointerEvent<HTMLDivElement>) {
      const comeco = inicio.current;
      if (!comeco || comeco.id !== evento.pointerId || !folha.current) return;
      const desceu = Math.max(0, evento.clientY - comeco.y);
      folha.current.style.transform = `translateY(${desceu}px)`;
    },
    onPointerUp(evento: React.PointerEvent<HTMLDivElement>) {
      const comeco = inicio.current;
      const el = folha.current;
      if (!comeco || comeco.id !== evento.pointerId || !el) return;
      const desceu = evento.clientY - comeco.y;
      const rapidez = desceu / Math.max(1, evento.timeStamp - comeco.quando);
      if (desceu > 96 || (desceu > 24 && rapidez > 0.5)) {
        inicio.current = null;
        el.style.transition = '';
        el.style.setProperty('--tw-exit-translate-y', '100%');
        aoFechar();
        return;
      }
      voltar();
    },
    onPointerCancel: voltar,
  };

  return { folha, puxador };
}
