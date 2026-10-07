import { describe, expect, it } from 'vitest';

import {
  chegaramAgora,
  contextoDoAviso,
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
  seloDoAviso,
  semResposta,
  textoDoAviso,
  tipoDoAviso,
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
/** Outra pessoa da gestão: é ela que "atende" nos casos em que o GESTOR não atende. */
const COLEGA: QuemSouEu = { id: 'gestor-2', papel: 'gestor' };
/** Quem só liga (pivô de 06/10/2026): não vê Conversas, então não é avisado de WhatsApp. */
const SDR: QuemSouEu = { id: 'sdr-1', papel: 'sdr' };
const ADMIN: QuemSouEu = { id: 'admin-1', papel: 'admin' };
const EMBAIXADOR: QuemSouEu = { id: 'emb-1', papel: 'embaixador' };

const TODOS_ATIVOS = new Set(['gestor-1', 'gestor-2', 'sdr-1', 'admin-1', 'emb-1']);

function conversa(parcial: Partial<ConversaComResposta> = {}): ConversaComResposta {
  return {
    conversaId: 'fio-1',
    organizacaoId: 'org-1',
    responsavelId: 'admin-1',
    chegouEm: '2026-10-01T14:00:00+00:00',
    nomeDoPerfil: null,
    telefone: '+5584999998801',
    alguemEscreveu: false,
    respondidaEm: null,
    ...parcial,
  };
}

describe('quem recebe avisos', () => {
  it('é quem atende o WhatsApp: admin e gestor', () => {
    expect(recebeAvisos('admin')).toBe(true);
    expect(recebeAvisos('gestor')).toBe(true);
  });

  it('quem só liga, os papéis desativados e o robô nunca: nada no WhatsApp espera por eles', () => {
    expect(recebeAvisos('sdr')).toBe(false);
    expect(recebeAvisos('embaixador')).toBe(false);
    expect(recebeAvisos('leitura')).toBe(false);
    expect(recebeAvisos('financeiro')).toBe(false);
    expect(recebeAvisos('bot')).toBe(false);
  });
});

describe('de quem é o aviso', () => {
  it('conversa em que alguém já escreveu é só de quem atende', () => {
    const c = conversa({ responsavelId: 'gestor-2', alguemEscreveu: true });
    expect(ehParaMim(c, COLEGA, TODOS_ATIVOS)).toBe(true);
    expect(ehParaMim(c, GESTOR, TODOS_ATIVOS)).toBe(false);
    expect(ehParaMim(c, ADMIN, TODOS_ATIVOS)).toBe(false);
  });

  it('conversa em que ninguém escreveu é de todos que atendem a fila', () => {
    const c = conversa({ responsavelId: 'admin-1', alguemEscreveu: false });
    expect(ehParaMim(c, ADMIN, TODOS_ATIVOS)).toBe(true);
    expect(ehParaMim(c, GESTOR, TODOS_ATIVOS)).toBe(true);
    expect(ehParaMim(c, COLEGA, TODOS_ATIVOS)).toBe(true);
  });

  it('quem só liga não é avisado de WhatsApp, nem do que aponta para ele', () => {
    const deOutro = conversa({ responsavelId: 'admin-1', alguemEscreveu: false });
    const dele = conversa({ responsavelId: 'sdr-1', alguemEscreveu: true });
    const cliente = conversa({ organizacaoId: null, responsavelId: 'admin-1' });
    expect(ehParaMim(deOutro, SDR, TODOS_ATIVOS)).toBe(false);
    expect(ehParaMim(dele, SDR, TODOS_ATIVOS)).toBe(false);
    expect(ehParaMim(cliente, SDR, TODOS_ATIVOS)).toBe(false);
  });

  it('responsável desativado conta como ninguém atendendo', () => {
    const c = conversa({ responsavelId: 'saiu-da-empresa', alguemEscreveu: true });
    expect(ehParaMim(c, GESTOR, TODOS_ATIVOS)).toBe(true);
    expect(ehParaMim(c, COLEGA, TODOS_ATIVOS)).toBe(true);
    expect(ehParaMim(c, EMBAIXADOR, TODOS_ATIVOS)).toBe(false);
  });

  it('conversa que ficou no nome de quem só liga avisa a gestão inteira', () => {
    // Em 06/10/2026 havia conversas em produção atendidas por um SDR. Ele deixou
    // de ser avisado; sem esta regra, a resposta do parceiro não avisaria ninguém.
    // `lerPessoasAtivas` só devolve quem atende, então o SDR fica fora de `ativos`.
    const quemAtende = new Set(['gestor-1', 'gestor-2', 'admin-1']);
    const c = conversa({ responsavelId: 'sdr-1', alguemEscreveu: true });
    expect(ehParaMim(c, GESTOR, quemAtende)).toBe(true);
    expect(ehParaMim(c, ADMIN, quemAtende)).toBe(true);
    expect(ehParaMim(c, SDR, quemAtende)).toBe(false);
  });

  it('sem a lista de ativos, o responsável vale como ativo', () => {
    // Falha de rede não pode virar aviso de tudo para todo mundo.
    const c = conversa({ responsavelId: 'gestor-2', alguemEscreveu: true });
    expect(ehParaMim(c, GESTOR, null)).toBe(false);
    expect(ehParaMim(c, COLEGA, null)).toBe(true);
  });

  it('quem não responde não é avisado nem do que aponta para ele', () => {
    const c = conversa({ responsavelId: 'leitor-1' });
    expect(ehParaMim(c, { id: 'leitor-1', papel: 'leitura' }, TODOS_ATIVOS)).toBe(false);
  });

  it('cliente (quem não é ficha) avisa todos os operadores, mesmo com alguém já respondendo', () => {
    const cliente = conversa({
      organizacaoId: null,
      responsavelId: 'gestor-2',
      alguemEscreveu: true,
    });
    expect(ehParaMim(cliente, COLEGA, TODOS_ATIVOS)).toBe(true);
    expect(ehParaMim(cliente, GESTOR, TODOS_ATIVOS)).toBe(true);
    expect(ehParaMim(cliente, ADMIN, TODOS_ATIVOS)).toBe(true);
    // Sem a lista de ativos a resposta é a mesma: a regra do cliente não depende dela.
    expect(ehParaMim(cliente, GESTOR, null)).toBe(true);
  });

  it('o parceiro continua sendo só de quem atende: a regra do cliente não vaza para ele', () => {
    const parceiro = conversa({
      organizacaoId: 'org-1',
      responsavelId: 'gestor-2',
      alguemEscreveu: true,
    });
    expect(ehParaMim(parceiro, COLEGA, TODOS_ATIVOS)).toBe(true);
    expect(ehParaMim(parceiro, GESTOR, TODOS_ATIVOS)).toBe(false);
    expect(ehParaMim(parceiro, ADMIN, TODOS_ATIVOS)).toBe(false);
  });

  it('cliente não avisa embaixador de outro, nem leitura, nem financeiro', () => {
    const cliente = conversa({
      organizacaoId: null,
      responsavelId: 'gestor-2',
      alguemEscreveu: true,
    });
    expect(ehParaMim(cliente, EMBAIXADOR, TODOS_ATIVOS)).toBe(false);
    expect(ehParaMim(cliente, { id: 'leitor-1', papel: 'leitura' }, TODOS_ATIVOS)).toBe(false);
    expect(ehParaMim(cliente, { id: 'fin-1', papel: 'financeiro' }, TODOS_ATIVOS)).toBe(false);
  });

  it('filtra a lista inteira pela mesma regra', () => {
    const lista = [
      conversa({ conversaId: 'a', responsavelId: 'gestor-2', alguemEscreveu: true }),
      conversa({ conversaId: 'b', responsavelId: 'gestor-1', alguemEscreveu: true }),
      conversa({ conversaId: 'c', responsavelId: 'admin-1', alguemEscreveu: false }),
    ];
    expect(respostasParaMim(lista, COLEGA, TODOS_ATIVOS).map((c) => c.conversaId)).toEqual([
      'a',
      'c',
    ]);
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

describe('o que ainda espera resposta', () => {
  const as14 = conversa({ conversaId: 'a', chegouEm: '2026-10-02T14:00:00+00:00' });
  const as15 = conversa({ conversaId: 'b', chegouEm: '2026-10-02T15:00:00+00:00' });
  const as16 = conversa({ conversaId: 'c', chegouEm: '2026-10-02T16:00:00+00:00' });

  it('sem resposta nenhuma, todas contam: abrir para ler não tira ninguém', () => {
    expect(semResposta([as14, as15, as16])).toEqual([as14, as15, as16]);
  });

  it('responder tira só a respondida: de três para duas', () => {
    const respondida = { ...as15, alguemEscreveu: true, respondidaEm: '2026-10-02T15:02:00+00:00' };
    expect(semResposta([as14, respondida, as16])).toEqual([as14, as16]);
  });

  it('mensagem nova depois da resposta volta a contar', () => {
    const deNovo = { ...as15, alguemEscreveu: true, respondidaEm: '2026-10-02T14:30:00+00:00' };
    expect(semResposta([deNovo])).toEqual([deNovo]);
  });

  it('carimbo igual com casas decimais diferentes conta como respondida', () => {
    const empate = {
      ...as15,
      alguemEscreveu: true,
      respondidaEm: '2026-10-02T15:00:00.000000+00:00',
    };
    expect(semResposta([empate])).toEqual([]);
  });
});

describe('até onde o piso anda', () => {
  const as14 = conversa({ conversaId: 'a', chegouEm: '2026-10-02T14:00:00+00:00' });
  const as15 = conversa({ conversaId: 'b', chegouEm: '2026-10-02T15:00:00+00:00' });
  const as16 = conversa({ conversaId: 'c', chegouEm: '2026-10-02T16:00:00+00:00' });

  it('nada à espera: vai até a última chegada', () => {
    expect(pisoPossivel([as14, as15, as16], [])).toBe(as16.chegouEm);
  });

  it('nada lido e nada à espera: não há para onde andar', () => {
    expect(pisoPossivel([], [])).toBeNull();
  });

  it('para antes da mais antiga à espera, nunca em cima dela', () => {
    expect(pisoPossivel([as14, as15, as16], [as15, as16])).toBe(as14.chegouEm);
  });

  it('a mais antiga de todas ainda à espera: o piso fica onde está', () => {
    expect(pisoPossivel([as14, as15, as16], [as14])).toBeNull();
  });

  it('leitura que bateu no teto não move o piso: abaixo dela pode haver quem espera', () => {
    expect(pisoPossivel([as14, as15, as16], [], true)).toBeNull();
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

describe('parceiro ou cliente no cartão', () => {
  const parceiro = conversa({ organizacaoId: 'org-1' });
  const cliente = conversa({
    organizacaoId: null,
    nomeDoPerfil: 'Carla Cliente',
    telefone: '+5584900000002',
  });

  it('quem tem ficha é parceiro; quem não tem é cliente', () => {
    expect(tipoDoAviso(parceiro)).toBe('parceiro');
    expect(tipoDoAviso(cliente)).toBe('cliente');
  });

  it('o selo diz quem escreveu, e continua dizendo que é mensagem', () => {
    expect(seloDoAviso('parceiro')).toBe('Mensagem de parceiro');
    expect(seloDoAviso('cliente')).toBe('Mensagem de cliente');
  });

  it('o parceiro leva a categoria e a etapa do funil', () => {
    const ficha = {
      nome: 'Jôsy Buffet',
      categoria: 'Buffet adulto/corporativo',
      etapa: 'Cadastro em andamento',
    };
    expect(contextoDoAviso(parceiro, ficha)).toEqual({
      texto: 'Buffet adulto/corporativo',
      destaque: 'Cadastro em andamento',
    });
  });

  it('parceiro sem negócio, ou com a leitura falhando, não inventa etapa', () => {
    expect(contextoDoAviso(parceiro, { nome: 'X', categoria: 'DJs', etapa: null })).toEqual({
      texto: 'DJs',
      destaque: null,
    });
    expect(contextoDoAviso(parceiro, null)).toEqual({ texto: null, destaque: null });
  });

  it('o cliente diz que é cliente do app e mostra só o fim do número', () => {
    const contexto = contextoDoAviso(cliente, null);
    expect(contexto).toEqual({ texto: 'Cliente do app', destaque: 'final 0002' });
    // RF-BAS-14: o telefone inteiro nunca aparece no aviso.
    expect(JSON.stringify(contexto)).not.toContain('84900000002');
  });

  it('cliente sem nome no perfil não repete o número: o nome do cartão já é ele', () => {
    const semNome = conversa({
      organizacaoId: null,
      nomeDoPerfil: null,
      telefone: '+5584900000002',
    });
    expect(contextoDoAviso(semNome, null)).toEqual({ texto: 'Cliente do app', destaque: null });
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

  it('várias misturadas abrem a lista de Conversas', () => {
    expect(
      destinoDoAviso([
        conversa({ conversaId: 'a', organizacaoId: 'org-1' }),
        conversa({ conversaId: 'b', organizacaoId: null }),
      ]),
    ).toBe('/conversas');
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
