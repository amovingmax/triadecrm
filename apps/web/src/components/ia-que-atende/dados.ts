import { createClient } from '@/lib/supabase/client';

/**
 * A IA que atende o cliente sozinha (Imova, 06/11/2026): o que a tela lê e o que ela
 * pede ao banco. Toda escrita é por função do banco (`public.ia_*`), que confere o
 * papel de novo; a tela só evita oferecer o que vai ser recusado.
 */

export const CHAVE_DA_IA = ['ia-que-atende'] as const;

export function chaveDoEstado(fioId: string) {
  return [...CHAVE_DA_IA, 'estado', fioId] as const;
}

export function chaveDasRespostas(fioId: string) {
  return [...CHAVE_DA_IA, 'respostas', fioId] as const;
}

export const CHAVE_DO_PAINEL = [...CHAVE_DA_IA, 'painel'] as const;
export const CHAVE_DO_CADERNO = [...CHAVE_DA_IA, 'caderno'] as const;
export const CHAVE_DAS_RECENTES = [...CHAVE_DA_IA, 'recentes'] as const;

/** Frase para a pessoa, a partir do motivo que o banco devolveu. */
const MOTIVOS: Readonly<Record<string, string>> = {
  sem_permissao: 'O seu acesso não permite mexer na IA.',
  conversa_inexistente: 'A conversa não existe mais.',
  resposta_inexistente: 'Essa resposta não existe mais.',
  sem_correcao: 'Escreva o que a IA devia ter respondido.',
  correcao_longa: 'A correção passou de 1.500 caracteres.',
  texto_curto: 'Escreva pelo menos uma frase.',
  texto_longo: 'O texto passou de 2.000 caracteres.',
  linha_inexistente: 'Essa linha do caderno já tinha saído.',
  modo_invalido: 'Modo desconhecido.',
  setor_inexistente: 'Esse setor não existe.',
  modelo_invalido: 'Modelo desconhecido.',
  aviso_fora_do_tamanho: 'O aviso precisa ter de 10 a 400 caracteres.',
  assinatura_longa: 'A assinatura passou de 40 caracteres.',
  e_a_conversa_do_treino: 'Essa é a conversa do treino: lá a IA aprende. Escolha outra para testar.',
  muitas_conversas_de_teste: 'Já são 5 conversas de teste. Tire uma antes de pôr outra.',
};

export class ErroDaIa extends Error {
  readonly motivo: string;
  constructor(motivo: string) {
    super(MOTIVOS[motivo] ?? 'O servidor recusou o pedido.');
    this.name = 'ErroDaIa';
    this.motivo = motivo;
  }
}

async function pedir(funcao: string, argumentos: Record<string, unknown>): Promise<Record<string, unknown>> {
  const { data, error } = await createClient().rpc(funcao as never, argumentos as never);
  if (error) throw new Error(error.message);
  const resposta = (data ?? {}) as Record<string, unknown>;
  if (resposta.ok === false) throw new ErroDaIa(String(resposta.motivo ?? 'recusado'));
  return resposta;
}

function texto(valor: unknown): string | null {
  return typeof valor === 'string' && valor.trim() !== '' ? valor : null;
}

// ---------------------------------------------------------------------------
// Numa conversa
// ---------------------------------------------------------------------------

export interface EstadoDaIaNaConversa {
  /** A chave-mestra da IA está ligada? */
  readonly ligada: boolean;
  readonly modo: 'treino' | 'clientes';
  /** É a conversa do treino? */
  readonly treino: boolean;
  /** É uma conversa de teste (a IA conversa como com um cliente, sem aprender)? */
  readonly teste: boolean;
  /** A IA responde nesta conversa agora? */
  readonly atende: boolean;
  /** O que alguém (ou a IA) decidiu aqui: atendendo, parada ou nada ainda. */
  readonly estado: 'atendendo' | 'parada' | null;
  readonly motivo: string | null;
  readonly mudouEm: string | null;
  readonly mudouPor: string | null;
  readonly passadaPara: string | null;
}

