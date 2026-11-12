/**
 * As regras puras da "Agenda de hoje" do Meu dia (11/11/2026, o acabamento da
 * Agenda da Imova), separadas do componente para serem testadas sem DOM.
 *
 * 1. QUE COMPROMISSO TEM HORA. A coluna listava toda tarefa `meeting`/`visit` do
 *    dia com a hora do prazo, e a apresentação a combinar (prazo 09:00 pela régua
 *    do desfecho) aparecia como "09:00 · Reunião · atrasada 3 h". A régua agora é a
 *    MESMA da Agenda: `naturezaDoCompromisso` (reunião com linha em `reunioes`, do
 *    Calendly, ou cuja etapa pede `meeting_at`) e `visitaComHoraCombinada` (visita
 *    do Calendly, ou marcada no CRM onde a empresa mostra a hora). O resto vai para
 *    "Sem hora marcada", sem hora e sem "atrasada".
 *
 * 2. "ABRIR AGENDA" LEVA A PESSOA. Vendo o dia de outra pessoa, o link abria a
 *    própria agenda. Agora leva `?pessoa=` (a Agenda confere no servidor se quem
 *    entrou pode abrir a agenda dela; se não pode, abre a própria, como antes).
 */
import {
  naturezaDoCompromisso,
  temHoraCombinada,
  visitaComHoraCombinada,
} from '@/components/agenda/tipos';

/** O que a regra precisa saber de uma tarefa de hoje. */
export type TarefaDaAgendaDeHoje = {
  kind: 'meeting' | 'visit';
  /** `tasks.origin`: `manual`, `system`, `calendly`… */
  origin: string;
  /** `reunioes.id` da reunião de que a tarefa é o eco, quando há. */
  reuniaoId: string | null;
  /** `deals.stage_id` do negócio da tarefa, quando há. */
  etapaId: number | null;
};

/** A hora desta tarefa é hora combinada com alguém (a régua da Agenda). */
export function temHoraNaAgendaDeHoje(
  t: TarefaDaAgendaDeHoje,
  etapasQueMarcamHora: ReadonlySet<number>,
  horaNaVisita: boolean,
): boolean {
  const tipo = t.kind === 'visit' ? ('visita' as const) : ('reuniao' as const);
  const natureza = naturezaDoCompromisso(
    { reuniaoId: t.reuniaoId, tipo, etapaId: t.etapaId, peloCalendly: t.origin === 'calendly' },
    etapasQueMarcamHora,
  );
  return temHoraCombinada({
    natureza,
    tipo,
    horaCombinada: tipo === 'visita' && visitaComHoraCombinada(t.origin, horaNaVisita),
  });
}

/** Os de hora marcada e os sem hora, cada lista na ordem em que veio. */
export function separarPelaHora<T extends { comHora: boolean }>(
  itens: readonly T[],
): { comHora: T[]; semHora: T[] } {
  return { comHora: itens.filter((c) => c.comHora), semHora: itens.filter((c) => !c.comHora) };
}

/** "Visita · sem hora combinada", "Reunião · a combinar": a linha de baixo do sem hora. */
export function rotuloSemHora(kind: TarefaDaAgendaDeHoje['kind']): string {
  return kind === 'visit' ? 'Visita · sem hora combinada' : 'Reunião · a combinar';
}

/** A Agenda da pessoa cujo dia está aberto: a própria sem parâmetro, a de outra com `?pessoa=`. */
export function linkDaAgenda(pessoa: string, usuarioId: string | undefined): string {
  return usuarioId === undefined || pessoa === usuarioId
    ? '/agenda'
    : `/agenda?pessoa=${encodeURIComponent(pessoa)}`;
}
