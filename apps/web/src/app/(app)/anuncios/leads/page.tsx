import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { requireRole } from '@/lib/auth/session';
import { EMPRESA } from '@/lib/empresa';
import { PAPEIS_DO_CRM } from '@/lib/navegacao';
import { leadDaUrl } from '@/components/anuncios/leads/aviso-de-lead';
import { TelaLeads } from '@/components/anuncios/leads/tela-leads';

export const metadata: Metadata = { title: 'Leads dos portais' };

/**
 * Os leads dos portais (05/11/2026), só na Imova: quem pediu contato num
 * anúncio do ZAP Imóveis, do Viva Real ou da OLX.
 *
 * Na KOMUNE a rota não existe (404), como as irmãs. Admin, gestor e SDR entram e
 * trabalham o lead (o banco confere de novo em `public.portal_lead_*`).
 * `?anuncio=<código>` abre já filtrada: é o atalho da lista de Anúncios.
 * `?lead=<id>` abre a ficha do lead: é o toque no aviso de lead novo (11/11/2026).
 */
export default async function Pagina({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  if (!EMPRESA.modulos.anuncios) notFound();
  const [sessao, params] = await Promise.all([requireRole(...PAPEIS_DO_CRM), searchParams]);
  const anuncio = typeof params.anuncio === 'string' ? params.anuncio.trim().slice(0, 100) : '';
  return (
    <TelaLeads
      euId={sessao.id}
      anuncioInicial={anuncio || null}
      leadInicial={leadDaUrl(params.lead)}
    />
  );
}
