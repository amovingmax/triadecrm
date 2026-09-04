'use client';

import { ChevronDown, Pencil, RotateCw, Target } from 'lucide-react';

import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardAction, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { formatarNumero } from '@/components/parceiros/formatos';

import { BarraProgresso } from './barra-progresso';
import { FraseDaMeta } from './frase-da-meta';
import {
  ehProxy,
  fracaoDecorrida,
  METRICA_DESTAQUE,
  percentualDaBarra,
  situacaoDaLinha,
  type LinhaProgresso,
  type Pessoa,
} from './tipos';

/**
 * O cartão de uma pessoa: a mesma estrutura para todo mundo, sempre na mesma ordem.
 *
 * Os cartões ficam lado a lado e em ordem ALFABÉTICA, nunca por desempenho: são duas
 * pessoas no time, e ordenar por resultado transformaria uma tela de acompanhamento
 * num placar. Não há posição, não há pontuação, não há cor de vitória — quem quiser
 * comparar compara, mas a tela não faz isso pela pessoa (PRD RF-MET-09, R07 §3.4:
 * ranking público só de conquista, e o risco documentado da Lei de Goodhart).
 *
 * Dentro do cartão a hierarquia é: portas abertas em número grande (a meta do plano,
 * RF-MET-01), depois as outras métricas COM meta definida, e por último, recolhido,
 * o que não tem meta e o que ainda não dá para medir.
 */
