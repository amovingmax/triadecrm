/**
 * O resumo da passagem (Imova, 11/11/2026): o que a tela lê de
 * `public.ia_passagens_da_conversa` e as frases que ela mostra. Só lógica pura, sem
 * banco nem React, para o Vitest conferir.
 *
 * Quem decide o que vale (as provas, a temperatura na escala do CRM, qual passagem fica
 * em destaque) é o banco. Aqui só se traduz para gente, e o que o cliente não disse
 * aparece como "não disse" — nunca some calado, nem é preenchido.
 */

export const NAO_DISSE = 'não disse';

/**
 * De onde vem cada situação (o banco decide, pela linha do resumo, não só pelo relógio):
 * pronto; falhou (com o motivo); escrevendo (pedido há menos de 15 min); nao_chegou (pedido
 * mais velho, ou a linha que não nasceu); antes (passagem de antes do resumo existir).
 */
export type SituacaoDoResumo = 'pronto' | 'falhou' | 'escrevendo' | 'nao_chegou' | 'antes';
export type TemperaturaDaPassagem = 'frio' | 'morno' | 'quente';

export interface ResumoDaPassagem {
  readonly negocio: 'compra' | 'locacao' | null;
  readonly tipo: string | null;
  readonly regiao: string | null;
  readonly imoveis: readonly string[];
  /**
   * O imóvel de interesse que a IA registrou, em palavras ("terreno em Praia de Tabatinga
   * (TE0004_IMOVA)"), só quando o cliente não escreveu código (25/11/2026).
   */
  readonly interesse: readonly string[];
  readonly orcamento: string | null;
  readonly pagamento: string | null;
  readonly objecao: string | null;
  readonly objecaoNome: string | null;
  readonly objecaoComoDisse: string | null;
  readonly temperatura: TemperaturaDaPassagem | null;
  readonly temperaturaPorque: string | null;
  readonly porquePassou: string | null;
  readonly proximoPasso: string | null;
  readonly dadosInsuficientes: boolean;
  readonly motivoSemResumo: string | null;
  readonly escritoEm: string | null;
}

export interface PassagemDaIa {
  readonly respostaId: string;
  /** O aviso "já vou te passar" que saiu; null quando a porteira o recusou. */
  readonly messageId: string | null;
  readonly criadaEm: string;
  /** O motivo que a IA (ou a regra) registrou ao passar. */
  readonly motivo: string | null;
  readonly situacao: SituacaoDoResumo;
  /** Treino ou teste NA HORA da passagem: a IA continuou ali, ninguém recebeu o cliente. */
  readonly simulada: boolean;
  readonly resumo: ResumoDaPassagem | null;
}

export interface PassagensDaConversa {
  /** Conversa do treino ou de teste: a passagem é simulação, e nada fica em destaque. */
  readonly simulada: boolean;
  /** O primeiro nome de quem recebeu a conversa, quando a IA a passou. */
  readonly passadaPara: string | null;
  /** Da mais nova para a mais velha (até 10). */
  readonly passagens: readonly PassagemDaIa[];
  /** A passagem que fica no topo: a última de verdade, enquanto ninguém da equipe respondeu. */
  readonly destaque: PassagemDaIa | null;
}

function texto(valor: unknown): string | null {
  return typeof valor === 'string' && valor.trim() !== '' ? valor.trim() : null;
}

function umDe<T extends string>(lista: readonly T[], valor: unknown): T | null {
  return typeof valor === 'string' && (lista as readonly string[]).includes(valor)
    ? (valor as T)
    : null;
}

const SITUACOES: readonly SituacaoDoResumo[] = [
  'pronto',
  'falhou',
  'escrevendo',
  'nao_chegou',
  'antes',
];
const TEMPERATURAS: readonly TemperaturaDaPassagem[] = ['frio', 'morno', 'quente'];

