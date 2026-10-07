import { describe, expect, it } from 'vitest';

import { avisoDaSaudacao, frasePulados, lerResultado, recadoDaSaudacao } from './saudacao';

/**
 * O aviso de depois do clique é a única coisa que a pessoa lê sobre a saudação:
 * a mensagem não sai na hora, e quem foi pulado não aparece em lugar nenhum.
 * Número errado ou frase sem sentido aqui é a pessoa achando que mandou para
 * cinquenta quando mandou para dois.
 */
describe('a resposta do banco', () => {
  it('lê os números e os pulados, ignorando o que não conhece', () => {
    expect(
      lerResultado({
        ok: true,
        na_fila: 3,
        na_frente: 7,
        por_hora: 6,
        recusados: { ja_conversou: 2, sem_whatsapp: 1, motivo_novo: 4 },
      }),
    ).toEqual({
      ok: true,
      naFila: 3,
      naFrente: 7,
      porHora: 6,
      pulados: { ja_conversou: 2, sem_whatsapp: 1 },
    });
  });

  it('recusa vira motivo; resposta estranha vira erro do servidor', () => {
    expect(lerResultado({ ok: false, motivo: 'saudacao_desligada' })).toEqual({
      ok: false,
      motivo: 'saudacao_desligada',
    });
    expect(lerResultado(null)).toEqual({ ok: false, motivo: 'erro_do_servidor' });
  });
});

describe('quem foi pulado, em português', () => {
  it('singular e plural, e "e" antes do último', () => {
    expect(frasePulados({ ja_conversou: 1 })).toBe('1 já conversa com a gente');
    expect(frasePulados({ ja_conversou: 2, sem_whatsapp: 1, nao_contatar: 3 })).toBe(
      '2 já conversam com a gente, 1 sem WhatsApp e 3 pediram para não ser contatados',
    );
  });

  it('ninguém pulado: nada a dizer', () => {
    expect(frasePulados({})).toBeNull();
  });
});

describe('o aviso de depois do clique', () => {
  const base = { ok: true as const, naFrente: 0, porHora: 6, pulados: {} };

  it('um só: curto, e diz que não sai na hora', () => {
    const aviso = avisoDaSaudacao({ ...base, naFila: 1 });
    expect(aviso.titulo).toBe('Saudação na fila.');
    expect(aviso.descricao).toMatch(/Sai 6 por hora, só no horário de envio/);
    expect(aviso.entrou).toBe(true);
  });

  it('vários, com quem estava na frente e quem foi pulado', () => {
    const aviso = avisoDaSaudacao({
      ...base,
      naFila: 12,
      naFrente: 4,
      pulados: { ja_recebeu: 2 },
    });
    expect(aviso.titulo).toBe('Saudação na fila para 12 parceiros.');
    expect(aviso.descricao).toMatch(/4 na frente\./);
    expect(aviso.descricao).toMatch(/Pulados: 2 já receberam a saudação\./);
  });

  it('ninguém entrou: diz por quê, e não oferece desfazer', () => {
    const aviso = avisoDaSaudacao({ ...base, naFila: 0, pulados: { ja_conversou: 1 } });
    expect(aviso).toEqual({
      titulo: 'Ninguém entrou na fila.',
      descricao: 'Pulados: 1 já conversa com a gente.',
      entrou: false,
    });
  });

  it('o interruptor desligado manda para onde ligar', () => {
    expect(recadoDaSaudacao('saudacao_desligada')).toMatch(/Ajustes → Atendimento/);
  });
});
