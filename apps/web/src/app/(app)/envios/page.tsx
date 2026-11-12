import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { requireSession } from '@/lib/auth/session';
import { temPoderDeGestao } from '@/lib/navegacao';
import { carregarCatalogos } from '@/components/parceiros/catalogos';
import { TelaEnvios } from '@/components/envios/tela-envios';

export const metadata: Metadata = { title: 'Disparos' };

/**
 * Disparos: envio em massa pelo WhatsApp (decisão do Rafael, 21/09/2026; de
 * volta ao menu em 12/11/2026, com o limite do dia sendo o da Meta).
 *
 * Admin, gestor e SDR, o mesmo conjunto de `app.is_manager()`, que toda RPC de
 * envio em massa confere: desde 21/10/2026 o SDR tem o poder do gestor fora de
 * Ajustes. Criar modelo novo continua só de admin e gestor (é catálogo, e o
 * banco confere `app.admin_ou_gestor()`). Aqui só não se oferece a tela a quem
 * o banco recusaria.
 */
export default async function Pagina() {
  const [sessao, catalogos] = await Promise.all([requireSession(), carregarCatalogos()]);
  if (!temPoderDeGestao(sessao.papel)) redirect('/sem-permissao');
  const criaModelo = sessao.papel === 'admin' || sessao.papel === 'gestor';
  return <TelaEnvios catalogos={catalogos} criaModelo={criaModelo} />;
}
