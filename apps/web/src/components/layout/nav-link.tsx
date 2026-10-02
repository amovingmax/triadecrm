'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { rotuloDasRespostas } from '@/components/avisos/regra';
import { type ItemNavegacao, estaAtivo } from '@/lib/navegacao';
import { cn } from '@/lib/utils';

type Props = {
  item: ItemNavegacao;
  variante: 'lateral' | 'trilho' | 'inferior' | 'menu';
  onNavegar?: () => void;
  /**
   * Quanta coisa está parada esperando nesta tela. `null` quando o item não conta
   * (a maioria) ou quando a contagem falhou.
   *
   * O zero também não aparece: "Revisão 0" ocupa o mesmo espaço de "Revisão 42" e diz
   * o contrário — que não há por que entrar. Fila vazia é silêncio.
   */
  contagem?: number | null;
};

/**
 * Link de navegação com estado ativo pela rota atual; serve a lateral do desktop,
 * a barra inferior do celular e o menu "Mais".
 *
 * O ativo se marca por quatro coisas: peso (font-medium), um fundo de marca a 16%
 * sobre a base da casca, a tinta do rótulo em verde escuro (7,4:1) e uma marca de
 * 2px na cor da marca, à esquerda na lateral e no topo na barra inferior.
 *
 * O verde aqui era proibido até 17/09/2026 — "cor só significa temperatura" — e a
 * proibição valia enquanto a cor da marca e a da escala térmica dividissem o mesmo
 * território. Não dividem: a térmica vive DENTRO do dado (linha da lista, chip do
 * parceiro, barra do funil) e a marca vive no CROMO (esta lateral, o botão de
 * ação, o anel de foco). "Você está em Conversas" e "este parceiro está quente"
 * nunca são lidos no mesmo pedaço de tela.
 *
 * O inativo usa `--sidebar-muted-foreground`, medido contra o azul da casca; o
 * `--muted-foreground` do conteúdo pararia em 4,45:1 sobre ele.
 *
 * Na barra inferior o rótulo tem `truncate` (`overflow: hidden`), então a caixa da
 * linha precisa caber a tinta inteira: `leading-4` (16px) para os 16px que a Poppins
 * ocupa a 11px, nunca `leading-none` (11px). Isso deixou de ser precaução no dia em
 * que "Registrar" entrou na barra: o "g" é o primeiro descendente ali, e com
 * `leading-none` a perna dele seria cortada. "Relatórios" e "Agência", se um dia
 * subirem, perderiam o topo do acento pelo mesmo motivo. Cabe nos 64px da barra:
 * 20px de ícone + 4px + 16px de rótulo = 40px.
 *
 * Na variante "menu" (a folha "Mais" do celular) o item traz a DESCRIÇÃO sob o
 * rótulo. Treze rótulos de uma palavra são treze adivinhações: "Cadências", "Revisão"
 * e "Ligar" não dizem a ninguém o que há do outro lado, e a frase que explica isso
 * já existia em `NAVEGACAO` servindo só de índice invisível da paleta. Duas linhas
 * no máximo (`line-clamp-2`): a folha lista oito módulos, e um parágrafo por item
 * empurraria os últimos para fora da tela. A frase inteira continua indo para a
 * busca da paleta, que não depende do que está visível.
 */
