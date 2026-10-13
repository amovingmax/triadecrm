import { describe, expect, it } from 'vitest';

import { estadoDoAviso, resultadoPedeAviso, type SituacaoDoAviso } from './aviso-no-whatsapp';

const s = (x: Partial<SituacaoDoAviso>): SituacaoDoAviso => ({
  ok: true,
  situacao: 'pendente',
  ...x,
});

describe('o aviso no WhatsApp de quem não atendeu', () => {
  it('pede aviso só quem não falou com ninguém', () => {
    expect(resultadoPedeAviso('nao_atendeu')).toBe(true);
    expect(resultadoPedeAviso('caixa_postal')).toBe(true);
    expect(resultadoPedeAviso('ocupado')).toBe(true);
    expect(resultadoPedeAviso('atendida_humano')).toBe(false);
    expect(resultadoPedeAviso('chamada_muda')).toBe(false);
    expect(resultadoPedeAviso('numero_invalido')).toBe(false);
  });

  it('na fila: menta, a prévia da mensagem, dá para cancelar, e a tela segue perguntando', () => {
    const e = estadoDoAviso(s({ situacao: 'pendente' }));
    expect(e).toMatchObject({ tom: 'destaque', selo: 'Na fila', balao: true, podeCancelar: true });
    expect(e?.andando).toBe(true);
    expect(e?.naConversa).toBe(false);
  });

  it('enviado: o selo acompanha a entrega do WhatsApp até "Lido"', () => {
    expect(estadoDoAviso(s({ situacao: 'enviada', entrega: 'queued' }))).toMatchObject({
      selo: 'Enviando',
      detalhe: 'Saindo agora pelo número da Komune.',
    });
    expect(estadoDoAviso(s({ situacao: 'enviada', entrega: 'sent' }), '12:12')?.detalhe).toBe(
      'Saiu pelo número da Komune às 12:12. Já está na conversa.',
    );
    expect(estadoDoAviso(s({ situacao: 'enviada', entrega: 'sent' }))?.selo).toBe('Enviado');
    expect(estadoDoAviso(s({ situacao: 'enviada', entrega: 'delivered' }))?.selo).toBe('Entregue');
    const lido = estadoDoAviso(s({ situacao: 'enviada', entrega: 'read' }));
    expect(lido).toMatchObject({ selo: 'Lido', tom: 'destaque', naConversa: true });
    expect(lido?.andando).toBe(false);
    expect(lido?.podeCancelar).toBe(false);
  });

  it('falha de entrega fica vermelha e aponta a conversa', () => {
    expect(estadoDoAviso(s({ situacao: 'enviada', entrega: 'failed' }))).toMatchObject({
      tom: 'falha',
      naConversa: true,
      balao: false,
    });
  });

  it('cancelado, pulado ou sem aviso: cinza, e diz por quê', () => {
    expect(
      estadoDoAviso(s({ situacao: 'cancelada', motivo: 'cancelado_por_quem_ligou' })),
    ).toMatchObject({ tom: 'neutro', detalhe: 'Nada vai para o WhatsApp.' });
    expect(estadoDoAviso(s({ situacao: 'cancelada', motivo: 'aviso_vencido' }))?.detalhe).toContain(
      '3 dias',
    );
    expect(
      estadoDoAviso(s({ situacao: 'pulada', motivo: 'mensagem_recente_sem_resposta' }))?.detalhe,
    ).toContain('72 h');
    expect(
      estadoDoAviso(s({ situacao: 'sem_aviso', motivo: 'modelo_aguardando_meta' }))?.detalhe,
    ).toContain('aprovação da Meta');
  });

  it('e fica calado quando ninguém esperava aviso', () => {
    expect(estadoDoAviso(s({ situacao: 'sem_aviso', motivo: 'desligado' }))).toBeNull();
    expect(estadoDoAviso(s({ situacao: 'sem_aviso', motivo: 'resultado_sem_aviso' }))).toBeNull();
    expect(estadoDoAviso(s({ situacao: 'sem_aviso', motivo: null }))).toBeNull();
  });
});
