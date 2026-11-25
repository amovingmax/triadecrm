/**
 * O ensaio da retomada contra o modelo (Imova, 25/11/2026): `workers ai --ensaio=retomada`.
 *
 * Dez conversas parecidas com as reais, com o texto de anúncios que estão no ar, passam
 * pelo `retomar-conversa@v2` de verdade (Haiku 5.5). Para cada uma, confere: retomou ou
 * não, como devia; o texto que sairia passa pela rede de segurança do worker
 * (`motivoParaNaoMandarV2`: sem pergunta, sem código, sem preço, sem emoji...). Nunca
 * manda mensagem: não chama nenhuma porta do banco que escreve na conversa. Grava só
 * `ai_runs`, sem conversa (como a bateria da atendente).
 */
import {
  type EntradaDaRetomadaV2,
  type SaidaDaRetomadaV2,
  motivoParaNaoMandarV2,
  reidratar,
  retomarConversaV2,
} from '@komune/prompts';

import { limparTexto, soOPrimeiroNome } from './atendente';
import { type ContextoDaIa, executar } from './execucao';
import { textoDoAnuncio } from './retomar';

interface AnuncioDoEnsaio {
  readonly codigo: string;
  readonly titulo: string;
  readonly tipo: string;
  readonly bairro: string;
  readonly descricao: string;
}

/** Trechos reais de anúncios no ar em 25/11/2026 (com preço, como estão: o worker tira). */
const ANUNCIOS: Record<string, AnuncioDoEnsaio> = {
  TE0004: {
    codigo: 'TE0004_IMOVA',
    titulo: 'Terreno Frente ao Mar com 810m² – Praia de Tabatinga | Escriturado',
    tipo: 'terreno',
    bairro: 'Praia de Tabatinga',
    descricao:
      'Terreno Frente Mar à Venda Praia de Tabatinga/RN. Oportunidade única no litoral sul do Rio Grande do Norte! Terreno frente para o mar, localizado na belíssima Praia de Tabatinga, uma das regiões mais valorizadas e desejadas do RN. Com 810 m², o imóvel é ideal para construção de casa de alto padrão, pousada ou investimento com grande potencial de valorização. Vista permanente para o mar, brisa constante e contato direto com a natureza. Documentação: Escriturado e pronto para venda. Área total: 810 m². Valor: R$ 520.000,00',
  },
  TE0001: {
    codigo: 'TE0001_IMOVA',
    titulo: 'Terreno à venda com 3.000 m² em Capim Macio - Natal/RN',
    tipo: 'terreno',
    bairro: 'Capim Macio',
    descricao:
      'Área à Venda em Capim Macio Localização Nobre e Alto Potencial Imobiliário. Excelente oportunidade em Capim Macio, um dos bairros mais valorizados de Natal, a apenas 3 minutos de Ponta Negra e a poucos metros da Av. Engenheiro Roberto Freire. O imóvel está localizado em frente à Ecopraça, onde atualmente funciona o Village Beach Tênis. A área oferece duas opções de metragem: 3.000 m² (03 lotes de 1.000 m²) e 5.000 m² (05 lotes de 1.000 m²). Ideal para incorporação imobiliária, especialmente para a construção de condomínio residencial vertical.',
  },
  PT0001: {
    codigo: 'PT0001_IMOVA',
    titulo: 'Repasse Loja de Plantas + Casa Anexa | R$ 120 mil | Aluguel R$ 5.500',
    tipo: 'casa',
    bairro: 'Ponta Negra',
    descricao:
      'Repasse de loja de plantas em pleno funcionamento, com estrutura completa, estoque e clientela ativa. Valor do repasse: R$ 120.000,00. Aluguel mensal: R$ 5.500,00. Loja com 350 m² e casa anexa com 200 m², incluída no valor do aluguel, podendo ser utilizada como moradia ou para ampliação do negócio. Localização na Av. Praia de Pirangi, Ponta Negra. Casa com 2 quartos (sendo 1 suíte), banheiro social, cozinha, sala ampla, área de serviço e dispensa.',
  },
  TE0007: {
    codigo: 'TE0007',
    titulo: 'Terreno à venda com 1.338 m² em Pipa - Tibau do Sul/RN - Ao lado do Parque Estadual',
    tipo: 'terreno',
    bairro: 'Pipa',
    descricao:
      'Vendo terreno de 1.338 m² no final da Rua da Gameleira, onde se localiza a Rua do Cordeiro, vizinho ao Parque Estadual Mata da Pipa. Área totalmente arborizada, em uma das regiões mais valiosas e charmosas da Pipa. Ideal para quem busca um local tranquilo, cercado pela natureza, perfeito para uma casa ou residência especial. Valor: R$ 334.500,00 (R$ 250,00 o m²)',
  },
};

