'use client';

/**
 * Os jeitos de o quadro não ser um quadro: carregando, falhou, vazio de verdade e
 * vazio por filtro.
 *
 * Cada estado diz o que aconteceu E o que fazer. "Nenhum resultado" sem saída manda
 * a pessoa adivinhar; aqui o botão da saída está sempre na tela.
 */
import Link from 'next/link';
import { FilterX, RotateCw, SquareKanban } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';

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
    <div className="sombra-base flex flex-col items-center gap-3 rounded-xl bg-card px-6 py-14 text-center">
      <span className="flex size-10 items-center justify-center rounded-full bg-muted text-foreground">
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

/**
 * O funil existe e está vazio: não há filtro a limpar, há contato a fazer.
 *
 * Desde 07/10/2026 "vazio" não quer dizer base vazia: quem foi aprovado e ainda
 * não recebeu mensagem está em Prospectados, fora do quadro. A saída que o texto
 * aponta é a que põe gente aqui — a primeira mensagem.
 */
export function QuadroVazio({ nomeDoFunil }: { nomeDoFunil: string }) {
  return (
    <Moldura
      icone={<SquareKanban className="size-5" aria-hidden="true" />}
      titulo={`Ninguém em ${nomeDoFunil} ainda`}
      texto="O funil começa em Contatado: o parceiro entra aqui quando recebe a primeira mensagem ou quando um contato registrado muda a etapa dele. Quem ainda não foi contatado está em Prospectados."
    >
      <Button asChild variant="outline" className="toque h-11 md:h-9">
        <Link href="/parceiros">Abrir Prospectados</Link>
      </Button>
    </Moldura>
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
