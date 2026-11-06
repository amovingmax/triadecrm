import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { requireRole } from '@/lib/auth/session';
import { EMPRESA } from '@/lib/empresa';
import { PAPEIS_DO_CRM } from '@/lib/navegacao';
import { TelaDaIa } from '@/components/ia-que-atende/tela';

export const metadata: Metadata = { title: 'IA que atende' };

/**
 * A IA que atende o cliente sozinha (06/11/2026), só na Imova.
 *
 * Na KOMUNE a rota não existe (404): o módulo é da empresa, e o banco dela nem tem
 * as tabelas. Admin, gestor e SDR entram, avaliam as respostas e escrevem no
 * caderno; ligar, desligar e configurar é de admin e gestor, e o Postgres confere
 * de novo em cada função (`app.admin_ou_gestor`).
 */
export default async function Pagina() {
  if (!EMPRESA.modulos.iaQueAtende) notFound();
  await requireRole(...PAPEIS_DO_CRM);
  return <TelaDaIa />;
}
