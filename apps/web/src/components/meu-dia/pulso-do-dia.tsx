'use client';

import { useId, useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { ChevronDown, ChevronRight, FileText, Sparkles, TriangleAlert } from 'lucide-react';

import { cn } from '@/lib/utils';

import { buscarPulso, CHAVE_PULSO, type PrioridadeDoPulso } from './pulso-dados';
import {
  agruparPorPrazo,
  deQuandoE,
  diasDesde,
  linkDaPrioridade,
  ordenarPrioridades,
  ROTULO_DA_URGENCIA,
} from './pulso-formatos';

/**
 * O Pulso do dia no Meu dia — o que aconteceu nas conversas e o que não pode passar.
 *
 * ===========================================================================
 * ONDE ELE FICA, E POR QUÊ
 * ===========================================================================
 * Entre o resumo de números e a fila. Não é um cartão de destaque no topo: a
 * pergunta desta tela continua sendo "o que eu faço agora?", e quem responde isso é
 * a fila, que sai do Postgres com prioridade calculada. O Pulso é o CONTEXTO da
 * fila — por que o dia está assim —, e contexto vem antes da lista, não no lugar dela.
 *
 * ===========================================================================
 * COMO ELE SE ORGANIZA (30/09/2026)
 * ===========================================================================
 * Era um título, uma lista que ocupava metade da largura e um "Ler o resumo do dia"
 * que abria um parágrafo corrido — solto dentro do cartão. Agora são três partes
 * com papel próprio:
 *
 *  1. **A manchete.** O título que a IA escreveu é o título do cartão, com o rótulo
 *     "Pulso do dia · ontem" em cima — de quando ele é, sem a pessoa calcular.
 *  2. **O que não pode passar**, agrupado por prazo (Hoje, Amanhã, Esta semana). O
 *     prazo virou cabeçalho do grupo em vez de repetir "hoje" em cada linha; cada
 *     linha é o parceiro em cima e a ação embaixo, que se lê de relance.
 *  3. **O resumo**, num painel ao lado (embaixo, no celular): o primeiro parágrafo
 *     aberto, o resto atrás de "Ler o resumo completo", e os riscos SEMPRE à vista em
 *     "Atenção" — risco escondido atrás de um clique é risco que ninguém lê.
 *
 * O texto do resumo tem teto de linha (`max-w-prose`, ~65 caracteres): na largura
 * inteira da tela, um parágrafo de quatro linhas vira duas faixas que ninguém lê.
 *
 * Sem a escala térmica, como a leitura da IA na tela de Conversas: ela é a verdade
 * do CRM, e o que a máquina escreveu não se veste com ela. O único acento é a menta
 * do ícone, o mesmo dos outros avisos do Meu dia.
 *
 * Quando o digest para de sair (worker desligado, módulo fechado), a tela diz há
 * quantos dias é o último — em vez de mostrar um texto de terça como se fosse de
 * hoje, que é a forma mais silenciosa de um painel mentir.
 */
export function PulsoDoDia({ className }: { className?: string }) {
  const { data, isLoading } = useQuery({
    queryKey: CHAVE_PULSO,
    queryFn: buscarPulso,
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: false,
  });

  // Sem Pulso nenhum, a tela não avisa o que não falta: o módulo nasce desligado.
  if (isLoading || !data) return null;

  const quando = deQuandoE(data.dia);
  const velho = diasDesde(data.dia) > 2;
  const grupos = agruparPorPrazo(ordenarPrioridades(data.prioridades).slice(0, 5));
  const paragrafos = (data.texto ?? '')
    .split('\n')
    .map((p) => p.trim())
    .filter((p) => p !== '');
  const temResumo = paragrafos.length > 0 || data.riscos.length > 0;
  const temPrioridades = grupos.length > 0;

  return (
    <section
      aria-label="Pulso do dia"
      className={cn('sombra-base flex flex-col gap-5 rounded-xl bg-card p-5 sm:p-6', className)}
    >
      <header className="flex items-start gap-3">
        <span
          className="flex size-9 shrink-0 items-center justify-center rounded-full bg-menta text-menta-tinta"
          aria-hidden="true"
        >
          <Sparkles className="size-4" />
        </span>
        <div className="flex min-w-0 flex-col gap-1">
          <p className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-muted-foreground">
            <span className="font-medium tracking-wide uppercase">Pulso do dia</span>
            <span aria-hidden="true">·</span>
            <span>{quando}</span>
            {velho ? (
              <span className="rounded-full bg-morno-fundo px-2 py-0.5 text-morno-texto">
                é o último que saiu
              </span>
            ) : null}
          </p>
          <h2 className="max-w-[60ch] text-[17px] leading-snug font-semibold tracking-[-0.01em] text-balance sm:text-lg">
            {data.titulo ?? 'O resumo das conversas do dia'}
          </h2>
        </div>
      </header>

      <div
        className={cn(
          'grid gap-5',
          temPrioridades && temResumo && 'lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]',
        )}
      >
        {temPrioridades ? (
          <section aria-label="O que não pode passar" className="flex flex-col gap-3">
            <h3 className="text-sm font-semibold">O que não pode passar</h3>
            {grupos.map((grupo) => (
              <div key={grupo.urgencia} className="flex flex-col gap-1.5">
                <p className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
                  <span className="first-letter:uppercase">
                    {ROTULO_DA_URGENCIA[grupo.urgencia]}
                  </span>
                  <span className="numerico font-normal">{grupo.itens.length}</span>
                </p>
                <ul className="flex flex-col gap-1.5">
                  {grupo.itens.map((p, indice) => (
                    <Prioridade key={`${p.leadId}-${indice}`} prioridade={p} />
                  ))}
                </ul>
              </div>
            ))}
          </section>
        ) : null}

        {temResumo ? <Resumo paragrafos={paragrafos} riscos={data.riscos} /> : null}
      </div>

      <p
        className="border-t border-hairline pt-3 text-xs text-muted-foreground"
        title={data.promptVersion ?? undefined}
      >
        Escrito pela IA sobre as conversas do dia. Confira na conversa antes de agir.
      </p>
    </section>
  );
}

/**
 * O resumo em painel: o primeiro parágrafo à vista, o resto atrás de um botão que
 * anuncia se está aberto (`aria-expanded`), e os riscos sempre visíveis.
 */
function Resumo({
  paragrafos,
  riscos,
}: {
  paragrafos: readonly string[];
  riscos: readonly string[];
}) {
  const idDoResto = useId();
  const [aberto, setAberto] = useState(false);
  const [primeiro, ...resto] = paragrafos;
  // No celular o resumo vem DEPOIS das prioridades e antes da fila: o primeiro
  // parágrafo inteiro empurrava a fila para a terceira tela. Lá ele abre cortado em
  // quatro linhas; do `lg` para cima, ao lado da lista, vai inteiro.
  const primeiroLongo = (primeiro?.length ?? 0) > 220;
  const temBotao = resto.length > 0 || primeiroLongo;

  return (
    <aside
      aria-label="Resumo do dia"
      className="flex flex-col gap-3 self-start rounded-xl bg-muted/45 p-4 sm:p-5"
    >
      <h3 className="flex items-center gap-2 text-sm font-semibold">
        <FileText className="size-4 text-muted-foreground" aria-hidden="true" />
        Resumo do dia
      </h3>

      {primeiro ? (
        <div className="flex max-w-prose flex-col gap-2 text-sm leading-relaxed text-foreground/85">
          <p className={cn(!aberto && 'line-clamp-4 lg:line-clamp-none')}>{primeiro}</p>
          {temBotao ? (
            <>
              <div id={idDoResto} hidden={!aberto} className="flex flex-col gap-2">
                {resto.map((paragrafo, indice) => (
                  <p key={indice}>{paragrafo}</p>
                ))}
              </div>
              <button
                type="button"
                aria-expanded={aberto}
                aria-controls={idDoResto}
                onClick={() => setAberto((a) => !a)}
                className={cn(
                  'toque -ml-1 flex min-h-11 w-fit cursor-pointer items-center gap-1 rounded-md px-1 text-sm font-medium text-foreground underline-offset-4 outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50 sm:min-h-8',
                  // Só um parágrafo, e longo: o botão existe para o corte do
                  // celular, e some onde o parágrafo já vai inteiro.
                  resto.length === 0 && 'lg:hidden',
                )}
              >
                <ChevronDown
                  className={cn(
                    'size-4 transition-transform motion-reduce:transition-none',
                    aberto && 'rotate-180',
                  )}
                  aria-hidden="true"
                />
                {aberto ? 'Mostrar menos' : 'Ler o resumo completo'}
              </button>
            </>
          ) : null}
        </div>
      ) : null}

      {riscos.length > 0 ? (
        <div className="flex flex-col gap-1.5 border-t border-hairline pt-3">
          <p className="text-xs font-medium text-muted-foreground">Atenção</p>
          <ul className="flex flex-col gap-1.5 text-sm">
            {riscos.map((risco, indice) => (
              <li key={indice} className="flex items-start gap-2">
                <TriangleAlert
                  className="mt-0.5 size-4 shrink-0 text-morno-texto"
                  aria-hidden="true"
                />
                <span className="text-foreground/85">{risco}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </aside>
  );
}

/**
 * Uma prioridade: quem, em cima, e o que fazer, embaixo. O nome do parceiro é o que
 * a pessoa procura, e a linha inteira leva à conversa onde a ação acontece. O porquê
 * vai no `title` e na leitura de tela — é o detalhe, não a linha.
 */
function Prioridade({ prioridade }: { prioridade: PrioridadeDoPulso }) {
  const link = linkDaPrioridade(prioridade);
  const nome = prioridade.nome ?? 'Parceiro sem nome na base';

  const corpo = (
    <>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="truncate text-[15px] font-medium text-foreground">{nome}</span>
        <span className="text-sm leading-snug text-muted-foreground">{prioridade.acao}</span>
        {prioridade.porque ? <span className="sr-only">Por quê: {prioridade.porque}</span> : null}
      </span>
      {link ? (
        <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      ) : null}
    </>
  );

  const classe = 'flex min-h-11 items-center gap-3 rounded-lg bg-muted/45 px-4 py-2.5';

  return (
    <li>
      {link ? (
        <Link
          href={link}
          title={prioridade.porque || undefined}
          className={cn(
            classe,
            'toque transition-colors outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50',
          )}
        >
          {corpo}
        </Link>
      ) : (
        <span className={classe} title={prioridade.porque || undefined}>
          {corpo}
        </span>
      )}
    </li>
  );
}
