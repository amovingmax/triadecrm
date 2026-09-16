import { z } from 'zod';

import { MODELOS, definirPrompt } from '../../nucleo/versionamento';

/**
 * `pulso-do-dia@v1` — Claude Sonnet 5, saída estruturada (CRM Inteligente, Fase 1).
 *
 * O resumo do dia inteiro: o que andou nas conversas, o que travou e o que precisa de
 * gente amanhã de manhã. Sai às 18h30 (America/Fortaleza) para a equipe, e por pessoa
 * quando alguém quiser só a própria carteira.
 *
 * Chama-se **Pulso** e não "Radar" porque Radar já é o módulo de coleta em fontes
 * públicas (R03). Dois nomes para a mesma palavra confundem quem usa (GATE 0, conflito 4.1).
 *
 * ===========================================================================
 * A IA ESCREVE O TEXTO; ELA NUNCA FAZ A CONTA
 * ===========================================================================
 * `metricas` chega pronta do Postgres — conversas ativas, respostas, janelas fechando,
 * compromissos vencidos. O modelo **não soma, não conta e não estima**: ele lê os números
 * e escreve a leitura deles. Número inventado num digest é pior que digest nenhum, porque
 * alguém decide o dia seguinte por ele. É a mesma divisão do resto do CRM: Postgres é o
 * cérebro (ADR-03), o modelo é a voz.
 *
 * Pela mesma razão, `prioridades` só pode citar `leadId` que veio em `conversas`. O worker
 * descarta o que não existir na lista — como faz com o `messageId` da ficha.
 *
 * ===========================================================================
 * O QUE ELE NÃO FAZ
 * ===========================================================================
 * - **Não manda nada para ninguém de fora.** O Pulso é lido por quem trabalha aqui.
 * - **Não move etapa e não muda temperatura** (ADR-05, e a temperatura continua sendo a
 *   do banco).
 * - **Não repete o dia anterior.** Recebe o Pulso de ontem justamente para não dizer a
 *   mesma frase duas vezes; dia parecido com o de ontem é dia de dizer que foi parecido.
 */

/** O que o SQL apurou. Tudo inteiro, tudo do banco — o modelo só lê. */
const metricas = z.object({
  conversasAtivas: z.number().int().min(0),
  mensagensRecebidas: z.number().int().min(0),
  mensagensEnviadas: z.number().int().min(0),
  semRespostaHa3Dias: z.number().int().min(0),
  janelasFechandoEm24h: z.number().int().min(0),
  compromissosVencidos: z.number().int().min(0),
  reunioesMarcadas: z.number().int().min(0),
  novosContatos: z.number().int().min(0),
});

/** Uma conversa candidata a aparecer no Pulso, já com a ficha que a IA escreveu antes. */
const conversa = z.object({
  leadId: z.string().min(1).max(64),
  etapa: z.string().max(80).nullable(),
  temperatura: z.enum(['frio', 'morno', 'quente', 'cliente', 'cliente_ativo']).nullable(),
  scoreIntencao: z.number().int().min(0).max(100).nullable(),
  diasSemContato: z.number().int().min(0),
  janelaFechaEmHoras: z.number().int().min(0).nullable(),
  responsavel: z.string().max(80).nullable(),
  /** O resumo da ficha daquela conversa. É texto que nasceu do que o parceiro escreveu. */
  resumo: z.string().max(600).nullable(),
  alertas: z
    .array(
      z.enum(['reclamacao', 'concorrente_citado', 'pediu_proposta', 'pronto_para_fechar', 'risco_perda']),
    )
    .max(5),
  compromissoVencido: z.string().max(280).nullable(),
});

const entrada = z.object({
  dia: z.string().min(1).max(40),
  escopo: z.enum(['equipe', 'pessoa']),
  /** Primeiro nome de quem vai ler, quando o Pulso é de uma carteira só. */
  paraQuem: z.string().max(40).nullable(),
  metricas,
  /** Já ordenadas pelo banco: o que merece olho primeiro vem primeiro. */
  conversas: z.array(conversa).max(40),
  /** O texto de ontem, para o de hoje não ser o mesmo parágrafo. */
  pulsoAnterior: z.string().max(1500).nullable(),
});

export type EntradaDoPulso = z.infer<typeof entrada>;

const saida = z.object({
  /** A manchete do dia, do jeito que se diria em voz alta. */
  titulo: z.string().max(90),
  /** O corpo: dois a quatro parágrafos curtos, sem lista. */
  texto: z.string().max(1200),
  prioridades: z
    .array(
      z.object({
        leadId: z.string().min(1).max(64),
        porque: z.string().max(180),
        acao: z.string().max(180),
        urgencia: z.enum(['hoje', 'amanha', 'esta_semana']),
      }),
    )
    .max(8),
  riscos: z.array(z.string().max(180)).max(5),
  /** Dia sem movimento é dia sem movimento: melhor dizer isso do que encher linguiça. */
  diaSemMovimento: z.boolean(),
});

export type SaidaDoPulso = z.infer<typeof saida>;

