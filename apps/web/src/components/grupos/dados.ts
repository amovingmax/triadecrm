import { createClient } from '@/lib/supabase/client';
import { escaparCuringas, normalizarBusca } from '@/components/agenda/autocompletar';

import { fraseDoMotivo } from './regras';
import {
  COLUNAS_DA_MENSAGEM,
  COLUNAS_DO_GRUPO,
  type AcaoCrua,
  type ConversaParaConvite,
  type GrupoCru,
  type MensagemDoGrupoCrua,
  type ParticipanteCru,
  type PedidoCru,
} from './tipos';

/**
 * As leituras e os pedidos da aba Grupos, no navegador, sob a RLS de quem
 * entrou. Ler é direto nas tabelas (admin, gestor e SDR leem tudo); escrever é
 * só pelas funções `grupo_*`, que devolvem `{ ok, motivo }`.
 */

export const CHAVE_DOS_GRUPOS = ['grupos', 'lista'] as const;
export const chaveDoFio = (grupoId: string) => ['grupos', 'fio', grupoId] as const;
export const chaveDasAcoes = (grupoId: string) => ['grupos', 'acoes', grupoId] as const;

/** Quantas mensagens o fio carrega: as mais recentes. Grupo de 8 pessoas não passa disso tão cedo. */
export const TETO_DE_MENSAGENS = 400;

export class ErroDoGrupo extends Error {
  constructor(readonly motivo: string) {
    super(fraseDoMotivo(motivo));
    this.name = 'ErroDoGrupo';
  }
}

function erroDaLeitura(error: { message: string; code?: string }): Error {
  return new Error(
    error.code === '42501' || error.code === 'PGRST301'
      ? 'Seu perfil não lê os grupos.'
      : 'Não deu para ler os grupos. Confira a internet e tente de novo.',
  );
}

export async function carregarGrupos(): Promise<GrupoCru[]> {
  const { data, error } = await createClient()
    .from('wa_grupos')
    .select(COLUNAS_DO_GRUPO)
    .order('last_message_at', { ascending: false, nullsFirst: false })
    .order('criado_em', { ascending: false })
    .limit(200);
  if (error) throw erroDaLeitura(error);
  return (data ?? []) as GrupoCru[];
}

export type FioDoGrupo = {
  mensagens: MensagemDoGrupoCrua[];
  participantes: ParticipanteCru[];
  pedidos: PedidoCru[];
  /** O fio bateu no teto e mostra só as mais recentes. */
  cortado: boolean;
};

export async function carregarFio(grupoId: string): Promise<FioDoGrupo> {
  const supabase = createClient();
  const [mensagens, participantes, pedidos] = await Promise.all([
    supabase
      .from('wa_grupo_mensagens')
      .select(COLUNAS_DA_MENSAGEM)
      .eq('grupo_id', grupoId)
      .order('created_at', { ascending: false })
      .limit(TETO_DE_MENSAGENS),
    supabase
      .from('wa_grupo_participantes')
      .select('wa_id, nome, entrou_em, saiu_em')
      .eq('grupo_id', grupoId)
      .order('entrou_em', { ascending: true, nullsFirst: false }),
    supabase
      .from('wa_grupo_pedidos')
      .select('pedido_id, wa_id, criado_em, decisao')
      .eq('grupo_id', grupoId)
      .is('decisao', null)
      .order('criado_em', { ascending: true }),
  ]);
  const erro = mensagens.error ?? participantes.error ?? pedidos.error;
  if (erro) throw erroDaLeitura(erro);
  const lidas = (mensagens.data ?? []) as MensagemDoGrupoCrua[];
  return {
    mensagens: lidas.slice().reverse(),
    participantes: (participantes.data ?? []) as ParticipanteCru[],
    pedidos: (pedidos.data ?? []) as PedidoCru[],
    cortado: lidas.length >= TETO_DE_MENSAGENS,
  };
}

