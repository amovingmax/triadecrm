'use client';

import {
  type KeyboardEvent,
  type RefObject,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { Camera, ChevronLeft, ChevronRight, Flame } from 'lucide-react';

import { cn } from '@/lib/utils';

import {
  fotoAVista,
  juntarFotos,
  pontosDoCarrossel,
  type TamanhoDoPonto,
  vizinhasDaFoto,
} from './carrossel';
import { urlDaFoto } from './dados';

const TAMANHO_DO_PONTO: Record<TamanhoDoPonto, string> = {
  cheio: 'size-1.5',
  medio: 'size-1',
  pequeno: 'size-[3px]',
};

/** O selo da câmera no canto da foto (grade maior, lista menor). */
export function SeloDasFotos({ grade, children }: { grade: boolean; children: string }) {
  return (
    <span
      className={cn(
        'pointer-events-none absolute inline-flex items-center rounded-full bg-foreground/70 font-semibold text-background backdrop-blur-sm',
        grade
          ? 'bottom-2.5 left-2.5 h-[26px] gap-1.5 px-2.5 text-xs'
          : 'bottom-1.5 left-1.5 h-5 gap-1 px-1.5 text-[11px]',
      )}
    >
      <Camera className={grade ? 'size-3.5' : 'size-3'} aria-hidden="true" />
      <span className="numerico">{children}</span>
    </span>
  );
}

/** O destaque do portal no alto da foto (só na grade). */
export function SeloDoDestaque({ children }: { children: string }) {
  return (
    <span className="pointer-events-none absolute top-2.5 left-2.5 inline-flex h-6 items-center gap-1 rounded-full bg-menta-fundo px-2.5 text-xs font-semibold text-menta-texto">
      <Flame className="size-3.5" aria-hidden="true" />
      {children}
    </span>
  );
}

/** "9" ou "9 de 17" (quando o Canal Pro tem mais fotos que o CRM). */
export function contagemDasFotos(fotos: number, noCanalPro: number | null): string {
  return `${fotos}${noCanalPro !== null && noCanalPro > fotos ? ` de ${noCanalPro}` : ''}`;
}

// ---------------------------------------------------------------------------
// O motor comum: o trilho que rola de lado, a foto à vista e os arquivos pedidos
// ---------------------------------------------------------------------------

type Carrossel = ReturnType<typeof useCarrossel>;

/**
 * O estado de um carrossel de `quantas` fotos, que começa em `inicial`. O trilho
 * é rolagem nativa com encaixe (`scroll-snap`), sem biblioteca; os arquivos só
 * são pedidos para a foto à vista e as vizinhas (com `vizinhasJa`, desde o
 * começo; sem, só quando a pessoa chega perto).
 */
function useCarrossel(
  trilho: RefObject<HTMLDivElement | null>,
  quantas: number,
  inicial: number,
  vizinhasJa = false,
) {
  // Para onde a rolagem suave está indo: apertar a seta de novo antes de ela
  // chegar conta a partir do destino, não da foto que ainda está à vista.
  const destino = useRef<number | null>(null);
  const [atual, setAtual] = useState(inicial);
  const [pedidas, setPedidas] = useState<ReadonlySet<number>>(
    () => new Set(vizinhasJa ? vizinhasDaFoto(inicial, quantas) : [inicial]),
  );
  const vista = Math.min(atual, Math.max(0, quantas - 1));

  // Aberto numa foto que não é a primeira: o trilho já nasce nela, sem animação.
  useLayoutEffect(() => {
    const el = trilho.current;
    if (el && inicial > 0) el.scrollTo({ left: inicial * el.clientWidth, behavior: 'instant' });
  }, [trilho, inicial]);

  function pedirVizinhas(i: number) {
    setPedidas((p) => juntarFotos(p, vizinhasDaFoto(i, quantas)));
  }

  function aoRolar() {
    const el = trilho.current;
    if (!el) return;
    const i = fotoAVista(el.scrollLeft, el.clientWidth, quantas);
    if (i === destino.current) destino.current = null;
    if (i !== atual) {
      setAtual(i);
      pedirVizinhas(i);
    }
  }

  /** A rolagem parou: o próximo passo conta da foto à vista. */
  function aoRolarAte() {
    destino.current = null;
  }

  function irPara(i: number) {
    const el = trilho.current;
    if (!el) return;
    const alvo = Math.min(quantas - 1, Math.max(0, i));
    // Já parado nela (a ponta da fila): não há rolagem que chegue para limpar.
    destino.current = alvo === fotoAVista(el.scrollLeft, el.clientWidth, quantas) ? null : alvo;
    pedirVizinhas(alvo);
    const semMovimento = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    el.scrollTo({ left: alvo * el.clientWidth, behavior: semMovimento ? 'auto' : 'smooth' });
  }

  /** Um passo para o lado, a partir de onde a rolagem vai parar. */
  function passo(lado: -1 | 1) {
    irPara((destino.current ?? vista) + lado);
  }

  function aoTeclar(e: KeyboardEvent<HTMLElement>) {
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault();
      passo(e.key === 'ArrowLeft' ? -1 : 1);
    }
  }

  return {
    vista,
    pedidas,
    pedirVizinhas,
    aoRolar,
    aoRolarAte,
    irPara,
    passo,
    aoTeclar,
  };
}

