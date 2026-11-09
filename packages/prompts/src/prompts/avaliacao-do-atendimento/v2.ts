import * as z from 'zod';

import { definirPrompt } from '../../nucleo/versionamento';
import { type EntradaDaAvaliacao, avaliacaoDoAtendimentoV1, saidaDaAvaliacaoV1 } from './v1';

/**
 * `avaliacao-do-atendimento@v2` — a juíza que também diz ONDE a IA que atende falhou
 * (Imova, 09/11/2026).
 *
 * ===========================================================================
 * O QUE MUDOU DA v1, E SÓ ISSO
 * ===========================================================================
 * Um campo de saída a mais, `lacuna`: o principal ponto em que a IA que atende falhou
 * naquele dia, numa lista fechada. É o que o "relatório que vende" conta por tema ("a IA
 * não soube o condomínio em 7 conversas") para alguém ensinar a IA pelo caderno. As notas,
 * a régua, a entrada, a mensagem, o modelo e o propósito são os da v1; a porta de escrita
 * (`public.ia_juiza_gravar`) passa a ler `p_saida ->> 'lacuna'`, e a v1 continua no
 * catálogo — voltar é trocar o número em `VIGENTES`.
 *
 * A lacuna é estrutura, e por isso é estrita (enum): uma lacuna fora da lista é uma
 * avaliação errada, não uma frase comprida. Sem falha, ou sem dado para julgar, é
 * `nenhuma` — o relatório conta as lacunas que existem, como conta as notas que existem.
 */

/** Onde a IA que atende falhou no dia, a mais grave. `nenhuma` quando não falhou. */
export const LACUNAS_DO_ATENDIMENTO = [
  'nenhuma',
  'condominio_iptu',
  'financiamento',
  'fotos',
  'demorou_visita',
  'passou_sem_precisar',
  'nao_sabia_do_imovel',
  'tom',
  'outra',
] as const;

export type LacunaDoAtendimento = (typeof LACUNAS_DO_ATENDIMENTO)[number];

const saida = saidaDaAvaliacaoV1.extend({
  lacuna: z
    .enum(LACUNAS_DO_ATENDIMENTO)
    .describe('O principal ponto em que a IA falhou no dia, um só; nenhuma quando não falhou.'),
});

export type SaidaDaAvaliacaoV2 = z.infer<typeof saida>;

const ANTES_DOS_TEXTOS = '\nOS TEXTOS:\n';

const LACUNA = `
lacuna — o principal ponto em que a IA falhou nesse dia, um só:
- nenhuma: não falhou, ou a conversa não deixa julgar (dadosInsuficientes).
- condominio_iptu: o cliente perguntou o condomínio ou o IPTU e a IA não disse, ou disse
  algo que a conversa contradiz.
- financiamento: dúvida de financiamento, FGTS, entrada ou forma de pagamento mal
  respondida.
- fotos: o cliente pediu fotos ou vídeo e não recebeu.
- demorou_visita: o cliente queria ver o imóvel e a IA demorou a oferecer ou a marcar a
  visita.
- passou_sem_precisar: passou para um corretor o que ela mesma podia responder.
- nao_sabia_do_imovel: não soube um dado do imóvel (endereço, área, vaga, se está
  disponível, se aceita pet).
- tom: robótica, fria, insistente, comprida demais ou repetitiva.
- outra: falhou de outro jeito; diga qual no "melhorar".
- Falhou em mais de um ponto: escolha o que mais custou ao cliente. Com as notas que
  existem todas 4 ou 5, a lacuna quase sempre é nenhuma.
`;

if (!avaliacaoDoAtendimentoV1.sistema.includes(ANTES_DOS_TEXTOS)) {
  throw new Error(
    'avaliacao-do-atendimento@v2: a seção "OS TEXTOS" da v1 não está onde a v2 espera.',
  );
}

/** A lacuna de cada exemplo da v1, na ordem deles. */
const LACUNAS_DOS_EXEMPLOS_DA_V1: readonly LacunaDoAtendimento[] = [
  'nenhuma',
  'nao_sabia_do_imovel',
  'nenhuma',
  'nenhuma',
];

if (avaliacaoDoAtendimentoV1.exemplos.length !== LACUNAS_DOS_EXEMPLOS_DA_V1.length) {
  throw new Error('avaliacao-do-atendimento@v2: os exemplos da v1 mudaram; reveja as lacunas.');
}

export const avaliacaoDoAtendimentoV2 = definirPrompt<EntradaDaAvaliacao, SaidaDaAvaliacaoV2>({
  ...avaliacaoDoAtendimentoV1,
  versao: 2,
  saida,
  sistema: avaliacaoDoAtendimentoV1.sistema.replace(
    ANTES_DOS_TEXTOS,
    `${LACUNA}${ANTES_DOS_TEXTOS}`,
  ),
  exemplos: [
    ...avaliacaoDoAtendimentoV1.exemplos.map((exemplo, indice) => ({
      ...exemplo,
      saida: { ...exemplo.saida, lacuna: LACUNAS_DOS_EXEMPLOS_DA_V1[indice] ?? 'nenhuma' },
    })),
    {
      nome: 'passou para o corretor uma pergunta que ela mesma respondia',
      entrada: {
        leadId: 'lead-5',
        dia: '2026-11-05',
        respostas: 1,
        acoes: [{ acao: 'passou_para_pessoa', quando: '05/11 16:21' }],
        atitudeAntes: 'interessado',
        atitudeDepois: 'morno',
        mensagens: [
          {
            messageId: 'm1',
            de: 'cliente',
            quando: '05/11 16:20',
            texto: 'Boa tarde! O apartamento de Ponta Negra tem quantos quartos?',
          },
          {
            messageId: 'm2',
            de: 'ia',
            quando: '05/11 16:21',
            texto:
              'Boa tarde! Vou te passar para um dos nossos corretores, que te responde por aqui.',
          },
          {
            messageId: 'm3',
            de: 'cliente',
            quando: '05/11 18:40',
            texto: 'Ninguém respondeu ainda.',
          },
        ],
      },
      saida: {
        duvida: 2,
        informacao: null,
        satisfacao: 2,
        interesse: 'caiu',
        porque:
          'O cliente perguntou quantos quartos tem o apartamento; a IA passou para um corretor sem responder, e duas horas depois ele reclamou que ninguém respondeu.',
        melhorar:
          'Responder os dados do anúncio (quartos, área, valor) sem passar para o corretor.',
        dadosInsuficientes: false,
        lacuna: 'passou_sem_precisar',
      },
    },
  ],
});