/** Os últimos pedidos à Meta deste grupo. `wa_acoes` não está no Realtime: a tela sonda. */
export async function carregarAcoes(grupoId: string): Promise<AcaoCrua[]> {
  const { data, error } = await createClient()
    .from('wa_acoes')
    .select('id, tipo, estado, erro, pedida_em, feita_em')
    .eq('grupo_id', grupoId)
    .order('pedida_em', { ascending: false })
    .limit(30);
  // Sem leitura da fila a tela continua de pé: só não diz "esperando a Meta".
  if (error) return [];
  return (data ?? []) as AcaoCrua[];
}

/**
 * Chama uma função `grupo_*` e devolve o corpo dela, ou lança `ErroDoGrupo` com
 * a frase do motivo. Erro de rede vira a frase genérica.
 */
export async function pedir<T extends Record<string, unknown> = Record<string, unknown>>(
  funcao: string,
  argumentos: Record<string, unknown>,
): Promise<T & { ok: true }> {
  const { data, error } = await createClient().rpc(funcao, argumentos);
  if (error) {
    console.error(`grupos: ${funcao} falhou`, error.code, error.message);
    throw new ErroDoGrupo(error.code === '42501' ? 'sem_permissao' : '');
  }
  const r = (data ?? {}) as { ok?: boolean; motivo?: string };
  if (r.ok !== true) throw new ErroDoGrupo(r.motivo ?? '');
  return r as T & { ok: true };
}

/** As conversas 1:1 para onde o convite pode ir: as mais recentes, ou as que batem com a busca. */
export async function procurarConversas(texto: string): Promise<ConversaParaConvite[]> {
  const supabase = createClient();
  let consulta = supabase
    .from('conversations')
    .select('id, peer_nome, peer_phone_e164, last_inbound_at, window_expires_at')
    .is('arquivada_em', null)
    .order('last_inbound_at', { ascending: false, nullsFirst: false })
    .limit(30);
  const termo = texto.trim();
  if (termo !== '') {
    const digitos = termo.replace(/\D/g, '');
    consulta =
      digitos.length >= 4
        ? consulta.ilike('peer_phone_e164', `%${digitos}%`)
        : consulta.ilike('peer_nome', `%${escaparCuringas(termo)}%`);
  }
  const { data, error } = await consulta;
  if (error) throw erroDaLeitura(error);
  return (data ?? []) as ConversaParaConvite[];
}

/** Os parceiros que batem com o nome, para ligar o grupo a uma ficha. */
export async function procurarParceiros(texto: string): Promise<{ id: string; nome: string }[]> {
  const termo = normalizarBusca(texto);
  if (termo.length < 2) return [];
  const { data, error } = await createClient()
    .from('organizations_view')
    .select('id, name')
    .is('deleted_at', null)
    .ilike('search_name', `%${escaparCuringas(termo)}%`)
    .order('name')
    .limit(8);
  if (error) throw erroDaLeitura(error);
  return ((data ?? []) as { id: string; name: string | null }[]).map((p) => ({
    id: p.id,
    nome: p.name ?? 'Parceiro sem nome',
  }));
}

export async function nomeDoParceiro(id: string): Promise<string | null> {
  const { data } = await createClient()
    .from('organizations_view')
    .select('name')
    .eq('id', id)
    .maybeSingle();
  return (data as { name: string | null } | null)?.name ?? null;
}

/**
 * A URL assinada de um arquivo do grupo (de uma mensagem ou a capa). `null` é
 * estado, não falha: o worker ainda não baixou o arquivo, ou o grupo não tem capa.
 */
export async function urlDoArquivo(
  alvo: { mensagemId: string } | { grupoId: string },
): Promise<string | null> {
  try {
    const resposta = await fetch('/api/grupos/midia-url', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(
        'mensagemId' in alvo ? { mensagem_id: alvo.mensagemId } : { grupo_id: alvo.grupoId },
      ),
    });
    if (!resposta.ok) return null;
    const dados = (await resposta.json()) as { ok?: boolean; url?: string };
    return dados.ok && typeof dados.url === 'string' ? dados.url : null;
  } catch {
    return null;
  }
}
