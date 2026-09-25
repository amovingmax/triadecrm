'use client';

import { useQuery } from '@tanstack/react-query';
import { CalendarCheck } from 'lucide-react';

import { faixaDoHorario, livresDoDia, type HorarioLivre } from './acoes-reuniao';
import { type Dia } from './tipos';

/**
 * "O que o robô pode oferecer no meu nome hoje."
 *
 * Os horários vagos do dia em chip, vindos de `public.reuniao_livres` — que é a
 * MESMA grade de `app.reuniao_horarios_livres` que o robô usa para oferecer.
 * Pessoa e robô lendo a mesma grade não é elegância: é o que impede a tela de
 * prometer a tarde de um dia com rota planejada, ou a quinta reunião de um dia
 * que já tem quatro.
 *
 * Não é botão. Marcar reunião pela tela é pela ficha do negócio
 * (`public.reuniao_marcar_pelo_negocio`), que é o único caminho que
 * `authenticated` executa; aqui a pergunta é outra — o que ainda está de pé.
 *
 * Silêncio quando não há nada: dia de feriado, fim de semana, dia cheio ou dia
 * passado não ganham uma faixa dizendo "nenhum horário", que seria ruído em
 * quatro dias de cada sete.
 */
export function TiraDeLivres({ dia }: { dia: Dia }) {
  // Pela mesma porta do resto da tela (TanStack Query), e não por `useEffect`
  // com `setState`: a tira troca de dia a cada clique na tira da semana, e
  // buscar de novo o dia de ontem a cada volta é ida à rede que não muda nada.
  const consulta = useQuery({
    queryKey: ['agenda', 'livres', dia],
    queryFn: () => livresDoDia(dia),
    staleTime: 60_000,
  });

  const livres: HorarioLivre[] = consulta.data ?? [];
  if (livres.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-1.5 pb-1">
      <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <CalendarCheck className="size-3.5 shrink-0" aria-hidden="true" />
        Livres hoje:
      </span>
      {livres.map((h) => (
        <span
          key={h.inicio}
          className="numerico rounded-full border border-hairline px-2 py-0.5 text-xs text-muted-foreground"
        >
          {faixaDoHorario(h)}
        </span>
      ))}
    </div>
  );
}
