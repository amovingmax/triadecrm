'use client';

import Link from 'next/link';
import { ChevronRight } from 'lucide-react';

import { cn } from '@/lib/utils';
import { RevelarLista, RevelarItem } from '@/components/movimento';
import { BarraTermica, DiasSemContato } from '@/components/temperatura';

import { formatarLocal, formatarProximaAcao, formatarTelefone } from './formatos';
import type { LinhaParceiro } from './tipos';

/**
 * A mesma lista no celular, que é onde a Heloísa trabalha: entre visitas, no sol,
 * com uma mão só. A tabela vira cartão, mas a leitura é a mesma da tela grande —
 * barra térmica na borda esquerda, nome, e os dias sem contato em mono à direita.
 *
 * O cartão inteiro é o alvo de toque, com 64px de altura (bem acima dos 44px mínimos).
 */
export function ListaCartoes({ linhas }: { linhas: LinhaParceiro[] }) {
  return (
    <RevelarLista>
      <ul className="flex flex-col">
        {linhas.map((linha, indice) => (
          <RevelarItem key={linha.id} indice={indice}>
            <li className="border-b border-border/70 last:border-b-0">
              <Link
                href={`/parceiros/${linha.id}`}
                className="relative flex min-h-16 items-center gap-3 py-2.5 pr-2 pl-4 outline-none active:bg-muted/60 focus-visible:bg-muted/60"
              >
                <BarraTermica
                  temperatura={linha.temperature}
                  needsAttention={linha.needs_attention}
                  posicao="absoluta"
                />

                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{linha.name}</p>
                  <p className="truncate text-[0.8125rem] text-muted-foreground">
                    {[linha.primary_category, formatarLocal(linha.neighborhood, linha.city) || null]
                      .filter(Boolean)
                      .join(' · ')}
                  </p>
                  <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                    {linha.phone ? (
                      <span className="numerico">{formatarTelefone(linha.phone)}</span>
                    ) : null}
                    {linha.stage ? <span>{linha.stage}</span> : null}
                    <ProximaAcao iso={linha.next_action_at} />
                  </p>
                </div>

                <div className="flex shrink-0 flex-col items-end gap-0.5">
                  <DiasSemContato dias={linha.days_since_contact} />
                  {linha.owner ? (
                    <span className="max-w-24 truncate text-xs text-muted-foreground">
                      {linha.owner}
                    </span>
                  ) : null}
                </div>

                <ChevronRight
                  className="size-4 shrink-0 text-muted-foreground/60"
                  aria-hidden="true"
                />
              </Link>
            </li>
          </RevelarItem>
        ))}
      </ul>
    </RevelarLista>
  );
}

function ProximaAcao({ iso }: { iso: string | null }) {
  const acao = formatarProximaAcao(iso);
  if (!acao) return null;
  return (
    // A mesma regra da tabela e da ficha: quando o texto principal é um número,
    // ele sai em Geist Mono. O celular é a superfície principal do time em campo.
    <span className={cn(acao.numero && 'numerico', acao.atrasada && 'font-medium text-foreground')}>
      {acao.texto}
    </span>
  );
}
