'use client';

import { useDroppable } from '@dnd-kit/core';
import { ChevronLeft, Flag, Loader2, MoonStar, Slash, Trophy } from 'lucide-react';

import { cn } from '@/lib/utils';
import { Skeleton } from '@/components/ui/skeleton';

import type { DadosDaColuna } from './quadro-teclado';
import { etapaEhDeSaida, type EtapaQuadro } from './tipos';

/**
 * Uma coluna do quadro: a etapa, a contagem e a pilha de cartões (RF-FUN-01).
 *
 * Três coisas moram aqui e em nenhum outro lugar:
 *
 * 1. **A coluna é o alvo de soltar.** O droppable é a `<section>` inteira, com o
 *    cabeçalho e o vazio dentro — soltar em cima do título de "Perdido" tem de contar
 *    como soltar em Perdido. Enquanto há cartão no ar, todo alvo válido ganha
 *    contorno, e o alvo sob o ponteiro ganha o preenchimento: sem isso a pessoa solta
 *    no escuro.
 *
 * 2. **O cabeçalho fica FORA do que rola.** Com quarenta cartões numa coluna, um
 *    cabeçalho que some ao rolar deixa a pessoa sem saber em que etapa está olhando. A
 *    contagem é o total da etapa depois dos filtros, não o número de cartões
 *    carregados — por isso o rodapé pode dizer "Carregar mais 10".
 *
 * 3. **Altura pela tela, não pelo conteúdo.** `max-h` em `dvh` faz cada coluna rolar
 *    dentro de si e mantém as doze cabeças alinhadas; sem isso a coluna mais cheia
 *    estica a página e o quadro passa a rolar na vertical inteiro.
 */

/** Largura da coluna aberta. 288px cabe nome, categoria, local e os dois semáforos. */
const LARGURA = 'w-72';

/** Ícone da etapa de saída: publicado, perdido, opt-out e nutrição são destino, não trabalho. */
function IconeDaEtapa({ etapa }: { etapa: EtapaQuadro }) {
  if (etapa.is_won) return <Trophy className="size-3.5 shrink-0" aria-hidden="true" />;
  if (etapa.is_optout) return <Slash className="size-3.5 shrink-0" aria-hidden="true" />;
  if (etapa.is_lost) return <Flag className="size-3.5 shrink-0" aria-hidden="true" />;
  if (etapa.is_dormant) return <MoonStar className="size-3.5 shrink-0" aria-hidden="true" />;
  return null;
}

/** "1 negócio", "48 negócios": o rótulo do leitor de tela não fala errado. */
function contarNegocios(total: number): string {
  return `${total} ${total === 1 ? 'negócio' : 'negócios'}`;
}

function dadosDoDroppable(etapa: EtapaQuadro): DadosDaColuna {
  return { tipo: 'etapa', etapaId: etapa.id, posicao: etapa.position, nome: etapa.name };
}

/** Contagem da etapa, sempre em IBM Plex Mono para as colunas alinharem na vertical. */
export function ContagemDaEtapa({ total, className }: { total: number; className?: string }) {
  return (
    <span
      className={cn(
        'numerico rounded-lg bg-muted px-1.5 py-0.5 text-xs text-muted-foreground',
        className,
      )}
    >
      {total}
    </span>
  );
}

export function Coluna({
  etapa,
  arrastando,
  carregandoMais,
  aoCarregarMais,
  children,
}: {
  etapa: EtapaQuadro;
  /** Há um cartão em voo em algum lugar do quadro: acende as bordas dos alvos. */
  arrastando: boolean;
  carregandoMais: boolean;
  aoCarregarMais: () => void;
  children: React.ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: `etapa-${etapa.id}`,
    data: dadosDoDroppable(etapa),
  });

  const faltam = etapa.total - etapa.cards.length;

  return (
    <section
      ref={setNodeRef}
      aria-label={`Etapa ${etapa.name}, ${contarNegocios(etapa.total)}`}
      data-sobre={isOver ? '' : undefined}
      className={cn(
        LARGURA,
        'flex max-h-[calc(100dvh-19rem)] min-h-80 shrink-0 flex-col rounded-xl border border-hairline transition-colors',
        etapaEhDeSaida(etapa) ? 'bg-muted/20' : 'bg-muted/40',
        arrastando && 'border-input',
        isOver && 'border-ring bg-accent/60',
      )}
    >
      <header className="flex items-center gap-2 border-b border-hairline px-3 py-2">
        <IconeDaEtapa etapa={etapa} />
        <h3 className="min-w-0 flex-1 truncate text-sm font-medium" title={etapa.name}>
          {etapa.name}
        </h3>
        <ContagemDaEtapa total={etapa.total} />
      </header>

      <div className="flex min-h-24 flex-1 flex-col gap-2 overflow-y-auto p-2">
        {children}

        {etapa.total === 0 ? (
          <p className="px-1 py-6 text-center text-xs text-muted-foreground">
            {etapaEhDeSaida(etapa)
              ? 'Nada aqui. Encerra-se um negócio arrastando o cartão para esta etapa.'
              : 'Nada aqui. Arraste um cartão de outra etapa para começar.'}
          </p>
        ) : null}

        {faltam > 0 ? (
          <button
            type="button"
            onClick={aoCarregarMais}
            disabled={carregandoMais}
            className="toque mt-1 inline-flex h-9 shrink-0 items-center justify-center gap-1.5 rounded-lg border border-hairline text-xs font-medium text-muted-foreground hover:bg-accent hover:text-accent-foreground focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none disabled:opacity-50"
          >
            {carregandoMais ? (
              <>
                <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
                Carregando
              </>
            ) : (
              <>
                Carregar mais <span className="numerico">{faltam}</span>
              </>
            )}
          </button>
        ) : null}
      </div>
    </section>
  );
}

