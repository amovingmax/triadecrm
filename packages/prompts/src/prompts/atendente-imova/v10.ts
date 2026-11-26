/**
 * `atendente-imova@v10` (25/11/2026): a v9 com O AVISO DE DECISÃO.
 *
 * Pedido do dono: "ao invés de passar a CONVERSA para o CORRETOR, a IA poderia somente
 * perguntar para os admins e os admins escolheriam a opção que a IA deve responder" (o
 * caso da Paula: "Achei caro. O proprietário aceita 4 milhões?"). "A ideia é deixar a IA
 * conversando com os clientes e, quando necessário algum tipo de decisão que cabe aos
 * corretores, a IA pergunta, os corretores respondem a IA e a IA retorna uma resposta ao
 * cliente." E, sobre o protótipo: a IA não fala que vai levar a resposta à equipe; diz
 * algo como "Vou verificar", "Vou estudar esse caso", "Vou repassar ao diretor".
 *
 * O que muda em relação à v9:
 * - A saída ganha `decisao` ({ tipo, imovelCodigo, valorProposto, pergunta, sugestoes } |
 *   null): na proposta de valor e na pergunta que só a Imova responde (financiamento,
 *   FGTS, desconto, fato que não está escrito), a IA responde "vou verificar" com
 *   `acao = responder`, NÃO passa a conversa, e devolve a decisão. O worker a grava com
 *   `ia_atendente_pedir_decisao` (migração 20261125200000); os admins são avisados, um
 *   deles escolhe, e a resposta sai ao cliente como fala da IA.
 * - Um bloco diz quando pedir, como responder e o que continua indo para a equipe.
 *
 * Entrada, ferramenta, mensagem e exemplos são os da v9 (com `decisao: null`), mais dois:
 * a proposta e a pergunta. Voltar à v9 é trocar o número em `VIGENTES` e o import do
 * worker.
 *
 * O CADERNO: as notas 4 (b), 6 (b) e 8 (c) mandam passar a conversa na proposta, no
 * financiamento e no fato que não está escrito. O bloco diz que vale sobre elas, mas o
 * texto delas precisa mudar junto (só com a aprovação do dono), e o título das notas 9 e
 * 9b ("PROVISÓRIA: tirar quando a v10 estiver no ar") deve passar a dizer "v11", porque
 * esta versão também não leva as regras firmes para o prompt.
 */
import { z } from 'zod';

import { definirPrompt } from '../../nucleo/versionamento';
import { type BaseDoAtendenteV2, montarBaseV2 } from './v2';
import { trocarUmaVez } from './v4';
import { type EntradaDoAtendenteV6 } from './v6';
import { saidaDoAtendenteV9, atendenteImovaV9 as v9 } from './v9';

export const TIPOS_DE_DECISAO = ['proposta', 'pergunta'] as const;
export type TipoDeDecisao = (typeof TIPOS_DE_DECISAO)[number];

/** Até quantas respostas a IA sugere na pergunta. */
export const MAX_SUGESTOES = 3;

const sugestao = z.object({
  rotulo: z
    .string()
    .min(1)
    .max(60)
    .describe('O texto do botão que o admin vê, curto: "Sim, ajudamos com a documentação".'),
  resposta: z
    .string()
    .min(1)
    .max(300)
    .describe('A mensagem inteira que o cliente recebe se o admin escolher este botão.'),
});

const decisao = z
  .object({
    tipo: z
      .enum(TIPOS_DE_DECISAO)
      .describe('proposta, quando o cliente disse um valor; pergunta, no resto.'),
    imovelCodigo: z
      .string()
      .nullable()
      .describe('O código do imóvel de que falam, exatamente como está na lista, ou null.'),
    valorProposto: z
      .number()
      .int()
      .nullable()
      .describe('Na proposta, o valor que o cliente disse, em reais e sem centavos. Senão null.'),
    pergunta: z
      .string()
      .min(1)
      .max(200)
      .describe('As palavras do cliente, curtas, para o admin ler.'),
    sugestoes: z
      .array(sugestao)
      .max(MAX_SUGESTOES)
      .describe('Na pergunta, 2 respostas que a Imova poderia dar. Na proposta, [].'),
  })
  .nullable()
  .describe(
    'Só quando a resposta é da Imova (proposta de valor, desconto, financiamento, FGTS, forma de pagamento, fato que não está escrito): a decisão que vai aos admins. Senão null.',
  );

const saida = saidaDoAtendenteV9.extend({ decisao });
export type SaidaDoAtendenteV10 = z.infer<typeof saida>;
export type DecisaoDoAtendente = NonNullable<SaidaDoAtendenteV10['decisao']>;

const VISITA_NA_SAIDA =
  '- `visita`: { imovelCodigo, data, periodo, comoDisse } ou null (ver O PEDIDO DE VISITA).';
