/**
 * A IA que atende nunca para por causa de um número (Imova, 27/11/2026).
 *
 * Pedido do dono: "É extremamente importante que a IA não pare de atender os clientes. Ela
 * sempre deve responder a mensagens dos clientes."
 *
 * O que acontecia: a conferência de dado pessoal da chamada (`prepararChamada`, em
 * `@komune/prompts`) recusa a chamada inteira quando enxerga algo que parece telefone,
 * e-mail ou @, e a IA passava a conversa para a equipe sem responder. Como o caderno e os
 * anúncios vão em TODA resposta, uma nota com "1.338,99, 2.021" (19/11/2026) derrubou todas
 * as conversas por 40 minutos.
 *
 * O que muda: a conferência continua a mesma (nada de dado pessoal vai ao modelo), mas em vez
 * de recusar, o worker TIRA o trecho acusado do que a IA lê nesta resposta e responde:
 *   1. a base (caderno e anúncios) passa, texto a texto, pela mesma varredura da montagem
 *      (`varrerMontagem`), e o trecho acusado vira "[número tirado]" / "[contato tirado]";
 *   2. antes de gastar, a chamada é conferida (`prepararChamada`, sem modelo); se ainda
 *      acusar algo, o trecho sai de onde estiver (base ou mensagem do cliente), e depois, se
 *      preciso, todo número comprido sai; são três tentativas;
 *   3. só se as três falharem a chamada segue como antes (e aí o bloqueio de sempre).
 * Nota do caderno que precisou de corte vira tarefa para a gestão corrigir (uma por nota
 * por dia), porque a IA está lendo a nota sem o número.
 */
import {
  PiiNaChamadaError,
  type ContextoDoContato,
  type ProblemaDePii,
  type PromptVersionado,
  prepararChamada,
  varrerMontagem,
} from '@komune/prompts';

import type { ContextoDaIa } from './execucao';

export const NUMERO_TIRADO = '[número tirado]';
export const CONTATO_TIRADO = '[contato tirado]';

const marcaDo = (tipo: string): string => (tipo === 'TELEFONE' ? NUMERO_TIRADO : CONTATO_TIRADO);

/** Onde a base precisou de corte: o caminho do texto e o tipo do que saiu. */
export interface Corte {
  readonly onde: string;
  readonly tipos: readonly string[];
}

/** Troca, num texto, cada ocorrência do trecho pela marca. */
function trocar(texto: string, trecho: string, marca: string): string {
  return trecho === '' ? texto : texto.split(trecho).join(marca);
}

/**
 * Tira de um texto o que a varredura da montagem acusaria. Repete até limpar (a troca pode
 * juntar pedaços), no máximo cinco vezes.
 */
export function blindarTexto(texto: string): { texto: string; tipos: string[] } {
  let atual = texto;
  const tipos: string[] = [];
  for (let i = 0; i < 5; i += 1) {
    const problemas = varrerMontagem(atual);
    if (problemas.length === 0) break;
    for (const p of problemas) {
      atual = trocar(atual, p.trecho, marcaDo(p.tipo));
      tipos.push(p.tipo);
    }
  }
  return { texto: atual, tipos };
}

const E_MAIL = /[^\s@]+@[^\s@]+/g;
const ARROBA = /@[A-Za-z0-9._]*[A-Za-z0-9_]/g;
const INSTAGRAM = /(?:www\.)?instagram\.com\/\S+/gi;

/**
 * O corte forte: todo trecho sem letra com `minimo` algarismos ou mais vira "[número
 * tirado]", e e-mail, @ e endereço do Instagram viram "[contato tirado]".
 */
