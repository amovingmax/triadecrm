import { describe, expect, it } from 'vitest';

import { prepararChamada } from '../src/nucleo/chamada';
import {
  CASOS_DA_BATERIA,
  GRUPOS_DA_BATERIA,
  TETO_DE_CARACTERES,
  casosDaBateria,
  conferirCasoDaBateria,
  contarPerguntas,
  entradaDoCaso,
  quandoDaFala,
} from '../src/prompts/atendente-imova/bateria';
import { BASE_DO_ENSAIO_V5 } from '../src/prompts/atendente-imova/cenarios-v5';
import { atendenteImovaV7 as v7, sistemaComBaseV7 } from '../src/prompts/atendente-imova/v7';

/**
 * A bateria de ensaio da IA que atende (23/11/2026). Sem rede: prova que os 40 casos
 * montam uma entrada válida, que nenhum deles esbarra na auditoria de dado pessoal (uma
 * chamada barrada abriria tarefa para a equipe) e que a régua acerta e erra onde deve.
 * A rodada contra o modelo é `workers ai --ensaio=bateria`.
 */

describe('bateria do atendente: os casos', () => {
  it('são 55 (o A14, o I16, o I17 e os G06 a G08 entraram em 24/11; os D01 a D04 em 25/11; os V01 a V05 em 27/11), com id único, e cobrem os quatro grupos', () => {
    expect(CASOS_DA_BATERIA).toHaveLength(55);
    const ids = CASOS_DA_BATERIA.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const grupo of GRUPOS_DA_BATERIA) {
      expect(CASOS_DA_BATERIA.some((c) => c.grupo === grupo)).toBe(true);
    }
    expect(CASOS_DA_BATERIA.filter((c) => c.critico).length).toBeGreaterThanOrEqual(12);
  });

  it('cada caso monta uma entrada que a v7 aceita, com a última fala do cliente', () => {
    for (const caso of CASOS_DA_BATERIA) {
      const entrada = entradaDoCaso(caso);
      expect(() => v7.entrada.parse(entrada), caso.id).not.toThrow();
      expect(entrada.mensagens.at(-1)?.de, caso.id).toBe('cliente');
      expect(caso.espera.acoes.length, caso.id).toBeGreaterThan(0);
    }
  });

  it('nenhum caso esbarra na auditoria de dado pessoal (a chamada sairia barrada)', () => {
    const prompt = { ...v7, sistema: sistemaComBaseV7(BASE_DO_ENSAIO_V5) };
    for (const caso of CASOS_DA_BATERIA) {
      expect(
        () =>
          prepararChamada(prompt, entradaDoCaso(caso), {
            leadId: `ensaio-${caso.id.toLowerCase()}`,
            nome: caso.nome,
          }),
        caso.id,
      ).not.toThrow();
    }
  });

  it('o horário da fala é o do banco, DD/MM HH:MM, e atravessa a meia-noite', () => {
    expect(quandoDaFala('2026-11-24T10:15', 1)).toBe('24/11 10:14');
    expect(quandoDaFala('2026-11-24T10:15', 4330)).toBe('21/11 10:05');
    expect(quandoDaFala('2026-11-01T00:05', 10)).toBe('31/10 23:55');
  });

  it('roda só os casos pedidos', () => {
    expect(casosDaBateria(['i01', ' A04 ']).map((c) => c.id)).toEqual(['I01', 'A04']);
    expect(casosDaBateria()).toBe(CASOS_DA_BATERIA);
  });
});