/** As fotos lado a lado; com `aoClicar`, cada uma é um botão (o cartão abre a ficha). */
function Trilho({
  trilho,
  c,
  lista,
  quantas,
  apagada = false,
  aoClicar,
}: {
  trilho: RefObject<HTMLDivElement | null>;
  c: Carrossel;
  lista: string[];
  quantas: number;
  apagada?: boolean;
  aoClicar?: (foto: number) => void;
}) {
  const varias = quantas > 1;
  return (
    <div
      ref={trilho}
      onScroll={varias ? c.aoRolar : undefined}
      onScrollEnd={varias ? c.aoRolarAte : undefined}
      className={cn(
        'absolute inset-0 flex overflow-y-hidden',
        varias &&
          'snap-x snap-mandatory overflow-x-auto overscroll-x-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden',
      )}
    >
      {Array.from({ length: quantas }, (_, i) => {
        const caminho = lista[i];
        const foto =
          caminho !== undefined && c.pedidas.has(i) ? (
            // eslint-disable-next-line @next/next/no-img-element -- foto do balde público, sem otimizador do Next
            <img
              src={urlDaFoto(caminho)}
              alt=""
              loading={i === 0 ? 'lazy' : 'eager'}
              draggable={false}
              className={cn(
                'absolute inset-0 size-full object-cover select-none',
                apagada && 'opacity-60 grayscale',
              )}
            />
          ) : null;
        const lugar = 'relative block h-full w-full shrink-0 snap-center snap-always';
        return aoClicar ? (
          <button
            key={caminho ?? `foto-${i}`}
            type="button"
            onClick={() => aoClicar(i)}
            tabIndex={-1}
            aria-hidden="true"
            draggable={false}
            className={cn(lugar, 'outline-none')}
          >
            {foto}
          </button>
        ) : (
          <div key={caminho ?? `foto-${i}`} aria-hidden="true" className={lugar}>
            {foto}
          </div>
        );
      })}
    </div>
  );
}

