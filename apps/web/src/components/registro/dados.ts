import { createClient } from '@/lib/supabase/server';

import {
  COLUNAS_DESFECHO,
  diaEmFortaleza,
  type DesfechoCatalogo,
  type EtapaAlvo,
  type Feriado,
  type MotivoPerda,
} from './tipos';

/**
 * O que o servidor entrega pronto para a tela de registrar contato.
 *
 * São quatro listas pequenas, estáveis e legíveis por qualquer papel autenticado
 * (`interaction_outcomes_select`, `lost_reasons_select`, `stages_select` e
 * `holidays_select` são todas `using (true)`). Buscá-las no cliente custaria quatro
 * idas à rede antes do primeiro chip aparecer — e esta é a tela que precisa estar
 * pronta no primeiro toque, no 4G da calçada.
 *
 * Nada aqui é lista fixa em código: o catálogo de desfechos é editável pelo gestor
 * (RF-ADM-02) e a tela desenha o que o banco devolver.
 */
export type ContextoDoRegistro = {
  /** Os 34 desfechos ativos, na ordem `position`. */
  catalogo: DesfechoCatalogo[];
  /** Motivos de perda da lista fechada (RF-FUN-04). */
  motivosPerda: MotivoPerda[];
  /** Todas as etapas dos três funis, para a previsão saber a temperatura do destino. */
  etapasAlvo: EtapaAlvo[];
  /** Feriados a partir de hoje, para a próxima ação não cair num dia sem expediente. */
  feriados: Feriado[];
  /**
   * Formatos de reunião aceitos por funil, lidos de `stages.required_fields`.
   *
   * Não é lista fixa em código porque não é a mesma em todo funil: o `fornecedor`
   * aceita `meet` e `visita`; o `produtor`, `meet_manha`, `cafe_ou_visita_tarde` e
   * `evento_demo_sabado`. Oferecer o formato errado faria o `move_deal` recusar por
   * `campos_obrigatorios` depois de a pessoa já ter respondido.
   */
  formatosDeReuniao: Record<number, string[]>;
};

export async function carregarContextoDoRegistro(): Promise<ContextoDoRegistro> {
  const supabase = await createClient();
  const hoje = diaEmFortaleza(new Date());

  const [desfechos, motivos, etapas, feriados] = await Promise.all([
    supabase
      .from('interaction_outcomes')
      .select(COLUNAS_DESFECHO)
      .eq('is_active', true)
      .order('position'),
    supabase.from('lost_reasons').select('id, slug, name').eq('is_active', true).order('position'),
    supabase
      .from('stages')
      .select('id, pipeline_id, slug, name, temperature, required_fields')
      .order('position'),
    // Um ano de feriados basta: a espera mais longa do catálogo é de 90 dias.
    supabase.from('holidays').select('date').gte('date', hoje).order('date').limit(60),
  ]);

  return {
    catalogo: (desfechos.data ?? []) as DesfechoCatalogo[],
    motivosPerda: (motivos.data ?? []) as MotivoPerda[],
    etapasAlvo: (etapas.data ?? []).map((e) => ({
      pipelineId: e.pipeline_id,
      slug: e.slug,
      nome: e.name,
      temperatura: e.temperature,
    })) satisfies EtapaAlvo[],
    feriados: (feriados.data ?? []).map((f) => f.date) satisfies Feriado[],
    formatosDeReuniao: formatosPorFunil(etapas.data ?? []),
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
