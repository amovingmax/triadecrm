'use client';

import { CalendarCheck, CalendarPlus, RotateCw } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';

/**
 * As três formas de a agenda não ter cartão: carregando, dia vazio e falha.
 *
 * O esqueleto tem o desenho FINAL do dia (cabeçalho de bloco, barra térmica na
 * borda, coluna de hora, duas linhas de texto e a fileira de botões), não um giro no
 * meio da tela: o olho já se posiciona onde o conteúdo vai aparecer.
 */
export function EsqueletoAgenda() {
  return (
    <div aria-busy="true" aria-live="polite" className="flex flex-col gap-6">
      <span className="sr-only">Carregando a agenda.</span>
      {[3, 2].map((linhas, bloco) => (
        <section key={bloco} className="flex flex-col gap-2">
          <Skeleton className="h-3.5 w-40" />
          <ul className="flex flex-col">
            {Array.from({ length: linhas }, (_, i) => (
              <li
                key={i}
                className="relative flex min-h-24 items-start gap-3 border-b border-hairline py-3 pl-4"
              >
                <Skeleton className="absolute top-3 left-0 h-12 w-[3px] rounded-none" />
                <Skeleton className="mt-0.5 h-4 w-11 shrink-0" />
                <div className="flex min-w-0 flex-1 flex-col gap-2">
                  <Skeleton className="h-4 w-52 max-w-full" />
                  <Skeleton className="h-3 w-36" />
                  <div className="flex gap-2 pt-1">
                    <Skeleton className="h-9 w-28" />
                    <Skeleton className="h-9 w-32" />
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

/**
 * Dia sem nada marcado. Não é erro nem tela quebrada: é um dia livre, e o que a
 * pessoa precisa saber é para onde ir agora — o próximo compromisso, quando existe,
 * ou o caminho de marcar um.
 */
export function VazioDoDia({
  frase,
  acao,
}: {
  frase: string;
  acao: { rotulo: string; aoClicar: () => void } | null;
}) {
  return (
    <Moldura
      icone={<CalendarCheck className="size-5" aria-hidden="true" />}
      titulo="Nada marcado para este dia"
      texto={frase}
    >
      {acao ? (
        <Button variant="outline" onClick={acao.aoClicar} className="toque h-11 md:h-9">
          <CalendarPlus aria-hidden="true" />
          {acao.rotulo}
        </Button>
      ) : null}
    </Moldura>
  );
}

/** Falhou: diz o que aconteceu e o que fazer, sem texto cru do Postgres. */
export function ErroDaAgendaNaTela({
  causa,
  podeTentar,
  aoTentar,
}: {
  causa: string;
  podeTentar: boolean;
  aoTentar: () => void;
}) {
  return (
    <Moldura
      icone={<RotateCw className="size-5" aria-hidden="true" />}
      titulo="Não deu para carregar a agenda"
      texto={
        podeTentar
          ? `${causa} Confira a conexão e tente de novo. Se continuar, avise no grupo do time.`
          : causa
      }
    >
      {podeTentar ? (
        <Button variant="outline" onClick={aoTentar} className="toque h-11 md:h-9">
          <RotateCw aria-hidden="true" />
          Tentar de novo
        </Button>
      ) : null}
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
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-3 px-6 py-14 text-center">
      <span className="flex size-10 items-center justify-center rounded-xl bg-muted text-muted-foreground">
        {icone}
      </span>
      <div className="space-y-1">
        <p className="font-heading font-medium">{titulo}</p>
        <p className="mx-auto max-w-sm text-sm text-muted-foreground">{texto}</p>
      </div>
      {children}
    </div>
  );
}
