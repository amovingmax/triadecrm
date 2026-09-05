'use client';

import type { ReactNode } from 'react';
import { Download } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

import { baixarCsv, montarCsv, nomeDoArquivo } from './csv';
import { mensagemDoErro } from './dados';
import { ErroDoRelatorio, EsqueletoRelatorio, NotaDeAlcance, VazioDoRelatorio } from './estados';
import type { Periodo } from './periodo';
import { TabelaRelatorio } from './tabela';
import type { Coluna, DefinicaoPainel } from './tipos';
import { baixarXlsx, montarXlsx, nomeDoArquivoXlsx } from './xlsx';

/** O que a tela precisa saber de uma consulta do TanStack Query, e nada além. */
export type EstadoDaConsulta = {
  isPending: boolean;
  isError: boolean;
  error: unknown;
  refetch: () => void;
};

/**
 * A moldura de todo painel: título, o que ele responde, exportação, resumo, tabela,
 * e a nota que diz o que esta leitura ainda não enxerga.
 *
 * Os dois botões de exportação levam as MESMAS colunas que estão na tela, na mesma
 * ordem: as definições de coluna servem aos três (ver `csv.ts` e `xlsx.ts`). Eles só
 * existem quando há linha, porque baixar um arquivo com cabeçalho e nada dentro
 * parece defeito.
 *
 * Por que os dois formatos, e não um: o CSV abre em qualquer lugar e é o que se cola
 * num e-mail; o XLSX leva o número COMO NÚMERO, com formato de milhar e de
 * percentual, e é o que soma numa célula sem ninguém ter de trocar ponto por vírgula.
 * O RF-REL-09 pede os dois, e o Rafael pediu arquivo (R07 §4).
 */
export function QuadroPainel<L>({
  painel,
  periodo,
  consulta,
  colunas,
  linhas,
  chaveDaLinha,
  grupoDaLinha,
  destaqueDaLinha,
  resumo,
  nota,
  vazio,
  colunasNoEsqueleto,
}: {
  painel: DefinicaoPainel;
  periodo: Periodo;
  consulta: EstadoDaConsulta;
  colunas: readonly Coluna<L>[];
  linhas: readonly L[];
  chaveDaLinha: (linha: L, indice: number) => string;
  grupoDaLinha?: (linha: L) => string;
  destaqueDaLinha?: (linha: L) => boolean;
  /** Faixa de números-chave acima da tabela. */
  resumo?: ReactNode;
  /** O que esta leitura ainda não alcança, e do que depende. */
  nota?: ReactNode;
  vazio?: { titulo: string; texto: string };
  colunasNoEsqueleto?: number;
}) {
  const temLinhas = linhas.length > 0;

  return (
    <section className="flex w-full flex-col gap-4" aria-label={painel.titulo}>
      <header className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="font-heading text-lg font-semibold tracking-tight">{painel.titulo}</h2>
            <Badge variant="pilula" className="h-6 px-2.5 text-[11px] font-normal">
              {painel.requisitos}
            </Badge>
          </div>
          <p className="mt-1 max-w-prose text-sm leading-relaxed text-muted-foreground">
            {painel.descricao}
          </p>
        </div>

        {temLinhas ? (
          <div className="flex items-center gap-1.5">
            <Button
              variant="outline"
              aria-label={`Baixar ${painel.titulo} em CSV`}
              className="toque h-11 md:h-8"
              onClick={() =>
                baixarCsv(nomeDoArquivo(painel.chave, periodo), montarCsv(colunas, linhas))
              }
            >
              <Download aria-hidden="true" />
              CSV
            </Button>
            <Button
              variant="outline"
              aria-label={`Baixar ${painel.titulo} em XLSX`}
              className="toque h-11 md:h-8"
              onClick={() =>
                baixarXlsx(
                  nomeDoArquivoXlsx(painel.chave, periodo),
                  montarXlsx(painel.rotulo, colunas, linhas),
                )
              }
            >
              <Download aria-hidden="true" />
              XLSX
            </Button>
          </div>
        ) : null}
      </header>

      {resumo}

      <div className="w-full">
        {consulta.isPending ? (
          <EsqueletoRelatorio colunas={colunasNoEsqueleto ?? Math.min(colunas.length, 9)} />
        ) : consulta.isError ? (
          <ErroDoRelatorio
            causa={mensagemDoErro(consulta.error)}
            aoTentar={() => consulta.refetch()}
          />
        ) : temLinhas ? (
          <TabelaRelatorio
            rotulo={painel.titulo}
            colunas={colunas}
            linhas={linhas}
            chaveDaLinha={chaveDaLinha}
            grupoDaLinha={grupoDaLinha}
            destaqueDaLinha={destaqueDaLinha}
          />
        ) : (
          <VazioDoRelatorio
            titulo={vazio?.titulo ?? 'Nada aconteceu neste período'}
            texto={
              vazio?.texto ??
              'Nenhum registro entrou nas datas escolhidas. Amplie o período ou confira se o time registrou os contatos do dia.'
            }
          />
        )}
      </div>

      {nota && !consulta.isPending && !consulta.isError ? (
        <NotaDeAlcance>{nota}</NotaDeAlcance>
      ) : null}
    </section>
  );
}

/**
 * Os números-chave acima da tabela. Cada tira é um número que muda decisão, com o
 * rótulo embaixo e, quando ajuda, o denominador em uma linha de apoio.
 */
export function TirasDeResumo({
  itens,
}: {
  itens: readonly { chave: string; rotulo: string; valor: string; apoio?: string; ajuda?: string }[];
}) {
  return (
    <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-xl bg-hairline sm:grid-cols-3 lg:grid-cols-6">
      {itens.map((item) => (
        <div key={item.chave} className="flex flex-col gap-0.5 bg-card px-3 py-2.5" title={item.ajuda}>
          <dt className="text-xs leading-tight text-muted-foreground">{item.rotulo}</dt>
          <dd className="numerico text-xl leading-tight font-medium">{item.valor}</dd>
          {item.apoio ? (
            <p className="text-[11px] leading-tight text-muted-foreground">{item.apoio}</p>
          ) : null}
        </div>
      ))}
    </dl>
  );
}
