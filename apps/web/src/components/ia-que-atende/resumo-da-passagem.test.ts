import { describe, expect, it } from 'vitest';

import {
  NAO_DISSE,
  ancoraDaPassagem,
  camposDoResumo,
  equipeRespondeuDepois,
  fraseDaSituacao,
  fraseDoMotivo,
  fraseSemResumo,
  lerPassagens,
  linhaDaObjecao,
  linhaDaProcura,
  linhaDoOrcamento,
  linhaDosImoveis,
  manchete,
  type ResumoDaPassagem,
} from './resumo-da-passagem-formatos';

/**
 * O resumo da passagem na tela (Imova, 11/11/2026): a leitura do que o banco devolve e as
 * frases. O que o cliente não disse aparece como "não disse", nunca some nem é preenchido.
 */

const RESUMO_DO_BANCO = {
  negocio: 'compra',
  tipo: 'apartamento de 3 quartos',
  regiao: 'Ponta Negra',
  imoveis: ['AP0031_IMOVA'],
  orcamento: 'até R$ 600 mil',
  pagamento: 'financiamento',
  objecao: 'preco',
  objecao_nome: 'Preço',
  objecao_como_disse: 'achou o condomínio salgado',
  temperatura: 'quente',
  temperatura_porque: 'Quer visitar no sábado.',
  porque_passou: 'Quer negociar o valor.',
  proximo_passo: 'Levar o pedido ao proprietário.',
  dados_insuficientes: false,
  motivo_sem_resumo: null,
  escrito_em: '2026-11-11T12:20:30Z',
};

function doBanco(extras: Record<string, unknown> = {}) {
  return {
    existe: true,
    simulada: false,
    passada_para: 'Ana',
    passagens: [
      {
        resposta_id: 'r-2',
        message_id: 'm-2',
        criada_em: '2026-11-11T12:20:00Z',
        motivo: 'o cliente quer negociar o valor',
        aviso_saiu: true,
        situacao: 'pronto',
        resumo: RESUMO_DO_BANCO,
      },
      {
        resposta_id: 'r-1',
        message_id: null,
        criada_em: '2026-11-01T12:00:00Z',
        motivo: null,
        aviso_saiu: false,
        situacao: 'antes',
        resumo: null,
      },
    ],
    destaque: 'r-2',
    ...extras,
  };
}

const VAZIO: ResumoDaPassagem = {
  negocio: null,
  tipo: null,
  regiao: null,
  imoveis: [],
  interesse: [],
  orcamento: null,
  pagamento: null,
  objecao: null,
  objecaoNome: null,
  objecaoComoDisse: null,
  temperatura: null,
  temperaturaPorque: null,
  porquePassou: null,
  proximoPasso: null,
  dadosInsuficientes: true,
  motivoSemResumo: null,
  escritoEm: null,
};

describe('lerPassagens', () => {
  it('lê as passagens, o resumo e qual fica em destaque', () => {
    const lido = lerPassagens(doBanco());
    expect(lido?.passadaPara).toBe('Ana');
    expect(lido?.passagens).toHaveLength(2);
    expect(lido?.destaque?.respostaId).toBe('r-2');
    expect(lido?.passagens[0]?.resumo).toMatchObject({
      negocio: 'compra',
      imoveis: ['AP0031_IMOVA'],
      objecaoNome: 'Preço',
      temperatura: 'quente',
      proximoPasso: 'Levar o pedido ao proprietário.',
    });
    expect(lido?.passagens[1]).toMatchObject({
      messageId: null,
      situacao: 'antes',
      simulada: false,
      resumo: null,
    });
  });

  it('quem não vê recebe null; destaque que não está na lista não vira destaque', () => {
    expect(lerPassagens({ existe: false })).toBeNull();
    expect(lerPassagens(null)).toBeNull();
    expect(lerPassagens(doBanco({ destaque: 'r-9' }))?.destaque).toBeNull();
    expect(lerPassagens(doBanco({ destaque: null }))?.destaque).toBeNull();
  });

  it('valor fora da lista vira nulo, e situação desconhecida vira "não chegou"', () => {
    const lido = lerPassagens(
      doBanco({
        passagens: [
          {
            resposta_id: 'r-3',
            criada_em: '2026-11-11T12:20:00Z',
            situacao: 'inventada',
            resumo: { ...RESUMO_DO_BANCO, temperatura: 'cliente', negocio: 'aluguel' },
          },
        ],
      }),
    );
    expect(lido?.passagens[0]?.situacao).toBe('nao_chegou');
    expect(lido?.passagens[0]?.resumo?.temperatura).toBeNull();
    expect(lido?.passagens[0]?.resumo?.negocio).toBeNull();
  });
});

