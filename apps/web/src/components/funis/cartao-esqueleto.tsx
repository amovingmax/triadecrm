import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

/**
 * Cartão em carregamento. Existe para a coluna do quadro não pular de altura quando
 * a página de cartões chega: o esqueleto tem exatamente a mesma caixa do
 * `CartaoNegocio` (76px mínimos, quatro linhas, o mesmo raio e a mesma hairline),
 * inclusive a faixa da borda esquerda onde entrará a `BarraEtapa`.
 *
 * Sem preenchimento de propósito: antes da resposta do banco não se sabe em que
 * etapa o negócio está, e chutar uma altura pintaria a coluna inteira com um
 * progresso que talvez nem exista ali. (Até 28/09/2026 essa faixa era a barra
 * térmica, e o argumento era o mesmo.)
 */
export function CartaoEsqueleto({ className }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={cn(
        'relative flex min-h-[76px] w-full flex-col gap-2 rounded-xl border border-hairline bg-card py-3 pr-3 pl-4',
        className,
      )}
    >
      <Skeleton className="absolute inset-y-0 left-0 w-[3px] rounded-none" />
      <div className="flex items-center justify-between gap-2">
        <Skeleton className="h-4 w-1/2" />
        <Skeleton className="h-4 w-8" />
      </div>
      <Skeleton className="h-3 w-3/4" />
      <Skeleton className="h-3 w-24" />
      <div className="flex items-center justify-between gap-2">
        <Skeleton className="h-3 w-28" />
        <Skeleton className="h-3 w-16" />
      </div>
    </div>
  );
}

/** Uma coluna de esqueletos, para a primeira abertura do quadro. */
export function ColunaEsqueleto({ quantidade = 4 }: { quantidade?: number }) {
  return (
    <div className="flex flex-col gap-2">
      {Array.from({ length: quantidade }, (_, indice) => (
        <CartaoEsqueleto key={indice} />
      ))}
    </div>
  );
}
