import { type Intencao, type Responde, type Temperatura, fichaDa } from './intencoes';

/**
 * A camada determinística que envolve o classificador (RF-CON-19, RF-CON-20; R08 §1 e §5.3).
 *
 * O modelo classifica; **quem decide é esta função.** Três coisas nunca dependem do
 * modelo, porque errar nelas custa caro e a regra é conhecida:
 *
 * 1. **Opt-out por regra, antes de qualquer IA** (RF-CON-19). Se a mensagem pede para
 *    parar, a decisão é OPT_OUT mesmo que o modelo tenha achado outra coisa — inclusive
 *    quando o pedido vem no meio de outro assunto ("quanto custa? ah, e não me manda mais").
 * 2. **Prioridade absoluta** de OPT_OUT, HOSTIL e NAO_E_A_PESSOA sobre qualquer outra
 *    intenção da mesma mensagem (R08 §1).
 * 3. **Piso de confiança**: abaixo de 0,7 a intenção vira AMBIGUO e o robô faz uma
 *    pergunta curta; duas vezes seguidas, vai para humano (RF-CON-20).
 */

export const LIMIAR_DE_CONFIANCA = 0.7 as const;
/** R08 §5.3, gatilho 7: mensagem longa é gente escrevendo, e merece gente. */
export const LIMITE_DE_CARACTERES = 400 as const;

export interface RegraDeOptOut {
  readonly id: string;
  readonly padrao: RegExp;
  /**
   * `true` quando a regra é ampla o bastante para pegar também quem só está recusando a
   * oferta. Vem assim do RF-CON-19, que lista "não quero" e "não tenho interesse" entre
   * as expressões de opt-out; o erro é para o lado seguro (a pessoa para de receber),
   * mas custa um lead que talvez só tenha dito "não" à proposta. Marcado para o eval
   * apontar e para a decisão humana pendente ficar visível.
   */
  readonly amplo: boolean;
}

export const REGRAS_DE_OPT_OUT: readonly RegraDeOptOut[] = [
  {
    id: 'comando-isolado',
    padrao:
      /^\s*(?:por favor,?\s*)?(?:pode\s+)?(?:parar?|pare|sair|remover?|cancelar)\s*[.!]*\s*$/i,
    amplo: false,
  },
  {
    id: 'para-de-mandar',
    padrao: /\bpar(?:a|e|ar)\s+de\s+(?:me\s+)?(?:mandar|enviar|ligar|escrever|chamar)/i,
    amplo: false,
  },
  {
    id: 'nao-mande-mais',
    padrao:
      /\bn[ãa]o\s+(?:me\s+)?(?:mand[ae]|envie|escrev[ae]|lig(?:ue|a)|chame|perturbe)\b[^.!?]{0,30}\bmais\b/i,
    amplo: false,
  },
  {
    id: 'nao-mande-mais-invertido',
    padrao: /\bn[ãa]o\s+me\s+(?:mand[ae]|envie|lig(?:ue|a))\s+mais\b/i,
    amplo: false,
  },
  {
    id: 'tira-da-lista',
    padrao:
      /\bme\s+(?:tir[ae]|remov[ae]|exclu[ai])\b[^.!?]{0,40}\b(?:lista|cadastro|contatos?|base)\b/i,
    amplo: false,
  },
  {
    id: 'remover-numero',
    padrao: /\bremov[ea]r?\s+(?:o\s+)?meu\s+(?:n[úu]mero|contato)\b/i,
    amplo: false,
  },
  { id: 'descadastrar', padrao: /\bdescadastr/i, amplo: false },
  { id: 'nao-receber', padrao: /\bn[ãa]o\s+quero\s+(?:mais\s+)?receber\b/i, amplo: false },
  { id: 'bloquear', padrao: /\bbloquear\b/i, amplo: false },
  // As duas do RF-CON-19 que também são recusa de oferta. Ver `amplo` acima.
  { id: 'nao-tenho-interesse', padrao: /\bn[ãa]o\s+tenho\s+interesse\b/i, amplo: true },
  { id: 'nao-quero', padrao: /\bn[ãa]o\s+quero\b/i, amplo: true },
];

/** R08 §5.3, gatilho 3. */
export const TERMOS_DE_ALTO_VALOR: readonly RegExp[] = [
  /\bcontrato\b/i,
  /\bproposta\b/i,
  /\bnegoci/i,
  /\bexclusividade\b/i,
  /\bnota\s+fiscal\b/i,
  /\brepasse\b/i,
  /\bquando\s+cai\b/i,
];

export type MotivoDeEscalada =
  | 'pedido_explicito'
  | 'hostilidade'
  | 'termo_de_alto_valor'
  | 'intencao_repetida'
  | 'confianca_baixa_repetida'
  | 'mensagem_longa'
  | 'contato_vip'
  | 'sem_saida_do_modelo';

export interface EntidadesExtraidas {
  readonly dataHora: string | null;
  readonly nomeCitado: string | null;
  readonly plataformaCitada: string | null;
  readonly motivo: string | null;
}

export interface SaidaDoClassificador {
  readonly intencao: Intencao;
  readonly confianca: number;
  readonly segundaIntencao: Intencao | null;
  readonly sentimento: 'positivo' | 'neutro' | 'negativo';
  readonly entidades: EntidadesExtraidas;
}

export interface ContextoDaDecisao {
  /** O texto como o parceiro escreveu. A regra de opt-out roda sobre ele, não sobre o modelo. */
  readonly mensagem: string;
  /** `null` quando o modelo falhou ou ainda não foi chamado. */
  readonly saidaDoModelo: SaidaDoClassificador | null;
  readonly intencaoAnterior?: Intencao | null;
  readonly confiancaAnteriorBaixa?: boolean;
  readonly vip?: boolean;
}