/**
 * Etapa de saída, recolhida na faixa do fim do quadro.
 *
 * Doze colunas de 288px pedem 3.456px de largura: em 1440px cabem quatro e meia, e a
 * pessoa passa o dia rolando na horizontal para chegar em Prospectado. Publicado,
 * Nutrição, Perdido e Opt-out ficam numa faixa estreita, continuam recebendo cartão
 * arrastado (é o mesmo droppable, com o mesmo id) e abrem com um toque quando alguém
 * precisa conferir o que está lá dentro.
 */
export function ColunaRecolhida({
  etapa,
  arrastando,
  aoAbrir,
}: {
  etapa: EtapaQuadro;
  arrastando: boolean;
  aoAbrir: () => void;
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: `etapa-${etapa.id}`,
    data: dadosDoDroppable(etapa),
  });

  return (
    <button
      ref={setNodeRef}
      type="button"
      onClick={aoAbrir}
      title={`${etapa.name}: ${contarNegocios(etapa.total)}. Abrir a coluna.`}
      data-sobre={isOver ? '' : undefined}
      className={cn(
        'flex max-h-[calc(100dvh-19rem)] min-h-80 w-12 shrink-0 flex-col items-center gap-2 rounded-xl border border-hairline bg-muted/20 py-3 transition-colors',
        'hover:bg-accent focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none',
        arrastando && 'border-input',
        isOver && 'border-ring bg-accent',
      )}
    >
      <IconeDaEtapa etapa={etapa} />
      <ContagemDaEtapa total={etapa.total} className="bg-transparent px-0" />
      <span
        className="min-h-0 flex-1 truncate text-xs text-muted-foreground"
        style={{ writingMode: 'vertical-rl' }}
      >
        {etapa.name}
      </span>
    </button>
  );
}

/** Cabeça da faixa recolhida: diz o que é aquela fileira de colunas estreitas. */
export function CabecaDaFaixaDeSaida({ aoAbrirTudo }: { aoAbrirTudo: () => void }) {
  return (
    <button
      type="button"
      onClick={aoAbrirTudo}
      title="Abrir todas as etapas de encerramento"
      className="flex max-h-[calc(100dvh-19rem)] min-h-80 w-8 shrink-0 flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-hairline text-muted-foreground hover:bg-accent focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
    >
      <ChevronLeft className="size-4" aria-hidden="true" />
      <span className="text-xs" style={{ writingMode: 'vertical-rl' }}>
        Encerramento
      </span>
    </button>
  );
}

/**
 * Espera: o desenho final do quadro, não um giro no meio da tela.
 *
 * As mesmas larguras de coluna, a mesma moldura, o mesmo cabeçalho e a mesma altura de
 * cartão, para o conteúdo aparecer onde o olho já está e a troca não empurrar nada.
 */
export function EsqueletoDoQuadro({ colunas = 5 }: { colunas?: number }) {
  const cartoesPorColuna = [4, 3, 2, 3, 1];

  return (
    <div aria-busy="true" aria-live="polite" className="flex gap-3 overflow-hidden">
      <span className="sr-only">Carregando o quadro do funil.</span>
      {Array.from({ length: colunas }, (_, indice) => (
        <div
          key={indice}
          className={cn(
            LARGURA,
            'flex min-h-80 shrink-0 flex-col rounded-xl border border-hairline bg-muted/40',
          )}
        >
          <div className="flex items-center gap-2 border-b border-hairline px-3 py-2">
            <Skeleton className="h-4 flex-1" />
            <Skeleton className="h-4 w-7" />
          </div>
          <div className="flex flex-col gap-2 p-2">
            {Array.from(
              { length: cartoesPorColuna[indice % cartoesPorColuna.length] ?? 2 },
              (_, linha) => (
                <Skeleton key={linha} className="h-[76px] w-full rounded-xl" />
              ),
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