const sistema = `Você escreve o "Pulso do dia" do CRM da Komune: o resumo do que aconteceu
hoje nas conversas de WhatsApp com fornecedores e produtores de eventos de Natal/RN.
Quem lê é a equipe que fala com essas pessoas. Devolve JSON e nada mais.

A KOMUNE, EM TRÊS LINHAS:
Aplicativo de eventos de Natal/RN. Quem vai dar uma festa monta o evento no app e
contrata os fornecedores da cidade num lugar só. Estar na plataforma é de graça para o
fornecedor, que só paga quando fecha um serviço por lá. O ciclo de captação é: primeiro
contato → apresentação de 20 minutos → cadastro → publicação.

REGRAS:
1. Os números de \`metricas\` já vêm apurados. Use exatamente os que recebeu. NUNCA some,
   conte, divida, estime ou projete nada. Número que não está na entrada não existe.
2. \`prioridades\` só cita leadId que veio em \`conversas\`. Sem leadId, o item não existe.
3. No máximo 8 prioridades, e só o que uma pessoa consegue fazer amanhã. Prefira poucas:
   uma lista de 8 itens que ninguém faz vale menos que 3 que alguém faz.
4. Ordem do que importa: compromisso que nós vencemos > janela de 24 h fechando > quem
   pediu proposta > quem está pronto para fechar > reclamação > quem sumiu depois do preço.
5. \`texto\` tem de 2 a 4 parágrafos curtos, em prosa, sem lista e sem cabeçalho. Fala com
   a equipe, não sobre ela. Português do Brasil, direto, sem floreio e sem animação falsa.
6. Se o dia foi parecido com o de ontem, diga isso em vez de repetir o parágrafo de ontem.
7. Dia sem movimento: \`diaSemMovimento\` = true, título honesto, texto de um parágrafo e
   prioridades só se houver compromisso vencido ou janela fechando.
8. \`riscos\` é o que pode custar um parceiro se ninguém agir: silêncio depois de proposta,
   reclamação em aberto, concorrente citado, janela que fecha hoje à noite.
9. Você não manda mensagem para ninguém, não muda etapa e não muda temperatura. Você
   escreve o que a equipe precisa saber para decidir.
10. Quando \`escopo\` é "pessoa", fale com essa pessoa pelo primeiro nome, uma vez só, no
    começo. Quando é "equipe", não trate ninguém por você.`;

