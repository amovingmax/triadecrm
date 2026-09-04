'use client';

import { ChevronLeft, ChevronRight } from 'lucide-react';

import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';

import { PERIODOS, type Periodo } from './periodo';

/**
 * Dia, semana e mês (RF-MET-02), mais o passo para trás e para a frente.
 *
 * Segmentado feito com botões e `aria-pressed`, e não com abas: não há painel por
 * aba, o que muda é o recorte da mesma tela. O botão ativo usa peso e a superfície
 * `secondary` — nada de cor, que aqui significaria temperatura.
 */
export function SeletorPeriodo({
  periodo,
  aoTrocarPeriodo,
  aoAndar,
  aoVoltarParaAgora,
  ehAtual,
}: {
  periodo: Periodo;
  aoTrocarPeriodo: (periodo: Periodo) => void;
  aoAndar: (passos: number) => void;
  aoVoltarParaAgora: () => void;
  ehAtual: boolean;
}) {
  const nomeDoPasso = periodo === 'day' ? 'dia' : periodo === 'week' ? 'semana' : 'mês';

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div
        role="group"
        aria-label="Período da meta"
        className="flex items-center gap-1 rounded-lg bg-muted p-1"
      >
        {PERIODOS.map((opcao) => {
          const ativo = opcao.valor === periodo;
          return (
            <button
              key={opcao.valor}
              type="button"
              aria-pressed={ativo}
              onClick={() => aoTrocarPeriodo(opcao.valor)}
              className={cn(
                // 44px no celular (o polegar da Heloísa na rua), 36px no desktop.
                'toque min-h-11 rounded-md px-3 text-sm transition-colors outline-none md:min-h-9',
                'focus-visible:ring-3 focus-visible:ring-ring/50',
                ativo
                  ? 'bg-background font-medium text-foreground shadow-xs'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {opcao.rotulo}
            </button>
          );
        })}
      </div>

      <div className="flex items-center gap-1">
        <Button
          variant="outline"
          size="icon"
          aria-label={`${nomeDoPasso} anterior`}
          onClick={() => aoAndar(-1)}
          className="toque size-11 md:size-8"
        >
          <ChevronLeft aria-hidden="true" />
        </Button>
        <Button
          variant="outline"
          disabled={ehAtual}
          onClick={aoVoltarParaAgora}
          className="toque h-11 md:h-8"
        >
          {periodo === 'day' ? 'Hoje' : periodo === 'week' ? 'Esta semana' : 'Este mês'}
        </Button>
        <Button
          variant="outline"
          size="icon"
          aria-label={`próximo ${nomeDoPasso}`}
          onClick={() => aoAndar(1)}
          className="toque size-11 md:size-8"
        >
          <ChevronRight aria-hidden="true" />
        </Button>
      </div>
    </div>
  );
}
