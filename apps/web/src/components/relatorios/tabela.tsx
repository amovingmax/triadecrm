'use client';

import { Fragment, type CSSProperties, type ReactNode } from 'react';

import { cn } from '@/lib/utils';

import type { Coluna } from './tipos';

/**
 * A tabela densa dos relatórios.
 *
 * Escolha de fundo: número lado a lado vale mais que gráfico bonito, então o formato
 * padrão é tabela e o desenho entra só onde ele carrega informação que o número não
 * dá (a barra térmica da etapa, a barra de proporção na coluna de conversão).
 *
 * Linhas separadas por `border-hairline`, nunca por borda cheia: numa grade de doze
 * colunas a borda cheia vira gaiola (docs/design/sistema-visual.md).
 *
 * Toda coluna de número vai para a direita, na IBM Plex Mono com tabular-nums, para
 * a coluna alinhar na vírgula e a leitura de cima a baixo ser uma linha reta.
 *
 * No celular a tabela ROLA na horizontal dentro do próprio quadro (a página nunca
 * rola de lado) e a primeira coluna fica grudada à esquerda, para a linha nunca
 * perder o nome enquanto se anda pelos números.
 */
/**
 * Aviso de que ainda há coluna fora da tela, sem ouvinte de rolagem: quatro camadas
 * de fundo, duas presas ao conteúdo (`local`, que somem no início e no fim da
 * rolagem) e duas presas ao contêiner (`scroll`), que só aparecem quando as
 * primeiras saem de baixo delas. É o mesmo recurso da tabela de Parceiros — a tabela
 * de relatório tem até 22 colunas e sem ele ninguém descobre que há mais à direita.
 */
const SOMBRA_DE_ROLAGEM: CSSProperties = {
  backgroundImage: [
    'linear-gradient(to right, var(--background), transparent)',
    'linear-gradient(to left, var(--background), transparent)',
    'linear-gradient(to right, color-mix(in oklab, var(--foreground) 10%, transparent), transparent)',
    'linear-gradient(to left, color-mix(in oklab, var(--foreground) 10%, transparent), transparent)',
  ].join(', '),
  backgroundPosition: 'left center, right center, left center, right center',
  backgroundRepeat: 'no-repeat',
  backgroundSize: '2rem 100%, 2rem 100%, 0.75rem 100%, 0.75rem 100%',
  backgroundAttachment: 'local, local, scroll, scroll',
};

