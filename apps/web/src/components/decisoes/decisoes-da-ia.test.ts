import { describe, expect, it } from 'vitest';

import {
  avisoDoResultado,
  decisoesNaoVistas,
  diferencaDoAnunciado,
  lerDecisao,
  lerResultado,
  lerValorDigitado,
  linhaDaDecisao,
  reais,
  textoDaProposta,
  valorCurto,
} from './decisoes-da-ia';

/**
 * O AVISO DE DECISÃO (IMOVA, 25/11/2026), A PARTE DO SITE.
 *
 * O que estes casos protegem: o cartão só mostra "Aceitar os R$ 4 milhões" quando há valor;
 * as prévias dizem, palavra por palavra, o que o banco manda (`app.ia_decisao_texto`, os
 * mesmos textos conferidos no pgTAP 207); e o admin entende o que aconteceu depois do toque.
 */

const DO_BANCO = {
  id: 'd1',
  conversa_id: 'c1',
  cliente: 'Paula Freitas',
  primeiro_nome: 'Paula',
  caminho: '/conversas?cliente=c1',
  tipo: 'proposta',
  situacao: 'aberta',
  pergunta: 'Achei caro. O proprietário aceita 4 milhões?',
  resposta_da_ia: 'Entendi. Vou repassar sua proposta ao diretor e te retorno.',
  sugestoes: [],
  imovel_codigo: 'TE0001_IMOVA',
  imovel: 'o terreno em Capim Macio',
  titulo: 'Terreno em Capim Macio',
  area: 3000,
  valor_anunciado: 4500000,
  valor_proposto: 4000000,
  consultando_por: null,
  consultando_em: null,
  criado_em: '2026-11-25T18:26:00Z',
};

describe('a decisão lida do banco', () => {
  it('a proposta, com os valores e o imóvel', () => {
    expect(lerDecisao(DO_BANCO)).toMatchObject({
      id: 'd1',
      tipo: 'proposta',
      primeiroNome: 'Paula',
      valorProposto: 4_000_000,
      valorAnunciado: 4_500_000,
      imovel: 'o terreno em Capim Macio',
      sugestoes: [],
    });
  });

  it('proposta sem valor vira pergunta; sugestão sem rótulo ou resposta sai', () => {
    const d = lerDecisao({
      ...DO_BANCO,
      valor_proposto: null,
      sugestoes: [
        { rotulo: 'Sim', resposta: 'Ajudamos sim.' },
        { rotulo: '', resposta: 'x' },
        { rotulo: 'Não' },
      ],
    });
    expect(d?.tipo).toBe('pergunta');
    expect(d?.sugestoes).toEqual([{ rotulo: 'Sim', resposta: 'Ajudamos sim.' }]);
  });

  it('sem id, conversa, data ou pergunta: não é cartão', () => {
    expect(lerDecisao({ ...DO_BANCO, pergunta: ' ' })).toBeNull();
    expect(lerDecisao(null)).toBeNull();
  });
});

describe('os valores', () => {
  it('reais como o banco escreve, o curto do botão e a diferença', () => {
    expect(reais(4_000_000)).toBe('R$ 4.000.000');
    expect(reais(334_500)).toBe('R$ 334.500');
    expect(valorCurto(4_000_000)).toBe('R$ 4 milhões');
    expect(valorCurto(1_000_000)).toBe('R$ 1 milhão');
    expect(valorCurto(4_300_000)).toBe('R$ 4,3 milhões');
    expect(valorCurto(450_000)).toBe('R$ 450 mil');
    expect(valorCurto(334_500)).toBe('R$ 334.500');
    const d = lerDecisao(DO_BANCO);
    expect(d === null ? null : diferencaDoAnunciado(d)).toBe('11% abaixo do anunciado');
  });

  it('o valor digitado na contraproposta', () => {
    expect(lerValorDigitado('4.300.000')).toBe(4_300_000);
    expect(lerValorDigitado('R$ 4.300.000,00')).toBe(4_300_000);
    expect(lerValorDigitado('4300000')).toBe(4_300_000);
    expect(lerValorDigitado('abc')).toBeNull();
    expect(lerValorDigitado('0')).toBeNull();
  });
});

