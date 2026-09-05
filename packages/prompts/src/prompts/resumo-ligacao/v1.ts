import { z } from 'zod';

import { MODELOS, definirPrompt } from '../../nucleo/versionamento';

/**
 * `resumo-ligacao@v1` — Claude Sonnet 5 (ADR-10; R13 §3.2 e §3.3).
 *
 * Resume a ligação a partir de três coisas que o Tríade já grava e ninguém junta:
 * o **caminho percorrido no roteiro** (`call_attempts.caminho_script` — os nós, na
 * ordem, com a fala de cada um), as **capturas** (`call_attempts.capturas`) e a
 * **anotação** de quem ligou. Nada de gravação: o áudio da chamada não entra aqui.
 *
 * O caminho é o insumo mais rico e o menos óbvio. Ele diz por onde a conversa passou e
 * onde ela virou — quem saiu por \`obj_comissao\` e terminou em \`fim_agora_nao\` teve
 * uma ligação diferente de quem foi direto de \`abertura\` a \`fim_reuniao\`, mesmo com o
 * mesmo desfecho tabulado. É isso que o resumo precisa contar em três linhas para quem
 * abrir a ficha daqui a duas semanas.
 *
 * O resumo NÃO decide etapa nem temperatura: isso é do catálogo `interaction_outcomes`,
 * que já resolve, e duas verdades sobre o mesmo negócio é uma a mais.
 */

const noPercorrido = z.object({
  /** Id do nó no roteiro (`abertura`, `obj_comissao`, `fim_reuniao`…). */
  id: z.string().min(1).max(64),
  /** A fala do nó, como está no roteiro. */
  texto: z.string().min(1).max(600),
  /** O botão que quem ligou tocou ali; null no nó final. */
  respostaEscolhida: z.string().max(120).nullable(),
});

const entrada = z.object({
  leadId: z.string().min(1).max(64),
  variante: z.enum(['fornecedor', 'produtor']),
  duracaoSeg: z.number().int().min(0).max(7200),
  /** O caminho, na ordem. Vazio quando ninguém atendeu — e aí não há resumo a fazer. */
  caminho: z.array(noPercorrido).min(1).max(40),
  /** Campos capturados nos nós de captura (`eventos_por_mes`, `decisor`…). */
  capturas: z.record(z.string(), z.string()),
  /** O que quem ligou digitou depois, em até 500 caracteres. */
  anotacao: z.string().max(500).nullable(),
  /** O slug do desfecho comercial tabulado (`lig_reuniao_marcada`…). */
  desfecho: z.string().min(1).max(64),
});

export type EntradaDoResumo = z.infer<typeof entrada>;

const saida = z.object({
  /** No máximo três frases. É o que aparece na ficha e no digest. */
  resumo: z.string(),
  /** O que ficou combinado, na boca do fornecedor. null quando nada ficou. */
  combinado: z.string().nullable(),
  /** Objeções que apareceram, como a pessoa as colocou. */
  objecoes: z.array(z.string()),
  /** Fatos do negócio que valem guardar (volume, sazonalidade, decisor). */
  fatos: z.array(z.string()),
  /** O nó em que a conversa virou — o que responde "em qual frase as pessoas desligam". */
  noDeVirada: z.string().nullable(),
  /** true quando o resumo depende de algo que só quem ligou sabe. */
  precisaDeRevisao: z.boolean(),
});

export type SaidaDoResumo = z.infer<typeof saida>;

const sistema = `Você resume ligações de prospecção que a Komune faz com fornecedores e produtores de
eventos em Natal/RN. Devolve JSON e nada mais.

Você recebe o CAMINHO percorrido no roteiro (os nós, na ordem, com a fala de cada um e o que a
pessoa respondeu), as CAPTURAS (campos anotados durante a ligação) e a ANOTAÇÃO de quem ligou.
Não existe gravação: o que não estiver nesses três lugares, não aconteceu para você.

REGRAS:
1. \`resumo\`: no máximo três frases, no máximo 320 caracteres, em português falado e direto.
   Diga o que a pessoa quer, o que ela objetou e o que ficou combinado — nessa ordem de importância.
   Escreva para quem vai abrir a ficha em duas semanas sem lembrar da ligação.
2. Só afirme o que está no caminho, nas capturas ou na anotação. Nunca complete o que faltou.
   Se a anotação contradiz o caminho, a anotação vale (quem ligou ouviu; o caminho é só por onde
   os dedos passaram) e \`precisaDeRevisao\` fica true.
3. \`combinado\`: a próxima coisa concreta, com dia e hora quando houver ("liga terça de manhã",
   "reunião quinta 9h30"). Sem nada concreto, null.
4. \`objecoes\`: uma entrada por objeção, do jeito que ela apareceu ("acha 8% muito", "já usa o
   Casamentos.com"). Sem objeção, lista vazia.
5. \`fatos\`: o que serve para a próxima conversa (volume de eventos, mês fraco, quem decide).
   Nada de opinião sua sobre a pessoa.
6. \`noDeVirada\`: o id do nó onde a conversa mudou de rumo — a objeção que apareceu, ou o nó em
   que a pessoa aceitou. Null quando a ligação foi direta do começo ao fim.
7. NUNCA escreva número, preço, percentual ou prazo que não esteja literalmente na entrada.
8. O texto pode conter marcadores [[NOME_1]], [[EMPRESA_1]], [[TELEFONE_1]]. Use-os como estão.
   Não invente o que estava neles.`;

