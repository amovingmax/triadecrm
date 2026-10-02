import { describe, expect, it } from 'vitest';

import {
  aindaNaoAbertas,
  chegaramAgora,
  destinoDoAviso,
  ehParaMim,
  maisRecente,
  marcaDoAviso,
  nomeDoAviso,
  pisoPossivel,
  previaDaMensagem,
  recebeAvisos,
  respostasParaMim,
  rotuloDasRespostas,
  semOQueOPisoCobre,
  textoDoAviso,
  ultimaChegada,
  type ConversaComResposta,
  type QuemSouEu,
} from './regra';

/**
 * O que estes testes protegem.
 *
 * O aviso erra calado de dois jeitos, e os dois custam caro: avisar quem não
 * atende (a pessoa aprende a ignorar o número) e NÃO avisar quem atende (a
 * resposta espera, a janela de 24 h fecha e a próxima mensagem é um modelo
 * pago). A regra é pequena de propósito, e cada linha dela está fixada aqui.
 *
 * O socket e a notificação do sistema não são testados aqui — quem os prova é o
 * navegador, com o CRM aberto.
 */

const GESTOR: QuemSouEu = { id: 'gestor-1', papel: 'gestor' };
const SDR: QuemSouEu = { id: 'sdr-1', papel: 'sdr' };
const ADMIN: QuemSouEu = { id: 'admin-1', papel: 'admin' };
const EMBAIXADOR: QuemSouEu = { id: 'emb-1', papel: 'embaixador' };

const TODOS_ATIVOS = new Set(['gestor-1', 'sdr-1', 'admin-1', 'emb-1']);

function conversa(parcial: Partial<ConversaComResposta> = {}): ConversaComResposta {
  return {
    conversaId: 'fio-1',
    organizacaoId: 'org-1',
    responsavelId: 'admin-1',
    chegouEm: '2026-10-01T14:00:00+00:00',
    nomeDoPerfil: null,
    telefone: '+5584999998801',
    alguemEscreveu: false,
    ...parcial,
  };
}

describe('quem recebe avisos', () => {
  it('é quem pode responder: admin, gestor, sdr e embaixador', () => {
    expect(recebeAvisos('admin')).toBe(true);
    expect(recebeAvisos('gestor')).toBe(true);
    expect(recebeAvisos('sdr')).toBe(true);
    expect(recebeAvisos('embaixador')).toBe(true);
  });

  it('leitura, financeiro e o robô nunca: não respondem, então nada espera por eles', () => {
    expect(recebeAvisos('leitura')).toBe(false);
    expect(recebeAvisos('financeiro')).toBe(false);
    expect(recebeAvisos('bot')).toBe(false);
  });
});

