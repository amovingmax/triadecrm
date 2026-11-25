import { describe, expect, it } from 'vitest';

import {
  lerDias,
  quandoPorPerto,
  rotuloDaSituacao,
  rotuloDoMotivo,
  textoDoSelo,
} from './retomada-dados';

describe('a retomada na tela (Imova, 11/11/2026)', () => {
  it('lê os dias como o banco aceita: de 1 a 30, crescentes, até cinco', () => {
    expect(lerDias('1, 3, 7')).toEqual([1, 3, 7]);
    expect(lerDias(' 2 ;5  10 ')).toEqual([2, 5, 10]);
    expect(lerDias('3, 1')).toBeNull();
    expect(lerDias('1, 1')).toBeNull();
    expect(lerDias('0')).toBeNull();
    expect(lerDias('31')).toBeNull();
    expect(lerDias('1, 2, 3, 4, 5, 6')).toBeNull();
    expect(lerDias('1,5;x')).toBeNull();
    expect(lerDias('')).toBeNull();
  });

  it('diz o motivo como a equipe fala, com ou sem detalhe', () => {
    expect(rotuloDoMotivo('modelo_nao_aprovado_na_meta (pending)')).toBe(
      'modelo ainda não aprovado pela Meta',
    );
    expect(rotuloDoMotivo('a_ia_decidiu_nao_retomar: o cliente já comprou')).toBe(
      'a IA leu que o cliente encerrou',
    );
    expect(rotuloDoMotivo('porteira: Envio recusado: teto')).toBe(
      'recusada pela porteira do WhatsApp',
    );
    expect(rotuloDoMotivo('numero_suprimido')).toBe('numero suprimido');
    expect(rotuloDoMotivo('sem_leitura_da_ia: a_ia_nao_leu_a_tempo')).toBe(
      'a IA não leu a conversa antes do modelo',
    );
    expect(rotuloDoMotivo(null)).toBe('sem motivo registrado');
  });

  it('a situação do modelo na Meta', () => {
    expect(rotuloDaSituacao({ situacao: 'approved', aprovado: true, ativo: true })).toBe(
      'aprovado pela Meta',
    );
    expect(rotuloDaSituacao({ situacao: 'pending', aprovado: false, ativo: true })).toBe(
      'esperando a Meta',
    );
    expect(rotuloDaSituacao({ situacao: 'nao_enviado', aprovado: false, ativo: true })).toBe(
      'ainda não enviado à Meta',
    );
    expect(rotuloDaSituacao({ situacao: 'approved', aprovado: true, ativo: false })).toBe(
      'desligado no CRM',
    );
  });

  it('o quando, no relógio de Natal', () => {
    // 12/11/2026 10:00 em Natal = 13:00 UTC.
    const agora = new Date('2026-11-12T13:00:00Z');
    expect(quandoPorPerto('2026-11-12T17:00:00Z', agora)).toBe('hoje, 14:00');
    expect(quandoPorPerto('2026-11-13T11:00:00Z', agora)).toBe('amanhã, 08:00');
    expect(quandoPorPerto('2026-11-16T11:00:00Z', agora)).toBe('16/11, 08:00');
    expect(quandoPorPerto('2026-11-12T12:00:00Z', agora)).toBe('agora');
  });

  it('o selo só aparece com retomada a caminho', () => {
    const agora = new Date('2026-11-12T13:00:00Z');
    const base = {
      motivo: null,
      etapa: 2,
      total: 3,
      dias: 3,
      tipo: 'modelo' as const,
      quando: '2026-11-13T11:00:00Z',
      modeloPronto: true,
    };
    const selo = textoDoSelo({ ...base, situacao: 'aguardando' }, agora);
    expect(selo?.rotulo).toBe('Retomada amanhã, 08:00');
    expect(selo?.detalhe).toMatch(/2ª de 3, 3 dias sem resposta/);
    expect(selo?.detalhe).toMatch(/modelo aprovado pela Meta/);
    expect(
      textoDoSelo({ ...base, situacao: 'devida', quando: '2026-11-12T12:00:00Z' }, agora)?.rotulo,
    ).toBe('Retomada em breve');
    expect(textoDoSelo({ ...base, situacao: 'na_fila' }, agora)?.rotulo).toBe(
      'Retomada: a IA está escrevendo',
    );
    expect(
      textoDoSelo({ ...base, situacao: 'parada', motivo: 'visita_marcada' }, agora),
    ).toBeNull();
    expect(textoDoSelo({ ...base, situacao: 'acabou' }, agora)).toBeNull();
    // A próxima é modelo, e ele não está escolhido nem aprovado: o selo some.
    expect(textoDoSelo({ ...base, situacao: 'aguardando', modeloPronto: false }, agora)).toBeNull();
    // O texto do dia 1 não depende de modelo.
    expect(
      textoDoSelo(
        { ...base, situacao: 'aguardando', tipo: 'texto', dias: 1, modeloPronto: null },
        agora,
      ),
    ).not.toBeNull();
    expect(textoDoSelo({ ...base, situacao: 'desligada' }, agora)).toBeNull();
    expect(textoDoSelo(null, agora)).toBeNull();
  });
});
