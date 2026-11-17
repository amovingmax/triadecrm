'use client';

import { useId, useState } from 'react';
import { ChevronDown, CircleCheck, Wrench } from 'lucide-react';

import { cn } from '@/lib/utils';

import type { LacunaDaIA, PainelProgressoIA } from '../dados-vende';
import {
  comoCorrigirLacuna,
  contagem,
  diaMes,
  inteiro,
  lista,
  numero,
  plural,
  rotuloDaLacuna,
  type Tom,
} from '../formatos-vende';
import { Cartao, SemDado } from '../graficos-vende';

import { tempoDaIA } from './resumo';

/**
 * O que ainda falta (16/11/2026): onde a avaliação diária achou falha na IA, em
 * ranking. A maior falha é a "prioridade", com o "como corrigir" à vista; as outras
 * vêm compactas, com o conserto em letra menor. Dono: o agente "lacunas".
 *
 * A conta é do banco (`relatorio_imova_painel_ia()`): `agora` são as falhas dos
 * últimos 28 dias e `antes` as dos 28 dias anteriores, em janela corrida. Por isso a
 * comparação só existe quando as duas janelas são inteiras de IA (ver `comparacaoDa`):
 * antes disso a janela anterior é, no todo ou em parte, de antes de a IA existir, e
 * "▲ eram 0" em toda linha seria mentira.
 */

/** Quantas linhas aparecem antes do "ver todas": a prioridade e mais 4. */
const LIMITE = 5;

const TOM: Record<Tom, string> = {
  bom: 'text-cliente-texto',
  ruim: 'text-quente-texto',
  neutro: 'text-muted-foreground',
};

/**
 * A falha no meio da frase do título ("Corrigir primeiro: os dados do imóvel"). Os
 * rótulos de `formatos-vende.ts` são de lista ("Não sabia os dados do imóvel") e não
 * cabem depois dos dois-pontos.
 */
const NA_FRASE: Record<LacunaDaIA, string> = {
  condominio_iptu: 'condomínio e IPTU',
  financiamento: 'as respostas sobre financiamento',
  fotos: 'as fotos que o cliente pede',
  demorou_visita: 'a demora para oferecer visita',
  passou_sem_precisar: 'o que ela passa sem precisar',
  nao_sabia_do_imovel: 'os dados do imóvel',
  tom: 'o tom das respostas',
  outra: 'as falhas fora da lista',
};

type Linha = { lacuna: LacunaDaIA; agora: number; antes: number };

/**
 * A janela anterior existe? A régua é a do topo da aba (`tempoDaIA`, em `resumo.tsx`):
 * só da 9ª semana da IA em diante, quando as "4 semanas anteriores" são inteiras de IA.
 * Comparar 4 semanas cheias com uma janela de poucos dias diria "piorou" só porque a IA
 * atendeu por mais tempo (16/11/2026: uma régua só para a aba toda).
 */
type Comparacao = { tipo: 'nenhuma'; aPartirDe: string | null } | { tipo: 'cheia' };

function comparacaoDa(dados: PainelProgressoIA): Comparacao {
  const tempo = tempoDaIA(dados);
  if (!tempo) return { tipo: 'nenhuma', aPartirDe: null };
  return tempo.compara ? { tipo: 'cheia' } : { tipo: 'nenhuma', aPartirDe: tempo.comparaEm };
}

/** "▼ eram 12": verde é menos falha, vermelho é mais; a leitura por extenso vai junto. */
function Delta({ agora, antes, className }: { agora: number; antes: number; className?: string }) {
  const tom: Tom = agora < antes ? 'bom' : agora > antes ? 'ruim' : 'neutro';
  const seta = agora < antes ? '▼' : agora > antes ? '▲' : '=';
  const leitura = agora < antes ? 'caiu, melhor' : agora > antes ? 'subiu, pior' : 'igual';
  const eram = `${plural(antes, 'era', 'eram')} ${inteiro(antes)}`;
  return (
    <span
      className={cn('numerico text-[11px] font-semibold whitespace-nowrap', TOM[tom], className)}
    >
      <span aria-hidden="true">
        {seta} {eram}
      </span>
      <span className="sr-only">
        , {leitura}: {eram} nas 4 semanas anteriores
      </span>
    </span>
  );
}

