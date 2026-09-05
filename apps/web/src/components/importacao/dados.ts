/**
 * As idas ao banco da importação.
 *
 * Quem decide é o Postgres: `importacao_previa` classifica, `esteira_abrir_lote`
 * + `importacao_gravar` + `importacao_encerrar_lote` escrevem pela esteira do
 * ADR-08. Aqui só ficam três coisas: partir a planilha em pedaços que caibam numa
 * chamada, somar o que voltou e traduzir o erro para português.
 *
 * Por que em pedaços: uma prévia de 3.000 linhas numa chamada só é um payload de
 * megabytes e uma transação longa segurando o banco. Em pedaços, a barra anda, a
 * pessoa vê progresso e um pedaço que falha não leva os outros junto.
 */
import { createClient } from '@/lib/supabase/client';
import { formatarNumero } from '@/components/parceiros/formatos';

import type {
  Contagem,
  Decisao,
  LinhaDaPrevia,
  LinhaGravada,
  LoteAnterior,
  Previa,
} from './tipos';

/** Teto do `importacao_previa` no banco. */
export const POR_PEDIDO_PREVIA = 200;
/** Teto do `importacao_gravar` no banco. Menor: cada linha ali escreve. */
export const POR_PEDIDO_GRAVACAO = 100;

export type LinhaCrua = Record<string, string | number>;

function pedacos<T>(itens: T[], tamanho: number): T[][] {
  const saida: T[][] = [];
  for (let i = 0; i < itens.length; i += tamanho) saida.push(itens.slice(i, i + tamanho));
  return saida;
}

function somar(a: Contagem, b: Contagem): Contagem {
  const saida: Contagem = { ...a };
  for (const [chave, valor] of Object.entries(b)) {
    const k = chave as Decisao;
    saida[k] = (saida[k] ?? 0) + (valor ?? 0);
  }
  return saida;
}

export function totalDe(contagem: Contagem): number {
  return Object.values(contagem).reduce<number>((s, n) => s + (n ?? 0), 0);
}

/**
 * Quantos CANDIDATOS a importação mandou para a fila de revisão do Radar.
 *
 * Não é `contagem.duplicata + contagem.revisao`: isso conta LINHAS da planilha, e
 * linha não é candidato (§3.12g do laudo). Duas linhas da mesma empresa
 * compartilham a mesma identidade (celular > @ > CNPJ > nome+cidade), viram a
 * mesma captura e o MESMO candidato; e a linha que a esteira não conseguiu
 * transformar em candidato (`sem_candidato`) não vai para fila nenhuma.
 *
 * Medido no banco em 05/09/2026, com a planilha-ponte preenchida mais uma
 * segunda ocorrência de "Rios Recepções": o recibo mandava "decidir as 31" e a
 * fila do Radar recebia 30.
 */
const DECISOES_QUE_VAO_PARA_A_FILA: readonly Decisao[] = ['duplicata', 'revisao'];

/**
 * `radar_fila` mostra `status = 'novo'` por padrão. `ja_revisado` é o motivo que
 * o banco devolve quando o candidato existe mas JÁ SAIU da fila — decidido numa
 * passagem anterior. Ele volta na resposta com `candidate_id`, e contá-lo
 * mandaria a pessoa procurar no Radar o que não está mais lá.
 */
const MOTIVOS_FORA_DA_FILA: readonly string[] = ['ja_revisado'];

export function candidatosNaFila(linhas: readonly LinhaGravada[]): number {
  const candidatos = new Set<string>();
  for (const l of linhas) {
    if (!DECISOES_QUE_VAO_PARA_A_FILA.includes(l.decisao)) continue;
    if (l.motivo && MOTIVOS_FORA_DA_FILA.includes(l.motivo)) continue;
    if (l.candidate_id) candidatos.add(l.candidate_id);
  }
  return candidatos.size;
}

type RespostaDoBanco = {
  ok?: boolean;
  reason?: string;
  contagem?: Contagem;
  linhas?: unknown[];
};

/**
 * Erro que veio do Postgres, COM o código SQLSTATE.
 *
 * O `error.message` do supabase-js traz só a frase do `raise exception`; o
 * `42501` (permissão negada) viaja em `error.code`. Jogar o código fora era o
 * §3.7 do laudo: a recusa "Papel sdr não desfaz importação" caía no genérico "o
 * servidor não respondeu como esperado", e quem importava não ficava sabendo que
 * o caminho era chamar um gestor.
 */
