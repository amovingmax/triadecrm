'use client';

import { useId, useState } from 'react';
import { BellRing, ChevronDown } from 'lucide-react';

import { Skeleton } from '@/components/ui/skeleton';
import { useMidia } from '@/lib/use-midia';
import { cn } from '@/lib/utils';

import type { ItemDeAtencao } from './aba-dos-anuncios';
import type { PinoAntesDeColar } from './passos-do-caminho';
import { LinhaDePendencia } from './precisa-de-voce';
import { LinhaDaTroca, useTrocaDaArbo } from './troca-da-arbo';

/**
 * O painel Pendências (protótipo responsivo da Imova, 24/11/2026): o "Próximo
 * passo · Troca da Arbo pelo CRM" e o "Precisa de você" num cartão só, que abre
 * e fecha. No celular ele começa fechado e a linha do título diz quantas são e
 * quais; do tablet para cima começa aberto. Era o que mais empurrava a lista para
 * baixo: no celular o primeiro anúncio só aparecia depois de ~1.900 px.
 *
 * Sem nada nas duas partes, o painel não aparece.
 */
export function Pendencias({
  itens,
  itensProntos,
  chave,
  noPortalSoPeloSistemaAtual,
  pino,
  aoVerNaLista,
  aoSincronizar,
  aoAbrir,
  aoFiltrarProntos,
}: {
  itens: ItemDeAtencao[];
  /** As listas que montam os itens já chegaram. */
  itensProntos: boolean;
  chave: string | null;
  noPortalSoPeloSistemaAtual: number;
  pino: PinoAntesDeColar;
  aoVerNaLista: () => void;
  aoSincronizar: () => void;
  aoAbrir: (anuncioId: string) => void;
  aoFiltrarProntos: () => void;
}) {
  const id = useId();
  const troca = useTrocaDaArbo(noPortalSoPeloSistemaAtual, pino);
  // `null` é "o padrão do tamanho da tela": quem decide é o CSS (fechado abaixo de
  // 768px), então o primeiro quadro, que vem do servidor, já nasce certo. O toque
  // grava a escolha e ela passa a valer em qualquer tamanho.
  const [escolha, setEscolha] = useState<boolean | null>(null);
  const largo = useMidia('(min-width: 768px)');
  const aberto = escolha ?? largo;

  if (troca.estado === 'carregando' || !itensProntos) {
    return <Skeleton className="h-[68px] w-full rounded-xl" />;
  }
  const comTroca = troca.estado === 'passo' || troca.estado === 'erro';
  if (!comTroca && itens.length === 0) return null;

  const quantas = (troca.estado === 'passo' ? 1 : 0) + itens.length;
  const resumo = [
    troca.estado === 'passo' ? 'Troca da Arbo pelo CRM' : null,
    ...itens.map((i) => i.curto),
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <section
      aria-labelledby={`${id}-titulo`}
      className="sombra-base overflow-hidden rounded-xl bg-card"
    >
      <h2 id={`${id}-titulo`}>
        <button
          type="button"
          aria-expanded={aberto}
          aria-controls={`${id}-corpo`}
          onClick={() => setEscolha(!aberto)}
          className="flex min-h-11 w-full items-center gap-3 px-4 py-3.5 text-left outline-none hover:bg-muted/50 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:ring-inset"
        >
          <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-menta-fundo text-menta-texto">
            <BellRing className="size-4" aria-hidden="true" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-2 font-semibold">
              Pendências
              {quantas > 0 ? (
                <span className="numerico inline-grid h-5.5 min-w-5.5 place-items-center rounded-full bg-menta px-1.5 text-xs font-bold text-menta-tinta">
                  {quantas}
                </span>
              ) : null}
            </span>
            {resumo ? (
              <span className="block truncate text-[13px] font-normal text-muted-foreground">
                {resumo}
              </span>
            ) : null}
          </span>
          <ChevronDown
            className={cn(
              'size-5 shrink-0 text-muted-foreground transition-transform duration-150',
              escolha === null ? 'md:rotate-180' : escolha && 'rotate-180',
            )}
            aria-hidden="true"
          />
        </button>
      </h2>
      <div
        id={`${id}-corpo`}
        className={cn(
          'border-t border-hairline px-4 pb-1',
          escolha === null ? 'max-md:hidden' : !escolha && 'hidden',
        )}
      >
        <ul className="flex flex-col divide-y divide-hairline">
          {comTroca ? (
            <LinhaDaTroca troca={troca} chave={chave} aoVerNaLista={aoVerNaLista} />
          ) : null}
          {itens.map((item) => (
            <LinhaDePendencia
              key={item.id}
              item={item}
              aoSincronizar={aoSincronizar}
              aoAbrir={aoAbrir}
              aoFiltrarProntos={aoFiltrarProntos}
            />
          ))}
        </ul>
      </div>
    </section>
  );
}
