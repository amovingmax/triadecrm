'use client';

import { useId, type CSSProperties, type ReactElement, type ReactNode } from 'react';
import type { UseQueryResult } from '@tanstack/react-query';
import { ChevronRight, Sparkles } from 'lucide-react';

import { cn } from '@/lib/utils';
import { Skeleton } from '@/components/ui/skeleton';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

import { mensagemDoErro } from './dados';
import { ErroDoRelatorio, VazioDoRelatorio } from './estados';
import { fracao, pontosDaLinha, trechosDaLinha, type Delta } from './formatos-vende';
import type { DefinicaoPainel } from './tipos';

/**
 * As peças de gráfico do "relatório que vende" da Imova (09/11/2026).
 *
 * Sem biblioteca: o protótipo aprovado é CSS e SVG, e é isso que vai para a tela.
 * As regras valem para todo gráfico daqui:
 *   - um eixo só (nunca dois); quando duas medidas de escala diferente aparecem
 *     juntas, cada uma tem a sua coluna, com o seu título;
 *   - cor carrega identidade e texto fica em tinta: nenhum número ou rótulo é
 *     escrito na cor da série;
 *   - destaque é a tinta forte e o resto é cinza (`--vende-resto`);
 *   - barra com ponta arredondada de 4px na ponta do dado (a base fica reta) e 2px
 *     de vão entre segmentos empilhados;
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
 */
export const PALETA_VENDE = [
  '[--vende-muito:#7f2410] [--vende-interessado:#c4512a] [--vende-morno:#ec9468]',
  '[--vende-azul:#2a78d6] [--vende-laranja:#eb6834]',
  '[--vende-subiu:#2a78d6] [--vende-igual:#dcdcd9] [--vende-caiu:#e34948]',
  '[--vende-resto:#c9c9c7] [--vende-traco:#6b6b6a]',
  'dark:[--vende-muito:#f4b08f] dark:[--vende-interessado:#e07045] dark:[--vende-morno:#a8401f]',
  'dark:[--vende-azul:#3987e5] dark:[--vende-laranja:#d95926]',
  'dark:[--vende-subiu:#3987e5] dark:[--vende-igual:#4a4a47] dark:[--vende-caiu:#e66767]',
  'dark:[--vende-resto:#4f4f4d] dark:[--vende-traco:#a3a3a2]',
].join(' ');

