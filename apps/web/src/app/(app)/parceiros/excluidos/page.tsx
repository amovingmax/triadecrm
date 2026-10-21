import type { Metadata } from 'next';

import { requireRole } from '@/lib/auth/session';
import { PAPEIS_DO_CRM } from '@/lib/navegacao';
import { TelaExcluidos } from '@/components/parceiros/tela-excluidos';

export const metadata: Metadata = { title: 'Parceiros excluídos' };

/**
 * Os parceiros que saíram da base, e a porta de volta (07/10/2026).
 *
 * Excluir um parceiro não apaga nada: tira de circulação
 * (`public.parceiro_excluir`). Esta é a tela que torna isso verdade para quem
 * usa — sem ela, "dá para restaurar" seria uma promessa sem botão.
 *
 * Admin, gestor e SDR (o SDR desde 21/10/2026): são os mesmos que excluem, e
 * `public.parceiros_excluidos` recusa qualquer outro papel. O provedor de consultas vem do `layout` de
 * `/parceiros`, que esta rota herda.
 */
export default async function Pagina() {
  await requireRole(...PAPEIS_DO_CRM);
  return <TelaExcluidos />;
}