/** A fatia de uma falha no total, de 0 a 1. */
function fracaoDe(n: number, total: number): number {
  return total > 0 ? Math.max(0, Math.min(1, n / total)) : 0;
}

/**
 * A barra do ranking: fina, e o trilho inteiro é o total de falhas — a barra é a fatia
 * daquela falha, a mesma conta do "%" ao lado (barra e número nunca discordam). Em
 * azul, a cor da IA, calmo no escuro: a prioridade em azul cheio, o resto mais claro.
 * Nada de branco puro ofuscando.
 */
function BarraFina({ fracao, destaque = false }: { fracao: number; destaque?: boolean }) {
  return (
    <span
      aria-hidden="true"
      className="relative block h-1.5 w-full overflow-hidden rounded-full bg-muted"
    >
      {fracao > 0 ? (
        <span
          className={cn(
            'absolute inset-y-0 left-0 min-w-1.5 rounded-full',
            destaque ? 'bg-(--vende-azul)' : 'bg-(--vende-azul)/55',
          )}
          style={{ width: `${(fracao * 100).toFixed(2)}%` }}
        />
      ) : null}
    </span>
  );
}

/**
 * Uma falha do ranking. A prioridade e as outras têm a MESMA geometria (posição,
 * rótulo, barra com o "%" à direita, número de vezes alinhado à direita), para as
 * barras se compararem; a prioridade só cresce no tipo e traz o conserto num quadro.
 */
function Item({
  linha,
  posicao,
  total,
  compara,
  destaque = false,
}: {
  linha: Linha;
  posicao: number;
  total: number;
  compara: boolean;
  destaque?: boolean;
}) {
  const fracao = fracaoDe(linha.agora, total);
  const porcento = `${Math.round(fracao * 100)}%`;
  const conserto = comoCorrigirLacuna(linha.lacuna);
  return (
    // `items-baseline`: o número da posição senta na linha do rótulo, mesmo com o 28px ao lado.
    <div className="grid grid-cols-[1.25rem_minmax(0,1fr)] items-baseline gap-x-2">
      <span className="numerico text-[12px] leading-snug text-muted-foreground" aria-hidden="true">
        {posicao}
      </span>
      <div className="flex min-w-0 flex-col gap-1.5">
        <div className="flex items-baseline justify-between gap-3">
          <span
            className={cn(
              'min-w-0 leading-snug',
              destaque ? 'text-[15px] font-semibold' : 'text-[13px] font-medium',
            )}
          >
            {rotuloDaLacuna(linha.lacuna)}
          </span>
          <span className="flex shrink-0 items-baseline gap-2.5">
            {/* No celular a seta desce para a linha da barra: o rótulo fica com a largura. */}
            {compara ? (
              <Delta agora={linha.agora} antes={linha.antes} className="hidden sm:inline" />
            ) : null}
            <span className="flex items-baseline gap-1">
              <span
                className={cn(
                  'numerico text-right',
                  destaque
                    ? 'text-[28px] leading-none font-medium tracking-[-0.02em]'
                    : 'min-w-6 text-[14px] font-semibold',
                )}
              >
                {inteiro(linha.agora)}
              </span>
              {/* A unidade aparece uma vez, na prioridade; ela ensina a ler as outras. */}
              <span className={destaque ? 'text-[11px] text-muted-foreground' : 'sr-only'}>
                {plural(linha.agora, 'vez', 'vezes')}
              </span>
            </span>
          </span>
        </div>
        <div className="flex items-center gap-2.5">
          <BarraFina fracao={fracao} destaque={destaque} />
          {/* Largura fixa: o trilho tem de ter o mesmo tamanho em toda linha, ou as barras não se comparam. */}
          {compara ? (
            <Delta
              agora={linha.agora}
              antes={linha.antes}
              className="w-[4.5rem] shrink-0 text-right sm:hidden"
            />
          ) : null}
          <span className="numerico min-w-8 text-right text-[11px] text-muted-foreground">
            {porcento}
            <span className="sr-only"> das falhas</span>
          </span>
        </div>
        {conserto ? (
          destaque ? (
            <p className="mt-1 flex items-start gap-2 rounded-md border border-hairline bg-card px-3 py-2.5 text-[13px] leading-snug">
              <Wrench
                className="mt-0.5 size-3.5 shrink-0 text-muted-foreground"
                aria-hidden="true"
              />
              <span>
                <span className="font-semibold">Como corrigir: </span>
                {conserto}
              </span>
            </p>
          ) : (
            <p className="text-[12px] leading-snug text-muted-foreground">
              <span className="sr-only">Como corrigir: </span>
              {conserto}
            </p>
          )
        ) : null}
      </div>
    </div>
  );
}

