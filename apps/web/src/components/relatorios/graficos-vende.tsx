'use client';

import {
  Children,
  Fragment,
  isValidElement,
  useId,
  useRef,
  useState,
  type CSSProperties,
  type ReactElement,
  type ReactNode,
} from 'react';
import type { UseQueryResult } from '@tanstack/react-query';
import { ArrowDownRight, ArrowUpRight, ChevronRight, Info, Minus, Sparkles } from 'lucide-react';

import { cn } from '@/lib/utils';
import { Skeleton } from '@/components/ui/skeleton';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

import { mensagemDoErro } from './dados';
import { ErroDoRelatorio, VazioDoRelatorio } from './estados';
import { fracao, pontosDaLinha, trechosDaLinha, type Delta } from './formatos-vende';
import type { DefinicaoPainel } from './tipos';

/**
 * As peças de gráfico do "relatório que vende" da Imova (09/11/2026; linguagem visual
 * revista em 16/11/2026, "mais clean, mais analítica").
 *
 * Sem biblioteca: o protótipo aprovado é CSS e SVG, e é isso que vai para a tela.
 * As regras valem para todo gráfico daqui:
 *   - um eixo só (nunca dois); quando duas medidas de escala diferente aparecem
 *     juntas, cada uma tem a sua coluna, com o seu título;
 *   - cor carrega identidade e texto fica em tinta: nenhum número ou rótulo é
 *     escrito na cor da série;
 *   - destaque é a tinta calma (`--vende-tinta`) e o resto é cinza (`--vende-resto`);
 *   - barra com ponta arredondada de 4px na ponta do dado (a base fica reta) e 2px
 *     de vão entre segmentos empilhados; coluna nunca mais larga que o seu teto
 *     (uma semana sozinha não ocupa meia tela);
 *   - grade quase invisível (`--vende-grade`), base um degrau mais forte
 *     (`--vende-eixo`), rótulos de eixo em 11px;
 *   - linha de 2px, ponto de 8px com anel da cor do cartão; a semana corrente, que
 *     está pela metade, pode vir marcada como parcial (tracejada ou hachurada);
 *   - legenda sempre que houver duas séries ou mais;
 *   - a dica abre no mouse E no foco do teclado (Radix Tooltip), num alvo maior que
 *     a marca;
 *   - nada só por cor: nível, situação e tendência vêm sempre com texto junto.
 */

/**
 * A paleta, em variáveis CSS com o par do modo escuro. Vai na raiz de cada painel.
 *
 * Interesse (muito / interessado / morno): uma rampa de um matiz só, do escuro para o
 * claro no modo claro e do claro para o escuro no escuro (o passo mais perto do fundo
 * é sempre o "menos": morno). O morno do claro tem contraste baixo com o cartão, por
 * isso o nível sempre aparece escrito ao lado.
 * IA × equipe e procura × oferta: azul e laranja. Interesse subiu / igual / caiu:
 * azul, cinza neutro e vermelho. Os passos do escuro saíram do validador de paleta
 * (rampa ordinal: degraus monotônicos, ponta clara a 2,77:1 do cartão #1c1c1c; o
 * par categórico com ΔE 26,8 sob protanopia).
 *
 * Os NEUTROS (tinta, resto, igual, traço, grade e eixo) não são mais hex fixo: são a
 * tinta do texto misturada ao cartão (`color-mix` em OKLab), para seguirem o tema em
 * que estão. Na KOMUNE a mistura cai em cima dos cinzas validados de antes (o resto
 * do escuro dá #4d4d4c contra o #4f4f4d antigo; o do claro, #c9c9c7); no petróleo da
 * Imova eles ganham o mesmo tom do cartão em vez de um cinza marrom solto.
 *
 * O destaque (`--vende-tinta`) deixou de ser a tinta pura do texto (16/11/2026): no
 * escuro, barra grande em #e6f0ee (13:1 do cartão) ofuscava e parecia "selecionada".
 * Agora é 72% da tinta no escuro (6,96:1 do cartão #152a28 da Imova; 7,9:1 do
 * #1c1c1c da KOMUNE) e 86% no claro (cerca de 12:1 do branco). O resto fica a 1,9:1
 * no escuro e 1,6:1 no claro: a distância entre os dois continua sendo o "destaque ×
 * resto", e os dois passam longe um do outro.
 */
export const PALETA_VENDE = [
  '[--vende-muito:#7f2410] [--vende-interessado:#c4512a] [--vende-morno:#ec9468]',
  '[--vende-azul:#2a78d6] [--vende-laranja:#eb6834]',
  '[--vende-subiu:#2a78d6] [--vende-caiu:#e34948]',
  '[--vende-tinta:color-mix(in_oklab,var(--foreground)_86%,var(--card))]',
  '[--vende-resto:color-mix(in_oklab,var(--foreground)_20%,var(--card))]',
  '[--vende-igual:color-mix(in_oklab,var(--foreground)_14%,var(--card))]',
  '[--vende-traco:color-mix(in_oklab,var(--foreground)_58%,var(--card))]',
  '[--vende-grade:color-mix(in_oklab,var(--foreground)_6%,var(--card))]',
  '[--vende-eixo:color-mix(in_oklab,var(--foreground)_16%,var(--card))]',
  'dark:[--vende-muito:#f4b08f] dark:[--vende-interessado:#e07045] dark:[--vende-morno:#a8401f]',
  'dark:[--vende-azul:#3987e5] dark:[--vende-laranja:#d95926]',
  'dark:[--vende-subiu:#3987e5] dark:[--vende-caiu:#e66767]',
  'dark:[--vende-tinta:color-mix(in_oklab,var(--foreground)_72%,var(--card))]',
  'dark:[--vende-resto:color-mix(in_oklab,var(--foreground)_26%,var(--card))]',
  'dark:[--vende-igual:color-mix(in_oklab,var(--foreground)_21%,var(--card))]',
  'dark:[--vende-traco:color-mix(in_oklab,var(--foreground)_62%,var(--card))]',
  'dark:[--vende-grade:color-mix(in_oklab,var(--foreground)_8%,var(--card))]',
  'dark:[--vende-eixo:color-mix(in_oklab,var(--foreground)_18%,var(--card))]',
].join(' ');

/** As cores por papel, como classe de fundo. */
export const COR = {
  tinta: 'bg-(--vende-tinta)',
  resto: 'bg-(--vende-resto)',
  muito: 'bg-(--vende-muito)',
  interessado: 'bg-(--vende-interessado)',
  morno: 'bg-(--vende-morno)',
  azul: 'bg-(--vende-azul)',
  laranja: 'bg-(--vende-laranja)',
  subiu: 'bg-(--vende-subiu)',
  igual: 'bg-(--vende-igual)',
  caiu: 'bg-(--vende-caiu)',
  traco: 'bg-(--vende-traco)',
} as const;

export type Cor = keyof typeof COR;

/** A mesma cor como valor CSS (para traço e gradiente em SVG). */
const VARIAVEL_DA_COR: Record<Cor, string> = {
  tinta: 'var(--vende-tinta)',
  resto: 'var(--vende-resto)',
  muito: 'var(--vende-muito)',
  interessado: 'var(--vende-interessado)',
  morno: 'var(--vende-morno)',
  azul: 'var(--vende-azul)',
  laranja: 'var(--vende-laranja)',
  subiu: 'var(--vende-subiu)',
  igual: 'var(--vende-igual)',
  caiu: 'var(--vende-caiu)',
  traco: 'var(--vende-traco)',
};

