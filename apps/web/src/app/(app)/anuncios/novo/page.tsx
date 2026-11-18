import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { requireRole } from '@/lib/auth/session';
import { EMPRESA } from '@/lib/empresa';
import { PAPEIS_DO_CRM } from '@/lib/navegacao';
import { EditorDeAnuncio, type InicioDoAnuncio } from '@/components/anuncios/editor-anuncio';
import { ehTerreno } from '@/components/anuncios/regras-do-cartao';
import { podePublicarAnuncio, TIPOS_DE_IMOVEL } from '@/components/anuncios/tipos';

export const metadata: Metadata = { title: 'Novo anúncio' };

type Busca = Record<string, string | string[] | undefined>;
const umSo = (v: string | string[] | undefined) => (typeof v === 'string' ? v.trim() : '');

/**
 * O tipo, a cidade, o bairro e a área que o "Novo anúncio" conferiu antes de
 * abrir o editor (18/11/2026): o editor já começa com eles. O que não for
 * reconhecível fica de fora.
 */
function inicioDaBusca(busca: Busca): InicioDoAnuncio {
  const inicio: InicioDoAnuncio = {};
  const tipo = umSo(busca.tipo);
  if (TIPOS_DE_IMOVEL.some((t) => t.id === tipo)) inicio.tipo = tipo;
  const cidade = umSo(busca.cidade).slice(0, 120);
  if (cidade) inicio.cidade = cidade;
  const bairro = umSo(busca.bairro).slice(0, 120);
  if (bairro) inicio.bairro = bairro;
  const area = umSo(busca.area);
  if (/^\d{1,7}$/.test(area)) {
    if (ehTerreno(inicio.tipo ?? '')) inicio.area_total = area;
    else inicio.area_util = area;
  }
  return inicio;
}

/** O anúncio que ainda não existe: o primeiro salvar cria o rascunho e abre as fotos. */
export default async function Pagina({ searchParams }: { searchParams: Promise<Busca> }) {
  if (!EMPRESA.modulos.anuncios) notFound();
  const sessao = await requireRole(...PAPEIS_DO_CRM);
  return (
    <EditorDeAnuncio
      id={null}
      podePublicar={podePublicarAnuncio(sessao.papel)}
      inicio={inicioDaBusca(await searchParams)}
    />
  );
}
