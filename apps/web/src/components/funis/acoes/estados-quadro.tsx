'use client';

/**
 * Os jeitos de o quadro não ser um quadro: carregando, falhou, vazio de verdade,
 * vazio por filtro, e o funil de ativação — que não é nenhuma das quatro coisas.
 *
 * Cada estado diz o que aconteceu E o que fazer. "Nenhum resultado" sem saída manda
 * a pessoa adivinhar; aqui o botão da saída está sempre na tela.
 */
import { FilterX, RotateCw, SquareKanban, Workflow } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';

import type { EtapaQuadro } from '../tipos';
import { traduzirFalha } from './erros';

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
    <div className="flex flex-col items-center gap-3 px-6 py-16 text-center">
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

/**
 * Espera: a forma do quadro, não um giro no meio da tela. As colunas já ocupam o
 * lugar onde os cartões vão aparecer, e a troca não empurra nada.
 */
export function EsqueletoQuadro() {
  return (
    <div aria-busy="true" aria-live="polite">
      <span className="sr-only">Carregando o quadro do funil.</span>
      <div className="flex gap-3 overflow-hidden">
        {Array.from({ length: 5 }, (_, coluna) => (
          <div key={coluna} className="flex w-72 shrink-0 flex-col gap-2">
            <div className="flex items-center justify-between px-1">
              <Skeleton className="h-3.5 w-28" />
              <Skeleton className="h-3.5 w-6" />
            </div>
            {Array.from({ length: 4 - (coluna % 3) }, (_, cartao) => (
              <Skeleton key={cartao} className="h-[76px] w-full rounded-xl" />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

/** Falhou: a frase é a de `traduzirFalha`, nunca o texto do Postgres. */
export function ErroDoQuadro({ causa, aoTentar }: { causa: unknown; aoTentar: () => void }) {
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

/** O funil existe e está vazio: não há filtro a limpar, há negócio a criar. */
export function QuadroVazio({ nomeDoFunil }: { nomeDoFunil: string }) {
  return (
    <Moldura
      icone={<SquareKanban className="size-5" aria-hidden="true" />}
      titulo={`Nenhum negócio em ${nomeDoFunil}`}
      texto="Cada parceiro cadastrado entra no funil automaticamente. Comece cadastrando um parceiro ou revisando os candidatos do Radar."
    />
  );
}

/** O recorte é que não devolveu nada: a saída é afrouxar o recorte. */
export function QuadroVazioPorFiltro({
  descricao,
  aoLimpar,
}: {
  descricao: string;
  aoLimpar: () => void;
}) {
  return (
    <Moldura
      icone={<FilterX className="size-5" aria-hidden="true" />}
      titulo="Nenhum cartão com esse recorte"
      texto={descricao}
    >
      <Button variant="outline" onClick={aoLimpar} className="toque h-11 md:h-9">
        <FilterX aria-hidden="true" />
        Limpar o recorte
      </Button>
    </Moldura>
  );
}

/**
 * O funil de ativação (PRD §6, v1).
 *
 * Ele não é um quadro de trabalho: as etapas mudam quando a plataforma Komune avisa
 * que o fornecedor publicou, recebeu um lead, respondeu, contratou. Ninguém arrasta
 * nada aqui, e um quadro com doze colunas vazias e arrasto habilitado ensinaria o
 * contrário. Então a tela mostra o que ele É — a régua de etapas com a contagem real
 * do banco — e diz de onde virão os cartões.
 */
export function PainelDeAtivacao({
  etapas,
  nomeDoFunil,
}: {
  etapas: EtapaQuadro[];
  nomeDoFunil: string;
}) {
  const total = etapas.reduce((soma, etapa) => soma + etapa.total, 0);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-start gap-3 rounded-xl border border-hairline bg-muted/40 p-4">
        <Workflow aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
        <div className="space-y-1 text-sm">
          <p className="font-medium">{nomeDoFunil} anda sozinho.</p>
          <p className="text-muted-foreground">
            As etapas mudam quando a plataforma Komune avisa que o fornecedor publicou o perfil,
            recebeu um lead, respondeu e fechou a primeira contratação. Ninguém arrasta cartão aqui:
            por isso a tela mostra a régua e não um quadro. A ligação com a plataforma entra depois
            do MVP.
          </p>
        </div>
      </div>

      <ol className="flex flex-col overflow-hidden rounded-xl border border-hairline">
        {etapas.map((etapa, indice) => (
          <li
            key={etapa.id}
            className="flex items-center gap-3 border-b border-hairline px-3 py-3 last:border-b-0"
          >
            <span className="numerico w-5 shrink-0 text-xs text-muted-foreground">
              {indice + 1}
            </span>
            <span className="min-w-0 flex-1 truncate text-sm font-medium">{etapa.name}</span>
            <span className="numerico shrink-0 text-sm text-muted-foreground">{etapa.total}</span>
          </li>
        ))}
      </ol>

      <p className="text-sm text-muted-foreground">
        <span className="numerico">{total}</span>
        {total === 1 ? ' negócio neste funil hoje.' : ' negócios neste funil hoje.'}
      </p>
    </div>
  );
}
