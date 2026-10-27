'use client';

import { cn } from '@/lib/utils';

import { GRUPOS_DE_EMOJIS } from './emojis';

/**
 * A grade de emojis da casa (27/10/2026): a mesma na caixa de escrever e no
 * "mais" das reações. Os grupos e a escolha moram em `emojis.ts`.
 *
 * Botões de 40 px: no celular é o dedo que escolhe.
 */
export function GradeDeEmojis({
  aoEscolher,
  className,
}: {
  aoEscolher: (emoji: string) => void;
  className?: string;
}) {
  return (
    <div className={cn('max-h-72 space-y-2 overflow-y-auto p-1', className)}>
      {GRUPOS_DE_EMOJIS.map((grupo) => (
        <section key={grupo.nome} aria-label={grupo.nome}>
          <p className="px-1 pb-1 text-[11px] text-muted-foreground">{grupo.nome}</p>
          <div className="grid grid-cols-8 gap-0.5">
            {grupo.emojis.map((emoji) => (
              <button
                key={emoji}
                type="button"
                onClick={() => aoEscolher(emoji)}
                className="flex size-10 items-center justify-center rounded-lg text-xl outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50"
              >
                {emoji}
              </button>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