/**
 * A hachura da semana parcial: listras a 135° na cor do cartão por cima da cor da
 * marca. Diz "pela metade" sem depender de cor (e sem trocar a cor da série).
 */
const HACHURA_PARCIAL: CSSProperties = {
  backgroundImage: 'repeating-linear-gradient(135deg, transparent 0 3px, var(--card) 3px 5px)',
};

/**
 * O aviso de que a tabela larga continua à direita, no celular: o mesmo recurso de
 * `tabela.tsx` (sombras presas ao contêiner, cobertas por fundos presos ao
 * conteúdo), com a cobertura na cor do CARTÃO, onde estas tabelas moram.
 */
export const SOMBRA_DE_ROLAGEM_NO_CARTAO: CSSProperties = {
  backgroundImage: [
    'linear-gradient(to right, var(--card), transparent)',
    'linear-gradient(to left, var(--card), transparent)',
    'linear-gradient(to right, color-mix(in oklab, var(--foreground) 10%, transparent), transparent)',
    'linear-gradient(to left, color-mix(in oklab, var(--foreground) 10%, transparent), transparent)',
  ].join(', '),
  backgroundPosition: 'left center, right center, left center, right center',
  backgroundRepeat: 'no-repeat',
  backgroundSize: '2rem 100%, 2rem 100%, 0.75rem 100%, 0.75rem 100%',
  backgroundAttachment: 'local, local, scroll, scroll',
};

/** O fundo levemente azul da sugestão da IA: identidade, não texto. */
export const FUNDO_DA_IA = 'bg-(--vende-azul)/8 dark:bg-(--vende-azul)/15';

/** O id do `useId` serve de `url(#…)` em SVG só sem os caracteres especiais. */
function idDeSvg(id: string): string {
  return `vende${id.replace(/[^a-zA-Z0-9_-]/g, '')}`;
}

// ---------------------------------------------------------------------------
// Molduras
// ---------------------------------------------------------------------------

/**
 * A moldura de uma aba: título e o que ela responde, a linha de apoio (o recorte, as
 * premissas) e os três estados da consulta. `children` só roda com dado na mão.
 * A função do banco que devolve `null` (a aba sem nada ainda) cai no vazio honesto,
 * e não num gráfico quebrado.
 *
 * O apoio vira chips discretos: cada parágrafo (`<p>`) que chega é partido nos seus
 * " · " e em cada `<br>`, e cada parte vira um chip. O que não é parágrafo (o botão
 * das premissas, por exemplo) entra como veio. No celular o apoio desce para baixo da
 * descrição (o título nunca é espremido numa coluna estreita).
 */
export function MolduraDaAba<T>({
  painel,
  consulta,
  apoio,
  tiras,
  children,
}: {
  painel: DefinicaoPainel;
  consulta: UseQueryResult<T, Error>;
  /** À direita do título: o recorte, a hora da foto, as premissas. */
  apoio?: ReactNode;
  /** Quantos números o esqueleto desenha no topo. */
  tiras?: number;
  children: (dados: T) => ReactNode;
}) {
  const id = useId();
  return (
    <section aria-labelledby={id} className={cn('flex w-full min-w-0 flex-col gap-4', PALETA_VENDE)}>
      <header className="flex flex-wrap items-start justify-between gap-x-8 gap-y-3 pb-1">
        <div className="min-w-0 flex-1 basis-full md:basis-0">
          <h2 id={id} className="font-heading text-lg leading-tight font-semibold tracking-tight">
            {painel.titulo}
          </h2>
          <p className="mt-1.5 max-w-[68ch] text-[13px] leading-relaxed text-pretty text-muted-foreground">
            {painel.descricao}
          </p>
        </div>
        {apoio ? <ApoioEmChips apoio={apoio} /> : null}
      </header>
      {consulta.isPending ? (
        <EsqueletoVende tiras={tiras} />
      ) : consulta.isError ? (
        <div className="rounded-xl border border-hairline bg-card px-4 md:px-6">
          <ErroDoRelatorio causa={mensagemDoErro(consulta.error)} aoTentar={() => void consulta.refetch()} />
        </div>
      ) : consulta.data === null || consulta.data === undefined ? (
        <div className="rounded-xl border border-hairline bg-card px-4 md:px-6">
          <VazioDoRelatorio
            titulo="Este relatório ainda não tem números"
            texto="O banco não devolveu nada para esta leitura. Os números aparecem com as primeiras conversas, visitas e imóveis no ar."
          />
        </div>
      ) : (
        children(consulta.data)
      )}
    </section>
  );
}

/** Abre os fragmentos: o apoio chega como `<>…</>`, ou como `<p>` com fragmento dentro. */
function achatar(nos: ReactNode): ReactNode[] {
  return Children.toArray(nos).flatMap((no) =>
    isValidElement<{ children?: ReactNode }>(no) && no.type === Fragment ? achatar(no.props.children) : [no],
  );
}

/** O que separa uma parte da outra: um `<br>` ou um `<span> · </span>`. */
function ehSeparador(no: ReactNode): boolean {
  if (!isValidElement<{ children?: ReactNode }>(no)) return false;
  if (no.type === 'br') return true;
  return no.type === 'span' && typeof no.props.children === 'string' && no.props.children.trim() === '·';
}

/** As partes de um parágrafo de apoio, cortadas nos " · " e nos `<br>`. */
function partesDoApoio(filhos: ReactNode): ReactNode[][] {
  const partes: ReactNode[][] = [];
  let atual: ReactNode[] = [];
  // O espaço solto entre dois pedaços ("Contra os {n} {dias}") fica; só o espaço da
  // ponta de um chip cai.
  const branco = (no: ReactNode) => typeof no === 'string' && no.trim() === '';
  const fechar = () => {
    while (atual.length > 0 && branco(atual[0])) atual.shift();
    while (atual.length > 0 && branco(atual[atual.length - 1])) atual.pop();
    if (atual.length > 0) partes.push(atual);
    atual = [];
  };
  for (const no of achatar(filhos)) {
    if (ehSeparador(no)) {
      fechar();
    } else if (typeof no === 'string') {
      no.split(/\s+·\s+|\s+·$|^·\s+/).forEach((pedaco, i) => {
        if (i > 0) fechar();
        if (pedaco) atual.push(pedaco);
      });
    } else {
      atual.push(no);
    }
  }
  fechar();
  return partes;
}

function ApoioEmChips({ apoio }: { apoio: ReactNode }) {
  return (
    <div className="flex max-w-full flex-wrap items-center gap-x-2 gap-y-1.5 md:max-w-[46%] md:justify-end">
      {achatar(apoio).map((no, i) => {
        const paragrafo =
          typeof no === 'string'
            ? no
            : isValidElement<{ children?: ReactNode }>(no) && no.type === 'p'
              ? no.props.children
              : null;
        if (paragrafo === null) return <Fragment key={i}>{no}</Fragment>;
        return (
          <ul key={i} className="flex flex-wrap items-center gap-1.5 md:justify-end">
            {partesDoApoio(paragrafo).map((parte, j) => (
              <li
                key={j}
                className="inline-flex min-h-7 items-center gap-1.5 rounded-full border border-hairline bg-card/50 px-2.5 py-1 text-xs leading-tight text-muted-foreground"
              >
                {parte}
              </li>
            ))}
          </ul>
        );
      })}
    </div>
  );
}

