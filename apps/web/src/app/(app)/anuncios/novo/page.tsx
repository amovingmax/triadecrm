import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { requireRole } from '@/lib/auth/session';
import { EMPRESA } from '@/lib/empresa';
import { PAPEIS_DO_CRM } from '@/lib/navegacao';
import { EditorDeAnuncio } from '@/components/anuncios/editor-anuncio';
import { podePublicarAnuncio } from '@/components/anuncios/tipos';

export const metadata: Metadata = { title: 'Novo anúncio' };

/** O anúncio que ainda não existe: o primeiro salvar cria o rascunho e abre as fotos. */
export default async function Pagina() {
  if (!EMPRESA.modulos.anuncios) notFound();
  const sessao = await requireRole(...PAPEIS_DO_CRM);
  return <EditorDeAnuncio id={null} podePublicar={podePublicarAnuncio(sessao.papel)} />;
}
