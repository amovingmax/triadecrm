import { createClient } from '@/lib/supabase/client';

import {
  fraseDoErroAoConfigurar,
  lerPainel,
  type PainelDoLembrete,
} from './lembrete-de-visita-regras';

/**
 * As leituras e gravações de Ajustes → WhatsApp → Lembrete da visita (11/11/2026,
 * só na Imova). Tudo por função do banco, que confere o papel (admin e gestor):
 * `lembrete_de_visita_painel`, `lembrete_de_visita_configurar` e
 * `lembrete_de_visita_modelo_para_a_meta`.
 */

export const CHAVE_DO_LEMBRETE = ['admin', 'whatsapp', 'lembrete-de-visita'] as const;

function motivo(dados: unknown): string | null {
  if (typeof dados !== 'object' || dados === null) return null;
  const m = (dados as { motivo?: unknown }).motivo;
  return typeof m === 'string' ? m : null;
}
function ok(dados: unknown): boolean {
  return typeof dados === 'object' && dados !== null && (dados as { ok?: unknown }).ok === true;
}

export async function carregarLembrete(): Promise<PainelDoLembrete> {
  const { data, error } = await createClient().rpc('lembrete_de_visita_painel');
  if (error || !ok(data)) throw new Error('Não deu para ler o lembrete da visita.');
  return lerPainel(data);
}

export async function mudarLembrete(mudanca: { ligado?: boolean; hora?: string }): Promise<void> {
  const { data, error } = await createClient().rpc('lembrete_de_visita_configurar', {
    p: mudanca,
  });
  if (error) throw new Error(fraseDoErroAoConfigurar(null));
  if (!ok(data)) throw new Error(fraseDoErroAoConfigurar(motivo(data)));
}

export async function mandarModeloParaAMeta(): Promise<void> {
  const { data, error } = await createClient().rpc('lembrete_de_visita_modelo_para_a_meta');
  if (error) throw new Error(fraseDoErroAoConfigurar(null));
  if (!ok(data)) throw new Error(fraseDoErroAoConfigurar(motivo(data)));
}
