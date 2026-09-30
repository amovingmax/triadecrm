'use client';

import { useMemo } from 'react';
import { ChevronRight } from 'lucide-react';

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
import { montarReciboDeLeitura, type ColunaLida } from './recibo-de-leitura';
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

  // UM CARTÃO COM UMA PERGUNTA (30/09/2026). O passo abria com o recibo inteiro
  // ("O CRM leu 10 colunas das 36", a lista das lidas e das ignoradas) antes de
  // dizer o que precisava da pessoa. Agora o título É a pergunta, e o recibo
  // mora no cartão do arquivo, atrás de um "ver". Quando falta coluna
  // obrigatória, a grade inteira já nasce aberta: escondida atrás de "ver as
  // colunas", a pessoa não achava onde responder.
  const faltaColuna = recibo.pendentes.length > 0;

  return (
    <section
      aria-labelledby="colunas-titulo"
      className="sombra-base flex flex-col gap-4 rounded-xl bg-card p-4 sm:p-5"
    >
      <header className="flex flex-col gap-1">
        <h2 id="colunas-titulo" className="text-lg font-semibold tracking-[-0.01em]">
          {faltaColuna
            ? `Qual coluna tem ${recibo.pendentes.map(rotuloDoCampo).join(' e ').toLowerCase()}?`
            : 'Confira as colunas que o CRM adivinhou'}
        </h2>
        <p className="max-w-[90ch] text-sm text-muted-foreground">
          {faltaColuna
            ? 'Sem essa informação o CRM não consegue criar o parceiro. Escolha a coluna certa na lista abaixo.'
            : 'Elas foram reconhecidas por um nome parecido, e não igual. Se alguma estiver errada, troque.'}
        </p>
      </header>

      {/* Só as colunas em dúvida ficam à vista. Quem quiser mexer no resto abre
          a grade inteira, que continua inteira. */}
      {recibo.chutadas.length > 0 ? (
        <Colunas
          indices={recibo.chutadas.map((c) => c.indice)}
          planilha={planilha}
          mapa={mapa}
          sugestao={sugestao}
          aoEscolher={escolher}
        />
      ) : null}

      <details open={faltaColuna} className="group/colunas border-t border-hairline pt-2">
        <summary className="toque flex min-h-11 cursor-pointer list-none items-center gap-1.5 text-[13px] text-muted-foreground transition-colors hover:text-foreground sm:min-h-8">
          <ChevronRight
            className="size-3.5 shrink-0 transition-transform group-open/colunas:rotate-90"
            aria-hidden="true"
          />
          {faltaColuna ? 'Todas as' : 'Ver todas as'}{' '}
          <span className="numerico">{recibo.totalDeColunas}</span> colunas do arquivo
        </summary>
        <div className="mt-2">
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
        <p className="text-[13px] text-muted-foreground">
          A planilha tem mais linhas do que o CRM lê de uma vez:{' '}
          <span className="numerico">{planilha.cortadas}</span> ficaram de fora. Divida o arquivo e
          importe em duas partes.
        </p>
      ) : null}
    </section>
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
                'flex flex-col gap-2 rounded-lg bg-muted/45 p-3',
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
                  <Badge variant="outline" className="shrink-0 bg-card">
                    Confira
                  </Badge>
                ) : null}
              </div>

              <Select value={campo ?? IGNORAR} onValueChange={(v) => aoEscolher(indice, v)}>
                <SelectTrigger
                  className="toque h-11 w-full bg-card md:h-9"
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
