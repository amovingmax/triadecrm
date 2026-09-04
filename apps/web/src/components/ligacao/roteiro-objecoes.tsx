'use client';

import { useState } from 'react';
import { ShieldQuestionMark } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';

import { objecoesDoRoteiro, type NoRoteiro, type Roteiro, type VarianteRoteiro } from './tipos';

/**
 * O bloco de objeções: alcançável de QUALQUER nó, a qualquer momento (R13 §3.2).
 *
 * Ele não faz parte da árvore principal — é a lista do que o cliente diz quando sai
 * do trilho ("manda por WhatsApp", "quanto custa", "de onde tirou meu número"). Um
 * toque leva à resposta pronta, e a resposta devolve ao fluxo pelas próprias saídas
 * dela, que já apontam de volta para o gancho da variante.
 *
 * No desktop é uma coluna fixa ao lado do roteiro: quem liga está sentado e o olho
 * acha a objeção sem procurar. No celular é uma gaveta pelo rodapé, porque a fala em
 * corpo grande é o que não pode perder espaço.
 */
export function ObjecoesLaterais({
  roteiro,
  variante,
  aoEscolher,
}: {
  roteiro: Roteiro;
  variante: VarianteRoteiro;
  aoEscolher: (no: NoRoteiro) => void;
}) {
  const objecoes = objecoesDoRoteiro(roteiro, variante);
  if (objecoes.length === 0) return null;

  return (
    <aside className="hidden w-56 shrink-0 flex-col gap-2 lg:flex" aria-label="Objeções">
      <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
        Se ele disser
      </p>
      {objecoes.map((no) => (
        <button
          key={no.id}
          type="button"
          onClick={() => aoEscolher(no)}
          className="toque min-h-10 rounded-lg border border-hairline px-3 py-2 text-left text-sm leading-snug text-muted-foreground transition-colors outline-none hover:border-input hover:bg-muted hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          {rotuloDaObjecao(no)}
        </button>
      ))}
    </aside>
  );
}

/** A mesma lista, como gaveta pelo rodapé: é a versão de celular. */
export function ObjecoesEmGaveta({
  roteiro,
  variante,
  aoEscolher,
}: {
  roteiro: Roteiro;
  variante: VarianteRoteiro;
  aoEscolher: (no: NoRoteiro) => void;
}) {
  const [aberta, setAberta] = useState(false);
  const objecoes = objecoesDoRoteiro(roteiro, variante);
  if (objecoes.length === 0) return null;

  return (
    <Sheet open={aberta} onOpenChange={setAberta}>
      <SheetTrigger asChild>
        <Button variant="outline" className="h-11 w-full lg:hidden">
          <ShieldQuestionMark aria-hidden="true" />
          Objeções
        </Button>
      </SheetTrigger>
      <SheetContent
        side="bottom"
        className="sombra-base-forte max-h-[80dvh] overflow-y-auto rounded-t-xl pb-[calc(1rem+var(--area-segura-inferior))]"
      >
        <SheetHeader>
          <SheetTitle>Se ele disser</SheetTitle>
          <SheetDescription>
            A resposta pronta, e depois dela a conversa volta para onde estava.
          </SheetDescription>
        </SheetHeader>
        <div className="flex flex-col gap-2 px-4 pb-4">
          {objecoes.map((no) => (
            <button
              key={no.id}
              type="button"
              onClick={() => {
                setAberta(false);
                aoEscolher(no);
              }}
              className="toque min-h-12 rounded-lg border border-hairline px-3 py-2.5 text-left text-base leading-snug transition-colors outline-none hover:border-input hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              {rotuloDaObjecao(no)}
            </button>
          ))}
        </div>
      </SheetContent>
    </Sheet>
  );
}

/**
 * O rótulo é a OBJEÇÃO na boca do cliente, não a resposta — o nó guarda a resposta,
 * que é longa demais para virar botão. Id desconhecido cai no começo do próprio texto:
 * uma objeção nova acrescentada à seed nunca fica sem rótulo na tela.
 */
export function rotuloDaObjecao(no: NoRoteiro): string {
  const conhecido = ROTULOS_DE_OBJECAO[no.id];
  if (conhecido) return conhecido;
  const inicio = no.texto.trim().split(/(?<=[.?!])\s/)[0] ?? no.texto;
  return inicio.length > 60 ? `${inicio.slice(0, 57)}…` : inicio;
}

const ROTULOS_DE_OBJECAO: Readonly<Record<string, string>> = {
  obj_whatsapp: 'Manda por WhatsApp',
  obj_concorrente: 'Já anuncio em outro site',
  obj_sem_tempo: 'Não tenho tempo agora',
  obj_preco: 'Quanto custa?',
  obj_mais_um_app: 'Não quero mais um app',
  obj_nao_preciso: 'Não preciso disso',
  obj_quem_ja_usa: 'Quem já usa aí?',
  obj_origem: 'De onde tirou meu número?',
  obj_financeiro: 'Dúvida de dinheiro',
};
