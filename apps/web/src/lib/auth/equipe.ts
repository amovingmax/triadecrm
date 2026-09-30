import 'server-only';

import { createClient } from '@/lib/supabase/server';

import { acompanhaEquipe, pessoasAcompanhadas, type PessoaAcompanhada } from './hierarquia';
import { isAppRole } from './role';
import type { Sessao } from './session';

/**
 * A lista do seletor de pessoa (Meu dia, Agenda, Metas), montada pela hierarquia de
 * `hierarquia.ts`: a própria pessoa e quem ela acompanha.
 *
 * Lê `team_directory`, a view sem PII com nome e papel do time (a mesma dos filtros
 * de Parceiros), só com quem está ativo. Para quem não acompanha ninguém nem vai ao
 * banco. Se a leitura falhar, a lista volta só com a própria pessoa: a tela abre no
 * dia de quem entrou, que é o que ela abriria de qualquer jeito.
 */
export async function carregarPessoasAcompanhadas(
  sessao: Pick<Sessao, 'id' | 'nome' | 'papel'>,
): Promise<PessoaAcompanhada[]> {
  const eu = { id: sessao.id, nome: sessao.nome, papel: sessao.papel };
  if (!acompanhaEquipe(sessao.papel)) return [eu];

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('team_directory')
    .select('id, full_name, role')
    .eq('is_active', true);
  if (error || !data) return [eu];

  const time = data.flatMap((linha) =>
    linha.id
      ? [
          {
            id: linha.id,
            nome: linha.full_name ?? 'Sem nome',
            papel: isAppRole(linha.role) ? linha.role : null,
          },
        ]
      : [],
  );
  return pessoasAcompanhadas(eu, time);
}
