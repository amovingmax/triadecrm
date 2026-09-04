'use client';

/**
 * Os jeitos de a tela de lotes não ser uma lista de lotes: carregando, falhou e
 * vazio de verdade.
 *
 * Cada estado diz o que aconteceu E o que fazer em seguida. "Nenhum lote" sem saída
 * manda a pessoa adivinhar; aqui o botão da saída está sempre na tela. O texto do
 * Postgres nunca chega aqui: quem traduz é `traduzirFalha`, o mesmo tradutor dos
 * funis — duas telas com dois vocabulários de erro seriam duas telas para aprender.
 */
import { PhoneOutgoing, RotateCw } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { traduzirFalha } from '@/components/funis/acoes/erros';

function Moldura({
  icone,
  titulo,
  texto,
  children,
}: {
  icone: React.ReactNode;
  titulo: string;
  texto: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed px-6 py-14 text-center">
      <span className="flex size-10 items-center justify-center rounded-xl bg-muted text-muted-foreground">
        {icone}
      </span>
      <div className="space-y-1">
        <p className="font-heading font-medium">{titulo}</p>
        <p className="mx-auto max-w-md text-sm text-muted-foreground">{texto}</p>
      </div>
      {children}
    </div>
  );
}

/** Espera: a forma dos cartões de lote, não um giro no meio da tela. */
export function EsqueletoDosLotes() {
  return (
    <div aria-busy="true" aria-live="polite" className="grid gap-3 lg:grid-cols-2">
      <span className="sr-only">Carregando os lotes de ligação.</span>
      {Array.from({ length: 2 }, (_, cartao) => (
        <div key={cartao} className="space-y-3 rounded-xl border p-4">
          <div className="flex items-center justify-between gap-2">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-5 w-16 rounded-full" />
          </div>
          <Skeleton className="h-3 w-56" />
          <Skeleton className="h-1.5 w-full rounded-full" />
          <div className="grid grid-cols-4 gap-3 pt-1">
            {Array.from({ length: 4 }, (_, numero) => (
              <div key={numero} className="space-y-1.5">
                <Skeleton className="h-6 w-8" />
                <Skeleton className="h-3 w-14" />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

/** Falhou: a frase é a de `traduzirFalha`, nunca o texto do Postgres. */
export function ErroDosLotes({ causa, aoTentar }: { causa: unknown; aoTentar: () => void }) {
  const { titulo, saida, vaiAdiantarTentarDeNovo } = traduzirFalha(causa);

  return (
    <Moldura
      icone={<RotateCw className="size-5" aria-hidden="true" />}
      titulo={titulo}
      texto={saida}
    >
      {vaiAdiantarTentarDeNovo ? (
        <Button variant="outline" onClick={aoTentar} className="toque h-11 md:h-9">
          <RotateCw aria-hidden="true" />
          Tentar de novo
        </Button>
      ) : null}
    </Moldura>
  );
}

/**
 * Vazio de verdade: ninguém montou lote ainda.
 *
 * O texto diz o que um lote É, porque esta é a primeira vez que a palavra aparece
 * para quem entrou: um recorte fechado de trabalho, montado uma vez, ligado o dia
 * inteiro sem escolher para quem ligar.
 */
export function SemLotes({ aoMontar, podeMontar }: { aoMontar: () => void; podeMontar: boolean }) {
  return (
    <Moldura
      icone={<PhoneOutgoing className="size-5" aria-hidden="true" />}
      titulo="Nenhum lote montado ainda."
      texto={
        podeMontar
          ? 'Um lote é o trabalho do turno fechado antes de começar: um funil, uma temperatura de origem e um roteiro. Você monta uma vez, e depois só liga — sem escolher para quem.'
          : 'Um lote é o trabalho do turno fechado antes de começar. Seu perfil não monta lote; peça a quem faz a captação para montar o de hoje.'
      }
    >
      {podeMontar ? (
        <Button onClick={aoMontar} className="toque h-11 md:h-9">
          <PhoneOutgoing aria-hidden="true" />
          Montar lote de hoje
        </Button>
      ) : null}
    </Moldura>
  );
}