describe('bateria do atendente: a régua', () => {
  const caso = (id: string) => {
    const achado = CASOS_DA_BATERIA.find((c) => c.id === id);
    if (achado === undefined) throw new Error(id);
    return achado;
  };
  const comMapa = { temMapa: true };

  it('acerta a resposta certa do caso de Camurupim', () => {
    expect(
      conferirCasoDaBateria(
        caso('I01'),
        {
          acao: 'responder',
          mensagem:
            'Olá, tudo bem? É o terreno de frente para o mar em Tabatinga, perto de Camurupim? Se for, o valor de venda é R$ 520.000.',
          agenda: null,
        },
        comMapa,
      ),
    ).toEqual([]);
  });

  it('pega o "não temos", a área na confirmação e a pergunta repetida', () => {
    const falhas = conferirCasoDaBateria(
      caso('I02'),
      {
        acao: 'responder',
        mensagem: 'Não temos esse terreno. É o de 810 m²? Qual é o nome da avenida?',
        agenda: null,
      },
      comMapa,
    );
    expect(falhas.join(' | ')).toMatch(/não temos/);
    expect(falhas.join(' | ')).toMatch(/área numa pergunta/);
    expect(falhas.join(' | ')).toMatch(/pergunta a rua ou a avenida de novo/);
    expect(falhas.join(' | ')).toMatch(/2 perguntas/);
  });

  it('cobra o que vale para toda resposta: código, corretor, emoji, link e tamanho', () => {
    const falhas = conferirCasoDaBateria(
      caso('A01'),
      {
        acao: 'responder',
        mensagem: `Bom dia 😊 sou do TE0004_IMOVA e um corretor te liga. https://calendly.com/x ${'a'.repeat(TETO_DE_CARACTERES)}`,
        agenda: null,
      },
      comMapa,
    ).join(' | ');
    for (const trecho of ['código do anúncio', 'corretor', 'emoji', 'link', 'caracteres'])
      expect(falhas).toContain(trecho);
  });

  it('a ação errada, o tipo de link errado e a busca no mapa que faltou', () => {
    expect(
      conferirCasoDaBateria(
        caso('L01'),
        { acao: 'responder', mensagem: 'Desculpe a demora.', agenda: null },
        comMapa,
      ),
    ).toEqual(['ação responder; esperava passar_para_corretor']);
    expect(
      conferirCasoDaBateria(
        caso('G01'),
        {
          acao: 'enviar_link_da_agenda',
          mensagem: 'Vou te mandar o link da nossa agenda.',
          agenda: { tipo: 'visita', imovelCodigo: null },
        },
        comMapa,
      ),
    ).toEqual(['link de visita; esperava reuniao']);
    const semBusca = {
      acao: 'responder',
      mensagem: 'É o terreno de frente para o mar em Tabatinga?',
      agenda: null,
    } as const;
    expect(conferirCasoDaBateria(caso('I11'), semBusca, comMapa)).toEqual([
      'não buscou no mapa (nota 14)',
    ]);
    expect(conferirCasoDaBateria(caso('I11'), semBusca, { temMapa: false })).toEqual([]);
    expect(
      conferirCasoDaBateria(caso('I11'), { ...semBusca, ferramentas: ['buscar_no_mapa'] }, comMapa),
    ).toEqual([]);
  });

  it('I17 (conserto 3 do mapa, 24/11): perguntar o lugar passa; oferecer Tabatinga ou Pipa, não', () => {
    const comMapa = { temMapa: true, temFoto: true } as const;
    const busca = { ferramentas: ['buscar_no_mapa'] } as const;
    expect(
      conferirCasoDaBateria(
        caso('I17'),
        {
          acao: 'responder',
          mensagem:
            'Você consegue me dizer o bairro, a rua e o CEP de onde fica o terreno? O que souber já me ajuda.',
          agenda: null,
          ...busca,
        },
        comMapa,
      ),
    ).toEqual([]);
    expect(
      conferirCasoDaBateria(
        caso('I17'),
        {
          acao: 'responder',
          mensagem: 'É o nosso terreno de frente para o mar, em Tabatinga.',
          agenda: null,
          foto: { imovelCodigo: 'TE0004_IMOVA', legenda: 'É este aqui que você viu?' },
          ...busca,
        },
        comMapa,
      ),
    ).toContain('fala do terreno de frente para o mar em Nísia Floresta');
  });

  it('G04 com a v9: o pedido de visita do terreno, da quinta e da manhã; sem pedido, falha', () => {
    const resposta = {
      acao: 'passar_para_corretor',
      mensagem:
        'Perfeito! Vou consultar um horário em que entre na minha agenda e te retorno pra combinarmos.',
      agenda: null,
    } as const;
    const v9 = { temMapa: true, temFoto: true, temVisita: true } as const;
    const certo = { imovelCodigo: 'TE0004_IMOVA', data: '2026-11-26', periodo: 'manha' };
    expect(conferirCasoDaBateria(caso('G04'), { ...resposta, visita: certo }, v9)).toEqual([]);
    expect(conferirCasoDaBateria(caso('G04'), { ...resposta, visita: null }, v9)).toEqual([
      'não manda o pedido de visita aos admins',
    ]);
    expect(
      conferirCasoDaBateria(
        caso('G04'),
        { ...resposta, visita: { ...certo, data: '2026-11-27' } },
        v9,
      ),
    ).toEqual(['pede a visita para 2026-11-27; era 2026-11-26']);
    // Sem a v9, o pedido não é cobrado.
    expect(conferirCasoDaBateria(caso('G04'), resposta, { temMapa: true, temFoto: true })).toEqual(
      [],
    );
    // Pedido onde o caso não pede.
    expect(
      conferirCasoDaBateria(
        caso('G03'),
        {
          acao: 'responder',
          mensagem: 'Qual dia e período ficam melhores para você?',
          agenda: null,
          visita: certo,
        },
        v9,
      ),
    ).toContain('manda pedido de visita quando não devia');
  });

  it('passar sem texto é aceito; o que o texto devia dizer, não', () => {
    expect(
      conferirCasoDaBateria(
        caso('A05'),
        { acao: 'passar_para_corretor', mensagem: '', agenda: null },
        comMapa,
      ),
    ).toEqual([]);
    expect(
      conferirCasoDaBateria(
        caso('L01'),
        { acao: 'passar_para_corretor', mensagem: '', agenda: null },
        comMapa,
      ),
    ).toEqual(['não pede desculpa']);
  });

  it('a foto para confirmar (v8): a do imóvel certo, a frase sem preço nem pergunta, e só quando o caso pede', () => {
    const comFoto = { temMapa: true, temFoto: true };
    const frase = 'É o nosso terreno de frente para o mar em Tabatinga, perto de Camurupim.';
    const fotoTabatinga = { imovelCodigo: 'TE0004_IMOVA', legenda: 'É este aqui que você viu?' };
    const resp = (mensagem: string, foto: typeof fotoTabatinga | null) => ({
      acao: 'responder' as const,
      mensagem,
      agenda: null,
      foto,
    });
    // I01: a foto certa, a frase limpa.
    expect(conferirCasoDaBateria(caso('I01'), resp(frase, fotoTabatinga), comFoto)).toEqual([]);
    // Sem a foto, num caso "deve".
    expect(conferirCasoDaBateria(caso('I01'), resp(frase, null), comFoto)).toContain(
      'não manda a foto para confirmar o imóvel',
    );
    // A foto de outro imóvel.
    expect(
      conferirCasoDaBateria(
        caso('I01'),
        resp(frase, { ...fotoTabatinga, imovelCodigo: 'TE0006' }),
        comFoto,
      ).join(' | '),
    ).toMatch(/foto de TE0006, que não é o imóvel do caso/);
    // Preço, metragem e pergunta no texto que vai antes da foto.
    const falhas = conferirCasoDaBateria(
      caso('I01'),
      resp(`${frase} Tem 816 m² e está à venda por R$ 520.000. Quer saber mais?`, fotoTabatinga),
      comFoto,
    );
    expect(falhas).toEqual(
      expect.arrayContaining([
        'dá o preço antes de o cliente confirmar o imóvel',
        'dá a metragem antes de o cliente confirmar o imóvel',
        'pergunta no texto, além da legenda da foto',
      ]),
    );
    // Dúvida na frase antes da foto.
    expect(
      conferirCasoDaBateria(
        caso('I01'),
        resp(
          'Acho que já sei qual é! Temos um terreno de frente para o mar em Tabatinga.',
          fotoTabatinga,
        ),
        comFoto,
      ),
    ).toContain('mostra dúvida ao dizer qual é o imóvel');
    expect(
      conferirCasoDaBateria(
        caso('I01'),
        resp(
          'Pelo que você descreve, deve ser o terreno de frente para o mar em Tabatinga.',
          fotoTabatinga,
        ),
        comFoto,
      ),
    ).toContain('mostra dúvida ao dizer qual é o imóvel');
    // Legenda que não pergunta.
    expect(
      conferirCasoDaBateria(
        caso('I01'),
        resp(frase, { ...fotoTabatinga, legenda: 'Segue a foto.' }),
        comFoto,
      ),
    ).toContain('a legenda da foto não é uma pergunta');
    // I10 (dois terrenos em Pipa): foto nenhuma.
    expect(
      conferirCasoDaBateria(
        caso('I10'),
        resp('Temos dois em Pipa: 1.338 m² e 2.000 m².', fotoTabatinga),
        comFoto,
      ),
    ).toContain('manda foto quando não devia');
    // I04 ("pode"): com a foto, o preço não é cobrado; sem a foto, é.
    const fotoDe900 = { imovelCodigo: 'TE0006', legenda: 'É este aqui que você viu?' };
    expect(
      conferirCasoDaBateria(
        caso('I04'),
        resp('É o nosso terreno na Rua Professor Etelvino Cunha, em Capim Macio.', fotoDe900),
        comFoto,
      ),
    ).toEqual([]);
    expect(
      conferirCasoDaBateria(
        caso('I04'),
        resp('Temos um terreno na Rua Professor Etelvino Cunha.', null),
        comFoto,
      ).join(' | '),
    ).toMatch(/não dá o valor do terreno de 900 m²/);
    // I03: a pergunta da legenda conta como a confirmação que o caso pede.
    expect(
      conferirCasoDaBateria(
        caso('I03'),
        resp('É o nosso terreno na Rua Professor Etelvino Cunha, em Capim Macio.', {
          imovelCodigo: 'TE0006',
          legenda: 'É este o terreno que você viu?',
        }),
        comFoto,
      ),
    ).toEqual([]);
    // Versão sem foto (v7): o campo é ignorado.
    expect(
      conferirCasoDaBateria(
        caso('I10'),
        resp('Temos dois em Pipa: 1.338 m² e 2.000 m².', fotoTabatinga),
        comMapa,
      ),
    ).toEqual([]);
  });

  it('A14 ("acho que tá caro"): entende + escritura passa; juntar rua, "vende inteiro" ou perguntar não', () => {
    const resp = (mensagem: string) => ({ acao: 'responder' as const, mensagem, agenda: null });
    expect(
      conferirCasoDaBateria(
        caso('A14'),
        resp('Entendo. Ele já tem escritura pública, o que dá segurança na compra.'),
        comMapa,
      ),
    ).toEqual([]);
    const falhas = conferirCasoDaBateria(
      caso('A14'),
      resp(
        'Entendo. Ele tem escritura pública e fica em Capim Macio, na Rua Professor Etelvino Cunha. O proprietário vende só o terreno inteiro. O que pesou mais: o valor, o lugar ou o tamanho?',
      ),
      comMapa,
    );
    expect(falhas).toEqual(
      expect.arrayContaining([
        'faz pergunta quando não devia',
        'junta localização ou regra do proprietário que ele não perguntou',
        'já pergunta o que pesou mais',
      ]),
    );
  });

  it('I09 (Satélite): um terreno parecido passa; dois, não', () => {
    const resp = (mensagem: string) => ({ acao: 'responder' as const, mensagem, agenda: null });
    expect(
      conferirCasoDaBateria(
        caso('I09'),
        resp(
          'No momento não temos terreno no Satélite; temos um terreno em Capim Macio, com escritura pública.',
        ),
        comMapa,
      ),
    ).toEqual([]);
    expect(
      conferirCasoDaBateria(
        caso('I09'),
        resp(
          'No Satélite não temos, mas temos dois terrenos em Capim Macio: um na Rua Professor Etelvino Cunha e outro na Rua Missionário Joel Carlson.',
        ),
        comMapa,
      ),
    ).toContain('oferece mais de um imóvel (item 6: um parecido só)');
  });

  it('o "tudo bem?" do cumprimento não conta como pergunta', () => {
    expect(contarPerguntas('Olá, tudo bem? Como posso te ajudar?')).toBe(1);
    expect(contarPerguntas('Qual dia? E qual período?')).toBe(2);
  });
});