const VISITA_E_DECISAO_NA_SAIDA = `${VISITA_NA_SAIDA}
- \`decisao\`: { tipo, imovelCodigo, valorProposto, pergunta, sugestoes } ou null (ver O AVISO DE DECISÃO).`;

/** A frase segura quando a da IA fala em equipe ou corretor (decisão do dono, 25/11/2026). */
export const FRASE_DA_DECISAO: Readonly<Record<TipoDeDecisao, string>> = {
  proposta: 'Vou repassar sua proposta ao diretor e te retorno.',
  pergunta: 'Vou verificar e te retorno.',
};

export const BLOCO_DA_DECISAO = `O AVISO DE DECISÃO (acao = responder):
Algumas respostas não são suas, são da Imova. Nestes casos você NÃO passa a conversa:
responde que vai verificar e pede a decisão aos admins, que escolhem o que você vai dizer
ao cliente depois.
- O cliente faz uma proposta de valor ("aceita 4 milhões?", "faço 300 mil", "pago 450 à
  vista") ou pede desconto.
- Pergunta de financiamento, FGTS, entrada, parcelas, permuta ou outra forma de pagamento.
- Pergunta um fato do imóvel ou da Imova que não está escrito (documentação, quartos,
  condomínio, CRECI, garantias), quando você não pode responder com fato escrito.
Como responder: acao = "responder" e uma mensagem curta, sem prometer e sem adiantar a
resposta, como "Vou verificar e te retorno.", "Vou estudar esse caso e te retorno." ou, na
proposta, "Vou repassar sua proposta ao diretor e te retorno." Mude as palavras a cada
uso. Nunca diga que vai levar o caso à equipe: não escreva "equipe" nem "corretor" nessa
mensagem. Fora do horário de atendimento (8. A IMOVA E A DOCUMENTAÇÃO (b) e FERIADOS E
RECESSOS), a mensagem SEMPRE diz o dia em que você retorna: "Vou verificar e te retorno na
segunda, a partir das 8h." (o próximo dia útil; nunca "amanhã" se amanhã não for dia útil).
Preencha \`decisao\`:
- \`tipo\`: "proposta" quando o cliente disse um valor; "pergunta" no resto (o pedido de
  desconto sem valor também é pergunta).
- \`imovelCodigo\`: o código do imóvel de que falam, exatamente como está na lista, ou null.
- \`valorProposto\`: na proposta, o valor que ELE disse, em reais, sem centavos ("4
  milhões" = 4000000; "450 mil" = 450000). Na pergunta, null.
- \`pergunta\`: as palavras dele, curtas (até 200 caracteres).
- \`sugestoes\`: na pergunta, 2 respostas que a Imova poderia dar, diferentes entre si (uma
  que diz sim e outra que diz não, ou dois caminhos): \`rotulo\`, o botão que o admin vê
  (até 60 caracteres), e \`resposta\`, a mensagem inteira que o cliente recebe se o admin a
  escolher, com as regras das suas mensagens (até 300 caracteres, sem emoji, sem código,
  sem "corretor" e sem "equipe"). Elas são opções para os admins: podem dizer o que não está
  escrito, porque só saem se um admin escolher, mas nunca um número (valor, prazo, taxa,
  porcentagem) que o cliente ou a lista não disseram. Cada uma RESPONDE a pergunta: nunca
  uma que só adia ("vamos analisar e retornamos"), porque adiar é o que você já fez. Na
  proposta, [].
Continua passando a conversa (passar_para_corretor, com \`decisao\` = null): quando ele pede
para falar com uma pessoa, reclama ou quer fechar contrato, na visita presencial (O PEDIDO
DE VISITA) e no que o caderno manda passar por outro motivo. Se você já disse que ia
verificar e ele pergunta de novo sobre o mesmo assunto, diga que ainda está verificando, com
\`decisao\` = null; se ele mudar o valor da proposta, peça de novo, com o valor novo. Este
bloco vale sobre as notas do caderno que mandam passar a conversa por proposta, desconto,
financiamento, FGTS, entrada, parcelas ou fato que não está escrito. Em qualquer outra
resposta, \`decisao\` = null.`;

const sistema = `${trocarUmaVez(v9.sistema, VISITA_NA_SAIDA, VISITA_E_DECISAO_NA_SAIDA)}\n\n${BLOCO_DA_DECISAO}`;

/** O bloco de sistema de uma chamada da v10: as regras, mais a base da Imova (a da v2). */
export function sistemaComBaseV10(base: BaseDoAtendenteV2): string {
  return `${sistema}\n\n${montarBaseV2(base)}`;
}

const clienteDoExemplo = {
  nome: '[[NOME_1]]',
  temFicha: true,
  etapa: 'Respondeu',
  perfil: [],
  visitas: [],
  canalDeChegada: 'anuncios' as const,
  email: { naFicha: true, ofertas: null },
};

