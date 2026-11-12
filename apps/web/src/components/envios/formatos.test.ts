import { describe, expect, it } from 'vitest';

import {
  acaoSugerida,
  acoesPara,
  aplicarQuantidade,
  custoEstimado,
  divisaoDoDia,
  duracaoEstimada,
  filtrosEscondidos,
  formatarNumero,
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

describe('a quantidade do disparo (12/11/2026)', () => {
  const marcados = ['a', 'b', 'c', 'd', 'e'];

  it('vazio manda para todos os marcados', () => {
    expect(aplicarQuantidade(marcados, null)).toEqual(marcados);
  });

  it('com um número, vão os primeiros da lista, nessa ordem — os 3 do teste', () => {
    expect(aplicarQuantidade(marcados, 3)).toEqual(['a', 'b', 'c']);
  });

  it('pedir mais do que há manda para todos, sem inventar ninguém', () => {
    expect(aplicarQuantidade(marcados, 50)).toEqual(marcados);
  });

  it('zero, negativo e fração não viram gente', () => {
    expect(aplicarQuantidade(marcados, 0)).toEqual([]);
    expect(aplicarQuantidade(marcados, -2)).toEqual([]);
    expect(aplicarQuantidade(marcados, 2.9)).toEqual(['a', 'b']);
    expect(aplicarQuantidade(marcados, Number.NaN)).toEqual(marcados);
  });
});

describe('o que cabe hoje no limite da Meta', () => {
  it('cabe tudo: nada fica para depois', () => {
    expect(divisaoDoDia(3, 1990, 0)).toEqual({ hoje: 3, depois: 0 });
  });

  it('desconta o que outros disparos já vão mandar', () => {
    expect(divisaoDoDia(500, 1000, 700)).toEqual({ hoje: 300, depois: 200 });
  });

  it('limite esgotado: tudo para o próximo dia útil', () => {
    expect(divisaoDoDia(10, 0, 0)).toEqual({ hoje: 0, depois: 10 });
  });

  it('sem saber o limite, não chuta', () => {
    expect(divisaoDoDia(10, null, 0)).toBeNull();
  });

  it('o número sai com ponto de milhar', () => {
    expect(formatarNumero(2000)).toBe('2.000');
  });
});

describe('os botões de um modelo', () => {
  it('"Agora não" tira da lista; o resto manda o link', () => {
    expect(acaoSugerida('Agora não')).toEqual({ acao: 'sair' });
    expect(acaoSugerida('Quero saber mais').acao).toBe('link');
  });

  it('só os de resposta ganham ação, e o que já foi editado fica', () => {
    const acoes = acoesPara(
      [
        { tipo: 'resposta', texto: 'Quero' },
        { tipo: 'resposta', texto: 'Agora não' },
        { tipo: 'link', texto: 'Criar meu perfil' },
      ],
      { Quero: { acao: 'nada' } },
    );
    expect(acoes).toEqual({ Quero: { acao: 'nada' }, 'Agora não': { acao: 'sair' } });
  });

  it('as recusas falam em disparo e no ritmo novo', () => {
    expect(fraseDaRecusa('ritmo_invalido')).toMatch(/300/);
    expect(fraseDaRecusa('sem_permissao')).toMatch(/SDR/);
  });
});
