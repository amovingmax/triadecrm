import { z } from 'zod';

import { baseComoTexto } from '../../nucleo/base-conhecimento';
import { MODELOS, definirPrompt } from '../../nucleo/versionamento';

/**
 * `followup-ligacao@v1` — Claude Sonnet 5 (ADR-10; ADR-05; R13 §1; R08 §2.0 e §5.7).
 *
 * O WhatsApp depois da ligação. É o terceiro da fila porque é o que fecha o ciclo do
 * R13: liga, resume, escreve. E é o único dos quatro que produz texto que uma pessoa
 * vai ler — por isso é o único que passa pelo validador de promessas (RF-CON-24) e o
 * único que sempre volta como **rascunho**: a Heloísa aprova, o robô não envia (ADR-05).
 *
 * A entrada não é a ligação: é o resumo dela. O follow-up bom cita a conversa que
 * aconteceu ("como você falou, dezembro é o seu mês fraco"), e é isso que o separa de
 * mensagem genérica que ninguém responde.
 *
 * O prompt pede \`claims\`: os ids dos fatos da base que o texto usa. Não é enfeite — é o
 * que o validador confere. Rascunho que afirma algo sem claim correspondente não sai.
 */

const entrada = z.object({
  leadId: z.string().min(1).max(64),
  variante: z.enum(['fornecedor', 'produtor']),
  segmento: z.enum(['AEB', 'INF', 'PRE', 'ESP', 'CER', 'FOR', 'GEN']),
  /** O resumo produzido por `resumo-ligacao`. */
  resumoDaLigacao: z.string().min(1).max(600),
  combinado: z.string().max(240).nullable(),
  objecoes: z.array(z.string().max(160)).max(6),
  desfecho: z.string().min(1).max(64),
  /**
   * O gancho, quando a mensagem precisa de um (RF-CON-15). Vem preenchido pelo CRM, e o
   * modelo não pode inventar um: sem gancho, a mensagem é só a retomada do combinado.
   */
  gancho: z.string().max(240).nullable(),
});

export type EntradaDoFollowUp = z.infer<typeof entrada>;

const saida = z.object({
  /** O rascunho. Uma mensagem, no máximo três linhas. */
  mensagem: z.string(),
  /** Ids de fatos da base usados no texto. O validador confere um a um. */
  claims: z.array(z.string()),
  /** Áudio da biblioteca que combina com a mensagem, ou null. Nunca voz sintética. */
  audioSugerido: z.string().nullable(),
  /** Por que esta mensagem e não outra — uma linha, para quem vai aprovar. */
  porQue: z.string(),
});

export type SaidaDoFollowUp = z.infer<typeof saida>;

const sistema = `Você redige o rascunho da mensagem de WhatsApp que vai DEPOIS de uma ligação, em nome da
Heloísa, do comercial da Komune (app de eventos de Natal/RN). Devolve JSON e nada mais.

Uma pessoa vai ler seu rascunho e decidir se envia. Escreva para ela poder enviar sem editar.

${baseComoTexto()}

COMO A HELOÍSA ESCREVE:
- "a gente", "rapidinho", "me diz", "tranquilo". Nunca "prezado", "parceria estratégica",
  "oportunidade imperdível", "sem compromisso".
- Uma ideia por mensagem. Frases curtas. Verbo na frente quando pede algo.
- Concorda antes de reenquadrar ("entendo...", "que bom..."). Nunca "mas" logo depois do nome.
- Sem pressão: sempre deixa a saída fácil ("se não for o momento, me diz").

REGRAS DO TEXTO:
1. No máximo 3 linhas e 300 caracteres. No máximo 1 emoji, nunca na primeira linha, nunca em
   mensagem sobre taxa, contrato ou objeção.
2. Retome a ligação por algo concreto que está no resumo. Mensagem que serviria para qualquer
   fornecedor é mensagem errada.
3. Termine com UMA pergunta, e só uma. Pergunta de agenda tem dia e hora concretos, nunca
   "quando você puder".
4. Nada de caixa alta, nada de dois pontos de exclamação, nada de link que não seja komune.app.
5. \`claims\`: os ids dos fatos da base que o texto usa. Se o texto não afirma nada da base,
   lista vazia. Não invente id.
6. Se a ligação levantou dúvida de dinheiro que não está na base (prazo de repasse, nota fiscal,
   cancelamento, multa), a mensagem NÃO responde: diz que você confirma com o financeiro e volta hoje.
7. Sem gancho na entrada, não invente um. Sem gancho, a mensagem só retoma o que ficou combinado.
8. Marcadores [[NOME_1]], [[EMPRESA_1]] ficam onde estão — é assim que o nome real entra depois.
9. \`audioSugerido\`: o slug de um áudio da biblioteca que caiba aqui, ou null. Áudio é sempre
   gravado pela Heloísa; você só escolhe, nunca escreve roteiro de voz.`;

