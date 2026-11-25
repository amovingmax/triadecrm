/**
 * O ensaio do resumo da passagem contra o modelo (Imova, 25/11/2026):
 * `workers ai --ensaio=resumo`.
 *
 * Cinco passagens parecidas com as reais (pedido de visita, negociação de preço, "quero
 * falar com uma pessoa", procura que a Imova não tem, financiamento com FGTS) passam pelo
 * `resumo-da-passagem@v1` de verdade (Haiku 5.5) e pela mesma conferência do worker
 * (`conferirResumoDaPassagem`: o que o cliente não disse com as palavras dele sai). Para
 * cada uma, confere o que importa ao caso. Não grava resumo nem toca conversa: grava só
 * `ai_runs`, sem conversa (como a bateria da atendente).
 */
import {
  type EntradaDoResumoDaPassagem,
  type SaidaDoResumoDaPassagem,
  conferirResumoDaPassagem,
  resumoDaPassagemV1,
} from '@komune/prompts';

import { type ContextoDaIa, executar } from './execucao';

type Mensagem = EntradaDoResumoDaPassagem['mensagens'][number];
type Saida = SaidaDoResumoDaPassagem;

interface CasoDoResumo {
  readonly id: string;
  readonly descricao: string;
  readonly motivo: string;
  readonly imoveis: EntradaDoResumoDaPassagem['imoveisCitados'];
  readonly conversa: readonly [de: Mensagem['de'], texto: string][];
  /** O que tem de valer no resumo conferido; devolve a falha, ou null. */
  readonly conferir: (s: Saida) => string | null;
}

const TE0004 = {
  codigo: 'TE0004_IMOVA',
  palavras: ['terreno', 'Praia de Tabatinga', 'frente ao mar', '810 m²', 'escriturado'],
};
const TE0001 = { codigo: 'TE0001_IMOVA', palavras: ['terreno', 'Capim Macio', '3.000 m²'] };
const TE0007 = { codigo: 'TE0007', palavras: ['terreno', 'Pipa', '1.338 m²', 'Parque Estadual'] };

const CASOS: readonly CasoDoResumo[] = [
  {
    id: 'S01',
    descricao: 'pediu visita presencial na quinta de manhã',
    motivo: 'visita presencial pedida (quinta, manhã)',
    imoveis: [TE0004],
    conversa: [
      ['cliente', 'Boa tarde! Vi o TE0004 no ZAP, quero construir uma casa de praia.'],
      ['ia', 'Boa tarde! É o terreno frente ao mar em Tabatinga, com 810 m², escriturado.'],
      ['cliente', 'Quero ver pessoalmente. Pode ser quinta de manhã?'],
      ['ia', 'Vou consultar um horário em que entre na minha agenda e te retorno pra combinarmos.'],
    ],
    conferir: (s) =>
      s.temperatura !== 'quente'
        ? `temperatura ${s.temperatura ?? 'nula'} (esperado quente)`
        : !/visita/i.test(s.porquePassou)
          ? 'o porquê da passagem não fala da visita'
          : null,
  },
  {
    id: 'S02',
    descricao: 'quer negociar o preço',
    motivo: 'cliente quer negociar valor',
    imoveis: [TE0001],
    conversa: [
      ['cliente', 'Olá, qual o valor do TE0001?'],
      ['ia', 'Olá! O terreno de Capim Macio tem 3.000 m² e está por R$ 4.500.000.'],
      ['cliente', 'Achei caro. O proprietário aceita 4 milhões?'],
      ['ia', 'Vou verificar com a equipe e te retorno.'],
    ],
    conferir: (s) =>
      s.objecao?.tipo !== 'preco'
        ? `objeção ${s.objecao?.tipo ?? 'vazia'} (esperado preço)`
        : /desconto|aceita|fechad/i.test(s.proximoPasso) && !/propriet/i.test(s.proximoPasso)
          ? 'o próximo passo promete condição sem levar ao proprietário'
          : null,
  },
  {
    id: 'S03',
    descricao: 'só pediu para falar com uma pessoa',
    motivo: 'cliente pediu atendimento humano',
    imoveis: [],
    conversa: [
      ['cliente', 'Oi'],
      ['ia', 'Olá! Aqui é da Imova. Como posso te ajudar?'],
      ['cliente', 'Quero falar com uma pessoa'],
      ['ia', 'Claro, vou passar para alguém da equipe.'],
    ],
    conferir: (s) =>
      !s.dadosInsuficientes
        ? 'dadosInsuficientes deveria ser true'
        : s.temperatura !== null
          ? `temperatura ${s.temperatura} (esperado nula)`
          : null,
  },
  {
    id: 'S04',
    descricao: 'procura aluguel que a Imova não tem',
    motivo: 'sem imóvel compatível; cliente quer falar com a equipe',
    imoveis: [],
    conversa: [
      ['cliente', 'Procuro apartamento de 2 quartos para alugar em Capim Macio, até 2.500 por mês'],
      [
        'ia',
        'No momento a gente não tem apartamento de 2 quartos para alugar em Capim Macio. Vou anotar e te aviso.',
      ],
      ['cliente', 'Tem alguém que possa me ajudar a procurar?'],
      ['ia', 'Vou passar para alguém da equipe.'],
    ],
    conferir: (s) =>
      s.procura.negocio?.valor !== 'locacao'
        ? `negócio ${s.procura.negocio?.valor ?? 'vazio'} (esperado locação)`
        : !/capim macio/i.test(s.procura.regiao?.valor ?? '')
          ? 'a região não trouxe Capim Macio'
          : !/2[.,]?500/.test(s.orcamento.valor?.valor ?? '')
            ? 'o orçamento não trouxe os 2.500'
            : null,
  },
  {
    id: 'S05',
    descricao: 'vai usar FGTS e financiamento',
    motivo: 'cliente quer saber de financiamento',
    imoveis: [TE0007],
    conversa: [
      ['cliente', 'Gostei do terreno de Pipa, o TE0007. Quero comprar para construir.'],
      ['ia', 'Que bom! É o terreno de 1.338 m² ao lado do Parque Estadual da Pipa.'],
      ['cliente', 'Vou usar FGTS e financiamento. Vocês ajudam com a documentação do banco?'],
      ['ia', 'Vou verificar isso com a equipe e te retorno.'],
    ],
    conferir: (s) =>
      s.orcamento.pagamento?.valor !== 'misto' && s.orcamento.pagamento?.valor !== 'fgts'
        ? `pagamento ${s.orcamento.pagamento?.valor ?? 'vazio'} (esperado misto ou FGTS)`
        : s.procura.negocio?.valor !== 'compra'
          ? `negócio ${s.procura.negocio?.valor ?? 'vazio'} (esperado compra)`
          : null,
  },
];

