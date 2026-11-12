import type { BaseDoAtendenteV2 } from './v2';
import type {
  AcaoDoAtendenteV3,
  ConviteDaAgenda,
  EntradaDoAtendenteV3,
  SaidaDoAtendenteV3,
  TipoDaAgenda,
} from './v3';

/**
 * Os cenários do ensaio de `atendente-imova@v3` (11/11/2026): a visita pelo link.
 *
 * Cada cenário é uma conversa, o que a resposta tem de fazer (`espera`) e uma resposta
 * que passa (`respostaBoa`). Servem a dois lados:
 *
 * - **sem rede**, no `pnpm -C packages/prompts test` (`evals/atendente-imova-v3.eval.test.ts`):
 *   toda conversa passa pelo schema e pela auditoria de dado pessoal, a resposta boa passa
 *   pelo conferidor e as respostas erradas de propósito não passam. É o que prova que a
 *   régua mede;
 * - **com o modelo de verdade**, no ensaio do worker (`workers ai --ensaio=atendente-imova`,
 *   `apps/workers/src/ia/ensaio-do-atendente.ts`), que manda cada conversa ao modelo e
 *   passa a resposta pelo mesmo `conferirCenario`.
 *
 * As conversas e a base são de mentira: nenhum cliente, nenhum telefone.
 */

export interface EsperaDoCenario {
  /** As ações que servem. */
  readonly acoes: readonly AcaoDoAtendenteV3[];
  /** No link da agenda: o tipo e, na visita, o código do imóvel. */
  readonly agenda?: { readonly tipo: TipoDaAgenda; readonly imovelCodigo: string | null };
  /** O que a mensagem tem de ter. */
  readonly exigido?: readonly RegExp[];
  /** O que a mensagem não pode ter, além do que nenhuma pode ter (o link). */
  readonly proibido?: readonly RegExp[];
}

export interface CenarioDoAtendente {
  readonly nome: string;
  readonly entrada: EntradaDoAtendenteV3;
  readonly espera: EsperaDoCenario;
  /** Uma resposta que passa: a prova, sem modelo, de que o conferidor não recusa o certo. */
  readonly respostaBoa: SaidaDoAtendenteV3;
}

/** A base do ensaio: dois imóveis no ar, um em rascunho, e o caderno com duas regras. */
export const BASE_DO_ENSAIO: BaseDoAtendenteV2 = {
  caderno: [
    {
      id: 1,
      texto: 'O escritório da Imova atende de segunda a sexta, das 8h às 18h.',
      origem: 'tela',
    },
    { id: 2, texto: 'No aluguel, a Imova aceita fiador ou seguro-fiança.', origem: 'treino' },
  ],
  imoveis: [
    {
      codigo: 'IM0003',
      situacao: 'no_ar',
      tipo: 'apartamento',
      negocio: 'aluguel',
      preco_aluguel: 2500,
      periodo_aluguel: 'mensal',
      condominio: 600,
      quartos: 3,
      suites: 1,
      banheiros: 2,
      vagas: 1,
      area_util: 90,
      rua: 'Rua das Dunas',
      bairro: 'Ponta Negra',
      cidade: 'Natal',
      estado: 'RN',
      titulo: 'Apartamento de 3 quartos em Ponta Negra',
    },
    {
      codigo: 'TE0004',
      situacao: 'no_ar',
      tipo: 'terreno',
      negocio: 'venda',
      preco_venda: 510000,
      area_total: 450,
      rua: 'Av. Barra de Tabatinga',
      bairro: 'Tabatinga',
      cidade: 'Nísia Floresta',
      estado: 'RN',
      titulo: 'Terreno em Tabatinga',
    },
    {
      codigo: 'IM0007',
      situacao: 'rascunho',
      tipo: 'casa',
      negocio: 'venda',
      preco_venda: 680000,
      quartos: 3,
      suites: 2,
      bairro: 'Capim Macio',
      cidade: 'Natal',
      estado: 'RN',
      titulo: 'Casa em Capim Macio',
    },
  ],
};

type Mensagens = EntradaDoAtendenteV3['mensagens'];

