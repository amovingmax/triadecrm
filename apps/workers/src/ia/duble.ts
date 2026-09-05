/**
 * DUBLÊ DO MODELO — não vai para produção, não é deploy, não é a Anthropic.
 *
 * É o outro lado da linha enquanto não há credencial (e enquanto ela não
 * existir, este é o único outro lado). Serve para o mesmo binário, com o mesmo
 * `ClienteDoModelo`, exercitar o caminho inteiro: pseudonimização, chamada,
 * validação da saída pelo schema da versão, validador de promessas, `ai_runs`
 * com os quatro contadores de token e o custo saindo da tabela de preços.
 *
 * Três coisas ele faz de verdade, e são as três que os testes medem:
 *
 * 1. **Descobre qual prompt está falando pelo ESQUEMA pedido**, não pelo texto
 *    do sistema. O esquema é o contrato da versão; o texto muda a cada revisão
 *    de redação. Prompt novo com campos novos falha barulhento aqui.
 * 2. **Devolve saída derivada da entrada**, e não uma constante. É isso que faz
 *    o teste provar que os marcadores `[[NOME_1]]` atravessam o modelo intactos
 *    e voltam reidratados só na hora em que uma pessoa lê.
 * 3. **Conta tokens e simula o cache**: o bloco de sistema é escrito no cache na
 *    primeira chamada e lido nas seguintes. Sem isso os quatro contadores de
 *    `ai_runs` nunca seriam exercitados, e a coluna que ninguém escreve é a
 *    coluna cuja conta ninguém confere.
 *
 * O que ele NÃO é: um modelo. A qualidade do texto não se mede aqui — mede-se
 * nos evals de `packages/prompts`, com fixture, que é onde ela cabe.
 */
import { estimarTokens } from '@komune/prompts';

import type { PedidoAoModelo, RespostaDoModelo, UsoDoModelo } from './cliente';

/** Qual dos quatro fluxos o esquema pedido descreve. */
export type FluxoDoDuble = 'transcricao' | 'resumo' | 'followup' | 'classificacao';

export class EsquemaDesconhecidoError extends Error {
  constructor(campos: readonly string[]) {
    super(
      `O dublê não reconhece o esquema pedido (campos: ${campos.join(', ') || 'nenhum'}). ` +
        'Prompt novo precisa de resposta nova aqui — silenciar isto seria testar o dublê, não o worker.',
    );
    this.name = 'EsquemaDesconhecidoError';
  }
}

function camposDoEsquema(esquema: Record<string, unknown>): string[] {
  const propriedades = esquema.properties;
  if (typeof propriedades !== 'object' || propriedades === null) return [];
  return Object.keys(propriedades as Record<string, unknown>);
}

export function fluxoDoEsquema(esquema: Record<string, unknown>): FluxoDoDuble {
  const campos = new Set(camposDoEsquema(esquema));
  if (campos.has('textoLimpo')) return 'transcricao';
  if (campos.has('noDeVirada')) return 'resumo';
  if (campos.has('claims')) return 'followup';
  if (campos.has('intencao')) return 'classificacao';
  throw new EsquemaDesconhecidoError([...campos]);
}

/** O trecho da mensagem depois de um cabeçalho em caixa alta ("CAMINHO NO ROTEIRO:"). */
function secao(mensagem: string, cabecalho: string): string {
  const inicio = mensagem.indexOf(cabecalho);
  if (inicio === -1) return '';
  return mensagem.slice(inicio + cabecalho.length).trim();
}

function campo(mensagem: string, rotulo: string): string | null {
  for (const linha of mensagem.split('\n')) {
    if (linha.startsWith(`${rotulo}: `)) {
      const valor = linha.slice(rotulo.length + 2).trim();
      return valor === '—' ? null : valor;
    }
  }
  return null;
}

function limitar(texto: string, maximo: number): string {
  return texto.length <= maximo ? texto : `${texto.slice(0, maximo - 1).trimEnd()}…`;
}

// ---------------------------------------------------------------------------
// As quatro respostas
// ---------------------------------------------------------------------------