/** Os exemplos da v9 sem decisão, mais a proposta e a pergunta. */
const exemplos = [
  ...v9.exemplos.map((e) => ({
    nome: e.nome,
    entrada: e.entrada,
    saida: { ...e.saida, decisao: null },
  })),
  {
    nome: 'proposta de valor: "vou repassar", sem passar a conversa, e a decisão com o valor dele',
    entrada: {
      leadId: 'lead-26',
      agora: '2026-11-25T15:26',
      agoraPorExtenso: 'quarta-feira, 25 de novembro, às 15h26',
      treino: false,
      cliente: clienteDoExemplo,
      convitesDaAgenda: [],
      respostasNaUltimaHora: 1,
      mensagens: [
        {
          messageId: 'm1',
          de: 'cliente' as const,
          quem: null,
          quando: '25/11 15:20',
          texto: 'Qual o valor do terreno de Tabatinga?',
        },
        {
          messageId: 'm2',
          de: 'ia' as const,
          quem: null,
          quando: '25/11 15:21',
          texto:
            'É o terreno de 810 m² de frente para o mar, em Nísia Floresta. O valor de venda é R$ 520.000.',
        },
        {
          messageId: 'm3',
          de: 'cliente' as const,
          quem: null,
          quando: '25/11 15:25',
          texto: 'Achei caro. O proprietário aceita 450 mil?',
        },
      ],
    },
    saida: {
      acao: 'responder' as const,
      mensagem: 'Entendi. Vou repassar sua proposta ao diretor e te retorno.',
      agenda: null,
      motivo: 'Proposta de R$ 450.000 pelo terreno de Tabatinga: decisão dos admins.',
      anotacoes: [],
      fotosEnsinadas: [],
      confianca: 0.9,
      ofertasPorEmail: null,
      fotoParaConfirmar: null,
      visita: null,
      decisao: {
        tipo: 'proposta' as const,
        imovelCodigo: 'TE0004_IMOVA',
        valorProposto: 450000,
        pergunta: 'Achei caro. O proprietário aceita 450 mil?',
        sugestoes: [],
      },
    },
  },
  {
    nome: 'pergunta de financiamento: "vou verificar" e duas respostas para os admins escolherem',
    entrada: {
      leadId: 'lead-27',
      agora: '2026-11-25T15:24',
      agoraPorExtenso: 'quarta-feira, 25 de novembro, às 15h24',
      treino: false,
      cliente: clienteDoExemplo,
      convitesDaAgenda: [],
      respostasNaUltimaHora: 1,
      mensagens: [
        {
          messageId: 'm1',
          de: 'cliente' as const,
          quem: null,
          quando: '25/11 15:18',
          texto: 'Gostei do terreno de Pipa de 1.338 m². Quero comprar para construir.',
        },
        {
          messageId: 'm2',
          de: 'ia' as const,
          quem: null,
          quando: '25/11 15:19',
          texto: 'Que bom! É o terreno vizinho ao Parque Mata da Pipa, por R$ 334.500.',
        },
        {
          messageId: 'm3',
          de: 'cliente' as const,
          quem: null,
          quando: '25/11 15:23',
          texto: 'Vou usar FGTS e financiamento. Vocês ajudam com a documentação do banco?',
        },
      ],
    },
    saida: {
      acao: 'responder' as const,
      mensagem: 'Boa pergunta. Vou verificar e te retorno.',
      agenda: null,
      motivo:
        'Pergunta sobre ajuda com a documentação do financiamento e do FGTS: decisão dos admins.',
      anotacoes: [],
      fotosEnsinadas: [],
      confianca: 0.85,
      ofertasPorEmail: null,
      fotoParaConfirmar: null,
      visita: null,
      decisao: {
        tipo: 'pergunta' as const,
        imovelCodigo: 'TE0007',
        valorProposto: null,
        pergunta: 'Vou usar FGTS e financiamento. Vocês ajudam com a documentação do banco?',
        sugestoes: [
          {
            rotulo: 'Sim, ajudamos com a documentação',
            resposta:
              'Ajudamos sim com a documentação do financiamento e do FGTS, do começo ao fim. Quando quiser seguir, é só me dizer.',
          },
          {
            rotulo: 'Indicamos um correspondente bancário',
            resposta:
              'Para a documentação do banco, trabalhamos com um correspondente bancário, que cuida do financiamento e do FGTS com você. Quando quiser seguir, é só me dizer.',
          },
        ],
      },
    },
  },
];

export const atendenteImovaV10 = definirPrompt<EntradaDoAtendenteV6, SaidaDoAtendenteV10>({
  id: 'atendente-imova',
  versao: 10,
  modelo: v9.modelo,
  proposito: v9.proposito,
  entrada: v9.entrada,
  saida,
  sistema,
  ferramentas: v9.ferramentas,
  camposDeTexto: v9.camposDeTexto,
  camposDoTriade: v9.camposDoTriade,
  escala: v9.escala,
  maxTokens: v9.maxTokens,
  montarMensagem: v9.montarMensagem,
  exemplos,
});
