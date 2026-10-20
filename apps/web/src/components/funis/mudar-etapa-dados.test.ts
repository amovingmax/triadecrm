import { describe, expect, it } from 'vitest';

import { cartaoDoNegocio, estadoDaProximaAcao } from './mudar-etapa-dados';

// 14/10/2026, 10h em Natal (UTC-3).
const agora = new Date('2026-10-14T13:00:00Z');

describe('mudar a etapa fora do quadro (14/10/2026)', () => {
  it('a próxima ação segue o dia em Natal, como app.deal_cards', () => {
    expect(estadoDaProximaAcao(null, agora)).toBe('sem');
    expect(estadoDaProximaAcao('2026-10-13T20:00:00Z', agora)).toBe('atrasada');
    // 23h30 de hoje em Natal já é amanhã em UTC, e continua sendo "hoje".
    expect(estadoDaProximaAcao('2026-10-15T02:30:00Z', agora)).toBe('hoje');
    expect(estadoDaProximaAcao('2026-10-15T12:00:00Z', agora)).toBe('agendada');
  });

  it('o cartão leva o negócio, o nome e a etapa para a folha de mover', () => {
    const cartao = cartaoDoNegocio(
      {
        id: 'd1',
        organization_id: 'o1',
        pipeline_id: 1,
        stage_id: 2,
        status: 'open',
        owner_id: null,
        tier: null,
        score: null,
        temperature: 'frio',
        needs_attention: false,
        last_channel: null,
        entered_stage_at: '2026-10-11T13:00:00Z',
        last_activity_at: null,
        next_action: 'Ligar',
        next_action_at: '2026-10-14T18:00:00Z',
        updated_at: '2026-10-14T12:00:00Z',
      },
      'Buffet da Ana',
      { name: 'Prospectado', position: 0 },
      agora,
    );
    expect(cartao).toMatchObject({
      deal_id: 'd1',
      organization_name: 'Buffet da Ana',
      stage_name: 'Prospectado',
      days_in_stage: 3,
      days_since_contact: null,
      next_action: 'Ligar',
      next_action_state: 'hoje',
    });
  });
});