export class ErroDoBanco extends Error {
  constructor(
    message: string,
    readonly codigo: string | null,
  ) {
    super(message);
    this.name = 'ErroDoBanco';
  }
}

function conferir(
  data: unknown,
  erro: { message: string; code?: string } | null,
): RespostaDoBanco {
  if (erro) throw new ErroDoBanco(erro.message, erro.code ?? null);
  const r = (data ?? {}) as RespostaDoBanco;
  if (r.ok === false) throw new Error(`recusado:${r.reason ?? 'desconhecido'}`);
  return r;
}

// ---------------------------------------------------------------------------
// Prévia
// ---------------------------------------------------------------------------

/**
 * Classifica a planilha inteira sem escrever nada.
 *
 * `aoAndar` recebe quantas linhas já foram classificadas — é o que move a barra
 * numa planilha grande, em vez de deixar a tela parada em "carregando".
 */
export async function pedirPrevia(
  linhas: LinhaCrua[],
  aoAndar?: (feitas: number, total: number) => void,
  sinal?: AbortSignal,
): Promise<Previa> {
  const supabase = createClient();
  let contagem: Contagem = {};
  const saida: LinhaDaPrevia[] = [];
  let feitas = 0;

  for (const pedaco of pedacos(linhas, POR_PEDIDO_PREVIA)) {
    if (sinal?.aborted) throw new DOMException('Prévia cancelada.', 'AbortError');
    const { data, error } = await supabase.rpc('importacao_previa', { p_linhas: pedaco });
    const r = conferir(data, error);
    contagem = somar(contagem, r.contagem ?? {});
    saida.push(...((r.linhas ?? []) as LinhaDaPrevia[]));
    feitas += pedaco.length;
    aoAndar?.(feitas, linhas.length);
  }

  return { contagem, linhas: saida };
}

// ---------------------------------------------------------------------------
// Gravação
// ---------------------------------------------------------------------------

/** Abre o lote (RF-BAS-17): é ele que dá o `import_batch_id` e a janela de desfazer. */
export async function abrirLote(rotulo: string, origemId: number): Promise<string> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc('esteira_abrir_lote', {
    p_kind: 'planilha',
    p_source_id: origemId,
    p_label: rotulo,
    p_params: {},
  });
  const r = conferir(data, error) as RespostaDoBanco & { batch_id?: string };
  if (!r.batch_id) throw new Error('recusado:lote_sem_id');
  return r.batch_id;
}

export type ResultadoDaGravacao = { contagem: Contagem; linhas: LinhaGravada[] };

export async function gravar(
  loteId: string,
  linhas: LinhaCrua[],
  aoAndar?: (feitas: number, total: number) => void,
): Promise<ResultadoDaGravacao> {
  const supabase = createClient();
  let contagem: Contagem = {};
  const saida: LinhaGravada[] = [];
  let feitas = 0;

  for (const pedaco of pedacos(linhas, POR_PEDIDO_GRAVACAO)) {
    const { data, error } = await supabase.rpc('importacao_gravar', {
      p_batch_id: loteId,
      p_linhas: pedaco,
    });
    const r = conferir(data, error);
    contagem = somar(contagem, r.contagem ?? {});
    saida.push(...((r.linhas ?? []) as LinhaGravada[]));
    feitas += pedaco.length;
    aoAndar?.(feitas, linhas.length);
  }

  return { contagem, linhas: saida };
}

export async function encerrarLote(loteId: string, erro?: string): Promise<string | null> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc('importacao_encerrar_lote', {
    p_batch_id: loteId,
    p_erro: erro ?? null,
  });
  const r = conferir(data, error) as RespostaDoBanco & { desfazer_ate?: string };
  return r.desfazer_ate ?? null;
}

export async function buscarLotes(): Promise<LoteAnterior[]> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc('importacao_lotes', { p_limit: 8 });
  if (error) throw new ErroDoBanco(error.message, error.code ?? null);
  return (data ?? []) as LoteAnterior[];
}

/** Desfazer do RF-BAS-17: só dentro das 48 h, e é o banco que confere. */
export type ResultadoDoDesfazer = {
  organizacoes: number;
  negocios: number;
  candidatos: number;
  /** Fichas que o lote criou mas alguém já trabalhou: ficam de pé, de propósito. */
  preservadas: number;
  jaEstava: boolean;
};

