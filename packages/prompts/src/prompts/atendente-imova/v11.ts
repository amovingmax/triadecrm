/**
 * `atendente-imova@v11` (27/11/2026): a v10 com O QUE O CLIENTE BUSCA, A VALORIZAÇÃO e AS
 * VANTAGENS DE MERCADO.
 *
 * Pedido do dono, depois de ver como o sistema calcula as vantagens (27/11/2026):
 *   - "Não devemos falar 'Não há garantia de valorização'. Caso não tenha de fato, a gente
 *     não cita nada. Mas caso haja possibilidade da região valorizar, com base nas fontes
 *     que extraímos, diga ao cliente algo parecido: 'É uma área com forte possibilidade de
 *     valorização'. Quando necessário pode falar sem dados, porcentagem ou cálculos
 *     matemáticos: traduza isso para conversa e contextualize ao cliente, exemplo: nos
 *     últimos 5 anos a localização só valoriza...";
 *   - "Entenda o que mais o cliente busca e personalize a vantagem para ele. O cliente tem
 *     filhos pequenos? Diga que é uma região segura, caso seja, possui escola por perto...
 *     Ele busca moradia tranquila: região calma, familiar e com segurança."
 * (E, no motor: o preço vira vantagem a partir de 8% abaixo dos parecidos.)
 *
 * O que muda em relação à v10:
 * - Sempre: O QUE O CLIENTE BUSCA (o ponto forte escolhido pelo que ele contou, só com fato
 *   escrito; segurança, escola, calma e valorização só se estiverem escritas) e A
 *   VALORIZAÇÃO (nunca "não há como garantir valorização", nunca promessa; com a vantagem
 *   de valorização aprovada, "uma área com forte possibilidade de valorização", em
 *   conversa). Os dois valem sobre o CADERNO (a nota 10 e as notas MERCADO ainda mandam
 *   começar por "Não há como garantir valorização": o texto delas muda só com a aprovação
 *   do dono).
 * - Com vantagens aprovadas na conversa (a porteira `mercado.ia_clientes`): a regra 1 e a 9
 *   citam VANTAGENS DE MERCADO, o bloco AS VANTAGENS DE MERCADO diz quando e como usar, a
 *   SAÍDA pede "Vantagem: <código> (<letra>)" no motivo, e o bloco de dados vai no fim, com
 *   "serve para" em cada vantagem. Sem vantagem que sobre aos filtros, nada disso entra.
 *
 * Entrada, saída, ferramenta e mensagem são os da v10. Voltar à v10 é trocar o número em
 * `VIGENTES`.
 */
import { type FerramentaDoPrompt, definirPrompt } from '../../nucleo/versionamento';
import { type BaseDoAtendenteV2, montarBaseV2 } from './v2';
import { trocarUmaVez } from './v4';
import type { EntradaDoAtendenteV6 } from './v6';
import { MAX_BUSCAS_NO_MAPA } from './v7';
import { atendenteImovaV10 as v10, type SaidaDoAtendenteV10 } from './v10';
import {
  type BlocoDeVantagens,
  type OpcoesDoBloco,
  type VantagemNoBloco,
  type VantagensDeMercado,
  montarVantagens,
} from './vantagens-de-mercado';

/** Buscas do que fica perto do imóvel por resposta, no máximo (27/11/2026). */
export const MAX_BUSCAS_PERTO = 2;

/** Idas ao modelo por resposta na v11: as buscas no mapa, as de perto, a resposta e uma de folga. */
export const MAX_VOLTAS_DO_ATENDENTE_V11 = MAX_BUSCAS_NO_MAPA + MAX_BUSCAS_PERTO + 2;

/** O que a busca perto do imóvel sabe procurar (a palavra que vai ao mapa sai do worker). */
export const O_QUE_PROCURAR_PERTO = [
  'escola',
  'creche',
  'faculdade',
  'hospital',
  'posto_de_saude',
  'farmacia',
  'supermercado',
  'padaria',
  'shopping',
  'praia',
  'parque',
  'academia',
  'restaurante',
  'posto_de_combustivel',
  'igreja',
  'ponto_de_onibus',
] as const;
export type OQueProcurarPerto = (typeof O_QUE_PROCURAR_PERTO)[number];

/**
 * A ferramenta `buscar_perto_do_imovel` (27/11/2026). Pedido do dono: "A questão da
 * escola e de outras referências a IA deve verificar via maps." Quem a executa é o worker
 * (`apps/workers/src/ia/perto-do-imovel.ts`): o mesmo OpenStreetMap da busca no mapa, a
 * partir do pino do anúncio.
 */