export function semNumerosLongos(texto: string, minimo: number): string {
  return texto
    .replace(INSTAGRAM, CONTATO_TIRADO)
    .replace(E_MAIL, CONTATO_TIRADO)
    .replace(ARROBA, CONTATO_TIRADO)
    .replace(/[^\p{L}]+/gu, (pedaco) => {
      const digitos = pedaco.match(/\p{Nd}/gu)?.length ?? 0;
      if (digitos < minimo) return pedaco;
      const inicio = pedaco.search(/\p{Nd}/u);
      let fim = pedaco.length - 1;
      while (fim > inicio && !/\p{Nd}/u.test(pedaco[fim] ?? '')) fim -= 1;
      return `${pedaco.slice(0, inicio)}${NUMERO_TIRADO}${pedaco.slice(fim + 1)}`;
    });
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Data e hora do banco ("2026-11-27 16:36:00.24-03"): registro, não texto para a IA. */
const DATA_E_HORA = /^\d{4}-\d{2}-\d{2}([ T]\d{2}:\d{2}(:\d{2}(\.\d+)?)?)?([+-]\d{2}(:?\d{2})?|Z)?$/;
/**
 * Chave de identificador, endereço, data ou versão: o valor não é texto para a IA ler, e
 * não muda (a `versao` da base, com `caderno_mudou_em`, vai só para o registro da resposta).
 */
const CHAVE_DE_IDENTIFICADOR = /^(id|codigo|chave|caminho|url|link|versao)$|_id$|Id$|_url$|Url$|_em$/;

/**
 * Aplica a troca a todo texto de um objeto (cópia), anotando onde mudou. Identificadores
 * (uuid, `id`, `codigo`, endereço) ficam como estão: o worker os usa depois.
 */
export function mapearTextos<T>(
  valor: T,
  troca: (texto: string) => string,
  cortes: { onde: string; antes: string; depois: string }[] = [],
  caminho = '',
): T {
  if (typeof valor === 'string') {
    if (UUID.test(valor) || DATA_E_HORA.test(valor)) return valor;
    const depois = troca(valor);
    if (depois !== valor) cortes.push({ onde: caminho, antes: valor, depois });
    return depois as T;
  }
  if (Array.isArray(valor)) {
    return valor.map((v, i) => mapearTextos(v, troca, cortes, `${caminho}[${i}]`)) as T;
  }
  if (valor !== null && typeof valor === 'object') {
    const copia: Record<string, unknown> = {};
    for (const [chave, v] of Object.entries(valor as Record<string, unknown>)) {
      copia[chave] = CHAVE_DE_IDENTIFICADOR.test(chave)
        ? v
        : mapearTextos(v, troca, cortes, caminho === '' ? chave : `${caminho}.${chave}`);
    }
    return copia as T;
  }
  return valor;
}

/** A base com cada texto passado pela varredura da montagem, e onde houve corte. */
export function blindarBase<T>(base: T): { base: T; cortes: Corte[] } {
  const tiposPorCaminho = new Map<string, string[]>();
  const brutos: { onde: string; antes: string; depois: string }[] = [];
  const blindada = mapearTextos(
    base,
    (texto) => {
      const r = blindarTexto(texto);
      if (r.tipos.length > 0) tiposPorCaminho.set(texto, r.tipos);
      return r.texto;
    },
    brutos,
  );
  return {
    base: blindada,
    cortes: brutos.map((c) => ({ onde: c.onde, tipos: [...new Set(tiposPorCaminho.get(c.antes) ?? [])] })),
  };
}

/** Os ids das notas do caderno que precisaram de corte ("caderno[3].texto" → base.caderno[3].id). */
export function notasCortadas(
  base: { readonly caderno?: readonly { readonly id: number }[] },
  cortes: readonly Corte[],
): number[] {
  const ids = new Set<number>();
  for (const c of cortes) {
    const m = /^caderno\[(\d+)\]/.exec(c.onde);
    const nota = m === null ? undefined : base.caderno?.[Number(m[1])];
    if (nota !== undefined) ids.add(nota.id);
  }
  return [...ids];
}

/** O que a conferência da chamada acusaria (vazio = a chamada sai). Não chama o modelo. */
export function problemasDaChamada<Entrada, Saida>(
  prompt: PromptVersionado<Entrada, Saida>,
  entrada: unknown,
  contato: ContextoDoContato,
): readonly ProblemaDePii[] {
  try {
    prepararChamada(prompt, entrada, contato);
    return [];
  } catch (erro) {
    if (erro instanceof PiiNaChamadaError) return erro.problemas;
    throw erro;
  }
}

/** Os campos de texto de fora que a conferência lê na entrada da IA que atende. */
interface EntradaComMensagens {
  readonly mensagens: readonly { readonly texto?: string | null }[];
  readonly cliente?: unknown;
}

/**
 * Aplica a troca só às falas da conversa e ao que se sabe do cliente (os campos de fora que a
 * conferência lê); o resto da entrada é do CRM (a hora, os links, os ids) e não muda.
 */
function nasMensagens<E extends EntradaComMensagens>(entrada: E, troca: (texto: string) => string): E {
  return {
    ...entrada,
    mensagens: entrada.mensagens.map((m) =>
      typeof m.texto === 'string' ? { ...m, texto: troca(m.texto) } : m,
    ),
    ...(entrada.cliente === undefined ? {} : { cliente: mapearTextos(entrada.cliente, troca) }),
  };
}

export interface Blindada<B, E> {
  readonly base: B;
  readonly entrada: E;
  /** Quantas tentativas de corte foram precisas depois da base (0 = nenhuma). */
  readonly tentativas: number;
  /** A conferência ainda acusa algo depois das três: a chamada segue como antes. */
  readonly aindaAcusa: boolean;
  /** Os tipos que a conferência acusou (sem os trechos: são dado pessoal). */
  readonly tipos: readonly string[];
}

/**
 * As três tentativas antes de gastar: (1) tira cada trecho acusado de onde estiver, na base e
 * nas falas; (2) tira todo trecho sem letra com 10 algarismos ou mais, e todo contato; (3) nas
 * falas, tira também os de 4 algarismos ou mais (o telefone repartido entre duas mensagens).
 * `montar` refaz o prompt a partir da base (o caderno vai no sistema).
 */
export function blindarChamada<B, E extends EntradaComMensagens, Saida>(opcoes: {
  base: B;
  entrada: E;
  contato: ContextoDoContato;
  montar: (base: B) => PromptVersionado<E, Saida>;
}): Blindada<B, E> {
  let base = opcoes.base;
  let entrada = opcoes.entrada;
  const tipos = new Set<string>();
  for (let tentativa = 0; tentativa <= 3; tentativa += 1) {
    const problemas = problemasDaChamada(opcoes.montar(base), entrada, opcoes.contato);
    if (problemas.length === 0) return { base, entrada, tentativas: tentativa, aindaAcusa: false, tipos: [...tipos] };
    for (const p of problemas) tipos.add(p.tipo);
    if (tentativa === 0) {
      for (const p of problemas) {
        const marca = marcaDo(p.tipo);
        base = mapearTextos(base, (t) => trocar(t, p.trecho, marca));
        entrada = nasMensagens(entrada, (t) => trocar(t, p.trecho, marca));
      }
    } else if (tentativa === 1) {
      base = mapearTextos(base, (t) => semNumerosLongos(t, 10));
      entrada = nasMensagens(entrada, (t) => semNumerosLongos(t, 10));
    } else if (tentativa === 2) {
      entrada = nasMensagens(entrada, (t) => semNumerosLongos(t, 4));
    }
  }
  return { base, entrada, tentativas: 3, aindaAcusa: true, tipos: [...tipos] };
}

/** Uma tarefa por nota por dia, por processo do worker. */
const avisadas = new Map<number, string>();

/** A gestão fica sabendo que a IA está lendo uma nota sem o número (e corrige a nota). */
export async function avisarNotasCortadas(contexto: ContextoDaIa, ids: readonly number[]): Promise<void> {
  const hoje = new Date().toISOString().slice(0, 10);
  const novas = ids.filter((id) => avisadas.get(id) !== hoje);
  if (novas.length === 0) return;
  for (const id of novas) avisadas.set(id, hoje);
  try {
    const { data } = await contexto.cliente
      .from('profiles')
      .select('id')
      .eq('is_active', true)
      .eq('role', 'admin')
      .order('created_at')
      .limit(1)
      .maybeSingle();
    const dono = (data as { id: string } | null)?.id ?? null;
    if (dono === null) return;
    const { error } = await contexto.cliente.from('tasks').insert({
      title:
        `Caderno da IA: ${novas.length === 1 ? 'a nota' : 'as notas'} ${novas.map((id) => `[${id}]`).join(', ')} ` +
        'tem número que parece telefone (ou e-mail/@). A IA continua respondendo, mas lê a nota sem esse ' +
        'trecho: corrija a nota na aba Caderno (separe os números com palavras).',
      kind: 'other',
      due_at: new Date().toISOString(),
      assignee_id: dono,
      origin: 'ai',
      priority: 1,
    });
    if (error) contexto.logger.warn('não deu para abrir a tarefa da nota cortada', { erro: error.message });
  } catch (erro) {
    contexto.logger.warn('não deu para abrir a tarefa da nota cortada', {
      erro: erro instanceof Error ? erro.message : String(erro),
    });
  }
}