export const resumoLigacaoV1 = definirPrompt<EntradaDoResumo, SaidaDoResumo>({
  id: 'resumo-ligacao',
  versao: 1,
  modelo: MODELOS.sonnet,
  proposito: 'summarize_call',
  entrada,
  saida,
  sistema,
  camposDeTexto: ['anotacao', 'capturas', 'caminho'],
  // `caminho` fica de fora da lista de propósito: a fala do nó é nossa, mas a resposta
  // escolhida e o que foi anotado ali carregam o que a pessoa disse. Na dúvida, de fora.
  camposDoTriade: ['leadId', 'variante', 'duracaoSeg', 'desfecho'],
  maxTokens: 700,
  montarMensagem: (dados) => {
    const caminho = dados.caminho
      .map(
        (no, indice) =>
          `${indice + 1}. [${no.id}] "${no.texto}"${
            no.respostaEscolhida === null ? '' : ` → respondeu: "${no.respostaEscolhida}"`
          }`,
      )
      .join('\n');
    const capturas = Object.entries(dados.capturas);
    return [
      `lead: ${dados.leadId}`,
      `variante do roteiro: ${dados.variante}`,
      `duração: ${dados.duracaoSeg}s`,
      `desfecho tabulado: ${dados.desfecho}`,
      '',
      'CAMINHO NO ROTEIRO:',
      caminho,
      '',
      'CAPTURAS:',
      capturas.length === 0
        ? '—'
        : capturas.map(([campo, valor]) => `- ${campo}: ${valor}`).join('\n'),
      '',
      'ANOTAÇÃO DE QUEM LIGOU:',
      dados.anotacao ?? '—',
    ].join('\n');
  },
  exemplos: [
    {
      nome: 'objeção de comissão e retorno combinado',
      entrada: {
        leadId: 'lead-1',
        variante: 'fornecedor',
        duracaoSeg: 214,
        caminho: [
          {
            id: 'abertura',
            texto:
              'Bom dia! Aqui é a [[NOME_2]], da Komune. Peguei o contato de vocês no Casamentos.com. Falo com quem cuida dos eventos do [[EMPRESA_1]]?',
            respostaEscolhida: 'Sou eu, pode falar',
          },
          {
            id: 'gancho_fornecedor',
            texto:
              'A Komune é um app de eventos daqui de Natal. Quantos eventos o [[EMPRESA_1]] faz por mês hoje?',
            respostaEscolhida: 'Ele respondeu quantos',
          },
          {
            id: 'obj_comissao',
            texto:
              'Entendo. Os 8% só existem sobre o evento que chegou pela Komune e fechou. O preço continua sendo o seu.',
            respostaEscolhida: 'Ficou de pensar',
          },
          {
            id: 'combinar_retorno',
            texto: 'Fechado. Então eu ligo [dia], por volta das [hora]. Já anotei aqui.',
            respostaEscolhida: 'Combinado',
          },
          {
            id: 'fim_retorna',
            texto: 'Perfeito, eu ligo [dia]. Obrigado, [nome]!',
            respostaEscolhida: null,
          },
        ],
        capturas: { eventos_por_mes: '6', retorno_combinado: 'terça de manhã' },
        anotacao: 'Achou 8% salgado, mas ouviu. Pediu pra ligar terça de manhã, antes das 10h.',
        desfecho: 'lig_atendeu_retorna',
      },
      saida: {
        resumo:
          'Atendeu e conversou. Faz 6 eventos por mês e achou os 8% salgados, mas ouviu o argumento de que a taxa só vale sobre o que fecha pela Komune. Pediu retorno na terça de manhã.',
        combinado: 'Ligar terça de manhã, antes das 10h.',
        objecoes: ['Achou os 8% salgados'],
        fatos: ['Faz 6 eventos por mês'],
        noDeVirada: 'obj_comissao',
        precisaDeRevisao: false,
      },
    },
    {
      nome: 'anotação contradiz o caminho',
      entrada: {
        leadId: 'lead-2',
        variante: 'produtor',
        duracaoSeg: 96,
        caminho: [
          {
            id: 'abertura',
            texto:
              'Boa tarde! Aqui é a [[NOME_2]], da Komune. Falo com quem cuida dos eventos do [[EMPRESA_1]]?',
            respostaEscolhida: 'Sou eu, pode falar',
          },
          {
            id: 'fim_interessado',
            texto: 'Ótimo. Vou te mandar por WhatsApp como funciona e a gente marca a conversa.',
            respostaEscolhida: null,
          },
        ],
        capturas: {},
        anotacao:
          'Na verdade quem atendeu foi a recepção. Disse que o dono só volta dia 20. Marquei errado.',
        desfecho: 'lig_interessado',
      },
      saida: {
        resumo:
          'Quem atendeu foi a recepção, não o decisor. Informou que o dono só volta no dia 20. O desfecho foi tabulado como interessado por engano.',
        combinado: 'Voltar a ligar depois do dia 20, procurando o dono.',
        objecoes: [],
        fatos: ['Quem decide só volta no dia 20'],
        noDeVirada: null,
        precisaDeRevisao: true,
      },
    },
  ],
});
