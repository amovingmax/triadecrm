'use client';

import { X } from 'lucide-react';

import { Chip } from '@/components/ui/chip';
import { FaixaDeslizante } from '@/components/ui/faixa-deslizante';

export type EtiquetaDeFiltro = {
  /** Chave estável (o nome do filtro). */
  chave: string;
  /** O que a etiqueta diz: "Cidade: Natal". */
  rotulo: string;
  aoTirar: () => void;
};

/**
 * Os filtros ligados, abaixo da busca (protótipo responsivo da Imova, 24/11/2026).
 *
 * Com os filtros guardados numa folha, a pessoa precisa ver o que está ligado sem
 * abrir a folha: cada filtro vira uma etiqueta que se tira com um toque (a etiqueta
 * INTEIRA é o botão, não só o X de 24px), e "Limpar" tira tudo. A linha desliza de
 * lado quando não cabe, em vez de empurrar a lista para baixo.
 */
export function EtiquetasDeFiltro({
  etiquetas,
  aoLimpar,
}: {
  etiquetas: readonly EtiquetaDeFiltro[];
  aoLimpar: () => void;
}) {
  if (etiquetas.length === 0) return null;
  return (
    <FaixaDeslizante rotulo="Filtros ligados" sangria>
      {etiquetas.map((e) => (
        <button
          key={e.chave}
          type="button"
          onClick={e.aoTirar}
          aria-label={`Tirar o filtro ${e.rotulo}`}
          className="toque inline-flex h-11 max-w-[80vw] items-center gap-1.5 rounded-full bg-primary/10 pr-2.5 pl-3.5 text-sm font-medium text-primary transition-colors hover:bg-primary/15 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none md:h-8"
        >
          <span className="truncate">{e.rotulo}</span>
          <X className="size-3.5 shrink-0" aria-hidden="true" />
        </button>
      ))}
      <Chip onClick={aoLimpar} className="md:h-8">
        Limpar
      </Chip>
    </FaixaDeslizante>
  );
}
