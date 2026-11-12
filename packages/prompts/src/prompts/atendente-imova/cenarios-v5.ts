import type { BaseDoAtendenteV2 } from './v2';
import type { EntradaDoAtendenteV3, SaidaDoAtendenteV3 } from './v3';
import type { CenarioDoAtendente } from './cenarios-v3';
import { BASE_DO_ENSAIO_V4, CENARIOS_DO_ATENDENTE_V4 } from './cenarios-v4';
import { FRASE_DA_VISITA } from './v5';

/**
 * Os cenários do ensaio de `atendente-imova@v5` (12/11/2026): a visita presencial sem
 * link. São os da v4 com toda visita trocada (pergunta o dia e o período, ou diz a frase
 * da agenda e passa; link de visita nunca), mais quatro novos: a resposta com o dia, o
 * horário proposto, o cliente que pede "o link" para visitar e o link da reunião pedido
 * de novo. A régua (`conferirCenario`) é a mesma da v3: como nenhum cenário de visita
 * aceita `enviar_link_da_agenda`, mandar o link na visita é sempre erro.
 */

export const BASE_DO_ENSAIO_V5: BaseDoAtendenteV2 = BASE_DO_ENSAIO_V4;

/** A frase da visita, com folga para o acento e a pontuação. */
export const FRASE_DA_VISITA_NA_MENSAGEM = /consultar um hor[áa]rio em que entre na minha agenda/i;

/** Pergunta de dia ou período, sem oferecer horário. */
const PERGUNTA_DO_DIA = /dia|per[íi]odo|turno|manh[ãa]|tarde/i;

type Mensagens = EntradaDoAtendenteV3['mensagens'];

function daV4(nome: string): CenarioDoAtendente {
  const achado = CENARIOS_DO_ATENDENTE_V4.find((c) => c.nome === nome);
  if (achado === undefined) throw new Error(`cenarios-v5: o cenário "${nome}" sumiu da v4.`);
  return achado;
}

function resposta(
  acao: SaidaDoAtendenteV3['acao'],
  mensagem: string,
  motivo: string,
  agenda: SaidaDoAtendenteV3['agenda'] = null,
): SaidaDoAtendenteV3 {
  return { acao, mensagem, agenda, motivo, anotacoes: [], fotosEnsinadas: [], confianca: 0.85 };
}

/** Uma conversa nova a partir da entrada de um cenário da v4, com outras mensagens. */
function comMensagens(
  base: EntradaDoAtendenteV3,
  agora: string,
  agoraPorExtenso: string,
  mensagens: Mensagens,
  convitesDaAgenda: EntradaDoAtendenteV3['convitesDaAgenda'] = [],
): EntradaDoAtendenteV3 {
  return {
    ...base,
    agora,
    agoraPorExtenso,
    mensagens,
    convitesDaAgenda,
    respostasNaUltimaHora: mensagens.filter((m) => m.de === 'ia').length,
  };
}

const NOMES_DA_V4 = {
  comCodigo: 'visita com código: manda o link da visita àquele imóvel',
  semImovel: 'visita sem imóvel: pergunta qual antes de mandar o link',
  foraDaLista: 'imóvel fora da lista: não manda link; pergunta onde viu ou passa',
  pediuDeNovo: 'pediu o link de novo: manda de novo',
  proprietario: 'proprietário que quer vender e saber quanto vale: link da reunião',
  amanha10h: '"quero ver o terreno amanhã às 10h": manda o link e não confirma o horário',
  mudouDeImovel: 'mudou de imóvel: manda o link do novo',
  rascunho: 'imóvel em rascunho: manda o link da visita (v4)',
  pausado: 'imóvel pausado: não manda link; confirma com o corretor (v4)',
} as const;

const comCodigo = daV4(NOMES_DA_V4.comCodigo);
const semImovel = daV4(NOMES_DA_V4.semImovel);
const foraDaLista = daV4(NOMES_DA_V4.foraDaLista);
const pediuDeNovo = daV4(NOMES_DA_V4.pediuDeNovo);
const proprietario = daV4(NOMES_DA_V4.proprietario);
const amanha10h = daV4(NOMES_DA_V4.amanha10h);
const mudouDeImovel = daV4(NOMES_DA_V4.mudouDeImovel);
const rascunho = daV4(NOMES_DA_V4.rascunho);
const pausado = daV4(NOMES_DA_V4.pausado);

const PERGUNTA_BOA = 'Qual dia e período ficam melhores pra você?';

