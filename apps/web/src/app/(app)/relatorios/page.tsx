import type { Metadata } from 'next';

import { requireRole } from '@/lib/auth/session';
import { PAPEIS_DO_CRM, temPoderDeGestao } from '@/lib/navegacao';
import { ProvedorConsultas } from '@/components/consultas/provedor-consultas';
import { hojeEmNatal, periodoDaUrl, semanaDaUrl } from '@/components/relatorios/periodo';
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
 * recorte de quem mandou. O relatório de segunda carrega `semana=aaaa-mm-dd` em vez
 * de período: é a leitura que mais se manda para alguém.
 */
export default async function Pagina({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  // Admin, gestor e SDR (de 06/10 a 20/10/2026 foi só a gestão). Os papéis antigos ficam fora.
  const [sessao, params] = await Promise.all([requireRole(...PAPEIS_DO_CRM), searchParams]);

  return (
    <ProvedorConsultas>
      <TelaRelatorios
        painelInicial={painelDaUrl(params.painel)}
        periodoInicial={periodoDaUrl(params, hojeEmNatal())}
        semanaInicial={semanaDaUrl(params.semana)}
        // `relatorio_semanal_gerar` confere `app.is_manager()`: admin, gestor e SDR.
        podeGerarSemana={temPoderDeGestao(sessao.papel)}
      />
    </ProvedorConsultas>
  );
}
