import type { Metadata } from 'next';

import { requireSession } from '@/lib/auth/session';
import { createClient } from '@/lib/supabase/server';
import { hojeEmNatal } from '@/components/metas/periodo';
import { TelaMetas } from '@/components/metas/tela-metas';
import { PAPEIS_QUE_DEFINEM_META, type Pessoa } from '@/components/metas/tipos';

export const metadata: Metadata = { title: 'Metas' };

/**
 * Metas (RF-MET-01/02; anexo R07 §3).
 *
 * O servidor resolve três coisas antes de a tela abrir: quem entrou, quais pessoas
 * podem aparecer e que dia é hoje em Natal.
 *
 * A lista de pessoas depende do papel, e isso espelha o que o Postgres já faz:
 * `public.goal_progress` recusa a meta de outra pessoa para quem não é gestor nem
 * admin ("Só gestor ou admin lê a meta de outra pessoa", 42501). Pedir e receber o
 * erro funcionaria, mas encheria a tela de cartões vermelhos por desenho — então a
 * tela só monta o que a RLS deixa passar.
 *
 * `hoje` sai do servidor, e não de um `new Date()` no navegador: assim o HTML do
 * servidor e o do cliente são iguais na primeira renderização, mesmo perto da
 * meia-noite, e o fuso é sempre America/Fortaleza (CLAUDE.md).
 */
export default async function Pagina() {
  const sessao = await requireSession();
  const podeDefinir = PAPEIS_QUE_DEFINEM_META.includes(sessao.papel);

  let pessoas: Pessoa[] = [{ id: sessao.id, nome: sessao.nome }];

  if (podeDefinir) {
    const supabase = await createClient();
    // `team_directory` é a view sem PII com os nomes do time (a mesma dos filtros
    // de Parceiros). Ordem alfabética: a tela acompanha, não classifica.
    const { data } = await supabase
      .from('team_directory')
      .select('id, full_name')
      .eq('is_active', true)
      .order('full_name');

    if (data && data.length > 0) {
      pessoas = data.map((linha) => ({ id: linha.id, nome: linha.full_name }));
    }
  }

  return (
    <TelaMetas pessoas={pessoas} euId={sessao.id} podeDefinir={podeDefinir} hoje={hojeEmNatal()} />
  );
}
