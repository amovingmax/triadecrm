import { createClient } from '@/lib/supabase/server';

import type { Catalogos } from './tipos';

/**
 * Catálogos dos filtros, lidos do banco no servidor e entregues prontos à tela.
 *
 * São listas pequenas e estáveis (19 categorias, 22 cidades, 33 etapas, o time e as
 * 11 origens): buscá-las no cliente custaria cinco idas à rede antes de a lista
 * aparecer. As políticas de RLS já liberam a leitura de catálogo para todo usuário
 * autenticado; `team_directory` é a view sem PII com os nomes do time.
 */
export async function carregarCatalogos(): Promise<Catalogos> {
  const supabase = await createClient();

  const [categorias, cidades, etapas, funis, pessoas, origens] = await Promise.all([
    supabase
      .from('categories')
      .select('id, slug, name, group')
      .eq('is_active', true)
      .order('position')
      .order('name'),
    supabase
      .from('cities')
      .select('id, name, state, is_metro_natal')
      .order('is_metro_natal', { ascending: false })
      .order('name'),
    supabase.from('stages').select('id, name, pipeline_id, position').order('position'),
    supabase.from('pipelines').select('id, name, position').order('position'),
    supabase
      .from('team_directory')
      .select('id, full_name, is_active')
      .eq('is_active', true)
      .order('full_name'),
    supabase.from('sources').select('id, name').eq('is_enabled', true).order('name'),
  ]);

  const nomeDoFunil = new Map((funis.data ?? []).map((f) => [f.id, f.name]));

  return {
    categorias: (categorias.data ?? []).map((c) => ({
      id: c.id,
      slug: c.slug,
      nome: c.name,
      grupo: c.group,
    })),
    cidades: (cidades.data ?? []).map((c) => ({
      id: c.id,
      nome: c.name,
      uf: c.state,
      grandeNatal: c.is_metro_natal,
    })),
    // Ordena por funil e depois pela posição da etapa: é a leitura do kanban.
    etapas: (etapas.data ?? [])
      .map((e) => ({
        id: e.id,
        nome: e.name,
        funil: nomeDoFunil.get(e.pipeline_id) ?? 'Funil',
        pipelineId: e.pipeline_id,
        posicao: e.position,
      }))
      .sort((a, b) => a.pipelineId - b.pipelineId || a.posicao - b.posicao)
      .map(({ id, nome, funil }) => ({ id, nome, funil })),
    pessoas: (pessoas.data ?? []).map((p) => ({ id: p.id, nome: p.full_name })),
    origens: (origens.data ?? []).map((o) => ({ id: o.id, nome: o.name })),
  };
}