function conversa(
  agora: string,
  agoraPorExtenso: string,
  mensagens: Mensagens,
  convitesDaAgenda: readonly ConviteDaAgenda[] = [],
): EntradaDoAtendenteV3 {
  return {
    leadId: 'lead-ensaio',
    agora,
    agoraPorExtenso,
    treino: false,
    cliente: {
      nome: '[[NOME_1]]',
      temFicha: true,
      etapa: 'Respondeu',
      perfil: [],
      visitas: [],
      canalDeChegada: 'anuncios',
    },
    convitesDaAgenda: [...convitesDaAgenda],
    respostasNaUltimaHora: mensagens.filter((m) => m.de === 'ia').length,
    mensagens,
  };
}

/** Como a mensagem do link volta na conversa: o texto da IA, a linha do imóvel e o link. */
function oLinkQueSaiu(quando: string, codigo: string, endereco: string): Mensagens[number] {
  return {
    messageId: 'm2',
    de: 'ia',
    quem: null,
    quando,
    texto: `Claro! Vou te mandar o link da agenda para você escolher o melhor dia e horário da visita.\n\nImóvel: ${codigo} · ${endereco}\nEscolha o horário: [link da agenda]`,
  };
}

function resposta(
  acao: AcaoDoAtendenteV3,
  mensagem: string,
  motivo: string,
  agenda: SaidaDoAtendenteV3['agenda'] = null,
): SaidaDoAtendenteV3 {
  return { acao, mensagem, agenda, motivo, anotacoes: [], fotosEnsinadas: [], confianca: 0.85 };
}

const PONTA_NEGRA = 'Rua das Dunas, Ponta Negra, Natal';

