'use client';

import { z } from 'zod';

import { createClient } from '@/lib/supabase/client';

import { ehEstadoDaLinha, type EstadoDaLinha } from './voz-logica';

/**
 * A ponte entre a tela e o lado do banco da ligação pelo navegador
 * (migração 20261006090100) e a Edge Function `voz-token`.
 *
 * Mesma regra de `chamada-rpc.ts`: nenhum texto do Postgres chega à tela. Recusa
 * prevista volta nomeada (`{ok:false, motivo}`) e quem a traduz é `fraseDaRecusa`.
 *
 * O TELEFONE NÃO PASSA POR AQUI. A tela manda o parceiro ou a tentativa do lote; o
 * banco escolhe o número e o entrega ao provedor. Nenhuma função deste arquivo
 * devolve número, e `voice_calls.to_number` nem é legível por quem está logado.
 */

/** Chave de `app_settings` que liga a telefonia. Nasce `false`. */
const CHAVE_DA_TELEFONIA = 'voz.telefonia';

const aberturaSchema = z.discriminatedUnion('ok', [
  z.object({
    ok: z.literal(true),
    ligacao: z.object({
      id: z.string().uuid(),
      iniciada_em: z.string(),
      attempt_id: z.string().uuid().nullable(),
    }),
  }),
  z.object({
    ok: z.literal(false),
    motivo: z.string(),
    ligacao_id: z.string().uuid().nullable().optional(),
  }),
]);

export type AberturaDeVoz = z.infer<typeof aberturaSchema>;

export type LeituraDaLinha = {
  estado: EstadoDaLinha;
  atendidaEm: string | null;
  encerradaEm: string | null;
  duracaoSeg: number | null;
};

/** A telefonia está ligada? Erro de leitura conta como desligada: o modo manual segue valendo. */
export async function telefoniaLigada(): Promise<boolean> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from('app_settings')
    .select('value')
    .eq('key', CHAVE_DA_TELEFONIA)
    .maybeSingle();
  if (error || !data) return false;
  const valor = data.value;
  return (
    typeof valor === 'object' && valor !== null && !Array.isArray(valor) && valor.ativa === true
  );
}

/** Abre a chamada no banco. Um dos dois alvos, nunca os dois. */
export async function abrirLigacaoDeVoz(
  alvo: { organizationId: string } | { attemptId: string },
): Promise<AberturaDeVoz> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc(
    'voz_abrir_ligacao',
    'attemptId' in alvo
      ? { p_attempt_id: alvo.attemptId }
      : { p_organization_id: alvo.organizationId },
  );
  if (error) {
    console.error('[voz] abrir', error);
    return { ok: false, motivo: error.code === '42501' ? 'sem_permissao' : 'falha' };
  }
  const lido = aberturaSchema.safeParse(data);
  return lido.success ? lido.data : { ok: false, motivo: 'falha' };
}

/** A tela dá a própria chamada por encerrada. Falhar aqui não pode travar a tela. */
export async function encerrarLigacaoDeVoz(
  id: string,
  opcoes: { codigo?: string | null; falha?: boolean } = {},
): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase.rpc('voz_encerrar_ligacao', {
    p_call_id: id,
    p_codigo: opcoes.codigo ?? undefined,
    p_falha: opcoes.falha ?? false,
  });
  if (error) console.error('[voz] encerrar', error);
}

/** O que o provedor já avisou sobre a linha. `null` quando não deu para ler. */
export async function lerLinha(id: string): Promise<LeituraDaLinha | null> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from('voice_calls')
    .select('status, atendida_em, encerrada_em, duracao_seg')
    .eq('id', id)
    .maybeSingle();
  if (error || !data || !ehEstadoDaLinha(data.status)) return null;
  return {
    estado: data.status,
    atendidaEm: data.atendida_em,
    encerradaEm: data.encerrada_em,
    duracaoSeg: data.duracao_seg,
  };
}

/** Liga a chamada à atividade que a tabulação criou. */
export async function vincularAtividade(id: string, activityId: string): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase.rpc('voz_vincular_atividade', {
    p_call_id: id,
    p_activity_id: activityId,
  });
  if (error) console.error('[voz] vincular', error);
}

export class ErroDeCredencial extends Error {
  constructor(readonly motivo: string) {
    super(motivo);
    this.name = 'ErroDeCredencial';
  }
}

/**
 * Pede a credencial temporária do softphone. Só o token sai daqui; os segredos do
 * provedor ficam na Edge Function.
 */
export async function pedirCredencial(): Promise<string> {
  const supabase = createClient();
  const { data, error } = await supabase.functions.invoke<{
    ok: boolean;
    token?: string;
    codigo?: string;
  }>('voz-token', { method: 'POST' });

  if (error) {
    // Recusa prevista vem com corpo JSON e status ≠ 2xx: o motivo está no corpo.
    let motivo = 'falha';
    const resposta = (error as { context?: unknown }).context;
    if (resposta instanceof Response) {
      try {
        const corpo = (await resposta.json()) as { codigo?: string };
        if (typeof corpo.codigo === 'string') motivo = corpo.codigo;
      } catch {
        // corpo ilegível: fica a frase genérica
      }
    }
    throw new ErroDeCredencial(motivo);
  }
  if (!data?.ok || typeof data.token !== 'string') {
    throw new ErroDeCredencial(data?.codigo ?? 'falha');
  }
  return data.token;
}