export function NavLink({ item, variante, onNavegar, contagem = null }: Props) {
  const pathname = usePathname();
  const ativo = estaAtivo(pathname, item.href);
  const Icone = item.icone;
  const numero = contagem !== null && contagem > 0 ? contagem : null;
  // O que o leitor de tela diz do número. Em Conversas ele é resposta nova para
  // esta pessoa; nos outros, trabalho parado na fila.
  const rotuloDoNumero =
    numero === null
      ? undefined
      : item.fila === 'respostas'
        ? rotuloDasRespostas(numero)
        : `${numero} esperando`;

  // ---------------------------------------------------------------------------
  // O TRILHO DE 72px (Tríade Design System, 29/09/2026)
  // ---------------------------------------------------------------------------
  // O sistema pede um trilho só de ícones no lugar da lateral com rótulo. Adotar
  // isso ao pé da letra desfaria o que a lateral resolveu em 08/09/2026: doze
  // itens em fila indiana não diziam nada sobre si mesmos ("muitas abas e pouco
  // direcionamento", Rafael), e foram o AGRUPAMENTO e o RÓTULO que consertaram.
  //
  // O empate se resolve pela regra do próprio sistema — a referência vence na
  // aparência, o repositório vence no significado. Então a APARÊNCIA é a do
  // sistema (disco de 44px, ícone de 18px, menta no ativo) e o SIGNIFICADO fica:
  //
  // O RÓTULO VOLTA QUANDO O MOUSE PASSA (30/09/2026). Rafael: "adicione um
  // expandir menu ali, na hora que passar o mouse em cima". O item é uma linha
  // — disco do ícone mais o nome —, e o trilho fechado mostra só o disco; o nome
  // está sempre no documento (é ele que dá nome ao link para o leitor de tela),
  // e só aparece quando o trilho abre (`sidebar.tsx`). Por isso saíram o `title`
  // e o `aria-label`: o primeiro virava um segundo rótulo flutuando ao lado do
  // rótulo de verdade, e o segundo repetia o texto que o link já tem.
  if (variante === 'trilho') {
    return (
      <Link
        href={item.href}
        aria-current={ativo ? 'page' : undefined}
        onClick={onNavegar}
        className={cn(
          // Fechado, a linha tem os 44px do trilho e o `rounded-full` a faz um
          // disco; aberto, a mesma linha vira uma pílula com o nome dentro.
          'relative flex h-11 w-full shrink-0 items-center gap-3 overflow-hidden rounded-full pr-4 transition-colors',
          'outline-none focus-visible:ring-3 focus-visible:ring-ring/50',
          ativo
            ? 'bg-sidebar-accent text-sidebar-accent-foreground'
            : 'text-sidebar-muted-foreground hover:bg-muted hover:text-sidebar-foreground',
        )}
      >
        <span className="relative flex size-11 shrink-0 items-center justify-center">
          <Icone className="size-[18px]" aria-hidden="true" strokeWidth={1.75} />
          {numero !== null ? (
            // A MENTA, e é o único lugar do trilho fechado com cor. Ela existe
            // aqui porque o trilho sem rótulo precisa de um sinal que se veja sem
            // ler: o número é o que diz em qual módulo há trabalho parado agora.
            // No ativo o fundo já é menta, e a contagem vira tinta para não sumir.
            <span
              aria-label={rotuloDoNumero}
              className={cn(
                'numerico absolute top-0.5 right-0 inline-flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] leading-none font-semibold',
                ativo ? 'bg-menta-tinta text-menta' : 'bg-menta text-menta-tinta',
              )}
            >
              {numero > 99 ? '99+' : numero}
            </span>
          ) : null}
        </span>
        {/* O nome: invisível com o trilho fechado, aparece quando ele abre. A
            demora de entrada acompanha a do trilho, para o texto não surgir
            antes de haver espaço para ele. */}
        <span
          className={cn(
            'truncate text-sm font-medium whitespace-nowrap opacity-0 transition-opacity duration-150',
            'group-hover/trilho:opacity-100 group-hover/trilho:delay-150',
            'group-has-[:focus-visible]/trilho:opacity-100',
            'motion-reduce:transition-none',
          )}
        >
          {item.rotulo}
        </span>
      </Link>
    );
  }

  if (variante === 'inferior') {
    return (
      <Link
        href={item.href}
        aria-current={ativo ? 'page' : undefined}
        className={cn(
          'toque relative flex min-w-0 flex-1 flex-col items-center justify-center gap-1 px-1 text-[11px] leading-4 transition-colors',
          ativo ? 'font-medium text-foreground' : 'text-sidebar-muted-foreground',
        )}
      >
        {/* A PÍLULA MENTA ATRÁS DO ÍCONE (29/09/2026), e não a fatia inteira
            pintada com um fio preto em cima. Com a menta como acento, a fatia
            cheia virava um bloco verde de 65x64px no pé de toda tela do celular
            — o objeto mais forte da interface, para dizer só "você está aqui".
            A pílula é o mesmo recado do disco do trilho no desktop. */}
        <span
          aria-hidden="true"
          className={cn(
            'flex h-7 w-12 items-center justify-center rounded-full transition-colors',
            ativo && 'bg-menta text-menta-tinta',
          )}
        >
          <Icone className={cn('size-5', ativo && 'stroke-[2.25]')} />
        </span>
        {numero !== null ? (
          // O NÚMERO NA BARRA DO CELULAR (01/10/2026). A barra recebia a
          // contagem e não a desenhava: no celular, que é onde o time atende em
          // campo, Conversas nunca dizia que alguém tinha respondido. Fica no
          // ombro da pílula do ícone, com a mesma menta do trilho do desktop, e
          // fora do `aria-hidden` dela para o leitor de tela dizer o número.
          <span
            aria-label={rotuloDoNumero}
            className={cn(
              'numerico absolute top-1.5 left-1/2 ml-1.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] leading-none font-semibold',
              ativo ? 'bg-menta-tinta text-menta' : 'bg-menta text-menta-tinta',
            )}
          >
            {numero > 99 ? '99+' : numero}
          </span>
        ) : null}
        <span className="truncate">{item.rotulo}</span>
      </Link>
    );
  }

  if (variante === 'menu') {
    return (
      <Link
        href={item.href}
        aria-current={ativo ? 'page' : undefined}
        onClick={onNavegar}
        className={cn(
          // `min-h-11` e não `h-11`: o alvo de toque continua garantido, mas a linha
          // agora cresce com a descrição em vez de cortá-la pela metade.
          'toque flex min-h-11 items-start gap-3 rounded-lg px-3 py-2 text-sm transition-colors',
          ativo ? 'bg-accent font-medium text-accent-foreground' : 'text-foreground',
        )}
      >
        <Icone className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <span className="flex min-w-0 flex-col">
          <span className="flex items-center gap-2">
            <span className="truncate">{item.rotulo}</span>
            {numero !== null ? (
              <span
                aria-label={rotuloDoNumero}
                className="shrink-0 rounded-full bg-accent px-1.5 py-0.5 text-[11px] leading-none font-medium tabular-nums text-accent-foreground"
              >
                {numero > 99 ? '99+' : numero}
              </span>
            ) : null}
          </span>
          {/* `text-xs` e tinta secundária: é apoio ao rótulo, não um segundo rótulo.
              Some quando a descrição está vazia em vez de abrir um buraco na linha.

              No item ativo a tinta sobe para `accent-foreground`: sobre o `bg-accent`
              do escuro (#3f3f46) o esmaecido para em 4,07:1, abaixo dos 4,5:1 que
              12px exigem. Fora do ativo ele tem folga (5,81:1 no escuro, 5,15:1 no
              claro) e a hierarquia se sustenta no tamanho, não na cor. */}
          {item.descricao ? (
            <span
              className={cn(
                'line-clamp-2 text-xs leading-snug',
                ativo ? 'text-accent-foreground' : 'text-muted-foreground',
              )}
            >
              {item.descricao}
            </span>
          ) : null}
        </span>
      </Link>
    );
  }

  return (
    <Link
      href={item.href}
      aria-current={ativo ? 'page' : undefined}
      onClick={onNavegar}
      className={cn(
        'relative flex h-8 items-center gap-2.5 rounded-lg pr-2 pl-3 text-[13px] transition-colors',
        ativo
          ? 'bg-sidebar-accent font-medium text-sidebar-accent-foreground'
          : 'text-sidebar-muted-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground',
      )}
    >
      {ativo ? (
        <span
          aria-hidden="true"
          className="absolute top-1.5 bottom-1.5 left-0 w-0.5 bg-sidebar-primary"
        />
      ) : null}
      <Icone className="size-4 shrink-0" aria-hidden="true" />
      <span className="truncate">{item.rotulo}</span>
      {numero !== null ? (
        // `tabular-nums` porque os números da lateral ficam empilhados numa
        // coluna e mudam sozinhos: sem largura fixa de dígito, "9" virando "12"
        // empurra o alinhamento. `ml-auto` cola no fim da linha, contra a borda
        // interna, que é onde o olho varre depois de ler o rótulo.
        //
        // Sem cor: é a mesma tinta do rótulo inativo, só mais firme. Um badge
        // vermelho aqui seria a única cromia da lateral, e cromia neste produto
        // significa temperatura — não urgência.
        <span
          aria-label={rotuloDoNumero}
          className={cn(
            'ml-auto shrink-0 rounded-full px-1.5 py-0.5 text-[11px] leading-none font-medium tabular-nums',
            ativo
              ? 'bg-sidebar-primary/15 text-sidebar-accent-foreground'
              : 'bg-sidebar-accent/70 text-sidebar-muted-foreground',
          )}
        >
          {numero > 99 ? '99+' : numero}
        </span>
      ) : null}
    </Link>
  );
}
