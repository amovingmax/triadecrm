'use client';

import { ChevronRight, PhoneOff, Timer } from 'lucide-react';

import { cn } from '@/lib/utils';
import { BarraTermica, DiasSemContato } from '@/components/temperatura';

import { formatarQuando } from './formatos';
import type { SugestaoDeAlvo } from './tipos';

/**
 * Uma linha da escolha do parceiro: barra térmica, nome, onde fica, dias sem contato.
 *
 * É a mesma leitura de relance da lista de Parceiros (cor à esquerda, número em mono
 * à direita), num alvo de toque de 64px — bem acima dos 44px mínimos, porque este é
 * o toque que ela dá andando.
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
    <li className="border-b border-hairline last:border-b-0">
      <button
        type="button"
        onClick={() => aoEscolher(alvo)}
        className="toque relative flex min-h-16 w-full items-center gap-3 py-2.5 pr-2 pl-4 text-left outline-none active:bg-muted/60 focus-visible:bg-muted/60"
      >
        <BarraTermica
          temperatura={alvo.temperatura}
          needsAttention={alvo.precisaAtencao}
          posicao="absoluta"
        />

        <div className="min-w-0 flex-1">
          <p className="truncate font-medium">{alvo.nome}</p>
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
    <h2
      className={cn(
        'px-4 pt-4 pb-1.5 text-xs font-medium tracking-wide text-muted-foreground uppercase',
        className,
      )}
    >
      {children}
    </h2>
  );
}
