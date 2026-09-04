import { createClient } from '@/lib/supabase/server';

import type { CatalogosDoRadar } from './tipos';

/**
 * Catálogos do Radar, lidos no servidor e entregues prontos à tela.
 *
 * São três listas pequenas e estáveis (19 categorias, 22 cidades, 11 fontes) que
 * alimentam o recorte da fila e o formulário de entrada manual. Buscá-las no
 * cliente custaria três idas à rede antes de a fila aparecer. A RLS já libera
 * catálogo para todo usuário autenticado.
 *
 * As fontes vêm TODAS, ligadas ou não: o filtro precisa das desligadas para achar
 * candidato antigo, e o formulário mostra a desligada em cinza, em vez de fingir
 * que ela não existe.
 */
export async function carregarCatalogosDoRadar(): Promise<CatalogosDoRadar> {
  const supabase = await createClient();

  const [categorias, cidades, fontes] = await Promise.all([
    supabase
      .from('categories')
      .select('id, slug, name, group')
      .eq('is_active', true)
      .order('position')
      .order('name'),
    supabase
      .from('cities')
      .select('id, name, is_metro_natal')
      .order('is_metro_natal', { ascending: false })
      .order('name'),
    supabase.from('sources').select('id, name, is_enabled').order('id'),
  ]);

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
      grandeNatal: c.is_metro_natal,
    })),
    origens: (fontes.data ?? []).map((f) => ({
      id: f.id,
      nome: f.name,
      ligada: f.is_enabled,
    })),
  };
}
