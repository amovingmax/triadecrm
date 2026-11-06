import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { requireRole } from '@/lib/auth/session';
import { EMPRESA } from '@/lib/empresa';
import { PAPEIS_DO_CRM } from '@/lib/navegacao';
import { TelaAnuncios } from '@/components/anuncios/tela-anuncios';
import { podePublicarAnuncio } from '@/components/anuncios/tipos';

export const metadata: Metadata = { title: 'Anúncios' };

/**
 * Anúncios de imóveis que sobem para o Canal Pro (04/11/2026), só na Imova.
 *
 * Na KOMUNE a rota não existe (404): o módulo é da empresa, e o banco dela nem
 * tem as tabelas. Admin, gestor e SDR entram; quem publica é a gestão
 * (`podePublicarAnuncio`), e o Postgres confere de novo em cada função.
 */
export default async function Pagina() {
  if (!EMPRESA.modulos.anuncios) notFound();
  const sessao = await requireRole(...PAPEIS_DO_CRM);
  return <TelaAnuncios podePublicar={podePublicarAnuncio(sessao.papel)} />;
}
