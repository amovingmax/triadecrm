import { cn } from '@/lib/utils';

import type { Regua } from './resumo-da-ficha';

/**
 * A régua do funil: o caminho inteiro, com o parceiro marcado nele.
 *
 * A ficha dizia "Reunião marcada há 2 dias" numa frase em letra pequena. A
 * frase responde em que etapa ele está; a régua responde ONDE isso fica — se é
 * o começo, o meio ou a véspera do fim — sem ninguém precisar saber de cor as
 * nove etapas da captação.
 *
 * SEM COR, de propósito. A única cromia do produto é a escala térmica
 * (`funis/etapa.tsx` diz o mesmo da barra de etapa do quadro): uma régua em
 * verde competiria com o chip de temperatura logo acima. O que está feito é
 * tinta a meio tom, a etapa atual é tinta cheia com um halo, e o que falta é
 * um fio quase apagado.
 *
 * No celular os nomes das etapas não cabem (nove rótulos em 340 px), então a
 * régua fica só com os traços e o nome da etapa atual sobe para o título.
 */
export function ReguaDoFunil({
  regua,
  funil,
  etapa,
  apoio,
}: {
  regua: Regua;
  funil: string;
  /** O nome da etapa em que o negócio está (ou a saída: "Perdido"). */
  etapa: string;
  /** A linha à direita: "há 2 dias nela", "prioridade A", o status. */
  apoio: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3">
      {/* No celular são duas linhas: o nome do funil sozinho em cima (ao lado do
          apoio ele quebrava em dois), e embaixo a etapa com o apoio. No desktop,
          uma linha só: o funil à esquerda, o apoio à direita. */}
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-4 gap-y-0.5">
        <p className="col-span-2 text-[11px] leading-4 font-semibold tracking-[0.07em] text-muted-foreground uppercase md:col-span-1">
          {funil}
        </p>
        {/* O nome da etapa no título: no celular é o único lugar em que ele
            aparece; no desktop ele está sob o traço dela. */}
        <p className="min-w-0 text-base leading-snug font-semibold tracking-[-0.01em] md:hidden">
          {etapa}
        </p>
        <p className="text-right text-[13px] leading-snug text-muted-foreground md:col-start-2 md:row-start-1">
          {apoio}
        </p>
      </div>

      <ol
        className="grid gap-1 md:gap-1.5"
        style={{ gridTemplateColumns: `repeat(${regua.passos.length}, minmax(0, 1fr))` }}
        aria-label={
          regua.fora
            ? `Fora do funil: ${regua.fora}`
            : regua.antes
              ? `Ainda não entrou no funil: ${regua.antes}`
              : `Etapa ${regua.posicao} de ${regua.total}: ${etapa}`
        }
      >
        {regua.passos.map((passo) => (
          <li
            key={passo.id}
            aria-current={passo.estado === 'atual' ? 'step' : undefined}
            className="flex min-w-0 flex-col gap-2"
          >
            <span
              aria-hidden="true"
              className={cn(
                'h-[5px] rounded-full md:h-1',
                passo.estado === 'feito' && 'bg-foreground/45',
                passo.estado === 'atual' && 'bg-foreground ring-[3px] ring-foreground/15',
                passo.estado === 'a_fazer' && 'bg-foreground/12',
              )}
            />
            <span
              className={cn(
                'hidden text-[11.5px] leading-tight md:block',
                passo.estado === 'atual'
                  ? 'font-semibold text-foreground'
                  : passo.estado === 'feito'
                    ? 'text-muted-foreground'
                    : 'text-muted-foreground/75',
              )}
            >
              {passo.nome}
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}
