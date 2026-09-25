'use client';

import { useMemo } from 'react';
import { Check, TriangleAlert } from 'lucide-react';

import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

import type { Sugestao } from './mapeamento';
import {
  montarReciboDeLeitura,
  rotuloComRessalva,
  type ColunaLida,
  type ReciboDeLeitura,
} from './recibo-de-leitura';
import {
  ehObrigatorio,
  rotuloDoCampo,
  TODOS_OS_CAMPOS,
  type CampoQualquer,
  type Mapa,
  type PlanilhaLida,
} from './tipos';

/** Valor do "não importar esta coluna" no Radix Select, que não aceita valor vazio. */
const IGNORAR = '__ignorar__';

/**
 * O que o CRM leu, e só o que está em dúvida.
 *
 * POR QUÊ o passo mudou de forma (25/09/2026): ele pedia confirmação de 36
 * caixinhas para mostrar 10 acertos que a máquina já tinha feito — todos por
 * nome exato. Uma parede de 36 cartões não é conferência; é onde o aviso de
 * verdade se esconde. Agora a tela AFIRMA o que leu, pergunta só onde há
 * dúvida, e guarda a grade inteira atrás de "ver as 36 colunas".
 *
 * Duas decisões de desenho continuam valendo, e é por elas que a grade não
 * sumiu:
 *   1. Cada coluna mostra as três primeiras respostas REAIS do arquivo embaixo
 *      do nome. Sem elas, "coluna E" é um nome; com elas, é "ah, é o WhatsApp".
 *   2. O acerto só é marcado como conferido quando foi EXATO. O que casou por
 *      semelhança aparece como "Chutei — confira": um "telefone 2" que virou
 *      WhatsApp é exatamente o erro que passa despercebido se a tela disser
 *      "pronto".
 */
export function PassoMapa({
  planilha,
  mapa,
  sugestao,
  origemDoLote,
  aoMudar,
}: {
  planilha: PlanilhaLida;
  mapa: Mapa;
  sugestao: Sugestao;
  /**
   * Nome da fonte escolhida no seletor do lote. Com ela, a coluna "Origem"
   * deixa de ser obrigatória no arquivo: o CSV do Maps não tem uma.
   */
  origemDoLote: string;
  aoMudar: (mapa: Mapa) => void;
}) {
  const recibo = useMemo(
    () => montarReciboDeLeitura(planilha, mapa, sugestao, origemDoLote),
    [planilha, mapa, sugestao, origemDoLote],
  );

  /** Trocar o campo de uma coluna tira esse campo de onde ele estivesse antes. */
  const escolher = (coluna: number, valor: string) => {
    const novo: Mapa = { ...mapa };
    for (const campo of TODOS_OS_CAMPOS) {
      if (novo[campo] === coluna) delete novo[campo];
    }
    if (valor !== IGNORAR) novo[valor as CampoQualquer] = coluna;
    aoMudar(novo);
  };

  return (
    <div className="flex flex-col gap-4">
      <ReciboDasColunas planilha={planilha} recibo={recibo} />

      {recibo.pendentes.length > 0 ? (
        <p className="max-w-prose text-sm text-muted-foreground">
          Sem {recibo.pendentes.map(rotuloDoCampo).join(' e ')} o CRM não consegue criar o parceiro.
          Indique {recibo.pendentes.length === 1 ? 'a coluna' : 'as colunas'} abaixo para seguir.
        </p>
      ) : null}

      {/* Só as colunas em dúvida ficam à vista. Quem quiser mexer no resto abre
          a grade inteira, que continua inteira. */}
      {recibo.chutadas.length > 0 ? (
        <Colunas
          titulo={
            recibo.chutadas.length === 1
              ? 'Uma coluna que eu chutei — confira'
              : `${recibo.chutadas.length} colunas que eu chutei — confira`
          }
          indices={recibo.chutadas.map((c) => c.indice)}
          planilha={planilha}
          mapa={mapa}
          sugestao={sugestao}
          aoEscolher={escolher}
        />
      ) : null}

      <details className="rounded-xl border border-hairline">
        <summary className="toque cursor-pointer list-none px-3 py-3 text-sm font-medium md:py-2">
          Ver as <span className="numerico">{recibo.totalDeColunas}</span> colunas do arquivo
        </summary>
        <div className="border-t border-hairline p-3">
          <Colunas
            indices={planilha.cabecalho.map((_, i) => i)}
            planilha={planilha}
            mapa={mapa}
            sugestao={sugestao}
            aoEscolher={escolher}
          />
        </div>
      </details>

      {planilha.cortadas > 0 ? (
        <p className="text-sm text-muted-foreground">
          A planilha tem mais linhas do que o CRM lê de uma vez:{' '}
          <span className="numerico">{planilha.cortadas}</span> ficaram de fora. Divida o arquivo e
          importe em duas partes.
        </p>
      ) : null}
    </div>
  );
}

/**
 * O recibo, sozinho.
 *
 * Aparece no passo do mapa e de novo junto da prévia — porque quando não há
 * dúvida o passo do mapa nem acontece, e a pessoa precisa ver o que foi lido
 * antes de gravar.
 */