function lerResumo(bruto: unknown): ResumoDaPassagem | null {
  if (typeof bruto !== 'object' || bruto === null) return null;
  const r = bruto as Record<string, unknown>;
  return {
    negocio: umDe(['compra', 'locacao'] as const, r.negocio),
    tipo: texto(r.tipo),
    regiao: texto(r.regiao),
    imoveis: Array.isArray(r.imoveis)
      ? r.imoveis.map(texto).filter((c): c is string => c !== null)
      : [],
    interesse: Array.isArray(r.interesse)
      ? r.interesse.map(texto).filter((c): c is string => c !== null)
      : [],
    orcamento: texto(r.orcamento),
    pagamento: texto(r.pagamento),
    objecao: texto(r.objecao),
    objecaoNome: texto(r.objecao_nome),
    objecaoComoDisse: texto(r.objecao_como_disse),
    temperatura: umDe(TEMPERATURAS, r.temperatura),
    temperaturaPorque: texto(r.temperatura_porque),
    porquePassou: texto(r.porque_passou),
    proximoPasso: texto(r.proximo_passo),
    dadosInsuficientes: r.dados_insuficientes === true,
    motivoSemResumo: texto(r.motivo_sem_resumo),
    escritoEm: texto(r.escrito_em),
  };
}

function lerPassagem(bruto: unknown): PassagemDaIa | null {
  if (typeof bruto !== 'object' || bruto === null) return null;
  const p = bruto as Record<string, unknown>;
  const respostaId = texto(p.resposta_id);
  const criadaEm = texto(p.criada_em);
  if (respostaId === null || criadaEm === null) return null;
  return {
    respostaId,
    messageId: texto(p.message_id),
    criadaEm,
    motivo: texto(p.motivo),
    // Situação que a tela não conhece não promete nada: "não chegou".
    situacao: umDe(SITUACOES, p.situacao) ?? 'nao_chegou',
    simulada: p.simulada === true,
    resumo: lerResumo(p.resumo),
  };
}

/** O que `public.ia_passagens_da_conversa` devolveu. `null`: a pessoa não vê, ou a conversa não existe. */
export function lerPassagens(bruto: unknown): PassagensDaConversa | null {
  if (typeof bruto !== 'object' || bruto === null) return null;
  const e = bruto as Record<string, unknown>;
  if (e.existe !== true) return null;
  const passagens = (Array.isArray(e.passagens) ? e.passagens : [])
    .map(lerPassagem)
    .filter((p): p is PassagemDaIa => p !== null);
  const destaque = texto(e.destaque);
  return {
    simulada: e.simulada === true,
    passadaPara: texto(e.passada_para),
    passagens,
    destaque: destaque === null ? null : (passagens.find((p) => p.respostaId === destaque) ?? null),
  };
}

const PAGAMENTOS: Readonly<Record<string, string>> = {
  financiamento: 'financiamento',
  a_vista: 'à vista',
  fgts: 'FGTS',
  consorcio: 'consórcio',
  misto: 'mais de uma forma',
};

/** "comprar · apartamento de 3 quartos · em Ponta Negra"; null quando ele não disse nada disso. */
export function linhaDaProcura(r: ResumoDaPassagem): string | null {
  const partes = [
    r.negocio === 'compra' ? 'comprar' : r.negocio === 'locacao' ? 'alugar' : null,
    r.tipo,
    r.regiao === null ? null : `em ${r.regiao}`,
  ].filter((p): p is string => p !== null);
  return partes.length === 0 ? null : partes.join(' · ');
}

/** "até R$ 600 mil · financiamento"; null quando ele não disse. */
export function linhaDoOrcamento(r: ResumoDaPassagem): string | null {
  const pagamento = r.pagamento === null ? null : (PAGAMENTOS[r.pagamento] ?? r.pagamento);
  const partes = [r.orcamento, pagamento].filter((p): p is string => p !== null);
  return partes.length === 0 ? null : partes.join(' · ');
}

/** "Preço — achou o condomínio salgado"; null quando ele não disse objeção. */
export function linhaDaObjecao(r: ResumoDaPassagem): string | null {
  if (r.objecao === null) return null;
  const nome = r.objecaoNome ?? r.objecao.replace(/_/g, ' ');
  return r.objecaoComoDisse === null ? nome : `${nome} — ${r.objecaoComoDisse}`;
}

/**
 * Os imóveis: os que o cliente escreveu; sem nenhum, o de interesse que a IA registrou,
 * com "lido pela IA" para não parecer dito pelo cliente (25/11/2026).
 */
export function linhaDosImoveis(r: ResumoDaPassagem): string | null {
  if (r.imoveis.length > 0) return r.imoveis.join(', ');
  return r.interesse.length > 0 ? `${r.interesse.join(', ')} (lido pela IA)` : null;
}

