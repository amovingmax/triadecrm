/**
 * `atendente-imova@v6` (17/11/2026): a v5 com O E-MAIL PARA OFERTAS.
 *
 * Pedido do usuário (17/11/2026): "Devemos treinar a IA para pedir o email das pessoas
 * caso elas queiram receber mais ofertas e receberem mais promoções", junto com "caso
 * seja fornecido a informação devemos colocar esse email que foi fornecido à ficha dele".
 *
 * O que muda em relação à v5:
 * - Um bloco novo, "O E-MAIL PARA OFERTAS": quando convidar (ficha existe, e-mail ainda
 *   não está nela, ele nunca respondeu ao convite), o momento (pausa natural, depois de
 *   resolver o que ele pediu; nunca na primeira resposta nem junto do link, da visita ou
 *   de uma passagem), uma vez por conversa, a frase do convite e o que dizer quando o
 *   e-mail chega.
 * - A entrada ganha `cliente.email` ({naFicha, ofertas}), vinda do banco
 *   (`app.ia_email_do_cliente`, migração 20261118150000). Nunca o endereço: o e-mail que
 *   o cliente escreve chega ao modelo como marcador (`[[EMAIL_1]]`), e quem o grava na
 *   ficha é um gatilho do banco (`messages_zzz_email_na_ficha`), não a IA.
 * - A saída ganha `ofertasPorEmail` ("aceitou" | "recusou" | null), que o worker leva a
 *   `public.ia_atendente_ofertas_por_email`. É o que faz a IA não convidar de novo quem
 *   recusou, e o que diz a um disparo de e-mail quem aceitou.
 *
 * O resto é a v5 palavra por palavra (a visita sem link, a reunião pelo link, o modelo,
 * o pensamento). Voltar à v5 é trocar o número em `VIGENTES` e o import do worker; o
 * banco aceita os dois (a chave `email` da entrada é ignorada pela v5).
 *
 * O número: a entrevista de 16/11 planejava uma "v6" com as regras firmes. Esta mudança
 * veio antes e ficou com o 6; aquela passa a ser a v7.
 */
import { z } from 'zod';

import { definirPrompt } from '../../nucleo/versionamento';
import { type BaseDoAtendenteV2, montarBaseV2 } from './v2';
import { entradaDoAtendenteV3, saidaDoAtendenteV3 } from './v3';
import { trocarUmaVez } from './v4';
import { atendenteImovaV5 as v5 } from './v5';

/** O que o cliente respondeu ao convite de receber ofertas por e-mail. */
export const RESPOSTAS_AS_OFERTAS = ['aceitou', 'recusou'] as const;
export type RespostaAsOfertas = (typeof RESPOSTAS_AS_OFERTAS)[number];

/** A frase do convite, como o bloco a ensina. */
export const FRASE_DO_CONVITE =
  'Se quiser, posso te enviar ofertas e novidades de imóveis por e-mail. Qual é o seu e-mail?';

const emailDoCliente = z.object({
  /** O e-mail do cliente já está na ficha (nunca o endereço). */
  naFicha: z.boolean(),
  /** A resposta mais nova ao convite; null = nunca respondeu. */
  ofertas: z.enum(RESPOSTAS_AS_OFERTAS).nullable(),
});
export type EmailDoCliente = z.infer<typeof emailDoCliente>;

const entrada = entradaDoAtendenteV3.extend({
  cliente: entradaDoAtendenteV3.shape.cliente.extend({ email: emailDoCliente }),
});
export type EntradaDoAtendenteV6 = z.infer<typeof entrada>;

const saida = saidaDoAtendenteV3.extend({
  ofertasPorEmail: z
    .enum(RESPOSTAS_AS_OFERTAS)
    .nullable()
    .describe(
      'aceitou: respondendo ao convite de ofertas por e-mail, ele mandou o e-mail ou disse que quer receber. recusou: disse que não quer. Senão null.',
    ),
});
export type SaidaDoAtendenteV6 = z.infer<typeof saida>;

const ANTES_DO_BLOCO = 'O QUE É DE GENTE (acao = passar_para_corretor):';