describe('as frases do resumo', () => {
  const resumo = lerPassagens(doBanco())!.passagens[0]!.resumo!;

  it('o que ele procura, o orçamento e a objeção, em uma linha cada', () => {
    expect(linhaDaProcura(resumo)).toBe('comprar · apartamento de 3 quartos · em Ponta Negra');
    expect(linhaDoOrcamento(resumo)).toBe('até R$ 600 mil · financiamento');
    expect(linhaDaObjecao(resumo)).toBe('Preço — achou o condomínio salgado');
    expect(manchete(resumo)).toBe(
      'comprar · apartamento de 3 quartos · em Ponta Negra · AP0031_IMOVA · até R$ 600 mil · financiamento',
    );
  });

  it('o pagamento sai em português, e o que falta não aparece', () => {
    expect(linhaDoOrcamento({ ...resumo, orcamento: null, pagamento: 'a_vista' })).toBe('à vista');
    expect(linhaDoOrcamento({ ...resumo, pagamento: 'fgts' })).toBe('até R$ 600 mil · FGTS');
    expect(linhaDaProcura({ ...resumo, negocio: 'locacao', tipo: null, regiao: null })).toBe(
      'alugar',
    );
    expect(
      linhaDaObjecao({
        ...resumo,
        objecaoNome: null,
        objecaoComoDisse: null,
        objecao: 'decide_com_outra_pessoa',
      }),
    ).toBe('decide com outra pessoa');
  });

  it('o que ele não disse é "não disse", nunca vazio nem inventado', () => {
    expect(manchete(VAZIO)).toBeNull();
    expect(camposDoResumo(VAZIO)).toEqual([
      { rotulo: 'Procura', valor: NAO_DISSE, disse: false },
      { rotulo: 'Imóveis', valor: NAO_DISSE, disse: false },
      { rotulo: 'Orçamento', valor: NAO_DISSE, disse: false },
      { rotulo: 'Objeção', valor: NAO_DISSE, disse: false },
    ]);
    expect(camposDoResumo(resumo).every((c) => c.disse)).toBe(true);
  });

  it('por que o resumo não saiu, e o motivo da passagem como frase', () => {
    expect(fraseSemResumo('dado_pessoal')).toBe(
      'a conversa tem telefone, e-mail ou @ que não pode ir para a IA',
    );
    expect(fraseSemResumo('orcamento')).toBe('o orçamento de IA do mês chegou ao limite');
    expect(fraseSemResumo('qualquer_outro')).toBe('o resumo não saiu');
    expect(fraseSemResumo(null)).toBe('o resumo não saiu');
    expect(fraseDoMotivo('o cliente pediu para falar com um corretor')).toBe(
      'O cliente pediu para falar com um corretor.',
    );
    expect(fraseDoMotivo('Pediu ligação!')).toBe('Pediu ligação!');
    expect(fraseDoMotivo('  ')).toBeNull();
  });
});

describe('equipeRespondeuDepois', () => {
  const passou = '2026-11-11T12:20:00Z';

  it('só gente da equipe, e só depois da passagem', () => {
    expect(
      equipeRespondeuDepois(
        [
          { entrada: false, autorTipo: 'human', em: '2026-11-11T12:10:00Z' },
          { entrada: false, autorTipo: 'bot_ai', em: '2026-11-11T12:21:00Z' },
          { entrada: true, autorTipo: 'system', em: '2026-11-11T12:22:00Z' },
        ],
        passou,
      ),
    ).toBe(false);
    expect(
      equipeRespondeuDepois(
        [{ entrada: false, autorTipo: 'human', em: '2026-11-11T12:25:00Z' }],
        passou,
      ),
    ).toBe(true);
  });

  it('data que não se lê não esconde nada', () => {
    expect(
      equipeRespondeuDepois(
        [{ entrada: false, autorTipo: 'human', em: '2026-11-11T12:25:00Z' }],
        'x',
      ),
    ).toBe(false);
  });
});