/** As cores por papel, como classe de fundo. */
export const COR = {
  tinta: 'bg-foreground',
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

// ---------------------------------------------------------------------------
// Molduras
// ---------------------------------------------------------------------------

/**
 * A moldura de uma aba: título e o que ela responde, a linha de apoio (o recorte, as
 * premissas) e os três estados da consulta. `children` só roda com dado na mão.
 * A função do banco que devolve `null` (a aba sem nada ainda) cai no vazio honesto,
 * e não num gráfico quebrado.
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
      <header className="flex flex-wrap items-start justify-between gap-x-6 gap-y-2">
        <div className="min-w-0 flex-1">
          <h2 id={id} className="font-heading text-lg font-semibold tracking-tight">
            {painel.titulo}
          </h2>
          <p className="mt-1 max-w-prose text-sm leading-relaxed text-muted-foreground">{painel.descricao}</p>
        </div>
        {apoio ? <div className="flex flex-col items-start gap-1 md:items-end md:pt-1">{apoio}</div> : null}
      </header>
      {consulta.isPending ? (
        <EsqueletoVende tiras={tiras} />
      ) : consulta.isError ? (
        <ErroDoRelatorio causa={mensagemDoErro(consulta.error)} aoTentar={() => void consulta.refetch()} />
      ) : consulta.data === null || consulta.data === undefined ? (
        <VazioDoRelatorio
          titulo="Este relatório ainda não tem números"
          texto="O banco não devolveu nada para esta leitura. Os números aparecem com as primeiras conversas, visitas e imóveis no ar."
        />
      ) : (
        children(consulta.data)
      )}
    </section>
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
 * subtítulo diz o que está desenhado, e `extra` leva a legenda à direita.
 */
export function Cartao({
  titulo,
  sub,
  extra,
  children,
  className,
  grande = false,
}: {
  titulo: ReactNode;
  sub?: ReactNode;
  extra?: ReactNode;
  children: ReactNode;
  className?: string;
  /** O título de 17px dos cartões que abrem uma seção. */
  grande?: boolean;
}) {
  const id = useId();
  return (
    <section
      aria-labelledby={id}
      className={cn('sombra-base flex min-w-0 flex-col gap-3.5 rounded-xl bg-card p-4 md:p-5', className)}
    >
      <header className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
        <div className="flex min-w-0 flex-col gap-0.5">
          <h3
            id={id}
            className={cn('leading-snug font-semibold text-balance', grande ? 'text-[17px]' : 'text-[15px]')}
          >
            {titulo}
          </h3>
          {sub ? <p className="text-xs leading-relaxed text-muted-foreground">{sub}</p> : null}
        </div>
        {extra}
      </header>
      {children}
    </section>
  );
}

/** A frase de rodapé de um cartão (o "como ler" ou o "→ o que fazer"). */
export function Rodape({ children, acao = false }: { children: ReactNode; acao?: boolean }) {
  return (
    <p
      className={cn(
        'text-xs leading-relaxed',
        acao ? 'border-t border-hairline pt-2.5 font-semibold' : 'text-muted-foreground',
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
      className="toque mt-auto inline-flex min-h-11 items-center gap-1 self-start rounded-md text-[13px] font-semibold underline-offset-4 hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none md:min-h-9"
    >
      {children}
      <ChevronRight className="size-4" aria-hidden="true" />
    </button>
  );
}

/** O texto do vazio dentro de um cartão: diz por quê, sem quebrar o desenho. */
export function SemDado({ children }: { children: ReactNode }) {
  return <p className="py-2 text-sm text-muted-foreground">{children}</p>;
}

/** O esqueleto da aba: a fila de números e dois cartões, na forma do que vem. */
export function EsqueletoVende({ tiras = 6 }: { tiras?: number }) {
  return (
    <div aria-busy="true" aria-live="polite" className="flex flex-col gap-4">
      <span className="sr-only">Carregando o relatório.</span>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {Array.from({ length: tiras }, (_, i) => (
          <div key={i} className="sombra-base flex flex-col gap-3 rounded-xl bg-card p-4">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-7 w-16" />
            <Skeleton className="h-3 w-20" />
          </div>
        ))}
      </div>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        {[0, 1].map((i) => (
          <div key={i} className="sombra-base flex flex-col gap-3 rounded-xl bg-card p-5">
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-3 w-1/2" />
            {Array.from({ length: 5 }, (_, l) => (
              <Skeleton key={l} className="h-4 w-full" />
            ))}
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

/** O delta: seta + valor + a leitura por extenso (o bom e o ruim não ficam só na cor). */
export function TextoDoDelta({ delta, className }: { delta: Delta | null; className?: string }) {
  if (!delta) return null;
  return (
    <span className={cn('numerico text-xs font-semibold whitespace-nowrap', TOM_DO_DELTA[delta.tom], className)}>
      <span aria-hidden="true">{delta.texto}</span>
      <span className="sr-only">{delta.leitura}</span>
    </span>
  );
}

/** Um número do topo da aba: rótulo, valor, delta, a linha das 12 semanas e o apoio. */
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
    <div className="sombra-base flex min-w-0 flex-col gap-2 rounded-xl bg-card p-4">
      <dt className="text-xs leading-tight text-muted-foreground">{rotulo}</dt>
      <dd className="flex flex-wrap items-baseline justify-between gap-x-2 gap-y-1">
        {/* Um código de imóvel ("TE0002_IMOVA") não cabe em 28px num cartão de meia
            tela: o valor longo desce um degrau e pode quebrar em qualquer ponto. */}
        <span
          className={cn(
            'numerico min-w-0 leading-none font-medium tracking-[-0.02em] [overflow-wrap:anywhere]',
            valor.length > 9 ? 'text-lg md:text-xl' : 'text-[26px] md:text-[28px]',
          )}
        >
          {valor}
        </span>
        <TextoDoDelta delta={delta ?? null} />
      </dd>
      {serie ? (
        <dd aria-hidden="true">
          <Sparkline valores={serie} />
        </dd>
      ) : null}
      {apoio ? <dd className="text-[11px] leading-snug text-muted-foreground">{apoio}</dd> : null}
    </div>
  );
}

/** A fila de números do topo. Duas colunas no celular. */
export function FilaDeKpis({ children, colunas = 6 }: { children: ReactNode; colunas?: 4 | 5 | 6 }) {
  return (
    <dl
      className={cn(
        'grid grid-cols-2 gap-3',
        colunas === 4 && 'lg:grid-cols-4',
        colunas === 5 && 'sm:grid-cols-3 lg:grid-cols-5',
        colunas === 6 && 'sm:grid-cols-3 xl:grid-cols-6',
      )}
    >
      {children}
    </dl>
  );
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
    <div className={cn('flex min-w-0 flex-col gap-1 rounded-lg bg-muted px-3 py-2.5', className)}>
      <span className="numerico text-xl leading-none font-medium">{numero}</span>
      <span className="text-[11px] leading-snug">{texto}</span>
      {apoio}
    </div>
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
      return <span aria-hidden="true" className={cn('h-3 w-0.5', COR[cor])} />;
    case 'linha':
      return <span aria-hidden="true" className={cn('h-0.5 w-3.5', COR[cor])} />;
    case 'tracejado':
      return <span aria-hidden="true" className="w-3.5 border-t-2 border-dashed border-(--vende-traco)" />;
    case 'circulo':
      return <span aria-hidden="true" className={cn('size-2.5 rounded-full', COR[cor])} />;
    case 'circulo-vazio':
      return <span aria-hidden="true" className="size-2.5 rounded-full border-2 border-(--vende-traco) bg-card" />;
    default:
      return <span aria-hidden="true" className={cn('size-2.5 rounded-[3px]', COR[cor])} />;
  }
}

/**
 * A dica de um gráfico: abre no mouse e no foco. `children` é o alvo (um botão do
 * tamanho da coluna ou da linha, maior que a marca), que já leva o `aria-label`.
 */
export function Dica({ texto, children, lado = 'top' }: { texto: ReactNode; children: ReactElement; lado?: 'top' | 'bottom' | 'left' | 'right' }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
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
 */
export function Barra({
  valor,
  maximo,
  cor = 'tinta',
  marcador,
  altura = 'h-4',
  className,
}: {
  valor: number | null;
  maximo: number;
  cor?: Cor;
  marcador?: number | null;
  altura?: string;
  className?: string;
}) {
  const f = fracao(valor, maximo);
  const m = marcador === null || marcador === undefined ? null : Math.max(0, Math.min(1, marcador));
  return (
    <span aria-hidden="true" className={cn('relative block w-full', altura, className)}>
      {f > 0 ? (
        <span
          className={cn('absolute inset-y-0 left-0 min-w-0.5 rounded-r-[4px]', COR[cor])}
          style={{ width: `${(f * 100).toFixed(2)}%` }}
        />
      ) : null}
      {m !== null ? (
        <span
          className="absolute -top-[3px] -bottom-[3px] w-0.5 -translate-x-1/2 bg-(--vende-traco)"
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
  altura = 'h-4',
  className,
}: {
  segmentos: readonly { valor: number; cor: Cor }[];
  maximo: number;
  altura?: string;
  className?: string;
}) {
  const visiveis = segmentos.filter((s) => s.valor > 0);
  const total = visiveis.reduce((s, x) => s + x.valor, 0);
  const f = fracao(total, maximo);
  return (
    <span aria-hidden="true" className={cn('relative block w-full', altura, className)}>
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
    <span aria-hidden="true" className="relative block h-2 w-14 shrink-0 overflow-hidden rounded-full bg-muted md:w-16">
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
};

/**
 * Colunas verticais, com a dica em cada uma. O alvo é a coluna inteira (da base ao
 * topo do gráfico), muito maior que a barra.
 */
export function Colunas({
  itens,
  maximo,
  altura = 'h-24',
  eixoY,
  larguraDaBarra = 'w-[70%]',
}: {
  itens: readonly Coluna[];
  maximo: number;
  altura?: string;
  /** As marcas do eixo y, de cima para baixo ("40%", "20%", "0"). Um eixo só. */
  eixoY?: readonly string[];
  larguraDaBarra?: string;
}) {
  return (
    <div className="flex gap-2">
      {eixoY ? <EixoY rotulos={eixoY} altura={altura} /> : null}
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <div className={cn('relative', altura)}>
          {eixoY ? <Grade linhas={eixoY.length} /> : <span className="absolute inset-x-0 bottom-0 h-px bg-border" />}
          <div className="relative flex h-full items-end gap-0.5">
            {itens.map((c) => {
              const f = fracao(c.valor, maximo);
              return (
                <Dica key={c.chave} texto={c.dica}>
                  <button
                    type="button"
                    aria-label={c.aria}
                    className={cn(ALVO, 'relative flex h-full min-w-0 flex-1 flex-col items-center justify-end')}
                  >
                    {c.marca ? (
                      <span className="absolute -top-0.5 left-1/2 -translate-x-1/2 -translate-y-full text-[10px] font-semibold whitespace-nowrap">
                        {c.marca}
                      </span>
                    ) : null}
                    {c.rotulo ? (
                      <span aria-hidden="true" className="numerico mb-1 text-[11px] leading-none">
                        {c.rotulo}
                      </span>
                    ) : null}
                    <span
                      aria-hidden="true"
                      className={cn(
                        'block max-w-10 rounded-t-[4px]',
                        larguraDaBarra,
                        c.destaque ? COR.tinta : COR.resto,
                      )}
                      style={{ height: f > 0 ? `${(f * (c.rotulo ? 84 : 100)).toFixed(2)}%` : '1px' }}
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
                  'min-w-0 flex-1 text-[11px] leading-tight',
                  // As pontas (a primeira e a última data) saem da coluna para dentro
                  // do gráfico em vez de cortar; o meio fica centrado.
                  i === 0 && itens.length > 2
                    ? 'text-left whitespace-nowrap'
                    : i === itens.length - 1 && itens.length > 2
                      ? 'text-right whitespace-nowrap'
                      : 'truncate text-center',
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

export type ColunaEmpilhada = {
  chave: string;
  /** De cima para baixo, em % da altura (somam até 100). */
  segmentos: readonly { valor: number; cor: Cor }[];
  dica: ReactNode;
  aria: string;
  /** Embaixo da coluna, em tinta. */
  rotulo?: string;
  eixo?: string;
};

/** Colunas 100% empilhadas, com 2px de vão; a dica escurece as outras colunas. */
export function ColunasEmpilhadas({
  itens,
  altura = 'h-48',
  eixoY,
  ativa,
  aoAtivar,
}: {
  itens: readonly ColunaEmpilhada[];
  altura?: string;
  eixoY?: readonly string[];
  ativa: string | null;
  aoAtivar: (chave: string | null) => void;
}) {
  return (
    <div className="flex gap-2">
      {eixoY ? <EixoY rotulos={eixoY} altura={altura} /> : null}
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <div className={cn('relative flex items-stretch gap-1', altura)}>
          {itens.map((c) => {
            const visiveis = c.segmentos.filter((s) => s.valor > 0);
            return (
              <Dica key={c.chave} texto={c.dica}>
                <button
                  type="button"
                  aria-label={c.aria}
                  onMouseEnter={() => aoAtivar(c.chave)}
                  onMouseLeave={() => aoAtivar(null)}
                  onFocus={() => aoAtivar(c.chave)}
                  onBlur={() => aoAtivar(null)}
                  className={cn(
                    ALVO,
                    'flex min-w-0 flex-1 flex-col justify-end gap-0.5 transition-opacity',
                    ativa !== null && ativa !== c.chave && 'opacity-55',
                  )}
                >
                  {visiveis.length === 0 ? (
                    <span aria-hidden="true" className="h-px w-full bg-border" />
                  ) : (
                    visiveis.map((s, i) => (
                      <span
                        key={i}
                        aria-hidden="true"
                        className={cn('w-full', COR[s.cor], i === 0 && 'rounded-t-[4px]')}
                        style={{ height: `calc(${s.valor.toFixed(2)}% - 2px)` }}
                      />
                    ))
                  )}
                </button>
              </Dica>
            );
          })}
        </div>
        {itens.some((c) => c.rotulo) ? (
          <div aria-hidden="true" className="flex gap-1">
            {itens.map((c) => (
              <span key={c.chave} className="numerico min-w-0 flex-1 truncate text-center text-[11px]">
                {c.rotulo ?? ''}
              </span>
            ))}
          </div>
        ) : null}
        {itens.some((c) => c.eixo) ? (
          <div aria-hidden="true" className="flex gap-1">
            {itens.map((c, i) => (
              <span
                key={c.chave}
                className={cn(
                  'numerico min-w-0 flex-1 text-[10px] text-muted-foreground',
                  i === 0 && itens.length > 2
                    ? 'text-left whitespace-nowrap'
                    : i === itens.length - 1 && itens.length > 2
                      ? 'text-right whitespace-nowrap'
                      : 'truncate text-center',
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

function EixoY({ rotulos, altura }: { rotulos: readonly string[]; altura: string }) {
  return (
    <div
      aria-hidden="true"
      className={cn('numerico flex w-8 shrink-0 flex-col justify-between text-right text-[11px] text-muted-foreground', altura)}
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

/** As linhas de grade (hairline), a de baixo mais forte: é a base. */
function Grade({ linhas }: { linhas: number }) {
  return (
    <div aria-hidden="true" className="absolute inset-0 flex flex-col justify-between">
      {Array.from({ length: linhas }, (_, i) => (
        <span key={i} className={cn('h-px', i === linhas - 1 ? 'bg-border' : 'bg-hairline')} />
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Linhas
// ---------------------------------------------------------------------------

/** A linha das 12 semanas de um número: as 4 últimas em tinta, as de antes em cinza. */
export function Sparkline({ valores }: { valores: readonly (number | null)[] }) {
  const bons = valores.filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
  if (bons.length < 2) return <span aria-hidden="true" className="block h-6" />;
  const min = Math.min(...bons);
  const max = Math.max(...bons);
  const pontos = pontosDaLinha(valores, [min, max === min ? min + 1 : max]).map((p) =>
    p ? { x: p.x, y: 4 + (p.y / 100) * 92 } : null,
  );
  const corte = Math.max(0, valores.length - 4);
  const antes = trechosDaLinha(pontos.slice(0, corte + 1));
  const agora = trechosDaLinha(pontos.map((p, i) => (i >= corte ? p : null)));
  return (
    <svg aria-hidden="true" viewBox="0 0 100 100" preserveAspectRatio="none" className="block h-6 w-full overflow-visible">
      {antes.map((t, i) => (
        <polyline key={`a${i}`} points={t} fill="none" className="stroke-(--vende-resto)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
      ))}
      {agora.map((t, i) => (
        <polyline key={`b${i}`} points={t} fill="none" className="stroke-foreground" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
      ))}
    </svg>
  );
}

export type PontoDaLinha = { dica: ReactNode; aria: string };

/**
 * Uma série no tempo, em SVG, com um eixo só. Buracos (semana sem dado) quebram a
 * linha. Cada ponto tem um alvo da largura da sua fatia, com a dica no mouse e no
 * foco. `marcas` são as versões (traço vertical tracejado).
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
}) {
  const coords = pontosDaLinha(valores, dominio);
  const trechos = trechosDaLinha(coords);
  const n = valores.length;
  const passo = n > 0 ? 100 / n : 100;
  const xDe = (i: number) => (n <= 1 ? 50 : (i / (n - 1)) * 100);
  const traco = cor === 'azul' ? 'stroke-(--vende-azul)' : 'stroke-foreground';
  const ponto = cor === 'azul' ? COR.azul : COR.tinta;
  const indicesValidos = coords.flatMap((c, i) => (c ? [i] : []));
  const primeiro = indicesValidos[0];
  const ultimo = indicesValidos[indicesValidos.length - 1];

  return (
    <div className="flex gap-2">
      {eixoY ? <EixoY rotulos={eixoY} altura={altura} /> : null}
      <div className={cn('relative min-w-0 flex-1', altura, rotuloDoFim && 'mr-10')}>
        {eixoY ? <Grade linhas={eixoY.length} /> : null}
        {marcas.map((m) => (
          <span
            key={`m${m.indice}`}
            aria-hidden="true"
            className="absolute inset-y-0 border-l-2 border-dashed border-(--vende-resto)"
            style={{ left: `${xDe(m.indice).toFixed(2)}%` }}
          >
            {m.rotulo ? (
              <span className="absolute top-0 left-1 bg-card pr-1 text-[11px] whitespace-nowrap text-muted-foreground">
                {m.rotulo}
              </span>
            ) : null}
          </span>
        ))}
        <svg aria-hidden="true" viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 h-full w-full overflow-visible">
          {trechos.map((t, i) => (
            <polyline key={i} points={t} fill="none" className={traco} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
          ))}
        </svg>
        {coords.map((c, i) => {
          if (!c) return null;
          const fim = i === ultimo;
          const vazio = pontas && i === primeiro && i !== ultimo;
          const visivel = !pontas || i === primeiro || fim;
          const marca = (
            <span
              aria-hidden="true"
              className={cn(
                'absolute left-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full',
                fim ? 'size-2.5' : 'size-2',
                vazio ? 'border-2 border-(--vende-azul) bg-card' : cn(ponto, 'ring-2 ring-card'),
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
      <span className="absolute inset-x-0 top-1/2 h-px bg-hairline" />
      {menor !== null && maior !== null ? (
        <span className="absolute top-1/2 h-0.5 -translate-y-1/2 bg-(--vende-resto)" style={{ left: `${menor}%`, width: `${maior - menor}%` }} />
      ) : null}
      {a !== null ? (
        <>
          <span
            className="absolute top-1/2 size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-(--vende-traco) bg-card"
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
            className="absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-foreground ring-2 ring-card"
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
        <span className="absolute inset-x-0 bottom-2 h-3.5 rounded-[4px] bg-muted" />
        {esperado > 0 ? (
          <span className="absolute bottom-2 left-0 h-3.5 rounded-r-[4px] bg-(--vende-resto)" style={{ width: pos(esperado) }} />
        ) : null}
        {fechados > 0 ? (
          <span
            className="absolute bottom-2 left-0 h-3.5 rounded-r-[4px] bg-foreground shadow-[2px_0_0_var(--card)]"
            style={{ width: pos(fechados) }}
          />
        ) : null}
        {faixa ? (
          <>
            <span className="absolute bottom-[14px] h-0.5 bg-(--vende-traco)" style={{ left: pos(faixa[0]), width: `calc(${pos(faixa[1])} - ${pos(faixa[0])})` }} />
            <span className="absolute bottom-[9px] h-3 w-0.5 bg-(--vende-traco)" style={{ left: pos(faixa[0]) }} />
            <span className="absolute bottom-[9px] h-3 w-0.5 -translate-x-full bg-(--vende-traco)" style={{ left: pos(faixa[1]) }} />
          </>
        ) : null}
        {meta !== null ? (
          <>
            <span className="absolute bottom-0.5 h-7 w-0.5 -translate-x-1/2 bg-foreground" style={{ left: pos(meta) }} />
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
        <div aria-hidden="true" className="numerico relative h-3.5 text-[10px] text-muted-foreground">
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
