import type { Metadata } from 'next';

import { requireRole } from '@/lib/auth/session';
import { PAPEIS_DO_CRM } from '@/lib/navegacao';
import { ProvedorConsultas } from '@/components/consultas/provedor-consultas';
import { TelaFunis } from '@/components/funis/acoes/tela-funis';
import { filtrosQuadroDaUrl } from '@/components/funis/tipos';

export const metadata: Metadata = { title: 'Funis' };

/**
 * Quadro dos funis (RF-FUN-01 a RF-FUN-04, RF-FUN-08).
 *
 * O servidor faz duas coisas e sai da frente: exige sessão (o proxy já barra antes;
 * aqui é a segunda camada) e traduz a query string no recorte inicial, para que um
 * link de quadro filtrado — mandado no grupo do time — abra já filtrado. O quadro em
 * si é buscado no cliente, com TanStack Query, porque ele muda o dia inteiro e é
 * arrastado, movido e recarregado sem trocar de página.
 *
 * O provedor de consultas mora aqui, e não no layout raiz: só as telas que buscam no
 * cliente precisam dele, e a casca do app continua sendo servidor puro.
 */
export default async function Pagina({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  // Admin, gestor e SDR (de 06/10 a 20/10/2026 foi só a gestão). Os papéis antigos ficam fora.
  const [, params] = await Promise.all([requireRole(...PAPEIS_DO_CRM), searchParams]);

  return (
    <ProvedorConsultas>
      <TelaFunis filtrosIniciais={filtrosQuadroDaUrl(params)} />
    </ProvedorConsultas>
  );
}
