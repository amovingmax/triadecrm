/**
 * Ajustes → Inteligência de mercado: o que a tela lê e grava (19/11/2026, só na Imova).
 *
 * Leitura direta das tabelas, que a RLS abre para a equipe (`app.is_manager()`):
 * `mercado_fontes`, `mercado_coletas`, `app_settings` e `worker_heartbeats`, mais a
 * saúde das fontes (`public.mercado_saude_fontes`). Gravação só pelas duas funções
 * do banco, que conferem `app.admin_ou_gestor()` e gravam no `audit_log`:
 *   - `public.mercado_coleta_ligar(p_ligar, p_motivo)` (migração 20261119170000);
 *   - `public.mercado_fonte_liberar(p_fonte, p_liberar, p_motivo)` (20261119160000).
 *
 * As gravações NUNCA estouram por recusa do banco: devolvem `{ ok: false, motivo }`,
 * e a frase que a pessoa lê sai de `fraseDaRecusaDoMercado`. Nada do Postgres chega
 * à tela (a regra de `exclusao/acoes.ts`).
 */
import type { Database } from '@komune/schema/database.types';

import { createClient } from '@/lib/supabase/client';

import type {
  ChaveDaColeta,
  Coleta,
  DadosDoMercado,
  FonteDeMercado,
  SaudeDaFonte,
} from './mercado-regras';

export const CHAVE_DO_MERCADO = ['admin', 'mercado'] as const;

type Funcoes = Database['public']['Functions'];
type ArgsDeLigar = Funcoes['mercado_coleta_ligar']['Args'];
type ArgsDeLiberar = Funcoes['mercado_fonte_liberar']['Args'];

/** As coletas que bastam para achar a rodada mais recente (55 fontes, no máximo). */
const COLETAS_LIDAS = 120;

export async function carregarMercado(): Promise<DadosDoMercado> {
  const supabase = createClient();
  const [chave, fontes, coletas, robo, saude] = await Promise.all([
    supabase.from('app_settings').select('value').eq('key', 'mercado').maybeSingle(),
    supabase
      .from('mercado_fontes')
      .select(
        'id, nome, grupo, tipo_de_dado, veredito, condicoes, reconferir, liberada, liberada_por, liberada_em, liberada_motivo, pode_coletar, frequencia, coletor',
      )
      .order('id'),
    supabase
      .from('mercado_coletas')
      .select('fonte, inicio, fim, situacao')
      .order('inicio', { ascending: false })
      .limit(COLETAS_LIDAS),
    supabase
      .from('worker_heartbeats')
      .select('last_beat_at')
      .eq('worker', 'mercado')
      .order('last_beat_at', { ascending: false })
      .limit(1),
    supabase.rpc('mercado_saude_fontes'),
  ]);

  if (chave.error) throw new Error(chave.error.message);
  if (fontes.error) throw new Error(fontes.error.message);
  if (coletas.error) throw new Error(coletas.error.message);

  return {
    chave: (chave.data?.value ?? null) as ChaveDaColeta | null,
    fontes: (fontes.data ?? []) as unknown as FonteDeMercado[],
    coletas: (coletas.data ?? []) as unknown as Coleta[],
    // O sinal do robô e a saúde são complemento: sem eles a tela abre igual.
    roboUltimoSinal: robo.error
      ? null
      : (((robo.data ?? [])[0] as { last_beat_at?: string } | undefined)?.last_beat_at ?? null),
    saude: saude.error ? [] : ((saude.data ?? []) as unknown as SaudeDaFonte[]),
  };
}

export type ResultadoDoMercado = { ok: true; mudou: boolean } | { ok: false; motivo: string };

type Bruto = { ok?: unknown; motivo?: unknown; mudou?: unknown };

function lerResposta(data: unknown, error: { code?: string } | null): ResultadoDoMercado {
  // 42501: o banco recusou o papel (a tela só aparece para admin e gestor, mas o
  // papel pode ter mudado com a tela aberta).
  if (error) return { ok: false, motivo: error.code === '42501' ? 'sem_permissao' : 'erro' };
  const r = (data ?? {}) as Bruto;
  if (r.ok !== true) return { ok: false, motivo: typeof r.motivo === 'string' ? r.motivo : 'erro' };
  return { ok: true, mudou: r.mudou !== false };
}

export async function ligarColeta(ligar: boolean, motivo: string): Promise<ResultadoDoMercado> {
  const args: ArgsDeLigar = { p_ligar: ligar, p_motivo: motivo.trim() };
  const { data, error } = await createClient().rpc('mercado_coleta_ligar', args);
  return lerResposta(data, error);
}

export async function liberarFonte(
  fonte: string,
  liberar: boolean,
  motivo: string,
): Promise<ResultadoDoMercado> {
  const args: ArgsDeLiberar = { p_fonte: fonte, p_liberar: liberar, p_motivo: motivo.trim() };
  const { data, error } = await createClient().rpc('mercado_fonte_liberar', args);
  return lerResposta(data, error);
}
