'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { type ItemNavegacao, estaAtivo } from '@/lib/navegacao';
import { cn } from '@/lib/utils';

type Props = {
  item: ItemNavegacao;
  variante: 'lateral' | 'inferior' | 'menu';
  onNavegar?: () => void;
  /**
   * Quanta coisa está parada esperando nesta tela. `null` quando o item não conta
   * (a maioria) ou quando a contagem falhou.
   *
   * O zero também não aparece: "Radar 0" ocupa o mesmo espaço de "Radar 42" e diz
   * o contrário — que não há por que entrar. Fila vazia é silêncio.
   */
  contagem?: number | null;
};

/**
 * Link de navegação com estado ativo pela rota atual; serve a lateral do desktop,
 * a barra inferior do celular e o menu "Mais".
 *
 * O ativo se marca por três coisas sem cromia: peso (font-medium), um fundo sutil
 * (tinta a 8% sobre a própria base da casca, 1,20:1 contra ela) e uma marca de 2px
 * em tinta, à esquerda na lateral e no topo na barra inferior. É a mesma gramática
 * da barra térmica da lista, e nenhuma delas gasta cor cromática, que na interface
 * só significa temperatura.
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
 * rótulo. Treze rótulos de uma palavra são treze adivinhações: "Cadências", "Radar"
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

  if (variante === 'inferior') {
    return (
      <Link
        href={item.href}
        aria-current={ativo ? 'page' : undefined}
        className={cn(
          'toque relative flex min-w-0 flex-1 flex-col items-center justify-center gap-1 px-1 text-[11px] leading-4 transition-colors',
          ativo
            ? 'bg-sidebar-accent font-medium text-sidebar-accent-foreground'
            : 'text-sidebar-muted-foreground',
        )}
      >
        <span
          aria-hidden="true"
          className={cn(
            'absolute inset-x-3 top-0 h-0.5 bg-sidebar-primary',
            ativo ? 'opacity-100' : 'opacity-0',
          )}
        />
        <Icone className={cn('size-5', ativo && 'stroke-[2.25]')} aria-hidden="true" />
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
                aria-label={`${numero} esperando`}
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
          aria-label={`${numero} esperando`}
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
