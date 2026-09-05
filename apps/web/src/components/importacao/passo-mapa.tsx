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

import { faltando, type Sugestao } from './mapeamento';
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
 * Passo 2: coluna por coluna.
 *
 * A tela sugere e a pessoa corrige. Duas decisões de desenho sustentam isso:
 *
 *   1. Cada coluna mostra as três primeiras respostas REAIS do arquivo embaixo do
 *      nome. Sem elas, "coluna E" é um nome; com elas, é "ah, é o WhatsApp". É o
 *      que faz a correção acontecer em segundos em vez de exigir abrir a planilha.
 *   2. O acerto só é marcado como conferido quando foi EXATO. O que casou por
 *      semelhança aparece como "confira": um "telefone 2" que virou WhatsApp é
 *      exatamente o erro que passa despercebido se a tela disser "pronto".
 */
export function PassoMapa({
  planilha,
  mapa,
  sugestao,
  aoMudar,
}: {
  planilha: PlanilhaLida;
  mapa: Mapa;
  sugestao: Sugestao;
  aoMudar: (mapa: Mapa) => void;
}) {
  const porColuna = useMemo(() => {
    const saida = new Map<number, CampoQualquer>();
    for (const campo of TODOS_OS_CAMPOS) {
      const indice = mapa[campo];
      if (indice !== undefined) saida.set(indice, campo);
    }
    return saida;
  }, [mapa]);

  const pendentes = faltando(mapa);

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
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h2 className="font-heading text-lg font-semibold tracking-tight">O que é cada coluna</h2>
          <p className="text-sm text-muted-foreground">
            Aba <span className="font-medium text-foreground">{planilha.aba}</span> ·{' '}
            <span className="numerico">{planilha.linhas.length}</span>{' '}
            {planilha.linhas.length === 1 ? 'linha' : 'linhas'} ·{' '}
            <span className="numerico">{planilha.cabecalho.length}</span> colunas
          </p>
        </div>
        {pendentes.length > 0 ? (
          <Badge variant="destructive" className="h-auto py-1">
            <TriangleAlert aria-hidden="true" />
            Falta indicar: {pendentes.map(rotuloDoCampo).join(', ')}
          </Badge>
        ) : (
          <Badge variant="pilula" className="h-auto py-1">
            <Check aria-hidden="true" />
            Tudo que é obrigatório está indicado
          </Badge>
        )}
      </div>

      <ul className="grid gap-2 md:grid-cols-2">
        {planilha.cabecalho.map((titulo, indice) => {
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
                    {amostra.length > 0 ? amostra.join(' · ') : 'Sem exemplos nesta coluna'}
                  </p>
                </div>
                {conferir ? (
                  <Badge variant="outline" className="shrink-0">
                    Confira
                  </Badge>
                ) : null}
              </div>

              <Select value={campo ?? IGNORAR} onValueChange={(v) => escolher(indice, v)}>
                <SelectTrigger
                  className="toque h-11 w-full md:h-9"
                  aria-label={`Campo da coluna ${titulo || indice + 1}`}
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={IGNORAR}>Não importar esta coluna</SelectItem>
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
