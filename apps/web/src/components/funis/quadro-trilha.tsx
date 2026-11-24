'use client';

import { FaixaDeslizante } from '@/components/ui/faixa-deslizante';
import { cn } from '@/lib/utils';

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
 * Desde o protótipo responsivo (24/11/2026) a trilha é a `FaixaDeslizante` com
 * sangria: começa alinhada ao texto (antes colava na borda da tela e lia como
 * cortada), esmaece na borda para dizer que há mais, e mantém a etapa escolhida à
 * vista sem rolar a página. A barrinha de cima é o mapa da trilha: um traço por
 * etapa, cheio até a escolhida, para a pessoa saber em que ponto do funil está
 * mesmo com a etapa fora da tela.
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
  const indiceAtivo = etapas.findIndex((e) => e.id === etapaAtivaId);

  return (
    <div className="flex flex-col gap-3">
      <div aria-hidden="true" className="grid auto-cols-fr grid-flow-col gap-1">
        {etapas.map((etapa, indice) => (
          <span
            key={etapa.id}
            className={cn(
              'h-1 rounded-full',
              indice < indiceAtivo
                ? 'bg-input'
                : indice === indiceAtivo
                  ? 'bg-primary'
                  : 'bg-border',
            )}
          />
        ))}
      </div>

      <FaixaDeslizante rotulo="Etapas do funil" ativo={etapaAtivaId} sangria>
        {etapas.map((etapa) => {
          const selecionada = etapa.id === etapaAtivaId;
          return (
            <button
              key={etapa.id}
              type="button"
              aria-pressed={selecionada}
              onClick={() => aoEscolher(etapa.id)}
              className={cn(
                'toque flex h-11 items-center gap-2 rounded-lg border px-3.5 text-sm whitespace-nowrap transition-colors focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none',
                selecionada
                  ? 'border-primary bg-primary/10 font-semibold text-primary'
                  : 'border-border bg-card font-medium text-foreground',
                // Etapa de saída é destino, não trabalho: fica visualmente mais leve.
                !selecionada && etapaEhDeSaida(etapa) && 'border-dashed text-muted-foreground',
              )}
            >
              {etapa.name}
              <span
                className={cn(
                  'numerico inline-grid h-5 min-w-5 place-items-center rounded-full px-1.5 text-xs font-semibold',
                  selecionada ? 'bg-primary/15 text-primary' : 'bg-muted text-muted-foreground',
                )}
              >
                {etapa.total}
              </span>
            </button>
          );
        })}
      </FaixaDeslizante>
    </div>
  );
}
