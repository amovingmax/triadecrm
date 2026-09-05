import { z } from 'zod';

import { MODELOS, definirPrompt } from '../../nucleo/versionamento';
import { type SaidaDoClassificador } from './decisao';
import { INTENCOES, taxonomiaComoTexto } from './intencoes';

/**
 * `classificar-intencao@v1` — Claude Haiku 4.5, saída estruturada (ADR-10; RF-CON-19).
 *
 * Classifica uma mensagem recebida em uma das 25 intenções, com confiança, entidades e
 * sentimento. **Só isso.** Não redige, não decide etapa e não decide se escala: quem faz
 * isso é `decidirIntencao`, que é código determinístico e testável. O modelo aqui é o
 * olho; a decisão é da regra.
 *
 * Duas instruções carregam quase todo o valor deste prompt:
 * - devolver confiança honesta, porque abaixo de 0,7 a regra pergunta em vez de chutar;
 * - devolver `segundaIntencao` quando a mensagem mistura dois assuntos, porque é assim
 *   que "quanto custa? me chama sexta" vira resposta de taxa *mais* retorno agendado.
 */

const entrada = z.object({
  leadId: z.string().min(1).max(64),
  canal: z.enum(['whatsapp', 'instagram', 'ligacao']),
  mensagem: z.string().min(1).max(4000),
  /** Resumo rolante da conversa, ≤ 800 tokens (RF-CON-25). Nunca a conversa inteira. */
  resumoDaConversa: z.string().max(2800).nullable(),
  ultimaIntencao: z.enum(INTENCOES).nullable(),
  jaRecebeuAudio: z.boolean(),
});

export type EntradaDaClassificacao = z.infer<typeof entrada>;

const saida: z.ZodType<SaidaDoClassificador> = z.object({
  intencao: z.enum(INTENCOES),
  confianca: z.number().min(0).max(1),
  segundaIntencao: z.enum(INTENCOES).nullable(),
  sentimento: z.enum(['positivo', 'neutro', 'negativo']),
  entidades: z.object({
    dataHora: z.string().nullable(),
    nomeCitado: z.string().nullable(),
    plataformaCitada: z.string().nullable(),
    motivo: z.string().nullable(),
  }),
});

const sistema = `Você classifica mensagens que fornecedores de eventos de Natal/RN mandam para a Komune.
Devolve JSON e nada mais. Não escreve resposta para o fornecedor, não sugere texto, não opina.

AS 25 INTENÇÕES (use exatamente estes nomes):
${taxonomiaComoTexto()}

REGRAS:
1. Escolha a intenção que descreve o que a pessoa QUER, não o assunto que ela citou.
2. \`confianca\` é honesta, de 0 a 1. Se a mensagem cabe em duas intenções e você não
   consegue separar, use confiança baixa em vez de escolher a mais provável: abaixo de
   0,7 o sistema faz uma pergunta curta, que é melhor que uma resposta errada.
3. Mensagem com dois assuntos: a intenção principal é a que mais move a conversa;
   a outra vai em \`segundaIntencao\`. Um assunto só → \`segundaIntencao\` é null.
4. \`entidades\`: \`dataHora\` no formato que a pessoa disse ("sexta de manhã", "dia 12 às 15h"),
   \`nomeCitado\` quando ela indica outra pessoa, \`plataformaCitada\` quando cita concorrente
   ou rede social, \`motivo\` quando ela diz por que recusa. Sem o dado, null.
5. O texto pode conter marcadores como [[NOME_1]], [[EMPRESA_1]], [[TELEFONE_1]]. São
   dados removidos por privacidade. Trate como o valor que representam e NUNCA tente
   adivinhar o que estava ali.
6. Não invente intenção fora da lista. Não devolva explicação, comentário ou markdown.`;

export const classificarIntencaoV1 = definirPrompt<EntradaDaClassificacao, SaidaDoClassificador>({
  id: 'classificar-intencao',
  versao: 1,
  modelo: MODELOS.haiku,
  proposito: 'classify_inbound',
  entrada,
  saida,
  sistema,
  camposDeTexto: ['mensagem', 'resumoDaConversa'],
  // `mensagem` e `resumoDaConversa` são o que o lead escreveu (o resumo é rolante, feito
  // em cima das mensagens dele). Tudo o mais é etiqueta nossa.
  camposDoTriade: ['leadId', 'canal', 'ultimaIntencao', 'jaRecebeuAudio'],
  maxTokens: 400,
  montarMensagem: (dados) =>
    [
      `lead: ${dados.leadId}`,
      `canal: ${dados.canal}`,
      `já recebeu áudio: ${dados.jaRecebeuAudio ? 'sim' : 'não'}`,
      `intenção anterior: ${dados.ultimaIntencao ?? '—'}`,
      `resumo da conversa: ${dados.resumoDaConversa ?? '—'}`,
      '',
      'MENSAGEM RECEBIDA:',
      dados.mensagem,
    ].join('\n'),
  exemplos: [
    {
      nome: 'taxa e retorno na mesma mensagem',
      entrada: {
        leadId: 'lead-1',
        canal: 'whatsapp',
        mensagem: 'quanto é a taxa? ah, e me chama sexta que eu tô em evento hoje',
        resumoDaConversa: null,
        ultimaIntencao: null,
        jaRecebeuAudio: false,
      },
      saida: {
        intencao: 'PEDIU_TAXA_PRECO',
        confianca: 0.88,
        segundaIntencao: 'ME_CHAMA_DEPOIS',
        sentimento: 'neutro',
        entidades: { dataHora: 'sexta', nomeCitado: null, plataformaCitada: null, motivo: null },
      },
    },
    {
      nome: 'só emoji, sem sinal',
      entrada: {
        leadId: 'lead-2',
        canal: 'whatsapp',
        mensagem: '👍',
        resumoDaConversa: 'Recebeu a abertura ontem, não respondeu.',
        ultimaIntencao: null,
        jaRecebeuAudio: false,
      },
      saida: {
        intencao: 'AMBIGUO',
        confianca: 0.55,
        segundaIntencao: null,
        sentimento: 'neutro',
        entidades: { dataHora: null, nomeCitado: null, plataformaCitada: null, motivo: null },
      },
    },
    {
      nome: 'indicação de outra pessoa',
      entrada: {
        leadId: 'lead-3',
        canal: 'whatsapp',
        mensagem: 'não sou eu que cuido disso, fala com a Ana que é a sócia',
        resumoDaConversa: null,
        ultimaIntencao: null,
        jaRecebeuAudio: false,
      },
      saida: {
        intencao: 'NAO_E_A_PESSOA',
        confianca: 0.91,
        segundaIntencao: 'INDICACAO',
        sentimento: 'neutro',
        entidades: { dataHora: null, nomeCitado: 'Ana', plataformaCitada: null, motivo: null },
      },
    },
  ],
});