export function CartaoPessoa({
  pessoa,
  ehVoce,
  linhas,
  carregando,
  erro,
  aoTentarDeNovo,
  podeDefinir,
  aoDefinirMeta,
}: {
  pessoa: Pessoa;
  ehVoce: boolean;
  linhas: LinhaProgresso[] | undefined;
  carregando: boolean;
  erro: string | null;
  aoTentarDeNovo: () => void;
  /** Gestor e admin definem meta; para os demais o cartão nem sugere a ação. */
  podeDefinir: boolean;
  aoDefinirMeta: (metrica: string | null) => void;
}) {
  return (
    <Card className="min-w-0">
      <CardHeader>
        <div className="flex min-w-0 items-center gap-2">
          <CardTitle className="truncate">{pessoa.nome}</CardTitle>
          {ehVoce ? (
            <Badge variant="pilula" className="shrink-0 font-normal">
              você
            </Badge>
          ) : null}
        </div>
        {podeDefinir ? (
          <CardAction>
            <Button
              variant="outline"
              onClick={() => aoDefinirMeta(null)}
              className="toque h-11 md:h-8"
            >
              <Target aria-hidden="true" />
              Definir meta
            </Button>
          </CardAction>
        ) : null}
      </CardHeader>

      <CardContent className="flex flex-col gap-4">
        {carregando ? (
          <EsqueletoCartao />
        ) : erro ? (
          <ErroDoCartao causa={erro} aoTentarDeNovo={aoTentarDeNovo} />
        ) : linhas && linhas.length > 0 ? (
          <Conteudo linhas={linhas} podeDefinir={podeDefinir} aoDefinirMeta={aoDefinirMeta} />
        ) : (
          <p className="py-6 text-sm text-muted-foreground">
            O banco não devolveu nenhuma métrica para esta pessoa neste período.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function Conteudo({
  linhas,
  podeDefinir,
  aoDefinirMeta,
}: {
  linhas: LinhaProgresso[];
  podeDefinir: boolean;
  aoDefinirMeta: (metrica: string) => void;
}) {
  const destaque = linhas.find((l) => l.metrica === METRICA_DESTAQUE);
  const outras = linhas.filter((l) => l.metrica !== METRICA_DESTAQUE);
  const comMeta = outras.filter((l) => l.meta !== null);
  const semMeta = outras.filter((l) => l.meta === null);

  return (
    <>
      {destaque ? (
        <Destaque linha={destaque} podeDefinir={podeDefinir} aoDefinirMeta={aoDefinirMeta} />
      ) : null}

      {comMeta.length > 0 ? (
        <ul className="flex flex-col border-t border-hairline">
          {comMeta.map((linha) => (
            <LinhaMetrica
              key={linha.metrica}
              linha={linha}
              podeDefinir={podeDefinir}
              aoDefinirMeta={aoDefinirMeta}
            />
          ))}
        </ul>
      ) : null}

      {/* Aberto por padrão quando NADA tem meta: nesse caso a lista de realizados é o
          único conteúdo do cartão, e escondê-la deixaria um cartão vazio na tela. */}
      {semMeta.length > 0 ? (
        <details
          open={comMeta.length === 0 && destaque?.meta == null}
          className="group/detalhes border-t border-hairline pt-2"
        >
          <summary className="toque flex min-h-11 cursor-pointer list-none items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground md:min-h-8">
            <ChevronDown
              className="size-4 transition-transform group-open/detalhes:rotate-180"
              aria-hidden="true"
            />
            <span className="numerico">{formatarNumero(semMeta.length)}</span>
            <span>
              {semMeta.length === 1 ? 'métrica sem meta definida' : 'métricas sem meta definida'}
            </span>
          </summary>
          <ul className="flex flex-col">
            {semMeta.map((linha) => (
              <LinhaMetrica
                key={linha.metrica}
                linha={linha}
                podeDefinir={podeDefinir}
                aoDefinirMeta={aoDefinirMeta}
              />
            ))}
          </ul>
        </details>
      ) : null}
    </>
  );
}

/** Portas abertas: o número grande do cartão, em mono, com a barra embaixo. */
function Destaque({
  linha,
  podeDefinir,
  aoDefinirMeta,
}: {
  linha: LinhaProgresso;
  podeDefinir: boolean;
  aoDefinirMeta: (metrica: string) => void;
}) {
  const situacao = situacaoDaLinha(linha);
  const feito = linha.realizado ?? 0;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <p className="text-xs tracking-wide text-muted-foreground uppercase">
          {linha.metrica_rotulo}
        </p>
        {ehProxy(linha) ? <ChipProxy /> : null}
      </div>

      <p className="flex items-baseline gap-2 leading-none">
        <span className="numerico text-5xl font-semibold">{formatarNumero(feito)}</span>
        {linha.meta !== null ? (
          <span className="text-lg text-muted-foreground">
            de <span className="numerico">{formatarNumero(linha.meta)}</span>
          </span>
        ) : (
          <span className="text-sm text-muted-foreground">sem meta</span>
        )}
      </p>

      {linha.meta !== null ? (
        <BarraProgresso
          grossa
          percentual={percentualDaBarra(linha)}
          ritmo={fracaoDecorrida(linha)}
          rotulo={`${linha.metrica_rotulo}: ${feito} de ${linha.meta}`}
        />
      ) : null}

      <p className="text-sm text-muted-foreground">
        <FraseDaMeta linha={linha} />
      </p>

      {situacao === 'sem_meta' && podeDefinir ? (
        <Button
          variant="outline"
          onClick={() => aoDefinirMeta(linha.metrica)}
          className="toque h-11 self-start md:h-8"
        >
          <Target aria-hidden="true" />
          Definir {linha.metrica_rotulo.toLowerCase()}
        </Button>
      ) : null}
    </div>
  );
}

/** Uma métrica na lista. Quando pode definir meta, a linha inteira é o alvo de toque. */
function LinhaMetrica({
  linha,
  podeDefinir,
  aoDefinirMeta,
}: {
  linha: LinhaProgresso;
  podeDefinir: boolean;
  aoDefinirMeta: (metrica: string) => void;
}) {
  const clicavel = podeDefinir && linha.mensuravel;
  const feito = linha.realizado ?? 0;
  // "Sem meta definida" já está escrito no resumo do recolhimento logo acima; repetir
  // a mesma frase em nove linhas seguidas transforma a lista num muro de texto e
  // esconde justamente as linhas que TÊM alguma coisa a dizer.
  const mostraFrase = situacaoDaLinha(linha) !== 'sem_meta';

  const miolo = (
    <>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex min-w-0 items-center gap-1.5">
          <span className="truncate text-sm">{linha.metrica_rotulo}</span>
          {ehProxy(linha) ? <ChipProxy /> : null}
          {clicavel ? (
            <Pencil
              className="size-3 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover/linha:opacity-100"
              aria-hidden="true"
            />
          ) : null}
        </div>
        {linha.meta !== null ? (
          <BarraProgresso
            percentual={percentualDaBarra(linha)}
            ritmo={fracaoDecorrida(linha)}
            rotulo={`${linha.metrica_rotulo}: ${feito} de ${linha.meta}`}
            className="max-w-56"
          />
        ) : null}
        {mostraFrase ? (
          <p className="text-xs text-muted-foreground">
            <FraseDaMeta linha={linha} />
          </p>
        ) : null}
      </div>

      <p className="shrink-0 text-right text-sm">
        {linha.mensuravel ? (
          <>
            <span className="numerico font-medium">{formatarNumero(feito)}</span>
            {linha.meta !== null ? (
              <span className="text-muted-foreground">
                {' / '}
                <span className="numerico">{formatarNumero(linha.meta)}</span>
              </span>
            ) : null}
          </>
        ) : (
          <span className="text-muted-foreground">—</span>
        )}
      </p>
    </>
  );

  return (
    <li className="border-b border-hairline last:border-b-0">
      {clicavel ? (
        <button
          type="button"
          onClick={() => aoDefinirMeta(linha.metrica)}
          aria-label={`Definir meta de ${linha.metrica_rotulo}`}
          className={cn(
            'group/linha flex min-h-11 w-full items-start gap-3 rounded-lg px-1 py-2 text-left',
            'transition-colors outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 md:min-h-9',
          )}
        >
          {miolo}
        </button>
      ) : (
        <div className="flex min-h-11 items-start gap-3 px-1 py-2 md:min-h-9">{miolo}</div>
      )}
    </li>
  );
}

/**
 * O número existe, mas a fonte da verdade é outra. O banco escreve isso em
 * `goal_progress.fonte` ("PROXY: ... a integração ainda não está ligada") e a tela
 * repete, em vez de deixar o número passar por definitivo.
 */
function ChipProxy() {
  return (
    <Badge
      variant="pilula"
      title="Contado pelo funil do CRM. A fonte da verdade é a plataforma Komune, cuja integração ainda não está ligada."
      className="shrink-0 text-[10px] font-normal text-muted-foreground"
    >
      proxy
    </Badge>
  );
}

function EsqueletoCartao() {
  return (
    <div aria-busy="true" className="flex flex-col gap-4">
      <span className="sr-only">Carregando as metas.</span>
      <div className="flex flex-col gap-2">
        <Skeleton className="h-3 w-24" />
        <Skeleton className="h-11 w-28" />
        <Skeleton className="h-2.5 w-full rounded-full" />
        <Skeleton className="h-3.5 w-56" />
      </div>
      <div className="flex flex-col gap-3 border-t border-hairline pt-3">
        {['w-28', 'w-24', 'w-32'].map((largura) => (
          <div key={largura} className="flex items-start gap-3">
            <div className="flex flex-1 flex-col gap-1.5">
              <Skeleton className={`h-3.5 ${largura}`} />
              <Skeleton className="h-1.5 w-40 rounded-full" />
            </div>
            <Skeleton className="h-3.5 w-10" />
          </div>
        ))}
      </div>
    </div>
  );
}

function ErroDoCartao({ causa, aoTentarDeNovo }: { causa: string; aoTentarDeNovo: () => void }) {
  return (
    <div className="flex flex-col items-start gap-3 py-4">
      <p className="text-sm text-muted-foreground">{causa}</p>
      <Button variant="outline" onClick={aoTentarDeNovo} className="toque h-11 md:h-8">
        <RotateCw aria-hidden="true" />
        Tentar de novo
      </Button>
    </div>
  );
}
