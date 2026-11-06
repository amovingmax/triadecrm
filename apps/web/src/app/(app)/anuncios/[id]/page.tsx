import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { requireRole } from '@/lib/auth/session';
import { EMPRESA } from '@/lib/empresa';
import { PAPEIS_DO_CRM } from '@/lib/navegacao';
import { EditorDeAnuncio } from '@/components/anuncios/editor-anuncio';
import { podePublicarAnuncio } from '@/components/anuncios/tipos';

export const metadata: Metadata = { title: 'Anúncio' };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Um anúncio: o formulário, as fotos e o que falta para ir ao ar. */
export default async function Pagina({ params }: { params: Promise<{ id: string }> }) {
  if (!EMPRESA.modulos.anuncios) notFound();
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const sessao = await requireRole(...PAPEIS_DO_CRM);
  return <EditorDeAnuncio id={id} podePublicar={podePublicarAnuncio(sessao.papel)} />;
}