const BLOCO_DO_EMAIL = `O E-MAIL PARA OFERTAS (acao = responder):
A Imova manda ofertas e novidades de imóveis por e-mail a quem quiser receber. Você
convida; quem decide é o cliente. A entrada diz se o e-mail dele já está na ficha e se ele
já respondeu ao convite.
- Convide só quando a ficha existe ("ficha no CRM: sim"), o e-mail ainda não está na ficha
  e ele nunca respondeu ao convite. Já aceitou e o e-mail ainda não está na ficha? Peça o
  e-mail uma vez. Recusou? Não convide de novo.
- O momento: depois de resolver o que ele pediu, numa pausa natural da conversa: ele
  agradeceu, disse que vai pensar, que está só pesquisando, ou hoje não temos o que ele
  procura. Ele só agradeceu e o convite cabe? Responda com o convite: isto vale mais que
  QUANDO NÃO RESPONDER.
- Nunca na primeira resposta da conversa, nunca na mesma mensagem do link da agenda, da
  frase da visita ou de uma passagem para a equipe, e nunca com cliente irritado ou que
  pediu para não receber mensagens.
- Uma vez por conversa. Você já convidou e ele não respondeu ao convite? Não repita; siga
  o assunto dele.
- O convite é uma frase curta no fim da sua mensagem, sem insistir: "${FRASE_DO_CONVITE}"
- Ele mandou o e-mail (na conversa, o endereço aparece como um marcador, como
  [[EMAIL_1]]): responda sempre (nunca nao_responder), agradeça em poucas palavras e diga
  que vai mandar as novidades por lá ("Perfeito, anotado! Vou te enviar as novidades por
  e-mail."). Não repita o endereço nem o marcador, não peça confirmação e não prometa
  frequência nem desconto. O CRM guarda o e-mail na ficha sozinho, assim que ele chega: por
  isso, nessa hora, a entrada já diz que o e-mail está na ficha.
- Perguntou para que é: só para mandar imóveis e ofertas da Imova, e ele pode pedir para
  parar quando quiser.
- \`ofertasPorEmail\`: "aceitou" quando, respondendo ao convite, ele manda o e-mail ou diz
  que quer receber; "recusou" quando diz que não quer; senão null. Mandou um e-mail sem o
  convite, por outro motivo (um documento, um contrato): null.

`;

const CONFIANCA_NA_SAIDA = `- \`confianca\`: de 0 a 1, o quanto você tem certeza de que a resposta está certa e completa.`;
const OFERTAS_E_CONFIANCA_NA_SAIDA = `- \`ofertasPorEmail\`: "aceitou", "recusou" ou null (ver O E-MAIL PARA OFERTAS).
${CONFIANCA_NA_SAIDA}`;

const sistema = trocarUmaVez(
  trocarUmaVez(v5.sistema, ANTES_DO_BLOCO, `${BLOCO_DO_EMAIL}${ANTES_DO_BLOCO}`),
  CONFIANCA_NA_SAIDA,
  OFERTAS_E_CONFIANCA_NA_SAIDA,
);

/** O bloco de sistema de uma chamada da v6: as regras, mais a base da Imova (a da v2). */
export function sistemaComBaseV6(base: BaseDoAtendenteV2): string {
  return `${sistema}\n\n${montarBaseV2(base)}`;
}

/** A linha do e-mail na mensagem, sem data (data em dígitos vira telefone na auditoria). */
export function linhaDoEmail(email: EmailDoCliente): string {
  const ficha = email.naFicha ? 'já está na ficha' : 'ainda não está na ficha';
  const ofertas =
    email.ofertas === 'aceitou'
      ? 'aceitou receber'
      : email.ofertas === 'recusou'
        ? 'recusou (não convide de novo)'
        : 'nunca respondeu ao convite';
  return `e-mail do cliente: ${ficha}; ofertas por e-mail: ${ofertas}`;
}

const ANCORA_DO_PERFIL = '\no que já se sabe dele:';

/** A mensagem da v6: a da v5, com a linha do e-mail antes do que já se sabe dele. */
function montarMensagem(dados: EntradaDoAtendenteV6): string {
  const mensagem = v5.montarMensagem(dados);
  if (mensagem.split(ANCORA_DO_PERFIL).length !== 2) {
    throw new Error('atendente-imova@v6: a mensagem da v5 não tem a linha do perfil uma vez só.');
  }
  return mensagem.replace(
    ANCORA_DO_PERFIL,
    `\n${linhaDoEmail(dados.cliente.email)}${ANCORA_DO_PERFIL}`,
  );
}

/**
 * Os exemplos da v5 com o e-mail já na ficha (eles não convidam, e não convidar é o
 * certo quando o e-mail já está lá), mais três do convite.
 */
