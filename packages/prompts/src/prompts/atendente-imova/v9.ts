/**
 * `atendente-imova@v9` (24/11/2026): a v8 com O PEDIDO DE VISITA.
 *
 * Pedido do dono: "A visita presencial não deve ser apresentada como link ou como algo
 * certo. Deve ser enviado uma solicitação se dá certo e deve aparecer um aviso para
 * todos os admins." Item 15 da entrevista de 24/11 ("IA combina, admin aprova, IA
 * confirma").
 *
 * O que muda em relação à v8:
 * - A saída ganha `visita` ({ imovelCodigo, data, periodo, comoDisse } | null): quando a
 *   IA passa a conversa por uma visita presencial e o cliente já disse o dia (nota 9 e
 *   do caderno), ela devolve o pedido. O worker o grava com `ia_atendente_pedir_visita`
 *   (migração 20261124190000); todos os admins são avisados e um deles decide.
 * - A linha da saída ganha o campo novo e um bloco curto diz quando preencher.
 *
 * A mensagem ao cliente não muda: é a da nota 9 (e) ("Vou consultar um horário em que
 * entre na minha agenda e te retorno pra combinarmos."). Entrada, ferramenta, mensagem e
 * exemplos são os da v8 (com `visita: null`), mais um do pedido. Voltar à v8 é trocar o
 * número em `VIGENTES` e o import do worker.
 *
 * O número: as notas 9 e 9b do caderno ("REGRAS FIRMES — PROVISÓRIA: tirar quando a v9
 * estiver no ar") falam das regras firmes, que esta versão NÃO leva para o prompt. Ao
 * publicar, o título das duas deve passar a dizer "v10".
 */
import { z } from 'zod';

import { definirPrompt } from '../../nucleo/versionamento';
import { type BaseDoAtendenteV2, montarBaseV2 } from './v2';
import { trocarUmaVez } from './v4';
import { type EntradaDoAtendenteV6 } from './v6';
import { saidaDoAtendenteV8, atendenteImovaV8 as v8 } from './v8';

export const PERIODOS_DA_VISITA = ['manha', 'tarde', 'noite'] as const;

const visita = z
  .object({
    imovelCodigo: z
      .string()
      .min(1)
      .describe('O código do imóvel da visita, exatamente como está na lista dos imóveis.'),
    data: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .nullable()
      .describe(
        'O dia da visita, AAAA-MM-DD, contado a partir de agora. Null se não souber contar.',
      ),
    periodo: z
      .enum(PERIODOS_DA_VISITA)
      .nullable()
      .describe('manha, tarde ou noite, como o cliente disse. Null se ele não disse.'),
    comoDisse: z
      .string()
      .max(80)
      .describe('As palavras do cliente sobre o dia, como "quinta de manhã".'),
  })
  .nullable()
  .describe(
    'Só quando acao = passar_para_corretor por uma visita presencial em que o cliente já disse o dia: o pedido que vai para a equipe aprovar. Senão null.',
  );

const saida = saidaDoAtendenteV8.extend({ visita });
export type SaidaDoAtendenteV9 = z.infer<typeof saida>;

const FOTO_NA_SAIDA =
  '- `fotoParaConfirmar`: { imovelCodigo, legenda } ou null (ver A FOTO PARA CONFIRMAR O IMÓVEL).';
const FOTO_E_VISITA_NA_SAIDA = `${FOTO_NA_SAIDA}
- \`visita\`: { imovelCodigo, data, periodo, comoDisse } ou null (ver O PEDIDO DE VISITA).`;

export const BLOCO_DA_VISITA = `O PEDIDO DE VISITA (acao = passar_para_corretor):
Quando você passar a conversa por uma visita presencial e o cliente já tiver dito o dia
(o caderno diz a mensagem), preencha \`visita\`: o código do imóvel, exatamente como está na
lista; \`data\`, o dia no formato AAAA-MM-DD contado a partir de agora ("quinta" é a próxima
quinta-feira, "amanhã" é o dia seguinte), ou null se não souber contar; \`periodo\`, "manha",
"tarde" ou "noite", ou null se ele não disse; e \`comoDisse\`, as palavras dele sobre o dia
("quinta de manhã"). O sistema manda o pedido para a equipe aprovar e responde o cliente
depois: na sua mensagem, nunca diga que a visita está marcada, confirmada ou agendada. Em
qualquer outra resposta, \`visita\` = null.`;

const sistema = `${trocarUmaVez(v8.sistema, FOTO_NA_SAIDA, FOTO_E_VISITA_NA_SAIDA)}\n\n${BLOCO_DA_VISITA}`;

/** O bloco de sistema de uma chamada da v9: as regras, mais a base da Imova (a da v2). */
export function sistemaComBaseV9(base: BaseDoAtendenteV2): string {
  return `${sistema}\n\n${montarBaseV2(base)}`;
}

/** Os exemplos da v8 sem pedido, mais o da visita com o dia dito. */
const exemplos = [
  ...v8.exemplos.map((e) => ({
    nome: e.nome,
    entrada: e.entrada,
    saida: { ...e.saida, visita: null },
  })),
  {
    nome: 'o cliente disse o dia da visita presencial: a frase do caderno, a passagem e o pedido',
    entrada: {
      leadId: 'lead-25',
      agora: '2026-11-24T10:15',
      agoraPorExtenso: 'terça-feira, 24 de novembro, às 10h15',
      treino: false,
      cliente: {
        nome: '[[NOME_1]]',
        temFicha: true,
        etapa: 'Respondeu',
        perfil: [],
        visitas: [],
        canalDeChegada: 'anuncios' as const,
        email: { naFicha: true, ofertas: null },
      },
      convitesDaAgenda: [],
      respostasNaUltimaHora: 1,
      mensagens: [
        {
          messageId: 'm1',
          de: 'cliente' as const,
          quem: null,
          quando: '24/11 10:05',
          texto: 'Quero ver o terreno de Tabatinga pessoalmente.',
        },
        {
          messageId: 'm2',
          de: 'ia' as const,
          quem: null,
          quando: '24/11 10:06',
          texto: 'Combinado. Qual dia e período ficam melhores para você?',
        },
        {
          messageId: 'm3',
          de: 'cliente' as const,
          quem: null,
          quando: '24/11 10:15',
          texto: 'Pode ser quinta de manhã.',
        },
      ],
    },
    saida: {
      acao: 'passar_para_corretor' as const,
      mensagem:
        'Perfeito! Vou consultar um horário em que entre na minha agenda e te retorno pra combinarmos.',
      agenda: null,
      motivo:
        'Visita presencial ao terreno de Tabatinga na quinta de manhã: pedido para a equipe aprovar.',
      anotacoes: [],
      fotosEnsinadas: [],
      confianca: 0.9,
      ofertasPorEmail: null,
      fotoParaConfirmar: null,
      visita: {
        imovelCodigo: 'TE0004_IMOVA',
        data: '2026-11-26',
        periodo: 'manha' as const,
        comoDisse: 'quinta de manhã',
      },
    },
  },
];

export const atendenteImovaV9 = definirPrompt<EntradaDoAtendenteV6, SaidaDoAtendenteV9>({
  id: 'atendente-imova',
  versao: 9,
  modelo: v8.modelo,
  proposito: v8.proposito,
  entrada: v8.entrada,
  saida,
  sistema,
  ferramentas: v8.ferramentas,
  camposDeTexto: v8.camposDeTexto,
  camposDoTriade: v8.camposDoTriade,
  escala: v8.escala,
  maxTokens: v8.maxTokens,
  montarMensagem: v8.montarMensagem,
  exemplos,
});