export async function carregarEstado(fioId: string): Promise<EstadoDaIaNaConversa | null> {
  const { data, error } = await createClient().rpc('ia_conversa_estado' as never, { p_conversation_id: fioId } as never);
  if (error) throw new Error(error.message);
  const e = (data ?? {}) as Record<string, unknown>;
  if (e.existe !== true) return null;
  return {
    ligada: e.ligada === true,
    modo: e.modo === 'clientes' ? 'clientes' : 'treino',
    treino: e.treino === true,
    teste: e.teste === true,
    atende: e.atende === true,
    estado: e.estado === 'atendendo' || e.estado === 'parada' ? e.estado : null,
    motivo: texto(e.motivo),
    mudouEm: texto(e.mudou_em),
    mudouPor: texto(e.mudou_por),
    passadaPara: texto(e.passada_para),
  };
}

export async function pararIa(fioId: string, motivo: string | null): Promise<void> {
  await pedir('ia_conversa_parar', { p_conversation_id: fioId, p_motivo: motivo });
}

export async function ligarIa(fioId: string): Promise<boolean> {
  const r = await pedir('ia_conversa_ligar', { p_conversation_id: fioId });
  return r.atende === true;
}

export interface RespostaDaIa {
  readonly id: string;
  readonly conversaId: string;
  readonly messageId: string | null;
  readonly acao: string;
  readonly corpo: string;
  readonly avaliacao: 'boa' | 'corrigir' | null;
  readonly correcao: string | null;
  readonly criadaEm: string;
  readonly motivo: string | null;
  readonly nomeDaConversa: string | null;
  readonly organizacaoId: string | null;
  readonly clienteDisse: string | null;
}

function respostaDe(linha: Record<string, unknown>): RespostaDaIa {
  const conversa = (linha.conversations ?? null) as Record<string, unknown> | null;
  const org = (conversa?.organizations ?? null) as Record<string, unknown> | null;
  const detalhes = (linha.detalhes ?? {}) as Record<string, unknown>;
  const antes = (linha.antes ?? null) as Record<string, unknown> | null;
  return {
    id: String(linha.id),
    conversaId: String(linha.conversation_id),
    messageId: texto(linha.message_id),
    acao: String(linha.acao),
    corpo: String(linha.corpo ?? ''),
    avaliacao: linha.avaliacao === 'boa' || linha.avaliacao === 'corrigir' ? linha.avaliacao : null,
    correcao: texto(linha.correcao),
    criadaEm: String(linha.criada_em),
    motivo: texto(detalhes.motivo),
    nomeDaConversa: texto(org?.name) ?? texto(conversa?.peer_nome),
    organizacaoId: texto(conversa?.organization_id),
    clienteDisse: texto(antes?.body) ?? texto(antes?.transcript),
  };
}

const COLUNAS_DA_RESPOSTA =
  'id, conversation_id, message_id, acao, corpo, avaliacao, correcao, criada_em, detalhes';

/** As respostas que saíram nesta conversa, para o "Boa / Corrigir" de cada balão. */
export async function carregarRespostasDaConversa(fioId: string): Promise<ReadonlyMap<string, RespostaDaIa>> {
  const { data, error } = await createClient()
    .from('ia_respostas' as never)
    .select(COLUNAS_DA_RESPOSTA)
    .eq('conversation_id', fioId)
    .not('message_id', 'is', null)
    .order('criada_em', { ascending: false })
    .limit(200);
  if (error) throw new Error(error.message);
  const mapa = new Map<string, RespostaDaIa>();
  for (const linha of (data ?? []) as Record<string, unknown>[]) {
    const r = respostaDe(linha);
    if (r.messageId !== null) mapa.set(r.messageId, r);
  }
  return mapa;
}

export async function avaliarResposta(
  respostaId: string,
  avaliacao: 'boa' | 'corrigir',
  correcao: string | null,
): Promise<void> {
  await pedir('ia_resposta_avaliar', {
    p_resposta_id: respostaId,
    p_avaliacao: avaliacao,
    p_correcao: correcao,
  });
}

// ---------------------------------------------------------------------------
// A tela "IA que atende"
// ---------------------------------------------------------------------------

/** Os modelos que a tela oferece; o Haiku 5.5 é o de hoje (06/11/2026, para economizar). */
export type ModeloDaIa = 'claude-haiku-5-5' | 'claude-sonnet-5-5' | 'claude-opus-5-5';
const MODELOS_DA_IA: readonly ModeloDaIa[] = ['claude-haiku-5-5', 'claude-sonnet-5-5', 'claude-opus-5-5'];

