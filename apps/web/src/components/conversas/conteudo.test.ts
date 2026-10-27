import { describe, expect, it } from 'vitest';

import {
  CONTEUDO_VAZIO,
  fraseDoNaoSuportado,
  lerConteudo,
  lerCoordenadas,
  linkDoMapa,
  montarPergunta,
  resumoDaMensagem,
  telefoneDoCartao,
  textoSemMarcas,
} from './conteudo';

/** O `messages.conteudo` (27/10/2026): a mesma forma nos dois sentidos. */
describe('lerConteudo', () => {
  it('nulo, vazio ou lista dão o conteúdo vazio', () => {
    expect(lerConteudo(null)).toEqual(CONTEUDO_VAZIO);
    expect(lerConteudo({})).toEqual(CONTEUDO_VAZIO);
    expect(lerConteudo([1, 2] as never)).toEqual(CONTEUDO_VAZIO);
  });

  it('lê a localização, com número que veio como texto', () => {
    expect(
      lerConteudo({ latitude: '-5.79', longitude: -35.21, nome: ' Buffet ', endereco: '' })
        .localizacao,
    ).toEqual({ latitude: -5.79, longitude: -35.21, nome: 'Buffet', endereco: null });
  });

  it('localização fora do mapa não vale', () => {
    expect(lerConteudo({ latitude: 120, longitude: 10 }).localizacao).toBeNull();
  });

  it('lê o cartão de contato e pula o contato sem nome', () => {
    const lido = lerConteudo({
      contatos: [
        {
          nome: 'Neuma',
          telefones: [{ numero: '+5584999990000', tipo: 'CELL', wa_id: '5584999990000' }],
        },
        { telefones: [{ numero: '1' }] },
      ],
    });
    expect(lido.contatos).toEqual([
      {
        nome: 'Neuma',
        telefones: [{ numero: '+5584999990000', tipo: 'CELL', waId: '5584999990000' }],
        emails: [],
        empresa: null,
      },
    ]);
  });

  it('lê os botões, a lista e o pedido de localização que uma pessoa mandou', () => {
    expect(
      lerConteudo({ interativo: { tipo: 'botoes', botoes: ['Sim', 'Não'] } }).interativo,
    ).toEqual({
      tipo: 'botoes',
      botoes: ['Sim', 'Não'],
    });
    expect(
      lerConteudo({
        interativo: { tipo: 'lista', botao: 'Ver', itens: [{ titulo: 'Casamento' }] },
      }).interativo,
    ).toEqual({ tipo: 'lista', botao: 'Ver', itens: [{ titulo: 'Casamento', descricao: null }] });
    expect(lerConteudo({ interativo: { tipo: 'pedir_localizacao' } }).interativo).toEqual({
      tipo: 'pedir_localizacao',
    });
    expect(lerConteudo({ interativo: { tipo: 'outra' } }).interativo).toBeNull();
  });

  it('lê a opção escolhida, o anúncio, o erro, o não suportado e o encaminhado', () => {
    const lido = lerConteudo({
      resposta: { id: 'b1', titulo: 'Sim' },
      anuncio: { titulo: 'Buffets em Natal', url: 'https://fb.me/x' },
      erro: { codigo: 131051, titulo: 'Tipo não suportado' },
      nao_suportado: { tipo: 'edit' },
      muito_encaminhada: true,
      versoes: ['antes', 42],
    });
    expect(lido.resposta).toEqual({ titulo: 'Sim', descricao: null });
    expect(lido.anuncio).toEqual({
      titulo: 'Buffets em Natal',
      corpo: null,
      url: 'https://fb.me/x',
    });
    expect(lido.erro).toEqual({ codigo: '131051', titulo: 'Tipo não suportado', detalhe: null });
    expect(lido.naoSuportado).toBe('edit');
    expect(lido.muitoEncaminhada).toBe(true);
    expect(lido.versoes).toEqual(['antes']);
  });

  it('as chaves convivem: o anúncio e a localização na mesma mensagem', () => {
    const lido = lerConteudo({ latitude: 1, longitude: 2, anuncio: { titulo: 'X' } });
    expect(lido.localizacao).not.toBeNull();
    expect(lido.anuncio?.titulo).toBe('X');
  });
});

describe('lerCoordenadas', () => {
  it('lê "lat, lng" e "lat lng"', () => {
    expect(lerCoordenadas('-5.79, -35.21')).toEqual({
      ok: true,
      latitude: -5.79,
      longitude: -35.21,
    });
    expect(lerCoordenadas(' -5.79 -35.21 ')).toEqual({
      ok: true,
      latitude: -5.79,
      longitude: -35.21,
    });
  });

  it('lê os links compridos do Google Maps', () => {
    expect(
      lerCoordenadas(
        'https://www.google.com/maps/place/Buffet/@-5.8801,-35.1702,17z/data=!3d-5.88!4d-35.17',
      ),
    ).toEqual({ ok: true, latitude: -5.8801, longitude: -35.1702 });
    expect(lerCoordenadas('https://maps.google.com/?q=-5.8,-35.2')).toEqual({
      ok: true,
      latitude: -5.8,
      longitude: -35.2,
    });
    expect(lerCoordenadas('https://www.google.com/maps/search/?api=1&query=-5.8%2C-35.2')).toEqual({
      ok: true,
      latitude: -5.8,
      longitude: -35.2,
    });
  });

  it('o link curto diz que não traz o ponto', () => {
    expect(lerCoordenadas('https://maps.app.goo.gl/abc123')).toEqual({
      ok: false,
      motivo: 'link_curto',
    });
  });

  it('recusa o vazio, o que não entende e o que cai fora do mapa', () => {
    expect(lerCoordenadas('   ')).toEqual({ ok: false, motivo: 'vazio' });
    expect(lerCoordenadas('Ponta Negra')).toEqual({ ok: false, motivo: 'nao_entendi' });
    expect(lerCoordenadas('95, 10')).toEqual({ ok: false, motivo: 'fora_do_mapa' });
  });

  it('o link do mapa é o do Google Maps com o ponto', () => {
    expect(linkDoMapa(-5.79, -35.21)).toBe('https://www.google.com/maps?q=-5.79,-35.21');
  });
});