describe('de quem é o aviso', () => {
  it('conversa em que alguém já escreveu é só de quem atende', () => {
    const c = conversa({ responsavelId: 'sdr-1', alguemEscreveu: true });
    expect(ehParaMim(c, SDR, TODOS_ATIVOS)).toBe(true);
    expect(ehParaMim(c, GESTOR, TODOS_ATIVOS)).toBe(false);
    expect(ehParaMim(c, ADMIN, TODOS_ATIVOS)).toBe(false);
  });

  it('conversa em que ninguém escreveu é de todos que atendem a fila', () => {
    const c = conversa({ responsavelId: 'admin-1', alguemEscreveu: false });
    expect(ehParaMim(c, ADMIN, TODOS_ATIVOS)).toBe(true);
    expect(ehParaMim(c, GESTOR, TODOS_ATIVOS)).toBe(true);
    expect(ehParaMim(c, SDR, TODOS_ATIVOS)).toBe(true);
  });

  it('o embaixador só é avisado do que está endereçado a ele', () => {
    const deOutro = conversa({ responsavelId: 'admin-1', alguemEscreveu: false });
    const dele = conversa({ responsavelId: 'emb-1', alguemEscreveu: false });
    expect(ehParaMim(deOutro, EMBAIXADOR, TODOS_ATIVOS)).toBe(false);
    expect(ehParaMim(dele, EMBAIXADOR, TODOS_ATIVOS)).toBe(true);
  });

  it('responsável desativado conta como ninguém atendendo', () => {
    const c = conversa({ responsavelId: 'saiu-da-empresa', alguemEscreveu: true });
    expect(ehParaMim(c, GESTOR, TODOS_ATIVOS)).toBe(true);
    expect(ehParaMim(c, SDR, TODOS_ATIVOS)).toBe(true);
    expect(ehParaMim(c, EMBAIXADOR, TODOS_ATIVOS)).toBe(false);
  });

  it('sem a lista de ativos, o responsável vale como ativo', () => {
    // Falha de rede não pode virar aviso de tudo para todo mundo.
    const c = conversa({ responsavelId: 'sdr-1', alguemEscreveu: true });
    expect(ehParaMim(c, GESTOR, null)).toBe(false);
    expect(ehParaMim(c, SDR, null)).toBe(true);
  });

  it('quem não responde não é avisado nem do que aponta para ele', () => {
    const c = conversa({ responsavelId: 'leitor-1' });
    expect(ehParaMim(c, { id: 'leitor-1', papel: 'leitura' }, TODOS_ATIVOS)).toBe(false);
  });

  it('cliente (quem não é ficha) avisa todos os operadores, mesmo com alguém já respondendo', () => {
    const cliente = conversa({ organizacaoId: null, responsavelId: 'sdr-1', alguemEscreveu: true });
    expect(ehParaMim(cliente, SDR, TODOS_ATIVOS)).toBe(true);
    expect(ehParaMim(cliente, GESTOR, TODOS_ATIVOS)).toBe(true);
    expect(ehParaMim(cliente, ADMIN, TODOS_ATIVOS)).toBe(true);
    // Sem a lista de ativos a resposta é a mesma: a regra do cliente não depende dela.
    expect(ehParaMim(cliente, GESTOR, null)).toBe(true);
  });

  it('o parceiro continua sendo só de quem atende: a regra do cliente não vaza para ele', () => {
    const parceiro = conversa({
      organizacaoId: 'org-1',
      responsavelId: 'sdr-1',
      alguemEscreveu: true,
    });
    expect(ehParaMim(parceiro, SDR, TODOS_ATIVOS)).toBe(true);
    expect(ehParaMim(parceiro, GESTOR, TODOS_ATIVOS)).toBe(false);
    expect(ehParaMim(parceiro, ADMIN, TODOS_ATIVOS)).toBe(false);
  });

  it('cliente não avisa embaixador de outro, nem leitura, nem financeiro', () => {
    const cliente = conversa({ organizacaoId: null, responsavelId: 'sdr-1', alguemEscreveu: true });
    expect(ehParaMim(cliente, EMBAIXADOR, TODOS_ATIVOS)).toBe(false);
    expect(ehParaMim(cliente, { id: 'leitor-1', papel: 'leitura' }, TODOS_ATIVOS)).toBe(false);
    expect(ehParaMim(cliente, { id: 'fin-1', papel: 'financeiro' }, TODOS_ATIVOS)).toBe(false);
  });

  it('filtra a lista inteira pela mesma regra', () => {
    const lista = [
      conversa({ conversaId: 'a', responsavelId: 'sdr-1', alguemEscreveu: true }),
      conversa({ conversaId: 'b', responsavelId: 'gestor-1', alguemEscreveu: true }),
      conversa({ conversaId: 'c', responsavelId: 'admin-1', alguemEscreveu: false }),
    ];
    expect(respostasParaMim(lista, SDR, TODOS_ATIVOS).map((c) => c.conversaId)).toEqual(['a', 'c']);
    expect(respostasParaMim(lista, GESTOR, TODOS_ATIVOS).map((c) => c.conversaId)).toEqual([
      'b',
      'c',
    ]);
  });
});

describe('os carimbos do banco', () => {
  it('compara no tempo, não no texto', () => {
    expect(maisRecente('2026-10-01T14:00:01+00:00', '2026-10-01T14:00:00+00:00')).toBeGreaterThan(
      0,
    );
    expect(maisRecente('2026-10-01T14:00:00+00:00', '2026-10-01T14:00:01+00:00')).toBeLessThan(0);
    expect(maisRecente('2026-10-01T14:00:00+00:00', '2026-10-01T14:00:00+00:00')).toBe(0);
  });

  it('o Postgres corta os zeros do fim, e a comparação não se perde nisso', () => {
    expect(maisRecente('2026-10-01T14:00:00.5+00:00', '2026-10-01T14:00:00+00:00')).toBeGreaterThan(
      0,
    );
    expect(
      maisRecente('2026-10-01T14:00:00.5+00:00', '2026-10-01T14:00:00.123456+00:00'),
    ).toBeGreaterThan(0);
  });

  it('desempata nos microssegundos, que o Date joga fora', () => {
    expect(
      maisRecente('2026-10-01T14:00:00.123999+00:00', '2026-10-01T14:00:00.123456+00:00'),
    ).toBeGreaterThan(0);
  });

  it('a última chegada é o marco de "visto"', () => {
    expect(ultimaChegada([])).toBeNull();
    expect(
      ultimaChegada([
        conversa({ chegouEm: '2026-10-01T14:00:00+00:00' }),
        conversa({ chegouEm: '2026-10-01T14:05:00+00:00' }),
        conversa({ chegouEm: '2026-10-01T13:00:00+00:00' }),
      ]),
    ).toBe('2026-10-01T14:05:00+00:00');
  });
});