describe('bateria do atendente: o aviso de decisão (v10, 25/11/2026)', () => {
  const caso = (id: string) => {
    const achado = CASOS_DA_BATERIA.find((c) => c.id === id);
    if (achado === undefined) throw new Error(`caso ${id} não existe`);
    return achado;
  };
  const resposta = (extra: Record<string, unknown>) => ({
    acao: 'responder' as const,
    mensagem: 'Entendi. Vou repassar sua proposta ao diretor e te retorno.',
    agenda: null,
    ...extra,
  });
  const v10 = { temMapa: true, temFoto: true, temVisita: true, temDecisao: true };

  it('na v10, a proposta com o valor dele é acerto; sem decisão, ou com outro valor, é falha', () => {
    const d01 = caso('D01');
    expect(
      conferirCasoDaBateria(
        d01,
        resposta({ decisao: { tipo: 'proposta', valorProposto: 450000, sugestoes: 0 } }),
        v10,
      ),
    ).toEqual([]);
    expect(conferirCasoDaBateria(d01, resposta({ decisao: null }), v10)).toContain(
      'responde sem pedir a decisão aos admins',
    );
    expect(
      conferirCasoDaBateria(
        d01,
        resposta({ decisao: { tipo: 'proposta', valorProposto: 400000, sugestoes: 0 } }),
        v10,
      ),
    ).toContain('o valor da proposta veio 400000; era 450000');
  });

  it('"equipe" na fala é falha; decisão onde o caso não pede, também', () => {
    expect(
      conferirCasoDaBateria(
        caso('D01'),
        resposta({
          mensagem: 'Vou levar sua proposta para a equipe e te retorno.',
          decisao: { tipo: 'proposta', valorProposto: 450000, sugestoes: 0 },
        }),
        v10,
      ),
    ).toContain('fala em equipe ao dizer que vai verificar');
    expect(
      conferirCasoDaBateria(
        caso('D04'),
        resposta({
          mensagem: 'Ainda estou verificando e te retorno.',
          decisao: { tipo: 'pergunta', valorProposto: null, sugestoes: 0 },
        }),
        v10,
      ),
    ).toContain('pede decisão quando não devia');
  });

  it('antes da v10, o caso de sempre: a proposta passa a conversa', () => {
    expect(
      conferirCasoDaBateria(caso('D01'), resposta({ acao: 'passar_para_corretor' }), {
        temMapa: true,
        temFoto: true,
        temVisita: true,
      }),
    ).toEqual([]);
  });
});