/** As setas dos lados: só com mouse; `sempre` à vista (ficha) ou só com o mouse em cima (cartão). */
function Setas({
  c,
  quantas,
  sempre = false,
}: {
  c: Carrossel;
  quantas: number;
  sempre?: boolean;
}) {
  const seta = cn(
    'absolute top-1/2 z-10 hidden -translate-y-1/2 place-items-center rounded-full bg-background/90 text-foreground shadow-sm outline-none backdrop-blur-sm transition-opacity duration-150 pointer-fine:grid hover:bg-background focus-visible:opacity-100 focus-visible:ring-3 focus-visible:ring-ring/50',
    sempre ? 'size-9' : 'size-8 opacity-0 group-hover/carrossel:opacity-100',
  );
  return (
    <>
      <button
        type="button"
        onClick={() => c.passo(-1)}
        aria-label="Foto anterior"
        className={cn(seta, 'left-2', c.vista === 0 && 'invisible')}
      >
        <ChevronLeft className="size-4" aria-hidden="true" />
      </button>
      <button
        type="button"
        onClick={() => c.passo(1)}
        aria-label="Próxima foto"
        className={cn(seta, 'right-2', c.vista === quantas - 1 && 'invisible')}
      >
        <ChevronRight className="size-4" aria-hidden="true" />
      </button>
      <p className="sr-only" aria-live="polite">
        Foto {c.vista + 1} de {quantas}
      </p>
    </>
  );
}

// ---------------------------------------------------------------------------
// No cartão da grade
// ---------------------------------------------------------------------------

/**
 * A foto do cartão do anúncio, na grade, que passa para o lado (27/11/2026): no
 * celular, arrastando com o dedo; no computador, pelas setas que aparecem com o
 * mouse em cima, pelas setas do teclado ou deslizando no trackpad. Clicar na
 * foto abre a ficha, na foto que estava à vista.
 *
 * Enquanto a lista de caminhos não chega, a capa já aparece e o número de fotos
 * vem da lista.
 */
