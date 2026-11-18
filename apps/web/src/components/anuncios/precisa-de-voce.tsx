'use client';

import Link from 'next/link';
import { Building2, Camera, CircleCheck, CloudUpload, Layers, Pencil } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

import type { ItemDeAtencao } from './aba-dos-anuncios';

const ICONE: Record<ItemDeAtencao['icone'], typeof Camera> = {
  fotos: Camera,
  editar: Pencil,
  copia: Layers,
  publicar: CloudUpload,
  canal_pro: Building2,
};

/**
 * "Precisa de você" (18/11/2026): uma linha por pendência, cada uma com a ação
 * dela. Substitui os avisos que se repetiam no caminho, no resumo e nos cartões
 * (o relatório velho aparecia três vezes; os rascunhos incompletos, duas).
 */
export function PrecisaDeVoce({
  itens,
  aoSincronizar,
  aoAbrir,
  aoFiltrarProntos,
}: {
  itens: ItemDeAtencao[];
  aoSincronizar: () => void;
  aoAbrir: (anuncioId: string) => void;
  aoFiltrarProntos: () => void;
}) {
  if (itens.length === 0) {
    return (
      <p className="sombra-base flex items-center gap-2 rounded-xl bg-card px-4 py-3 text-sm text-cliente-texto">
        <CircleCheck className="size-4" aria-hidden="true" />
        Nada pede você agora.
      </p>
    );
  }
  return (
    <section aria-labelledby="precisa-de-voce" className="sombra-base rounded-xl bg-card py-1.5">
      <h2
        id="precisa-de-voce"
        className="px-4 pt-2.5 pb-1 font-heading text-base font-semibold md:px-5"
      >
        Precisa de você{' '}
        <span className="text-sm font-medium text-muted-foreground numerico">{itens.length}</span>
      </h2>
      <ul className="flex flex-col divide-y divide-hairline">
        {itens.map((item) => {
          const Icone = ICONE[item.icone];
          const acao = item.acao;
          const variante = item.id === 'fotos' ? 'default' : 'outline';
          return (
            <li
              key={item.id}
              className="flex flex-wrap items-center gap-x-3.5 gap-y-2 px-4 py-3 md:flex-nowrap md:px-5"
            >
              <span
                className={cn(
                  'grid size-9 shrink-0 place-items-center rounded-full',
                  item.tom === 'alerta'
                    ? 'bg-morno-fundo text-morno-texto'
                    : 'bg-primary/12 text-primary',
                )}
              >
                <Icone className="size-4" aria-hidden="true" />
              </span>
              <div className="min-w-0 flex-1 basis-[calc(100%-3.5rem)] md:basis-auto">
                <p className="text-sm font-medium">{item.titulo}</p>
                <p className="text-[13px] text-muted-foreground">{item.texto}</p>
              </div>
              <div className="ml-12 md:ml-0">
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
        })}
      </ul>
    </section>
  );
}
