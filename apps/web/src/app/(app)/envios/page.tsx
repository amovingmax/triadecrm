import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { requireSession } from '@/lib/auth/session';
import { carregarCatalogos } from '@/components/parceiros/catalogos';
import { TelaEnvios } from '@/components/envios/tela-envios';

export const metadata: Metadata = { title: 'Campanhas' };

/**
 * Campanhas: envios em massa pelo WhatsApp (decisão do Rafael, 21/09/2026).
 *
 * Só admin e gestor: um lote mal montado derruba a nota do número de todo o
 * time. A autorização de verdade é do Postgres (`app.is_manager()` em toda
 * RPC); aqui só não se oferece a tela a quem o banco recusaria.
 */
export default async function Pagina() {
  const [sessao, catalogos] = await Promise.all([requireSession(), carregarCatalogos()]);
  if (sessao.papel !== 'admin' && sessao.papel !== 'gestor') redirect('/sem-permissao');
  return <TelaEnvios catalogos={catalogos} />;
}