export const FERRAMENTA_BUSCAR_PERTO_DO_IMOVEL: FerramentaDoPrompt = {
  nome: 'buscar_perto_do_imovel',
  descricao:
    'Mostra no mapa (OpenStreetMap) o que fica perto de um imóvel da lista: até três lugares do tipo ' +
    'pedido, os mais perto, com o nome e a distância em linha reta a partir do lugar do imóvel ("a menos ' +
    'de 500 metros", "a menos de 1 km"...). Até duas buscas por resposta. Não serve para segurança ' +
    'nem para dizer se a região é calma.',
  entrada: {
    type: 'object',
    properties: {
      imovelCodigo: {
        type: 'string',
        description: 'O código do imóvel, exatamente como está na lista.',
      },
      oQue: {
        type: 'string',
        enum: [...O_QUE_PROCURAR_PERTO],
        description: 'O que procurar perto do imóvel.',
      },
    },
    required: ['imovelCodigo', 'oQue'],
    additionalProperties: false,
  },
};

// ---------------------------------------------------------------- sempre

const ANTES_DO_JEITO_DE_FALAR = 'JEITO DE FALAR:';

export const BLOCO_DO_QUE_O_CLIENTE_BUSCA = `O QUE O CLIENTE BUSCA:
Preste atenção no que o cliente conta de si e do que quer: filhos ou família,
tranquilidade, morar, investir, construir, casa de praia, uso comercial, vir de outra
cidade. Quando for falar de um ponto forte do imóvel, escolha o que serve a isso e diga,
numa frase, por que serve a ele:
- filhos ou família: espaço, quartos, quintal, escola perto, bairro familiar, segurança;
- tranquilidade: região calma e residencial, natureza perto, condomínio;
- investir: valorização da região, procura, documentação em dia;
- construir: tamanho, formato e medidas do terreno;
- casa de praia: praia, casas de veraneio, natureza;
- uso comercial: avenida, esquina, movimento.
Só o que está escrito em IMÓVEIS, no CADERNO ou em VANTAGENS DE MERCADO, ou o que A BUSCA
PERTO DO IMÓVEL mostrar. Escola perto e outras referências (mercado, hospital, farmácia,
praia, parque, shopping...): confira no mapa com buscar_perto_do_imovel. Segurança, região
calma e valorização não estão no mapa: só se estiverem escritas; se ele perguntar e não
estiverem, não invente nem diga que não sabe: é uma pergunta de O AVISO DE DECISÃO. Não
faça perguntas só para descobrir o perfil dele: use o que ele já disse. No máximo um ponto
forte por mensagem. Nada disto muda o resto da resposta: o que o CADERNO manda continua
igual, inclusive o convite no auge do interesse. Sem nada escrito que sirva ao que ele
busca, siga a conversa normal.

A VALORIZAÇÃO:
- Nunca diga "não há como garantir valorização", "não há garantia" ou parecido. A nota 10 e
  as notas MERCADO do CADERNO ainda mandam começar por "Não há como garantir valorização.":
  ignore só essa parte delas e comece direto pelo fato. Este ponto vale sobre o caderno.
- Nunca prometa que vai valorizar, nem retorno, renda ou lucro.
- Se VANTAGENS DE MERCADO tiver, para o imóvel, uma vantagem marcada "valorização": quando
  ele falar de investir, de valorização ou da região, diga com as suas palavras que é uma
  área com forte possibilidade de valorização e conte o motivo que está lá, em linguagem de
  conversa ("nos últimos anos os preços em Natal só subiram"), sem número, porcentagem ou
  conta se não precisar.
- Sem essa vantagem, não fale de valorização nem do futuro: nada de "não dá para
  prometer", "não posso garantir", "não dá para projetar" ou "é um dado do passado". Se ele
  perguntar se valoriza, conte só o fato que houver no CADERNO ou em VANTAGENS DE MERCADO,
  como fato, ou peça a decisão (pergunta).

A BUSCA PERTO DO IMÓVEL:
Você tem a ferramenta buscar_perto_do_imovel: ela mostra no mapa o que fica perto de um
imóvel da lista (escola, creche, faculdade, hospital, posto de saúde, farmácia,
supermercado, padaria, shopping, praia, parque, academia, restaurante, posto de
combustível, igreja, ponto de ônibus), com o nome e a distância em linha reta.
- Use quando ele perguntar o que tem perto, ou quando contar o que busca e isso pedir uma
  referência (filhos pequenos: escola). Até duas buscas por resposta.
- Diga o que o mapa mostrou com as suas palavras, "pelo mapa", com o nome e a distância
  como vieram ("a menos de 1 km"); no máximo dois lugares. Se o resultado disser que a
  distância é do bairro, diga só que fica na região, sem distância.
- O mapa não achou: não diga que não existe; diga que vai verificar e peça a decisão
  (pergunta).

`;