describe('as prévias dizem o que o banco manda', () => {
  const d = lerDecisao(DO_BANCO);
  if (d === null) throw new Error('decisão do teste não leu');

  it('os quatro botões da proposta', () => {
    expect(textoDaProposta('consultar', d)).toBe(
      'Paula, sua proposta de R$ 4.000.000 já está com o proprietário. Assim que ele responder, te aviso por aqui.',
    );
    expect(textoDaProposta('aceitar', d)).toBe(
      'Boa notícia, Paula: o proprietário aceitou sua proposta de R$ 4.000.000 pelo terreno em Capim Macio. Para seguirmos, é só escolher o melhor dia e horário para conversarmos pelo link abaixo.',
    );
    expect(textoDaProposta('recusar', d)).toBe(
      'Paula, o proprietário não aceitou a proposta de R$ 4.000.000. O terreno em Capim Macio segue por R$ 4.500.000. Se quiser fazer outra proposta, é só me dizer.',
    );
    expect(textoDaProposta('contraproposta', d, 4_300_000)).toBe(
      'Paula, o proprietário não chegou aos R$ 4.000.000, mas aceita R$ 4.300.000 pelo terreno em Capim Macio. Se fizer sentido para você, é só me dizer.',
    );
  });

  it('sem nome, sem imóvel e sem preço anunciado', () => {
    const s = { ...d, primeiroNome: null, imovel: null, valorAnunciado: null };
    expect(textoDaProposta('recusar', s)).toBe(
      'O proprietário não aceitou a proposta de R$ 4.000.000. Se quiser fazer outra proposta, é só me dizer.',
    );
    expect(textoDaProposta('aceitar', s)).toMatch(/^Boa notícia: .* pelo imóvel\./);
  });
});

describe('depois do toque', () => {
  it('a IA respondeu, a consulta, a escrita e o que não saiu', () => {
    expect(
      avisoDoResultado('aceitar', lerResultado({ ok: true, mensagem_saiu: true, como: 'ia' })),
    ).toMatchObject({
      titulo: 'A IA respondeu o cliente',
      tom: 'sucesso',
    });
    expect(
      avisoDoResultado('consultar', lerResultado({ ok: true, mensagem_saiu: true })),
    ).toMatchObject({
      titulo: 'O cliente sabe que a proposta está com o proprietário',
    });
    expect(avisoDoResultado('escrita', lerResultado({ ok: true, ia_escreve: true }))).toMatchObject(
      {
        titulo: 'A IA vai responder o cliente',
      },
    );
    expect(
      avisoDoResultado('recusar', lerResultado({ ok: true, mensagem_saiu: false })),
    ).toMatchObject({
      tom: 'aviso',
    });
    expect(
      avisoDoResultado('recusar', lerResultado({ ok: true, mensagem_saiu: true, como: 'admin' })),
    ).toMatchObject({
      titulo: 'A mensagem saiu em seu nome',
    });
  });

  it('outro admin já respondeu', () => {
    expect(
      avisoDoResultado('aceitar', lerResultado({ ok: false, motivo: 'ja_decidido', por: 'Janio' })),
    ).toEqual({
      titulo: 'Outro admin já respondeu',
      descricao: 'Quem respondeu: Janio.',
      tom: 'aviso',
    });
  });
});

describe('o toque e a notificação', () => {
  it('só o que é novo toca, e a linha diz quem e quanto', () => {
    const d = lerDecisao(DO_BANCO);
    if (d === null) throw new Error('decisão do teste não leu');
    expect(decisoesNaoVistas([d], new Set(['d1']))).toEqual([]);
    expect(decisoesNaoVistas([d], new Set())).toEqual([d]);
    expect(linhaDaDecisao(d)).toBe(
      'Paula Freitas oferece R$ 4.000.000 pelo terreno em Capim Macio',
    );
    expect(linhaDaDecisao({ ...d, tipo: 'pergunta' })).toBe(
      'Paula Freitas perguntou: “Achei caro. O proprietário aceita 4 milhões?”',
    );
  });
});
