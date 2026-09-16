'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { ArrowRight, Sparkles } from 'lucide-react';

import { cn } from '@/lib/utils';

import { buscarPulso, CHAVE_PULSO, type PrioridadeDoPulso } from './pulso-dados';
import {
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
 * Sem cor, como a leitura da IA na tela de Conversas: a escala térmica é a verdade
 * do CRM, e o que a máquina escreveu não se veste com ela.
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
  const dias = diasDesde(data.dia);
  const prioridades = ordenarPrioridades(data.prioridades).slice(0, 5);

  return (
    <section
      aria-label="Pulso do dia"
      className={cn('flex flex-col gap-2 border-y border-hairline py-3', className)}
    >
      <header className="flex items-baseline gap-2">
        <Sparkles className="size-3.5 shrink-0 self-center text-muted-foreground" aria-hidden="true" />
        <h2 className="font-heading text-sm leading-tight font-semibold tracking-tight">
          {data.titulo ?? 'Pulso do dia'}
        </h2>
        <span className="text-xs text-muted-foreground">
          {quando}
          {dias > 2 ? <> · o último que saiu</> : null}
        </span>
      </header>

      {data.texto ? (
        <div className="flex flex-col gap-1.5 text-sm text-muted-foreground">
          {data.texto
            .split('\n')
            .map((paragrafo) => paragrafo.trim())
            .filter((paragrafo) => paragrafo !== '')
            .map((paragrafo, indice) => (
              <p key={indice}>{paragrafo}</p>
            ))}
        </div>
      ) : null}

      {prioridades.length > 0 ? (
        <ul className="flex flex-col">
          {prioridades.map((p, indice) => (
            <Prioridade key={`${p.leadId}-${indice}`} prioridade={p} />
          ))}
        </ul>
      ) : null}

      {data.riscos.length > 0 ? (
        <ul className="flex flex-col gap-0.5 text-xs text-muted-foreground">
          {data.riscos.map((risco, indice) => (
            <li key={indice} className="flex gap-1.5">
              <span aria-hidden="true">·</span>
              <span>{risco}</span>
            </li>
          ))}
        </ul>
      ) : null}

      <p className="text-[11px] text-muted-foreground">
        Escrito pela IA sobre as conversas do dia
        {data.promptVersion ? <> · {data.promptVersion}</> : null}
      </p>
    </section>
  );
}

/**
 * Uma prioridade: quem, por quê, o que fazer e quando. O nome do parceiro é o link —
 * ele é o que a pessoa procura, e clicar leva à conversa onde a ação acontece.
 */
function Prioridade({ prioridade }: { prioridade: PrioridadeDoPulso }) {
  const link = linkDaPrioridade(prioridade);
  const nome = prioridade.nome ?? 'Parceiro sem nome na base';

  const corpo = (
    <>
      <span className="min-w-0 flex-1">
        <span className="font-medium text-foreground">{nome}</span>
        <span className="text-muted-foreground"> — {prioridade.acao}</span>
      </span>
      <span className="shrink-0 text-xs text-muted-foreground">
        {ROTULO_DA_URGENCIA[prioridade.urgencia]}
      </span>
      {link ? <ArrowRight className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" /> : null}
    </>
  );

  return (
    <li className="border-t border-hairline first:border-t-0">
      {link ? (
        <Link
          href={link}
          title={prioridade.porque}
          className="toque flex min-h-11 items-center gap-2 py-1.5 text-sm hover:bg-muted/40 sm:min-h-9"
        >
          {corpo}
        </Link>
      ) : (
        <span className="flex min-h-9 items-center gap-2 py-1.5 text-sm" title={prioridade.porque}>
          {corpo}
        </span>
      )}
    </li>
  );
}