describe('o que ainda não abri', () => {
  const as14 = conversa({ conversaId: 'a', chegouEm: '2026-10-02T14:00:00+00:00' });
  const as15 = conversa({ conversaId: 'b', chegouEm: '2026-10-02T15:00:00+00:00' });
  const as16 = conversa({ conversaId: 'c', chegouEm: '2026-10-02T16:00:00+00:00' });

  it('sem nenhuma aberta, todas contam: entrar na tela não zera o número', () => {
    expect(aindaNaoAbertas([as14, as15, as16], new Map())).toEqual([as14, as15, as16]);
  });

  it('abrir uma tira só ela: de três para duas', () => {
    const abertas = new Map([['b', '2026-10-02T15:00:00+00:00']]);
    expect(aindaNaoAbertas([as14, as15, as16], abertas)).toEqual([as14, as16]);
  });

  it('mensagem nova numa conversa já aberta volta a contar', () => {
    const abertas = new Map([['b', '2026-10-02T14:30:00+00:00']]);
    expect(aindaNaoAbertas([as15], abertas)).toEqual([as15]);
  });

  it('carimbo igual com casas decimais diferentes ainda é a mesma chegada', () => {
    const abertas = new Map([['b', '2026-10-02T15:00:00.000000+00:00']]);
    expect(aindaNaoAbertas([as15], abertas)).toEqual([]);
  });
});

describe('até onde o piso anda', () => {
  const as14 = conversa({ conversaId: 'a', chegouEm: '2026-10-02T14:00:00+00:00' });
  const as15 = conversa({ conversaId: 'b', chegouEm: '2026-10-02T15:00:00+00:00' });
  const as16 = conversa({ conversaId: 'c', chegouEm: '2026-10-02T16:00:00+00:00' });

  it('nada por abrir: vai até a última chegada', () => {
    expect(pisoPossivel([as14, as15, as16], [])).toBe(as16.chegouEm);
  });

  it('nada lido e nada por abrir: não há para onde andar', () => {
    expect(pisoPossivel([], [])).toBeNull();
  });

  it('para antes da mais antiga por abrir, nunca em cima dela', () => {
    expect(pisoPossivel([as14, as15, as16], [as15, as16])).toBe(as14.chegouEm);
  });

  it('a mais antiga de todas ainda por abrir: o piso fica onde está', () => {
    expect(pisoPossivel([as14, as15, as16], [as14])).toBeNull();
  });

  it('o registro perde o que o piso já cobre e guarda o que está depois dele', () => {
    const abertas = new Map([
      ['a', '2026-10-02T14:00:00+00:00'],
      ['c', '2026-10-02T16:00:00+00:00'],
    ]);
    expect(semOQueOPisoCobre(abertas, '2026-10-02T15:00:00+00:00')).toEqual(
      new Map([['c', '2026-10-02T16:00:00+00:00']]),
    );
  });

  it('andar o piso não muda o que conta: a aberta some da leitura, a por abrir fica', () => {
    const abertas = new Map([['a', as14.chegouEm]]);
    const antes = aindaNaoAbertas([as14, as15, as16], abertas);
    const piso = pisoPossivel([as14, as15, as16], antes);
    expect(piso).toBe(as14.chegouEm);
    // A próxima leitura só traz o que chegou depois do piso.
    const lidas = [as15, as16];
    const depois = aindaNaoAbertas(lidas, semOQueOPisoCobre(abertas, piso as string));
    expect(depois).toEqual(antes);
  });
});

describe('o que chegou agora', () => {
  it('a primeira leitura só estabelece a linha de base', () => {
    expect(chegaramAgora(null, [conversa()])).toEqual([]);
  });

  it('conversa que não estava na lista é nova', () => {
    const minha = conversa({ conversaId: 'nova' });
    expect(chegaramAgora(new Map(), [minha])).toEqual([minha]);
  });

  it('a mesma conversa com chegada mais recente avisa de novo', () => {
    const antes = new Map([['fio-1', '2026-10-01T14:00:00+00:00']]);
    const depois = conversa({ chegouEm: '2026-10-01T14:03:00+00:00' });
    expect(chegaramAgora(antes, [depois])).toEqual([depois]);
  });

  it('a mesma conversa sem mensagem nova não avisa', () => {
    const antes = new Map([['fio-1', '2026-10-01T14:00:00+00:00']]);
    expect(chegaramAgora(antes, [conversa()])).toEqual([]);
  });
});