export function CarrosselDeFotos({
  codigo,
  capa,
  caminhos,
  fotos,
  noCanalPro,
  apagada,
  destaque,
  aoAbrir,
}: {
  codigo: string;
  capa: string | null;
  /**
   * Todas as fotos, na ordem do portal. `undefined` enquanto carrega; `null`
   * quando a leitura não trouxe (aí fica só a capa).
   */
  caminhos: string[] | null | undefined;
  /** Quantas fotos a lista diz que o anúncio tem. */
  fotos: number;
  noCanalPro: number | null;
  apagada: boolean;
  destaque: string | null;
  /** Abre a ficha nesta foto. */
  aoAbrir: (foto: number) => void;
}) {
  const lista = caminhos?.length ? caminhos : capa ? [capa] : [];
  // Carregando: os lugares das outras fotos já existem (a capa vem na frente).
  const quantas = caminhos === undefined ? Math.max(fotos, lista.length) : lista.length;
  const trilho = useRef<HTMLDivElement>(null);
  const c = useCarrossel(trilho, quantas, 0);
  const varias = quantas > 1;

  return (
    <div
      role={varias ? 'region' : undefined}
      aria-roledescription={varias ? 'carrossel' : undefined}
      aria-label={varias ? `Fotos do anúncio ${codigo}` : undefined}
      onKeyDown={varias ? c.aoTeclar : undefined}
      // Com o mouse (ou o dedo) em cima, a próxima já começa a carregar.
      onPointerEnter={varias ? () => c.pedirVizinhas(c.vista) : undefined}
      className="group/carrossel relative block aspect-[4/3] w-full shrink-0 overflow-hidden bg-muted"
    >
      <Trilho
        trilho={trilho}
        c={c}
        lista={lista}
        quantas={quantas}
        apagada={apagada}
        aoClicar={aoAbrir}
      />

      {varias ? (
        <>
          <Setas c={c} quantas={quantas} />
          <div
            aria-hidden="true"
            // O fundinho escuro deixa os pontos visíveis em foto aérea clara.
            className="pointer-events-none absolute bottom-3.5 left-1/2 flex h-4 -translate-x-1/2 items-center gap-1 rounded-full bg-black/35 px-1.5 backdrop-blur-sm"
          >
            {pontosDoCarrossel(quantas, c.vista).map((p) => (
              <span
                key={p.indice}
                className={cn(
                  'rounded-full transition-all duration-150',
                  TAMANHO_DO_PONTO[p.tamanho],
                  p.indice === c.vista ? 'bg-white' : 'bg-white/55',
                )}
              />
            ))}
          </div>
        </>
      ) : null}

      {fotos > 0 ? (
        <SeloDasFotos grade>
          {c.vista > 0 ? `${c.vista + 1}/${quantas}` : contagemDasFotos(fotos, noCanalPro)}
        </SeloDasFotos>
      ) : null}
      {destaque ? <SeloDoDestaque>{destaque}</SeloDoDestaque> : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Na ficha do anúncio
// ---------------------------------------------------------------------------

/**
 * As fotos na ficha do anúncio (27/11/2026): a foto grande passa para o lado
 * como no cartão (dedo, setas sempre à vista no computador, teclado, trackpad),
 * com "3/12" no canto, e embaixo a fileira com TODAS as miniaturas (antes eram
 * 9 e "+N"): tocar numa leva a ela, e a da foto à vista fica marcada. Abre na
 * foto que estava à vista no cartão.
 */
export function CarrosselDaFicha({
  codigo,
  caminhos,
  inicial,
}: {
  codigo: string;
  caminhos: string[];
  inicial: number;
}) {
  const quantas = caminhos.length;
  // A ficha já mostra a foto grande: as vizinhas carregam junto.
  const trilho = useRef<HTMLDivElement>(null);
  const c = useCarrossel(trilho, quantas, Math.min(inicial, Math.max(0, quantas - 1)), true);
  const fileira = useRef<HTMLUListElement>(null);
  const varias = quantas > 1;
  const { vista } = c;

  // A miniatura da foto à vista fica no meio da fileira (rolando só a fileira,
  // não a ficha).
  useEffect(() => {
    const el = fileira.current;
    const mini = el?.children[vista] as HTMLElement | undefined;
    if (!el || !mini) return;
    const semMovimento = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    el.scrollTo({
      left: mini.offsetLeft - (el.clientWidth - mini.clientWidth) / 2,
      behavior: semMovimento ? 'auto' : 'smooth',
    });
  }, [vista]);

  return (
    <div
      role={varias ? 'region' : undefined}
      aria-roledescription={varias ? 'carrossel' : undefined}
      aria-label={`Fotos de ${codigo}`}
      onKeyDown={varias ? c.aoTeclar : undefined}
      className="flex flex-col gap-2"
    >
      <div className="group/carrossel relative aspect-video w-full overflow-hidden rounded-xl bg-muted">
        <Trilho trilho={trilho} c={c} lista={caminhos} quantas={quantas} />
        {varias ? <Setas c={c} quantas={quantas} sempre /> : null}
        <SeloDasFotos grade>{varias ? `${vista + 1}/${quantas}` : '1'}</SeloDasFotos>
      </div>

      {varias ? (
        <ul
          ref={fileira}
          aria-label="Miniaturas"
          // A folga de 4px em volta deixa o anel da miniatura marcada inteiro.
          className="-mx-1 flex gap-1.5 overflow-x-auto overscroll-x-contain p-1 [scrollbar-width:thin]"
        >
          {caminhos.map((caminho, i) => (
            <li key={caminho} className="shrink-0">
              <button
                type="button"
                onClick={() => c.irPara(i)}
                aria-label={`Foto ${i + 1} de ${quantas}`}
                aria-current={i === vista ? 'true' : undefined}
                className={cn(
                  'toque relative block h-14 w-[4.75rem] overflow-hidden rounded-md bg-muted outline-none focus-visible:ring-3 focus-visible:ring-ring/50',
                  i === vista
                    ? 'ring-2 ring-primary ring-offset-2 ring-offset-background'
                    : 'opacity-70 hover:opacity-100',
                )}
              >
                {/* eslint-disable-next-line @next/next/no-img-element -- foto do balde público */}
                <img
                  src={urlDaFoto(caminho)}
                  alt=""
                  loading="lazy"
                  draggable={false}
                  className="size-full object-cover"
                />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
