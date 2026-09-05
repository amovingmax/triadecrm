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

type RespostaDoBanco = {
  ok?: boolean;
  reason?: string;
  contagem?: Contagem;
  linhas?: unknown[];
};

function conferir(data: unknown, erro: { message: string } | null): RespostaDoBanco {
  if (erro) throw new Error(erro.message);
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
  if (error) throw new Error(error.message);
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
  const recusa = /^recusado:(.+)$/.exec(texto)?.[1];
  if (recusa) return RECUSA[recusa] ?? 'O servidor recusou a importação.';
  if (/não importa planilha|42501|permission/i.test(texto)) {
    return 'O seu acesso não importa planilha. Fale com um gestor.';
  }
  if (/jwt|autenticad/i.test(texto)) return 'A sua sessão expirou. Entre de novo.';
  if (/fetch|network|failed|abort/i.test(texto)) {
    return 'O aplicativo não alcançou o servidor. Confira a conexão.';
  }
  return 'O servidor não respondeu como esperado.';
}
