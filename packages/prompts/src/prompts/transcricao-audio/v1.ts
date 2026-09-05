import { z } from 'zod';

import { MODELOS, definirPrompt } from '../../nucleo/versionamento';

/**
 * `transcricao-audio@v1` — Claude Haiku 4.5 (ADR-10; RF-CON-27).
 *
 * O primeiro prompt da lista, e não por acaso: com o primeiro contato virando ligação
 * (R13), o fornecedor responde por áudio de qualquer jeito — inclusive quando a gente
 * escreve. Áudio que ninguém ouve é conversa que não anda.
 *
 * **Isto não transcreve.** Quem transcreve é o faster-whisper na máquina local (RF-CON-27):
 * áudio não sai da infraestrutura e não vira token. O que este prompt faz é limpar o que
 * o ASR devolveu — pontuação, hesitação, palavra partida ao meio, ruído marcado como
 * inaudível — e dizer se dá para confiar. Transcrição ruim que passa por boa vira
 * classificação errada e resposta errada, então a saída carrega \`confianca\` e
 * \`precisaDeHumano\`, e é a máquina de estados que decide o resto.
 *
 * Regra dura: limpar não é completar. Buraco de áudio vira \`[inaudível]\`, não vira
 * palpite — e não vira número. O modelo é proibido de inventar valor, data ou nome.
 */

const entrada = z.object({
  leadId: z.string().min(1).max(64),
  canal: z.enum(['whatsapp', 'ligacao']),
  duracaoSeg: z.number().int().min(1).max(600),
  /** O que o ASR devolveu, cru, com hesitação e tudo. */
  transcricaoBruta: z.string().min(1).max(12000),
  /** Confiança média do ASR, 0 a 1. Vem do faster-whisper. */
  confiancaAsr: z.number().min(0).max(1),
  /** Uma linha de contexto do negócio, para desambiguar termo do ramo. */
  contexto: z.string().max(400).nullable(),
});

export type EntradaDaTranscricao = z.infer<typeof entrada>;

const saida = z.object({
  /** A transcrição legível, com pontuação e sem hesitação. */
  textoLimpo: z.string(),
  /** Quantos trechos ficaram como `[inaudível]`. */
  trechosInaudiveis: z.number().int().min(0),
  confianca: z.enum(['alta', 'media', 'baixa']),
  /** true quando o áudio não dá para usar sozinho: alguém precisa ouvir. */
  precisaDeHumano: z.boolean(),
  /** Uma linha, para caber na timeline sem abrir o áudio. */
  resumo: z.string(),
  entidades: z.object({
    datas: z.array(z.string()),
    valores: z.array(z.string()),
    nomesCitados: z.array(z.string()),
    plataformas: z.array(z.string()),
  }),
});

export type SaidaDaTranscricao = z.infer<typeof saida>;

const sistema = `Você limpa transcrições automáticas de áudios que fornecedores de eventos de Natal/RN
mandam para a Komune. A transcrição já existe; você só a torna legível e avalia se dá para confiar nela.
Devolve JSON e nada mais.

O QUE FAZER:
1. Pontue e separe frases. Tire hesitação ("é...", "ãhn", "tipo assim"), repetição de gaguejo e
   marcador de fala vazio. Mantenha o jeito da pessoa falar: gíria, regionalismo e frase curta ficam.
2. Conserte palavra que o reconhecimento partiu ou grudou SÓ quando a palavra certa é óbvia pelo
   contexto ("bufê" → "buffet", "come nialista" → "cerimonialista").
3. Trecho que o áudio não permite entender vira exatamente [inaudível]. Conte quantos foram.
4. NUNCA complete o que não foi dito. Sem palpite de número, data, preço, nome ou intenção.
   Na dúvida entre duas leituras, use [inaudível] e baixe a confiança.
5. \`confianca\`: alta = dá para agir; media = dá para ler, mas confirme o que for decisivo;
   baixa = tem buraco no meio do que importa. Áudio com mais de dois [inaudível] em frase decisiva,
   ou com confiança do reconhecimento abaixo de 0,6, é sempre "baixa".
6. \`precisaDeHumano\` é true quando a confiança é baixa, quando o áudio parece ser de outra pessoa
   que não o fornecedor, ou quando o assunto é contrato, dinheiro ou reclamação.
7. \`resumo\`: uma frase, no máximo 140 caracteres, dizendo o que a pessoa quer.
8. \`entidades\`: copie literalmente do que foi dito. Vazio quando não houve.
9. O texto pode conter marcadores [[NOME_1]], [[EMPRESA_1]], [[TELEFONE_1]]. Mantenha-os intactos,
   na mesma posição. Não tente descobrir o que estava ali.`;