export function ReciboDasColunas({
  planilha,
  recibo,
}: {
  planilha: PlanilhaLida;
  recibo: ReciboDeLeitura;
}) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h2 className="font-heading text-lg font-semibold tracking-tight">
            O CRM leu <span className="numerico">{recibo.lidas.length}</span>{' '}
            {recibo.lidas.length === 1 ? 'coluna' : 'colunas'}
            {recibo.totalDeColunas > recibo.lidas.length ? (
              <>
                {' '}
                das <span className="numerico">{recibo.totalDeColunas}</span>
              </>
            ) : null}
          </h2>
          <p className="text-sm text-muted-foreground">
            Aba <span className="font-medium text-foreground">{planilha.aba}</span> ·{' '}
            <span className="numerico">{planilha.linhas.length}</span>{' '}
            {planilha.linhas.length === 1 ? 'linha' : 'linhas'}
          </p>
        </div>
        {recibo.precisaPerguntar ? (
          <Badge variant="destructive" className="h-auto py-1">
            <TriangleAlert aria-hidden="true" />
            {recibo.pendentes.length > 0 ? 'Falta uma coluna' : 'Confira o que eu chutei'}
          </Badge>
        ) : (
          <Badge variant="pilula" className="h-auto py-1">
            <Check aria-hidden="true" />
            Nada em dúvida
          </Badge>
        )}
      </div>

      <p className="max-w-prose text-sm leading-relaxed">
        {recibo.lidas.map(rotuloComRessalva).join(' · ')}
      </p>

      {/* Pular linha em silêncio é como a pessoa passa vinte minutos procurando
          uma coluna que o CRM decidiu que não existia. */}
      {planilha.tituloIgnorado.length > 0 ? (
        <p className="max-w-prose text-sm text-muted-foreground">
          {planilha.tituloIgnorado.length === 1
            ? 'A primeira linha foi lida como título e não como cabeçalho:'
            : 'As primeiras linhas foram lidas como título e não como cabeçalho:'}{' '}
          <span className="text-foreground">
            {planilha.tituloIgnorado.map((l) => `“${l}”`).join('; ')}
          </span>
          . O cabeçalho é a primeira linha com duas ou mais células preenchidas.
        </p>
      ) : null}

      {/* As colunas que o CRM não usa e que TÊM um porquê que vale dizer. Sem
          esta linha, quem confere vê a coluna `place_id` ignorada e conclui que
          o CRM perdeu o identificador do lugar. */}
      {recibo.ignoradas.some((i) => i.motivo) ? (
        <ul className="max-w-prose text-sm text-muted-foreground">
          {recibo.ignoradas
            .filter((i) => i.motivo)
            .map((i) => (
              <li key={i.indice}>
                <span className="font-medium text-foreground">{i.titulo}</span>: {i.motivo}
              </li>
            ))}
        </ul>
      ) : null}
    </div>
  );
}

/** A grade de colunas, para um subconjunto de índices do cabeçalho. */
function Colunas({
  titulo,
  indices,
  planilha,
  mapa,
  sugestao,
  aoEscolher,
}: {
  titulo?: string;
  indices: number[];
  planilha: PlanilhaLida;
  mapa: Mapa;
  sugestao: Sugestao;
  aoEscolher: (coluna: number, valor: string) => void;
}) {
  const porColuna = useMemo(() => {
    const saida = new Map<number, CampoQualquer>();
    for (const campo of TODOS_OS_CAMPOS) {
      const indice = mapa[campo];
      if (indice !== undefined) saida.set(indice, campo);
    }
    return saida;
  }, [mapa]);

  return (
    <div className="flex flex-col gap-2">
      {titulo ? <h3 className="text-sm font-medium">{titulo}</h3> : null}
      <ul className="grid gap-2 md:grid-cols-2">
        {indices.map((indice) => {
          const titulo = planilha.cabecalho[indice] ?? '';
          const campo = porColuna.get(indice);
          const motivo = campo ? sugestao.motivos[campo] : undefined;
          const conferir = campo !== undefined && motivo === 'parecido';
          const amostra = planilha.linhas
            .slice(0, 3)
            .map((l) => (l[indice] ?? '').trim())
            .filter(Boolean);

          return (
            <li
              key={`${titulo}-${indice}`}
              className={cn(
                'flex flex-col gap-2 rounded-xl border border-hairline p-3',
                campo === undefined && 'opacity-70',
              )}
            >
              <div className="flex min-w-0 items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate font-medium" title={titulo}>
                    {titulo || <span className="text-muted-foreground">Coluna sem título</span>}
                  </p>
                  <p className="truncate text-xs text-muted-foreground" title={amostra.join(' · ')}>
                    {amostra.length > 0 ? amostra.join(' · ') : 'Esta coluna está vazia no arquivo'}
                  </p>
                </div>
                {conferir ? (
                  <Badge variant="outline" className="shrink-0">
                    Chutei — confira
                  </Badge>
                ) : null}
              </div>

              <Select value={campo ?? IGNORAR} onValueChange={(v) => aoEscolher(indice, v)}>
                <SelectTrigger
                  className="toque h-11 w-full md:h-9"
                  aria-label={`Campo da coluna ${titulo || indice + 1}`}
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={IGNORAR}>O CRM não usa esta coluna</SelectItem>
                  {TODOS_OS_CAMPOS.map((c) => (
                    <SelectItem key={c} value={c}>
                      {rotuloDoCampo(c)}
                      {ehObrigatorio(c) ? ' (obrigatório)' : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export type { ColunaLida };
