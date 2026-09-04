'use client';

import { CircleAlert, Inbox, RotateCw } from 'lucide-react';

import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';

/**
 * Espera, erro e vazio dos relatórios.
 *
 * O esqueleto tem a FORMA da tabela que vai chegar (mesma altura de linha, mesmo
 * número de colunas), para o olho já se posicionar e a troca não empurrar nada — o
 * mesmo princípio de `components/parceiros/estados-lista.tsx`.
 */

export function EsqueletoRelatorio({ colunas = 8, linhas = 10 }: { colunas?: number; linhas?: number }) {
  const larguras = ['w-28', 'w-16', 'w-20', 'w-12', 'w-16', 'w-24', 'w-14', 'w-20'];

  return (
    <div aria-busy="true" aria-live="polite" className="w-full">
      <span className="sr-only">Carregando o relatório.</span>
      <div className="flex h-9 items-end gap-4 border-b border-hairline px-2 pb-2">
        {Array.from({ length: colunas }, (_, i) => (
          <Skeleton key={i} className={cn('h-3', i === 0 ? 'w-32' : 'w-12')} />
        ))}
      </div>
      {Array.from({ length: linhas }, (_, linha) => (
        <div key={linha} className="flex h-10 items-center gap-4 border-b border-hairline px-2">
          {Array.from({ length: colunas }, (_, coluna) => (
            <Skeleton
              key={coluna}
              className={cn(
                'h-3.5',
                coluna === 0 ? larguras[linha % larguras.length] : 'w-10',
              )}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

/**
 * A falha em português, com o que fazer. O texto cru do Postgres nunca chega aqui:
 * quem traduz é `mensagemDoErro` em `dados.ts`.
 */
export function ErroDoRelatorio({ causa, aoTentar }: { causa: string; aoTentar: () => void }) {
  return (
    <Moldura icone={<CircleAlert className="size-5" aria-hidden="true" />} titulo="O relatório não abriu">
      <p className="max-w-prose text-sm text-muted-foreground">{causa}</p>
      <Button variant="outline" onClick={aoTentar} className="toque h-11 md:h-9">
        <RotateCw aria-hidden="true" />
        Tentar de novo
      </Button>
    </Moldura>
  );
}

/** Não há linha nenhuma no período: diz por quê e o que fazer para haver. */
export function VazioDoRelatorio({ titulo, texto }: { titulo: string; texto: string }) {
  return (
    <Moldura icone={<Inbox className="size-5" aria-hidden="true" />} titulo={titulo}>
      <p className="max-w-prose text-sm text-muted-foreground">{texto}</p>
    </Moldura>
  );
}

function Moldura({
  icone,
  titulo,
  children,
}: {
  icone: React.ReactNode;
  titulo: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-start gap-3 px-1 py-10">
      <span className="flex size-9 items-center justify-center rounded-lg bg-muted text-muted-foreground">
        {icone}
      </span>
      <h3 className="font-heading text-base font-semibold tracking-tight">{titulo}</h3>
      {children}
    </div>
  );
}

/**
 * O aviso de honestidade: o que esta leitura AINDA não enxerga e de que ela depende.
 *
 * Existe porque metade do produto ainda não está ligada (o coletor do Radar e o
 * WhatsApp oficial), e um relatório que mostra zero sem dizer por quê faz o time
 * concluir a coisa errada. Fica embaixo da tabela, em texto pequeno, nunca como
 * alarme: não é erro, é o estado do mundo hoje.
 */
export function NotaDeAlcance({ children }: { children: React.ReactNode }) {
  return (
    <p className="max-w-prose border-t border-hairline pt-3 text-xs leading-relaxed text-muted-foreground">
      {children}
    </p>
  );
}
