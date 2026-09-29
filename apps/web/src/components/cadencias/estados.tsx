'use client';

import Link from 'next/link';
import { RotateCw, Route, SquareKanban } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';

/**
 * Espera, vazio e falha — os três jeitos de a tela não ter o que mostrar.
 *
 * "Nenhuma organização em cadência" não é falha e não é sucesso: é o estado real de
 * um produto que subiu a régua antes de matricular alguém. A tela diz isso com todas
 * as letras e aponta para as portas que realmente existem — o botão do cartão e a
 * folha de mover do funil.
 */

/** Espera no formato final: os quatro tetos e o cartão da cadência com a trilha. */
export function EsqueletoDasCadencias() {
  return (
    <div aria-busy="true" aria-live="polite" className="flex flex-col gap-5">
      <span className="sr-only">Carregando as cadências.</span>
      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <li key={i} className="sombra-base flex flex-col gap-3 rounded-xl bg-card p-5">
            <Skeleton className="h-7 w-24 rounded-full" />
            <Skeleton className="h-10 w-16" />
            <Skeleton className="h-1.5 w-full rounded-full" />
          </li>
        ))}
      </ul>
      {Array.from({ length: 3 }, (_, i) => (
        <div key={i} className="sombra-base flex flex-col gap-4 rounded-xl bg-card p-5">
          <div className="flex items-start justify-between gap-3">
            <div className="flex flex-1 flex-col gap-2">
              <Skeleton className="h-5 w-52" />
              <Skeleton className="h-3 w-72" />
            </div>
            <Skeleton className="h-9 w-28 rounded-full" />
          </div>
          <div className="flex gap-3">
            {Array.from({ length: 4 }, (_, j) => (
              <Skeleton key={j} className="h-8 w-24 rounded-full" />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

/** Espera do resumo: o bloco de honestidade, os contadores e a lista. */
export function EsqueletoDoResumo() {
  return (
    <div aria-busy="true" aria-live="polite" className="flex flex-col gap-5">
      <span className="sr-only">Carregando o resumo do dia.</span>
      <Skeleton className="h-4 w-80" />
      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <li key={i} className="sombra-base flex flex-col gap-2 rounded-xl bg-card p-5">
            <Skeleton className="h-3 w-20" />
            <Skeleton className="h-6 w-10" />
          </li>
        ))}
      </ul>
      <div className="flex flex-col gap-2">
        {Array.from({ length: 5 }, (_, i) => (
          <div key={i} className="flex items-start gap-3 border-b border-hairline py-3 pl-4">
            <div className="flex flex-1 flex-col gap-2">
              <Skeleton className="h-4 w-56" />
              <Skeleton className="h-3 w-40" />
            </div>
            <Skeleton className="h-3 w-10" />
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * A régua existe, mas ninguém entrou nela ainda.
 *
 * Não é comemoração e não é erro: nenhuma matrícula significa que nenhum toque vai
 * nascer, e é isso que a frase tem de dizer.
 *
 * Até 09/09 esta frase mandava a pessoa "para o funil" — e no funil não havia porta
 * nenhuma: `matricular_em_cadencia` existia no banco e nada no produto a chamava. O
 * texto apontava para uma saída que não existia, que é a pior espécie de estado vazio.
 * Agora há duas portas de verdade, e o texto diz as duas: o botão "Matricular" em cada
 * cartão abaixo, e a folha que se abre no funil depois de mover um cartão de etapa.
 *
 * Para quem não matricula (`leitura`, `financeiro`, `embaixador`), o botão do cartão
 * não existe — então a frase não promete um botão que ela não vai encontrar.
 */
export function NinguemEmCadencia({
  quantasLigadas,
  podeMatricular,
}: {
  quantasLigadas: number;
  /** `app.pode_matricular()`, lido do banco. */
  podeMatricular: boolean;
}) {
  // UMA LINHA, e não um cartão de 290px com ícone, título e parágrafo
  // (29/09/2026): o vazio é um aviso sobre as réguas logo abaixo, e não o
  // assunto da tela. O que ele precisa dizer cabe numa frase e num botão.
  return (
    <div className="sombra-base flex flex-col gap-3 rounded-xl bg-card p-4 sm:flex-row sm:items-center sm:gap-4">
      <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-muted text-foreground">
        <Route className="size-4" aria-hidden="true" strokeWidth={1.75} />
      </span>
      <p className="min-w-0 flex-1 text-sm">
        <span className="font-medium">Ninguém está em cadência ainda.</span>{' '}
        <span className="text-muted-foreground">
          {quantasLigadas === 0
            ? 'Nenhuma régua aceita matrícula agora.'
            : podeMatricular
              ? 'Use “Matricular” numa régua abaixo, ou mova um cartão de etapa no funil.'
              : 'Quem matricula é admin, gestor ou SDR.'}
        </span>
      </p>
      <Button asChild variant="outline" className="toque h-11 shrink-0 self-start sm:self-auto md:h-9">
        <Link href="/funis">
          <SquareKanban aria-hidden="true" />
          Abrir o funil
        </Link>
      </Button>
    </div>
  );
}

/** Falhou: diz em português o que houve e o que fazer, nunca o texto cru do Postgres. */
export function ErroDaTela({
  titulo,
  causa,
  aoTentar,
}: {
  titulo: string;
  causa: string;
  aoTentar: () => void;
}) {
  return (
    <div className="sombra-base flex flex-col items-center gap-3 rounded-xl bg-card px-6 py-14 text-center">
      <span className="flex size-10 items-center justify-center rounded-full bg-muted text-foreground">
        <RotateCw className="size-5" aria-hidden="true" />
      </span>
      <div className="space-y-1">
        <p className="font-heading font-medium">{titulo}</p>
        <p className="mx-auto max-w-sm text-sm text-muted-foreground">
          {causa} Tente de novo; se continuar, avise no grupo do time.
        </p>
      </div>
      <Button variant="outline" onClick={aoTentar} className="toque h-11 md:h-9">
        <RotateCw aria-hidden="true" />
        Tentar de novo
      </Button>
    </div>
  );
}