/** Os cenários da v4 que a v5 troca, pelo nome na v4. */
const TROCADOS: Readonly<Record<string, CenarioDoAtendente>> = {
  [NOMES_DA_V4.comCodigo]: {
    nome: 'visita com código e sem dia: pergunta o dia e o período, sem link (v5)',
    entrada: comCodigo.entrada,
    espera: { acoes: ['responder'], exigido: [/\?/, PERGUNTA_DO_DIA] },
    respostaBoa: resposta(
      'responder',
      `Boa tarde, [[NOME_1]]! Claro, dá para conhecer sim. ${PERGUNTA_BOA}`,
      'Quer visitar o IM0003 e não disse o dia; perguntei o dia e o período.',
    ),
  },
  [NOMES_DA_V4.semImovel]: {
    nome: 'visita sem imóvel: pergunta qual, sem link (v5)',
    entrada: semImovel.entrada,
    espera: { acoes: ['responder'], exigido: [/\?/] },
    respostaBoa: resposta(
      'responder',
      'Bom dia, [[NOME_1]]! Claro. Qual imóvel você quer visitar? Pode me dizer o bairro ou onde viu o anúncio.',
      'Quer visitar, mas não disse qual imóvel.',
    ),
  },
  [NOMES_DA_V4.foraDaLista]: {
    nome: 'imóvel fora da lista: pergunta onde viu ou passa, sem link (v5)',
    entrada: foraDaLista.entrada,
    espera: { acoes: ['responder', 'passar_para_corretor'] },
    respostaBoa: resposta(
      'responder',
      'Boa tarde, [[NOME_1]]! Não estou achando essa casa por aqui. Onde você viu o anúncio? Assim confirmo qual é.',
      'O imóvel da Rua dos Pinheiros não está na lista; perguntei onde ele viu.',
    ),
  },
  [NOMES_DA_V4.pediuDeNovo]: {
    nome: 'pediu de novo o link de uma visita antiga: não manda; pergunta o dia ou passa (v5)',
    entrada: pediuDeNovo.entrada,
    espera: { acoes: ['responder', 'passar_para_corretor'] },
    respostaBoa: resposta(
      'responder',
      `Para a visita, a gente combina o horário por aqui mesmo. ${PERGUNTA_BOA}`,
      'Pediu de novo o link da visita ao IM0003; visita não tem link, perguntei o dia.',
    ),
  },
  [NOMES_DA_V4.proprietario]: {
    ...proprietario,
    nome: 'proprietário que quer vender e saber quanto vale: link da reunião online (v5)',
    respostaBoa: resposta(
      'enviar_link_da_agenda',
      'Boa noite, [[NOME_1]]! Que bom que pensou na Imova. Vou te mandar o link da agenda para você escolher o melhor dia e horário da nossa conversa sobre o seu apartamento.',
      'Proprietário quer avaliar e vender; mandei o link da reunião online.',
      { tipo: 'reuniao', imovelCodigo: null },
    ),
  },
  [NOMES_DA_V4.amanha10h]: {
    nome: '"quero ver o terreno amanhã às 10h": a frase da agenda e passa, sem confirmar (v5)',
    entrada: amanha10h.entrada,
    espera: {
      acoes: ['passar_para_corretor'],
      exigido: [FRASE_DA_VISITA_NA_MENSAGEM],
      proibido: [
        /te espero|nos vemos|ficou para amanh[ãa]|est[áa] (tudo )?certo para amanh[ãa]/i,
        /\b(marquei|agendei|confirmei|combinado|fechado|(est[áa]|ficou) (marcad|agendad|confirmad)[ao])\b/i,
      ],
    },
    respostaBoa: resposta(
      'passar_para_corretor',
      `Perfeito! ${FRASE_DA_VISITA}`,
      'Visita: TE0004 · prefere amanhã às 10h.',
    ),
  },
  [NOMES_DA_V4.mudouDeImovel]: {
    nome: 'mudou de imóvel: pergunta o dia da visita ao novo ou passa, sem link (v5)',
    entrada: mudouDeImovel.entrada,
    espera: { acoes: ['responder', 'passar_para_corretor'] },
    respostaBoa: resposta(
      'responder',
      'Sem problema! Qual dia e período ficam melhores pra você ver o terreno?',
      'Trocou o IM0003 pelo TE0004; perguntei o dia da visita ao terreno.',
    ),
  },
  [NOMES_DA_V4.rascunho]: {
    nome: 'imóvel em rascunho: pergunta o dia e o período, sem link (v5)',
    entrada: rascunho.entrada,
    espera: { acoes: ['responder'], exigido: [/\?/, PERGUNTA_DO_DIA] },
    respostaBoa: resposta(
      'responder',
      `Boa tarde, [[NOME_1]]! Claro. ${PERGUNTA_BOA}`,
      'Quer visitar o IM0007 e não disse o dia; perguntei.',
    ),
  },
  [NOMES_DA_V4.pausado]: {
    nome: 'imóvel pausado: pergunta o dia ou passa, sem link (v5)',
    entrada: pausado.entrada,
    espera: { acoes: ['responder', 'passar_para_corretor'] },
    respostaBoa: resposta(
      'responder',
      `Boa tarde, [[NOME_1]]! Claro. ${PERGUNTA_BOA}`,
      'Quer visitar o IM0009 e não disse o dia; perguntei.',
    ),
  },
};