describe('telefoneDoCartao', () => {
  it('sem DDI é brasileiro; com + vale como veio', () => {
    expect(telefoneDoCartao('(84) 99999-0000')).toBe('+5584999990000');
    expect(telefoneDoCartao('84 3222-1111')).toBe('+558432221111');
    expect(telefoneDoCartao('5584999990000')).toBe('+5584999990000');
    expect(telefoneDoCartao('+1 415 555 0100')).toBe('+14155550100');
  });

  it('o que não pode ser telefone é null', () => {
    expect(telefoneDoCartao('9999')).toBeNull();
    expect(telefoneDoCartao('')).toBeNull();
  });
});

describe('montarPergunta', () => {
  it('monta os botões, sem os vazios', () => {
    expect(
      montarPergunta({ modo: 'botoes', pergunta: ' Podemos? ', botoes: ['Sim', ' ', 'Não'] }),
    ).toEqual({
      ok: true,
      corpo: 'Podemos?',
      conteudo: { interativo: { tipo: 'botoes', botoes: ['Sim', 'Não'] } },
    });
  });

  it('recusa o que a Meta recusaria, com a frase', () => {
    const recusa = (r: ReturnType<typeof montarPergunta>) => (r.ok ? null : r.frase);
    expect(recusa(montarPergunta({ modo: 'botoes', pergunta: '', botoes: ['Sim'] }))).toMatch(
      /pergunta/,
    );
    expect(
      recusa(montarPergunta({ modo: 'botoes', pergunta: 'P', botoes: ['Sim', 'sim'] })),
    ).toMatch(/mesmo texto/);
    expect(
      recusa(montarPergunta({ modo: 'botoes', pergunta: 'P', botoes: ['a'.repeat(21)] })),
    ).toMatch(/20 letras/);
    expect(
      recusa(montarPergunta({ modo: 'botoes', pergunta: 'P', botoes: ['a', 'b', 'c', 'd'] })),
    ).toMatch(/3 botões/);
    expect(
      recusa(
        montarPergunta({
          modo: 'lista',
          pergunta: 'P',
          botao: 'Ver',
          itens: [{ titulo: 'x'.repeat(25), descricao: '' }],
        }),
      ),
    ).toMatch(/24 letras/);
  });

  it('monta a lista com a descrição opcional e o pedido de localização', () => {
    expect(
      montarPergunta({
        modo: 'lista',
        pergunta: 'Que evento?',
        botao: 'Ver opções',
        itens: [
          { titulo: 'Casamento', descricao: '' },
          { titulo: 'Aniversário', descricao: 'infantil' },
          { titulo: ' ', descricao: 'some' },
        ],
      }),
    ).toEqual({
      ok: true,
      corpo: 'Que evento?',
      conteudo: {
        interativo: {
          tipo: 'lista',
          botao: 'Ver opções',
          itens: [
            { titulo: 'Casamento', descricao: null },
            { titulo: 'Aniversário', descricao: 'infantil' },
          ],
        },
      },
    });
    expect(montarPergunta({ modo: 'pedir_localizacao', pergunta: 'Onde é?' })).toEqual({
      ok: true,
      corpo: 'Onde é?',
      conteudo: { interativo: { tipo: 'pedir_localizacao' } },
    });
  });
});

describe('o resumo de uma mensagem numa linha', () => {
  const base = {
    tipo: 'text' as const,
    texto: null,
    tipoNaMeta: null,
    midiaNome: null,
    conteudo: CONTEUDO_VAZIO,
    transcricao: null,
  };

  it('tira a assinatura e o "Correção:" da frente', () => {
    expect(textoSemMarcas('*Ana:*\n_Correção:_ Amanhã às 16h')).toBe('Amanhã às 16h');
    expect(resumoDaMensagem({ ...base, texto: '*Ana:*\nOi, tudo bem?' })).toBe('Oi, tudo bem?');
  });

  it('diz o tipo do que não é texto', () => {
    expect(resumoDaMensagem({ ...base, tipo: 'image', tipoNaMeta: 'sticker' })).toBe('Figurinha');
    expect(resumoDaMensagem({ ...base, tipo: 'document', midiaNome: 'cardapio.pdf' })).toBe(
      'Documento: cardapio.pdf',
    );
    expect(
      resumoDaMensagem({
        ...base,
        tipo: 'location',
        conteudo: {
          ...CONTEUDO_VAZIO,
          localizacao: { latitude: 1, longitude: 2, nome: 'Aurora', endereco: null },
        },
      }),
    ).toBe('Localização: Aurora');
  });

  it('corta o texto comprido numa linha', () => {
    const resumo = resumoDaMensagem({ ...base, texto: 'palavra '.repeat(40) });
    expect(resumo.length).toBeLessThanOrEqual(90);
    expect(resumo.endsWith('…')).toBe(true);
  });
});

describe('fraseDoNaoSuportado', () => {
  it('a edição do contato diz que a Meta não manda o texto novo', () => {
    expect(fraseDoNaoSuportado('edit')).toMatch(/não manda o texto novo/);
    expect(fraseDoNaoSuportado('poll_creation')).toMatch(/enquete/);
    expect(fraseDoNaoSuportado('coisa_de_2027')).toMatch(/só abre no celular/);
  });
});