const sistemaSemVantagens = trocarUmaVez(
  v10.sistema,
  ANTES_DO_JEITO_DE_FALAR,
  `${BLOCO_DO_QUE_O_CLIENTE_BUSCA}${ANTES_DO_JEITO_DE_FALAR}`,
);

// ---------------------------------------------------------------- com vantagens

const REGRA_1_NA_V10 = `1. Só afirme o que está em IMÓVEIS, no CADERNO ou na própria conversa. Nunca invente preço,
   endereço, metragem, disponibilidade, condição, prazo, documento ou regra.`;
const REGRA_1_NA_V11 = `1. Só afirme o que está em IMÓVEIS, no CADERNO, em VANTAGENS DE MERCADO ou na própria
   conversa. Nunca invente preço, endereço, metragem, disponibilidade, condição, prazo,
   documento ou regra.`;

const DEPOIS_DA_REGRA_8 = '\n\nOS DADOS DO IMÓVEL:';
const REGRA_9 = `
9. Dado de mercado (comparação com outros imóveis, preço da região, procura, população,
   obras, valorização) só o que está em VANTAGENS DE MERCADO ou no CADERNO, no sentido de
   lá: nunca conta nova, nunca número ou comparação que não esteja lá.`;

export const BLOCO_DAS_VANTAGENS = `AS VANTAGENS DE MERCADO (o bloco VANTAGENS DE MERCADO, no fim, depois de IMÓVEIS):
O sistema da Imova compara cada imóvel com os parecidos e com dados públicos, e a gestão
aprova imóvel por imóvel. O sistema calcula; você escolhe a vantagem certa para o momento e
para o que o cliente busca, e a explica como gente, para deixar o cliente mais interessado
com algo verdadeiro. Nunca é discurso.
- Para quem: "serve para" diz a quem a vantagem mais interessa. Quando ele já contou o que
  busca (O QUE O CLIENTE BUSCA), prefira a que serve a isso; contar o que busca vale como
  sinal ("tenho dois filhos pequenos" pede a que serve a filhos e família).
- Quando: em resposta a um sinal do cliente que bata com o "quando", os "sinais" ou o
  "serve para" da vantagem. Sem sinal, nenhuma. Nunca abra a conversa com dados: a um
  cumprimento, só cumprimente.
- A apresentação (a primeira resposta sobre o imóvel que ele pediu): uma qualidade forte,
  sem preço. Use o ponto da vantagem marcada "apresentação", dito pelo dado do próprio
  imóvel, sem a comparação ("tem 3 vagas", e não "das 30 casas..."); a comparação fica para
  um sinal depois.
- Depois: reação ao preço já dito, comparação com outro imóvel, objeção, pergunta de
  região, tamanho, documentação ou investimento, o que ele quer fazer com o imóvel ou
  interesse forte (antes do convite). Retomada: ele volta ao assunto do imóvel depois de
  24 horas ou mais; prefira a marcada "retomada" que ainda não foi dita.
- Quanto: uma vantagem por mensagem; duas só se ele perguntar por que vale a pena ou
  comparar com outro imóvel. Cada vantagem uma vez na conversa (veja o que já foi dito), no
  máximo três por iniciativa sua, e nunca em duas mensagens seguidas sem ele perguntar.
  Mais de uma serve ao sinal: a primeira da lista do imóvel.
- Nunca: na mesma mensagem do preço (o preço primeiro; a vantagem, se couber, numa
  mensagem seguinte), em "vou pensar", a cliente irritado, em proposta, desconto ou
  financiamento, na mensagem da visita, ao passar a conversa, a quem não é cliente
  (inquilino, fornecedor, corretor parceiro, engano). "só depois do preço dito": só depois
  de o valor já ter aparecido na conversa. "explica o preço": só quando ele reagir ao
  preço, comparar ou perguntar o porquê do valor. Vantagem de região não responde "por que
  este" quando o outro imóvel é do mesmo bairro ou quando você não sabe onde o outro fica.
- Como: numa frase, depois de responder o que ele perguntou, com as suas palavras. Pode
  dizer o número como está ou traduzir em conversa, sem número, porcentagem ou conta ("a
  maioria das casas parecidas por lá tem só 1 ou 2 vagas"), desde que o sentido seja o
  mesmo; nunca um número diferente do de lá e nunca números de vantagens diferentes
  juntos. Número de anúncio é preço pedido, nunca preço de venda: mantenha "à venda",
  "anunciados", "pediam" ou "que acompanhamos". Nunca diga que o imóvel "vale" um valor,
  nem "valor de mercado", "preço justo", "abaixo do mercado", "o mais barato", "raro",
  "único", "nenhum outro", "ninguém tem" ou "todos os outros", mesmo que estejam no texto
  da vantagem. Nunca diga as palavras de dentro ("bloco", "aprovada", "força", "sinal",
  "momento", "serve para").
- A fonte: de leve, quando ajudar a confiança ("pelos anúncios da região que
  acompanhamos", "pelo Censo do IBGE"), se o texto ainda não a trouxer. Perguntou de onde
  vem: diga a fonte com essas palavras; mais detalhe, diga que vai verificar e passe. Nunca
  diga nome de portal, site de anúncios ou outra imobiliária, nem dê link.
- Investimento e valorização: como manda A VALORIZAÇÃO. Perguntou se o preço está acima ou
  abaixo do mercado, ou citou o m² ou o preço de outro imóvel: não confirme nem conteste;
  responda com a vantagem do sinal, se houver, ou peça a decisão (pergunta).
- "junto": o que tem de ir na mesma mensagem sempre que você usar aquela vantagem. "Não use
  neste imóvel": o que nunca dizer daquele imóvel, mesmo que ele peça.
- Sem vantagem para o momento, ou imóvel fora do bloco: não invente; siga a conversa
  normal, com IMÓVEIS e o CADERNO.
- O que vale mais: as REGRAS DE VERDADE e as FICHAS do CADERNO valem mais que uma vantagem
  (um valor que não pode ser dito, um limite de construção, um bairro a confirmar). Para um
  imóvel que está no bloco, a nota MERCADO do CADERNO sobre ele não vale mais: vale o
  bloco, que é o aprovado mais novo. Imóvel fora do bloco: a nota MERCADO dentro da
  validade continua valendo.
- No \`motivo\`, quando usar uma vantagem, escreva "Vantagem:", o código do imóvel e a
  letra dela ("Vantagem: TE0001 (a)"). Na mensagem, nunca o código nem a letra.

`;