type Mensagem = EntradaDaRetomadaV2['mensagens'][number];

interface CasoDaRetomada {
  readonly id: string;
  readonly descricao: string;
  readonly anuncio: keyof typeof ANUNCIOS | null;
  readonly disponivel?: boolean;
  readonly conversa: readonly [de: Mensagem['de'], texto: string][];
  readonly esperado: boolean;
}

const CASOS: readonly CasoDaRetomada[] = [
  {
    id: 'R01',
    descricao: 'terreno na praia; ele quer construir casa de praia',
    anuncio: 'TE0004',
    conversa: [
      ['cliente', 'Boa tarde! Vi o terreno de Tabatinga, quero construir uma casa de praia.'],
      [
        'ia',
        'Boa tarde! É o terreno frente ao mar em Tabatinga, com 810 m². Dá uma ótima casa de praia.',
      ],
    ],
    esperado: true,
  },
  {
    id: 'R02',
    descricao: 'perguntou o preço, recebeu, parou',
    anuncio: 'TE0001',
    conversa: [
      ['cliente', 'Olá, qual o valor do terreno de Capim Macio?'],
      ['ia', 'Olá! O terreno de Capim Macio tem 3.000 m² e está por R$ 4.500.000.'],
    ],
    esperado: true,
  },
  {
    id: 'R03',
    descricao: 'interesse no repasse da loja',
    anuncio: 'PT0001',
    conversa: [
      ['cliente', 'Tenho interesse no repasse da loja de plantas'],
      [
        'ia',
        'Que bom! É uma loja de plantas funcionando em Ponta Negra, com casa anexa. Posso te passar mais detalhes.',
      ],
    ],
    esperado: true,
  },
  {
    id: 'R04',
    descricao: 'disse que vai pensar',
    anuncio: 'TE0007',
    conversa: [
      ['cliente', 'Gostei do terreno de Pipa, vou pensar e te falo'],
      ['ia', 'Combinado! Qualquer dúvida, é só chamar.'],
    ],
    esperado: true,
  },
  {
    id: 'R05',
    descricao: 'escreveu o código do anúncio na conversa',
    anuncio: 'TE0004',
    conversa: [
      ['cliente', 'Vi o TE0004 no ZAP, ainda está à venda?'],
      ['ia', 'Está sim! É o terreno frente ao mar em Tabatinga, escriturado.'],
    ],
    esperado: true,
  },
  {
    id: 'R06',
    descricao: 'sem imóvel conhecido (procura aluguel que não temos)',
    anuncio: null,
    conversa: [
      ['cliente', 'Procuro apartamento de 2 quartos para alugar em Capim Macio'],
      ['ia', 'No momento a gente não tem. Vou anotar o que você procura e te aviso quando surgir.'],
    ],
    esperado: false,
  },
  {
    id: 'R07',
    descricao: 'imóvel saiu do ar',
    anuncio: 'TE0001',
    disponivel: false,
    conversa: [
      ['cliente', 'Esse terreno de Capim Macio ainda está disponível?'],
      ['ia', 'Vou verificar a situação dele e te retorno.'],
    ],
    esperado: false,
  },
  {
    id: 'R08',
    descricao: 'já comprou',
    anuncio: 'TE0007',
    conversa: [
      ['cliente', 'Obrigado, mas já comprei um terreno em outro lugar.'],
      ['ia', 'Que bom que encontrou! Se precisar de algo, estamos por aqui.'],
    ],
    esperado: false,
  },
  {
    id: 'R09',
    descricao: 'pergunta dele ficou para a equipe',
    anuncio: 'TE0004',
    conversa: [
      ['cliente', 'O proprietário aceita permuta por um apartamento?'],
      ['ia', 'Vou verificar isso e te retorno.'],
    ],
    esperado: false,
  },
  {
    id: 'R10',
    descricao: 'volta a falar mês que vem',
    anuncio: 'PT0001',
    conversa: [
      ['cliente', 'Só consigo ver isso mês que vem, quando eu receber. Te chamo.'],
      ['ia', 'Combinado! Quando quiser, é só chamar aqui.'],
    ],
    esperado: false,
  },
];

export interface RespostaDoEnsaioDaRetomada {
  readonly caso: string;
  readonly descricao: string;
  readonly esperado: boolean;
  readonly retomou: boolean | null;
  readonly texto: string;
  readonly motivoDaIa: string;
  readonly barradoPor: string | null;
  readonly certo: boolean;
  readonly erro?: string;
}