export interface ConfiguracaoDaIa {
  readonly ligada: boolean;
  readonly modo: 'treino' | 'clientes';
  readonly conversaDeTreino: string | null;
  readonly assinatura: string;
  readonly modelo: ModeloDaIa;
  readonly setorCorretores: number | null;
  readonly avisoCorretor: string;
  readonly ligadaEm: string | null;
}

/**
 * Conversa de teste (10/11/2026): a IA conversa ali como com um cliente, também no
 * modo treino, e não aprende nada (nem caderno, nem foto ensinada).
 */
export interface ConversaDeTeste {
  readonly id: string;
  readonly nome: string;
  readonly telefone: string | null;
  readonly organizacaoId: string | null;
  /** A IA responde ali agora? */
  readonly atende: boolean;
}

export interface PainelDaIa {
  readonly config: ConfiguracaoDaIa;
  readonly podeConfigurar: boolean;
  readonly treino: { readonly id: string; readonly nome: string | null; readonly organizacaoId: string | null } | null;
  readonly testes: readonly ConversaDeTeste[];
  readonly placar: {
    readonly respostas: number;
    readonly boas: number;
    readonly corrigidas: number;
    readonly semAvaliacao: number;
    readonly passadas: number;
    readonly visitas: number;
    readonly silencios: number;
    readonly conversas: number;
    readonly noTreino: number;
    readonly noTeste: number;
  };
  readonly custoUsd: number;
  readonly caderno: { readonly ativas: number; readonly doTreino: number; readonly correcoes: number };
  readonly imoveis: number;
}

function numero(valor: unknown): number {
  const n = typeof valor === 'number' ? valor : Number(valor);
  return Number.isFinite(n) ? n : 0;
}

export async function carregarPainel(dias = 7): Promise<PainelDaIa | null> {
  const { data, error } = await createClient().rpc('ia_atendente_painel' as never, { p_dias: dias } as never);
  if (error) throw new Error(error.message);
  const p = (data ?? {}) as Record<string, unknown>;
  if (p.existe !== true) return null;
  const c = (p.config ?? {}) as Record<string, unknown>;
  const placar = (p.placar ?? {}) as Record<string, unknown>;
  const caderno = (p.caderno ?? {}) as Record<string, unknown>;
  const treino = (p.conversa_de_treino ?? null) as Record<string, unknown> | null;
  const testes = (Array.isArray(p.conversas_de_teste) ? p.conversas_de_teste : []) as Record<string, unknown>[];
  return {
    config: {
      ligada: c.ligada === true,
      modo: c.modo === 'clientes' ? 'clientes' : 'treino',
      conversaDeTreino: texto(c.conversa_de_treino),
      assinatura: texto(c.assinatura) ?? 'Imova',
      modelo: MODELOS_DA_IA.find((m) => m === c.modelo) ?? 'claude-opus-5-5',
      setorCorretores: c.setor_corretores === null || c.setor_corretores === undefined ? null : numero(c.setor_corretores),
      avisoCorretor: texto(c.aviso_corretor) ?? '',
      ligadaEm: texto(c.ligada_em),
    },
    podeConfigurar: p.pode_configurar === true,
    treino: treino
      ? { id: String(treino.id), nome: texto(treino.nome), organizacaoId: texto(treino.organization_id) }
      : null,
    testes: testes.map((t) => ({
      id: String(t.id),
      nome: texto(t.nome) ?? 'Sem nome',
      telefone: texto(t.telefone),
      organizacaoId: texto(t.organization_id),
      atende: t.atende === true,
    })),
    placar: {
      respostas: numero(placar.respostas),
      boas: numero(placar.boas),
      corrigidas: numero(placar.corrigidas),
      semAvaliacao: numero(placar.sem_avaliacao),
      passadas: numero(placar.passadas),
      visitas: numero(placar.visitas),
      silencios: numero(placar.silencios),
      conversas: numero(placar.conversas),
      noTreino: numero(placar.no_treino),
      noTeste: numero(placar.no_teste),
    },
    custoUsd: numero(p.custo_usd),
    caderno: {
      ativas: numero(caderno.ativas),
      doTreino: numero(caderno.do_treino),
      correcoes: numero(caderno.correcoes),
    },
    imoveis: numero(p.imoveis),
  };
}

