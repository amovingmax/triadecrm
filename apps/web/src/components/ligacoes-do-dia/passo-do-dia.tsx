'use client';

import { ChevronLeft, ChevronRight } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { rotuloDiaPorExtenso, somarDias, type Dia } from '@/components/agenda/tipos';

/**
 * De que dia é o relatório: um passo para trás, um para frente, e o calendário.
 *
 * O dia é sempre um DIA CIVIL de Natal (`YYYY-MM-DD`), o mesmo que o banco usa
 * para cortar as ligações. Não existe amanhã: ninguém ligou ainda.
 */
export function PassoDoDia({
  dia,
  hoje,
  aoTrocar,
}: {
  dia: Dia;
  hoje: Dia;
  aoTrocar: (dia: Dia) => void;
}) {
  const ehHoje = dia === hoje;
  const porExtenso = rotuloDiaPorExtenso(dia);

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="flex items-center gap-1">
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="toque size-11 md:size-9"
          onClick={() => aoTrocar(somarDias(dia, -1))}
        >
          <ChevronLeft aria-hidden="true" />
          <span className="sr-only">Dia anterior</span>
        </Button>
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="toque size-11 md:size-9"
          disabled={ehHoje}
          onClick={() => aoTrocar(somarDias(dia, 1))}
        >
          <ChevronRight aria-hidden="true" />
          <span className="sr-only">Dia seguinte</span>
        </Button>
      </div>

      <p className="min-w-0 text-sm font-medium first-letter:uppercase">
        {ehHoje ? `Hoje, ${porExtenso}` : porExtenso}
      </p>

      <div className="ml-auto flex items-center gap-2">
        {ehHoje ? null : (
          <Button
            type="button"
            variant="ghost"
            className="toque h-11 md:h-9"
            onClick={() => aoTrocar(hoje)}
          >
            Voltar para hoje
          </Button>
        )}
        <label className="sr-only" htmlFor="dia-das-ligacoes">
          Escolher o dia
        </label>
        <input
          id="dia-das-ligacoes"
          type="date"
          value={dia}
          max={hoje}
          onChange={(e) => {
            // O campo aceita ser esvaziado; dia vazio não é dia.
            if (/^\d{4}-\d{2}-\d{2}$/.test(e.target.value) && e.target.value <= hoje) {
              aoTrocar(e.target.value);
            }
          }}
          className="toque h-11 rounded-lg border border-input bg-background px-3 text-sm md:h-9"
        />
      </div>
    </div>
  );
}