export interface RespostaDoEnsaioDoResumo {
  readonly caso: string;
  readonly descricao: string;
  readonly certo: boolean;
  readonly falha: string | null;
  readonly descartados: readonly string[];
  readonly resumo: Saida | null;
  readonly erro?: string;
}

export interface ResultadoDoEnsaioDoResumo {
  readonly promptVersion: string;
  readonly respostas: readonly RespostaDoEnsaioDoResumo[];
  readonly custoUsd: number;
}

function entradaDoCaso(caso: CasoDoResumo): EntradaDoResumoDaPassagem {
  return {
    leadId: `ensaio-${caso.id.toLowerCase()}`,
    passouEm: 'quarta-feira, 25 de novembro, às 15h30',
    motivoDaPassagem: caso.motivo,
    visitas: [],
    imoveisCitados: caso.imoveis,
    mensagens: caso.conversa.map(([de, texto], i) => ({
      messageId: `m${i + 1}`,
      de,
      quem: null,
      quando: `25/11 15:2${i}`,
      texto,
    })),
  };
}

export async function ensaiarResumo(
  contexto: ContextoDaIa,
  opcoes: { repeticoes: number; tetoUsd: number },
): Promise<ResultadoDoEnsaioDoResumo> {
  const respostas: RespostaDoEnsaioDoResumo[] = [];
  let custo = 0;
  for (let rodada = 0; rodada < opcoes.repeticoes; rodada += 1) {
    for (const caso of CASOS) {
      if (custo >= opcoes.tetoUsd) break;
      const entrada = entradaDoCaso(caso);
      try {
        const r = await executar<EntradaDoResumoDaPassagem, Saida>(
          contexto,
          resumoDaPassagemV1,
          entrada,
          { leadId: entrada.leadId, nome: null, empresa: null },
          {},
        );
        custo += r.custoUsd ?? 0;
        const conferido = conferirResumoDaPassagem(entrada, r.saida);
        const falha = caso.conferir(conferido.saida);
        respostas.push({
          caso: caso.id,
          descricao: caso.descricao,
          certo: falha === null,
          falha,
          descartados: conferido.descartados,
          resumo: conferido.saida,
        });
      } catch (erro) {
        respostas.push({
          caso: caso.id,
          descricao: caso.descricao,
          certo: false,
          falha: 'erro',
          descartados: [],
          resumo: null,
          erro: erro instanceof Error ? erro.message : String(erro),
        });
      }
    }
  }
  return {
    promptVersion: `${resumoDaPassagemV1.id}@v${resumoDaPassagemV1.versao}`,
    respostas,
    custoUsd: Math.round(custo * 10_000) / 10_000,
  };
}

const dito = (d: { valor: unknown } | null | undefined): string =>
  d === null || d === undefined ? 'não disse' : String(d.valor);

export function relatorioDoResumo(r: ResultadoDoEnsaioDoResumo): string {
  const certas = r.respostas.filter((x) => x.certo).length;
  const linhas = [
    `ENSAIO DO RESUMO — ${r.promptVersion}: ${certas}/${r.respostas.length} certas, US$ ${r.custoUsd}`,
    '',
  ];
  for (const x of r.respostas) {
    linhas.push(
      `${x.certo ? 'ok ' : 'ERRO'} ${x.caso} (${x.descricao})${x.falha && !x.certo ? ` — ${x.falha}` : ''}${x.erro ? `: ${x.erro}` : ''}`,
    );
    const s = x.resumo;
    if (s !== null) {
      linhas.push(
        `     procura: ${dito(s.procura.negocio)} · ${dito(s.procura.tipo)} · ${dito(s.procura.regiao)}`,
        `     imóveis: ${s.imoveis.map((i) => i.codigo).join(', ') || 'nenhum'}`,
        `     orçamento: ${dito(s.orcamento.valor)} · pagamento: ${dito(s.orcamento.pagamento)}`,
        `     objeção: ${s.objecao ? `${s.objecao.tipo} (${s.objecao.comoDisse})` : 'nenhuma'}`,
        `     temperatura: ${s.temperatura ?? 'não dá para julgar'} — ${s.temperaturaPorque}`,
        `     por que passou: ${s.porquePassou}`,
        `     próximo passo: ${s.proximoPasso}`,
      );
      if (x.descartados.length > 0)
        linhas.push(`     descartado na conferência: ${x.descartados.join(', ')}`);
    }
  }
  return `${linhas.join('\n')}\n`;
}