const exemplos = [
  ...v5.exemplos.map((e) => ({
    nome: e.nome,
    entrada: {
      ...e.entrada,
      cliente: { ...e.entrada.cliente, email: { naFicha: true, ofertas: null } },
    },
    saida: { ...e.saida, ofertasPorEmail: null },
  })),
  {
    nome: 'só pesquisando, ficha sem e-mail: responde e convida para as ofertas por e-mail',
    entrada: {
      leadId: 'lead-21',
      agora: '2026-11-17T10:20',
      agoraPorExtenso: 'terça-feira, 17 de novembro, às 10h20',
      treino: false,
      cliente: {
        nome: '[[NOME_1]]',
        temFicha: true,
        etapa: 'Respondeu',
        perfil: [{ campo: 'procura', valor: 'casa para comprar em Parnamirim' }],
        visitas: [],
        canalDeChegada: 'anuncios' as const,
        email: { naFicha: false, ofertas: null },
      },
      convitesDaAgenda: [],
      respostasNaUltimaHora: 2,
      mensagens: [
        {
          messageId: 'm1',
          de: 'ia' as const,
          quem: null,
          quando: '17/11 10:12',
          texto:
            'No momento não temos casa à venda em Parnamirim. Temos terrenos na região; quer que eu te mostre?',
        },
        {
          messageId: 'm2',
          de: 'cliente' as const,
          quem: null,
          quando: '17/11 10:19',
          texto: 'Agora não, obrigado. Por enquanto estou só pesquisando.',
        },
      ],
    },
    saida: {
      acao: 'responder' as const,
      mensagem: `Tudo bem, fico à disposição! ${FRASE_DO_CONVITE}`,
      agenda: null,
      motivo:
        'Está só pesquisando e a ficha não tem e-mail; convidei uma vez para as ofertas por e-mail.',
      anotacoes: [],
      fotosEnsinadas: [],
      confianca: 0.85,
      ofertasPorEmail: null,
    },
  },
  {
    nome: 'manda o e-mail depois do convite: agradece, não repete o endereço, e aceitou',
    entrada: {
      leadId: 'lead-21',
      agora: '2026-11-17T10:24',
      agoraPorExtenso: 'terça-feira, 17 de novembro, às 10h24',
      treino: false,
      cliente: {
        nome: '[[NOME_1]]',
        temFicha: true,
        etapa: 'Respondeu',
        perfil: [{ campo: 'procura', valor: 'casa para comprar em Parnamirim' }],
        visitas: [],
        canalDeChegada: 'anuncios' as const,
        email: { naFicha: true, ofertas: null },
      },
      convitesDaAgenda: [],
      respostasNaUltimaHora: 3,
      mensagens: [
        {
          messageId: 'm1',
          de: 'ia' as const,
          quem: null,
          quando: '17/11 10:20',
          texto: `Tudo bem, fico à disposição! ${FRASE_DO_CONVITE}`,
        },
        {
          messageId: 'm2',
          de: 'cliente' as const,
          quem: null,
          quando: '17/11 10:23',
          texto: 'Pode mandar sim: [[EMAIL_1]]',
        },
      ],
    },
    saida: {
      acao: 'responder' as const,
      mensagem:
        'Perfeito, anotado! Vou te enviar as novidades por e-mail, e se aparecer uma casa em Parnamirim te aviso por aqui também.',
      agenda: null,
      motivo: 'Aceitou o convite e mandou o e-mail; o CRM guarda na ficha.',
      anotacoes: [],
      fotosEnsinadas: [],
      confianca: 0.9,
      ofertasPorEmail: 'aceitou' as const,
    },
  },
  {
    nome: 'não quer receber por e-mail: responde curto, recusou, e não convida mais',
    entrada: {
      leadId: 'lead-22',
      agora: '2026-11-17T15:05',
      agoraPorExtenso: 'terça-feira, 17 de novembro, às 15h05',
      treino: false,
      cliente: {
        nome: null,
        temFicha: true,
        etapa: 'Respondeu',
        perfil: [],
        visitas: [],
        canalDeChegada: 'placa' as const,
        email: { naFicha: false, ofertas: null },
      },
      convitesDaAgenda: [],
      respostasNaUltimaHora: 2,
      mensagens: [
        {
          messageId: 'm1',
          de: 'ia' as const,
          quem: null,
          quando: '17/11 15:01',
          texto: `O terreno de Tabatinga continua disponível. ${FRASE_DO_CONVITE}`,
        },
        {
          messageId: 'm2',
          de: 'cliente' as const,
          quem: null,
          quando: '17/11 15:04',
          texto: 'Não precisa, prefiro falar por aqui mesmo.',
        },
      ],
    },
    saida: {
      acao: 'responder' as const,
      mensagem: 'Sem problema, seguimos por aqui! Qualquer dúvida sobre o terreno, é só me chamar.',
      agenda: null,
      motivo: 'Recusou as ofertas por e-mail; não convido de novo.',
      anotacoes: [],
      fotosEnsinadas: [],
      confianca: 0.9,
      ofertasPorEmail: 'recusou' as const,
    },
  },
];

export const atendenteImovaV6 = definirPrompt<EntradaDoAtendenteV6, SaidaDoAtendenteV6>({
  id: 'atendente-imova',
  versao: 6,
  modelo: v5.modelo,
  proposito: v5.proposito,
  entrada,
  saida,
  sistema,
  camposDeTexto: v5.camposDeTexto,
  camposDoTriade: v5.camposDoTriade,
  escala: v5.escala,
  maxTokens: v5.maxTokens,
  montarMensagem,
  exemplos,
});