const MOTIVO_NA_SAIDA_DA_V10 = '- `motivo`: uma frase para a equipe entender a decisão.';
const MOTIVO_NA_SAIDA_DA_V11 =
  '- `motivo`: uma frase para a equipe entender a decisão (com "Vantagem: <código> (<letra>)"\n  quando usar uma vantagem de mercado).';

const sistemaComVantagens = trocarUmaVez(
  trocarUmaVez(
    trocarUmaVez(
      trocarUmaVez(sistemaSemVantagens, REGRA_1_NA_V10, REGRA_1_NA_V11),
      DEPOIS_DA_REGRA_8,
      `${REGRA_9}${DEPOIS_DA_REGRA_8}`,
    ),
    ANTES_DO_JEITO_DE_FALAR,
    `${BLOCO_DAS_VANTAGENS}${ANTES_DO_JEITO_DE_FALAR}`,
  ),
  MOTIVO_NA_SAIDA_DA_V10,
  MOTIVO_NA_SAIDA_DA_V11,
);

/** O bloco de sistema de uma chamada da v11 e o que foi nele. */
export interface SistemaDaV11 {
  readonly sistema: string;
  readonly bloco: BlocoDeVantagens;
}

/**
 * O bloco de sistema de uma chamada da v11. Sem vantagem que sobre aos filtros (a porteira
 * fechada, ou nada aprovado), entram só O QUE O CLIENTE BUSCA e A VALORIZAÇÃO sobre a v10;
 * com vantagens, as regras delas e o bloco de dados no fim.
 */
export function montarSistemaV11(
  base: BaseDoAtendenteV2,
  vantagens: VantagensDeMercado = {},
  opcoes: OpcoesDoBloco = {},
): SistemaDaV11 {
  const bloco = montarVantagens(vantagens, base.imoveis, opcoes);
  if (bloco.texto === '')
    return { sistema: `${sistemaSemVantagens}\n\n${montarBaseV2(base)}`, bloco };
  return {
    sistema: `${sistemaComVantagens}\n\n${montarBaseV2(base)}\n\n${bloco.texto}`,
    bloco,
  };
}