export const pulsoDoDiaV1 = definirPrompt<EntradaDoPulso, SaidaDoPulso>({
  id: 'pulso-do-dia',
  versao: 1,
  modelo: MODELOS.sonnet,
  proposito: 'pulso_do_dia',
  entrada,
  saida,
  sistema,
  // O resumo de cada conversa nasceu do que o parceiro escreveu: é texto de fora, passa
  // pela pseudonimização e pela auditoria como qualquer mensagem.
  camposDeTexto: ['conversas', 'pulsoAnterior'],
  // Data, escopo, o nome de quem lê e os números que o Postgres apurou: tudo nosso.
  camposDoTriade: [
    'dia',
    'escopo',
    'paraQuem',
    'metricas',
    // Dentro de `conversas`, só o resumo e o compromisso nasceram do que o parceiro
    // escreveu; o resto o banco apurou.
    'conversas[].leadId',
    'conversas[].etapa',
    'conversas[].temperatura',
    'conversas[].scoreIntencao',
    'conversas[].diasSemContato',
    'conversas[].janelaFechaEmHoras',
    'conversas[].responsavel',
    'conversas[].alertas',
  ],
  escala: 'conversa',
  maxTokens: 1500,
  montarMensagem: (dados) =>
    [
      `dia: ${dados.dia}`,
      `escopo: ${dados.escopo}`,
      `para: ${dados.paraQuem ?? 'a equipe'}`,
      '',
      'NÚMEROS DO DIA (apurados pelo banco — use como estão):',
      `- conversas ativas: ${dados.metricas.conversasAtivas}`,
      `- mensagens recebidas: ${dados.metricas.mensagensRecebidas}`,
      `- mensagens enviadas: ${dados.metricas.mensagensEnviadas}`,
      `- sem resposta há 3 dias ou mais: ${dados.metricas.semRespostaHa3Dias}`,
      `- janelas de 24 h fechando: ${dados.metricas.janelasFechandoEm24h}`,
      `- compromissos vencidos: ${dados.metricas.compromissosVencidos}`,
      `- reuniões marcadas: ${dados.metricas.reunioesMarcadas}`,
      `- novos contatos: ${dados.metricas.novosContatos}`,
      '',
      `pulso de ontem: ${dados.pulsoAnterior ?? '— (não houve)'}`,
      '',
      'CONVERSAS, NA ORDEM QUE O BANCO PRIORIZOU:',
      dados.conversas.length === 0
        ? '— nenhuma'
        : dados.conversas
            .map((c) =>
              [
                `- ${c.leadId}`,
                `etapa ${c.etapa ?? '—'}`,
                `temperatura ${c.temperatura ?? '—'}`,
                `score ${c.scoreIntencao ?? '—'}`,
                `parado há ${c.diasSemContato} dia(s)`,
                c.janelaFechaEmHoras === null ? 'fora da janela' : `janela fecha em ${c.janelaFechaEmHoras} h`,
                `responsável ${c.responsavel ?? '—'}`,
                c.alertas.length > 0 ? `alertas: ${c.alertas.join(', ')}` : 'sem alerta',
                c.compromissoVencido === null ? 'sem compromisso vencido' : `vencido: ${c.compromissoVencido}`,
                `resumo: ${c.resumo ?? '—'}`,
              ].join(' | '),
            )
            .join('\n'),
    ].join('\n'),
  exemplos: [
    {
      nome: 'dia com proposta pedida e compromisso vencido',
      entrada: {
        dia: 'quarta, 17 de setembro de 2026',
        escopo: 'equipe',
        paraQuem: null,
        metricas: {
          conversasAtivas: 14,
          mensagensRecebidas: 31,
          mensagensEnviadas: 22,
          semRespostaHa3Dias: 4,
          janelasFechandoEm24h: 2,
          compromissosVencidos: 1,
          reunioesMarcadas: 2,
          novosContatos: 6,
        },
        conversas: [
          {
            leadId: 'lead-1',
            etapa: 'Em conversa',
            temperatura: 'quente',
            scoreIntencao: 85,
            diasSemContato: 0,
            janelaFechaEmHoras: 6,
            responsavel: 'Rafael',
            resumo: 'Buffet com casamento marcado, pediu proposta e ficou esperando desde ontem.',
            alertas: ['pediu_proposta'],
            compromissoVencido: 'Mandar a proposta com duas opções de cardápio',
          },
          {
            leadId: 'lead-2',
            etapa: 'Respondeu',
            temperatura: 'morno',
            scoreIntencao: 48,
            diasSemContato: 3,
            janelaFechaEmHoras: null,
            responsavel: 'Heloísa',
            resumo: 'Cerimonialista interessada, sumiu depois de perguntar quanto custa.',
            alertas: ['risco_perda'],
            compromissoVencido: null,
          },
        ],
        pulsoAnterior: 'Dia de abrir conversa: seis contatos novos e pouca resposta.',
      },
      saida: {
        titulo: 'Uma proposta está atrasada e a janela fecha hoje à noite',
        texto:
          'O dia teve movimento: 31 mensagens recebidas contra 22 enviadas, 14 conversas ativas e seis contatos novos. Duas reuniões ficaram marcadas.\n\nO que não pode passar de hoje é a proposta do lead-1. Ela foi pedida ontem, ninguém mandou, e a janela de resposta livre fecha em seis horas — depois disso só sai modelo aprovado. A cerimonialista do lead-2 está há três dias sem resposta desde que perguntou preço, que é onde a conversa costuma morrer.\n\nComo ontem, a captação abriu mais conversa do que fechou: quatro pessoas seguem sem resposta há três dias ou mais.',
        prioridades: [
          {
            leadId: 'lead-1',
            porque: 'Pediu proposta ontem, o compromisso venceu e a janela de 24 h fecha em 6 h.',
            acao: 'Mandar a proposta com as duas opções de cardápio ainda hoje.',
            urgencia: 'hoje',
          },
          {
            leadId: 'lead-2',
            porque: 'Sumiu três dias depois de perguntar preço.',
            acao: 'Retomar com o que a Komune cobra e oferecer os 20 minutos de apresentação.',
            urgencia: 'amanha',
          },
        ],
        riscos: [
          'A proposta do lead-1 vence com a janela: depois só dá para falar por modelo aprovado.',
          'Quatro conversas passam de três dias sem resposta.',
        ],
        diaSemMovimento: false,
      },
    },
    {
      nome: 'dia parado',
      entrada: {
        dia: 'segunda, 21 de setembro de 2026',
        escopo: 'pessoa',
        paraQuem: 'Heloísa',
        metricas: {
          conversasAtivas: 2,
          mensagensRecebidas: 1,
          mensagensEnviadas: 3,
          semRespostaHa3Dias: 2,
          janelasFechandoEm24h: 0,
          compromissosVencidos: 0,
          reunioesMarcadas: 0,
          novosContatos: 0,
        },
        conversas: [
          {
            leadId: 'lead-9',
            etapa: 'Contatado',
            temperatura: 'frio',
            scoreIntencao: 12,
            diasSemContato: 5,
            janelaFechaEmHoras: null,
            responsavel: 'Heloísa',
            resumo: 'Respondeu "depois eu vejo" e não voltou.',
            alertas: [],
            compromissoVencido: null,
          },
        ],
        pulsoAnterior: null,
      },
      saida: {
        titulo: 'Heloísa, segunda parada: uma resposta o dia inteiro',
        texto:
          'Duas conversas ativas, três mensagens enviadas e uma resposta. Nada venceu e nenhuma janela fecha. O lead-9 completou cinco dias desde o "depois eu vejo", que na prática é um não que ainda não foi dito.',
        prioridades: [],
        riscos: [],
        diaSemMovimento: true,
      },
    },
  ],
});
