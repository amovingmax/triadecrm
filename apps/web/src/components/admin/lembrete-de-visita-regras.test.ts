import { describe, expect, it } from 'vitest';

import {
  fraseDoErroAoConfigurar,
  fraseDoInterruptor,
  fraseDoModelo,
  fraseDoMotivo,
  HORAS_DO_LEMBRETE,
  lerPainel,
  rotuloDaHora,
  situacaoDoModelo,
} from './lembrete-de-visita-regras';

describe('situacaoDoModelo', () => {
  it('inativo e sem situação: ainda não foi para a Meta', () => {
    expect(situacaoDoModelo({ ativo: false, situacao: 'nao_enviado', aprovado: false })).toBe(
      'nao_enviado',
    );
  });
  it('ativo e sem situação: vai na próxima sincronização', () => {
    expect(situacaoDoModelo({ ativo: true, situacao: 'nao_enviado', aprovado: false })).toBe(
      'na_fila',
    );
  });
  it('pendente: esperando a Meta', () => {
    expect(situacaoDoModelo({ ativo: true, situacao: 'pending', aprovado: false })).toBe(
      'esperando',
    );
  });
  it('recusado e aprovado', () => {
    expect(situacaoDoModelo({ ativo: true, situacao: 'rejected', aprovado: false })).toBe(
      'recusado',
    );
    expect(situacaoDoModelo({ ativo: true, situacao: 'approved', aprovado: true })).toBe(
      'aprovado',
    );
  });
  it('"approved" sem o nome na Meta ainda não é aprovado de verdade', () => {
    expect(situacaoDoModelo({ ativo: true, situacao: 'approved', aprovado: false })).toBe(
      'esperando',
    );
  });
});

describe('lerPainel', () => {
  it('lê o que o banco devolve', () => {
    const p = lerPainel({
      ok: true,
      ligado: true,
      hora: '09:00',
      modelo: {
        codigo: 'IMV-VIS-LEMBRETE',
        ativo: true,
        situacao: 'approved',
        aprovado: true,
        motivo_da_recusa: null,
        corpo: 'Olá, {{nome}}!',
        botoes: [
          { tipo: 'resposta', texto: 'Confirmo' },
          { tipo: 'resposta', texto: 'Preciso remarcar' },
        ],
      },
      ultimos_30_dias: { enviados: 4, confirmaram: 2, remarcar: 1, sem_resposta: 1, nao_sairam: 1 },
      nao_sairam: [
        { cliente: 'Gabi', marcada_para: '2027-03-05T13:00:00+00:00', motivo: 'sem_whatsapp' },
      ],
    });
    expect(p.ligado).toBe(true);
    expect(p.hora).toBe('09:00');
    expect(p.modelo?.situacao).toBe('aprovado');
    expect(p.modelo?.botoes).toEqual(['Confirmo', 'Preciso remarcar']);
    expect(p.numeros).toEqual({
      enviados: 4,
      confirmaram: 2,
      remarcar: 1,
      semResposta: 1,
      naoSairam: 1,
    });
    expect(p.naoSairam).toEqual([
      { cliente: 'Gabi', marcadaPara: '2027-03-05T13:00:00+00:00', motivo: 'sem_whatsapp' },
    ]);
  });

  it('sem nada, desligado às 10h, sem modelo e com zeros', () => {
    const p = lerPainel(null);
    expect(p.ligado).toBe(false);
    expect(p.hora).toBe('10:00');
    expect(p.modelo).toBeNull();
    expect(p.numeros.enviados).toBe(0);
    expect(p.naoSairam).toEqual([]);
  });
});

describe('as frases', () => {
  it('o modelo recusado leva o motivo da Meta', () => {
    expect(fraseDoModelo('recusado', 'INVALID_FORMAT')).toBe(
      'A Meta recusou o modelo: INVALID_FORMAT',
    );
    expect(fraseDoModelo('nao_enviado')).toMatch(/nenhum lembrete sai/);
  });

  it('o interruptor diz o que acontece agora', () => {
    expect(fraseDoInterruptor(false, 'aprovado', '10:00')).toBe('Desligado: nenhum lembrete sai.');
    expect(fraseDoInterruptor(true, 'esperando', '10:00')).toBe(
      'Ligado, mas nada sai até a Meta aprovar o modelo.',
    );
    expect(fraseDoInterruptor(true, 'aprovado', '10:00')).toMatch(/^Ligado: a partir das 10h,/);
  });

  it('as horas vão das 7h às 17h, de hora em hora', () => {
    expect(HORAS_DO_LEMBRETE[0]).toBe('07:00');
    expect(HORAS_DO_LEMBRETE.at(-1)).toBe('17:00');
    expect(HORAS_DO_LEMBRETE).toContain('10:00');
    expect(rotuloDaHora('09:00')).toBe('9h');
    expect(rotuloDaHora('09:30')).toBe('9h30');
  });

  it('o motivo de não ter saído, sem código do banco', () => {
    expect(fraseDoMotivo('sem_whatsapp')).toBe('a ficha não tem WhatsApp');
    expect(fraseDoMotivo('contato_suprimido')).toBe('o cliente pediu para não receber mensagens');
    expect(fraseDoMotivo('numero_suprimido')).toBe('o cliente pediu para não receber mensagens');
    expect(fraseDoMotivo('janela_depois_do_fechamento')).toBe('fora do horário de envio');
    expect(fraseDoMotivo('teto_iniciadas_dia')).toBe('o limite de mensagens do dia foi atingido');
    expect(
      fraseDoMotivo(
        'Envio recusado: o robô já falou o bastante nesta conversa (bot_pausado) — RF-CON-20',
      ),
    ).toBe('o robô já tinha falado o bastante nessa conversa');
    expect(fraseDoMotivo('qualquer outra coisa')).toBe('o WhatsApp recusou o envio');
  });

  it('o erro ao configurar', () => {
    expect(fraseDoErroAoConfigurar('hora_invalida')).toBe('Escolha uma hora entre 7h e 17h.');
    expect(fraseDoErroAoConfigurar('sem_permissao')).toBe('Só admin e gestor mudam o lembrete.');
    expect(fraseDoErroAoConfigurar(null)).toBe('Não deu para salvar. Tente de novo.');
  });
});
