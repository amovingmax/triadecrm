import { ChevronRight } from 'lucide-react';

import { cn } from '@/lib/utils';

/**
 * Nota de rodapé que nasce fechada.
 *
 * O CRM tem um punhado de explicações que precisam existir — o que ainda não está
 * ligado, por que a ordem é essa, o que não entra na fila — e que não precisam estar
 * abertas o tempo todo. Deixá-las expandidas custa meia tela em cada rota e empurra a
 * lista de trabalho para baixo da dobra; a pessoa que precisa da explicação lê uma vez
 * e nunca mais, e quem já sabe paga o preço todo dia.
 *
 * `<details>` nativo em vez de estado em React: abre sem JavaScript, entra na busca da
 * página com Ctrl+F mesmo fechado (o navegador expande sozinho ao encontrar) e o leitor
 * de tela já anuncia o estado.
 */
export function NotaRecolhida({
  titulo,
  children,
  className,
}: {
  titulo: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <details className={cn('group border-t border-hairline pt-3 text-xs', className)}>
      <summary className="flex min-h-9 cursor-pointer list-none items-center gap-1 text-muted-foreground transition-colors hover:text-foreground">
        <ChevronRight
          className="size-3.5 shrink-0 transition-transform group-open:rotate-90"
          aria-hidden="true"
        />
        <span className="font-medium">{titulo}</span>
      </summary>
      <div className="mt-2 max-w-prose leading-relaxed text-muted-foreground">{children}</div>
    </details>
  );
}
