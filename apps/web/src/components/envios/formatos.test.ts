import { describe, expect, it } from 'vitest';

import {
  custoEstimado,
  duracaoEstimada,
  filtrosEscondidos,
  formatarReais,
  fraseDaRecusa,
  fraseDoMotivo,
  nomeSugerido,
  progresso,
  regrasIncompletas,
  regrasPara,
  rotuloDaMensagem,
  variaveisComRegra,
  variaveisDoCorpo,
} from './formatos';

describe('as variáveis de um corpo', () => {
  it('na ordem da primeira aparição, sem repetir, com ou sem espaço nas chaves', () => {
    expect(variaveisDoCorpo('Oi {{nome}}, da {{ empresa }}! {{nome}} de novo')).toEqual([
      'nome',
      'empresa',
    ]);
  });

  it('atendente e saudação não pedem regra: o banco preenche', () => {
    expect(variaveisComRegra('{{saudacao}}, {{nome}}! Aqui é {{atendente}}.')).toEqual(['nome']);
  });
});

describe('as regras sugeridas', () => {
  it('campo da ficha puxa da ficha, com uma reserva que ainda lê bem', () => {
    expect(regrasPara('Oi {{nome}}, da {{empresa}}, de {{categoria}}', {})).toEqual({
      nome: { campo: 'nome', reserva: 'pessoal' },
      empresa: { campo: 'empresa', reserva: '' },
      categoria: { campo: 'categoria', reserva: 'eventos' },
    });
  });

  it('variável que não é da ficha vira texto fixo, e fica incompleta até alguém escrever', () => {
    const regras = regrasPara('Convite para {{evento}}', {});
    expect(regras).toEqual({ evento: { fixo: '' } });
    expect(regrasIncompletas(regras)).toEqual(['evento']);
  });

  it('trocar de modelo mantém o que a pessoa já tinha escrito', () => {
    const antes = { evento: { fixo: 'Feira de Noivas' } };
    expect(regrasPara('{{evento}} e {{nome}}', antes).evento).toEqual({ fixo: 'Feira de Noivas' });
  });
});

describe('os motivos em português', () => {
  it('motivo conhecido vira frase; desconhecido aparece como veio', () => {
    expect(fraseDoMotivo('contato_suprimido')).toMatch(/não receber/);
    expect(fraseDoMotivo('coisa_nova')).toBe('Recusado: coisa_nova.');
    expect(fraseDoMotivo(null)).toBe('');
  });

  it('a recusa do lote diz qual variável', () => {
    expect(fraseDaRecusa('variavel_sem_regra', 'evento')).toMatch(/\{\{evento\}\}/);
  });
});

describe('o tempo do lote', () => {
  it('poucas mensagens em ritmo alto: minutos', () => {
    expect(duracaoEstimada(10, 30, 45)).toBe('cerca de 20 min');
  });

  it('o teto de primeiros contatos pode mandar para vários dias', () => {
    expect(duracaoEstimada(120, 60, 35)).toBe('cerca de 4 dias úteis');
  });

  it('sem teto (quem já conversou), só o ritmo decide', () => {
    expect(duracaoEstimada(60, 20, null)).toBe('cerca de 3 h');
  });
});

describe('o progresso', () => {
  it('conta enviada, pulada e cancelada como decidida', () => {
    const c = {
      total: 10, pendentes: 4, enviadas: 4, puladas: 1, canceladas: 1,
      entregues: 3, lidas: 2, falharam: 0, responderam: 1, sairam: 0, tocaram: 0, clicaram: 0, cadastraram: 0,
    };
    expect(progresso(c)).toBeCloseTo(0.6);
  });
});

describe('a tela única da campanha', () => {
  it('o nome sai sozinho: a mensagem e o dia de Natal', () => {
    // 22h de 21/09 em Natal já é 22/09 em UTC: vale o dia de Natal.
    expect(nomeSugerido('Convite fundador', new Date('2026-09-22T01:00:00Z'))).toBe(
      'Convite fundador — 21/09',
    );
    expect(nomeSugerido(null)).toBe('');
    expect(nomeSugerido('   ')).toBe('');
  });

  it('marketing custa por mensagem; utilidade é grátis para quem está na janela', () => {
    expect(custoEstimado('marketing', 100, 30)).toBeCloseTo(34);
    expect(custoEstimado('utility', 100, 30)).toBeCloseTo(2.45);
    expect(custoEstimado(null, 100, 0)).toBeNull();
    expect(formatarReais(29.58).replace(/\s/g, ' ')).toBe('R$ 29,58');
  });

  it('conta os filtros escondidos em "Mais filtros", e só eles', () => {
    expect(filtrosEscondidos({ situacoes: ['nunca_contatado'], tags: [1], setores: [2] })).toBe(0);
    expect(
      filtrosEscondidos({ cidades: [1], tipos: [], busca: ' buffet ', sem_contato_ha_dias: 0 }),
    ).toBe(3);
  });

  it('os três cumprimentos aparecem como um só na lista de campanhas', () => {
    expect(rotuloDaMensagem('Boa tarde (cumprimento solto)')).toBe('Cumprimento');
    expect(rotuloDaMensagem(null)).toBe('Texto livre');
    expect(rotuloDaMensagem('Convite de fornecedor fundador (Komune)')).toBe(
      'Convite de fornecedor fundador (Komune)',
    );
  });
});
