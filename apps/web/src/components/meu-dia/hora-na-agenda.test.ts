import { describe, expect, it } from 'vitest';

import {
  linkDaAgenda,
  rotuloSemHora,
  separarPelaHora,
  temHoraNaAgendaDeHoje,
  type TarefaDaAgendaDeHoje,
} from './hora-na-agenda';

const ETAPA_COM_HORA = 7;
const ETAPAS = new Set([ETAPA_COM_HORA]);

function tarefa(t: Partial<TarefaDaAgendaDeHoje>): TarefaDaAgendaDeHoje {
  return { kind: 'meeting', origin: 'system', reuniaoId: null, etapaId: null, ...t };
}

describe('a hora na "Agenda de hoje" do Meu dia', () => {
  it('a apresentação a combinar não tem hora: não aparece como "09:00 · atrasada"', () => {
    expect(temHoraNaAgendaDeHoje(tarefa({ etapaId: 3 }), ETAPAS, true)).toBe(false);
    expect(temHoraNaAgendaDeHoje(tarefa({}), ETAPAS, true)).toBe(false);
  });

  it('a reunião de verdade, a do Calendly e a da etapa que pede hora têm hora', () => {
    expect(temHoraNaAgendaDeHoje(tarefa({ reuniaoId: 'r1' }), ETAPAS, false)).toBe(true);
    expect(temHoraNaAgendaDeHoje(tarefa({ origin: 'calendly' }), ETAPAS, false)).toBe(true);
    expect(temHoraNaAgendaDeHoje(tarefa({ etapaId: ETAPA_COM_HORA }), ETAPAS, false)).toBe(true);
  });

  it('a visita tem hora quando veio do Calendly, ou do CRM onde a empresa mostra a hora', () => {
    expect(
      temHoraNaAgendaDeHoje(tarefa({ kind: 'visit', origin: 'calendly' }), ETAPAS, false),
    ).toBe(true);
    expect(temHoraNaAgendaDeHoje(tarefa({ kind: 'visit', origin: 'manual' }), ETAPAS, true)).toBe(
      true,
    );
    // Na KOMUNE a visita marcada no CRM é porta a bater, sem hora.
    expect(temHoraNaAgendaDeHoje(tarefa({ kind: 'visit', origin: 'manual' }), ETAPAS, false)).toBe(
      false,
    );
    // A visita que a régua do desfecho criou é prazo, não hora.
    expect(temHoraNaAgendaDeHoje(tarefa({ kind: 'visit', origin: 'system' }), ETAPAS, true)).toBe(
      false,
    );
  });

  it('separa os de hora dos sem hora, sem mudar a ordem', () => {
    const itens = [
      { id: 'a', comHora: true },
      { id: 'b', comHora: false },
      { id: 'c', comHora: true },
    ];
    const { comHora, semHora } = separarPelaHora(itens);
    expect(comHora.map((c) => c.id)).toEqual(['a', 'c']);
    expect(semHora.map((c) => c.id)).toEqual(['b']);
  });

  it('o sem hora diz o que é, sem hora nem atraso', () => {
    expect(rotuloSemHora('visit')).toBe('Visita · sem hora combinada');
    expect(rotuloSemHora('meeting')).toBe('Reunião · a combinar');
  });

  it('"Abrir agenda" leva a pessoa cujo dia está aberto', () => {
    expect(linkDaAgenda('eu', 'eu')).toBe('/agenda');
    expect(linkDaAgenda('outra', 'eu')).toBe('/agenda?pessoa=outra');
    expect(linkDaAgenda('outra', undefined)).toBe('/agenda');
  });
});