export const transcricaoAudioV1 = definirPrompt<EntradaDaTranscricao, SaidaDaTranscricao>({
  id: 'transcricao-audio',
  versao: 1,
  modelo: MODELOS.haiku,
  proposito: 'transcribe_audio',
  entrada,
  saida,
  sistema,
  camposDeTexto: ['transcricaoBruta', 'contexto'],
  // O ASR e o contexto vêm de fora; o resto é o que o CRM já sabia do caso.
  camposDoTriade: ['leadId', 'canal', 'duracaoSeg', 'confiancaAsr'],
  maxTokens: 1200,
  montarMensagem: (dados) =>
    [
      `lead: ${dados.leadId}`,
      `canal: ${dados.canal}`,
      `duração: ${dados.duracaoSeg}s`,
      `confiança do reconhecimento: ${dados.confiancaAsr.toFixed(2)}`,
      `contexto: ${dados.contexto ?? '—'}`,
      '',
      'TRANSCRIÇÃO BRUTA:',
      dados.transcricaoBruta,
    ].join('\n'),
  exemplos: [
    {
      nome: 'áudio limpo, fornecedor interessado',
      entrada: {
        leadId: 'lead-1',
        canal: 'whatsapp',
        duracaoSeg: 22,
        transcricaoBruta:
          'oi é... bom dia é a [[NOME_1]] né então tipo assim eu vi aqui ó eu tenho interesse sim viu manda pra mim como que funciona aí a gente vê',
        confiancaAsr: 0.92,
        contexto: 'Buffet, primeira ligação atendida ontem.',
      },
      saida: {
        textoLimpo:
          'Oi, bom dia, é a [[NOME_1]]. Eu vi aqui, tenho interesse sim. Manda pra mim como que funciona, aí a gente vê.',
        trechosInaudiveis: 0,
        confianca: 'alta',
        precisaDeHumano: false,
        resumo: 'Tem interesse e pediu para receber como funciona.',
        entidades: { datas: [], valores: [], nomesCitados: [], plataformas: [] },
      },
    },
    {
      nome: 'áudio ruidoso, número no meio do buraco',
      entrada: {
        leadId: 'lead-2',
        canal: 'whatsapp',
        duracaoSeg: 31,
        transcricaoBruta:
          'ó eu faço uns [ruído] eventos por mês mas a taxa de vocês é [ruído] por cento né que aí fica [ruído] pra mim',
        confiancaAsr: 0.48,
        contexto: null,
      },
      saida: {
        textoLimpo:
          'Ó, eu faço uns [inaudível] eventos por mês, mas a taxa de vocês é [inaudível] por cento, né? Que aí fica [inaudível] pra mim.',
        trechosInaudiveis: 3,
        confianca: 'baixa',
        precisaDeHumano: true,
        resumo: 'Falou de volume de eventos e da taxa, mas os números não deu para entender.',
        entidades: { datas: [], valores: [], nomesCitados: [], plataformas: [] },
      },
    },
    {
      nome: 'áudio com assunto contratual',
      entrada: {
        leadId: 'lead-3',
        canal: 'whatsapp',
        duracaoSeg: 40,
        transcricaoBruta:
          'olha eu queria entender o contrato antes tá porque eu já me queimei com o [[EMPRESA_1]] então quando é que cai o dinheiro depois que fecha',
        confiancaAsr: 0.9,
        contexto: 'Espaço para eventos, veio de indicação.',
      },
      saida: {
        textoLimpo:
          'Olha, eu queria entender o contrato antes, tá? Porque eu já me queimei com o [[EMPRESA_1]]. Então, quando é que cai o dinheiro depois que fecha?',
        trechosInaudiveis: 0,
        confianca: 'alta',
        precisaDeHumano: true,
        resumo: 'Quer ver o contrato e saber o prazo de repasse antes de seguir.',
        entidades: {
          datas: [],
          valores: [],
          nomesCitados: [],
          plataformas: ['[[EMPRESA_1]]'],
        },
      },
    },
  ],
});