export interface Decisao {
  readonly intencao: Intencao;
  readonly origem: 'regra' | 'modelo';
  readonly confianca: number;
  readonly responde: Responde;
  readonly temperatura: Temperatura;
  readonly escalar: boolean;
  readonly motivosDeEscalada: readonly MotivoDeEscalada[];
  readonly intencaoSecundaria: Intencao | null;
  /** Qual regra de opt-out disparou, quando disparou. */
  readonly regraDeOptOut: string | null;
}

/** A regra do RF-CON-19 que roda antes de qualquer IA. */
export function detectarOptOut(mensagem: string): RegraDeOptOut | null {
  return REGRAS_DE_OPT_OUT.find((regra) => regra.padrao.test(mensagem)) ?? null;
}

function contarPerguntas(mensagem: string): number {
  return (mensagem.match(/\?/g) ?? []).length;
}

function motivosDeEscalada(contexto: ContextoDaDecisao, intencao: Intencao): MotivoDeEscalada[] {
  const motivos: MotivoDeEscalada[] = [];
  const mensagem = contexto.mensagem;

  if (intencao === 'PEDIU_LIGACAO') motivos.push('pedido_explicito');
  if (intencao === 'HOSTIL') motivos.push('hostilidade');
  if (TERMOS_DE_ALTO_VALOR.some((padrao) => padrao.test(mensagem))) {
    motivos.push('termo_de_alto_valor');
  }
  if (mensagem.length > LIMITE_DE_CARACTERES || contarPerguntas(mensagem) > 1) {
    motivos.push('mensagem_longa');
  }
  if (contexto.vip === true) motivos.push('contato_vip');
  if (
    contexto.intencaoAnterior === intencao &&
    (intencao === 'NAO_TRABALHO_COM_COMISSAO' || intencao === 'JA_USO_OUTRO')
  ) {
    motivos.push('intencao_repetida');
  }
  return motivos;
}

function montar(
  intencao: Intencao,
  origem: 'regra' | 'modelo',
  confianca: number,
  contexto: ContextoDaDecisao,
  extras: {
    readonly motivosExtras?: readonly MotivoDeEscalada[];
    readonly secundaria?: Intencao | null;
    readonly regraDeOptOut?: string | null;
  } = {},
): Decisao {
  const ficha = fichaDa(intencao);
  const motivos = [...motivosDeEscalada(contexto, intencao), ...(extras.motivosExtras ?? [])];
  const unicos = [...new Set(motivos)];
  return {
    intencao,
    origem,
    confianca,
    responde: unicos.length > 0 ? 'humano' : ficha.responde,
    temperatura: ficha.temperatura,
    escalar: unicos.length > 0,
    motivosDeEscalada: unicos,
    intencaoSecundaria: extras.secundaria ?? null,
    regraDeOptOut: extras.regraDeOptOut ?? null,
  };
}

/**
 * A decisão final sobre uma mensagem recebida.
 *
 * Opt-out é o único caso em que a decisão sai sem escalada e sem olhar o modelo: a
 * confirmação é uma linha de texto fixo e a supressão é imediata (RF-CON-19).
 */
export function decidirIntencao(contexto: ContextoDaDecisao): Decisao {
  const optOut = detectarOptOut(contexto.mensagem);
  if (optOut !== null) {
    const ficha = fichaDa('OPT_OUT');
    return {
      intencao: 'OPT_OUT',
      origem: 'regra',
      confianca: 1,
      responde: ficha.responde,
      temperatura: ficha.temperatura,
      escalar: false,
      motivosDeEscalada: [],
      intencaoSecundaria: contexto.saidaDoModelo?.intencao ?? null,
      regraDeOptOut: optOut.id,
    };
  }

  const saida = contexto.saidaDoModelo;
  if (saida === null) {
    return montar('AMBIGUO', 'regra', 0, contexto, { motivosExtras: ['sem_saida_do_modelo'] });
  }

  // Prioridade absoluta: se qualquer das duas intenções da mensagem for HOSTIL ou
  // NAO_E_A_PESSOA, é ela que vale, mesmo com confiança baixa (R08 §1).
  const candidatas: Intencao[] = [
    saida.intencao,
    ...(saida.segundaIntencao ? [saida.segundaIntencao] : []),
  ];
  const absoluta = candidatas.find((intencao) => fichaDa(intencao).prioridadeAbsoluta);
  if (absoluta !== undefined) {
    const outra = candidatas.find((intencao) => intencao !== absoluta) ?? null;
    return montar(absoluta, 'modelo', saida.confianca, contexto, { secundaria: outra });
  }

  if (saida.confianca < LIMIAR_DE_CONFIANCA) {
    const motivosExtras: MotivoDeEscalada[] =
      contexto.confiancaAnteriorBaixa === true ? ['confianca_baixa_repetida'] : [];
    return montar('AMBIGUO', 'modelo', saida.confianca, contexto, {
      motivosExtras,
      secundaria: saida.intencao,
    });
  }

  // Duas intenções na mesma mensagem: responde a de maior impacto no funil e guarda a
  // outra ("quanto é a taxa? me chama sexta" → responde a taxa, agenda o retorno).
  const ordenadas = [...candidatas].sort((a, b) => fichaDa(b).impacto - fichaDa(a).impacto);
  const principal = ordenadas[0] ?? saida.intencao;
  const secundaria = ordenadas[1] ?? null;
  return montar(principal, 'modelo', saida.confianca, contexto, { secundaria });
}
