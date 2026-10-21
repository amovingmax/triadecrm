import 'server-only';

import { cache } from 'react';

import { OUTRAS_EMPRESAS_DO_SELETOR } from '@/lib/empresa';
import { createClient } from '@/lib/supabase/server';

/**
 * A quais outras empresas a pessoa logada também tem acesso. É o que decide se ela vê
 * o botão de trocar de empresa (`destinosDaPessoa` em `lib/empresa.ts`); quem marca é o
 * admin, em Ajustes → Pessoas (migração 20261022110000).
 *
 * Sem outra empresa configurada neste site, nem pergunta ao banco. Erro, sessão ausente
 * ou banco ainda sem a função viram "nenhuma": na dúvida, o botão some — ele só leva a
 * outro endereço, e quem decide se a pessoa entra lá é a lista de permitidos de lá.
 */
export const lerMinhasOutrasEmpresas = cache(async (): Promise<string[]> => {
  if (OUTRAS_EMPRESAS_DO_SELETOR.length === 0) return [];
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('minhas_outras_empresas');
  if (error || !Array.isArray(data)) return [];
  return data;
});
