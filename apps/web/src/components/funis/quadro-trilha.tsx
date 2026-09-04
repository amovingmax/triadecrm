'use client';

import { useEffect, useRef } from 'react';

import { cn } from '@/lib/utils';

import { ContagemDaEtapa } from './coluna';
import { etapaEhDeSaida, type EtapaQuadro } from './tipos';

/**
 * A trilha de etapas do celular (RF-FUN-09).
 *
 * Abaixo de 768px não existe quadro: doze colunas não cabem em 390px, e arrastar
 * dentro de uma lista que rola verticalmente disputa o gesto de rolagem justamente com
 * quem está de pé, na rua, com uma mão só. A tela vira esta trilha — as etapas na
 * ordem do funil, com a contagem, a atual destacada — e, embaixo, a lista dos cartões
 * daquela etapa em largura cheia.
 *
 * A trilha rola sozinha para deixar a etapa escolhida à vista: com catorze etapas no
 * funil de produtor, "Carteira indicada" fica fora da tela e a pessoa perderia a
 * referência de onde está.
 */
export function TrilhaDeEtapas({
  etapas,
  etapaAtivaId,
  aoEscolher,
}: {
  etapas: EtapaQuadro[];
  etapaAtivaId: number | null;
  aoEscolher: (etapaId: number) => void;
}) {
  const ativa = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    ativa.current?.scrollIntoView({ block: 'nearest', inline: 'center' });
  }, [etapaAtivaId]);

  return (
    <div
      role="tablist"
      aria-label="Etapas do funil"
      // Sangra até a borda da tela: no celular a trilha rola de ponta a ponta, e uma
      // faixa que começa a 16px da borda parece cortada em vez de rolável.
      className="-mx-4 flex snap-x gap-2 overflow-x-auto px-4 pb-1"
    >
      {etapas.map((etapa) => {
        const selecionada = etapa.id === etapaAtivaId;
        return (
          <button
            key={etapa.id}
            ref={selecionada ? ativa : null}
            role="tab"
            type="button"
            aria-selected={selecionada}
            onClick={() => aoEscolher(etapa.id)}
            className={cn(
              'toque flex h-11 shrink-0 snap-start items-center gap-1.5 rounded-lg border px-3 text-sm whitespace-nowrap transition-colors focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none',
              selecionada
                ? 'border-ring bg-secondary font-medium text-secondary-foreground'
                : 'border-hairline text-muted-foreground',
              // Etapa de saída é destino, não trabalho: fica visualmente mais leve.
              !selecionada && etapaEhDeSaida(etapa) && 'border-dashed',
            )}
          >
            {etapa.name}
            <ContagemDaEtapa total={etapa.total} className={selecionada ? undefined : 'bg-muted'} />
          </button>
        );
      })}
    </div>
  );
}