export interface ResultadoDoEnsaioDaRetomada {
  readonly promptVersion: string;
  readonly respostas: readonly RespostaDoEnsaioDaRetomada[];
  readonly custoUsd: number;
}

function entradaDoCaso(caso: CasoDaRetomada): EntradaDaRetomadaV2 {
  const anuncio = caso.anuncio === null ? null : ANUNCIOS[caso.anuncio]!;
  return {
    leadId: `ensaio-${caso.id.toLowerCase()}`,
    agora: '2026-11-26 10:10',
    agoraPorExtenso: 'quinta-feira, 26 de novembro, às 10h10',
    horasSemResposta: 21,
    cliente: { nome: 'Ana Souza' },
    imovel:
      anuncio === null
        ? null
        : {
            codigo: anuncio.codigo,
            descricao: `${anuncio.tipo} em ${anuncio.bairro}`,
            anuncio: textoDoAnuncio({ ...anuncio, caracteristicas: [] }),
            disponivel: caso.disponivel ?? true,
          },
    mensagens: caso.conversa.map(([de, texto], i) => ({
      messageId: `m${i + 1}`,
      de,
      quem: null,
      quando: `25/11 13:0${i}`,
      texto,
    })),
  };
}

/** Roda os casos `repeticoes` vezes; para no teto de gasto. */
export async function ensaiarRetomada(
  contexto: ContextoDaIa,
  opcoes: { repeticoes: number; tetoUsd: number },
): Promise<ResultadoDoEnsaioDaRetomada> {
  const respostas: RespostaDoEnsaioDaRetomada[] = [];
  let custo = 0;
  for (let rodada = 0; rodada < opcoes.repeticoes; rodada += 1) {
    for (const caso of CASOS) {
      if (custo >= opcoes.tetoUsd) break;
      const entrada = entradaDoCaso(caso);
      const contato = { leadId: entrada.leadId, nome: 'Ana Souza', empresa: null };
      try {
        const r = await executar<EntradaDaRetomadaV2, SaidaDaRetomadaV2>(
          contexto,
          retomarConversaV2,
          entrada,
          contato,
          {},
        );
        custo += r.custoUsd ?? 0;
        const texto = r.saida.retomar
          ? soOPrimeiroNome(limparTexto(reidratar(r.saida.mensagem, r.mapa)), 'Ana Souza')
          : '';
        const contextoDosNumeros = [
          ...entrada.mensagens.map((m) => m.texto),
          entrada.imovel?.codigo,
          entrada.imovel?.descricao,
          entrada.imovel?.anuncio,
        ];
        const barradoPor = r.saida.retomar
          ? motivoParaNaoMandarV2(texto, contextoDosNumeros)
          : null;
        respostas.push({
          caso: caso.id,
          descricao: caso.descricao,
          esperado: caso.esperado,
          retomou: r.saida.retomar,
          texto,
          motivoDaIa: limparTexto(reidratar(r.saida.motivo, r.mapa)),
          barradoPor,
          certo: r.saida.retomar === caso.esperado && barradoPor === null,
        });
      } catch (erro) {
        respostas.push({
          caso: caso.id,
          descricao: caso.descricao,
          esperado: caso.esperado,
          retomou: null,
          texto: '',
          motivoDaIa: '',
          barradoPor: null,
          certo: false,
          erro: erro instanceof Error ? erro.message : String(erro),
        });
      }
    }
  }
  return {
    promptVersion: `${retomarConversaV2.id}@v${retomarConversaV2.versao}`,
    respostas,
    custoUsd: Math.round(custo * 10_000) / 10_000,
  };
}

export function relatorioDaRetomada(r: ResultadoDoEnsaioDaRetomada): string {
  const certas = r.respostas.filter((x) => x.certo).length;
  const linhas = [
    `ENSAIO DA RETOMADA — ${r.promptVersion}: ${certas}/${r.respostas.length} certas, US$ ${r.custoUsd}`,
    '',
  ];
  for (const x of r.respostas) {
    const marca = x.certo ? 'ok ' : 'ERRO';
    const decisao = x.retomou === null ? 'falhou' : x.retomou ? 'retomou' : 'não retomou';
    linhas.push(
      `${marca} ${x.caso} (${x.descricao}) — esperado: ${x.esperado ? 'retomar' : 'não retomar'}; ${decisao}` +
        (x.barradoPor ? `; BARRADO: ${x.barradoPor}` : '') +
        (x.erro ? `; erro: ${x.erro}` : ''),
    );
    if (x.texto) linhas.push(`     texto (${x.texto.length} car.): ${x.texto}`);
    if (x.motivoDaIa) linhas.push(`     motivo: ${x.motivoDaIa}`);
  }
  return `${linhas.join('\n')}\n`;
}
