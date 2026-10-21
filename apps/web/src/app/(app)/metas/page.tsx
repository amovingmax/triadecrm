import type { Metadata } from 'next';

import { carregarPessoasAcompanhadas } from '@/lib/auth/equipe';
import { requireRole } from '@/lib/auth/session';
import { PAPEIS_DO_CRM } from '@/lib/navegacao';
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
 * `public.goal_progress` recusa a meta de outra pessoa para quem não passa em
 * `app.is_manager()` (admin, gestor e, desde 21/10/2026, SDR). Pedir e receber o
 * erro funcionaria, mas encheria a tela de cartões vermelhos por desenho — então a
 * tela só monta o que a RLS deixa passar.
 *
 * `hoje` sai do servidor, e não de um `new Date()` no navegador: assim o HTML do
 * servidor e o do cliente são iguais na primeira renderização, mesmo perto da
 * meia-noite, e o fuso é sempre America/Fortaleza (CLAUDE.md).
 */
export default async function Pagina() {
  // Admin, gestor e SDR (de 06/10 a 20/10/2026 foi só a gestão). Os papéis antigos ficam fora.
  const sessao = await requireRole(...PAPEIS_DO_CRM);
  const podeDefinir = PAPEIS_QUE_DEFINEM_META.includes(sessao.papel);

  // A própria pessoa e quem ela acompanha pela hierarquia (`lib/auth/hierarquia.ts`):
  // o admin vê gestor, SDR e embaixador; o gestor e o SDR, SDR e embaixador. Depois da
  // própria pessoa, ordem alfabética: a tela acompanha, não classifica.
  const pessoas: Pessoa[] = podeDefinir
    ? await carregarPessoasAcompanhadas(sessao)
    : [{ id: sessao.id, nome: sessao.nome }];

  return (
    <TelaMetas pessoas={pessoas} euId={sessao.id} podeDefinir={podeDefinir} hoje={hojeEmNatal()} />
  );
}
