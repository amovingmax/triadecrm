'use client';

import { cn } from '@/lib/utils';
import { BarraTermica } from '@/components/temperatura';

import {
  compararCompromissos,
  diaDoInstante,
  diasDaSemana,
  ehFimDeSemana,
  horaEmNatal,
  numeroDoDia,
  rotuloDiaPorExtenso,
  rotuloSemanaCurto,
  type Compromisso,
  type Dia,
} from './tipos';

/**
 * A semana inteira de relance: sete colunas no desktop, sete blocos empilhados no
 * celular. Não é uma segunda agenda, é o índice da primeira — cada dia leva para a
 * lista daquele dia, onde estão as ações.
 *
 * Cada linha mostra o essencial para decidir onde tocar: a barra térmica, a hora
 * quando ela é hora combinada, e o nome. O resto (etapa, bairro, botões) mora na
 * visão de dia, porque numa coluna de 180px seria ilegível.
 */
export function VisaoDaSemana({
  inicio,
  itens,
  hoje,
  aoIrParaDia,
}: {
  inicio: Dia;
  itens: readonly Compromisso[];
  hoje: Dia;
  aoIrParaDia: (dia: Dia) => void;
}) {
  const dias = diasDaSemana(inicio);
  const porDia = new Map<Dia, Compromisso[]>();
  for (const item of [...itens].sort(compararCompromissos)) {
    const dia = diaDoInstante(item.quando);
    const atual = porDia.get(dia);
    if (atual) atual.push(item);
    else porDia.set(dia, [item]);
  }

  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-7 md:gap-2">
      {dias.map((dia) => {
        const doDia = porDia.get(dia) ?? [];
        // A contagem é de ABERTOS, a mesma da tira de navegação e do cabeçalho: um dia
        // cujo único compromisso já foi registrado não pode aparecer como "1 a fazer".
        const abertos = doDia.filter((c) => !c.concluido).length;
        return (
          <section
            key={dia}
            className={cn(
              'flex min-w-0 flex-col rounded-xl border border-hairline bg-card/40 md:min-h-40',
              ehFimDeSemana(dia) && doDia.length === 0 && 'opacity-60',
            )}
          >
            <button
              type="button"
              onClick={() => aoIrParaDia(dia)}
              className="toque flex items-baseline gap-1.5 rounded-t-xl border-b border-hairline px-2.5 py-2 text-left outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              <span className="text-xs text-muted-foreground">{rotuloSemanaCurto(dia)}</span>
              <span
                className={cn('numerico text-sm font-medium', dia === hoje && 'underline')}
                title={dia === hoje ? 'Hoje' : undefined}
              >
                {numeroDoDia(dia)}
              </span>
              <span className="sr-only">Abrir {rotuloDiaPorExtenso(dia)}</span>
              {abertos > 0 ? (
                <span className="numerico ml-auto text-xs text-muted-foreground">{abertos}</span>
              ) : null}
            </button>

            {doDia.length === 0 ? (
              <p className="px-2.5 py-3 text-xs text-muted-foreground">Sem compromisso</p>
            ) : (
              <ul className="flex flex-col">
                {doDia.map((c) => (
                  <li
                    key={c.taskId}
                    className={cn(
                      'relative flex items-center gap-2 border-b border-hairline py-2 pr-2 pl-3 last:border-b-0',
                      c.concluido && 'opacity-60',
                    )}
                  >
                    <BarraTermica
                      temperatura={c.temperatura}
                      needsAttention={c.precisaAtencao}
                      posicao="absoluta"
                      semRotulo
                    />
                    {c.natureza === 'marcado' ? (
                      <span className="numerico shrink-0 text-xs font-medium">
                        {horaEmNatal(c.quando)}
                      </span>
                    ) : null}
                    <span className="min-w-0 truncate text-xs" title={c.organizacao}>
                      {c.organizacao}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        );
      })}
    </div>
  );
}
