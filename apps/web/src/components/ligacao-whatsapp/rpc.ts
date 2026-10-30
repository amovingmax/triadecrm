'use client';

import { createClient } from '@/lib/supabase/client';

import type { EstadoDaChamada, EstadoNaConversa } from './logica';

export type ChamadaNoBanco = {
  id: string;
  conversation_id: string;
  direcao: 'recebida' | 'feita';
  estado: EstadoDaChamada;
  quem: string;
  oferta_sdp: string | null;
  resposta_sdp: string | null;
  feita_por: string | null;
  atendida_por: string | null;
  tocou_em: string;
  atendida_em: string | null;
  encerrada_em: string | null;
  duracao_seg: number | null;
};

export const COLUNAS_DA_CHAMADA =
  'id, conversation_id, direcao, estado, quem, oferta_sdp, resposta_sdp, feita_por, atendida_por, tocou_em, atendida_em, encerrada_em, duracao_seg';

type Resposta = { ok: boolean; motivo?: string };

/** O banco ou a Meta disseram não: `mensagem` já é a frase da tela, quando veio pronta. */
export class ErroDaLigacao extends Error {
  constructor(
    readonly motivo: string | undefined,
    readonly frase: string | null = null,
  ) {
    super(frase ?? motivo ?? 'erro da ligação');
    this.name = 'ErroDaLigacao';
  }
}

export async function lerEstadoNaConversa(conversaId: string): Promise<EstadoNaConversa> {
  const { data, error } = await createClient().rpc('wa_ligacao_estado', {
    p_conversation_id: conversaId,
  });
  if (error) throw new ErroDaLigacao(undefined);
  return data as unknown as EstadoNaConversa;
}

export async function pedirPermissao(conversaId: string, texto: string): Promise<void> {
  const { data, error } = await createClient().rpc('wa_permissao_pedir', {
    p_conversation_id: conversaId,
    p_texto: texto,
  });
  if (error) throw new ErroDaLigacao(undefined);
  const r = data as unknown as Resposta;
  if (!r.ok) throw new ErroDaLigacao(r.motivo);
}

export async function abrirChamada(conversaId: string): Promise<string> {
  const { data, error } = await createClient().rpc('wa_chamada_abrir', {
    p_conversation_id: conversaId,
  });
  if (error) throw new ErroDaLigacao(undefined);
  const r = data as unknown as Resposta & { chamada_id?: string };
  if (!r.ok || !r.chamada_id) throw new ErroDaLigacao(r.motivo);
  return r.chamada_id;
}

/** Reserva a ligação recebida. Devolve a oferta da Meta. */
export async function reservarChamada(chamadaId: string): Promise<string> {
  const { data, error } = await createClient().rpc('wa_chamada_atender', {
    p_chamada_id: chamadaId,
  });
  if (error) throw new ErroDaLigacao(undefined);
  const r = data as unknown as Resposta & { oferta_sdp?: string | null };
  if (!r.ok) throw new ErroDaLigacao(r.motivo);
  if (!r.oferta_sdp) throw new ErroDaLigacao('ja_atendida');
  return r.oferta_sdp;
}

export async function soltarChamada(chamadaId: string): Promise<void> {
  await createClient().rpc('wa_chamada_soltar', { p_chamada_id: chamadaId });
}

export async function lerChamada(chamadaId: string): Promise<ChamadaNoBanco | null> {
  const { data } = await createClient()
    .from('wa_chamadas')
    .select(COLUNAS_DA_CHAMADA)
    .eq('id', chamadaId)
    .maybeSingle();
  return (data as ChamadaNoBanco | null) ?? null;
}

/** As ligações recebidas que estão tocando agora: a reserva, se o Realtime faltar. */
export async function lerTocando(desde: Date): Promise<ChamadaNoBanco[]> {
  const { data } = await createClient()
    .from('wa_chamadas')
    .select(COLUNAS_DA_CHAMADA)
    .eq('direcao', 'recebida')
    .eq('estado', 'tocando')
    .gte('tocou_em', desde.toISOString());
  return (data as ChamadaNoBanco[] | null) ?? [];
}

/** A Edge Function que fala com a Meta. O corpo da recusa traz a frase pronta. */
export async function pedirAoServidor(
  acao: 'pre_aceitar' | 'aceitar' | 'ligar' | 'encerrar',
  chamadaId: string,
  sdp?: string,
): Promise<void> {
  const { data, error } = await createClient().functions.invoke<Resposta>('wa-chamada', {
    method: 'POST',
    body: { acao, chamada_id: chamadaId, ...(sdp ? { sdp } : {}) },
  });
  if (error) {
    let frase: string | null = null;
    let codigo: string | undefined;
    const resposta = (error as { context?: unknown }).context;
    if (resposta instanceof Response) {
      try {
        const corpo = (await resposta.json()) as { mensagem?: string; codigo?: string };
        if (typeof corpo.mensagem === 'string') frase = corpo.mensagem;
        if (typeof corpo.codigo === 'string') codigo = corpo.codigo;
      } catch {
        // corpo ilegível: fica a frase genérica
      }
    }
    throw new ErroDaLigacao(codigo, frase);
  }
  if (data && data.ok === false) throw new ErroDaLigacao(data.motivo);
}