export async function desfazerLote(loteId: string): Promise<ResultadoDoDesfazer> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc('esteira_desfazer_lote', { p_batch_id: loteId });
  const r = conferir(data, error) as RespostaDoBanco & {
    ja_estava?: boolean;
    organizacoes_removidas?: number;
    negocios_removidos?: number;
    candidatos_removidos?: number;
    fichas_preservadas?: number;
  };
  return {
    organizacoes: r.organizacoes_removidas ?? 0,
    negocios: r.negocios_removidos ?? 0,
    candidatos: r.candidatos_removidos ?? 0,
    preservadas: r.fichas_preservadas ?? 0,
    jaEstava: r.ja_estava === true,
  };
}

/**
 * O que o recibo diz depois de desfazer — sem inventar causa.
 *
 * A frase antiga era "N ficaram de pé porque alguém já trabalhou", e ela era
 * falsa exatamente quando mais aparecia: até o conserto do §3.6 toda ficha
 * recém-importada contava como tocada, porque quem a tocara era o PRÓPRIO
 * importador (a nota do "último contato" da planilha). A pessoa lia que alguém
 * tinha trabalhado a ficha um instante depois de ela mesma importar, e ia
 * procurar um problema que não existia.
 *
 * Agora a frase enumera o que `public.esteira_desfazer_lote` de fato confere, e
 * não afirma quem fez o quê.
 */
const POR_QUE_FICA =
  'já têm histórico próprio: conversa registrada depois da importação, mudança de etapa, autorização ou ligação';

export function fraseDoDesfazer({
  organizacoes,
  preservadas,
}: Pick<ResultadoDoDesfazer, 'organizacoes' | 'preservadas'>): string {
  const fichas = (n: number) => `${formatarNumero(n)} ${n === 1 ? 'ficha' : 'fichas'}`;

  if (organizacoes === 0 && preservadas === 0) {
    return 'Esse lote não tinha ficha para remover.';
  }
  if (organizacoes === 0) {
    return `Nenhuma ficha removida: as ${formatarNumero(preservadas)} deste lote ${POR_QUE_FICA}.`;
  }
  const removidas = `${fichas(organizacoes)} ${organizacoes === 1 ? 'removida' : 'removidas'}.`;
  if (preservadas === 0) return removidas;
  return `${removidas} ${formatarNumero(preservadas)} ${
    preservadas === 1 ? 'ficou' : 'ficaram'
  } de pé porque ${POR_QUE_FICA}.`;
}

// ---------------------------------------------------------------------------
// Erros
// ---------------------------------------------------------------------------

const RECUSA: Record<string, string> = {
  linhas_invalidas: 'O formato enviado ao servidor não estava certo. Recarregue a página.',
  lote_grande_demais: 'O pedaço enviado passou do teto do servidor. Recarregue a página.',
  lote_inexistente: 'Esse lote não existe mais. Comece a importação de novo.',
  lote_nao_e_planilha: 'Esse lote é de coleta, não de planilha.',
  lote_encerrado: 'Esse lote já foi fechado. Comece uma importação nova.',
  lote_sem_id: 'O servidor não devolveu o número do lote. Tente de novo.',
  origem_invalida: 'A origem escolhida não existe mais no catálogo de fontes.',
  origem_desabilitada: 'Essa fonte está desligada no catálogo.',
  janela_de_48h_encerrada: 'Passaram as 48 horas do desfazer. Agora é ficha por ficha.',
};

/** Nunca mostre código do Postgres a quem está importando planilha. */
export function mensagemDoErro(erro: unknown): string {
  const texto = erro instanceof Error ? erro.message : '';
  const codigo = erro instanceof ErroDoBanco ? erro.codigo : null;
  const recusa = /^recusado:(.+)$/.exec(texto)?.[1];
  if (recusa) return RECUSA[recusa] ?? 'O servidor recusou a importação.';
  // Os dois 42501 da importação são recusas diferentes e levam a ações
  // diferentes: uma é "você não pode importar", a outra é "você importa, mas
  // desfazer é de gestor". Dizer as duas com a mesma frase manda a pessoa
  // procurar o acesso errado.
  if (/não desfaz importação/i.test(texto)) {
    return 'Só um gestor desfaz uma importação. Peça a um gestor para desfazer este lote.';
  }
  if (/não importa planilha|permission/i.test(texto) || codigo === '42501') {
    return 'O seu acesso não importa planilha. Fale com um gestor.';
  }
  if (/jwt|autenticad/i.test(texto)) return 'A sua sessão expirou. Entre de novo.';
  if (/fetch|network|failed|abort/i.test(texto)) {
    return 'O aplicativo não alcançou o servidor. Confira a conexão.';
  }
  return 'O servidor não respondeu como esperado.';
}