/** Onde a avaliação diária achou falha e o que fazer. Dono: o agente "lacunas". */
export function Lacunas({ dados }: { dados: PainelProgressoIA }) {
  const [todas, setTodas] = useState(false);
  const idDaLista = useId();

  const comparacao = comparacaoDa(dados);
  const compara = comparacao.tipo !== 'nenhuma';

  const linhas: Linha[] = lista(dados.lacunas)
    .map((l) => ({ lacuna: l.lacuna, agora: contagem(l.agora), antes: contagem(l.antes) }))
    .sort((a, b) => b.agora - a.agora || b.antes - a.antes);
  const ativas = linhas.filter((l) => l.agora > 0);
  // Sumiu nas últimas 4 semanas o que aparecia antes: é vitória, e só conta com comparação.
  const sumiram = compara ? linhas.filter((l) => l.agora === 0 && l.antes > 0) : [];
  const total = ativas.reduce((s, l) => s + l.agora, 0);

  // A avaliação diária já leu alguma conversa? Sem isso, "nenhuma falha" não é vitória.
  const avaliou = lista(dados.semanas).some(
    (s) =>
      numero(s.duvida) !== null || numero(s.informacao) !== null || numero(s.satisfacao) !== null,
  );

  const sub =
    comparacao.tipo === 'nenhuma' && dados.desde
      ? `Falhas que a avaliação diária achou desde ${diaMes(dados.desde)}, quando a IA começou.`
      : 'Falhas que a avaliação diária achou nas últimas 4 semanas.';

  const ajuda = (
    <>
      Todo dia a avaliação diária lê as conversas da IA e anota o que faltou em cada uma. O número é
      quantas vezes cada falha apareceu nos últimos 28 dias; a barra e o % são a fatia dela no total
      de falhas. A seta compara com os 28 dias anteriores (▼ verde é menos falha, ▲ vermelho é mais)
      e só aparece quando a IA já atendeu as 8 semanas inteiras. Mais conversas também trazem mais falhas:
      leia junto com o volume de conversas.
    </>
  );

  const [primeira, ...resto] = ativas;
  if (!primeira) {
    const vitoria = avaliou || sumiram.length > 0;
    return (
      <Cartao
        secao="lacunas"
        titulo={
          vitoria
            ? 'Nenhuma falha anotada nas últimas 4 semanas'
            : 'Nenhuma falha anotada até agora'
        }
        ajuda={ajuda}
      >
        {/* A vitória ganha o ✓ grande; o "ainda não avaliou" é o vazio comum das outras
            seções (`SemDado`), sem ícone: não é notícia. O bloco ocupa a altura que sobra e
            fica no meio (17/11/2026): no computador o cartão estica até a altura das
            Versões, ao lado, e o recado preso no alto deixava um cartão vazio embaixo. */}
        <div className="flex flex-1 flex-col justify-center gap-3">
          {vitoria ? (
            <p className="flex flex-col items-center gap-2 px-3.5 py-6 text-center text-[13px] leading-snug text-muted-foreground">
              <CircleCheck className="size-8 text-cliente-texto" aria-hidden="true" />
              <span>A avaliação diária leu as conversas e não achou o que corrigir.</span>
            </p>
          ) : (
            <SemDado>As falhas aparecem aqui quando a avaliação diária ler as primeiras conversas da IA.</SemDado>
          )}
          <Sumiram linhas={sumiram} />
        </div>
      </Cartao>
    );
  }

  // Com 6, mostra as 6: esconder uma só para ter um "ver todas" é pior que a linha a mais.
  const cabe = ativas.length <= LIMITE + 1;
  const visiveis = cabe || todas ? resto : resto.slice(0, LIMITE - 1);
  const escondidas = resto.length - resto.slice(0, LIMITE - 1).length;

  return (
    <Cartao
      secao="lacunas"
      titulo={`Corrigir primeiro: ${NA_FRASE[primeira.lacuna] ?? rotuloDaLacuna(primeira.lacuna).toLowerCase()}`}
      sub={sub}
      ajuda={ajuda}
    >
      <ol
        id={idDaLista}
        className="flex flex-col"
        aria-label="Falhas, da que mais apareceu para a que menos apareceu"
      >
        <li className="flex flex-col gap-2 rounded-lg bg-muted/60 p-3.5">
          <span className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
            Prioridade
          </span>
          <Item linha={primeira} posicao={1} total={total} compara={compara} destaque />
        </li>
        {visiveis.map((l, i) => (
          <li
            key={l.lacuna}
            className={cn('px-3.5 py-2.5', i === 0 ? 'mt-1' : 'border-t border-hairline')}
          >
            <Item linha={l} posicao={i + 2} total={total} compara={compara} />
          </li>
        ))}
      </ol>

      {!cabe ? (
        <button
          type="button"
          aria-expanded={todas}
          aria-controls={idDaLista}
          onClick={() => setTodas((v) => !v)}
          className="toque -mt-2 inline-flex min-h-11 items-center gap-1 self-start rounded-md px-3.5 text-[13px] font-semibold underline-offset-4 hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none md:min-h-9"
        >
          {todas ? 'Mostrar só as 5 maiores' : `Ver as outras ${inteiro(escondidas)}`}
          <ChevronDown
            className={cn('size-4 transition-transform', todas && 'rotate-180')}
            aria-hidden="true"
          />
        </button>
      ) : null}

      <Sumiram linhas={sumiram} />

      {comparacao.tipo === 'nenhuma' ? (
        <p className="border-t border-hairline pt-2.5 text-xs leading-relaxed text-muted-foreground">
          Primeiras semanas da IA: sem comparação ainda
          {comparacao.aPartirDe
            ? ` (as setas aparecem a partir de ${diaMes(comparacao.aPartirDe)})`
            : ''}
          .
        </p>
      ) : null}
    </Cartao>
  );
}

/** O que aparecia nas 4 semanas anteriores e sumiu nas últimas: uma linha, com o ✓ verde. */
function Sumiram({ linhas }: { linhas: readonly Linha[] }) {
  if (linhas.length === 0) return null;
  return (
    <p className="flex items-start gap-2 border-t border-hairline pt-2.5 text-xs leading-relaxed">
      <CircleCheck className="mt-0.5 size-3.5 shrink-0 text-cliente-texto" aria-hidden="true" />
      <span>
        <span className="font-semibold">Sumiram nas últimas 4 semanas: </span>
        <span className="text-muted-foreground">
          {linhas
            .map(
              (l) =>
                `${rotuloDaLacuna(l.lacuna)} (${plural(l.antes, 'era', 'eram')} ${inteiro(l.antes)})`,
            )
            .join(' · ')}
        </span>
      </span>
    </p>
  );
}
