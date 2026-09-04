import { createClient } from '@/lib/supabase/server';

import type { CatalogosConversas } from './montagem';

/**
 * Catálogos da tela de Conversas, lidos no servidor e entregues prontos.
 *
 * São três listas pequenas e estáveis (o time, as 33 etapas dos funis e os 34 desfechos
 * do catálogo de interações) que a linha do tempo precisa para traduzir id em nome.
 * Buscá-las no cliente custaria três idas à rede antes de a primeira conversa aparecer,
 * e as políticas de RLS já liberam catálogo para qualquer usuário autenticado.
 *
 * `team_directory` é a view sem PII com os nomes do time: nunca `profiles` direto.
 */
export async function carregarCatalogos(): Promise<CatalogosConversas> {
  const supabase = await createClient();

  const [pessoas, etapas, funis, desfechos] = await Promise.all([
    supabase
      .from('team_directory')
      .select('id, full_name, is_active')
      .eq('is_active', true)
      .order('full_name'),
    supabase.from('stages').select('id, name, pipeline_id, position').order('position'),
    supabase.from('pipelines').select('id, name, position').order('position'),
    supabase.from('interaction_outcomes').select('id, name, position').order('position'),
  ]);

  const nomeDoFunil = new Map((funis.data ?? []).map((f) => [f.id, f.name]));

  return {
    pessoas: (pessoas.data ?? []).map((p) => ({ id: p.id, nome: p.full_name })),
    etapas: (etapas.data ?? []).map((e) => ({
      id: e.id,
      nome: e.name,
      funil: nomeDoFunil.get(e.pipeline_id) ?? 'Funil',
    })),
    desfechos: (desfechos.data ?? []).map((d) => ({ id: d.id, nome: d.name })),
  };
}
