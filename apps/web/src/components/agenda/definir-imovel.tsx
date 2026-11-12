'use client';

import { useState } from 'react';
import { Loader2, MapPinPlus } from 'lucide-react';
import { toast } from 'sonner';

import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { useEhCelular } from '@/components/parceiros/usar-eh-celular';

import { EscolherImovel } from './escolher-imovel';
import {
  ESCOLHA_VAZIA,
  FALTA_O_IMOVEL,
  recadoDoImovel,
  validarImovel,
  type EscolhaDoImovel,
} from './imovel-da-visita';
import { definirImovelDaVisita } from './imovel-da-visita-dados';

/**
 * "Definir imóvel" (11/11/2026, só na Imova): a visita que ficou sem imóvel — a
 * antiga, a do Calendly sem endereço nem código, a que entrou por outra porta —
 * ganha o anúncio ou o endereço por `public.visita_definir_imovel`. É a mesma
 * escolha do "Novo compromisso", numa folha, aberta do cartão da Agenda e da
 * agenda de hoje do Meu dia.
 */
export function DefinirImovel({
  taskId,
  organizacao,
  aoMudar,
  compacto = false,
  className,
}: {
  taskId: string;
  /** Com quem é a visita, para a folha dizer de qual se trata. */
  organizacao: string | null;
  /** Gravou: quem chamou relê a lista. */
  aoMudar: () => void;
  /** No Meu dia, o botão pequeno da coluna. */
  compacto?: boolean;
  className?: string;
}) {
  const ehCelular = useEhCelular();
  const [aberta, setAberta] = useState(false);

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size={compacto ? 'sm' : 'lg'}
        className={cn('toque h-11', compacto ? 'md:h-8' : 'md:h-9', className)}
        onClick={() => setAberta(true)}
      >
        <MapPinPlus aria-hidden="true" />
        Definir imóvel
      </Button>
      <Sheet open={aberta} onOpenChange={setAberta}>
        <SheetContent
          side={ehCelular ? 'bottom' : 'right'}
          className="sombra-base-forte max-h-[92dvh] overflow-y-auto pb-[calc(1rem+var(--area-segura-inferior))] max-md:rounded-t-xl sm:max-w-md md:max-h-none"
        >
          <SheetHeader>
            <SheetTitle>Definir o imóvel da visita</SheetTitle>
            <SheetDescription>
              {organizacao ? `Visita com ${organizacao}. ` : ''}Toda visita tem imóvel: o anúncio,
              ou o endereço do imóvel sem anúncio.
            </SheetDescription>
          </SheetHeader>
          {/* Nasce a cada abertura: a escolha de uma visita não aparece na próxima. */}
          {aberta ? (
            <Formulario
              taskId={taskId}
              aoGravar={() => {
                setAberta(false);
                aoMudar();
              }}
            />
          ) : null}
        </SheetContent>
      </Sheet>
    </>
  );
}

function Formulario({ taskId, aoGravar }: { taskId: string; aoGravar: () => void }) {
  const [escolha, setEscolha] = useState<EscolhaDoImovel>(ESCOLHA_VAZIA);
  const [erro, setErro] = useState<string | null>(null);
  const [gravando, setGravando] = useState(false);

  async function gravar() {
    const r = validarImovel(escolha);
    if (!r.ok) {
      setErro(r.recado);
      return;
    }
    setGravando(true);
    const gravou = await definirImovelDaVisita({
      taskId,
      anuncioId: r.anuncioId,
      endereco: r.endereco,
    });
    setGravando(false);
    if (!gravou.ok) {
      setErro(recadoDoImovel(gravou.motivo));
      return;
    }
    toast.success(
      gravou.codigo
        ? `Imóvel ${gravou.codigo} gravado na visita.`
        : 'Endereço do imóvel gravado na visita.',
    );
    aoGravar();
  }

  return (
    <div className="flex flex-col gap-5 px-4 pb-4">
      <EscolherImovel
        valor={escolha}
        aoMudar={(e) => {
          setEscolha(e);
          setErro(null);
        }}
        permiteSemAnuncio
        erro={erro}
      />
      <Button
        size="lg"
        className="toque h-11 md:h-10"
        disabled={gravando}
        onClick={() => void gravar()}
      >
        {gravando ? (
          <Loader2 className="animate-spin" aria-hidden="true" />
        ) : (
          <MapPinPlus aria-hidden="true" />
        )}
        Gravar o imóvel
      </Button>
      <p className="text-xs text-muted-foreground">
        Sem imóvel, a visita aparece como &ldquo;{FALTA_O_IMOVEL}&rdquo; na agenda, e o Maps busca
        pelo nome da ficha.
      </p>
    </div>
  );
}