describe('o nome no aviso', () => {
  it('o nome da ficha vence o apelido do WhatsApp', () => {
    expect(nomeDoAviso(conversa({ nomeDoPerfil: 'aurora 24h' }), 'Buffet Aurora')).toBe(
      'Buffet Aurora',
    );
  });

  it('ficha que só tem o rótulo com o número usa o nome do perfil', () => {
    expect(
      nomeDoAviso(conversa({ nomeDoPerfil: 'Dona Ivone' }), 'Contato do WhatsApp (84) 99999-8801'),
    ).toBe('Dona Ivone');
  });

  it('sem nome nenhum, vai o fim do número — nunca o número inteiro', () => {
    const semFicha = nomeDoAviso(conversa({ organizacaoId: null }), null);
    expect(semFicha).toBe('Número terminado em 8801');

    const fichaSemNome = nomeDoAviso(conversa(), 'Contato do WhatsApp (84) 99999-8801');
    expect(fichaSemNome).toBe('Número terminado em 8801');
    expect(fichaSemNome).not.toContain('99999');
  });

  it('quem não é ficha aparece com o nome do WhatsApp', () => {
    expect(nomeDoAviso(conversa({ organizacaoId: null, nomeDoPerfil: ' Carla ' }), null)).toBe(
      'Carla',
    );
  });
});

describe('o texto da notificação do sistema', () => {
  it('uma mensagem diz de quem é, e não leva o conteúdo', () => {
    const texto = textoDoAviso(['Buffet Aurora']);
    expect(texto.titulo).toBe('Nova mensagem de Buffet Aurora');
    expect(texto.corpo).toBe('Abra o Tríade para ler e responder.');
  });

  it('várias viram um aviso só, com os nomes', () => {
    const texto = textoDoAviso(['Buffet Aurora', 'Dona Ivone', 'Carla']);
    expect(texto.titulo).toBe('3 conversas com mensagem nova');
    expect(texto.corpo).toBe('Buffet Aurora, Dona Ivone e Carla.');
  });

  it('mais de três nomes não cabem: o resto vira contagem', () => {
    const texto = textoDoAviso(['A', 'B', 'C', 'D', 'E']);
    expect(texto.titulo).toBe('5 conversas com mensagem nova');
    expect(texto.corpo).toBe('A, B, C e mais 2.');
  });
});

describe('a prévia no cartão de dentro do CRM', () => {
  it('é o começo do texto, numa linha só', () => {
    expect(previaDaMensagem('text', '  Oi!\n\nAinda tem   ingresso?  ')).toBe(
      'Oi! Ainda tem ingresso?',
    );
  });

  it('texto longo é cortado com reticências', () => {
    const previa = previaDaMensagem('text', 'a'.repeat(300));
    expect(previa).toHaveLength(140);
    expect(previa?.endsWith('…')).toBe(true);
  });

  it('sem texto, diz o que chegou', () => {
    expect(previaDaMensagem('audio', null)).toBe('Mensagem de áudio');
    expect(previaDaMensagem('image', '')).toBe('Imagem');
    expect(previaDaMensagem('document', null)).toBe('Documento');
  });

  it('imagem com legenda mostra a legenda', () => {
    expect(previaDaMensagem('image', 'Olha o salão')).toBe('Olha o salão');
  });

  it('quando não se sabe, não inventa', () => {
    expect(previaDaMensagem(null, null)).toBeNull();
    expect(previaDaMensagem('interactive', null)).toBeNull();
  });
});

describe('para onde o aviso leva', () => {
  it('uma mensagem de ficha abre a conversa dela', () => {
    expect(destinoDoAviso([conversa({ organizacaoId: 'org-7' })])).toBe('/conversas?org=org-7');
  });

  it('quem não é ficha abre pela conversa, porque não tem ficha', () => {
    expect(destinoDoAviso([conversa({ conversaId: 'fio-9', organizacaoId: null })])).toBe(
      '/conversas?cliente=fio-9',
    );
  });

  it('várias de clientes abrem a aba Clientes', () => {
    expect(
      destinoDoAviso([
        conversa({ conversaId: 'a', organizacaoId: null }),
        conversa({ conversaId: 'b', organizacaoId: null }),
      ]),
    ).toBe('/conversas?aba=fora');
  });

  it('várias misturadas abrem a aba Responderam', () => {
    expect(
      destinoDoAviso([
        conversa({ conversaId: 'a', organizacaoId: 'org-1' }),
        conversa({ conversaId: 'b', organizacaoId: null }),
      ]),
    ).toBe('/conversas?aba=responderam');
  });
});

describe('a marca e o rótulo', () => {
  it('duas abas calculam a mesma marca para o mesmo aviso', () => {
    const novas = [conversa()];
    expect(marcaDoAviso(novas)).toBe(marcaDoAviso([conversa()]));
    expect(marcaDoAviso(novas)).not.toBe(
      marcaDoAviso([conversa({ chegouEm: '2026-10-01T14:09:00+00:00' })]),
    );
  });

  it('o número fala no singular e no plural', () => {
    expect(rotuloDasRespostas(1)).toBe('1 resposta nova');
    expect(rotuloDasRespostas(4)).toBe('4 respostas novas');
  });
});
