import { describe, expect, it } from 'vitest';

import {
  assuntoDaReuniao,
  corpoDaReuniao,
  destinatarios,
  type AvisoDeReuniao,
} from './aviso-de-reuniao';

/**
 * O e-mail de reunião marcada.
 *
 * O que estes testes protegem:
 *
 *  1. **O assunto diz o que aconteceu, com quem e quando** — quem lê no celular
 *     decide sem abrir.
 *  2. **O corpo diz com todas as letras que foi o robô.** É o que permite ler a
 *     amostragem das primeiras semanas sem abrir cada conversa.
 *  3. **O telefone do parceiro não sai do CRM.** E-mail é caixa fora da RLS e
 *     telefone completo lá é PII exportada sem `pii_access_log` (RF-BAS-14).
 *  4. **Enquanto a rampa está ligada, o corpo pede o clique** — e diz por quê:
 *     o fornecedor ainda não sabe o horário.
 *  5. **O dono entra na lista de destinatários sem duplicar a lista do time**,
 *     e a comparação não é sensível a maiúsculas: o mesmo e-mail escrito de dois
 *     jeitos é uma pessoa só.
 */

const AVISO: AvisoDeReuniao = {
  msgId: 1,
  chave: 'reuniao:r1:marcada',
  motivo: 'marcada',
  reuniaoId: 'r1',
  organizationId: 'o1',
  conversationId: 'c1',
  parceiro: 'Buffet Sabor',
  quandoPorExtenso: 'quinta-feira, 1º de outubro, às 10h20',
  quandoCurto: '01/10, 10h20',
  formato: 'online',
  link: 'https://meet.invalid/heloisa',
  local: null,
  estado: 'marcada',
  marcadaPeloRobo: true,
  atende: 'Heloísa',
  emailDoDono: 'heloisa@komune.app.br',
};

const CRM = 'https://crm.komune.app.br';

describe('assuntoDaReuniao', () => {
  it('o assunto diz parceiro, dia e hora', () => {
    expect(assuntoDaReuniao(AVISO)).toBe('Reunião marcada: Buffet Sabor — 01/10, 10h20');
  });

  it('o assunto do cancelamento diz que é cancelamento', () => {
    expect(assuntoDaReuniao({ ...AVISO, motivo: 'cancelada' })).toContain('Reunião cancelada');
  });

  it('o assunto de quem ainda espera o clique diz isso', () => {
    expect(assuntoDaReuniao({ ...AVISO, estado: 'a_confirmar' })).toContain('confirmar');
  });
});

describe('corpoDaReuniao', () => {
  it('o corpo diz COM TODAS AS LETRAS que foi o robô', () => {
    expect(corpoDaReuniao(AVISO, CRM)).toContain('marcada pelo robô');
  });

  it('quando foi gente, não diz que foi o robô', () => {
    expect(corpoDaReuniao({ ...AVISO, marcadaPeloRobo: false }, CRM)).not.toContain(
      'marcada pelo robô',
    );
  });

  it('o corpo NÃO leva o telefone do parceiro', () => {
    expect(corpoDaReuniao(AVISO, CRM)).not.toMatch(/\+55\d{10,}/);
  });

  it('leva a sala quando é online, e o endereço quando é presencial', () => {
    expect(corpoDaReuniao(AVISO, CRM)).toContain('https://meet.invalid/heloisa');
    expect(
      corpoDaReuniao(
        { ...AVISO, formato: 'presencial', link: null, local: 'Av. Roberto Freire, 1234' },
        CRM,
      ),
    ).toContain('Av. Roberto Freire, 1234');
  });

  it('leva o link da ficha e o da conversa', () => {
    const corpo = corpoDaReuniao(AVISO, CRM);
    expect(corpo).toContain(`${CRM}/parceiros/o1`);
    expect(corpo).toContain(`${CRM}/conversas?org=o1`);
  });

  it('enquanto a rampa está ligada, o corpo pede o clique', () => {
    expect(corpoDaReuniao({ ...AVISO, estado: 'a_confirmar' }, CRM)).toContain(
      'o fornecedor ainda NÃO sabe o horário',
    );
  });

  it('e quando já está confirmada, não pede clique nenhum', () => {
    expect(corpoDaReuniao(AVISO, CRM)).not.toContain('o fornecedor ainda NÃO sabe o horário');
  });
});

describe('destinatarios', () => {
  it('o dono entra na lista de destinatários, sem duplicar a lista do time', () => {
    expect(destinatarios(AVISO, ['komune@komune.app.br'])).toEqual([
      'komune@komune.app.br',
      'heloisa@komune.app.br',
    ]);
  });

  it('e a comparação não é sensível a maiúsculas', () => {
    expect(
      destinatarios({ ...AVISO, emailDoDono: 'KOMUNE@komune.app.br' }, ['komune@komune.app.br']),
    ).toEqual(['komune@komune.app.br']);
  });

  it('sem e-mail do dono, sobra a lista do time', () => {
    expect(destinatarios({ ...AVISO, emailDoDono: null }, ['komune@komune.app.br'])).toEqual([
      'komune@komune.app.br',
    ]);
  });
});
