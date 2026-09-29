'use client';

import { ChevronRight, PhoneOff, Timer } from 'lucide-react';

import { cn } from '@/lib/utils';
import { DiasSemContato } from '@/components/temperatura';

import { formatarQuando } from './formatos';
import type { SugestaoDeAlvo } from './tipos';

/**
 * Uma linha da escolha do parceiro: nome, onde fica, dias sem contato.
 *
 * Um alvo de toque de 64px — bem acima dos 44px mínimos, porque este é o toque que
 * ela dá andando. A BARRA TÉRMICA SAIU DA LINHA EM 29/09/2026: pelo Tríade Design
 * System a escala térmica mora só nos relatórios e na ficha, e aqui ela pintava
 * uma lista de oito buffets de ouro, vermelho e azul sem que a cor mudasse a
 * escolha de ninguém. A linha agora é uma superfície, como as do Meu dia.
 *
 * A linha diz duas coisas a mais que a lista de Parceiros não precisa dizer, e as
 * duas mudam o que ela vai fazer no passo seguinte: a janela de recontato ainda
 * aberta (RF-FUN-13) e o `do_not_contact` (RF-ADM-04). Nenhuma das duas BLOQUEIA o
 * registro — registrar o que aconteceu não é contatar ninguém —, mas ambas aparecem
 * antes do toque, não depois.
 */
export function LinhaAlvo({
  alvo,
  aoEscolher,
}: {
  alvo: SugestaoDeAlvo;
  aoEscolher: (alvo: SugestaoDeAlvo) => void;
}) {
  const local = [alvo.bairro, alvo.categoria].filter(Boolean).join(' · ');

  return (
    <li>
      <button
        type="button"
        onClick={() => aoEscolher(alvo)}
        className="toque flex min-h-16 w-full items-center gap-3 rounded-lg bg-muted/45 py-2.5 pr-3 pl-4 text-left outline-none transition-colors hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 active:bg-muted"
      >
        <div className="min-w-0 flex-1">
          <p className="truncate text-[15px] font-medium">{alvo.nome}</p>
          {alvo.motivo ? (
            <p className="truncate text-[0.8125rem] text-foreground">{alvo.motivo}</p>
          ) : null}
          <p className="flex flex-wrap items-center gap-x-2 truncate text-xs text-muted-foreground">
            {local ? <span className="truncate">{local}</span> : null}
            {alvo.etapa ? <span className="truncate">{alvo.etapa}</span> : null}
            {alvo.naoContatar ? (
              <span className="inline-flex items-center gap-1 text-foreground">
                <PhoneOff className="size-3" aria-hidden="true" />
                não contatar
              </span>
            ) : null}
            {alvo.cooldownAte ? (
              <span className="inline-flex items-center gap-1">
                <Timer className="size-3" aria-hidden="true" />
                recontato {formatarQuando(alvo.cooldownAte)}
              </span>
            ) : null}
          </p>
        </div>

        <DiasSemContato dias={alvo.diasSemContato} className="shrink-0" />
        <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      </button>
    </li>
  );
}

/** Cabeçalho de um grupo da lista (Agora, Resultados). Só texto, sem caixa. */
export function TituloDoGrupo({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <h2 className={cn('pt-1 text-xs font-medium text-muted-foreground', className)}>
      {children}
    </h2>
  );
}
