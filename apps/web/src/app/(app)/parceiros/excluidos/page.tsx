import type { Metadata } from 'next';

import { requireRole } from '@/lib/auth/session';
import { TelaExcluidos } from '@/components/parceiros/tela-excluidos';

export const metadata: Metadata = { title: 'Parceiros excluídos' };

/**
 * Os parceiros que saíram da base, e a porta de volta (07/10/2026).
 *
 * Excluir um parceiro não apaga nada: tira de circulação
 * (`public.parceiro_excluir`). Esta é a tela que torna isso verdade para quem
 * usa — sem ela, "dá para restaurar" seria uma promessa sem botão.
 *
 * Só admin e gestor: são os mesmos que excluem, e `public.parceiros_excluidos`
 * recusa qualquer outro papel. O provedor de consultas vem do `layout` de
 * `/parceiros`, que esta rota herda.
 */
export default async function Pagina() {
  await requireRole('admin', 'gestor');
  return <TelaExcluidos />;
}