/** O selo "IA" de quem sugere: ícone e texto em tinta sobre o fundo azul claro. */
export function SeloIA({ children = 'IA' }: { children?: ReactNode }) {
  return (
    <span className={cn('inline-flex h-6 items-center gap-1 rounded-full px-2 text-[11px] font-semibold', FUNDO_DA_IA)}>
      <Sparkles className="size-3" aria-hidden="true" />
      {children}
    </span>
  );
}

/**
 * O cartão de um gráfico: o título é a CONCLUSÃO (uma frase com os números), o
 * subtítulo diz o que está desenhado, e `extra` leva a legenda à direita. Mesmo
 * respiro em todo cartão, borda hairline (no escuro é ela que desenha o contorno;
 * a sombra some no fundo petróleo).
 */
export function Cartao({
  titulo,
  sub,
  extra,
  ajuda,
  secao,
  children,
  className,
  grande = false,
}: {
  titulo: ReactNode;
  sub?: ReactNode;
  extra?: ReactNode;
  /**
   * O "como esta conta é feita": abre num ⓘ ao lado do título (mouse, foco e toque),
   * para o subtítulo ficar numa linha só.
   */
  ajuda?: ReactNode;
  /** Vira `data-secao`: o nome da seção para o print e para os testes. */
  secao?: string;
  children: ReactNode;
  className?: string;
  /** O título de 17px dos cartões que abrem uma seção. */
  grande?: boolean;
}) {
  const id = useId();
  return (
    <section
      aria-labelledby={id}
      data-secao={secao}
      className={cn(
        'sombra-base flex min-w-0 flex-col gap-4 rounded-xl border border-hairline bg-card p-4 md:p-5 xl:p-6',
        className,
      )}
    >
      <header className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2.5">
        <div className="flex min-w-0 flex-col gap-1">
          <h3
            id={id}
            className={cn(
              'leading-snug font-semibold tracking-[-0.01em] text-balance',
              grande ? 'text-[17px]' : 'text-[15px]',
            )}
          >
            {titulo}
            {ajuda ? <AjudaDoCartao texto={ajuda} /> : null}
          </h3>
          {sub ? <p className="text-xs leading-relaxed text-muted-foreground">{sub}</p> : null}
        </div>
        {extra}
      </header>
      {children}
    </section>
  );
}

/**
 * O ⓘ do título: um botão de verdade (foco e toque), com a explicação na dica. O
 * círculo é pequeno e discreto, mas o alvo cresce por um pseudo-elemento: 46px no
 * celular (a regra dos 44px de toque) sem empurrar o título.
 */
export function AjudaDoCartao({ texto }: { texto: ReactNode }) {
  return (
    <Dica texto={texto}>
      <button
        type="button"
        aria-label="Como esta conta é feita"
        className="relative ml-1.5 inline-flex size-[18px] translate-y-[-1px] items-center justify-center rounded-full align-middle text-muted-foreground/80 transition-colors after:absolute after:-inset-3.5 after:content-[''] hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none data-[state=delayed-open]:bg-muted data-[state=delayed-open]:text-foreground data-[state=instant-open]:bg-muted data-[state=instant-open]:text-foreground md:after:-inset-1.5"
      >
        <Info className="size-3.5" strokeWidth={1.75} aria-hidden="true" />
      </button>
    </Dica>
  );
}

/** A frase de rodapé de um cartão (o "como ler" ou o "→ o que fazer"). */
export function Rodape({ children, acao = false }: { children: ReactNode; acao?: boolean }) {
  return (
    <p
      className={cn(
        'text-xs leading-relaxed',
        acao ? 'border-t border-hairline pt-3 font-semibold' : 'text-muted-foreground',
      )}
    >
      {children}
    </p>
  );
}

/** O link "Ver…" que troca de aba sem sair da tela. */
export function IrPara({ aoClicar, children }: { aoClicar: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={aoClicar}
      className="toque group/ir mt-auto inline-flex min-h-11 items-center gap-1 self-start rounded-md text-[13px] font-semibold underline-offset-4 hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none md:min-h-9"
    >
      {children}
      <ChevronRight className="size-4 transition-transform group-hover/ir:translate-x-0.5" aria-hidden="true" />
    </button>
  );
}

/** O texto do vazio dentro de um cartão: diz por quê, sem quebrar o desenho. */
export function SemDado({ children }: { children: ReactNode }) {
  return <p className="py-2 text-[13px] leading-relaxed text-muted-foreground">{children}</p>;
}

/** As colunas da fila de números, pelo tamanho da fila (a mesma conta no esqueleto). */
function colunasDaFila(colunas: number): string {
  return cn(
    'grid grid-cols-2 gap-3 md:gap-4',
    colunas === 4 && 'lg:grid-cols-4',
    colunas === 5 && 'sm:grid-cols-3 lg:grid-cols-5',
    colunas >= 6 && 'sm:grid-cols-3 xl:grid-cols-6',
    colunas < 4 && 'sm:grid-cols-3',
  );
}