export async function configurarIa(valores: Record<string, unknown>): Promise<void> {
  await pedir('ia_atendente_configurar', { p_valores: valores });
}

/** Põe ou tira uma conversa da lista de teste (`public.ia_conversa_de_teste_marcar`, só admin e gestor). */
export async function marcarConversaDeTeste(fioId: string, teste: boolean): Promise<void> {
  await pedir('ia_conversa_de_teste_marcar', { p_conversation_id: fioId, p_teste: teste });
}

/** As respostas mais recentes, com o que o cliente tinha dito, para avaliar em lote. */
export async function carregarRespostasRecentes(limite = 40): Promise<RespostaDaIa[]> {
  const { data, error } = await createClient()
    .from('ia_respostas' as never)
    .select(
      `${COLUNAS_DA_RESPOSTA}, conversations(peer_nome, organization_id, organizations(name)), antes:messages!ia_respostas_em_resposta_a_fkey(body, transcript)`,
    )
    .not('message_id', 'is', null)
    .order('criada_em', { ascending: false })
    .limit(limite);
  if (error) throw new Error(error.message);
  return ((data ?? []) as Record<string, unknown>[]).map(respostaDe);
}

export interface LinhaDoCaderno {
  readonly id: number;
  readonly texto: string;
  readonly origem: 'treino' | 'correcao' | 'tela';
  readonly criadoEm: string;
}

export async function carregarCaderno(): Promise<LinhaDoCaderno[]> {
  const { data, error } = await createClient()
    .from('ia_caderno' as never)
    .select('id, texto, origem, criado_em')
    .eq('ativo', true)
    .order('id', { ascending: false });
  if (error) throw new Error(error.message);
  return ((data ?? []) as Record<string, unknown>[]).map((l) => ({
    id: numero(l.id),
    texto: String(l.texto ?? ''),
    origem: l.origem === 'treino' || l.origem === 'correcao' ? l.origem : 'tela',
    criadoEm: String(l.criado_em),
  }));
}

export async function escreverNoCaderno(textoNovo: string, id: number | null = null): Promise<void> {
  await pedir('ia_caderno_escrever', { p_texto: textoNovo, p_id: id });
}

export async function tirarDoCaderno(id: number): Promise<void> {
  await pedir('ia_caderno_tirar', { p_id: id });
}

export interface Setor {
  readonly id: number;
  readonly nome: string;
}

export async function carregarSetores(): Promise<Setor[]> {
  const { data, error } = await createClient()
    .from('setores' as never)
    .select('id, nome')
    .eq('ativo', true)
    .order('posicao');
  if (error) throw new Error(error.message);
  return ((data ?? []) as Record<string, unknown>[]).map((s) => ({ id: numero(s.id), nome: String(s.nome) }));
}

export interface ConversaAchada {
  readonly id: string;
  readonly nome: string;
  /** Mascarado (+55 84 •••••-••12), para distinguir dois contatos de mesmo nome. */
  readonly telefone: string | null;
}

/**
 * A busca da conversa do treino e das de teste: sem acento e sem maiúscula, no nome do contato e no
 * da ficha, ou pelos dígitos do telefone (`public.ia_procurar_conversas`, 06/11/2026).
 */
export async function procurarConversas(termo: string): Promise<ConversaAchada[]> {
  const limpo = termo.trim();
  if (limpo.length < 2) return [];
  const { data, error } = await createClient().rpc('ia_procurar_conversas' as never, { p_termo: limpo } as never);
  if (error) throw new Error(error.message);
  return ((data ?? []) as Record<string, unknown>[]).map((c) => ({
    id: String(c.id),
    nome: texto(c.nome) ?? 'Sem nome',
    telefone: texto(c.telefone),
  }));
}

export function linkDaConversa(r: { organizacaoId: string | null; conversaId: string }): string {
  return r.organizacaoId ? `/conversas?org=${r.organizacaoId}` : `/conversas?cliente=${r.conversaId}`;
}
