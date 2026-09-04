'use client';

import { ChevronLeft, ChevronRight } from 'lucide-react';

import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';

import {
  diasDaSemana,
  ehFimDeSemana,
  numeroDoDia,
  rotuloDaSemana,
  rotuloDiaPorExtenso,
  rotuloSemanaCurto,
  type Dia,
} from './tipos';

/**
 * A navegação da agenda: semana anterior, semana seguinte, "Hoje" e os sete dias.
 *
 * A tira é o mapa da semana em uma linha: cada dia traz o número em IBM Plex Mono e,
 * quando tem compromisso aberto, a contagem. Sábado e domingo continuam na tira (o
 * funil `produtor` tem formato de demonstração de sábado) mas nascem apagados, porque
 * o expediente do PRD é de segunda a sexta.
 *
 * Sete colunas de grade, nunca rolagem lateral: em 390px cada dia fica com ~52px, o
 * suficiente para o alvo de toque de 44px.
 */
export function TiraDaSemana({
  inicio,
  diaAtivo,
  hoje,
  contagem,
  aoEscolherDia,
  aoTrocarSemana,
  aoVoltarParaHoje,
}: {
  inicio: Dia;
  diaAtivo: Dia;
  hoje: Dia;
  contagem: Map<Dia, number>;
  aoEscolherDia: (dia: Dia) => void;
  aoTrocarSemana: (passo: -1 | 1) => void;
  aoVoltarParaHoje: () => void;
}) {
  const dias = diasDaSemana(inicio);
  const semanaDeHoje = dias.includes(hoje);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-1.5">
        <Button
          variant="ghost"
          size="icon"
          className="toque size-11 md:size-8"
          onClick={() => aoTrocarSemana(-1)}
        >
          <ChevronLeft aria-hidden="true" />
          <span className="sr-only">Semana anterior</span>
        </Button>
        <p className="flex-1 text-center text-sm font-medium">
          <span className="text-muted-foreground">Semana de </span>
          <span className="numerico">{rotuloDaSemana(inicio)}</span>
        </p>
        <Button
          variant="ghost"
          size="icon"
          className="toque size-11 md:size-8"
          onClick={() => aoTrocarSemana(1)}
        >
          <ChevronRight aria-hidden="true" />
          <span className="sr-only">Próxima semana</span>
        </Button>
        <Button
          variant="outline"
          size="lg"
          className="toque h-11 md:h-8"
          onClick={aoVoltarParaHoje}
          disabled={semanaDeHoje && diaAtivo === hoje}
        >
          Hoje
        </Button>
      </div>

      <div className="grid grid-cols-7 gap-1" role="group" aria-label="Dias da semana">
        {dias.map((dia) => {
          const ativo = dia === diaAtivo;
          const quantos = contagem.get(dia) ?? 0;
          return (
            <button
              key={dia}
              type="button"
              aria-pressed={ativo}
              aria-label={`${rotuloDiaPorExtenso(dia)}${
                quantos > 0 ? `, ${quantos} compromisso(s)` : ', sem compromisso'
              }`}
              onClick={() => aoEscolherDia(dia)}
              className={cn(
                'toque flex min-h-[3.25rem] flex-col items-center justify-center gap-0.5 rounded-lg border text-xs outline-none focus-visible:ring-3 focus-visible:ring-ring/50',
                ativo
                  ? 'acao-gradiente border-transparent'
                  : 'border-hairline bg-card/50 hover:bg-muted',
                !ativo && ehFimDeSemana(dia) && 'text-muted-foreground',
              )}
            >
              <span className="leading-none">{rotuloSemanaCurto(dia)}</span>
              <span className="numerico text-sm leading-none font-medium">{numeroDoDia(dia)}</span>
              {/* A contagem é número, não bolinha: no sol, um ponto de 4px some. */}
              <span
                className={cn(
                  'numerico text-[10px] leading-none',
                  quantos > 0 ? (ativo ? '' : 'text-foreground') : 'invisible',
                )}
              >
                {quantos > 0 ? quantos : '0'}
              </span>
              {/* Marca de "hoje": sempre presente, para a altura dos sete botões não
                  variar entre as semanas. */}
              <span
                aria-hidden="true"
                className={cn('h-px w-4 bg-foreground', dia === hoje && !ativo ? '' : 'invisible')}
              />
            </button>
          );
        })}
      </div>
    </div>
  );
}