const respondeuODia: CenarioDoAtendente = {
  nome: 'respondeu o dia da visita: a frase da agenda e passa (v5)',
  entrada: comMensagens(rascunho.entrada, '2026-11-11T13:31', 'quarta-feira, 11 de novembro, às 13h31', [
    {
      messageId: 'm1',
      de: 'cliente',
      quem: null,
      quando: '11/11 13:10',
      texto: 'Quero visitar a casa IM0007 em Capim Macio.',
    },
    {
      messageId: 'm2',
      de: 'ia',
      quem: null,
      quando: '11/11 13:11',
      texto: `Boa tarde! Claro. ${PERGUNTA_BOA}`,
    },
    {
      messageId: 'm3',
      de: 'cliente',
      quem: null,
      quando: '11/11 13:30',
      texto: 'Sexta à tarde seria ótimo.',
    },
  ]),
  espera: { acoes: ['passar_para_corretor'], exigido: [FRASE_DA_VISITA_NA_MENSAGEM] },
  respostaBoa: resposta(
    'passar_para_corretor',
    `Perfeito! ${FRASE_DA_VISITA}`,
    'Visita: IM0007 · prefere sexta à tarde.',
  ),
};

const pedeOLinkParaVisitar: CenarioDoAtendente = {
  nome: 'pede "o link da agenda" para visitar: não manda link (v5)',
  entrada: comMensagens(rascunho.entrada, '2026-11-11T10:06', 'quarta-feira, 11 de novembro, às 10h06', [
    {
      messageId: 'm1',
      de: 'cliente',
      quem: null,
      quando: '11/11 10:05',
      texto: 'Me manda o link da agenda pra eu marcar a visita na casa IM0007 de Capim Macio.',
    },
  ]),
  espera: { acoes: ['responder', 'passar_para_corretor'] },
  respostaBoa: resposta(
    'responder',
    `Bom dia, [[NOME_1]]! A visita a gente combina por aqui mesmo. ${PERGUNTA_BOA}`,
    'Pediu o link para visitar o IM0007; visita não tem link, perguntei o dia.',
  ),
};

const reuniaoDeNovo: CenarioDoAtendente = {
  nome: 'pediu o link da reunião de novo: manda de novo (v5)',
  entrada: comMensagens(
    proprietario.entrada,
    '2026-11-12T11:20',
    'quinta-feira, 12 de novembro, às 11h20',
    [
      {
        messageId: 'm1',
        de: 'cliente',
        quem: null,
        quando: '12/11 09:04',
        texto: 'Tenho um apartamento em Lagoa Nova e queria anunciar com vocês.',
      },
      {
        messageId: 'm2',
        de: 'ia',
        quem: null,
        quando: '12/11 09:05',
        texto:
          'Que bom que pensou na Imova! Vou te mandar o link da agenda para você escolher o melhor dia e horário da nossa conversa.\n\nEscolha o horário: [link da agenda]',
      },
      {
        messageId: 'm3',
        de: 'cliente',
        quem: null,
        quando: '12/11 11:19',
        texto: 'Não estou achando o link da conversa, pode mandar de novo?',
      },
    ],
    [{ tipo: 'reuniao', imovelCodigo: null, enviadoEm: '2026-11-12T09:05', agendado: false }],
  ),
  espera: { acoes: ['enviar_link_da_agenda'], agenda: { tipo: 'reuniao', imovelCodigo: null } },
  respostaBoa: resposta(
    'enviar_link_da_agenda',
    'Claro! Mando de novo o link para você escolher o dia e o horário da nossa conversa.',
    'Pediu de novo o link da reunião online.',
    { tipo: 'reuniao', imovelCodigo: null },
  ),
};

export const CENARIOS_DO_ATENDENTE_V5: readonly CenarioDoAtendente[] = [
  ...CENARIOS_DO_ATENDENTE_V4.map((c) => TROCADOS[c.nome] ?? c),
  respondeuODia,
  pedeOLinkParaVisitar,
  reuniaoDeNovo,
];