export const CENARIOS_DO_ATENDENTE_V3: readonly CenarioDoAtendente[] = [
  {
    nome: 'visita com código: manda o link da visita àquele imóvel',
    entrada: conversa('2026-11-11T14:01', 'quarta-feira, 11 de novembro, às 14h01', [
      {
        messageId: 'm1',
        de: 'cliente',
        quem: null,
        quando: '11/11 14:00',
        texto: 'Boa tarde! Quero visitar o apartamento IM0003. Como faço?',
      },
    ]),
    espera: {
      acoes: ['enviar_link_da_agenda'],
      agenda: { tipo: 'visita', imovelCodigo: 'IM0003' },
    },
    respostaBoa: resposta(
      'enviar_link_da_agenda',
      'Boa tarde, [[NOME_1]]! Vou te mandar o link da agenda: lá você escolhe o melhor dia e horário para a visita.',
      'Quer visitar o IM0003; mandei o link.',
      { tipo: 'visita', imovelCodigo: 'IM0003' },
    ),
  },
  {
    nome: 'visita sem imóvel: pergunta qual antes de mandar o link',
    entrada: conversa('2026-11-11T09:41', 'quarta-feira, 11 de novembro, às 09h41', [
      {
        messageId: 'm1',
        de: 'cliente',
        quem: null,
        quando: '11/11 09:40',
        texto: 'Oi, bom dia! Gostaria de agendar uma visita.',
      },
    ]),
    espera: { acoes: ['responder'], exigido: [/\?/] },
    respostaBoa: resposta(
      'responder',
      'Bom dia, [[NOME_1]]! Claro. Qual imóvel você quer visitar? Pode me dizer o bairro ou onde viu o anúncio.',
      'Quer visitar, mas não disse qual imóvel.',
    ),
  },
  {
    nome: 'imóvel fora da lista: não manda link; pergunta onde viu ou passa',
    entrada: conversa('2026-11-11T16:21', 'quarta-feira, 11 de novembro, às 16h21', [
      {
        messageId: 'm1',
        de: 'cliente',
        quem: null,
        quando: '11/11 16:20',
        texto: 'Quero visitar a casa amarela da Rua dos Pinheiros, em Lagoa Nova. Quando posso ir?',
      },
    ]),
    espera: { acoes: ['responder', 'passar_para_corretor'] },
    respostaBoa: resposta(
      'responder',
      'Boa tarde, [[NOME_1]]! Não estou achando essa casa por aqui. Onde você viu o anúncio? Assim confirmo qual é e te mando o link da visita.',
      'O imóvel da Rua dos Pinheiros não está na lista; perguntei onde ele viu.',
    ),
  },
  {
    nome: 'link já mandado e não agendado: não manda de novo, responde a pergunta',
    entrada: conversa(
      '2026-11-11T14:40',
      'quarta-feira, 11 de novembro, às 14h40',
      [
        {
          messageId: 'm1',
          de: 'cliente',
          quem: null,
          quando: '11/11 14:04',
          texto: 'Quero visitar o apartamento IM0003',
        },
        oLinkQueSaiu('11/11 14:05', 'IM0003', PONTA_NEGRA),
        {
          messageId: 'm3',
          de: 'cliente',
          quem: null,
          quando: '11/11 14:38',
          texto: 'E o condomínio, quanto é?',
        },
      ],
      [{ tipo: 'visita', imovelCodigo: 'IM0003', enviadoEm: '2026-11-11T14:05', agendado: false }],
    ),
    espera: { acoes: ['responder'], exigido: [/600/] },
    respostaBoa: resposta(
      'responder',
      'O condomínio é de R$ 600 por mês, além dos R$ 2.500 do aluguel.',
      'Perguntou o condomínio; o link já tinha saído.',
    ),
  },
  {
    nome: 'pediu o link de novo: manda de novo',
    entrada: conversa(
      '2026-11-11T11:20',
      'quarta-feira, 11 de novembro, às 11h20',
      [
        {
          messageId: 'm1',
          de: 'cliente',
          quem: null,
          quando: '11/11 09:04',
          texto: 'Quero visitar o apartamento IM0003',
        },
        oLinkQueSaiu('11/11 09:05', 'IM0003', PONTA_NEGRA),
        {
          messageId: 'm3',
          de: 'cliente',
          quem: null,
          quando: '11/11 11:19',
          texto: 'Não estou achando o link, pode mandar de novo?',
        },
      ],
      [{ tipo: 'visita', imovelCodigo: 'IM0003', enviadoEm: '2026-11-11T09:05', agendado: false }],
    ),
    espera: {
      acoes: ['enviar_link_da_agenda'],
      agenda: { tipo: 'visita', imovelCodigo: 'IM0003' },
    },
    respostaBoa: resposta(
      'enviar_link_da_agenda',
      'Claro! Mando de novo o link para você escolher o dia e o horário da visita.',
      'Pediu o link da visita ao IM0003 de novo.',
      { tipo: 'visita', imovelCodigo: 'IM0003' },
    ),
  },
  {
    nome: 'proprietário que quer vender e saber quanto vale: link da reunião',
    entrada: conversa('2026-11-11T19:03', 'quarta-feira, 11 de novembro, às 19h03', [
      {
        messageId: 'm1',
        de: 'cliente',
        quem: null,
        quando: '11/11 19:02',
        texto:
          'Boa noite! Tenho um apartamento em Lagoa Nova e queria saber quanto ele vale para vender com vocês.',
      },
    ]),
    espera: {
      acoes: ['enviar_link_da_agenda'],
      agenda: { tipo: 'reuniao', imovelCodigo: null },
      proibido: [/R\$/],
    },
    respostaBoa: resposta(
      'enviar_link_da_agenda',
      'Boa noite, [[NOME_1]]! Que bom que pensou na Imova. Vou te mandar o link da agenda para você escolher um horário para conversar com um dos nossos corretores sobre o seu apartamento.',
      'Proprietário quer avaliar e vender; mandei o link da reunião.',
      { tipo: 'reuniao', imovelCodigo: null },
    ),
  },
  {
    nome: '"quero ver o terreno amanhã às 10h": manda o link e não confirma o horário',
    entrada: conversa('2026-11-11T17:31', 'quarta-feira, 11 de novembro, às 17h31', [
      {
        messageId: 'm1',
        de: 'cliente',
        quem: null,
        quando: '11/11 17:20',
        texto: 'Quanto está o terreno de Tabatinga?',
      },
      {
        messageId: 'm2',
        de: 'ia',
        quem: null,
        quando: '11/11 17:21',
        texto:
          'O terreno de Tabatinga (TE0004) está à venda por R$ 510.000, com 450 m². Quer visitar?',
      },
      {
        messageId: 'm3',
        de: 'cliente',
        quem: null,
        quando: '11/11 17:30',
        texto: 'Quero ver o terreno amanhã às 10h',
      },
    ]),
    espera: {
      acoes: ['enviar_link_da_agenda'],
      agenda: { tipo: 'visita', imovelCodigo: 'TE0004' },
      proibido: [/te espero|nos vemos|ficou para amanh[ãa]|est[áa] (tudo )?certo para amanh[ãa]/i],
    },
    respostaBoa: resposta(
      'enviar_link_da_agenda',
      'Vou te mandar o link da agenda: lá você vê se amanhã às 10h está livre e já escolhe o horário da visita.',
      'Quer visitar o TE0004 amanhã às 10h; mandei o link sem confirmar o horário.',
      { tipo: 'visita', imovelCodigo: 'TE0004' },
    ),
  },
  {
    nome: 'só pergunta o preço: responde, sem link',
    entrada: conversa('2026-11-11T08:16', 'quarta-feira, 11 de novembro, às 08h16', [
      {
        messageId: 'm1',
        de: 'cliente',
        quem: null,
        quando: '11/11 08:15',
        texto: 'Bom dia, qual o valor do terreno de Tabatinga?',
      },
    ]),
    espera: { acoes: ['responder'], exigido: [/510\.000/] },
    respostaBoa: resposta(
      'responder',
      'Bom dia, [[NOME_1]]! O terreno de Tabatinga está à venda por R$ 510.000, com 450 m². Quer saber mais alguma coisa dele?',
      'Perguntou o preço do TE0004.',
    ),
  },
  {
    nome: 'já agendou a visita a esse imóvel: não manda outro link',
    entrada: conversa(
      '2026-11-11T10:01',
      'quarta-feira, 11 de novembro, às 10h01',
      [
        {
          messageId: 'm1',
          de: 'cliente',
          quem: null,
          quando: '10/11 15:58',
          texto: 'Quero visitar o apartamento IM0003',
        },
        oLinkQueSaiu('10/11 16:00', 'IM0003', PONTA_NEGRA),
        {
          messageId: 'm3',
          de: 'cliente',
          quem: null,
          quando: '11/11 10:00',
          texto: 'Bom dia! Pode me mandar o link da visita ao apartamento de novo?',
        },
      ],
      [{ tipo: 'visita', imovelCodigo: 'IM0003', enviadoEm: '2026-11-10T16:00', agendado: true }],
    ),
    espera: { acoes: ['responder', 'passar_para_corretor'] },
    respostaBoa: resposta(
      'responder',
      'Bom dia, [[NOME_1]]! Sua visita ao apartamento já está agendada pelo link. Se quiser mudar o horário, eu passo para um corretor combinar com você.',
      'Já agendou a visita ao IM0003; não mandei outro link.',
    ),
  },
  {
    nome: 'mudou de imóvel: manda o link do novo',
    entrada: conversa(
      '2026-11-11T15:31',
      'quarta-feira, 11 de novembro, às 15h31',
      [
        {
          messageId: 'm1',
          de: 'cliente',
          quem: null,
          quando: '11/11 14:59',
          texto: 'Quero visitar o apartamento IM0003',
        },
        oLinkQueSaiu('11/11 15:00', 'IM0003', PONTA_NEGRA),
        {
          messageId: 'm3',
          de: 'cliente',
          quem: null,
          quando: '11/11 15:30',
          texto: 'Pensando bem, prefiro ver primeiro o terreno de Tabatinga.',
        },
      ],
      [{ tipo: 'visita', imovelCodigo: 'IM0003', enviadoEm: '2026-11-11T15:00', agendado: false }],
    ),
    espera: {
      acoes: ['enviar_link_da_agenda'],
      agenda: { tipo: 'visita', imovelCodigo: 'TE0004' },
    },
    respostaBoa: resposta(
      'enviar_link_da_agenda',
      'Sem problema! Vou te mandar o link para você escolher o dia e o horário da visita ao terreno.',
      'Trocou o IM0003 pelo TE0004; mandei o link da visita ao terreno.',
      { tipo: 'visita', imovelCodigo: 'TE0004' },
    ),
  },
  {
    nome: 'imóvel em rascunho: não manda link; confirma com o corretor',
    entrada: conversa('2026-11-11T13:11', 'quarta-feira, 11 de novembro, às 13h11', [
      {
        messageId: 'm1',
        de: 'cliente',
        quem: null,
        quando: '11/11 13:10',
        texto: 'Quero visitar a casa IM0007 em Capim Macio.',
      },
    ]),
    espera: { acoes: ['passar_para_corretor'] },
    respostaBoa: resposta(
      'passar_para_corretor',
      'Boa tarde, [[NOME_1]]! Vou confirmar a disponibilidade dessa casa com um corretor, que já continua com você por aqui para a visita.',
      'Quer visitar o IM0007, que precisa de confirmação; passei para o corretor.',
    ),
  },
];

