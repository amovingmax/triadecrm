'use client';

import { TriangleAlert, X } from 'lucide-react';

import { cn } from '@/lib/utils';
import type { AvisoDoQuadro } from './use-quadro';

/**
 * O que o quadro diz quando alguma coisa não deu certo.
 *
 * Regra desta tela: **nenhuma recusa morre no console.** O cartão volta para a coluna
 * de origem sozinho (a reversão da atualização otimista), e um cartão que volta sem
 * explicação faz a pessoa arrastar de novo, e de novo. O aviso fica na tela até ela
 * fechar ou até o próximo movimento dar certo — não é `toast` de quatro segundos que
 * some enquanto ela ainda está olhando para o cartão.
 *
 * A brasa (`--destructive`, que é o `quente` da escala térmica) entra só na borda e no
 * ícone. Preenchimento cheio criaria um retângulo vermelho concorrendo com a
 * temperatura dos cartões que estão logo abaixo, na mesma tela.
 */
export function AvisoDoMovimento({
  aviso,
  aoFechar,
}: {
  aviso: AvisoDoQuadro;
  aoFechar: () => void;
}) {
  return (
    <div
      role="alert"
      className={cn(
        'flex items-start gap-2.5 rounded-xl border px-3 py-2.5',
        aviso.tom === 'recusa'
          ? 'border-destructive/40 bg-destructive/8'
          : 'border-hairline bg-muted',
      )}
    >
      <TriangleAlert
        className={cn(
          'mt-0.5 size-4 shrink-0',
          aviso.tom === 'recusa' ? 'text-destructive' : 'text-muted-foreground',
        )}
        aria-hidden="true"
      />
      <div className="min-w-0 flex-1">
        <p
          className={cn(
            'text-sm font-medium',
            aviso.tom === 'recusa' ? 'text-destructive-texto' : 'text-foreground',
          )}
        >
          {aviso.titulo}
        </p>
        {aviso.detalhe ? (
          <p className="mt-0.5 text-xs text-muted-foreground">{aviso.detalhe}</p>
        ) : null}
      </div>
      <button
        type="button"
        onClick={aoFechar}
        aria-label="Fechar o aviso"
        className="-mt-0.5 inline-flex size-7 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-accent focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
      >
        <X className="size-4" aria-hidden="true" />
      </button>
    </div>
  );
}
