import type { Metadata } from 'next';

import { requireRole } from '@/lib/auth/session';
import {
  PAPEIS_DO_CRM,
  leTelefoneCompleto,
  podeCriarParceiro,
  podeExcluirParceiro,
  podeImportarPlanilha,
  podeMandarMensagemAutomatica,
  podeMarcarConsultoria,
} from '@/lib/navegacao';
import { carregarCatalogos } from '@/components/parceiros/catalogos';
import { TelaParceiros } from '@/components/parceiros/tela-parceiros';
import { filtrosDaUrl } from '@/components/parceiros/tipos';

export const metadata: Metadata = { title: 'Prospectados' };

/**
 * Lista de parceiros (RF-BAS-12, RF-BAS-14, RF-BAS-15).
 *
 * O servidor faz três coisas: lê os catálogos dos filtros (listas pequenas e estáveis,
 * que não valem cinco idas à rede depois que a página abre), traduz a query string no
 * recorte inicial (um link filtrado abre já filtrado) e resolve o papel de quem entrou.
 * A busca em si roda no cliente, com TanStack Query.
 *
 * `?novo=1` é o contrato com a paleta de comandos (`HREF_NOVO_PARCEIRO`): a paleta só
 * navega, quem abre a folha de cadastro rápido é esta tela.
 */
export default async function Pagina({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [sessao, catalogos, params] = await Promise.all([
    // Admin, gestor e SDR (de 06/10 a 20/10/2026 foi só a gestão). Os papéis antigos ficam fora.
    requireRole(...PAPEIS_DO_CRM),
    carregarCatalogos(),
    searchParams,
  ]);

  const podeCriar = podeCriarParceiro(sessao.papel);

  return (
    <TelaParceiros
      catalogos={catalogos}
      filtrosIniciais={filtrosDaUrl(params)}
      podeCriar={podeCriar}
      podeImportar={podeImportarPlanilha(sessao.papel)}
      podeSaudar={podeMandarMensagemAutomatica(sessao.papel)}
      podeMarcarConsultoria={podeMarcarConsultoria(sessao.papel)}
      veExcluidos={podeExcluirParceiro(sessao.papel)}
      leTelefoneCompleto={leTelefoneCompleto(sessao.papel)}
      abrirCadastro={podeCriar && params.novo === '1'}
    />
  );
}