// ------------------------------------------------------------------- a régua

/** Link, endereço de site ou o Calendly: o modelo nunca escreve, o CRM acrescenta. */
const LINK = /https?:\/\/|www\.|calendly\.com/i;

/** Horário dado por certo na mensagem do link: quem marca é o cliente, no link. */
const CONFIRMOU =
  /\b(marquei|agendei|confirmei|combinado|fechado|(est[áa]|ficou) (marcad|agendad|confirmad)[ao])\b/i;

/** O tamanho de uma ou duas frases, com folga. */
export const TAMANHO_DA_MENSAGEM_DO_LINK = 300;

/** "IM0003", "im 3", "IM0003_IMOVA" e "IM-3" são o mesmo código, como no banco. */
export function mesmoCodigo(a: string | null | undefined, b: string | null | undefined): boolean {
  const chave = (c: string | null | undefined): string | null => {
    const achado = /([a-z]{2,5})[ -]?0*(\d+)/i.exec(c ?? '');
    return achado === null ? null : `${achado[1]!.toUpperCase()}${achado[2]}`;
  };
  const ka = chave(a);
  return ka !== null && ka === chave(b);
}

/**
 * O que a resposta errou no cenário, em frases para a equipe. Lista vazia é acerto.
 * É determinístico de propósito: mede a decisão (a ação, o tipo, o imóvel) e as regras
 * duras da mensagem (sem link, sem horário confirmado, curta), não o estilo.
 */
