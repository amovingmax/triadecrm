import { createClient } from '@/lib/supabase/server';
import {
  COLUNAS_DESFECHO,
  diaEmFortaleza,
  type EtapaAlvo,
  type Feriado,
  type MotivoPerda,
} from '@/components/registro/tipos';

import {
  COLUNAS_DO_LOTE,
  loteDaLinha,
  type ContextoDaLigacao,
  type LinhaDeLote,
} from './chamada-contexto';
import { type DesfechoDeLigacao } from './tipos';

/**
 * O que o servidor entrega pronto para a tela de ligar (R13 §3).
 *
 * A regra é a mesma da `/registrar`: listas pequenas, estáveis e legíveis por
 * qualquer papel autenticado vêm do servidor, para o primeiro toque não esperar oito
 * idas à rede. Tudo que muda de segundo em segundo (o próximo da fila, a chamada, a
 * tabulação) roda no cliente, pelas RPCs, sob a mesma RLS.
 *
 * Nada de telefone passa por aqui: `call_batch_items.phone_e164` nem sequer é legível
 * por PostgREST (a migração 001300 devolveu o `select` coluna a coluna, sem ela).
 * Quem revela o número é `proximo_da_fila`, com registro em `pii_access_log`, e isso
 * acontece no cliente, na hora de ligar.
 */

/** Os dois funis de captação. `ativacao` (id 2) é pós-venda e não entra em lote. */
const FUNIS_DE_LIGACAO: readonly string[] = ['fornecedor', 'produtor'];

export async function carregarContextoDaLigacao(): Promise<ContextoDaLigacao> {
  const supabase = await createClient();
  const hoje = diaEmFortaleza(new Date());

  const [desfechos, motivos, etapas, feriados, funis, roteiros, categorias, lotes] =
    await Promise.all([
      supabase
        .from('interaction_outcomes')
        .select(`${COLUNAS_DESFECHO}, requires_answer`)
        .eq('is_active', true)
        .contains('surfaces', ['ligacao'])
        .order('position'),
      supabase
        .from('lost_reasons')
        .select('id, slug, name')
        .eq('is_active', true)
        .order('position'),
      supabase
        .from('stages')
        .select('id, pipeline_id, slug, name, temperature, required_fields')
        .order('position'),
      // A janela de ligação não abre em feriado (R13 §6); dois meses bastam para a
      // contagem regressiva da próxima abertura.
      supabase.from('holidays').select('date').gte('date', hoje).order('date').limit(60),
      supabase.from('pipelines').select('id, slug, name').order('position'),
      supabase
        .from('call_scripts')
        .select('id, slug, nome, versao')
        .eq('is_published', true)
        .order('nome'),
      supabase.from('categories').select('id, name').eq('is_active', true).order('position'),
      supabase
        .from('call_batches')
        .select(COLUNAS_DO_LOTE)
        .neq('status', 'encerrado')
        .gte('ends_on', hoje)
        .order('created_at', { ascending: false })
        .limit(20),
    ]);

  return {
    catalogo: (desfechos.data ?? []) as DesfechoDeLigacao[],
    motivosPerda: (motivos.data ?? []) as MotivoPerda[],
    etapasAlvo: (etapas.data ?? []).map((e) => ({
      pipelineId: e.pipeline_id,
      slug: e.slug,
      nome: e.name,
      temperatura: e.temperature,
    })) satisfies EtapaAlvo[],
    feriados: (feriados.data ?? []).map((f) => f.date) satisfies Feriado[],
    formatosDeReuniao: formatosPorFunil(etapas.data ?? []),
    funis: (funis.data ?? [])
      .filter((p) => FUNIS_DE_LIGACAO.includes(p.slug))
      .map((p) => ({ id: p.id, slug: p.slug, nome: p.name })),
    roteiros: (roteiros.data ?? []).map((r) => ({
      id: r.id,
      slug: r.slug,
      nome: r.nome,
      versao: r.versao,
    })),
    categorias: (categorias.data ?? []).map((c) => ({ id: c.id, nome: c.name })),
    lotes: ((lotes.data ?? []) as LinhaDeLote[]).map(loteDaLinha),
  };
}

/** Extrai as opções de `meeting_format` que cada funil declara nas etapas dele. */
function formatosPorFunil(
  etapas: readonly { pipeline_id: number; required_fields: unknown }[],
): Record<number, string[]> {
  const mapa: Record<number, string[]> = {};
  for (const etapa of etapas) {
    if (!Array.isArray(etapa.required_fields)) continue;
    for (const campo of etapa.required_fields) {
      if (typeof campo !== 'object' || campo === null) continue;
      const spec = campo as { field?: unknown; options?: unknown };
      if (spec.field !== 'meeting_format' || !Array.isArray(spec.options)) continue;
      mapa[etapa.pipeline_id] = spec.options.filter((o): o is string => typeof o === 'string');
    }
  }
  return mapa;
}
