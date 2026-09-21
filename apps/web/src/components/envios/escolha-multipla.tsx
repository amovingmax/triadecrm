'use client';

import { ChevronDown } from 'lucide-react';

import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

/**
 * Um filtro de "qualquer um destes". O rótulo diz quantos estão marcados, para
 * a pessoa ver o recorte sem abrir cada pílula.
 */
export function EscolhaMultipla<T extends string | number>({
  rotulo,
  opcoes,
  valor,
  aoMudar,
}: {
  rotulo: string;
  opcoes: readonly { valor: T; rotulo: string; grupo?: string }[];
  valor: T[];
  aoMudar: (v: T[]) => void;
}) {
  const marcados = opcoes.filter((o) => valor.includes(o.valor));
  const texto =
    marcados.length === 0
      ? rotulo
      : marcados.length === 1
        ? `${rotulo}: ${marcados[0]?.rotulo}`
        : `${rotulo}: ${marcados.length}`;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          className={cn(
            'toque h-11 shrink-0 md:h-8',
            marcados.length > 0 && 'border-primary/50 bg-primary/5 text-foreground',
          )}
        >
          <span className="max-w-48 truncate">{texto}</span>
          <ChevronDown aria-hidden="true" className="opacity-60" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="max-h-80 w-64 overflow-y-auto">
        {opcoes.map((o, i) => {
          // Cabeçalho só onde o grupo muda em relação à opção anterior.
          const cabecalho = o.grupo && o.grupo !== opcoes[i - 1]?.grupo ? o.grupo : null;
          return (
            <div key={String(o.valor)}>
              {cabecalho ? (
                <DropdownMenuLabel className="text-xs text-muted-foreground">{cabecalho}</DropdownMenuLabel>
              ) : null}
              <DropdownMenuCheckboxItem
                checked={valor.includes(o.valor)}
                onSelect={(e) => e.preventDefault()}
                onCheckedChange={(v) =>
                  aoMudar(v ? [...valor, o.valor] : valor.filter((x) => x !== o.valor))
                }
              >
                {o.rotulo}
              </DropdownMenuCheckboxItem>
            </div>
          );
        })}
        {valor.length > 0 ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => aoMudar([])}>Limpar {rotulo.toLowerCase()}</DropdownMenuItem>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
