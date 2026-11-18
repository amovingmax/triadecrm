'use client';

import { useEffect, useRef } from 'react';
import { ExternalLink, FileSpreadsheet, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';

import { ImportarSistemaAtual } from './importar-sistema-atual';
import { formatarQuando } from './no-portal';
import { favoritoDeSincronizar } from './sincronizar-canal-pro';
import { URL_DO_CANAL_PRO } from './tipos';

/**
 * "Sincronizar Canal Pro" (18/11/2026): ensina a guardar o favorito e a clicar
 * nele com o Canal Pro aberto. A conferência e a gravação acontecem na aba que o
 * favorito abre (`/anuncios/sincronizar`). Os dois jeitos de antes (a planilha
 * do Canal Pro e o arquivo da Arbo) ficam aqui embaixo, fora do cabeçalho.
 */
export function FolhaSincronizar({
  aberto,
  aoMudar,
  sincronizadoEm,
  temEnderecoDoSistemaAtual,
  aoAbrirPlanilha,
}: {
  aberto: boolean;
  aoMudar: (aberto: boolean) => void;
  /** A última lista do Canal Pro (planilha ou sincronização). */
  sincronizadoEm: string | null;
  temEnderecoDoSistemaAtual: boolean;
  aoAbrirPlanilha: () => void;
}) {
  return (
    <Sheet open={aberto} onOpenChange={aoMudar}>
      <SheetContent
        side="right"
        className="w-full gap-0 overflow-y-auto p-0 data-[side=right]:sm:max-w-lg"
      >
        <SheetHeader className="gap-1 border-b border-hairline p-5 pr-14">
          <SheetTitle className="text-lg">Sincronizar com o Canal Pro</SheetTitle>
          <SheetDescription>
            Um clique traz tudo o que está lá: situação, números e todas as fotos, inclusive dos
            anúncios não publicados. Nada entra repetido.
          </SheetDescription>
        </SheetHeader>
        <div className="flex flex-col gap-5 p-5 text-sm">
          <Passo n={1} titulo="Guarde o favorito na barra de favoritos">
            <p className="text-muted-foreground">
              Uma vez só, no computador. Arraste o botão laranja para a barra de favoritos do
              navegador (no Chrome, Ctrl+Shift+B ou ⌘+Shift+B mostra a barra).
            </p>
            {aberto ? <Favorito /> : null}
          </Passo>
          <Passo n={2} titulo="No Canal Pro, abra Meus anúncios e clique no favorito">
            <p className="text-muted-foreground">
              Ele pede ao Canal Pro a lista de todos os anúncios da conta, publicados ou não, com
              todas as fotos, e abre o CRM numa aba nova. Usa o seu login, na sua aba: o CRM não
              guarda senha.
            </p>
            <Button asChild variant="outline" className="toque h-11 w-fit md:h-9">
              <a href={URL_DO_CANAL_PRO} target="_blank" rel="noopener noreferrer">
                <ExternalLink aria-hidden="true" />
                Abrir o Canal Pro
              </a>
            </Button>
          </Passo>
          <Passo n={3} titulo="Confira o que muda e aplique">
            <p className="text-muted-foreground">
              Na aba nova, o CRM mostra o que é novo, o que ganha fotos, o que só atualiza situação
              e números e o que é o mesmo imóvel com outro código, que não entra. Nada é gravado
              antes do “Aplicar”.
            </p>
          </Passo>
          <p className="text-xs text-muted-foreground">
            {sincronizadoEm
              ? `Última lista do Canal Pro ${formatarQuando(sincronizadoEm)}.`
              : 'O CRM ainda não tem a lista do Canal Pro.'}
          </p>

          <div className="flex flex-col gap-2 border-t border-hairline pt-4">
            <p className="font-medium">Outros jeitos</p>
            <p className="text-muted-foreground">
              Se o favorito não funcionar: a planilha que o Canal Pro exporta (traz situação e
              números, sem fotos) ou o arquivo da Arbo, o sistema que publica hoje.
            </p>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                className="toque h-11 md:h-9"
                onClick={() => {
                  aoMudar(false);
                  aoAbrirPlanilha();
                }}
              >
                <FileSpreadsheet aria-hidden="true" />
                Planilha do Canal Pro
              </Button>
              <ImportarSistemaAtual temEndereco={temEnderecoDoSistemaAtual} />
            </div>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function Passo({ n, titulo, children }: { n: number; titulo: string; children: React.ReactNode }) {
  return (
    <section className="grid grid-cols-[2rem_minmax(0,1fr)] gap-3">
      <span className="grid size-8 place-items-center rounded-full bg-muted text-sm font-semibold numerico">
        {n}
      </span>
      <div className="flex min-w-0 flex-col gap-2 pt-1">
        <h3 className="font-medium">{titulo}</h3>
        {children}
      </div>
    </section>
  );
}

/**
 * O botão para arrastar. O React recusa `javascript:` no `href`, então o endereço
 * entra depois de montar, direto no elemento. Clicar aqui dentro só ensina.
 */
function Favorito() {
  const ref = useRef<HTMLAnchorElement>(null);
  useEffect(() => {
    ref.current?.setAttribute('href', favoritoDeSincronizar(window.location.origin));
  }, []);
  return (
    <a
      ref={ref}
      draggable
      onClick={(e) => {
        e.preventDefault();
        toast.info('Arraste este botão para a barra de favoritos.', {
          description: 'Ele funciona dentro do Canal Pro, com a página Meus anúncios aberta.',
        });
      }}
      className="inline-flex h-11 w-fit cursor-grab items-center gap-2 rounded-full border-2 border-dashed border-black/30 bg-menta px-4 font-semibold text-menta-tinta md:h-10"
      title="Arraste para a barra de favoritos"
    >
      <RefreshCw className="size-4" aria-hidden="true" />
      Imova: sincronizar
    </a>
  );
}
