'use client';

import { ArrowRight, Loader2 } from 'lucide-react';

import { cn } from '@/lib/utils';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { useEhCelular } from '@/components/parceiros/usar-eh-celular';
import { type DesfechoCatalogo, type EtapaAlvo } from '@/components/registro/tipos';

import { type PedidoDeDesfecho } from './tipos';

/**
 * A folha que pergunta O QUE ACONTECEU no compromisso.
 *
 * É a mesma gramática do passo 2 de `/registrar`: uma lista de desfechos do catálogo,
 * e o toque no desfecho é o commit (ou abre a folha de campo que falta, para os que
 * exigem motivo de perda, nova data ou evidência de autorização). Nada é lista fixa
 * em código: as opções chegam prontas em `pedido.opcoes`, recortadas do
 * `public.interaction_outcomes` por `recortesDoCompromisso`.
 *
 * Cada linha diz para onde o desfecho leva o negócio, quando a etapa de destino
 * existe no funil deste parceiro — cinco dos nove destinos do catálogo não existem no
 * funil `produtor`, que é metade da base, e prometer uma promoção que não vai
 * acontecer seria mentira.
 */
export function FolhaDesfecho({
  pedido,
  etapasAlvo,
  gravando,
  aoEscolher,
  aoFechar,
}: {
  pedido: PedidoDeDesfecho | null;
  etapasAlvo: readonly EtapaAlvo[];
  gravando: boolean;
  aoEscolher: (desfecho: DesfechoCatalogo) => void;
  aoFechar: () => void;
}) {
  const ehCelular = useEhCelular();

  return (
    <Sheet
      open={pedido !== null}
      onOpenChange={(aberta) => {
        if (!aberta && !gravando) aoFechar();
      }}
    >
      <SheetContent
        side={ehCelular ? 'bottom' : 'right'}
        className="sombra-base-forte max-h-[92dvh] overflow-y-auto pb-[calc(1rem+var(--area-segura-inferior))] max-md:rounded-t-xl sm:max-w-md md:max-h-none"
      >
        <SheetHeader>
          <SheetTitle>{pedido?.titulo ?? 'O que aconteceu'}</SheetTitle>
          <SheetDescription>{pedido?.descricao ?? ''}</SheetDescription>
        </SheetHeader>

        <div className="flex flex-col gap-1.5 px-4 pb-4">
          {pedido?.opcoes.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Não há resultado deste tipo para registrar neste parceiro. Se ele procurou você, anote
              na ficha: anotação não devolve ninguém para a fila.
            </p>
          ) : null}

          {pedido?.opcoes.map((desfecho) => {
            const destino = etapasAlvo.find(
              (e) =>
                e.pipelineId === pedido.compromisso.pipelineId &&
                e.slug === desfecho.target_stage_slug,
            );
            return (
              <button
                key={desfecho.id}
                type="button"
                disabled={gravando}
                onClick={() => aoEscolher(desfecho)}
                className={cn(
                  'toque flex min-h-14 items-center gap-3 rounded-lg border border-hairline px-3.5 text-left transition-colors outline-none',
                  'hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50',
                )}
              >
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="text-sm font-medium">{desfecho.name}</span>
                  <span className="text-xs text-muted-foreground">
                    {destino
                      ? `Leva para "${destino.nome}".`
                      : desfecho.target_stage_slug
                        ? 'Este funil não tem a etapa deste resultado: a etapa não muda.'
                        : 'Não muda a etapa.'}
                    {desfecho.next_action_label ? ` Depois: ${desfecho.next_action_label}.` : ''}
                  </span>
                </span>
                <ArrowRight className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              </button>
            );
          })}

          {gravando ? (
            <p className="flex items-center gap-2 pt-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              Gravando...
            </p>
          ) : null}
        </div>
      </SheetContent>
    </Sheet>
  );
}
