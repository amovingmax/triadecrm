import { describe, expect, it } from 'vitest';

import {
  acoesPara,
  duracaoEstimada,
  fraseDaRecusa,
  fraseDoMotivo,
  progresso,
  regrasIncompletas,
  regrasPara,
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

describe('o que cada botão faz', () => {
  it('"Agora não" encerra; o resto manda o link', () => {
    const acoes = acoesPara(
      [
        { tipo: 'resposta', texto: 'Quero o convite' },
        { tipo: 'resposta', texto: 'Agora não' },
        { tipo: 'link', texto: 'Criar meu perfil' },
      ],
      {},
    );
    expect(acoes['Agora não']).toEqual({ acao: 'sair' });
    expect(acoes['Quero o convite']?.acao).toBe('link');
    expect(Object.keys(acoes)).toHaveLength(2);
  });
});
