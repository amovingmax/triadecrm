import { describe, expect, it } from 'vitest';

import { fraseDoAviso, resultadoPedeAviso } from './aviso-no-whatsapp';

describe('o aviso no WhatsApp de quem não atendeu', () => {
  it('pede aviso só quem não falou com ninguém', () => {
    expect(resultadoPedeAviso('nao_atendeu')).toBe(true);
    expect(resultadoPedeAviso('caixa_postal')).toBe(true);
    expect(resultadoPedeAviso('ocupado')).toBe(true);
    expect(resultadoPedeAviso('atendida_humano')).toBe(false);
    expect(resultadoPedeAviso('chamada_muda')).toBe(false);
    expect(resultadoPedeAviso('numero_invalido')).toBe(false);
  });

  it('na fila, o recibo diz o que vai sair e deixa cancelar', () => {
    const frase = fraseDoAviso({ ok: true, situacao: 'pendente', motivo: null });
    expect(frase?.podeCancelar).toBe(true);
    expect(frase?.texto).toContain('Tentamos entrar em contato');
  });

  it('cancelado ou enviado, não há mais o que cancelar', () => {
    expect(
      fraseDoAviso({ ok: true, situacao: 'cancelada', motivo: 'cancelado_por_quem_ligou' }),
    ).toEqual({ texto: 'Aviso cancelado: nada vai para o WhatsApp.', podeCancelar: false });
    expect(fraseDoAviso({ ok: true, situacao: 'enviada' })?.podeCancelar).toBe(false);
  });

  it('sem aviso, diz por quê quando a pessoa esperava um', () => {
    expect(
      fraseDoAviso({ ok: true, situacao: 'sem_aviso', motivo: 'modelo_aguardando_meta' })?.texto,
    ).toContain('aprovação da Meta');
    expect(
      fraseDoAviso({ ok: true, situacao: 'sem_aviso', motivo: 'mensagem_recente_sem_resposta' })
        ?.texto,
    ).toContain('72 h');
  });

  it('e fica calado quando ninguém esperava aviso', () => {
    expect(fraseDoAviso({ ok: true, situacao: 'sem_aviso', motivo: 'desligado' })).toBeNull();
    expect(
      fraseDoAviso({ ok: true, situacao: 'sem_aviso', motivo: 'resultado_sem_aviso' }),
    ).toBeNull();
    expect(fraseDoAviso({ ok: true, situacao: 'sem_aviso', motivo: null })).toBeNull();
  });
});