describe('bateria do atendente: a régua da v11 (27/11/2026)', () => {
  const caso = (id: string) => CASOS_DA_BATERIA.find((c) => c.id === id)!;
  const com = { temMapa: true, temFoto: true, temVisita: true, temDecisao: true };
  const decisao = {
    tipo: 'pergunta' as const,
    valorProposto: null,
    sugestoes: 2,
  };
  const conferir = (id: string, mensagem: string, comDecisao = false): string[] =>
    conferirCasoDaBateria(
      caso(id),
      { acao: 'responder', mensagem, agenda: null, ...(comDecisao ? { decisao } : { decisao: null }) },
      com,
    );

  it('L03 e V02: "não há como garantir" e "forte possibilidade" sem vantagem são erro', () => {
    expect(conferir('V02', 'Não há como garantir valorização, mas a região é procurada.').join(' ')).toMatch(/garantia/);
    expect(conferir('V02', 'É uma área com forte possibilidade de valorização.').join(' ')).toMatch(/forte possibilidade/);
    expect(conferir('L03', 'Tabatinga tem muitas casas de praia: cerca de metade dos domicílios é de uso ocasional.')).toEqual([]);
  });

  it('V01: com a vantagem, "forte possibilidade de valorização" passa; promessa não', () => {
    expect(
      conferir('V01', 'É uma área com forte possibilidade de valorização: os preços em Natal só subiram nos últimos anos.'),
    ).toEqual([]);
    expect(conferir('V01', 'Vai valorizar com certeza.').length).toBeGreaterThan(0);
  });

  it('V04: afirmar segurança ou escola sem fato escrito é erro; "vou verificar" com a decisão passa', () => {
    expect(conferir('V04', 'É um bairro tranquilo e tem escola perto.', true).join(' ')).toMatch(
      /segurança, calma ou escola/,
    );
    expect(conferir('V04', 'Vou verificar esses pontos da região e te retorno.', true)).toEqual([]);
  });

  it('V03 e V05 levam as vantagens no formato do banco', () => {
    expect(caso('V03').vantagens).toBeTruthy();
    expect(caso('V05').vantagens).toBeTruthy();
    expect(caso('V04').vantagens).toBeUndefined();
  });
});

describe('bateria do atendente: o aviso de "não dá para prometer" também é erro (27/11/2026)', () => {
  const caso = CASOS_DA_BATERIA.find((c) => c.id === 'L03')!;
  const com = { temMapa: true, temFoto: true, temVisita: true, temDecisao: true };
  it.each([
    'Sobre valorização, não dá para prometer nada.',
    'Sobre valorização, não temos como prometer nada.',
    'É um dado do passado, sem como prometer o futuro.',
    'Eu prefiro não projetar o futuro.',
  ])('"%s"', (mensagem) => {
    expect(
      conferirCasoDaBateria(caso, { acao: 'responder', mensagem, agenda: null, decisao: null }, com).join(' '),
    ).toMatch(/garantia/);
  });
});
