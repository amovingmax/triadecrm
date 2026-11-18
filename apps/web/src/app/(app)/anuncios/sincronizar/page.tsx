import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { requireRole } from '@/lib/auth/session';
import { EMPRESA } from '@/lib/empresa';
import { PAPEIS_DO_CRM } from '@/lib/navegacao';
import { ReceberSincronizacao } from '@/components/anuncios/receber-sincronizacao';
import { podePublicarAnuncio } from '@/components/anuncios/tipos';

export const metadata: Metadata = { title: 'Sincronizar com o Canal Pro' };

/**
 * A aba que o favorito "Imova: sincronizar" abre (18/11/2026), só na Imova. A
 * lista do Canal Pro vem no fragmento do endereço, que nunca chega ao servidor;
 * quem confere e grava é o navegador, com as funções do banco que já conferem
 * quem pode (admin e gestor).
 */
export default async function Pagina() {
  if (!EMPRESA.modulos.anuncios) notFound();
  const sessao = await requireRole(...PAPEIS_DO_CRM);
  if (!podePublicarAnuncio(sessao.papel)) {
    return (
      <p className="max-w-xl text-sm text-muted-foreground">
        Só a gestão sincroniza com o Canal Pro. Peça a um gestor para clicar no favorito.
      </p>
    );
  }
  return <ReceberSincronizacao />;
}