/** O esqueleto da aba: a fila de números e dois cartões, na forma do que vem. */
export function EsqueletoVende({ tiras = 6 }: { tiras?: number }) {
  return (
    <div aria-busy="true" aria-live="polite" className="flex flex-col gap-4">
      <span className="sr-only">Carregando o relatório.</span>
      <div className={colunasDaFila(tiras)}>
        {Array.from({ length: tiras }, (_, i) => (
          <div key={i} className="sombra-base flex flex-col gap-3 rounded-xl border border-hairline bg-card p-4 md:p-5">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-7 w-16" />
            <Skeleton className="mt-1 h-6 w-full opacity-60" />
            <Skeleton className="h-3 w-20" />
          </div>
        ))}
      </div>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        {[0, 1].map((i) => (
          <div
            key={i}
            className="sombra-base flex flex-col gap-4 rounded-xl border border-hairline bg-card p-4 md:p-5 xl:p-6"
          >
            <div className="flex flex-col gap-2">
              <Skeleton className="h-4 w-2/3" />
              <Skeleton className="h-3 w-1/2" />
            </div>
            <div className="flex h-36 items-end justify-around gap-2 border-b border-hairline pb-px">
              {[46, 62, 38, 70, 55, 80, 64].map((a, c) => (
                <Skeleton key={c} className="w-full max-w-8 rounded-b-none opacity-70" style={{ height: `${a}%` }} />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Números
// ---------------------------------------------------------------------------

const TOM_DO_DELTA = {
  bom: 'text-cliente-texto',
  ruim: 'text-quente-texto',
  neutro: 'text-muted-foreground',
} as const;

/** O fundo da pílula: o "fundo" de 12% da própria cor, com o texto já medido sobre ele. */
const FUNDO_DO_DELTA = {
  bom: 'bg-cliente-fundo',
  ruim: 'bg-quente-fundo',
  neutro: 'bg-muted',
} as const;

/** "▲ 23%" vira seta para cima + "23%"; "= igual" vira traço + "igual". */
function partesDoDelta(texto: string): { seta: 'sobe' | 'desce' | 'igual' | null; valor: string } {
  const t = texto.trim();
  if (t.startsWith('▲')) return { seta: 'sobe', valor: t.slice(1).trim() };
  if (t.startsWith('▼')) return { seta: 'desce', valor: t.slice(1).trim() };
  if (t.startsWith('=')) return { seta: 'igual', valor: t.slice(1).trim() };
  return { seta: null, valor: t };
}

/**
 * O delta: seta + valor + a leitura por extenso (o bom e o ruim não ficam só na cor).
 * `forma="pilula"` põe o mesmo texto numa pílula com o fundo do tom (o jeito dos
 * números do topo); o padrão é o texto solto, para caber numa frase.
 */
export function TextoDoDelta({
  delta,
  className,
  forma = 'texto',
}: {
  delta: Delta | null;
  className?: string;
  forma?: 'texto' | 'pilula';
}) {
  if (!delta) return null;
  const { seta, valor } = partesDoDelta(delta.texto);
  const Icone = seta === 'sobe' ? ArrowUpRight : seta === 'desce' ? ArrowDownRight : seta === 'igual' ? Minus : null;
  return (
    <span
      className={cn(
        'numerico inline-flex items-center gap-0.5 font-semibold whitespace-nowrap',
        TOM_DO_DELTA[delta.tom],
        forma === 'pilula' ? cn('h-[22px] rounded-full pr-2 pl-1.5 text-[11px]', FUNDO_DO_DELTA[delta.tom]) : 'text-xs',
        className,
      )}
    >
      <span aria-hidden="true" className="inline-flex items-center gap-0.5">
        {Icone ? <Icone className="size-3.5 shrink-0" strokeWidth={2.25} /> : null}
        {valor}
      </span>
      <span className="sr-only">{delta.leitura}</span>
    </span>
  );
}

/**
 * Um número do topo da aba: o rótulo pequeno em cinza, o valor grande em tinta com o
 * delta em pílula ao lado, a linha das 12 semanas e o apoio embaixo. A linha e o apoio
 * descem para o pé do cartão: numa fila, todos os apoios ficam na mesma altura.
 */
export function TiraKpi({
  rotulo,
  valor,
  delta,
  serie,
  apoio,
}: {
  rotulo: string;
  valor: string;
  delta?: Delta | null;
  /** Até 12 semanas; as 4 últimas em tinta, o resto em cinza. */
  serie?: readonly (number | null)[];
  apoio?: ReactNode;
}) {
  return (
    <div className="sombra-base flex min-w-0 flex-col gap-2.5 rounded-xl border border-hairline bg-card p-4 md:p-5">
      <dt className="text-xs leading-tight font-medium text-muted-foreground">{rotulo}</dt>
      <dd className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
        {/* Um código de imóvel ("TE0002_IMOVA") não cabe em 28px num cartão de meia
            tela: o valor longo desce um degrau e pode quebrar em qualquer ponto. */}
        <span
          className={cn(
            'numerico min-w-0 leading-none font-medium tracking-[-0.025em] [overflow-wrap:anywhere]',
            valor.length > 9 ? 'text-lg md:text-xl' : 'text-[28px] md:text-[30px]',
          )}
        >
          {valor}
        </span>
        <TextoDoDelta delta={delta ?? null} forma="pilula" />
      </dd>
      {serie ? (
        <dd aria-hidden="true" className="mt-auto pt-1.5">
          <Sparkline valores={serie} />
        </dd>
      ) : null}
      {apoio ? (
        <dd className={cn('text-[11px] leading-snug text-muted-foreground', !serie && 'mt-auto pt-1')}>{apoio}</dd>
      ) : null}
    </div>
  );
}

/** A fila de números do topo. Duas colunas no celular. */
export function FilaDeKpis({ children, colunas = 6 }: { children: ReactNode; colunas?: 4 | 5 | 6 }) {
  return <dl className={colunasDaFila(colunas)}>{children}</dl>;
}

/** Um quadrinho de número dentro de um cartão (a conta da meta, o funil do anúncio). */
export function Quadrinho({
  numero,
  texto,
  apoio,
  className,
}: {
  numero: ReactNode;
  texto: ReactNode;
  apoio?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex min-w-0 flex-col gap-1.5 rounded-lg bg-muted/70 px-3 py-3', className)}>
      <span className="numerico text-xl leading-none font-medium tracking-[-0.02em]">{numero}</span>
      <span className="text-[11px] leading-snug text-muted-foreground">{texto}</span>
      {apoio}
    </div>
  );
}

/**
 * A nota na régua de 1 a 5, quando ainda não há duas semanas para uma linha (linha
 * com um ponto só não é gráfico). É uma POSIÇÃO numa escala que não começa no zero,
 * por isso um ponto no trilho, e não uma barra que encheria a partir de um zero que
 * não existe. Veio do número do topo do Progresso da IA (`ia/numeros.tsx`) e serve
 * também ao cartão da IA na Visão geral. Decorativa: o valor vai escrito ao lado.
 */
export function ReguaDaNota({ nota }: { nota: number }) {
  const posicao = Math.max(0, Math.min(1, (nota - 1) / 4));
  return (
    <span aria-hidden="true" className="numerico flex items-center gap-2 text-[11px] text-muted-foreground">
      <span>1</span>
      <span className="relative block h-1.5 flex-1 rounded-full bg-(--vende-azul)/15 dark:bg-(--vende-azul)/25">
        <span
          className="absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-(--vende-azul) ring-2 ring-card"
          style={{ left: `${(posicao * 100).toFixed(2)}%` }}
        />
      </span>
      <span>5</span>
    </span>
  );
}

// ---------------------------------------------------------------------------
// Legenda e dica
// ---------------------------------------------------------------------------

export type ItemDaLegenda = {
  rotulo: ReactNode;
  cor?: Cor;
  forma?: 'quadrado' | 'traco' | 'linha' | 'tracejado' | 'circulo' | 'circulo-vazio';
};

export function Legenda({ itens, className }: { itens: readonly ItemDaLegenda[]; className?: string }) {
  return (
    <ul className={cn('flex flex-wrap gap-x-3.5 gap-y-1 text-xs text-muted-foreground', className)}>
      {itens.map((item, i) => (
        <li key={i} className="inline-flex items-center gap-1.5">
          <Amostra cor={item.cor ?? 'tinta'} forma={item.forma ?? 'quadrado'} />
          {item.rotulo}
        </li>
      ))}
    </ul>
  );
}

/** A legenda dos três níveis de interesse (as barras de imóveis). */
export function LegendaDoInteresse() {
  return (
    <Legenda
      itens={[
        { rotulo: 'Muito interessado', cor: 'muito' },
        { rotulo: 'Interessado', cor: 'interessado' },
        { rotulo: 'Morno', cor: 'morno' },
      ]}
    />
  );
}

function Amostra({ cor, forma }: { cor: Cor; forma: NonNullable<ItemDaLegenda['forma']> }) {
  switch (forma) {
    case 'traco':
      return <span aria-hidden="true" className={cn('h-3 w-0.5 rounded-full', COR[cor])} />;
    case 'linha':
      return <span aria-hidden="true" className={cn('h-0.5 w-3.5 rounded-full', COR[cor])} />;
    case 'tracejado':
      return <span aria-hidden="true" className="w-3.5 border-t-[1.5px] border-dashed border-(--vende-traco)" />;
    case 'circulo':
      return <span aria-hidden="true" className={cn('size-2 rounded-full', COR[cor])} />;
    case 'circulo-vazio':
      return <span aria-hidden="true" className="size-2 rounded-full border-[1.5px] border-(--vende-traco) bg-card" />;
    default:
      return <span aria-hidden="true" className={cn('size-2.5 rounded-[3px]', COR[cor])} />;
  }
}

/**
 * A dica de um gráfico: abre no mouse e no foco. `children` é o alvo (um botão do
 * tamanho da coluna ou da linha, maior que a marca), que já leva o `aria-label`.
 *
 * O foco do teclado num alvo fora da tela faz o navegador rolar até ele, e o Radix
 * fecha a dica em TODA rolagem que contém o alvo: com Tab, a dica de quem estava
 * abaixo da dobra abria e fechava no mesmo instante (revisão de 16/11/2026). Por
 * isso, logo depois do foco e enquanto o alvo continua focado, o pedido de fechar é
 * ignorado; sair do alvo, rolar depois disso ou passar o mouse fora fecha como antes.
 */
export function Dica({ texto, children, lado = 'top' }: { texto: ReactNode; children: ReactElement; lado?: 'top' | 'bottom' | 'left' | 'right' }) {
  const [aberta, setAberta] = useState(false);
  const foco = useRef<{ alvo: EventTarget | null; em: number }>({ alvo: null, em: 0 });
  return (
    <Tooltip
      open={aberta}
      onOpenChange={(abrir) => {
        const recemFocado =
          foco.current.alvo !== null &&
          document.activeElement === foco.current.alvo &&
          performance.now() - foco.current.em < 700;
        if (!abrir && recemFocado) return;
        setAberta(abrir);
      }}
    >
      <TooltipTrigger
        asChild
        onFocus={(e) => {
          foco.current = { alvo: e.currentTarget, em: performance.now() };
        }}
        onBlur={() => {
          foco.current = { alvo: null, em: 0 };
        }}
      >
        {children}
      </TooltipTrigger>
      <TooltipContent side={lado} sideOffset={6} className="max-w-[18rem] text-left leading-snug">
        {texto}
      </TooltipContent>
    </Tooltip>
  );
}

/** O botão-alvo de uma marca: invisível, focável, com o anel de foco do sistema. */
export const ALVO =
  'cursor-default rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card';

// ---------------------------------------------------------------------------
// Barras
// ---------------------------------------------------------------------------

/**
 * Barra horizontal, ancorada à esquerda, com a ponta do dado arredondada (4px). O
 * `marcador` (de 0 a 1) é o traço de referência: o período anterior ou a média.
 * `trilho` desenha o fundo inteiro bem claro, para ler a barra como parte do todo.
 */
export function Barra({
  valor,
  maximo,
  cor = 'tinta',
  marcador,
  altura = 'h-3',
  className,
  trilho = false,
}: {
  valor: number | null;
  maximo: number;
  cor?: Cor;
  marcador?: number | null;
  altura?: string;
  className?: string;
  /** O fundo inteiro da régua em cinza bem claro (para porcentagem de um todo). */
  trilho?: boolean;
}) {
  const f = fracao(valor, maximo);
  const m = marcador === null || marcador === undefined ? null : Math.max(0, Math.min(1, marcador));
  return (
    <span aria-hidden="true" className={cn('relative block w-full', altura, className)}>
      {trilho ? <span className="absolute inset-0 rounded-r-[4px] bg-(--vende-grade)" /> : null}
      {f > 0 ? (
        <span
          className={cn('absolute inset-y-0 left-0 min-w-0.5 rounded-r-[4px]', COR[cor])}
          style={{ width: `${(f * 100).toFixed(2)}%` }}
        />
      ) : null}
      {m !== null ? (
        <span
          className="absolute -top-[3px] -bottom-[3px] w-0.5 -translate-x-1/2 rounded-full bg-(--vende-traco)"
          style={{ left: `${(m * 100).toFixed(2)}%` }}
        />
      ) : null}
    </span>
  );
}

/**
 * Barra empilhada horizontal: os segmentos da esquerda para a direita, com 2px de vão
 * e a ponta do dado (a direita do último) arredondada. A largura total é a do maior
 * valor da lista (`maximo`), para as linhas se compararem.
 */
export function BarraEmpilhada({
  segmentos,
  maximo,
  altura = 'h-3',
  className,
  trilho = false,
}: {
  segmentos: readonly { valor: number; cor: Cor }[];
  maximo: number;
  altura?: string;
  className?: string;
  /** O fundo inteiro da régua em cinza bem claro. */
  trilho?: boolean;
}) {
  const visiveis = segmentos.filter((s) => s.valor > 0);
  const total = visiveis.reduce((s, x) => s + x.valor, 0);
  const f = fracao(total, maximo);
  return (
    <span aria-hidden="true" className={cn('relative block w-full', altura, className)}>
      {trilho ? <span className="absolute inset-0 rounded-r-[4px] bg-(--vende-grade)" /> : null}
      {f > 0 ? (
        <span
          className="absolute inset-y-0 left-0 flex min-w-0.5 gap-0.5 overflow-hidden rounded-r-[4px]"
          style={{ width: `${(f * 100).toFixed(2)}%` }}
        >
          {visiveis.map((s, i) => (
            <span key={i} className={cn('h-full min-w-px', COR[s.cor])} style={{ flex: `${s.valor} 1 0` }} />
          ))}
        </span>
      ) : (
        <span className="absolute inset-y-0 left-0 w-0.5 rounded-r-[2px] bg-(--vende-resto)" />
      )}
    </span>
  );
}

/** A barrinha de calor (0 a 100) de um lead, na cor do nível. */
export function BarraDeCalor({ calor, cor }: { calor: number | null; cor: Cor }) {
  const f = fracao(calor, 100);
  return (
    <span aria-hidden="true" className="relative block h-1.5 w-14 shrink-0 overflow-hidden rounded-full bg-muted md:w-16">
      <span className={cn('absolute inset-y-0 left-0 rounded-full', COR[cor])} style={{ width: `${f * 100}%` }} />
    </span>
  );
}

// ---------------------------------------------------------------------------
// Colunas
// ---------------------------------------------------------------------------

export type Coluna = {
  chave: string;
  valor: number | null;
  /** O número escrito em cima da coluna (opcional). */
  rotulo?: string;
  /** O rótulo embaixo (eixo x). */
  eixo?: string;
  dica: ReactNode;
  /** A leitura da coluna para o leitor de tela. */
  aria: string;
  destaque?: boolean;
  /** A anotação acima da coluna ("entrou no ar"). */
  marca?: string;
  /**
   * A semana que ainda não acabou: a coluna sai hachurada (listras na cor do cartão),
   * para ninguém tirar conclusão dela. Diga também no `eixo` ou na `dica`.
   */
  parcial?: boolean;
  /** A cor desta coluna, por cima da regra destaque × resto (ex.: `azul` para a IA). */
  cor?: Cor;
};

/**
 * Colunas verticais, com a dica em cada uma. O alvo é a coluna inteira (da base ao
 * topo do gráfico), muito maior que a barra. A barra tem teto de largura
 * (`larguraMaxima`): com duas semanas, cada uma fica fina no meio da sua fatia, e não
 * um bloco de meia tela.
 */
export function Colunas({
  itens,
  maximo,
  altura = 'h-24',
  eixoY,
  larguraDaBarra = 'w-[70%]',
  larguraMaxima = 'max-w-8',
}: {
  itens: readonly Coluna[];
  maximo: number;
  altura?: string;
  /** As marcas do eixo y, de cima para baixo ("40%", "20%", "0"). Um eixo só. */
  eixoY?: readonly string[];
  larguraDaBarra?: string;
  /** O teto da largura da barra, como classe (`max-w-8` = 32px é o padrão). */
  larguraMaxima?: string;
}) {
  return (
    <div className="flex gap-2">
      {eixoY ? <EixoY rotulos={eixoY} altura={altura} /> : null}
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <div className={cn('relative', altura)}>
          {eixoY ? <Grade linhas={eixoY.length} /> : <span className="absolute inset-x-0 bottom-0 h-px bg-(--vende-eixo)" />}
          <div className="relative flex h-full items-end gap-0.5">
            {itens.map((c) => {
              const f = fracao(c.valor, maximo);
              return (
                <Dica key={c.chave} texto={c.dica}>
                  <button
                    type="button"
                    aria-label={c.aria}
                    className={cn(
                      ALVO,
                      'group/coluna relative flex h-full min-w-0 flex-1 flex-col items-center justify-end transition-colors hover:bg-foreground/[0.03]',
                    )}
                  >
                    {c.marca ? (
                      <span className="absolute -top-0.5 left-1/2 -translate-x-1/2 -translate-y-full text-[11px] font-semibold whitespace-nowrap">
                        {c.marca}
                      </span>
                    ) : null}
                    {c.rotulo ? (
                      <span
                        aria-hidden="true"
                        className={cn(
                          'numerico mb-1 text-[11px] leading-none',
                          c.destaque || c.cor ? 'font-semibold' : 'text-muted-foreground',
                        )}
                      >
                        {c.rotulo}
                      </span>
                    ) : null}
                    <span
                      aria-hidden="true"
                      className={cn(
                        'block rounded-t-[4px] transition-opacity group-hover/coluna:opacity-85',
                        larguraDaBarra,
                        larguraMaxima,
                        c.cor ? COR[c.cor] : c.destaque ? COR.tinta : COR.resto,
                      )}
                      style={{
                        height: f > 0 ? `${(f * (c.rotulo ? 84 : 100)).toFixed(2)}%` : '1px',
                        ...(c.parcial && f > 0 ? HACHURA_PARCIAL : null),
                      }}
                    />
                  </button>
                </Dica>
              );
            })}
          </div>
        </div>
        {itens.some((c) => c.eixo) ? (
          <div aria-hidden="true" className="flex gap-0.5">
            {itens.map((c, i) => (
              <span
                key={c.chave}
                className={cn(
                  'numerico min-w-0 flex-1 text-[11px] leading-tight text-muted-foreground',
                  pontaDoEixo(i, itens.length),
                )}
              >
                {c.eixo ?? ''}
              </span>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}

/**
 * O rótulo do eixo x de cada fatia. As pontas (a primeira e a última data) saem da
 * fatia para DENTRO do gráfico em vez de cortar ou vazar do cartão: a última é uma
 * linha flexível alinhada ao fim, que transborda para a esquerda ("esta (parcial)"
 * cabe mesmo numa fatia estreita); o meio fica centrado e corta com reticências.
 */
function pontaDoEixo(i: number, total: number): string {
  if (total > 2 && i === 0) return 'text-left whitespace-nowrap';
  if (total > 2 && i === total - 1) return 'flex justify-end whitespace-nowrap';
  return 'truncate text-center';
}

function EixoY({ rotulos, altura }: { rotulos: readonly string[]; altura: string }) {
  return (
    <div
      aria-hidden="true"
      className={cn(
        'numerico flex w-8 shrink-0 flex-col justify-between text-right text-[11px] text-muted-foreground',
        altura,
      )}
    >
      {rotulos.map((r, i) => (
        <span
          key={i}
          className={cn('leading-none', i === rotulos.length - 1 ? 'translate-y-1/2' : '-translate-y-1/2')}
        >
          {r}
        </span>
      ))}
    </div>
  );
}

/** As linhas de grade, quase invisíveis; a de baixo um degrau mais forte: é a base. */
function Grade({ linhas }: { linhas: number }) {
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 flex flex-col justify-between">
      {Array.from({ length: linhas }, (_, i) => (
        <span key={i} className={cn('h-px', i === linhas - 1 ? 'bg-(--vende-eixo)' : 'bg-(--vende-grade)')} />
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Linhas
// ---------------------------------------------------------------------------

type Ponto = { x: number; y: number };

/** Os trechos contínuos de uma série, como listas de pontos (para a área embaixo). */
function trechosEmPontos(pontos: readonly (Ponto | null)[]): Ponto[][] {
  const trechos: Ponto[][] = [];
  let atual: Ponto[] = [];
  for (const p of pontos) {
    if (p) {
      atual.push(p);
    } else if (atual.length > 0) {
      trechos.push(atual);
      atual = [];
    }
  }
  if (atual.length > 0) trechos.push(atual);
  return trechos;
}

/** O polígono da área embaixo de um trecho, fechado na base (y = 100). */
function poligonoDaArea(trecho: readonly Ponto[]): string {
  const primeiro = trecho[0];
  const ultimo = trecho[trecho.length - 1];
  if (!primeiro || !ultimo) return '';
  const linha = trecho.map((p) => `${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(' ');
  return `${linha} ${ultimo.x.toFixed(2)},100 ${primeiro.x.toFixed(2)},100`;
}

/** O degradê vertical da área: a cor da série bem fraca no alto, nada na base. */
function DegradeDaArea({ id, cor, forca = 0.2 }: { id: string; cor: string; forca?: number }) {
  return (
    <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" style={{ stopColor: cor, stopOpacity: forca }} />
      <stop offset="1" style={{ stopColor: cor, stopOpacity: 0 }} />
    </linearGradient>
  );
}

/**
 * A linha das 12 semanas de um número: as 4 últimas em tinta (com uma área bem fraca
 * embaixo e o ponto do fim), as de antes em cinza. Com menos de 2 pontos não há linha:
 * fica só o espaço, para a fila de números não desalinhar.
 */
export function Sparkline({
  valores,
  area = true,
  ultimaParcial = false,
}: {
  valores: readonly (number | null)[];
  /** A área bem fraca embaixo das 4 últimas semanas (ligada por padrão). */
  area?: boolean;
  /** A última semana ainda não acabou: o último trecho sai tracejado e o ponto, vazado. */
  ultimaParcial?: boolean;
}) {
  const id = idDeSvg(useId());
  const bons = valores.filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
  if (bons.length < 2) return <span aria-hidden="true" className="block h-7" />;
  const min = Math.min(...bons);
  const max = Math.max(...bons);
  const pontos = pontosDaLinha(valores, [min, max === min ? min + 1 : max]).map((p) =>
    p ? { x: p.x, y: 8 + (p.y / 100) * 84 } : null,
  );
  const n = valores.length;
  const corte = Math.max(0, n - 4);
  // O pedaço que chega na semana parcial: [penúltimo, último], só se os dois existem.
  const penultimo = pontos[n - 2];
  const derradeiro = pontos[n - 1];
  const parcial = ultimaParcial && penultimo && derradeiro ? ([penultimo, derradeiro] as const) : null;
  const antes = trechosDaLinha(pontos.slice(0, corte + 1));
  const agoraPontos = pontos.map((p, i) => (i >= corte ? p : null));
  const agora = trechosDaLinha(parcial ? agoraPontos.slice(0, n - 1) : agoraPontos);
  const ultimo = [...pontos].reverse().find((p): p is Ponto => p !== null);
  const traco = {
    fill: 'none',
    strokeWidth: 1.5,
    strokeLinejoin: 'round' as const,
    strokeLinecap: 'round' as const,
    vectorEffect: 'non-scaling-stroke' as const,
  };
  return (
    <span aria-hidden="true" className="relative block h-7 w-full">
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 h-full w-full overflow-visible">
        {area ? (
          <>
            <defs>
              <DegradeDaArea id={id} cor="var(--vende-tinta)" forca={0.16} />
            </defs>
            {trechosEmPontos(agoraPontos)
              .filter((t) => t.length > 1)
              .map((t, i) => (
                <polygon key={`r${i}`} points={poligonoDaArea(t)} fill={`url(#${id})`} />
              ))}
          </>
        ) : null}
        {antes.map((t, i) => (
          <polyline key={`a${i}`} points={t} className="stroke-(--vende-resto)" {...traco} />
        ))}
        {agora.map((t, i) => (
          <polyline key={`b${i}`} points={t} className="stroke-(--vende-tinta)" {...traco} />
        ))}
        {parcial ? (
          <polyline
            points={parcial.map((p) => `${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(' ')}
            className="stroke-(--vende-tinta)"
            strokeDasharray="3 3"
            {...traco}
          />
        ) : null}
      </svg>
      {ultimo ? (
        <span
          className={cn(
            'absolute size-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-card',
            parcial ? 'border border-(--vende-tinta) bg-card' : 'bg-(--vende-tinta)',
          )}
          style={{ left: `${ultimo.x.toFixed(2)}%`, top: `${ultimo.y.toFixed(2)}%` }}
        />
      ) : null}
    </span>
  );
}

export type PontoDaLinha = { dica: ReactNode; aria: string };

/**
 * Uma série no tempo, em SVG, com um eixo só. Buracos (semana sem dado) quebram a
 * linha. Cada ponto tem um alvo da largura da sua fatia, com a dica no mouse e no
 * foco (e um fio vertical marcando a semana). `marcas` são as versões (traço vertical
 * tracejado fino; duas versões na mesma semana viram uma marca só).
 */
export function Linha({
  valores,
  dominio,
  altura = 'h-36',
  cor = 'azul',
  pontos,
  eixoY,
  marcas = [],
  pontas = false,
  rotuloDoFim,
  area = false,
  ultimaParcial = false,
}: {
  valores: readonly (number | null)[];
  dominio: readonly [number, number];
  altura?: string;
  cor?: 'azul' | 'tinta';
  /** Um por valor: a dica e a leitura de cada semana. */
  pontos?: readonly PontoDaLinha[];
  eixoY?: readonly string[];
  marcas?: readonly { indice: number; rotulo?: string }[];
  /** Ponto vazio no começo e cheio no fim, como nos múltiplos pequenos. */
  pontas?: boolean;
  /** O número escrito ao lado do último ponto. */
  rotuloDoFim?: string;
  /** Preenche embaixo da linha com um degradê bem suave da cor da série. */
  area?: boolean;
  /**
   * A última semana ainda não acabou: o trecho que chega nela sai tracejado e o ponto
   * dela fica mais claro. Diga também na dica ("esta semana, parcial").
   */
  ultimaParcial?: boolean;
}) {
  const id = idDeSvg(useId());
  const coords = pontosDaLinha(valores, dominio);
  const n = valores.length;
  const parcial = ultimaParcial && n >= 2 && coords[n - 1] !== null;
  // O trecho cheio para antes da semana parcial; o pedaço que chega nela é tracejado
  // (só quando a semana de antes tem valor: senão fica o ponto sozinho, mais claro).
  const cheios = trechosDaLinha(parcial ? coords.slice(0, n - 1) : coords);
  const anterior = parcial ? coords[n - 2] : null;
  const atual = parcial ? coords[n - 1] : null;
  const passo = n > 0 ? 100 / n : 100;
  const xDe = (i: number) => (n <= 1 ? 50 : (i / (n - 1)) * 100);
  const corDaSerie = cor === 'azul' ? VARIAVEL_DA_COR.azul : VARIAVEL_DA_COR.tinta;
  const traco = cor === 'azul' ? 'stroke-(--vende-azul)' : 'stroke-(--vende-tinta)';
  const ponto = cor === 'azul' ? COR.azul : COR.tinta;
  const bordaVazia = cor === 'azul' ? 'border-(--vende-azul)' : 'border-(--vende-tinta)';
  const indicesValidos = coords.flatMap((c, i) => (c ? [i] : []));
  const primeiro = indicesValidos[0];
  const ultimo = indicesValidos[indicesValidos.length - 1];
  // Duas versões na mesma semana: uma marca só, com os rótulos juntos (e chave única).
  const marcasUnicas = [...new Set(marcas.map((m) => m.indice))].map((indice) => ({
    indice,
    rotulo: marcas
      .filter((m) => m.indice === indice && m.rotulo)
      .map((m) => m.rotulo)
      .join(' · '),
  }));
  const tracoSvg = {
    fill: 'none',
    strokeWidth: 2,
    strokeLinejoin: 'round' as const,
    strokeLinecap: 'round' as const,
    vectorEffect: 'non-scaling-stroke' as const,
  };

  return (
    <div className="flex gap-2">
      {eixoY ? <EixoY rotulos={eixoY} altura={altura} /> : null}
      <div className={cn('relative min-w-0 flex-1', altura, rotuloDoFim && 'mr-10')}>
        {eixoY ? <Grade linhas={eixoY.length} /> : null}
        {marcasUnicas.map((m) => (
          <span
            key={`m${m.indice}`}
            aria-hidden="true"
            className="absolute inset-y-0 border-l border-dashed border-(--vende-traco)"
            style={{ left: `${xDe(m.indice).toFixed(2)}%` }}
          >
            {m.rotulo ? (
              <span className="absolute top-0 left-1 bg-card pr-1 text-[11px] leading-none whitespace-nowrap text-muted-foreground">
                {m.rotulo}
              </span>
            ) : null}
          </span>
        ))}
        <svg aria-hidden="true" viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 h-full w-full overflow-visible">
          {area ? (
            <>
              <defs>
                <DegradeDaArea id={id} cor={corDaSerie} />
              </defs>
              {trechosEmPontos(coords)
                .filter((t) => t.length > 1)
                .map((t, i) => (
                  <polygon key={`r${i}`} points={poligonoDaArea(t)} fill={`url(#${id})`} />
                ))}
            </>
          ) : null}
          {cheios.map((t, i) => (
            <polyline key={i} points={t} className={traco} {...tracoSvg} />
          ))}
          {anterior && atual ? (
            <polyline
              points={`${anterior.x.toFixed(2)},${anterior.y.toFixed(2)} ${atual.x.toFixed(2)},${atual.y.toFixed(2)}`}
              className={traco}
              strokeDasharray="4 4"
              {...tracoSvg}
            />
          ) : null}
        </svg>
        {coords.map((c, i) => {
          if (!c) return null;
          const fim = i === ultimo;
          const vazio = pontas && i === primeiro && i !== ultimo;
          const visivel = !pontas || i === primeiro || fim;
          const daParcial = parcial && i === n - 1;
          const marca = (
            <span
              aria-hidden="true"
              className={cn(
                'absolute left-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full',
                fim ? 'size-2.5' : 'size-2',
                vazio ? cn('border-[1.5px] bg-card', bordaVazia) : cn(ponto, 'ring-2 ring-card'),
                daParcial && 'opacity-55',
                !visivel && 'opacity-0 group-hover/ponto:opacity-100 group-focus-visible/ponto:opacity-100',
              )}
              style={{ top: `${c.y.toFixed(2)}%` }}
            />
          );
          const alvo = pontos?.[i];
          // O alvo é a fatia do ponto, cortada nas bordas para nada vazar do cartão.
          const esquerda = Math.max(0, xDe(i) - passo / 2);
          const largura = Math.min(100, xDe(i) + passo / 2) - esquerda;
          return alvo ? (
            <Dica key={i} texto={alvo.dica}>
              <button
                type="button"
                aria-label={alvo.aria}
                className={cn(ALVO, 'group/ponto absolute inset-y-0')}
                style={{ left: `${esquerda.toFixed(2)}%`, width: `${largura.toFixed(2)}%` }}
              >
                <span
                  className="absolute inset-y-0"
                  style={{ left: `${(largura > 0 ? ((xDe(i) - esquerda) / largura) * 100 : 50).toFixed(2)}%` }}
                >
                  {/* O fio da semana: aparece no mouse e no foco, como numa régua. */}
                  <span
                    aria-hidden="true"
                    className="absolute inset-y-0 w-px -translate-x-1/2 bg-(--vende-traco) opacity-0 transition-opacity group-hover/ponto:opacity-40 group-focus-visible/ponto:opacity-40"
                  />
                  {marca}
                </span>
              </button>
            </Dica>
          ) : (
            <span key={i} className="absolute inset-y-0" style={{ left: `${xDe(i).toFixed(2)}%` }}>
              {marca}
            </span>
          );
        })}
        {/* O número do fim só fica ao lado da linha quando o último ponto é a última
            semana; senão ele flutuaria longe do ponto (a dica continua dizendo). */}
        {rotuloDoFim && ultimo !== undefined && ultimo === n - 1 && coords[ultimo] ? (
          <span
            aria-hidden="true"
            className="numerico absolute left-full ml-2.5 -translate-y-1/2 text-[13px] font-semibold whitespace-nowrap"
            style={{ top: `${coords[ultimo]?.y.toFixed(2)}%` }}
          >
            {rotuloDoFim}
          </span>
        ) : null}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Haltere e placar
// ---------------------------------------------------------------------------

/**
 * Haltere: o "antes" (círculo vazio) e o "depois" (cheio) na mesma régua, ligados
 * por um traço. Os números ficam do lado de fora de cada ponta.
 */
export function Haltere({
  de,
  ate,
  maximo,
  rotuloDe,
  rotuloAte,
}: {
  de: number | null;
  ate: number | null;
  maximo: number;
  rotuloDe: string;
  rotuloAte: string;
}) {
  const a = de === null ? null : fracao(de, maximo) * 100;
  const b = ate === null ? null : fracao(ate, maximo) * 100;
  const menor = a !== null && b !== null ? Math.min(a, b) : null;
  const maior = a !== null && b !== null ? Math.max(a, b) : null;
  return (
    <span aria-hidden="true" className="relative mx-9 block h-6">
      <span className="absolute inset-x-0 top-1/2 h-px bg-(--vende-grade)" />
      {menor !== null && maior !== null ? (
        <span
          className="absolute top-1/2 h-0.5 -translate-y-1/2 rounded-full bg-(--vende-resto)"
          style={{ left: `${menor}%`, width: `${maior - menor}%` }}
        />
      ) : null}
      {a !== null ? (
        <>
          <span
            className="absolute top-1/2 size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-[1.5px] border-(--vende-traco) bg-card"
            style={{ left: `${a}%` }}
          />
          <span
            className={cn(
              'numerico absolute top-1/2 -translate-y-1/2 text-[11px] text-muted-foreground',
              b !== null && b < a ? 'ml-2' : '-translate-x-full pr-2',
            )}
            style={{ left: `${a}%` }}
          >
            {rotuloDe}
          </span>
        </>
      ) : null}
      {b !== null ? (
        <>
          <span
            className="absolute top-1/2 size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-(--vende-tinta) ring-2 ring-card"
            style={{ left: `${b}%` }}
          />
          <span
            className={cn(
              'numerico absolute top-1/2 -translate-y-1/2 text-xs font-semibold',
              a !== null && b < a ? '-translate-x-full pr-2.5' : 'ml-2.5',
            )}
            style={{ left: `${b}%` }}
          >
            {rotuloAte}
          </span>
        </>
      ) : null}
    </span>
  );
}

/**
 * O placar do mês: os fechados em tinta, a previsão em cinza por cima do trilho, a
 * faixa provável (bigode) e o traço da meta. Um eixo só, em negócios.
 */
export function PlacarDaMeta({
  fechados,
  esperado,
  faixa,
  meta,
  escala,
  ticks = false,
}: {
  fechados: number;
  esperado: number;
  faixa?: readonly [number, number] | null;
  meta: number | null;
  escala: number;
  ticks?: boolean;
}) {
  const pos = (v: number) => `${(fracao(v, escala) * 100).toFixed(2)}%`;
  return (
    <div className="flex flex-col gap-1">
      <div aria-hidden="true" className={cn('relative', meta !== null ? 'h-12 pt-4' : 'h-8')}>
        <span className="absolute inset-x-0 bottom-2 h-3 rounded-[4px] bg-(--vende-grade)" />
        {esperado > 0 ? (
          <span className="absolute bottom-2 left-0 h-3 rounded-r-[4px] bg-(--vende-resto)" style={{ width: pos(esperado) }} />
        ) : null}
        {fechados > 0 ? (
          <span
            className="absolute bottom-2 left-0 h-3 rounded-r-[4px] bg-(--vende-tinta) shadow-[2px_0_0_var(--card)]"
            style={{ width: pos(fechados) }}
          />
        ) : null}
        {faixa ? (
          <>
            <span className="absolute bottom-[13px] h-px bg-(--vende-traco)" style={{ left: pos(faixa[0]), width: `calc(${pos(faixa[1])} - ${pos(faixa[0])})` }} />
            <span className="absolute bottom-[8px] h-3 w-px bg-(--vende-traco)" style={{ left: pos(faixa[0]) }} />
            <span className="absolute bottom-[8px] h-3 w-px -translate-x-full bg-(--vende-traco)" style={{ left: pos(faixa[1]) }} />
          </>
        ) : null}
        {meta !== null ? (
          <>
            <span className="absolute bottom-0.5 h-7 w-0.5 -translate-x-1/2 rounded-full bg-(--vende-tinta)" style={{ left: pos(meta) }} />
            <span
              className="absolute top-0 -translate-x-1/2 text-[11px] font-semibold whitespace-nowrap"
              style={{ left: `min(max(${pos(meta)}, 1.75rem), calc(100% - 1.75rem))` }}
            >
              Meta {meta}
            </span>
          </>
        ) : null}
      </div>
      {ticks ? (
        <div aria-hidden="true" className="numerico relative h-3.5 text-[11px] text-muted-foreground">
          {Array.from({ length: escala + 1 }, (_, i) => (
            <span key={i} className="absolute -translate-x-1/2" style={{ left: pos(i) }}>
              {i}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}