/** O resumo em uma linha (sem a temperatura, que tem o próprio selo): o que procura, imóveis e orçamento. */
export function manchete(r: ResumoDaPassagem): string | null {
  const partes = [linhaDaProcura(r), linhaDosImoveis(r), linhaDoOrcamento(r)].filter(
    (p): p is string => p !== null,
  );
  return partes.length === 0 ? null : partes.join(' · ');
}

const SEM_RESUMO: Readonly<Record<string, string>> = {
  dado_pessoal: 'a conversa tem telefone, e-mail ou @ que não pode ir para a IA',
  orcamento: 'o orçamento de IA do mês chegou ao limite',
  erro_do_modelo: 'a IA não conseguiu escrever o resumo',
  sem_mensagem_do_cliente: 'o cliente não escreveu nada para resumir',
  suprimido: 'o cliente pediu para não ser mais contatado',
  desligado: 'o resumo da passagem está desligado',
  erro_interno: 'um erro do CRM segurou o resumo',
};

/** Por que o resumo não saiu, para gente. */
export function fraseSemResumo(motivo: string | null): string {
  return (motivo === null ? null : SEM_RESUMO[motivo]) ?? 'o resumo não saiu';
}

/** O motivo que a IA registrou, com a primeira letra maiúscula e ponto final. */
export function fraseDoMotivo(motivo: string | null): string | null {
  const limpo = texto(motivo);
  if (limpo === null) return null;
  const frase = limpo.charAt(0).toUpperCase() + limpo.slice(1);
  return /[.!?…]$/.test(frase) ? frase : `${frase}.`;
}

/** Os campos que o cartão mostra, na ordem, com "não disse" no lugar do vazio. */
export function camposDoResumo(
  r: ResumoDaPassagem,
): readonly { rotulo: string; valor: string; disse: boolean }[] {
  const campo = (rotulo: string, valor: string | null) => ({
    rotulo,
    valor: valor ?? NAO_DISSE,
    disse: valor !== null,
  });
  return [
    campo('Procura', linhaDaProcura(r)),
    campo('Imóveis', linhaDosImoveis(r)),
    campo('Orçamento', linhaDoOrcamento(r)),
    campo('Objeção', linhaDaObjecao(r)),
  ];
}

/**
 * Alguém da equipe escreveu depois da passagem? O banco é quem decide o destaque; isto só
 * tira a faixa do topo na hora em que a pessoa responde, sem esperar a próxima leitura.
 */
export function equipeRespondeuDepois(
  mensagens: readonly { entrada: boolean; autorTipo: string; em: string }[],
  criadaEm: string,
): boolean {
  const desde = Date.parse(criadaEm);
  if (Number.isNaN(desde)) return false;
  return mensagens.some((m) => !m.entrada && m.autorTipo === 'human' && Date.parse(m.em) > desde);
}

/**
 * Onde mostrar a passagem que não tem mensagem (a porteira recusou o aviso): embaixo da
 * última mensagem da conversa até a hora da passagem. `null` quando não há nenhuma antes.
 */
export function ancoraDaPassagem(
  mensagens: readonly { id: string; em: string }[],
  criadaEm: string,
): string | null {
  const ate = Date.parse(criadaEm);
  if (Number.isNaN(ate)) return null;
  let ancora: { id: string; em: number } | null = null;
  for (const m of mensagens) {
    const em = Date.parse(m.em);
    if (Number.isNaN(em) || em > ate) continue;
    if (ancora === null || em >= ancora.em) ancora = { id: m.id, em };
  }
  return ancora?.id ?? null;
}

/** A frase de quem não tem resumo (ainda, ou nunca). */
export function fraseDaSituacao(
  passagem: Pick<PassagemDaIa, 'situacao' | 'resumo'>,
): string | null {
  switch (passagem.situacao) {
    case 'escrevendo':
      return 'A IA está escrevendo o resumo para o corretor (alguns segundos).';
    case 'nao_chegou':
      return 'O resumo não chegou (o trabalho da IA não rodou). Leia a conversa.';
    case 'falhou':
      return `Sem resumo: ${fraseSemResumo(passagem.resumo?.motivoSemResumo ?? null)}. Leia a conversa.`;
    case 'antes':
      return 'Esta passagem é de antes do resumo: leia a conversa.';
    default:
      return null;
  }
}
