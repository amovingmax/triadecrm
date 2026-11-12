'use client';

import { useState } from 'react';
import { Check, ChevronUp, Send } from 'lucide-react';

import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';

/**
 * A barra de enviar, fixa embaixo (protótipo B, 12/11/2026): a frase do que vai
 * acontecer ("Vai para 3 pessoas, agora, em nome da KOMUNE."), o custo e o
 * limite de hoje logo abaixo, "Mais opções" fechado e o botão. Botão apagado
 * sempre diz por quê, ao lado. Criado o disparo, a barra vira a confirmação.
 */
export function BarraDeEnviar({
  frase,
  detalhe,
  rotuloDoBotao,
  podeEnviar,
  enviando,
  falta,
  aoEnviar,
  maisOpcoes,
  criado,
  aoVerAndamento,
  aoFazerOutro,
}: {
  frase: string;
  detalhe: string;
  rotuloDoBotao: string;
  podeEnviar: boolean;
  enviando: boolean;
  /** O primeiro motivo de o botão estar apagado. */
  falta: string | null;
  aoEnviar: () => void;
  maisOpcoes: React.ReactNode;
  /** A frase da confirmação, depois de criado. */
  criado: string | null;
  aoVerAndamento: () => void;
  aoFazerOutro: () => void;
}) {
  const [aberta, setAberta] = useState(false);

  return (
    <section
      aria-labelledby="bloco-enviar"
      className={cn(
        // A mesma barra presa ao pé da Revisão (`revisao/barra-de-lote`): no
        // celular, de ponta a ponta acima do menu de baixo; no computador, um
        // cartão flutuando no pé da coluna.
        'sticky bottom-[calc(var(--altura-barra-inferior)+var(--area-segura-inferior))] z-30 -mx-4 border-t border-hairline bg-background/95 px-4 py-3 backdrop-blur',
        'md:bottom-4 md:mx-0 md:rounded-xl md:border md:bg-card md:px-5 md:py-4 md:sombra-base-forte',
      )}
    >
      <h2 id="bloco-enviar" className="sr-only">
        Enviar
      </h2>

      {criado !== null ? (
        <div role="status" className="flex flex-col gap-3 md:flex-row md:items-center md:gap-4">
          <div className="flex min-w-0 flex-1 items-center gap-3">
            <span
              aria-hidden="true"
              className="flex size-11 shrink-0 items-center justify-center rounded-full bg-menta text-menta-tinta"
            >
              <Check className="size-5" strokeWidth={2.25} />
            </span>
            <div className="min-w-0">
              <p className="font-semibold">Disparo criado</p>
              <p className="text-sm text-muted-foreground">{criado}</p>
            </div>
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              className="toque h-11 flex-1 px-4 md:flex-none"
              onClick={aoVerAndamento}
            >
              Ver andamento
            </Button>
            <Button className="toque h-11 flex-1 px-4 md:flex-none" onClick={aoFazerOutro}>
              Fazer outro
            </Button>
          </div>
        </div>
      ) : (
        <>
          {aberta ? (
            <div
              id="mais-opcoes"
              className="mb-3 max-h-[45dvh] overflow-y-auto border-b border-hairline pb-4 md:mb-4 md:max-h-[50dvh]"
            >
              {maisOpcoes}
            </div>
          ) : null}
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:gap-4">
            <div className="min-w-0 flex-1 space-y-0.5">
              <p className="text-[15px] leading-snug font-semibold">{frase}</p>
              {detalhe ? (
                <p className="text-xs leading-relaxed text-muted-foreground">{detalhe}</p>
              ) : null}
              {falta ? (
                <p
                  id="motivo-do-envio"
                  className="text-xs leading-relaxed font-medium text-foreground"
                >
                  {falta}
                </p>
              ) : null}
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                aria-expanded={aberta}
                aria-controls="mais-opcoes"
                className="toque h-12 px-4 md:h-10"
                onClick={() => setAberta((a) => !a)}
              >
                Mais opções
                <ChevronUp
                  className={cn('transition-transform', aberta && 'rotate-180')}
                  aria-hidden="true"
                />
              </Button>
              <Button
                className="toque h-12 flex-1 px-5 text-[15px] md:flex-none"
                disabled={!podeEnviar || enviando}
                aria-describedby={falta ? 'motivo-do-envio' : undefined}
                onClick={aoEnviar}
              >
                <Send aria-hidden="true" />
                {rotuloDoBotao}
              </Button>
            </div>
          </div>
        </>
      )}
    </section>
  );
}