export const followupLigacaoV1 = definirPrompt<EntradaDoFollowUp, SaidaDoFollowUp>({
  id: 'followup-ligacao',
  versao: 1,
  modelo: MODELOS.sonnet,
  proposito: 'draft_followup',
  entrada,
  saida,
  sistema,
  camposDeTexto: ['resumoDaLigacao', 'combinado', 'objecoes', 'gancho'],
  // O resumo, o combinado, as objeções e o gancho descrevem o que a pessoa falou.
  camposDoTriade: ['leadId', 'variante', 'segmento', 'desfecho'],
  maxTokens: 500,
  montarMensagem: (dados) =>
    [
      `lead: ${dados.leadId}`,
      `variante: ${dados.variante} · segmento: ${dados.segmento}`,
      `desfecho da ligação: ${dados.desfecho}`,
      `combinado: ${dados.combinado ?? '—'}`,
      `objeções: ${dados.objecoes.length === 0 ? '—' : dados.objecoes.join('; ')}`,
      `gancho autorizado: ${dados.gancho ?? '—'}`,
      '',
      'RESUMO DA LIGAÇÃO:',
      dados.resumoDaLigacao,
    ].join('\n'),
  exemplos: [
    {
      nome: 'retomada depois de objeção de comissão',
      entrada: {
        leadId: 'lead-1',
        variante: 'fornecedor',
        segmento: 'AEB',
        resumoDaLigacao:
          'Atendeu e conversou. Faz 6 eventos por mês e achou os 8% salgados, mas ouviu. Pediu retorno na terça de manhã.',
        combinado: 'Ligar terça de manhã, antes das 10h.',
        objecoes: ['Achou os 8% salgados'],
        desfecho: 'lig_atendeu_retorna',
        gancho: null,
      },
      saida: {
        mensagem:
          'Oi, [[NOME_1]], foi bom falar com você agora há pouco.\nComo combinamos, te ligo terça de manhã, antes das 10h.\nSó pra adiantar: os 8% valem só sobre o evento que fechar pela Komune, e o preço continua sendo o seu. Terça às 9h30 está de pé?',
        claims: ['taxa', 'preco-e-do-fornecedor'],
        audioSugerido: 'aeb-taxa-8-porcento',
        porQue: 'Retoma o combinado e responde a única objeção que apareceu, sem repetir o pitch.',
      },
    },
    {
      nome: 'dúvida de repasse: não responde, escapa para o financeiro',
      entrada: {
        leadId: 'lead-2',
        variante: 'fornecedor',
        segmento: 'ESP',
        resumoDaLigacao:
          'Gostou da ideia, mas travou em quando o dinheiro cai depois do evento fechado. Quer isso por escrito antes de seguir.',
        combinado: null,
        objecoes: ['Quer saber o prazo de repasse antes de seguir'],
        desfecho: 'lig_atendeu_retorna',
        gancho: null,
      },
      saida: {
        mensagem:
          'Oi, [[NOME_1]], obrigada pela conversa.\nSobre quando o valor cai depois do evento, vou confirmar com o financeiro e te respondo hoje.\nPosso te ligar amanhã às 10h com a resposta na mão?',
        claims: [],
        audioSugerido: null,
        porQue:
          'A pergunta é de dinheiro e não está na base: a mensagem não responde e marca o retorno.',
      },
    },
  ],
});