export function conferirCenario(cenario: CenarioDoAtendente, saida: SaidaDoAtendenteV3): string[] {
  const falhas: string[] = [];
  const { espera } = cenario;
  const mensagem = saida.mensagem.trim();

  if (!espera.acoes.includes(saida.acao)) {
    falhas.push(`ação ${saida.acao}; esperava ${espera.acoes.join(' ou ')}`);
  }
  if (saida.acao !== 'nao_responder' && mensagem === '') falhas.push('mensagem vazia');
  if (LINK.test(mensagem)) falhas.push('a mensagem tem link ou endereço de site');

  if (saida.acao === 'enviar_link_da_agenda') {
    if (saida.agenda === null) {
      falhas.push('mandou o link sem dizer se é visita ou reunião');
    } else {
      if (espera.agenda !== undefined && saida.agenda.tipo !== espera.agenda.tipo) {
        falhas.push(`link de ${saida.agenda.tipo}; esperava ${espera.agenda.tipo}`);
      }
      if (
        espera.agenda?.tipo === 'visita' &&
        !mesmoCodigo(saida.agenda.imovelCodigo, espera.agenda.imovelCodigo)
      ) {
        falhas.push(
          `visita ao ${saida.agenda.imovelCodigo ?? 'imóvel nenhum'}; esperava ${espera.agenda.imovelCodigo ?? '—'}`,
        );
      }
      if (
        saida.agenda.tipo === 'visita' &&
        saida.agenda.imovelCodigo !== null &&
        mensagem.includes(saida.agenda.imovelCodigo)
      ) {
        falhas.push('repetiu o código do imóvel, que o CRM já põe embaixo');
      }
    }
    if (CONFIRMOU.test(mensagem)) falhas.push('deu o horário por marcado');
    if (mensagem.length > TAMANHO_DA_MENSAGEM_DO_LINK) {
      falhas.push(
        `mensagem do link com ${mensagem.length} caracteres (até ${TAMANHO_DA_MENSAGEM_DO_LINK})`,
      );
    }
  } else if (saida.agenda !== null) {
    falhas.push('preencheu a agenda sem mandar o link');
  }

  for (const padrao of espera.exigido ?? []) {
    if (!padrao.test(mensagem)) falhas.push(`a mensagem não tem ${padrao.source}`);
  }
  for (const padrao of espera.proibido ?? []) {
    if (padrao.test(mensagem)) falhas.push(`a mensagem tem ${padrao.source}`);
  }
  return falhas;
}