describe('ancoraDaPassagem', () => {
  const mensagens = [
    { id: 'a', em: '2026-11-11T12:00:00Z' },
    { id: 'c', em: '2026-11-11T12:30:00Z' },
    { id: 'b', em: '2026-11-11T12:10:00Z' },
  ];

  it('a passagem sem aviso vai embaixo da última mensagem até a hora dela', () => {
    expect(ancoraDaPassagem(mensagens, '2026-11-11T12:15:00Z')).toBe('b');
    expect(ancoraDaPassagem(mensagens, '2026-11-11T12:10:00Z')).toBe('b');
    expect(ancoraDaPassagem(mensagens, '2026-11-11T13:00:00Z')).toBe('c');
  });

  it('sem mensagem antes, ou com data ilegível, não há onde pôr', () => {
    expect(ancoraDaPassagem(mensagens, '2026-11-11T11:00:00Z')).toBeNull();
    expect(ancoraDaPassagem(mensagens, 'x')).toBeNull();
    expect(ancoraDaPassagem([], '2026-11-11T12:15:00Z')).toBeNull();
  });
});

describe('fraseDaSituacao', () => {
  it('cada situação sem resumo diz o que aconteceu, e pronto não diz nada', () => {
    expect(fraseDaSituacao({ situacao: 'escrevendo', resumo: null })).toMatch(
      /escrevendo o resumo/,
    );
    expect(fraseDaSituacao({ situacao: 'nao_chegou', resumo: null })).toMatch(/não chegou/);
    expect(fraseDaSituacao({ situacao: 'antes', resumo: null })).toMatch(/de antes do resumo/);
    expect(
      fraseDaSituacao({ situacao: 'falhou', resumo: { ...VAZIO, motivoSemResumo: 'desligado' } }),
    ).toBe('Sem resumo: o resumo da passagem está desligado. Leia a conversa.');
    expect(
      fraseDaSituacao({ situacao: 'falhou', resumo: { ...VAZIO, motivoSemResumo: 'suprimido' } }),
    ).toBe('Sem resumo: o cliente pediu para não ser mais contatado. Leia a conversa.');
    expect(fraseDaSituacao({ situacao: 'pronto', resumo: VAZIO })).toBeNull();
  });
});

describe('o imóvel de interesse lido pela IA (25/11/2026)', () => {
  it('sem código escrito pelo cliente, o cartão mostra o imóvel que a IA registrou, marcado', () => {
    const r: ResumoDaPassagem = {
      ...VAZIO,
      interesse: ['terreno em Praia de Tabatinga (TE0004_IMOVA)'],
    };
    expect(linhaDosImoveis(r)).toBe('terreno em Praia de Tabatinga (TE0004_IMOVA) (lido pela IA)');
    expect(camposDoResumo(r).find((c) => c.rotulo === 'Imóveis')).toMatchObject({ disse: true });
  });

  it('com código escrito pelo cliente, vale o código; sem nenhum dos dois, "não disse"', () => {
    expect(linhaDosImoveis({ ...VAZIO, imoveis: ['TE0007'], interesse: ['x (Y)'] })).toBe('TE0007');
    expect(linhaDosImoveis(VAZIO)).toBeNull();
  });

  it('o banco manda `interesse` e a leitura aceita', () => {
    const p = lerPassagens(
      doBanco({
        passagens: [
          {
            resposta_id: 'r-9',
            message_id: 'm-9',
            criada_em: '2026-11-25T18:00:00Z',
            motivo: 'visita presencial pedida',
            aviso_saiu: true,
            situacao: 'pronto',
            resumo: { ...RESUMO_DO_BANCO, imoveis: [], interesse: ['terreno em Pipa (TE0007)'] },
          },
        ],
      }),
    );
    expect(p?.passagens[0]?.resumo?.interesse).toEqual(['terreno em Pipa (TE0007)']);
  });
});