export function TabelaRelatorio<L>({
  rotulo,
  colunas,
  linhas,
  chaveDaLinha,
  grupoDaLinha,
  destaqueDaLinha,
}: {
  /** Nome da tabela para leitor de tela (`aria-label`). */
  rotulo: string;
  colunas: readonly Coluna<L>[];
  linhas: readonly L[];
  chaveDaLinha: (linha: L, indice: number) => string;
  /** Título da faixa que separa blocos (o funil, por exemplo, agrupa por pipeline). */
  grupoDaLinha?: (linha: L) => string;
  /** Deixa a linha em peso maior (totais, linha de destaque). */
  destaqueDaLinha?: (linha: L) => boolean;
}) {
  // As colunas que aparecem na tela: as de `soNoCsv` existem só no arquivo.
  const visiveis = colunas.filter((coluna) => !coluna.soNoCsv);

  // O título de faixa de cada linha (ou nulo quando ela continua no mesmo grupo),
  // calculado antes de desenhar: variável reatribuída dentro do `map` seria estado
  // escondido no meio da renderização, e o React não garante que ele sobreviva.
  const titulosDeGrupo = linhas.map((linha, indice) => {
    if (!grupoDaLinha) return null;
    const grupo = grupoDaLinha(linha);
    const anterior = indice > 0 ? linhas[indice - 1] : undefined;
    const grupoAnterior = anterior ? grupoDaLinha(anterior) : null;
    return grupo === grupoAnterior ? null : grupo;
  });

  return (
    <div className="relative w-full overflow-x-auto" style={SOMBRA_DE_ROLAGEM}>
      <table className="corpo-tabela w-full min-w-max border-collapse text-sm" aria-label={rotulo}>
        <thead>
          <tr className="border-b border-hairline">
            {visiveis.map((coluna) => (
              <th
                key={coluna.chave}
                scope="col"
                title={coluna.ajuda}
                className={cn(
                  'h-9 px-2 align-bottom text-xs font-medium whitespace-nowrap text-muted-foreground',
                  coluna.numero ? 'text-right' : 'text-left',
                  coluna.fixa && 'sticky left-0 z-10 bg-background',
                  coluna.classe,
                )}
              >
                {coluna.rotulo}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {linhas.map((linha, indice) => {
            const grupo = titulosDeGrupo[indice] ?? null;

            return (
              <Fragment key={chaveDaLinha(linha, indice)}>
                {grupo !== null ? (
                  <tr>
                    <th
                      scope="colgroup"
                      colSpan={visiveis.length}
                      className="bg-muted/40 px-2 py-1.5 text-left text-xs font-semibold tracking-wide text-foreground"
                    >
                      {grupo}
                    </th>
                  </tr>
                ) : null}
                <tr
                  className={cn(
                    'border-b border-hairline transition-colors hover:bg-muted/40',
                    destaqueDaLinha?.(linha) && 'font-medium',
                  )}
                >
                  {visiveis.map((coluna) => (
                    <td
                      key={coluna.chave}
                      className={cn(
                        'px-2 py-2 align-middle whitespace-nowrap',
                        coluna.numero ? 'numerico text-right' : 'text-left',
                        coluna.fixa && 'sticky left-0 z-10 bg-background',
                        coluna.classe,
                      )}
                    >
                      {coluna.fixa ? (
                        // A coluna de identidade fica grudada à esquerda enquanto a
                        // tabela rola; se ela mesma for mais larga que o celular
                        // ("Produtoras corporativas/shows e organizadores
                        // recorrentes" mede 380px), ela tapa a tabela inteira e não
                        // sobra número nenhum para ver. Aqui ela é cortada com
                        // reticências no estreito, e o nome inteiro fica no `title`.
                        <span
                          className="block max-w-[9.5rem] truncate md:max-w-none"
                          title={coluna.texto(linha)}
                        >
                          {coluna.celula ? coluna.celula(linha) : coluna.texto(linha)}
                        </span>
                      ) : coluna.celula ? (
                        coluna.celula(linha)
                      ) : (
                        coluna.texto(linha)
                      )}
                    </td>
                  ))}
                </tr>
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/**
 * O marcador de "não dá para calcular", que é diferente de zero.
 *
 * Zero é resultado ("ninguém abriu a porta"); `n/d` é ausência de denominador
 * ("ninguém bateu, então não há taxa"). Com 100 parceiros essa diferença aparece em
 * quase toda tabela, e trocar uma pela outra faria o time comemorar ou se assustar
 * com um número que não existe.
 */
export function SemDado({ motivo = 'sem base para calcular' }: { motivo?: string }) {
  return (
    <span className="text-xs text-muted-foreground" title={motivo}>
      n/d<span className="sr-only"> ({motivo})</span>
    </span>
  );
}

/**
 * Barra de proporção dentro da célula, na rampa neutra dos tokens `chart-*`.
 *
 * Não é enfeite: a mesma coluna com trinta números iguais em largura não mostra onde
 * está o acúmulo, e a barra mostra. A cor é neutra de propósito — cromia neste
 * produto é escala térmica, e uma barra colorida aqui competiria com ela.
 */
export function BarraProporcao({
  valor,
  maximo,
  className,
}: {
  valor: number;
  maximo: number;
  className?: string;
}) {
  const fracao = maximo > 0 ? Math.max(0, Math.min(1, valor / maximo)) : 0;

  // Zero não desenha trilho: com trinta linhas zeradas (que é o normal numa base de
  // cem parceiros), trinta trilhos vazios viram uma grade cinza que compete com o
  // número. A altura fica reservada assim mesmo, para a linha não pular.
  if (fracao === 0) {
    return <span aria-hidden="true" className={cn('block h-1.5 w-full', className)} />;
  }

  return (
    <span
      aria-hidden="true"
      className={cn('block h-1.5 w-full overflow-hidden rounded-full bg-muted', className)}
    >
      <span
        className="block h-full rounded-full bg-chart-3"
        style={{ width: `${(fracao * 100).toFixed(1)}%` }}
      />
    </span>
  );
}

/** Célula de número com barra embaixo: o valor manda, a barra dá o relevo. */
export function NumeroComBarra({
  texto,
  valor,
  maximo,
}: {
  texto: ReactNode;
  valor: number;
  maximo: number;
}) {
  return (
    // A barra tem largura fixa (`w-24`): numa tabela de quatro colunas o trilho
    // esticado até o fim da célula media 270px e passava a ler como gráfico, e não
    // como o acento que ele é. Com a mesma largura em toda tabela, as barras de
    // painéis diferentes ficam comparáveis entre si.
    <span className="ml-auto flex w-24 flex-col items-end gap-1">
      <span>{texto}</span>
      <BarraProporcao valor={valor} maximo={maximo} />
    </span>
  );
}