function transcrever(mensagem: string): Record<string, unknown> {
  const bruta = secao(mensagem, 'TRANSCRIÇÃO BRUTA:');
  // "Limpar" aqui é uma regra de brinquedo, e de propósito: tirar hesitação e
  // marcar ruído como [inaudível] é o suficiente para o worker ter texto
  // diferente do que entrou, que é o que ele precisa gravar.
  const limpo = bruta
    .replace(/\[ru[íi]do\]/gi, '[inaudível]')
    // Sem \b: em JavaScript a fronteira de palavra não enxerga "é" como letra,
    // e a hesitação mais comum do corpus começa justamente com ela.
    .replace(/(?:é\.\.\.|ãhn|tipo assim)\s*/gi, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
  const inaudiveis = (limpo.match(/\[inaudível\]/g) ?? []).length;
  const confiancaAsr = Number(campo(mensagem, 'confiança do reconhecimento') ?? '1');
  const confianca = inaudiveis > 2 || confiancaAsr < 0.6 ? 'baixa' : 'alta';
  return {
    textoLimpo: limpo.length === 0 ? '[inaudível]' : limpo,
    trechosInaudiveis: inaudiveis,
    confianca,
    precisaDeHumano: confianca === 'baixa' || /contrato|dinheiro|reclama/i.test(limpo),
    resumo: limitar(limpo.replace(/\s+/g, ' '), 140),
    entidades: { datas: [], valores: [], nomesCitados: [], plataformas: [] },
  };
}

function resumir(mensagem: string): Record<string, unknown> {
  const caminho = secao(mensagem, 'CAMINHO NO ROTEIRO:').split('\n\n')[0] ?? '';
  const anotacao = secao(mensagem, 'ANOTAÇÃO DE QUEM LIGOU:');
  // A âncora `^\d+\. ` é a forma que `resumo-ligacao@v1` imprime cada nó. Sem
  // ela, os marcadores da própria fala do roteiro ([dia], [hora], [empresa])
  // entrariam na contagem — e um dublê que lê errado prova a coisa errada.
  const nos = [...caminho.matchAll(/^\d+\. \[([a-z0-9_]+)\]/gm)].map((achado) => achado[1] ?? '');
  const virada = nos.find((no) => no.startsWith('obj_')) ?? null;
  const desfecho = campo(mensagem, 'desfecho tabulado') ?? 'lig_atendeu_retorna';
  const partes = [
    `Ligação tabulada como ${desfecho}, com ${nos.length} passos no roteiro.`,
    virada === null ? null : `A conversa virou em ${virada}.`,
    anotacao === '—' || anotacao === '' ? null : limitar(anotacao, 160),
  ].filter((parte): parte is string => parte !== null);
  return {
    resumo: limitar(partes.join(' '), 320),
    combinado: anotacao === '—' || anotacao === '' ? null : limitar(anotacao, 240),
    objecoes: virada === null ? [] : [`Apareceu ${virada}`],
    fatos: [],
    noDeVirada: virada,
    precisaDeRevisao: false,
  };
}

function redigir(mensagem: string): Record<string, unknown> {
  const combinado = campo(mensagem, 'combinado');
  const resumo = secao(mensagem, 'RESUMO DA LIGAÇÃO:');
  const retomada = limitar(resumo.replace(/\s+/g, ' '), 90);
  const linhas = [
    'Oi, [[NOME_1]], foi bom falar com você agora há pouco.',
    `Só pra registrar o que ficou: ${retomada}`,
    combinado === null ? 'Posso te ligar amanhã às 10h?' : `${limitar(combinado, 90)} Confirma pra mim?`,
  ];
  return {
    mensagem: limitar(linhas.join('\n'), 300),
    claims: [],
    audioSugerido: null,
    porQue: 'Retoma a ligação pelo que ficou combinado e faz uma pergunta só.',
  };
}

const PISTAS_DE_INTENCAO: readonly (readonly [RegExp, string, number])[] = [
  [/\bquanto\b|\btaxa\b|\bpre[çc]o\b|\bcomiss/i, 'PEDIU_TAXA_PRECO', 0.88],
  [/n[ãa]o sou eu|falar? com [ao] /i, 'NAO_E_A_PESSOA', 0.9],
  [/\bcontrato\b|nota fiscal|repasse/i, 'PERGUNTA_CONTRATUAL', 0.86],
  [/me chama|depois|semana que vem|sexta/i, 'ME_CHAMA_DEPOIS', 0.82],
  [/quero|tenho interesse|bora|vamos/i, 'INTERESSADO', 0.85],
  [/manda|me envia|material/i, 'MANDA_MATERIAL', 0.8],
];

function classificar(mensagem: string): Record<string, unknown> {
  const texto = secao(mensagem, 'MENSAGEM RECEBIDA:');
  const achadas = PISTAS_DE_INTENCAO.filter(([padrao]) => padrao.test(texto));
  const principal = achadas[0];
  const segunda = achadas[1];
  return {
    intencao: principal?.[1] ?? 'AMBIGUO',
    confianca: principal?.[2] ?? 0.5,
    segundaIntencao: segunda?.[1] ?? null,
    sentimento: /obrigad|[óo]timo|legal|show/i.test(texto) ? 'positivo' : 'neutro',
    entidades: {
      dataHora: /sexta|segunda|amanh[ãa]|\d{1,2}h/i.exec(texto)?.[0] ?? null,
      nomeCitado: null,
      plataformaCitada: /casamentos\.com|instagram|getninjas/i.exec(texto)?.[0] ?? null,
      motivo: null,
    },
  };
}

const RESPOSTAS: Readonly<Record<FluxoDoDuble, (mensagem: string) => Record<string, unknown>>> = {
  transcricao: transcrever,
  resumo: resumir,
  followup: redigir,
  classificacao: classificar,
};

// ---------------------------------------------------------------------------
// O dublê
// ---------------------------------------------------------------------------

export interface OpcoesDoDuble {
  /**
   * Substitui a saída de um fluxo. É o que deixa um teste provar o caminho
   * ruim — rascunho que promete o que não pode, JSON fora do schema — sem
   * inventar um segundo dublê para cada caso.
   */
  readonly forcar?: Partial<Record<FluxoDoDuble, unknown>>;
  /** Levanta este erro em vez de responder. Para exercitar retry e dead-letter. */
  readonly falharCom?: () => Error;
}

/**
 * O dublê como `ClienteDoModelo`: é assim que ele entra pelo mesmo lugar que o
 * cliente real, sem o worker saber a diferença.
 */
export function clienteDuble(opcoes: OpcoesDoDuble = {}): {
  conversar(pedido: PedidoAoModelo): Promise<RespostaDoModelo>;
  /** Quantas chamadas passaram por aqui, por fluxo. */
  readonly chamadas: FluxoDoDuble[];
} {
  const sistemasVistos = new Set<string>();
  const chamadas: FluxoDoDuble[] = [];

  return {
    chamadas,
    async conversar(pedido: PedidoAoModelo): Promise<RespostaDoModelo> {
      if (opcoes.falharCom !== undefined) throw opcoes.falharCom();
      const fluxo = fluxoDoEsquema(pedido.esquema);
      chamadas.push(fluxo);
      const forcada = opcoes.forcar?.[fluxo];
      const json = forcada === undefined ? RESPOSTAS[fluxo](pedido.mensagem) : forcada;

      const tokensDoSistema = estimarTokens(pedido.sistema);
      const jaVisto = sistemasVistos.has(pedido.sistema);
      sistemasVistos.add(pedido.sistema);
      const uso: UsoDoModelo = {
        entrada: estimarTokens(pedido.mensagem),
        saida: estimarTokens(JSON.stringify(json)),
        escritaDeCache: jaVisto ? 0 : tokensDoSistema,
        leituraDeCache: jaVisto ? tokensDoSistema : 0,
      };
      return await Promise.resolve({
        json,
        uso,
        modelo: pedido.modelo,
        paradaPor: 'end_turn',
      });
    },
  };
}
