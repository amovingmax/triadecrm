import type { Metadata } from 'next';

import { requireSession } from '@/lib/auth/session';
import { leTelefoneCompleto, podeCriarParceiro } from '@/lib/navegacao';
import { carregarCatalogos } from '@/components/parceiros/catalogos';
import { TelaParceiros } from '@/components/parceiros/tela-parceiros';
import { filtrosDaUrl } from '@/components/parceiros/tipos';

export const metadata: Metadata = { title: 'Parceiros' };

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
    requireSession(),
    carregarCatalogos(),
    searchParams,
  ]);

  const podeCriar = podeCriarParceiro(sessao.papel);

  return (
    <TelaParceiros
      catalogos={catalogos}
      filtrosIniciais={filtrosDaUrl(params)}
      podeCriar={podeCriar}
      leTelefoneCompleto={leTelefoneCompleto(sessao.papel)}
      abrirCadastro={podeCriar && params.novo === '1'}
    />
  );
}