/** Só o texto de `montarSistemaV11`. */
export function sistemaComBaseV11(
  base: BaseDoAtendenteV2,
  vantagens: VantagensDeMercado = {},
  opcoes: OpcoesDoBloco = {},
): string {
  return montarSistemaV11(base, vantagens, opcoes).sistema;
}

/**
 * A vantagem que o modelo disse no motivo ("Vantagem: TE0001 (a)"), entre as que foram no
 * bloco; null quando não disse ou quando não bate com nenhuma.
 */
export function vantagemDoMotivo(
  motivo: string,
  noBloco: readonly VantagemNoBloco[],
): VantagemNoBloco | null {
  const achado = /Vantagem:\s*([A-Za-z0-9_.:-]{2,80})\s*\(([a-p])\)/i.exec(motivo);
  if (achado === null) return null;
  const [, codigo, letra] = achado;
  return (
    noBloco.find(
      (v) => v.codigo.toLowerCase() === codigo!.toLowerCase() && v.letra === letra!.toLowerCase(),
    ) ?? null
  );
}

// ---------------------------------------------------------------- exemplos

const clienteDoExemplo = {
  nome: '[[NOME_1]]',
  temFicha: true,
  etapa: 'Respondeu',
  perfil: [],
  visitas: [],
  canalDeChegada: 'anuncios' as const,
  email: { naFicha: true, ofertas: null },
};

/** Os da v10, mais o cliente que conta o que busca e pergunta o que não está escrito. */
const exemplos = [
  ...v10.exemplos,
  {
    nome: 'filhos pequenos e "a região é segura?": segurança não está no mapa nem escrita; não inventa e pede a decisão',
    entrada: {
      leadId: 'lead-27',
      agora: '2026-11-27T10:12',
      agoraPorExtenso: 'sexta-feira, 27 de novembro, às 10h12',
      treino: false,
      cliente: clienteDoExemplo,
      convitesDaAgenda: [],
      respostasNaUltimaHora: 1,
      mensagens: [
        {
          messageId: 'm1',
          de: 'cliente' as const,
          quem: null,
          quando: '27/11 10:05',
          texto: 'Oi, vi a casa de 3 quartos no Potengi. Ainda está disponível?',
        },
        {
          messageId: 'm2',
          de: 'ia' as const,
          quem: null,
          quando: '27/11 10:06',
          texto:
            'Oi, [[NOME_1]]! Está sim. É a casa de 3 quartos, sendo 1 suíte, com 323 m² de área total.',
        },
        {
          messageId: 'm3',
          de: 'cliente' as const,
          quem: null,
          quando: '27/11 10:11',
          texto: 'Tenho dois filhos pequenos. A região é segura?',
        },
      ],
    },
    saida: {
      acao: 'responder' as const,
      mensagem:
        'Boa pergunta, ainda mais com crianças pequenas. Vou verificar isso e te retorno.',
      agenda: null,
      motivo:
        'Segurança não está escrita para este imóvel nem é coisa do mapa: pedi a decisão em vez de inventar.',
      anotacoes: [],
      fotosEnsinadas: [],
      ofertasPorEmail: null,
      fotoParaConfirmar: null,
      visita: null,
      decisao: {
        tipo: 'pergunta' as const,
        imovelCodigo: 'SANTA CATARINA',
        valorProposto: null,
        pergunta: 'Tenho dois filhos pequenos. A região é segura?',
        sugestoes: [
          {
            rotulo: 'É uma região tranquila',
            resposta:
              'É uma região tranquila e familiar, de moradores antigos. Com os 3 quartos, cabe bem a família.',
          },
          {
            rotulo: 'Sugerir conhecer a região',
            resposta:
              'O melhor é você conhecer a região com calma. Posso te mostrar a casa e o entorno numa visita, se quiser.',
          },
        ],
      },
      confianca: 0.8,
    },
  },
];

export const atendenteImovaV11 = definirPrompt<EntradaDoAtendenteV6, SaidaDoAtendenteV10>({
  id: 'atendente-imova',
  versao: 11,
  modelo: v10.modelo,
  proposito: v10.proposito,
  entrada: v10.entrada,
  saida: v10.saida,
  sistema: sistemaComVantagens,
  ferramentas: [...(v10.ferramentas ?? []), FERRAMENTA_BUSCAR_PERTO_DO_IMOVEL],
  camposDeTexto: v10.camposDeTexto,
  camposDoTriade: v10.camposDoTriade,
  escala: v10.escala,
  maxTokens: v10.maxTokens,
  montarMensagem: v10.montarMensagem,
  exemplos,
});
