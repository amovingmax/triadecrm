'use client';

import Link from 'next/link';
import { Building2, Camera, CloudUpload, Layers, Pencil } from 'lucide-react';

import { Button } from '@/components/ui/button';

import type { ItemDeAtencao } from './aba-dos-anuncios';

const ICONE: Record<ItemDeAtencao['icone'], typeof Camera> = {
  fotos: Camera,
  editar: Pencil,
  copia: Layers,
  publicar: CloudUpload,
  canal_pro: Building2,
};

/**
 * Uma pendência do "Precisa de você" (18/11/2026), cada uma com a ação dela.
 * Desde 24/11/2026 elas moram no painel Pendências, logo abaixo da troca da
 * Arbo: a linha é a mesma do protótipo responsivo (ícone, texto e, do
 * computador para cima, a ação à direita).
 */
export function LinhaDePendencia({
  item,
  aoSincronizar,
  aoAbrir,
  aoFiltrarProntos,
}: {
  item: ItemDeAtencao;
  aoSincronizar: () => void;
  aoAbrir: (anuncioId: string) => void;
  aoFiltrarProntos: () => void;
}) {
  const Icone = ICONE[item.icone];
  const acao = item.acao;
  const variante = item.id === 'fotos' ? 'default' : 'outline';
  return (
    <li className="grid grid-cols-[2.5rem_minmax(0,1fr)] gap-x-3 gap-y-1 py-3 lg:grid-cols-[2.5rem_minmax(0,1fr)_auto] lg:items-center">
      <span className="row-span-2 grid size-10 place-items-center rounded-lg bg-muted text-muted-foreground lg:row-span-1">
        <Icone className="size-4" aria-hidden="true" />
      </span>
      <div className="min-w-0">
        <p className="text-sm font-semibold">{item.titulo}</p>
        <p className="text-[13px] text-muted-foreground">{item.texto}</p>
      </div>
      <div className="col-start-2 mt-1.5 flex flex-wrap gap-2 lg:col-start-3 lg:mt-0 lg:justify-end">
        {acao.tipo === 'editar' ? (
          <Button asChild variant={variante} className="toque h-11 md:h-9">
            <Link href={`/anuncios/${acao.anuncioId}`}>{item.rotulo}</Link>
          </Button>
        ) : (
          <Button
            variant={variante}
            className="toque h-11 md:h-9"
            onClick={() =>
              acao.tipo === 'sincronizar'
                ? aoSincronizar()
                : acao.tipo === 'abrir'
                  ? aoAbrir(acao.anuncioId)
                  : aoFiltrarProntos()
            }
          >
            {item.id === 'fotos' ? <Camera aria-hidden="true" /> : null}
            {item.rotulo}
          </Button>
        )}
      </div>
    </li>
  );
}
