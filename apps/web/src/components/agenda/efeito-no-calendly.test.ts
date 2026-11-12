import { describe, expect, it } from 'vitest';

import {
  avisoAoRemarcarDoCalendly,
  comOrigem,
  EMAIL_DE_REUNIAO,
  efeitoDeCancelarNoCalendly,
  fraseDoEmail,
  lerAgendaDoLink,
  marcarSomeDoLink,
  recadoDeReuniaoCancelada,
  recadoDeReuniaoRemarcada,
  rotuloDoConflito,
} from './efeito-no-calendly';

describe('o e-mail do time', () => {
  it('na KOMUNE (sem empresa no ambiente) o e-mail está ligado, e as frases de sempre ficam', () => {
    expect(EMAIL_DE_REUNIAO).toBe(true);
    expect(fraseDoEmail()).toBe(' O time é avisado por e-mail.');
    expect(recadoDeReuniaoCancelada()).toBe('Reunião cancelada. O time é avisado por e-mail.');
    expect(recadoDeReuniaoRemarcada(false)).toBe('Reunião remarcada. O time é avisado por e-mail.');
  });

  it('sem e-mail de reunião (a Imova), a tela não promete e-mail', () => {
    expect(fraseDoEmail(false)).toBe('');
    expect(recadoDeReuniaoCancelada(false)).toBe('Reunião cancelada.');
    expect(recadoDeReuniaoRemarcada(false, false)).toBe('Reunião remarcada.');
  });

  it('remarcar a reunião do Calendly diz o que o cliente recebe', () => {
    expect(recadoDeReuniaoRemarcada(true, false)).toMatch(
      /^Reunião remarcada\. O Calendly avisa o cliente/,
    );
    expect(recadoDeReuniaoRemarcada(true, false)).toMatch(/WhatsApp/);
  });
});

describe('o efeito de cancelar no Calendly', () => {
  const ana = 'pessoa-ana';
  const ligado = { pessoaId: ana, espelhoLigado: true };

  it('o que a equipe marcou na agenda do link, com o espelho ligado, libera o horário', () => {
    expect(
      efeitoDeCancelarNoCalendly(
        { peloCalendly: false, responsavelId: ana, natureza: 'visita' },
        ligado,
      ),
    ).toBe(
      'O bloco "Ocupado" sai do Google Agenda, e o horário volta a ficar livre para o cliente no Calendly.',
    );
    expect(
      efeitoDeCancelarNoCalendly(
        { peloCalendly: false, responsavelId: ana, natureza: 'marcado' },
        ligado,
      ),
    ).toMatch(/volta a ficar livre/);
  });

  it('a apresentação a marcar não segurava horário: nada muda no Calendly', () => {
    expect(
      efeitoDeCancelarNoCalendly(
        { peloCalendly: false, responsavelId: ana, natureza: 'a_marcar' },
        ligado,
      ),
    ).toBe('Ele não segurava horário, então nada muda no Calendly.');
  });

  it('noutra agenda, com o espelho desligado ou sem resposta do banco, não fala do Calendly', () => {
    const c = { peloCalendly: false, responsavelId: ana, natureza: 'visita' as const };
    expect(efeitoDeCancelarNoCalendly({ ...c, responsavelId: 'outra' }, ligado)).toBeNull();
    expect(efeitoDeCancelarNoCalendly(c, { pessoaId: ana, espelhoLigado: false })).toBeNull();
    expect(efeitoDeCancelarNoCalendly(c, null)).toBeNull();
  });

  it('o que veio do Calendly tem a frase dele no diálogo, e não esta', () => {
    expect(
      efeitoDeCancelarNoCalendly(
        { peloCalendly: true, responsavelId: ana, natureza: 'visita' },
        ligado,
      ),
    ).toBeNull();
  });

  it('o "Novo compromisso" diz que o horário some do link só na agenda que o link oferece', () => {
    expect(marcarSomeDoLink(ana, ligado)).toBe(true);
    expect(marcarSomeDoLink('outra', ligado)).toBe(false);
    expect(marcarSomeDoLink(ana, { pessoaId: ana, espelhoLigado: false })).toBe(false);
    expect(marcarSomeDoLink(ana, null)).toBe(false);
  });

  it('lê a resposta do banco sem confiar na forma', () => {
    expect(lerAgendaDoLink({ pessoa_id: ana, espelho_ligado: true })).toEqual(ligado);
    expect(lerAgendaDoLink({ pessoa_id: null, espelho_ligado: 'sim' })).toEqual({
      pessoaId: null,
      espelhoLigado: false,
    });
    expect(lerAgendaDoLink(null)).toBeNull();
    expect(lerAgendaDoLink([])).toBeNull();
  });
});

describe('remarcar a reunião do Calendly e o conflito', () => {
  it('a folha de remarcar cita a frase que o Calendly manda ao cliente', () => {
    expect(avisoAoRemarcarDoCalendly('Imova Imobiliária')).toContain(
      '"A Imova Imobiliária remarcou este compromisso e vai combinar o novo horário com você."',
    );
  });

  it('o conflito diz "(marcado pelo Calendly)" no que veio do link, pelo instante', () => {
    const conflitos = comOrigem(
      [
        { tipo: 'visita', titulo: 'Visita: Maria', inicio: '2026-11-12T13:00:00+00:00' },
        { tipo: 'reuniao', titulo: 'Reunião: João', inicio: '2026-11-12T13:30:00+00:00' },
      ],
      ['2026-11-12T10:00:00-03:00'],
    );
    expect(conflitos.map(rotuloDoConflito)).toEqual([
      'Visita: Maria (marcado pelo Calendly)',
      'Reunião: João',
    ]);
  });
});
