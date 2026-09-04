import type { Metadata } from 'next';

import { requireRole } from '@/lib/auth/session';
import { ProvedorConsultas } from '@/components/consultas/provedor-consultas';
import { hojeEmNatal, periodoDaUrl } from '@/components/relatorios/periodo';
import { TelaRelatorios } from '@/components/relatorios/tela-relatorios';
import { painelDaUrl } from '@/components/relatorios/tipos';

export const metadata: Metadata = { title: 'Relatórios' };

/**
 * Relatórios (RF-REL-01 a RF-REL-11).
 *
 * O papel é conferido aqui só para não mostrar uma tela que nunca vai carregar: a
 * autorização de verdade está nas próprias funções do banco, que recusam quem não
 * passa por `app.sees_all()` — hoje isso deixa de fora o embaixador (que enxerga a
 * própria carteira, RF-ADM-01) e o robô.
 *
 * O período inicial vem da query string, para que um link de relatório abra no mesmo
 * recorte de quem mandou.
 */
export default async function Pagina({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [, params] = await Promise.all([
    requireRole('admin', 'gestor', 'sdr', 'leitura', 'financeiro'),
    searchParams,
  ]);

  return (
    <ProvedorConsultas>
      <TelaRelatorios
        painelInicial={painelDaUrl(params.painel)}
        periodoInicial={periodoDaUrl(params, hojeEmNatal())}
      />
    </ProvedorConsultas>
  );
}
