'use client';

import { CalendarClock, CircleCheck, RotateCw, TriangleAlert } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';

import { faltamAte } from './chamada-cabecalho';
import { fraseDoBloqueio, HORARIO_PERMITIDO } from './chamada-janela';
import { type EstadoDaJanela } from './tipos';

/**
 * Os quatro jeitos de a tela de ligar não ter um contato na frente, e o que cada um
 * manda a pessoa fazer. Nenhum deles é um giro no meio da tela nem texto cru do
 * Postgres: quem não tem para quem ligar precisa saber por quê e qual é o próximo passo.
 */

/** Espera: o mesmo desenho da tela final, para o olho já se posicionar. */
export function EsqueletoDaChamada() {
  return (
    <div aria-busy="true" aria-live="polite" className="flex flex-col gap-6">
      <span className="sr-only">Puxando o próximo contato da fila.</span>

      <div className="flex flex-col gap-2">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-4 w-80" />
        <Skeleton className="h-4 w-52" />
      </div>

      <div className="flex flex-col gap-3 rounded-xl border border-hairline bg-card p-5">
        <Skeleton className="h-9 w-64" />
        <div className="flex flex-col gap-2 sm:flex-row">
          <Skeleton className="h-12 flex-1" />
          <Skeleton className="h-12 flex-1" />
          <Skeleton className="h-12 w-32" />
        </div>
      </div>

      <div className="flex flex-col gap-4">
        <Skeleton className="h-8 w-full max-w-2xl" />
        <Skeleton className="h-8 w-4/5 max-w-xl" />
        <div className="grid gap-2 sm:grid-cols-2">
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} className="h-14" />
          ))}
        </div>
      </div>
    </div>
  );
}

/** A fila acabou: é vitória, e o passo seguinte é montar outro lote. */
export function FilaAcabou({
  falados,
  total,
  aoMontarOutro,
}: {
  falados: number;
  total: number;
  aoMontarOutro: () => void;
}) {
  return (
    <Moldura
      icone={<CircleCheck className="size-5" aria-hidden="true" />}
      titulo="Acabou a fila deste lote"
      texto={`Foram ${total} contatos, ${falados} conversas. Monte o próximo lote quando quiser voltar.`}
    >
      <Button type="button" onClick={aoMontarOutro}>
        Montar outro lote
      </Button>
    </Moldura>
  );
}

/**
 * Fora da janela (R13 §6): a fila não entrega contato, e a tela diz até quando.
 * A contagem regressiva existe para a pessoa DECIDIR — "faltam 12 minutos" faz ela
 * esperar; "bloqueado" faz ela ficar tentando.
 */
export function ForaDaJanela({
  janela,
  aoTentarDeNovo,
}: {
  janela: Extract<EstadoDaJanela, { aberta: false }>;
  aoTentarDeNovo: () => void;
}) {
  return (
    <Moldura
      icone={<CalendarClock className="size-5" aria-hidden="true" />}
      titulo="Fora do horário de ligação"
      texto={`${fraseDoBloqueio(janela)}${
        janela.abreEm ? ` Faltam ${faltamAte(janela.abreEm)}.` : ''
      } ${HORARIO_PERMITIDO}`}
    >
      <Button type="button" variant="outline" onClick={aoTentarDeNovo}>
        <RotateCw aria-hidden="true" />
        Verificar de novo
      </Button>
    </Moldura>
  );
}

/** Recusa nomeada pelo banco ou falha de rede: uma frase e uma saída. */
export function ErroDaChamada({
  frase,
  aoTentarDeNovo,
  aoVoltar,
}: {
  frase: string;
  aoTentarDeNovo: (() => void) | null;
  aoVoltar: () => void;
}) {
  return (
    <Moldura
      icone={<TriangleAlert className="size-5" aria-hidden="true" />}
      titulo="Não deu para seguir"
      texto={frase}
    >
      {aoTentarDeNovo ? (
        <Button type="button" onClick={aoTentarDeNovo}>
          <RotateCw aria-hidden="true" />
          Tentar de novo
        </Button>
      ) : null}
      <Button type="button" variant="outline" onClick={aoVoltar}>
        Voltar aos lotes
      </Button>
    </Moldura>
  );
}

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
    <div className="flex flex-col items-center gap-3 rounded-xl border border-hairline bg-card px-6 py-14 text-center">
      <span className="flex size-10 items-center justify-center rounded-lg bg-muted text-muted-foreground">
        {icone}
      </span>
      <h2 className="text-lg font-medium">{titulo}</h2>
      <p className="max-w-md text-sm text-balance text-muted-foreground">{texto}</p>
      {children ? <div className="mt-2 flex flex-wrap justify-center gap-2">{children}</div> : null}
    </div>
  );
}
