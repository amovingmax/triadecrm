import type { PainelDaIa, RespostaDaIa } from './dados';

/**
 * O que a tela "IA que atende" deduz do que já carregou, sem perguntar nada novo ao
 * banco (protótipo responsivo da Imova, 24/11/2026): a situação da IA em uma palavra,
 * o filtro das respostas e o título de cada nota do caderno.
 */

// ---------------------------------------------------------------------------
// A situação da IA
// ---------------------------------------------------------------------------

export type TomDaSituacao = 'atendendo' | 'treino' | 'parada' | 'desligada';

export interface SituacaoDaIa {
  readonly tom: TomDaSituacao;
  /** A linha forte do cartão. */
  readonly titulo: string;
  /** A palavra do selo. */
  readonly selo: string;
  /** A frase de hoje, com as conversas de teste quando há. */
  readonly frase: string;
}

/**
 * As mesmas frases que a tela já dizia numa linha só, partidas em título, selo e
 * frase. "Parada" é ligada em treino sem conversa de treino nem de teste: ligada, mas
 * sem ninguém a quem responder.
 */
export function situacaoDaIa(
  painel: Pick<PainelDaIa, 'config' | 'treino' | 'testes'>,
): SituacaoDaIa {
  const { config, treino, testes } = painel;
  const deTeste =
    testes.length === 0
      ? ''
      : ` E conversa, sem aprender, com ${testes.map((t) => t.nome).join(', ')} (teste).`;
  if (!config.ligada) {
    return {
      tom: 'desligada',
      titulo: 'Desligada',
      selo: 'Desligada',
      frase: 'Não responde ninguém.',
    };
  }
  if (config.modo === 'clientes') {
    return {
      tom: 'atendendo',
      titulo: 'Ligada para os clientes',
      selo: 'IA atendendo',
      frase: 'Responde toda conversa em que ninguém do time escreveu.',
    };
  }
  if (treino) {
    return {
      tom: 'treino',
      titulo: 'Ligada, em treino',
      selo: 'Em treino',
      frase: `Aprende só na conversa de ${treino.nome ?? 'treino'}.${deTeste}`,
    };
  }
  if (testes.length > 0) {
    return {
      tom: 'treino',
      titulo: 'Ligada, em treino',
      selo: 'Em treino',
      frase: `Sem conversa de treino escolhida.${deTeste}`,
    };
  }
  return {
    tom: 'parada',
    titulo: 'Ligada, em treino',
    selo: 'Parada',
    frase: 'Sem conversa de treino escolhida: não responde ninguém.',
  };
}

// ---------------------------------------------------------------------------
// O filtro das respostas
// ---------------------------------------------------------------------------

export const FILTROS_DAS_RESPOSTAS = [
  'Todas',
  'Sem avaliação',
  'Boas',
  'Corrigidas',
  'Passou para corretor',
] as const;

export type FiltroDasRespostas = (typeof FILTROS_DAS_RESPOSTAS)[number];

/** Filtra no cliente as respostas que a tela já carregou (as 40 mais recentes). */
export function filtrarRespostas(
  lista: readonly RespostaDaIa[],
  filtro: FiltroDasRespostas,
): RespostaDaIa[] {
  switch (filtro) {
    case 'Sem avaliação':
      return lista.filter((r) => r.avaliacao === null);
    case 'Boas':
      return lista.filter((r) => r.avaliacao === 'boa');
    case 'Corrigidas':
      return lista.filter((r) => r.avaliacao === 'corrigir');
    case 'Passou para corretor':
      return lista.filter((r) => r.acao === 'passou_para_pessoa');
    default:
      return [...lista];
  }
}

/** Quantas a lista mostra de cada vez: "Mostrar mais" soma outras tantas. */
export const RESPOSTAS_POR_VEZ = 10;

// ---------------------------------------------------------------------------
// A nota do caderno
// ---------------------------------------------------------------------------

export interface NotaPartida {
  /** O número que a nota traz no começo ("9", "FICHA 1", "MERCADO"), ou null. */
  readonly numero: string | null;
  /** O nome da nota, até os dois-pontos, ou null quando a nota é uma frase solta. */
  readonly titulo: string | null;
  /** O resto do texto. Sem título, é o texto inteiro. */
  readonly corpo: string;
}

/**
 * As notas que o time escreve seguem o jeito "9. REGRAS FIRMES (PROVISÓRIA: tirar
 * quando…): Onde o caderno…", "FICHA 1. TERRENO DE 900 M² EM NATAL: …" ou
 * "MERCADO · CASA DE 3 QUARTOS NO POTENGI: …". A tela mostra número, título e o
 * começo do corpo; os dois-pontos de dentro do parêntese não contam. Nota que é
 * só uma frase ("Quando o cliente perguntar de financiamento…") fica inteira.
 */
export function partirNota(texto: string): NotaPartida {
  const limpo = texto.trim();
  // O separador depois do número é obrigatório: "3 quartos…" é frase, não nota 3.
  const rotulo = /^(FICHA\s+\d+[A-Za-z]?|\d+[A-Za-z]?|MERCADO)\s*[.·)]\s+/u.exec(limpo);
  if (!rotulo) return { numero: null, titulo: null, corpo: limpo };
  const resto = limpo.slice(rotulo[0].length);
  let fundo = 0;
  let fim = -1;
  for (let i = 0; i < Math.min(resto.length, 140); i++) {
    const c = resto[i];
    if (c === '(') fundo++;
    else if (c === ')') fundo = Math.max(0, fundo - 1);
    else if (c === '\n') break;
    else if (c === ':' && fundo === 0) {
      fim = i;
      break;
    }
  }
  const numero = (rotulo[1] ?? '').replace(/\s+/g, ' ').toUpperCase();
  if (fim <= 0) return { numero, titulo: null, corpo: resto.trim() };
  return { numero, titulo: resto.slice(0, fim).trim(), corpo: resto.slice(fim + 1).trim() };
}
